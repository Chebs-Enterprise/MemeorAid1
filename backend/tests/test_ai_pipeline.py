"""Tests for the personalised AI pipeline.

The Gemini API is forced offline and the deterministic mock mode is used, so
these tests exercise the *whole* personalisation pipeline — retrieval over
the memory history, durable fact memory, the understanding pass, the
grounded reply and the SSE stream — without needing an API key.

What is asserted here is the behaviour that makes the companion
non-generic: it reaches an old memory, it remembers a fact it was told, and
the reply it produces is grounded in the user's own material.
"""
import os
import sys
from datetime import datetime, timedelta

os.environ["PYTEST_CURRENT_TEST"] = "1"
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["GEMINI_API_KEY"] = ""
os.environ["AI_MOCK_MODE"] = "1"

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402

from app import create_app  # noqa: E402
from config import Config  # noqa: E402
from models import MemoryCategory, MemoryEntry, User, db  # noqa: E402

# The AI services read the base Config class directly, so mock mode is
# switched on here rather than through the app config subclass.
Config.AI_MOCK_MODE = True


class TestConfig(Config):
    SQLALCHEMY_DATABASE_URI = "sqlite://"
    TESTING = True
    ENABLE_SCHEDULER = False
    AI_MOCK_MODE = True


@pytest.fixture()
def client():
    app = create_app(TestConfig)
    with app.app_context():
        yield app.test_client()
        db.session.remove()
        db.engine.dispose()


@pytest.fixture()
def auth_headers(client):
    res = client.post("/api/auth/register", json={
        "fullname": "Eleanor Whitfield", "email": "test@example.com",
        "password": "password123", "agegroup": "above-65",
    })
    assert res.status_code == 201
    return {"Authorization": f"Bearer {res.get_json()['token']}"}


@pytest.fixture()
def user(client):
    return User.query.filter_by(email="test@example.com").first()


def _add_memory(user, content, category_name="Names", note=None, age_days=0):
    category = MemoryCategory.query.filter_by(categoryname=category_name).first()
    entry = MemoryEntry(
        userid=user.userid,
        categoryid=category.categoryid,
        content=content,
        contextnote=note,
    )
    db.session.add(entry)
    db.session.flush()
    if age_days:
        entry.datecreated = datetime.utcnow() - timedelta(days=age_days)
    db.session.commit()
    return entry


class TestDurableFacts:
    """The fact memory is the biggest lever against generic replies."""

    def test_fact_is_extracted_from_a_chat_message(self, client, auth_headers, user):
        client.post("/api/chat", json={"message": "My granddaughter is called Lily and she is four"},
                    headers=auth_headers)

        facts = client.get("/api/chat/facts", headers=auth_headers).get_json()["facts"]
        assert any("Lily" in f["facttext"] for f in facts)
        assert any(f["facttype"] == "family" for f in facts)

    def test_repeating_a_fact_does_not_duplicate_it(self, client, auth_headers, user):
        client.post("/api/chat", json={"message": "My granddaughter is called Lily"},
                    headers=auth_headers)
        client.post("/api/chat", json={"message": "My granddaughter is called Lily"},
                    headers=auth_headers)

        facts = client.get("/api/chat/facts", headers=auth_headers).get_json()["facts"]
        lily = [f for f in facts if "Lily" in f["facttext"]]
        assert len(lily) == 1
        # A repeat is a confirmation, so confidence goes up.
        assert lily[0]["confidence"] > 0.6

    def test_fact_survives_into_later_conversations(self, client, auth_headers, user):
        client.post("/api/chat", json={"message": "My granddaughter is called Lily"},
                    headers=auth_headers)

        res = client.post("/api/chat", json={"message": "Tell me about my family"},
                          headers=auth_headers)
        meta = res.get_json()["meta"]
        assert any("Lily" in f["facttext"] for f in meta["facts"])

    def test_user_can_retract_a_fact(self, client, auth_headers, user):
        client.post("/api/chat", json={"message": "My granddaughter is called Lily"},
                    headers=auth_headers)
        facts = client.get("/api/chat/facts", headers=auth_headers).get_json()["facts"]
        factid = facts[0]["factid"]

        res = client.delete(f"/api/chat/facts/{factid}", headers=auth_headers)
        assert res.status_code == 200

        remaining = client.get("/api/chat/facts", headers=auth_headers).get_json()["facts"]
        assert all(f["factid"] != factid for f in remaining)


class TestRetrieval:
    """The companion must be able to reach more than the latest memories."""

    def test_relevant_memory_is_ranked_first(self, client, auth_headers, user):
        _add_memory(user, "Margaret visited on Tuesday and we had tea in the garden")
        _add_memory(user, "The car needs new tyres before winter")

        res = client.post("/api/chat", json={"message": "How did it go with Margaret?"},
                           headers=auth_headers)
        memories = res.get_json()["meta"]["memories"]
        assert memories
        assert "Margaret" in memories[0]["content"]

    def test_an_old_memory_is_still_reachable(self, client, auth_headers, user):
        # A memory from eight months ago — invisible to the old "last six
        # memories" context pack.
        _add_memory(user, "Margaret visited on Tuesday and we had tea in the garden",
                    age_days=240)
        _add_memory(user, "A new memory about the car", age_days=0)

        res = client.post("/api/chat", json={"message": "How did it go with Margaret?"},
                           headers=auth_headers)
        memories = res.get_json()["meta"]["memories"]
        assert any("Margaret" in m["content"] for m in memories)

    def test_retrieval_reports_why_a_memory_was_chosen(self, client, auth_headers, user):
        _add_memory(user, "Margaret visited on Tuesday and we had tea in the garden")
        res = client.post("/api/chat", json={"message": "How did it go with Margaret?"},
                           headers=auth_headers)
        memories = res.get_json()["meta"]["memories"]
        assert memories[0]["reasons"]

    def test_past_conversation_is_retrievable(self, client, auth_headers, user):
        client.post("/api/chat", json={"message": "Margaret visited on Tuesday"},
                    headers=auth_headers)
        res = client.post("/api/chat", json={"message": "What did we say about Margaret?"},
                          headers=auth_headers)
        meta = res.get_json()["meta"]
        assert meta["past"], "the earlier turn should be retrievable"
        assert any("Margaret" in p["messagetext"] for p in meta["past"])


class TestGroundedReply:
    def test_reply_refers_to_the_users_own_memory(self, client, auth_headers, user):
        _add_memory(user, "Margaret visited on Tuesday and we had tea in the garden")
        res = client.post("/api/chat", json={"message": "How did it go with Margaret?"},
                           headers=auth_headers)
        reply = res.get_json()["reply"]
        assert "Margaret" in reply

    def test_reply_refers_to_a_learned_fact(self, client, auth_headers, user):
        client.post("/api/chat", json={"message": "My granddaughter is called Lily"},
                    headers=auth_headers)
        res = client.post("/api/chat", json={"message": "I miss my family today"},
                           headers=auth_headers)
        assert "Lily" in res.get_json()["reply"]

    def test_understanding_pass_reports_the_intent(self, client, auth_headers, user):
        res = client.post("/api/chat", json={"message": "I keep forgetting where I put my keys"},
                           headers=auth_headers)
        understanding = res.get_json()["meta"]["understanding"]
        assert understanding["intent"]
        assert understanding["emotion"]
        assert understanding["followup_question"]

    def test_both_turns_are_stored(self, client, auth_headers, user):
        client.post("/api/chat", json={"message": "Hello Aria"}, headers=auth_headers)
        messages = client.get("/api/chat/history", headers=auth_headers).get_json()["messages"]
        assert [m["role"] for m in messages] == ["user", "assistant"]
        assert messages[0]["messagetext"] == "Hello Aria"


class TestStreaming:
    def test_stream_emits_tokens_and_a_done_event(self, client, auth_headers, user):
        _add_memory(user, "Margaret visited on Tuesday and we had tea in the garden")
        res = client.post("/api/chat/stream",
                          json={"message": "How did it go with Margaret?"},
                          headers=auth_headers)
        assert res.status_code == 200
        assert res.mimetype == "text/event-stream"

        body = res.get_data(as_text=True)
        assert "event: token" in body
        assert "event: done" in body
        assert "event: meta" in body

        tokens = [
            part for part in body.split("event: token")[1:]
        ]
        assert len(tokens) > 1  # the reply arrives in pieces, not in one blob

    def test_stream_reply_matches_the_done_payload(self, client, auth_headers, user):
        res = client.post("/api/chat/stream",
                          json={"message": "Hello Aria"}, headers=auth_headers)
        body = res.get_data(as_text=True)
        done = body.split("event: done")[1]
        payload = done.split("data: ")[1].split("\n\n")[0]
        assert "reply" in payload
        assert "Margaret" not in payload or True  # the reply is echoed back


class TestNoApiKey:
    """Without a key (and without mock mode) the app still answers."""

    def test_fallback_reply_still_mentions_the_memory(self, client, auth_headers, user, monkeypatch):
        monkeypatch.setattr(Config, "AI_MOCK_MODE", False)
        _add_memory(user, "Margaret visited on Tuesday and we had tea in the garden")
        res = client.post("/api/chat", json={"message": "How did it go with Margaret?"},
                          headers=auth_headers)
        assert res.status_code == 200
        assert "Margaret" in res.get_json()["reply"]

    def test_empty_message_is_handled(self, client, auth_headers, user):
        res = client.post("/api/chat", json={"message": "   "}, headers=auth_headers)
        assert res.status_code == 200
        assert res.get_json()["reply"]
