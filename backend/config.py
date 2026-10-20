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

        dsn = url.replace("postgresql+psycopg2://", "postgresql://")
        conn = psycopg2.connect(dsn, connect_timeout=3)
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

    # AI (Claude API, section 2.2.2). Empty key => deterministic fallbacks.
    ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
    CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-5")

    # Email (family connection mode, section 3.4.1)
    EMAIL_BACKEND = os.getenv("EMAIL_BACKEND", "console")
    SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
    SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER = os.getenv("SMTP_USER", "")
    SMTP_PASS = os.getenv("SMTP_PASS", "")
    EMAIL_FROM = os.getenv("EMAIL_FROM", "memoraid@example.com")

    # Scheduler
    ENABLE_SCHEDULER = os.getenv("ENABLE_SCHEDULER", "1") == "1"

    # Pattern Confidence Module (section 1.7)
    PATTERN_DECAY_RATE = float(os.getenv("PATTERN_DECAY_RATE", "0.9"))
    PATTERN_CONTEXT_THRESHOLD = float(os.getenv("PATTERN_CONTEXT_THRESHOLD", "0.6"))
    PATTERN_STALE_FLOOR = float(os.getenv("PATTERN_STALE_FLOOR", "0.3"))

    # Family connection mode
    INACTIVITY_THRESHOLD_HOURS = int(os.getenv("INACTIVITY_THRESHOLD_HOURS", "24"))
