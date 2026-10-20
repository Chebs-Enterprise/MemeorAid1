"""
MemorAid (IMRS) — Flask backend entry point.

Run:
    cd backend
    pip install -r requirements.txt
    python app.py

Serves the REST API on http://127.0.0.1:5000/api (the exact base URL the
frontend api.js expects). When the React app has been built (frontend-react/dist
exists) it is also served here as static files, with a single-page-app fallback
so client-side routes such as /dashboard resolve. That gives a single-process
demo: `python app.py` and open http://127.0.0.1:5000/.
"""
import os
import sys

from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import JWTManager

# Make backend modules importable regardless of the CWD.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import Config  # noqa: E402
from models import (  # noqa: E402
    AnalyticsRecord, BehaviorPattern, ChatMessage, ExerciseSession,
    MemoryCategory, MemoryEntry, Notification, RecallQuestion,
    RecallSession, ReviewSchedule, User, db,
)

MODELS = {
    "User": User, "MemoryCategory": MemoryCategory, "MemoryEntry": MemoryEntry,
    "RecallQuestion": RecallQuestion, "ReviewSchedule": ReviewSchedule,
    "RecallSession": RecallSession, "ExerciseSession": ExerciseSession,
    "AnalyticsRecord": AnalyticsRecord, "BehaviorPattern": BehaviorPattern,
    "ChatMessage": ChatMessage, "Notification": Notification,
}

FRONTEND_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "frontend-react", "dist"
)


def create_app(config_object=Config):
    app = Flask(__name__, static_folder=None)
    app.config.from_object(config_object)

    db.init_app(app)
    JWTManager(app)
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    from routes import analytics, auth, checkin, chat, exercises, memories, notifications, profile, recall
    for module in (auth, profile, memories, recall, exercises, chat, analytics, checkin, notifications):
        app.register_blueprint(module.bp)

    @app.get("/api/health")
    def health():
        return jsonify(success=True, service="MemorAid API", version="1.0")

    # Optional: serve the built React app for single-process demos.
    # Real files (JS/CSS/images) are served as-is; anything else falls back to
    # index.html so react-router routes like /dashboard resolve on refresh.
    if os.path.isdir(FRONTEND_DIR):
        @app.get("/")
        def index():
            return send_from_directory(FRONTEND_DIR, "index.html")

        @app.get("/<path:page>")
        def static_page(page):
            target = os.path.join(FRONTEND_DIR, page)
            if os.path.isfile(target):
                return send_from_directory(FRONTEND_DIR, page)
            return send_from_directory(FRONTEND_DIR, "index.html")

    # Database bootstrap + seed (categories, demo account).
    with app.app_context():
        db.create_all()
        from db.db import seed
        seed(db.session, MODELS)

    # Scheduler (figure 3.1: morning check-in, pattern decay, family alert).
    if app.config.get("ENABLE_SCHEDULER") and os.getenv("PYTEST_CURRENT_TEST") is None:
        try:
            from services.jobs import start_scheduler
            start_scheduler(app)
        except Exception as exc:  # pragma: no cover
            print(f"[MemorAid] Scheduler not started: {exc}")

    return app


app = create_app()

if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    print(f"[MemorAid] API on http://127.0.0.1:{port}/api  (DB: {app.config['SQLALCHEMY_DATABASE_URI']})")
    app.run(host="127.0.0.1", port=port, debug=os.getenv("FLASK_DEBUG", "0") == "1")
