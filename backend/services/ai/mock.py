"""
Offline stand-ins for the two structured LLM passes.

When no GEMINI_API_KEY is configured the companion still has to work
(section 1.6: the app stays functional without the third-party API). The
mock mode runs the *whole* personalisation pipeline — retrieval, durable
facts, the understanding pass — with deterministic, rule-based stand-ins
for the model, so the behaviour can be developed and tested before a key
exists.

The rules are deliberately simple and predictable: they extract the kind of
statement a real model would extract, and they read the retrieved context
rather than inventing anything. Nothing here fabricates a fact.
"""
import re

FAMILY_WORDS = {
    "granddaughter", "grandson", "daughter", "son", "wife", "husband", "mother",
    "father", "mum", "mom", "mum", "dad", "sister", "brother", "aunt", "uncle",
    "cousin", "niece", "nephew", "friend", "neighbour", "neighbor", "dog", "cat",
    "grandchild", "godmother", "godfather", "partner",
}

DIFFICULTY_WORDS = (
    "forgot", "forget", "can't remember", "cannot remember", "couldn't remember",
    "memory", "blank", "confused", "mix up", "mixed up",
)

POSITIVE_WORDS = ("happy", "glad", "good", "lovely", "wonderful", "better", "great")
NEGATIVE_WORDS = ("sad", "lonely", "worried", "scared", "afraid", "upset", "tired")

GREETING_RE = re.compile(
    r"(?i)^(hi|hello|hey|good (morning|afternoon|evening)|"
    r"nice to (see|meet) you|good to see you)\b"
)
SMALL_TALK_RE = re.compile(
    r"(?i)\b(how (are|is) (you|things|it going|your day)|how're you|"
    r"how have you been|what'?s up|thank you|thanks)\b"
)


def _clean(text):
    return re.sub(r"\s+", " ", (text or "").strip()).strip(" .!?,;:")


def mock_extract_facts(text):
    """Rule-based fact extraction (the offline stand-in for the fast model)."""
    text = _clean(text)
    if not text:
        return []

    facts = []
    seen = set()

    def add(facttext, facttype, confidence=0.75):
        facttext = _clean(facttext)
        if not facttext or len(facttext) < 5:
            return
        key = facttext.lower()
        if key in seen:
            return
        seen.add(key)
        facts.append({
            "facttext": facttext,
            "facttype": facttype,
            "factkey": None,
            "confidence": confidence,
        })

    # "My daughter's name is Sarah"
    for match in re.finditer(
        r"(?i:\bmy\s+([a-z]+)'?s?\s+name\s+is\s+)([A-Z][\w'-]*(?:\s+[A-Z][\w'-]*)?)",
        text,
    ):
        relation, name = match.group(1).lower(), match.group(2).strip()
        add(f"My {relation} is called {name}.", "family" if relation in FAMILY_WORDS else "person", 0.85)

    # "my granddaughter is called Lily"
    for match in re.finditer(
        r"(?i:\bmy\s+([a-z]+)\s+is\s+(?:called|named)\s+)([A-Z][\w'-]*(?:\s+[A-Z][\w'-]*)?)",
        text,
    ):
        relation, name = match.group(1).lower(), match.group(2).strip()
        add(f"My {relation} is called {name}.", "family" if relation in FAMILY_WORDS else "person", 0.85)

    # "my husband John" / "my dog Baxter"
    for match in re.finditer(
        r"(?i:\bmy\s+([a-z]+)\s+)([A-Z][\w'-]*)\b", text
    ):
        relation, name = match.group(1).lower(), match.group(2)
        if relation in FAMILY_WORDS:
            add(f"My {relation} is {name}.", "family", 0.8)

    # "I live in Brighton" / "I go to church on Sundays"
    match = re.search(r"(?i:\bi\s+live\s+in\s+)([A-Z][\w' -]{2,30})", text)
    if match:
        add(f"I live in {match.group(1).strip()}.", "place", 0.8)

    match = re.search(r"(?i:\bi\s+(?:always|usually|often|regularly)\s+)([a-z]\w+(?:\s+\w+){0,3})", text)
    if match:
        add(f"I {match.group(1).strip()}.", "routine", 0.7)

    match = re.search(r"(?i:\bi\s+(like|love|prefer|enjoy|hate|dislike)\s+)([a-z]\w+(?:\s+\w+){0,3})", text)
    if match:
        verb = match.group(1).lower()
        verb = "like" if verb in ("like", "love", "prefer", "enjoy") else "dislike"
        add(f"I {verb} {match.group(2).strip()}.", "preference", 0.7)

    match = re.search(r"(?i:\bmy\s+([a-z]+)\s+(?:appointment|check-?up|visit|class)\s+(?:is|was)\s+)(.+)", text)
    if match:
        add(f"My {match.group(1).lower()} {match.group(2).strip()}.", "event", 0.7)

    return facts


def mock_understand(message, memories=None, facts=None):
    """Rule-based understanding pass (the offline stand-in for the fast model)."""
    raw = message or ""
    message = _clean(raw)
    lowered = message.lower()
    memories = memories or []
    facts = facts or []

    if not message:
        intent, emotion = "small talk", "calm"
    elif GREETING_RE.search(message):
        intent, emotion = "greeting", "calm"
    elif SMALL_TALK_RE.search(message):
        intent, emotion = "small talk", "calm"
    elif any(word in lowered for word in DIFFICULTY_WORDS):
        intent, emotion = "reporting difficulty", "worried"
    elif any(word in lowered for word in NEGATIVE_WORDS):
        intent, emotion = "sharing a feeling", "sad"
    elif any(word in lowered for word in POSITIVE_WORDS):
        intent, emotion = "sharing a feeling", "happy"
    elif "?" in raw:
        intent, emotion = "asking a question", "curious"
    else:
        intent, emotion = "sharing a memory", "calm"

    topics = []
    for memory in memories[:3]:
        category = memory.get("category")
        if category and category not in topics:
            topics.append(category)

    entities = []
    for fact in facts[:5]:
        for word in re.findall(r"\b([A-Z][\w'-]{2,})", fact.get("facttext", "")):
            if word.lower() not in {"my", "i", "the", "every", "sunday", "monday"} and word not in entities:
                entities.append(word)

    for word in re.findall(r"\b([A-Z][\w'-]{2,})", message):
        if word not in entities:
            entities.append(word)

    needs_memory = bool(memories or facts) and intent in {
        "sharing a memory", "asking a question", "reporting difficulty", "sharing a feeling"
    }
    # Offline stand-in for the model's "is this worth keeping?" judgement. A
    # whole statement about the person is memorable; a greeting, a question or
    # a bare feeling is not.
    memorable = intent == "sharing a memory" and len(message.split()) >= 3

    if intent == "greeting":
        followup = "How are you feeling today?"
    elif intent == "reporting difficulty":
        followup = "Would you like to tell me more about that?"
    elif needs_memory:
        followup = "Would you like to add that to your memories so we can revisit it?"
    else:
        followup = "Is there something particular you would like to talk about?"

    return {
        "intent": intent,
        "emotion": emotion,
        "topics": topics,
        "entities": entities[:6],
        "memorable": memorable,
        "memory_note": message if memorable else "",
        "needs_memory": needs_memory,
        "suggested_action": (
            "reference the user's own details" if needs_memory else "listen and ask one gentle question"
        ),
        "followup_question": followup,
    }
