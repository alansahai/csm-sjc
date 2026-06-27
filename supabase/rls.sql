-- =====================================================
-- ROW LEVEL SECURITY — CSM-SJC Catechism Management
-- Equivalent to firestore.rules for Supabase/PostgreSQL
-- Run AFTER schema.sql in the Supabase SQL Editor
-- Safe to re-run: drops existing policies before recreating them
-- =====================================================

-- =====================================================
-- HELPER FUNCTIONS (CREATE OR REPLACE — always safe)
-- SECURITY DEFINER lets these bypass RLS so they can
-- look up roles without infinite recursion.
-- =====================================================

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION is_faculty()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE id = auth.uid() AND role = 'faculty'
  );
$$;

CREATE OR REPLACE FUNCTION get_faculty_class_id()
RETURNS TEXT LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT class_id FROM user_roles
  WHERE id = auth.uid() AND role = 'faculty'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION get_active_academic_year_id()
RETURNS TEXT LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT active_academic_year_id FROM app_config WHERE id = 'global' LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION get_previous_year_id()
RETURNS TEXT LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT ay.previous_year_id
  FROM academic_years ay
  WHERE ay.id = get_active_academic_year_id()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION is_migration_enabled()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT COALESCE(migration_enabled, FALSE)
  FROM academic_years
  WHERE id = get_active_academic_year_id()
  LIMIT 1;
$$;

-- =====================================================
-- ENABLE RLS ON ALL TABLES
-- =====================================================

ALTER TABLE app_config                ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_years            ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles                ENABLE ROW LEVEL SECURITY;
ALTER TABLE students                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_year_counters       ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments               ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessments               ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance                ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE early_angel_entries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE early_angel_daily_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE early_angel_leaderboard   ENABLE ROW LEVEL SECURITY;
ALTER TABLE vbs_portals               ENABLE ROW LEVEL SECURITY;
ALTER TABLE vbs_students              ENABLE ROW LEVEL SECURITY;
ALTER TABLE vbs_attendance            ENABLE ROW LEVEL SECURITY;
ALTER TABLE vbs_reports               ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements             ENABLE ROW LEVEL SECURITY;
ALTER TABLE homework                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE homework_submissions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs             ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- DROP ALL EXISTING POLICIES (idempotent cleanup)
-- =====================================================

DROP POLICY IF EXISTS "app_config_read"                   ON app_config;
DROP POLICY IF EXISTS "app_config_write"                  ON app_config;

DROP POLICY IF EXISTS "academic_years_read"               ON academic_years;
DROP POLICY IF EXISTS "academic_years_write"              ON academic_years;

DROP POLICY IF EXISTS "classes_read"                      ON classes;
DROP POLICY IF EXISTS "classes_write"                     ON classes;

DROP POLICY IF EXISTS "user_roles_read"                   ON user_roles;
DROP POLICY IF EXISTS "user_roles_admin_write"            ON user_roles;
DROP POLICY IF EXISTS "user_roles_faculty_self_update"    ON user_roles;
DROP POLICY IF EXISTS "user_roles_faculty_self_insert"    ON user_roles;

DROP POLICY IF EXISTS "students_read_staff"               ON students;
DROP POLICY IF EXISTS "students_read_anon"                ON students;
DROP POLICY IF EXISTS "students_admin_write"              ON students;
DROP POLICY IF EXISTS "students_faculty_write"            ON students;
DROP POLICY IF EXISTS "students_faculty_update"           ON students;

DROP POLICY IF EXISTS "counters_read"                     ON class_year_counters;
DROP POLICY IF EXISTS "counters_write"                    ON class_year_counters;

DROP POLICY IF EXISTS "enrollments_read_admin"            ON enrollments;
DROP POLICY IF EXISTS "enrollments_read_faculty"          ON enrollments;
DROP POLICY IF EXISTS "enrollments_read_anon"             ON enrollments;
DROP POLICY IF EXISTS "enrollments_admin_write"           ON enrollments;

DROP POLICY IF EXISTS "sessions_read_admin"               ON sessions;
DROP POLICY IF EXISTS "sessions_read_faculty"             ON sessions;
DROP POLICY IF EXISTS "sessions_read_anon"                ON sessions;
DROP POLICY IF EXISTS "sessions_admin_write"              ON sessions;
DROP POLICY IF EXISTS "sessions_faculty_write"            ON sessions;
DROP POLICY IF EXISTS "sessions_faculty_update"           ON sessions;

DROP POLICY IF EXISTS "assessments_read_admin"            ON assessments;
DROP POLICY IF EXISTS "assessments_read_faculty"          ON assessments;
DROP POLICY IF EXISTS "assessments_read_anon"             ON assessments;
DROP POLICY IF EXISTS "assessments_admin_write"           ON assessments;
DROP POLICY IF EXISTS "assessments_faculty_write"         ON assessments;
DROP POLICY IF EXISTS "assessments_faculty_update"        ON assessments;
DROP POLICY IF EXISTS "assessments_faculty_delete"        ON assessments;

DROP POLICY IF EXISTS "attendance_read_admin"             ON attendance;
DROP POLICY IF EXISTS "attendance_read_faculty"           ON attendance;
DROP POLICY IF EXISTS "attendance_read_anon"              ON attendance;
DROP POLICY IF EXISTS "attendance_admin_write"            ON attendance;
DROP POLICY IF EXISTS "attendance_faculty_insert"         ON attendance;
DROP POLICY IF EXISTS "attendance_faculty_update"         ON attendance;
DROP POLICY IF EXISTS "attendance_faculty_delete"         ON attendance;

DROP POLICY IF EXISTS "scores_read_admin"                 ON scores;
DROP POLICY IF EXISTS "scores_read_faculty"               ON scores;
DROP POLICY IF EXISTS "scores_read_anon"                  ON scores;
DROP POLICY IF EXISTS "scores_admin_write"                ON scores;
DROP POLICY IF EXISTS "scores_faculty_insert"             ON scores;
DROP POLICY IF EXISTS "scores_faculty_update"             ON scores;

DROP POLICY IF EXISTS "ea_entries_read_admin"             ON early_angel_entries;
DROP POLICY IF EXISTS "ea_entries_read_faculty"           ON early_angel_entries;
DROP POLICY IF EXISTS "ea_entries_read_anon"              ON early_angel_entries;
DROP POLICY IF EXISTS "ea_entries_admin_write"            ON early_angel_entries;
DROP POLICY IF EXISTS "ea_entries_faculty_insert"         ON early_angel_entries;
DROP POLICY IF EXISTS "ea_entries_faculty_update"         ON early_angel_entries;
DROP POLICY IF EXISTS "ea_entries_faculty_delete"         ON early_angel_entries;

DROP POLICY IF EXISTS "ea_daily_read_admin"               ON early_angel_daily_summary;
DROP POLICY IF EXISTS "ea_daily_read_faculty"             ON early_angel_daily_summary;
DROP POLICY IF EXISTS "ea_daily_read_anon"                ON early_angel_daily_summary;
DROP POLICY IF EXISTS "ea_daily_admin_write"              ON early_angel_daily_summary;
DROP POLICY IF EXISTS "ea_daily_faculty_upsert"           ON early_angel_daily_summary;
DROP POLICY IF EXISTS "ea_daily_faculty_update"           ON early_angel_daily_summary;
DROP POLICY IF EXISTS "ea_daily_faculty_delete"           ON early_angel_daily_summary;

DROP POLICY IF EXISTS "ea_lb_read_admin"                  ON early_angel_leaderboard;
DROP POLICY IF EXISTS "ea_lb_read_faculty"                ON early_angel_leaderboard;
DROP POLICY IF EXISTS "ea_lb_read_anon"                   ON early_angel_leaderboard;
DROP POLICY IF EXISTS "ea_lb_admin_write"                 ON early_angel_leaderboard;
DROP POLICY IF EXISTS "ea_lb_faculty_upsert"              ON early_angel_leaderboard;
DROP POLICY IF EXISTS "ea_lb_faculty_update"              ON early_angel_leaderboard;
DROP POLICY IF EXISTS "ea_lb_faculty_delete"              ON early_angel_leaderboard;

DROP POLICY IF EXISTS "vbs_portals_read"                  ON vbs_portals;
DROP POLICY IF EXISTS "vbs_portals_write"                 ON vbs_portals;

DROP POLICY IF EXISTS "vbs_students_read_admin"           ON vbs_students;
DROP POLICY IF EXISTS "vbs_students_read_faculty"         ON vbs_students;
DROP POLICY IF EXISTS "vbs_students_admin_write"          ON vbs_students;
DROP POLICY IF EXISTS "vbs_students_faculty_write"        ON vbs_students;
DROP POLICY IF EXISTS "vbs_students_faculty_update"       ON vbs_students;
DROP POLICY IF EXISTS "vbs_students_faculty_delete"       ON vbs_students;

DROP POLICY IF EXISTS "vbs_att_read_admin"                ON vbs_attendance;
DROP POLICY IF EXISTS "vbs_att_read_faculty"              ON vbs_attendance;
DROP POLICY IF EXISTS "vbs_att_admin_write"               ON vbs_attendance;
DROP POLICY IF EXISTS "vbs_att_faculty_write"             ON vbs_attendance;
DROP POLICY IF EXISTS "vbs_att_faculty_update"            ON vbs_attendance;
DROP POLICY IF EXISTS "vbs_att_faculty_delete"            ON vbs_attendance;

DROP POLICY IF EXISTS "vbs_reports_read"                  ON vbs_reports;
DROP POLICY IF EXISTS "vbs_reports_write"                 ON vbs_reports;

DROP POLICY IF EXISTS "announcements_read_public"         ON announcements;
DROP POLICY IF EXISTS "announcements_admin_write"         ON announcements;

DROP POLICY IF EXISTS "homework_read_public"              ON homework;
DROP POLICY IF EXISTS "homework_write"                    ON homework;

DROP POLICY IF EXISTS "hw_subs_read_public"               ON homework_submissions;
DROP POLICY IF EXISTS "hw_subs_write"                     ON homework_submissions;

DROP POLICY IF EXISTS "activity_logs_admin_read"          ON activity_logs;
DROP POLICY IF EXISTS "activity_logs_authenticated_insert" ON activity_logs;

-- =====================================================
-- app_config
-- Public read — student/parent login needs activeAcademicYearId before any auth session
-- =====================================================

CREATE POLICY "app_config_read"
  ON app_config FOR SELECT USING (TRUE);

CREATE POLICY "app_config_write"
  ON app_config FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

-- =====================================================
-- academic_years  (public read — student portal needs year info)
-- =====================================================

CREATE POLICY "academic_years_read"
  ON academic_years FOR SELECT USING (TRUE);

CREATE POLICY "academic_years_write"
  ON academic_years FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

-- =====================================================
-- classes  (public read — needed by student/parent portal)
-- =====================================================

CREATE POLICY "classes_read"
  ON classes FOR SELECT USING (TRUE);

CREATE POLICY "classes_write"
  ON classes FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

-- =====================================================
-- user_roles
-- =====================================================

CREATE POLICY "user_roles_read"
  ON user_roles FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "user_roles_admin_write"
  ON user_roles FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "user_roles_faculty_self_update"
  ON user_roles FOR UPDATE
  USING  (auth.uid() = id AND role = 'faculty')
  WITH CHECK (auth.uid() = id AND role = 'faculty');

CREATE POLICY "user_roles_faculty_self_insert"
  ON user_roles FOR INSERT
  WITH CHECK (auth.uid() = id AND role = 'faculty');

-- =====================================================
-- students
-- =====================================================

CREATE POLICY "students_read_staff"
  ON students FOR SELECT
  USING (is_admin() OR is_faculty());

CREATE POLICY "students_read_anon"
  ON students FOR SELECT
  USING (auth.role() = 'anon');

CREATE POLICY "students_admin_write"
  ON students FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "students_faculty_write"
  ON students FOR INSERT
  WITH CHECK (is_faculty() AND class_id = get_faculty_class_id());

CREATE POLICY "students_faculty_update"
  ON students FOR UPDATE
  USING  (is_faculty() AND class_id = get_faculty_class_id())
  WITH CHECK (is_faculty() AND class_id = get_faculty_class_id());

-- =====================================================
-- class_year_counters
-- =====================================================

CREATE POLICY "counters_read"
  ON class_year_counters FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "counters_write"
  ON class_year_counters FOR ALL
  USING  (is_admin() OR is_faculty())
  WITH CHECK (is_admin() OR is_faculty());

-- =====================================================
-- enrollments
-- =====================================================

CREATE POLICY "enrollments_read_admin"
  ON enrollments FOR SELECT USING (is_admin());

CREATE POLICY "enrollments_read_faculty"
  ON enrollments FOR SELECT
  USING (is_faculty() AND class_id = get_faculty_class_id());

CREATE POLICY "enrollments_read_anon"
  ON enrollments FOR SELECT USING (auth.role() = 'anon');

CREATE POLICY "enrollments_admin_write"
  ON enrollments FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

-- =====================================================
-- sessions
-- =====================================================

CREATE POLICY "sessions_read_admin"
  ON sessions FOR SELECT USING (is_admin());

CREATE POLICY "sessions_read_faculty"
  ON sessions FOR SELECT
  USING (
    is_faculty()
    AND (
      academic_year_id = get_active_academic_year_id()
      OR (is_migration_enabled() AND academic_year_id = get_previous_year_id())
    )
  );

CREATE POLICY "sessions_read_anon"
  ON sessions FOR SELECT USING (auth.role() = 'anon');

CREATE POLICY "sessions_admin_write"
  ON sessions FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "sessions_faculty_write"
  ON sessions FOR INSERT
  WITH CHECK (is_faculty() AND academic_year_id = get_active_academic_year_id());

CREATE POLICY "sessions_faculty_update"
  ON sessions FOR UPDATE
  USING  (is_faculty() AND academic_year_id = get_active_academic_year_id())
  WITH CHECK (is_faculty() AND academic_year_id = get_active_academic_year_id());

-- =====================================================
-- assessments
-- =====================================================

CREATE POLICY "assessments_read_admin"
  ON assessments FOR SELECT USING (is_admin());

CREATE POLICY "assessments_read_faculty"
  ON assessments FOR SELECT
  USING (is_faculty() AND class_id = get_faculty_class_id() AND academic_year_id = get_active_academic_year_id());

CREATE POLICY "assessments_read_anon"
  ON assessments FOR SELECT USING (auth.role() = 'anon');

CREATE POLICY "assessments_admin_write"
  ON assessments FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "assessments_faculty_write"
  ON assessments FOR INSERT
  WITH CHECK (is_faculty() AND class_id = get_faculty_class_id() AND academic_year_id = get_active_academic_year_id());

CREATE POLICY "assessments_faculty_update"
  ON assessments FOR UPDATE
  USING  (is_faculty() AND class_id = get_faculty_class_id() AND academic_year_id = get_active_academic_year_id())
  WITH CHECK (is_faculty() AND class_id = get_faculty_class_id() AND academic_year_id = get_active_academic_year_id());

CREATE POLICY "assessments_faculty_delete"
  ON assessments FOR DELETE
  USING (is_faculty() AND class_id = get_faculty_class_id() AND academic_year_id = get_active_academic_year_id());

-- =====================================================
-- attendance
-- =====================================================

CREATE POLICY "attendance_read_admin"
  ON attendance FOR SELECT USING (is_admin());

CREATE POLICY "attendance_read_faculty"
  ON attendance FOR SELECT
  USING (is_faculty() AND class_id = get_faculty_class_id() AND academic_year_id = get_active_academic_year_id());

CREATE POLICY "attendance_read_anon"
  ON attendance FOR SELECT USING (auth.role() = 'anon');

CREATE POLICY "attendance_admin_write"
  ON attendance FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "attendance_faculty_insert"
  ON attendance FOR INSERT
  WITH CHECK (is_faculty() AND class_id = get_faculty_class_id() AND academic_year_id = get_active_academic_year_id());

CREATE POLICY "attendance_faculty_update"
  ON attendance FOR UPDATE
  USING  (is_faculty() AND class_id = get_faculty_class_id() AND academic_year_id = get_active_academic_year_id())
  WITH CHECK (is_faculty() AND class_id = get_faculty_class_id() AND academic_year_id = get_active_academic_year_id());

CREATE POLICY "attendance_faculty_delete"
  ON attendance FOR DELETE
  USING (is_faculty() AND class_id = get_faculty_class_id() AND academic_year_id = get_active_academic_year_id());

-- =====================================================
-- scores
-- =====================================================

CREATE POLICY "scores_read_admin"
  ON scores FOR SELECT USING (is_admin());

CREATE POLICY "scores_read_faculty"
  ON scores FOR SELECT
  USING (is_faculty() AND class_id = get_faculty_class_id() AND academic_year_id = get_active_academic_year_id());

CREATE POLICY "scores_read_anon"
  ON scores FOR SELECT USING (auth.role() = 'anon');

CREATE POLICY "scores_admin_write"
  ON scores FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "scores_faculty_insert"
  ON scores FOR INSERT
  WITH CHECK (is_faculty() AND class_id = get_faculty_class_id() AND academic_year_id = get_active_academic_year_id());

CREATE POLICY "scores_faculty_update"
  ON scores FOR UPDATE
  USING  (is_faculty() AND class_id = get_faculty_class_id() AND academic_year_id = get_active_academic_year_id())
  WITH CHECK (is_faculty() AND class_id = get_faculty_class_id() AND academic_year_id = get_active_academic_year_id());

-- =====================================================
-- early_angel_entries
-- =====================================================

CREATE POLICY "ea_entries_read_admin"     ON early_angel_entries FOR SELECT USING (is_admin());
CREATE POLICY "ea_entries_read_faculty"   ON early_angel_entries FOR SELECT
  USING (is_faculty() AND academic_year_id = get_active_academic_year_id());
CREATE POLICY "ea_entries_read_anon"      ON early_angel_entries FOR SELECT USING (auth.role() = 'anon');
CREATE POLICY "ea_entries_admin_write"    ON early_angel_entries FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "ea_entries_faculty_insert" ON early_angel_entries FOR INSERT
  WITH CHECK (is_faculty() AND academic_year_id = get_active_academic_year_id());
CREATE POLICY "ea_entries_faculty_update" ON early_angel_entries FOR UPDATE
  USING  (is_faculty() AND academic_year_id = get_active_academic_year_id())
  WITH CHECK (is_faculty() AND academic_year_id = get_active_academic_year_id());
CREATE POLICY "ea_entries_faculty_delete" ON early_angel_entries FOR DELETE
  USING (is_faculty() AND academic_year_id = get_active_academic_year_id());

-- =====================================================
-- early_angel_daily_summary
-- =====================================================

CREATE POLICY "ea_daily_read_admin"      ON early_angel_daily_summary FOR SELECT USING (is_admin());
CREATE POLICY "ea_daily_read_faculty"    ON early_angel_daily_summary FOR SELECT
  USING (is_faculty() AND academic_year_id = get_active_academic_year_id());
CREATE POLICY "ea_daily_read_anon"       ON early_angel_daily_summary FOR SELECT USING (auth.role() = 'anon');
CREATE POLICY "ea_daily_admin_write"     ON early_angel_daily_summary FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "ea_daily_faculty_upsert"  ON early_angel_daily_summary FOR INSERT
  WITH CHECK (is_faculty() AND academic_year_id = get_active_academic_year_id());
CREATE POLICY "ea_daily_faculty_update"  ON early_angel_daily_summary FOR UPDATE
  USING  (is_faculty() AND academic_year_id = get_active_academic_year_id())
  WITH CHECK (is_faculty() AND academic_year_id = get_active_academic_year_id());
CREATE POLICY "ea_daily_faculty_delete"  ON early_angel_daily_summary FOR DELETE
  USING (is_faculty() AND academic_year_id = get_active_academic_year_id());

-- =====================================================
-- early_angel_leaderboard
-- =====================================================

CREATE POLICY "ea_lb_read_admin"      ON early_angel_leaderboard FOR SELECT USING (is_admin());
CREATE POLICY "ea_lb_read_faculty"    ON early_angel_leaderboard FOR SELECT
  USING (is_faculty() AND academic_year_id = get_active_academic_year_id());
CREATE POLICY "ea_lb_read_anon"       ON early_angel_leaderboard FOR SELECT USING (auth.role() = 'anon');
CREATE POLICY "ea_lb_admin_write"     ON early_angel_leaderboard FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "ea_lb_faculty_upsert"  ON early_angel_leaderboard FOR INSERT
  WITH CHECK (is_faculty() AND academic_year_id = get_active_academic_year_id());
CREATE POLICY "ea_lb_faculty_update"  ON early_angel_leaderboard FOR UPDATE
  USING  (is_faculty() AND academic_year_id = get_active_academic_year_id())
  WITH CHECK (is_faculty() AND academic_year_id = get_active_academic_year_id());
CREATE POLICY "ea_lb_faculty_delete"  ON early_angel_leaderboard FOR DELETE
  USING (is_faculty() AND academic_year_id = get_active_academic_year_id());

-- =====================================================
-- vbs_portals
-- =====================================================

CREATE POLICY "vbs_portals_read"  ON vbs_portals FOR SELECT USING (is_admin() OR is_faculty());
CREATE POLICY "vbs_portals_write" ON vbs_portals FOR ALL
  USING  (is_admin() OR is_faculty())
  WITH CHECK (is_admin() OR is_faculty());

-- =====================================================
-- vbs_students
-- =====================================================

CREATE POLICY "vbs_students_read_admin"     ON vbs_students FOR SELECT USING (is_admin());
CREATE POLICY "vbs_students_read_faculty"   ON vbs_students FOR SELECT
  USING (is_faculty() AND class_id = get_faculty_class_id() AND academic_year_id = get_active_academic_year_id());
CREATE POLICY "vbs_students_admin_write"    ON vbs_students FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "vbs_students_faculty_write"  ON vbs_students FOR INSERT
  WITH CHECK (is_faculty() AND class_id = get_faculty_class_id() AND academic_year_id = get_active_academic_year_id());
CREATE POLICY "vbs_students_faculty_update" ON vbs_students FOR UPDATE
  USING  (is_faculty() AND class_id = get_faculty_class_id() AND academic_year_id = get_active_academic_year_id())
  WITH CHECK (is_faculty() AND class_id = get_faculty_class_id() AND academic_year_id = get_active_academic_year_id());
CREATE POLICY "vbs_students_faculty_delete" ON vbs_students FOR DELETE
  USING (is_faculty() AND class_id = get_faculty_class_id() AND academic_year_id = get_active_academic_year_id());

-- =====================================================
-- vbs_attendance
-- =====================================================

CREATE POLICY "vbs_att_read_admin"     ON vbs_attendance FOR SELECT USING (is_admin());
CREATE POLICY "vbs_att_read_faculty"   ON vbs_attendance FOR SELECT
  USING (is_faculty() AND class_id = get_faculty_class_id() AND academic_year_id = get_active_academic_year_id());
CREATE POLICY "vbs_att_admin_write"    ON vbs_attendance FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "vbs_att_faculty_write"  ON vbs_attendance FOR INSERT
  WITH CHECK (is_faculty() AND class_id = get_faculty_class_id() AND academic_year_id = get_active_academic_year_id());
CREATE POLICY "vbs_att_faculty_update" ON vbs_attendance FOR UPDATE
  USING  (is_faculty() AND class_id = get_faculty_class_id() AND academic_year_id = get_active_academic_year_id())
  WITH CHECK (is_faculty() AND class_id = get_faculty_class_id() AND academic_year_id = get_active_academic_year_id());
CREATE POLICY "vbs_att_faculty_delete" ON vbs_attendance FOR DELETE
  USING (is_faculty() AND class_id = get_faculty_class_id() AND academic_year_id = get_active_academic_year_id());

-- =====================================================
-- vbs_reports
-- =====================================================

CREATE POLICY "vbs_reports_read"  ON vbs_reports FOR SELECT USING (is_admin() OR is_faculty());
CREATE POLICY "vbs_reports_write" ON vbs_reports FOR ALL
  USING  (is_admin() OR is_faculty())
  WITH CHECK (is_admin() OR is_faculty());

-- =====================================================
-- announcements  (public read)
-- =====================================================

CREATE POLICY "announcements_read_public"
  ON announcements FOR SELECT USING (TRUE);

CREATE POLICY "announcements_admin_write"
  ON announcements FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

-- =====================================================
-- homework  (public read)
-- =====================================================

CREATE POLICY "homework_read_public"
  ON homework FOR SELECT USING (TRUE);

CREATE POLICY "homework_write"
  ON homework FOR ALL
  USING  (is_admin() OR is_faculty())
  WITH CHECK (is_admin() OR is_faculty());

CREATE POLICY "hw_subs_read_public"
  ON homework_submissions FOR SELECT USING (TRUE);

CREATE POLICY "hw_subs_write"
  ON homework_submissions FOR ALL
  USING  (is_admin() OR is_faculty())
  WITH CHECK (is_admin() OR is_faculty());

-- =====================================================
-- activity_logs
-- =====================================================

CREATE POLICY "activity_logs_admin_read"
  ON activity_logs FOR SELECT USING (is_admin());

CREATE POLICY "activity_logs_authenticated_insert"
  ON activity_logs FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
