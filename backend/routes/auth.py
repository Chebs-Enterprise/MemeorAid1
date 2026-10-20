"""Auth routes — FR-01: Register Account / Login (use case diagram 3.1)."""
import bcrypt
from flask import Blueprint, jsonify, request
from flask_jwt_extended import create_access_token

from models import User, db

bp = Blueprint("auth", __name__, url_prefix="/api/auth")

VALID_AGE_GROUPS = ("51-65", "above-65")


@bp.post("/register")
def register():
    data = request.get_json(silent=True) or {}
    fullname = (data.get("fullname") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    agegroup = data.get("agegroup") or ""

    if not fullname or not email or not password:
        return jsonify(success=False, message="Please fill in your full name, email and password."), 400
    if agegroup not in VALID_AGE_GROUPS:
        return jsonify(success=False, message="Please choose an age group."), 400
    if len(password) < 8:
        return jsonify(success=False, message="Please choose a password of at least 8 characters."), 400
    if User.query.filter_by(email=email).first():
        return jsonify(success=False, message="An account with this email already exists."), 409

    checkintime = (data.get("checkintime") or "08:00").strip()
    try:
        hours, minutes = checkintime.split(":")
        from datetime import time as dtime
        checkin_time_obj = dtime(int(hours), int(minutes))
    except Exception:
        from datetime import time as dtime
        checkin_time_obj = dtime(8, 0)

    user = User(
        fullname=fullname,
        email=email,
        passwordhash=bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode(),
        agegroup=agegroup,
        family_contact_email=(data.get("family_contact_email") or "").strip() or None,
        checkintime=checkin_time_obj,
    )
    db.session.add(user)
    db.session.commit()

    token = create_access_token(identity=str(user.userid))
    return jsonify(success=True, token=token, user=user.to_dict()), 201


@bp.post("/login")
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    user = User.query.filter_by(email=email).first()
    if not user or not user.isactive:
        return jsonify(success=False, message="We could not find an account with those details."), 401
    if not bcrypt.checkpw(password.encode(), user.passwordhash.encode()):
        return jsonify(success=False, message="That password does not look right. Please try again."), 401

    token = create_access_token(identity=str(user.userid))
    return jsonify(success=True, token=token, user=user.to_dict()), 200
