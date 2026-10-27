"""
AI chat companion — FR-09, FR-10, FR-11.

This is the part of MemorAid users spend the most time with, so it is built
around one goal: the reply must be about *this* person, not about a
generic elderly user.

How a reply is produced
-----------------------
    1. the message is stored, and any behaviour pattern is confirmed/denied
    2. the user's memories, durable facts and past conversation are
       *retrieved* against the message (services/ai/memory_store.py)
    3. a cheap "understanding" pass works out the intent and the emotion
       (services/ai/understanding.py)
    4. a context pack is assembled from all of it (services/ai/context.py)
    5. a grounded persona prompt is sent together with the real multi-turn
       conversation, so Gemini replies with the user's own details in it
    6. durable facts are extracted from what was said and stored for later
       (services/ai/facts.py)

Pattern Confidence safety rules (section 1.7) are enforced in the system
prompt: the AI must NEVER assert that an event occurred; patterns are
offered only as possibilities pending the user's confirmation.
"""
import json
import re

from config import Config
from models import ChatMessage, db
from services import pattern_confidence
from services.ai import facts as fact_store
from services.ai import memory_logging
from services.ai import memory_store
from services.ai.client import call_llm, stream_llm
from services.ai.context import build_context_pack
from services.ai.understanding import understand, understanding_block

PERSONA = (
    "You are Aria, the memory companion at the heart of MemorAid.\n"
    "MemorAid is not a general-purpose assistant. It is a gentle companion for "
    "older adults whose memory is changing, and you are the part they talk to. "
    "Your purpose is to help {name} feel known, keep hold of the people and "
    "routines that matter to them, and gently keep their memory active. You are "
    "not here to answer questions like a search engine.\n"
    "Tone: {tone}\n"
    "\n"
    "Who you are talking to:\n"
    "- Someone who may repeat themselves, lose the thread, or feel embarrassed "
    "about forgetting. Never point out a repetition. Never correct them "
    "sharply. Never sound hurried or patronising.\n"
    "- A capable adult. Be warm, respectful and patient. No baby talk.\n"
    "\n"
    "How to speak:\n"
    "1. Use short, plain sentences — usually 2 to 4. One idea at a time. No "
    "lists, headings, emoji, markdown or long explanations.\n"
    "2. Choose everyday words. Avoid jargon, idioms and abbreviations.\n"
    "3. Ask at most one question per reply, and make it gentle and specific.\n"
    "4. Use their name sometimes, not in every sentence.\n"
    "5. Do not begin every reply the same way. Avoid stock phrases such as "
    "\"Thank you for telling me that\" and \"I understand how you feel\".\n"
    "\n"
    "Being a memory companion — this matters more than anything else:\n"
    "1. Answer what they actually said first. For a greeting, everyday small "
    "talk, or a question about you, just respond warmly and naturally. Do not "
    "bring up a memory or fact unless they raised it or it genuinely helps. "
    "Memories support the conversation — they are never the centre of it.\n"
    "2. Ground what you say in the context below. When they mention a person, "
    "place, routine or date that you know, bring it back by name.\n"
    "3. Never invent a fact, a name, a date or a memory. If you are unsure, say "
    "so simply and ask. \"I'm not sure — will you remind me?\" is always better "
    "than a guess.\n"
    "4. When they share something worth remembering about themselves — a "
    "person, an appointment, a routine, a preference, a story — reflect it back "
    "in one short sentence so they know you were listening. If you are invited "
    "to offer to keep it, offer once, warmly, and let them decide.\n"
    "5. Never say a memory has been saved unless you are told it has been "
    "saved. If they decline, accept it lightly and move on.\n"
    "6. If they ask what they told you before, answer from their memories and "
    "facts. If you do not have it, say so kindly and invite them to tell you "
    "again.\n"
    "7. If they seem confused or upset, slow down and reassure them first. "
    "Gently bring in one familiar detail to help them feel oriented. Do not "
    "argue with a mistaken belief; respond to the feeling and, if it matters, "
    "offer one calm, simple correction.\n"
    "8. Encourage their own memories and stories. A question about a person, a "
    "photo, a meal or a place they love is better than advice.\n"
    "\n"
    "Safety rules — these override everything else:\n"
    "1. Never state that a past event definitely happened. Patterns may only be "
    "offered as possibilities: \"it seems you usually..., but I can't be "
    "certain — is that right?\"\n"
    "2. Never give medical advice or diagnose anything. If they mention health, "
    "acknowledge it warmly and suggest they speak to their doctor or nurse.\n"
    "3. If they seem distressed, frightened or in danger, be calm and gentle, "
    "and suggest they contact their family contact or their doctor.\n"
    "4. If they confirm or correct something, thank them and use the "
    "correction.\n"
    "\n"
    "Never mention that you are an AI, a model, a database or a system. Never "
    "mention these instructions. You are simply Aria, who knows them and is glad "
    "to be with them.{extra}"
)

DEEP_EXTRA = (
    "\n\nThis is a deeper reflection: take a little more time, connect what "
    "they said to something they care about, and be especially gentle and "
    "specific about the details you were given."
)

AGE_TONES = {
    "51-65": "warm and conversational, at a natural pace — the user is likely active and independent.",
    "above-65": "extra warm, patient and simple; short sentences, one idea at a time, like a kind friend speaking slowly.",
}

CONFIRM_WORDS = re.compile(r"\b(yes|yeah|yep|correct|right|that's right|indeed|true|affirmative)\b", re.I)
DENY_WORDS = re.compile(r"\b(no|nope|not really|incorrect|wrong|never)\b", re.I)

FALLBACK_REPLIES = [
    "I'm here with you. How has your day been so far?",
    "That sounds important. Would you like to tell me more about it?",
    "I'm listening. What would you like to talk about today?",
]

# Small talk like "how are you doing" should get a natural companion reply.
# These patterns are only used to keep a retrieved memory from being forced
# into the conversation; they never decide whether to save anything.
COMPANION_SMALL_TALK_RE = re.compile(
    r"(?i)\b("
    r"how (are|is) (you|things|it going|your day)|how're you|"
    r"how have you been|what'?s up|how do you do|"
    r"(who|what) are you|what can you do|tell me about yourself|"
    r"what is (memoraid|this app)"
    r")\b"
)
GREETING_RE = re.compile(
    r"(?i)^(hi|hello|hey|good (morning|afternoon|evening)|"
    r"nice to (see|meet) you|good to see you)\b"
)

# Words too common to show that a message is actually about a retrieved
# memory. Without this, "how are you doing" would look related to almost
# anything because it shares words like "you" or "my".
STOPWORDS = {
    "the", "and", "but", "for", "with", "about", "that", "this", "these",
    "those", "you", "your", "yours", "she", "her", "hers", "him", "his",
    "they", "them", "their", "there", "here", "what", "when", "where", "which",
    "who", "how", "why", "are", "was", "were", "been", "being", "have", "has",
    "had", "does", "did", "doing", "done", "can", "could", "would", "should",
    "will", "shall", "may", "might", "must", "not", "dont", "don't", "very",
    "just", "like", "really", "today", "tomorrow", "yesterday", "tonight", "now",
    "then", "from", "into", "out",
    "all", "any", "some", "one", "two", "get", "got", "tell", "said", "say",
    "know", "think", "feel", "feeling", "going", "good", "well", "much",
}

# Gratitude and acknowledgement are the end of a turn, not an invitation to
# revisit the thing that was just said.
THANKS_RE = re.compile(
    r"(?i)\b(thanks|thank you|thankyou|cheers|appreciate (it|that))\b"
)
ACK_RE = re.compile(
    r"(?i)^\s*(it'?s|it is|that'?s|that is|its)?\s*(ok|okay|fine|alright|all right)\b"
)
REMIND_RE = re.compile(
    r"(?i)\b(remind|reminder|"
    r"what (am i|should i|do i need to|do i have to) (meant )?(to )?do|"
    r"what'?s (on|happening) tomorrow|what do i have (on )?tomorrow)\b"
)
REMIND_REQUEST_RE = re.compile(
    r"(?i)\b(remind me|"
    r"what (am i|should i|do i need to|do i have to) (meant )?(to )?do|"
    r"what'?s (on|happening) tomorrow|what do i have (on )?tomorrow)\b"
)
RECALL_RE = re.compile(
    r"(?i)\b(what did (we|i)|do you remember|remember (what|when|who)|"
    r"we (talked|spoke|said)|told you|recall)\b"
)

# Instructions added to the persona so Aria *asks* to keep a memory instead of
# only answering. The reply itself is still generated normally; these lines
# just make the offered save sound like her rather than a system prompt.
SAVE_OFFER_EXTRA = (
    "\n\nThe person has just told you something about themselves that is "
    "worth remembering. Warmly offer to keep it as a memory they can be "
    "asked to recall later, reading back the one-line summary you were "
    "given below in their own words. Keep it short and natural, make it "
    "clear the choice is theirs, and let them answer with a simple yes or "
    "no. Do not say it has already been saved."
)

SAVE_CLARIFY_EXTRA = (
    "\n\nThe person has started telling you something about themselves, but "
    "you do not yet have enough to keep as a memory. Ask one warm, specific "
    "question that would let them give you the detail that makes it "
    "memorable — a name, a place, a day. Do not mention saving it yet."
)

SAVE_DONE_EXTRA = (
    "\n\nThe memory has just been saved — the database confirmed it. "
    "Warmly confirm that you have kept it and that it will come back to "
    "them soon as a question to recall. Do not thank them for confirming, "
    "and do not ask another question about the same thing."
)

SAVE_CANCELLED_EXTRA = (
    "\n\nThe person has just decided NOT to keep the memory you offered. "
    "Accept that lightly and without asking again, then move the "
    "conversation on. Never imply that anything was saved."
)

# A memory Aria has offered to keep is stored *on her own turn* behind this
# marker, so the offer survives a reload or a server restart between the
# question and the answer. It is stripped everywhere the reply is read out —
# history, meta and the streamed text — so the user never sees it.
PENDING_MARKER = "\n\u2063memoraid-pending:"


def _heuristic_observe(user, message):
    """Silently observe patterns from what the user says (never asserted back)."""
    lowered = message.lower()
    if any(word in lowered for word in ("forgot", "couldn't remember", "can't remember", "did i")):
        pattern_confidence.observe_pattern(user, "expresses_memory_difficulty", {"note": message[:120]})
    if "glasses" in lowered or "keys" in lowered or "where did i put" in lowered:
        pattern_confidence.observe_pattern(user, "misplaces_items", {"items": lowered[:80]})
    if re.search(r"\b(medicat|tablet|pill|dosage|dose)\b", lowered):
        pattern_confidence.observe_pattern(user, "medication_focus", {})
    if re.search(r"\b(grandson|granddaughter|grandchild|my son|my daughter)\b", lowered):
        pattern_confidence.observe_pattern(user, "family_focus", {})
    if re.search(r"\b(appointment|doctor|clinic|hospital)\b", lowered):
        pattern_confidence.observe_pattern(user, "appointment_focus", {})


def _history_turns(user, limit=None):
    """The recent conversation as real multi-turn messages (oldest first)."""
    limit = limit or getattr(Config, "CHAT_HISTORY_TURNS", 20)
    rows = (
        ChatMessage.query.filter_by(userid=user.userid)
        .order_by(ChatMessage.createdat.desc()).limit(limit * 2).all()
    )
    rows.reverse()
    turns = []
    for row in rows:
        role = "assistant" if row.role == "assistant" else "user"
        content = (row.messagetext or "").strip()
        if row.role == "assistant":
            content = _strip_pending(content).strip()
        if not content:
            continue
        turns.append({"role": role, "content": content})
    return turns


def _model_for_mode(mode):
    if mode == "deep":
        return getattr(Config, "GEMINI_MODEL_DEEP", "gemini-3.8-flash")
    return getattr(Config, "GEMINI_MODEL", "gemini-3.6-flash")


def _content_words(text):
    """Words that carry meaning, used only to judge topical overlap."""
    words = re.findall(r"[a-z0-9']+", (text or "").lower())
    return {word for word in words if len(word) > 2 and word not in STOPWORDS}


def _shares_topic(message, items, key):
    """True when the message and a retrieved item talk about the same thing."""
    said = _content_words(message)
    if not said:
        return False
    return any(_content_words(item.get(key)) & said for item in items or [])


def _context_overlap(message, memories, facts):
    return _shares_topic(message, memories, "content") or _shares_topic(
        message, facts, "facttext"
    )


def _past_overlap(message, past):
    """Relevant earlier turns, ignoring an exact replay of this message."""
    norm = " ".join((message or "").lower().split())
    kept = []
    for item in past or []:
        text = item.get("messagetext") or ""
        if " ".join(text.lower().split()) == norm:
            continue
        kept.append(item)
    said = _content_words(message)
    if not said:
        return []
    return [item for item in kept if _content_words(item.get("messagetext")) & said]


def _turn_uses_context(message, understanding, memories, facts, past=None):
    """Should this turn be answered with the retrieved memories and facts?

    Retrieval always returns *something* — including the newest memories —
    so this is the guard that stops a greeting from being turned into a
    memory recital. A memory is only offered when the person raised it, when
    the understanding pass says it connects, or when the words overlap.
    """
    past = past or []
    if not memories and not facts and not past:
        return False

    # "Thank you for the reminder" is gratitude, not a new reminder request.
    if _is_gratitude(message):
        return False

    # An explicit request to be reminded is exactly when a memory should be
    # used, even if the rest of the sentence looks like small talk.
    if REMIND_RE.search(message or ""):
        return bool(memories or facts)

    intent = (understanding.get("intent") or "").strip().lower()
    overlap = _context_overlap(message, memories, facts)
    if intent in ("greeting", "small talk"):
        # Small talk only uses context if it actually named the same thing
        # (e.g. "How did it go with Margaret?"), never just because a memory
        # happened to be retrieved.
        return overlap
    if COMPANION_SMALL_TALK_RE.search(message or "") or GREETING_RE.search(message or ""):
        return overlap
    if intent in ("sharing a feeling", "reporting difficulty"):
        # A feeling on its own should be met with warmth, not a memory. Only
        # bring context in when they actually mentioned the same subject.
        return overlap
    if RECALL_RE.search(message or ""):
        return bool(overlap or _past_overlap(message, past))
    return bool(understanding.get("needs_memory")) or overlap


def _filter_to_topic(message, items, key):
    """Keep only the retrieved items whose words the message actually uses."""
    said = _content_words(message)
    if not said:
        return []
    return [
        item for item in items or []
        if _content_words(item.get(key)) & said
    ]


def _keep_context_for_turn(message, understanding, memories, facts, past):
    """Trim retrieved context to what belongs in this turn."""
    if not _turn_uses_context(message, understanding, memories, facts, past):
        return [], [], []

    if REMIND_RE.search(message or ""):
        # Ranked retrieval already put the most likely reminder first. If the
        # request names the subject ("remind me about my birthday"), prefer
        # the item that shares that subject over the current top result.
        mem_overlap = _filter_to_topic(message, memories, "content")
        fact_overlap = _filter_to_topic(message, facts, "facttext")
        if mem_overlap or fact_overlap:
            return mem_overlap[:1], fact_overlap[:1], []
        return memories[:1], [], []

    overlap = (
        _context_overlap(message, memories, facts)
        or bool(_past_overlap(message, past))
    )
    if overlap:
        memories = _filter_to_topic(message, memories, "content")
        facts = _filter_to_topic(message, facts, "facttext")
        past = _past_overlap(message, past)
    else:
        # No shared words, but the understanding pass says this connects
        # ("tell me about my family" -> the granddaughter fact). Keep the
        # strongest few rather than everything retrieval happened to return.
        memories, facts, past = memories[:3], facts[:3], past[:2]
    return memories, facts, past


def _friend_name(prepared):
    name = (prepared.get("preferred_name") or "").strip()
    return name


def _is_gratitude(message):
    """A thank-you/acknowledgement, unless it also asks for something."""
    message = message or ""
    thanks = bool(THANKS_RE.search(message) or ACK_RE.search(message))
    return thanks and not REMIND_REQUEST_RE.search(message)


# ──────────────────────────────────────────────────────────────────────
# Conversational memory logging
# ──────────────────────────────────────────────────────────────────────
def _last_assistant_prompt(user):
    """The most recent assistant reply, used to recover an offered save.

    The pending draft is kept on the assistant turn itself, so the offer
    survives a server restart or a page reload between the question and the
    answer — nothing is held only in memory.
    """
    row = (
        ChatMessage.query.filter_by(userid=user.userid, role="assistant")
        .order_by(ChatMessage.createdat.desc())
        .first()
    )
    return row


def _decode_marker(row):
    """Return any pending draft/clarification stored on an assistant turn."""
    if not row or not row.messagetext:
        return None
    marker = row.messagetext.rfind(PENDING_MARKER)
    if marker == -1:
        return None
    raw = row.messagetext[marker + len(PENDING_MARKER):].strip()
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict) or not data.get("content"):
        return None
    return data


def _decode_pending(row):
    """Return a memory *offer* stored on an assistant turn, if there is one."""
    data = _decode_marker(row)
    if not data or data.get("clarify"):
        return None
    return data


def _decode_clarify(row):
    """Return a half-formed memory Aria asked for more detail about."""
    data = _decode_marker(row)
    if not data or not data.get("clarify"):
        return None
    return data


def _encode_with_pending(reply, draft):
    """Append the hidden pending-draft marker to an assistant reply."""
    return f"{reply}{PENDING_MARKER}{json.dumps(draft, ensure_ascii=False)}"


def _strip_pending(text):
    """Remove the marker from a stored reply before it is shown/streamed."""
    if not text:
        return text
    marker = text.rfind(PENDING_MARKER)
    return text[:marker].rstrip() if marker != -1 else text


# Public alias — the route layer needs the same stripping for stored history.
strip_pending = _strip_pending
decode_pending = _decode_pending


def _log_memory_turn(user, message, understanding=None):
    """Work out, and act on, what this turn means for memory logging.

    Returns ``(kind, draft, memory, question)`` where ``kind`` is one of
    ``conversation | clarify | confirm | logged | cancelled`` and ``memory``
    is only ever a dict once the row has been committed and re-read.
    """
    offer_row = _last_assistant_prompt(user)
    pending = _decode_pending(offer_row)
    clarify = _decode_clarify(offer_row)

    # 1. They are answering an offer Aria made on the previous turn.
    if pending:
        answer = memory_logging.is_confirmation(message)
        if answer is True:
            memory, question = memory_logging.save_confirmed_memory(user, pending)
            if memory:
                # The offer is spent — clear it so a reload cannot show a
                # second save card for a memory that already exists.
                offer_row.messagetext = _strip_pending(offer_row.messagetext)
                return "logged", pending, memory, question
            # The save failed: fall through and treat it as ordinary chat
            # rather than telling the user something that is not true.
            return "conversation", None, None, None
        if answer is False:
            offer_row.messagetext = _strip_pending(offer_row.messagetext)
            return "cancelled", pending, None, None

        # They said something else instead of answering (or corrected the
        # offer). Retire the old offer so it cannot be saved later by
        # accident; the new turn is classified on its own merits below.
        offer_row.messagetext = _strip_pending(offer_row.messagetext)
    elif clarify:
        # Aria asked for one more detail. Retire the marker now; its content
        # is merged into this turn below if the answer is still thin.
        offer_row.messagetext = _strip_pending(offer_row.messagetext)

    # 2. A fresh turn: understand it, then decide if it is worth keeping.
    #    The understanding pass has normally already been run for this turn
    #    (see _prepare) and is passed in, so no extra model call is made.
    if understanding is None:
        understanding = understand(user, message)
    kind, draft = memory_logging.classify(message, understanding)

    # 3. If they are answering a "tell me a little more" question, join the
    #    two halves together. Otherwise "my appointment" + "with Dr Patel on
    #    Tuesday" would be saved as the second half only, losing the point.
    clarify_text = (clarify or {}).get("content", "").strip()
    intent = (understanding.get("intent") or "").strip().lower()
    if (
        clarify_text
        and intent not in ("greeting", "small talk", "asking a question")
        and "?" not in message
    ):
        combined = f"{clarify_text} {message}".strip()
        combined_understanding = dict(understanding)
        combined_understanding["intent"] = "sharing a memory"
        combined_understanding["memorable"] = True
        kind, draft = memory_logging.classify(combined, combined_understanding)

    if kind == "confirm":
        draft = memory_logging.build_draft(
            user,
            (draft or {}).get("content") or message,
            understanding=understanding,
        )
    return kind or "conversation", draft, None, None


def _logging_extra(kind, draft, memory, question):
    """The extra prompt lines that steer this turn's reply."""
    if kind == "confirm" and draft:
        return (
            f"{SAVE_OFFER_EXTRA}\n\nThe one-line summary to read back: "
            f"\"{memory_logging.draft_summary(draft)}\" "
            f"(category: {draft.get('category')})"
        )
    if kind == "clarify":
        return SAVE_CLARIFY_EXTRA
    if kind == "logged" and memory:
        review = memory.get("nextreviewdate") or ""
        return (
            f"{SAVE_DONE_EXTRA}\n\nWhat was saved: \"{memory.get('content')}\" "
            f"(category: {memory.get('category')}). "
            f"The first recall is due: {review[:10] or 'tomorrow'}."
        )
    if kind == "cancelled":
        return SAVE_CANCELLED_EXTRA
    return ""


def _prepare(user, message, mode="standard"):
    """Everything that happens before the reply is generated.

    Returns a dict with the context pack, the prompt parts, the retrieved
    material and the understanding of the message.
    """
    pattern_event = None
    if CONFIRM_WORDS.search(message):
        last = pattern_confidence.get_context_patterns(user)
        if last:
            target = last[-1]
            pattern_confidence.confirm_pattern(user, target["pattern_type"])
            pattern_event = {"type": "confirmed", "pattern": target["pattern_type"]}
    elif DENY_WORDS.search(message):
        pattern_event = {"type": "denied"}

    _heuristic_observe(user, message)

    # ── Retrieve what is relevant to THIS message ──────────────────────
    memories = memory_store.retrieve_memories(user, message)
    known_facts = memory_store.retrieve_facts(user, message)
    past = memory_store.retrieve_chat(user, message)

    # ── Understand what the user actually said ─────────────────────────
    # Give the understanding pass the same retrieved material the reply will
    # get, so it can tell whether this connects to something already known
    # (and therefore deserves careful, grounded handling).
    understanding_context = [f"Name: {user.fullname}."]
    understanding_context.extend(
        f"- {fact.get('facttext')}" for fact in known_facts[:6]
    )
    understanding_context.extend(
        f"- [{memory.get('category') or 'Memory'}] {memory.get('content')}"
        for memory in memories[:6]
    )
    understanding = understand(
        user,
        message,
        context_block="\n".join(understanding_context),
        memories=memories,
        facts=known_facts,
    )

    # ── Only keep context this turn is actually about ───────────────────
    # Retrieval always returns something, so without this guard small talk
    # ("how are you doing") would be answered with a memory recital.
    memories, known_facts, past = _keep_context_for_turn(
        message, understanding, memories, known_facts, past
    )

    # ── Is this turn a memory worth keeping? ───────────────────────────
    # The understanding pass is reused here rather than re-run, so logging a
    # memory costs nothing extra in model calls.
    logging_kind, draft, saved_memory, saved_question = _log_memory_turn(
        user, message, understanding=understanding
    )

    # ── Assemble the context pack ───────────────────────────────────────
    context = build_context_pack(
        user, query=message, memories=memories, facts=known_facts, past=past
    )

    tone = AGE_TONES.get(user.agegroup, AGE_TONES["above-65"])
    extra = DEEP_EXTRA if mode == "deep" else ""
    full_name = (user.fullname or "").strip()
    preferred_name = full_name.split()[0] if full_name else "there"
    system = PERSONA.format(tone=tone, name=preferred_name, extra=extra)

    # The volatile part (what was retrieved for this message) sits in its
    # own system block, so the persona prefix stays cacheable.
    context_extra = (
        f"Context about the user:\n{context}\n\n"
        f"What I picked up from this message:\n{understanding_block(understanding)}"
    )
    logging_extra = _logging_extra(logging_kind, draft, saved_memory, saved_question)
    if logging_extra:
        context_extra += f"\n\n{logging_extra}"
    elif _is_gratitude(message):
        context_extra += (
            "\n\nThey are thanking you or closing the thought. Reply briefly "
            "and warmly. Do not bring up the memory again."
        )
    elif REMIND_RE.search(message):
        context_extra += (
            "\n\nThey are asking to be reminded. Tell them the relevant detail "
            "once, plainly, then stop. Do not ask them to tell you more about it."
        )

    # ── The real conversation, as multi-turn messages ───────────────────
    turns = _history_turns(user)
    last_reply = next(
        (turn["content"] for turn in reversed(turns) if turn["role"] == "assistant"),
        "",
    )
    turns.append({"role": "user", "content": message})

    return {
        "system": system,
        "system_extra": context_extra,
        "messages": turns,
        "message": message,
        "preferred_name": preferred_name,
        "last_reply": last_reply,
        "memories": memories,
        "facts": known_facts,
        "past": past,
        "understanding": understanding,
        "pattern_event": pattern_event,
        "model": _model_for_mode(mode),
        "mode": mode,
        "logging_kind": logging_kind,
        "draft": draft,
        "saved_memory": saved_memory,
        "saved_question": saved_question,
    }


def _second_person(text):
    """Turn a stored fact/memory into something Aria can say back."""
    text = (text or "").strip()
    text = re.sub(r"(?i)^the user's\s+", "your ", text)
    text = re.sub(r"(?i)^the user\s+has\s+", "you have ", text)
    text = re.sub(r"(?i)^the user\s+is\s+", "you are ", text)
    text = re.sub(r"(?i)^the user\s+", "you ", text)
    if text.startswith("My "):
        text = "your " + text[3:]
    elif text.startswith("I "):
        text = "you " + text[2:]
    return text.strip()


def _contextual_fallback(prepared, message):
    """Reply used when the AI provider is unavailable — warm, never generic.

    This path deliberately answers the person's actual message first. A
    retrieved memory is only mentioned when the turn was about it, so a
    greeting never turns into a recital of the newest memory.
    """
    kind = prepared.get("logging_kind")
    draft = prepared.get("draft") or {}
    saved = prepared.get("saved_memory")
    understanding = prepared.get("understanding") or {}
    intent = (understanding.get("intent") or "").strip().lower()
    emotion = (understanding.get("emotion") or "").strip().lower()
    name = _friend_name(prepared)
    memories = prepared.get("memories") or []
    facts = prepared.get("facts") or []

    # The memory-logging turn must stay coherent even without the model: an
    # offer is still an offer, a save is only mentioned once the row exists,
    # and a decline is accepted lightly.
    if kind == "logged" and saved:
        content = saved.get("content") or "it"
        return (
            f"That's saved. I'll keep \"{content}\" and bring it back to you "
            "soon as a question to recall."
        )
    if kind == "confirm" and draft:
        summary = memory_logging.draft_summary(draft) or "that"
        return (
            "I can keep that for you — shall I save "
            f"\"{summary}\" as a memory?"
        )
    if kind == "clarify":
        return (
            "That sounds important. Could you tell me a little more — a name, "
            "a place, or a day?"
        )
    if kind == "cancelled":
        return (
            "Of course — I won't keep that one. Just tell me if you'd like me "
            "to remember something another time."
        )

    # ── Gratitude and acknowledgement end the turn ─────────────────────
    if _is_gratitude(message):
        return f"You're welcome, {name}." if name else "You're welcome."

    # ── A request to be reminded ───────────────────────────────────────
    if REMIND_RE.search(message or ""):
        item = None
        if memories:
            item = memories[0].get("content")
        elif facts:
            item = facts[0].get("facttext")
        if item:
            line = _second_person(item).rstrip(".")
            if re.search(r"(?i)\bremind", message or ""):
                greeting = f"Of course, {name}." if name else "Of course."
                return (
                    f"{greeting} {line[0].upper() + line[1:]}. I can remind you "
                    "again whenever you like."
                )
            return (
                f"You told me {line[0].lower() + line[1:]}. I hope that helps."
            )
        return (
            "Of course. I don't have a note about that yet. Would you like to "
            "tell me, so I can keep it?"
        )

    # ── Greetings and small talk ───────────────────────────────────────
    has_context = bool(memories or facts)
    if not has_context and (intent == "greeting" or GREETING_RE.search(message or "")):
        greeting = f"Hello {name}." if name else "Hello."
        return f"{greeting} It's lovely to hear from you. How are you feeling today?"
    if not has_context and re.search(
        r"(?i)\b(how (are|is) (you|things|it going|your day)|how're you|"
        r"how have you been|what'?s up)\b",
        message or "",
    ):
        return (
            "I'm doing well, thank you for asking. It's good to be here with "
            "you. How are you feeling today?"
        )
    if not has_context and (
        intent in ("greeting", "small talk")
        or COMPANION_SMALL_TALK_RE.search(message or "")
    ):
        return (
            "I'm here with you. What would you like to talk about today?"
        )

    # A feeling on its own is met with warmth, not a memory.
    if intent in ("sharing a feeling", "reporting difficulty"):
        if emotion in ("sad", "lonely", "worried", "afraid", "scared", "tired"):
            return (
                "I'm here with you. That sounds like a lot to carry. Would you "
                "like to tell me a little about what is on your mind?"
            )
        return "I'm glad you told me how you are feeling. I'm here with you."

    # ── Only offer a memory when this turn was actually about it ───────
    if memories:
        content = (memories[0].get("content") or "").strip().rstrip(".")
        last_reply = (prepared.get("last_reply") or "").lower()
        if content and content.lower() in last_reply:
            # Do not repeat the same memory twice in a row; acknowledge that
            # the earlier answer still stands instead.
            return "I'm glad that helps. Is there anything else you'd like to check?"
        if content:
            return (
                f'I remember you told me: "{content}." Is there anything you '
                "would like to add to that?"
            )
    if facts:
        facttext = (facts[0].get("facttext") or "").strip().rstrip(".")
        if facttext:
            return (
                f'I remember this about you: "{facttext}." How has that been lately?'
            )

    if prepared.get("pattern_event", {}) and prepared["pattern_event"].get("type") == "confirmed":
        return "Thank you for confirming — I'll keep that in mind. Is there anything else you'd like to talk about?"
    return FALLBACK_REPLIES[len(message) % len(FALLBACK_REPLIES)]


def _store_turns(user, message, reply, prepared):
    """Persist the exchange, index it for retrieval and learn new facts.

    Returns ``(new_facts, user_messageid, assistant_messageid)``. The ids let
    the streamed reply tell the client which rows it can copy or delete
    immediately, before the conversation is reloaded.
    """
    user_msg = ChatMessage(userid=user.userid, role="user", messagetext=message)
    db.session.add(user_msg)
    db.session.flush()

    # An offered memory rides on Aria's own turn, so the offer is still there
    # after a reload — see PENDING_MARKER. The stripped text is what gets
    # indexed, so retrieval and the model never see the hidden marker.
    stored_reply = reply
    if prepared.get("logging_kind") in ("confirm", "clarify") and prepared.get("draft"):
        stored_reply = _encode_with_pending(reply, prepared["draft"])
    assistant_msg = ChatMessage(userid=user.userid, role="assistant", messagetext=stored_reply)
    db.session.add(assistant_msg)
    db.session.flush()

    memory_store.index_chat(user, user_msg)
    memory_store.index_chat(user, assistant_msg, text=_strip_pending(stored_reply))

    # Learn durable facts from what was just said.
    new_facts = []
    try:
        stored = fact_store.extract_facts(user, message, source="chat")
        new_facts = [f.to_dict() for f in stored]
    except Exception as exc:  # pragma: no cover - never break the chat
        print(f"[MemorAid] Fact extraction failed: {exc}")

    db.session.commit()
    return new_facts, user_msg.messageid, assistant_msg.messageid


def _used_in_reply(reply, items, key):
    """Only the retrieved items Aria actually drew on in this reply.

    Showing every retrieved fact under the reply is what made a small
    conversation feel like a memory dump. If the words of a memory or fact
    do not appear in the reply, it is not offered as "what Aria used".
    """
    if not reply:
        return []
    reply_words = _content_words(reply)
    if not reply_words:
        return []
    return [
        item for item in items or []
        if _content_words(item.get(key)) & reply_words
    ]


def _build_meta(prepared, new_facts=None, model=None, reply=None):
    """The payload the UI uses to show *why* the reply was personal."""
    memories = prepared.get("memories") or []
    facts = prepared.get("facts") or []
    kind = prepared.get("logging_kind") or "conversation"
    draft = prepared.get("draft")
    saved_memory = prepared.get("saved_memory")

    # Once the reply exists, narrow the chips to the material it used.
    if reply:
        memories = _used_in_reply(reply, memories, "content")
        facts = _used_in_reply(reply, facts, "facttext")

    meta = {
        "understanding": prepared.get("understanding") or {},
        "memories": [
            {
                "memoryid": m.get("memoryid"),
                "content": m.get("content"),
                "category": m.get("category"),
                "datecreated": m.get("datecreated"),
                "reasons": m.get("reasons") or [],
            }
            for m in memories[:4]
        ],
        "facts": [
            {
                "factid": f.get("factid"),
                "facttext": f.get("facttext"),
                "facttype": f.get("facttype"),
            }
            for f in facts[:4]
        ],
        "past": [
            {
                "messageid": p.get("messageid"),
                "role": p.get("role"),
                "messagetext": _strip_pending(p.get("messagetext") or ""),
                "createdat": p.get("createdat"),
            }
            for p in (prepared.get("past") or [])[:3]
        ],
        "new_facts": new_facts or [],
        "model": model or prepared.get("model"),
        "mode": prepared.get("mode", "standard"),
        # Conversational memory logging: "conversation" means this turn had
        # nothing to do with saving, so the UI shows no card at all.
        "logging": kind,
        "pending_memory": draft if kind == "confirm" else None,
        "saved_memory": saved_memory if kind == "logged" else None,
        "saved_question": prepared.get("saved_question") if kind == "logged" else None,
    }
    return meta


def handle_message(user, message, mode="standard"):
    """Process a chat turn. Returns (reply_text, pattern_event, meta)."""
    message = (message or "").strip()
    if not message:
        return "Could you say that again, please?", None, {}

    prepared = _prepare(user, message, mode=mode)

    reply = call_llm(
        prepared["system"],
        user_prompt=prepared["messages"][-1]["content"],
        max_tokens=400,
        model=prepared["model"],
        messages=prepared["messages"],
        cache_system=True,
        system_extra=prepared["system_extra"],
        mock_reply=True,
    )
    if not reply:
        reply = _contextual_fallback(prepared, message)

    reply = _strip_pending(reply).strip()
    new_facts, _, _ = _store_turns(user, message, reply, prepared)
    meta = _build_meta(prepared, new_facts, reply=reply)
    return reply, prepared["pattern_event"], meta


def stream_message(user, message, mode="standard"):
    """Generate a reply token by token.

    Yields events as dicts so the route can serialise them as SSE:
        {"event": "meta",   "data": {...}}
        {"event": "token",  "data": {"text": "..."}}
        {"event": "done",   "data": {"reply": "...", "meta": {...},
                                     "messageids": {"user": 1, "assistant": 2}}}
        {"event": "error",  "data": {"message": "..."}}
    """
    message = (message or "").strip()
    if not message:
        yield {
            "event": "done",
            "data": {
                "reply": "Could you say that again, please?",
                "meta": {},
            },
        }
        return

    prepared = _prepare(user, message, mode=mode)
    yield {"event": "meta", "data": _build_meta(prepared)}

    chunks = []
    generator = stream_llm(
        prepared["system"],
        prepared["messages"],
        max_tokens=400,
        model=prepared["model"],
        system_extra=prepared["system_extra"],
        mock_reply=True,
    )
    for chunk in generator:
        if not chunk:
            continue
        chunks.append(chunk)
        yield {"event": "token", "data": {"text": chunk}}

    reply = _strip_pending("".join(chunks)).strip()
    if not reply:
        reply = _contextual_fallback(prepared, message)
        yield {"event": "token", "data": {"text": reply}}

    message_ids = {"user": None, "assistant": None}
    try:
        new_facts, user_id, assistant_id = _store_turns(user, message, reply, prepared)
        message_ids = {"user": user_id, "assistant": assistant_id}
    except Exception as exc:  # pragma: no cover - never break the chat
        print(f"[MemorAid] Could not store the exchange: {exc}")
        new_facts = []

    yield {
        "event": "done",
        "data": {
            "reply": reply,
            "meta": _build_meta(prepared, new_facts, reply=reply),
            "pattern_event": prepared.get("pattern_event"),
            "messageids": message_ids,
        },
    }
