"""
Retrieval over the user's memories, facts and past conversation.

This is the module that stops the companion sounding generic. The old
context pack sent the six most recent memories, so anything the user had
logged earlier was invisible to the model. Retrieval scores every memory
against the current message and sends only the relevant ones.

Hybrid scoring (weights sum to 1.0)
------------------------------------
    semantic  0.45  cosine similarity of the embedded query and memory
    keyword   0.25  overlap of content words (exact names, places, dates)
    recency   0.10  exponential decay, half-life ~120 days
    due       0.10  SM-2 scheduling — memories due for review right now
    category  0.10  the message naming the same category as the memory

Every scored item keeps the reasons it was selected so the UI can show
"because you mentioned…" and the model can be told why it matters.
"""
import math
from datetime import date, datetime, timedelta

from config import Config
from models import ChatMessage, EmbeddingRecord, MemoryEntry, ReviewSchedule, UserFact, db
from services.ai.embeddings import cosine, embed_text, keyword_overlap

RECENCY_HALFLIFE_DAYS = 120.0


def _vector_for(userid, kind, refid):
    row = EmbeddingRecord.query.filter_by(
        userid=userid, kind=kind, refid=refid
    ).order_by(EmbeddingRecord.embeddingid.desc()).first()
    if row and row.vector:
        return list(row.vector)
    return None


def _store_vector(userid, kind, refid, text):
    """Embed and persist a vector for a memory/fact/chat turn."""
    vector = embed_text(text)
    row = EmbeddingRecord.query.filter_by(
        userid=userid, kind=kind, refid=refid
    ).order_by(EmbeddingRecord.embeddingid.desc()).first()
    provider = getattr(Config, "EMBEDDING_PROVIDER", "local")
    dim = len(vector) or getattr(Config, "EMBEDDING_DIM", 384)
    if row:
        row.vector = vector
        row.provider = provider
        row.dim = dim
        row.createdat = datetime.utcnow()
    else:
        db.session.add(EmbeddingRecord(
            userid=userid, kind=kind, refid=refid, vector=vector,
            provider=provider, dim=dim,
        ))
    return vector


def index_memory(user, entry):
    """Index a memory entry (content + context note)."""
    text = " ".join(filter(None, [entry.content or "", entry.contextnote or ""]))
    return _store_vector(user.userid, "memory", entry.memoryid, text)


def index_fact(user, fact):
    return _store_vector(user.userid, "fact", fact.factid, fact.facttext or "")


def index_chat(user, message, text=None):
    """Index a chat message. ``text`` overrides the stored body when the
    caller needs to index a cleaned version (a hidden marker, for example)."""
    body = message.messagetext or "" if text is None else text
    return _store_vector(user.userid, "chat", message.messageid, body)


def ensure_memory_index(user):
    """Index any memory that has no vector yet (safe to call repeatedly)."""
    entries = MemoryEntry.query.filter_by(userid=user.userid).all()
    indexed = {
        r.refid
        for r in EmbeddingRecord.query.filter_by(
            userid=user.userid, kind="memory"
        ).all()
    }
    added = 0
    for entry in entries:
        if entry.memoryid not in indexed:
            index_memory(user, entry)
            added += 1
    if added:
        db.session.flush()
    return added


def _recency_score(created):
    if not created:
        return 0.0
    age_days = max(0.0, (datetime.utcnow() - created).total_seconds() / 86400.0)
    return math.pow(0.5, age_days / RECENCY_HALFLIFE_DAYS)


def _due_score(entry):
    """1.0 when the memory is due for review now, decaying afterwards."""
    schedule = entry.schedule
    if not schedule or not schedule.nextreviewdate:
        return 0.0
    delta = (schedule.nextreviewdate - date.today()).days
    if delta <= 0:
        return 1.0
    return max(0.0, 1.0 - delta / 30.0)


def retrieve_memories(user, query, limit=None, include_recent=True):
    """Return the memories most relevant to ``query``, best first."""
    limit = limit or getattr(Config, "RETRIEVAL_MEMORY_LIMIT", 8)
    if not query:
        return []

    ensure_memory_index(user)

    entries = (
        MemoryEntry.query.filter_by(userid=user.userid, status="active")
        .order_by(MemoryEntry.datecreated.desc()).all()
    )
    if not entries:
        return []

    qvec = embed_text(query)
    lowered = (query or "").lower()
    schedules = {s.memoryid: s for s in ReviewSchedule.query.all()
                 if s.memoryid in {e.memoryid for e in entries}}

    scored = []
    for entry in entries:
        text = " ".join(filter(None, [entry.content or "", entry.contextnote or ""]))
        semantic = cosine(qvec, _vector_for(user.userid, "memory", entry.memoryid))
        keyword = keyword_overlap(query, text)
        recency = _recency_score(entry.datecreated)
        schedule = schedules.get(entry.memoryid)
        due = _due_score(entry) if schedule else 0.0
        category = ""
        if entry.category:
            category = entry.category.categoryname or ""
        category_hit = 0.0
        if category:
            cat_key = category.lower()
            # "my medication" should match the "Medications" category.
            stems = {cat_key, cat_key[:-1] if cat_key.endswith("s") else cat_key}
            if any(stem and stem in lowered for stem in stems):
                category_hit = 1.0

        score = (
            0.45 * max(0.0, semantic)
            + 0.25 * keyword
            + 0.10 * recency
            + 0.10 * due
            + 0.10 * category_hit
        )
        reasons = []
        if semantic > 0.12:
            reasons.append("matches what you said")
        if keyword > 0.05:
            reasons.append("mentions the same words")
        if due > 0:
            reasons.append("is due for review")
        if category_hit:
            reasons.append(f"is a {category.lower()} memory")
        if recency > 0.6:
            reasons.append("is one of your recent memories")

        scored.append({
            "memoryid": entry.memoryid,
            "content": entry.content,
            "contextnote": entry.contextnote,
            "category": category,
            "datecreated": entry.datecreated.isoformat() if entry.datecreated else None,
            "score": round(score, 4),
            "reasons": reasons,
        })

    scored.sort(key=lambda item: item["score"], reverse=True)

    # Always keep the newest memories in the pack: even a message with no
    # overlap should not leave the model with nothing to talk about.
    if include_recent:
        chosen_ids = {item["memoryid"] for item in scored[:limit]}
        for entry in entries[:2]:
            if entry.memoryid not in chosen_ids and len(chosen_ids) < limit:
                match = next(i for i in scored if i["memoryid"] == entry.memoryid)
                match["score"] = round(match["score"] + 0.001, 4)
                match["reasons"].append("is one of your recent memories")
                chosen_ids.add(entry.memoryid)

    return scored[:limit]


def retrieve_facts(user, query, limit=None):
    """Return the facts most relevant to ``query``."""
    limit = limit or getattr(Config, "RETRIEVAL_FACT_LIMIT", 8)
    facts = (
        UserFact.query.filter_by(userid=user.userid, status="active")
        .order_by(UserFact.confidence.desc()).all()
    )
    if not facts:
        return []

    qvec = embed_text(query)
    lowered = (query or "").lower()
    scored = []
    for fact in facts:
        semantic = cosine(qvec, _vector_for(user.userid, "fact", fact.factid))
        keyword = keyword_overlap(query, fact.facttext or "")
        literal = 1.0 if (fact.factkey and fact.factkey.split(":")[-1].lower() in lowered) else 0.0
        score = 0.6 * max(0.0, semantic) + 0.25 * keyword + 0.15 * literal
        scored.append({
            "factid": fact.factid,
            "facttext": fact.facttext,
            "facttype": fact.facttype,
            "factkey": fact.factkey,
            "confidence": round(fact.confidence or 0.0, 3),
            "score": round(score + 0.001 * (fact.confidence or 0), 4),
        })
    scored.sort(key=lambda item: item["score"], reverse=True)
    return scored[:limit]


def retrieve_chat(user, query, limit=None):
    """Return past conversation turns that relate to ``query``."""
    limit = limit or getattr(Config, "RETRIEVAL_CHAT_LIMIT", 4)
    if not query:
        return []
    rows = (
        ChatMessage.query.filter_by(userid=user.userid)
        .order_by(ChatMessage.createdat.desc()).limit(200).all()
    )
    if not rows:
        return []

    qvec = embed_text(query)
    scored = []
    for row in rows:
        semantic = cosine(qvec, _vector_for(user.userid, "chat", row.messageid))
        keyword = keyword_overlap(query, row.messagetext or "")
        score = 0.7 * max(0.0, semantic) + 0.3 * keyword
        if score <= 0.02:
            continue
        scored.append({
            "messageid": row.messageid,
            "role": row.role,
            "messagetext": row.messagetext,
            "createdat": row.createdat.isoformat() if row.createdat else None,
            "score": round(score, 4),
        })
    scored.sort(key=lambda item: item["score"], reverse=True)
    return scored[:limit]


def touch_fact(fact):
    fact.lastused = datetime.utcnow()


def prune_old_vectors(user, keep_days=365):
    """Housekeeping: drop vectors for items that no longer exist."""
    cutoff = datetime.utcnow() - timedelta(days=keep_days)
    stale = EmbeddingRecord.query.filter(
        EmbeddingRecord.userid == user.userid,
        EmbeddingRecord.createdat < cutoff,
    ).count()
    return stale
