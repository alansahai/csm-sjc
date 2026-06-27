-- =====================================================
-- SUPABASE SCHEMA — CSM-SJC Catechism Management
-- Migrated from: Firebase Firestore
-- Safe to re-run: uses IF NOT EXISTS throughout
-- =====================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- CORE CONFIGURATION
-- =====================================================

CREATE TABLE IF NOT EXISTS app_config (
    id                      TEXT PRIMARY KEY DEFAULT 'global',
    active_academic_year_id TEXT,
    early_angel_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    vbs_enabled             BOOLEAN NOT NULL DEFAULT FALSE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT app_config_singleton CHECK (id = 'global')
);

-- =====================================================
-- ACADEMIC STRUCTURE
-- =====================================================

CREATE TABLE IF NOT EXISTS academic_years (
    id                TEXT PRIMARY KEY,
    year_label        TEXT NOT NULL,
    label             TEXT,
    start_date        DATE NOT NULL,
    end_date          DATE NOT NULL,
    status            TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('active', 'archived', 'draft')),
    previous_year_id  TEXT REFERENCES academic_years(id) ON DELETE SET NULL,
    migration_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_app_config_active_year'
    ) THEN
        ALTER TABLE app_config
            ADD CONSTRAINT fk_app_config_active_year
            FOREIGN KEY (active_academic_year_id)
            REFERENCES academic_years(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS classes (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

-- =====================================================
-- USERS & ROLES
-- =====================================================

CREATE TABLE IF NOT EXISTS user_roles (
    id                      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role                    TEXT NOT NULL CHECK (role IN ('admin', 'faculty')),
    class_id                TEXT REFERENCES classes(id) ON DELETE SET NULL,
    email                   TEXT,
    display_name            TEXT,
    phone                   TEXT,
    onboarding_completed    BOOLEAN NOT NULL DEFAULT FALSE,
    onboarding_completed_at TIMESTAMPTZ,
    onboarding_version      INTEGER NOT NULL DEFAULT 0,
    onboarding_checklist    JSONB NOT NULL DEFAULT '{}',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- STUDENTS & ENROLLMENT
-- =====================================================

CREATE TABLE IF NOT EXISTS students (
    student_id          TEXT PRIMARY KEY,
    first_name          TEXT NOT NULL,
    last_name           TEXT,
    full_name           TEXT GENERATED ALWAYS AS (
                            TRIM(first_name || ' ' || COALESCE(last_name, ''))
                        ) STORED,
    dob                 DATE,
    guardian            TEXT,
    phone               TEXT,
    email               TEXT,
    class_id            TEXT REFERENCES classes(id) ON DELETE SET NULL,
    notes               TEXT,
    behavior_note       TEXT,
    behavior_visibility BOOLEAN NOT NULL DEFAULT FALSE,
    anbiyam_name             TEXT,
    received_first_communion BOOLEAN NOT NULL DEFAULT FALSE,
    received_confirmation    BOOLEAN NOT NULL DEFAULT FALSE,
    register_no         INTEGER,
    father_name         TEXT,
    father_phone        TEXT,
    mother_name         TEXT,
    mother_phone        TEXT,
    emergency_name      TEXT,
    emergency_phone     TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS class_year_counters (
    id               TEXT PRIMARY KEY,
    academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    class_id         TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    count            INTEGER NOT NULL DEFAULT 0,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (academic_year_id, class_id)
);

CREATE TABLE IF NOT EXISTS enrollments (
    id                    TEXT PRIMARY KEY,
    academic_year_id      TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    class_id              TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    student_id            TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    register_no           INTEGER,
    status                TEXT NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'transferred')),
    full_name             TEXT,
    promoted_from_class   TEXT,
    promoted_from_year    TEXT,
    promoted_at           TIMESTAMPTZ,
    migrated_from_year_id TEXT REFERENCES academic_years(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (academic_year_id, class_id, student_id)
);

-- =====================================================
-- SESSIONS, ASSESSMENTS, ATTENDANCE, SCORES
-- =====================================================

CREATE TABLE IF NOT EXISTS sessions (
    id               TEXT PRIMARY KEY,
    session_date     DATE NOT NULL,
    status           TEXT NOT NULL DEFAULT 'Available'
                         CHECK (status IN ('Available', 'NoClass')),
    no_class_reason  TEXT,
    academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    class_id         TEXT REFERENCES classes(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assessments (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name             TEXT NOT NULL,
    assessment_date  DATE NOT NULL,
    total_marks      NUMERIC NOT NULL CHECK (total_marks >= 0),
    class_id         TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attendance (
    id               TEXT PRIMARY KEY,
    session_id       TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    student_id       TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    status           TEXT NOT NULL
                         CHECK (status IN ('Present', 'Absent', 'Late', 'Excused')),
    class_id         TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (session_id, student_id)
);

CREATE TABLE IF NOT EXISTS scores (
    id               TEXT PRIMARY KEY,
    assessment_id    UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
    student_id       TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    marks            NUMERIC CHECK (marks >= 0),
    class_id         TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (assessment_id, student_id)
);

-- =====================================================
-- EARLY ANGEL
-- =====================================================

CREATE TABLE IF NOT EXISTS early_angel_entries (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    class_id         TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    student_id       TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    student_name     TEXT NOT NULL,
    category         TEXT NOT NULL,
    points           INTEGER NOT NULL DEFAULT 0,
    notes            TEXT,
    entry_date       DATE NOT NULL,
    entry_time       TIME,
    academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS early_angel_daily_summary (
    id               TEXT PRIMARY KEY,
    class_id         TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    summary_date     DATE NOT NULL,
    student_id       TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    student_name     TEXT NOT NULL,
    points_total     INTEGER NOT NULL DEFAULT 0,
    entry_count      INTEGER NOT NULL DEFAULT 0,
    academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    last_updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    UNIQUE (academic_year_id, class_id, summary_date, student_id)
);

CREATE TABLE IF NOT EXISTS early_angel_leaderboard (
    id               TEXT PRIMARY KEY,
    class_id         TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    student_id       TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    student_name     TEXT NOT NULL,
    total_points     INTEGER NOT NULL DEFAULT 0,
    entry_count      INTEGER NOT NULL DEFAULT 0,
    last_entry_date  DATE,
    academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    last_updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    UNIQUE (academic_year_id, class_id, student_id)
);

-- =====================================================
-- VBS (Vacation Bible School)
-- =====================================================

CREATE TABLE IF NOT EXISTS vbs_portals (
    id               TEXT PRIMARY KEY,
    vbs_year         TEXT NOT NULL,
    academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    UNIQUE (academic_year_id, vbs_year)
);

CREATE TABLE IF NOT EXISTS vbs_students (
    id               TEXT PRIMARY KEY,
    portal_id        TEXT NOT NULL REFERENCES vbs_portals(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    full_name        TEXT,
    class_id         TEXT NOT NULL,
    student_id       TEXT NOT NULL,
    father           TEXT,
    phone            TEXT,
    vbs_year         TEXT NOT NULL,
    academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS vbs_attendance (
    id               TEXT PRIMARY KEY,
    portal_id        TEXT NOT NULL REFERENCES vbs_portals(id) ON DELETE CASCADE,
    vbs_student_id   TEXT NOT NULL REFERENCES vbs_students(id) ON DELETE CASCADE,
    class_id         TEXT NOT NULL,
    student_name     TEXT NOT NULL,
    status           TEXT NOT NULL CHECK (status IN ('Present', 'Absent')),
    vbs_date         DATE NOT NULL,
    vbs_year         TEXT NOT NULL,
    academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    UNIQUE (portal_id, vbs_student_id, vbs_date)
);

CREATE TABLE IF NOT EXISTS vbs_reports (
    id                TEXT PRIMARY KEY,
    report_type       TEXT NOT NULL
                          CHECK (report_type IN ('today', 'detailed', '100_percent')),
    vbs_year          TEXT NOT NULL,
    academic_year_id  TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    class_id          TEXT,
    report_date       DATE,
    entry_count       INTEGER,
    generated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    generated_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    generated_by_role TEXT,
    report_data       JSONB NOT NULL DEFAULT '{}'
);

-- =====================================================
-- ANNOUNCEMENTS, HOMEWORK, ACTIVITY LOGS
-- =====================================================

CREATE TABLE IF NOT EXISTS announcements (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title            TEXT NOT NULL,
    body             TEXT NOT NULL,
    audience         TEXT NOT NULL DEFAULT 'all'
                         CHECK (audience IN ('all', 'students', 'faculty')),
    expires_at       DATE,
    pinned           BOOLEAN NOT NULL DEFAULT FALSE,
    academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS homework (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title            TEXT NOT NULL,
    description      TEXT,
    subject          TEXT,
    due_date         DATE,
    class_id         TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    attachment_note  TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS homework_submissions (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    homework_id      UUID NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
    student_id       TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    class_id         TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    status           TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('submitted', 'pending')),
    submitted_at     TIMESTAMPTZ,
    notes            TEXT,
    UNIQUE (homework_id, student_id)
);

CREATE TABLE IF NOT EXISTS activity_logs (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    action     TEXT NOT NULL,
    details    JSONB NOT NULL DEFAULT '{}',
    user_email TEXT,
    uid        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- UTILITY FUNCTIONS (CREATE OR REPLACE — always safe)
-- =====================================================

CREATE OR REPLACE FUNCTION increment_field(
    p_table  TEXT,
    p_pk_col TEXT,
    p_pk_val TEXT,
    p_col    TEXT,
    p_amount NUMERIC
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    EXECUTE format(
        'UPDATE %I SET %I = %I + $1 WHERE %I = $2',
        p_table, p_col, p_col, p_pk_col
    ) USING p_amount, p_pk_val;
END;
$$;

CREATE OR REPLACE FUNCTION increment_class_year_counter(
    p_academic_year_id TEXT,
    p_class_id         TEXT
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_new_count  INTEGER;
    v_counter_id TEXT;
BEGIN
    v_counter_id := p_academic_year_id || '_' || p_class_id;

    INSERT INTO class_year_counters (id, academic_year_id, class_id, count, updated_at)
    VALUES (v_counter_id, p_academic_year_id, p_class_id, 1, NOW())
    ON CONFLICT (id) DO UPDATE
        SET count      = class_year_counters.count + 1,
            updated_at = NOW()
    RETURNING count INTO v_new_count;

    RETURN v_new_count;
END;
$$;

-- =====================================================
-- INDEXES (IF NOT EXISTS — safe to re-run)
-- =====================================================

-- user_roles
CREATE INDEX IF NOT EXISTS idx_user_roles_role     ON user_roles(role);
CREATE INDEX IF NOT EXISTS idx_user_roles_class_id ON user_roles(class_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_email    ON user_roles(email);

-- students
CREATE INDEX IF NOT EXISTS idx_students_class_id ON students(class_id);
CREATE INDEX IF NOT EXISTS idx_students_phone    ON students(phone);
CREATE INDEX IF NOT EXISTS idx_students_email    ON students(email);
CREATE INDEX IF NOT EXISTS idx_students_dob      ON students(dob);
CREATE INDEX IF NOT EXISTS idx_students_fullname ON students(full_name);

-- enrollments
CREATE INDEX IF NOT EXISTS idx_enrollments_year         ON enrollments(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_class        ON enrollments(class_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_student      ON enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_year_class   ON enrollments(academic_year_id, class_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_year_student ON enrollments(academic_year_id, student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_status       ON enrollments(status);

-- class_year_counters
CREATE INDEX IF NOT EXISTS idx_counters_year_class ON class_year_counters(academic_year_id, class_id);

-- sessions
CREATE INDEX IF NOT EXISTS idx_sessions_year       ON sessions(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_sessions_date       ON sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_sessions_class      ON sessions(class_id);
CREATE INDEX IF NOT EXISTS idx_sessions_year_class ON sessions(academic_year_id, class_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status     ON sessions(status);

-- assessments
CREATE INDEX IF NOT EXISTS idx_assessments_class      ON assessments(class_id);
CREATE INDEX IF NOT EXISTS idx_assessments_year       ON assessments(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_assessments_year_class ON assessments(academic_year_id, class_id);
CREATE INDEX IF NOT EXISTS idx_assessments_date       ON assessments(assessment_date);

-- attendance
CREATE INDEX IF NOT EXISTS idx_attendance_session    ON attendance(session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_student    ON attendance(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_class      ON attendance(class_id);
CREATE INDEX IF NOT EXISTS idx_attendance_year       ON attendance(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_attendance_year_class ON attendance(academic_year_id, class_id);
CREATE INDEX IF NOT EXISTS idx_attendance_status     ON attendance(status);

-- scores
CREATE INDEX IF NOT EXISTS idx_scores_assessment  ON scores(assessment_id);
CREATE INDEX IF NOT EXISTS idx_scores_student     ON scores(student_id);
CREATE INDEX IF NOT EXISTS idx_scores_class       ON scores(class_id);
CREATE INDEX IF NOT EXISTS idx_scores_year        ON scores(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_scores_year_class  ON scores(academic_year_id, class_id);

-- early_angel_entries
CREATE INDEX IF NOT EXISTS idx_ea_entries_class      ON early_angel_entries(class_id);
CREATE INDEX IF NOT EXISTS idx_ea_entries_student    ON early_angel_entries(student_id);
CREATE INDEX IF NOT EXISTS idx_ea_entries_year       ON early_angel_entries(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_ea_entries_date       ON early_angel_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_ea_entries_year_class ON early_angel_entries(academic_year_id, class_id);

-- early_angel_daily_summary
CREATE INDEX IF NOT EXISTS idx_ea_daily_year_class ON early_angel_daily_summary(academic_year_id, class_id);
CREATE INDEX IF NOT EXISTS idx_ea_daily_date       ON early_angel_daily_summary(summary_date);
CREATE INDEX IF NOT EXISTS idx_ea_daily_student    ON early_angel_daily_summary(student_id);

-- early_angel_leaderboard
CREATE INDEX IF NOT EXISTS idx_ea_lb_year_class ON early_angel_leaderboard(academic_year_id, class_id);
CREATE INDEX IF NOT EXISTS idx_ea_lb_student    ON early_angel_leaderboard(student_id);
CREATE INDEX IF NOT EXISTS idx_ea_lb_points     ON early_angel_leaderboard(total_points DESC);

-- vbs_students
CREATE INDEX IF NOT EXISTS idx_vbs_students_portal     ON vbs_students(portal_id);
CREATE INDEX IF NOT EXISTS idx_vbs_students_class      ON vbs_students(class_id);
CREATE INDEX IF NOT EXISTS idx_vbs_students_year       ON vbs_students(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_vbs_students_student_id ON vbs_students(student_id);

-- vbs_attendance
CREATE INDEX IF NOT EXISTS idx_vbs_att_portal  ON vbs_attendance(portal_id);
CREATE INDEX IF NOT EXISTS idx_vbs_att_student ON vbs_attendance(vbs_student_id);
CREATE INDEX IF NOT EXISTS idx_vbs_att_date    ON vbs_attendance(vbs_date);
CREATE INDEX IF NOT EXISTS idx_vbs_att_class   ON vbs_attendance(class_id);
CREATE INDEX IF NOT EXISTS idx_vbs_att_year    ON vbs_attendance(academic_year_id);

-- announcements
CREATE INDEX IF NOT EXISTS idx_announcements_year     ON announcements(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_announcements_audience ON announcements(audience);
CREATE INDEX IF NOT EXISTS idx_announcements_expires  ON announcements(expires_at);
CREATE INDEX IF NOT EXISTS idx_announcements_pinned   ON announcements(pinned) WHERE pinned = TRUE;

-- homework
CREATE INDEX IF NOT EXISTS idx_homework_class    ON homework(class_id);
CREATE INDEX IF NOT EXISTS idx_homework_year     ON homework(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_homework_due_date ON homework(due_date);

-- homework_submissions
CREATE INDEX IF NOT EXISTS idx_hw_subs_homework ON homework_submissions(homework_id);
CREATE INDEX IF NOT EXISTS idx_hw_subs_student  ON homework_submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_hw_subs_class    ON homework_submissions(class_id);
CREATE INDEX IF NOT EXISTS idx_hw_subs_year     ON homework_submissions(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_hw_subs_status   ON homework_submissions(status);

-- activity_logs
CREATE INDEX IF NOT EXISTS idx_activity_logs_uid        ON activity_logs(uid);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC);

-- =====================================================
-- SEED: App config singleton row
-- =====================================================

INSERT INTO app_config (id, early_angel_enabled, vbs_enabled)
VALUES ('global', FALSE, FALSE)
ON CONFLICT (id) DO NOTHING;
