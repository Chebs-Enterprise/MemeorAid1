"""Morning check-in routes — FR-14 (adherence feature, section 1.4)."""
from datetime import date

from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required

from models import MemoryEntry, Notification, ReviewSchedule, db
from routes.profile import current_user
from services import pattern_confidence, streaks
from services.ai.checkin import generate_checkin_message

bp = Blueprint("checkin", __name__, url_prefix="/api/checkin")


@bp.get("")
@bp.get("/")
@jwt_required()
def today_checkin():
    """Today's AI morning message, cached in notifications so the
    dashboard shows a stable greeting (output design, section 3.5.3)."""
    user = current_user()
    today = date.today()

    # Cached greeting for today. Scoped by userid AND recipient so a row left
    # behind by a deleted account (whose id was later reused) can never be
    # served to the wrong person.
    cached = (
        Notification.query.filter_by(
            userid=user.userid, type="morning_checkin", recipient=user.email
        )
        .filter(Notification.createdat >= today.isoformat())
        .order_by(Notification.createdat.desc()).first()
    )
    if cached:
        message = cached.message
        due_count = None
    else:
        payload = generate_checkin_message(user)
        message = payload["message"]
        due_count = payload["due_count"]
        db.session.add(Notification(
            userid=user.userid, type="morning_checkin",
            message=message, recipient=user.email, status="sent",
        ))
        db.session.commit()

    due_total = (
        ReviewSchedule.query.join(MemoryEntry, MemoryEntry.memoryid == ReviewSchedule.memoryid)
        .filter(MemoryEntry.userid == user.userid, MemoryEntry.status == "active")
        .filter(ReviewSchedule.nextreviewdate <= today).count()
    )
    return jsonify(
        success=True,
        message=message,
        due_count=due_total if due_count is None else due_count,
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
