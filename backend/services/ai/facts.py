"""
Durable fact memory — the companion's long-term knowledge about one user.

The single biggest reason a memory companion sounds generic is that it
forgets. "My granddaughter is called Lily" is said once, then lost, so the
next reply is generic again. This module extracts those small, stable
statements from what the user says and stores them so every later context
pack can include them.

Guard rails
-----------
* Only *durable* facts are kept — "I'm tired today" is not a fact.
* Facts are de-duplicated by a normalised ``factkey``; a repeat raises the
  confidence instead of creating a duplicate row.
* The user can list and retract their facts (see routes/chat.py), because
  this is their data and it must stay under their control.
* Patterns are NOT facts. Behaviour patterns stay in the Pattern Confidence
  Module and are only ever offered as possibilities (section 1.7).
"""
import re
from datetime import datetime

from config import Config
from models import UserFact, db
from services.ai.client import call_llm_json, llm_configured
from services.ai.mock import mock_extract_facts

FACT_SYSTEM_PROMPT = (
    "You extract durable facts about a person from their message.\n"
    "Return ONLY a JSON array, no prose, no markdown fence.\n"
    "Each item: {\"facttext\": \"...\", \"facttype\": \"...\", "
    "\"factkey\": \"...\", \"confidence\": 0.0-1.0}\n"
    "facttype is one of: family, routine, preference, health, event, place, "
    "person, general.\n"
    "factkey is a short stable identifier, e.g. \"family:granddaughter:lily\".\n"
    "Rules:\n"
    "1. Only keep facts that will still be true in a month. Skip moods, "
    "temporary states and small talk (\"I'm tired today\" is not a fact).\n"
    "2. Never infer medical conditions, diagnoses or medication changes. "
    "Only record what the person plainly stated.\n"
    "3. One fact per item. Write each fact as a short complete sentence that "
    "makes sense on its own, e.g. \"My granddaughter is called Lily.\"\n"
    "4. If there is nothing durable in the message, return an empty array [].\n"
    "5. Never repeat a fact that is already in the list you are given."
)

FACT_TYPES = {
    "family", "routine", "preference", "health", "event", "place", "person", "general",
}


def _normalise_key(text, facttype):
    """Build a stable de-duplication key from a fact sentence."""
    words = re.findall(r"[a-z0-9]+", (text or "").lower())
    stop = {"my", "is", "are", "the", "a", "an", "and", "of", "to", "in", "on", "for",
            "her", "his", "their", "our", "that", "this", "with", "she", "he", "i"}
    meaningful = [w for w in words if w not in stop and len(w) > 2]
    tail = ":".join(meaningful[:3]) if meaningful else (words[0] if words else "fact")
    return f"{facttype or 'general'}:{tail}"[:120]


def upsert_fact(user, facttext, facttype=None, factkey=None, confidence=0.6,
                source="chat"):
    """Store a fact, merging it with an existing one when they match."""
    facttext = (facttext or "").strip()
    if not facttext:
        return None
    facttype = (facttype or "general").lower()
    if facttype not in FACT_TYPES:
        facttype = "general"
    factkey = (factkey or _normalise_key(facttext, facttype)).lower()[:120]

    existing = UserFact.query.filter_by(
        userid=user.userid, factkey=factkey, status="active"
    ).first()
    now = datetime.utcnow()
    if existing:
        existing.facttext = facttext
        existing.facttype = facttype
        existing.confidence = min(1.0, max(existing.confidence or 0.0, confidence) + 0.05)
        existing.lastverified = now
        existing.source = source
        return existing

    fact = UserFact(
        userid=user.userid,
        factkey=factkey,
        facttext=facttext,
        facttype=facttype,
        confidence=max(0.0, min(1.0, confidence)),
        source=source,
        status="active",
        createdat=now,
        lastverified=now,
    )
    db.session.add(fact)
    db.session.flush()
    return fact


def extract_facts(user, text, source="chat"):
    """Extract durable facts from a message and store them.

    Uses the fast model for the extraction pass; with no API key the offline
    mock extracts the obvious patterns so the pipeline stays testable.
    """
    text = (text or "").strip()
    if len(text) < 4:
        return []

    known = [
        f.facttext for f in UserFact.query.filter_by(
            userid=user.userid, status="active"
        ).all()
    ]

    if not llm_configured():
        if not getattr(Config, "AI_MOCK_MODE", False):
            return []
        candidates = mock_extract_facts(text)
    else:
        payload = {
            "message": text,
            "facts_already_known": known,
        }
        result = call_llm_json(
            FACT_SYSTEM_PROMPT,
            "Message and known facts as JSON:\n" + str(payload),
            tier="fast",
            max_tokens=500,
            default=[],
        )
        candidates = result if isinstance(result, list) else []

    stored = []
    for item in candidates:
        if not isinstance(item, dict):
            continue
        facttext = (item.get("facttext") or "").strip()
        if not facttext:
            continue
        fact = upsert_fact(
            user,
            facttext,
            facttype=item.get("facttype"),
            factkey=item.get("factkey"),
            confidence=float(item.get("confidence") or 0.6),
            source=source,
        )
        if fact:
            stored.append(fact)

    if stored:
        from services.ai import memory_store

        for fact in stored:
            memory_store.index_fact(user, fact)
        db.session.commit()
    return stored


def list_facts(user, include_retracted=False):
    query = UserFact.query.filter_by(userid=user.userid)
    if not include_retracted:
        query = query.filter_by(status="active")
    return query.order_by(UserFact.confidence.desc()).all()


def retract_fact(user, factid):
    """Let the user remove a fact — their data, their call."""
    fact = UserFact.query.filter_by(userid=user.userid, factid=factid).first()
    if not fact:
        return None
    fact.status = "retracted"
    db.session.commit()
    return fact
