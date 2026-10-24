"""
Notification core — preferences, quiet hours, de-duplication and the
predefined message text for every notification type.

Design rule for this module (an explicit product requirement): **no AI here.**
Notifications are created, scheduled and worded with ordinary Python only.
Nothing in this file imports the Gemini client or any other model API, so the
whole notification system keeps working when the AI provider is unavailable,
misconfigured or rate-limited. The wording is fixed, warm and predictable,
which is also what an elderly user wants from a reminder.

The module is deliberately dependency-free beyond the standard library and the
existing models: timezone handling uses ``zoneinfo`` (stdlib on Python 3.9+)
with a safe UTC fallback, so no new package is required.
"""
from datetime import date, datetime

from models import (
    MemoryEntry,
    Notification,
    NotificationPreference,
    ReviewSchedule,
    db,
)

# ---------------------------------------------------------------------------
# Categories of notification. Kept as plain strings to match the existing
# ``Notification.type`` column and the checks already in the codebase.
# ---------------------------------------------------------------------------
TYPE_MORNING_CHECKIN = "morning_checkin"
TYPE_DUE_REVIEW = "due_review"
TYPE_INACTIVITY = "inactivity"
TYPE_FAMILY_ALERT = "family_alert"


# ---------------------------------------------------------------------------
# Preferences
# ---------------------------------------------------------------------------
def get_preferences(user, create=True):
    """Return the user's NotificationPreference row.

    Existing accounts have no row, so the first read creates one with the
    model defaults (everything sensible on, quiet hours 22:00–07:00, UTC).
    That avoids a database migration/backfill for accounts that predate this
    feature.
    """
    row = NotificationPreference.query.filter_by(userid=user.userid).first()
    if row is None and create:
        row = NotificationPreference(userid=user.userid)
        db.session.add(row)
        db.session.commit()
    return row


# ---------------------------------------------------------------------------
# Timezone + quiet hours
# ---------------------------------------------------------------------------
def user_now(pref, now_utc=None):
    """Current time in the user's own timezone.

    ``timezone`` is an IANA name ("Europe/London"); an unknown or blank value
    falls back to UTC rather than raising, so a bad setting can never break a
    scheduled job. ``zoneinfo`` is standard library — no dependency added.
    """
    now_utc = now_utc or datetime.utcnow()
    name = (getattr(pref, "timezone", None) or "UTC").strip() or "UTC"
    try:
        from zoneinfo import ZoneInfo

        return now_utc.replace(tzinfo=ZoneInfo("UTC")).astimezone(ZoneInfo(name))
    except Exception:
        return now_utc


def local_minutes(dt):
    """Minutes since local midnight (used for quiet-hour comparisons)."""
    return dt.hour * 60 + dt.minute


def in_quiet_hours(pref, now_utc=None):
    """True when ``now`` falls inside the user's quiet hours.

    Quiet hours are wall-clock and may wrap past midnight (the default
    22:00–07:00 does), so the comparison is done on minutes-since-midnight.
    Disabled quiet hours always return False.
    """
    if pref is None or not pref.quiet_hours_enabled:
        return False
    start = pref.quiet_hours_start if pref.quiet_hours_start is not None else 22 * 60
    end = pref.quiet_hours_end if pref.quiet_hours_end is not None else 7 * 60
    if start == end:
        return False  # a zero-length window means "off"
    minute = local_minutes(user_now(pref, now_utc))
    if start < end:
        return start <= minute < end
    # Window wraps midnight, e.g. 22:00 -> 07:00.
    return minute >= start or minute < end


# ---------------------------------------------------------------------------
# De-duplication
# ---------------------------------------------------------------------------
def already_notified(userid, dedupekey):
    """True if a notification with this exact key already exists.

    Jobs run every few minutes, so this single check is what makes each of
    them idempotent: the same reminder (same user, same type, same day) can
    only ever be produced once.
    """
    if not dedupekey:
        return False
    return (
        Notification.query.filter_by(userid=userid, dedupekey=dedupekey).first()
        is not None
    )


# ---------------------------------------------------------------------------
# Deterministic message builders (predefined text, no AI)
# ---------------------------------------------------------------------------
def _first_name(user):
    return (user.fullname or "there").split()[0]


def build_morning_checkin(user, due_count, local_dt=None):
    """Predefined good-morning text.

    Mentions only facts we actually hold — the user's first name, today's due
    count and their streak. It never invents a memory or a feeling.
    """
    local_dt = local_dt or datetime.now()
    name = _first_name(user)
    if due_count:
        due_sentence = (
            f"You have {due_count} "
            f"{'memory' if due_count == 1 else 'memories'} ready to revisit today."
        )
    else:
        due_sentence = "Nothing is due today, so it is a nice moment for a short memory exercise."
    return {
        "title": f"Good morning, {name}",
        "message": (
            f"Good morning, {name}. I hope you slept well. {due_sentence} "
            "I am here whenever you are ready."
        ),
    }


def build_due_review(user, due_count):
    """Predefined nudge about SM-2 reviews that are actually due today."""
    name = _first_name(user)
    if due_count == 1:
        message = (
            f"Hello {name}, one of your memories is ready to revisit today. "
            "A quick look now helps it stay fresh."
        )
    else:
        message = (
            f"Hello {name}, {due_count} of your memories are ready to revisit today. "
            "Even one or two keeps them fresh."
        )
    return {"title": "Your reviews for today", "message": message}


def build_inactivity(user, inactive_hours):
    """Predefined gentle inactivity reminder (goes to the user themselves)."""
    name = _first_name(user)
    return {
        "title": f"We have missed you, {name}",
        "message": (
            f"Hello {name}, it has been about {inactive_hours} hours since we last "
            "heard from you. There is no rush — whenever you are ready, a short "
            "catch-up or check-in would be lovely."
        ),
    }


def build_family_alert(user, inactive_hours):
    """Predefined text for the *user's own* in-app record of a family alert.

    Privacy rule: this is the only notification shape that references the
    family contact, and even here it mentions nothing about the user's saved
    memories — only that a check-in notice was sent. The email body itself
    (services/email_sender.py) is likewise content-free.
    """
    name = _first_name(user)
    return {
        "title": "Check-in notice sent",
        "message": (
            f"Because we had not heard from you for about {inactive_hours} hours, "
            f"gentle check-in notice was sent to your family contact. "
            "No details of your memories were shared."
        ),
    }


# ---------------------------------------------------------------------------
# Counting helpers — reminders must reflect real schedules, never guesses
# ---------------------------------------------------------------------------
def due_review_count(user, today=None):
    """How many of the user's active memories are due for review today."""
    today = today or date.today()
    return (
        ReviewSchedule.query.join(
            MemoryEntry, MemoryEntry.memoryid == ReviewSchedule.memoryid
        )
        .filter(MemoryEntry.userid == user.userid, MemoryEntry.status == "active")
        .filter(ReviewSchedule.nextreviewdate <= today)
        .count()
    )


def inactive_hours(user, now=None):
    """Whole hours since the user's last recorded activity.

    Uses only stored activity dates (``last_activity_date`` /
    ``last_checkin_date`` / account creation). Walks day by day so the result
    is correct even when today's clock is earlier than the anchor's, which the
    old ``(a - b).days * 24`` arithmetic got wrong.
    """
    now = now or datetime.utcnow()
    anchor = user.last_activity_date or user.last_checkin_date
    if anchor is None and user.createdat:
        anchor = user.createdat.date()
    if anchor is None:
        return None
    anchor_start = datetime(anchor.year, anchor.month, anchor.day)
    now_start = datetime(now.year, now.month, now.day)
    return (now_start - anchor_start).days * 24 + now.hour
