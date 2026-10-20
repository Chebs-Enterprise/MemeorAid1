"""
Scheduler jobs — figure 3.1, the Scheduler actor's three use cases:

  * Trigger Morning Check-In   (per-user checkintime, FR-14)
  * Update Pattern Confidence Scores (nightly decay, FR-10)
  * Trigger Family Connection Alert  (inactivity threshold, FR-15)

Run in-process via APScheduler; the hourly jobs are idempotent per day.
"""
from datetime import date, datetime

from models import Notification, User, db
from services import pattern_confidence
from services.ai.checkin import generate_checkin_message
from services.email_sender import send_family_alert

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


def morning_checkin_job():
    """For every user whose configured check-in time has arrived today,
    generate the AI morning message and store it as a notification."""
    now = datetime.now()
    users = User.query.filter_by(isactive=True).all()
    created = 0
    for user in users:
        if user.last_checkin_date == date.today():
            continue
        if not user.checkintime:
            continue
        # Fire within the hour following the configured time.
        if not (user.checkintime.hour == now.hour or
                (user.checkintime.hour == now.hour - 1 and now.minute < 10)):
            continue
        already = Notification.query.filter_by(
            userid=user.userid, type="morning_checkin"
        ).filter(Notification.createdat >= now.replace(hour=0, minute=0, second=0)).first()
        if already:
            continue
        payload = generate_checkin_message(user)
        db.session.add(Notification(
            userid=user.userid,
            type="morning_checkin",
            message=payload["message"],
            recipient=user.email,
            status="sent",
        ))
        created += 1
    db.session.commit()
    return created


def pattern_decay_job():
    """Nightly: decay unconfirmed pattern confidence scores (section 1.7)."""
    return pattern_confidence.decay_unconfirmed_patterns()


def family_alert_job():
    """Users inactive beyond their threshold get a family contact alert
    (email + notification). At most one alert per day per user."""
    now = datetime.now()
    today = date.today()
    sent = 0
    users = User.query.filter(
        User.isactive == True,  # noqa: E712
        User.family_contact_email.isnot(None),
    ).all()
    for user in users:
        threshold = user.inactivity_threshold_hours or 24
        anchor = user.last_activity_date or user.last_checkin_date or user.createdat.date()
        if anchor is None:
            continue
        inactive_hours = (now.date() - anchor).days * 24
        if inactive_hours < threshold:
            continue
        if user.family_alert_sent_date == today:
            continue
        ok = send_family_alert(user.family_contact_email, user.fullname, inactive_hours)
        db.session.add(Notification(
            userid=user.userid,
            type="family_alert",
            message=f"Inactivity alert sent to {user.family_contact_email} "
                    f"({inactive_hours}h without engagement).",
            recipient=user.family_contact_email,
            status="sent" if ok else "pending",
        ))
        user.family_alert_sent_date = today
        sent += 1
    db.session.commit()
    return sent


def start_scheduler(app):
    """Attach the three jobs to a BackgroundScheduler."""
    from apscheduler.schedulers.background import BackgroundScheduler

    global _current_app
    _current_app = app

    scheduler = BackgroundScheduler(timezone="UTC")
    scheduler.add_job(_run_with_context, "interval", minutes=5, id="morning_checkin",
                      args=[morning_checkin_job])
    scheduler.add_job(_run_with_context, "cron", hour=2, minute=0, id="pattern_decay",
                      args=[pattern_decay_job])
    scheduler.add_job(_run_with_context, "interval", minutes=30, id="family_alert",
                      args=[family_alert_job])
    scheduler.start()
    app.extensions["scheduler"] = scheduler
    print("[MemorAid] Scheduler started: morning check-in (5 min), "
          "pattern decay (daily 02:00 UTC), family alert (30 min).")
    return scheduler
