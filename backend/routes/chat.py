"""Chat companion route — FR-09/FR-10/FR-11 (Chat with AI Companion)."""
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from models import ChatMessage
from routes.profile import current_user
from services.ai.chat_companion import handle_message

bp = Blueprint("chat", __name__, url_prefix="/api/chat")


@bp.get("/history")
@jwt_required()
def history():
    user = current_user()
    rows = (
        ChatMessage.query.filter_by(userid=user.userid)
        .order_by(ChatMessage.createdat.desc()).limit(50).all()
    )
    rows.reverse()
    return jsonify(success=True, messages=[r.to_dict() for r in rows])


@bp.post("")
@bp.post("/")
@jwt_required()
def send():
    user = current_user()
    data = request.get_json(silent=True) or {}
    reply, pattern_event = handle_message(user, data.get("message"))
    return jsonify(success=True, reply=reply, pattern_event=pattern_event)
