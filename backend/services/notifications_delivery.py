"""
Notification delivery — writes the in-app row and (optionally) attempts
browser push and email, tracking per-channel success and failing safely.

Three rules shape this module:

  * **The in-app row is the source of truth.** It is always written first, so
    a push or email failure never loses the notification — the user still sees
    it in the bell/list next time they open the app.
  * **Failures are contained.** Every external channel is wrapped so a dead
    push endpoint, a missing VAPID key or an SMTP timeout can never raise into
    a scheduler job or an API request.
  * **No AI.** Delivery is transport only; all wording is decided by
    services/notifications.py.
"""
from datetime import datetime
import json

from models import Notification, PushSubscription, db
from services import email_sender


def _channel_list(notification):
    return [c for c in (notification.channels or "").split(",") if c]


def _record_channel(notification, channel, ok):
    channels = set(_channel_list(notification))
    if ok:
        channels.add(channel)
    notification.channels = ",".join(sorted(channels)) or "inapp"


def deliver(user, pref, *, ntype, title, message, dedupekey=None,
            recipient=None, send_push=False, send_email=False,
            email_callable=None, now_utc=None):
    """Create a notification and try to deliver it on the requested channels.

    Returns the persisted ``Notification``. ``status`` ends as ``"sent"`` when
    at least the in-app channel succeeded (which is always, since the row is
    written), and ``"pending"`` only in the rare case the commit fails.
    """
    notification = Notification(
        userid=user.userid,
        type=ntype,
        title=title,
        message=message,
        recipient=recipient or user.email,
        status="sent",
        dedupekey=dedupekey,
        channels="inapp",
    )
    db.session.add(notification)

    # Flush first so the row exists even if a later channel throws.
    try:
        db.session.flush()
    except Exception:
        db.session.rollback()
        notification.status = "pending"
        return notification

    push_ok = False
    if send_push and pref is not None and getattr(pref, "push_enabled", False):
        # A push transport must never be able to take down the caller: the
        # in-app row is already persisted above, and a reminder that cannot be
        # pushed is not a lost reminder.
        try:
            push_ok = send_push_to_user(user, title, message, url="/dashboard")
        except Exception as exc:
            print(f"[MemorAid][notify] push channel failed: {exc}")
            push_ok = False
    _record_channel(notification, "push", push_ok)

    email_ok = False
    if send_email and email_callable is not None:
        try:
            email_ok = bool(email_callable())
        except Exception as exc:  # never let a mail failure break the job
            print(f"[MemorAid][notify] email channel failed: {exc}")
            email_ok = False
    _record_channel(notification, "email", email_ok)

    if not (getattr(notification, "channels", "") or "").strip():
        notification.channels = "inapp"

    try:
        db.session.commit()
    except Exception as exc:  # pragma: no cover - defensive
        print(f"[MemorAid][notify] commit failed: {exc}")
        db.session.rollback()
    return notification


# ---------------------------------------------------------------------------
# Browser push
# ---------------------------------------------------------------------------
def push_available():
    """Whether real web-push delivery is configured **and** possible.

    Web Push needs VAPID keys and a crypto library to encrypt the payload.
    Rather than add a heavyweight dependency, delivery is attempted only when
    ``pywebpush`` is importable and keys are present; otherwise this returns
    False and the app quietly degrades to in-app notifications. Nothing here
    raises, so the notification system stays functional without push.
    """
    from config import Config

    if not (Config.VAPID_PUBLIC_KEY and Config.VAPID_PRIVATE_KEY):
        return False
    try:
        import pywebpush  # noqa: F401
    except Exception:
        return False
    return True


def send_push_to_user(user, title, body, url="/dashboard"):
    """Attempt to push ``title``/``body`` to every active device.

    Endpoints that answer 404/410 are permanently gone: they are deactivated
    (not deleted) and stop being retried. Any other error just bumps a failure
    counter. Returns True when at least one device accepted the message.
    """
    if not push_available():
        return False

    from config import Config

    subs = PushSubscription.query.filter_by(userid=user.userid, isactive=True).all()
    if not subs:
        return False

    payload = {"title": title, "body": body, "url": url}
    delivered = False
    for sub in subs:
        try:
            from pywebpush import WebPushException, webpush

            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                },
                data=json.dumps(payload),
                vapid_private_key=Config.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": Config.VAPID_SUBJECT},
            )
            sub.lastsuccessat = datetime.utcnow()
            sub.failurecount = 0
            delivered = True
        except Exception as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in (404, 410):
                sub.isactive = False
            else:
                sub.failurecount = (sub.failurecount or 0) + 1
                if sub.failurecount >= 5:
                    # Repeated soft failures: stop hammering a broken device.
                    sub.isactive = False
    try:
        db.session.commit()
    except Exception:  # pragma: no cover - defensive
        db.session.rollback()
    return delivered


def family_alert_emailer(family_email, user_full_name, inactive_hours):
    """Build the zero-argument email callback for ``deliver``.

    Wrapped in a closure so the callable signature stays ``() -> bool`` and a
    failure can never escape into the scheduler.
    """
    def _send():
        return email_sender.send_family_alert(family_email, user_full_name, inactive_hours)

    return _send
