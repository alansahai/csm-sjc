/**
 * admin.js
 * All app logic for the Admin Dashboard (admin.html)
 * This is a "super-set" file that includes ALL faculty functions
 * plus all admin-only functions.
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
    attendance: [],
    assessments: [],
    scores: [],
    userRoles: [],
    classes: []
};
window.DATA_MODELS = DATA_MODELS; // Expose for debugging

// Global variable to hold the unsubscribe functions for realtime listeners
window.realtimeUnsubscribers = [];

// Global var to hold user data after verification
let currentUserData = null;

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

    // Setup all event listeners
    setupEventListeners();

    // Start fetching realtime data (the admin version)
    startRealtimeListeners();

    // --- Admin-specific load ---
    try {
        // Load all data for analytics
        await loadAllDataForAdmin();

        // Populate dropdowns that depend on this data
        await populateClassDropdowns('user-class-id-select');
        await populateClassDropdowns('student-class-id');
        await populateClassDropdowns('assessment-class-id');
        await populateClassDropdowns('report-class-filter');
        await populateClassDropdowns('analytics-class-filter');

        // Render analytics
        renderAdminAnalytics();
        renderClassesTable();
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
    if (targetTab === 'admin-panel') {
        // Refresh admin data
        loadAllDataForAdmin().then(() => {
            renderAdminAnalytics();
            renderClassesTable();
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
        snapshot.forEach(doc => DATA_MODELS.students.push(doc.data()));
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
        snapshot.forEach(doc => DATA_MODELS.sessions.push(doc.data()));
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
        snapshot.forEach((doc) => DATA_MODELS.assessments.push({ id: doc.id, ...doc.data() }));
        renderAssessmentsTable();
        console.log('[realtime] Synced assessments:', DATA_MODELS.assessments.length);
    }, err => console.error('[realtime] Assessments listener error:', err));
    window.realtimeUnsubscribers.push(unsubAssessments);

    // ATTENDANCE Listener (global)
    const attendanceQuery = collection(db, 'attendance');
    const unsubAttendance = onSnapshot(attendanceQuery, snapshot => {
        DATA_MODELS.attendance = [];
        snapshot.forEach(doc => DATA_MODELS.attendance.push(doc.data()));
        const currentSession = document.getElementById('session-date')?.value;
        if (currentSession) renderAttendanceForm(currentSession);
        console.log('[realtime] attendance sync', DATA_MODELS.attendance.length);
    }, err => console.error('[realtime] attendance listener error', err));
    window.realtimeUnsubscribers.push(unsubAttendance);

    // SCORES Listener (global)
    const scoresQuery = collection(db, 'scores');
    const unsubScores = onSnapshot(scoresQuery, snapshot => {
        DATA_MODELS.scores = [];
        snapshot.forEach(doc => DATA_MODELS.scores.push(doc.data()));
        renderAssessmentsTable();
        if (window._currentScoresAssessmentId && document.getElementById('scores-modal').style.display === 'flex') {
            openScoresModal(window._currentScoresAssessmentId);
        }
        console.log('[realtime] scores sync', DATA_MODELS.scores.length);
    }, err => console.error('[realtime] scores listener error', err));
    window.realtimeUnsubscribers.push(unsubScores);
}

// -----------------
// 📈 DASHBOARD
// -----------------
async function renderDashboard() {
    // Render Stats Cards
    const totalStudentsEl = document.getElementById('total-students');
    if (totalStudentsEl) totalStudentsEl.textContent = DATA_MODELS.students.length;

    const availableSessions = DATA_MODELS.sessions.filter(s => s.status === 'Available');
    const classesHeldEl = document.getElementById('classes-held');
    if (classesHeldEl) classesHeldEl.textContent = availableSessions.length;

    if (DATA_MODELS.students.length > 0 && availableSessions.length > 0) {
        let totalAttendance = 0;
        DATA_MODELS.students.forEach(student => {
            const presentCount = DATA_MODELS.attendance.filter(a => (a.studentId === student.studentId) && (a.status === 'Present' || a.status === 'Late')).length;
            totalAttendance += Math.round((presentCount / availableSessions.length) * 100);
        });
        const avgAttendance = DATA_MODELS.students.length > 0 ? Math.round(totalAttendance / DATA_MODELS.students.length) : 0;
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
    const filteredStudents = DATA_MODELS.students.filter(student => {
        if (!filterText) return true;
        return student.firstName.toLowerCase().includes(filterText) ||
            student.lastName.toLowerCase().includes(filterText) ||
            student.studentId.toLowerCase().includes(filterText) ||
            (student.guardian && student.guardian.toLowerCase().includes(filterText));
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
    const student = DATA_MODELS.students.find(s => s.studentId === studentId);
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
    const student = DATA_MODELS.students.find(s => s.studentId === studentId);
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

    if (!date) return showError('Please select a date');
    if (DATA_MODELS.sessions.some(s => s.date === date)) {
        return showError('A session already exists for this date');
    }

    const session = {
        id: generateId(), date, status, noClassReason,
        createdAt: new Date().toISOString(),
    };

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
    const result = await showConfirm(
        'Delete Session?',
        `Delete session for ${formatDate(session?.date)}? All attendance will be lost.`
    );
    if (result.isConfirmed) {
        showSpinner();
        try {
            const { doc, deleteDoc } = window;
            const docRef = doc(window.db, 'sessions', sessionId);
            await deleteDoc(docRef);
            // TODO: Batch delete all attendance docs for this session
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
    const sortedStudents = [...DATA_MODELS.students].sort((a, b) =>
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
            const student = DATA_MODELS.students.find(s => s.studentId === studentId);

            // Admin needs to look up the student's classId
            if (student && student.classId) {
                const attendanceObj = {
                    sessionId, studentId, status,
                    updatedAt: new Date().toISOString(),
                    classId: student.classId,
                };
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
function renderAssessmentsTable() {
    const tbody = document.querySelector('#assessments-table tbody');
    if (!tbody) return;

    const sortedAssessments = [...DATA_MODELS.assessments].sort((a, b) => new Date(b.date) - new Date(a.date));
    tbody.innerHTML = '';
    if (sortedAssessments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5">No assessments created yet.</td></tr>';
        return;
    }

    sortedAssessments.forEach(assessment => {
        const scores = DATA_MODELS.scores.filter(score => score.assessmentId === assessment.id);
        const scoredStudents = scores.length;
        const totalStudentsInClass = DATA_MODELS.students.filter(s => s.classId === assessment.classId).length;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${escapeHtml(assessment.name)} (${escapeHtml(assessment.classId || 'N/A')})</td>
            <td>${formatDate(assessment.date)}</td>
            <td>${escapeHtml(assessment.totalMarks)}</td>
            <td>${scoredStudents} of ${totalStudentsInClass}</td>
            <td>
                <button class="btn btn-primary btn-sm record-scores" data-id="${escapeHtml(assessment.id)}">
                    <i class="fas fa-edit"></i> Record Scores
                </button>
                <button class="btn btn-danger btn-sm delete-assessment" data-id="${escapeHtml(assessment.id)}">
                    <i class="fas fa-trash"></i>
                </button>
            </td>`;
        tbody.appendChild(row);
    });

    tbody.querySelectorAll('.record-scores').forEach(btn => {
        btn.addEventListener('click', (e) => openScoresModal(e.currentTarget.dataset.id));
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

    const assessment = {
        id: generateId(), name, date, totalMarks, classId
    };

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
    const result = await showConfirm(
        'Delete Assessment?',
        `Delete "${assessment?.name}"? All scores will be lost.`
    );
    if (result.isConfirmed) {
        showSpinner();
        try {
            const { doc, deleteDoc } = window;
            const docRef = doc(window.db, 'assessments', assessmentId);
            await deleteDoc(docRef);

            // TODO: Delete all scores associated with this assessment (batched delete)

            createAuditLog('assessment_deleted', { assessmentId: assessmentId, name: assessment?.name });
            showSuccess('Assessment deleted.');
        } catch (err) {
            showError('Failed to delete assessment: ' + err.message);
        } finally {
            hideSpinner();
        }
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
    const classStudents = DATA_MODELS.students.filter(s => s.classId === assessment.classId);

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
        toWrite.push({
            assessmentId, studentId, marks,
            updatedAt: new Date().toISOString(),
            classId: assessment.classId
        });
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
    const students = classId
        ? DATA_MODELS.students.filter(s => s.classId === classId)
        : DATA_MODELS.students;

    populateDropdown('report-student', students, s => s.studentId, s => `${s.firstName} ${s.lastName} (${s.studentId})`);

    // Clear old report
    document.getElementById('report-content').innerHTML = '<p>Select a student to generate a report</p>';
}

function generateStudentReport(studentId) {
    const student = DATA_MODELS.students.find(s => s.studentId === studentId);
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
    setTimeout(() => {
        renderMarksChart(assessmentDetails); // From common.js
        renderAttendanceChart(studentId, DATA_MODELS); // From common.js
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

    const students = [...DATA_MODELS.students].sort((a, b) =>
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
        const promises = studentsToImport.map(student => {
            const studentRef = doc(window.db, 'students', String(student.studentId));
            return setDoc(studentRef, student);
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
    if (DATA_MODELS.students.length === 0) return showError('No student data to export.');
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
    const students = [...DATA_MODELS.students].sort((a, b) =>
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
        const { getDocs, collection } = window;
        const collectionsToFetch = ['students', 'sessions', 'attendance', 'assessments', 'scores', 'userRoles', 'classes'];
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
        const students = DATA_MODELS.students.filter(s => s.classId === fac.classId);
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
            const studentsInClass = DATA_MODELS.students.filter(s => s.classId === classObj.id);
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
            return setDoc(sessionRef, {
                id: date,
                date: date,
                status: 'Available',
                createdAt: new Date().toISOString()
            }, { merge: true });
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
                batch.set(attRef, record, { merge: true });
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