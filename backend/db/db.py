"""
Database bootstrap and seed data.

Seeds the five memory categories from the document of proof (section 1.5:
Names, Appointments, Tasks, Conversations, Medications — see
implementation plan ambiguity A1) and a demo account so the system is
immediately demoable.
"""
from datetime import date, datetime, time, timedelta

import bcrypt

CATEGORIES = [
    ("Names", "People you meet — grandchildren, neighbours, community members"),
    ("Appointments", "Doctor visits, meetings and dates to keep"),
    ("Tasks", "Things to do and errands to run"),
    ("Conversations", "Important discussions and what was said"),
    ("Medications", "Medicines, dosages and schedules"),
]

DEMO_USER = {
    "fullname": "Eleanor Vance",
    "email": "eleanor@demo.memoraid.app",
    "password": "demo1234",
    "agegroup": "above-65",
    "family_contact_email": "sarah@demo.memoraid.app",
    "checkintime": time(8, 0),
}

DEMO_MEMORIES = [
    ("Names", "My granddaughter Chioma is studying medicine at the University of Lagos.",
     "She calls every Sunday evening."),
    ("Appointments", "Dr. Okafor appointment on Thursday at 10 in the morning at the Enugu clinic.",
     "Bring the blood pressure diary."),
    ("Medications", "Take one Amlodipine tablet after breakfast every morning.",
     "The tablet is white and round."),
]


def seed(db_session, models):
    """Idempotent seed: categories + demo user + a few sample memories."""
    MemoryCategory = models["MemoryCategory"]
    MemoryEntry = models["MemoryEntry"]
    RecallQuestion = models["RecallQuestion"]
    ReviewSchedule = models["ReviewSchedule"]
    User = models["User"]

    if not MemoryCategory.query.first():
        for name, desc in CATEGORIES:
            db_session.add(MemoryCategory(categoryname=name, description=desc))
        db_session.flush()

    if not User.query.filter_by(email=DEMO_USER["email"]).first():
        from services.ai.question_generator import generate_question

        user = User(
            fullname=DEMO_USER["fullname"],
            email=DEMO_USER["email"],
            passwordhash=bcrypt.hashpw(DEMO_USER["password"].encode(), bcrypt.gensalt()).decode(),
            agegroup=DEMO_USER["agegroup"],
            family_contact_email=DEMO_USER["family_contact_email"],
            checkintime=DEMO_USER["checkintime"],
            last_activity_date=date.today(),
        )
        db_session.add(user)
        db_session.flush()

        for category_name, content, note in DEMO_MEMORIES:
            category = MemoryCategory.query.filter_by(categoryname=category_name).first()
            entry = MemoryEntry(userid=user.userid, categoryid=category.categoryid,
                                content=content, contextnote=note)
            db_session.add(entry)
            db_session.flush()
            question_text, by_ai = generate_question(content, category_name, note, difficulty=1)
            db_session.add(RecallQuestion(
                memoryid=entry.memoryid, questiontext=question_text,
                answerkey=content, difficultylevel=1, generatedbyai=by_ai,
            ))
            db_session.add(ReviewSchedule(
                memoryid=entry.memoryid,
                nextreviewdate=date.today(),  # due today so the demo has a queue
                interval=1, repetition=0, easefactor=2.5,
            ))
        print(f"[MemorAid] Seeded demo account: {DEMO_USER['email']} / {DEMO_USER['password']}")

    db_session.commit()


def init_db(app, db, models):
    with app.app_context():
        db.create_all()
        seed(db.session, models)
