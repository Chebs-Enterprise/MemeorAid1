"""
Exercise sessions — FR-08, the six scientifically validated memory training
techniques from the document of proof (section 2.2.1):

  1. Method of Loci            (Bower, 1970)
  2. Elaborative Encoding      (Craik & Lockhart, 1972)
  3. Spaced Retrieval Training (Landauer & Bjork, 1978; Camp, 1989)
  4. Face-Name Association     (Bower & Karlin, 1974)
  5. Chunking                  (Miller, 1956)
  6. Active Observation        (Merzenich, 2013)

Exercises are selected adaptively: the user's weakest recall category
(lowest accuracy with >= 3 attempts) picks the target content, and the
least-recently-used technique is chosen for rotation. Gemini generates
step-by-step guidance; a deterministic template per technique is the
fallback.
"""
from datetime import datetime

from models import ExerciseSession
from services.ai.client import call_llm

TECHNIQUES = {
    "method_of_loci": {
        "name": "Method of Loci",
        "summary": (
            "Put each thing you want to remember in a different spot along a route you "
            "know well — like moving from your front door to your kitchen. "
            "To remember them, just walk that route in your mind."
        ),
        "steps": [
            "Pick a route you know well. For example, from your front door to your room.",
            "Take the items you want to remember one by one.",
            "Put each item in a different spot along that route. Make a funny picture in your mind to help you remember.",
            "Take a short break. Then walk that route in your mind again.",
            "As you pass each spot in your mind, say the item out loud.",
        ],
    },
    "elaborative_encoding": {
        "name": "Elaborative Encoding",
        "summary": (
            "Link what you want to remember to something you already know. "
            "It could be a person, a place, a story, or how you feel. "
            "This helps you remember better."
        ),
        "steps": [
            "Pick one thing you want to remember.",
            "Ask yourself: what does this remind me of?",
            "Link it to something from your life — a person, a place, or an event.",
            "Say that link out loud in one sentence.",
            "Take a short pause and say the link again.",
        ],
    },
    "spaced_retrieval": {
        "name": "Spaced Retrieval Training",
        "summary": (
            "Test yourself on the same thing a few times, with longer breaks each time. "
            "This helps you remember it better over time."
        ),
        "steps": [
            "Pick one thing to remember — like a name, a date, or an appointment.",
            "Say it from memory right away.",
            "Wait about 30 seconds, then say it again from memory.",
            "Wait about 2 minutes, then say it again from memory.",
            "Wait a bit more, then test yourself one last time.",
        ],
    },
    "face_name_association": {
        "name": "Face–Name Association",
        "summary": (
            "Link a person's name to one thing you notice about their face, "
            "like their smile or glasses. Make a quick picture in your mind to help you remember."
        ),
        "steps": [
            "Think clearly of the person's face.",
            "Pick one thing you notice — like their smile, glasses, or hair.",
            "Make a funny or clear picture linking that thing to their name.",
            "Say their name out loud as you picture it.",
            "Try to recall the name again after a short pause.",
        ],
    },
    "chunking": {
        "name": "Chunking",
        "summary": (
            "Split a long list into small groups of things that go together. "
            "It's easier to remember small groups than a long list."
        ),
        "steps": [
            "Look at the list you need to remember.",
            "Put the items into small groups of two or three that make sense together.",
            "Give each group a short name in your own words.",
            "Try to remember the group names first, then the items in each group.",
            "Say the groups back in order, then in a different order.",
        ],
    },
    "active_observation": {
        "name": "Active Observation",
        "summary": (
            "Look closely at something for a short time, then try to remember as much as you can. "
            "Do it again to catch what you missed."
        ),
        "steps": [
            "Pick something to look at — like a room, your street, or a picture.",
            "Look at it closely for about one minute. Pay attention to small details.",
            "Look away and say as much as you can remember.",
            "Look back and see what you missed.",
            "Try again to remember the things you missed.",
        ],
    },
}

TECHNIQUE_ORDER = list(TECHNIQUES.keys())

SYSTEM_PROMPT = (
    "You are MemorAid, a warm memory coach for elderly users. Guide the user "
    "through ONE memory exercise technique in short, numbered, plain-language "
    "steps (maximum 6 steps). Use an encouraging, patient tone suitable for "
    "someone aged 65+. Never use clinical or technical jargon."
)


def select_technique(user):
    """Adaptive selection: least-recently-used technique for this user."""
    last = (
        ExerciseSession.query.filter_by(userid=user.userid)
        .order_by(ExerciseSession.sessiondate.desc()).first()
    )
    if not last:
        return TECHNIQUE_ORDER[0]
    try:
        last_index = TECHNIQUE_ORDER.index(last.technique)
    except ValueError:
        return TECHNIQUE_ORDER[0]
    return TECHNIQUE_ORDER[(last_index + 1) % len(TECHNIQUE_ORDER)]


def build_exercise(user, weakest_category_name=None, sample_content=None, technique_key=None):
    """Return a dict describing the exercise session to present.

    ``technique_key`` lets the client open a specific one of the six
    techniques when the user navigates between them. Without it the existing
    adaptive least-recently-used choice is used.
    """
    if technique_key not in TECHNIQUES:
        technique_key = select_technique(user)
    spec = TECHNIQUES[technique_key]

    guidance = None
    prompt = (
        f"Technique: {spec['name']}\n"
        f"Summary: {spec['summary']}\n"
    )
    if weakest_category_name:
        prompt += f"The user has been struggling with: {weakest_category_name} memories.\n"
    if sample_content:
        prompt += f"A recent memory of theirs: {sample_content}\n"
    prompt += "Write the guided steps now."
    text = call_llm(SYSTEM_PROMPT, prompt, max_tokens=400, tier="fast")
    if text:
        guidance = text

    return {
        "technique": technique_key,
        "name": spec["name"],
        "summary": spec["summary"],
        "steps": spec["steps"],
        "guidance_text": guidance,
        "weak_category": weakest_category_name,
        # Returned so the interactive tutor can use the user's own memory
        # instead of a generic example. This is additive: existing clients
        # ignore it, and no generation logic changes.
        "sample_content": sample_content,
    }
