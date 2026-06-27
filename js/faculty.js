/**
 * faculty.js
 * All app logic for the Faculty Dashboard (faculty.html)
 */

// Show a nice overlay for uncaught errors
window.addEventListener('error', (ev) => handleAppError(ev.message, ev.filename, ev.lineno));
window.addEventListener('unhandledrejection', (ev) => handleAppError(ev.reason.message || JSON.stringify(ev.reason)));

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
    appConfig: { activeAcademicYearId: null },
    homework: [],
    homeworkSubmissions: []
};
window.DATA_MODELS = DATA_MODELS; // Expose for debugging

// Global variable to hold the unsubscribe functions for realtime listeners
window.realtimeUnsubscribers = [];

// Global var to hold user data after verification
let currentUserData = null;

// A2: At-risk filter state
let showAtRiskOnly = false;

// B7: Attendance date filter state
let ATTENDANCE_DATE_FILTER = { from: null, to: null };

// B1: CSV import state
let CSV_PARSED_ROWS = [];

const FACULTY_ONBOARDING_VERSION = 1;
let facultyOnboardingResolver = null;
const YEAR_MIGRATION_STATE = {
    activeYearId: null,
    previousYearId: null,
    migrationEnabled: false,
    candidates: []
};

// -----------------
// 🔐 APP INITIALIZATION & SECURITY
// -----------------
document.addEventListener('DOMContentLoaded', function () {
    if (typeof window.onAuthStateChanged !== 'function') {
        return handleAppError("Supabase Auth is not loaded. Cannot start app.");
    }

    // Start auth listener
    window.onAuthStateChanged(window.auth, async (user) => {
        if (user) {
            console.log("User authenticated:", user.uid); // Debug Log 1
            try {
                // User is signed in, check their role from SERVER
                const userData = await verifyRoleFromServer(user.uid, 'faculty');

                // --- USER IS VALID FACULTY ---
                console.log(`Welcome, ${user.email}! Role: ${userData.role}`);
                currentUserData = userData;
                await initializeApp(user, userData);

            } catch (err) {
                // Role verification failed
                console.error("CRITICAL ERROR:", err); // Debug Log 2
                Swal.fire('Login Error', err.message || 'Access denied', 'error').then(() => logout());
            }
        } else {
            // No user signed in
            console.log("No user signed in.");
            // Only redirect if we are NOT already on the login page to avoid loops
            if (!window.location.pathname.endsWith('index.html')) {
                window.location.href = 'index.html';
            }
        }
    });
});

/**
 * Initializes the faculty app after auth check passes.
 * @param {object} user - The Firebase Auth user object.
 * @param {object} userData - The user data from Firestore ({role, classId, ...}).
 */
async function initializeApp(user, userData) {
    // Populate profile menu
    document.getElementById('user-info-email').textContent = user.email;
    document.getElementById('user-info-role').textContent = `Faculty - ${userData.classId || 'Unassigned'}`;

    // Populate sidebar user info
    const sidebarEmail = document.getElementById('sidebar-user-email');
    const sidebarRole = document.getElementById('sidebar-user-role');
    if (sidebarEmail) sidebarEmail.textContent = user.email;
    if (sidebarRole) sidebarRole.textContent = userData.classId ? `Faculty - ${userData.classId}` : 'Faculty';

    await loadAcademicYearContext();
    await watchAcademicYearContext(async () => {
        location.reload();
    });

    // Apply UI restrictions (hides admin-only buttons)
    applyRoleRestrictions(userData.role);

    // Setup all event listeners for the page
    setupEventListeners();

    // Prepare year migration tools (Phase 2 kickoff)
    await initializeYearMigrationPanel();

    // First-login onboarding for faculty users
    await maybeRunFacultyOnboarding(user, userData);

    // Start fetching realtime data
    startRealtimeListeners();

    // B8: Start announcements listener
    startFacultyAnnouncementsListener();

    // Show the app content and hide the spinner
    document.getElementById('app-content').classList.remove('is-hidden');
    hideSpinner();
}

// -----------------
// 🔐 UI & EVENT LISTENERS
// -----------------

/**
 * Applies UI restrictions based on user role.
 * @param {string} role - The user's role (e.g., "faculty").
 */
function applyRoleRestrictions(role) {
    // Hide all elements marked as `data-admin-only="true"`
    document.querySelectorAll('[data-admin-only="true"]').forEach(el => {
        el.style.display = 'none';
    });

    // We use CSS for dynamically created elements
    // This is Snippet 1 from your implementation plan
    const styles = document.createElement('style');
    styles.id = 'dynamic-hidden-actions';
    styles.innerHTML = `
      .edit-student,
      .delete-student,
      .delete-session,
      .delete-assessment,
      .delete-class-btn {
          display: none !important;
      }
    `;
    document.head.appendChild(styles);
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
            if (modal.id === 'faculty-onboarding-modal' && modal.style.display === 'flex') return;
            if (e.target === modal) modal.style.display = 'none';
        });
    });

    // Logout Button (in profile menu)
    document.getElementById('logout-btn').addEventListener('click', logout); // From common.js
    document.getElementById('sidebar-logout-btn')?.addEventListener('click', logout);

    // Faculty profile editing
    document.getElementById('edit-profile-btn')?.addEventListener('click', openFacultyProfileEditor);
    document.getElementById('save-faculty-profile-btn')?.addEventListener('click', saveFacultyProfileEdits);
    document.getElementById('cancel-faculty-profile-edit-btn')?.addEventListener('click', closeFacultyProfileEditor);
    document.getElementById('close-faculty-profile-modal-btn')?.addEventListener('click', closeFacultyProfileEditor);

    // Profile Menu Toggle
    document.getElementById('profile-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = document.getElementById('profile-menu');
        const isOpen = menu.style.display === 'block';
        menu.style.display = isOpen ? 'none' : 'block';
    });

    // Close profile menu on outside click
    document.addEventListener('click', (e) => {
        const menu = document.getElementById('profile-menu');
        const btn = document.getElementById('profile-btn');
        if (menu && menu.style.display === 'block' && btn && !btn.contains(e.target) && !menu.contains(e.target)) {
            menu.style.display = 'none';
        }
    });

    const facultyProfileModal = document.getElementById('faculty-profile-modal');
    facultyProfileModal?.addEventListener('click', (e) => {
        if (e.target === facultyProfileModal) closeFacultyProfileEditor();
    });

    // Session status change in modal
    const sessionStatus = document.getElementById('session-status');
    if (sessionStatus) {
        sessionStatus.addEventListener('change', () => {
            document.getElementById('noclass-reason-group').style.display =
                (sessionStatus.value === 'NoClass') ? 'block' : 'none';
        });
    }

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
        if (e.target.value) {
            generateStudentReport(e.target.value);
        } else {
            document.getElementById('report-content').innerHTML = '<p>Select a student to generate a report</p>';
        }
    });

    // Attendance session selection
    document.getElementById('session-date')?.addEventListener('change', (e) => {
        if (e.target.value) {
            renderAttendanceForm(e.target.value);
        } else {
            document.getElementById('attendance-form-container').innerHTML = '<p>Select a session to take attendance</p>';
        }
    });

    // Attendance report buttons
    document.getElementById('generate-overall-report-btn')?.addEventListener('click', generateOverallAttendanceReport);
    document.getElementById('report-session-date')?.addEventListener('change', generateDaywiseAttendanceReport);
    document.getElementById('print-daywise-report-btn')?.addEventListener('click', exportDaywiseReportAsPdf);
    document.getElementById('download-overall-report-btn')?.addEventListener('click', () => {
        downloadContainerAsPDF('overall-report-container', 'Overall_Attendance_Report.pdf');
    });

    // View Student Modal Close
    document.getElementById('close-view-modal')?.addEventListener('click', () => {
        document.getElementById('student-view-modal').style.display = 'none';
    });

    // Academic year migration is admin-only — removed from faculty

    // Faculty onboarding
    document.getElementById('faculty-onboarding-form')?.addEventListener('submit', completeFacultyOnboarding);

    // Early Angel portal
    document.getElementById('open-early-angel-btn')?.addEventListener('click', () => {
        window.location.href = 'early-angel.html';
    });
    document.getElementById('open-vbs-btn')?.addEventListener('click', () => {
        window.location.href = 'vbs.html';
    });
    document.getElementById('close-early-angel-btn')?.addEventListener('click', () => toggleEarlyAngelPanel(false));
    document.getElementById('early-angel-entry-form')?.addEventListener('submit', saveEarlyAngelEntry);
    document.getElementById('early-angel-student-filter')?.addEventListener('change', renderEarlyAngelTables);
    const earlyAngelDateInput = document.getElementById('early-angel-date');
    if (earlyAngelDateInput && !earlyAngelDateInput.value) {
        earlyAngelDateInput.valueAsDate = new Date();
    }

    // PHASE 3: Quick Onboarding Listeners
    setupQuickOnboardingListeners();
    initializeQuickOnboarding();

    // A2: At-risk filter toggle
    document.getElementById('show-at-risk-btn')?.addEventListener('click', () => {
        showAtRiskOnly = !showAtRiskOnly;
        renderStudentsTable();
    });

    // Student transfer is admin-only — removed from faculty

    // A5: Print Class Register
    document.getElementById('print-register-btn')?.addEventListener('click', openPrintRegisterModal);
    document.getElementById('close-print-register-btn')?.addEventListener('click', () => { document.getElementById('print-register-modal').style.display = 'none'; });
    document.getElementById('cancel-print-register-btn')?.addEventListener('click', () => { document.getElementById('print-register-modal').style.display = 'none'; });
    document.getElementById('confirm-print-register-btn')?.addEventListener('click', printClassRegister);

    // B1: CSV Import
    document.getElementById('import-csv-btn-new')?.addEventListener('click', openCsvImportModal);
    document.getElementById('close-csv-modal-btn')?.addEventListener('click', () => { document.getElementById('csv-import-modal').style.display = 'none'; });
    document.getElementById('cancel-csv-import-btn')?.addEventListener('click', () => { document.getElementById('csv-import-modal').style.display = 'none'; });
    document.getElementById('csv-template-btn')?.addEventListener('click', downloadCSVTemplate);
    document.getElementById('csv-file-input')?.addEventListener('change', handleCsvFileSelect);
    document.getElementById('confirm-csv-import-btn')?.addEventListener('click', runCsvImport);

    // B7: Attendance date filter
    document.getElementById('apply-att-filter-btn')?.addEventListener('click', applyAttendanceDateFilter);
    document.getElementById('clear-att-filter-btn')?.addEventListener('click', clearAttendanceDateFilter);

    // C3: Homework
    document.getElementById('add-homework-btn')?.addEventListener('click', openHomeworkForm);
    document.getElementById('save-homework-btn')?.addEventListener('click', saveHomework);
    document.getElementById('cancel-homework-btn')?.addEventListener('click', () => {
        document.getElementById('homework-form-container').style.display = 'none';
        document.getElementById('hw-editing-id').value = '';
    });
    document.getElementById('close-hw-submissions-btn')?.addEventListener('click', () => {
        document.getElementById('hw-submissions-modal').style.display = 'none';
    });
    document.getElementById('close-hw-submissions-modal-btn')?.addEventListener('click', () => {
        document.getElementById('hw-submissions-modal').style.display = 'none';
    });
    document.getElementById('homework-tbody')?.addEventListener('click', e => {
        const editBtn = e.target.closest('.hw-edit-btn');
        const delBtn = e.target.closest('.hw-delete-btn');
        const subBtn = e.target.closest('.hw-submissions-btn');
        if (editBtn) editHomework(editBtn.dataset.hwId);
        if (delBtn) deleteHomework(delBtn.dataset.hwId);
        if (subBtn) viewHomeworkSubmissions(subBtn.dataset.hwId);
    });
}

function openFacultyProfileEditor() {
    const modal = document.getElementById('faculty-profile-modal');
    const emailEl = document.getElementById('faculty-profile-email');
    const classEl = document.getElementById('faculty-profile-class');
    const displayNameInput = document.getElementById('faculty-profile-display-name');
    const phoneInput = document.getElementById('faculty-profile-phone');

    if (emailEl) emailEl.textContent = window.auth?.currentUser?.email || currentUserData?.email || '...';
    if (classEl) classEl.textContent = currentUserData?.classId || 'Unassigned';
    if (displayNameInput) displayNameInput.value = currentUserData?.displayName || (window.auth?.currentUser?.email || '').split('@')[0] || '';
    if (phoneInput) phoneInput.value = currentUserData?.phone || '';

    if (modal) modal.style.display = 'flex';
}

function closeFacultyProfileEditor() {
    const modal = document.getElementById('faculty-profile-modal');
    if (modal) modal.style.display = 'none';
}

async function saveFacultyProfileEdits() {
    const uid = window.auth?.currentUser?.uid;
    const displayName = document.getElementById('faculty-profile-display-name')?.value.trim() || '';
    const phone = document.getElementById('faculty-profile-phone')?.value.trim() || '';

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

        await setDoc(doc(window.db, 'userRoles', uid), payload, { merge: true });

        currentUserData = {
            ...(currentUserData || {}),
            ...payload,
        };

        document.getElementById('user-info-email').textContent = window.auth?.currentUser?.email || currentUserData?.email || 'unknown';
        closeFacultyProfileEditor();
        showSuccess('Profile updated', 'Your faculty profile was saved successfully.');
    } catch (err) {
        showError('Failed to save faculty profile: ' + err.message);
    } finally {
        hideSpinner();
    }
}

/**
 * Handles clicks on the main navigation tabs.
 */
function handleNavTabClick(e) {
    e.preventDefault();
    const targetTab = this.getAttribute('data-tab');

    // Update active tab
    document.querySelectorAll('[data-tab]').forEach(t => t.classList.remove('active'));
    this.classList.add('active');

    // Update topbar title
    const tabTitles = { dashboard: 'Dashboard', students: 'Students', attendance: 'Attendance', assessments: 'Assessments', reports: 'Reports', homework: 'Homework' };
    const topbarTitle = document.getElementById('topbar-title');
    if (topbarTitle) topbarTitle.textContent = tabTitles[targetTab] || targetTab;

    // Sync sidebar link active state
    document.querySelectorAll('.sidebar-link[data-tab]').forEach(sl => sl.classList.toggle('active', sl.getAttribute('data-tab') === targetTab));

    // Show corresponding content
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
    if (targetTab === 'homework') {
        populateHwClassDropdown();
        renderHomeworkTable();
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
// 📡 REALTIME DATA LISTENERS
// -----------------

/**
 * Stops all active Firestore listeners.
 */
function stopRealtimeListeners() {
    if (window.realtimeUnsubscribers && window.realtimeUnsubscribers.length > 0) {
        console.log('[realtime] Stopping', window.realtimeUnsubscribers.length, 'listeners...');
        window.realtimeUnsubscribers.forEach(unsub => unsub());
        window.realtimeUnsubscribers = [];
    }
}

/**
 * Starts all realtime listeners scoped to the faculty's class.
 */
function startRealtimeListeners() {
    if (!currentUserData) return;

    const userClassId = currentUserData.classId;
    if (!userClassId) {
        handleAppError('Faculty user has no assigned class. Contact admin.');
        logout();
        return;
    }

    if (!window.db || !window.onSnapshot || !window.collection || !window.query || !window.where) {
        return handleAppError('[realtime] Firestore realtime not available.');
    }

    stopRealtimeListeners(); // Prevent double listeners
    console.log(`[realtime] Starting listeners for classId: ${userClassId}`);

    const { db, onSnapshot, collection, query, where } = window;

    // Dual-listener approach: enrollments = class membership source of truth,
    // students = profile data. Both update DATA_MODELS.students in memory.
    let _enrolledIds = new Set();
    let _allStudentProfiles = [];
    const activeYearId = getActiveAcademicYearId();

    function _rebuildStudents() {
        DATA_MODELS.students = _allStudentProfiles
            .filter(s => _enrolledIds.has(String(s.studentId)));
        DATA_MODELS.students.sort((a, b) =>
            String(a.studentId).localeCompare(String(b.studentId), undefined, { numeric: true })
        );
        renderStudentsTable();
        updateReportDropdown();
        renderEarlyAngelStudentSelectors();
        renderEarlyAngelTables();
        renderDashboard();
        console.log('[realtime] students sync', DATA_MODELS.students.length);
    }

    // ACADEMIC YEARS Listener — needed for dashboard year label and migration panel
    const unsubAcademicYears = onSnapshot(collection(db, 'academicYears'), snapshot => {
        DATA_MODELS.academicYears = [];
        snapshot.forEach(d => DATA_MODELS.academicYears.push({ id: d.id, ...d.data() }));
        DATA_MODELS.academicYears.sort((a, b) => String(b.id || '').localeCompare(String(a.id || '')));
        renderDashboard();
    }, err => console.error('[realtime] academicYears listener error', err));
    window.realtimeUnsubscribers.push(unsubAcademicYears);

    // ENROLLMENT Listener — fires when admin promotes/adds/removes a student for this class+year
    const enrollmentsQuery = activeYearId
        ? query(collection(db, 'enrollments'),
                where('academicYearId', '==', activeYearId),
                where('classId', '==', userClassId))
        : query(collection(db, 'enrollments'), where('classId', '==', userClassId));

    const unsubEnrollments = onSnapshot(enrollmentsQuery, snap => {
        _enrolledIds = new Set(
            snap.docs
                .map(d => d.data())
                .filter(e => e.status !== 'transferred')
                .map(e => String(e.studentId))
        );
        DATA_MODELS.enrollments = snap.docs.map(d => d.data());
        console.log('[realtime] enrollments sync', snap.docs.length);
        _rebuildStudents();
    }, err => console.error('[realtime] enrollments listener error', err));
    window.realtimeUnsubscribers.push(unsubEnrollments);

    // STUDENTS Listener — global (faculty can read all students per rules), filtered in memory
    const unsubStudents = onSnapshot(collection(db, 'students'), snapshot => {
        _allStudentProfiles = snapshot.docs.map(d => d.data());
        _rebuildStudents();
    }, err => console.error('[realtime] students listener error', err));
    window.realtimeUnsubscribers.push(unsubStudents);

    // SESSIONS Listener — must include academicYearId so rule's recordInActiveYear() is satisfied
    const sessionsQuery = activeYearId
        ? query(collection(db, 'sessions'), where('academicYearId', '==', activeYearId))
        : collection(db, 'sessions');
    const unsubSessions = onSnapshot(sessionsQuery, snapshot => {
        DATA_MODELS.sessions = [];
        snapshot.forEach(doc => DATA_MODELS.sessions.push(doc.data()));
        renderSessionsTable();
        renderAttendanceForm(document.getElementById('session-date')?.value || '');
        renderDashboard();
        console.log('[realtime] sessions sync', DATA_MODELS.sessions.length);
    }, err => console.error('[realtime] sessions listener error', err));
    window.realtimeUnsubscribers.push(unsubSessions);

    // ASSESSMENTS Listener (scoped to class + active year)
    const assessmentsQuery = activeYearId
        ? query(collection(db, 'assessments'), where('classId', '==', userClassId), where('academicYearId', '==', activeYearId))
        : query(collection(db, 'assessments'), where('classId', '==', userClassId));
    const unsubAssessments = onSnapshot(assessmentsQuery, (snapshot) => {
        DATA_MODELS.assessments = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAssessmentsTable();
        console.log('[realtime] Synced assessments:', DATA_MODELS.assessments.length);
    }, err => console.error('[realtime] Assessments listener error:', err));
    window.realtimeUnsubscribers.push(unsubAssessments);

    // ATTENDANCE Listener (scoped to class + active year)
    const attendanceQuery = activeYearId
        ? query(collection(db, 'attendance'), where('classId', '==', userClassId), where('academicYearId', '==', activeYearId))
        : query(collection(db, 'attendance'), where('classId', '==', userClassId));
    const unsubAttendance = onSnapshot(attendanceQuery, snapshot => {
        DATA_MODELS.attendance = snapshot.docs.map(d => d.data());
        const currentSession = document.getElementById('session-date')?.value;
        if (currentSession) renderAttendanceForm(currentSession);
        console.log('[realtime] attendance sync', DATA_MODELS.attendance.length);
    }, err => console.error('[realtime] attendance listener error', err));
    window.realtimeUnsubscribers.push(unsubAttendance);

    // SCORES Listener (scoped to class + active year)
    const scoresQuery = activeYearId
        ? query(collection(db, 'scores'), where('classId', '==', userClassId), where('academicYearId', '==', activeYearId))
        : query(collection(db, 'scores'), where('classId', '==', userClassId));
    const unsubScores = onSnapshot(scoresQuery, snapshot => {
        DATA_MODELS.scores = snapshot.docs.map(d => d.data());
        renderAssessmentsTable();
        const scoresModal = document.getElementById('scores-modal');
        if (window._currentScoresAssessmentId && scoresModal?.style.display === 'flex') {
            openScoresModal(window._currentScoresAssessmentId);
        }
        console.log('[realtime] scores sync', DATA_MODELS.scores.length);
    }, err => console.error('[realtime] scores listener error', err));
    window.realtimeUnsubscribers.push(unsubScores);

    // EARLY ANGEL ENTRIES Listener (scoped to class + active year)
    const earlyAngelEntriesQuery = activeYearId
        ? query(
            collection(db, 'earlyAngelEntries'),
            where('classId', '==', userClassId),
            where('academicYearId', '==', activeYearId)
        )
        : query(
            collection(db, 'earlyAngelEntries'),
            where('classId', '==', userClassId)
        );

    const unsubEarlyAngelEntries = onSnapshot(earlyAngelEntriesQuery, snapshot => {
        DATA_MODELS.earlyAngelEntries = [];
        snapshot.forEach(doc => {
            const data = { id: doc.id, ...doc.data() };
            if (isCurrentAcademicYear(data)) DATA_MODELS.earlyAngelEntries.push(data);
        });
        DATA_MODELS.earlyAngelEntries.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        renderEarlyAngelTables();
        console.log('[realtime] earlyAngelEntries sync', DATA_MODELS.earlyAngelEntries.length);
    }, err => console.error('[realtime] earlyAngelEntries listener error', err));
    window.realtimeUnsubscribers.push(unsubEarlyAngelEntries);

    // EARLY ANGEL LEADERBOARD Listener (scoped to class + active year)
    const earlyAngelLeaderboardQuery = activeYearId
        ? query(
            collection(db, 'earlyAngelLeaderboard'),
            where('classId', '==', userClassId),
            where('academicYearId', '==', activeYearId)
        )
        : query(
            collection(db, 'earlyAngelLeaderboard'),
            where('classId', '==', userClassId)
        );

    const unsubEarlyAngelLeaderboard = onSnapshot(earlyAngelLeaderboardQuery, snapshot => {
        DATA_MODELS.earlyAngelLeaderboard = [];
        snapshot.forEach(doc => {
            const data = { id: doc.id, ...doc.data() };
            if (isCurrentAcademicYear(data)) DATA_MODELS.earlyAngelLeaderboard.push(data);
        });
        DATA_MODELS.earlyAngelLeaderboard.sort((a, b) => Number(b.totalPoints || 0) - Number(a.totalPoints || 0));
        renderEarlyAngelTables();
        console.log('[realtime] earlyAngelLeaderboard sync', DATA_MODELS.earlyAngelLeaderboard.length);
    }, err => console.error('[realtime] earlyAngelLeaderboard listener error', err));
    window.realtimeUnsubscribers.push(unsubEarlyAngelLeaderboard);

    // A6: Load classes list for transfer modal
    const { getDocs, collection: col } = window;
    if (getDocs && col) {
        getDocs(col(db, 'classes')).then(snap => {
            DATA_MODELS.classes = [];
            snap.forEach(d => DATA_MODELS.classes.push({ id: d.id, ...d.data() }));
        }).catch(err => console.warn('[faculty] Could not load classes:', err));
    }

    // C3: HOMEWORK listener (scoped to class)
    const activeYearHw = getActiveAcademicYearId() || window.APP_CONTEXT?.activeAcademicYearId || DATA_MODELS.appConfig?.activeAcademicYearId;
    if (activeYearHw) {
        const hwQuery = query(collection(db, 'homework'),
            where('classId', '==', userClassId),
            where('academicYearId', '==', activeYearHw));
        const unsubHw = onSnapshot(hwQuery, snap => {
            DATA_MODELS.homework = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderHomeworkTable();
        }, err => console.error('[realtime] homework error', err));
        window.realtimeUnsubscribers.push(unsubHw);

        const hwSubQuery = query(collection(db, 'homeworkSubmissions'),
            where('classId', '==', userClassId),
            where('academicYearId', '==', activeYearHw));
        const unsubHwSub = onSnapshot(hwSubQuery, snap => {
            DATA_MODELS.homeworkSubmissions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderHomeworkTable();
        }, err => console.error('[realtime] homeworkSubmissions error', err));
        window.realtimeUnsubscribers.push(unsubHwSub);
    } else {
        console.warn('[faculty] Homework listener skipped — no active academic year ID yet');
    }
}

// -----------------
// 📈 DASHBOARD
// -----------------

/**
 * Renders the dashboard overview cards.
 * This faculty-safe version does NOT query activityLogs.
 */
async function renderDashboard() {
    const activeYearId = getActiveAcademicYearId() || DATA_MODELS.appConfig?.activeAcademicYearId || null;
    const activeYear = (DATA_MODELS.academicYears || []).find(year => String(year.id || '') === String(activeYearId || ''));
    const activeYearLabel = activeYear ? (activeYear.label || activeYear.yearLabel || activeYear.id) : (activeYearId || 'Not set');
    const activeYearEl = document.getElementById('faculty-active-year-label');
    if (activeYearEl) activeYearEl.textContent = activeYearLabel;

    const assignedClassEl = document.getElementById('faculty-assigned-class-label');
    if (assignedClassEl) assignedClassEl.textContent = currentUserData?.classId || 'Unassigned';

    const classRoster = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
        .filter(student => String(student.classId || '') === String(currentUserData?.classId || ''));

    const totalStudentsEl = document.getElementById('total-students');
    if (totalStudentsEl) {
        totalStudentsEl.textContent = classRoster.length;
    }

    const availableSessions = DATA_MODELS.sessions.filter(s => s.status === 'Available');
    const classesHeldEl = document.getElementById('classes-held');
    if (classesHeldEl) {
        classesHeldEl.textContent = availableSessions.length;
    }

    // Calculate average attendance
    if (classRoster.length > 0 && availableSessions.length > 0) {
        let totalAttendance = 0;
        classRoster.forEach(student => {
            const presentCount = DATA_MODELS.attendance.filter(a =>
                (a.studentId === student.studentId) &&
                (a.status === 'Present' || a.status === 'Late')
            ).length;
            // Ensure attendance percentage is capped by number of sessions
            const percentage = Math.round((presentCount / availableSessions.length) * 100);
            totalAttendance += percentage;
        });

        const avgAttendance = Math.round(totalAttendance / classRoster.length);
        const avgAttendanceEl = document.getElementById('avg-attendance');
        if (avgAttendanceEl) {
            avgAttendanceEl.textContent = `${avgAttendance}%`;
        }
    } else {
        const avgAttendanceEl = document.getElementById('avg-attendance');
        if (avgAttendanceEl) {
            avgAttendanceEl.textContent = '0%';
        }
    }

    // Upcoming sessions (next 7 days)
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today
    const nextWeek = new Date();
    nextWeek.setDate(today.getDate() + 7);

    const upcomingSessions = DATA_MODELS.sessions.filter(session => {
        const sessionDate = new Date(session.date); // Assumes YYYY-MM-DD
        sessionDate.setMinutes(sessionDate.getMinutes() + sessionDate.getTimezoneOffset()); // Adjust to UTC
        return sessionDate >= today && sessionDate <= nextWeek;
    });

    const upcomingSessionsEl = document.getElementById('upcoming-sessions');
    if (upcomingSessionsEl) {
        upcomingSessionsEl.textContent = upcomingSessions.length;
    }

    // --- Faculty version: Do NOT try to read activityLogs ---
    const activityContainer = document.getElementById('recent-activity');
    if (activityContainer) {
        activityContainer.innerHTML = '<p>Recent activity logs are only visible to Admins.</p>';
    }
}

// -----------------
// 👨‍🎓 STUDENT MANAGEMENT
// -----------------

function requiresFacultyOnboarding(userData) {
    const isCompleted = userData?.onboardingCompleted === true;
    const version = Number(userData?.onboardingVersion || 0);
    return !isCompleted || version < FACULTY_ONBOARDING_VERSION;
}

function populateFacultyOnboardingDetails(user, userData) {
    const classIdEl = document.getElementById('onboarding-class-id');
    const activeYearEl = document.getElementById('onboarding-active-year');
    const migrationNoteEl = document.getElementById('onboarding-migration-note');
    const displayNameInput = document.getElementById('onboarding-display-name');
    const phoneInput = document.getElementById('onboarding-contact-phone');
    const ackYear = document.getElementById('onboarding-ack-year');
    const ackPolicy = document.getElementById('onboarding-ack-policy');

    const classId = userData?.classId || currentUserData?.classId || 'Unassigned';
    const activeYearId = YEAR_MIGRATION_STATE.activeYearId || getActiveAcademicYearId() || 'Not set';
    const previousYearId = YEAR_MIGRATION_STATE.previousYearId;
    const migrationEnabled = YEAR_MIGRATION_STATE.migrationEnabled;

    if (classIdEl) classIdEl.textContent = classId;
    if (activeYearEl) activeYearEl.textContent = activeYearId;

    if (migrationNoteEl) {
        if (!migrationEnabled) {
            migrationNoteEl.textContent = 'Migration is currently disabled for this academic year.';
        } else if (!previousYearId) {
            migrationNoteEl.textContent = 'Migration is enabled, but previous year is not configured by admin yet.';
        } else {
            migrationNoteEl.textContent = `Migration available from ${previousYearId}. Use the Students tab migration panel if needed.`;
        }
    }

    const defaultName = (user?.email || '').split('@')[0] || '';
    if (displayNameInput) {
        displayNameInput.value = userData?.displayName || defaultName;
    }
    if (phoneInput) {
        phoneInput.value = userData?.phone || '';
    }
    if (ackYear) ackYear.checked = false;
    if (ackPolicy) ackPolicy.checked = false;
}

async function maybeRunFacultyOnboarding(user, userData) {
    if (!requiresFacultyOnboarding(userData)) return;

    const modal = document.getElementById('faculty-onboarding-modal');
    if (!modal) return;

    await refreshYearMigrationState();
    populateFacultyOnboardingDetails(user, userData);

    hideSpinner();
    modal.style.display = 'flex';

    await new Promise(resolve => {
        facultyOnboardingResolver = resolve;
    });
}

async function completeFacultyOnboarding(e) {
    e.preventDefault();

    const modal = document.getElementById('faculty-onboarding-modal');
    const displayName = document.getElementById('onboarding-display-name')?.value.trim() || '';
    const phone = document.getElementById('onboarding-contact-phone')?.value.trim() || '';
    const ackYear = !!document.getElementById('onboarding-ack-year')?.checked;
    const ackPolicy = !!document.getElementById('onboarding-ack-policy')?.checked;
    const uid = window.auth?.currentUser?.uid;

    if (!displayName) {
        return showError('Display name is required.');
    }
    if (!ackYear || !ackPolicy) {
        return showError('Please acknowledge both onboarding checkboxes before continuing.');
    }
    if (!uid) {
        return showError('Unable to complete onboarding. Please login again.');
    }

    showSpinner();
    try {
        const payload = {
            role: 'faculty',
            displayName,
            phone,
            onboardingCompleted: true,
            onboardingCompletedAt: new Date().toISOString(),
            onboardingVersion: FACULTY_ONBOARDING_VERSION,
            onboardingChecklist: {
                activeYearReviewed: ackYear,
                dataPolicyAcknowledged: ackPolicy,
                activeAcademicYearId: YEAR_MIGRATION_STATE.activeYearId || null,
            },
            updatedAt: new Date().toISOString(),
        };

        await setDoc(doc(window.db, 'userRoles', uid), payload, { merge: true });

        currentUserData = {
            ...(currentUserData || {}),
            ...payload,
        };

        if (modal) modal.style.display = 'none';
        if (typeof facultyOnboardingResolver === 'function') {
            facultyOnboardingResolver();
            facultyOnboardingResolver = null;
        }

        createAuditLog('faculty_onboarding_completed', {
            uid,
            classId: currentUserData?.classId || null,
            onboardingVersion: FACULTY_ONBOARDING_VERSION,
        });

        showSuccess('Onboarding complete', 'Your faculty setup is saved.');
    } catch (err) {
        showError('Failed to complete onboarding: ' + err.message);
    } finally {
        hideSpinner();
    }
}

async function initializeYearMigrationPanel() {
    await refreshYearMigrationState();
    await loadYearMigrationCandidates();
}

async function refreshYearMigrationState() {
    YEAR_MIGRATION_STATE.activeYearId = getActiveAcademicYearId() || null;
    YEAR_MIGRATION_STATE.previousYearId = null;
    YEAR_MIGRATION_STATE.migrationEnabled = false;

    if (!window.db || !window.doc || !window.getDoc || !YEAR_MIGRATION_STATE.activeYearId) {
        renderYearMigrationPanel();
        return;
    }

    try {
        const yearSnap = await getDoc(doc(window.db, 'academicYears', YEAR_MIGRATION_STATE.activeYearId));
        if (yearSnap.exists()) {
            const yearData = yearSnap.data() || {};
            YEAR_MIGRATION_STATE.previousYearId = yearData.previousYearId || null;
            YEAR_MIGRATION_STATE.migrationEnabled = !!yearData.migrationEnabled;
        }
    } catch (err) {
        console.warn('Failed to load migration settings for active year:', err);
    }

    renderYearMigrationPanel();
}

function renderYearMigrationPanel() {
    const statusEl = document.getElementById('year-migration-status');
    const runBtn = document.getElementById('run-year-migration-btn');

    if (!statusEl || !runBtn) return;

    const classId = currentUserData?.classId || '';
    const activeYearId = YEAR_MIGRATION_STATE.activeYearId;
    const previousYearId = YEAR_MIGRATION_STATE.previousYearId;
    const migrationEnabled = YEAR_MIGRATION_STATE.migrationEnabled;
    const candidateCount = YEAR_MIGRATION_STATE.candidates.length;

    if (!activeYearId) {
        statusEl.textContent = 'No active academic year is configured yet.';
        runBtn.disabled = true;
        renderYearMigrationPreview();
        return;
    }

    if (!migrationEnabled) {
        statusEl.textContent = `Migration is disabled for active year ${activeYearId}. Ask admin to enable migration for this year.`;
        runBtn.disabled = true;
        renderYearMigrationPreview();
        return;
    }

    if (!previousYearId) {
        statusEl.textContent = `Active year ${activeYearId} has migration enabled, but no previous year is configured.`;
        runBtn.disabled = true;
        renderYearMigrationPreview();
        return;
    }

    statusEl.textContent = `Class ${classId || 'N/A'} migration source: ${previousYearId}. Active year: ${activeYearId}. Ready candidates: ${candidateCount}.`;
    runBtn.disabled = candidateCount === 0;
    renderYearMigrationPreview();
}

function renderYearMigrationPreview() {
    const previewEl = document.getElementById('year-migration-preview');
    if (!previewEl) return;

    const migrationEnabled = YEAR_MIGRATION_STATE.migrationEnabled;
    const previousYearId = YEAR_MIGRATION_STATE.previousYearId;
    const activeYearId = YEAR_MIGRATION_STATE.activeYearId;
    const rows = YEAR_MIGRATION_STATE.candidates;

    if (!activeYearId || !migrationEnabled || !previousYearId) {
        previewEl.innerHTML = '<p>Migration preview will appear here when migration is enabled and previous year is configured.</p>';
        return;
    }

    if (rows.length === 0) {
        previewEl.innerHTML = `<p>No eligible students found in ${escapeHtml(previousYearId)} for migration.</p>`;
        return;
    }

    const previewRows = rows.slice(0, 15);
    previewEl.innerHTML = `
        <p><strong>${rows.length}</strong> students are eligible for migration from ${escapeHtml(previousYearId)} to ${escapeHtml(activeYearId)}.</p>
        <table class="data-table simple">
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Guardian</th>
                    <th>Contact</th>
                </tr>
            </thead>
            <tbody>
                ${previewRows.map(s => `
                    <tr>
                        <td>${escapeHtml(s.studentId || s.id || '')}</td>
                        <td>${escapeHtml((s.firstName || '') + ' ' + (s.lastName || ''))}</td>
                        <td>${escapeHtml(s.guardian || '-')}</td>
                        <td>${escapeHtml(s.phone || s.email || '-')}</td>
                    </tr>
                `).join('')}
                ${rows.length > 15 ? `<tr><td colspan="4">... and ${rows.length - 15} more students</td></tr>` : ''}
            </tbody>
        </table>
    `;
}

// Student migration and class assignment is admin-only — no-op in faculty portal
async function loadYearMigrationCandidates() { return; }
async function runYearMigration() { return; }

function getEarlyAngelActiveYearId() {
    return getActiveAcademicYearId() || YEAR_MIGRATION_STATE.activeYearId || null;
}

function renderEarlyAngelStudentSelectors() {
    const entrySelect = document.getElementById('early-angel-student-select');
    const filterSelect = document.getElementById('early-angel-student-filter');
    if (!entrySelect && !filterSelect) return;

    const students = [...(DATA_MODELS.students || [])].sort((a, b) =>
        String(a.studentId || '').localeCompare(String(b.studentId || ''), undefined, { numeric: true })
    );

    if (entrySelect) {
        const currentValue = entrySelect.value;
        entrySelect.innerHTML = '<option value="">-- Select a student --</option>';
        students.forEach(student => {
            const option = document.createElement('option');
            option.value = String(student.studentId || '');
            option.textContent = `${student.registerNo ?? student.studentId} - ${student.firstName || ''} ${student.lastName || ''}`.trim();
            entrySelect.appendChild(option);
        });
        if (currentValue && students.some(s => String(s.studentId) === currentValue)) {
            entrySelect.value = currentValue;
        }
    }

    if (filterSelect) {
        const currentValue = filterSelect.value;
        filterSelect.innerHTML = '<option value="">-- All students --</option>';
        students.forEach(student => {
            const option = document.createElement('option');
            option.value = String(student.studentId || '');
            option.textContent = `${student.registerNo ?? student.studentId} - ${student.firstName || ''} ${student.lastName || ''}`.trim();
            filterSelect.appendChild(option);
        });
        if (currentValue && students.some(s => String(s.studentId) === currentValue)) {
            filterSelect.value = currentValue;
        }
    }
}

function renderEarlyAngelTables() {
    renderEarlyAngelLeaderboardTable();
    renderEarlyAngelEntriesTable();
}

function toggleEarlyAngelPanel(show) {
    const panel = document.getElementById('early-angel-panel');
    if (!panel) return;

    panel.classList.toggle('is-hidden', !show);
    if (show) {
        renderEarlyAngelStudentSelectors();
        renderEarlyAngelTables();
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function renderEarlyAngelLeaderboardTable() {
    const tbody = document.querySelector('#early-angel-leaderboard-table tbody');
    if (!tbody) return;

    const studentFilter = document.getElementById('early-angel-student-filter')?.value || '';
    const rows = (DATA_MODELS.earlyAngelLeaderboard || []).filter(item => !studentFilter || String(item.studentId) === studentFilter);

    tbody.innerHTML = '';
    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4">No leaderboard entries yet.</td></tr>';
        return;
    }

    rows.forEach((row, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${index + 1}</td>
            <td>${escapeHtml(row.studentName || row.studentId || '-')}</td>
            <td><strong>${Number(row.totalPoints || 0)}</strong></td>
            <td>${Number(row.entryCount || 0)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderEarlyAngelEntriesTable() {
    const tbody = document.querySelector('#early-angel-entries-table tbody');
    if (!tbody) return;

    const studentFilter = document.getElementById('early-angel-student-filter')?.value || '';
    const rows = (DATA_MODELS.earlyAngelEntries || []).filter(item => !studentFilter || String(item.studentId) === studentFilter);

    tbody.innerHTML = '';
    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5">No Early Angel entries yet.</td></tr>';
        return;
    }

    rows.slice(0, 100).forEach(row => {
        const tr = document.createElement('tr');
        const dateLabel = row.entryDate ? formatDate(row.entryDate) : formatDate((row.createdAt || '').slice(0, 10));
        tr.innerHTML = `
            <td>${escapeHtml(dateLabel)}</td>
            <td>${escapeHtml(row.studentName || row.studentId || '-')}</td>
            <td>${escapeHtml(row.category || '-')}</td>
            <td>${Number(row.points || 0)}</td>
            <td>${escapeHtml(row.notes || '-')}</td>
        `;
        tbody.appendChild(tr);
    });
}

async function saveEarlyAngelEntry(e) {
    e.preventDefault();

    const studentId = (document.getElementById('early-angel-student-select')?.value || '').trim();
    const points = Number(document.getElementById('early-angel-points')?.value || 0);
    const category = (document.getElementById('early-angel-category')?.value || 'Other').trim();
    const entryDate = document.getElementById('early-angel-date')?.value || new Date().toISOString().slice(0, 10);
    const notes = (document.getElementById('early-angel-notes')?.value || '').trim();

    const activeYearId = getEarlyAngelActiveYearId();
    const classId = currentUserData?.classId || '';

    if (!studentId) return showError('Please select a student.');
    if (!Number.isFinite(points) || points <= 0) return showError('Points must be a positive number.');
    if (!entryDate) return showError('Entry date is required.');
    if (!classId) return showError('Faculty class is not configured. Contact admin.');
    if (!activeYearId) return showError('Active academic year is not configured. Contact admin.');

    const student = DATA_MODELS.students.find(s => String(s.studentId) === studentId);
    if (!student) return showError('Selected student is not available in this class/year.');

    const studentName = `${student.firstName || ''} ${student.lastName || ''}`.trim() || studentId;
    const nowIso = new Date().toISOString();

    showSpinner();
    try {
        const entryPayload = withAcademicYear({
            studentId,
            studentName,
            classId,
            category,
            points,
            notes,
            entryDate,
        });

        await addDoc(collection(window.db, 'earlyAngelEntries'), entryPayload);

        const summaryDocId = `${activeYearId}_${classId}_${entryDate}_${studentId}`;
        await setDoc(doc(window.db, 'earlyAngelDailySummary', summaryDocId), withAcademicYear({
            classId,
            summaryDate: entryDate,
            studentId,
            studentName,
            pointsTotal: window.increment(points),
            entryCount: window.increment(1),
            lastUpdatedAt: nowIso,
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
        }), { merge: true });

        createAuditLog('early_angel_entry_saved', {
            classId,
            studentId,
            points,
            category,
            academicYearId: activeYearId
        });

        showSuccess('Early Angel entry saved.');
        document.getElementById('early-angel-entry-form')?.reset();
        const dateInput = document.getElementById('early-angel-date');
        if (dateInput) dateInput.value = entryDate;
        const pointsInput = document.getElementById('early-angel-points');
        if (pointsInput) pointsInput.value = '1';
    } catch (err) {
        showError('Failed to save Early Angel entry: ' + err.message);
    } finally {
        hideSpinner();
    }
}

function renderStudentsTable() {
    const tbody = document.querySelector('#students-table tbody');
    if (!tbody) return;

    const filterText = document.getElementById('student-search')?.value.toLowerCase() || '';
    const classId = String(currentUserData?.classId || '').trim();
    const availableSessions = DATA_MODELS.sessions.filter(s => s.status === 'Available');
    let rosterStudents = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
        .filter(student => !classId || String(student.classId || '') === classId);

    let filteredStudents = rosterStudents.filter(student => {
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

    // A2: At-risk filter
    if (showAtRiskOnly) {
        filteredStudents = filteredStudents.filter(student => {
            const pct = calcStudentAttendancePct(student.studentId, availableSessions, DATA_MODELS.attendance);
            return pct !== null && pct < 75;
        });
        const btn = document.getElementById('show-at-risk-btn');
        if (btn) btn.classList.add('btn-danger');
    } else {
        const btn = document.getElementById('show-at-risk-btn');
        if (btn) btn.classList.remove('btn-danger');
    }

    tbody.innerHTML = ''; // Clear table
    if (filteredStudents.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6">No students found.</td></tr>';
        return;
    }

    filteredStudents.forEach(student => {
        // A2: Attendance badge
        const pct = calcStudentAttendancePct(student.studentId, availableSessions, DATA_MODELS.attendance);
        const atRiskBadge = (pct !== null && pct < 75)
            ? `<span class="at-risk-badge">⚠ ${pct}%</span>` : '';
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><a href="#" class="student-link" data-id="${escapeHtml(student.studentId)}">${escapeHtml(student.registerNo ?? student.studentId)}</a></td>
            <td>${escapeHtml(student.firstName)} ${escapeHtml(student.lastName)}${atRiskBadge}</td>
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

    // Add event listeners to new buttons
    tbody.querySelectorAll('.student-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            viewStudentDetails(e.target.closest('a').dataset.id);
        });
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
        const existingStudentId = document.getElementById('student-id').value; // non-empty = edit
        const studentId = existingStudentId || crypto.randomUUID();
        const firstName = document.getElementById('student-first-name').value.trim();
        const lastName = document.getElementById('student-last-name').value.trim();
        const dob = document.getElementById('student-dob').value || null; // '' is invalid for DATE
        const guardian = document.getElementById('student-guardian').value.trim();
        const phone = document.getElementById('student-phone').value.trim();
        const email = document.getElementById('student-email').value.trim();
        const notes = document.getElementById('student-notes').value.trim();

        // A4: Behavior note fields
        const behaviorNote = document.getElementById('student-behavior-note')?.value.trim() || '';
        const behaviorVisibility = document.getElementById('student-behavior-visibility')?.checked !== false;

        // Faculty role: classId comes from their own profile
        const classId = currentUserData.classId;

        if (!firstName) {
            throw new Error('Please enter the student\'s name.');
        }

        const student = {
            studentId,
            firstName, lastName, dob, guardian, phone, email, classId, notes,
            behaviorNote, behaviorVisibility,
            anbiyamName: document.getElementById('student-anbiyam')?.value?.trim() || '',
            receivedFirstCommunion: document.getElementById('student-first-communion')?.checked === true,
            receivedConfirmation: document.getElementById('student-confirmation')?.checked === true,
            fatherName: document.getElementById('student-father-name')?.value?.trim() || '',
            fatherPhone: document.getElementById('student-father-phone')?.value?.trim() || '',
            motherName: document.getElementById('student-mother-name')?.value?.trim() || '',
            motherPhone: document.getElementById('student-mother-phone')?.value?.trim() || '',
            emergencyName: document.getElementById('student-emergency-name')?.value?.trim() || '',
            emergencyPhone: document.getElementById('student-emergency-phone')?.value?.trim() || '',
        };

        // Persist profile to Firestore
        const studentRef = doc(window.db, 'students', String(student.studentId));
        await setDoc(studentRef, student, { merge: true });

        // Create/update enrollment so the dual-listener picks this student up
        const savedEnrollment = await upsertEnrollmentForStudent(student, currentUserData?.uid || 'faculty');

        // Update local cache immediately so the table reflects the change without a reload.
        const sIdx = (DATA_MODELS.students || []).findIndex(s => String(s.studentId) === String(student.studentId));
        if (sIdx >= 0) DATA_MODELS.students[sIdx] = { ...DATA_MODELS.students[sIdx], ...student };
        else DATA_MODELS.students.push({ ...student });
        if (savedEnrollment && savedEnrollment.id) {
            const eIdx = (DATA_MODELS.enrollments || []).findIndex(e => String(e.id) === String(savedEnrollment.id));
            if (eIdx >= 0) DATA_MODELS.enrollments[eIdx] = { ...DATA_MODELS.enrollments[eIdx], ...savedEnrollment };
            else DATA_MODELS.enrollments.push({ ...savedEnrollment });
        }
        renderStudentsTable();

        const action = existingStudentId ? 'student_updated' : 'student_created';
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
        document.getElementById('student-first-name').value = student.firstName;
        document.getElementById('student-last-name').value = student.lastName;
        document.getElementById('student-dob').value = student.dob || '';
        document.getElementById('student-guardian').value = student.guardian;
        document.getElementById('student-phone').value = student.phone || '';
        document.getElementById('student-email').value = student.email || '';
        // 'student-class-id' dropdown is hidden for faculty, no need to set
        document.getElementById('student-notes').value = student.notes || '';
        // Anbiyam + sacraments
        const anbiyamEl = document.getElementById('student-anbiyam');
        if (anbiyamEl) anbiyamEl.value = student.anbiyamName || '';
        const fhcEl = document.getElementById('student-first-communion');
        if (fhcEl) fhcEl.checked = student.receivedFirstCommunion === true;
        const confEl = document.getElementById('student-confirmation');
        if (confEl) confEl.checked = student.receivedConfirmation === true;
        // A4: Behavior note
        const behaviorNoteEl = document.getElementById('student-behavior-note');
        if (behaviorNoteEl) behaviorNoteEl.value = student.behaviorNote || '';
        const behaviorVisEl = document.getElementById('student-behavior-visibility');
        if (behaviorVisEl) behaviorVisEl.checked = student.behaviorVisibility !== false;
        // B2: Family contact fields
        const fn = document.getElementById('student-father-name'); if (fn) fn.value = student.fatherName || '';
        const fp = document.getElementById('student-father-phone'); if (fp) fp.value = student.fatherPhone || '';
        const mn = document.getElementById('student-mother-name'); if (mn) mn.value = student.motherName || '';
        const mp = document.getElementById('student-mother-phone'); if (mp) mp.value = student.motherPhone || '';
        const en = document.getElementById('student-emergency-name'); if (en) en.value = student.emergencyName || '';
        const ep = document.getElementById('student-emergency-phone'); if (ep) ep.value = student.emergencyPhone || '';
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
            const activeYearId = getActiveAcademicYearId();
            const classId = currentUserData?.classId;
            // Delete master profile
            await deleteDoc(doc(window.db, 'students', String(studentId)));
            // Delete enrollment record for the active year so the roster listener removes the student
            if (activeYearId && classId) {
                const enrollId = `${activeYearId}_${classId}_${studentId}`;
                await deleteDoc(doc(window.db, 'enrollments', enrollId));
            }

            // Update the local cache immediately (realtime may be delayed/disabled).
            DATA_MODELS.students = (DATA_MODELS.students || []).filter(s => String(s.studentId) !== String(studentId));
            DATA_MODELS.enrollments = (DATA_MODELS.enrollments || []).filter(e => String(e.studentId) !== String(studentId));
            renderStudentsTable();

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

    const behaviorNote = student.behaviorNote ? escapeHtml(student.behaviorNote) : '<em>None</em>';
    const behaviorVis = student.behaviorVisibility !== false ? 'Visible to student' : 'Hidden from student';
    // B2: Family & Contact card
    const waLink = (phone, name) => phone ? `<a href="https://wa.me/${phone.replace(/\D/g,'')}" target="_blank" title="WhatsApp ${escapeHtml(name)}"><i class="fab fa-whatsapp" style="color:#25D366;"></i> ${escapeHtml(phone)}</a>` : '<em style="color:var(--text-muted)">N/A</em>';
    const familyHtml = (student.fatherName || student.motherName || student.emergencyName) ? `
        <hr style="margin:10px 0;">
        <strong style="font-size:0.92rem;">Family &amp; Contact</strong>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;margin-top:6px;font-size:0.9rem;">
            <p><strong>Father:</strong> ${escapeHtml(student.fatherName || 'N/A')}</p>
            <p><strong>Father Phone:</strong> ${waLink(student.fatherPhone, 'father')}</p>
            <p><strong>Mother:</strong> ${escapeHtml(student.motherName || 'N/A')}</p>
            <p><strong>Mother Phone:</strong> ${waLink(student.motherPhone, 'mother')}</p>
            <p><strong>Emergency:</strong> ${escapeHtml(student.emergencyName || 'N/A')}</p>
            <p><strong>Emergency Phone:</strong> ${waLink(student.emergencyPhone, 'emergency contact')}</p>
        </div>` : '';
    const detailsHtml = `
        <p><strong>Student ID:</strong> ${escapeHtml(student.studentId)}</p>
        <p><strong>Name:</strong> ${escapeHtml(student.firstName)} ${escapeHtml(student.lastName)}</p>
        <p><strong>Date of Birth:</strong> ${student.dob ? formatDate(student.dob) : 'N/A'}</p>
        <p><strong>Guardian:</strong> ${escapeHtml(student.guardian)}</p>
        <p><strong>Contact:</strong> ${escapeHtml(student.phone || 'N/A')}</p>
        <p><strong>Email:</strong> ${escapeHtml(student.email || 'N/A')}</p>
        <p><strong>Class:</strong> ${escapeHtml(student.classId || 'N/A')}</p>
        <p><strong>Notes:</strong> ${escapeHtml(student.notes || 'None')}</p>
        <hr style="margin:10px 0;">
        <p><strong>Behavior Note:</strong> ${behaviorNote}</p>
        <p><strong>Behavior Visibility:</strong> ${behaviorVis}</p>
        ${familyHtml}
    `;

    document.getElementById('student-details-content').innerHTML = detailsHtml;
    document.getElementById('student-view-modal').style.display = 'flex';
}

// -----------------
// 📅 SESSION MANAGEMENT
// -----------------
function renderSessionsTable() {
    const tbody = document.querySelector('#sessions-table tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    const sortedSessions = [...DATA_MODELS.sessions].sort((a, b) => new Date(b.date) - new Date(a.date));

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
            </td>
        `;
        tbody.appendChild(row);

        if (session.status === 'Available') {
            availableSessionsForDropdown.push(session);
        }
    });

    // Populate session dropdowns (using common.js helper)
    populateDropdown('session-date', availableSessionsForDropdown, s => s.id, s => `${formatDate(s.date)} (${s.status})`);
    populateDropdown('report-session-date', sortedSessions, s => s.id, s => `${formatDate(s.date)} (${s.status === 'Available' ? 'Class Held' : 'No Class'})`);

    // Add event listeners
    tbody.querySelectorAll('.take-attendance').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const sessionId = e.currentTarget.dataset.id;
            document.getElementById('session-date').value = sessionId;
            renderAttendanceForm(sessionId);
            // Switch to attendance tab
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

    if (DATA_MODELS.sessions.some(s => s.id === sessionId || (s.sessionDate || s.date) === date)) {
        return showError('A session already exists for this date');
    }

    const session = withAcademicYear({
        id: sessionId,
        sessionDate: date, status, noClassReason,
        createdAt: new Date().toISOString(),
    });

    showSpinner();
    try {
        const sessionRef = doc(window.db, 'sessions', session.id);
        await setDoc(sessionRef, session);
        createAuditLog('session_created', { date: session.sessionDate, status: session.status });
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
    const result = await showConfirm(
        'Delete Session?',
        `Delete session for ${formatDate(session?.date)}? All attendance for this day will be lost.`
    );

    if (result.isConfirmed) {
        showSpinner();
        try {
            // Delete session document
            await deleteDoc(doc(window.db, 'sessions', sessionId));
            // Delete all attendance records for this session to keep stats accurate
            const attSnap = await window.getDocs(
                window.query(window.collection(window.db, 'attendance'), window.where('sessionId', '==', sessionId))
            );
            if (!attSnap.empty) {
                const batch = window.writeBatch(window.db);
                attSnap.docs.forEach(d => batch.delete(d.ref));
                await batch.commit();
            }
            createAuditLog('session_deleted', { sessionId, date: session?.date, attendanceRecordsDeleted: attSnap?.size || 0 });
            showSuccess('Session deleted.');
        } catch (err) {
            showError('Failed to delete session: ' + err.message);
        } finally {
            hideSpinner();
        }
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

    const myClassId = String(currentUserData.classId || '');
    // Build class roster; fall back to raw students list if enrollment data is thin
    let rosterStudents = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
        .filter(student => String(student.classId || '') === myClassId);
    if (rosterStudents.length === 0) {
        rosterStudents = DATA_MODELS.students.filter(s => String(s.classId || '') === myClassId);
    }
    const sortedStudents = rosterStudents.sort((a, b) =>
        String(a.studentId).localeCompare(String(b.studentId), undefined, { numeric: true })
    );

    sortedStudents.forEach(student => {
        const existing = DATA_MODELS.attendance.find(a => a.sessionId === sessionId && a.studentId === student.studentId);
        const status = existing ? existing.status : 'Present';
        html += `
            <tr>
                <td>${escapeHtml(student.registerNo ?? student.studentId)}</td>
                <td>${escapeHtml(student.firstName)} ${escapeHtml(student.lastName)}</td>
                <td>
                    <select class="attendance-status" data-student="${escapeHtml(student.studentId)}" data-class="${escapeHtml(student.classId || myClassId)}">
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

// Dropdown version of Save (Faculty)
window.saveAttendance = async (sessionId) => {
    const inputs = document.querySelectorAll('.attendance-status');
    if (!inputs || inputs.length === 0) return showError('No attendance inputs found');

    const classId = currentUserData.classId;
    if (!classId) return showError('Error: Faculty class ID not found.');

    const activeYearId = getActiveAcademicYearId()
        || window.APP_CONTEXT?.activeAcademicYearId
        || DATA_MODELS.appConfig?.activeAcademicYearId;
    if (!activeYearId) return showError('No active academic year found. Cannot save attendance.');

    showSpinner();
    try {
        const { doc, setDoc } = window;
        const records = []; // { obj } parallel to promises
        const promises = [];
        for (const select of inputs) {
            const studentId = select.dataset.student;
            if (!studentId) continue;
            const status = select.value;
            const docId = `${sessionId}_${studentId}`;
            const attendanceObj = {
                id: docId,
                sessionId, studentId, status, classId,
                academicYearId: activeYearId,
                updatedAt: new Date().toISOString(),
            };
            const docRef = doc(window.db, 'attendance', docId);
            records.push(attendanceObj);
            promises.push(setDoc(docRef, attendanceObj, { merge: true }));
        }
        const results = await Promise.allSettled(promises);
        const failed = results.filter(r => r.status === 'rejected');
        const saved = results.length - failed.length;

        // Update local cache for each successful save so views reflect reality
        // immediately (realtime updates may be delayed or disabled).
        results.forEach((res, i) => {
            if (res.status !== 'fulfilled') return;
            const obj = records[i];
            const idx = DATA_MODELS.attendance.findIndex(a =>
                a.sessionId === obj.sessionId && String(a.studentId) === String(obj.studentId));
            if (idx >= 0) DATA_MODELS.attendance[idx] = { ...DATA_MODELS.attendance[idx], ...obj };
            else DATA_MODELS.attendance.push(obj);
        });

        createAuditLog('attendance_saved', { sessionId, studentCount: saved, failed: failed.length, classId });
        if (failed.length > 0) {
            console.error('Attendance save failures:', failed.map(r => r.reason?.message));
            showError(`${saved} saved, ${failed.length} failed. Check console for details.`);
        } else {
            showSuccess('Attendance saved successfully!');
        }

        // Refresh any open day-wise report that reads attendance
        const reportSel = document.getElementById('report-session-date');
        if (reportSel && reportSel.value && typeof generateDaywiseAttendanceReport === 'function') {
            generateDaywiseAttendanceReport();
        }
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

    // Faculty role: classId comes from their own profile
    const classId = currentUserData.classId;

    if (!name || !date || isNaN(totalMarks) || totalMarks <= 0 || !classId) {
        return showError('Please fill in all required fields.');
    }

    const assessment = withAcademicYear({
        id: crypto.randomUUID(),
        name, assessmentDate: date, totalMarks, classId
    });

    showSpinner();
    try {
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
    const result = await showConfirm(
        'Delete Assessment?',
        `Delete "${assessment?.name}"? All scores for this assessment will be lost.`
    );

    if (result.isConfirmed) {
        showSpinner();
        try {
            const docRef = doc(window.db, 'assessments', assessmentId);
            await deleteDoc(docRef);
            // Batched delete all related scores
            const { doc, query, collection, where, getDocs, writeBatch } = window;
            const db = window.db;
            const scoreBatch = writeBatch(db);
            const scoresQ = query(collection(db, 'scores'), where('assessmentId', '==', assessmentId));
            const scoresSnap = await getDocs(scoresQ);
            scoresSnap.forEach(scoreDoc => {
                scoreBatch.delete(scoreDoc.ref);
            });
            await scoreBatch.commit();

            createAuditLog('assessment_deleted', {
                assessmentId: assessmentId,
                name: assessment?.name,
                deletedScoresCount: scoresSnap.size
            });
            showSuccess('Assessment deleted.');
        } catch (err) {
            showError('Failed to delete assessment: ' + err.message);
        } finally {
            hideSpinner();
        }
    }
}

function openScoresModal(assessmentId) {
    window._currentScoresAssessmentId = assessmentId; // Store globally
    const assessment = DATA_MODELS.assessments.find(a => a.id === assessmentId);
    if (!assessment) return showError('Could not find assessment details.');

    const container = document.getElementById('scores-form-container');
    let html = `<h3>Record Scores for ${escapeHtml(assessment.name)}</h3>
                <p>Date: ${formatDate(assessment.date)} | Total Marks: ${assessment.totalMarks}</p>`;
    html += '<table class="data-table"><thead><tr><th>Student</th><th>Score</th></tr></thead><tbody>';

    DATA_MODELS.students.forEach(student => {
        const existing = DATA_MODELS.scores.find(s =>
            s.assessmentId === assessmentId && s.studentId === student.studentId
        );
        const score = (existing && existing.marks !== null) ? existing.marks : '';

        html += `
            <tr>
                <td>${escapeHtml(student.firstName)} ${escapeHtml(student.lastName)} (${escapeHtml(student.studentId)})</td>
                <td>
                    <input type="number" class="score-input" data-student="${escapeHtml(student.studentId)}" 
                           min="0" max="${escapeHtml(assessment.totalMarks)}" value="${escapeHtml(score)}"
                           placeholder="0-${assessment.totalMarks}">
                </td>
            </tr>
        `;
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

    const classId = currentUserData.classId;

    const inputs = document.querySelectorAll('#scores-form-container .score-input');
    const toWrite = [];

    for (const input of inputs) {
        const studentId = input.dataset.student;
        const marksStr = input.value.trim();
        let marks = null; // Default to null (not submitted)

        if (marksStr !== '') {
            marks = Number(marksStr);
            if (isNaN(marks) || marks < 0 || marks > assessment.totalMarks) {
                return showError(`Invalid score for ${studentId}: ${marksStr}. Must be between 0 and ${assessment.totalMarks}.`);
            }
        }
        toWrite.push(withAcademicYear({
            assessmentId, studentId, marks,
            updatedAt: new Date().toISOString(),
            classId: classId
        }));
    }

    showSpinner();
    try {
        const { doc, setDoc } = window;
        const promises = toWrite.map(s => {
            const docId = `${s.assessmentId}_${s.studentId}`; // Stable composite key
            const docRef = doc(window.db, 'scores', docId);
            return setDoc(docRef, s, { merge: true });
        });
        await Promise.all(promises);
        createAuditLog('scores_saved', { assessmentId, assessmentName: assessment.name, classId, studentCount: toWrite.length });
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
    const classRoster = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
        .filter(student => String(student.classId || '') === String(currentUserData?.classId || ''));
    populateDropdown('report-student', classRoster, s => s.studentId, s => `${s.firstName} ${s.lastName} (${s.studentId})`);
}

function generateStudentReport(studentId) {
    const student = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
        .find(s => String(s.studentId) === String(studentId) && String(s.classId || '') === String(currentUserData?.classId || ''));
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

    // Generate HTML
    let html = `
        <div class="print-only report-header">
            <h2>Student Report: ${escapeHtml(student.firstName)} ${escapeHtml(student.lastName)}</h2>
            <p>Generated on: ${formatDate(new Date().toISOString())}</p>
        </div>
        
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
            ${assessmentDetails.length > 0 ? `
                <table class="data-table">
                    <thead><tr><th>Assessment</th><th>Date</th><th>Marks</th><th>Total</th><th>%</th></tr></thead>
                    <tbody>
                        ${assessmentDetails.map(d => `
                            <tr>
                                <td>${escapeHtml(d.name)}</td>
                                <td>${formatDate(d.date)}</td>
                                <td>${d.marks === null ? 'N/A' : escapeHtml(d.marks)}</td>
                                <td>${escapeHtml(d.totalMarks)}</td>
                                <td>${d.totalMarks > 0 && d.marks !== null ? Math.round((d.marks / d.totalMarks) * 100) : 'N/A'}%</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            ` : '<p>No assessments recorded for this student.</p>'}
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
        </div>
    `;
    container.innerHTML = html;

    // Render charts (from common.js)
    setTimeout(() => {
        renderMarksChart(assessmentDetails);
        renderAttendanceChart(studentId, DATA_MODELS);
    }, 100);
}

/**
 * Generates Report 1: Overall Attendance Matrix (With Stats Boxes)
 */
function generateOverallAttendanceReport() {
    const container = document.getElementById('overall-report-container');
    if (!container) return;

    let sessions = DATA_MODELS.sessions
        .filter(s => s.status === 'Available')
        .sort((a, b) => new Date(a.sessionDate || a.date) - new Date(b.sessionDate || b.date));

    // B7: Apply date filter
    if (ATTENDANCE_DATE_FILTER.from) {
        sessions = sessions.filter(s => (s.sessionDate || s.date) >= ATTENDANCE_DATE_FILTER.from);
    }
    if (ATTENDANCE_DATE_FILTER.to) {
        sessions = sessions.filter(s => (s.sessionDate || s.date) <= ATTENDANCE_DATE_FILTER.to);
    }

    let students = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
        .filter(s => String(s.classId || '') === String(currentUserData?.classId || ''));
    if (students.length === 0) {
        students = DATA_MODELS.students.filter(s => String(s.classId || '') === String(currentUserData?.classId || ''));
    }
    students = students.sort((a, b) =>
        String(a.registerNo ?? a.studentId).localeCompare(String(b.registerNo ?? b.studentId), undefined, { numeric: true })
    );

    const overallDownloadBtn = document.getElementById('download-overall-report-btn');
    if (sessions.length === 0 || students.length === 0) {
        container.innerHTML = '<p>No data available.</p>';
        if (overallDownloadBtn) overallDownloadBtn.style.display = 'none';
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

        <div style="margin: 20px 0; text-align: right; display: flex; gap: 10px; justify-content: flex-end;">
            <button class="btn btn-danger" id="export-attendance-pdf">
                <i class="fas fa-file-pdf"></i> Export Matrix PDF
            </button>
            <button class="btn btn-success" id="export-attendance-csv">
                <i class="fas fa-file-csv"></i> Export Matrix CSV
            </button>
        </div>

        <div style="overflow-x: auto; border: 1px solid var(--border-color); border-radius: var(--border-radius);">
        <table class="data-table" style="font-size: 0.9rem; margin: 0;">
            <thead>
                <tr>
                    <th style="position: sticky; left: 0; background: #f5f7fa; z-index: 2; min-width: 150px;">Student</th>
                    ${sessions.map(s => `<th style="text-align: center;">${formatDate(s.sessionDate || s.date).split(',')[0]}</th>`).join('')}
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
                    ${escapeHtml(student.firstName)} ${escapeHtml(student.lastName)} <small style="color:gray; display:block;">(#${escapeHtml(String(student.registerNo ?? student.studentId))})</small>
                </td>
                ${rowCells}
                <td style="font-weight: bold; text-align: center; ${color}">${percentage}%</td>
            </tr>
        `;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
    if (overallDownloadBtn) overallDownloadBtn.style.display = 'inline-flex';

    // Re-attach the export listeners
    document.getElementById('export-attendance-csv')?.addEventListener('click', exportAttendanceToCsv);
    document.getElementById('export-attendance-pdf')?.addEventListener('click', exportAttendanceToPdf);
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
        .sort((a, b) => new Date(a.sessionDate || a.date) - new Date(b.sessionDate || b.date));

    if (sessions.length === 0) return showError('No class sessions found.');

    // 1. Build the Header Row
    let csvContent = "Reg No,Name";
    sessions.forEach(session => {
        csvContent += `,"${formatDate(session.sessionDate || session.date)}"`;
    });
    csvContent += ",Total Present,Total Sessions,Percentage\n";

    // 2. Sort Students
    let students = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
        .filter(student => String(student.classId || '') === String(currentUserData.classId || ''));
    if (students.length === 0) {
        students = DATA_MODELS.students.filter(s => String(s.classId || '') === String(currentUserData.classId || ''));
    }
    students = students.sort((a, b) =>
        String(a.registerNo ?? a.studentId).localeCompare(String(b.registerNo ?? b.studentId), undefined, { numeric: true })
    );

    // 3. Build Data Rows
    students.forEach(student => {
        let row = `"${student.registerNo ?? student.studentId}","${student.firstName} ${student.lastName}"`;
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

function exportAttendanceToPdf() {
    if (DATA_MODELS.attendance.length === 0 || DATA_MODELS.sessions.length === 0) {
        return showError('No data to export.');
    }

    const sessions = DATA_MODELS.sessions
        .filter(s => s.status === 'Available')
        .sort((a, b) => new Date(a.sessionDate || a.date) - new Date(b.sessionDate || b.date));
    if (sessions.length === 0) return showError('No class sessions found.');

    let students = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
        .filter(s => String(s.classId || '') === String(currentUserData.classId || ''));
    if (students.length === 0) {
        students = DATA_MODELS.students.filter(s => String(s.classId || '') === String(currentUserData.classId || ''));
    }
    students = students.sort((a, b) =>
        String(a.registerNo ?? a.studentId).localeCompare(String(b.registerNo ?? b.studentId), undefined, { numeric: true })
    );

    const className = (DATA_MODELS.classes || []).find(c => c.id === currentUserData.classId)?.name || currentUserData.classId || 'Class';

    const headerCols = sessions.map(s => `<th>${formatDate(s.sessionDate || s.date).split(',')[0]}</th>`).join('');

    const bodyRows = students.map((student, idx) => {
        let presentCount = 0;
        const cells = sessions.map(session => {
            const rec = DATA_MODELS.attendance.find(a => a.sessionId === session.id && a.studentId === student.studentId);
            const status = rec ? rec.status : 'Absent';
            let code = 'A'; let color = '#ef4444';
            if (status === 'Present') { code = 'P'; color = '#16a34a'; presentCount++; }
            else if (status === 'Late') { code = 'L'; color = '#d97706'; presentCount++; }
            else if (status === 'Excused') { code = 'E'; color = '#6366f1'; }
            return `<td style="text-align:center;color:${color};font-weight:600;">${code}</td>`;
        }).join('');
        const pct = Math.round((presentCount / sessions.length) * 100);
        const pctColor = pct < 75 ? '#ef4444' : '#16a34a';
        return `<tr>
            <td style="text-align:center;">${idx + 1}</td>
            <td style="white-space:nowrap;">${escapeHtml(String(student.registerNo ?? student.studentId))}</td>
            <td style="white-space:nowrap;">${escapeHtml(student.firstName)} ${escapeHtml(student.lastName)}</td>
            ${cells}
            <td style="text-align:center;font-weight:700;color:${pctColor};">${pct}%</td>
        </tr>`;
    }).join('');

    // Scale font smaller when many sessions so table fits on landscape page
    const colCount = sessions.length + 4;
    const fontSize = colCount > 30 ? '7px' : colCount > 20 ? '8px' : colCount > 12 ? '9px' : '10px';

    const printHtml = `<!DOCTYPE html><html><head><title>Attendance Matrix — ${escapeHtml(className)}</title>
<style>
  @page { size: A4 landscape; margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: ${fontSize}; margin: 0; padding: 0; }
  h2, h3 { margin: 0 0 4px; }
  h2 { font-size: 13px; }
  h3 { font-size: 10px; color: #555; font-weight: normal; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #ccc; padding: 2px 3px; overflow: hidden; }
  th { background: #f1f5f9; font-size: calc(${fontSize} - 0px); text-align: center; }
  td:nth-child(1) { width: 22px; }
  td:nth-child(2) { width: 28px; }
  td:nth-child(3) { width: 80px; }
  td:last-child  { width: 28px; }
  tr { page-break-inside: avoid; }
  thead { display: table-header-group; }
  .header-block { margin-bottom: 6px; }
  p.legend { font-size: 8px; color: #666; margin: 4px 0 0; }
</style>
</head>
<body>
<div class="header-block">
  <h2>Attendance Matrix — ${escapeHtml(className)} &nbsp;|&nbsp; St. Jude's Catechism</h2>
  <h3>Academic Year: ${escapeHtml(String(currentUserData.academicYear || ''))} &nbsp;|&nbsp; Generated: ${new Date().toLocaleDateString('en-IN')}</h3>
  <p class="legend">P = Present &nbsp; A = Absent &nbsp; L = Late &nbsp; E = Excused</p>
</div>
<table>
  <thead>
    <tr>
      <th>#</th><th>Reg.</th><th style="text-align:left;">Student Name</th>
      ${headerCols}
      <th>%</th>
    </tr>
  </thead>
  <tbody>${bodyRows}</tbody>
</table>
<script>window.onload = () => { window.print(); }<\/script>
</body></html>`;

    const w = window.open('', '_blank');
    if (w) { w.document.write(printHtml); w.document.close(); }
}

// Dropdown version of Save (Faculty)
window.saveAttendance = async (sessionId) => {
    const inputs = document.querySelectorAll('.attendance-status');
    if (!inputs || inputs.length === 0) return showError('No attendance inputs found');

    const classId = currentUserData.classId;
    if (!classId) return showError('Error: Faculty class ID not found.');

    const activeYearId = getActiveAcademicYearId()
        || window.APP_CONTEXT?.activeAcademicYearId
        || DATA_MODELS.appConfig?.activeAcademicYearId;
    if (!activeYearId) return showError('No active academic year found. Cannot save attendance.');

    showSpinner();
    try {
        const { doc, setDoc } = window;
        const records = []; // { obj } parallel to promises
        const promises = [];
        for (const select of inputs) {
            const studentId = select.dataset.student;
            if (!studentId) continue;
            const status = select.value;
            const docId = `${sessionId}_${studentId}`;
            const attendanceObj = {
                id: docId,
                sessionId, studentId, status, classId,
                academicYearId: activeYearId,
                updatedAt: new Date().toISOString(),
            };
            const docRef = doc(window.db, 'attendance', docId);
            records.push(attendanceObj);
            promises.push(setDoc(docRef, attendanceObj, { merge: true }));
        }
        const results = await Promise.allSettled(promises);
        const failed = results.filter(r => r.status === 'rejected');
        const saved = results.length - failed.length;

        // Update local cache for each successful save so views reflect reality
        // immediately (realtime updates may be delayed or disabled).
        results.forEach((res, i) => {
            if (res.status !== 'fulfilled') return;
            const obj = records[i];
            const idx = DATA_MODELS.attendance.findIndex(a =>
                a.sessionId === obj.sessionId && String(a.studentId) === String(obj.studentId));
            if (idx >= 0) DATA_MODELS.attendance[idx] = { ...DATA_MODELS.attendance[idx], ...obj };
            else DATA_MODELS.attendance.push(obj);
        });

        createAuditLog('attendance_saved', { sessionId, studentCount: saved, failed: failed.length, classId });
        if (failed.length > 0) {
            console.error('Attendance save failures:', failed.map(r => r.reason?.message));
            showError(`${saved} saved, ${failed.length} failed. Check console for details.`);
        } else {
            showSuccess('Attendance saved successfully!');
        }

        // Refresh any open day-wise report that reads attendance
        const reportSel = document.getElementById('report-session-date');
        if (reportSel && reportSel.value && typeof generateDaywiseAttendanceReport === 'function') {
            generateDaywiseAttendanceReport();
        }
    } catch (err) {
        showError('Error saving attendance: ' + err.message);
    } finally {
        hideSpinner();
    }
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

function parseCSV(content) {
    const lines = content.split('\n').filter(line => line.trim() !== '');
    if (lines.length < 2) {
        return showError('CSV file must contain at least a header row and one data row');
    }
    const headers = lines[0].split(',').map(h => h.trim());
    const headerIndices = {
        studentId: headers.indexOf('studentId'),
        firstName: headers.indexOf('firstName'),
        lastName: headers.indexOf('lastName'),
        dob: headers.indexOf('dob(YYYY-MM-DD)'),
        guardian: headers.indexOf('guardian'),
        phone: headers.indexOf('phone'),
        email: headers.indexOf('email'),
        notes: headers.indexOf('notes')
    };
    if (headerIndices.studentId === -1 || headerIndices.firstName === -1) {
        return showError('Invalid CSV format. Header must contain at least "studentId" and "firstName".');
    }
    const students = [], errors = [];
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        const student = {
            studentId: values[headerIndices.studentId],
            firstName: values[headerIndices.firstName],
            lastName: headerIndices.lastName !== -1 ? values[headerIndices.lastName] : '',
            dob: headerIndices.dob !== -1 ? values[headerIndices.dob] : '',
            guardian: headerIndices.guardian !== -1 ? values[headerIndices.guardian] : '',
            phone: headerIndices.phone !== -1 ? values[headerIndices.phone] : '',
            email: headerIndices.email !== -1 ? values[headerIndices.email] : '',
            notes: headerIndices.notes !== -1 ? values[headerIndices.notes] : ''
        };
        if (!student.studentId || !student.firstName) {
            errors.push(`Row ${i + 1}: Missing required fields (studentId, firstName)`);
            continue;
        }
        if (student.dob && !/^\d{4}-\d{2}-\d{2}$/.test(student.dob)) {
            errors.push(`Row ${i + 1}: Invalid date format (should be YYYY-MM-DD)`);
            continue;
        }
        if (DATA_MODELS.students.some(s => s.studentId === student.studentId) || students.some(s => s.studentId === student.studentId)) {
            errors.push(`Row ${i + 1}: Duplicate student ID`);
            continue;
        }
        students.push(student);
    }
    // Display preview or errors
    const container = document.getElementById('preview-container');
    const importCsvBtn = document.getElementById('import-csv-btn');
    if (errors.length > 0) {
        container.innerHTML = `<h4>Validation Errors:</h4><ul>${errors.map(e => `<li>${e}</li>`).join('')}</ul>`;
        importCsvBtn.disabled = true;
    } else {
        let previewHtml = `<h4>Preview (${students.length} students):</h4>
                           <table class="data-table simple"><thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>`;
        students.slice(0, 5).forEach(s => {
            previewHtml += `<tr>${headers.map(h_key => `<td>${escapeHtml(s[Object.keys(headerIndices).find(key => headerIndices[key] === headers.indexOf(h_key))] || '')}</td>`).join('')}</tr>`;
        });
        if (students.length > 5) previewHtml += `<tr><td colspan="${headers.length}">... and ${students.length - 5} more students</td></tr>`;
        previewHtml += '</tbody></table>';
        container.innerHTML = previewHtml;
        importCsvBtn.disabled = false;
    }
    window.csvPreviewData = { validStudents: students, errors: errors };
}

async function importCSV() {
    if (!window.csvPreviewData || !window.csvPreviewData.validStudents) {
        return showError('No valid student data to import.');
    }
    const studentsToImport = window.csvPreviewData.validStudents;
    const classId = currentUserData.classId; // Get faculty's class

    // Add the faculty's classId to each student
    studentsToImport.forEach(s => s.classId = classId);

    showSpinner();
    try {
        const { doc, setDoc } = window;
        const promises = studentsToImport.map(async student => {
            const studentRef = doc(window.db, 'students', String(student.studentId));
            await setDoc(studentRef, student, { merge: true });
            await upsertEnrollmentForStudent(withAcademicYear(student), currentUserData?.uid || 'faculty');
        });
        await Promise.all(promises);
        document.getElementById('import-modal').style.display = 'none';
        window.csvPreviewData = null;
        createAuditLog('csv_import', { count: studentsToImport.length, classId: classId });
        showSuccess(`Successfully imported ${studentsToImport.length} students.`);
    } catch (err) {
        showError('Import failed: ' + err.message);
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

/**
 * Generates Report 2: Day-wise Attendance Report (Matrix/Table Format)
 * PASTE THIS INTO faculty.js
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

    // Find the session object
    const session = DATA_MODELS.sessions.find(s => s.id === sessionId);
    if (!session) {
        container.innerHTML = '<p>Error: Session not found.</p>';
        printBtn.style.display = 'none';
        return;
    }

    // Handle "No Class" status
    if (session.status === 'NoClass') {
        container.innerHTML = `<h5>Report for ${formatDate(session.date)}</h5>
                               <p><strong>Status: No Class</strong></p>
                               <p>Reason: ${escapeHtml(session.noClassReason || 'Not specified')}</p>`;
        printBtn.style.display = 'block';
        return;
    }

    // Get students (Faculty view is already scoped to their class)
    let allStudents = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
        .filter(student => String(student.classId || '') === String(currentUserData.classId || ''));
    if (allStudents.length === 0) {
        allStudents = DATA_MODELS.students.filter(s => String(s.classId || '') === String(currentUserData.classId || ''));
    }
    allStudents = allStudents.sort((a, b) =>
        (a.lastName || '').localeCompare(b.lastName || '') || (a.firstName || '').localeCompare(b.firstName || '')
    );

    // 1. Separate students into two buckets
    const presentStudents = [];
    const absentStudents = [];

    allStudents.forEach(student => {
        const att = DATA_MODELS.attendance.find(a => a.sessionId === sessionId && a.studentId === student.studentId);
        const status = att ? att.status : 'Absent'; // Default to Absent

        const rowData = { student, status };

        if (status === 'Present') {
            presentStudents.push(rowData);
        } else {
            absentStudents.push(rowData);
        }
    });

    // 2. Sort both buckets by Student ID
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

function exportDaywiseReportAsPdf() {
    const select = document.getElementById('report-session-date');
    const sessionId = select?.value;
    const session = sessionId ? DATA_MODELS.sessions.find(s => s.id === sessionId) : null;
    if (!session) return showError('Please select a session first.');

    const container = document.getElementById('daywise-report-container');
    if (!container || !container.innerHTML.trim()) return showError('No report to export. Please generate the report first.');

    const className = (DATA_MODELS.classes || []).find(c => c.id === currentUserData.classId)?.name || currentUserData.classId || 'Class';
    const sessionDate = formatDate(session.sessionDate || session.date);

    const printHtml = `<!DOCTYPE html><html><head><title>Day-wise Report — ${escapeHtml(sessionDate)}</title>
<style>
  @page { size: A4 portrait; margin: 15mm; }
  body { font-family: Arial, sans-serif; font-size: 12px; margin: 0; padding: 0; color: #222; }
  h2 { font-size: 16px; margin: 0 0 4px; }
  h3 { font-size: 12px; font-weight: normal; color: #555; margin: 0 0 14px; }
  h4 { font-size: 13px; margin: 16px 0 6px; }
  h5 { font-size: 12px; margin: 10px 0 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  th, td { border: 1px solid #ccc; padding: 5px 8px; text-align: left; }
  th { background: #f1f5f9; }
  tr { page-break-inside: avoid; }
  .text-success { color: #16a34a; font-weight: 600; }
  .text-danger  { color: #ef4444; font-weight: 600; }
  hr { border: none; border-top: 1px solid #ddd; margin: 14px 0; }
  p.footer { font-size: 9px; color: #999; margin-top: 20px; }
</style>
</head><body>
<h2>Day-wise Attendance Report — ${escapeHtml(className)}</h2>
<h3>Session: ${escapeHtml(sessionDate)} &nbsp;|&nbsp; St. Jude's Catechism &nbsp;|&nbsp; Generated: ${new Date().toLocaleDateString('en-IN')}</h3>
${container.innerHTML}
<p class="footer">Printed by St. Jude's Catechism Management System</p>
<script>window.onload = () => window.print();<\/script>
</body></html>`;

    const blob = new Blob([printHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
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
        alert("Error: Report containers missing in HTML. Please check console.");
        console.error("Missing DOM Elements:", { listView, reportView, container });
        return;
    }

    // 2. Switch Views
    listView.style.display = 'none';
    reportView.style.display = 'block';

    // 3. Filter Data (Admin/Faculty agnostic logic)
    // Faculty users already have a filtered DATA_MODELS.students, Admin has all.
    // This filter works for both.
    const students = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
        .filter(s => String(s.classId || '') === String(assessment.classId || ''))
        .sort((a, b) => String(a.studentId).localeCompare(String(b.studentId), undefined, { numeric: true }));

    const scores = DATA_MODELS.scores.filter(s => s.assessmentId === assessmentId);

    // 4. Calculate Stats
    let totalScored = 0;
    let sumMarks = 0;
    let highest = 0;
    let lowest = assessment.totalMarks;

    const reportRows = students.map(student => {
        const scoreRecord = scores.find(s => s.studentId === student.studentId);
        const marks = scoreRecord && scoreRecord.marks !== null ? scoreRecord.marks : null;

        let percentage = 0;
        let statusHtml = '<span style="color:orange">Absent</span>';

        if (marks !== null) {
            totalScored++;
            sumMarks += marks;
            if (marks > highest) highest = marks;
            if (marks < lowest) lowest = marks;

            percentage = Math.round((marks / assessment.totalMarks) * 100);
            const color = percentage >= 35 ? 'green' : 'red';
            statusHtml = `<strong style="color:${color}">${percentage}%</strong>`;
        }

        return { student, marks, statusHtml };
    });

    if (totalScored === 0) lowest = 0;
    const average = totalScored > 0 ? Math.round(sumMarks / totalScored) : 0;

    // 5. Build HTML
    let html = `
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
            <button class="btn btn-success btn-sm" id="btn-export-assess-csv">
                <i class="fas fa-file-csv"></i> Export CSV
            </button>
            <button class="btn btn-danger btn-sm" id="btn-export-assess-pdf">
                <i class="fas fa-file-pdf"></i> Export PDF
            </button>
            <button class="btn btn-primary btn-sm" onclick="printReport('assessment-report-container', 'Assessment Report')">
                <i class="fas fa-print"></i> Print
            </button>
        </div>

        <table class="data-table">
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Marks</th>
                    <th>%</th>
                    <th>Grade</th>
                </tr>
            </thead>
            <tbody>
    `;

    reportRows.forEach(row => {
        const pct = row.marks !== null ? Math.round((row.marks / assessment.totalMarks) * 100) : null;
        const gradeObj = (typeof getLetterGrade === 'function') ? getLetterGrade(pct) : null;
        const gradeBadge = gradeObj
            ? `<span class="grade-badge ${gradeObj.css}">${gradeObj.grade}</span>`
            : '<span style="color:orange">Absent</span>';
        html += `<tr>
            <td>${escapeHtml(row.student.studentId)}</td>
            <td>${escapeHtml(row.student.firstName)} ${escapeHtml(row.student.lastName)}</td>
            <td>${row.marks !== null ? row.marks : '-'}</td>
            <td>${row.statusHtml}</td>
            <td>${gradeBadge}</td>
        </tr>`;
    });

    html += `</tbody></table>`;

    // 6. Inject HTML
    container.innerHTML = html;

    // 7. Attach Listeners (Wrapped in Timeout to ensure DOM readiness)
    setTimeout(() => {
        const btnCsv = document.getElementById('btn-export-assess-csv');
        const btnPdf = document.getElementById('btn-export-assess-pdf');

        if (btnCsv) {
            btnCsv.onclick = () => exportAssessmentToCsv(assessmentId);
        } else {
            console.warn("CSV Button failed to render");
        }

        if (btnPdf) {
            btnPdf.onclick = () => {
                const filename = `Report_${assessment.name.replace(/[^a-z0-9]/gi, '_')}.pdf`;
                // Check if common.js function exists
                if (typeof downloadContainerAsPDF === 'function') {
                    downloadContainerAsPDF('assessment-report-container', filename);
                } else {
                    alert("PDF function missing. Check common.js");
                }
            };
        } else {
            console.warn("PDF Button failed to render");
        }
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

// -----------------------------------------------------------
// PHASE 2: FACULTY MIGRATION WIZARD
// -----------------------------------------------------------

/**
 * Initialize migration card visibility and populate migration preview
 */
async function initializeFacultyMigrationCard() {
    const card = document.getElementById('year-migration-card');
    if (!card) return;

    const activeYearId = getActiveAcademicYearId();
    const activeYear = (DATA_MODELS.academicYears || []).find(y => y.id === activeYearId);

    if (!activeYear || !activeYear.migrationEnabled || !activeYear.previousYearId) {
        // Migration is not enabled for this year
        const statusEl = document.getElementById('year-migration-status');
        if (statusEl) {
            statusEl.innerHTML = '<p style="color: var(--text-color-light);">Academic year migration is currently <strong>disabled</strong> by admin.</p>';
        }
        const previewBtn = document.getElementById('preview-year-migration-btn');
        const runBtn = document.getElementById('run-year-migration-btn');
        if (previewBtn) previewBtn.disabled = true;
        if (runBtn) runBtn.disabled = true;
        return;
    }

    // Migration is enabled - show options
    const statusEl = document.getElementById('year-migration-status');
    if (statusEl) {
        const prevYear = (DATA_MODELS.academicYears || []).find(y => y.id === activeYear.previousYearId);
        statusEl.innerHTML = `<p style="color: var(--success); font-weight: 500;"><i class="fas fa-check-circle"></i> Migration enabled from <strong>${prevYear?.label || activeYear.previousYearId}</strong></p>`;
    }

    const previewBtn = document.getElementById('preview-year-migration-btn');
    const runBtn = document.getElementById('run-year-migration-btn');
    if (previewBtn) previewBtn.disabled = false;
    if (runBtn) runBtn.disabled = false;

    // Wire up button listeners
    if (previewBtn && !previewBtn.dataset.listenerWired) {
        previewBtn.addEventListener('click', previewYearMigration);
        previewBtn.dataset.listenerWired = 'true';
    }
    if (runBtn && !runBtn.dataset.listenerWired) {
        runBtn.addEventListener('click', runYearMigration);
        runBtn.dataset.listenerWired = 'true';
    }

    // Load initial preview
    await previewYearMigration();
}

/**
 * PHASE 2: Preview students from previous year
 */
async function previewYearMigration() {
    const activeYearId = getActiveAcademicYearId();
    const activeYear = (DATA_MODELS.academicYears || []).find(y => y.id === activeYearId);

    if (!activeYear || !activeYear.previousYearId) {
        showError('Migration not configured for this year.');
        return;
    }

    const previewContainer = document.getElementById('year-migration-preview');
    if (!previewContainer) return;

    previewContainer.innerHTML = '<p>Loading previous year students...</p>';

    try {
        // Query enrollments from previous year for THIS faculty's class
        const previousYearEnrollments = await fetchEnrollmentsForClass(activeYear.previousYearId, currentUserData.classId);

        if (previousYearEnrollments.length === 0) {
            previewContainer.innerHTML = '<p style="color: var(--text-color-light);">No students found from previous year for your class.</p>';
            return;
        }

        // Check for duplicates in current year
        const currentEnrollments = DATA_MODELS.enrollments || [];
        const duplicateStudentIds = new Set();
        previousYearEnrollments.forEach(prevEnroll => {
            if (currentEnrollments.some(curr => curr.studentId === prevEnroll.studentId && curr.academicYearId === activeYearId)) {
                duplicateStudentIds.add(prevEnroll.studentId);
            }
        });

        let html = `<h5>Previous Year Roster (${previousYearEnrollments.length} students)</h5>`;
        if (duplicateStudentIds.size > 0) {
            html += `<p style="color: var(--warning);"><i class="fas fa-exclamation-triangle"></i> <strong>${duplicateStudentIds.size}</strong> student(s) already exist in this year and will be skipped.</p>`;
        }

        html += '<table class="data-table simple"><thead><tr><th>Reg #</th><th>Student ID</th><th>Name</th><th>Status</th></tr></thead><tbody>';

        previousYearEnrollments.forEach(enroll => {
            const student = (DATA_MODELS.students || []).find(s => s.studentId === enroll.studentId);
            const isDuplicate = duplicateStudentIds.has(enroll.studentId);
            const statusClass = isDuplicate ? 'text-warning' : 'text-success';
            const statusText = isDuplicate ? 'SKIP (exists)' : 'Ready to migrate';

            html += `<tr>
                <td>${enroll.registerNo}</td>
                <td>${enroll.studentId}</td>
                <td>${student ? `${student.firstName} ${student.lastName}` : '(not found)'}</td>
                <td class="${statusClass}"><small>${statusText}</small></td>
            </tr>`;
        });

        html += '</tbody></table>';
        previewContainer.innerHTML = html;

        // Store preview data for migration
        window.migrationPreviewData = {
            previousYearEnrollments,
            duplicateStudentIds,
            activeYearId,
            previousYearId: activeYear.previousYearId
        };

    } catch (err) {
        console.error('Migration preview error:', err);
        previewContainer.innerHTML = `<p class="text-danger">Error loading previous year data: ${err.message}</p>`;
    }
}

// Migration is admin-only — duplicate definition removed

// -----------------------------------------------------------
// PHASE 3: STUDENT QUICK ONBOARDING
// -----------------------------------------------------------

/**
 * Initialize quick onboarding modal - auto-generate register number when modal opens
 */
function initializeQuickOnboarding() {
    const btn = document.getElementById('quick-onboard-btn');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        // Clear form
        document.getElementById('quick-onboard-form').reset();

        // Auto-generate register number for current class/year
        const regNo = await generateNextRegisterNumber();
        document.getElementById('qo-register-no').value = regNo || '(Will be auto-assigned)';
    });
}

/**
 * Generate next register number for faculty's class in active academic year
 */
async function generateNextRegisterNumber() {
    const activeYearId = getActiveAcademicYearId();
    const classId = currentUserData?.classId;

    if (!activeYearId || !classId) return null;

    try {
        // Query existing enrollments to find max register number
        const enrollments = (DATA_MODELS.enrollments || []).filter(
            e => e.academicYearId === activeYearId && e.classId === classId
        );

        if (enrollments.length === 0) return '1';

        // Get max register number and increment
        const maxRegNo = Math.max(...enrollments.map(e => parseInt(e.registerNo) || 0));
        return String(maxRegNo + 1);
    } catch (err) {
        console.error('Error generating register number:', err);
        return null;
    }
}

/**
 * Submit quick onboarding form - create student and enrollment
 */
async function submitQuickOnboarding() {
    const form = document.getElementById('quick-onboard-form');
    if (!form.checkValidity()) {
        return showError('Please fill in all required fields.');
    }

    const firstName = document.getElementById('qo-first-name').value.trim();
    const lastName = document.getElementById('qo-last-name').value.trim();
    const fatherName = document.getElementById('qo-father-name').value.trim();
    const fatherMobile = document.getElementById('qo-father-mobile').value.trim();
    const dob = document.getElementById('qo-dob').value || '';

    if (!firstName || !lastName || !fatherName || !fatherMobile) {
        return showError('Please fill in all required fields.');
    }

    const activeYearId = getActiveAcademicYearId();
    const classId = currentUserData?.classId;

    if (!activeYearId || !classId) {
        return showError('Academic year or class not configured.');
    }

    showSpinner('Registering student...');
    try {
        // Create unique student ID (can be modified later by faculty)
        const studentId = `STU-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`.toUpperCase();

        // Create student profile
        const studentPayload = withAcademicYear({
            studentId,
            firstName,
            lastName,
            dob,
            fatherName,
            fatherMobile,
            classId,
            phone: fatherMobile,
            guardian: fatherName,
            registeredVia: 'quick_onboarding',
            registeredAt: new Date().toISOString(),
            registeredBy: currentUserData?.uid || 'faculty'
        });

        const studentRef = doc(window.db, 'students', studentId);
        await setDoc(studentRef, studentPayload, { merge: true });

        // Log audit entry (enrollment is handled by admin)
        createAuditLog('student_quick_onboarding', { studentId, firstName, lastName, classId });

        // Close modal (realtime listeners will pick up the new student automatically)
        const qoModal = document.getElementById('quick-onboard-modal');
        if (qoModal) qoModal.style.display = 'none';
        showSuccess(`Student Added!`, `${firstName} ${lastName} added. Ask admin to complete class enrollment.`);

    } catch (err) {
        console.error('Quick onboarding error:', err);
        showError('Registration failed: ' + err.message);
    } finally {
        hideSpinner();
    }
}

/**
 * Wire up quick onboarding event listeners
 */
function setupQuickOnboardingListeners() {
    const submitBtn = document.getElementById('submit-quick-onboard-btn');
    if (submitBtn) {
        submitBtn.addEventListener('click', submitQuickOnboarding);
    }
}

// -----------------
// 🔄 A6: STUDENT TRANSFER (FACULTY)
// -----------------
// Transfer and class assignment functions are admin-only — removed from faculty

// -----------------
// 📢 B8: ANNOUNCEMENTS (FACULTY READ-ONLY)
// -----------------
let _facultyAnnouncementsListenerActive = false;
function startFacultyAnnouncementsListener() {
    if (_facultyAnnouncementsListenerActive) return;
    if (!window.db || !window.onSnapshot || !window.collection) return;
    _facultyAnnouncementsListenerActive = true;
    const { onSnapshot, collection, query, orderBy } = window;
    const q = query(collection(window.db, 'announcements'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
        const all = [];
        snap.forEach(d => all.push({ id: d.id, ...d.data() }));
        renderFacultyAnnouncements(all);
    }, err => {
        _facultyAnnouncementsListenerActive = false;
        console.warn('Announcements listener error:', err);
    });
    window.realtimeUnsubscribers.push(unsub);
}

function renderFacultyAnnouncements(announcements) {
    const container = document.getElementById('faculty-announcements-list');
    if (!container) return;

    const activeYearId = getActiveAcademicYearId();
    const filtered = (announcements || []).filter(a => {
        if (a.audience && a.audience !== 'all' && a.audience !== 'faculty') return false;
        if (a.expiresAt && a.expiresAt < new Date().toISOString().slice(0, 10)) return false;
        if (a.academicYearId && String(a.academicYearId) !== String(activeYearId || '')) return false;
        return true;
    });

    if (filtered.length === 0) {
        container.innerHTML = '<p style="color:var(--text-color-light);">No announcements at this time.</p>';
        return;
    }

    const sorted = [...filtered].sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });

    container.innerHTML = sorted.map(ann => {
        return `
        <div class="announcement-card ${ann.pinned ? 'pinned' : ''}">
            ${ann.pinned ? '<i class="fas fa-thumbtack" style="color:var(--warning);margin-right:6px;"></i>' : ''}
            <strong>${escapeHtml(ann.title || '')}</strong>
            <p style="margin:6px 0 4px;">${escapeHtml(ann.body || '')}</p>
            <small style="color:var(--text-color-light);">${formatDate(ann.createdAt ? ann.createdAt.slice(0, 10) : '')}</small>
        </div>`;
    }).join('');
}

// ==========================================
// FEATURE A5 — Print Class Register (Faculty)
// ==========================================
function openPrintRegisterModal() {
    const modal = document.getElementById('print-register-modal');
    if (!modal) return;
    const sesSelect = document.getElementById('register-session-select');
    sesSelect.innerHTML = '<option value="">-- Select session --</option>';
    const available = [...DATA_MODELS.sessions]
        .filter(s => s.status === 'Available')
        .sort((a, b) => new Date(b.sessionDate || b.date) - new Date(a.sessionDate || a.date));
    available.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = formatDate(s.sessionDate || s.date) + (s.topic ? ` — ${s.topic}` : '');
        sesSelect.appendChild(opt);
    });
    // Faculty: hide class selector, default to their own class
    const clsGroup = document.getElementById('register-class-group');
    if (clsGroup) clsGroup.style.display = 'none';
    modal.style.display = 'flex';
}

function printClassRegister() {
    const sessionId = document.getElementById('register-session-select').value;
    if (!sessionId) { showError('Please select a session.'); return; }

    const session = DATA_MODELS.sessions.find(s => s.id === sessionId);
    if (!session) { showError('Session not found.'); return; }

    const classId = currentUserData?.classId;
    let roster = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
        .filter(s => !classId || s.classId === classId);
    if (roster.length === 0) {
        roster = DATA_MODELS.students.filter(s => !classId || s.classId === classId);
    }
    const students = roster.sort((a, b) =>
        String(a.registerNo ?? a.studentId).localeCompare(String(b.registerNo ?? b.studentId), undefined, { numeric: true })
    );

    const attendance = DATA_MODELS.attendance || [];
    const sessionAtt = attendance.filter(a => a.sessionId === sessionId);
    const className = classId ? ((DATA_MODELS.classes || []).find(c => c.id === classId)?.name || classId) : 'My Class';

    let rows = students.map((s, idx) => {
        const rec = sessionAtt.find(a => String(a.studentId) === String(s.studentId));
        const status = rec ? rec.status : 'Absent';
        const statusColor = status === 'Present' ? '#22c55e' : status === 'Late' ? '#f59e0b' : status === 'Excused' ? '#6366f1' : '#ef4444';
        return `<tr>
            <td>${idx + 1}</td>
            <td>${escapeHtml(String(s.registerNo ?? s.studentId))}</td>
            <td>${escapeHtml(s.firstName)} ${escapeHtml(s.lastName)}</td>
            <td style="color:${statusColor};font-weight:600;">${escapeHtml(status)}</td>
            <td style="width:80px;border-bottom:1px solid #999;"></td>
        </tr>`;
    }).join('');

    const printHtml = `<!DOCTYPE html><html><head><title>Class Register</title>
    <style>body{font-family:Arial,sans-serif;padding:24px;font-size:14px;}
    table{width:100%;border-collapse:collapse;}th,td{border:1px solid #ccc;padding:6px 10px;text-align:left;}
    th{background:#f1f5f9;}h2,h3{margin:4px 0;}p{margin:2px 0;color:#555;}
    @media print{body{padding:0;}}</style></head>
    <body>
    <h2>Class Register — ${escapeHtml(className)}</h2>
    <h3>Session Date: ${formatDate(session.sessionDate || session.date)}</h3>
    <p>Total Students: ${students.length}</p>
    <br>
    <table>
        <thead><tr><th>#</th><th>ID</th><th>Name</th><th>Status</th><th>Signature</th></tr></thead>
        <tbody>${rows}</tbody>
    </table>
    <br><p>Printed: ${new Date().toLocaleString()}</p>
    <script>window.onload=()=>window.print();<\/script>
    </body></html>`;

    document.getElementById('print-register-modal').style.display = 'none';
    const blob = new Blob([printHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ==========================================
// FEATURE B1 — CSV Student Import (Faculty)
// ==========================================
function downloadCSVTemplate() {
    const header = 'firstName,lastName,dob,guardian,phone,email,notes,fatherName,fatherPhone,motherName,motherPhone';
    const example = 'John,Doe,2014-03-15,Mary Doe,9123456789,john@example.com,Sample note,James Doe,9000000001,Mary Doe,9000000002';
    downloadCSV(header + '\n' + example, 'student_import_template.csv');
}

function parseStudentCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return { errors: ['CSV file has no data rows.'], rows: [] };
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const requiredCols = ['firstname', 'lastname', 'dob', 'guardian', 'phone'];
    const missing = requiredCols.filter(c => !headers.includes(c));
    if (missing.length > 0) return { errors: [`Missing required columns: ${missing.join(', ')}`], rows: [] };

    const rows = [];
    const errors = [];
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const vals = lines[i].split(',').map(v => v.trim());
        const row = {};
        headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });
        if (!row.firstname || !row.lastname) {
            errors.push(`Row ${i + 1}: firstName and lastName are required.`);
            row._error = true;
        }
        if (row.dob && !/^\d{4}-\d{2}-\d{2}$/.test(row.dob)) {
            errors.push(`Row ${i + 1}: dob must be in YYYY-MM-DD format (got: "${row.dob}").`);
            row._error = true;
        }
        rows.push(row);
    }
    return { errors, rows };
}

function openCsvImportModal() {
    const modal = document.getElementById('csv-import-modal');
    if (!modal) return;
    CSV_PARSED_ROWS = [];
    document.getElementById('csv-file-input').value = '';
    document.getElementById('csv-preview-container').classList.add('is-hidden');
    document.getElementById('confirm-csv-import-btn').classList.add('is-hidden');
    document.getElementById('csv-validation-errors').innerHTML = '';
    document.getElementById('csv-preview-info').textContent = '';
    modal.style.display = 'flex';
}

function handleCsvFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        const { errors, rows } = parseStudentCSV(ev.target.result);
        CSV_PARSED_ROWS = rows;
        renderCsvPreview(errors, rows);
    };
    reader.readAsText(file);
}

function renderCsvPreview(errors, rows) {
    const container = document.getElementById('csv-preview-container');
    const errDiv = document.getElementById('csv-validation-errors');
    const infoDiv = document.getElementById('csv-preview-info');
    const theadRow = document.getElementById('csv-preview-thead-row');
    const tbody = document.getElementById('csv-preview-tbody');
    const confirmBtn = document.getElementById('confirm-csv-import-btn');
    container.classList.remove('is-hidden');

    if (errors.length > 0) {
        errDiv.innerHTML = `<div style="background:var(--danger-light,#fee2e2);border:1px solid var(--danger);border-radius:6px;padding:10px;color:var(--danger);font-size:0.82rem;">
            <strong>Issues found:</strong><ul style="margin:4px 0 0 16px;">${errors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul>
        </div>`;
    } else {
        errDiv.innerHTML = '';
    }

    const validRows = rows.filter(r => !r._error);
    const roster = DATA_MODELS.students || [];
    const duplicates = validRows.filter(r => roster.some(s =>
        s.firstName?.toLowerCase() === r.firstname?.toLowerCase() &&
        s.lastName?.toLowerCase() === r.lastname?.toLowerCase() &&
        s.dob === r.dob));
    const importable = validRows.filter(r => !duplicates.includes(r));

    infoDiv.textContent = `${rows.length} rows parsed — ${importable.length} will be imported, ${duplicates.length} duplicates skipped, ${rows.filter(r => r._error).length} rows with errors skipped.`;

    const cols = ['firstname', 'lastname', 'dob', 'guardian', 'phone', 'email'];
    theadRow.innerHTML = cols.map(c => `<th>${escapeHtml(c)}</th>`).concat(['<th>Status</th>']).join('');
    tbody.innerHTML = rows.map(r => {
        const isDup = duplicates.includes(r);
        const statusLabel = r._error ? '<span style="color:var(--danger)">Error</span>' : isDup ? '<span style="color:var(--warning)">Duplicate</span>' : '<span style="color:var(--success)">OK</span>';
        const rowStyle = r._error ? 'background:#fee2e2;' : isDup ? 'background:#fffbeb;' : '';
        return `<tr style="${rowStyle}">${cols.map(c => `<td>${escapeHtml(r[c] || '')}</td>`).join('')}<td>${statusLabel}</td></tr>`;
    }).join('');

    if (importable.length > 0) {
        confirmBtn.classList.remove('is-hidden');
    } else {
        confirmBtn.classList.add('is-hidden');
    }
}

async function runCsvImport() {
    const validRows = CSV_PARSED_ROWS.filter(r => !r._error);
    const roster = DATA_MODELS.students || [];
    const importable = validRows.filter(r => !roster.some(s =>
        s.firstName?.toLowerCase() === r.firstname?.toLowerCase() &&
        s.lastName?.toLowerCase() === r.lastname?.toLowerCase() &&
        s.dob === r.dob));

    if (importable.length === 0) { showError('No valid rows to import.'); return; }

    const confirmResult = await showConfirm('Confirm Import', `Import ${importable.length} student(s)?`);
    if (!confirmResult.isConfirmed) return;

    showSpinner();
    let successCount = 0;
    let failCount = 0;
    try {
        const { doc, setDoc } = window;
        for (const r of importable) {
            try {
                const studentId = generateId();
                const student = {
                    studentId,
                    firstName: r.firstname || '',
                    lastName: r.lastname || '',
                    dob: r.dob || '',
                    guardian: r.guardian || '',
                    phone: r.phone || '',
                    email: r.email || '',
                    classId: currentUserData?.classId || '',
                    notes: r.notes || '',
                    fatherName: r.fathername || '',
                    fatherPhone: r.fatherphone || '',
                    motherName: r.mothername || '',
                    motherPhone: r.motherphone || '',
                    emergencyName: '',
                    emergencyPhone: '',
                    behaviorNote: '',
                    behaviorVisibility: true,
                };
                await setDoc(doc(window.db, 'students', String(student.studentId)), student, { merge: true });
                await upsertEnrollmentForStudent(student, currentUserData?.uid || 'faculty');
                successCount++;
            } catch (rowErr) {
                console.error('Row import error:', rowErr);
                failCount++;
            }
        }
        createAuditLog('csv_import', { count: successCount });
        showSuccess(`Imported ${successCount} student(s).${failCount > 0 ? ` ${failCount} failed.` : ''}`);
        document.getElementById('csv-import-modal').style.display = 'none';
    } catch (err) {
        showError('Import failed: ' + err.message);
    } finally {
        hideSpinner();
    }
}

// ==========================================
// FEATURE B7 — Attendance Date Filter (Faculty)
// ==========================================
function applyAttendanceDateFilter() {
    const from = document.getElementById('att-filter-from')?.value || null;
    const to = document.getElementById('att-filter-to')?.value || null;
    if (!from && !to) { showError('Please enter at least one date.'); return; }
    if (from && to && from > to) { showError('From date must be before To date.'); return; }
    ATTENDANCE_DATE_FILTER = { from, to };
    const parts = [];
    if (from) parts.push(`From: ${formatDate(from)}`);
    if (to) parts.push(`To: ${formatDate(to)}`);
    const statusEl = document.getElementById('att-filter-status');
    if (statusEl) statusEl.textContent = 'Active filter — ' + parts.join(', ');
    showSuccess('Date filter applied. Click Generate to refresh the report.');
}

function clearAttendanceDateFilter() {
    ATTENDANCE_DATE_FILTER = { from: null, to: null };
    const fromEl = document.getElementById('att-filter-from');
    const toEl = document.getElementById('att-filter-to');
    if (fromEl) fromEl.value = '';
    if (toEl) toEl.value = '';
    const statusEl = document.getElementById('att-filter-status');
    if (statusEl) statusEl.textContent = '';
    const container = document.getElementById('overall-report-container');
    if (container) container.innerHTML = '';
    showSuccess('Date filter cleared.');
}

// ==========================================
// FEATURE C3 — Homework / Assignment Tracker
// ==========================================

function populateHwClassDropdown() {
    const sel = document.getElementById('hw-class-select');
    if (!sel) return;
    const myClassId = currentUserData?.classId;
    sel.innerHTML = '';
    (DATA_MODELS.classes || [])
        .filter(c => !myClassId || c.id === myClassId)
        .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
        .forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.name || c.id;
            sel.appendChild(opt);
        });
    if (myClassId) sel.value = myClassId;
}

function openHomeworkForm() {
    const container = document.getElementById('homework-form-container');
    if (!container) return;
    const titleEl = document.getElementById('homework-form-title');
    if (titleEl) titleEl.textContent = 'New Assignment';
    document.getElementById('hw-title').value = '';
    document.getElementById('hw-subject').value = '';
    document.getElementById('hw-description').value = '';
    document.getElementById('hw-attachment-note').value = '';
    document.getElementById('hw-due-date').value = '';
    document.getElementById('hw-editing-id').value = '';
    populateHwClassDropdown();
    container.style.display = 'block';
    document.getElementById('hw-title').focus();
}

function editHomework(hwId) {
    const hw = (DATA_MODELS.homework || []).find(h => h.id === hwId);
    if (!hw) return;
    const container = document.getElementById('homework-form-container');
    if (!container) return;
    const titleEl = document.getElementById('homework-form-title');
    if (titleEl) titleEl.textContent = 'Edit Assignment';
    document.getElementById('hw-title').value = hw.title || '';
    document.getElementById('hw-subject').value = hw.subject || '';
    document.getElementById('hw-description').value = hw.description || '';
    document.getElementById('hw-attachment-note').value = hw.attachmentNote || '';
    document.getElementById('hw-due-date').value = hw.dueDate || '';
    document.getElementById('hw-editing-id').value = hw.id;
    populateHwClassDropdown();
    const clsSel = document.getElementById('hw-class-select');
    if (clsSel && hw.classId) clsSel.value = hw.classId;
    container.style.display = 'block';
}

async function saveHomework() {
    const title = document.getElementById('hw-title')?.value?.trim();
    if (!title) return showError('Title required.');
    const classId = document.getElementById('hw-class-select')?.value || currentUserData?.classId;
    if (!classId) return showError('Class is required.');
    const editingId = document.getElementById('hw-editing-id')?.value?.trim();
    const id = editingId || crypto.randomUUID();
    const activeYear = getActiveAcademicYearId();
    const payload = {
        id, title,
        subject: document.getElementById('hw-subject')?.value?.trim() || '',
        description: document.getElementById('hw-description')?.value?.trim() || '',
        attachmentNote: document.getElementById('hw-attachment-note')?.value?.trim() || '',
        dueDate: document.getElementById('hw-due-date')?.value || '',
        classId, academicYearId: activeYear,
    };
    if (!editingId) payload.createdAt = new Date().toISOString();
    showSpinner('Saving...');
    try {
        await window.setDoc(window.doc(window.db, 'homework', id), payload, { merge: true });
        createAuditLog(editingId ? 'homework_updated' : 'homework_created', { id, title });
        hideSpinner();
        document.getElementById('homework-form-container').style.display = 'none';
        document.getElementById('hw-editing-id').value = '';
        showSuccess('Assignment saved.');
    } catch (err) {
        hideSpinner();
        showError('Save failed: ' + err.message);
    }
}

async function deleteHomework(hwId) {
    const hw = (DATA_MODELS.homework || []).find(h => h.id === hwId);
    if (!hw) return;
    const confirmed = await showConfirm('Delete Assignment', 'Delete "' + hw.title + '"? This cannot be undone.', 'Delete');
    if (!confirmed.isConfirmed) return;
    showSpinner('Deleting...');
    try {
        await window.deleteDoc(window.doc(window.db, 'homework', hwId));
        createAuditLog('homework_deleted', { id: hwId });
        hideSpinner();
        showSuccess('Assignment deleted.');
    } catch (err) {
        hideSpinner();
        showError('Delete failed: ' + err.message);
    }
}

function renderHomeworkTable() {
    const tbody = document.getElementById('homework-tbody');
    if (!tbody) return;
    const myClassId = currentUserData?.classId;
    const hwList = (DATA_MODELS.homework || [])
        .filter(h => !myClassId || h.classId === myClassId)
        .slice()
        .sort((a, b) => (b.dueDate || b.createdAt || '').localeCompare(a.dueDate || a.createdAt || ''));
    if (!hwList.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted);">No assignments yet. Click &ldquo;New Assignment&rdquo; to add one.</td></tr>';
        return;
    }
    const subs = DATA_MODELS.homeworkSubmissions || [];
    const classes = DATA_MODELS.classes || [];
    const today = new Date().toISOString().split('T')[0];
    tbody.innerHTML = hwList.map(hw => {
        const cls = classes.find(c => c.id === hw.classId);
        const clsName = cls ? (cls.name || cls.id) : (hw.classId || '—');
        const submittedCount = subs.filter(s => s.homeworkId === hw.id && s.status !== 'pending').length;
        const roster = getCurrentAcademicYearRoster(DATA_MODELS.students || [], DATA_MODELS.enrollments || []).filter(s => s.classId === hw.classId);
        const totalStudents = roster.length;
        const isOverdue = hw.dueDate && hw.dueDate < today;
        return '<tr>'
            + '<td><strong>' + escapeHtml(hw.title) + '</strong>'
            + (hw.attachmentNote ? '<br><span style="font-size:0.78rem;color:var(--text-muted);"><i class="fas fa-paperclip"></i> ' + escapeHtml(hw.attachmentNote) + '</span>' : '')
            + '</td>'
            + '<td>' + escapeHtml(hw.subject || '—') + '</td>'
            + '<td>' + escapeHtml(clsName) + '</td>'
            + '<td style="color:' + (isOverdue ? 'var(--danger)' : 'inherit') + '">' + (hw.dueDate ? formatDate(hw.dueDate) : '—') + '</td>'
            + '<td><span class="' + (submittedCount >= totalStudents && totalStudents > 0 ? 'hw-submitted' : 'hw-pending') + '">' + submittedCount + '/' + totalStudents + '</span></td>'
            + '<td>'
            + '<button class="btn btn-sm btn-primary hw-submissions-btn" data-hw-id="' + hw.id + '" title="View Submissions"><i class="fas fa-list-check"></i></button> '
            + '<button class="btn btn-sm btn-secondary hw-edit-btn" data-hw-id="' + hw.id + '" title="Edit"><i class="fas fa-edit"></i></button> '
            + '<button class="btn btn-sm btn-danger hw-delete-btn" data-hw-id="' + hw.id + '" title="Delete"><i class="fas fa-trash"></i></button>'
            + '</td></tr>';
    }).join('');
}

function viewHomeworkSubmissions(hwId) {
    const hw = (DATA_MODELS.homework || []).find(h => h.id === hwId);
    if (!hw) return;
    const cls = (DATA_MODELS.classes || []).find(c => c.id === hw.classId);
    const clsName = cls ? (cls.name || cls.id) : (hw.classId || '');
    const infoEl = document.getElementById('hw-submissions-info');
    if (infoEl) infoEl.textContent = hw.title + ' — ' + clsName + ' — Due: ' + (hw.dueDate ? formatDate(hw.dueDate) : '—');

    const students = getCurrentAcademicYearRoster(DATA_MODELS.students || [], DATA_MODELS.enrollments || [])
        .filter(s => s.classId === hw.classId)
        .sort((a, b) => (a.firstName + ' ' + a.lastName).localeCompare(b.firstName + ' ' + b.lastName));

    const subs = DATA_MODELS.homeworkSubmissions || [];
    const tbody = document.getElementById('hw-submissions-tbody');
    if (!tbody) return;
    tbody.innerHTML = students.map(s => {
        const sub = subs.find(sb => sb.homeworkId === hwId && sb.studentId === s.studentId);
        const status = sub ? (sub.status || 'pending') : 'pending';
        const badge = status === 'submitted'
            ? '<span class="hw-submitted">Submitted</span>'
            : status === 'late'
                ? '<span class="hw-pending" style="background:#fee2e2;color:#991b1b;">Late</span>'
                : '<span class="hw-pending">Pending</span>';
        return '<tr>'
            + '<td>' + escapeHtml(s.firstName + ' ' + s.lastName) + '</td>'
            + '<td>' + badge + '</td>'
            + '<td><select class="hw-status-select" data-student-id="' + s.studentId + '" data-hw-id="' + hwId + '" style="padding:4px 8px;border-radius:var(--radius-sm);border:1px solid var(--border);font-size:0.82rem;">'
            + '<option value="pending"' + (status === 'pending' ? ' selected' : '') + '>Pending</option>'
            + '<option value="submitted"' + (status === 'submitted' ? ' selected' : '') + '>Submitted</option>'
            + '<option value="late"' + (status === 'late' ? ' selected' : '') + '>Late</option>'
            + '</select></td></tr>';
    }).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--text-muted);">No students in class.</td></tr>';

    tbody.querySelectorAll('.hw-status-select').forEach(function(sel) {
        sel.addEventListener('change', async function () {
            const newStatus = this.value;
            const studentId = this.dataset.studentId;
            const hwIdSel = this.dataset.hwId;
            const hwDoc = (DATA_MODELS.homework || []).find(h => h.id === hwIdSel);
            const activeYear = getActiveAcademicYearId();
            const existing = (DATA_MODELS.homeworkSubmissions || []).find(s => s.homeworkId === hwIdSel && s.studentId === studentId);
            const subId = existing?.id || crypto.randomUUID();
            try {
                const subPayload = {
                    id: subId, homeworkId: hwIdSel, studentId,
                    classId: hwDoc ? (hwDoc.classId || '') : '', academicYearId: activeYear,
                    status: newStatus,
                };
                if (newStatus === 'submitted') subPayload.submittedAt = new Date().toISOString();
                await window.setDoc(window.doc(window.db, 'homeworkSubmissions', subId), subPayload, { merge: true });
            } catch (err) {
                showError('Failed to update: ' + err.message);
            }
        });
    });

    document.getElementById('hw-submissions-modal').style.display = 'flex';
}