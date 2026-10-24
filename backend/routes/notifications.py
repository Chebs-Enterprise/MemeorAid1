"""
Notifications routes — in-app notification history, unread counts, read state,
per-user preferences and browser push subscriptions (table: notifications,
section 3.5.1).

Notifications themselves are produced by the scheduler
(services/jobs.py) using predefined text only — no endpoint here calls an AI
service, and every endpoint keeps working with the AI provider offline.
"""
from datetime import datetime

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from config import Config
from models import Notification, PushSubscription, db
from routes.profile import current_user
from services import notifications as notify

bp = Blueprint("notifications", __name__, url_prefix="/api/notifications")


def _visible(query):
    """Exclude rows the user has deleted (soft delete, see the model)."""
    return query.filter(Notification.deletedat.is_(None))


# ---------------------------------------------------------------------------
# History + unread
# ---------------------------------------------------------------------------
@bp.get("")
@bp.get("/")
@jwt_required()
def list_notifications():
    """Notification history (newest first) plus the unread count.

    Soft-deleted rows are never returned, so a deleted message stays gone from
    the user's point of view.
    """
    user = current_user()
    limit = request.args.get("limit", type=int) or 30
    limit = max(1, min(limit, 100))
    query = _visible(Notification.query.filter_by(userid=user.userid))
    if request.args.get("unread") in ("1", "true", "yes"):
        query = query.filter(Notification.status != "read")
    rows = query.order_by(Notification.createdat.desc()).limit(limit).all()
    unread = _visible(Notification.query).filter(
        Notification.userid == user.userid, Notification.status != "read"
    ).count()
    return jsonify(
        success=True,
        notifications=[r.to_dict() for r in rows],
        unread_count=unread,
    )


@bp.get("/unread-count")
@jwt_required()
def unread_count():
    """Just the badge number, for cheap polling from the header."""
    user = current_user()
    unread = _visible(Notification.query).filter(
        Notification.userid == user.userid, Notification.status != "read"
    ).count()
    return jsonify(success=True, unread_count=unread)


# ---------------------------------------------------------------------------
# Read state
# ---------------------------------------------------------------------------
@bp.post("/read")
@jwt_required()
def mark_all_read():
    """Mark every unread notification as read."""
    user = current_user()
    unread = _visible(Notification.query).filter(
        Notification.userid == user.userid, Notification.status != "read"
    ).all()
    now = datetime.utcnow()
    for row in unread:
        row.status = "read"
        row.readat = now
    db.session.commit()
    return jsonify(success=True, marked=len(unread), unread_count=0)


@bp.post("/<int:notificationid>/read")
@jwt_required()
def mark_one_read(notificationid):
    """Mark a single notification read (scoped to the signed-in user)."""
    user = current_user()
    row = _visible(Notification.query).filter_by(
        notificationid=notificationid, userid=user.userid
    ).first()
    if row is None:
        return jsonify(success=False, message="Notification not found."), 404
    if row.status != "read":
        row.status = "read"
        row.readat = datetime.utcnow()
        db.session.commit()
    unread = _visible(Notification.query).filter(
        Notification.userid == user.userid, Notification.status != "read"
    ).count()
    return jsonify(success=True, notification=row.to_dict(), unread_count=unread)


@bp.delete("/<int:notificationid>")
@jwt_required()
def delete_notification(notificationid):
    """Remove one notification from the user's list.

    Scoped to the signed-in user, so one account can never delete another's
    message. The row is soft-deleted: it vanishes from the list, the unread
    count and every future read, but the scheduler's per-day/per-event dedupe
    still sees it, so the same reminder cannot be recreated minutes later.
    """
    user = current_user()
    row = _visible(Notification.query).filter_by(
        notificationid=notificationid, userid=user.userid
    ).first()
    if row is None:
        return jsonify(success=False, message="Notification not found."), 404
    row.deletedat = datetime.utcnow()
    db.session.commit()
    unread = _visible(Notification.query).filter(
        Notification.userid == user.userid, Notification.status != "read"
    ).count()
    return jsonify(
        success=True, deleted=notificationid, unread_count=unread
    )


# ---------------------------------------------------------------------------
# Preferences
# ---------------------------------------------------------------------------
@bp.get("/preferences")
@jwt_required()
def get_preferences():
    user = current_user()
    pref = notify.get_preferences(user)
    return jsonify(success=True, preferences=pref.to_dict())


@bp.put("/preferences")
@jwt_required()
def update_preferences():
    """Update the user's notification preferences.

    Only known keys are accepted; booleans are coerced, quiet-hour values are
    clamped to a valid minute-of-day, and an unrecognised timezone name is
    rejected so a typo cannot silently disable all reminders.
    """
    user = current_user()
    pref = notify.get_preferences(user)
    data = request.get_json(silent=True) or {}

    for field in ("morning_checkin", "due_review", "family_alerts",
                  "push_enabled", "family_consent", "quiet_hours_enabled"):
        if field in data:
            setattr(pref, field, bool(data[field]))

    for field in ("quiet_hours_start", "quiet_hours_end"):
        if field in data and data[field] is not None:
            try:
                minutes = int(data[field])
            except (TypeError, ValueError):
                return jsonify(
                    success=False, message="Quiet hours must be minutes past midnight."
                ), 400
            setattr(pref, field, max(0, min(1439, minutes)))

    if "timezone" in data and data["timezone"]:
        name = str(data["timezone"]).strip()
        try:
            from zoneinfo import ZoneInfo

            ZoneInfo(name)
            pref.timezone = name
        except Exception:
            return jsonify(
                success=False, message=f"Unknown timezone '{name}'."
            ), 400

    db.session.commit()
    return jsonify(success=True, preferences=pref.to_dict())


# ---------------------------------------------------------------------------
# Browser push subscriptions
# ---------------------------------------------------------------------------
@bp.get("/push/public-key")
@jwt_required()
def push_public_key():
    """The VAPID public key the browser needs to create a subscription.

    Returns ``available=false`` when push is not configured, so the frontend
    can hide the control instead of subscribing to a dead endpoint.
    """
    from services import notifications_delivery as delivery

    return jsonify(
        success=True,
        available=bool(Config.VAPID_PUBLIC_KEY) and delivery.push_available(),
        public_key=Config.VAPID_PUBLIC_KEY or None,
    )


@bp.post("/push/subscribe")
@jwt_required()
def push_subscribe():
    """Store (or refresh) a browser push subscription for this device."""
    user = current_user()
    data = request.get_json(silent=True) or {}
    endpoint = (data.get("endpoint") or "").strip()
    keys = data.get("keys") or {}
    if not endpoint:
        return jsonify(success=False, message="A subscription endpoint is required."), 400

    row = PushSubscription.query.filter_by(userid=user.userid, endpoint=endpoint).first()
    if row is None:
        row = PushSubscription(userid=user.userid, endpoint=endpoint)
        db.session.add(row)
    row.p256dh = keys.get("p256dh") or row.p256dh
    row.auth = keys.get("auth") or row.auth
    row.useragent = (request.headers.get("User-Agent") or "")[:255]
    row.isactive = True
    row.failurecount = 0

    # Storing a subscription implies the user wants push; make the two agree.
    pref = notify.get_preferences(user)
    pref.push_enabled = True

    db.session.commit()
    return jsonify(success=True, subscription=row.to_dict())


@bp.post("/push/unsubscribe")
@jwt_required()
def push_unsubscribe():
    """Deactivate this device's subscription (and stop pushing to it)."""
    user = current_user()
    data = request.get_json(silent=True) or {}
    endpoint = (data.get("endpoint") or "").strip()
    if not endpoint:
        return jsonify(success=False, message="A subscription endpoint is required."), 400
    row = PushSubscription.query.filter_by(userid=user.userid, endpoint=endpoint).first()
    if row is not None:
        row.isactive = False
        db.session.commit()

    # If no active device is left, reflect that in the preference.
    remaining = PushSubscription.query.filter_by(
        userid=user.userid, isactive=True
    ).count()
    if remaining == 0:
        pref = notify.get_preferences(user)
        pref.push_enabled = False
        db.session.commit()
    return jsonify(success=True, active_devices=remaining)
