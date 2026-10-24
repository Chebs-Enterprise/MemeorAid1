"""Notification system tests.

Covers the requirements that make notifications trustworthy:

  * preferences default sensibly and are per-user + validated,
  * quiet hours are evaluated in the user's own timezone,
  * every job is idempotent (de-duplicated) per day,
  * due-review reminders come from the real SM-2 schedules,
  * family alerts need a configured contact AND explicit consent,
  * read/unread state and unread counts behave,
  * push subscribe/unsubscribe is scoped to the user,
  * **no notification path calls an AI service** (a guard test that fails the
    moment someone wires the model client into notifications).
"""
import os
import sys
from datetime import date, datetime, timedelta

os.environ["PYTEST_CURRENT_TEST"] = "1"
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["GEMINI_API_KEY"] = ""

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402

from app import create_app  # noqa: E402
from config import Config  # noqa: E402
from models import (  # noqa: E402
    MemoryEntry,
    Notification,
    NotificationPreference,
    PushSubscription,
    ReviewSchedule,
    User,
    db,
)
from services import jobs, notifications as notify  # noqa: E402


class TestConfig(Config):
    SQLALCHEMY_DATABASE_URI = "sqlite://"
    TESTING = True
    ENABLE_SCHEDULER = False
    AI_MOCK_MODE = True


@pytest.fixture()
def app():
    application = create_app(TestConfig)
    with application.app_context():
        yield application
        db.session.remove()
        db.engine.dispose()


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def auth_headers(client):
    res = client.post("/api/auth/register", json={
        "fullname": "Eleanor Whitfield", "email": "notify@example.com",
        "password": "password123", "agegroup": "above-65",
    })
    assert res.status_code == 201
    return {"Authorization": f"Bearer {res.get_json()['token']}"}


@pytest.fixture()
def user(app):
    """Create the test account directly so tests that don't need HTTP still
    have a real, persisted user to hang notifications off."""
    existing = User.query.filter_by(email="notify@example.com").first()
    if existing is None:
        client = app.test_client()
        client.post("/api/auth/register", json={
            "fullname": "Eleanor Whitfield", "email": "notify@example.com",
            "password": "password123", "agegroup": "above-65",
        })
    return User.query.filter_by(email="notify@example.com").first()


def _make_due_memory(user, days_overdue=1, content="Dr. Okafor appointment Thursday 10am.",
                     today=None):
    """Create a memory whose review schedule is already due."""
    today = today or date.today()
    entry = MemoryEntry(userid=user.userid, categoryid=1, content=content, status="active")
    db.session.add(entry)
    db.session.flush()
    db.session.add(ReviewSchedule(
        memoryid=entry.memoryid,
        nextreviewdate=today - timedelta(days=days_overdue),
    ))
    db.session.commit()
    return entry


def _quiet_off(user):
    """Turn quiet hours off so a job test only exercises the logic it names.

    Quiet hours are inherently time-of-day dependent; leaving the default
    on would make job assertions pass or fail depending on when CI runs.
    """
    pref = notify.get_preferences(user)
    pref.quiet_hours_enabled = False
    db.session.commit()
    return pref


# ---------------------------------------------------------------------------
# Preferences
# ---------------------------------------------------------------------------
class TestPreferences:
    def test_defaults_are_created_on_first_read(self, user):
        assert NotificationPreference.query.count() == 0
        pref = notify.get_preferences(user)
        assert pref is not None
        assert pref.morning_checkin is True
        assert pref.due_review is True
        assert pref.family_alerts is True
        assert pref.push_enabled is False
        # Consent must default OFF — never contact family without agreement.
        assert pref.family_consent is False
        assert pref.quiet_hours_enabled is True
        assert pref.timezone == "UTC"
        assert NotificationPreference.query.count() == 1

    def test_get_is_idempotent(self, user):
        a = notify.get_preferences(user)
        b = notify.get_preferences(user)
        assert a.preferenceid == b.preferenceid
        assert NotificationPreference.query.count() == 1

    def test_endpoint_returns_defaults(self, client, auth_headers):
        res = client.get("/api/notifications/preferences", headers=auth_headers)
        assert res.status_code == 200
        prefs = res.get_json()["preferences"]
        assert prefs["family_consent"] is False
        assert prefs["timezone"] == "UTC"

    def test_endpoint_updates_and_persists(self, client, auth_headers, user):
        res = client.put("/api/notifications/preferences", headers=auth_headers, json={
            "due_review": False,
            "quiet_hours_start": 23 * 60,
            "quiet_hours_end": 6 * 60,
            "timezone": "Europe/London",
        })
        assert res.status_code == 200
        prefs = res.get_json()["preferences"]
        assert prefs["due_review"] is False
        assert prefs["quiet_hours_start"] == 23 * 60
        assert prefs["timezone"] == "Europe/London"

    def test_bad_timezone_is_rejected(self, client, auth_headers):
        res = client.put("/api/notifications/preferences", headers=auth_headers,
                         json={"timezone": "Mars/Olympus"})
        assert res.status_code == 400

    def test_quiet_hours_are_clamped(self, client, auth_headers):
        res = client.put("/api/notifications/preferences", headers=auth_headers,
                         json={"quiet_hours_start": 99999})
        assert res.get_json()["preferences"]["quiet_hours_start"] == 1439

    def test_preferences_are_per_user(self, client, auth_headers, user):
        client.put("/api/notifications/preferences", headers=auth_headers,
                   json={"due_review": False})
        other = client.post("/api/auth/register", json={
            "fullname": "Someone Else", "email": "other@example.com",
            "password": "password123", "agegroup": "51-65",
        }).get_json()
        headers2 = {"Authorization": f"Bearer {other['token']}"}
        prefs = client.get("/api/notifications/preferences", headers=headers2).get_json()
        assert prefs["preferences"]["due_review"] is True


# ---------------------------------------------------------------------------
# Timezone + quiet hours
# ---------------------------------------------------------------------------
class TestQuietHours:
    def test_default_window_covers_the_night(self, user):
        pref = notify.get_preferences(user)
        assert notify.in_quiet_hours(pref, datetime(2026, 1, 1, 23, 0)) is True
        assert notify.in_quiet_hours(pref, datetime(2026, 1, 1, 3, 0)) is True
        assert notify.in_quiet_hours(pref, datetime(2026, 1, 1, 12, 0)) is False

    def test_disabled_quiet_hours_never_suppress(self, user):
        pref = notify.get_preferences(user)
        pref.quiet_hours_enabled = False
        assert notify.in_quiet_hours(pref, datetime(2026, 1, 1, 23, 0)) is False

    def test_non_wrapping_window(self, user):
        pref = notify.get_preferences(user)
        pref.quiet_hours_start = 9 * 60   # 09:00
        pref.quiet_hours_end = 17 * 60    # 17:00
        assert notify.in_quiet_hours(pref, datetime(2026, 1, 1, 10, 0)) is True
        assert notify.in_quiet_hours(pref, datetime(2026, 1, 1, 20, 0)) is False

    def test_timezone_shifts_the_local_clock(self, user):
        pref = notify.get_preferences(user)
        pref.timezone = "Pacific/Kiritimati"  # UTC+14
        # 00:30 UTC is 14:30 local there — outside default quiet hours.
        assert notify.in_quiet_hours(pref, datetime(2026, 1, 1, 0, 30)) is False

    def test_unknown_timezone_falls_back_to_utc(self, user):
        pref = notify.get_preferences(user)
        pref.timezone = "Not/AZone"
        # Must not raise; behaves like UTC (23:00 is quiet).
        assert notify.in_quiet_hours(pref, datetime(2026, 1, 1, 23, 0)) is True


# ---------------------------------------------------------------------------
# Inactivity arithmetic
# ---------------------------------------------------------------------------
class TestInactivityHours:
    def test_counts_from_last_activity(self, user):
        now = datetime(2026, 6, 10, 15, 0, 0)
        user.last_activity_date = date(2026, 6, 8)
        db.session.commit()
        # Two full days plus the 15 hours already elapsed today.
        assert notify.inactive_hours(user, now) == 63

    def test_partial_day_is_counted(self, user):
        user.last_activity_date = date(2026, 6, 8)
        db.session.commit()
        now = datetime(2026, 6, 10, 10, 0, 0)
        hours = notify.inactive_hours(user, now)
        assert hours == 58

    def test_no_anchor_returns_none(self, user):
        user.last_activity_date = None
        user.last_checkin_date = None
        user.createdat = None
        db.session.commit()
        assert notify.inactive_hours(user, datetime.utcnow()) is None


# ---------------------------------------------------------------------------
# Morning check-in job
# ---------------------------------------------------------------------------
class TestMorningCheckinJob:
    # A fixed midday UTC instant: outside default quiet hours and far from any
    # check-in hour default, so each test sets checkintime deliberately.
    NOW = datetime(2026, 6, 10, 12, 0, 0)

    def test_creates_one_predefined_notification(self, app, user):
        _quiet_off(user)
        user.checkintime = datetime(2026, 6, 10, 11, 30).time()
        db.session.commit()
        created = jobs.morning_checkin_job(self.NOW)
        assert created == 1
        row = Notification.query.filter_by(userid=user.userid, type="morning_checkin").one()
        assert row.title.startswith("Good morning")
        assert user.fullname.split()[0] in row.message

    def test_is_idempotent_per_day(self, app, user):
        _quiet_off(user)
        user.checkintime = datetime(2026, 6, 10, 11, 30).time()
        db.session.commit()
        jobs.morning_checkin_job(self.NOW)
        jobs.morning_checkin_job(self.NOW)
        assert Notification.query.filter_by(type="morning_checkin").count() == 1

    def test_respects_opt_out(self, app, user):
        pref = _quiet_off(user)
        user.checkintime = datetime(2026, 6, 10, 11, 30).time()
        pref.morning_checkin = False
        db.session.commit()
        assert jobs.morning_checkin_job(self.NOW) == 0
        assert Notification.query.filter_by(type="morning_checkin").count() == 0

    def test_skips_during_quiet_hours(self, app, user):
        user.checkintime = datetime(2026, 6, 10, 11, 30).time()
        pref = notify.get_preferences(user)
        # Force a quiet window that spans the whole day.
        pref.quiet_hours_start = 0
        pref.quiet_hours_end = 1439
        pref.quiet_hours_enabled = True
        db.session.commit()
        assert jobs.morning_checkin_job(self.NOW) == 0

    def test_waits_until_the_configured_hour(self, app, user):
        _quiet_off(user)
        user.checkintime = datetime(2026, 6, 10, 7, 0).time()  # 5h earlier
        db.session.commit()
        assert jobs.morning_checkin_job(self.NOW) == 0


# ---------------------------------------------------------------------------
# Due-review job (uses the real SM-2 schedule)
# ---------------------------------------------------------------------------
class TestDueReviewJob:
    NOW = datetime(2026, 6, 10, 12, 0, 0)

    def test_no_memories_means_no_notification(self, app, user):
        _quiet_off(user)
        assert jobs.due_review_job(self.NOW) == 0

    def test_due_memory_produces_a_reminder(self, app, user):
        _quiet_off(user)
        _make_due_memory(user, today=date(2026, 6, 10))
        assert jobs.due_review_job(self.NOW) == 1
        row = Notification.query.filter_by(userid=user.userid, type="due_review").one()
        assert "1" in row.message or "one" in row.message.lower()

    def test_count_matches_the_schedule(self, app, user):
        _quiet_off(user)
        _make_due_memory(user, today=date(2026, 6, 10))
        _make_due_memory(user, content="Bridge club Tuesday.", today=date(2026, 6, 10))
        assert notify.due_review_count(user, date(2026, 6, 10)) == 2
        assert jobs.due_review_job(self.NOW) == 1
        row = Notification.query.filter_by(type="due_review").one()
        assert "2" in row.message

    def test_not_due_yet_is_silent(self, app, user):
        _quiet_off(user)
        entry = MemoryEntry(userid=user.userid, categoryid=1,
                            content="Future thing.", status="active")
        db.session.add(entry)
        db.session.flush()
        db.session.add(ReviewSchedule(memoryid=entry.memoryid,
                                      nextreviewdate=date(2026, 6, 20)))
        db.session.commit()
        assert jobs.due_review_job(self.NOW) == 0

    def test_idempotent_per_day(self, app, user):
        _quiet_off(user)
        _make_due_memory(user, today=date(2026, 6, 10))
        jobs.due_review_job(self.NOW)
        jobs.due_review_job(self.NOW)
        assert Notification.query.filter_by(type="due_review").count() == 1

    def test_respects_opt_out(self, app, user):
        pref = _quiet_off(user)
        _make_due_memory(user, today=date(2026, 6, 10))
        pref.due_review = False
        db.session.commit()
        assert jobs.due_review_job(self.NOW) == 0


# ---------------------------------------------------------------------------
# Inactivity / family alerts
# ---------------------------------------------------------------------------
class TestInactivityAndFamilyAlerts:
    NOW = datetime(2026, 6, 10, 12, 0, 0)

    def _make_inactive(self, user, days=3):
        # Anchored to the same calendar day as NOW so the arithmetic is exact.
        user.last_activity_date = date(2026, 6, 10) - timedelta(days=days)
        user.last_checkin_date = None
        user.inactivity_threshold_hours = 24
        db.session.commit()

    def test_inactive_user_gets_own_reminder(self, app, user):
        _quiet_off(user)
        self._make_inactive(user)
        assert jobs.family_alert_job(self.NOW) >= 1
        assert Notification.query.filter_by(type="inactivity").count() == 1

    def test_active_user_gets_nothing(self, app, user):
        _quiet_off(user)
        user.last_activity_date = date(2026, 6, 10)
        db.session.commit()
        assert jobs.family_alert_job(self.NOW) == 0

    def test_family_email_requires_a_contact(self, app, user, monkeypatch):
        pref = _quiet_off(user)
        self._make_inactive(user)
        # Consent on, but no contact address configured.
        pref.family_consent = True
        db.session.commit()
        calls = []
        monkeypatch.setattr("services.email_sender.send_family_alert",
                            lambda *a, **k: calls.append(a) or True)
        jobs.family_alert_job(self.NOW)
        assert calls == []
        assert Notification.query.filter_by(type="family_alert").count() == 0

    def test_family_email_requires_consent(self, app, user, monkeypatch):
        _quiet_off(user)
        self._make_inactive(user)
        user.family_contact_email = "daughter@example.com"
        db.session.commit()
        # Consent defaults OFF — the contact must NOT be emailed.
        calls = []
        monkeypatch.setattr("services.email_sender.send_family_alert",
                            lambda *a, **k: calls.append(a) or True)
        jobs.family_alert_job(self.NOW)
        assert calls == []
        assert Notification.query.filter_by(type="family_alert").count() == 0

    def test_consented_family_alert_is_sent_once(self, app, user, monkeypatch):
        pref = _quiet_off(user)
        self._make_inactive(user)
        user.family_contact_email = "daughter@example.com"
        pref.family_consent = True
        db.session.commit()
        calls = []
        monkeypatch.setattr("services.email_sender.send_family_alert",
                            lambda *a, **k: calls.append(a) or True)
        jobs.family_alert_job(self.NOW)
        jobs.family_alert_job(self.NOW)
        assert len(calls) == 1
        row = Notification.query.filter_by(type="family_alert").one()
        # Privacy: the user's own record must not leak memory content.
        assert "appointment" not in row.message.lower()

    def test_consent_off_still_gives_the_user_their_own_reminder(self, app, user, monkeypatch):
        _quiet_off(user)
        self._make_inactive(user)
        user.family_contact_email = "daughter@example.com"
        db.session.commit()
        monkeypatch.setattr("services.email_sender.send_family_alert",
                            lambda *a, **k: True)
        jobs.family_alert_job(self.NOW)
        # No family email, but the user's own inactivity notice is still created.
        assert Notification.query.filter_by(type="inactivity").count() == 1
        assert Notification.query.filter_by(type="family_alert").count() == 0


# ---------------------------------------------------------------------------
# History, unread, read state
# ---------------------------------------------------------------------------
class TestReadState:
    def _seed(self, user, count=3):
        for _ in range(count):
            db.session.add(Notification(userid=user.userid, type="due_review",
                                        title="t", message="m", status="sent"))
        db.session.commit()

    def test_unread_count(self, client, auth_headers, user):
        self._seed(user, 3)
        res = client.get("/api/notifications/unread-count", headers=auth_headers)
        assert res.get_json()["unread_count"] == 3

    def test_list_includes_unread_count_and_flag(self, client, auth_headers, user):
        self._seed(user, 2)
        data = client.get("/api/notifications", headers=auth_headers).get_json()
        assert data["unread_count"] == 2
        assert all(n["unread"] is True for n in data["notifications"])

    def test_mark_one_read(self, client, auth_headers, user):
        self._seed(user, 2)
        nid = Notification.query.first().notificationid
        res = client.post(f"/api/notifications/{nid}/read", headers=auth_headers)
        assert res.status_code == 200
        assert res.get_json()["unread_count"] == 1
        assert Notification.query.get(nid).readat is not None

    def test_mark_all_read(self, client, auth_headers, user):
        self._seed(user, 3)
        res = client.post("/api/notifications/read", headers=auth_headers)
        assert res.get_json()["unread_count"] == 0

    def test_cannot_read_another_users_notification(self, client, auth_headers, user):
        self._seed(user, 1)
        nid = Notification.query.first().notificationid
        other = client.post("/api/auth/register", json={
            "fullname": "Other Person", "email": "other2@example.com",
            "password": "password123", "agegroup": "51-65",
        }).get_json()
        headers2 = {"Authorization": f"Bearer {other['token']}"}
        res = client.post(f"/api/notifications/{nid}/read", headers=headers2)
        assert res.status_code == 404

    def test_filter_unread_only(self, client, auth_headers, user):
        self._seed(user, 3)
        Notification.query.first().status = "read"
        db.session.commit()
        data = client.get("/api/notifications?unread=1", headers=auth_headers).get_json()
        assert all(n["unread"] for n in data["notifications"])
        assert len(data["notifications"]) == 2


class TestDelete:
    def _seed(self, user, count=2, **kwargs):
        for _ in range(count):
            db.session.add(Notification(userid=user.userid, type="due_review",
                                        title="t", message="m", status="sent",
                                        **kwargs))
        db.session.commit()

    def test_delete_hides_the_notification(self, client, auth_headers, user):
        self._seed(user, 2)
        nid = Notification.query.first().notificationid
        res = client.delete(f"/api/notifications/{nid}", headers=auth_headers)
        assert res.status_code == 200
        assert res.get_json()["deleted"] == nid

        listed = client.get("/api/notifications", headers=auth_headers).get_json()
        assert nid not in [n["notificationid"] for n in listed["notifications"]]
        # Soft delete: the row survives so dedupe cannot recreate the reminder.
        assert Notification.query.get(nid).deletedat is not None

    def test_delete_refreshes_unread_count(self, client, auth_headers, user):
        self._seed(user, 2)
        nid = Notification.query.first().notificationid
        res = client.delete(f"/api/notifications/{nid}", headers=auth_headers)
        assert res.get_json()["unread_count"] == 1

    def test_deleted_reminder_is_not_recreated_by_dedupe(self, client, auth_headers, user):
        self._seed(user, 1, dedupekey="due_review:2026-01-01")
        nid = Notification.query.first().notificationid
        client.delete(f"/api/notifications/{nid}", headers=auth_headers)
        assert notify.already_notified(user.userid, "due_review:2026-01-01") is True

    def test_cannot_delete_another_users_notification(self, client, auth_headers, user):
        self._seed(user, 1)
        nid = Notification.query.first().notificationid
        other = client.post("/api/auth/register", json={
            "fullname": "Other Person", "email": "other-delete@example.com",
            "password": "password123", "agegroup": "51-65",
        }).get_json()
        headers2 = {"Authorization": f"Bearer {other['token']}"}
        res = client.delete(f"/api/notifications/{nid}", headers=headers2)
        assert res.status_code == 404
        assert Notification.query.get(nid).deletedat is None

    def test_delete_requires_auth(self, client, auth_headers, user):
        self._seed(user, 1)
        nid = Notification.query.first().notificationid
        res = client.delete(f"/api/notifications/{nid}")
        assert res.status_code == 401


# ---------------------------------------------------------------------------
# Push subscriptions
# ---------------------------------------------------------------------------
class TestPushSubscriptions:
    def _sub(self):
        return {"endpoint": "https://push.example.com/abc",
                "keys": {"p256dh": "key1", "auth": "auth1"}}

    def test_subscribe_and_unsubscribe(self, client, auth_headers, user):
        res = client.post("/api/notifications/push/subscribe",
                          headers=auth_headers, json=self._sub())
        assert res.status_code == 200
        row = PushSubscription.query.filter_by(userid=user.userid).one()
        assert row.isactive is True
        # Subscribing implies the preference is on.
        assert notify.get_preferences(user).push_enabled is True

        res = client.post("/api/notifications/push/unsubscribe",
                          headers=auth_headers, json={"endpoint": self._sub()["endpoint"]})
        assert res.get_json()["active_devices"] == 0
        assert PushSubscription.query.get(row.subscriptionid).isactive is False
        assert notify.get_preferences(user).push_enabled is False

    def test_endpoint_required(self, client, auth_headers):
        res = client.post("/api/notifications/push/subscribe",
                          headers=auth_headers, json={})
        assert res.status_code == 400

    def test_resubscribe_reactivates(self, client, auth_headers, user):
        client.post("/api/notifications/push/subscribe", headers=auth_headers, json=self._sub())
        client.post("/api/notifications/push/unsubscribe", headers=auth_headers,
                    json={"endpoint": self._sub()["endpoint"]})
        client.post("/api/notifications/push/subscribe", headers=auth_headers, json=self._sub())
        assert PushSubscription.query.filter_by(userid=user.userid).count() == 1
        assert PushSubscription.query.filter_by(userid=user.userid).one().isactive is True

    def test_public_key_reports_unavailable_without_keys(self, client, auth_headers):
        res = client.get("/api/notifications/push/public-key", headers=auth_headers)
        body = res.get_json()
        assert body["success"] is True
        assert body["available"] is False


# ---------------------------------------------------------------------------
# Delivery safety + the no-AI guarantee
# ---------------------------------------------------------------------------
class TestDeliverySafety:
    def test_push_failure_never_loses_the_in_app_row(self, app, user, monkeypatch):
        pref = notify.get_preferences(user)
        pref.push_enabled = True
        db.session.commit()
        # Pretend push "works" but throws: the row must survive.
        monkeypatch.setattr("services.notifications_delivery.push_available", lambda: True)
        monkeypatch.setattr("services.notifications_delivery.send_push_to_user",
                            lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
        from services import notifications_delivery as delivery
        row = delivery.deliver(user, pref, ntype="due_review", title="T", message="M",
                               send_push=True)
        assert row.notificationid is not None
        assert Notification.query.filter_by(userid=user.userid).count() == 1

    def test_email_failure_is_contained(self, app, user):
        pref = notify.get_preferences(user)
        from services import notifications_delivery as delivery
        row = delivery.deliver(user, pref, ntype="family_alert", title="T", message="M",
                               send_email=True,
                               email_callable=lambda: (_ for _ in ()).throw(RuntimeError("smtp")))
        assert row.notificationid is not None
        assert "email" not in row.to_dict()["channels"]

    def test_notification_modules_do_not_import_ai(self):
        """The whole notification path must run with no AI client involved."""
        import ast

        for mod in ("services/notifications.py", "services/notifications_delivery.py",
                    "services/jobs.py", "routes/notifications.py"):
            path = os.path.join(os.path.dirname(__file__), "..", mod)
            with open(path, encoding="utf-8") as fh:
                tree = ast.parse(fh.read())
            imported = set()
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    imported.update(a.name for a in node.names)
                elif isinstance(node, ast.ImportFrom):
                    imported.add(node.module or "")
            forbidden = {"services.ai.client", "services.ai.checkin",
                         "services.ai", "google.generativeai"}
            assert not (imported & forbidden), f"{mod} must not import an AI client"

    def test_jobs_run_without_an_api_key(self, app, user, monkeypatch):
        """With the provider unavailable, notifications still work."""
        monkeypatch.setattr("services.ai.client.call_llm", lambda *a, **k: None)
        _quiet_off(user)
        user.checkintime = datetime(2026, 6, 10, 11, 30).time()
        _make_due_memory(user, today=date(2026, 6, 10))
        db.session.commit()
        now = datetime(2026, 6, 10, 12, 0, 0)
        assert jobs.morning_checkin_job(now) == 1
        assert jobs.due_review_job(now) == 1


# ---------------------------------------------------------------------------
# Scheduler wiring
# ---------------------------------------------------------------------------
class TestSchedulerWiring:
    def test_scheduler_registers_expected_jobs(self, app):
        # start_scheduler is normally gated off under pytest; call it directly
        # to assert the job set without leaving a thread running.
        scheduler = jobs.start_scheduler(app)
        try:
            ids = {j.id for j in scheduler.get_jobs()}
            assert {"morning_checkin", "due_review", "inactivity", "pattern_decay"} <= ids
        finally:
            scheduler.shutdown(wait=False)


# ---------------------------------------------------------------------------
# Check-in greeting + schema upgrade
# ---------------------------------------------------------------------------
class TestCheckinGreeting:
    def test_checkin_greeting_is_predefined_and_not_ai(self, client, auth_headers, monkeypatch):
        """The morning greeting is a notification, so it must not call the AI
        provider even when one is configured."""
        calls = []
        monkeypatch.setattr("services.ai.client.call_llm",
                            lambda *a, **k: calls.append(a) or "AI text")
        res = client.get("/api/checkin", headers=auth_headers)
        assert res.status_code == 200
        assert calls == [], "morning check-in must not call the AI provider"
        assert res.get_json()["message"]

    def test_checkin_caches_with_a_title_and_dedupe_key(self, client, auth_headers, user):
        client.get("/api/checkin", headers=auth_headers)
        row = Notification.query.filter_by(userid=user.userid, type="morning_checkin").one()
        assert row.title and row.title.startswith("Good morning")
        assert row.dedupekey and row.dedupekey.startswith("morning_checkin:")

    def test_checkin_is_stable_within_a_day(self, client, auth_headers, user):
        first = client.get("/api/checkin", headers=auth_headers).get_json()["message"]
        second = client.get("/api/checkin", headers=auth_headers).get_json()["message"]
        assert first == second
        assert Notification.query.filter_by(
            userid=user.userid, type="morning_checkin"
        ).count() == 1


class TestSchemaUpgrade:
    def test_ensure_schema_is_idempotent(self, app):
        from db.migrate import ensure_schema

        # The test database is built from current models, so every column is
        # already present: nothing to add, and it must not raise.
        assert ensure_schema(db) == []

    def test_missing_columns_are_added(self, app):
        """Simulate a pre-feature database and confirm the helper upgrades it."""
        import sqlite3
        import tempfile

        from sqlalchemy import create_engine, inspect, text

        from db.migrate import ensure_schema

        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "legacy.db")
            raw = sqlite3.connect(path)
            raw.execute(
                "CREATE TABLE notifications (notificationid INTEGER PRIMARY KEY, "
                "userid INTEGER, type VARCHAR(30), message TEXT, recipient VARCHAR(150), "
                "status VARCHAR(20), createdat DATETIME)"
            )
            raw.commit()
            raw.close()

            class _Shim:
                engine = create_engine(f"sqlite:///{path}")

            try:
                added = ensure_schema(_Shim)
                cols = {c["name"] for c in inspect(_Shim.engine).get_columns("notifications")}
                assert {"title", "dedupekey", "channels", "readat", "deletedat"} <= cols
                assert set(added) == {
                    "notifications.title", "notifications.dedupekey",
                    "notifications.channels", "notifications.readat",
                    "notifications.deletedat",
                }
                # Second run finds nothing to do.
                assert ensure_schema(_Shim) == []
                with _Shim.engine.connect() as conn:
                    assert conn.execute(text("SELECT COUNT(*) FROM notifications")).scalar() == 0
            finally:
                _Shim.engine.dispose()
