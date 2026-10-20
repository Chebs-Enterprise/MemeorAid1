"""Profile & settings routes — FR-02, 'Manage Profile and Settings'."""
from datetime import time as dtime

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from models import User, db

bp = Blueprint("profile", __name__, url_prefix="/api")


def current_user():
    return User.query.get(int(get_jwt_identity()))


@bp.get("/profile")
@jwt_required()
def get_profile():
    user = current_user()
    if not user:
        return jsonify(success=False, message="Account not found."), 404
    return jsonify(success=True, user=user.to_dict())


@bp.put("/profile")
@jwt_required()
def update_profile():
    user = current_user()
    if not user:
        return jsonify(success=False, message="Account not found."), 404
    data = request.get_json(silent=True) or {}

    if "fullname" in data and data["fullname"].strip():
        user.fullname = data["fullname"].strip()
    if "family_contact_email" in data:
        user.family_contact_email = (data["family_contact_email"] or "").strip() or None
    if "accessibilitypref" in data:
        user.accessibilitypref = (data["accessibilitypref"] or "").strip() or None
    if "agegroup" in data and data["agegroup"] in ("51-65", "above-65"):
        user.agegroup = data["agegroup"]
    if "checkintime" in data:
        try:
            hours, minutes = (data["checkintime"] or "08:00").split(":")
            user.checkintime = dtime(int(hours), int(minutes))
        except Exception:
            pass
    if "inactivity_threshold_hours" in data:
        try:
            user.inactivity_threshold_hours = max(1, int(data["inactivity_threshold_hours"]))
        except (TypeError, ValueError):
            pass

    db.session.commit()
    return jsonify(success=True, user=user.to_dict())
