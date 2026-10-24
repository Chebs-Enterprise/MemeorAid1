"""Chat companion route — FR-09/FR-10/FR-11 (Chat with AI Companion).

Endpoints
---------
    GET    /api/chat/history          the stored conversation
    POST   /api/chat                  one turn (reply + pattern_event + meta)
    POST   /api/chat/stream           the same turn, streamed over SSE
    GET    /api/chat/facts            the durable facts the companion knows
    DELETE /api/chat/facts/<factid>   let the user retract a fact
    POST   /api/chat/memory/confirm   save a memory Aria offered in the chat
    POST   /api/chat/memory/decline   say no to an offered memory

The streamed endpoint exists because a memory companion that pauses for
several seconds feels broken to an older user. The reply arrives word by
word, and the ``meta`` event tells the UI which memories and facts were
used so it can show a \"because you mentioned…\" hint.
"""
import json

from flask import Blueprint, Response, jsonify, request, stream_with_context
from flask_jwt_extended import jwt_required

from models import ChatMessage, db
from routes.profile import current_user
from services.ai import memory_logging
from services.ai.chat_companion import (
    decode_pending,
    handle_message,
    stream_message,
    strip_pending,
)
from services.ai.facts import list_facts, retract_fact

bp = Blueprint("chat", __name__, url_prefix="/api/chat")


def _sse(event, data):
    """Format one Server-Sent Event."""
    payload = json.dumps(data, default=str)
    return f"event: {event}\ndata: {payload}\n\n"


@bp.get("/history")
@jwt_required()
def history():
    user = current_user()
    rows = (
        ChatMessage.query.filter_by(userid=user.userid)
        .order_by(ChatMessage.createdat.desc()).limit(50).all()
    )
    rows.reverse()
    messages = []
    for row in rows:
        data = row.to_dict()
        if row.role == "assistant":
            # The offered-memory marker is hidden from the user; the draft is
            # surfaced separately so the UI can re-show its confirmation card
            # after a reload.
            data["messagetext"] = strip_pending(data.get("messagetext"))
            draft = decode_pending(row)
            if draft:
                data["pending_memory"] = draft
        messages.append(data)
    return jsonify(success=True, messages=messages)


@bp.post("")
@bp.post("/")
@jwt_required()
def send():
    user = current_user()
    data = request.get_json(silent=True) or {}
    mode = "deep" if data.get("mode") == "deep" else "standard"
    reply, pattern_event, meta = handle_message(user, data.get("message"), mode=mode)
    return jsonify(success=True, reply=reply, pattern_event=pattern_event, meta=meta)


@bp.post("/stream")
@jwt_required()
def stream():
    user = current_user()
    data = request.get_json(silent=True) or {}
    mode = "deep" if data.get("mode") == "deep" else "standard"
    message = data.get("message") or ""

    @stream_with_context
    def generate():
        try:
            for event in stream_message(user, message, mode=mode):
                yield _sse(event["event"], event["data"])
        except Exception as exc:  # pragma: no cover - defensive
            print(f"[MemorAid] Chat stream failed: {exc}")
            yield _sse("error", {"message": "Something went wrong. Please try again."})

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@bp.post("/memory/confirm")
@jwt_required()
def confirm_memory():
    """Save the memory Aria offered, using the *stored* pending draft.

    The draft is read back from Aria's last turn rather than trusted from the
    request, so the row that is written is exactly the one the user was shown
    — and a client cannot invent a memory the companion never proposed.
    """
    user = current_user()
    row = _last_pending_row(user)
    draft = decode_pending(row)
    if not draft:
        return jsonify(
            success=False,
            message="There is no memory waiting to be saved.",
        ), 404

    memory, question = memory_logging.save_confirmed_memory(user, draft)
    if not memory:
        return jsonify(
            success=False,
            message="I could not save that just now. Please try again.",
        ), 500

    # The offer is spent: drop the marker so it cannot be confirmed twice.
    row.messagetext = strip_pending(row.messagetext)
    _store_memory_notice(user, memory, question)
    db.session.commit()

    return jsonify(
        success=True,
        message="Saved to your memories.",
        memory=memory,
        question=question,
        nextreviewdate=memory.get("nextreviewdate"),
    ), 201


@bp.post("/memory/decline")
@jwt_required()
def decline_memory():
    """Say no to the offered memory: clear the offer, write nothing."""
    user = current_user()
    row = _last_pending_row(user)
    draft = decode_pending(row)
    if not draft:
        return jsonify(
            success=False,
            message="There is no memory waiting to be saved.",
        ), 404

    row.messagetext = strip_pending(row.messagetext)
    _store_memory_notice(
        user,
        None,
        None,
        text="I won't keep that one. Just tell me if you'd like me to remember "
             "something another time.",
    )
    db.session.commit()
    return jsonify(success=True, message="Not saved.")


def _last_pending_row(user):
    """The most recent assistant turn, which may carry a pending draft."""
    return (
        ChatMessage.query.filter_by(userid=user.userid, role="assistant")
        .order_by(ChatMessage.createdat.desc())
        .first()
    )


def _store_memory_notice(user, memory, question, text=None):
    """Write Aria's own follow-up turn so the exchange stays in the history.

    Confirming from the confirmation card never went through the chat model,
    so without this the conversation would show the offer and then nothing.
    """
    if text is None:
        content = (memory or {}).get("content") or "it"
        text = (
            f"That's saved — I'll keep \"{content}\" and bring it back to you "
            "soon as a question to recall."
        )
    note = ChatMessage(userid=user.userid, role="assistant", messagetext=text)
    db.session.add(note)
    db.session.flush()
    try:
        from services.ai import memory_store

        memory_store.index_chat(user, note)
    except Exception as exc:  # pragma: no cover - indexing must never break the save
        print(f"[MemorAid] Could not index the memory notice: {exc}")


@bp.get("/facts")
@jwt_required()
def facts():
    """What the companion has learned about the user (their data, visible)."""
    user = current_user()
    rows = list_facts(user)
    return jsonify(success=True, facts=[f.to_dict() for f in rows])


@bp.delete("/facts/<int:factid>")
@jwt_required()
def delete_fact(factid):
    """Retract a fact — the user stays in control of what is remembered."""
    user = current_user()
    fact = retract_fact(user, factid)
    if not fact:
        return jsonify(success=False, message="That fact was not found."), 404
    return jsonify(success=True, fact=fact.to_dict())
