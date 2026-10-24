"""Tests for conversational memory logging.

Telling Aria about something in the chat should be able to log a real memory:
the turn is classified, a draft is proposed and read back, and only once the
person agrees is a row written — through the same helpers the Log Memory form
uses, so the recall question and the SM-2 schedule are created too.

These tests run the deterministic offline mock, so they need no API key. What
they guard is the part that matters most: a memory is *never* claimed as saved
unless the database really holds it, and nothing is written without an
explicit yes.
"""
import os
import sys

os.environ["PYTEST_CURRENT_TEST"] = "1"
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["GEMINI_API_KEY"] = ""
os.environ["AI_MOCK_MODE"] = "1"

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402

from app import create_app  # noqa: E402
from config import Config  # noqa: E402
from models import (  # noqa: E402
    ChatMessage,
    MemoryCategory,
    MemoryEntry,
    RecallQuestion,
    ReviewSchedule,
    User,
    db,
)
from services.ai import memory_logging  # noqa: E402

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
        "fullname": "Eleanor Whitfield", "email": "logging@example.com",
        "password": "password123", "agegroup": "above-65",
    })
    assert res.status_code == 201
    return {"Authorization": f"Bearer {res.get_json()['token']}"}


@pytest.fixture()
def user(client):
    return User.query.filter_by(email="logging@example.com").first()


def _chat(client, headers, message):
    res = client.post("/api/chat", json={"message": message}, headers=headers)
    assert res.status_code == 200
    return res.get_json()


class TestClassification:
    """Which turns are candidates, and which are just conversation."""

    def test_greeting_is_not_a_memory_candidate(self, user):
        understanding = {"intent": "greeting", "needs_memory": False}
        kind, draft = memory_logging.classify("Good morning Aria", understanding)
        assert kind == "conversation"
        assert draft is None

    def test_question_is_not_turned_into_a_memory(self, user):
        understanding = {"intent": "asking a question", "needs_memory": False}
        kind, _ = memory_logging.classify(
            "Do you remember what my granddaughter is called?", understanding
        )
        assert kind == "conversation"

    def test_full_statement_is_a_confident_candidate(self, user):
        understanding = {"intent": "sharing a memory", "needs_memory": True}
        kind, draft = memory_logging.classify(
            "My granddaughter Chioma is studying medicine at the University of Lagos",
            understanding,
        )
        assert kind == "confirm"
        assert draft and draft["substantial"] is True

    def test_thin_statement_asks_for_one_more_detail(self, user):
        understanding = {"intent": "sharing a memory", "needs_memory": True}
        kind, _ = memory_logging.classify(
            "I have an appointment soon", understanding
        )
        assert kind == "clarify"

    def test_category_is_always_one_of_the_seeded_set(self, user):
        values = memory_logging.build_draft(
            user, "I take my Amlodipine tablet every morning after breakfast"
        )
        seeded = {c.categoryname for c in MemoryCategory.query.all()}
        assert values["category"] in seeded
        assert values["category"] == "Medications"

    def test_draft_never_invents_a_detail(self, user):
        said = "My neighbour Margaret came round for tea on Tuesday"
        draft = memory_logging.build_draft(user, said)
        # Every content word in the draft must have come from the user.
        for word in draft["content"].split():
            assert word.strip(".,!?").lower() in said.lower() or word.lower() in {
                "the", "a", "an", "i", "my",
            }

    def test_memorable_flag_is_enough_even_when_intent_is_vague(self, user):
        """The understanding pass's explicit judgement wins over a vague label."""
        understanding = {"intent": "sharing a feeling", "memorable": True}
        kind, draft = memory_logging.classify(
            "My sister Ruth lives in Bristol and visits every Sunday", understanding
        )
        assert kind == "confirm"
        assert draft and draft["substantial"] is True

    def test_greeting_stays_conversation_even_if_flagged(self, user):
        understanding = {"intent": "greeting", "memorable": False}
        kind, _ = memory_logging.classify("Good morning Aria", understanding)
        assert kind == "conversation"

    def test_a_bare_feeling_is_not_a_memory(self, user):
        # Matching an existing memory is not the same as sharing a new one.
        understanding = {
            "intent": "sharing a feeling",
            "emotion": "lonely",
            "needs_memory": True,
            "memorable": False,
        }
        kind, _ = memory_logging.classify("I'm feeling lonely today", understanding)
        assert kind == "conversation"


class TestConfirmationDetection:
    def test_yes_and_no_are_recognised(self):
        for text in ("yes", "Yes please", "ok", "go ahead", "save it", "that's right"):
            assert memory_logging.is_confirmation(text) is True
        for text in ("no", "not now", "leave it", "never mind", "no thanks"):
            assert memory_logging.is_confirmation(text) is False

    def test_a_correction_is_neither_yes_nor_no(self):
        assert memory_logging.is_confirmation("No, it's actually my grandson") is None
        assert memory_logging.is_confirmation("Actually, it was on Wednesday") is None


class TestSavingWithoutConfirmation:
    """The most important guard rail: no yes, no row."""

    def test_a_candidate_turn_writes_nothing(self, client, auth_headers, user):
        before = MemoryEntry.query.filter_by(userid=user.userid).count()
        data = _chat(
            client, auth_headers,
            "My granddaughter Chioma is studying medicine at the University of Lagos",
        )
        assert data["meta"]["logging"] in {"confirm", "clarify"}
        # The offer is shown, but nothing has been stored.
        assert MemoryEntry.query.filter_by(userid=user.userid).count() == before
        assert data["meta"]["saved_memory"] is None

    def test_declining_keeps_the_database_clean(self, client, auth_headers, user):
        _chat(
            client, auth_headers,
            "My neighbour Margaret came round for tea on Tuesday afternoon",
        )
        before = MemoryEntry.query.filter_by(userid=user.userid).count()
        res = client.post("/api/chat/memory/decline", headers=auth_headers)
        assert res.status_code == 200
        assert MemoryEntry.query.filter_by(userid=user.userid).count() == before


class TestConfirmedSave:
    def test_confirmation_endpoint_saves_and_schedules(self, client, auth_headers, user):
        _chat(
            client, auth_headers,
            "My granddaughter Chioma is studying medicine at the University of Lagos",
        )
        res = client.post("/api/chat/memory/confirm", headers=auth_headers)
        assert res.status_code == 201
        body = res.get_json()
        assert body["success"] is True

        memory = body["memory"]
        memoryid = memory["memoryid"]
        assert memory["category"]
        # The row really exists, and it has a recall question and a schedule.
        stored = MemoryEntry.query.filter_by(
            memoryid=memoryid, userid=user.userid
        ).first()
        assert stored is not None
        assert RecallQuestion.query.filter_by(memoryid=memoryid).first() is not None
        schedule = ReviewSchedule.query.filter_by(memoryid=memoryid).first()
        assert schedule is not None
        assert schedule.nextreviewdate is not None

    def test_confirming_twice_does_not_create_two_memories(self, client, auth_headers, user):
        _chat(
            client, auth_headers,
            "My friend Harold goes walking with me every Friday morning",
        )
        first = client.post("/api/chat/memory/confirm", headers=auth_headers)
        assert first.status_code == 201
        second = client.post("/api/chat/memory/confirm", headers=auth_headers)
        assert second.status_code == 404
        assert MemoryEntry.query.filter_by(userid=user.userid).count() == 1

    def test_confirm_without_an_offer_is_404(self, client, auth_headers):
        res = client.post("/api/chat/memory/confirm", headers=auth_headers)
        assert res.status_code == 404

    def test_telling_aria_yes_also_saves(self, client, auth_headers, user):
        _chat(
            client, auth_headers,
            "My husband Richard takes his heart tablets after breakfast every day",
        )
        data = _chat(client, auth_headers, "Yes please")
        assert data["meta"]["logging"] == "logged"
        assert data["meta"]["saved_memory"] is not None
        assert data["meta"]["saved_question"] is not None
        assert MemoryEntry.query.filter_by(userid=user.userid).count() == 1

    def test_a_thin_answer_is_joined_to_the_earlier_statement(self, client, auth_headers, user):
        """Aria asks for one more detail; the saved memory keeps both halves."""
        first = _chat(client, auth_headers, "I have an appointment soon")
        assert first["meta"]["logging"] == "clarify"
        assert first["meta"]["pending_memory"] is None

        second = _chat(
            client, auth_headers, "It is with Dr Patel next Tuesday at ten in the morning"
        )
        assert second["meta"]["logging"] == "confirm"
        draft = second["meta"]["pending_memory"]
        assert "appointment" in draft["content"].lower()
        assert "Patel" in draft["content"]
        assert draft["category"] == "Appointments"

        res = client.post("/api/chat/memory/confirm", headers=auth_headers)
        assert res.status_code == 201
        saved = res.get_json()["memory"]
        assert "appointment" in saved["content"].lower()
        assert "Patel" in saved["content"]


class TestPendingDraftPersistence:
    def test_the_offer_survives_a_reload(self, client, auth_headers):
        _chat(
            client, auth_headers,
            "My granddaughter Chioma is studying medicine at the University of Lagos",
        )
        history = client.get("/api/chat/history", headers=auth_headers).get_json()
        assistant = [m for m in history["messages"] if m["role"] == "assistant"]
        assert assistant, "expected Aria's reply in the history"
        # The hidden marker is never shown, but the draft is offered again.
        assert "memoraid-pending" not in assistant[-1]["messagetext"]
        assert assistant[-1].get("pending_memory")

    def test_the_marker_is_never_shown_to_the_user(self, client, auth_headers):
        data = _chat(
            client, auth_headers,
            "My neighbour Margaret came round for tea on Tuesday afternoon",
        )
        assert "memoraid-pending" not in data["reply"]

    def test_changing_the_subject_retires_the_offer(self, client, auth_headers, user):
        """An offer they moved on from must not be saveable later by accident."""
        _chat(
            client, auth_headers,
            "My neighbour Margaret came round for tea on Tuesday afternoon",
        )
        _chat(client, auth_headers, "What is the weather like today?")

        history = client.get("/api/chat/history", headers=auth_headers).get_json()
        assert all(not m.get("pending_memory") for m in history["messages"])

        res = client.post("/api/chat/memory/confirm", headers=auth_headers)
        assert res.status_code == 404
        assert MemoryEntry.query.filter_by(userid=user.userid).count() == 0

    def test_saying_no_in_the_chat_retires_the_offer(self, client, auth_headers, user):
        _chat(
            client, auth_headers,
            "My neighbour Margaret came round for tea on Tuesday afternoon",
        )
        data = _chat(client, auth_headers, "No thank you")
        assert data["meta"]["logging"] == "cancelled"

        history = client.get("/api/chat/history", headers=auth_headers).get_json()
        assert all(not m.get("pending_memory") for m in history["messages"])
        assert MemoryEntry.query.filter_by(userid=user.userid).count() == 0

    def test_streamed_turn_offers_a_memory_and_can_be_saved(self, client, auth_headers, user):
        """The path the chat UI uses (SSE) must expose the card and never leak the marker."""
        res = client.post(
            "/api/chat/stream",
            json={"message": "My granddaughter Chioma is studying medicine at the University of Lagos"},
            headers=auth_headers,
        )
        assert res.status_code == 200
        body = res.get_data(as_text=True)

        assert "memoraid-pending" not in body
        assert '"pending_memory"' in body
        assert '"logging": "confirm"' in body

        history = client.get("/api/chat/history", headers=auth_headers).get_json()
        assistant = [m for m in history["messages"] if m["role"] == "assistant"]
        assert assistant[-1].get("pending_memory")

        saved = client.post("/api/chat/memory/confirm", headers=auth_headers)
        assert saved.status_code == 201
        assert MemoryEntry.query.filter_by(userid=user.userid).count() == 1


class TestOrdinaryConversationStaysOrdinary:
    def test_greeting_gets_no_save_card(self, client, auth_headers):
        data = _chat(client, auth_headers, "Hello Aria")
        assert data["meta"]["logging"] == "conversation"
        assert data["meta"]["pending_memory"] is None
        assert data["meta"]["saved_memory"] is None

    def test_how_are_you_does_not_recite_a_memory(
        self, client, auth_headers, user
    ):
        """Small talk must not be turned into a recital of the newest memory."""
        category = MemoryCategory.query.first()
        db.session.add(MemoryEntry(
            userid=user.userid,
            categoryid=category.categoryid,
            content="I need to prepare for school tomorrow.",
        ))
        db.session.commit()

        data = _chat(client, auth_headers, "How are you doing")

        assert data["meta"]["logging"] == "conversation"
        assert data["meta"]["memories"] == []
        assert data["meta"]["facts"] == []
        assert "school" not in data["reply"].lower()
        # It should still be a warm, normal reply.
        assert "?" in data["reply"]

    def test_relevant_memory_is_still_offered(
        self, client, auth_headers, user
    ):
        """The guard must not hide a memory the person actually asked about."""
        category = MemoryCategory.query.first()
        db.session.add(MemoryEntry(
            userid=user.userid,
            categoryid=category.categoryid,
            content="Margaret visited on Tuesday and we had tea in the garden.",
        ))
        db.session.commit()

        data = _chat(client, auth_headers, "How did it go with Margaret?")

        assert any("Margaret" in m["content"] for m in data["meta"]["memories"])
        assert "Margaret" in data["reply"]

    def test_reminder_request_uses_the_right_memory_without_a_dump(
        self, client, auth_headers, user
    ):
        category = MemoryCategory.query.first()
        db.session.add(MemoryEntry(
            userid=user.userid,
            categoryid=category.categoryid,
            content="The car needs new tyres before winter.",
        ))
        db.session.flush()
        db.session.add(MemoryEntry(
            userid=user.userid,
            categoryid=category.categoryid,
            content="I need to prepare for school tomorrow.",
        ))
        db.session.commit()

        data = _chat(client, auth_headers, "What am I meant to do tomorrow?")

        assert "school" in data["reply"].lower()
        assert "tyres" not in data["reply"].lower()
        # Only the memory the reply used is shown under it.
        assert len(data["meta"]["memories"]) == 1
        assert "school" in data["meta"]["memories"][0]["content"].lower()

    def test_thanks_after_help_does_not_repeat_the_memory(
        self, client, auth_headers, user
    ):
        category = MemoryCategory.query.first()
        db.session.add(MemoryEntry(
            userid=user.userid,
            categoryid=category.categoryid,
            content="I need to prepare for school tomorrow.",
        ))
        db.session.commit()

        _chat(client, auth_headers, "What am I meant to do tomorrow?")
        data = _chat(client, auth_headers, "Thank you for reminding me")

        assert "welcome" in data["reply"].lower()
        assert "school" not in data["reply"].lower()
        assert data["meta"]["memories"] == []
        assert data["meta"]["facts"] == []

    def test_saved_memory_is_reachable_like_any_other(self, client, auth_headers, user):
        """A chat-logged memory is indexed for retrieval, not a second-class row."""
        _chat(
            client, auth_headers,
            "My granddaughter Chioma is studying medicine at the University of Lagos",
        )
        client.post("/api/chat/memory/confirm", headers=auth_headers)

        listed = client.get("/api/memories", headers=auth_headers).get_json()
        contents = [m["content"] for m in listed["memories"]]
        assert any("Chioma" in c for c in contents)


class TestChatMessageNotice:
    def test_confirming_leaves_a_line_in_the_history(self, client, auth_headers):
        _chat(
            client, auth_headers,
            "My neighbour Margaret came round for tea on Tuesday afternoon",
        )
        client.post("/api/chat/memory/confirm", headers=auth_headers)
        rows = ChatMessage.query.filter_by(role="assistant").all()
        assert any("saved" in (r.messagetext or "").lower() for r in rows)


class TestCompanionPersona:
    """The prompt sent to the model must frame Aria as a memory companion."""

    def test_persona_is_memory_specific_and_knows_the_person(self, client, auth_headers, user, monkeypatch):
        from services.ai import chat_companion

        captured = {}

        def fake_call_llm(system_prompt, **kwargs):
            captured["system"] = system_prompt
            captured["extra"] = kwargs.get("system_extra")
            return "Hello Eleanor, it is lovely to hear from you."

        monkeypatch.setattr(chat_companion, "call_llm", fake_call_llm)

        reply, _, _ = chat_companion.handle_message(user, "Hello Aria")

        system = captured["system"]
        assert "memory companion" in system
        assert "MemorAid" in system
        assert user.fullname.split()[0] in system
        # Guard the elderly-friendly rules that make it not a generic chatbot.
        assert "Never invent a fact" in system
        assert "Never give medical advice" in system
        assert "short, plain sentences" in system
        assert reply

    def test_persona_does_not_claim_a_memory_was_saved(self, client, auth_headers, user, monkeypatch):
        from services.ai import chat_companion

        captured = {}

        def fake_call_llm(system_prompt, **kwargs):
            captured["system"] = system_prompt
            captured["extra"] = kwargs.get("system_extra")
            return "That sounds like a happy day."

        monkeypatch.setattr(chat_companion, "call_llm", fake_call_llm)
        chat_companion.handle_message(user, "I went to the market on Tuesday")

        extra = captured["extra"] or ""
        assert "worth remembering" in extra.lower()
        # The offer is framed as a question, never as an accomplished save.
        assert "have saved" not in extra.lower()

    def test_offline_fallback_still_offers_to_save(self, client, auth_headers, user, monkeypatch):
        """With the model unavailable, the reply must not silently drop the offer."""
        from services.ai import chat_companion

        monkeypatch.setattr(chat_companion, "call_llm", lambda *a, **k: None)
        reply, _, meta = chat_companion.handle_message(
            user, "My granddaughter Lily is coming to visit on Sunday"
        )

        assert meta["logging"] == "confirm"
        assert meta["pending_memory"] is not None
        assert "shall i save" in reply.lower()
        assert "saved" not in reply.lower()
