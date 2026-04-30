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
    appConfig: { activeAcademicYearId: null }
};
window.DATA_MODELS = DATA_MODELS; // Expose for debugging

// Global variable to hold the unsubscribe functions for realtime listeners
window.realtimeUnsubscribers = [];

// Global var to hold user data after verification
let currentUserData = null;
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
        return handleAppError("Firebase Auth is not loaded. Cannot start app.");
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

    // Faculty profile editing
    document.getElementById('edit-profile-btn')?.addEventListener('click', openFacultyProfileEditor);
    document.getElementById('save-faculty-profile-btn')?.addEventListener('click', saveFacultyProfileEdits);
    document.getElementById('cancel-faculty-profile-edit-btn')?.addEventListener('click', closeFacultyProfileEditor);
    document.getElementById('close-faculty-profile-modal-btn')?.addEventListener('click', closeFacultyProfileEditor);

    // Profile Menu Toggle
    document.getElementById('profile-btn').addEventListener('click', () => {
        document.getElementById('profile-menu').classList.toggle('is-hidden');
    });

    // Close profile menu on outside click
    window.addEventListener('click', (e) => {
        const menu = document.getElementById('profile-menu');
        const btn = document.getElementById('profile-btn');
        if (menu && btn && !menu.classList.contains('is-hidden') && !menu.contains(e.target) && !btn.contains(e.target)) {
            menu.classList.add('is-hidden');
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
    document.getElementById('print-daywise-report-btn')?.addEventListener('click', () => {
        printReport('daywise-report-container', 'Day-wise Attendance Report'); // From common.js
    });

    // View Student Modal Close
    document.getElementById('close-view-modal')?.addEventListener('click', () => {
        document.getElementById('student-view-modal').style.display = 'none';
    });

    // Academic year migration tools
    document.getElementById('preview-year-migration-btn')?.addEventListener('click', loadYearMigrationCandidates);
    document.getElementById('run-year-migration-btn')?.addEventListener('click', runYearMigration);

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

    // STUDENTS Listener (scoped to class)
    const studentsQuery = query(
        collection(db, 'students'),
        where('classId', '==', userClassId)
    );
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
        renderEarlyAngelStudentSelectors();
        renderEarlyAngelTables();
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

    // ASSESSMENTS Listener (scoped to class)
    const assessmentsQuery = query(
        collection(db, 'assessments'),
        where('classId', '==', userClassId)
    );
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

    // ATTENDANCE Listener (scoped to class)
    const attendanceQuery = query(
        collection(db, 'attendance'),
        where('classId', '==', userClassId)
    );
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

    // SCORES Listener (scoped to class)
    const scoresQuery = query(
        collection(db, 'scores'),
        where('classId', '==', userClassId)
    );
    const unsubScores = onSnapshot(scoresQuery, snapshot => {
        DATA_MODELS.scores = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (isCurrentAcademicYear(data)) DATA_MODELS.scores.push(data);
        });
        renderAssessmentsTable();
        // Refresh scores modal if open
        const scoresModal = document.getElementById('scores-modal');
        if (window._currentScoresAssessmentId && scoresModal.style.display === 'flex') {
            openScoresModal(window._currentScoresAssessmentId);
        }
        console.log('[realtime] scores sync', DATA_MODELS.scores.length);
    }, err => console.error('[realtime] scores listener error', err));
    window.realtimeUnsubscribers.push(unsubScores);

    // EARLY ANGEL ENTRIES Listener (scoped to class + active year)
    const activeYearId = getActiveAcademicYearId();
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

async function loadYearMigrationCandidates() {
    YEAR_MIGRATION_STATE.candidates = [];

    const classId = currentUserData?.classId || '';
    if (!window.db || !window.collection || !window.query || !window.where || !window.getDocs || !classId) {
        renderYearMigrationPanel();
        return;
    }

    await refreshYearMigrationState();
    if (!YEAR_MIGRATION_STATE.migrationEnabled || !YEAR_MIGRATION_STATE.previousYearId || !YEAR_MIGRATION_STATE.activeYearId) {
        renderYearMigrationPanel();
        return;
    }

    try {
        const previousYearQuery = query(
            collection(window.db, 'students'),
            where('classId', '==', classId),
            where('academicYearId', '==', YEAR_MIGRATION_STATE.previousYearId)
        );
        const activeYearQuery = query(
            collection(window.db, 'students'),
            where('classId', '==', classId),
            where('academicYearId', '==', YEAR_MIGRATION_STATE.activeYearId)
        );

        const [previousSnap, activeSnap] = await Promise.all([
            getDocs(previousYearQuery),
            getDocs(activeYearQuery)
        ]);

        const activeStudentIds = new Set(
            activeSnap.docs.map(d => String(d.data()?.studentId || d.id))
        );

        const candidates = [];
        previousSnap.forEach(docSnap => {
            const student = docSnap.data() || {};
            const studentId = String(student.studentId || docSnap.id);
            if (!activeStudentIds.has(studentId)) {
                candidates.push({ ...student, id: studentId, studentId });
            }
        });

        YEAR_MIGRATION_STATE.candidates = candidates.sort((a, b) =>
            String(a.studentId || '').localeCompare(String(b.studentId || ''), undefined, { numeric: true })
        );
    } catch (err) {
        console.error('Failed to load migration candidates:', err);
        showError('Failed to load migration preview: ' + err.message);
    }

    renderYearMigrationPanel();
}

async function runYearMigration() {
    const classId = currentUserData?.classId || '';
    const candidates = YEAR_MIGRATION_STATE.candidates || [];
    const activeYearId = YEAR_MIGRATION_STATE.activeYearId;
    const previousYearId = YEAR_MIGRATION_STATE.previousYearId;

    if (!YEAR_MIGRATION_STATE.migrationEnabled || !activeYearId || !previousYearId) {
        return showError('Migration is not enabled or year settings are incomplete.');
    }
    if (!classId) {
        return showError('Faculty class is not configured. Contact admin.');
    }
    if (candidates.length === 0) {
        return showError('No students available to migrate.');
    }

    const result = await showConfirmWithInput(
        'Run Academic Year Migration?',
        `This will copy ${candidates.length} students from ${previousYearId} to ${activeYearId} for class ${classId}. Type "MIGRATE" to continue.`,
        'MIGRATE'
    );
    if (result.value !== 'MIGRATE') return showSuccess('Migration canceled.');

    showSpinner();
    try {
        const writePromises = candidates.map(async sourceStudent => {
            const studentPayload = withAcademicYear({
                studentId: String(sourceStudent.studentId || sourceStudent.id || ''),
                firstName: sourceStudent.firstName || '',
                lastName: sourceStudent.lastName || '',
                dob: sourceStudent.dob || '',
                guardian: sourceStudent.guardian || '',
                phone: sourceStudent.phone || '',
                email: sourceStudent.email || '',
                notes: sourceStudent.notes || '',
                classId,
                migratedFromYear: previousYearId,
                migratedAt: new Date().toISOString(),
                migratedBy: currentUserData?.uid || 'faculty'
            });

            const studentRef = doc(window.db, 'students', String(studentPayload.studentId));
            await setDoc(studentRef, studentPayload, { merge: true });
            await upsertEnrollmentForStudent(studentPayload, currentUserData?.uid || 'faculty');
        });

        await Promise.all(writePromises);

        createAuditLog('faculty_academic_year_migration', {
            classId,
            fromYear: previousYearId,
            toYear: activeYearId,
            migratedCount: candidates.length
        });

        await loadYearMigrationCandidates();
        showSuccess(`Migration complete. ${candidates.length} students copied to ${activeYearId}.`);
    } catch (err) {
        showError('Migration failed: ' + err.message);
    } finally {
        hideSpinner();
    }
}

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
            option.textContent = `${student.studentId} - ${student.firstName || ''} ${student.lastName || ''}`.trim();
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
            option.textContent = `${student.studentId} - ${student.firstName || ''} ${student.lastName || ''}`.trim();
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
            createdAt: nowIso,
            createdBy: currentUserData?.uid || 'faculty'
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
            updatedBy: currentUserData?.uid || 'faculty'
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
            updatedBy: currentUserData?.uid || 'faculty'
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
    const rosterStudents = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
        .filter(student => !classId || String(student.classId || '') === classId);
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

    tbody.innerHTML = ''; // Clear table
    if (filteredStudents.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6">No students found.</td></tr>';
        return;
    }

    filteredStudents.forEach(student => {
        const row = document.createElement('tr');
        // Use escapeHtml (from common.js) to prevent XSS from user data
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
        const studentIdInput = document.getElementById('student-id-input').value.trim();
        const firstName = document.getElementById('student-first-name').value.trim();
        const lastName = document.getElementById('student-last-name').value.trim();
        const dob = document.getElementById('student-dob').value;
        const guardian = document.getElementById('student-guardian').value.trim();
        const phone = document.getElementById('student-phone').value.trim();
        const email = document.getElementById('student-email').value.trim();
        const notes = document.getElementById('student-notes').value.trim();
        const id = document.getElementById('student-id').value; // Hidden field for editing

        // Faculty role: classId comes from their own profile
        const classId = currentUserData.classId;

        if (!firstName || !lastName || !studentIdInput || !guardian || !classId) {
            throw new Error('Please fill in all required fields (*).');
        }

        const student = {
            studentId: studentIdInput,
            firstName, lastName, dob, guardian, phone, email, classId, notes
        };

        // Persist to Firestore
        const studentRef = doc(window.db, 'students', String(student.studentId));
        await setDoc(studentRef, student, { merge: true }); // Use merge to be safe
        await upsertEnrollmentForStudent(student, currentUserData?.uid || 'faculty');

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
        document.getElementById('student-id').value = student.studentId; // Set hidden ID
        document.getElementById('student-id-input').value = student.studentId;
        document.getElementById('student-first-name').value = student.firstName;
        document.getElementById('student-last-name').value = student.lastName;
        document.getElementById('student-dob').value = student.dob || '';
        document.getElementById('student-guardian').value = student.guardian;
        document.getElementById('student-phone').value = student.phone || '';
        document.getElementById('student-email').value = student.email || '';
        // 'student-class-id' dropdown is hidden for faculty, no need to set
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
        <p><strong>Date of Birth:</strong> ${student.dob ? formatDate(student.dob) : 'N/A'}</p>
        <p><strong>Guardian:</strong> ${escapeHtml(student.guardian)}</p>
        <p><strong>Contact:</strong> ${escapeHtml(student.phone || 'N/A')}</p>
        <p><strong>Email:</strong> ${escapeHtml(student.email || 'N/A')}</p>
        <p><strong>Class:</strong> ${escapeHtml(student.classId || 'N/A')}</p>
        <p><strong>Notes:</strong> ${escapeHtml(student.notes || 'None')}</p>
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

    if (DATA_MODELS.sessions.some(s => s.id === sessionId || s.date === date)) {
        return showError('A session already exists for this date');
    }

    const session = withAcademicYear({
        id: sessionId,
        date, status, noClassReason,
        createdAt: new Date().toISOString(),
    });

    showSpinner();
    try {
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
    const result = await showConfirm(
        'Delete Session?',
        `Delete session for ${formatDate(session?.date)}? All attendance for this day will be lost.`
    );

    if (result.isConfirmed) {
        showSpinner();
        try {
            const docRef = doc(window.db, 'sessions', sessionId);
            await deleteDoc(docRef);
            createAuditLog('session_deleted', { sessionId: sessionId, date: session?.date });
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

    // Sort students by ID for taking attendance too
    const sortedStudents = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
        .filter(student => String(student.classId || '') === String(currentUserData.classId || ''))
        .sort((a, b) =>
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

// Dropdown version of Save (Faculty)
window.saveAttendance = async (sessionId) => {
    const inputs = document.querySelectorAll('.attendance-status');
    if (!inputs || inputs.length === 0) return showError('No attendance inputs found');

    const classId = currentUserData.classId;
    if (!classId) return showError('Error: Faculty class ID not found.');

    showSpinner();
    try {
        const { doc, setDoc } = window;
        const promises = [];
        for (const select of inputs) {
            const studentId = select.dataset.student;
            const status = select.value;

            const attendanceObj = withAcademicYear({
                sessionId, studentId, status,
                updatedAt: new Date().toISOString(),
                classId: classId, // Faculty uses their own class ID
            });
            const docId = `${sessionId}_${studentId}`;
            const docRef = doc(window.db, 'attendance', docId);
            promises.push(setDoc(docRef, attendanceObj, { merge: true }));
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

    // Faculty role: classId comes from their own profile
    const classId = currentUserData.classId;

    if (!name || !date || isNaN(totalMarks) || totalMarks <= 0 || !classId) {
        return showError('Please fill in all required fields.');
    }

    const assessment = withAcademicYear({
        id: generateId(),
        name, date, totalMarks, classId
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

    const sessions = DATA_MODELS.sessions
        .filter(s => s.status === 'Available')
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    const students = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
        .filter(s => String(s.classId || '') === String(currentUserData?.classId || ''))
        .sort((a, b) =>
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
    const students = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
        .filter(student => String(student.classId || '') === String(currentUserData.classId || ''))
        .sort((a, b) =>
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

// Dropdown version of Save (Faculty)
window.saveAttendance = async (sessionId) => {
    const inputs = document.querySelectorAll('.attendance-status');
    if (!inputs || inputs.length === 0) return showError('No attendance inputs found');

    const classId = currentUserData.classId;
    if (!classId) return showError('Error: Faculty class ID not found.');

    showSpinner();
    try {
        const { doc, setDoc } = window;
        const promises = [];
        for (const select of inputs) {
            const studentId = select.dataset.student;
            const status = select.value;

            const attendanceObj = withAcademicYear({
                sessionId, studentId, status,
                updatedAt: new Date().toISOString(),
                classId: classId, // Faculty uses their own class ID
            });
            const docId = `${sessionId}_${studentId}`;
            const docRef = doc(window.db, 'attendance', docId);
            promises.push(setDoc(docRef, attendanceObj, { merge: true }));
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
            const yearStudent = withAcademicYear(student);
            const studentRef = doc(window.db, 'students', String(student.studentId));
            await setDoc(studentRef, yearStudent, { merge: true });
            await upsertEnrollmentForStudent(yearStudent, currentUserData?.uid || 'faculty');
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
    const allStudents = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
        .filter(student => String(student.classId || '') === String(currentUserData.classId || ''))
        .sort((a, b) =>
            a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)
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
                </tr>
            </thead>
            <tbody>
    `;

    reportRows.forEach(row => {
        html += `<tr>
            <td>${escapeHtml(row.student.studentId)}</td>
            <td>${escapeHtml(row.student.firstName)} ${escapeHtml(row.student.lastName)}</td>
            <td>${row.marks !== null ? row.marks : '-'}</td>
            <td>${row.statusHtml}</td>
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

/**
 * PHASE 2: Execute migration - import students from previous year
 */
async function runYearMigration() {
    if (!window.migrationPreviewData) {
        return showError('Please refresh preview first.');
    }

    const { previousYearEnrollments, duplicateStudentIds, activeYearId, previousYearId } = window.migrationPreviewData;

    const studentsToMigrate = previousYearEnrollments.filter(enroll => !duplicateStudentIds.has(enroll.studentId));

    if (studentsToMigrate.length === 0) {
        return showError('All students in previous year are already enrolled in current year.');
    }

    const result = await showConfirm(
        `Migrate ${studentsToMigrate.length} Student${studentsToMigrate.length !== 1 ? 's' : ''}?`,
        `This will import ${studentsToMigrate.length} student(s) from previous year to current year. Existing students will be skipped.`
    );

    if (!result.isConfirmed) return;

    showSpinner('Migrating students...');
    try {
        let migratedCount = 0;

        for (const prevEnroll of studentsToMigrate) {
            // Get student data from previous year
            const student = (DATA_MODELS.students || []).find(s => s.studentId === prevEnroll.studentId);
            if (!student) continue;

            // Create new enrollment for current year with auto register number
            const newEnrollment = await createOrUpdateEnrollment(
                activeYearId,
                currentUserData.classId,
                student.studentId,
                { migratedFromYearId: previousYearId }
            );

            if (newEnrollment) {
                migratedCount++;
                console.log(`Migrated: ${student.studentId} -> Register #${newEnrollment.registerNo}`);
            }
        }

        createAuditLog('year_migration_completed', {
            activeYearId,
            previousYearId,
            migratedCount,
            classId: currentUserData.classId
        });

        await initializeFacultyMigrationCard();
        showSuccess('Migration Complete!', `Successfully imported ${migratedCount} student(s) to current year.`);

    } catch (err) {
        console.error('Migration error:', err);
        showError('Migration failed: ' + err.message);
    } finally {
        hideSpinner();
    }
}

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

        // Create enrollment with auto register number
        const enrollment = await createOrUpdateEnrollment(
            activeYearId,
            classId,
            studentId,
            { registrationMethod: 'quick_onboarding' }
        );

        if (!enrollment || !enrollment.registerNo) {
            throw new Error('Failed to auto-assign register number.');
        }

        // Log audit entry
        createAuditLog('student_quick_onboarding', {
            studentId,
            firstName,
            lastName,
            registerNo: enrollment.registerNo,
            classId
        });

        // Close modal and refresh
        closeModal('quick-onboard-modal');
        await reloadAllData();
        showSuccess(`Student Registered!`, `${firstName} ${lastName} registered as #${enrollment.registerNo}`);

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