"""
AI chat companion — FR-09, FR-10, FR-11.

Personalisation: responses are built from the user's memory history,
recall performance and confirmed behaviour patterns (context pack in
client.py). Tone adapts to the age group.

Pattern Confidence safety rules (section 1.7) are enforced in the system
prompt: the AI must NEVER assert that an event occurred; patterns are
offered only as possibilities pending the user's confirmation.
"""
import re

from models import ChatMessage, db
from services import pattern_confidence
from services.ai.client import build_context_pack, call_claude

SYSTEM_TEMPLATE = (
    "You are Aria, the friendly memory companion inside MemorAid, a memory "
    "support tool for elderly users.\n"
    "Tone: {tone}\n"
    "Safety rules — these override everything else:\n"
    "1. You must NEVER state that something happened as a fact. When you "
    "reference the user's past patterns, phrase them as possibilities: "
    "\"it looks like you usually..., but I can't be certain — is that right?\"\n"
    "2. Never give medical advice or diagnose anything.\n"
    "3. Keep replies short (2-4 sentences), warm and simple.\n"
    "4. If the user confirms or denies something you offered as a pattern, "
    "thank them and remember the correction.\n"
    "Context about the user:\n{context}"
)

AGE_TONES = {
    "51-65": "warm and conversational, with a natural pace — the user is likely active and independent.",
    "above-65": "extra warm, patient and simple; short sentences, one idea at a time, like a kind friend speaking slowly.",
}

CONFIRM_WORDS = re.compile(r"\b(yes|yeah|yep|correct|right|that's right|indeed|true|affirmative)\b", re.I)
DENY_WORDS = re.compile(r"\b(no|nope|not really|incorrect|wrong|never)\b", re.I)

FALLBACK_REPLIES = [
    "Thank you for telling me that. I've made a note of it — how has your day been so far?",
    "I hear you. Would you like to talk about one of your memories, or shall I suggest a short memory exercise?",
    "That sounds important. Would you like to tell me more about it?",
]


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


def handle_message(user, message):
    """Process a chat turn. Returns (reply_text, pattern_event)."""
    message = (message or "").strip()
    if not message:
        return "Could you say that again, please?", None

    # Persist the user's message
    db.session.add(ChatMessage(userid=user.userid, role="user", messagetext=message))

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

    context = build_context_pack(user)
    tone = AGE_TONES.get(user.agegroup, AGE_TONES["above-65"])
    system = SYSTEM_TEMPLATE.format(tone=tone, context=context)

    history = (
        ChatMessage.query.filter_by(userid=user.userid)
        .order_by(ChatMessage.createdat.desc()).limit(6).all()
    )
    turns = "\n".join(
        f"{m.role}: {m.messagetext}" for m in reversed(history)
    )
    prompt = f"Recent conversation:\n{turns}\n\nUser: {message}\nAria:"

    reply = call_claude(system, prompt, max_tokens=300)
    if not reply:
        if pattern_event and pattern_event["type"] == "confirmed":
            reply = "Thank you for confirming — I'll keep that in mind. Is there anything else you'd like to talk about?"
        else:
            reply = FALLBACK_REPLIES[len(message) % len(FALLBACK_REPLIES)]

    db.session.add(ChatMessage(userid=user.userid, role="assistant", messagetext=reply))
    db.session.commit()
    return reply, pattern_event
