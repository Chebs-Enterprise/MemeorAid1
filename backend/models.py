"""
MemorAid ORM models — all eleven tables from the document of proof.

Tables documented field-by-field in Memoraid-123.docx section 3.5.1 are
verbatim; the six tables the document describes only narratively have
fields inferred from the class-diagram descriptions (section 3.4.2) and
the implementation plan (section 4.6).
"""
from datetime import date, datetime

from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String, Text, Time, UniqueConstraint
from sqlalchemy import Boolean as SqlBoolean
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.types import JSON

db = SQLAlchemy()

# JSONB on PostgreSQL, generic JSON elsewhere (SQLite dev fallback).
JSONType = JSON().with_variant(JSONB(), "postgresql")


class User(db.Model):
    __tablename__ = "users"

    userid = db.Column(Integer, primary_key=True)
    fullname = db.Column(String(100), nullable=False)
    email = db.Column(String(150), unique=True, nullable=False)
    passwordhash = db.Column(String(255), nullable=False)
    agegroup = db.Column(String(20), nullable=False)  # '51-65' | 'above-65'
    accessibilitypref = db.Column(String(50))         # e.g. 'large|contrast-on'
    family_contact_email = db.Column(String(150))
    exercise_streak = db.Column(Integer, default=0)
    recall_streak = db.Column(Integer, default=0)
    last_exercise_date = db.Column(Date)
    createdat = db.Column(DateTime, default=datetime.utcnow)
    isactive = db.Column(SqlBoolean, default=True)
    # Operational fields (implementation plan §17 / §7):
    checkintime = db.Column(Time, default=lambda: datetime.strptime("08:00", "%H:%M").time())
    last_checkin_date = db.Column(Date)
    last_activity_date = db.Column(Date)
    last_recall_date = db.Column(Date)
    inactivity_threshold_hours = db.Column(Integer, default=24)
    family_alert_sent_date = db.Column(Date)

    def to_dict(self, include_settings=True):
        data = {
            "userid": self.userid,
            "fullname": self.fullname,
            "email": self.email,
            "agegroup": self.agegroup,
            "exercise_streak": self.exercise_streak or 0,
            "recall_streak": self.recall_streak or 0,
        }
        if include_settings:
            data.update({
                "accessibilitypref": self.accessibilitypref,
                "family_contact_email": self.family_contact_email,
                "checkintime": self.checkintime.strftime("%H:%M") if self.checkintime else "08:00",
                "inactivity_threshold_hours": self.inactivity_threshold_hours or 24,
                "createdat": self.createdat.isoformat() if self.createdat else None,
            })
        return data


def delete_user_data(user, session=None):
    """Remove every row belonging to ``user`` (except the user row itself).

    Dependent rows have no ON DELETE CASCADE configured, so deleting an
    account would otherwise leave memories, sessions and — most importantly —
    cached notifications behind. Because ``userid`` is an autoincrement column,
    a later registration can reuse the id and inherit the dead account's data
    (this actually happened: a new account saw a previous account's cached
    morning greeting). Always call this before deleting a user.

    Returns a dict of the number of rows removed per table.
    """
    session = session or db.session
    removed = {}

    memory_ids = [
        row[0] for row in session.query(MemoryEntry.memoryid)
        .filter(MemoryEntry.userid == user.userid).all()
    ]
    if memory_ids:
        # Questions and schedules hang off each memory entry.
        removed["recallquestions"] = (
            session.query(RecallQuestion)
            .filter(RecallQuestion.memoryid.in_(memory_ids))
            .delete(synchronize_session=False)
        )
        removed["reviewschedules"] = (
            session.query(ReviewSchedule)
            .filter(ReviewSchedule.memoryid.in_(memory_ids))
            .delete(synchronize_session=False)
        )

    for model, column in (
        (RecallSession, RecallSession.userid),
        (ExerciseSession, ExerciseSession.userid),
        (AnalyticsRecord, AnalyticsRecord.userid),
        (BehaviorPattern, BehaviorPattern.userid),
        (ChatMessage, ChatMessage.userid),
        (Notification, Notification.userid),
        (NotificationPreference, NotificationPreference.userid),
        (PushSubscription, PushSubscription.userid),
        (MemoryEntry, MemoryEntry.userid),
        (UserFact, UserFact.userid),
        (EmbeddingRecord, EmbeddingRecord.userid),
    ):
        count = session.query(model).filter(column == user.userid).delete(
            synchronize_session=False
        )
        if count:
            removed[model.__tablename__] = count

    return removed


class MemoryCategory(db.Model):
    __tablename__ = "memorycategories"

    categoryid = db.Column(Integer, primary_key=True)
    categoryname = db.Column(String(50), unique=True, nullable=False)
    description = db.Column(String(255))

    def to_dict(self):
        return {
            "categoryid": self.categoryid,
            "categoryname": self.categoryname,
            "description": self.description,
        }


class MemoryEntry(db.Model):
    __tablename__ = "memoryentries"

    memoryid = db.Column(Integer, primary_key=True)
    userid = db.Column(Integer, ForeignKey("users.userid"))
    categoryid = db.Column(Integer, ForeignKey("memorycategories.categoryid"))
    content = db.Column(Text, nullable=False)
    contextnote = db.Column(Text)
    datecreated = db.Column(DateTime, default=datetime.utcnow)
    status = db.Column(String(20), default="active")  # active | archived

    category = db.relationship("MemoryCategory")
    question = db.relationship("RecallQuestion", backref="memory", uselist=False)
    schedule = db.relationship("ReviewSchedule", backref="memory", uselist=False)

    def to_dict(self, with_question=False):
        data = {
            "memoryid": self.memoryid,
            "userid": self.userid,
            "categoryid": self.categoryid,
            "category": self.category.categoryname if self.category else None,
            "content": self.content,
            "contextnote": self.contextnote,
            "datecreated": self.datecreated.isoformat() if self.datecreated else None,
            "status": self.status,
            "nextreviewdate": self.schedule.nextreviewdate.isoformat() if self.schedule else None,
        }
        if with_question and self.question:
            data["question"] = self.question.to_dict()
        return data


class RecallQuestion(db.Model):
    __tablename__ = "recallquestions"

    questionid = db.Column(Integer, primary_key=True)
    memoryid = db.Column(Integer, ForeignKey("memoryentries.memoryid"), unique=True)
    questiontext = db.Column(Text, nullable=False)
    answerkey = db.Column(Text)
    difficultylevel = db.Column(Integer, default=1)  # 1 easy | 2 medium | 3 hard
    generatedbyai = db.Column(SqlBoolean, default=True)
    dategenerated = db.Column(DateTime, default=datetime.utcnow)

    def to_dict(self, include_answer=False):
        data = {
            "questionid": self.questionid,
            "memoryid": self.memoryid,
            "questiontext": self.questiontext,
            "difficultylevel": self.difficultylevel,
            "generatedbyai": self.generatedbyai,
        }
        if include_answer:
            data["answerkey"] = self.answerkey
        return data


class ReviewSchedule(db.Model):
    __tablename__ = "reviewschedules"

    scheduleid = db.Column(Integer, primary_key=True)
    memoryid = db.Column(Integer, ForeignKey("memoryentries.memoryid"), unique=True)
    nextreviewdate = db.Column(Date, nullable=False)
    interval = db.Column(Integer, default=1)
    repetition = db.Column(Integer, default=0)
    easefactor = db.Column(Float, default=2.5)
    lastreviewdate = db.Column(Date)

    def to_dict(self):
        return {
            "scheduleid": self.scheduleid,
            "memoryid": self.memoryid,
            "nextreviewdate": self.nextreviewdate.isoformat() if self.nextreviewdate else None,
            "interval": self.interval,
            "repetition": self.repetition,
            "easefactor": self.easefactor,
            "lastreviewdate": self.lastreviewdate.isoformat() if self.lastreviewdate else None,
        }


class RecallSession(db.Model):
    __tablename__ = "recallsessions"

    sessionid = db.Column(Integer, primary_key=True)
    userid = db.Column(Integer, ForeignKey("users.userid"))
    questionid = db.Column(Integer, ForeignKey("recallquestions.questionid"))
    memoryid = db.Column(Integer, ForeignKey("memoryentries.memoryid"))
    userresponse = db.Column(Text)
    quality = db.Column(Integer)
    passed = db.Column(SqlBoolean)
    difficulty = db.Column(Integer)
    sessiondate = db.Column(DateTime, default=datetime.utcnow)


class ExerciseSession(db.Model):
    __tablename__ = "exercisesessions"

    TECHNIQUES = (
        "method_of_loci", "elaborative_encoding", "spaced_retrieval",
        "face_name_association", "chunking", "active_observation",
    )

    exerciseid = db.Column(Integer, primary_key=True)
    userid = db.Column(Integer, ForeignKey("users.userid"))
    technique = db.Column(String(40), nullable=False)
    categoryid = db.Column(Integer, ForeignKey("memorycategories.categoryid"))
    guidance_text = db.Column(Text)
    completed = db.Column(SqlBoolean, default=False)
    score = db.Column(Integer)
    sessiondate = db.Column(DateTime, default=datetime.utcnow)

    category = db.relationship("MemoryCategory")

    def to_dict(self):
        return {
            "exerciseid": self.exerciseid,
            "technique": self.technique,
            "categoryid": self.categoryid,
            "category": self.category.categoryname if self.category else None,
            "guidance_text": self.guidance_text,
            "completed": self.completed,
            "score": self.score,
            "sessiondate": self.sessiondate.isoformat() if self.sessiondate else None,
        }


class AnalyticsRecord(db.Model):
    __tablename__ = "analyticsrecords"
    __table_args__ = (UniqueConstraint("userid", "categoryid", "period", name="uq_analytics"),)

    recordid = db.Column(Integer, primary_key=True)
    userid = db.Column(Integer, ForeignKey("users.userid"))
    categoryid = db.Column(Integer, ForeignKey("memorycategories.categoryid"))
    period = db.Column(Date, default=date.today)
    total_attempts = db.Column(Integer, default=0)
    recalls_passed = db.Column(Integer, default=0)
    accuracy = db.Column(Float, default=0.0)


class BehaviorPattern(db.Model):
    __tablename__ = "behaviorpatterns"

    patternid = db.Column(Integer, primary_key=True)
    userid = db.Column(Integer, ForeignKey("users.userid"))
    pattern_type = db.Column(String(40))
    pattern_data = db.Column(JSONType, default=dict)
    confidence_score = db.Column(Float, default=0.0)
    last_reinforced = db.Column(Date)
    status = db.Column(String(20), default="observed")  # observed | confirmed | stale

    def to_dict(self):
        return {
            "patternid": self.patternid,
            "pattern_type": self.pattern_type,
            "pattern_data": self.pattern_data,
            "confidence_score": round(self.confidence_score or 0.0, 3),
            "last_reinforced": self.last_reinforced.isoformat() if self.last_reinforced else None,
            "status": self.status,
        }


class ChatMessage(db.Model):
    __tablename__ = "chatmessages"

    messageid = db.Column(Integer, primary_key=True)
    userid = db.Column(Integer, ForeignKey("users.userid"))
    role = db.Column(String(10))  # user | assistant
    messagetext = db.Column(Text)
    createdat = db.Column(DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "messageid": self.messageid,
            "role": self.role,
            "messagetext": self.messagetext,
            "createdat": self.createdat.isoformat() if self.createdat else None,
        }


class Notification(db.Model):
    """One in-app (and optionally push/email) notification.

    ``status`` is the delivery/lifecycle state and is deliberately the small,
    ordered set the UI understands:

        pending   created but not delivered anywhere yet (a failed send, or a
                  notification produced while the user was in quiet hours)
        sent      delivered to at least one channel (in-app row, push, email)
        read      the user has seen it in the app

    ``readat`` records when it was marked read, and ``dedupekey`` is the
    daily-guard that stops the scheduler producing the same reminder every
    run (see services/notifications.py). ``title`` is a short plain-language
    heading so the in-app list and the browser push can share wording.
    """
    __tablename__ = "notifications"

    notificationid = db.Column(Integer, primary_key=True)
    userid = db.Column(Integer, ForeignKey("users.userid"))
    type = db.Column(String(30))     # morning_checkin | due_review | family_alert | inactivity
    title = db.Column(String(120))
    message = db.Column(Text)
    recipient = db.Column(String(150))
    status = db.Column(String(20), default="pending")  # pending | sent | read
    # Stable per-day / per-event key so a job that runs every few minutes can
    # never create the same notification twice.
    dedupekey = db.Column(String(160))
    # Which channels the notification actually reached: "inapp", "push", "email".
    channels = db.Column(String(60), default="inapp")
    createdat = db.Column(DateTime, default=datetime.utcnow)
    readat = db.Column(DateTime)
    # Soft delete: the row disappears from the user's list and counts, but it
    # is kept so the scheduler's per-day/per-event dedupe still knows the
    # reminder was already produced and cannot recreate it minutes later.
    deletedat = db.Column(DateTime)

    def to_dict(self):
        return {
            "notificationid": self.notificationid,
            "type": self.type,
            "title": self.title,
            "message": self.message,
            "recipient": self.recipient,
            "status": self.status,
            "channels": (self.channels or "inapp").split(","),
            "createdat": self.createdat.isoformat() if self.createdat else None,
            "readat": self.readat.isoformat() if self.readat else None,
            "unread": (self.status or "pending") != "read",
        }


class NotificationPreference(db.Model):
    """What a user wants to be notified about, and when.

    One row per user (created on first read with sensible defaults, so no
    migration/backfill is needed for existing accounts). This is where the
    "configurable preferences, quiet hours and consent" requirements live —
    kept apart from the ``users`` table so the core account row stays stable.

    Quiet hours are evaluated in the user's own ``timezone`` (an IANA name);
    nothing in this module needs a paid service or an external clock.
    """
    __tablename__ = "notificationpreferences"

    preferenceid = db.Column(Integer, primary_key=True)
    userid = db.Column(Integer, ForeignKey("users.userid"), unique=True)
    # Per-category opt-in/opt-out. Defaults preserve today's behaviour.
    morning_checkin = db.Column(SqlBoolean, default=True)
    due_review = db.Column(SqlBoolean, default=True)
    family_alerts = db.Column(SqlBoolean, default=True)
    # Browser push is opt-in: it also needs the browser's own permission.
    push_enabled = db.Column(SqlBoolean, default=False)
    # Consent for contacting the family contact. OFF by default: MemorAid
    # must never alert a third party without the user explicitly agreeing.
    family_consent = db.Column(SqlBoolean, default=False)
    # Quiet hours, local wall-clock minutes since midnight (start inclusive,
    # end exclusive). Defaults cover a typical night.
    quiet_hours_start = db.Column(Integer, default=22 * 60)
    quiet_hours_end = db.Column(Integer, default=7 * 60)
    quiet_hours_enabled = db.Column(SqlBoolean, default=True)
    # IANA timezone name, e.g. "Europe/London". Falls back to UTC when the
    # name is unknown, so a bad value can never break a job.
    timezone = db.Column(String(64), default="UTC")
    createdat = db.Column(DateTime, default=datetime.utcnow)
    updatedat = db.Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "morning_checkin": bool(self.morning_checkin),
            "due_review": bool(self.due_review),
            "family_alerts": bool(self.family_alerts),
            "push_enabled": bool(self.push_enabled),
            "family_consent": bool(self.family_consent),
            "quiet_hours_enabled": bool(self.quiet_hours_enabled),
            "quiet_hours_start": self.quiet_hours_start if self.quiet_hours_start is not None else 22 * 60,
            "quiet_hours_end": self.quiet_hours_end if self.quiet_hours_end is not None else 7 * 60,
            "timezone": self.timezone or "UTC",
        }


class PushSubscription(db.Model):
    """A browser push subscription (one per device/browser).

    The endpoint and keys come straight from the browser's
    ``PushManager.subscribe()`` call and are unique per device. Rows are kept
    soft (``isactive``) because a subscription that the browser has rotated or
    revoked starts returning 404/410 on send — see
    services/notifications_delivery.py — and is then deactivated rather than
    deleted, so the failure is visible.
    """
    __tablename__ = "pushsubscriptions"

    subscriptionid = db.Column(Integer, primary_key=True)
    userid = db.Column(Integer, ForeignKey("users.userid"))
    endpoint = db.Column(Text, nullable=False)
    p256dh = db.Column(String(255))
    auth = db.Column(String(255))
    useragent = db.Column(String(255))
    isactive = db.Column(SqlBoolean, default=True)
    # Delivery bookkeeping so failures are tracked safely rather than retried
    # forever.
    failurecount = db.Column(Integer, default=0)
    lastsuccessat = db.Column(DateTime)
    createdat = db.Column(DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "subscriptionid": self.subscriptionid,
            "endpoint": self.endpoint,
            "isactive": bool(self.isactive),
            "failurecount": self.failurecount or 0,
            "lastsuccessat": self.lastsuccessat.isoformat() if self.lastsuccessat else None,
            "createdat": self.createdat.isoformat() if self.createdat else None,
        }


class UserFact(db.Model):
    """Durable facts the companion has learned about the user.

    The single biggest reason a memory companion sounds generic is that it
    forgets what it was told. "My granddaughter is called Lily" is stated once
    and then lost, so the next reply is generic again. Each fact is a small,
    self-contained statement about the user, extracted from conversation (or
    from a logged memory), de-duplicated by ``factkey`` and re-injected into
    every context pack.

    The user owns this data: facts can be listed and retracted from the UI.
    """
    __tablename__ = "userfacts"

    factid = db.Column(Integer, primary_key=True)
    userid = db.Column(Integer, ForeignKey("users.userid"))
    # Stable key used for de-duplication, e.g. "family:granddaughter:lily".
    factkey = db.Column(String(120))
    facttext = db.Column(Text, nullable=False)
    facttype = db.Column(String(30), default="general")
    # family | routine | preference | health | event | place | person | general
    confidence = db.Column(Float, default=0.5)
    source = db.Column(String(20), default="chat")  # chat | memory | pattern | manual
    status = db.Column(String(20), default="active")  # active | superseded | retracted
    createdat = db.Column(DateTime, default=datetime.utcnow)
    lastused = db.Column(DateTime)
    lastverified = db.Column(DateTime)

    def to_dict(self):
        return {
            "factid": self.factid,
            "factkey": self.factkey,
            "facttext": self.facttext,
            "facttype": self.facttype,
            "confidence": round(self.confidence or 0.0, 3),
            "source": self.source,
            "status": self.status,
            "createdat": self.createdat.isoformat() if self.createdat else None,
            "lastverified": self.lastverified.isoformat() if self.lastverified else None,
        }


class EmbeddingRecord(db.Model):
    """Vector index over memories, facts and past chat turns.

    Retrieval is what lets the companion reach a memory from three months
    ago instead of only the six most recent ones. The embedding provider is
    pluggable (see services/ai/embeddings.py) — the default one runs fully
    offline, so this table is populated even without an API key.
    """
    __tablename__ = "embeddingrecords"

    embeddingid = db.Column(Integer, primary_key=True)
    userid = db.Column(Integer, ForeignKey("users.userid"))
    kind = db.Column(String(20))      # memory | fact | chat
    refid = db.Column(Integer)
    vector = db.Column(JSONType)
    provider = db.Column(String(20), default="local")
    dim = db.Column(Integer, default=384)
    createdat = db.Column(DateTime, default=datetime.utcnow)

