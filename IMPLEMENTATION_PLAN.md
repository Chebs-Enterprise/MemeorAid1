# MemorAid (IMRS) — Complete Implementation Plan

**Source of truth:** `Memoraid-123.docx` — *"Design and Implementation of an Intelligent Memory Reinforcement System (IMRS), commercially named MemorAid"*, Chapters 1–3 (Introduction, Literature Review, Systems Analysis & Design).

**Authority rule:** Where this plan or the existing codebase conflicts with the document, **the document wins**. Every requirement below is traceable to a document section. Conflicts with the current code are listed in §12 with their resolution. Ambiguities *inside* the document are logged in §17 with a proposed resolution and flagged for sign-off.

---

## 1. What the System Is (Document Perspective)

MemorAid is a **web-based cognitive-training system for everyday forgetfulness among elderly users (aged 51+)**, originally motivated by the Nigerian elder-care context. It does **not** merely store information — it actively **trains** the user's memory through:

1. **Active recall** — the user retrieves an answer from memory *before* it is shown (not a reminder app).
2. **AI-generated recall questioning** — the **Gemini API** (Google) generates a personalised question for every logged memory; the user never authors flashcards.
3. **Spaced repetition** — the **SM-2 algorithm** (Wozniak, 1990) schedules each memory's next review from the user's 0–5 quality rating.
4. **Progressive difficulty** — questions scale 1 (easy) → 2 (medium) → 3 (hard) based on demonstrated performance.
5. **Six validated memory exercise techniques** — Method of Loci, Elaborative Encoding, Spaced Retrieval Training (SRT), Face-Name Association, Chunking, Active Observation — selected **adaptively** by the user's weak categories.
6. **Conversational AI companion** — chat powered by Gemini, personalised from the user's memory history, recall performance, and detected behaviour patterns, with **age-based tone adaptation**.
7. **Pattern Confidence Module** — a backend component that silently observes behaviour, scores each pattern with a confidence value that **decays** if not reinforced, and guarantees the AI **never asserts that an event occurred** without explicit confirmation (phrased as possibility, not fact).
8. **Adherence features (not memory-strengthening mechanisms, per §1.4):** daily **morning check-in**, simplified AI voice, and **family connection mode** (inactivity alert to a linked family member).
9. **Dual streak system** — separate `exercise_streak` and `recall_streak` counters.
10. **Forgetting-pattern analytics** — recall accuracy %, forgetting frequency by category (bar), accuracy over time (line), streaks, and an AI motivational message.

**Actors (Figure 3.1):** Elderly User · Family Member (linked contact) · AI Service (Gemini API) · Scheduler (automated backend job).

**Stated methodology:** OOADM supported by prototyping. The design objects are: User, MemoryEntry, MemoryCategory, RecallQuestion, ReviewSchedule, RecallSession, ExerciseSession, ChatMessage, BehaviorPattern, AnalyticsRecord, Notification — plus service objects AIQuestionGenerator, SM2Scheduler, AnalyticsDashboard.

**Stated tech stack (§2.2.2, §3.4.3):** Frontend HTML/CSS/JavaScript · Backend **Python + Flask (REST API)** · Database **PostgreSQL** · AI **Gemini API** (no custom model training; personalisation via structured context in prompts) · bcrypt password hashing.

---

## 2. Functional Requirements (traceable)

| ID | Requirement | Doc ref |
|----|-------------|---------|
| FR-01 | User registration & login (bcrypt hash, JWT session) | §3.5.1 users, use cases Register/Login |
| FR-02 | Profile & settings: age group (51–65 / above-65), accessibility prefs, family contact email, check-in time | §3.5.1 users, Manage Profile |
| FR-03 | Memory logging with exactly **three fields**: category (5 options), memory content, optional context note — loggable in <30 s | §1.5, §3.5.2 |
| FR-04 | On save: backend builds structured prompt (content, category, context note, difficulty 1) → Gemini returns a recall question → stored 1:1 with the memory; initial ReviewSchedule = **next day** | §3.4.3 sequence |
| FR-05 | SM-2 scheduling per memory (quality 0–5, interval, ease factor ≥1.3, repetition) | §3.4.4, §2.2.1 |
| FR-06 | Recall session: due queue; **one question at a time**; user **types an answer**, then **Reveal**, then rates **0–5** with plain-English labels; summary + streak update at end | §3.4.4, §3.5.3 |
| FR-07 | Progressive difficulty 1/2/3, adjusted after each review based on rating | §1.5, §3.4.4 |
| FR-08 | Exercise sessions delivering the **six techniques**, adaptively selected from weak categories, with AI step-by-step guidance; completion updates exercise streak | §2.2.1, §3.5.3 |
| FR-09 | Chat companion with personalisation context pack (memory history, recall performance, confirmed behaviour patterns) | §2.2.2, §2.4 |
| FR-10 | Pattern Confidence Module: observe → score → decay; AI must never assume an event occurred | §1.7 |
| FR-11 | Age-based AI tone adaptation (51–65 vs above-65) | §1.5 |
| FR-12 | Dual streaks (recall & exercise) maintained server-side | §3.5.1 users |
| FR-13 | Analytics dashboard: overall accuracy %, forgetting-frequency bar chart by category, accuracy-over-time line chart, streak counters, AI motivational message | §3.5.3 |
| FR-14 | Scheduler: generate & deliver **morning check-in** at the user's configured time; dashboard shows the personalised greeting | §3.4.1, §3.5.3 |
| FR-15 | Family connection: when engagement/check-in inactivity exceeds threshold, **alert the family contact** (email) and record a notification | §1.4, §3.4.1 |
| FR-16 | Elderly accessibility (hard rules): inputs ≥56 px high, labels **above** fields, body text ≥18 px, headings ≥24 px, friendly plain-language errors, password show/hide toggle, font-size & contrast preferences | §3.5.2 |

**Explicit non-requirements (per §1.6):** not a clinical/medical device; no diagnosis or treatment of dementia/Alzheimer's; no custom model training; no native mobile app (standard browsers only).

---

## 3. System Architecture

```
┌────────────────────────────── Browser ──────────────────────────────┐
│  React 19 + Vite 8 SPA  (folder: frontend-react/)                   │
│  component tree · react-router · AuthContext · single API layer     │
│  public: / · /login · /signup                                       │
│  app: /dashboard · /log-memory · /recall · /exercises · /chat ·      │
│       /analytics · /profile                                         │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ REST/JSON + Authorization: Bearer JWT
┌───────────────────────────────▼─────────────────────────────────────┐
│                      Flask API (app.py)                             │
│  Blueprints: auth · profile · memories · recall · exercises ·       │
│              chat · analytics · checkin · notifications             │
│  ─────────────────────────────────────────────────────────          │
│  Services:                                                          │
│   • AIQuestionGenerator  → Gemini API (fallback: template engine)   │
│   • ExerciseGuide        → Gemini API (fallback: canned guidance)   │
│   • ChatCompanion        → Gemini API + ToneAdapter + PC rules      │
│   • CheckInGenerator     → Gemini API (fallback: template)          │
│   • PatternConfidence    → observe / score / decay (pure Python)    │
│   • SM2Scheduler         → SM-2 math (port of sm2.js, unit-tested)  │
│   • StreakManager · AnalyticsEngine · EmailSender (smtplib)         │
│  ─────────────────────────────────────────────────────────          │
│  SQLAlchemy ORM ──────► PostgreSQL                                  │
│  APScheduler (in-process jobs): morning check-in · pattern decay ·  │
│              family inactivity alert                                │
└─────────────────────────────────────────────────────────────────────┘
        │ (HTTPS, Gemini REST)                │ (SMTP)
        ▼                                       ▼
   Gemini API (Google)                 Family contact email
```

**Proposed repository layout** (backend added alongside the existing static frontend):

```
MemeorAid1/
├── Memoraid-123.docx              ← document of proof (do not modify)
├── app.py                         ← Flask app factory + scheduler bootstrap
├── config.py                      ← env-driven config (DATABASE_URL, SECRET_KEY,
│                                     GEMINI_API_KEY, SMTP_*, thresholds)
├── requirements.txt               ← flask, flask-sqlalchemy, flask-cors,
│                                     flask-jwt-extended, bcrypt,
│                                     apscheduler, psycopg2-binary, python-dotenv
├── .env.example · .gitignore
├── db/
│   ├── schema.sql                 ← DDL (§6)
│   ├── seed.sql                   ← 5 categories + demo user + sample memories
│   └── db.py                      ← init/seed helpers
├── services/
│   ├── sm2.py · streaks.py · pattern_confidence.py · analytics.py
│   ├── ai/ client.py · question_generator.py · exercise_guide.py
│   │        chat_companion.py · checkin.py · prompts/ (templated prompts)
│   └── email_sender.py
├── routes/ (blueprints) auth · profile · memories · recall · exercises
│           chat · analytics · checkin · notifications
├── models/  User · MemoryCategory · MemoryEntry · RecallQuestion ·
│            ReviewSchedule · RecallSession · ExerciseSession ·
│            ChatMessage · BehaviorPattern · AnalyticsRecord · Notification
├── tests/   test_sm2.py · test_streaks.py · test_pattern_confidence.py
│            test_api_*.py (pytest)
└── <existing static HTML/CSS/JS — rebuilt per §11>
```

---

## 4. Database Design (PostgreSQL)

Eleven tables are specified or implied (see §17, ambiguity A2). Field names for the six tables the document describes only narratively are **inferred** from the class-diagram descriptions in §3.4.2 and marked *(inferred)*.

### 4.1 `users` (verbatim from §3.5.1)

```sql
CREATE TABLE users (
  userid               SERIAL PRIMARY KEY,
  fullname             VARCHAR(100) NOT NULL,
  email                VARCHAR(150) UNIQUE NOT NULL,
  passwordhash         VARCHAR(255) NOT NULL,            -- bcrypt
  agegroup             VARCHAR(20) NOT NULL CHECK (agegroup IN ('51-65','above-65')),
  accessibilitypref    VARCHAR(50),                       -- font size + contrast
  family_contact_email VARCHAR(150),
  exercise_streak      INT DEFAULT 0,
  recall_streak        INT DEFAULT 0,
  last_exercise_date   DATE,
  createdat            TIMESTAMP DEFAULT NOW(),
  isactive             BOOLEAN DEFAULT TRUE,
  -- inferred operational fields (not in doc column list; needed for FR-14/FR-15):
  checkintime          TIME DEFAULT '08:00',
  last_checkin_date    DATE,
  last_activity_date   DATE,
  inactivity_threshold_hours INT DEFAULT 24
);
```

### 4.2 `memorycategories` — seeded with **five** categories (§1.5): Names, Appointments, Tasks, Conversations, Medications *(see ambiguity A1)*

```sql
CREATE TABLE memorycategories (
  categoryid   SERIAL PRIMARY KEY,
  categoryname VARCHAR(50) UNIQUE NOT NULL,
  description  VARCHAR(255)
);
```

### 4.3 `memoryentries` (verbatim)

```sql
CREATE TABLE memoryentries (
  memoryid    SERIAL PRIMARY KEY,
  userid      INT REFERENCES users(userid),
  categoryid  INT REFERENCES memorycategories(categoryid),
  content     TEXT NOT NULL,
  contextnote TEXT,
  datecreated TIMESTAMP DEFAULT NOW(),
  status      VARCHAR(20) DEFAULT 'active'               -- active | archived
);
```

### 4.4 `recallquestions` (verbatim) — exactly **one question per memory** (1:1, §3.4.2)

```sql
CREATE TABLE recallquestions (
  questionid      SERIAL PRIMARY KEY,
  memoryid        INT UNIQUE REFERENCES memoryentries(memoryid),
  questiontext    TEXT NOT NULL,
  answerkey       TEXT,                                  -- original memory as reference
  difficultylevel INT DEFAULT 1 CHECK (difficultylevel BETWEEN 1 AND 3),
  generatedbyai   BOOLEAN DEFAULT TRUE,                  -- FALSE = template fallback
  dategenerated   TIMESTAMP DEFAULT NOW()
);
```

### 4.5 `reviewschedules` (verbatim)

```sql
CREATE TABLE reviewschedules (
  scheduleid      SERIAL PRIMARY KEY,
  memoryid        INT UNIQUE REFERENCES memoryentries(memoryid),
  nextreviewdate  DATE NOT NULL,
  interval        INT DEFAULT 1,
  repetition      INT DEFAULT 0,
  easefactor      FLOAT DEFAULT 2.5,
  lastreviewdate  DATE
);
```

### 4.6 Inferred tables *(field design is ours; tables themselves are required by §3.5.1)*

```sql
CREATE TABLE recallsessions (            -- "each user's recall attempt and score"
  sessionid   SERIAL PRIMARY KEY,
  userid      INT REFERENCES users(userid),
  questionid  INT REFERENCES recallquestions(questionid),
  memoryid    INT REFERENCES memoryentries(memoryid),
  userresponse TEXT,
  quality     INT CHECK (quality BETWEEN 0 AND 5),
  passed      BOOLEAN,                   -- quality >= 3 (SM-2 convention)
  difficulty  INT,
  sessiondate TIMESTAMP DEFAULT NOW()
);

CREATE TABLE exercisesessions (          -- "completed exercise sessions and techniques used"
  exerciseid    SERIAL PRIMARY KEY,
  userid        INT REFERENCES users(userid),
  technique     VARCHAR(40) NOT NULL CHECK (technique IN
                 ('method_of_loci','elaborative_encoding','spaced_retrieval',
                  'face_name_association','chunking','active_observation')),
  categoryid    INT REFERENCES memorycategories(categoryid),   -- weak area targeted
  guidance_text TEXT,
  completed     BOOLEAN DEFAULT FALSE,
  score         INT,
  sessiondate   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE analyticsrecords (          -- "recall accuracy and forgetting patterns by category"
  recordid       SERIAL PRIMARY KEY,
  userid         INT REFERENCES users(userid),
  categoryid     INT REFERENCES memorycategories(categoryid),
  period         DATE DEFAULT CURRENT_DATE,   -- one row per user/category/day
  total_attempts INT DEFAULT 0,
  recalls_passed INT DEFAULT 0,
  accuracy       FLOAT DEFAULT 0.0
);

CREATE TABLE behaviorpatterns (          -- "silently observed patterns with confidence scores"
  patternid        SERIAL PRIMARY KEY,
  userid           INT REFERENCES users(userid),
  pattern_type     VARCHAR(40),         -- e.g. best_review_time, weak_category, name_recall_struggle
  pattern_data     JSONB,
  confidence_score FLOAT DEFAULT 0.0,   -- 0..1, decays if not reinforced
  last_reinforced  DATE,
  status           VARCHAR(20) DEFAULT 'observed'  -- observed | confirmed | stale
);

CREATE TABLE chatmessages (
  messageid SERIAL PRIMARY KEY,
  userid    INT REFERENCES users(userid),
  role      VARCHAR(10) CHECK (role IN ('user','assistant')),
  messagetext TEXT,
  createdat TIMESTAMP DEFAULT NOW()
);

CREATE TABLE notifications (             -- morning check-in, due review, family alerts
  notificationid SERIAL PRIMARY KEY,
  userid          INT REFERENCES users(userid),
  type            VARCHAR(30) CHECK (type IN ('morning_checkin','due_review','family_alert')),
  message         TEXT,
  recipient       VARCHAR(150),          -- user email or family contact email
  status          VARCHAR(20) DEFAULT 'pending',  -- pending | sent | read
  createdat       TIMESTAMP DEFAULT NOW()
);
```

---

## 5. REST API Contract

Base URL `/api`, JSON, `Authorization: Bearer <JWT>` on everything except register/login.

| Method | Endpoint | Purpose | Use case |
|--------|----------|---------|----------|
| POST | `/auth/register` | Create account (bcrypt), seed default check-in | Register Account |
| POST | `/auth/login` | Verify → JWT | Login |
| GET / PUT | `/profile` | Read/update profile, family contact, check-in time, accessibility prefs | Manage Profile & Settings |
| POST | `/memories` | Save entry → Gemini question → save question + ReviewSchedule(next day) → return question & date | Log Memory Entry |
| GET | `/memories` | List active entries with next-review dates | Dashboard |
| POST | `/memories/:id/archive` | Soft-delete (`status='archived'`) | Manage Profile |
| GET | `/recall/due` | Questions due today (`nextreviewdate <= CURRENT_DATE`) | View Due Reviews |
| POST | `/recall/submit` | Store attempt → run SM-2 → update ReviewSchedule → adjust difficulty → update AnalyticsRecord → update recall streak | Complete Recall Session / Rate Recall Quality |
| GET | `/exercises/next` | Pick weakest category → pick technique rotation → AI guidance | Complete Exercise Session |
| POST | `/exercises/:id/complete` | Mark complete → update exercise streak + analytics | Complete Exercise Session |
| POST | `/chat` | Personalised reply (context pack + tone + Pattern Confidence rules) | Chat with AI Companion |
| GET | `/analytics` | Accuracy %, per-category stats, 30-day trend, streaks | View Analytics Dashboard |
| GET | `/checkin` | Today's AI morning-check-in message | Trigger Morning Check-In (scheduler) |
| POST | `/checkin/complete` | Record check-in, refresh `last_checkin_date` | adherence |
| GET | `/notifications` | List notifications (incl. family alerts copy) | — |

The **Family Member has no login** (§3.4.1 lists only *Receive Inactivity Alert*): alerts are delivered **by email** to `users.family_contact_email` and recorded in `notifications`.

---

## 6. AI Integration (Gemini API)

One shared client (`services/ai/client.py`): Gemini REST API behind a small provider adapter, model tiers from config (e.g. `gemini-3.6-flash`), per-user context pack builder, retry/timeout, and a **deterministic fallback** for every generation task so the system remains functional when the API is unavailable (§1.6 acknowledges API dependency). Fallback questions set `generatedbyai = FALSE`.

**Context pack (built fresh per call, per §2.2.2 "backend logic that collects and structures user data"):** age group · recent memories (title-less content + category) · recall performance per category · current streaks · confirmed behaviour patterns (confidence ≥ 0.6 only) · current difficulty levels.

### Prompt tasks

1. **Question generation** (FR-04) — inputs: memory content, category, context note, difficulty level (1/2/3). Difficulty semantics: 1 = direct "what/when" question; 2 = requires connecting detail + context; 3 = inference/why/how, partial-information prompts. Output: a single plain-language question an elderly Nigerian user can read effortlessly.
2. **Exercise guidance** (FR-08) — inputs: technique, target category, a sample memory. Output: step-by-step guidance in short numbered steps.
3. **Chat response** (FR-09/FR-10/FR-11) — tone: warm, patient, simplified for `above-65`; slightly more conversational for `51-65`. Hard safety rules in the system prompt: **never assert that an event happened**; only "it looks like…, but I can't be certain — is this right?"; no medical advice; ask for confirmation before treating anything as fact.
4. **Morning check-in** (FR-14) — short warm greeting, today's due-review count, one encouragement.
5. **Motivational message** (FR-13) — one line for the analytics dashboard from real stats.

### Pattern Confidence Module (FR-10)

- Pure-Python service writing to `behaviorpatterns`.
- Nightly job: every observed-but-unconfirmed pattern gets `confidence_score *= 0.9` (decay rate configurable); patterns below 0.3 are marked `stale` and excluded from AI context.
- User confirmations in chat/logging raise confidence and set `last_reinforced`.
- Only patterns with confidence ≥ 0.6 enter the AI context pack, and only as *possibilities*.

---

## 7. Scheduler (in-process APScheduler)

| Job | Schedule | Action |
|-----|----------|--------|
| Morning check-in | Every minute, match users by `checkintime` | Generate Gemini message → `notifications` row → dashboard greeting |
| Pattern confidence decay | Daily 02:00 | Decay scores, mark stale (§6) |
| Family connection alert | Hourly | Users whose `last_checkin_date`/`last_activity_date` exceed `inactivity_threshold_hours` (default 24) → email `family_contact_email` + `notifications` row (`type='family_alert'`) |

Production note: for multi-process deployments switch the job store to PostgreSQL/Redis; single-process dev is fine for the prototype.

---

## 8. Core Algorithms

### 8.1 SM-2 (FR-05) — port `sm2.js` to `services/sm2.py` verbatim

- q < 3 → repetition = 0, interval = 1 (review tomorrow).
- q ≥ 3 → rep 1: 1 day; rep 2: 6 days; rep ≥ 3: `interval × easefactor`.
- `EF' = EF + (0.1 − (5−q) × (0.08 + (5−q) × 0.02))`, floored at 1.3.
- `passed = q ≥ 3`. **Parity unit tests** against the JS version.

### 8.2 Difficulty adjustment (FR-07) — design decision fulfilling §3.4.4 "adjusts the difficulty level"

- q ≥ 4 → difficulty + 1 (max 3).
- q = 3 → unchanged.
- q ≤ 2 → difficulty reset to 1 **and** the question is regenerated for that memory at difficulty 1 (keeps the 1:1 question-per-memory schema; full rating history preserved in `recallsessions`).

### 8.3 Streaks (FR-12)

- Recall streak: incremented when a day has ≥1 submitted recall; reset to 0 when a calendar day passes with none.
- Exercise streak: same rule on `last_exercise_date` / `exercise_streak`.
- Both updated inside the same DB transaction as the session record.

### 8.4 Analytics (FR-13) — all real, computed from `recallsessions`/`analyticsrecords`

- Overall accuracy = passed / total attempts (period: all-time + last 30 days).
- Bar chart: forgetting frequency (failed attempts) per category.
- Line chart: weekly accuracy over the last 8 weeks.
- Weakest category = lowest accuracy with ≥3 attempts (drives adaptive exercise selection).

---

## 9. Email (FR-15)

`smtplib` + STARTTLS, config from env (`SMTP_HOST/PORT/USER/PASS/FROM`). Development mode `EMAIL_BACKEND=console` prints alerts to the log so the flow is demoable without SMTP credentials.

---

## 10. Testing Plan

- **Unit:** SM-2 parity vs `sm2.js`; streak transitions (incl. day-boundary reset); decay math; difficulty rules; analytics computations.
- **Integration:** every endpoint against a throwaway Postgres schema (pytest + Flask test client); auth guards (401 without token).
- **AI:** prompt builders tested with a mocked AI client (assert structure, not prose); fallback path tested with the API forced down.
- **Scheduler:** job functions invoked directly with seeded data (inactivity → alert row + console email).
- **Manual/accessibility:** §11 checklist; Chrome + Firefox + mobile Safari; screen-reader smoke test on the recall flow.

---

## 11. Frontend (doc input/output design is binding)

**Stack decision — React 19 + Vite 8, in `frontend-react/`.** The document (line 107) names the frontend languages as *HTML, CSS, JavaScript*; it does not constrain the tooling. React and Vite are tooling, and a React application is still authored in HTML, CSS and JavaScript, so the document is satisfied. The migration was chosen because a final-year CS project is assessed on architecture as well as behaviour: the vanilla build was 10 self-contained HTML pages that each re-declared the sidebar, topbar and accessibility bar (~60 duplicated lines per page), had no component model, no router, no state management and no build pipeline. The React build replaces that with:

| Concern | Vanilla build | React build |
|---|---|---|
| Navigation markup | duplicated across 10 files | one `AppLayout` |
| Auth state | `localStorage` read per page | one `AuthContext` |
| API access | per-page scripts | one `lib/api.js` |
| Routing | full page reloads | `react-router` |
| Build | none | Vite (bundle + minify + sourcemaps) |
| Linting | none | oxlint, 0 errors |

The earlier vanilla build is retained unchanged in `frontend/` for reference and as a fallback; the backend is untouched and still serves it if present.

**Hard rules (§3.5.2) applied globally in `src/styles/global.css`:** inputs/selects/textareas `min-height: 56px`; every field has a visible `<label>` **above** it (never placeholder-only); body text ≥18 px; headings ≥24 px; error messages plain-language, friendly, non-alarming; password fields get show/hide toggles; font-size & high-contrast prefs. *(The old CSS used a 48 px touch target and ~15–16 px body text — raised.)*

| Route | Doc-required content |
|------|---------------------|
| `/`, `/login`, `/signup` | Registration captures age group, family contact email, check-in time; password toggle |
| **`/dashboard`** | Personalised AI morning greeting · count of memories due today · **exercise streak** · **recall streak** · recently logged memories with next-review dates (§3.5.3) |
| `/log-memory` | **Exactly three fields**: category (Names/Appointments/Tasks/Conversations/Medications), content, optional context note; confirmation shows generated question + next review date |
| `/recall` | One question per screen → text area to **type the answer** → **Reveal** (original memory) → **0–5 scale with plain-English labels** (0 "No recall" … 5 "Easy") → next question or session summary |
| **`/exercises` (NEW)** | Technique in plain language → AI step-by-step guidance → completion confirmation → streak update |
| `/chat` | Conversational thread; AI companion warm tone per age group (name "Aria" retained — cosmetic, non-conflicting) |
| `/analytics` | Accuracy % · forgetting-frequency **bar chart by category** · accuracy-over-time **line chart** · streak counters · AI motivational message (hand-rolled SVG charts — no charting dependency) |
| `/profile` | Profile fields, family contact, check-in time, inactivity threshold, accessibility prefs |

**Removed from the earlier frontend (not in document):** localStorage mock backend & silent API fallback; auto-minting of JWTs; "Explore as Eleanor" fake login (replaced by a seeded demo account with real credentials); hardcoded analytics numbers (89.4 % retention, 6-day streak, etc.); the "doctor report export" (not in the document — optional stretch, excluded from core scope). The API client surfaces errors honestly.

---

## 12. Gap Analysis — Document vs Existing Codebase (document wins)

| # | Document requires | Existing code has | Resolution |
|---|-------------------|-------------------|------------|
| G1 | Flask + PostgreSQL backend, JWT auth, bcrypt | `app.py` = 0 bytes; mock JWT auto-minted in localStorage | Build backend per §3–§7; delete mock auth |
| G2 | Gemini API for questions/exercises/chat/check-in | Keyword-based `simulateAIQuestionGeneration` / `simulateChatResponse` | Replace with real service + deterministic fallback |
| G3 | Categories: Names, Appointments, Tasks, Conversations, Medications | Family, Medical, Daily Routine, Special Moments | Re-seed five document categories everywhere |
| G4 | Memory = `content` + `contextnote` (3-field form) | title/date/notes/mood | Drop title/mood; form per §3.5.2 |
| G5 | Separate `recallquestions` (1:1) + `reviewschedules` tables; difficulty 1–3 | Question/answer/SM-2 embedded in each memory | Normalize to document schema |
| G6 | Typed answer before Reveal | Question → Reveal → Rate only | Rebuild recall flow per activity diagram |
| G7 | **Exercise sessions with six techniques** | **Entirely absent** | New `exercises.html` + backend (FR-08) |
| G8 | Dual real streaks | "6 days" hardcoded | Server-side streak manager |
| G9 | Pattern Confidence Module (scores, decay, confirmation) | Chat-text gimmick ("I don't know for certain…") | Real module (§6) keeping the same safety phrasing |
| G10 | Scheduler: check-in, decay, family alert | None | APScheduler jobs (§7) |
| G11 | Family connection = inactivity **alert** | Caregiver form fields only | Email + notifications (§9) |
| G12 | Age-based tone adaptation | Age group collected but unused | Tone adapter in chat/check-in prompts |
| G13 | Inputs ≥56 px, body ≥18 px, headings ≥24 px | 48 px targets, smaller body text | CSS audit & fix |
| G14 | Real analytics (accuracy %, forgetting by category, trend) | Mostly hardcoded; partial real | Full AnalyticsEngine (§8.4) |
| G15 | One AI-generated question per memory at difficulty 1, review next day | Seeded Q&A pairs | Generated at POST /memories time |

**What is worth keeping from the existing code:** the visual design language (`style.css` warm senior-friendly palette, layout shells, nav/accessibility controller `nav.js` after spec adjustments), the correct standard SM-2 implementation in `sm2.js` (ported to Python with parity tests), and the general page decomposition. Everything else is rebuilt to document spec.

---

## 13. Implementation Phases

| Phase | Scope | Deliverable | Est. (dev-days) |
|-------|-------|-------------|-----------------|
| **0. Foundation** | Repo layout, venv, `requirements.txt`, config, `.env.example`, Postgres provision, CORS, Flask skeleton, CI-less pytest harness | App boots; `/api/health` | 1–2 |
| **1. Data + Auth** | DDL, ORM models, seeds (5 categories, demo user Eleanor + family contact), register/login/profile endpoints | FR-01, FR-02 | 2–3 |
| **2. Memory + AI questions** | POST/GET/archive memories; Gemini question generator + fallback; ReviewSchedule creation (next day) | FR-03, FR-04 | 2–3 |
| **3. Recall engine** | `/recall/due`, `/recall/submit`, SM-2 port, difficulty rules, streaks, analytics records | FR-05, FR-06, FR-07, FR-12 | 3–4 |
| **4. Exercises** | Technique rotation, adaptive weak-category selection, AI guidance, completion flow | FR-08 | 3–4 |
| **5. Chat + Pattern Confidence** | Context pack, tone adapter, PC module (observe/score/decay), chat history | FR-09, FR-10, FR-11 | 3–4 |
| **6. Scheduler + Check-in + Family** | APScheduler jobs, notifications, SMTP/console email | FR-14, FR-15 | 2 |
| **7. Analytics engine** | Accuracy, per-category, trend, motivational message | FR-13 | 2 |
| **8. Frontend rebuild** | All pages to §11 spec; remove mocks; accessibility audit (FR-16) | Usable system end-to-end | 4–6 |
| **9. Testing** | Unit/integration/AI-mocked/manual per §10 | Test suite green | 3–4 |
| **10. Evaluation** | Usability pilot + effectiveness measurement per §14; report data | Evaluation results | ongoing |

Indicative total: **≈25–35 dev-days**. Phases 2–3 and 8 are the critical path; frontend can be parallelised against backend phases.

---

## 14. Evaluation Plan (Objectives 4 & 5)

- **Usability (Obj. 4):** task-completion test with elderly participants of varying tech literacy: register, log a memory, complete a recall session, complete an exercise, chat. Measure task success, time-on-task, error counts; collect a post-task questionnaire (SUS-style, adapted).
- **Effectiveness (Obj. 5):** for the pilot group, track recall accuracy trend over the evaluation period (real `recallsessions` data), streak consistency (adherence proxy), and session frequency from `notifications`/session tables.
- **System testing (Obj. 5):** the §10 suite; requirements traceability (every FR exercised by at least one test or verified manual check).
- Deliverable: evaluation report appendixing the original 50-respondent questionnaire findings (§1.5).

---

## 15. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Gemini API cost/latency/outage (§1.6 acknowledges) | Deterministic fallback generators; `generatedbyai` flag; caching of questions (1:1 per memory, regenerate only on difficulty reset) |
| Elderly users can't sustain engagement (§1.4: adherence > efficacy) | Adherence features (check-in, streaks, family alert) exactly per document; prototyping iterations with real elderly users |
| Email deliverability for family alerts | `EMAIL_BACKEND=console` dev mode; app-password SMTP config documented |
| Scheduler reliability in dev | In-process APScheduler for prototype; documented path to external cron for production |
| Personalisation feels thin early (§1.6) | Context pack prioritises confirmed patterns; UI copy sets expectations |

---

## 16. Definition of Done

1. Every FR-01…FR-16 demonstrable end-to-end against PostgreSQL with Gemini enabled **and** with the API key removed (fallback).
2. All §11 input/output rules visually verified.
3. Test suite green; SM-2 parity proven.
4. Scheduler jobs demonstrable (console email counts as demonstration).
5. Evaluation report produced.

---

## 17. Document Ambiguities & Proposed Resolutions (need sign-off)

| # | Ambiguity | Proposed resolution |
|---|-----------|---------------------|
| A1 | §1.5 lists **five** memory categories (Names, Appointments, Tasks, Conversations, Medications) but the `memorycategories` table in §3.5.1 lists four (Appointment, Task, Conversation, Medication) | Implement **five** per §1.5 (scope statement governs features); seed all five. "Names" maps naturally onto the Face-Name Association technique, strengthening this reading |
| A2 | §3.5.1 says "ten tables" but names **eleven** (5 detailed + 6 additional) | Implement all eleven; the list, not the count, is authoritative |
| A3 | Family alert delivery channel unspecified | Email to `family_contact_email` + `notifications` record (users have no login per the use case) |
| A4 | Morning-check-in delivery channel unspecified | In-app: dashboard greeting + `notifications` row; email optional extra |
| A5 | Difficulty increase implies new question, but schema is 1:1 memory↔question | Update the existing `recallquestions` row in place; history lives in `recallsessions` |
| A6 | Chat companion is unnamed in the document | Keep "Aria" from the existing UI (cosmetic only) |
| A7 | Threshold for family inactivity alert | Default 24 h (matches existing UI), stored per-user, configurable in profile |
| A8 | "Doctor report export" exists in current UI but not in the document | Excluded from core scope; optional stretch after §16 |
| A9 | The supplied Figma design (`Downloads/figmades`) lists **eleven** category chips, §3.5.1 lists four, §1.5 lists five | **Document wins → five categories kept.** Only the design's *visual* chip treatment was adopted |
| A10 | The Figma design labels every input with `placeholder=` only, with no `<label>` element anywhere | **Document wins → real `<label>`s added above all fields** (§3.5.2 forbids placeholder-only). The design's colours and typography were kept |
| A11 | The Figma `.chip` is ~35 px tall, below the doc's 56 px minimum touch target | **Document wins → chips raised to `min-height: 56px`** |

---

## 18. Visual Re-skin to the Supplied Figma Design (`Downloads/figmades`)

The Figma link itself is not machine-readable (the design renders client-side and the REST API needs a personal access token). The design was instead taken from the hand-written export in `Downloads/figmades` — eight `.jsx` files plus a 152-line `index.css` design system. That export is a **visual reference only**: it contains invented placeholder data ("Stephanie Grace K.", "@graceben", "Sunday Dinner at Sarah's House", "+1 badges", "94% accuracy") which was **not** ported. No API call, route or feature changed.

**Approach — remap the palette onto the existing token names.** `global.css` already had 50+ custom properties consumed by ~459 lines of layout CSS. Rather than rewrite every rule, the Figma values were assigned to those *same* token names, so every component inherited the new look automatically and no component's markup had to change for colour reasons.

| Figma token | Value | Mapped onto |
|---|---|---|
| `--teal-900` | `#006b62` | `--teal-forest` (primary) |
| `--teal-500` | `#00b5a5` | `--teal-accent`, stat-card fill |
| `--teal-300` | `#2dd4bf` | active nav, focus ring |
| `--teal-text` | `#1f8478` | `--teal-accent-dark`, secondary text |
| `--mint` | `#f3fbfa` | `--teal-mint`, `--bg-surface` |
| `--cream` | `#faf0e4` | `--cream`, memory cards |
| `--brown` | `#7a4a00` | field labels, SOCIAL/gold tag |
| `--sidebar` / `--sidebar-active` | `#1a1d1c` / `#25524c` | sidebar chrome |
| `--gold` | `#f5a623` | celebration accents |

**Typography.** `ABeeZee` (body), `Lilita One` (celebration), `Ubuntu Mono` (chips, panel labels, voice hint) — added via `index.html` and the `--font-mono` / `--font-celebrate` tokens.

**Component-level changes** (not just tokens): Figma's `.stat-card` (solid teal tile, label left / figure right, 94 px), `.memory-card` (warm cream panel), segmented recall progress bar, mono `.technique-chip`, and uppercase lettered badges. `h3` was raised from 20 px to the doc's 24 px heading floor.

**Accessibility raised, never lowered.** Three Figma controls sat below the document's 56 px touch target and were corrected rather than copied: `.a11y-btn` (40 px → 56 px), `.password-toggle` (40 px → 48 px inside a 56 px field), and the technique chip (~35 px → 56 px). A single app-wide `:focus-visible` ring replaced the button-only rule. High-contrast mode gained matching overrides for the new cream/gold surfaces.

**Verification.** 22 backend tests pass; the built stylesheet was confirmed to contain every Figma token and font; the served bundle was checked over HTTP on all ten routes; a source-level audit confirms every `<input>`/`<textarea>` has a `<label>` and no page uses placeholder-only labelling.

Pre-re-skin stylesheet retained at `src/styles/global.css.pre-figma-backup` for reverting.

## 19. Visual Refinement Pass (polish, not redesign)

A second pass tightened the look without altering structure, palette, features or flows. No markup was restructured and no backend code was touched; the work is CSS plus three small JSX cleanups of inline styles.

**Spacing scale.** Ad-hoc 14/18/22/26/30 px values were replaced by a 4 px-based scale, `--space-1` (4 px) … `--space-10` (64 px). Every padding, margin and gap now steps through it.

**Radius and elevation.** Moved to *one radius per role* — `--radius-xs` 6, `--radius-md` 14, `--radius-lg` 18, `--radius-xl` 24, `--radius-field` 14, `--radius-pill` 28. Cards had previously mixed 16 px and 20 px while a `--radius-field` token sat unused. The shadow ramp was replaced with a softer two-layer, teal-tinted set (`--shadow-sm` / `--shadow-lg` / `--shadow-pill`).

**Typography.** `h1`/`h2` were weight 400 but `h3` was 700 — an abrupt jump that ABeeZee (which ships only 400) rendered as a synthesised smear. All display headings are now 400 with per-level line-heights and letter-spacing; `h4` added; body `line-height` 1.65. Hierarchy is carried by size and colour, not faux-bold.

**Buttons.** Every variant now carries the same 2 px border, so outlined and filled buttons occupy identical boxes (previously an outlined button sat 2 px shorter on each axis beside a filled one). Added `.btn:active` feedback and a tidy disabled state.

**Forms.** Tighter label → hint → field rhythm; `--radius-field` applied; added `input:hover`, `input:disabled`, `input[type='number']`, and recoloured the select caret to the brand teal. `.form-message` switched from an amber box to a left-border accent with softer tones.

**Cards and badges.** `.card`, `.question-card` and the summary panels now share one treatment: hairline border, `--radius-xl`, `--shadow-sm`. Badges use `--radius-xs`.

**Shell.** Sidebar 272 px; the active-link accent bar moved from `border-right` to an inset `::after` pseudo-element so selecting an item no longer nudges its text 3 px left. Topbar and stage rhythm aligned to the scale.

**Responsive.** Rewritten to two breakpoints — `@media (max-width: 1024px)` (tablet: sidebar becomes a fixed drawer, stat grids 2-up) and a new `@media (max-width: 640px)` (phone: single column, tighter padding, stacked chat composer, wider bubbles).

**Stale-palette fixes (confirmed with the user).** Two spots that had bypassed the earlier token remap via inline styles were pointed at the current palette: `Charts.jsx` chart fills (`#14b8a6`/`#e11d48`/`#8e9ba7`/`rgba(20,184,166,.18)` → new `--chart-pass` / `--chart-forget` / `--chart-axis` / `--chart-grid` tokens) and an Analytics badge's leftover amber override. No new colours were introduced. The chart legend moved from inline styles to a `.chart-legend` class, and the landing aside's inline stat tiles to `.aside-stat` classes.

**Celebration moment.** `--font-celebrate` (Lilita One) was defined but applied nowhere; it now carries the session-complete heading and accuracy figure, keeping that one moment distinct.

**Token hygiene.** Removed six genuinely dead tokens (`--teal-accent`, `--teal-accent-dark`, `--teal-forest-dark`, `--radius-sm`, `--shadow-md`, `--emerald-success`, `--amber-warning`) after confirming zero references. Audit result: **no dangling `var()` references, no duplicate definitions, no dead tokens** except the four `--chart-*` ones, which are intentionally consumed by `Charts.jsx` inline styles (invisible to a CSS-only scan but verified present in the built bundle).

**Accessibility preserved.** Every binding §3.5.2 rule still holds: fields 56 px, labels above fields at 18 px, body ≥18 px, headings ≥24 px, plain-language messages, password toggle, text-size presets, high-contrast mode (now covering the cream/gold surfaces, `.badge-gold`, `.greeting-card`, `.technique-chip`, `.steps-list li` and `.form-message`). The `.a11y-btn` controls were deliberately kept at the full 56 px: the document's rule names "input fields", but its stated rationale — larger targets for elderly users with reduced fine motor control — applies squarely to these toggles.

**Verification.** `npm run build` clean; 22 backend tests pass; the served bundle confirmed over HTTP on all ten routes with every referenced asset returning 200 (no missing-resource console errors); stylesheet parses with balanced braces; a source-level scan confirms no stale old-palette literals remain.

Refinement revert point retained at `src/styles/global.css.pre-refine-backup`.

## 20. Dashboard Enrichment

The dashboard read as flat: four small, identical teal number tiles, a thin list, and — because the only notification was the morning check-in — the greeting sentence printed twice on one screen. The data was fine; the presentation gave nothing focal weight. No endpoint changed.

**Greeting band.** Now a real header: an uppercase mono date eyebrow, the greeting, the check-in message, and the check-in action pinned to the opposite end. Once the day's check-in is done the button is replaced by a quiet "Checked in today" confirmation chip instead of repeating the action.

**Stat tiles.** Each tile gained a tinted icon badge and a figure-above-label stack. The tiles are white on the cream page so teal is reserved for meaning: `.is-due` fills the tile brand-teal only when there is something to do — attention goes straight there without introducing a new colour.

**"Up next" band.** The most important action is a bordered strip with a left accent rule, an icon, and an explanation that adapts to the count; when nothing is due it still renders (offering an exercise instead), so the page never has a dead centre.

**Sections.** Added `.section-head` (title left, action right) and `.dash-section` spacing, plus a genuinely new **"Up next" spotlight** card showing the next memory with its category and review timing.

**Memory rows.** Each row gained a category icon (mapped from the doc's five categories) so rows are identifiable without reading them; notification rows use a distinct `.is-note` treatment on the plain surface rather than the cream memory tone.

**Duplicate removed.** The morning check-in notification repeats the greeting verbatim, so it is filtered out of the feed — it belongs in the greeting band, not echoed below it.

**Not touched.** Same palette, same tokens, same sections in the same order, same endpoints, same data. Responsive and high-contrast rules extended to cover every new class.

## 21. Display Settings Moved Off the Page Top; Greeting Becomes a Banner

**Display settings.** The text-size presets and high-contrast toggle sat in a bar pinned above all ten screens, pushing each page down ~70px and reading as chrome the user could not dismiss. §3.5.2 requires that these controls *exist and be reachable* — it does not require a permanent top strip. They moved behind a single "Display settings" button: initially in the sidebar footer for the signed-in shell, and in the top navigation for the public pages. The signed-in control later moved into the header settings panel only (§29). The panel closes on outside click and on Escape, and both the trigger (56px) and every option (48px) stay comfortably above the document's touch-target intent.

**Greeting becomes a banner.** It was a mint tile that looked like one more card. It is now a full-width brand-teal gradient banner — 190px tall, 40px heading, white check-in button (flipped so it stays the obvious action on the dark fill), and a soft radial glow for depth without a busy gradient. It stacks and shrinks correctly on phone, and high-contrast swaps it to a dark surface with the glow disabled.

**Stat tiles enlarged.** Tile min-height 104px → 132px, icon 46px → 58px, figure 32px → 42px, label 16px → 17px. The larger figure is scoped to the dashboard: the recall summary and analytics panels keep their 32px figure, which suits their denser layout.

`--bg-cream-alt` was removed — it existed only for the deleted bar.

## 22. Banner Reaches the Page Edges; Topbar Collapses

**Topbar.** The user block (avatar, name, "MemorAid member") was removed from the topbar — it duplicated the profile page and was the first thing on every screen. `initials` and the `user` binding went with it. The topbar is now `display: none` on desktop and exists only as the mobile menu bar, revealed at the 1024px breakpoint where the sidebar becomes a drawer. The page content therefore starts at the very top of the viewport on desktop.

**Banner to the edges.** The stage is now full-width (`padding: var(--space-6) 0 var(--space-8); width: 100%`) and each signed-in page wraps its ordinary content in `.stage-inner` (1140px column, `padding: 0 var(--space-7)`) — nine occurrences across the seven pages. The dashboard banner escapes that column with `.banner-bleed`, which cancels the stage's side padding with negative margins, so the teal fill reaches both edges. `.greeting-inner` holds the copy to the 1140px column so the text stays aligned with the page. The banner has no side margin and no corner radius: a banner that stops short of the edges reads as another card, not as the top of the page. Height is 240px with a 40px heading.

The bleed margins are re-declared at both breakpoints to match the stage padding (`--space-6` at 1024px, `--space-4` at 640px), so the banner stays edge-to-edge at every width.

**Not touched.** Same palette, same tokens, same sections in the same order, same endpoints, same data.

### Files changed this pass

`frontend-react/src/components/AppLayout.jsx` (topbar user block removed; `initials`/`user` dropped), `frontend-react/src/pages/{Dashboard,LogMemory,Recall,Exercises,Chat,Analytics,Profile}.jsx` (`.stage-inner`, and `.banner-bleed` on the dashboard), `frontend-react/src/styles/global.css` (`.app-stage`, `.stage-inner`, `.greeting-inner`, `.banner-bleed`, `.greeting-card`, both responsive blocks).

**Verified:** build clean; 22 backend tests pass; all ten routes and every asset 200; token audit has no dangling variables; no emoji; braces balanced; `.topbar-user`/`.avatar`/"MemorAid member"/`initials` absent from both the served CSS and the served JS.

## 23. Banner Corrected to the Content Column

The first attempt at the banner bleed overshot: `.app-stage` had been left with **no horizontal padding** (`padding: var(--space-6) 0 …; width: 100%`), so the negative bleed margins pushed the fill *outside the content column and across the sidebar*. The shell is a two-column grid (272px sidebar + `1fr`), so the stage's padding is what defines the content column's edges — removing it removed the boundary the bleed was supposed to respect.

**Fix.** The stage keeps its side padding (`padding: var(--space-6) var(--space-7) var(--space-8)`), and `.banner-bleed` cancels exactly that amount. The banner now reaches both edges of the content column and stops there; it can no longer reach the sidebar at any width. The bleed offset is re-declared at each breakpoint to match that breakpoint's stage padding — 32px at desktop, 24px at 1024px, 16px at 640px.

**Banner reduced.** Height 240px → 176px; heading 40px → 31px; body 19px → 18px; padding `--space-9` → `--space-7`; eyebrow 15px → 14px; corner glow 280px → 220px at lower opacity; shadow `--shadow-lg` → `--shadow-sm` (the banner no longer needs to float — it is a band, not a card). Phone heading 30px → 26px.

**Guard.** `.app-main` carries `min-width: 0`, which is what stops the `1fr` grid cell from being blown out by the negative margins. There is no `overflow-x` rule anywhere, and no `100vw` on the banner, so the bleed cannot create a horizontal scrollbar.

**Also fixed:** the first pass used `--shadow-md`, a token that had been removed earlier as unused. The banner now uses `--shadow-sm`, and the token audit is back to no dangling `var()` references.

## 24. Page Header: Avatar, Settings, Notifications

A header strip holding **exactly three controls**, anchored to the right-hand side of the content area, above the banner and all page content: notifications (bell, with an unread count), settings (gear), and the avatar (initials circle). No page title, no brand, no name or role label beside the avatar.

This **supersedes** the document-driven layout for the shell chrome. The user was explicit that their current instruction overrides the document, so the header is built to their spec rather than to §3.5's structure.

**Component.** `frontend-react/src/components/AppHeader.jsx` — new file. It fetches notifications once on mount via the existing `api.getNotifications()`, and holds its own popover state. Failure of that fetch is swallowed: the header is not essential chrome, so the page below must still work and the badge simply stays empty.

**Popovers.** All three controls open small panels rather than navigating away, so the header never becomes a place you have to leave the page from. Notifications lists the first six with a link through to the dashboard; settings carries the document-required display controls (`A11yBar`) plus profile and sign-out; the avatar shows the signed-in name and offers profile and sign-out. Every panel closes on outside click and on Escape.

**Icons.** Two added to `Icon.jsx`: `bell` and `settings`, both hand-written paths on the same 24×24 `stroke="currentColor"` convention as the rest, so no dependency was introduced.

**Layout.** `.app-header` is `display: flex; justify-content: flex-end` with the page's own background, so it sits flush on the cream surface as a utility strip rather than as a second toolbar. Controls are 48px squares. `.app-menu-bar` replaces `.app-topbar`: hidden on desktop, shown at ≤1024px where the sidebar becomes a drawer.

**One note on the settings control.** The document requires text-size presets and high contrast to be reachable, and they already lived behind "Display settings" in the sidebar. Rather than duplicate that logic, the header's settings panel rendered the same `A11yBar` component, so there was one implementation reachable from two places. The sidebar instance was later removed on request; the header settings panel is now the only signed-in home (§29).

**Superseded on request, not on evidence.** The document remains the tie-breaker for conflicts *within the implementation*; this header is a deliberate user-directed departure from it, recorded here so the divergence is traceable.

**Verified:** build clean (46 modules, +1 for the new component); 22 backend tests pass; all ten routes and every asset 200; render order confirmed in the served bundle as header → menu bar → stage/banner → content; `.app-topbar` absent from both CSS and JS; no dangling CSS variables; braces balanced.

## 25. Banner Loses Its Fill; Stat Tiles Take the Colour; Header Outlines

**Banner is now plain.** The teal gradient is gone — the greeting band carries the page's own background (`--bg-cream`) and no fill of its own, so the coloured tiles below it are what draw the eye. Because the band is no longer dark, its type flipped back to the light-surface palette: heading `--teal-900`, body `--text-muted`, eyebrow `--teal-text`, and the check-in button fills with `--teal-forest` on white. The corner wash was kept at reduced opacity so the band does not read as empty space. Still full-bleed via `.banner-bleed`.

**Stat tiles carry the colour.** They were white cards with a teal icon; they are now the coloured elements on the page. The fill is a 150° gradient with a light sheen (`::before`, a low-opacity highlight across the upper-left) and a hairline of light along the top edge (`::after`) — a glassy highlight rather than a flat fill or a washed-out gradient. Icons sit in a translucent white well, figures and labels in white, figure given a subtle text-shadow.

**Contrast correction.** The first version of the gradient ran from `--teal-500` (#00b5a5) to `--teal-forest`. Measured, white 17px labels on `--teal-500` come to **2.58:1** — below the document's 4.5:1 requirement for body text, and below even the 3:1 large-text floor. The gradient now runs `--teal-forest` → `--teal-900`: **6.4:1** at the light end and **10.2:1** at the dark end, so the tile is compliant no matter where a label sits. The `is-due` state deepened to `--teal-900` → `#00332f` rather than changing hue, and the high-contrast overrides were corrected to match.

**Header outlines.** Notifications and settings lost their border and background — they now sit directly on the page background, read by their icon alone, with a `--bg-surface` wash on hover. The avatar keeps its ring (`1px solid --border-card`), which is what marks it as the account control. This gives the cluster one focal point instead of three identical boxes.

**Token hygiene.** `--mint` became unused when the banner lost its fill and was removed.

**Verified:** build clean; 22 backend tests pass; all ten routes and every asset 200; contrast re-measured (6.4:1 / 10.2:1, both pass AA); no dangling CSS variables; braces balanced.

## 26. Notifications Move to Their Own Page

Notification messages were shown in the dashboard's "Recent messages" feed and again in the header bell popover — the same content in two places, neither of them a page you could link to. They now live on a dedicated `/notifications` screen.

**New page.** `frontend-react/src/pages/Notifications.jsx` lists every notification newest first (up to 100), with a type badge (Morning check-in · Reviews due · We missed you · Family alert), the date, an unread accent, per-row "Mark read" and **Delete**, and a "Mark all as read" action. Deleting asks for confirmation, updates the list and unread badge optimistically, and hides the message for good. Loading, empty and error states reuse the existing `Loading`, `empty-state`, `Toast` and `.memory-item.is-note` treatments, so no new visual language was introduced. A link through to Profile points at the reminder preferences (`NotificationPreferences`).

**Delete endpoint.** `DELETE /api/notifications/<id>` hides one row and returns the refreshed unread count. It is scoped to the signed-in user (another account gets a 404), and it is a **soft delete**: `deletedat` is set, every list/unread/read query filters deleted rows out, but the dedupe check still sees them so a scheduler run cannot recreate a reminder the user just deleted. `deletedat` is added to the startup schema upgrader (`db/migrate.py`), so existing SQLite/PostgreSQL databases upgrade in place. Scheduling, wording, preferences, push and email are unchanged.

**Dashboard.** The "Recent messages" section, its `notifications` state, the `getNotifications()` call and the duplicate-filtering rule were removed. Everything else on the dashboard — greeting band, stat tiles, up-next strip, recent memories, up-next card — is untouched; the page now fetches only the check-in and memories endpoints.

**Header.** The bell is now a plain link to `/notifications` instead of a popover, so notification text no longer appears on every screen. It keeps the unread dot, polls `/notifications/unread-count` once a minute, and listens for a `memoraid:notifications-changed` event the page fires after a read action so the badge clears immediately. Settings and avatar popovers are unchanged.

**Navigation and routing.** `/notifications` is registered inside `RequireAuth` + `AppLayout`, and a "Notifications" item with the bell icon was added to the sidebar directly after Dashboard. The API client's `getNotifications()` gained optional `limit` (the page asks for 100); the backend contract is unchanged.

**Not touched.** No Python notification logic, scheduler job, preference endpoint, push path or email delivery was modified.

**Verified:** `npm run build` clean (50 modules); `npm run lint` adds no new errors (warnings are pre-existing); all 57 notification tests pass (including 5 delete tests: hides the row from the list, refreshes the unread count, keeps the dedupe key effective, rejects another user's row, requires auth); `/notifications` and the rebuilt bundle return 200 from the served app.

## 27. Exercises Become a Tutor-Guided Session

The Exercises page used to describe a technique and offer one "Mark as complete" button, so an exercise was recorded after a single click. It now runs as a guided conversation: one instruction or question at a time, a response from the user, feedback, and a summary that is only saved after the final step.

**Session lifecycle.** `intro → running → paused → summary`. The intro keeps the existing technique badge, name, summary, focus area and "How it works" list, then adds **Start exercise** and keeps **Show me a different one**. Running shows a segmented progress bar and the current step only, with **Pause** and either **Continue** or **Check my answer**. Paused offers **Resume** and **Start again**. The summary shows the score, steps completed, recall performance, day streak, an encouraging message, **Repeat exercise** and **Finish**. Nothing is posted to `/exercises/complete` until the last step is reached; opening the page leaves the session incomplete.

**Six interactive scripts.** The scripts live in the new `frontend-react/src/lib/exerciseTutor.js`, one per existing technique:

- **Method of Loci** — choose three stops on a familiar route, place one item at each, walk the route and recall each item.
- **Elaborative Encoding** — use a saved memory or choose one, make a personal connection, put it in a full sentence, then repeat the connection.
- **Spaced Retrieval** — choose or use a saved memory, read it, recall it, take two guided breaths and recall it twice more.
- **Face–Name Association** — name a person, choose a facial feature, make a silly picture or rhyme, then recall name → feature and feature → name.
- **Chunking** — study a six-item shopping list, group it into three pairs, then recall the pairs twice in different orders.
- **Active Observation** — study a scene (a saved memory when available, otherwise a six-detail scene), recall as much as possible, review the full scene, and try again.

**Feedback and encouragement.** Recall answers are compared on meaningful words with a forgiving half-match rule, so "tea" works for "a cup of tea". A missed item never advances as a failure: the feedback repeats the correct item or pair in plain language, automatically reveals the step's hint, and invites one more mental picture. Any non-empty personal answer is accepted on the open-ended steps. Earlier wrong answers never block progress; the user always reaches the summary.

**Scoring.** Only self-test steps count towards the percentage (for example, three route recalls or three spaced retrievals); the score stored on the existing `ExerciseSession.score` field is that percentage. Techniques made entirely of open reflection show the percentage of steps completed instead. The existing `/api/exercises/complete` route, streak logic, model and history list are unchanged.

**Backend change.** `services/ai/exercise_guide.py` now includes `sample_content` in the `/api/exercises/next` response so the tutor can use the user's own memory. It is an additive field: generation, technique selection, session recording and all other endpoints are untouched.

**Design.** The session reuses `.question-card`, `.recall-progress`, `.reveal-panel`, `.form-group`, `.form-message`, `.stat-grid`, `.session-summary`, `.steps-list` and the existing button variants. The only new CSS is a wrapping `.tutor-actions` row and a calm teal `.form-message.is-info`; no existing styles were reworked.

**Verified:** `npm run build` clean (51 modules); `npm run lint` adds no new errors (warnings are pre-existing); a Node smoke check built all six scripts with and without a saved memory and resolved every prompt, example, evaluation and step count; the full backend suite passes (133 tests); `/exercises` and the rebuilt bundle return 200 from the served app.

## 28. Signed-In Layout Matches the 80% Browser-Zoom View

The first attempt only tightened spacing; the user confirmed the app still felt too zoomed in but liked the result at **80% browser zoom** and asked for that view to become the default at 100%. The signed-in shell now uses CSS `zoom: 0.8`, which scales layout as well as paint, so the 100% view is the previously approved 80% view.

**Zoom mechanics.** The override lives on `.app-shell`, so the public landing and auth surfaces are untouched. CSS `zoom` (unlike `transform`) shrinks the element's layout box, and the auto-width grid still fills the window. Viewport lengths inside the zoomed shell are divided by the zoom factor: `100 / 0.8 = 125`. `.app-shell` and the sidebar use `125vh`, the chat column uses `calc(125vh - 240px)`, and viewport-based caps (`100vw` / `70vw` / `84vw` / `90vw` / `60vh`) are scaled by 1.25 so popovers, toasts and chat bubbles keep the physical size they would have at real 80% browser zoom.

**Density adjustments retained.** The earlier pass also removed oversized chrome: 248px rail, 24px gutters, 30px app headings, 108px stat tiles, smaller card/question padding and a 1.5 line-height. Those values now render at 80% scale.

**Verified:** `npm run build` clean (51 modules); at a 1424×805 viewport the rendered sidebar is 198px wide, the header 51px tall, the 56px button becomes 45px on screen, the dashboard document is 1409×845, and there is no horizontal overflow. Narrow (500px) and desktop passes across dashboard, notifications, log-memory, recall, chat, analytics, exercises and profile show no clipping or horizontal scroll. The `125vh` rule fills the viewport where content is short and permits normal scrolling where it is taller.

## 29. Text Presets Actually Scale; Display Settings Only in the Header; Landing Photos

**Text size now works.** The presets previously changed `--font-scale` and the root `html` size, but almost every declaration used absolute `px`, so nothing visibly moved. All 180 `font-size` declarations in `global.css` are now `calc(<size>px * var(--font-scale-text))`; `:root` defaults the multiplier to 1, and `body[data-font-size='large']` / `xlarge` set it to 1.15 / 1.3. `body` and `.app-shell` also multiply `--body-font-size`, covering inherited text. Widths, heights, padding and the 56px touch targets are untouched — the setting changes type, not the interface scale. At a 1424×805 viewport the measured app sizes are: shell/body 18 → 20.7 → 23.4px, greeting heading 28 → 32.2 → 36.4px, stat figure 36 → 41.4 → 46.8px, with no horizontal overflow at any preset.

**Display settings moved out of the sidebar.** `A11yBar` is no longer imported or rendered by `AppLayout`; the header settings popover is its only signed-in home. The nested panel now expands inline under its trigger (`.header-panel .a11y-panel`), because the old upward-opening sidebar treatment would have opened above the viewport. Public pages keep their top-navigation control.

**Landing illustrations replaced with real photographs.** The hand-drawn hero portrait and circular testimonial portrait in `Landing.jsx` were removed. The hero now uses `public/landing-hero-senior.jpg` (Pexels photo 11883419, "Portrait of an Elderly Woman Smiling", by Adriane Erthal) and the testimonial uses `public/landing-testimonial-senior.jpg` (Pexels photo 11489432, "A Smiling Woman in Orange Crew Neck Shirt", by Mehmet Turgut Kirkgoz). Both are Pexels-licensed, downloaded at display resolution, and cropped with `object-fit: cover`; the testimonial sits in the existing 168px circular frame with a 4px border. The hero image fills the 260:200 mockup photo area at 360×277 on desktop. No SVG illustrations remain in either slot, and the landing page has no horizontal overflow.

**Verified:** `npm run build` clean (51 modules); the header settings panel opens in the viewport at 1424×805 and at Extra large, the size buttons update `body[data-font-size]` and `localStorage`, sidebar contains zero display-settings controls while the header contains one, both landing images load with natural sizes 1000×667 and 480×480, and all eight signed-in routes pass at Extra large on desktop (1440×900) and narrow (500px) widths without horizontal overflow or clipped content.



