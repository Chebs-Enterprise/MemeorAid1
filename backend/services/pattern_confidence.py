"""
Pattern Confidence Module — document of proof Memoraid-123.docx section 1.7:

    "A backend component that silently observes user behaviour patterns,
     assigns each pattern a confidence score, and decays that score if the
     pattern is not reinforced — ensuring the AI never assumes an event
     occurred without explicit user confirmation."

Design (implementation plan section 6):
  * New observations start at INITIAL_CONFIDENCE.
  * Each reinforcement raises the score (capped at 1.0).
  * The nightly scheduler job decays unconfirmed scores by DECAY_RATE.
  * Scores below STALE_FLOOR are marked 'stale' and excluded from AI context.
  * Only patterns at or above CONTEXT_THRESHOLD enter the AI context pack,
    and only as possibilities — never asserted facts.
"""
from datetime import date

from config import Config
from models import BehaviorPattern, db

INITIAL_CONFIDENCE = 0.4
REINFORCE_BUMP = 0.2


def _cfg():
    return {
        "decay": getattr(Config, "PATTERN_DECAY_RATE", 0.9),
        "context": getattr(Config, "PATTERN_CONTEXT_THRESHOLD", 0.6),
        "floor": getattr(Config, "PATTERN_STALE_FLOOR", 0.3),
    }


def observe_pattern(user, pattern_type, data=None, today=None):
    """Silently record (or reinforce) an observed behaviour pattern."""
    today = today or date.today()
    pattern = BehaviorPattern.query.filter_by(
        userid=user.userid, pattern_type=pattern_type
    ).first()
    if pattern:
        pattern.confidence_score = min(1.0, (pattern.confidence_score or 0) + REINFORCE_BUMP)
        pattern.last_reinforced = today
        if pattern.status == "stale":
            pattern.status = "observed"
    else:
        pattern = BehaviorPattern(
            userid=user.userid,
            pattern_type=pattern_type,
            pattern_data=data or {},
            confidence_score=INITIAL_CONFIDENCE,
            last_reinforced=today,
            status="observed",
        )
        db.session.add(pattern)
    return pattern


def confirm_pattern(user, pattern_type, today=None):
    """Explicit user confirmation — the only way a pattern becomes 'confirmed'."""
    today = today or date.today()
    pattern = BehaviorPattern.query.filter_by(
        userid=user.userid, pattern_type=pattern_type
    ).first()
    if pattern:
        pattern.confidence_score = min(1.0, (pattern.confidence_score or 0) + REINFORCE_BUMP + 0.2)
        pattern.last_reinforced = today
        pattern.status = "confirmed"
    return pattern


def get_context_patterns(user):
    """Patterns safe to feed the AI: confident enough AND confirmed/observed."""
    cfg = _cfg()
    rows = BehaviorPattern.query.filter(
        BehaviorPattern.userid == user.userid,
        BehaviorPattern.status.in_(["observed", "confirmed"]),
        BehaviorPattern.confidence_score >= cfg["context"],
    ).all()
    return [r.to_dict() for r in rows]


def decay_unconfirmed_patterns(today=None):
    """Nightly scheduler job: decay every unconfirmed pattern's score."""
    cfg = _cfg()
    today = today or date.today()
    rows = BehaviorPattern.query.filter(BehaviorPattern.status != "confirmed").all()
    decayed = 0
    for row in rows:
        row.confidence_score = (row.confidence_score or 0.0) * cfg["decay"]
        if row.confidence_score < cfg["floor"]:
            row.status = "stale"
        decayed += 1
    db.session.commit()
    return decayed
