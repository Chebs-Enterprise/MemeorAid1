"""
Understanding pass — what the user actually said, before answering.

A single call straight from "message" to "reply" is what makes assistants
generic: the model answers the words on the surface and ignores what the
person is really doing. This module adds one cheap pass in front of the
reply that works out the *intent*, the *emotion*, the *entities* and
whether the person is talking about something the companion already knows
about.

The result is used three ways:
  * the reply is written in light of the understanding
  * the UI can show what the companion picked up ("you seemed worried")
  * the fact extractor knows which part of the message to look at

It runs on the fast model, so it costs a fraction of the reply itself.
"""
from config import Config
from services.ai.client import call_llm_json, llm_configured
from services.ai.mock import mock_understand

UNDERSTANDING_SYSTEM_PROMPT = (
    "You are the understanding layer of Aria, a memory companion for older "
    "adults whose memory is changing. Read the person's message and any "
    "context about them, then return ONLY a JSON object (no prose, no "
    "markdown fence):\n"
    "{\n"
    "  \"intent\": \"greeting | sharing a memory | sharing a fact | "
    "sharing a feeling | asking a question | reporting difficulty | small talk\",\n"
    "  \"emotion\": \"one short word, e.g. calm, happy, worried, tired, confused\",\n"
    "  \"topics\": [\"up to 3 short topics\"],\n"
    "  \"entities\": [\"names, places, relationships mentioned\"],\n"
    "  \"memorable\": true,\n"
    "  \"memory_note\": \"if memorable, one short sentence of what is worth keeping\",\n"
    "  \"needs_memory\": true,\n"
    "  \"suggested_action\": \"one short instruction to the responder\",\n"
    "  \"followup_question\": \"one warm question that would invite them to say more\"\n"
    "}\n"
    "Set \"memorable\" to true whenever they tell you something about "
    "themselves that would be worth keeping as a memory: a person, a "
    "relationship, an appointment, a routine, a preference, a place, or a "
    "story about their life. Be generous — this is the main way a memory gets "
    "saved. Set it to false for greetings, questions, pure feelings with no "
    "personal detail, and everyday small talk.\n"
    "Set \"needs_memory\" to true when the context already contains something "
    "that matches what they are talking about, and name it in topics.\n"
    "Be concrete. Never diagnose, never guess at medical conditions, never "
    "invent facts about the person."
)

DEFAULT_UNDERSTANDING = {
    "intent": "small talk",
    "emotion": "calm",
    "topics": [],
    "entities": [],
    "memorable": False,
    "memory_note": "",
    "needs_memory": False,
    "suggested_action": "listen and ask one gentle question",
    "followup_question": "Is there something particular you would like to talk about?",
}


def understand(user, message, context_block="", memories=None, facts=None):
    """Work out what the user means. Always returns a usable dict."""
    message = (message or "").strip()
    if not message:
        return dict(DEFAULT_UNDERSTANDING)

    if not llm_configured():
        if not getattr(Config, "AI_MOCK_MODE", False):
            return dict(DEFAULT_UNDERSTANDING)
        return mock_understand(message, memories=memories, facts=facts)

    prompt = (
        f"Context about the user:\n{context_block}\n\n"
        f"User message: {message}"
    )
    result = call_llm_json(
        UNDERSTANDING_SYSTEM_PROMPT,
        prompt,
        tier="fast",
        max_tokens=500,
        default=None,
    )
    if not isinstance(result, dict):
        return dict(DEFAULT_UNDERSTANDING)

    understanding = dict(DEFAULT_UNDERSTANDING)
    understanding.update({k: v for k, v in result.items() if k in DEFAULT_UNDERSTANDING})
    return understanding


def understanding_block(understanding):
    """Compact rendering of the understanding for the reply prompt."""
    if not understanding:
        return ""
    topics = ", ".join(understanding.get("topics") or [])
    entities = ", ".join(understanding.get("entities") or [])
    lines = [
        f"Intent: {understanding.get('intent', 'small talk')}",
        f"Emotion: {understanding.get('emotion', 'calm')}",
    ]
    if topics:
        lines.append(f"Topics: {topics}")
    if entities:
        lines.append(f"People/places mentioned: {entities}")
    if understanding.get("memorable") and understanding.get("memory_note"):
        lines.append(
            f"Worth remembering: {understanding['memory_note']}"
        )
    if understanding.get("needs_memory"):
        lines.append(
            "This connects to something they have already told you — ground the "
            "reply in that specific detail."
        )
    if understanding.get("followup_question"):
        lines.append(
            f"A question that would invite them to say more: "
            f"\"{understanding['followup_question']}\""
        )
    return "\n".join(lines)
