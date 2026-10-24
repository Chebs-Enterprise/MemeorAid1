# MemorAid (IMRS) — Intelligent Memory Reinforcement System

A memory-support web application for older adults. Built to the specification in
`Memoraid-123.docx` (the **document of proof** — it takes precedence over any
other code in this repository).

Frontend and backend live in **separate folders**:

```
frontend-react/   React 19 + Vite 8 SPA   (HTML / CSS / JavaScript)
backend/          Flask + SQLAlchemy + PostgreSQL + Google Gemini API
```

The document of proof (line 107) specifies the frontend languages as HTML, CSS
and JavaScript. The React application is written in those languages; React and
Vite are the build tooling, chosen so the project demonstrates the component
architecture, routing, state management and build pipeline expected of a
final-year Computer Science project. See `frontend-react/README.md` for the
architecture and a screen-by-screen map.

The original prototype files at the repository root are left untouched.

---

## Quick start

You need **two terminals**: one for the API, one for the React dev server.

### 1. Backend (terminal 1)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

The API starts on **http://127.0.0.1:5000/api**.

### 2. Frontend (terminal 2)

```powershell
cd frontend-react
npm install
npm run dev
```

The app starts on **http://localhost:5173**. Vite proxies `/api` to the Flask
backend, so requests reach the API without any CORS configuration.

### Single-process alternative

Run `npm run build` inside `frontend-react/`; the backend then serves the built
app itself (from `frontend-react/dist`) at **http://127.0.0.1:5000/** — one
process, one URL, with a single-page-app fallback so routes like `/dashboard`
resolve on refresh.

### 3. Demo account

Seeded automatically on first boot:

| Email | Password |
|---|---|
| `eleanor@demo.memoraid.app` | `demo1234` |

The demo account has three sample memories (one appointment, one medication,
one name) already due for review.

---

## Configuration

Copy `backend/.env.example` to `backend/.env` and edit as needed.

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | SQLAlchemy database URL | `postgresql+psycopg2://memoraid:memoraid@localhost:5432/memoraid` |
| `GEMINI_API_KEY` | Google Gemini API key (section 2.2.2) | *(empty → deterministic fallbacks)* |
| `GEMINI_MODEL` | Gemini model id for chat | `gemini-3.6-flash` |
| `GEMINI_MODEL_FAST` | Gemini model id for background passes | `gemini-3.5-flash-lite` |
| `GEMINI_MODEL_DEEP` | Gemini model id for deep reflection | `gemini-3.8-flash` |
| `SECRET_KEY` / `JWT_SECRET_KEY` | Flask / JWT signing keys | dev values — **change in production** |
| `EMAIL_BACKEND` | `console` or `smtp` | `console` |
| `ENABLE_SCHEDULER` | Run the in-process scheduler | `1` |

### Database

The document mandates **PostgreSQL** for real deployments. On startup the
backend attempts a genuine authenticated PostgreSQL connection. If that fails
for any reason (no server *or* rejected credentials), it prints a loud warning
and falls back to a local SQLite file at `backend/instance/memoraid.db`, so the
prototype always boots.

> **STATUS ON THIS MACHINE: running on the SQLite fallback.**
>
> PostgreSQL 16 *is* installed and listening on port 5432, but the `memoraid`
> role and database have not been created yet — that requires the PostgreSQL
> superuser password, which was not available. The app is fully functional on
> SQLite in the meantime; `backend/.env` is already pointed at PostgreSQL, so
> completing the step below switches it over on the next restart.

#### Current state of the PostgreSQL instance

| Fact | Value |
|---|---|
| Version / install | PostgreSQL 16, `C:\Program Files\PostgreSQL\16` |
| Data directory | `C:\Program Files\PostgreSQL\16\data` |
| Listening | `0.0.0.0:5432` and `[::]:5432` (process started manually) |
| Windows service | `postgresql-x64-16` — **Stopped** (not managing the live instance) |
| Authentication | `scram-sha-256` for `127.0.0.1` and `::1` — a password is required |
| `memoraid` role / database | **do not exist yet** |

Because the running instance was started by a different account, `pg_ctl` cannot
signal it and it does not appear in `pg_ctl status`. Setting up the database
therefore needs either the superuser password or an elevated shell.

#### Setting up PostgreSQL

Run the helper from an **elevated** PowerShell (it needs to restart the
PostgreSQL service to apply configuration):

```powershell
# If you know the postgres superuser password:
.\setup_postgres.ps1 -PostgresPassword 'YOUR_PASSWORD'

# If you don't know it, briefly allow local passwordless access
# (pg_hba.conf is backed up, switched to `trust` for 127.0.0.1/::1 only,
#  then ALWAYS restored afterwards):
.\setup_postgres.ps1 -UseTrustForLocalhost
```

The script creates the `memoraid` role and database, loads
`backend/db/schema.sql` (11 tables), and prints the connection string.

#### Doing it by hand

In SQL Shell (psql) as the `postgres` superuser:

```sql
CREATE ROLE memoraid WITH LOGIN PASSWORD 'memoraid';
CREATE DATABASE memoraid OWNER memoraid ENCODING 'UTF8';
GRANT ALL PRIVILEGES ON DATABASE memoraid TO memoraid;
\c memoraid
ALTER SCHEMA public OWNER TO memoraid;
```

Then load the schema and restart the backend:

```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U memoraid -h 127.0.0.1 -d memoraid -f backend\db\schema.sql
```

> **Note on `pg_hba.conf`:** the file ships with a UTF-8 **BOM**. Never rewrite
> it with `Set-Content -Encoding UTF8` — that adds a second BOM and PostgreSQL
> refuses to start ("could not load pg_hba.conf"). `setup_postgres.ps1`
> round-trips the exact bytes to avoid this.

### AI behaviour without an API key

Every AI feature has a deterministic fallback, so the system is fully usable
offline:

- recall questions are generated from templates (flagged `generatedbyai: false`)
- the chat companion replies from a warm, safe script
- exercise guidance uses the built-in technique templates
- the morning check-in uses a rules-based message

---

## Features (mapped to the document)

| # | Feature | Where |
|---|---|---|
| FR-01 | Sign up / sign in (JWT + bcrypt) | `routes/auth.py`, `login.html`, `signup.html` |
| FR-02 | Profile, accessibility preferences | `routes/profile.py`, `profile.html` |
| FR-03 | Log a memory (5 categories, 3 fields) | `routes/memories.py`, `log-memory.html` |
| FR-04 | AI question generation | `services/ai/question_generator.py` |
| FR-05 | SM-2 spaced repetition | `services/sm2.py` |
| FR-06/07 | Recall session + progressive difficulty | `routes/recall.py`, `recall.html` |
| FR-08 | Six memory exercise techniques | `services/ai/exercise_guide.py`, `exercises.html` |
| FR-09/10/11 | AI chat companion + Pattern Confidence Module | `services/ai/chat_companion.py`, `services/pattern_confidence.py` |
| FR-12 | Streaks (recall + exercise) | `services/streaks.py` |
| FR-13 | Analytics dashboard (2 charts + AI message) | `services/analytics.py`, `analytics.html` |
| FR-14 | Morning check-in | `routes/checkin.py`, `services/ai/checkin.py` |
| FR-15 | Family connection alert | `services/jobs.py`, `services/email_sender.py` |
| FR-16 | Scheduler (3 jobs) | `services/jobs.py` |

### Memory categories (document §1.5)

Names · Appointments · Tasks · Conversations · Medications

### Accessibility rules enforced (document §3.5.2)

- all inputs are at least **56 px** tall
- labels sit **above** fields (never placeholder-only)
- body text ≥ **18 px**, headings ≥ **24 px**
- friendly, plain-language error messages
- password show/hide toggle
- text-size presets (normal / large / extra large) and a high-contrast mode
- read-aloud buttons on questions, exercises and the check-in message

---

## Tests

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest tests -q
```

20 tests: SM-2 algorithm parity and end-to-end API coverage (auth, memories,
the full recall flow, reveal endpoint, exercises, chat, check-in, analytics).

The suite runs against in-memory SQLite with the Gemini API forced offline, so
the fallback generators are exercised too.

---

## Notes and open questions

`IMPLEMENTATION_PLAN.md` at the repository root documents the plan, the schema,
the API contract and the gap analysis against the original prototype. Section
**§17** lists eight ambiguities in the document that need author sign-off — most
notably the number of memory categories (§1.5 names five, the §3.5.1 table lists
four) and the table count ("ten" is stated, eleven are named). The build follows
§1.5 and implements all eleven.
