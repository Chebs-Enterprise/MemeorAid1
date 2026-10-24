"""
Conversational memory logging — telling Aria about something *is* logging it.

Logging a memory used to mean leaving the conversation and filling in a form
on a different page. For the person MemorAid is built for that is a real
barrier: they were mid-sentence about their granddaughter and would have had
to navigate away and type it all again. This module lets the same thing
happen inside the chat.

How a turn is classified
------------------------
The existing understanding pass already reads the message and decides the
intent, so it is reused here rather than adding another model call. A turn is
treated as a *memory worth keeping* when it looks like the person is telling
us something about themselves — a person, a place, a routine, an
appointment, a preference — as opposed to greeting, small talk, a question,
or a report of memory difficulty.

The outcome of every turn is therefore exactly one of:

    conversation  ordinary chat                            (nothing saved)
    clarify       about them, but too thin to keep yet     (Aria asks)
    confirm       a clear candidate — Aria offers to save  (waits for them)
    logged        they agreed, and the row is really saved  (database-verified)

The confirmation step is not ceremony. A memory entry feeds the recall
question generator and the SM-2 schedule, so putting the wrong thing in is
worse than waiting one more turn. But the user must never be interrogated
either: a full, self-contained statement (with a date, or a whole sentence
about a person) is a confident candidate and is offered straight away.

Guard rails
-----------
* Nothing is ever written to ``memoryentries`` unless the user agreed — the
  only caller of the save path is the confirm handler.
* The AI never gets to *assert* that a memory was saved: the save happens in
  the database and the reply is only told about it *after* the row exists.
* With no API key the clarification/classification step falls back to the
  deterministic rules in ``services/ai/mock.py``, like every other AI feature.
* Saving goes through the same helpers as ``POST /api/memories``, so the
  recall question, the SM-2 schedule and the retrieval index stay in step
  whatever route the memory came in through.
"""
import re

from config import Config

# Where a memory logged from the chat is stored. ``source`` rides along on the
# context note so it is obvious in the database that it did not come from the
# Log Memory form (the note is free text and already user-visible).
CHAT_SOURCE = "From your conversation with Aria"

MEMORY_CATEGORY_HINTS = {
    "names": ("names", "name", "people", "person", "family", "friend", "neighbour"),
    "appointments": ("appointment", "appointments", "doctor", "dentist", "clinic",
                     "visit", "meeting", "hospital", "surgery", "checkup", "check-up"),
    "tasks": ("task", "tasks", "to do", "todo", "errand", "chore", "shopping",
              "bill", "pay", "remind"),
    "conversations": ("conversation", "conversations", "talked", "told", "said",
                      "discussed", "phone call", "called me"),
    "medications": ("medication", "medications", "medicine", "tablet", "pill",
                    "pills", "dose", "dosage", "prescription", "inhaler"),
}

# "my granddaughter is called Lily" — a confident, self-contained statement.
_NAMED_PERSON = re.compile(
    r"\bmy\s+[a-z]+\s+(?:is|was)\s+(?:called|named)\b"
    r"|\bmy\s+[a-z]+'?s?\s+name\s+is\b"
    r"|\bmy\s+[a-z]+\s+[A-Z][\w'-]+",  # "my husband John"
)

# A named weekday, an actual date, or a time — the mark of a real appointment.
_HAS_WHEN = re.compile(
    r"\b(?:mon|tues?|wed(?:nes)?|thur?s?|fri|sat(?:ur)?|sun)(?:day)?\b"
    r"|\b(?:next|this)\s+(?:week|month|year|monday|tuesday|wednesday|thursday|"
    r"friday|saturday|sunday)\b"
    r"|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?[a-z]{3,9}\b"
    r"|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b"
    r"|\b\d{1,2}[:.]\d{2}\b"
    r"|\b\d{1,2}\s*(?:am|pm)\b"
    r"|\b(?:tomorrow|today|tonight|yesterday)\b",
    re.I,
)

_TEMPORAL_END = re.compile(
    r"\b(?:today|tomorrow|tonight|yesterday|this (?:morning|afternoon|evening)|"
    r"right now|at the moment|these days)\b.*$",
    re.I,
)

# "How do I...", "Do you remember...?" — a question, not a new memory.
_QUESTION = re.compile(r"^\s*(?:what|when|where|who|why|how|do|does|did|can|could|"
                       r"should|would|will|is|are|am)\b", re.I)


# ──────────────────────────────────────────────────────────────────────
# Classification
# ──────────────────────────────────────────────────────────────────────
def _looks_like_question(message):
    return bool(_QUESTION.match((message or "").strip()))


def _substantial(message, understanding):
    """Is there enough here to keep as a memory, or should Aria ask first?"""
    text = (message or "").strip()
    if _NAMED_PERSON.search(text) or _HAS_WHEN.search(text):
        return True
    # A whole sentence with a subject and a verb carries enough to be useful.
    words = [w for w in re.findall(r"[A-Za-z']+", text) if len(w) > 1]
    if len(words) < 6:
        return False
    if re.search(r"\b(?:is|are|was|were|has|have|had|do|does|did|go|goes|went|"
                 r"will|would|like|love|enjoy|prefer|live|lives|take|takes|"
                 r"call|calls|visit|visits|see|sees|need|needs)\b", text, re.I):
        return True
    return bool((understanding or {}).get("needs_memory"))


def is_memory_candidate(message, understanding):
    """Decide whether a turn is something worth keeping as a memory.

    Returns ``(is_candidate, substantial)``. ``substantial`` says whether the
    statement is complete enough to offer to save straight away, or whether
    Aria should gently ask for one more detail first.
    """
    text = (message or "").strip()
    if len(text.split()) < 3:
        return False, False

    understanding = understanding or {}
    intent = (understanding.get("intent") or "").strip().lower()

    # Never turn a passing comment into a memory test.
    if intent in ("greeting", "small talk"):
        return False, False

    # A question is never a new memory, even if the intent label is vague.
    # ("Do you remember my granddaughter's name?" must not create a memory.)
    if _looks_like_question(text) or "?" in text:
        return False, False

    if intent == "asking a question":
        return False, False
    if intent in ("sharing a memory", "sharing a fact", "logging a memory"):
        return True, _substantial(text, understanding)

    # The understanding pass explicitly judged this worth keeping. This is the
    # most reliable signal: it can recognise a personal fact even when the
    # intent label is approximate.
    if understanding.get("memorable"):
        return True, _substantial(text, understanding)

    # ``needs_memory`` only says the context overlaps — it does not mean the
    # person has shared something new. A bare feeling or a report of memory
    # difficulty must not be turned into a memory by the shape fallbacks
    # below (for example, the word "today" in "I feel lonely today").
    if intent in ("sharing a feeling", "reporting difficulty"):
        return False, False

    lowered = text.lower()
    if re.search(
        r"\b(?:appointment|visit|tablet|medication|takes? my|prescription)\b",
        lowered,
    ) or _HAS_WHEN.search(text):
        return True, _substantial(text, understanding)
    if re.search(r"\bi\s+(?:live|used to live|am going|will|always|usually|often)\b", lowered):
        return True, _substantial(text, understanding)
    if re.search(r"\bmy\s+[a-z]+\s+(?:is|was)\b", lowered):
        return True, _substantial(text, understanding)
    return False, False


def classify(message, understanding):
    """Turn a classification into the turn kind the companion acts on."""
    candidate, substantial = is_memory_candidate(message, understanding)
    if not candidate:
        return "conversation", None
    return ("confirm" if substantial else "clarify"), {
        "content": (message or "").strip(),
        "substantial": substantial,
        # A clarification is not an offer to save — it is context Aria can
        # merge into the next answer (see chat_companion._log_memory_turn).
        "clarify": not substantial,
    }


# ──────────────────────────────────────────────────────────────────────
# Drafting
# ──────────────────────────────────────────────────────────────────────
def _pick_category_name(text, categories):
    """Choose one of the *existing* categories for a piece of text.

    Categories are never invented: the matcher only ever returns a name that
    is already in the ``memorycategories`` table, with "Names" / "Tasks" as
    the safe general-purpose fallbacks.
    """
    names = {c.categoryname.lower(): c.categoryname for c in categories}
    if not names:
        return None

    lowered = (text or "").lower()
    best_name = None
    best_score = 0
    for key, hints in MEMORY_CATEGORY_HINTS.items():
        actual = names.get(key)
        if not actual:
            continue
        score = 0
        for hint in hints:
            if re.search(rf"\b{re.escape(hint)}\b", lowered):
                score += 1
        if score > best_score:
            best_score = score
            best_name = actual

    if best_name:
        return best_name
    if "names" in names:
        # "Is about a person" is the most common case, so it is the default.
        if re.search(r"\bmy\s+[a-z]+", lowered):
            return names["names"]
        return names["names"]
    return next(iter(names.values()))


def _fallback_draft(content):
    """Deterministic draft used when the model is unavailable.

    It only ever restates what the user said, so it cannot invent a fact.
    """
    content = re.sub(r"\s+", " ", (content or "").strip()).strip(" .")
    words = content.split()
    if len(words) > 24:
        content = " ".join(words[:24]).rstrip(",;:") + "…"
    if content:
        content = content[0].upper() + content[1:]
    if content and content[-1] not in ".!?":
        content += "."
    return content


def build_draft(user, message, understanding=None, categories=None):
    """Propose a memory entry (category + clean content) without saving it.

    Returns a dict with ``categoryid``, ``category``, ``content``,
    ``contextnote``, ``confidence`` and ``generatedbyai``. This is a *draft*
    shown to the user for confirmation — it is never persisted here.
    """
    from services.ai import understanding as understanding_mod
    from services.ai.client import call_llm_json, llm_configured

    message = (message or "").strip()
    if categories is None:
        from models import MemoryCategory

        categories = MemoryCategory.query.order_by(MemoryCategory.categoryid).all()

    allowed = {c.categoryname.lower(): c.categoryname for c in categories}
    category_name = None
    content = None
    context_note = None
    confidence = 0.6
    generated = False

    if llm_configured():
        catalogue = ", ".join(c.categoryname for c in categories)
        prompt = (
            f"Category options (choose exactly one): {catalogue}\n"
            f"What the person said: {message}\n"
            f"What we understood: {understanding_mod.understanding_block(understanding)}"
        )
        result = call_llm_json(
            DRAFT_SYSTEM_PROMPT,
            prompt,
            tier="fast",
            max_tokens=400,
            default=None,
        )
        if isinstance(result, dict):
            proposed = (result.get("category") or "").strip()
            if proposed.lower() in allowed:
                category_name = allowed[proposed.lower()]
            elif _pick_category_name(message, categories):
                # Model returned something outside the catalogue — fall back
                # to the deterministic matcher rather than inventing a row.
                category_name = _pick_category_name(message, categories)
            content = (result.get("content") or "").strip() or None
            context_note = (result.get("contextnote") or "").strip() or None
            try:
                confidence = float(result.get("confidence") or 0.6)
            except (TypeError, ValueError):
                confidence = 0.6
            generated = bool(content)

    if not category_name:
        category_name = _pick_category_name(message, categories)
    if not content:
        content = _fallback_draft(message)

    category = next(
        (c for c in categories if c.categoryname == category_name), None
    )
    return {
        "categoryid": category.categoryid if category else None,
        "category": category_name,
        "content": content,
        "contextnote": context_note or CHAT_SOURCE,
        "confidence": max(0.0, min(1.0, confidence)),
        "generatedbyai": generated,
    }


DRAFT_SYSTEM_PROMPT = (
    "You tidy one thing a person told their memory companion into a single "
    "memory they could be asked to recall later. Return ONLY a JSON object, "
    "no prose, no markdown fence:\n"
    "{\n"
    "  \"category\": \"one of the category options given to you, spelled exactly\",\n"
    "  \"content\": \"one clear sentence, in their voice, that stands on its own\",\n"
    "  \"contextnote\": \"a short extra detail, or an empty string\",\n"
    "  \"confidence\": 0.0\n"
    "}\n"
    "Rules:\n"
    "1. Use ONLY what they actually said. Never add a name, date, place or "
    "detail that was not in their words.\n"
    "2. Keep dates and times exactly as they were given.\n"
    "3. The category MUST be one of the options supplied. Do not invent one.\n"
    "4. Write the content as a short, complete sentence, in the first person, "
    "the way they would say it.\n"
    "5. If what they said is too vague to stand alone, still return your best "
    "single sentence — the person will confirm or correct it."
)


# ──────────────────────────────────────────────────────────────────────
# Confirmation handling
# ──────────────────────────────────────────────────────────────────────
CONFIRM_REPLY = re.compile(
    r"^\s*(?:yes|yeah|yep|yup|ok|okay|sure|please do|go ahead|that'?s right|"
    r"correct|right|perfect|save it|save that|add it|do it|yes please|"
    r"that'?s it|exactly|please)\b",
    re.I,
)
DENY_REPLY = re.compile(
    r"^\s*(?:no|nope|nah|don'?t|do not|stop|not now|leave it|forget it|"
    r"that'?s wrong|wrong|cancel|never mind|nevermind)\b",
    re.I,
)
CORRECTION_REPLY = re.compile(
    r"^\s*(?:no,?\s*|actually,?\s*|not quite,?\s*|correction[:,]?\s*)"
    r"(?:it'?s|its|it is|i|my|we|they|she|he)\b",
    re.I,
)


def is_confirmation(message):
    """True/False when the message answers the save confirmation, else None."""
    text = (message or "").strip()
    if not text:
        return None
    # A correction is neither a yes nor a no — it replaces the draft.
    if CORRECTION_REPLY.match(text):
        return None
    if CONFIRM_REPLY.match(text):
        return True
    if DENY_REPLY.match(text):
        return False
    return None


# ──────────────────────────────────────────────────────────────────────
# Saving (the single write path)
# ──────────────────────────────────────────────────────────────────────
def save_confirmed_memory(user, draft):
    """Create the real memory, its question and its schedule, then verify.

    This is the only function that writes a conversational memory, and it
    deliberately reuses the same helpers as ``POST /api/memories`` so a
    memory logged through chat is indistinguishable — to recall, to
    analytics and to retrieval — from one logged through the form.

    Returns ``(memory_dict, question_dict)`` only once the row has been
    committed and re-read from the database, so the caller is never able to
    claim a save that did not happen.
    """
    from datetime import date, timedelta

    from models import (
        MemoryCategory,
        MemoryEntry,
        RecallQuestion,
        ReviewSchedule,
        db,
    )
    from services import streaks
    from services.ai import memory_store
    from services.ai.facts import extract_facts
    from services.ai.question_generator import generate_question

    content = (draft.get("content") or "").strip()
    if not content:
        return None, None

    category = MemoryCategory.query.get(draft.get("categoryid"))
    if not category:
        return None, None

    context_note = (draft.get("contextnote") or CHAT_SOURCE).strip() or None

    entry = MemoryEntry(
        userid=user.userid,
        categoryid=category.categoryid,
        content=content,
        contextnote=context_note,
    )
    db.session.add(entry)
    db.session.flush()

    memory_store.index_memory(user, entry)

    question_text, by_ai = generate_question(
        content, category.categoryname, context_note, difficulty=1
    )
    question = RecallQuestion(
        memoryid=entry.memoryid,
        questiontext=question_text,
        answerkey=content,
        difficultylevel=1,
        generatedbyai=by_ai,
    )
    schedule = ReviewSchedule(
        memoryid=entry.memoryid,
        nextreviewdate=date.today() + timedelta(days=1),
        interval=1,
        repetition=0,
        easefactor=2.5,
    )
    db.session.add(question)
    db.session.add(schedule)
    streaks.record_activity(user)
    db.session.commit()

    # Learn the durable facts the memory reveals (a separate commit so a fact
    # pass error can never roll the memory itself back).
    try:
        extract_facts(
            user, " ".join(filter(None, [content, context_note])), source="memory"
        )
    except Exception as exc:  # pragma: no cover - never block saving a memory
        print(f"[MemorAid] Fact extraction from a chat memory failed: {exc}")

    # Re-read from the database: the confirmation the user sees is only
    # produced once the row is provably there.
    stored = MemoryEntry.query.filter_by(
        memoryid=entry.memoryid, userid=user.userid
    ).first()
    if not stored:
        return None, None
    return stored.to_dict(with_question=True), question.to_dict()


def draft_summary(draft):
    """The short, plain description Aria reads back before saving."""
    return (draft or {}).get("content") or ""


def categories_available():
    """True when the category table has been seeded (it always is at boot)."""
    from models import MemoryCategory

    return MemoryCategory.query.first() is not None


__all__ = [
    "CHAT_SOURCE",
    "build_draft",
    "categories_available",
    "classify",
    "draft_summary",
    "is_confirmation",
    "is_memory_candidate",
    "save_confirmed_memory",
]
