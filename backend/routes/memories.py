"""
Memory logging routes — FR-03, FR-04.

Implements the document's sequence diagram (figure 3.3) exactly:
POST /api/memories -> validate -> save entry -> build structured prompt
(content, category, context note, difficulty level 1) -> Gemini returns a
question -> save question linked 1:1 -> create initial ReviewSchedule with
next review date = the following day -> respond with the generated
question and next review date.
"""
from datetime import date, timedelta

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from models import MemoryCategory, MemoryEntry, RecallQuestion, ReviewSchedule, db
from routes.profile import current_user
from services import streaks
from services.ai import memory_store
from services.ai.facts import extract_facts
from services.ai.question_generator import generate_question

bp = Blueprint("memories", __name__, url_prefix="/api")


@bp.get("/categories")
@jwt_required()
def list_categories():
    cats = MemoryCategory.query.order_by(MemoryCategory.categoryid).all()
    return jsonify(success=True, categories=[c.to_dict() for c in cats])


@bp.post("/memories")
@jwt_required()
def create_memory():
    user = current_user()
    data = request.get_json(silent=True) or {}

    content = (data.get("content") or "").strip()
    contextnote = (data.get("contextnote") or "").strip() or None
    categoryid = data.get("categoryid")

    if not content:
        return jsonify(success=False, message="Please write the memory you would like to keep."), 400
    category = MemoryCategory.query.get(categoryid) if categoryid else None
    if not category:
        return jsonify(success=False, message="Please choose a category for this memory."), 400

    entry = MemoryEntry(
        userid=user.userid,
        categoryid=category.categoryid,
        content=content,
        contextnote=contextnote,
    )
    db.session.add(entry)
    db.session.flush()  # obtain entry.memoryid

    # Make the new memory reachable by the companion straight away: it joins
    # the retrieval index, and anything durable it reveals is learned as a
    # fact (so "my granddaughter Lily" survives beyond the six most recent
    # memories).
    memory_store.index_memory(user, entry)

    question_text, by_ai = generate_question(
        content, category.categoryname, contextnote, difficulty=1
    )
    question = RecallQuestion(
        memoryid=entry.memoryid,
        questiontext=question_text,
        answerkey=content,
        difficultylevel=1,
        generatedbyai=by_ai,
    )
    # Initial ReviewSchedule: next review the following day (figure 3.3).
    schedule = ReviewSchedule(
        memoryid=entry.memoryid,
        nextreviewdate=date.today() + timedelta(days=1),
        interval=1,
        repetition=0,
        easefactor=2.5,
    )
    db.session.add(question)
    db.session.add(schedule)
    streaks.record_activity(user)
    db.session.commit()

    # Learn any durable facts from the memory itself (after the main commit,
    # so the fact pass cannot disturb the memory transaction).
    try:
        extract_facts(user, " ".join(filter(None, [content, contextnote or ""])), source="memory")
    except Exception as exc:  # pragma: no cover - never block saving a memory
        print(f"[MemorAid] Fact extraction from memory failed: {exc}")

    return jsonify(
        success=True,
        message="Your memory has been saved.",
        memory=entry.to_dict(with_question=True),
        nextreviewdate=schedule.nextreviewdate.isoformat(),
        question=question.to_dict(),
    ), 201


@bp.get("/memories")
@jwt_required()
def list_memories():
    user = current_user()
    entries = (
        MemoryEntry.query.filter_by(userid=user.userid, status="active")
        .order_by(MemoryEntry.datecreated.desc()).all()
    )
    return jsonify(success=True, memories=[e.to_dict(with_question=True) for e in entries])


@bp.post("/memories/<int:memoryid>/archive")
@jwt_required()
def archive_memory(memoryid):
    user = current_user()
    entry = MemoryEntry.query.filter_by(memoryid=memoryid, userid=user.userid).first()
    if not entry:
        return jsonify(success=False, message="We could not find that memory."), 404
    entry.status = "archived"
    db.session.commit()
    return jsonify(success=True, message="The memory has been archived.")
