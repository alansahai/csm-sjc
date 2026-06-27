-- Enable Supabase Realtime for all application tables.
-- Run this once in the Supabase SQL editor.
--
-- With this, every insert/update/delete is pushed to connected clients instantly,
-- so the app updates live without a page refresh. (The app also has a 10s polling
-- fallback in code, but this makes changes truly instant.)
--
-- Idempotent: safe to re-run — tables already in the publication are skipped.

DO $$
DECLARE
    t text;
    tbls text[] := ARRAY[
        'user_roles',
        'academic_years',
        'classes',
        'app_config',
        'students',
        'enrollments',
        'class_year_counters',
        'sessions',
        'assessments',
        'attendance',
        'scores',
        'early_angel_entries',
        'early_angel_daily_summary',
        'early_angel_leaderboard',
        'vbs_portals',
        'vbs_students',
        'vbs_attendance',
        'vbs_reports',
        'announcements',
        'homework',
        'homework_submissions',
        'activity_logs',
        'faculty_class_assignments'
    ];
BEGIN
    FOREACH t IN ARRAY tbls LOOP
        -- Only add tables that actually exist and aren't already published.
        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = t
        ) AND NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
            RAISE NOTICE 'Added % to supabase_realtime', t;
        END IF;
    END LOOP;
END $$;

-- Verify which tables are now realtime-enabled:
-- SELECT tablename FROM pg_publication_tables
-- WHERE pubname = 'supabase_realtime' AND schemaname = 'public' ORDER BY tablename;
