"""
AI recall question generation — FR-04, document of proof section 3.4.3.

Sequence (Figure 3.3): the backend builds a structured prompt containing
the memory content, category, context note and difficulty level, sends it
to Gemini, and stores the returned question linked 1:1 to the memory with
an initial ReviewSchedule for the following day.

If the Gemini API is unavailable a deterministic template generator is
used and the question is flagged generatedbyai = false.
"""
from services.ai.client import call_llm

SYSTEM_PROMPT = (
    "You are MemorAid, a warm memory-support assistant for elderly users. "
    "Generate ONE short, plain-language recall question from a memory the "
    "user has logged. The question must be answerable from the memory "
    "content alone, must not mention that it comes from a stored note, and "
    "must read naturally to someone aged 65+. "
    "Difficulty 1: a direct what/when/who question. "
    "Difficulty 2: requires connecting the detail with its context. "
    "Difficulty 3: asks why/how or requests an inference from partial "
    "information. "
    "Reply with the question text only — no preamble, no quotes."
)

CATEGORY_FALLBACKS = {
    "Names": {
        1: "Who is the person in this memory? Try to recall their name and how you know them.",
        2: "What is the name of the person in this memory, and what makes them important to you?",
        3: "If you met this person again, what would you say first? Recall their name and the story behind how you met.",
    },
    "Appointments": {
        1: "What appointment do you need to remember, and when does it take place?",
        2: "What appointment is coming up, where is it, and what do you need to bring?",
        3: "Why is this appointment important, and what would happen if you missed it? Recall the day and time as precisely as you can.",
    },
    "Tasks": {
        1: "What task did you need to remember? Say what it is and when it needs doing.",
        2: "What task needs to be done, what are the important details, and who is involved?",
        3: "Walk yourself through this task step by step — what comes first, and why does it matter?",
    },
    "Conversations": {
        1: "Who did you talk with recently, and what was the conversation about?",
        2: "What was discussed in this conversation, and what did you agree to do?",
        3: "What do you think the other person felt about that conversation, and what was the most important thing they said?",
    },
    "Medications": {
        1: "What medication do you need to take, and what is the schedule?",
        2: "What medication do you take, how much, and at what time of day?",
        3: "Why were you given this medication, and what should you do if you forget a dose?",
    },
}
DEFAULT_FALLBACK = {
    1: "What do you remember about this moment? Say as much as you can.",
    2: "What are the key details of this memory — who, where and when?",
    3: "Why does this memory matter to you? Recall as many connected details as you can.",
}


def generate_question(content, category_name, context_note=None, difficulty=1):
    """Return (question_text, generated_by_ai)."""
    difficulty = max(1, min(3, int(difficulty or 1)))

    prompt = (
        f"Category: {category_name}\n"
        f"Difficulty level: {difficulty}\n"
        f"Memory content: {content}\n"
    )
    if context_note:
        prompt += f"Additional context note: {context_note}\n"
    prompt += "Write the recall question now."

    question = call_llm(SYSTEM_PROMPT, prompt, max_tokens=150, tier="fast")
    if question:
        return question.splitlines()[0].strip(), True

    # Deterministic fallback: category-aware, difficulty-scaled template.
    by_difficulty = CATEGORY_FALLBACKS.get(category_name, DEFAULT_FALLBACK)
    return by_difficulty.get(difficulty, DEFAULT_FALLBACK[1]), False
