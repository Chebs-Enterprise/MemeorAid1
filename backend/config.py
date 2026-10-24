"""
MemorAid backend configuration.

Document of proof: Memoraid-123.docx section 3.5.1 mandates PostgreSQL.
For local development without PostgreSQL the app falls back to SQLite
(loud warning, prototype stays demoable).
"""
import os
from datetime import timedelta

from dotenv import load_dotenv

load_dotenv()


def _postgres_reachable(url: str):
    """Attempt a real (authenticated) connection so we can fall back to
    SQLite with a meaningful warning. Returns None if reachable, otherwise
    the failure reason.

    Note: a bare TCP probe is not enough — a Postgres server may be
    listening on the port while rejecting these credentials (as it does on
    this development machine), which would otherwise crash the app.
    """
    try:
        import psycopg2
        from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse

        dsn = url.replace("postgresql+psycopg2://", "postgresql://")
        # Ensure SSL is used for common managed Postgres (e.g. Supabase/Render)
        parsed = urlparse(dsn)
        query = dict(parse_qsl(parsed.query, keep_blank_values=True))
        if parsed.hostname and parsed.hostname not in ('localhost', '127.0.0.1', '::1'):
            if 'sslmode' not in query:
                query['sslmode'] = 'require'
        if query:
            dsn = urlunparse(parsed._replace(query=urlencode(query)))
        conn = psycopg2.connect(dsn, connect_timeout=5)
        conn.close()
        return None
    except Exception as exc:
        return str(exc).splitlines()[0]


def _database_uri() -> str:
    url = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg2://memoraid:memoraid@localhost:5432/memoraid",
    )
    if url.startswith("sqlite"):
        return url
    # If running in production-like environments, try to use Postgres directly
    # even if quick reachability check behaves differently
    if os.getenv("VERCEL") or os.getenv("RENDER") or os.getenv("RAILWAY_ENVIRONMENT") or os.getenv("SUPABASE_URL"):
        # Normalize for SQLAlchemy + psycopg2
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+psycopg2://", 1)
        elif url.startswith("postgresql://") and "+psycopg2" not in url:
            url = url.replace("postgresql://", "postgresql+psycopg2://", 1)
        return url
    failure = _postgres_reachable(url)
    if failure is None:
        return url
    print(
        "\n" + "=" * 78 + "\n"
        "[MemorAid] WARNING: PostgreSQL is not usable — falling back to a local\n"
        f"  SQLite file (memoraid.db).\n"
        f"  Reason: {failure}\n"
        "  The document of proof mandates PostgreSQL for any real deployment.\n"
        "  To use PostgreSQL, create the database and credentials, then set\n"
        "  DATABASE_URL in backend/.env (see backend/.env.example).\n"
        "  To force SQLite for local development: DATABASE_URL=sqlite:///memoraid.db\n"
        + "=" * 78 + "\n"
    )
    return "sqlite:///memoraid.db"


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
    SQLALCHEMY_DATABASE_URI = _database_uri()
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-jwt-secret-change-me")
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(
        days=int(os.getenv("JWT_ACCESS_TOKEN_EXPIRES_DAYS", "7"))
    )

    # AI (Google Gemini API, section 2.2.2). The key is read from the
    # environment / backend/.env and is never hardcoded. Empty key =>
    # deterministic fallbacks (offline demo).
    AI_PROVIDER = os.getenv("AI_PROVIDER", "gemini")
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
    GEMINI_API_BASE = os.getenv(
        "GEMINI_API_BASE", "https://generativelanguage.googleapis.com/v1beta"
    )

    # Model tiering (section 2.2.2 — no custom model training; the backend
    # structures context and lets Gemini do the thinking):
    #   GEMINI_MODEL      — the chat companion (the reply the user reads)
    #   GEMINI_MODEL_FAST — background work (fact extraction, question
    #                       generation, session digests, pattern detection)
    #   GEMINI_MODEL_DEEP — optional "deep reflection" mode for the chat
    GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
    GEMINI_MODEL_FAST = os.getenv("GEMINI_MODEL_FAST", "gemini-3.5-flash-lite")
    GEMINI_MODEL_DEEP = os.getenv("GEMINI_MODEL_DEEP", "gemini-3.8-flash")

    # Optional thinking override. Gemini 3/4 models take a thinking level
    # (MINIMAL | LOW | MEDIUM | HIGH); Gemini 2.5 models take a token budget.
    # Leave empty to let the client pick per tier (fast=MINIMAL, chat=LOW,
    # deep=HIGH). GEMINI_THINKING_BUDGET applies to 2.5 models only.
    GEMINI_THINKING_LEVEL = os.getenv("GEMINI_THINKING_LEVEL", "")
    GEMINI_THINKING_BUDGET = int(os.getenv("GEMINI_THINKING_BUDGET", "0"))
    AI_TIMEOUT_SECONDS = float(os.getenv("AI_TIMEOUT_SECONDS", "60"))

    # AI_MOCK_MODE runs the whole personalisation pipeline (retrieval, fact
    # memory, understanding pass) with a deterministic offline stand-in for
    # the model, so the flow is testable before an API key exists.
    AI_MOCK_MODE = os.getenv("AI_MOCK_MODE", "0") == "1"

    # Pause between the mock's streamed words, so the offline demo behaves
    # like the real thing (words appearing one by one) instead of dumping
    # the whole reply at once.
    MOCK_STREAM_DELAY = float(os.getenv("MOCK_STREAM_DELAY", "0.02"))

    # Embeddings for retrieval. "local" is an offline hashing embedder (no key,
    # no network); "voyage"/"openai" upgrade the semantic search when a key
    # is available. The interface is identical either way.
    EMBEDDING_PROVIDER = os.getenv("EMBEDDING_PROVIDER", "local")
    EMBEDDING_API_KEY = os.getenv("EMBEDDING_API_KEY", "")
    EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM", "384"))
    EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "voyage-3")

    # Retrieval tuning (how many memories/facts go into one context pack).
    RETRIEVAL_MEMORY_LIMIT = int(os.getenv("RETRIEVAL_MEMORY_LIMIT", "8"))
    RETRIEVAL_FACT_LIMIT = int(os.getenv("RETRIEVAL_FACT_LIMIT", "8"))
    RETRIEVAL_CHAT_LIMIT = int(os.getenv("RETRIEVAL_CHAT_LIMIT", "4"))
    CHAT_HISTORY_TURNS = int(os.getenv("CHAT_HISTORY_TURNS", "20"))

    # Email (family connection mode, section 3.4.1)
    EMAIL_BACKEND = os.getenv("EMAIL_BACKEND", "console")
    SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
    SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER = os.getenv("SMTP_USER", "")
    SMTP_PASS = os.getenv("SMTP_PASS", "")
    EMAIL_FROM = os.getenv("EMAIL_FROM", "memoraid@example.com")

    # Scheduler
    ENABLE_SCHEDULER = os.getenv("ENABLE_SCHEDULER", "1") == "1"

    # Notifications (section 3.5.1). All notification text is predefined in
    # services/notifications.py — no AI is ever called to build or send one.
    #   NOTIFICATION_DUE_REVIEW    master switch for SM-2 due-review nudges
    #   NOTIFICATION_INACTIVITY    master switch for inactivity reminders
    # Both default on; per-user preferences can still turn each one off.
    NOTIFICATION_DUE_REVIEW = os.getenv("NOTIFICATION_DUE_REVIEW", "1") == "1"
    NOTIFICATION_INACTIVITY = os.getenv("NOTIFICATION_INACTIVITY", "1") == "1"
    # Default IANA timezone for new preference rows (users can override).
    DEFAULT_TIMEZONE = os.getenv("DEFAULT_TIMEZONE", "UTC")
    # How often the reminder jobs wake up (minutes). Every run is de-duplicated
    # per day, so this only controls responsiveness.
    NOTIFICATION_CHECK_INTERVAL_MINUTES = int(
        os.getenv("NOTIFICATION_CHECK_INTERVAL_MINUTES", "5")
    )

    # Web Push (VAPID). Left empty by default: without keys the app simply
    # falls back to in-app notifications, and services/notifications_delivery
    # never raises. Generate a key pair with:
    #   python -c "import base64,os;print(base64.urlsafe_b64encode(os.urandom(65)).decode().rstrip('='))"
    VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
    VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
    VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:memoraid@example.com")

    # Pattern Confidence Module (section 1.7)
    PATTERN_DECAY_RATE = float(os.getenv("PATTERN_DECAY_RATE", "0.9"))
    PATTERN_CONTEXT_THRESHOLD = float(os.getenv("PATTERN_CONTEXT_THRESHOLD", "0.6"))
    PATTERN_STALE_FLOOR = float(os.getenv("PATTERN_STALE_FLOOR", "0.3"))

    # Family connection mode
    INACTIVITY_THRESHOLD_HOURS = int(os.getenv("INACTIVITY_THRESHOLD_HOURS", "24"))
