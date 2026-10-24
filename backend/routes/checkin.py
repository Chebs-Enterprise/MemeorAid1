"""Morning check-in routes — FR-14 (adherence feature, section 1.4).

Wording note: a morning check-in is part of the notification system, and the
product requirement is explicit that notifications use **predefined text and
ordinary Python only** — no AI service may create, schedule or send one. The
greeting is therefore produced by ``services.notifications.build_morning_checkin``
so the dashboard, the in-app bell and any push all show the same, predictable
message, and the six o'clock job keeps working when the AI provider is down.
"""
from datetime import date

from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required

from models import MemoryEntry, Notification, ReviewSchedule, db
from routes.profile import current_user
from services import notifications as notify, pattern_confidence, streaks

bp = Blueprint("checkin", __name__, url_prefix="/api/checkin")


@bp.get("")
@bp.get("/")
@jwt_required()
def today_checkin():
    """Today's morning greeting, cached in notifications so the dashboard shows
    a stable message (output design, section 3.5.3)."""
    user = current_user()
    pref = notify.get_preferences(user)
    today = notify.user_now(pref).date()

    # Cached greeting for today. Scoped by userid AND recipient so a row left
    # behind by a deleted account (whose id was later reused) can never be
    # served to the wrong person.
    cached = (
        Notification.query.filter_by(
            userid=user.userid, type=notify.TYPE_MORNING_CHECKIN, recipient=user.email
        )
        .filter(Notification.createdat >= today.isoformat())
        .order_by(Notification.createdat.desc()).first()
    )
    due_total = notify.due_review_count(user, today)

    if cached:
        message = cached.message
    else:
        text = notify.build_morning_checkin(user, due_total)
        message = text["message"]
        db.session.add(Notification(
            userid=user.userid,
            type=notify.TYPE_MORNING_CHECKIN,
            title=text["title"],
            message=message,
            recipient=user.email,
            status="sent",
            channels="inapp",
            # Share the scheduler's key so opening the dashboard first cannot
            # lead to a second, duplicate check-in notification later today.
            dedupekey=f"{notify.TYPE_MORNING_CHECKIN}:{user.userid}:{today.isoformat()}",
        ))
        db.session.commit()

    return jsonify(
        success=True,
        message=message,
        due_count=due_total,
        recall_streak=user.recall_streak or 0,
        exercise_streak=user.exercise_streak or 0,
        checked_in_today=(user.last_checkin_date == today),
    )


@bp.post("/complete")
@jwt_required()
def complete_checkin():
    user = current_user()
    today = date.today()
    if user.last_checkin_date != today:
        user.last_checkin_date = today
        streaks.record_activity(user)
        # A missed check-in becomes a confirmed adherence pattern over time.
        pattern_confidence.observe_pattern(user, "morning_checkin_routine", {"date": today.isoformat()})
        db.session.commit()
    return jsonify(success=True, message="Good morning! Your check-in is recorded.",
                   checked_in_today=True)
