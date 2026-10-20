"""Notifications routes — morning check-in, due review and family alerts
(table: notifications, section 3.5.1)."""
from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required

from models import Notification, db
from routes.profile import current_user

bp = Blueprint("notifications", __name__, url_prefix="/api/notifications")


@bp.get("")
@bp.get("/")
@jwt_required()
def list_notifications():
    user = current_user()
    rows = (
        Notification.query.filter_by(userid=user.userid)
        .order_by(Notification.createdat.desc()).limit(30).all()
    )
    return jsonify(success=True, notifications=[r.to_dict() for r in rows])


@bp.post("/read")
@jwt_required()
def mark_all_read():
    user = current_user()
    Notification.query.filter_by(userid=user.userid, status="pending").update({"status": "read"})
    db.session.commit()
    return jsonify(success=True)
