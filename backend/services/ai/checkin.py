"""Morning check-in message generation — FR-14 (AI Service use case:
'Generate Morning Check-In Message', figure 3.1)."""
from datetime import date

from models import MemoryEntry, ReviewSchedule
from services.ai.client import call_claude

SYSTEM_PROMPT = (
    "You are Aria from MemorAid. Write a short, warm morning check-in "
    "message for an elderly user (maximum 3 sentences). Greet them by name, "
    "mention how many memories they have due for review today if any, and "
    "offer one gentle encouragement. Never mention technology or buttons."
)

FALLBACK = (
    "Good morning, {name}! I hope you slept well. "
    "{due_sentence} "
    "Whenever you are ready, we can look at today's memories together."
)


def generate_checkin_message(user):
    due_count = (
        ReviewSchedule.query.join(MemoryEntry, MemoryEntry.memoryid == ReviewSchedule.memoryid)
        .filter(MemoryEntry.userid == user.userid, MemoryEntry.status == "active")
        .filter(ReviewSchedule.nextreviewdate <= date.today())
        .count()
    )
    due_sentence = (
        f"You have {due_count} memories waiting for you today."
        if due_count
        else "Nothing is due for review today — a good day to try a memory exercise."
    )

    text = call_claude(
        SYSTEM_PROMPT,
        f"User name: {user.fullname}. {due_sentence} "
        f"Recall streak: {user.recall_streak or 0} day(s). "
        f"Exercise streak: {user.exercise_streak or 0} day(s).",
        max_tokens=120,
    )
    if not text:
        first = user.fullname.split()[0]
        text = FALLBACK.format(name=first, due_sentence=due_sentence)

    return {"message": text, "due_count": due_count}
