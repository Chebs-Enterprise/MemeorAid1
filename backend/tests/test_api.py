"""End-to-end API tests against an in-memory SQLite database with the
Gemini API forced offline (fallback generators must carry the flow)."""
import os
import sys

os.environ["PYTEST_CURRENT_TEST"] = "1"
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["GEMINI_API_KEY"] = ""

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402

from app import create_app  # noqa: E402
from config import Config  # noqa: E402
from models import db  # noqa: E402


class TestConfig(Config):
    SQLALCHEMY_DATABASE_URI = "sqlite://"
    TESTING = True
    ENABLE_SCHEDULER = False


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
        "fullname": "Test User", "email": "test@example.com",
        "password": "password123", "agegroup": "above-65",
    })
    assert res.status_code == 201
    return {"Authorization": f"Bearer {res.get_json()['token']}"}


def _create_memory(client, headers, categoryid=1):
    return client.post("/api/memories", json={
        "categoryid": categoryid,
        "content": "Dr. Okafor appointment on Thursday at 10 in the morning.",
        "contextnote": "Bring the diary.",
    }, headers=headers)


def _backdate_latest_schedule(days=1):
    """Simulate the passage of time: figure 3.3 schedules a new memory for
    review the FOLLOWING day, so tests must backdate it to make it due."""
    from datetime import date, timedelta

    from models import ReviewSchedule
    sched = ReviewSchedule.query.order_by(ReviewSchedule.scheduleid.desc()).first()
    assert sched is not None
    sched.nextreviewdate = date.today() - timedelta(days=days)
    db.session.commit()


class TestAuth:
    def test_register_and_login(self, client):
        res = client.post("/api/auth/register", json={
            "fullname": "A B", "email": "a@b.com", "password": "password123",
            "agegroup": "51-65",
        })
        assert res.status_code == 201
        res = client.post("/api/auth/login", json={"email": "a@b.com", "password": "password123"})
        assert res.status_code == 200
        assert res.get_json()["success"] is True

    def test_bad_login_is_401(self, client):
        res = client.post("/api/auth/login", json={"email": "no@no.com", "password": "x"})
        assert res.status_code == 401

    def test_endpoints_require_token(self, client):
        assert client.get("/api/memories").status_code == 401
        assert client.get("/api/recall/due").status_code == 401


class TestMemories:
    def test_create_memory_generates_question_and_schedule(self, client, auth_headers):
        cats = client.get("/api/categories", headers=auth_headers).get_json()["categories"]
        assert [c["categoryname"] for c in cats] == [
            "Names", "Appointments", "Tasks", "Conversations", "Medications"
        ]
        res = _create_memory(client, auth_headers, cats[1]["categoryid"])
        assert res.status_code == 201
        data = res.get_json()
        assert data["question"]["questiontext"]
        assert data["nextreviewdate"]  # initial schedule = following day
        assert data["memory"]["category"] == "Appointments"

    def test_empty_memory_rejected(self, client, auth_headers):
        res = client.post("/api/memories", json={"categoryid": 1, "content": ""}, headers=auth_headers)
        assert res.status_code == 400


class TestRecallFlow:
    def test_reveal_endpoint_discloses_original_memory(self, client, auth_headers):
        cats = client.get("/api/categories", headers=auth_headers).get_json()["categories"]
        _create_memory(client, auth_headers, cats[0]["categoryid"])
        _backdate_latest_schedule()
        q = client.get("/api/recall/due", headers=auth_headers).get_json()["questions"][0]
        res = client.get(f"/api/recall/question/{q['questionid']}/answer", headers=auth_headers)
        assert res.status_code == 200
        assert "Dr. Okafor" in res.get_json()["content"]

    def test_full_recall_session_updates_schedule_and_streak(self, client, auth_headers):
        cats = client.get("/api/categories", headers=auth_headers).get_json()["categories"]
        _create_memory(client, auth_headers, cats[0]["categoryid"])

        # Not due yet — figure 3.3 schedules the first review for tomorrow.
        assert client.get("/api/recall/due", headers=auth_headers).get_json()["count"] == 0

        _backdate_latest_schedule()
        due = client.get("/api/recall/due", headers=auth_headers).get_json()
        assert due["count"] == 1
        q = due["questions"][0]
        assert "answerkey" not in q  # the answer must never leak before Reveal

        res = client.post("/api/recall/submit", json={
            "questionid": q["questionid"], "response": "Chioma", "quality": 5,
        }, headers=auth_headers).get_json()
        assert res["passed"] is True
        assert res["streak"] == 1
        assert res["interval"] == 1

        # Second pass: interval 6
        due = client.get("/api/recall/due", headers=auth_headers).get_json()
        assert due["count"] == 0  # scheduled tomorrow/next interval — not due today

        summary = client.get("/api/recall/summary", headers=auth_headers).get_json()
        assert summary["attempted"] == 1
        assert summary["passed"] == 1

    def test_poor_recall_resets_and_regenerates_at_difficulty_one(self, client, auth_headers):
        cats = client.get("/api/categories", headers=auth_headers).get_json()["categories"]
        _create_memory(client, auth_headers, cats[0]["categoryid"])
        _backdate_latest_schedule()
        q = client.get("/api/recall/due", headers=auth_headers).get_json()["questions"][0]
        res = client.post("/api/recall/submit", json={
            "questionid": q["questionid"], "response": "", "quality": 1,
        }, headers=auth_headers).get_json()
        assert res["passed"] is False
        assert res["difficultylevel"] == 1
        assert res["nextreviewdate"]  # tomorrow


class TestExercises:
    def test_next_and_complete(self, client, auth_headers):
        res = client.get("/api/exercises/next", headers=auth_headers).get_json()
        assert res["success"] is True
        assert res["exercise"]["technique"]
        assert res["exercise"]["steps"]
        # The interactive tutor uses the user's own memory when there is one.
        assert "sample_content" in res["exercise"]
        res = client.post("/api/exercises/complete", json={
            "exerciseid": res["exercise"]["exerciseid"],
        }, headers=auth_headers).get_json()
        assert res["exercise_streak"] == 1


class TestChatAndCheckin:
    def test_chat_reply_is_safe_fallback(self, client, auth_headers):
        res = client.post("/api/chat", json={"message": "Where are my glasses?"}, headers=auth_headers)
        assert res.status_code == 200
        assert res.get_json()["reply"]

    def test_checkin_flow(self, client, auth_headers):
        res = client.get("/api/checkin", headers=auth_headers).get_json()
        assert res["message"]
        res = client.post("/api/checkin/complete", headers=auth_headers).get_json()
        assert res["checked_in_today"] is True


class TestAnalytics:
    def test_analytics_payload_shape(self, client, auth_headers):
        cats = client.get("/api/categories", headers=auth_headers).get_json()["categories"]
        _create_memory(client, auth_headers, cats[0]["categoryid"])
        _backdate_latest_schedule()
        q = client.get("/api/recall/due", headers=auth_headers).get_json()["questions"][0]
        client.post("/api/recall/submit", json={
            "questionid": q["questionid"], "response": "x", "quality": 4,
        }, headers=auth_headers)
        data = client.get("/api/analytics", headers=auth_headers).get_json()["analytics"]
        assert data["overall_accuracy"] == 100.0
        assert data["total_attempts"] == 1
        assert data["recall_streak"] == 1
        assert len(data["trend"]) == 8
        assert data["motivational_message"]


class TestAccountDeletion:
    """Regression tests for orphaned rows.

    Dependent rows have no ON DELETE CASCADE, so deleting a user used to leave
    notifications (and memories, sessions, chat) behind. Because userid is an
    autoincrement column, a later registration could reuse the id and inherit
    the dead account's cached morning greeting. delete_user_data() prevents it,
    and the check-in lookup is additionally scoped by recipient as a backstop.
    """

    def test_delete_user_data_removes_all_dependent_rows(self, client, auth_headers):
        from models import (ChatMessage, MemoryEntry, Notification,
                            RecallQuestion, ReviewSchedule, User,
                            delete_user_data)

        _create_memory(client, auth_headers)
        client.get("/api/checkin", headers=auth_headers)  # caches a greeting
        client.post("/api/chat", json={"message": "hello"}, headers=auth_headers)

        user = User.query.filter_by(email="test@example.com").first()
        uid = user.userid
        memory_ids = [m.memoryid for m in MemoryEntry.query.filter_by(userid=uid).all()]
        assert memory_ids, "expected the fixture memory to exist"

        # The greeting must be cached for this to be a meaningful test.
        assert Notification.query.filter_by(userid=uid).count() >= 1

        delete_user_data(user)
        db.session.delete(user)
        db.session.commit()

        assert MemoryEntry.query.filter_by(userid=uid).count() == 0
        assert RecallQuestion.query.filter(
            RecallQuestion.memoryid.in_(memory_ids)
        ).count() == 0
        assert ReviewSchedule.query.filter(
            ReviewSchedule.memoryid.in_(memory_ids)
        ).count() == 0
        assert ChatMessage.query.filter_by(userid=uid).count() == 0
        assert Notification.query.filter_by(userid=uid).count() == 0

    def test_checkin_cache_does_not_leak_across_accounts(self, client, auth_headers):
        """A cached greeting written for one account is never served to another."""
        from models import Notification

        client.get("/api/checkin", headers=auth_headers)
        cached = Notification.query.filter_by(type="morning_checkin").first()
        assert cached is not None

        # Point the cached row at a different recipient, simulating an id freed
        # up by a deletion and then reused by a new registration.
        cached.recipient = "someone.else@example.com"
        db.session.commit()

        res = client.get("/api/checkin", headers=auth_headers).get_json()
        assert res["message"]
        # A fresh greeting must have been generated for THIS account.
        rows = Notification.query.filter_by(
            type="morning_checkin", recipient="test@example.com"
        ).all()
        assert rows, "expected a new greeting addressed to the current account"
