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
    attendance: [],
    assessments: [],
    scores: []
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
            console.log("User authenticated:", user.uid); // Debug Log 1
            try {
                // User is signed in, check their role from SERVER
                const userData = await verifyRoleFromServer(user.uid, 'faculty');

                // --- USER IS VALID FACULTY ---
                console.log(`Welcome, ${user.email}! Role: ${userData.role}`);
                currentUserData = userData;
                initializeApp(user, userData);

            } catch (err) {
                // Role verification failed
                console.error("CRITICAL ERROR:", err); // Debug Log 2
                alert(`Login Error: ${err.message}\n\nCheck console for details.`); // Stop redirect with alert
                // await logout(); // COMMENTED OUT TO STOP LOOP
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
function initializeApp(user, userData) {
    // Populate profile menu
    document.getElementById('user-info-email').textContent = user.email;
    document.getElementById('user-info-role').textContent = `Faculty - ${userData.classId || 'Unassigned'}`;

    // Apply UI restrictions (hides admin-only buttons)
    applyRoleRestrictions(userData.role);

    // Setup all event listeners for the page
    setupEventListeners();

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
            if (e.target === modal) modal.style.display = 'none';
        });
    });

    // Logout Button (in profile menu)
    document.getElementById('logout-btn').addEventListener('click', logout); // From common.js

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

    // ASSESSMENTS Listener (scoped to class)
    const assessmentsQuery = query(
        collection(db, 'assessments'),
        where('classId', '==', userClassId)
    );
    const unsubAssessments = onSnapshot(assessmentsQuery, (snapshot) => {
        DATA_MODELS.assessments = [];
        snapshot.forEach((doc) => DATA_MODELS.assessments.push({ id: doc.id, ...doc.data() }));
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
        snapshot.forEach(doc => DATA_MODELS.attendance.push(doc.data()));
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
        snapshot.forEach(doc => DATA_MODELS.scores.push(doc.data()));
        renderAssessmentsTable();
        // Refresh scores modal if open
        const scoresModal = document.getElementById('scores-modal');
        if (window._currentScoresAssessmentId && scoresModal.style.display === 'flex') {
            openScoresModal(window._currentScoresAssessmentId);
        }
        console.log('[realtime] scores sync', DATA_MODELS.scores.length);
    }, err => console.error('[realtime] scores listener error', err));
    window.realtimeUnsubscribers.push(unsubScores);
}

// -----------------
// 📈 DASHBOARD
// -----------------

/**
 * Renders the dashboard overview cards.
 * This faculty-safe version does NOT query activityLogs.
 */
async function renderDashboard() {
    const totalStudentsEl = document.getElementById('total-students');
    if (totalStudentsEl) {
        totalStudentsEl.textContent = DATA_MODELS.students.length;
    }

    const availableSessions = DATA_MODELS.sessions.filter(s => s.status === 'Available');
    const classesHeldEl = document.getElementById('classes-held');
    if (classesHeldEl) {
        classesHeldEl.textContent = availableSessions.length;
    }

    // Calculate average attendance
    if (DATA_MODELS.students.length > 0 && availableSessions.length > 0) {
        let totalAttendance = 0;
        DATA_MODELS.students.forEach(student => {
            const presentCount = DATA_MODELS.attendance.filter(a =>
                (a.studentId === student.studentId) &&
                (a.status === 'Present' || a.status === 'Late')
            ).length;
            // Ensure attendance percentage is capped by number of sessions
            const percentage = Math.round((presentCount / availableSessions.length) * 100);
            totalAttendance += percentage;
        });

        const avgAttendance = Math.round(totalAttendance / DATA_MODELS.students.length);
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
function renderStudentsTable() {
    const tbody = document.querySelector('#students-table tbody');
    if (!tbody) return;

    const filterText = document.getElementById('student-search')?.value.toLowerCase() || '';
    const filteredStudents = DATA_MODELS.students.filter(student => {
        if (!filterText) return true;
        // Use escapeHtml to prevent XSS in the search functionality if it were displayed
        return student.firstName.toLowerCase().includes(filterText) ||
            student.lastName.toLowerCase().includes(filterText) ||
            student.studentId.toLowerCase().includes(filterText) ||
            (student.guardian && student.guardian.toLowerCase().includes(filterText));
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
    const student = DATA_MODELS.students.find(s => s.studentId === studentId);
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

    if (!date) return showError('Please select a date');

    if (DATA_MODELS.sessions.some(s => s.date === date)) {
        return showError('A session already exists for this date');
    }

    const session = {
        id: generateId(), // From common.js
        date, status, noClassReason,
        createdAt: new Date().toISOString(),
    };

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

            const attendanceObj = {
                sessionId, studentId, status,
                updatedAt: new Date().toISOString(),
                classId: classId, // Faculty uses their own class ID
            };
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
function renderAssessmentsTable() {
    const tbody = document.querySelector('#assessments-table tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    const sortedAssessments = [...DATA_MODELS.assessments].sort((a, b) => new Date(b.date) - new Date(a.date));

    if (sortedAssessments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5">No assessments created yet.</td></tr>';
        return;
    }

    sortedAssessments.forEach(assessment => {
        const scoredStudents = DATA_MODELS.scores.filter(score => score.assessmentId === assessment.id).length;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${escapeHtml(assessment.name)}</td>
            <td>${formatDate(assessment.date)}</td>
            <td>${escapeHtml(assessment.totalMarks)}</td>
            <td>${scoredStudents} of ${DATA_MODELS.students.length}</td>
            <td>
                <button class="btn btn-primary btn-sm record-scores" data-id="${escapeHtml(assessment.id)}">
                    <i class="fas fa-edit"></i> Record Scores
                </button>
                <button class="btn btn-danger btn-sm delete-assessment" data-id="${escapeHtml(assessment.id)}">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });

    // Add event listeners
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

    // Faculty role: classId comes from their own profile
    const classId = currentUserData.classId;

    if (!name || !date || isNaN(totalMarks) || totalMarks <= 0 || !classId) {
        return showError('Please fill in all required fields.');
    }

    const assessment = {
        id: generateId(),
        name, date, totalMarks, classId
    };

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
        toWrite.push({
            assessmentId, studentId, marks,
            updatedAt: new Date().toISOString(),
            classId: classId
        });
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
    populateDropdown('report-student', DATA_MODELS.students, s => s.studentId, s => `${s.firstName} ${s.lastName} (${s.studentId})`);
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

            const attendanceObj = {
                sessionId, studentId, status,
                updatedAt: new Date().toISOString(),
                classId: classId, // Faculty uses their own class ID
            };
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
        const promises = studentsToImport.map(student => {
            const studentRef = doc(window.db, 'students', String(student.studentId));
            return setDoc(studentRef, student);
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
    const allStudents = [...DATA_MODELS.students].sort((a, b) =>
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