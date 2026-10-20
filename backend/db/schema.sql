-- MemorAid (IMRS) — PostgreSQL schema
-- Document of proof: Memoraid-123.docx section 3.5.1 (database design).
-- Eleven tables: five documented field-by-field (verbatim below) and six
-- whose fields are inferred from the class-diagram descriptions (3.4.2).
--
-- NOTE: The application itself creates tables through SQLAlchemy models
-- (models.py) so the prototype can also run on SQLite for development.
-- This file is the authoritative PostgreSQL DDL for real deployments.

CREATE TABLE IF NOT EXISTS users (
    userid               SERIAL PRIMARY KEY,
    fullname             VARCHAR(100) NOT NULL,
    email                VARCHAR(150) UNIQUE NOT NULL,
    passwordhash         VARCHAR(255) NOT NULL,
    agegroup             VARCHAR(20) NOT NULL CHECK (agegroup IN ('51-65', 'above-65')),
    accessibilitypref    VARCHAR(50),
    family_contact_email VARCHAR(150),
    exercise_streak      INT DEFAULT 0,
    recall_streak        INT DEFAULT 0,
    last_exercise_date   DATE,
    createdat            TIMESTAMP DEFAULT NOW(),
    isactive             BOOLEAN DEFAULT TRUE,
    -- operational fields inferred by the implementation plan (sections 17, 7):
    checkintime               TIME DEFAULT '08:00',
    last_checkin_date         DATE,
    last_activity_date        DATE,
    last_recall_date          DATE,
    inactivity_threshold_hours INT DEFAULT 24,
    family_alert_sent_date    DATE
);

CREATE TABLE IF NOT EXISTS memorycategories (
    categoryid   SERIAL PRIMARY KEY,
    categoryname VARCHAR(50) UNIQUE NOT NULL,
    description  VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS memoryentries (
    memoryid    SERIAL PRIMARY KEY,
    userid      INT REFERENCES users(userid),
    categoryid  INT REFERENCES memorycategories(categoryid),
    content     TEXT NOT NULL,
    contextnote TEXT,
    datecreated TIMESTAMP DEFAULT NOW(),
    status      VARCHAR(20) DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS recallquestions (
    questionid      SERIAL PRIMARY KEY,
    memoryid        INT UNIQUE REFERENCES memoryentries(memoryid),
    questiontext    TEXT NOT NULL,
    answerkey       TEXT,
    difficultylevel INT DEFAULT 1 CHECK (difficultylevel BETWEEN 1 AND 3),
    generatedbyai   BOOLEAN DEFAULT TRUE,
    dategenerated   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reviewschedules (
    scheduleid     SERIAL PRIMARY KEY,
    memoryid       INT UNIQUE REFERENCES memoryentries(memoryid),
    nextreviewdate DATE NOT NULL,
    interval       INT DEFAULT 1,
    repetition     INT DEFAULT 0,
    easefactor     FLOAT DEFAULT 2.5,
    lastreviewdate DATE
);

CREATE TABLE IF NOT EXISTS recallsessions (
    sessionid    SERIAL PRIMARY KEY,
    userid       INT REFERENCES users(userid),
    questionid   INT REFERENCES recallquestions(questionid),
    memoryid     INT REFERENCES memoryentries(memoryid),
    userresponse TEXT,
    quality      INT CHECK (quality BETWEEN 0 AND 5),
    passed       BOOLEAN,
    difficulty   INT,
    sessiondate  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exercisesessions (
    exerciseid    SERIAL PRIMARY KEY,
    userid        INT REFERENCES users(userid),
    technique     VARCHAR(40) NOT NULL CHECK (technique IN
                    ('method_of_loci', 'elaborative_encoding', 'spaced_retrieval',
                     'face_name_association', 'chunking', 'active_observation')),
    categoryid    INT REFERENCES memorycategories(categoryid),
    guidance_text TEXT,
    completed     BOOLEAN DEFAULT FALSE,
    score         INT,
    sessiondate   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analyticsrecords (
    recordid       SERIAL PRIMARY KEY,
    userid         INT REFERENCES users(userid),
    categoryid     INT REFERENCES memorycategories(categoryid),
    period         DATE DEFAULT CURRENT_DATE,
    total_attempts INT DEFAULT 0,
    recalls_passed INT DEFAULT 0,
    accuracy       FLOAT DEFAULT 0.0,
    UNIQUE (userid, categoryid, period)
);

CREATE TABLE IF NOT EXISTS behaviorpatterns (
    patternid        SERIAL PRIMARY KEY,
    userid           INT REFERENCES users(userid),
    pattern_type     VARCHAR(40),
    pattern_data     JSONB,
    confidence_score FLOAT DEFAULT 0.0,
    last_reinforced  DATE,
    status           VARCHAR(20) DEFAULT 'observed'
);

CREATE TABLE IF NOT EXISTS chatmessages (
    messageid   SERIAL PRIMARY KEY,
    userid      INT REFERENCES users(userid),
    role        VARCHAR(10) CHECK (role IN ('user', 'assistant')),
    messagetext TEXT,
    createdat   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
    notificationid SERIAL PRIMARY KEY,
    userid         INT REFERENCES users(userid),
    type           VARCHAR(30) CHECK (type IN ('morning_checkin', 'due_review', 'family_alert')),
    message        TEXT,
    recipient      VARCHAR(150),
    status         VARCHAR(20) DEFAULT 'pending',
    createdat      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memoryentries_user ON memoryentries(userid, status);
CREATE INDEX IF NOT EXISTS idx_reviewschedules_due ON reviewschedules(nextreviewdate);
CREATE INDEX IF NOT EXISTS idx_recallsessions_user ON recallsessions(userid, sessiondate);
CREATE INDEX IF NOT EXISTS idx_behaviorpatterns_user ON behaviorpatterns(userid, status);
