/**
 * admin.js
 * All app logic for the Admin Dashboard (admin.html)
 * This is a "super-set" file that includes ALL faculty functions
 * plus all admin-only functions.
 */

// Show a nice overlay for uncaught errors
window.addEventListener('error', (ev) => handleAppError(ev.message, ev.filename, ev.lineno));
window.addEventListener('unhandledrejection', (ev) => handleAppError(ev.reason?.message || JSON.stringify(ev.reason || 'Unknown error')));

function handleAppError(message, filename = '', lineno = '') {
    try {
        const overlay = document.getElementById('app-error-overlay');
        const msg = document.getElementById('app-error-message');
        if (overlay && msg) {
            overlay.classList.remove('is-hidden');
            msg.textContent = `${message}\n${filename}:${lineno}`;
            document.getElementById('app-error-reload').onclick = () => location.reload();
            document.getElementById('app-error-console').onclick = () => console.log('Open DevTools -> Console');
        }
    } catch (e) { /* ignore overlay errors */ }
}

// Global Data Model
const DATA_MODELS = {
    students: [],
    sessions: [],
    assessments: [],
    attendance: [],
    scores: [],
    earlyAngelEntries: [],
    earlyAngelLeaderboard: [],
    enrollments: [],
    classYearCounters: [],
    facultyClassAssignments: [],
    appConfig: { activeAcademicYearId: null }
};
window.DATA_MODELS = DATA_MODELS; // Expose for debugging

// Global variable to hold the unsubscribe functions for realtime listeners
window.realtimeUnsubscribers = [];

// Global var to hold user data after verification
let currentUserData = null;
let editingAcademicYearId = null;

// -----------------
// 🔐 APP INITIALIZATION & SECURITY
// -----------------
document.addEventListener('DOMContentLoaded', function () {
    if (typeof window.onAuthStateChanged !== 'function') {
        return handleAppError("Firebase Auth is not loaded. Cannot start app.");
    }

    // Start auth listener
    window.onAuthStateChanged(window.auth, async (user) => {
        if (user) {
            try {
                // User is signed in, check their role from SERVER
                const userData = await verifyRoleFromServer(user.uid, 'admin');

                // --- USER IS VALID ADMIN ---
                console.log(`Welcome, ADMIN ${user.email}!`);
                currentUserData = userData; // Store user data globally
                initializeApp(user, userData);

            } catch (err) {
                // Role verification failed (not admin, no role, etc.)
                console.warn(`Auth/role check failed: ${err.message}. Redirecting to login.`);
                await logout(); // Use common.js logout
            }
        } else {
            // No user signed in, send to login
            console.log("No user signed in. Redirecting to login.");
            await logout(); // Use common.js logout
        }
    });
});

/**
 * Initializes the admin app after auth check passes.
 * @param {object} user - The Firebase Auth user object.
 * @param {object} userData - The user data from Firestore ({role, ...}).
 */
async function initializeApp(user, userData) {
    // Populate profile menu
    document.getElementById('user-info-email').textContent = user.email;
    document.getElementById('user-info-role').textContent = 'Administrator';

    // Apply UI restrictions (which for admin, just means showing admin-only things)
    applyRoleRestrictions(userData.role);

    // PHASE 1: Initialize appConfig/global singleton before any other setup
    showSpinner('Initializing app configuration...');
    try {
        const appConfig = await initializeAppConfig();
        if (appConfig) {
            console.log('App configuration initialized:', appConfig);
        }
    } catch (err) {
        console.warn('Failed to initialize appConfig (non-critical):', err);
    }

    // Load active academic year before listeners start.
    await loadAcademicYearContext();
    await watchAcademicYearContext(async () => {
        location.reload();
    });

    // Setup all event listeners
    setupEventListeners();

    // Start fetching realtime data (the admin version)
    startRealtimeListeners();

    // --- Admin-specific load ---
    try {
        // Load all data for analytics
        await loadAllDataForAdmin();
        await ensureAcademicYearSetup();

        // Populate dropdowns that depend on this data
        await populateClassDropdowns('user-class-id-select');
        await populateClassDropdowns('student-class-id');
        await populateClassDropdowns('assessment-class-id');
        await populateClassDropdowns('report-class-filter');
        await populateClassDropdowns('analytics-class-filter');

        // Render analytics
        renderAdminAnalytics();
        renderClassesTable();
        renderUserRolesTable();
        renderAcademicYearControls();
        renderAdminEarlyAngelPortal();
    } catch (err) {
        console.error("Failed during admin data load:", err);
        showError("An error occurred loading admin tools: " + err.message);
    }

    // Show the app content and hide the spinner
    document.getElementById('app-content').classList.remove('is-hidden');
    hideSpinner();
}

// -----------------
// 🔐 UI & EVENT LISTENERS
// -----------------

/**
 * Applies UI restrictions based on user role.
 * @param {string} role - The user's role (e.g., "admin").
 */
function applyRoleRestrictions(role) {
    // Show admin-only elements
    document.querySelectorAll('[data-admin-only="true"]').forEach(el => {
        el.style.display = 'block';
    });

    // Show the admin nav link
    const adminNav = document.getElementById('nav-admin-panel');
    if (adminNav) adminNav.style.display = 'block';

    // No need to add extra CSS to hide buttons, admin sees all
    const styles = document.getElementById('dynamic-hidden-actions');
    if (styles) styles.innerHTML = '';
}

/**
 * Sets up all event listeners for the page.
 */
function setupEventListeners() {
    // Navigation Tabs
    document.querySelectorAll('[data-tab]').forEach(tab => {
        tab.addEventListener('click', handleNavTabClick);
    });

    // Modal Triggers
    document.querySelectorAll('[data-modal]').forEach(trigger => {
        trigger.addEventListener('click', handleModalOpenClick);
    });

    // Modal Close Buttons
    document.querySelectorAll('.modal .close-btn').forEach(button => {
        button.addEventListener('click', (e) => e.target.closest('.modal').style.display = 'none');
    });

    // Close modal on outside click
    window.addEventListener('click', (e) => {
        document.querySelectorAll('.modal').forEach(modal => {
            if (e.target === modal) modal.style.display = 'none';
        });
    });

    // Header Actions
    document.getElementById('logout-btn').addEventListener('click', logout); // From common.js
    document.getElementById('edit-profile-btn')?.addEventListener('click', openAdminProfileEditor);
    document.getElementById('save-admin-profile-btn')?.addEventListener('click', saveAdminProfileEdits);
    document.getElementById('cancel-admin-profile-edit-btn')?.addEventListener('click', closeAdminProfileEditor);
    document.getElementById('close-admin-profile-modal-btn')?.addEventListener('click', closeAdminProfileEditor);
    document.getElementById('profile-btn').addEventListener('click', () => {
        document.getElementById('profile-menu').classList.toggle('is-hidden');
    });
    window.addEventListener('click', (e) => {
        const menu = document.getElementById('profile-menu');
        const btn = document.getElementById('profile-btn');
        if (menu && btn && !menu.classList.contains('is-hidden') && !menu.contains(e.target) && !btn.contains(e.target)) {
            menu.classList.add('is-hidden');
        }
    });

    const adminProfileModal = document.getElementById('admin-profile-modal');
    adminProfileModal?.addEventListener('click', (e) => {
        if (e.target === adminProfileModal) closeAdminProfileEditor();
    });

    // Session status change in modal
    document.getElementById('session-status')?.addEventListener('change', (e) => {
        document.getElementById('noclass-reason-group').style.display = (e.target.value === 'NoClass') ? 'block' : 'none';
    });

    // Save buttons
    document.getElementById('save-student-btn')?.addEventListener('click', saveStudent);
    document.getElementById('save-session-btn')?.addEventListener('click', saveSession);
    document.getElementById('save-assessment-btn')?.addEventListener('click', saveAssessment);
    document.getElementById('save-scores-btn')?.addEventListener('click', saveScores);

    // Import CSV
    document.getElementById('csv-file')?.addEventListener('change', handleCSVUpload);
    document.getElementById('import-csv-btn')?.addEventListener('click', importCSV);

    // Student Search (using debounce from common.js)
    const studentSearch = document.getElementById('student-search');
    if (studentSearch) {
        studentSearch.addEventListener('input', debounce(renderStudentsTable, 300));
        studentSearch.nextElementSibling?.addEventListener('click', renderStudentsTable);
    }

    // Attendance sub-tabs
    document.querySelectorAll('#attendance [data-tab-target]').forEach(tab => {
        tab.addEventListener('click', handleAttendanceSubTabClick);
    });

    // Report student selection
    document.getElementById('report-student')?.addEventListener('change', (e) => {
        if (e.target.value) generateStudentReport(e.target.value);
        else document.getElementById('report-content').innerHTML = '<p>Select a student to generate a report</p>';
    });
    // Report class filter
    document.getElementById('report-class-filter')?.addEventListener('change', updateReportDropdown);

    // Bulk Class Reports - populate dropdown on focus
    const bulkClassSelect = document.getElementById('bulk-report-class-select');
    if (bulkClassSelect) {
        bulkClassSelect.addEventListener('focus', () => {
            populateClassDropdowns('bulk-report-class-select');
        });
    }

    // Attendance session selection
    document.getElementById('session-date')?.addEventListener('change', (e) => {
        if (e.target.value) renderAttendanceForm(e.target.value);
        else document.getElementById('attendance-form-container').innerHTML = '<p>Select a session to take attendance</p>';
    });

    // Attendance report buttons
    document.getElementById('generate-overall-report-btn')?.addEventListener('click', generateOverallAttendanceReport);
    document.getElementById('report-session-date')?.addEventListener('change', generateDaywiseAttendanceReport);
    document.getElementById('print-daywise-report-btn')?.addEventListener('click', () => {
        printReport('daywise-report-container', 'Day-wise Attendance Report'); // From common.js
    });

    // View Student Modal Close
    document.getElementById('close-view-modal')?.addEventListener('click', () => {
        document.getElementById('student-view-modal').style.display = 'none';
    });

    // ... inside setupEventListeners ...

    // Bulk Attendance Import
    const bulkAttFile = document.getElementById('bulk-att-file');
    if (bulkAttFile) {
        bulkAttFile.addEventListener('change', handleBulkAttendanceUpload);
    }
    const bulkAttBtn = document.getElementById('import-bulk-att-btn');
    if (bulkAttBtn) {
        bulkAttBtn.addEventListener('click', importBulkAttendance);
    }


    function openAdminProfileEditor() {
        const modal = document.getElementById('admin-profile-modal');
        const emailEl = document.getElementById('admin-profile-email');
        const displayNameInput = document.getElementById('admin-profile-display-name');
        const phoneInput = document.getElementById('admin-profile-phone');

        if (emailEl) emailEl.textContent = window.auth?.currentUser?.email || currentUserData?.email || '...';
        if (displayNameInput) displayNameInput.value = currentUserData?.displayName || (window.auth?.currentUser?.email || '').split('@')[0] || '';
        if (phoneInput) phoneInput.value = currentUserData?.phone || '';

        if (modal) modal.style.display = 'flex';
    }

    function closeAdminProfileEditor() {
        const modal = document.getElementById('admin-profile-modal');
        if (modal) modal.style.display = 'none';
    }

    async function saveAdminProfileEdits() {
        const uid = window.auth?.currentUser?.uid;
        const displayName = document.getElementById('admin-profile-display-name')?.value.trim() || '';
        const phone = document.getElementById('admin-profile-phone')?.value.trim() || '';

        if (!displayName) {
            return showError('Display name is required.');
        }
        if (!uid) {
            return showError('Unable to save profile. Please login again.');
        }

        showSpinner();
        try {
            const payload = {
                displayName,
                phone,
                updatedAt: new Date().toISOString(),
            };

            await window.setDoc(window.doc(window.db, 'userRoles', uid), payload, { merge: true });

            currentUserData = {
                ...(currentUserData || {}),
                ...payload,
            };

            closeAdminProfileEditor();
            showSuccess('Profile updated', 'Your admin profile was saved successfully.');
        } catch (err) {
            showError('Failed to save admin profile: ' + err.message);
        } finally {
            hideSpinner();
        }
    }
    // System Restore
    document.getElementById('btn-restore-system')?.addEventListener('click', restoreSystemFromBackup);

    // --- ADMIN TOOL LISTENERS ---
    document.getElementById('class-form')?.addEventListener('submit', saveClass);
    document.getElementById('user-role-form')?.addEventListener('submit', saveUserRole);
    document.getElementById('user-role-select')?.addEventListener('change', (e) => {
        document.getElementById('faculty-class-group').style.display = (e.target.value === 'faculty') ? 'block' : 'none';
    });
    document.getElementById('run-migration-btn')?.addEventListener('click', runBackfillMigration);
    document.getElementById('run-cleanup-btn')?.addEventListener('click', runFieldCleanup);
    document.getElementById('run-session-cleanup-btn')?.addEventListener('click', runSessionCleanup);
    document.getElementById('export-students-csv')?.addEventListener('click', exportStudentsToCsv);
    document.getElementById('export-attendance-csv')?.addEventListener('click', exportAttendanceToCsv);
    document.getElementById('export-full-backup-json')?.addEventListener('click', downloadJsonBackup);
    // Add this line inside setupEventListeners()
    document.getElementById('student-id-migration-form')?.addEventListener('submit', runStudentIdMigration);

    // Academic year management
    document.getElementById('academic-year-form')?.addEventListener('submit', saveAcademicYear);
    document.getElementById('cancel-academic-year-edit-btn')?.addEventListener('click', resetAcademicYearForm);
    document.getElementById('save-active-academic-year-btn')?.addEventListener('click', saveActiveAcademicYear);
    document.getElementById('backfill-academic-year-btn')?.addEventListener('click', backfillAcademicYearForLegacyData);

    // PHASE 2: Faculty Migration Wizard (Admin Controls)
    document.getElementById('enable-migration-btn')?.addEventListener('click', enableMigrationForYear);
    document.getElementById('disable-migration-btn')?.addEventListener('click', disableMigrationForAllYears);

    // Early Angel dashboard portal
    document.getElementById('open-admin-early-angel-btn')?.addEventListener('click', () => {
        window.location.href = 'early-angel.html';
    });
    document.getElementById('open-admin-vbs-btn')?.addEventListener('click', () => {
        window.location.href = 'vbs.html';
    });
    document.getElementById('close-admin-early-angel-btn')?.addEventListener('click', () => toggleAdminEarlyAngelPanel(false));
    document.getElementById('admin-early-angel-class-filter')?.addEventListener('change', renderAdminEarlyAngelPortal);
    document.getElementById('admin-early-angel-entry-class')?.addEventListener('change', handleAdminEarlyAngelEntryClassChange);
    document.getElementById('admin-early-angel-entry-form')?.addEventListener('submit', saveAdminEarlyAngelEntry);
    const adminEarlyAngelDate = document.getElementById('admin-early-angel-date');
    if (adminEarlyAngelDate && !adminEarlyAngelDate.value) {
        adminEarlyAngelDate.valueAsDate = new Date();
    }
}

/**
 * Handles clicks on the main navigation tabs.
 */
function handleNavTabClick(e) {
    e.preventDefault();
    const targetTab = this.getAttribute('data-tab');

    document.querySelectorAll('[data-tab]').forEach(t => t.classList.remove('active'));
    this.classList.add('active');

    document.querySelectorAll('.main-content > .tab-content').forEach(content => {
        content.classList.remove('active');
        if (content.id === targetTab) {
            content.classList.add('active');
        }
    });

    // Refresh content on tab switch
    if (targetTab === 'attendance') {
        renderSessionsTable();
        renderAttendanceForm(document.getElementById('session-date')?.value || '');
    }
    if (targetTab === 'reports') {
        updateReportDropdown();
    }
    if (targetTab === 'dashboard') {
        renderAdminEarlyAngelPortal();
    }
    if (targetTab === 'admin-panel') {
        // Refresh admin data
        loadAllDataForAdmin().then(async () => {
            await ensureAcademicYearSetup();
            renderAdminAnalytics();
            renderClassesTable();
            renderUserRolesTable();
            renderAcademicYearControls();
            renderAdminEarlyAngelPortal();
        });
    }
}

/**
 * Handles opening modals.
 */
function handleModalOpenClick(e) {
    e.preventDefault();
    const modalId = this.dataset.modal;
    const modalEl = document.getElementById(modalId);
    if (!modalEl) return console.warn('Modal not found:', modalId);

    modalEl.style.display = 'flex';

    // Reset modals on open
    if (modalId === 'session-modal') {
        document.getElementById('session-form')?.reset();
        document.getElementById('noclass-reason-group').style.display = 'none';
        document.getElementById('session-date-input').valueAsDate = new Date();
    } else if (modalId === 'student-modal') {
        document.getElementById('student-modal-title').textContent = 'Add Student';
        document.getElementById('student-form')?.reset();
        document.getElementById('student-id').value = '';
    } else if (modalId === 'import-modal') {
        document.getElementById('csv-file').value = '';
        document.getElementById('preview-container').innerHTML = '<p>Preview will appear here after selecting a file</p>';
        document.getElementById('import-csv-btn').disabled = true;
    }
}

/**
 * Handles clicks on the attendance sub-tabs.
 */
function handleAttendanceSubTabClick() {
    const target = this.getAttribute('data-tab-target');

    document.querySelectorAll('#attendance [data-tab-target]').forEach(t => t.classList.remove('active'));
    this.classList.add('active');

    document.querySelectorAll('#attendance .tab-content').forEach(content => {
        content.classList.remove('active');
        if (`#${content.id}` === target) {
            content.classList.add('active');
        }
    });
}

// -----------------
// 📡 REALTIME DATA LISTENERS (ADMIN VERSION)
// -----------------

function stopRealtimeListeners() {
    if (window.realtimeUnsubscribers && window.realtimeUnsubscribers.length > 0) {
        console.log('[realtime] Stopping', window.realtimeUnsubscribers.length, 'listeners...');
        window.realtimeUnsubscribers.forEach(unsub => unsub());
        window.realtimeUnsubscribers = [];
    }
}

/**
 * Starts all realtime listeners. ADMIN version (no scoping).
 */
function startRealtimeListeners() {
    if (!window.db || !window.onSnapshot || !window.collection) {
        return handleAppError('[realtime] Firestore realtime not available.');
    }

    const { db, onSnapshot, collection } = window;

    stopRealtimeListeners();
    console.log('[realtime] Starting listeners for ADMIN (all data)');

    // STUDENTS Listener (global)
    const studentsQuery = collection(db, 'students');
    const unsubStudents = onSnapshot(studentsQuery, snapshot => {
        DATA_MODELS.students = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            DATA_MODELS.students.push(data);
        });
        DATA_MODELS.students.sort((a, b) =>
            String(a.studentId).localeCompare(String(b.studentId), undefined, { numeric: true })
        );
        renderStudentsTable();
        updateReportDropdown();
        renderDashboard();
        console.log('[realtime] students sync', DATA_MODELS.students.length);
    }, err => console.error('[realtime] students listener error', err));
    window.realtimeUnsubscribers.push(unsubStudents);

    // SESSIONS Listener (global)
    const sessionsQuery = collection(db, 'sessions');
    const unsubSessions = onSnapshot(sessionsQuery, snapshot => {
        DATA_MODELS.sessions = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (isCurrentAcademicYear(data)) DATA_MODELS.sessions.push(data);
        });
        renderSessionsTable();
        renderAttendanceForm(document.getElementById('session-date')?.value || '');
        renderDashboard();
        console.log('[realtime] sessions sync', DATA_MODELS.sessions.length);
    }, err => console.error('[realtime] sessions listener error', err));
    window.realtimeUnsubscribers.push(unsubSessions);

    // ASSESSMENTS Listener (global)
    const assessmentsQuery = collection(db, 'assessments');
    const unsubAssessments = onSnapshot(assessmentsQuery, (snapshot) => {
        DATA_MODELS.assessments = [];
        snapshot.forEach((doc) => {
            const data = { id: doc.id, ...doc.data() };
            if (isCurrentAcademicYear(data)) DATA_MODELS.assessments.push(data);
        });
        renderAssessmentsTable();
        console.log('[realtime] Synced assessments:', DATA_MODELS.assessments.length);
    }, err => console.error('[realtime] Assessments listener error:', err));
    window.realtimeUnsubscribers.push(unsubAssessments);

    // ATTENDANCE Listener (global)
    const attendanceQuery = collection(db, 'attendance');
    const unsubAttendance = onSnapshot(attendanceQuery, snapshot => {
        DATA_MODELS.attendance = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (isCurrentAcademicYear(data)) DATA_MODELS.attendance.push(data);
        });
        const currentSession = document.getElementById('session-date')?.value;
        if (currentSession) renderAttendanceForm(currentSession);
        console.log('[realtime] attendance sync', DATA_MODELS.attendance.length);
    }, err => console.error('[realtime] attendance listener error', err));
    window.realtimeUnsubscribers.push(unsubAttendance);

    // SCORES Listener (global)
    const scoresQuery = collection(db, 'scores');
    const unsubScores = onSnapshot(scoresQuery, snapshot => {
        DATA_MODELS.scores = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (isCurrentAcademicYear(data)) DATA_MODELS.scores.push(data);
        });
        renderAssessmentsTable();
        if (window._currentScoresAssessmentId && document.getElementById('scores-modal').style.display === 'flex') {
            openScoresModal(window._currentScoresAssessmentId);
        }
        console.log('[realtime] scores sync', DATA_MODELS.scores.length);
    }, err => console.error('[realtime] scores listener error', err));
    window.realtimeUnsubscribers.push(unsubScores);

    // EARLY ANGEL ENTRIES Listener (global)
    const earlyAngelEntriesQuery = collection(db, 'earlyAngelEntries');
    const unsubEarlyAngelEntries = onSnapshot(earlyAngelEntriesQuery, snapshot => {
        DATA_MODELS.earlyAngelEntries = [];
        snapshot.forEach(doc => {
            const data = { id: doc.id, ...doc.data() };
            if (isCurrentAcademicYear(data)) DATA_MODELS.earlyAngelEntries.push(data);
        });
        DATA_MODELS.earlyAngelEntries.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        renderAdminEarlyAngelPortal();
        console.log('[realtime] earlyAngelEntries sync', DATA_MODELS.earlyAngelEntries.length);
    }, err => console.error('[realtime] earlyAngelEntries listener error', err));
    window.realtimeUnsubscribers.push(unsubEarlyAngelEntries);

    // EARLY ANGEL LEADERBOARD Listener (global)
    const earlyAngelLeaderboardQuery = collection(db, 'earlyAngelLeaderboard');
    const unsubEarlyAngelLeaderboard = onSnapshot(earlyAngelLeaderboardQuery, snapshot => {
        DATA_MODELS.earlyAngelLeaderboard = [];
        snapshot.forEach(doc => {
            const data = { id: doc.id, ...doc.data() };
            if (isCurrentAcademicYear(data)) DATA_MODELS.earlyAngelLeaderboard.push(data);
        });
        DATA_MODELS.earlyAngelLeaderboard.sort((a, b) => Number(b.totalPoints || 0) - Number(a.totalPoints || 0));
        renderAdminEarlyAngelPortal();
        console.log('[realtime] earlyAngelLeaderboard sync', DATA_MODELS.earlyAngelLeaderboard.length);
    }, err => console.error('[realtime] earlyAngelLeaderboard listener error', err));
    window.realtimeUnsubscribers.push(unsubEarlyAngelLeaderboard);

    // ACADEMIC YEARS Listener (PHASE 1)
    const academicYearsQuery = collection(db, 'academicYears');
    const unsubAcademicYears = onSnapshot(academicYearsQuery, snapshot => {
        DATA_MODELS.academicYears = [];
        snapshot.forEach(doc => {
            DATA_MODELS.academicYears.push({ id: doc.id, ...doc.data() });
        });
        DATA_MODELS.academicYears.sort((a, b) => String(b.id || '').localeCompare(String(a.id || '')));
        renderAcademicYearControls();
        console.log('[realtime] academicYears sync', DATA_MODELS.academicYears.length);
    }, err => console.error('[realtime] academicYears listener error', err));
    window.realtimeUnsubscribers.push(unsubAcademicYears);

    // ENROLLMENTS Listener (PHASE 1)
    const enrollmentsQuery = collection(db, 'enrollments');
    const unsubEnrollments = onSnapshot(enrollmentsQuery, snapshot => {
        DATA_MODELS.enrollments = [];
        snapshot.forEach(doc => {
            const data = { id: doc.id, ...doc.data() };
            if (isCurrentAcademicYear(data)) DATA_MODELS.enrollments.push(data);
        });
        console.log('[realtime] enrollments sync', DATA_MODELS.enrollments.length);
    }, err => console.error('[realtime] enrollments listener error', err));
    window.realtimeUnsubscribers.push(unsubEnrollments);
}

// -----------------
// 📈 DASHBOARD
// -----------------
async function renderDashboard() {
    // Render Stats Cards
    const activeYearId = getActiveAcademicYearId() || DATA_MODELS.appConfig?.activeAcademicYearId || null;
    const activeYear = (DATA_MODELS.academicYears || []).find(year => String(year.id || '') === String(activeYearId || ''));
    const activeYearLabel = activeYear ? (activeYear.label || activeYear.yearLabel || activeYear.id) : (activeYearId || 'Not set');
    const activeYearEl = document.getElementById('admin-active-year-label');
    if (activeYearEl) activeYearEl.textContent = activeYearLabel;

    const currentRoster = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || []);

    const migrationEl = document.getElementById('admin-migration-status');
    if (migrationEl) migrationEl.textContent = activeYear?.migrationEnabled ? 'On' : 'Off';

    const totalStudentsEl = document.getElementById('total-students');
    if (totalStudentsEl) totalStudentsEl.textContent = currentRoster.length;

    const availableSessions = DATA_MODELS.sessions.filter(s => s.status === 'Available');
    const classesHeldEl = document.getElementById('classes-held');
    if (classesHeldEl) classesHeldEl.textContent = availableSessions.length;

    if (currentRoster.length > 0 && availableSessions.length > 0) {
        let totalAttendance = 0;
        currentRoster.forEach(student => {
            const presentCount = DATA_MODELS.attendance.filter(a => (a.studentId === student.studentId) && (a.status === 'Present' || a.status === 'Late')).length;
            totalAttendance += Math.round((presentCount / availableSessions.length) * 100);
        });
        const avgAttendance = currentRoster.length > 0 ? Math.round(totalAttendance / currentRoster.length) : 0;
        const avgAttendanceEl = document.getElementById('avg-attendance');
        if (avgAttendanceEl) avgAttendanceEl.textContent = `${avgAttendance}%`;
    } else {
        const avgAttendanceEl = document.getElementById('avg-attendance');
        if (avgAttendanceEl) avgAttendanceEl.textContent = '0%';
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today
    const nextWeek = new Date();
    nextWeek.setDate(today.getDate() + 7);
    const upcomingSessions = DATA_MODELS.sessions.filter(s => {
        const sessionDate = new Date(s.date); // Assumes YYYY-MM-DD
        sessionDate.setMinutes(sessionDate.getMinutes() + sessionDate.getTimezoneOffset()); // Adjust to UTC
        return sessionDate >= today && sessionDate <= nextWeek;
    });
    const upcomingSessionsEl = document.getElementById('upcoming-sessions');
    if (upcomingSessionsEl) upcomingSessionsEl.textContent = upcomingSessions.length;

    // --- Admin version: Render Activity Log ---
    const activityContainer = document.getElementById('recent-activity');
    if (!activityContainer) return;
    activityContainer.innerHTML = '<p>Loading recent activity...</p>';

    try {
        const { query, collection, orderBy, limit, getDocs } = window;
        const logsQuery = query(
            collection(window.db, 'activityLogs'),
            orderBy('timestamp', 'desc'),
            limit(10)
        );
        const querySnapshot = await getDocs(logsQuery);
        if (querySnapshot.empty) {
            activityContainer.innerHTML = '<p>No recent activity.</p>';
            return;
        }
        let html = '<ul class="activity-log-list">';
        querySnapshot.forEach(doc => {
            const log = doc.data();
            let text = `<b>${escapeHtml(log.action)}</b> by ${escapeHtml(log.userEmail)}`;
            if (log.details && log.details.name) text += ` (Name: ${escapeHtml(log.details.name)})`;
            else if (log.details && log.details.studentId) text += ` (ID: ${escapeHtml(log.details.studentId)})`;
            else if (log.details && log.details.date) text += ` (Date: ${escapeHtml(log.details.date)})`;
            html += `<li>${text} <small>(${formatDateTime(log.timestamp.toDate())})</small></li>`;
        });
        html += '</ul>';
        activityContainer.innerHTML = html;
    } catch (err) {
        console.error('Error fetching activity log:', err);
        activityContainer.innerHTML = '<p class="text-danger">Error loading activity log.</p>';
    }
}

function toggleAdminEarlyAngelPanel(show) {
    const panel = document.getElementById('admin-early-angel-panel');
    if (!panel) return;

    panel.classList.toggle('is-hidden', !show);
    if (show) {
        renderAdminEarlyAngelPortal();
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function populateAdminEarlyAngelClassFilter() {
    const filterSelect = document.getElementById('admin-early-angel-class-filter');
    const entryClassSelect = document.getElementById('admin-early-angel-entry-class');
    const classes = [...(DATA_MODELS.classes || [])].sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));

    if (filterSelect) {
        const currentFilterValue = filterSelect.value;
        filterSelect.innerHTML = '<option value="">-- All classes --</option>';
        classes.forEach(classDoc => {
            const option = document.createElement('option');
            option.value = classDoc.id;
            option.textContent = `${classDoc.id} - ${classDoc.name || classDoc.id}`;
            filterSelect.appendChild(option);
        });
        if (currentFilterValue && classes.some(c => c.id === currentFilterValue)) {
            filterSelect.value = currentFilterValue;
        }
    }

    if (entryClassSelect) {
        const currentEntryClassValue = entryClassSelect.value;
        entryClassSelect.innerHTML = '<option value="">-- Select class --</option>';
        classes.forEach(classDoc => {
            const option = document.createElement('option');
            option.value = classDoc.id;
            option.textContent = `${classDoc.id} - ${classDoc.name || classDoc.id}`;
            entryClassSelect.appendChild(option);
        });

        if (currentEntryClassValue && classes.some(c => c.id === currentEntryClassValue)) {
            entryClassSelect.value = currentEntryClassValue;
        } else if (!currentEntryClassValue && classes.length > 0) {
            entryClassSelect.value = classes[0].id;
        }
    }
}

function handleAdminEarlyAngelEntryClassChange() {
    populateAdminEarlyAngelStudentSelect();
}

function populateAdminEarlyAngelStudentSelect() {
    const classSelect = document.getElementById('admin-early-angel-entry-class');
    const studentSelect = document.getElementById('admin-early-angel-entry-student');
    if (!classSelect || !studentSelect) return;

    const classId = classSelect.value;
    const currentValue = studentSelect.value;
    studentSelect.innerHTML = '<option value="">-- Select student --</option>';

    if (!classId) return;

    const students = [...(DATA_MODELS.students || [])]
        .filter(s => String(s.classId || '') === classId)
        .sort((a, b) => String(a.studentId || '').localeCompare(String(b.studentId || ''), undefined, { numeric: true }));

    students.forEach(student => {
        const option = document.createElement('option');
        option.value = String(student.studentId || '');
        option.textContent = `${student.studentId} - ${student.firstName || ''} ${student.lastName || ''}`.trim();
        studentSelect.appendChild(option);
    });

    if (currentValue && students.some(s => String(s.studentId) === currentValue)) {
        studentSelect.value = currentValue;
    }
}

function renderAdminEarlyAngelPortal() {
    populateAdminEarlyAngelClassFilter();
    populateAdminEarlyAngelStudentSelect();
    renderAdminEarlyAngelLeaderboardTable();
    renderAdminEarlyAngelEntriesTable();
}

function renderAdminEarlyAngelLeaderboardTable() {
    const tbody = document.querySelector('#admin-early-angel-leaderboard-table tbody');
    if (!tbody) return;

    const classFilter = document.getElementById('admin-early-angel-class-filter')?.value || '';
    const classesById = new Map((DATA_MODELS.classes || []).map(c => [String(c.id), c]));
    const rows = (DATA_MODELS.earlyAngelLeaderboard || []).filter(r => !classFilter || String(r.classId) === classFilter);

    tbody.innerHTML = '';
    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5">No leaderboard data yet.</td></tr>';
        return;
    }

    rows
        .slice()
        .sort((a, b) => Number(b.totalPoints || 0) - Number(a.totalPoints || 0))
        .forEach((row, index) => {
            const classDoc = classesById.get(String(row.classId || ''));
            const classText = classDoc ? `${classDoc.id} - ${classDoc.name || classDoc.id}` : (row.classId || '-');
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${index + 1}</td>
                <td>${escapeHtml(classText)}</td>
                <td>${escapeHtml(row.studentName || row.studentId || '-')}</td>
                <td><strong>${Number(row.totalPoints || 0)}</strong></td>
                <td>${Number(row.entryCount || 0)}</td>
            `;
            tbody.appendChild(tr);
        });
}

function renderAdminEarlyAngelEntriesTable() {
    const tbody = document.querySelector('#admin-early-angel-entries-table tbody');
    if (!tbody) return;

    const classFilter = document.getElementById('admin-early-angel-class-filter')?.value || '';
    const classesById = new Map((DATA_MODELS.classes || []).map(c => [String(c.id), c]));
    const rows = (DATA_MODELS.earlyAngelEntries || []).filter(r => !classFilter || String(r.classId) === classFilter);

    tbody.innerHTML = '';
    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6">No Early Angel entries yet.</td></tr>';
        return;
    }

    rows
        .slice(0, 100)
        .forEach(row => {
            const classDoc = classesById.get(String(row.classId || ''));
            const classText = classDoc ? `${classDoc.id} - ${classDoc.name || classDoc.id}` : (row.classId || '-');
            const dateLabel = row.entryDate ? formatDate(row.entryDate) : formatDate((row.createdAt || '').slice(0, 10));
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(dateLabel)}</td>
                <td>${escapeHtml(classText)}</td>
                <td>${escapeHtml(row.studentName || row.studentId || '-')}</td>
                <td>${escapeHtml(row.category || '-')}</td>
                <td>${Number(row.points || 0)}</td>
                <td>${escapeHtml(row.notes || '-')}</td>
            `;
            tbody.appendChild(tr);
        });
}

async function saveAdminEarlyAngelEntry(e) {
    e.preventDefault();

    const classId = (document.getElementById('admin-early-angel-entry-class')?.value || '').trim();
    const studentId = (document.getElementById('admin-early-angel-entry-student')?.value || '').trim();
    const points = Number(document.getElementById('admin-early-angel-points')?.value || 0);
    const category = (document.getElementById('admin-early-angel-category')?.value || 'Other').trim();
    const entryDate = document.getElementById('admin-early-angel-date')?.value || new Date().toISOString().slice(0, 10);
    const notes = (document.getElementById('admin-early-angel-notes')?.value || '').trim();

    const activeYearId = getActiveAcademicYearId();
    if (!activeYearId) return showError('Active academic year is not configured.');
    if (!classId) return showError('Please select a class.');
    if (!studentId) return showError('Please select a student.');
    if (!Number.isFinite(points) || points <= 0) return showError('Points must be a positive number.');

    const student = (DATA_MODELS.students || []).find(s => String(s.studentId) === studentId && String(s.classId) === classId);
    if (!student) return showError('Selected student is not available for the selected class.');

    const studentName = `${student.firstName || ''} ${student.lastName || ''}`.trim() || studentId;
    const nowIso = new Date().toISOString();

    showSpinner();
    try {
        const entryPayload = withAcademicYear({
            classId,
            studentId,
            studentName,
            category,
            points,
            notes,
            entryDate,
            createdAt: nowIso,
            createdBy: currentUserData?.uid || 'admin'
        });

        await addDoc(collection(window.db, 'earlyAngelEntries'), entryPayload);

        const summaryDocId = `${activeYearId}_${classId}_${entryDate}_${studentId}`;
        await setDoc(doc(window.db, 'earlyAngelDailySummary', summaryDocId), withAcademicYear({
            classId,
            date: entryDate,
            studentId,
            studentName,
            pointsTotal: window.increment(points),
            entryCount: window.increment(1),
            lastUpdatedAt: nowIso,
            updatedBy: currentUserData?.uid || 'admin'
        }), { merge: true });

        const leaderboardDocId = `${activeYearId}_${classId}_${studentId}`;
        await setDoc(doc(window.db, 'earlyAngelLeaderboard', leaderboardDocId), withAcademicYear({
            classId,
            studentId,
            studentName,
            totalPoints: window.increment(points),
            entryCount: window.increment(1),
            lastEntryDate: entryDate,
            lastUpdatedAt: nowIso,
            updatedBy: currentUserData?.uid || 'admin'
        }), { merge: true });

        createAuditLog('admin_early_angel_entry_saved', {
            classId,
            studentId,
            points,
            category,
            academicYearId: activeYearId
        });

        showSuccess('Early Angel entry saved.');
        document.getElementById('admin-early-angel-entry-form')?.reset();
        const dateInput = document.getElementById('admin-early-angel-date');
        if (dateInput) dateInput.value = entryDate;
        const pointsInput = document.getElementById('admin-early-angel-points');
        if (pointsInput) pointsInput.value = '1';
        const classSelect = document.getElementById('admin-early-angel-entry-class');
        if (classSelect) classSelect.value = classId;
        populateAdminEarlyAngelStudentSelect();
    } catch (err) {
        showError('Failed to save Early Angel entry: ' + err.message);
    } finally {
        hideSpinner();
    }
}


// -------------------------------------------------------------------
// --- ALL SHARED FUNCTIONS (STUDENTS, SESSIONS, REPORTS, ETC.) ---
// -------------------------------------------------------------------

// -----------------
// 👨‍🎓 STUDENT MANAGEMENT
// -----------------
function renderStudentsTable() {
    const tbody = document.querySelector('#students-table tbody');
    if (!tbody) return;

    const filterText = document.getElementById('student-search')?.value.toLowerCase() || '';
    const rosterStudents = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || []);
    const filteredStudents = rosterStudents.filter(student => {
        if (!filterText) return true;
        const searchText = [
            student.firstName,
            student.lastName,
            student.fullName,
            student.studentId,
            student.guardian,
            student.phone,
            student.email,
            student.classId,
            student.registerNo
        ].filter(Boolean).join(' ').toLowerCase();
        return searchText.includes(filterText);
    });

    tbody.innerHTML = '';
    if (filteredStudents.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6">No students found.</td></tr>';
        return;
    }

    filteredStudents.forEach(student => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><a href="#" class="student-link" data-id="${escapeHtml(student.studentId)}">${escapeHtml(student.studentId)}</a></td>
            <td>${escapeHtml(student.firstName)} ${escapeHtml(student.lastName)}</td>
            <td>${escapeHtml(student.guardian)}</td>
            <td>${escapeHtml(student.phone || student.email || 'N/A')}</td>
            <td>${escapeHtml(student.classId || 'N/A')}</td>
            <td>
                <button class="btn btn-warning btn-sm edit-student" data-id="${escapeHtml(student.studentId)}">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-danger btn-sm delete-student" data-id="${escapeHtml(student.studentId)}">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });

    // Add event listeners
    tbody.querySelectorAll('.student-link').forEach(link => {
        link.addEventListener('click', (e) => { e.preventDefault(); viewStudentDetails(e.target.closest('a').dataset.id); });
    });
    tbody.querySelectorAll('.edit-student').forEach(btn => {
        btn.addEventListener('click', (e) => editStudent(e.currentTarget.dataset.id));
    });
    tbody.querySelectorAll('.delete-student').forEach(btn => {
        btn.addEventListener('click', (e) => deleteStudent(e.currentTarget.dataset.id));
    });
}

async function saveStudent() {
    showSpinner();
    try {
        const studentIdInput = document.getElementById('student-id-input').value.trim();
        const firstName = document.getElementById('student-first-name').value.trim();
        const lastName = document.getElementById('student-last-name').value.trim();
        const dob = document.getElementById('student-dob').value;
        const guardian = document.getElementById('student-guardian').value.trim();
        const phone = document.getElementById('student-phone').value.trim();
        const email = document.getElementById('student-email').value.trim();
        const notes = document.getElementById('student-notes').value.trim();
        const id = document.getElementById('student-id').value; // Hidden field

        // Admin version: classId comes from the dropdown
        const classId = document.getElementById('student-class-id').value;

        if (!firstName || !lastName || !studentIdInput || !guardian || !classId) {
            throw new Error('Please fill in all required fields (*).');
        }

        const student = {
            studentId: studentIdInput,
            firstName, lastName, dob, guardian, phone, email, classId, notes
        };

        const { doc, setDoc } = window;
        const studentRef = doc(window.db, 'students', String(student.studentId));
        await setDoc(studentRef, student, { merge: true });
        await upsertEnrollmentForStudent(student, currentUserData?.uid || 'admin');

        const action = id ? 'student_updated' : 'student_created';
        createAuditLog(action, { studentId: student.studentId, name: `${student.firstName} ${student.lastName}` });

        document.getElementById('student-modal').style.display = 'none';
        showSuccess('Student saved successfully!');

    } catch (err) {
        showError('Error saving student: ' + err.message);
    } finally {
        hideSpinner();
    }
}

function editStudent(studentId) {
    const rosterStudent = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
        .find(s => String(s.studentId) === String(studentId));
    const student = rosterStudent;
    if (student) {
        document.getElementById('student-id').value = student.studentId;
        document.getElementById('student-id-input').value = student.studentId;
        document.getElementById('student-first-name').value = student.firstName;
        document.getElementById('student-last-name').value = student.lastName;
        document.getElementById('student-dob').value = student.dob || '';
        document.getElementById('student-guardian').value = student.guardian;
        document.getElementById('student-phone').value = student.phone || '';
        document.getElementById('student-email').value = student.email || '';
        document.getElementById('student-class-id').value = student.classId || ''; // Admin can edit class
        document.getElementById('student-notes').value = student.notes || '';
        document.getElementById('student-modal-title').textContent = 'Edit Student';
        document.getElementById('student-modal').style.display = 'flex';
    }
}

async function deleteStudent(studentId) {
    const result = await showConfirm(
        'Delete Student?',
        'Are you sure you want to delete this student? This action cannot be undone.'
    );
    if (result.isConfirmed) {
        showSpinner();
        try {
            const { doc, deleteDoc } = window;
            const docRef = doc(window.db, 'students', String(studentId));
            await deleteDoc(docRef);
            createAuditLog('student_deleted', { studentId: String(studentId) });
            showSuccess('Student deleted.');
        } catch (err) {
            showError('Failed to delete student: ' + err.message);
        } finally {
            hideSpinner();
        }
    }
}

function viewStudentDetails(studentId) {
    const student = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
        .find(s => String(s.studentId) === String(studentId));
    if (!student) return showError('Student not found.');
    const detailsHtml = `
        <p><strong>Student ID:</strong> ${escapeHtml(student.studentId)}</p>
        <p><strong>Name:</strong> ${escapeHtml(student.firstName)} ${escapeHtml(student.lastName)}</p>
        <p><strong>DOB:</strong> ${student.dob ? formatDate(student.dob) : 'N/A'}</p>
        <p><strong>Guardian:</strong> ${escapeHtml(student.guardian)}</p>
        <p><strong>Contact:</strong> ${escapeHtml(student.phone || 'N/A')}</p>
        <p><strong>Email:</strong> ${escapeHtml(student.email || 'N/A')}</p>
        <p><strong>Class:</strong> ${escapeHtml(student.classId || 'N/A')}</p>
        <p><strong>Notes:</strong> ${escapeHtml(student.notes || 'None')}</p>`;
    document.getElementById('student-details-content').innerHTML = detailsHtml;
    document.getElementById('student-view-modal').style.display = 'flex';
}

// -----------------
// 📅 SESSION MANAGEMENT
// -----------------
function renderSessionsTable() {
    const tbody = document.querySelector('#sessions-table tbody');
    if (!tbody) return;

    const sortedSessions = [...DATA_MODELS.sessions].sort((a, b) => new Date(b.date) - new Date(a.date));
    tbody.innerHTML = '';
    if (sortedSessions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4">No sessions created yet.</td></tr>';
    }

    const availableSessionsForDropdown = [];
    sortedSessions.forEach(session => {
        const row = document.createElement('tr');
        const statusBadge = session.status === 'Available'
            ? `<span class="status-badge status-present">Class Available</span>`
            : `<span class="status-badge status-noclass">No Class</span>`;
        row.innerHTML = `
            <td>${formatDate(session.date)}</td>
            <td>${statusBadge}</td>
            <td>${escapeHtml(session.noClassReason || 'N/A')}</td>
            <td>
                ${session.status === 'Available' ? `
                    <button class="btn btn-primary btn-sm take-attendance" data-id="${escapeHtml(session.id)}">
                        <i class="fas fa-check-circle"></i> Take Attendance
                    </button>
                ` : ''}
                <button class="btn btn-danger btn-sm delete-session" data-id="${escapeHtml(session.id)}">
                    <i class="fas fa-trash"></i>
                </button>
            </td>`;
        tbody.appendChild(row);
        if (session.status === 'Available') {
            availableSessionsForDropdown.push(session);
        }
    });

    populateDropdown('session-date', availableSessionsForDropdown, s => s.id, s => `${formatDate(s.date)} (${s.status})`);
    populateDropdown('report-session-date', sortedSessions, s => s.id, s => `${formatDate(s.date)} (${s.status === 'Available' ? 'Class Held' : 'No Class'})`);

    tbody.querySelectorAll('.take-attendance').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const sessionId = e.currentTarget.dataset.id;
            document.getElementById('session-date').value = sessionId;
            renderAttendanceForm(sessionId);
            document.querySelector('[data-tab-target="#take-attendance"]').click();
        });
    });
    tbody.querySelectorAll('.delete-session').forEach(btn => {
        btn.addEventListener('click', (e) => deleteSession(e.currentTarget.dataset.id));
    });
}

async function saveSession() {
    const date = document.getElementById('session-date-input').value;
    const status = document.getElementById('session-status').value;
    const noClassReason = (status === 'NoClass') ? document.getElementById('noclass-reason').value : null;
    const sessionId = date;

    if (!date) return showError('Please select a date');
    if (DATA_MODELS.sessions.some(s => s.id === sessionId || s.date === date)) {
        return showError('A session already exists for this date');
    }

    const session = withAcademicYear({
        id: sessionId, date, status, noClassReason,
        createdAt: new Date().toISOString(),
    });

    showSpinner();
    try {
        const { doc, setDoc } = window;
        const sessionRef = doc(window.db, 'sessions', session.id);
        await setDoc(sessionRef, session);
        createAuditLog('session_created', { date: session.date, status: session.status });
        document.getElementById('session-modal').style.display = 'none';
        showSuccess('Session created!');
    } catch (err) {
        showError('Error saving session: ' + err.message);
    } finally {
        hideSpinner();
    }
}

async function deleteSession(sessionId) {
    const session = DATA_MODELS.sessions.find(s => s.id === sessionId);
    if (!confirm(`Delete session for ${formatDate(session?.date)}? All attendance for this day will be deleted.`)) return;

    showSpinner();
    try {
        const { doc, query, collection, where, getDocs, writeBatch } = window;
        const db = window.db;
        const batch = writeBatch(db);

        // 1. Delete the Session Doc
        const sessionRef = doc(db, 'sessions', sessionId);
        batch.delete(sessionRef);

        // 2. Find and Delete all related Attendance Docs
        const q = query(collection(db, 'attendance'), where('sessionId', '==', sessionId));
        const snapshot = await getDocs(q);
        snapshot.forEach(doc => {
            batch.delete(doc.ref);
        });

        // 3. Commit
        await batch.commit();

        // 4. Update Local State
        DATA_MODELS.sessions = DATA_MODELS.sessions.filter(s => s.id !== sessionId);
        DATA_MODELS.attendance = DATA_MODELS.attendance.filter(a => a.sessionId !== sessionId);

        createAuditLog('session_deleted', { sessionId, date: session?.date, recordsDeleted: snapshot.size });
        showSuccess('Session and related attendance deleted.');
        renderSessionsTable();

    } catch (err) {
        console.error(err);
        showError('Failed to delete session: ' + err.message);
    } finally {
        hideSpinner();
    }
}

// -----------------
// 📝 ATTENDANCE MANAGEMENT
// -----------------
/**
 * Renders the attendance form (DROPDOWN VERSION).
 */
function renderAttendanceForm(sessionId) {
    const session = DATA_MODELS.sessions.find(s => s.id === sessionId);
    const container = document.getElementById('attendance-form-container');
    if (!container) return;

    if (!session) {
        container.innerHTML = '<p>Please select a session to take attendance.</p>';
        return;
    }

    let html = `<h3>Take Attendance for ${formatDate(session.date)}</h3>
        <div class="form-group">
            <label>Set Status for All Students:</label>
            <div class="btn-group">
                <button class="btn btn-success btn-sm" onclick="setAllStatus('Present')">All Present</button>
                <button class="btn btn-danger btn-sm" onclick="setAllStatus('Absent')">All Absent</button>
                <button class="btn btn-warning btn-sm" onclick="setAllStatus('Late')">All Late</button>
                <button class="btn btn-secondary btn-sm" onclick="setAllStatus('Excused')">All Excused</button>
            </div>
        </div>
        <table class="data-table">
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Student Name</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>`;

    // Sort students by ID for taking attendance too
    const sortedStudents = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || []).sort((a, b) =>
        String(a.studentId).localeCompare(String(b.studentId), undefined, { numeric: true })
    );

    sortedStudents.forEach(student => {
        const existing = DATA_MODELS.attendance.find(a => a.sessionId === sessionId && a.studentId === student.studentId);
        const status = existing ? existing.status : 'Present';
        html += `
            <tr>
                <td>${escapeHtml(student.studentId)}</td>
                <td>${escapeHtml(student.firstName)} ${escapeHtml(student.lastName)}</td>
                <td>
                    <select class="attendance-status" data-student="${escapeHtml(student.studentId)}">
                        <option value="Present" ${status === 'Present' ? 'selected' : ''}>Present</option>
                        <option value="Absent" ${status === 'Absent' ? 'selected' : ''}>Absent</option>
                        <option value="Late" ${status === 'Late' ? 'selected' : ''}>Late</option>
                        <option value="Excused" ${status === 'Excused' ? 'selected' : ''}>Excused</option>
                    </select>
                </td>
            </tr>`;
    });
    html += `</tbody></table><button class="btn btn-primary" onclick="saveAttendance('${escapeHtml(sessionId)}')">Save Attendance</button>`;
    container.innerHTML = html;
}

// Dropdown version of Set All
window.setAllStatus = (status) => {
    document.querySelectorAll('.attendance-status').forEach(select => select.value = status);
}

// Dropdown version of Save (Admin)
window.saveAttendance = async (sessionId) => {
    const inputs = document.querySelectorAll('.attendance-status');
    if (!inputs || inputs.length === 0) return showError('No attendance inputs found');

    showSpinner();
    try {
        const { doc, setDoc } = window;
        const promises = [];
        for (const select of inputs) {
            const studentId = select.dataset.student;
            const status = select.value;
            const student = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
                .find(s => String(s.studentId) === String(studentId));

            // Admin needs to look up the student's classId
            if (student && student.classId) {
                const attendanceObj = withAcademicYear({
                    sessionId, studentId, status,
                    updatedAt: new Date().toISOString(),
                    classId: student.classId,
                });
                const docId = `${sessionId}_${studentId}`;
                const docRef = doc(window.db, 'attendance', docId);
                promises.push(setDoc(docRef, attendanceObj, { merge: true }));
            }
        }
        await Promise.all(promises);
        showSuccess('Attendance saved successfully!');
    } catch (err) {
        showError('Error saving attendance: ' + err.message);
    } finally {
        hideSpinner();
    }
}

// -----------------
// 📊 ASSESSMENT MANAGEMENT
// -----------------
// REPLACE your existing renderAssessmentsTable with this one:
function renderAssessmentsTable() {
    const tbody = document.querySelector('#assessments-table tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    const sortedAssessments = [...DATA_MODELS.assessments].sort((a, b) =>
        new Date(b.date) - new Date(a.date)
    );

    sortedAssessments.forEach(assessment => {
        const scoredStudents = DATA_MODELS.scores
            .filter(score => score.assessmentId === assessment.id)
            .length;

        // Calculate total students for that class
        // (Faculty logic handles this automatically via scoped DATA_MODELS)
        const totalStudents = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
            .filter(s => String(s.classId || '') === String(assessment.classId || '')).length;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>
                ${escapeHtml(assessment.name)}
                <small style="color:gray; display:block">(${escapeHtml(assessment.classId || 'N/A')})</small>
            </td>
            <td>${formatDate(assessment.date)}</td>
            <td>${escapeHtml(assessment.totalMarks)}</td>
            <td>${scoredStudents} / ${totalStudents}</td>
            <td>
                <div class="btn-group">
                    <button class="btn btn-primary btn-sm record-scores" data-id="${escapeHtml(assessment.id)}" title="Record Scores">
                        <i class="fas fa-edit"></i> Marks
                    </button>
                    <button class="btn btn-info btn-sm view-report" data-id="${escapeHtml(assessment.id)}" title="View Report">
                        <i class="fas fa-chart-bar"></i> Report
                    </button>
                    <button class="btn btn-danger btn-sm delete-assessment" data-id="${escapeHtml(assessment.id)}" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });

    // Re-attach listeners
    tbody.querySelectorAll('.record-scores').forEach(btn => {
        btn.addEventListener('click', (e) => openScoresModal(e.currentTarget.dataset.id));
    });
    tbody.querySelectorAll('.view-report').forEach(btn => {
        btn.addEventListener('click', (e) => viewAssessmentReport(e.currentTarget.dataset.id));
    });
    tbody.querySelectorAll('.delete-assessment').forEach(btn => {
        btn.addEventListener('click', (e) => deleteAssessment(e.currentTarget.dataset.id));
    });
}

async function saveAssessment() {
    const name = document.getElementById('assessment-name').value.trim();
    const date = document.getElementById('assessment-date').value;
    const totalMarks = parseInt(document.getElementById('assessment-total-marks').value);

    // Admin version: classId comes from dropdown
    const classId = document.getElementById('assessment-class-id').value;

    if (!name || !date || isNaN(totalMarks) || totalMarks <= 0 || !classId) {
        return showError('Please fill in all required fields.');
    }

    const assessment = withAcademicYear({
        id: generateId(), name, date, totalMarks, classId
    });

    showSpinner();
    try {
        const { doc, setDoc } = window;
        const assessmentRef = doc(window.db, 'assessments', assessment.id);
        await setDoc(assessmentRef, assessment);
        createAuditLog('assessment_created', { name: assessment.name, classId: assessment.classId });
        document.getElementById('assessment-modal').style.display = 'none';
        showSuccess('Assessment created!');
    } catch (err) {
        showError('Error saving assessment: ' + err.message);
    } finally {
        hideSpinner();
    }
}

async function deleteAssessment(assessmentId) {
    const assessment = DATA_MODELS.assessments.find(a => a.id === assessmentId);
    if (!confirm(`Delete "${assessment?.name}"? All student scores for this assessment will be deleted.`)) return;

    showSpinner();
    try {
        const { doc, query, collection, where, getDocs, writeBatch } = window;
        const db = window.db;
        const batch = writeBatch(db);

        // 1. Delete the Assessment Doc
        const assessRef = doc(db, 'assessments', assessmentId);
        batch.delete(assessRef);

        // 2. Find and Delete all related Score Docs
        const q = query(collection(db, 'scores'), where('assessmentId', '==', assessmentId));
        const snapshot = await getDocs(q);
        snapshot.forEach(doc => {
            batch.delete(doc.ref);
        });

        // 3. Commit
        await batch.commit();

        // 4. Update Local State
        DATA_MODELS.assessments = DATA_MODELS.assessments.filter(a => a.id !== assessmentId);
        DATA_MODELS.scores = DATA_MODELS.scores.filter(s => s.assessmentId !== assessmentId);

        createAuditLog('assessment_deleted', { assessmentId, name: assessment?.name, recordsDeleted: snapshot.size });
        showSuccess('Assessment and related scores deleted.');
        renderAssessmentsTable();

    } catch (err) {
        console.error(err);
        showError('Failed to delete assessment: ' + err.message);
    } finally {
        hideSpinner();
    }
}

function openScoresModal(assessmentId) {
    window._currentScoresAssessmentId = assessmentId;
    const assessment = DATA_MODELS.assessments.find(a => a.id === assessmentId);
    if (!assessment) return showError('Could not find assessment details.');

    const container = document.getElementById('scores-form-container');
    let html = `<h3>Record Scores for ${escapeHtml(assessment.name)}</h3>
                <p>Date: ${formatDate(assessment.date)} | Total Marks: ${assessment.totalMarks}</p>`;
    html += '<table class="data-table"><thead><tr><th>Student</th><th>Score</th></tr></thead><tbody>';

    // Filter students by the assessment's classId
    const classStudents = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
        .filter(s => String(s.classId || '') === String(assessment.classId || ''));

    classStudents.forEach(student => {
        const existing = DATA_MODELS.scores.find(s => s.assessmentId === assessmentId && s.studentId === student.studentId);
        const score = (existing && existing.marks !== null) ? existing.marks : '';
        html += `
            <tr>
                <td>${escapeHtml(student.firstName)} ${escapeHtml(student.lastName)} (${escapeHtml(student.studentId)})</td>
                <td>
                    <input type="number" class="score-input" data-student="${escapeHtml(student.studentId)}" 
                           min="0" max="${escapeHtml(assessment.totalMarks)}" value="${escapeHtml(score)}"
                           placeholder="0-${assessment.totalMarks}">
                </td>
            </tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
    document.getElementById('scores-modal').style.display = 'flex';
}

async function saveScores() {
    const assessmentId = window._currentScoresAssessmentId;
    if (!assessmentId) return showError('Error: No assessment ID found.');

    const assessment = DATA_MODELS.assessments.find(a => a.id === assessmentId);
    if (!assessment) return showError('Error: Could not find assessment details.');

    const inputs = document.querySelectorAll('#scores-form-container .score-input');
    const toWrite = [];

    for (const input of inputs) {
        const studentId = input.dataset.student;
        const marksStr = input.value.trim();
        let marks = null;

        if (marksStr !== '') {
            marks = Number(marksStr);
            if (isNaN(marks) || marks < 0 || marks > assessment.totalMarks) {
                return showError(`Invalid score for ${studentId}: ${marksStr}.`);
            }
        }
        toWrite.push(withAcademicYear({
            assessmentId, studentId, marks,
            updatedAt: new Date().toISOString(),
            classId: assessment.classId
        }));
    }

    showSpinner();
    try {
        const { doc, setDoc } = window;
        const promises = toWrite.map(s => {
            const docId = `${s.assessmentId}_${s.studentId}`;
            const docRef = doc(window.db, 'scores', docId);
            return setDoc(docRef, s, { merge: true });
        });
        await Promise.all(promises);
        document.getElementById('scores-modal').style.display = 'none';
        window._currentScoresAssessmentId = null;
        showSuccess('Scores saved successfully!');
    } catch (err) {
        showError('Error saving scores: ' + err.message);
    } finally {
        hideSpinner();
    }
}

// -----------------
// 📜 REPORT GENERATION
// -----------------
function updateReportDropdown() {
    const classId = document.getElementById('report-class-filter').value;
    const students = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
        .filter(s => !classId || String(s.classId || '') === String(classId));

    populateDropdown('report-student', students, s => s.studentId, s => `${s.firstName} ${s.lastName} (${s.studentId})`);

    // Clear old report
    document.getElementById('report-content').innerHTML = '<p>Select a student to generate a report</p>';
}

/**
 * Enhanced generateStudentReport with improved chart rendering.
 * Waits for both charts to fully render before allowing export.
 */
async function generateStudentReport(studentId) {
    const student = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
        .find(s => String(s.studentId) === String(studentId));
    if (!student) return;
    const container = document.getElementById('report-content');
    const availableSessions = DATA_MODELS.sessions.filter(s => s.status === 'Available');
    const totalSessionsHeld = availableSessions.length;
    const studentAttendance = DATA_MODELS.attendance.filter(a => a.studentId === studentId);
    const presentCount = studentAttendance.filter(a => a.status === 'Present' || a.status === 'Late').length;
    const attendancePercentage = totalSessionsHeld > 0 ? Math.round((presentCount / totalSessionsHeld) * 100) : 0;
    const studentScores = DATA_MODELS.scores.filter(s => s.studentId === studentId);
    const assessmentDetails = studentScores.map(score => {
        const assessment = DATA_MODELS.assessments.find(a => a.id === score.assessmentId);
        return {
            name: assessment ? assessment.name : 'Unknown',
            date: assessment ? assessment.date : '',
            totalMarks: (assessment && assessment.totalMarks > 0) ? assessment.totalMarks : 0,
            marks: score.marks
        };
    }).sort((a, b) => new Date(a.date) - new Date(b.date));
    let html = `
        <div class="print-only report-header"><h2>Student Report: ${escapeHtml(student.firstName)} ${escapeHtml(student.lastName)}</h2><p>Generated on: ${formatDate(new Date().toISOString())}</p></div>
        <div class="report-section">
            <h3>Student Information</h3>
            <table class="data-table simple">
                <tr><td><strong>ID:</strong></td><td>${escapeHtml(student.studentId)}</td></tr>
                <tr><td><strong>Name:</strong></td><td>${escapeHtml(student.firstName)} ${escapeHtml(student.lastName)}</td></tr>
                <tr><td><strong>Class:</strong></td><td>${escapeHtml(student.classId || 'N/A')}</td></tr>
                <tr><td><strong>Guardian:</strong></td><td>${escapeHtml(student.guardian)}</td></tr>
                <tr><td><strong>Phone:</strong></td><td>${escapeHtml(student.phone || 'N/A')}</td></tr>
            </table>
        </div>
        <div class="report-section">
            <h3>Attendance Summary</h3>
            <table class="data-table simple">
                <tr><td><strong>Total Classes Held:</strong></td><td>${totalSessionsHeld}</td></tr>
                <tr><td><strong>Sessions Attended:</strong></td><td>${presentCount}</td></tr>
                <tr><td><strong>Attendance Percentage:</strong></td><td>${attendancePercentage}%</td></tr>
            </table>
        </div>
        <div class="report-section">
            <h3>Assessment History</h3>
            ${assessmentDetails.length > 0 ? `<table class="data-table">
                    <thead><tr><th>Assessment</th><th>Date</th><th>Marks</th><th>Total</th><th>%</th></tr></thead>
                    <tbody>
                        ${assessmentDetails.map(d => `
                            <tr>
                                <td>${escapeHtml(d.name)}</td>
                                <td>${formatDate(d.date)}</td>
                                <td>${d.marks === null ? 'N/A' : escapeHtml(d.marks)}</td>
                                <td>${escapeHtml(d.totalMarks)}</td>
                                <td>${d.totalMarks > 0 && d.marks !== null ? Math.round((d.marks / d.totalMarks) * 100) : 'N/A'}%</td>
                            </tr>`).join('')}
                    </tbody>
                </table>` : '<p>No assessments recorded.</p>'}
        </div>
        <div class="report-section">
            <h3>Performance Visualization</h3>
            <div class="grid">
                <div class="chart-container"><canvas id="marks-chart"></canvas></div>
                <div class="chart-container"><canvas id="attendance-chart"></canvas></div>
            </div>
        </div>
        <div class="no-print btn-group">
            <button class="btn btn-primary" onclick="printReport('report-content', 'Student Report')"><i class="fas fa-print"></i> Print</button>
            <button class="btn btn-success" onclick="downloadReportPDF('${escapeHtml(studentId)}', DATA_MODELS)"><i class="fas fa-file-pdf"></i> PDF</button>
        </div>`;
    container.innerHTML = html;

    // Render charts with improved timing to ensure they complete before printing
    await new Promise(resolve => {
        // Initial render
        renderMarksChart(assessmentDetails);
        renderAttendanceChart(studentId, DATA_MODELS);

        // Wait for chart animation to complete (Chart.js default animation is 750ms)
        // Adding buffer time to ensure readiness
        setTimeout(resolve, 1000);
    });
}

/**
 * Generates Report 1: Overall Attendance Matrix (With Stats Boxes)
 */
function generateOverallAttendanceReport() {
    const container = document.getElementById('overall-report-container');
    if (!container) return;

    const sessions = DATA_MODELS.sessions
        .filter(s => s.status === 'Available')
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    const students = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || []).sort((a, b) =>
        String(a.studentId).localeCompare(String(b.studentId), undefined, { numeric: true })
    );

    if (sessions.length === 0 || students.length === 0) {
        container.innerHTML = '<p>No data available.</p>';
        return;
    }

    // --- 1. Calculate Summary Stats ---
    const totalStudents = students.length;
    const totalSessions = sessions.length;
    let totalPresentCount = 0;
    let totalPossibleSlots = totalStudents * totalSessions;

    students.forEach(student => {
        sessions.forEach(session => {
            const record = DATA_MODELS.attendance.find(a =>
                a.sessionId === session.id && a.studentId === student.studentId
            );
            if (record && (record.status === 'Present' || record.status === 'Late')) {
                totalPresentCount++;
            }
        });
    });

    const classAverage = totalPossibleSlots > 0
        ? Math.round((totalPresentCount / totalPossibleSlots) * 100)
        : 0;

    // --- 2. Build HTML (Stats + Table) ---
    let html = `
        <div class="report-stats-grid">
            <div class="report-stat-card">
                <h6>Total Students</h6>
                <p>${totalStudents}</p>
            </div>
            <div class="report-stat-card">
                <h6>Total Sessions</h6>
                <p>${totalSessions}</p>
            </div>
            <div class="report-stat-card">
                <h6>Class Average</h6>
                <p>${classAverage}%</p>
            </div>
        </div>

        <div style="margin: 20px 0; text-align: right;">
            <button class="btn btn-success" id="export-attendance-csv">
                <i class="fas fa-file-csv"></i> Export Matrix CSV
            </button>
        </div>

        <div style="overflow-x: auto; border: 1px solid var(--border-color); border-radius: var(--border-radius);">
        <table class="data-table" style="font-size: 0.9rem; margin: 0;">
            <thead>
                <tr>
                    <th style="position: sticky; left: 0; background: #f5f7fa; z-index: 2; min-width: 150px;">Student</th>
                    ${sessions.map(s => `<th style="text-align: center;">${formatDate(s.date).split(',')[0]}</th>`).join('')}
                    <th style="text-align: center;">%</th>
                </tr>
            </thead>
            <tbody>
    `;

    students.forEach(student => {
        let presentCount = 0;
        let rowCells = '';

        sessions.forEach(session => {
            const record = DATA_MODELS.attendance.find(a =>
                a.sessionId === session.id && a.studentId === student.studentId
            );

            let status = record ? record.status : 'Absent';
            let badgeClass = 'status-absent';
            let content = 'A';

            if (status === 'Present') { badgeClass = 'status-present'; content = 'P'; presentCount++; }
            else if (status === 'Late') { badgeClass = 'status-late'; content = 'L'; presentCount++; }
            else if (status === 'Excused') { badgeClass = 'status-excused'; content = 'E'; }

            rowCells += `<td style="text-align: center;"><span class="status-badge ${badgeClass}" style="padding: 2px 6px;">${content}</span></td>`;
        });

        const percentage = Math.round((presentCount / sessions.length) * 100);
        let color = percentage < 75 ? 'color: var(--danger);' : 'color: var(--success);';

        html += `
            <tr>
                <td style="position: sticky; left: 0; background: var(--bg-color-alt); z-index: 1; font-weight: 500; border-right: 1px solid #eee;">
                    ${escapeHtml(student.firstName)} <small style="color:gray; display:block;">(${student.studentId})</small>
                </td>
                ${rowCells}
                <td style="font-weight: bold; text-align: center; ${color}">${percentage}%</td>
            </tr>
        `;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;

    // Re-attach the export listener
    document.getElementById('export-attendance-csv')?.addEventListener('click', exportAttendanceToCsv);
}

/**
 * Generates Report 2: Day-wise Attendance Report (SORTED & SPLIT)
 */
function generateDaywiseAttendanceReport() {
    const container = document.getElementById('daywise-report-container');
    const select = document.getElementById('report-session-date');
    const printBtn = document.getElementById('print-daywise-report-btn');
    if (!container || !select || !printBtn) return;

    const sessionId = select.value;
    if (!sessionId) {
        container.innerHTML = '<p>Please select a session to view the report.</p>';
        printBtn.style.display = 'none';
        return;
    }

    const session = DATA_MODELS.sessions.find(s => s.id === sessionId);
    if (!session) {
        container.innerHTML = '<p>Error: Session not found.</p>';
        printBtn.style.display = 'none';
        return;
    }

    if (session.status === 'NoClass') {
        container.innerHTML = `<h5>Report for ${formatDate(session.date)}</h5>
                               <p><strong>Status: No Class</strong></p>
                               <p>Reason: ${escapeHtml(session.noClassReason || 'Not specified')}</p>`;
        printBtn.style.display = 'block';
        return;
    }

    // 1. Separate students into two buckets
    const presentStudents = [];
    const absentStudents = [];

    DATA_MODELS.students.forEach(student => {
        const att = DATA_MODELS.attendance.find(a => a.sessionId === sessionId && a.studentId === student.studentId);
        const status = att ? att.status : 'Absent'; // Default to Absent

        const rowData = { student, status };

        if (status === 'Present') {
            presentStudents.push(rowData);
        } else {
            absentStudents.push(rowData);
        }
    });

    // 2. Sort both buckets by Student ID (Numeric sort)
    const sortById = (a, b) => String(a.student.studentId).localeCompare(String(b.student.studentId), undefined, { numeric: true });
    presentStudents.sort(sortById);
    absentStudents.sort(sortById);

    // 3. Build HTML Helper
    const buildTable = (title, rows, isAbsentTable = false) => {
        if (rows.length === 0) return `<p>No students in this category.</p>`;
        let html = `<h5>${title} (${rows.length})</h5>
                    <table class="data-table" style="margin-bottom: 20px;">
                        <thead>
                            <tr>
                                <th style="width: 20%;">Student ID</th>
                                <th style="width: 50%;">Name</th>
                                <th style="width: 30%;">Status</th>
                            </tr>
                        </thead>
                        <tbody>`;
        rows.forEach(row => {
            const colorClass = isAbsentTable ? 'text-danger' : 'text-success';
            html += `<tr>
                        <td>${escapeHtml(row.student.studentId)}</td>
                        <td>${escapeHtml(row.student.firstName)} ${escapeHtml(row.student.lastName)}</td>
                        <td class="${colorClass}">${escapeHtml(row.status)}</td>
                     </tr>`;
        });
        html += `</tbody></table>`;
        return html;
    };

    let finalHtml = `<h4>Attendance Report: ${formatDate(session.date)}</h4>`;
    finalHtml += buildTable('✅ Present Students', presentStudents, false);
    finalHtml += `<hr class="section-divider">`;
    finalHtml += buildTable('❌ Absent / Late / Excused', absentStudents, true);

    container.innerHTML = finalHtml;
    printBtn.style.display = 'block';
}

// -----------------
// 📦 CSV IMPORT
// -----------------
function handleCSVUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => parseCSV(e.target.result);
    reader.readAsText(file);
}

// 🚀 REPLACEMENT for parseCSV(content) in admin.js
function parseCSV(content) {
    const lines = content.split('\n').filter(line => line.trim() !== '');
    if (lines.length < 2) {
        alert('CSV file must contain at least a header row and one data row');
        return;
    }

    // Helper: Robust Date Parser
    // Handles YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, etc.
    function parseDate(dateStr) {
        if (!dateStr) return '';
        const clean = dateStr.trim();

        // 1. Try ISO Format (YYYY-MM-DD)
        if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;

        // 2. Try DD/MM/YYYY or DD-MM-YYYY (Common Excel export format)
        // Regex matches: (1-2 digits) separator (1-2 digits) separator (4 digits)
        const dmy = clean.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
        if (dmy) {
            const day = dmy[1].padStart(2, '0');
            const month = dmy[2].padStart(2, '0');
            const year = dmy[3];
            return `${year}-${month}-${day}`;
        }

        // 3. Fallback: Try standard JS Date parser (Good for "Jan 1, 2020" etc)
        const d = new Date(clean);
        if (!isNaN(d.getTime())) {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const dayStr = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${dayStr}`;
        }

        return ''; // Could not parse
    }

    const headers = lines[0].split(',').map(h => h.trim());

    // Find indices
    const headerIndices = {
        studentId: headers.indexOf('studentId'),
        firstName: headers.indexOf('firstName'),
        lastName: headers.indexOf('lastName'),
        dob: headers.indexOf('dob(YYYY-MM-DD)'),
        guardian: headers.indexOf('guardian'),
        phone: headers.indexOf('phone'),
        email: headers.indexOf('email'),
        notes: headers.indexOf('notes'),
        classId: headers.indexOf('classId')
    };

    // Flexible header matching for DOB
    if (headerIndices.dob === -1) headerIndices.dob = headers.indexOf('dob');
    if (headerIndices.dob === -1) headerIndices.dob = headers.indexOf('Date of Birth');
    if (headerIndices.dob === -1) headerIndices.dob = headers.findIndex(h => h.toLowerCase().includes('dob'));

    if (headerIndices.studentId === -1 || headerIndices.firstName === -1) {
        alert('Invalid CSV format. Header must contain at least "studentId" and "firstName".');
        return;
    }

    const students = [];
    const errors = [];

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());

        // Extract raw DOB
        const rawDob = headerIndices.dob !== -1 ? values[headerIndices.dob] : '';

        // Parse it using our smart helper
        const finalDob = parseDate(rawDob);

        const student = {
            studentId: values[headerIndices.studentId],
            firstName: values[headerIndices.firstName],
            lastName: headerIndices.lastName !== -1 ? values[headerIndices.lastName] : '',
            dob: finalDob, // Use the fixed date
            guardian: headerIndices.guardian !== -1 ? values[headerIndices.guardian] : '',
            phone: headerIndices.phone !== -1 ? values[headerIndices.phone] : '',
            email: headerIndices.email !== -1 ? values[headerIndices.email] : '',
            notes: headerIndices.notes !== -1 ? values[headerIndices.notes] : '',
            classId: headerIndices.classId !== -1 ? values[headerIndices.classId] : ''
        };

        if (!student.studentId || !student.firstName) {
            errors.push(`Row ${i + 1}: Missing required fields`);
            continue;
        }

        // Validate uniqueness
        if (DATA_MODELS.students.some(s => s.studentId === student.studentId) ||
            students.some(s => s.studentId === student.studentId)) {
            errors.push(`Row ${i + 1}: Duplicate student ID (${student.studentId})`);
            continue;
        }

        students.push(student);
    }

    // --- Preview Rendering Logic ---
    const container = document.getElementById('preview-container');
    const importCsvBtn = document.getElementById('import-csv-btn');

    if (!container) return;

    if (errors.length > 0) {
        let errorHtml = '<h4 class="text-danger">Validation Errors:</h4><ul>';
        errors.forEach(e => errorHtml += `<li>${e}</li>`);
        errorHtml += '</ul>';
        container.innerHTML = errorHtml;
        if (importCsvBtn) importCsvBtn.disabled = true;
    } else {
        let previewHtml = `<h4>Preview (${students.length} valid students):</h4>`;
        previewHtml += '<table class="data-table simple"><thead><tr>';
        headers.forEach(h => previewHtml += `<th>${h}</th>`);
        previewHtml += '</tr></thead><tbody>';

        students.slice(0, 5).forEach(s => {
            previewHtml += '<tr>';
            previewHtml += `<td>${s.studentId}</td>`;
            previewHtml += `<td>${s.firstName}</td>`;
            previewHtml += `<td>${s.lastName || ''}</td>`;
            // Display raw vs parsed if needed, or just parsed
            previewHtml += `<td>${s.dob || '<span style="color:#ccc">Empty</span>'}</td>`;
            previewHtml += `<td>${s.guardian || ''}</td>`;
            previewHtml += `<td>${s.phone || ''}</td>`;
            previewHtml += `<td>${s.email || ''}</td>`;
            previewHtml += `<td>${s.notes || ''}</td>`;
            previewHtml += `<td>${s.classId || ''}</td>`;
            previewHtml += '</tr>';
        });

        if (students.length > 5) previewHtml += `<tr><td colspan="${headers.length}">...and ${students.length - 5} more</td></tr>`;
        previewHtml += '</tbody></table>';

        container.innerHTML = previewHtml;
        if (importCsvBtn) importCsvBtn.disabled = false;
    }

    window.csvPreviewData = { validStudents: students, errors: errors };
}

async function importCSV() {
    if (!window.csvPreviewData || !window.csvPreviewData.validStudents) {
        return showError('No valid student data to import.');
    }
    const studentsToImport = window.csvPreviewData.validStudents;
    showSpinner();
    try {
        const { doc, setDoc } = window;
        const promises = studentsToImport.map(async student => {
            const yearStudent = withAcademicYear(student);
            const studentRef = doc(window.db, 'students', String(student.studentId));
            await setDoc(studentRef, yearStudent, { merge: true });
            await upsertEnrollmentForStudent(yearStudent, currentUserData?.uid || 'admin');
        });
        await Promise.all(promises);
        document.getElementById('import-modal').style.display = 'none';
        window.csvPreviewData = null;
        createAuditLog('csv_import', { count: studentsToImport.length });
        showSuccess(`Successfully imported ${studentsToImport.length} students.`);
    } catch (err) {
        showError('Import failed: ' + err.message);
    } finally {
        hideSpinner();
    }
}


// -------------------------------------------------------------------
// --- ADMIN-ONLY FUNCTIONS (ANALYTICS, TOOLS, EXPORT) ---
// -------------------------------------------------------------------

// -----------------
// 📦 DATA EXPORT TOOLS
// -----------------
function downloadJsonBackup() {
    showSpinner();
    try {
        const timestamp = new Date().toISOString().replace(/:/g, '-');
        const filename = `catechism_backup_${timestamp}.json`;
        const backupData = { exportedAt: new Date().toISOString(), ...DATA_MODELS };
        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showSuccess('JSON Backup Downloaded!');
    } catch (err) {
        showError('Backup Failed: ' + err.message);
    } finally {
        hideSpinner();
    }
}
function exportStudentsToCsv() {
    if ((getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])).length === 0) return showError('No student data to export.');
    const headers = ['studentId', 'firstName', 'lastName', 'classId', 'guardian', 'phone', 'email', 'dob', 'notes'];
    exportToCsv(DATA_MODELS.students, headers, 'students_export.csv');
}

/**
 * Exports attendance as a Matrix (Rows: Students, Cols: Dates)
 * Fix: Dates are wrapped in quotes to prevent splitting cells.
 */
function exportAttendanceToCsv() {
    if (DATA_MODELS.attendance.length === 0 || DATA_MODELS.sessions.length === 0) {
        return showError('No data to export.');
    }

    const sessions = DATA_MODELS.sessions
        .filter(s => s.status === 'Available')
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (sessions.length === 0) return showError('No class sessions found.');

    // 1. Build the Header Row
    // Fix: Wrap date in quotes -> "${date}"
    let csvContent = "Student ID,Name";
    sessions.forEach(session => {
        csvContent += `,"${formatDate(session.date)}"`;
    });
    csvContent += ",Total Present,Total Sessions,Percentage\n";

    // 2. Sort Students
    const students = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || []).sort((a, b) =>
        String(a.studentId).localeCompare(String(b.studentId), undefined, { numeric: true })
    );

    // 3. Build Data Rows
    students.forEach(student => {
        // Wrap Name in quotes to handle commas in names (e.g., "Doe, John")
        let row = `"${student.studentId}","${student.firstName} ${student.lastName}"`;
        let presentCount = 0;

        sessions.forEach(session => {
            const record = DATA_MODELS.attendance.find(a =>
                a.sessionId === session.id && a.studentId === student.studentId
            );

            let status = record ? record.status : 'Absent';

            // Short codes
            let shortCode = 'A';
            if (status === 'Present') { shortCode = 'P'; presentCount++; }
            else if (status === 'Late') { shortCode = 'L'; presentCount++; }
            else if (status === 'Excused') shortCode = 'E';

            row += `,${shortCode}`;
        });

        const percentage = Math.round((presentCount / sessions.length) * 100);
        row += `,${presentCount},${sessions.length},${percentage}%`;

        csvContent += row + "\n";
    });

    downloadCSV(csvContent, `Attendance_Matrix_${new Date().toISOString().slice(0, 10)}.csv`);
}

function exportToCsv(data, headers, filename) {
    showSpinner();
    try {
        const csvRows = [headers.join(',')];
        for (const item of data) {
            const values = headers.map(header => {
                let value = item[header];
                if (value === null || value === undefined) value = '';
                const stringValue = String(value);
                if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
                    return `"${stringValue.replace(/"/g, '""')}"`;
                }
                return stringValue;
            });
            csvRows.push(values.join(','));
        }
        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showSuccess('CSV Exported!', `${filename} has been downloaded.`);
    } catch (err) {
        showError('CSV Export Failed: ' + err.message);
    } finally {
        hideSpinner();
    }
}

// -----------------
// 📊 ADMIN ANALYTICS FUNCTIONS
// -----------------
async function loadAllDataForAdmin() {
    if (!window.db || !window.getDocs || !window.collection) {
        throw new Error('Firestore is not ready.');
    }
    console.log('Loading all admin data for analytics...');
    try {
        const { getDocs, collection, getDoc, doc } = window;
        const collectionsToFetch = [
            'students',
            'sessions',
            'attendance',
            'assessments',
            'scores',
            'earlyAngelEntries',
            'earlyAngelDailySummary',
            'earlyAngelLeaderboard',
            'userRoles',
            'classes',
            'academicYears',
            'enrollments',
            'classYearCounters',
            'facultyClassAssignments'
        ];
        const promises = collectionsToFetch.map(colName => getDocs(collection(window.db, colName)));
        const snapshots = await Promise.all(promises);
        snapshots.forEach((snapshot, index) => {
            const colName = collectionsToFetch[index];
            DATA_MODELS[colName] = [];
            snapshot.forEach(doc => {
                let data = doc.data();
                data.id = doc.id;
                if (colName === 'userRoles') data.uid = doc.id;
                DATA_MODELS[colName].push(data);
            });
        });

        const appConfigSnap = await getDoc(doc(window.db, 'appConfig', 'global'));
        DATA_MODELS.appConfig = appConfigSnap.exists()
            ? { id: 'global', ...appConfigSnap.data() }
            : { id: 'global', activeAcademicYearId: null };

        setActiveAcademicYearContext(DATA_MODELS.appConfig.activeAcademicYearId || null);
        if (typeof loadAcademicYearContext === 'function') {
            await loadAcademicYearContext(true);
        }

        const yearScopedCollections = [
            'sessions',
            'attendance',
            'assessments',
            'scores',
            'enrollments',
            'earlyAngelEntries',
            'earlyAngelDailySummary',
            'earlyAngelLeaderboard'
        ];
        yearScopedCollections.forEach(colName => {
            DATA_MODELS[colName] = (DATA_MODELS[colName] || []).filter(isCurrentAcademicYear);
        });
        console.log('All admin data loaded.');
    } catch (err) {
        console.error('Error loading admin data:', err);
        throw new Error('Error loading admin data: ' + err.message);
    }
}

function renderAdminAnalytics() {
    console.log('Rendering admin analytics...');
    const facultyTableBody = document.querySelector('#faculty-performance-table tbody');
    if (!facultyTableBody) return console.error('Faculty performance table body not found!');
    facultyTableBody.innerHTML = '';
    const faculty = DATA_MODELS.userRoles.filter(u => u.role === 'faculty');
    const availableSessions = DATA_MODELS.sessions.filter(s => s.status === 'Available');
    if (faculty.length === 0) {
        facultyTableBody.innerHTML = '<tr><td colspan="4">No faculty users found.</td></tr>';
    }
    faculty.forEach(fac => {
        const displayEmail = fac.email || fac.uid;
        const facultyClass = DATA_MODELS.classes.find(c => c.id === fac.classId);
        const className = facultyClass ? facultyClass.name : (fac.classId || 'N/A');
        const students = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
            .filter(s => String(s.classId || '') === String(fac.classId || ''));
        const studentCount = students.length;
        let totalPercentage = 0;
        let validStudents = 0;
        if (availableSessions.length > 0) {
            students.forEach(student => {
                const presentCount = DATA_MODELS.attendance.filter(a => a.studentId === student.studentId && (a.status === 'Present' || a.status === 'Late')).length;
                totalPercentage += (presentCount / availableSessions.length) * 100;
                validStudents++;
            });
        }
        const avgAttendance = (validStudents > 0) ? Math.round(totalPercentage / validStudents) : 0;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${escapeHtml(displayEmail)}</td>
            <td>${escapeHtml(className)}</td>
            <td>${studentCount}</td>
            <td>${avgAttendance}%</td>`;
        facultyTableBody.appendChild(row);
    });
    document.getElementById('analytics-class-filter').addEventListener('change', renderAnalyticsCharts);
    renderAnalyticsCharts();
}

function renderAnalyticsCharts() {
    const classId = document.getElementById('analytics-class-filter').value;
    const attCtx = document.getElementById('class-attendance-chart');
    if (!attCtx) return;
    if (window.classAttendanceChart) window.classAttendanceChart.destroy();
    const chartLabels = [], chartData = [];
    const availableSessions = DATA_MODELS.sessions.filter(s => s.status === 'Available');
    const classesToChart = classId ? [DATA_MODELS.classes.find(c => c.id === classId)] : DATA_MODELS.classes;
    if (availableSessions.length > 0) {
        classesToChart.forEach(classObj => {
            if (!classObj) return;
            const studentsInClass = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
                .filter(s => String(s.classId || '') === String(classObj.id || ''));
            if (studentsInClass.length === 0) {
                chartLabels.push(classObj.name); chartData.push(0); return;
            };
            let totalPercentage = 0;
            studentsInClass.forEach(student => {
                const presentCount = DATA_MODELS.attendance.filter(a => a.studentId === student.studentId && (a.status === 'Present' || a.status === 'Late')).length;
                totalPercentage += (presentCount / availableSessions.length) * 100;
            });
            chartLabels.push(classObj.name);
            chartData.push(Math.round(totalPercentage / studentsInClass.length));
        });
    }
    window.classAttendanceChart = new Chart(attCtx.getContext('2d'), {
        type: 'bar',
        data: {
            labels: chartLabels.map(l => escapeHtml(l)),
            datasets: [{
                label: 'Average Class Attendance (%)',
                data: chartData,
                backgroundColor: 'rgba(52, 152, 219, 0.7)',
                borderColor: 'rgba(52, 152, 219, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, max: 100 } }
        }
    });

    const assessCtx = document.getElementById('class-assessment-chart');
    if (!assessCtx) return;
    if (window.classAssessmentChart) window.classAssessmentChart.destroy();
    const assessmentsToChart = classId ? DATA_MODELS.assessments.filter(a => a.classId === classId) : DATA_MODELS.assessments;
    const assessmentLabels = [], assessmentData = [];
    assessmentsToChart.forEach(assessment => {
        const scores = DATA_MODELS.scores.filter(s => s.assessmentId === assessment.id && s.marks !== null);
        if (scores.length === 0) {
            assessmentLabels.push(assessment.name); assessmentData.push(null); return; // Use null for no data
        };
        let totalScore = 0;
        scores.forEach(s => {
            if (assessment.totalMarks && assessment.totalMarks > 0) {
                totalScore += (s.marks / assessment.totalMarks) * 100;
            }
        });
        assessmentLabels.push(assessment.name);
        assessmentData.push(Math.round(totalScore / scores.length));
    });

    window.classAssessmentChart = new Chart(assessCtx.getContext('2d'), {
        type: 'line',
        data: {
            labels: assessmentLabels.map(l => escapeHtml(l)),
            datasets: [{
                label: 'Average Assessment Score (%)',
                data: assessmentData,
                borderColor: 'rgba(39, 174, 96, 1)',
                backgroundColor: 'rgba(39, 174, 96, 0.1)',
                fill: true,
                tension: 0.1,
                spanGaps: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, max: 100 } }
        }
    });
}

function getDefaultAcademicYearId() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    // Academic year rolls over in June.
    return month >= 5 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

function getAcademicYearLabel(yearDoc) {
    if (!yearDoc) return 'N/A';
    return yearDoc.label || yearDoc.id || 'N/A';
}

async function ensureAcademicYearSetup() {
    if (!window.db || !window.doc || !window.setDoc) return;

    let requiresReload = false;
    const defaultYearId = getDefaultAcademicYearId();
    const defaultYearRef = window.doc(window.db, 'academicYears', defaultYearId);

    if (!Array.isArray(DATA_MODELS.academicYears) || DATA_MODELS.academicYears.length === 0) {
        await window.setDoc(defaultYearRef, {
            id: defaultYearId,
            label: `Academic Year ${defaultYearId}`,
            startDate: `${defaultYearId.slice(0, 4)}-06-01`,
            endDate: `${defaultYearId.slice(5)}-05-31`,
            status: 'active',
            migrationEnabled: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        }, { merge: true });
        requiresReload = true;
    }

    const configuredActiveYear = DATA_MODELS.appConfig?.activeAcademicYearId || null;
    if (!configuredActiveYear) {
        const fallbackYear = DATA_MODELS.academicYears?.[0]?.id || defaultYearId;
        await window.setDoc(window.doc(window.db, 'appConfig', 'global'), {
            activeAcademicYearId: fallbackYear,
            updatedAt: new Date().toISOString(),
        }, { merge: true });
        requiresReload = true;
    }

    if (requiresReload) {
        await loadAllDataForAdmin();
    }

    setActiveAcademicYearContext(DATA_MODELS.appConfig?.activeAcademicYearId || null);
}

function renderAcademicYearControls() {
    const years = [...(DATA_MODELS.academicYears || [])].sort((a, b) => String(b.id || '').localeCompare(String(a.id || '')));
    const activeYearId = DATA_MODELS.appConfig?.activeAcademicYearId || getActiveAcademicYearId() || '';

    const activeYearDoc = years.find(y => y.id === activeYearId);
    const activeYearTextEl = document.getElementById('active-academic-year-current');
    if (activeYearTextEl) {
        activeYearTextEl.textContent = activeYearDoc ? `${getAcademicYearLabel(activeYearDoc)} (${activeYearDoc.id})` : 'Not set';
    }

    populateDropdown(
        'active-academic-year-select',
        years,
        y => y.id,
        y => `${getAcademicYearLabel(y)} (${y.id})`
    );

    const activeSelect = document.getElementById('active-academic-year-select');
    if (activeSelect && activeYearId) {
        activeSelect.value = activeYearId;
    }

    populateDropdown(
        'academic-year-previous-select',
        years,
        y => y.id,
        y => `${getAcademicYearLabel(y)} (${y.id})`
    );

    const tableBody = document.querySelector('#academic-years-table tbody');
    if (!tableBody) return;

    tableBody.innerHTML = '';
    if (years.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="8">No academic years configured.</td></tr>';
        return;
    }

    years.forEach(year => {
        const row = document.createElement('tr');
        const isActive = year.id === activeYearId;
        const canEdit = !!year.id;
        row.innerHTML = `
            <td>${escapeHtml(year.id || '-')}</td>
            <td>${escapeHtml(getAcademicYearLabel(year))}</td>
            <td>${escapeHtml(year.startDate || '-')}</td>
            <td>${escapeHtml(year.endDate || '-')}</td>
            <td>${escapeHtml(year.previousYearId || '-')}</td>
            <td>${year.migrationEnabled ? '<span class="status-badge status-present">Enabled</span>' : '<span class="status-badge status-absent">Disabled</span>'}</td>
            <td>${isActive ? '<span class="status-badge status-late">Active</span>' : '-'}</td>
            <td>
                ${canEdit
                ? `<button type="button" class="btn btn-warning btn-sm edit-academic-year" data-id="${escapeHtml(year.id)}"><i class="fas fa-edit"></i> Edit</button>`
                : '-'}
            </td>
        `;
        tableBody.appendChild(row);
    });

    tableBody.querySelectorAll('.edit-academic-year').forEach(btn => {
        btn.addEventListener('click', (e) => startEditAcademicYear(e.currentTarget.dataset.id));
    });

    if (editingAcademicYearId && !years.some(y => y.id === editingAcademicYearId)) {
        resetAcademicYearForm();
    }

    // PHASE 2: Render migration wizard controls
    renderMigrationWizardControls();
}

function startEditAcademicYear(yearId) {
    const year = (DATA_MODELS.academicYears || []).find(y => y.id === yearId);
    if (!year) {
        return showError('Academic year not found. Refresh and try again.');
    }

    editingAcademicYearId = year.id;

    const idInput = document.getElementById('academic-year-id-input');
    const labelInput = document.getElementById('academic-year-label-input');
    const startInput = document.getElementById('academic-year-start-input');
    const endInput = document.getElementById('academic-year-end-input');
    const previousInput = document.getElementById('academic-year-previous-select');
    const migrationToggle = document.getElementById('academic-year-migration-enabled');
    const titleEl = document.getElementById('academic-year-form-title');
    const saveBtn = document.getElementById('save-academic-year-btn');
    const cancelBtn = document.getElementById('cancel-academic-year-edit-btn');

    if (idInput) {
        idInput.value = year.id || '';
        idInput.disabled = true;
    }
    if (labelInput) labelInput.value = year.label || '';
    if (startInput) startInput.value = year.startDate || '';
    if (endInput) endInput.value = year.endDate || '';
    if (previousInput) previousInput.value = year.previousYearId || '';
    if (migrationToggle) migrationToggle.checked = !!year.migrationEnabled;
    if (titleEl) titleEl.textContent = `Edit Academic Year (${year.id})`;
    if (saveBtn) saveBtn.innerHTML = '<i class="fas fa-save"></i> Update Academic Year';
    if (cancelBtn) cancelBtn.style.display = 'inline-flex';

    document.getElementById('academic-year-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetAcademicYearForm() {
    editingAcademicYearId = null;

    const form = document.getElementById('academic-year-form');
    const idInput = document.getElementById('academic-year-id-input');
    const titleEl = document.getElementById('academic-year-form-title');
    const saveBtn = document.getElementById('save-academic-year-btn');
    const cancelBtn = document.getElementById('cancel-academic-year-edit-btn');

    form?.reset();
    if (idInput) idInput.disabled = false;
    if (titleEl) titleEl.textContent = 'Create / Update Academic Year';
    if (saveBtn) saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Academic Year';
    if (cancelBtn) cancelBtn.style.display = 'none';
}

async function saveAcademicYear(e) {
    e.preventDefault();
    const idInput = document.getElementById('academic-year-id-input');
    const labelInput = document.getElementById('academic-year-label-input');
    const startInput = document.getElementById('academic-year-start-input');
    const endInput = document.getElementById('academic-year-end-input');
    const previousInput = document.getElementById('academic-year-previous-select');
    const migrationToggle = document.getElementById('academic-year-migration-enabled');

    const id = idInput?.value.trim();
    const label = labelInput?.value.trim();
    const startDate = startInput?.value || '';
    const endDate = endInput?.value || '';
    const previousYearId = previousInput?.value || null;
    const migrationEnabled = !!migrationToggle?.checked;
    const isEditMode = !!editingAcademicYearId;
    const targetId = editingAcademicYearId || id;

    if (!targetId || !startDate || !endDate) {
        return showError('Please provide Year ID, Start Date and End Date.');
    }

    if (isEditMode && id && id !== editingAcademicYearId) {
        return showError('Year ID cannot be changed while editing. Click Cancel Edit to create a new year.');
    }

    showSpinner();
    try {
        const payload = {
            id: targetId,
            label: label || `Academic Year ${targetId}`,
            startDate,
            endDate,
            previousYearId,
            migrationEnabled,
            status: 'active',
            updatedAt: new Date().toISOString(),
        };

        const existing = DATA_MODELS.academicYears.find(y => y.id === targetId);
        if (!existing) {
            payload.createdAt = new Date().toISOString();
        }

        await window.setDoc(window.doc(window.db, 'academicYears', targetId), payload, { merge: true });

        if (!DATA_MODELS.appConfig?.activeAcademicYearId) {
            await window.setDoc(window.doc(window.db, 'appConfig', 'global'), {
                activeAcademicYearId: targetId,
                updatedAt: new Date().toISOString(),
            }, { merge: true });
            setActiveAcademicYearContext(targetId);
        }

        createAuditLog(isEditMode ? 'academic_year_updated' : 'academic_year_saved', {
            id: targetId,
            migrationEnabled,
            previousYearId,
        });

        await loadAllDataForAdmin();
        renderAcademicYearControls();
        resetAcademicYearForm();
        showSuccess(isEditMode ? 'Academic year updated successfully.' : 'Academic year saved successfully.');
    } catch (err) {
        showError('Failed to save academic year: ' + err.message);
    } finally {
        hideSpinner();
    }
}

async function saveActiveAcademicYear() {
    const select = document.getElementById('active-academic-year-select');
    const selectedYearId = select?.value || '';
    if (!selectedYearId) return showError('Please choose an academic year.');

    showSpinner();
    try {
        await window.setDoc(window.doc(window.db, 'appConfig', 'global'), {
            activeAcademicYearId: selectedYearId,
            updatedAt: new Date().toISOString(),
        }, { merge: true });

        setActiveAcademicYearContext(selectedYearId);
        createAuditLog('academic_year_activated', { activeAcademicYearId: selectedYearId });

        await loadAllDataForAdmin();
        renderAcademicYearControls();
        startRealtimeListeners();
        showSuccess('Active academic year updated.');
    } catch (err) {
        showError('Failed to update active academic year: ' + err.message);
    } finally {
        hideSpinner();
    }
}

async function backfillAcademicYearForLegacyData() {
    const activeYearId = getActiveAcademicYearId();
    if (!activeYearId) {
        return showError('Set an active academic year before running backfill.');
    }

    const result = await showConfirmWithInput(
        'Run Academic Year Backfill?',
        `This will add academicYearId (${activeYearId}) to old records that do not have one. Type "BACKFILL" to continue.`,
        'BACKFILL'
    );
    if (result.value !== 'BACKFILL') return showSuccess('Backfill canceled.');

    showSpinner();
    try {
        const { collection, getDocs, setDoc } = window;
        const targetCollections = ['students', 'sessions', 'assessments', 'attendance', 'scores'];
        let updatedCount = 0;
        let enrollmentCount = 0;

        for (const colName of targetCollections) {
            const snapshot = await getDocs(collection(window.db, colName));
            const writePromises = [];

            snapshot.forEach(docSnap => {
                const data = docSnap.data() || {};
                if (!data.academicYearId) {
                    writePromises.push(setDoc(docSnap.ref, { academicYearId: activeYearId }, { merge: true }));
                    updatedCount++;
                }
            });

            if (writePromises.length > 0) {
                await Promise.all(writePromises);
            }

            if (colName === 'students') {
                for (const studentDoc of snapshot.docs) {
                    const studentData = { ...studentDoc.data(), studentId: studentDoc.id, academicYearId: activeYearId };
                    if (studentData.classId) {
                        const enrollment = await upsertEnrollmentForStudent(studentData, currentUserData?.uid || 'admin');
                        if (enrollment) enrollmentCount++;
                    }
                }
            }
        }

        createAuditLog('academic_year_backfill_run', {
            academicYearId: activeYearId,
            updatedCount,
            enrollmentCount,
        });

        await loadAllDataForAdmin();
        renderAcademicYearControls();
        startRealtimeListeners();
        showSuccess('Backfill complete!', `Updated ${updatedCount} records and synced ${enrollmentCount} enrollments.`);
    } catch (err) {
        showError('Backfill failed: ' + err.message);
    } finally {
        hideSpinner();
    }
}

/**
 * PHASE 2: Enable migration for a specific academic year
 * Admin UI calls this when clicking "Enable Migration" button
 */
async function enableMigrationForYear() {
    const yearSelect = document.getElementById('migration-enable-year-select');
    const selectedYearId = yearSelect?.value || '';
    if (!selectedYearId) return showError('Please select an academic year.');

    const year = DATA_MODELS.academicYears?.find(y => y.id === selectedYearId);
    if (!year) return showError('Year not found.');

    const result = await showConfirm(
        `Enable Migration for ${year.label}?`,
        `Faculty will be able to import students from ${year.previousYearId || 'the previous year'} to this year.`
    );

    if (!result.isConfirmed) return;

    showSpinner();
    try {
        await setMigrationEnabled(selectedYearId, true);
        await loadAllDataForAdmin();
        renderAcademicYearControls();
        showSuccess('Migration enabled for ' + year.label);
    } catch (err) {
        showError('Failed to enable migration: ' + err.message);
    } finally {
        hideSpinner();
    }
}

/**
 * PHASE 2: Disable migration for all years
 */
async function disableMigrationForAllYears() {
    const result = await showConfirm(
        'Disable All Migrations?',
        'Faculty will no longer be able to import students from previous years.'
    );

    if (!result.isConfirmed) return;

    showSpinner();
    try {
        const promises = (DATA_MODELS.academicYears || []).map(year =>
            setMigrationEnabled(year.id, false)
        );
        await Promise.all(promises);
        await loadAllDataForAdmin();
        renderAcademicYearControls();
        showSuccess('All migrations disabled.');
    } catch (err) {
        showError('Failed to disable migrations: ' + err.message);
    } finally {
        hideSpinner();
    }
}

/**
 * PHASE 2: Populate migration wizard controls
 */
function renderMigrationWizardControls() {
    const select = document.getElementById('migration-enable-year-select');
    if (!select) return;

    const years = (DATA_MODELS.academicYears || []).filter(y => y.status === 'active');
    select.innerHTML = '<option value="">-- Select --</option>';
    years.forEach(year => {
        const option = document.createElement('option');
        option.value = year.id;
        option.textContent = `${year.label} (${year.id})${year.migrationEnabled ? ' [Migration ON]' : ''}`;
        select.appendChild(option);
    });
}


// -----------------
// 🛠️ ADMIN DATA TOOLS
// -----------------

/**
 * Fetches all classes and populates dropdowns.
 * This is an admin-only helper.
 */
async function populateClassDropdowns(selectElementId) {
    const selectEl = document.getElementById(selectElementId);
    if (!selectEl) return;

    if (!window.db || !window.collection || !window.getDocs || !window.query) {
        console.warn(`populateClassDropdowns: Firestore services not ready for ${selectElementId}`);
        return;
    }

    try {
        const currentValue = selectEl.value;
        const defaultOption = selectEl.options[0] ? selectEl.options[0].cloneNode(true) : document.createElement('option');
        if (!defaultOption.value) {
            defaultOption.value = "";
            defaultOption.textContent = "-- Select --";
        }

        selectEl.innerHTML = '';
        selectEl.appendChild(defaultOption);

        const q = window.query(collection(window.db, 'classes'));
        const querySnapshot = await getDocs(q);

        querySnapshot.forEach((doc) => {
            const classData = doc.data();
            const option = document.createElement('option');
            option.value = doc.id; // e.g., "class-6"
            option.textContent = classData.name; // e.g., "Class 6"
            selectEl.appendChild(option);
        });

        if (currentValue) selectEl.value = currentValue;

    } catch (err) {
        console.error(`Error populating dropdown #${selectElementId}:`, err);
    }
}

async function renderClassesTable() {
    const tbody = document.querySelector('#classes-table tbody');
    if (!tbody) return;
    try {
        const classes = DATA_MODELS.classes;
        tbody.innerHTML = '';
        if (classes.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3">No classes created.</td></tr>';
        }
        classes.forEach((classData) => {
            const row = document.createElement('tr');
            row.innerHTML = `<td>${escapeHtml(classData.id)}</td><td>${escapeHtml(classData.name)}</td>
                <td><button class="btn btn-danger btn-sm delete-class-btn" data-id="${escapeHtml(classData.id)}"><i class="fas fa-trash"></i></button></td>`;
            tbody.appendChild(row);
        });
        tbody.querySelectorAll('.delete-class-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.currentTarget.dataset.id;
                const result = await showConfirm('Delete Class?', `Delete ${id}?`);
                if (result.isConfirmed) {
                    await deleteDoc(doc(window.db, 'classes', id));
                    await loadAllDataForAdmin(); // Manually refresh data
                    renderClassesTable();
                    createAuditLog('class_deleted', { classId: id });
                    showSuccess('Class deleted.');
                }
            });
        });
    } catch (err) {
        console.error("Error rendering classes table:", err);
        tbody.innerHTML = `<tr><td colspan="3" class="text-danger">Error loading classes.</td></tr>`;
    }
}

async function saveClass(e) {
    e.preventDefault();
    const classIdInput = document.getElementById('class-id-input');
    const classNameInput = document.getElementById('class-name-input');
    const classId = classIdInput.value.trim();
    const className = classNameInput.value.trim();
    if (!classId || !className) return showError('Class ID and Name are required.');
    showSpinner();
    try {
        const { doc, setDoc } = window;
        await setDoc(doc(window.db, 'classes', classId), { name: className }, { merge: true });
        showSuccess('Class saved!');
        createAuditLog('class_saved', { classId: classId, name: className });
        classIdInput.value = '';
        classNameInput.value = '';
        await loadAllDataForAdmin(); // Manually refresh
        renderClassesTable();
        await populateClassDropdowns('user-class-id-select'); // Repopulate dropdowns
    } catch (err) {
        showError('Error saving class: ' + err.message);
    } finally {
        hideSpinner();
    }
}

async function saveUserRole(e) {
    e.preventDefault();
    const uid = document.getElementById('user-uid-input').value.trim();
    const role = document.getElementById('user-role-select').value;
    const classId = document.getElementById('user-class-id-select').value;

    const email = prompt(`Enter the email for this user (UID: ${uid}) for display purposes:`);
    if (!email) {
        showError('Email is required to save a role.');
        return;
    }

    if (!uid || !role) return showError('UID and Role are required.');

    let roleData = {
        role: role,
        email: email // Store email for the analytics dashboard
    };

    if (role === 'faculty') {
        if (!classId) return showError('Please select a class for the faculty.');
        roleData.classId = classId;
    }
    showSpinner();
    try {
        const { doc, setDoc } = window;
        await setDoc(doc(window.db, 'userRoles', uid), roleData);

        if (role === 'faculty') {
            const activeYearId = getActiveAcademicYearId() || DATA_MODELS.appConfig?.activeAcademicYearId || null;
            if (activeYearId) {
                const assignmentId = `${activeYearId}_${uid}`;
                await setDoc(doc(window.db, 'facultyClassAssignments', assignmentId), {
                    id: assignmentId,
                    academicYearId: activeYearId,
                    uid,
                    email,
                    classId,
                    updatedAt: new Date().toISOString(),
                    updatedBy: currentUserData?.uid || 'admin'
                }, { merge: true });
            }
        }

        showSuccess('User role saved!');
        createAuditLog('user_role_updated', { assignedUid: uid, role: role, classId: classId, email: email });
        document.getElementById('user-role-form').reset();
        await loadAllDataForAdmin(); // Refresh admin data
        renderAdminAnalytics();
    } catch (err) {
        showError('Error saving role: ' + err.message);
    } finally {
        hideSpinner();
    }
}

// --- Data Migration Tools ---
async function runBackfillMigration() {
    const classId = document.getElementById('migration-class-id').value.trim();
    if (!classId) return showError('Please enter a Class ID.');
    const result = await showConfirmWithInput(
        'Run Migration?',
        `This will add 'classId: "${classId}"' to ALL documents. Type "MIGRATE" to confirm.`,
        'MIGRATE'
    );
    if (result.value !== 'MIGRATE') return showSuccess('Migration Canceled.');
    showSpinner();
    try {
        const { collection, getDocs, setDoc } = window;
        const collections = ['students', 'sessions', 'assessments', 'attendance', 'scores'];
        let totalUpdated = 0;
        for (const colName of collections) {
            const snapshot = await getDocs(collection(window.db, colName));
            if (snapshot.empty) continue;
            const promises = [];
            snapshot.forEach((doc) => {
                if (!doc.data().classId) {
                    promises.push(setDoc(doc.ref, { classId: classId }, { merge: true }));
                }
            });
            if (promises.length > 0) {
                await Promise.all(promises);
                totalUpdated += promises.length;
            }
        }
        showSuccess('Migration Complete!', `Updated ${totalUpdated} documents.`);
        createAuditLog('data_migration_run', { assignedClassId: classId, totalUpdated });
    } catch (err) {
        showError('Migration Failed: ' + err.message);
    } finally {
        hideSpinner();
    }
}

async function runFieldCleanup() {
    const result = await showConfirmWithInput(
        'Run Cleanup?',
        'This will remove the old "class" field from all students. Type "CLEANUP" to confirm.',
        'CLEANUP'
    );
    if (result.value !== 'CLEANUP') return showSuccess('Cleanup Canceled.');
    showSpinner();
    try {
        const { collection, getDocs, updateDoc, deleteField } = window;
        const snapshot = await getDocs(collection(window.db, 'students'));
        if (snapshot.empty) return showSuccess('Cleanup Complete', 'No students found.');
        const promises = [];
        snapshot.forEach((doc) => {
            if (doc.data().class !== undefined) {
                promises.push(updateDoc(doc.ref, { class: deleteField() }));
            }
        });
        if (promises.length === 0) {
            showSuccess('Cleanup Complete', 'No documents had the old "class" field.');
        } else {
            await Promise.all(promises);
            showSuccess('Cleanup Complete!', `Removed "class" field from ${promises.length} documents.`);
            createAuditLog('data_cleanup_run', { field: 'class', collection: 'students', count: promises.length });
        }
    } catch (err) {
        showError('Cleanup Failed: ' + err.message);
    } finally {
        hideSpinner();
    }
}

async function runSessionCleanup() {
    const result = await showConfirmWithInput(
        'Run Session Cleanup?',
        'This will remove "classId" from all SESSIONS. Type "CLEANUP SESSIONS" to confirm.',
        'CLEANUP SESSIONS'
    );
    if (result.value !== 'CLEANUP SESSIONS') return showSuccess('Cleanup Canceled.');
    showSpinner();
    try {
        const { collection, getDocs, updateDoc, deleteField } = window;
        const snapshot = await getDocs(collection(window.db, 'sessions'));
        if (snapshot.empty) return showSuccess('Cleanup Complete', 'No sessions found.');
        const promises = [];
        snapshot.forEach((doc) => {
            if (doc.data().classId !== undefined) {
                promises.push(updateDoc(doc.ref, { classId: deleteField() }));
            }
        });
        if (promises.length === 0) {
            showSuccess('Cleanup Complete', 'No sessions had the "classId" field.');
        } else {
            await Promise.all(promises);
            showSuccess('Cleanup Complete!', `Removed "classId" field from ${promises.length} sessions.`);
            createAuditLog('data_cleanup_run', { field: 'classId', collection: 'sessions', count: promises.length });
        }
    } catch (err) {
        showError('Session Cleanup Failed: ' + err.message);
    } finally {
        hideSpinner();
    }
}

// PASTE THIS NEW FUNCTION over the old runStudentIdMigration in admin.js

/**
 * [CORRECTED] Migrates all related records from an old studentId to a new one.
 * This version reads the old docs, creates NEW docs with the new ID,
 * and then deletes the old docs and the old student.
 */
async function runStudentIdMigration(e) {
    e.preventDefault();
    const oldId = document.getElementById('migration-old-id').value.trim();
    const newId = document.getElementById('migration-new-id').value.trim();

    if (!oldId || !newId) {
        return showError('Both Old ID and New ID are required.');
    }

    const result = await showConfirm(
        'Run CORRECTED Migration?',
        `This will find all records ending in "_${oldId}", create new ones ending in "_${newId}", and delete the originals. This is the correct fix. Are you sure?`,
        'Yes, migrate now'
    );

    if (!result.isConfirmed) {
        return showSuccess('Migration canceled.');
    }

    showSpinner();
    try {
        // Ensure all functions are imported
        const { collection, getDocs, writeBatch, doc, setDoc, getDoc, query, where } = window;
        const db = window.db;
        const batch = writeBatch(db);
        let attendanceCount = 0;
        let scoresCount = 0;

        // 1. Find and update all ATTENDANCE records
        // We must query by the OLD ID in the field, which my *last* script set to the NEW ID.
        // So we will query for the new ID, but check the doc.id for the old one.
        // This is messy, but will work.
        const qAtt = query(collection(db, 'attendance'), where('studentId', '==', newId));
        const attSnap = await getDocs(qAtt);

        attSnap.forEach(doc => {
            // Find docs that still have the OLD ID in their name
            if (doc.id.endsWith(`_${oldId}`)) {
                const oldData = doc.data();
                oldData.studentId = newId; // Ensure internal field is correct

                const newDocId = doc.id.replace(`_${oldId}`, `_${newId}`);
                const newDocRef = window.doc(db, 'attendance', newDocId);

                batch.set(newDocRef, oldData); // Create the new doc
                batch.delete(doc.ref); // Delete the old doc
                attendanceCount++;
            }
        });

        // 2. Find and update all SCORES records
        const qScores = query(collection(db, 'scores'), where('studentId', '==', newId));
        const scoresSnap = await getDocs(qScores);

        scoresSnap.forEach(doc => {
            // Find docs that still have the OLD ID in their name
            if (doc.id.endsWith(`_${oldId}`)) {
                const oldData = doc.data();
                oldData.studentId = newId; // Ensure internal field is correct

                const newDocId = doc.id.replace(`_${oldId}`, `_${newId}`);
                const newDocRef = window.doc(db, 'scores', newDocId);

                batch.set(newDocRef, oldData); // Create the new doc
                batch.delete(doc.ref); // Delete the old doc
                scoresCount++;
            }
        });

        // 3. Delete the temporary "students/101" document
        const oldStudentRef = doc(db, 'students', oldId);
        batch.delete(oldStudentRef);

        // 4. Commit the batch
        await batch.commit();

        showSuccess('Migration Complete!', `Migrated ${attendanceCount} attendance records and ${scoresCount} score records. The old student doc (${oldId}) was deleted.`);

        document.getElementById('migration-old-id').value = '';
        document.getElementById('migration-new-id').value = '';

        await loadAllDataForAdmin();
        renderStudentsTable();

    } catch (err) {
        showError('Migration Failed: ' + err.message);
    } finally {
        hideSpinner();
    }
}

// --- NEW DRAG-AND-DROP HELPER FUNCTIONS ---

function handleDragStart(e) {
    // Store the ID of the student being dragged
    e.dataTransfer.setData('text/plain', e.target.dataset.studentId);
}

function handleDragOver(e) {
    // Allow the drop
    e.preventDefault();
}

function handleDrop(e) {
    e.preventDefault();
    const studentId = e.dataTransfer.getData('text/plain');
    const card = document.querySelector(`.att-student-card[data-student-id="${studentId}"]`);
    if (!card) return;

    // Find the closest list and append the card
    const dropZone = e.target.closest('.att-list');
    if (dropZone) {
        dropZone.appendChild(card);
    }
}

// ---------------------------------------------------------
// 🚀 BULK ATTENDANCE IMPORT (Matrix Format) - FIXED & ROBUST
// ---------------------------------------------------------

// 1. Handle File Selection & Preview
function handleBulkAttendanceUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        parseBulkAttendanceCSV(e.target.result);
    };
    reader.readAsText(file);
}

// 2. Parse CSV and Prepare Data (Robust Header Split Fix)
function parseBulkAttendanceCSV(content) {
    const lines = content.split('\n').filter(line => line.trim() !== '');
    if (lines.length < 2) return alert('CSV must have a header and data.');

    // Helper: Robust split for CSV lines (handles "Jul 12, 2025" correctly)
    // Splits by comma ONLY if that comma is not inside quotes
    const splitCsvLine = (line) => {
        return line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(cell => cell.trim().replace(/^"|"$/g, ''));
    };

    // Helper: Parse various date formats
    function parseHeaderDate(dateStr) {
        if (!dateStr) return null;
        const clean = dateStr.trim();

        // Skip stats columns
        if (clean.startsWith('Total') || clean.startsWith('Percentage')) return null;

        // Try standard date parse (Handles "Jul 13, 2025", "2025-07-13")
        const d = new Date(clean);

        // Validate: Must be a valid date AND have a realistic year (e.g., > 2020)
        // This filter prevents "Jul 13" (parsed as 2001) from being accepted if the split failed
        if (!isNaN(d.getTime()) && d.getFullYear() > 2020) {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }
        return null;
    }

    // A. Parse Headers (Using robust split)
    const headers = splitCsvLine(lines[0]);

    const dateIndices = [];
    const sessionDates = new Set();

    headers.forEach((h, index) => {
        // Skip ID/Name columns
        if (index < 2) return;

        const isoDate = parseHeaderDate(h);
        if (isoDate) {
            sessionDates.add(isoDate);
            dateIndices.push({ index: index, date: isoDate });
        }
    });

    const uniqueSessions = Array.from(sessionDates).sort();

    if (uniqueSessions.length === 0) {
        return alert('No valid date columns found (checked for years > 2020). Headers must be like "Jul 13, 2025" or "2025-07-13".');
    }

    // B. Parse Rows
    const attendanceData = [];
    let validRows = 0;

    for (let i = 1; i < lines.length; i++) {
        const row = splitCsvLine(lines[i]);

        const csvStudentId = row[0];
        if (!csvStudentId) continue;

        // Robust Matching: Trim and String match
        const student = DATA_MODELS.students.find(s =>
            String(s.studentId).trim() === String(csvStudentId).trim()
        );

        if (!student) {
            console.warn(`Row ${i}: Skipped unknown Student ID "${csvStudentId}"`);
            continue;
        }

        validRows++;

        // Loop through identified date columns
        dateIndices.forEach(col => {
            // Safety check: ensure row has this column
            if (col.index >= row.length) return;

            const rawValue = row[col.index] ? row[col.index].toUpperCase() : 'A';
            let status = 'Absent'; // Default

            if (['P', 'PRESENT', '1', 'Y', 'YES'].includes(rawValue)) status = 'Present';
            else if (['L', 'LATE'].includes(rawValue)) status = 'Late';
            else if (['E', 'EXCUSED'].includes(rawValue)) status = 'Excused';

            attendanceData.push({
                sessionId: col.date,
                studentId: student.studentId,
                classId: student.classId,
                status: status,
                updatedAt: new Date().toISOString()
            });
        });
    }

    // C. Show Preview
    const preview = document.getElementById('bulk-att-preview');
    const btn = document.getElementById('import-bulk-att-btn');

    if (validRows === 0) {
        preview.style.display = 'block';
        preview.innerHTML = `<p class="text-danger">Error: Found ${uniqueSessions.length} sessions, but <strong>0 students matched</strong>.</p>
        <p>Please import students first, or check that Student IDs match exactly.</p>`;
        return;
    }

    preview.style.display = 'block';
    preview.innerHTML = `
        <p><strong>Sessions Found:</strong> ${uniqueSessions.length}</p>
        <p><strong>Students Matched:</strong> ${validRows}</p>
        <p><strong>Records to Create:</strong> ${attendanceData.length}</p>
        <hr>
        <div style="font-size: 0.85rem; color: #666;">
            <strong>Dates:</strong> ${uniqueSessions.join(', ')}
        </div>
    `;

    window.bulkImportData = { sessions: uniqueSessions, attendance: attendanceData };
    btn.disabled = false;
}

// 3. Upload to Firestore
async function importBulkAttendance() {
    if (!window.bulkImportData) return;
    const { sessions, attendance } = window.bulkImportData;
    const btn = document.getElementById('import-bulk-att-btn');

    if (!confirm(`Proceed to create ${sessions.length} sessions and update ${attendance.length} attendance entries?`)) return;

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    showSpinner();

    try {
        const { doc, setDoc, writeBatch } = window;
        const db = window.db;

        // A. Create Sessions (Batching not strictly needed for small session counts, but good practice)
        const sessionPromises = sessions.map(date => {
            const sessionRef = doc(db, 'sessions', date);
            return setDoc(sessionRef, withAcademicYear({
                id: date,
                date: date,
                status: 'Available',
                createdAt: new Date().toISOString()
            }), { merge: true });
        });

        await Promise.all(sessionPromises);
        console.log('Sessions created.');

        // B. Create Attendance Records (Batched for speed)
        // Firestore allows max 500 operations per batch
        const BATCH_SIZE = 450;
        for (let i = 0; i < attendance.length; i += BATCH_SIZE) {
            const batch = writeBatch(db);
            const chunk = attendance.slice(i, i + BATCH_SIZE);

            chunk.forEach(record => {
                const docId = `${record.sessionId}_${record.studentId}`;
                const attRef = doc(db, 'attendance', docId);
                batch.set(attRef, withAcademicYear(record), { merge: true });
            });

            await batch.commit();
            console.log(`Committed batch ${i} to ${i + chunk.length}`);
        }

        showSuccess('Import Successful!', 'Sessions and attendance updated.');

        // Cleanup
        document.getElementById('bulk-att-preview').innerHTML = '';
        document.getElementById('bulk-att-file').value = '';
        window.bulkImportData = null;

        // Refresh Data
        await loadAllDataForAdmin();
        renderSessionsTable();

    } catch (err) {
        console.error(err);
        showError('Import Failed: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-upload"></i> Upload & Process Attendance';
        hideSpinner();
    }
}

// Helper to switch back to the list view
function closeAssessmentReport() {
    document.getElementById('assessment-report-view').style.display = 'none';
    document.getElementById('assessment-list-view').style.display = 'block';
}
// Make it global so the HTML button can see it
window.closeAssessmentReport = closeAssessmentReport;


// ---------------------------------------------------------
// 📊 NEW ASSESSMENT REPORT LOGIC
// ---------------------------------------------------------

// 1. Switch Views
function closeAssessmentReport() {
    document.getElementById('assessment-report-view').style.display = 'none';
    document.getElementById('assessment-list-view').style.display = 'block';
}
// Expose to window so the HTML "Back" button can call it
window.closeAssessmentReport = closeAssessmentReport;

// REPLACE 'viewAssessmentReport' in BOTH admin.js and faculty.js
function viewAssessmentReport(assessmentId) {
    console.log("Generating report for:", assessmentId);

    const assessment = DATA_MODELS.assessments.find(a => a.id === assessmentId);
    if (!assessment) return console.error("Assessment not found in data");

    // 1. Get Elements
    const listView = document.getElementById('assessment-list-view');
    const reportView = document.getElementById('assessment-report-view');
    const container = document.getElementById('assessment-report-container');

    // Safety Check
    if (!listView || !reportView || !container) {
        alert("Error: Report containers missing in HTML. Did you update admin.html?");
        return;
    }

    // 2. Switch Views
    listView.style.display = 'none';
    reportView.style.display = 'block';

    // 3. Filter Data
    const students = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
        .filter(s => String(s.classId || '') === String(assessment.classId || ''))
        .sort((a, b) => String(a.studentId).localeCompare(String(b.studentId), undefined, { numeric: true }));
    const scores = DATA_MODELS.scores.filter(s => s.assessmentId === assessmentId);

    // 4. Stats Logic
    let totalScored = 0, sumMarks = 0, highest = 0, lowest = assessment.totalMarks;

    const reportRows = students.map(student => {
        const scoreRecord = scores.find(s => s.studentId === student.studentId);
        const marks = scoreRecord && scoreRecord.marks !== null ? scoreRecord.marks : null;
        let statusHtml = '<span style="color:orange">Absent</span>';

        if (marks !== null) {
            totalScored++;
            sumMarks += marks;
            if (marks > highest) highest = marks;
            if (marks < lowest) lowest = marks;
            const percentage = Math.round((marks / assessment.totalMarks) * 100);
            const color = percentage >= 35 ? 'green' : 'red';
            statusHtml = `<strong style="color:${color}">${percentage}%</strong>`;
        }
        return { student, marks, statusHtml };
    });

    if (totalScored === 0) lowest = 0;
    const average = totalScored > 0 ? Math.round(sumMarks / totalScored) : 0;

    // 5. Build HTML
    container.innerHTML = `
        <div class="report-header print-only">
            <h3>${escapeHtml(assessment.name)}</h3>
            <p>Date: ${formatDate(assessment.date)} | Total Marks: ${assessment.totalMarks}</p>
        </div>
        <div class="report-stats-grid" style="margin-bottom: 20px;">
            <div class="report-stat-card"><h6>Average</h6><p>${average}</p></div>
            <div class="report-stat-card"><h6>Highest</h6><p>${highest}</p></div>
            <div class="report-stat-card"><h6>Lowest</h6><p>${lowest}</p></div>
            <div class="report-stat-card"><h6>Count</h6><p>${totalScored} / ${students.length}</p></div>
        </div>
        <div class="text-right no-print" style="margin-bottom: 15px; display:flex; justify-content:flex-end; gap:10px;">
            <button class="btn btn-success btn-sm" id="btn-export-assess-csv"><i class="fas fa-file-csv"></i> Export CSV</button>
            <button class="btn btn-danger btn-sm" id="btn-export-assess-pdf"><i class="fas fa-file-pdf"></i> Export PDF</button>
            <button class="btn btn-primary btn-sm" onclick="printReport('assessment-report-container', 'Assessment Report')"><i class="fas fa-print"></i> Print</button>
        </div>
        <table class="data-table">
            <thead><tr><th>ID</th><th>Name</th><th>Marks</th><th>%</th></tr></thead>
            <tbody>
                ${reportRows.map(row => `
                    <tr>
                        <td>${escapeHtml(row.student.studentId)}</td>
                        <td>${escapeHtml(row.student.firstName)} ${escapeHtml(row.student.lastName)}</td>
                        <td>${row.marks !== null ? row.marks : '-'}</td>
                        <td>${row.statusHtml}</td>
                    </tr>`).join('')}
            </tbody>
        </table>
    `;

    // 6. Attach Listeners
    setTimeout(() => {
        document.getElementById('btn-export-assess-csv').onclick = () => exportAssessmentToCsv(assessmentId);
        document.getElementById('btn-export-assess-pdf').onclick = () => {
            const filename = `Report_${assessment.name.replace(/[^a-z0-9]/gi, '_')}.pdf`;
            if (typeof downloadContainerAsPDF === 'function') {
                downloadContainerAsPDF('assessment-report-container', filename);
            } else {
                alert("PDF function missing. Check common.js");
            }
        };
    }, 50);
}

// 3. Export CSV
function exportAssessmentToCsv(assessmentId) {
    const assessment = DATA_MODELS.assessments.find(a => a.id === assessmentId);
    if (!assessment) return;

    const students = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
        .filter(s => String(s.classId || '') === String(assessment.classId || ''))
        .sort((a, b) => String(a.studentId).localeCompare(String(b.studentId), undefined, { numeric: true }));
    const scores = DATA_MODELS.scores.filter(s => s.assessmentId === assessmentId);

    let csv = `Assessment Report,"${assessment.name}"\n`;
    csv += `Date,${formatDate(assessment.date)}\n`;
    csv += `Total Marks,${assessment.totalMarks}\n\n`;
    csv += `Student ID,Name,Marks,Percentage\n`;

    students.forEach(student => {
        const scoreRecord = scores.find(s => s.studentId === student.studentId);
        const marks = scoreRecord && scoreRecord.marks !== null ? scoreRecord.marks : '';
        let perc = '';
        if (marks !== '') perc = Math.round((marks / assessment.totalMarks) * 100) + '%';

        csv += `"${student.studentId}","${student.firstName} ${student.lastName}",${marks},${perc}\n`;
    });

    downloadCSV(csv, `Assessment_${assessment.name.replace(/\s/g, '_')}.csv`);
}

// Helper to switch back to the list view
window.closeAssessmentReport = function () {
    const reportView = document.getElementById('assessment-report-view');
    const listView = document.getElementById('assessment-list-view');

    if (reportView) reportView.style.display = 'none';
    if (listView) listView.style.display = 'block';
};

// Helper to switch back to the list view
window.closeAssessmentReport = function () {
    const reportView = document.getElementById('assessment-report-view');
    const listView = document.getElementById('assessment-list-view');

    if (reportView) reportView.style.display = 'none';
    if (listView) listView.style.display = 'block';
};

// ---------------------------------------------------------
// ♻️ SYSTEM RESTORE (From JSON Backup)
// ---------------------------------------------------------

async function restoreSystemFromBackup() {
    const fileInput = document.getElementById('restore-file');
    const file = fileInput?.files[0];

    if (!file) return alert("Please select a JSON backup file first.");

    if (!confirm("CRITICAL WARNING: This will MERGE backup data into your database. \n\n- Existing IDs will be updated.\n- New IDs will be created.\n- Large datasets will be processed in chunks.\n\nAre you sure?")) return;

    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const backup = JSON.parse(e.target.result);
            showSpinner();

            const { doc } = window;
            const db = window.db;
            let totalCount = 0;

            // Generic helper to restore a specific collection
            const restoreCollection = async (colName, items, idKey) => {
                if (!items || items.length === 0) return;
                console.log(`Restoring ${colName}...`);

                await processBatchInChunks(items, (batch, item) => {
                    // Determine ID: Explicit key, or 'id', or composite
                    let docId = item[idKey] || item.id;
                    if (colName === 'attendance' && !docId) docId = `${item.sessionId}_${item.studentId}`;
                    if (colName === 'scores' && !docId) docId = `${item.assessmentId}_${item.studentId}`;

                    if (docId) {
                        const ref = doc(db, colName, String(docId));
                        batch.set(ref, item, { merge: true });
                    }
                });
                totalCount += items.length;
            };

            // Restore strictly in order
            await restoreCollection('students', backup.students, 'studentId');
            await restoreCollection('sessions', backup.sessions, 'id');
            await restoreCollection('assessments', backup.assessments, 'id');
            await restoreCollection('classes', backup.classes, 'id');
            await restoreCollection('userRoles', backup.userRoles, 'uid');
            // Restore large collections last
            await restoreCollection('attendance', backup.attendance, 'id');
            await restoreCollection('scores', backup.scores, 'id');

            createAuditLog('system_restore', { ops: totalCount });
            showSuccess("Restore Complete", `${totalCount} records processed. Reloading...`);
            setTimeout(() => location.reload(), 2000);

        } catch (err) {
            console.error(err);
            showError("Restore Failed: " + err.message);
        } finally {
            hideSpinner();
        }
    };
    reader.readAsText(file);
}

/**
 * 🛡️ SAFELY process a large number of Firestore writes in chunks.
 * Prevents "Batch too large" errors (limit is 500).
 * @param {Array} items - Array of data items to process
 * @param {Function} callback - Function that takes (batch, item) and adds the op
 */
async function processBatchInChunks(items, callback) {
    const BATCH_SIZE = 400; // Safety margin below 500
    const { writeBatch } = window;
    const db = window.db;

    // Split into chunks
    const chunks = [];
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
        chunks.push(items.slice(i, i + BATCH_SIZE));
    }

    console.log(`[Batch] Processing ${items.length} items in ${chunks.length} chunks...`);

    let totalOps = 0;

    // Process sequentially to avoid network contention
    for (const [index, chunk] of chunks.entries()) {
        const batch = writeBatch(db);
        chunk.forEach(item => callback(batch, item));
        await batch.commit();
        totalOps += chunk.length;
        console.log(`[Batch] Committed chunk ${index + 1}/${chunks.length} (${totalOps} ops)`);
    }

    return totalOps;
}

// ---------------------------------------------------------
// 👤 ROLE MANAGEMENT UI
// ---------------------------------------------------------

function renderUserRolesTable() {
    const tbody = document.querySelector('#user-roles-table tbody');
    if (!tbody) return; // Element might not exist yet in HTML

    const activeYearLabel = document.getElementById('faculty-assignment-active-year');
    const activeYearId = getActiveAcademicYearId() || DATA_MODELS.appConfig?.activeAcademicYearId || 'Not set';
    if (activeYearLabel) {
        activeYearLabel.textContent = `Active year faculty-class assignment: ${activeYearId}`;
    }

    const activeAssignmentsByUid = new Map(
        (DATA_MODELS.facultyClassAssignments || [])
            .filter(item => String(item.academicYearId || '') === String(activeYearId))
            .map(item => [String(item.uid || ''), item])
    );

    tbody.innerHTML = '';

    // Filter valid roles
    const roles = DATA_MODELS.userRoles || [];
    const classes = [...(DATA_MODELS.classes || [])].sort((a, b) =>
        String(a.id || '').localeCompare(String(b.id || ''), undefined, { numeric: true })
    );

    if (roles.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4">No roles found.</td></tr>';
        return;
    }

    roles.forEach(user => {
        const isFaculty = String(user.role || '').trim().toLowerCase() === 'faculty';
        const assignedClassId = isFaculty
            ? String(activeAssignmentsByUid.get(String(user.uid || ''))?.classId || user.classId || '')
            : String(user.classId || '');

        const classEditorHtml = isFaculty
            ? `
                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                    <select class="faculty-class-select" data-uid="${escapeHtml(user.uid)}" style="min-width:170px;">
                        <option value="">-- Select class --</option>
                        ${classes.map(cls => {
                const selected = String(cls.id || '') === assignedClassId ? 'selected' : '';
                return `<option value="${escapeHtml(cls.id)}" ${selected}>${escapeHtml(cls.name || cls.id)}</option>`;
            }).join('')}
                    </select>
                    <button class="btn btn-primary btn-sm save-faculty-class" data-uid="${escapeHtml(user.uid)}">
                        <i class="fas fa-save"></i> Update
                    </button>
                </div>
            `
            : escapeHtml(user.classId || '-');

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${escapeHtml(user.email || 'No Email')}</td>
            <td><span class="status-badge status-${user.role === 'admin' ? 'present' : 'late'}">${user.role.toUpperCase()}</span></td>
            <td>${classEditorHtml}</td>
            <td>
                <button class="btn btn-danger btn-sm delete-role" data-uid="${user.uid}">
                    <i class="fas fa-trash"></i> Revoke
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });

    // Attach delete listeners
    tbody.querySelectorAll('.delete-role').forEach(btn => {
        btn.addEventListener('click', (e) => deleteUserRole(e.currentTarget.dataset.uid));
    });

    tbody.querySelectorAll('.save-faculty-class').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const uid = String(e.currentTarget.dataset.uid || '').trim();
            const select = tbody.querySelector(`.faculty-class-select[data-uid="${uid}"]`);
            const classId = String(select?.value || '').trim();
            updateFacultyClassAssignment(uid, classId);
        });
    });
}

async function updateFacultyClassAssignment(uid, classId) {
    if (!uid) return showError('Invalid faculty UID.');
    if (!classId) return showError('Please select a class before updating.');

    const roleDoc = (DATA_MODELS.userRoles || []).find(user => String(user.uid || '') === String(uid));
    if (!roleDoc) return showError('Faculty role not found. Refresh and try again.');
    if (String(roleDoc.role || '').trim().toLowerCase() !== 'faculty') return showError('Class assignment is allowed only for faculty users.');

    const activeYearId = getActiveAcademicYearId() || DATA_MODELS.appConfig?.activeAcademicYearId || null;
    const nowIso = new Date().toISOString();

    showSpinner();
    try {
        const userRolePayload = {
            ...roleDoc,
            role: 'faculty',
            classId,
            updatedAt: nowIso,
            updatedBy: currentUserData?.uid || 'admin'
        };

        await window.setDoc(window.doc(window.db, 'userRoles', uid), userRolePayload, { merge: true });

        if (activeYearId) {
            const assignmentId = `${activeYearId}_${uid}`;
            await window.setDoc(window.doc(window.db, 'facultyClassAssignments', assignmentId), {
                id: assignmentId,
                academicYearId: activeYearId,
                uid,
                email: roleDoc.email || '',
                classId,
                updatedAt: nowIso,
                updatedBy: currentUserData?.uid || 'admin'
            }, { merge: true });
        }

        createAuditLog('faculty_class_assignment_updated', {
            uid,
            classId,
            academicYearId: activeYearId,
        });

        await loadAllDataForAdmin();
        renderUserRolesTable();
        renderAdminAnalytics();
        showSuccess('Assignment Updated', `Faculty class updated to ${classId}.`);
    } catch (err) {
        showError('Failed to update faculty class assignment: ' + err.message);
    } finally {
        hideSpinner();
    }
}

async function deleteUserRole(uid) {
    if (!confirm("Are you sure? This user will lose access immediately.")) return;

    showSpinner();
    try {
        const { doc, deleteDoc } = window;
        await deleteDoc(doc(window.db, 'userRoles', uid));

        const linkedAssignments = (DATA_MODELS.facultyClassAssignments || [])
            .filter(item => String(item.uid || '') === String(uid));
        await Promise.all(linkedAssignments.map(item => deleteDoc(doc(window.db, 'facultyClassAssignments', String(item.id)))));

        createAuditLog('user_role_revoked', { uid, removedAssignments: linkedAssignments.length });
        showSuccess('Access Revoked');

        // Refresh data
        await loadAllDataForAdmin();
        renderUserRolesTable();
    } catch (err) {
        showError('Failed to revoke role: ' + err.message);
    } finally {
        hideSpinner();
    }
}