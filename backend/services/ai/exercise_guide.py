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
            "Place each thing you want to remember at a spot along a route you "
            "know well — like the walk from your front door to the market. To "
            "recall, walk the route in your mind and collect them."
        ),
        "steps": [
            "Choose a familiar route — for example, your home from room to room.",
            "Take the items you want to remember, one by one.",
            "Mentally place each item at the next spot on your route, making the picture a little funny so it sticks.",
            "Rest for a moment, then walk the route again in your mind.",
            "Collect each item as you pass its spot and say it aloud.",
        ],
    },
    "elaborative_encoding": {
        "name": "Elaborative Encoding",
        "summary": (
            "Connect new information to something you already know — a story, "
            "a feeling, or an old memory. Deeper connections make stronger "
            "memories."
        ),
        "steps": [
            "Take the new thing you want to remember.",
            "Ask yourself: what does this remind me of?",
            "Link it to a person, a story, or a feeling from your own life.",
            "Say the connection out loud in one full sentence.",
            "Repeat the connection once more after a short pause.",
        ],
    },
    "spaced_retrieval": {
        "name": "Spaced Retrieval Training",
        "summary": (
            "Test yourself on the same piece of information several times in "
            "one sitting, with slightly longer pauses each time. This is the "
            "technique clinicians use to strengthen name and face recall."
        ),
        "steps": [
            "Choose one thing to remember — a name, a date, or an appointment.",
            "Say it from memory straight away.",
            "Wait about 30 seconds, then say it again from memory.",
            "Wait about two minutes, and test yourself once more.",
            "Finish with one last test after five minutes.",
        ],
    },
    "face_name_association": {
        "name": "Face–Name Association",
        "summary": (
            "Tie a person's name to one distinctive feature or a mental "
            "picture. The hook gives your memory something to grab."
        ),
        "steps": [
            "Think of the person's face clearly in your mind.",
            "Notice one distinctive feature — their smile, glasses, or hair.",
            "Pair the feature with their name in a short rhyme or picture.",
            "Say the name aloud while you picture the feature.",
            "Recall the pair once more after a minute.",
        ],
    },
    "chunking": {
        "name": "Chunking",
        "summary": (
            "Group long lists into small meaningful groups. Smaller groups "
            "are much easier for your memory to hold."
        ),
        "steps": [
            "Look at the information you need to remember.",
            "Find natural groups of two or three items that belong together.",
            "Give each group a short label in your own words.",
            "Remember the labels first, then the items inside each group.",
            "Repeat the groups back in order, then out of order.",
        ],
    },
    "active_observation": {
        "name": "Active Observation",
        "summary": (
            "Study a set of details for a short while, then try to recall as "
            "many as you can without looking. This keeps your attention sharp."
        ),
        "steps": [
            "Choose a scene — a photograph, your street outside the window, or a room.",
            "Study it carefully for about one minute.",
            "Look away and list everything you can remember.",
            "Look back and check what you missed.",
            "Try once more for the details you missed.",
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


def build_exercise(user, weakest_category_name=None, sample_content=None):
    """Return a dict describing the exercise session to present."""
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
