"""
Exercise session routes — FR-08, the six validated techniques
(document of proof section 2.2.1), selected adaptively from the user's
weakest recall category.
"""
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from models import ExerciseSession, MemoryCategory, MemoryEntry, db
from routes.profile import current_user
from services import streaks
from services.ai.exercise_guide import TECHNIQUES, build_exercise
from services.analytics import weakest_category_for_user

bp = Blueprint("exercises", __name__, url_prefix="/api/exercises")


def _sample_for_category(user, category_name):
    if not category_name:
        return None
    entry = (
        MemoryEntry.query.join(MemoryCategory, MemoryEntry.categoryid == MemoryCategory.categoryid)
        .filter(MemoryEntry.userid == user.userid, MemoryEntry.status == "active")
        .filter(MemoryCategory.categoryname == category_name)
        .order_by(MemoryEntry.datecreated.desc()).first()
    )
    return entry.content if entry else None


@bp.get("/next")
@jwt_required()
def next_exercise():
    user = current_user()
    # The six techniques can be opened directly. The adaptive choice remains
    # the default when no technique is named.
    technique = request.args.get("technique")
    if technique and technique not in TECHNIQUES:
        return jsonify(success=False, message="We could not find that exercise."), 400

    weakest = weakest_category_for_user(user)
    sample = _sample_for_category(user, weakest)
    exercise = build_exercise(
        user,
        weakest_category_name=weakest,
        sample_content=sample,
        technique_key=technique,
    )

    # Record the attempt as an incomplete session (completed on POST).
    record = ExerciseSession(
        userid=user.userid,
        technique=exercise["technique"],
        categoryid=None,
        guidance_text=exercise["guidance_text"] or "\n".join(exercise["steps"]),
        completed=False,
    )
    db.session.add(record)
    db.session.commit()
    exercise["exerciseid"] = record.exerciseid
    return jsonify(success=True, exercise=exercise)


@bp.post("/complete")
@jwt_required()
def complete_exercise():
    user = current_user()
    data = request.get_json(silent=True) or {}
    exerciseid = data.get("exerciseid")
    technique = data.get("technique")

    record = None
    if exerciseid:
        record = ExerciseSession.query.filter_by(exerciseid=exerciseid, userid=user.userid).first()
    if not record and technique in ExerciseSession.TECHNIQUES:
        record = ExerciseSession(userid=user.userid, technique=technique,
                                 guidance_text=data.get("guidance_text"))
        db.session.add(record)
    if not record:
        return jsonify(success=False, message="We could not find that exercise."), 404

    record.completed = True
    if isinstance(data.get("score"), int):
        record.score = data["score"]

    streak = streaks.update_exercise_streak(user)
    db.session.commit()

    spec = TECHNIQUES.get(record.technique, {"name": record.technique})
    return jsonify(
        success=True,
        message=f"Well done! Your {spec['name']} exercise is complete.",
        exercise_streak=streak,
    )


@bp.get("/history")
@jwt_required()
def exercise_history():
    user = current_user()
    rows = (
        ExerciseSession.query.filter_by(userid=user.userid, completed=True)
        .order_by(ExerciseSession.sessiondate.desc()).limit(20).all()
    )
    return jsonify(success=True, exercises=[r.to_dict() for r in rows])
