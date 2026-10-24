"""
Recall session routes — FR-05, FR-06, FR-07.

Implements the recall session activity diagram (figure 3.4):
due queue -> question WITHOUT the original memory -> user types an answer
-> Reveal -> rate 0-5 -> backend runs SM-2, updates ReviewSchedule,
adjusts difficulty, updates the AnalyticsRecord for the category, and
updates the recall streak -> session summary.
"""
from datetime import date, datetime

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from models import (
    AnalyticsRecord,
    MemoryEntry,
    RecallQuestion,
    RecallSession,
    ReviewSchedule,
    db,
)
from routes.profile import current_user
from services import pattern_confidence, streaks
from services.ai.question_generator import generate_question
from services.sm2 import calculate_sm2

bp = Blueprint("recall", __name__, url_prefix="/api/recall")


def _due_rows(user):
    return (
        db.session.query(RecallQuestion, ReviewSchedule, MemoryEntry)
        .join(ReviewSchedule, ReviewSchedule.memoryid == RecallQuestion.memoryid)
        .join(MemoryEntry, MemoryEntry.memoryid == RecallQuestion.memoryid)
        .filter(MemoryEntry.userid == user.userid, MemoryEntry.status == "active")
        .filter(ReviewSchedule.nextreviewdate <= date.today())
        .order_by(ReviewSchedule.nextreviewdate.asc())
        .all()
    )


@bp.get("/due")
@jwt_required()
def due_reviews():
    user = current_user()
    rows = _due_rows(user)
    # One question at a time (section 3.5.2); NEVER include the answer.
    items = [
        {
            "questionid": q.questionid,
            "memoryid": q.memoryid,
            "category": entry.category.categoryname if entry.category else None,
            "questiontext": q.questiontext,
            "difficultylevel": q.difficultylevel,
        }
        for q, _sched, entry in rows
    ]
    return jsonify(success=True, count=len(items), questions=items)


@bp.post("/submit")
@jwt_required()
def submit_recall():
    user = current_user()
    data = request.get_json(silent=True) or {}
    questionid = data.get("questionid")
    userresponse = (data.get("response") or "").strip()
    quality = data.get("quality")

    if quality is None or not (0 <= int(quality) <= 5):
        return jsonify(success=False, message="Please rate your recall from 0 to 5."), 400

    question = RecallQuestion.query.get(questionid) if questionid else None
    if not question:
        return jsonify(success=False, message="We could not find that question."), 404
    schedule = ReviewSchedule.query.filter_by(memoryid=question.memoryid).first()
    entry = MemoryEntry.query.get(question.memoryid)

    quality = int(quality)

    # 1. SM-2 schedules the next review (FR-05)
    result = calculate_sm2(
        quality,
        schedule.repetition if schedule else 0,
        schedule.easefactor if schedule else 2.5,
        schedule.interval if schedule else 0,
    )
    if schedule:
        schedule.repetition = result["repetition"]
        schedule.easefactor = result["ease_factor"]
        schedule.interval = result["interval"]
        schedule.nextreviewdate = result["next_review_date"]
        schedule.lastreviewdate = date.today()

    # 2. Progressive difficulty (FR-07)
    new_difficulty = question.difficultylevel
    if quality >= 4:
        new_difficulty = min(3, question.difficultylevel + 1)
    elif quality <= 2:
        new_difficulty = 1
        category_name = entry.category.categoryname if entry and entry.category else "Memory"
        question_text, by_ai = generate_question(
            entry.content, category_name, entry.contextnote, difficulty=1
        )
        question.questiontext = question_text
        question.generatedbyai = by_ai
    question.difficultylevel = new_difficulty

    # 3. Record the attempt
    db.session.add(RecallSession(
        userid=user.userid,
        questionid=question.questionid,
        memoryid=question.memoryid,
        userresponse=userresponse,
        quality=quality,
        passed=result["passed"],
        difficulty=question.difficultylevel,
    ))

    # 4. Update the AnalyticsRecord for the relevant category (figure 3.4)
    if entry and entry.categoryid:
        today = date.today()
        record = AnalyticsRecord.query.filter_by(
            userid=user.userid, categoryid=entry.categoryid, period=today
        ).first()
        if not record:
            record = AnalyticsRecord(userid=user.userid, categoryid=entry.categoryid, period=today)
            db.session.add(record)
        record.total_attempts = (record.total_attempts or 0) + 1
        if result["passed"]:
            record.recalls_passed = (record.recalls_passed or 0) + 1
        record.accuracy = round(100 * (record.recalls_passed or 0) / record.total_attempts, 1)

    # 5. Silent pattern observation + streak + activity
    if result["passed"]:
        pattern_confidence.observe_pattern(user, "successful_recall", {"questionid": question.questionid})
    streaks.update_recall_streak(user)
    db.session.commit()

    return jsonify(
        success=True,
        passed=result["passed"],
        streak=user.recall_streak,
        interval=result["interval"],
        nextreviewdate=result["next_review_date"].isoformat(),
        difficultylevel=new_difficulty,
        answerkey=question.answerkey,
    )


@bp.get("/question/<int:questionid>/answer")
@jwt_required()
def reveal_answer(questionid):
    """Disclose the original memory at Reveal time (figure 3.4 / output
    design 3.5.3: the Reveal button displays the original memory)."""
    user = current_user()
    question = RecallQuestion.query.get(questionid) if questionid else None
    if not question:
        return jsonify(success=False, message="We could not find that question."), 404
    entry = MemoryEntry.query.get(question.memoryid)
    if not entry or entry.userid != user.userid:
        return jsonify(success=False, message="We could not find that memory."), 404
    return jsonify(success=True, answerkey=question.answerkey, content=entry.content)


@bp.get("/summary")
@jwt_required()
def session_summary():
    """End-of-session summary data (figure 3.4: display summary + streak)."""
    user = current_user()
    # Sessions are stamped with ``datetime.utcnow`` (models.py), so "today"
    # must be the UTC date too — comparing against the local date drops every
    # attempt made in the evening of a timezone ahead of UTC.
    today = datetime.utcnow().date()
    sessions = [
        s for s in RecallSession.query.filter_by(userid=user.userid).all()
        if s.sessiondate and s.sessiondate.date() == today
    ]
    return jsonify(
        success=True,
        attempted=len(sessions),
        passed=sum(1 for s in sessions if s.passed),
        recall_streak=user.recall_streak or 0,
    )
