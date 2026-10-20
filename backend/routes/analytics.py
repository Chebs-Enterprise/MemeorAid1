"""Analytics routes — FR-13 (View Analytics Dashboard, section 3.5.3)."""
from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required

from routes.profile import current_user
from services.analytics import compute_analytics

bp = Blueprint("analytics", __name__, url_prefix="/api/analytics")


@bp.get("")
@bp.get("/")
@jwt_required()
def dashboard():
    user = current_user()
    return jsonify(success=True, analytics=compute_analytics(user))
