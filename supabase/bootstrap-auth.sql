-- =====================================================
-- BOOTSTRAP AUTHENTICATION SETUP
-- Run this AFTER schema.sql and rls.sql
-- =====================================================
-- HOW TO USE:
--   1. Replace YOUR_USER_UUID with the UUID shown in
--      Supabase Dashboard → Authentication → Users
--   2. Replace the email and display_name values
--   3. Run in SQL Editor
-- =====================================================

-- Step 1: Insert your classes (adjust IDs to match what you use)
INSERT INTO classes (id, name) VALUES
    ('1',  'Class 1'),
    ('2',  'Class 2'),
    ('3',  'Class 3'),
    ('4',  'Class 4'),
    ('5',  'Class 5'),
    ('6',  'Class 6'),
    ('7',  'Class 7'),
    ('8',  'Class 8'),
    ('9',  'Class 9'),
    ('10', 'Class 10'),
    ('11', 'Class 11'),
    ('12', 'Class 12')
ON CONFLICT (id) DO NOTHING;

-- Step 2: Create admin role for your first user
-- Get the UUID from: Dashboard → Authentication → Users → click the user → copy User UID
INSERT INTO user_roles (id, role, email, display_name)
VALUES (
    'YOUR_USER_UUID',          -- paste UUID here
    'admin',
    'youremail@example.com',   -- same email used in Supabase Auth
    'Your Name'
)
ON CONFLICT (id) DO UPDATE
    SET role         = EXCLUDED.role,
        email        = EXCLUDED.email,
        display_name = EXCLUDED.display_name;

-- Step 3: Add a faculty user (repeat for each faculty member)
-- INSERT INTO user_roles (id, role, email, display_name, class_id)
-- VALUES (
--     'FACULTY_USER_UUID',
--     'faculty',
--     'faculty@example.com',
--     'Faculty Name',
--     '7'              -- must match a classes.id above
-- );

-- Step 4: Create the initial academic year and activate it
INSERT INTO academic_years (id, year_label, start_date, end_date, status)
VALUES ('2025_26', '2025-26', '2025-06-01', '2026-03-31', 'active')
ON CONFLICT (id) DO NOTHING;

UPDATE app_config
SET active_academic_year_id = '2025_26',
    updated_at = NOW()
WHERE id = 'global';

-- Verify setup
SELECT 'user_roles' AS tbl, COUNT(*) FROM user_roles
UNION ALL
SELECT 'classes',           COUNT(*) FROM classes
UNION ALL
SELECT 'academic_years',    COUNT(*) FROM academic_years
UNION ALL
SELECT 'app_config active year', COUNT(*) FROM app_config WHERE active_academic_year_id IS NOT NULL;
