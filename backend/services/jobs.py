"""
Scheduler jobs — figure 3.1, the Scheduler actor's use cases:

  * Morning Check-In Reminder      (per-user checkintime, FR-14)
  * Due-Review Reminder            (SM-2 schedules, FR-06/FR-08)
  * Update Pattern Confidence Scores (nightly decay, FR-10)
  * Inactivity / Family Alert      (inactivity threshold, FR-15)

Run in-process via APScheduler, so they fire whether or not the frontend is
open. Every user-facing job is idempotent per day (and de-duplicated by a
stable ``dedupekey``), respects the user's notification preferences, local
timezone and quiet hours, and uses **no AI** — all text comes from
services/notifications.py.

Quiet hours do not silently drop a reminder: a reminder that would land in
quiet hours is simply not created at that time and is reconsidered on a later
run once the window has passed (still only once per day).
"""
from datetime import date, datetime

from models import User, db
from services import notifications as notify, pattern_confidence
from services import notifications_delivery as delivery

# APScheduler runs jobs on its own thread with no Flask application context,
# so every job needs one wrapped around its database work (and app.py pushes
# one when a job is invoked directly).
_current_app = None


def _run_with_context(job):
    """Run a job inside an application context (required for db access)."""
    if _current_app is None:
        return job()
    with _current_app.app_context():
        return job()


def _today_key(user, ntype, local_dt=None):
    """Stable per-user/per-day/per-type de-duplication key."""
    day = (local_dt.date() if local_dt else date.today()).isoformat()
    return f"{ntype}:{user.userid}:{day}"


def morning_checkin_job(now_utc=None):
    """For every user whose configured check-in time has arrived in *their*
    timezone, create the predefined morning greeting as a notification."""
    now_utc = now_utc or datetime.utcnow()
    users = User.query.filter_by(isactive=True).all()
    created = 0
    for user in users:
        if user.last_checkin_date == date.today():
            continue
        if not user.checkintime:
            continue
        pref = notify.get_preferences(user)
        if pref is not None and not pref.morning_checkin:
            continue
        local = notify.user_now(pref, now_utc)
        # Fire within the hour following the configured local check-in time.
        if not (user.checkintime.hour == local.hour or
                (user.checkintime.hour == local.hour - 1 and local.minute < 10)):
            continue
        if notify.in_quiet_hours(pref, now_utc):
            continue  # reconsidered on a later run, still once per day
        key = _today_key(user, notify.TYPE_MORNING_CHECKIN, local)
        if notify.already_notified(user.userid, key):
            continue
        due = notify.due_review_count(user)
        text = notify.build_morning_checkin(user, due, local)
        delivery.deliver(
            user, pref,
            ntype=notify.TYPE_MORNING_CHECKIN,
            title=text["title"], message=text["message"],
            dedupekey=key, send_push=True,
        )
        created += 1
    db.session.commit()
    return created


def due_review_job(now_utc=None):
    """Remind users who have memories due for review today (SM-2).

    The count comes straight from ``ReviewSchedule`` for the user's active
    memories, so the reminder always matches the real review queue and never
    invents a memory.
    """
    from config import Config

    if not Config.NOTIFICATION_DUE_REVIEW:
        return 0

    now_utc = now_utc or datetime.utcnow()
    users = User.query.filter_by(isactive=True).all()
    created = 0
    for user in users:
        pref = notify.get_preferences(user)
        if pref is not None and not pref.due_review:
            continue
        local = notify.user_now(pref, now_utc)
        due = notify.due_review_count(user, local.date())
        if due <= 0:
            continue
        if notify.in_quiet_hours(pref, now_utc):
            continue
        key = _today_key(user, notify.TYPE_DUE_REVIEW, local)
        if notify.already_notified(user.userid, key):
            continue
        text = notify.build_due_review(user, due)
        delivery.deliver(
            user, pref,
            ntype=notify.TYPE_DUE_REVIEW,
            title=text["title"], message=text["message"],
            dedupekey=key, send_push=True,
        )
        created += 1
    db.session.commit()
    return created


def pattern_decay_job():
    """Nightly: decay unconfirmed pattern confidence scores (section 1.7)."""
    return pattern_confidence.decay_unconfirmed_patterns()


def family_alert_job(now_utc=None):
    """Users inactive beyond their threshold get an inactivity reminder.

    A family contact is emailed **only** when all of these hold:
      * a family contact address is configured,
      * the user has explicitly consented (``family_consent``),
      * the preference ``family_alerts`` is on.

    Either way the user gets their own in-app inactivity reminder (if enabled),
    so the feature is useful even with no family connection. The family email
    carries no memory content — see services/email_sender.py.
    """
    from config import Config

    if not Config.NOTIFICATION_INACTIVITY:
        return 0

    now_utc = now_utc or datetime.utcnow()
    users = User.query.filter_by(isactive=True).all()
    sent = 0
    for user in users:
        threshold = user.inactivity_threshold_hours or Config.INACTIVITY_THRESHOLD_HOURS
        hours = notify.inactive_hours(user, now_utc)
        if hours is None or hours < threshold:
            continue
        pref = notify.get_preferences(user)
        if notify.in_quiet_hours(pref, now_utc):
            continue
        local = notify.user_now(pref, now_utc)

        wants_user_reminder = pref is None or pref.family_alerts
        if wants_user_reminder:
            key = _today_key(user, notify.TYPE_INACTIVITY, local)
            if not notify.already_notified(user.userid, key):
                text = notify.build_inactivity(user, hours)
                delivery.deliver(
                    user, pref,
                    ntype=notify.TYPE_INACTIVITY,
                    title=text["title"], message=text["message"],
                    dedupekey=key, send_push=True,
                )
                sent += 1

        # Family contact: needs a configured address AND explicit consent.
        consented = pref is not None and bool(pref.family_consent)
        if (
            user.family_contact_email
            and consented
            and (pref is None or pref.family_alerts)
            and user.family_alert_sent_date != local.date()
        ):
            text = notify.build_family_alert(user, hours)
            delivery.deliver(
                user, pref,
                ntype=notify.TYPE_FAMILY_ALERT,
                title=text["title"], message=text["message"],
                dedupekey=_today_key(user, notify.TYPE_FAMILY_ALERT, local),
                recipient=user.family_contact_email,
                send_email=True,
                email_callable=delivery.family_alert_emailer(
                    user.family_contact_email, user.fullname, hours
                ),
            )
            user.family_alert_sent_date = local.date()
            sent += 1

    db.session.commit()
    return sent


def start_scheduler(app):
    """Attach the jobs to a BackgroundScheduler."""
    from apscheduler.schedulers.background import BackgroundScheduler

    from config import Config

    global _current_app
    _current_app = app

    interval = max(1, Config.NOTIFICATION_CHECK_INTERVAL_MINUTES)

    scheduler = BackgroundScheduler(timezone="UTC")
    scheduler.add_job(_run_with_context, "interval", minutes=interval, id="morning_checkin",
                      args=[morning_checkin_job])
    scheduler.add_job(_run_with_context, "interval", minutes=interval, id="due_review",
                      args=[due_review_job])
    scheduler.add_job(_run_with_context, "interval", minutes=max(interval, 30), id="inactivity",
                      args=[family_alert_job])
    scheduler.add_job(_run_with_context, "cron", hour=2, minute=0, id="pattern_decay",
                      args=[pattern_decay_job])
    scheduler.start()
    app.extensions["scheduler"] = scheduler
    print("[MemorAid] Scheduler started: morning check-in, due-review and "
          f"inactivity reminders (every {interval} min), pattern decay "
          "(daily 02:00 UTC). All notifications are predefined — no AI is called.")
    return scheduler
