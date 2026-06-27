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
    classes: [],
    earlyAngelEntries: [],
    earlyAngelLeaderboard: [],
    enrollments: [],
    classYearCounters: [],
    facultyClassAssignments: [],
    appConfig: { activeAcademicYearId: null },
    announcements: [],
    homework: [],
    homeworkSubmissions: []
};
window.DATA_MODELS = DATA_MODELS; // Expose for debugging

// Global variable to hold the unsubscribe functions for realtime listeners
window.realtimeUnsubscribers = [];

// Global var to hold user data after verification
let currentUserData = null;
let editingAcademicYearId = null;

// A1: Admin "My Class" default
let ADMIN_MY_CLASS_ID = null;

// A2: At-risk filter state
let showAtRiskOnly = false;

// A1: Current class filter in Students tab
let studentClassFilter = null;

// Students table sort state
let studentSort = { key: 'register', dir: 'asc' };

// B7: Attendance date filter state
let ATTENDANCE_DATE_FILTER = { from: null, to: null };

// B1: CSV import state
let CSV_PARSED_ROWS = [];

// Alias for currentUserData (used in shared feature code)
const CURRENT_USER_DATA = { get classId() { return currentUserData?.classId || null; } };

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

    // Populate sidebar user info
    const sidebarEmail = document.getElementById('sidebar-user-email');
    const sidebarRole = document.getElementById('sidebar-user-role');
    if (sidebarEmail) sidebarEmail.textContent = user.email;
    if (sidebarRole) sidebarRole.textContent = 'Administrator';

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

        // A1: Default assessment class dropdown to My Class
        if (ADMIN_MY_CLASS_ID) {
            const assessClassEl = document.getElementById('assessment-class-id');
            if (assessClassEl) {
                const hasOption = Array.from(assessClassEl.options).some(o => o.value === ADMIN_MY_CLASS_ID);
                if (hasOption) assessClassEl.value = ADMIN_MY_CLASS_ID;
            }
        }

        // Render analytics
        renderAdminAnalytics();
        renderClassesTable();
        renderUserRolesTable();
        renderAcademicYearControls();
        renderAdminEarlyAngelPortal();
        populateCertClassDropdown();
        populateYearPromotionDropdowns();

        // B8: Start announcements realtime listener
        startAnnouncementsListener();

        // C3: Start homework realtime listener
        startAdminHomeworkListener();

        // Activity log realtime listener (started via startRealtimeListeners, but call here as safety)
        startActivityLogListener();

        // A1: Set default report class filter to My Class
        if (ADMIN_MY_CLASS_ID) {
            const reportClassFilter = document.getElementById('report-class-filter');
            if (reportClassFilter) {
                const hasOption = Array.from(reportClassFilter.options).some(o => o.value === ADMIN_MY_CLASS_ID);
                if (hasOption) {
                    reportClassFilter.value = ADMIN_MY_CLASS_ID;
                    updateReportDropdown();
                }
            }
        }
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
    document.getElementById('sidebar-logout-btn')?.addEventListener('click', logout);
    document.getElementById('edit-profile-btn')?.addEventListener('click', openAdminProfileEditor);
    document.getElementById('save-admin-profile-btn')?.addEventListener('click', saveAdminProfileEdits);
    document.getElementById('cancel-admin-profile-edit-btn')?.addEventListener('click', closeAdminProfileEditor);
    document.getElementById('close-admin-profile-modal-btn')?.addEventListener('click', closeAdminProfileEditor);
    document.getElementById('profile-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = document.getElementById('profile-menu');
        const isOpen = menu.style.display === 'block';
        menu.style.display = isOpen ? 'none' : 'block';
    });
    document.addEventListener('click', (e) => {
        const menu = document.getElementById('profile-menu');
        const btn = document.getElementById('profile-btn');
        if (menu && menu.style.display === 'block' && btn && !btn.contains(e.target) && !menu.contains(e.target)) {
            menu.style.display = 'none';
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

    // Class dropdown → auto-fill register number
    document.getElementById('student-class-id')?.addEventListener('change', function () {
        const classId = this.value;
        if (!classId) {
            document.getElementById('student-register-no').value = '';
            document.getElementById('student-register-no').placeholder = 'Select class first...';
        } else {
            prefillNextRegisterNo(classId);
        }
    });

    // "Change class" override — warn before unlocking the class dropdown
    document.getElementById('student-class-change-btn')?.addEventListener('click', async () => {
        const result = await showConfirm(
            'Add to a different class?',
            'This student will be added to a class other than your own. Are you sure you want to change the class?'
        );
        if (result.isConfirmed) unlockStudentClass();
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

    // Students table column sorting
    document.querySelectorAll('#students-table thead th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.sort;
            if (studentSort.key === key) {
                studentSort.dir = studentSort.dir === 'asc' ? 'desc' : 'asc';
            } else {
                studentSort.key = key;
                studentSort.dir = 'asc';
            }
            renderStudentsTable();
        });
    });

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

    // Attendance scope toggle (My Class / All Students)
    document.getElementById('attendance-scope-toggle')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.att-scope-btn');
        if (!btn) return;
        document.querySelectorAll('.att-scope-btn').forEach(b => {
            b.classList.toggle('active', b === btn);
            b.classList.toggle('btn-primary', b === btn);
            b.classList.toggle('btn-secondary', b !== btn);
        });
        const sessionId = document.getElementById('session-date')?.value;
        if (sessionId) renderAttendanceForm(sessionId);
    });

    // Attendance report buttons
    document.getElementById('generate-overall-report-btn')?.addEventListener('click', generateOverallAttendanceReport);
    document.getElementById('report-session-date')?.addEventListener('change', generateDaywiseAttendanceReport);
    document.getElementById('print-daywise-report-btn')?.addEventListener('click', () => {
        printReport('daywise-report-container', 'Day-wise Attendance Report'); // From common.js
    });
    document.getElementById('download-daywise-report-btn')?.addEventListener('click', () => {
        downloadContainerAsPDF('daywise-report-container', 'Daywise_Attendance_Report.pdf');
    });
    document.getElementById('download-overall-report-btn')?.addEventListener('click', () => {
        downloadContainerAsPDF('overall-report-container', 'Overall_Attendance_Report.pdf');
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
    // A2: At-risk filter toggle
    document.getElementById('show-at-risk-btn')?.addEventListener('click', () => {
        showAtRiskOnly = !showAtRiskOnly;
        renderStudentsTable();
    });

    // A6: Transfer modal wiring
    document.getElementById('confirm-transfer-btn')?.addEventListener('click', confirmStudentTransfer);
    document.getElementById('cancel-transfer-btn')?.addEventListener('click', () => {
        document.getElementById('transfer-modal').style.display = 'none';
    });
    document.getElementById('close-transfer-modal-btn')?.addEventListener('click', () => {
        document.getElementById('transfer-modal').style.display = 'none';
    });

    // A7: Refresh class performance table
    document.getElementById('refresh-class-perf-btn')?.addEventListener('click', renderClassPerformanceTable);

    // B8: Announcements
    document.getElementById('new-announcement-btn')?.addEventListener('click', () => {
        document.getElementById('announcement-id').value = '';
        document.getElementById('announcement-title').value = '';
        document.getElementById('announcement-body').value = '';
        document.getElementById('announcement-audience').value = 'all';
        document.getElementById('announcement-expires').value = '';
        document.getElementById('announcement-pinned').checked = false;
        document.getElementById('announcement-form-title').textContent = 'New Announcement';
        document.getElementById('announcements-form-section').style.display = 'block';
    });
    document.getElementById('save-announcement-btn')?.addEventListener('click', saveAnnouncement);
    document.getElementById('cancel-announcement-btn')?.addEventListener('click', () => {
        document.getElementById('announcements-form-section').style.display = 'none';
    });

    // System Restore
    document.getElementById('btn-restore-system')?.addEventListener('click', restoreSystemFromBackup);

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

    // C1: Certificate Generator
    document.getElementById('generate-certs-btn')?.addEventListener('click', generateCertificates);

    // Today's Attendance Report (PDF)
    const todaysAttDate = document.getElementById('todays-att-date');
    if (todaysAttDate && !todaysAttDate.value) todaysAttDate.value = new Date().toISOString().slice(0, 10);
    document.getElementById('download-todays-attendance-btn')?.addEventListener('click', downloadTodaysAttendance);

    // C3: Homework submissions modal
    document.getElementById('close-hw-submissions-btn')?.addEventListener('click', () => { document.getElementById('hw-submissions-modal').style.display = 'none'; });
    document.getElementById('close-hw-submissions-modal-btn')?.addEventListener('click', () => { document.getElementById('hw-submissions-modal').style.display = 'none'; });

    // Admin homework (my-class assignments)
    document.getElementById('add-homework-btn')?.addEventListener('click', openAdminHomeworkForm);
    document.getElementById('save-homework-btn')?.addEventListener('click', saveAdminHomework);
    document.getElementById('cancel-homework-btn')?.addEventListener('click', () => {
        document.getElementById('homework-form-container').style.display = 'none';
        document.getElementById('hw-editing-id').value = '';
    });
    document.getElementById('my-hw-tbody')?.addEventListener('click', e => {
        const editBtn = e.target.closest('.admin-hw-edit-btn');
        const delBtn = e.target.closest('.admin-hw-delete-btn');
        if (editBtn) editAdminHomework(editBtn.dataset.hwId);
        if (delBtn) deleteAdminHomework(delBtn.dataset.hwId);
    });

    // Year Promotion
    document.getElementById('promo-preview-btn')?.addEventListener('click', previewYearPromotion);
    document.getElementById('promo-run-btn')?.addEventListener('click', runYearPromotion);
    document.getElementById('promo-fix-regnos-btn')?.addEventListener('click', fixRegisterNumbers);

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

    // Update topbar title
    const tabTitles = { dashboard: 'Dashboard', students: 'Students', attendance: 'Attendance', assessments: 'Assessments', reports: 'Reports', 'admin-panel': 'Admin Tools', homework: 'Homework' };
    const topbarTitle = document.getElementById('topbar-title');
    if (topbarTitle) topbarTitle.textContent = tabTitles[targetTab] || targetTab;

    // Sync sidebar link active state
    document.querySelectorAll('.sidebar-link[data-tab]').forEach(sl => sl.classList.toggle('active', sl.getAttribute('data-tab') === targetTab));

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
        renderAdminHomeworkTable();
    }
    if (targetTab === 'dashboard') {
        renderDashboard();
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
            populateYearPromotionDropdowns();
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
        document.getElementById('student-register-no').value = '';
        document.getElementById('student-register-no').placeholder = 'Select class first...';
        prefillNextStudentId();
        applyStudentClassLock(); // lock class to admin's own class (with change override)
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
    // Reset one-time listener guards so they restart correctly on year switch
    _announcementsListenerActive = false;
    _adminHomeworkListenerActive = false;
    _adminActivityLogListenerActive = false;
}

// Debounced renderDashboard — batches rapid multi-listener fires into one render
let _renderDashboardTimer = null;
function _debouncedRenderDashboard() {
    if (_renderDashboardTimer) clearTimeout(_renderDashboardTimer);
    _renderDashboardTimer = setTimeout(() => renderDashboard(), 250);
}

let _adminActivityLogListenerActive = false;
function startActivityLogListener() {
    if (_adminActivityLogListenerActive) return;
    if (!window.db || !window.onSnapshot) return;
    _adminActivityLogListenerActive = true;
    const { onSnapshot, collection, query, orderBy, limit } = window;
    const q = query(collection(window.db, 'activityLogs'), orderBy('createdAt', 'desc'), limit(10));
    const unsub = onSnapshot(q, snap => {
        const activityContainer = document.getElementById('recent-activity');
        if (!activityContainer) return;
        if (snap.empty) {
            activityContainer.innerHTML = '<p>No recent activity.</p>';
            return;
        }
        let html = '<ul class="activity-log-list">';
        snap.forEach(docSnap => {
            const log = docSnap.data();
            let text = `<b>${escapeHtml(log.action)}</b> by ${escapeHtml(log.userEmail || 'system')}`;
            if (log.details?.name) text += ` (Name: ${escapeHtml(log.details.name)})`;
            else if (log.details?.studentId) text += ` (ID: ${escapeHtml(log.details.studentId)})`;
            else if (log.details?.date) text += ` (Date: ${escapeHtml(log.details.date)})`;
            const ts = log.createdAt ? formatDateTime(new Date(log.createdAt)) : '';
            html += `<li>${text}${ts ? ` <small>(${ts})</small>` : ''}</li>`;
        });
        html += '</ul>';
        activityContainer.innerHTML = html;
    }, err => {
        _adminActivityLogListenerActive = false;
        console.warn('[realtime] activityLog listener error:', err);
    });
    window.realtimeUnsubscribers.push(unsub);
}

/**
 * Starts all realtime listeners. ADMIN version (no scoping).
 */
function startRealtimeListeners() {
    if (!window.db || !window.onSnapshot || !window.collection) {
        return handleAppError('[realtime] Firestore realtime not available.');
    }

    const { db, onSnapshot, collection, query, where } = window;

    stopRealtimeListeners();
    console.log('[realtime] Starting listeners for ADMIN (all data)');

    // Year-scoped query: fetch ONLY the active academic year's rows from the server.
    // This both enforces "stick to the active year" and avoids the PostgREST 1000-row
    // cap silently dropping current-year rows behind thousands of old-year rows.
    const activeYearId = getActiveAcademicYearId() || DATA_MODELS.appConfig?.activeAcademicYearId || null;
    const yearScopedQuery = (name) => activeYearId
        ? query(collection(db, name), where('academicYearId', '==', activeYearId))
        : collection(db, name);

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
        _debouncedRenderDashboard();
        console.log('[realtime] students sync', DATA_MODELS.students.length);
    }, err => console.error('[realtime] students listener error', err));
    window.realtimeUnsubscribers.push(unsubStudents);

    // SESSIONS Listener (active year only)
    const sessionsQuery = yearScopedQuery('sessions');
    const unsubSessions = onSnapshot(sessionsQuery, snapshot => {
        DATA_MODELS.sessions = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (isCurrentAcademicYear(data)) DATA_MODELS.sessions.push(data);
        });
        renderSessionsTable();
        renderAttendanceForm(document.getElementById('session-date')?.value || '');
        _debouncedRenderDashboard();
        console.log('[realtime] sessions sync', DATA_MODELS.sessions.length);
    }, err => console.error('[realtime] sessions listener error', err));
    window.realtimeUnsubscribers.push(unsubSessions);

    // ASSESSMENTS Listener (active year only)
    const assessmentsQuery = yearScopedQuery('assessments');
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

    // ATTENDANCE Listener (active year only)
    const attendanceQuery = yearScopedQuery('attendance');
    const unsubAttendance = onSnapshot(attendanceQuery, snapshot => {
        DATA_MODELS.attendance = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (isCurrentAcademicYear(data)) DATA_MODELS.attendance.push(data);
        });
        const currentSession = document.getElementById('session-date')?.value;
        if (currentSession) renderAttendanceForm(currentSession);
        _debouncedRenderDashboard();
        console.log('[realtime] attendance sync', DATA_MODELS.attendance.length);
    }, err => console.error('[realtime] attendance listener error', err));
    window.realtimeUnsubscribers.push(unsubAttendance);

    // SCORES Listener (active year only)
    const scoresQuery = yearScopedQuery('scores');
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
        _debouncedRenderDashboard();
        console.log('[realtime] scores sync', DATA_MODELS.scores.length);
    }, err => console.error('[realtime] scores listener error', err));
    window.realtimeUnsubscribers.push(unsubScores);

    // EARLY ANGEL ENTRIES Listener (active year only)
    const earlyAngelEntriesQuery = yearScopedQuery('earlyAngelEntries');
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

    // EARLY ANGEL LEADERBOARD Listener (active year only)
    const earlyAngelLeaderboardQuery = yearScopedQuery('earlyAngelLeaderboard');
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

    // ACADEMIC YEARS Listener
    const academicYearsQuery = collection(db, 'academicYears');
    const unsubAcademicYears = onSnapshot(academicYearsQuery, snapshot => {
        DATA_MODELS.academicYears = [];
        snapshot.forEach(doc => {
            DATA_MODELS.academicYears.push({ id: doc.id, ...doc.data() });
        });
        DATA_MODELS.academicYears.sort((a, b) => String(b.id || '').localeCompare(String(a.id || '')));
        renderAcademicYearControls();
        populateYearPromotionDropdowns();
        _debouncedRenderDashboard();
        console.log('[realtime] academicYears sync', DATA_MODELS.academicYears.length);
    }, err => console.error('[realtime] academicYears listener error', err));
    window.realtimeUnsubscribers.push(unsubAcademicYears);

    // ENROLLMENTS Listener (active year only)
    const enrollmentsQuery = yearScopedQuery('enrollments');
    const unsubEnrollments = onSnapshot(enrollmentsQuery, snapshot => {
        DATA_MODELS.enrollments = [];
        snapshot.forEach(doc => {
            const data = { id: doc.id, ...doc.data() };
            if (isCurrentAcademicYear(data)) DATA_MODELS.enrollments.push(data);
        });
        _debouncedRenderDashboard();
        console.log('[realtime] enrollments sync', DATA_MODELS.enrollments.length);
    }, err => console.error('[realtime] enrollments listener error', err));
    window.realtimeUnsubscribers.push(unsubEnrollments);

    // CLASSES Listener
    const unsubClasses = onSnapshot(collection(db, 'classes'), snapshot => {
        DATA_MODELS.classes = [];
        snapshot.forEach(d => DATA_MODELS.classes.push({ id: d.id, ...d.data() }));
        DATA_MODELS.classes.sort((a, b) => String(a.id || '').localeCompare(String(b.id || ''), undefined, { numeric: true }));
        renderClassesTable();
        populateClassDropdowns('user-class-id-select');
        populateClassDropdowns('student-class-id');
        populateClassDropdowns('assessment-class-id');
        populateClassDropdowns('report-class-filter');
        populateClassDropdowns('analytics-class-filter');
        populateCertClassDropdown();
        populateYearPromotionDropdowns();
        _debouncedRenderDashboard();
        console.log('[realtime] classes sync', DATA_MODELS.classes.length);
    }, err => console.error('[realtime] classes listener error', err));
    window.realtimeUnsubscribers.push(unsubClasses);

    // USER ROLES Listener
    const unsubUserRoles = onSnapshot(collection(db, 'userRoles'), snapshot => {
        DATA_MODELS.userRoles = [];
        snapshot.forEach(d => DATA_MODELS.userRoles.push({ id: d.id, uid: d.id, ...d.data() }));
        renderUserRolesTable();
        console.log('[realtime] userRoles sync', DATA_MODELS.userRoles.length);
    }, err => console.error('[realtime] userRoles listener error', err));
    window.realtimeUnsubscribers.push(unsubUserRoles);

    // APP CONFIG Listener
    const { doc: firestoreDoc } = window;
    const unsubAppConfig = onSnapshot(firestoreDoc(db, 'appConfig', 'global'), docSnap => {
        DATA_MODELS.appConfig = docSnap.exists()
            ? { id: 'global', ...docSnap.data() }
            : { id: 'global', activeAcademicYearId: null };
        setActiveAcademicYearContext(DATA_MODELS.appConfig.activeAcademicYearId || null);
        if (typeof loadAcademicYearContext === 'function') loadAcademicYearContext(false);
        renderAcademicYearControls();
        _debouncedRenderDashboard();
        console.log('[realtime] appConfig sync', DATA_MODELS.appConfig.activeAcademicYearId);
    }, err => console.error('[realtime] appConfig listener error', err));
    window.realtimeUnsubscribers.push(unsubAppConfig);

    // ACTIVITY LOG Listener (top-10 most recent)
    startActivityLogListener();
}

// -----------------
// 📈 DASHBOARD
// -----------------
function renderDashboard() {
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

    const availableSessions = DATA_MODELS.sessions.filter(s => s.status === 'Available' && isCurrentAcademicYear(s));
    const classesHeldEl = document.getElementById('classes-held');
    if (classesHeldEl) classesHeldEl.textContent = availableSessions.length;

    const activeYearAttendance = DATA_MODELS.attendance.filter(a => isCurrentAcademicYear(a));

    if (currentRoster.length > 0 && availableSessions.length > 0) {
        let totalAttendance = 0;
        currentRoster.forEach(student => {
            const presentCount = activeYearAttendance.filter(a => (a.studentId === student.studentId) && (a.status === 'Present' || a.status === 'Late')).length;
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

    // A1: My Class label
    const myClassEl = document.getElementById('my-class-label');
    if (myClassEl) myClassEl.textContent = ADMIN_MY_CLASS_ID || '—';

    // A2: Below-75 count (availableSessions already defined above)
    const below75El = document.getElementById('below-75-count');
    if (below75El) {
        const atRiskCount = currentRoster.filter(student => {
            const pct = calcStudentAttendancePct(student.studentId, availableSessions, activeYearAttendance);
            return pct !== null && pct < 75;
        }).length;
        below75El.textContent = atRiskCount;
    }

    // A7: Class performance table
    renderClassPerformanceTable();

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
        });

        const batch = window.writeBatch(window.db);

        const entryRef = doc(collection(window.db, 'earlyAngelEntries'));
        batch.set(entryRef, entryPayload);

        const summaryDocId = `${activeYearId}_${classId}_${entryDate}_${studentId}`;
        batch.set(doc(window.db, 'earlyAngelDailySummary', summaryDocId), withAcademicYear({
            classId,
            summaryDate: entryDate,
            studentId,
            studentName,
            pointsTotal: window.increment(points),
            entryCount: window.increment(1),
            lastUpdatedAt: nowIso,
        }), { merge: true });

        const leaderboardDocId = `${activeYearId}_${classId}_${studentId}`;
        batch.set(doc(window.db, 'earlyAngelLeaderboard', leaderboardDocId), withAcademicYear({
            classId,
            studentId,
            studentName,
            totalPoints: window.increment(points),
            entryCount: window.increment(1),
            lastEntryDate: entryDate,
            lastUpdatedAt: nowIso,
        }), { merge: true });

        await batch.commit();

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

    // A1: Render class filter bar
    const filterBar = document.getElementById('student-class-filter-bar');
    if (filterBar) {
        const allClasses = [...new Set(
            getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
                .map(s => s.classId).filter(Boolean)
        )].sort();
        let barHtml = `<button class="btn btn-sm ${!studentClassFilter ? 'btn-primary active' : 'btn-outline'}" data-class-filter="">All</button>`;
        if (ADMIN_MY_CLASS_ID) {
            barHtml += `<button class="btn btn-sm ${studentClassFilter === ADMIN_MY_CLASS_ID ? 'btn-primary active' : 'btn-outline'}" data-class-filter="${escapeHtml(ADMIN_MY_CLASS_ID)}">My Class (${escapeHtml(ADMIN_MY_CLASS_ID)})</button>`;
        }
        allClasses.forEach(cls => {
            if (cls !== ADMIN_MY_CLASS_ID) {
                barHtml += `<button class="btn btn-sm ${studentClassFilter === cls ? 'btn-primary active' : 'btn-outline'}" data-class-filter="${escapeHtml(cls)}">${escapeHtml(cls)}</button>`;
            }
        });
        filterBar.innerHTML = barHtml;
        filterBar.querySelectorAll('[data-class-filter]').forEach(btn => {
            btn.addEventListener('click', () => {
                studentClassFilter = btn.dataset.classFilter || null;
                renderStudentsTable();
            });
        });
    }

    const filterText = document.getElementById('student-search')?.value.toLowerCase() || '';
    const availableSessions = DATA_MODELS.sessions.filter(s => s.status === 'Available' && isCurrentAcademicYear(s));
    const activeYearAttendance = (DATA_MODELS.attendance || []).filter(a => isCurrentAcademicYear(a));
    let rosterStudents = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || []);

    // A1: Apply class filter
    if (studentClassFilter) {
        rosterStudents = rosterStudents.filter(s => String(s.classId || '') === studentClassFilter);
    }

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
            const pct = calcStudentAttendancePct(student.studentId, availableSessions, activeYearAttendance);
            return pct !== null && pct < 75;
        });
        const btn = document.getElementById('show-at-risk-btn');
        if (btn) btn.classList.add('btn-danger');
    } else {
        const btn = document.getElementById('show-at-risk-btn');
        if (btn) btn.classList.remove('btn-danger');
    }

    // Sort by the selected column
    const sortDir = studentSort.dir === 'desc' ? -1 : 1;
    filteredStudents.sort((a, b) => {
        switch (studentSort.key) {
            case 'name': {
                const an = `${a.firstName || ''} ${a.lastName || ''}`.trim().toLowerCase();
                const bn = `${b.firstName || ''} ${b.lastName || ''}`.trim().toLowerCase();
                return an.localeCompare(bn) * sortDir;
            }
            case 'guardian':
                return String(a.guardian || '').toLowerCase()
                    .localeCompare(String(b.guardian || '').toLowerCase()) * sortDir;
            case 'class':
                return String(a.classId || '').toLowerCase()
                    .localeCompare(String(b.classId || '').toLowerCase(), undefined, { numeric: true }) * sortDir;
            case 'register':
            default: {
                const ar = Number(a.registerNo ?? a.studentId) || 0;
                const br = Number(b.registerNo ?? b.studentId) || 0;
                return (ar - br) * sortDir;
            }
        }
    });

    // Reflect the active sort in the column headers
    document.querySelectorAll('#students-table thead th.sortable').forEach(th => {
        const ind = th.querySelector('.sort-ind');
        if (ind) ind.textContent = th.dataset.sort === studentSort.key
            ? (studentSort.dir === 'desc' ? '▼' : '▲') : '';
    });

    tbody.innerHTML = '';
    if (filteredStudents.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6">No students found.</td></tr>';
        return;
    }

    filteredStudents.forEach(student => {
        // A2: Attendance badge
        const pct = calcStudentAttendancePct(student.studentId, availableSessions, activeYearAttendance);
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
                <button class="btn btn-secondary btn-sm transfer-student-btn" data-id="${escapeHtml(student.studentId)}" title="Transfer to another class">
                    <i class="fas fa-exchange-alt"></i>
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
    tbody.querySelectorAll('.transfer-student-btn').forEach(btn => {
        btn.addEventListener('click', (e) => openTransferModal(e.currentTarget.dataset.id));
    });
}

function getNextSequentialStudentId() {
    // Find the highest numeric studentId across all students (UUID-format IDs are skipped)
    const allStudents = DATA_MODELS.students || [];
    let maxNum = 0;
    for (const s of allStudents) {
        const n = parseInt(s.studentId, 10);
        if (!Number.isNaN(n) && String(n) === String(s.studentId) && n > maxNum) {
            maxNum = n;
        }
    }
    return maxNum + 1;
}

function claimNextStudentId() {
    return String(getNextSequentialStudentId());
}

function prefillNextStudentId() {
    const el = document.getElementById('student-seq-id');
    if (!el) return;
    el.value = String(getNextSequentialStudentId());
}

// Lock the class dropdown to the admin's own class when adding a new student.
// A "Change class" button lets them override after confirming a warning.
function applyStudentClassLock() {
    const select = document.getElementById('student-class-id');
    const changeBtn = document.getElementById('student-class-change-btn');
    const hint = document.getElementById('student-class-lock-hint');
    if (!select) return;

    const myClass = ADMIN_MY_CLASS_ID || currentUserData?.classId || '';
    if (!myClass) {
        // No fixed class for this admin — leave the dropdown free.
        select.disabled = false;
        if (changeBtn) changeBtn.style.display = 'none';
        if (hint) hint.style.display = 'none';
        return;
    }

    select.value = myClass;
    select.disabled = true;
    if (hint) hint.style.display = 'block';
    if (changeBtn) changeBtn.style.display = 'inline';
    // Fill register number for the locked class.
    prefillNextRegisterNo(myClass);
}

function unlockStudentClass() {
    const select = document.getElementById('student-class-id');
    const changeBtn = document.getElementById('student-class-change-btn');
    const hint = document.getElementById('student-class-lock-hint');
    if (select) select.disabled = false;
    if (changeBtn) changeBtn.style.display = 'none';
    if (hint) hint.style.display = 'none';
}

function prefillNextRegisterNo(classId) {
    const el = document.getElementById('student-register-no');
    if (!el || !classId) return;

    const activeYear = getActiveAcademicYearId();
    if (!activeYear) { el.value = ''; el.placeholder = 'No active year'; return; }

    const classNum = window.getClassNumber ? window.getClassNumber(classId) : null;

    // Derive the next register number from the ACTUAL active-year enrollments in this
    // class (the source of truth) rather than a separate monotonic counter. This means
    // deleting the highest-numbered student frees that number for reuse, and the preview
    // always reflects what is really in the database.
    let maxSeq = 0;
    for (const e of (DATA_MODELS.enrollments || [])) {
        if (String(e.classId) !== String(classId)) continue;
        if (e.academicYearId !== activeYear) continue;
        if (e.registerNo == null) continue;
        const reg = Number(e.registerNo);
        if (Number.isNaN(reg)) continue;
        const seq = classNum != null ? reg - classNum * 100 : reg;
        if (seq > maxSeq) maxSeq = seq;
    }
    const nextSeq = maxSeq + 1;
    const registerNo = classNum != null
        ? parseInt(`${classNum}${String(nextSeq).padStart(2, '0')}`, 10)
        : nextSeq;
    el.value = String(registerNo);
}

async function saveStudent() {
    showSpinner();
    try {
        const existingStudentId = document.getElementById('student-id').value; // non-empty = edit
        let studentId;
        if (existingStudentId) {
            studentId = existingStudentId;
        } else {
            studentId = claimNextStudentId();
        }
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

        // Admin version: classId comes from the dropdown (now optional)
        const classId = document.getElementById('student-class-id').value || null;

        if (!firstName) {
            throw new Error('Please enter the student\'s name.');
        }

        const prefillRegNo = parseInt(document.getElementById('student-register-no')?.value || '', 10);

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
            ...(prefillRegNo && !existingStudentId ? { _hintRegisterNo: prefillRegNo } : {}),
        };

        const { doc, setDoc } = window;
        const studentRef = doc(window.db, 'students', String(student.studentId));
        // _hintRegisterNo is a UI-only hint for enrollment — never persist it to the students table.
        const studentToSave = { ...student };
        delete studentToSave._hintRegisterNo;
        await setDoc(studentRef, studentToSave, { merge: true });
        const savedEnrollment = await upsertEnrollmentForStudent(student, currentUserData?.uid || 'admin');

        // Update the local cache immediately so the table/dashboard reflect the change
        // without a page reload (realtime updates may be delayed or disabled).
        const sIdx = (DATA_MODELS.students || []).findIndex(s => String(s.studentId) === String(studentToSave.studentId));
        if (sIdx >= 0) DATA_MODELS.students[sIdx] = { ...DATA_MODELS.students[sIdx], ...studentToSave };
        else DATA_MODELS.students.push({ ...studentToSave });
        DATA_MODELS.students.sort((a, b) =>
            String(a.studentId).localeCompare(String(b.studentId), undefined, { numeric: true })
        );
        if (savedEnrollment && savedEnrollment.id) {
            const eIdx = (DATA_MODELS.enrollments || []).findIndex(e => String(e.id) === String(savedEnrollment.id));
            if (eIdx >= 0) DATA_MODELS.enrollments[eIdx] = { ...DATA_MODELS.enrollments[eIdx], ...savedEnrollment };
            else DATA_MODELS.enrollments.push({ ...savedEnrollment });
        }
        renderStudentsTable();
        _debouncedRenderDashboard();

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
        // Show read-only ID and register number
        const seqIdEl = document.getElementById('student-seq-id');
        if (seqIdEl) seqIdEl.value = student.studentId || '';
        const regNoEl = document.getElementById('student-register-no');
        if (regNoEl) { regNoEl.value = student.registerNo != null ? String(student.registerNo) : ''; }
        document.getElementById('student-first-name').value = student.firstName;
        document.getElementById('student-last-name').value = student.lastName;
        document.getElementById('student-dob').value = student.dob || '';
        document.getElementById('student-guardian').value = student.guardian;
        document.getElementById('student-phone').value = student.phone || '';
        document.getElementById('student-email').value = student.email || '';
        unlockStudentClass(); // editing: class is freely editable
        document.getElementById('student-class-id').value = student.classId || ''; // Admin can edit class
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
            const { doc, deleteDoc, getDocs, query, collection, where, writeBatch } = window;
            // Delete master profile
            await deleteDoc(doc(window.db, 'students', String(studentId)));
            // Delete all enrollment records for this student
            const enrollSnap = await getDocs(query(collection(window.db, 'enrollments'), where('studentId', '==', String(studentId))));
            if (!enrollSnap.empty) {
                const batch = writeBatch(window.db);
                enrollSnap.docs.forEach(d => batch.delete(d.ref));
                await batch.commit();
            }

            // Update the local cache immediately (realtime may be delayed/disabled) so the
            // table refreshes and the next auto-assigned Student ID reflects the deletion.
            DATA_MODELS.students = (DATA_MODELS.students || []).filter(s => String(s.studentId) !== String(studentId));
            DATA_MODELS.enrollments = (DATA_MODELS.enrollments || []).filter(e => String(e.studentId) !== String(studentId));
            renderStudentsTable();
            _debouncedRenderDashboard();

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
        <p><strong>DOB:</strong> ${student.dob ? formatDate(student.dob) : 'N/A'}</p>
        <p><strong>Guardian:</strong> ${escapeHtml(student.guardian)}</p>
        <p><strong>Contact:</strong> ${escapeHtml(student.phone || 'N/A')}</p>
        <p><strong>Email:</strong> ${escapeHtml(student.email || 'N/A')}</p>
        <p><strong>Class:</strong> ${escapeHtml(student.classId || 'N/A')}</p>
        <p><strong>Anbiyam:</strong> ${escapeHtml(student.anbiyamName || 'N/A')}</p>
        <p><strong>First Holy Communion:</strong> ${student.receivedFirstCommunion === true ? 'Received' : 'Not yet'}</p>
        <p><strong>Confirmation:</strong> ${student.receivedConfirmation === true ? 'Received' : 'Not yet'}</p>
        <p><strong>Notes:</strong> ${escapeHtml(student.notes || 'None')}</p>
        <hr style="margin:10px 0;">
        <p><strong>Behavior Note:</strong> ${behaviorNote}</p>
        <p><strong>Behavior Visibility:</strong> ${behaviorVis}</p>
        ${familyHtml}`;
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
    if (DATA_MODELS.sessions.some(s => s.id === sessionId || (s.sessionDate || s.date) === date)) {
        return showError('A session already exists for this date');
    }

    const session = withAcademicYear({
        id: sessionId, sessionDate: date, status, noClassReason,
        createdAt: new Date().toISOString(),
    });

    showSpinner();
    try {
        const { doc, setDoc } = window;
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
function getAttendanceScope() {
    return document.querySelector('.att-scope-btn.active')?.dataset.scope || 'class';
}

function renderAttendanceForm(sessionId) {
    const session = DATA_MODELS.sessions.find(s => s.id === sessionId);
    const container = document.getElementById('attendance-form-container');
    if (!container) return;

    if (!session) {
        container.innerHTML = '<p>Please select a session to take attendance.</p>';
        return;
    }

    const scope = getAttendanceScope();
    const adminClassId = currentUserData?.classId || null;

    // Build roster
    let rosterStudents = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || []);
    if (rosterStudents.length < DATA_MODELS.students.length) {
        const rosterIds = new Set(rosterStudents.map(s => String(s.studentId)));
        const extras = DATA_MODELS.students.filter(s => !rosterIds.has(String(s.studentId)));
        rosterStudents = [...rosterStudents, ...extras];
    }

    // Filter by scope
    if (scope === 'class' && adminClassId) {
        rosterStudents = rosterStudents.filter(s => String(s.classId) === String(adminClassId));
    }

    const sortedStudents = rosterStudents.sort((a, b) =>
        String(a.studentId).localeCompare(String(b.studentId), undefined, { numeric: true })
    );

    const scopeLabel = scope === 'class' && adminClassId
        ? ` — ${DATA_MODELS.classes?.find(c => c.id === adminClassId)?.name || adminClassId}`
        : ' — All Students';

    let html = `<h3>Take Attendance for ${formatDate(session.date)}${scopeLabel}</h3>
        <div class="form-group">
            <label>Set Status for All:</label>
            <div class="btn-group">
                <button class="btn btn-success btn-sm" onclick="setAllStatus('Present')">All Present</button>
                <button class="btn btn-danger btn-sm" onclick="setAllStatus('Absent')">All Absent</button>
                <button class="btn btn-warning btn-sm" onclick="setAllStatus('Late')">All Late</button>
                <button class="btn btn-secondary btn-sm" onclick="setAllStatus('Excused')">All Excused</button>
            </div>
        </div>`;

    if (sortedStudents.length === 0) {
        html += `<p style="color:var(--text-color-light);">No students found for this scope.</p>`;
    } else {
        html += `<table class="data-table">
            <thead>
                <tr>
                    <th>Reg No</th>
                    <th>Student Name</th>
                    ${scope === 'all' ? '<th>Class</th>' : ''}
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>`;

        sortedStudents.forEach(student => {
            const existing = DATA_MODELS.attendance.find(a => a.sessionId === sessionId && a.studentId === student.studentId);
            const status = existing ? existing.status : 'Present';
            const className = scope === 'all'
                ? (DATA_MODELS.classes?.find(c => c.id === student.classId)?.name || student.classId || '—')
                : null;
            html += `
                <tr>
                    <td>${escapeHtml(String(student.registerNo ?? student.studentId))}</td>
                    <td>${escapeHtml(student.firstName)} ${escapeHtml(student.lastName)}</td>
                    ${scope === 'all' ? `<td>${escapeHtml(className)}</td>` : ''}
                    <td>
                        <select class="attendance-status" data-student="${escapeHtml(student.studentId)}" data-class="${escapeHtml(student.classId || '')}">
                            <option value="Present" ${status === 'Present' ? 'selected' : ''}>Present</option>
                            <option value="Absent" ${status === 'Absent' ? 'selected' : ''}>Absent</option>
                            <option value="Late" ${status === 'Late' ? 'selected' : ''}>Late</option>
                            <option value="Excused" ${status === 'Excused' ? 'selected' : ''}>Excused</option>
                        </select>
                    </td>
                </tr>`;
        });
        html += `</tbody></table>`;
    }

    html += `<button class="btn btn-primary" style="margin-top:12px;" onclick="saveAttendance('${escapeHtml(sessionId)}')">Save Attendance</button>`;
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

    const activeYearId = getActiveAcademicYearId();
    if (!activeYearId) return showError('No active academic year found. Cannot save attendance.');

    // Build a reliable classId lookup: enrollment for active year wins, fall back to student master
    const enrollmentClassMap = new Map();
    for (const en of (DATA_MODELS.enrollments || [])) {
        if (en.academicYearId === activeYearId) {
            enrollmentClassMap.set(String(en.studentId), String(en.classId || ''));
        }
    }

    showSpinner();
    try {
        const { doc, setDoc } = window;
        const records = []; // { obj, docId } parallel to promises
        const promises = [];
        const skipped = [];

        for (const select of inputs) {
            const studentId = select.dataset.student;
            if (!studentId) continue;

            const status = select.value;

            // Prefer enrollment classId, then dataset.class, then student master
            let classId = enrollmentClassMap.get(String(studentId))
                || select.dataset.class
                || DATA_MODELS.students.find(s => String(s.studentId) === String(studentId))?.classId
                || '';

            if (!classId) {
                skipped.push(studentId);
                continue;
            }

            const docId = `${sessionId}_${studentId}`;
            const attendanceObj = {
                id: docId,
                sessionId, studentId, status, classId,
                academicYearId: activeYearId,
                updatedAt: new Date().toISOString(),
            };
            const docRef = doc(window.db, 'attendance', docId);
            records.push({ obj: attendanceObj, docId });
            promises.push(setDoc(docRef, attendanceObj, { merge: true }));
        }

        const results = await Promise.allSettled(promises);
        const failed = results.filter(r => r.status === 'rejected');
        const saved = results.length - failed.length;

        // Update the local cache for every successful save so the views reflect
        // reality immediately (realtime updates may be delayed or disabled).
        results.forEach((res, i) => {
            if (res.status !== 'fulfilled') return;
            const { obj } = records[i];
            const idx = DATA_MODELS.attendance.findIndex(a =>
                a.sessionId === obj.sessionId && String(a.studentId) === String(obj.studentId));
            if (idx >= 0) DATA_MODELS.attendance[idx] = { ...DATA_MODELS.attendance[idx], ...obj };
            else DATA_MODELS.attendance.push(obj);
        });

        createAuditLog('attendance_saved', { sessionId, studentCount: saved, skipped: skipped.length, failed: failed.length });

        if (failed.length > 0) {
            console.error('Attendance save failures:', failed.map(r => r.reason?.message));
            showError(`${saved} saved, ${failed.length} failed. Check console for details.`);
        } else if (skipped.length > 0) {
            showSuccess(`Attendance saved for ${saved} students. ${skipped.length} skipped (no class assigned).`);
        } else {
            showSuccess(`Attendance saved for ${saved} students!`);
        }

        // Refresh any open report/view that reads attendance
        const reportSel = document.getElementById('report-session-date');
        if (reportSel && reportSel.value && typeof generateDaywiseAttendanceReport === 'function') {
            generateDaywiseAttendanceReport();
        }
        _debouncedRenderDashboard();
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
        id: crypto.randomUUID(), name, assessmentDate: date, totalMarks, classId
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
        createAuditLog('scores_saved', { assessmentId, assessmentName: assessment.name, classId: assessment.classId, studentCount: toWrite.length });
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

    populateDropdown('report-student', students, s => s.studentId, s => `${s.firstName} ${s.lastName} (#${s.registerNo ?? s.studentId})`);

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
    const availableSessions = DATA_MODELS.sessions.filter(s => s.status === 'Available' && isCurrentAcademicYear(s));
    const totalSessionsHeld = availableSessions.length;
    const studentAttendance = DATA_MODELS.attendance.filter(a => a.studentId === studentId && isCurrentAcademicYear(a));
    const presentCount = studentAttendance.filter(a => a.status === 'Present' || a.status === 'Late').length;
    const attendancePercentage = totalSessionsHeld > 0 ? Math.round((presentCount / totalSessionsHeld) * 100) : 0;
    const studentScores = DATA_MODELS.scores.filter(s => s.studentId === studentId && isCurrentAcademicYear(s));
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

    let sessions = DATA_MODELS.sessions
        .filter(s => s.status === 'Available')
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    // B7: Apply date filter
    if (ATTENDANCE_DATE_FILTER.from) {
        sessions = sessions.filter(s => s.date >= ATTENDANCE_DATE_FILTER.from);
    }
    if (ATTENDANCE_DATE_FILTER.to) {
        sessions = sessions.filter(s => s.date <= ATTENDANCE_DATE_FILTER.to);
    }

    const students = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || []).sort((a, b) =>
        String(a.studentId).localeCompare(String(b.studentId), undefined, { numeric: true })
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
    if (overallDownloadBtn) overallDownloadBtn.style.display = 'inline-flex';

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
    const downloadBtn = document.getElementById('download-daywise-report-btn');
    if (!container || !select || !printBtn) return;
    const setReportBtns = (show) => {
        const d = show ? 'inline-flex' : 'none';
        printBtn.style.display = d;
        if (downloadBtn) downloadBtn.style.display = d;
    };

    const sessionId = select.value;
    if (!sessionId) {
        container.innerHTML = '<p>Please select a session to view the report.</p>';
        setReportBtns(false);
        return;
    }

    const session = DATA_MODELS.sessions.find(s => s.id === sessionId);
    if (!session) {
        container.innerHTML = '<p>Error: Session not found.</p>';
        setReportBtns(false);
        return;
    }

    if (session.status === 'NoClass') {
        container.innerHTML = `<h5>Report for ${formatDate(session.date)}</h5>
                               <p><strong>Status: No Class</strong></p>
                               <p>Reason: ${escapeHtml(session.noClassReason || 'Not specified')}</p>`;
        setReportBtns(true);
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
    setReportBtns(true);
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
            const studentRef = doc(window.db, 'students', String(student.studentId));
            await setDoc(studentRef, student, { merge: true });
            await upsertEnrollmentForStudent(withAcademicYear(student), currentUserData?.uid || 'admin');
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
    const roster = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || []);
    if (roster.length === 0) return showError('No student data to export for the active year.');
    const headers = ['studentId', 'firstName', 'lastName', 'classId', 'registerNo', 'guardian', 'phone', 'email', 'dob', 'notes'];
    exportToCsv(roster, headers, 'students_export.csv');
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
        const { getDocs, collection, getDoc, doc, query, where } = window;
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
        // Fetch year-scoped collections filtered to the active year at the SERVER.
        // Avoids the PostgREST 1000-row cap dropping current-year rows behind old data,
        // and enforces "stick strictly to the active academic year".
        const activeYearIdForLoad = getActiveAcademicYearId() || null;
        const yearScopedSet = new Set([
            'sessions', 'attendance', 'assessments', 'scores', 'enrollments',
            'earlyAngelEntries', 'earlyAngelDailySummary', 'earlyAngelLeaderboard'
        ]);
        const buildFetchRef = (colName) => (activeYearIdForLoad && yearScopedSet.has(colName))
            ? query(collection(window.db, colName), where('academicYearId', '==', activeYearIdForLoad))
            : collection(window.db, colName);
        const promises = collectionsToFetch.map(colName => getDocs(buildFetchRef(colName)));
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

        // A1: Store admin's own classId
        if (currentUserData?.classId) {
            ADMIN_MY_CLASS_ID = currentUserData.classId;
            if (!studentClassFilter) studentClassFilter = ADMIN_MY_CLASS_ID;
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
    const availableSessions = DATA_MODELS.sessions.filter(s => s.status === 'Available' && isCurrentAcademicYear(s));
    const activeYearAttendance = (DATA_MODELS.attendance || []).filter(a => isCurrentAcademicYear(a));
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
                const presentCount = activeYearAttendance.filter(a => a.studentId === student.studentId && (a.status === 'Present' || a.status === 'Late')).length;
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
            yearLabel: `Academic Year ${defaultYearId}`,
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
            yearLabel: label || `Academic Year ${targetId}`,
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

// ================================================================
// STUDENT YEAR PROMOTION (Admin tool — replaces faculty migration)
// ================================================================

function populateYearPromotionDropdowns() {
    const years = DATA_MODELS.academicYears || [];
    const classes = DATA_MODELS.classes || [];
    const activeYearId = getActiveAcademicYearId();

    const fromYearSel = document.getElementById('promo-from-year');
    const toYearSel = document.getElementById('promo-to-year');
    const fromClassSel = document.getElementById('promo-from-class');
    const toClassSel = document.getElementById('promo-to-class');
    if (!fromYearSel) return;

    const yearOpts = years
        .sort((a, b) => String(b.id).localeCompare(String(a.id)))
        .map(y => `<option value="${escapeHtml(y.id)}">${escapeHtml(y.label || y.id)}</option>`)
        .join('');
    fromYearSel.innerHTML = '<option value="">-- Select --</option>' + yearOpts;
    toYearSel.innerHTML = '<option value="">-- Select --</option>' + yearOpts;
    if (activeYearId) toYearSel.value = activeYearId;

    const classOpts = [...classes]
        .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
        .map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name || c.id)}</option>`)
        .join('');
    fromClassSel.innerHTML = '<option value="">-- Select --</option>' + classOpts;
    toClassSel.innerHTML = '<option value="">-- Select --</option>' + classOpts;

    if (fromYearSel.innerHTML !== '<option value="">-- Select --</option>') {
        document.getElementById('promo-run-btn').disabled = true;
        document.getElementById('promo-preview-container').innerHTML = '';
        _promoPreviewStudents = [];
    }
}

let _promoPreviewStudents = [];

async function previewYearPromotion() {
    const fromYear  = document.getElementById('promo-from-year').value;
    const fromClass = document.getElementById('promo-from-class').value;
    const toYear    = document.getElementById('promo-to-year').value;
    const toClass   = document.getElementById('promo-to-class').value;
    const container = document.getElementById('promo-preview-container');
    const runBtn    = document.getElementById('promo-run-btn');

    if (!fromYear || !fromClass) return showError('Select a source year and class.');
    if (!toYear   || !toClass)   return showError('Select a target year and class.');
    if (fromYear === toYear && fromClass === toClass) return showError('Source and target must be different.');

    showSpinner();
    _promoPreviewStudents = [];
    if (runBtn) runBtn.disabled = true;

    try {
        const { collection, query, where, getDocs } = window;

        const [srcSnap, tgtSnap] = await Promise.all([
            getDocs(query(collection(window.db, 'enrollments'),
                where('academicYearId', '==', fromYear),
                where('classId', '==', fromClass))),
            getDocs(query(collection(window.db, 'enrollments'),
                where('academicYearId', '==', toYear),
                where('classId', '==', toClass)))
        ]);

        const alreadyEnrolled = new Set(tgtSnap.docs.map(d => String(d.data().studentId)));
        const allStudents = DATA_MODELS.students || [];

        let sourceList = [];
        if (!srcSnap.empty) {
            // Modern path: use enrollment records
            sourceList = srcSnap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(e => e.status !== 'transferred')
                .map(e => {
                    const s = allStudents.find(st => String(st.studentId) === String(e.studentId)) || {};
                    return {
                        studentId: e.studentId,
                        fullName: e.fullName || `${s.firstName || ''} ${s.lastName || ''}`.trim() || String(e.studentId)
                    };
                });
        } else {
            // Legacy path: students stored directly with classId field (no enrollment docs yet)
            sourceList = allStudents
                .filter(s => String(s.classId || '') === String(fromClass))
                .map(s => ({
                    studentId: s.studentId,
                    fullName: `${s.firstName || ''} ${s.lastName || ''}`.trim() || String(s.studentId)
                }));
        }

        _promoPreviewStudents = sourceList
            .map(s => ({ ...s, alreadyEnrolled: alreadyEnrolled.has(String(s.studentId)) }))
            .sort((a, b) => a.fullName.localeCompare(b.fullName));

        const toEnroll = _promoPreviewStudents.filter(s => !s.alreadyEnrolled);
        const skipped  = _promoPreviewStudents.filter(s =>  s.alreadyEnrolled);

        const fromClassName = (DATA_MODELS.classes || []).find(c => c.id === fromClass)?.name || fromClass;
        const toClassName   = (DATA_MODELS.classes || []).find(c => c.id === toClass)?.name   || toClass;
        const fromYearLabel = (DATA_MODELS.academicYears || []).find(y => y.id === fromYear)?.label || fromYear;
        const toYearLabel   = (DATA_MODELS.academicYears || []).find(y => y.id === toYear)?.label   || toYear;

        container.innerHTML = `
            <div class="card card-nested" style="margin-top:12px;">
                <p style="margin-bottom:10px;font-size:0.92rem;">
                    <strong>${toEnroll.length}</strong> student${toEnroll.length !== 1 ? 's' : ''} will be promoted:
                    <strong>${escapeHtml(fromClassName)}</strong> (${escapeHtml(fromYearLabel)})
                    → <strong>${escapeHtml(toClassName)}</strong> (${escapeHtml(toYearLabel)}).
                    ${skipped.length > 0 ? `<span style="color:var(--warning);margin-left:6px;"><i class="fas fa-exclamation-triangle"></i> ${skipped.length} already enrolled — will be skipped.</span>` : ''}
                    ${toEnroll.length === 0 ? '<span style="color:var(--danger);margin-left:6px;">No students to promote.</span>' : ''}
                </p>
                <div class="table-wrapper"><table class="data-table" style="font-size:0.84rem;">
                    <thead><tr><th>Student ID</th><th>Name</th><th>Action</th></tr></thead>
                    <tbody>${_promoPreviewStudents.map(s => `<tr>
                        <td>${escapeHtml(String(s.studentId))}</td>
                        <td>${escapeHtml(s.fullName)}</td>
                        <td>${s.alreadyEnrolled
                            ? '<span style="color:var(--warning);font-size:0.8rem;"><i class="fas fa-minus-circle"></i> Skip</span>'
                            : '<span style="color:var(--success);font-size:0.8rem;"><i class="fas fa-check-circle"></i> Promote</span>'}</td>
                    </tr>`).join('')}</tbody>
                </table></div>
            </div>`;

        if (runBtn) runBtn.disabled = toEnroll.length === 0;
    } catch (err) {
        container.innerHTML = `<p style="color:var(--danger);padding:8px 0;"><i class="fas fa-exclamation-circle"></i> ${escapeHtml(err.message)}</p>`;
        showError('Preview failed: ' + err.message);
    } finally {
        hideSpinner();
    }
}

async function runYearPromotion() {
    const fromYear  = document.getElementById('promo-from-year').value;
    const fromClass = document.getElementById('promo-from-class').value;
    const toYear    = document.getElementById('promo-to-year').value;
    const toClass   = document.getElementById('promo-to-class').value;
    const toEnroll  = (_promoPreviewStudents || []).filter(s => !s.alreadyEnrolled);

    if (toEnroll.length === 0) return showError('No students to promote. Click Preview first.');

    const fromClassName = (DATA_MODELS.classes || []).find(c => c.id === fromClass)?.name || fromClass;
    const toClassName   = (DATA_MODELS.classes || []).find(c => c.id === toClass)?.name   || toClass;

    const confirmed = await showConfirm(
        `Promote ${toEnroll.length} Student${toEnroll.length !== 1 ? 's' : ''}?`,
        `Students will be enrolled in ${toClassName} for the selected academic year.`,
        'Yes, Promote'
    );
    if (!confirmed.isConfirmed) return;

    showSpinner();
    let ok = 0, fail = 0;
    try {
        await Promise.all(toEnroll.map(async (student) => {
            try {
                // Create enrollment record in the new year/class
                await createOrUpdateEnrollment(toYear, toClass, student.studentId, {
                    fullName: student.fullName,
                    status: 'active',
                    promotedFromClass: fromClass,
                    promotedFromYear: fromYear,
                    promotedAt: new Date().toISOString()
                });
                // Update master student profile classId so faculty queries find them
                await setDoc(
                    doc(window.db, 'students', String(student.studentId)),
                    { classId: toClass, updatedAt: new Date().toISOString() },
                    { merge: true }
                );
                ok++;
            } catch (e) {
                fail++;
                console.error('Promotion failed for', student.studentId, e);
            }
        }));
        createAuditLog('admin_year_promotion', { fromYear, fromClass, toYear, toClass, promoted: ok, failed: fail });
        document.getElementById('promo-run-btn').disabled = true;
        document.getElementById('promo-preview-container').innerHTML = '';
        _promoPreviewStudents = [];
        showSuccess('Promotion Complete!',
            `${ok} student${ok !== 1 ? 's' : ''} enrolled in ${toClassName}.${fail > 0 ? ` ${fail} failed — check console.` : ''}`);
    } catch (err) {
        showError('Promotion failed: ' + err.message);
    } finally {
        hideSpinner();
    }
}

/**
 * Reassign register numbers for all enrollments in a year+class
 * using the {classNumber}{seq:02} format (e.g. 701, 702, 715).
 * Run this once after migrating old students to fix their register numbers.
 */
async function fixRegisterNumbers() {
    const toYear  = document.getElementById('promo-to-year').value;
    const toClass = document.getElementById('promo-to-class').value;

    if (!toYear || !toClass) return showError('Select the Target Year and Target Class first, then click Fix Register Numbers.');

    const toClassObj = (DATA_MODELS.classes || []).find(c => c.id === toClass);
    const classNum = window.getClassNumber ? window.getClassNumber(toClass, toClassObj?.name) : null;
    if (classNum == null) return showError(`Cannot extract a class number from "${toClass}" (name: "${toClassObj?.name || '?'}"). Expected a numeric class name like "Class 7".`);

    const toClassName = (DATA_MODELS.classes || []).find(c => c.id === toClass)?.name || toClass;
    const toYearLabel = (DATA_MODELS.academicYears || []).find(y => y.id === toYear)?.label || toYear;

    try {
        const { collection, query, where, getDocs, setDoc, doc, serverTimestamp } = window;

        // Fetch all active enrollments for this year+class
        showSpinner();
        const snap = await getDocs(query(
            collection(window.db, 'enrollments'),
            where('academicYearId', '==', toYear),
            where('classId', '==', toClass)
        ));
        hideSpinner();

        const enrollments = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(e => e.status !== 'transferred')
            .sort((a, b) => Number(a.studentId) - Number(b.studentId));

        if (enrollments.length === 0) {
            return showError(`No enrollments found for ${toClassName} / ${toYearLabel}.`);
        }

        // Show confirm AFTER spinner is gone so buttons are clickable
        const confirmed = await showConfirm(
            `Reassign Register Numbers?`,
            `This will renumber all ${enrollments.length} students in ${toClassName} (${toYearLabel}) as ${classNum}01, ${classNum}02 … ${classNum}${String(enrollments.length).padStart(2, '0')}.`,
            'Yes, Renumber'
        );
        if (!confirmed.isConfirmed) return;

        showSpinner();

        // Parallel writes — enrollments (register numbers) + master student classId update
        await Promise.all(enrollments.map((enroll, i) => {
            const registerNo = parseInt(`${classNum}${String(i + 1).padStart(2, '0')}`, 10);
            return Promise.all([
                // Fix enrollment register number
                setDoc(doc(window.db, 'enrollments', enroll.id),
                    { registerNo, updatedAt: serverTimestamp() }, { merge: true }),
                // Fix master student classId so faculty can find them
                setDoc(doc(window.db, 'students', String(enroll.studentId)),
                    { classId: toClass, academicYearId: toYear, updatedAt: serverTimestamp() },
                    { merge: true })
            ]);
        }));
        const updated = enrollments.length;

        // Reset the classYearCounter to the final count
        const counterRef = doc(window.db, 'classYearCounters', `${toYear}_${toClass}`);
        await setDoc(counterRef, {
            academicYearId: toYear,
            classId: toClass,
            count: enrollments.length,
            updatedAt: serverTimestamp()
        }, { merge: true });

        createAuditLog('admin_fix_register_numbers', { toYear, toClass, updated });
        showSuccess('Done!', `${updated} students fixed: register numbers ${classNum}01–${classNum}${String(updated).padStart(2, '0')} and class profiles updated.`);
    } catch (err) {
        showError('Fix failed: ' + err.message);
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
// Synchronous on purpose: builds from the already-loaded DATA_MODELS.classes.
// The previous async version re-fetched from the DB, and because innerHTML was
// cleared before the await but options were appended after it, two concurrent
// calls (init + the classes realtime listener) interleaved and produced a
// duplicated option list. Building synchronously from cached data avoids the race.
function populateClassDropdowns(selectElementId) {
    const selectEl = document.getElementById(selectElementId);
    if (!selectEl) return;

    const currentValue = selectEl.value;
    const defaultOption = selectEl.options[0] ? selectEl.options[0].cloneNode(true) : document.createElement('option');
    if (!defaultOption.value) {
        defaultOption.value = "";
        defaultOption.textContent = "-- Select --";
    }

    selectEl.innerHTML = '';
    selectEl.appendChild(defaultOption);

    // De-dupe by id defensively, then sort numerically by class id.
    const seen = new Set();
    const classes = (DATA_MODELS.classes || [])
        .filter(c => c && c.id && !seen.has(c.id) && seen.add(c.id))
        .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));

    classes.forEach(classData => {
        const option = document.createElement('option');
        option.value = classData.id;          // e.g., "class-6"
        option.textContent = classData.name;  // e.g., "Class 6"
        selectEl.appendChild(option);
    });

    if (currentValue) selectEl.value = currentValue;
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
                    createAuditLog('class_deleted', { classId: id });
                    showSuccess('Class deleted.');
                    // Realtime listener handles table refresh automatically
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
        // Realtime listener handles refresh automatically
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
        await setDoc(doc(window.db, 'userRoles', uid), roleData, { merge: true });

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
                sessionDate: date,
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
            <thead><tr><th>ID</th><th>Name</th><th>Marks</th><th>%</th><th>Grade</th></tr></thead>
            <tbody>
                ${reportRows.map(row => {
                    const pct = row.marks !== null ? Math.round((row.marks / assessment.totalMarks) * 100) : null;
                    const gradeObj = (typeof getLetterGrade === 'function') ? getLetterGrade(pct) : null;
                    const gradeBadge = gradeObj
                        ? `<span class="grade-badge ${gradeObj.css}">${gradeObj.grade}</span>`
                        : '<span style="color:orange">Absent</span>';
                    return `
                    <tr>
                        <td>${escapeHtml(row.student.studentId)}</td>
                        <td>${escapeHtml(row.student.firstName)} ${escapeHtml(row.student.lastName)}</td>
                        <td>${row.marks !== null ? row.marks : '-'}</td>
                        <td>${row.statusHtml}</td>
                        <td>${gradeBadge}</td>
                    </tr>`;
                }).join('')}
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
        // merge:true preserves existing columns — only send valid user_roles columns.
        // (Do NOT spread roleDoc: it carries a synthetic `uid` field, and there is no
        //  `uid`/`updated_by` column on user_roles, which would reject the write.)
        const userRolePayload = {
            role: 'faculty',
            classId,
            updatedAt: nowIso,
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

// -----------------
// 📊 A7: CLASS PERFORMANCE COMPARISON
// -----------------
function renderClassPerformanceTable() {
    const tbody = document.getElementById('class-performance-tbody');
    if (!tbody) return;

    const availableSessions = DATA_MODELS.sessions.filter(s => s.status === 'Available' && isCurrentAcademicYear(s));
    const activeYearAttendance = DATA_MODELS.attendance.filter(a => isCurrentAcademicYear(a));
    const allClasses = [...new Set(
        getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
            .map(s => s.classId).filter(Boolean)
    )].sort();

    if (allClasses.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5">No class data available.</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    allClasses.forEach(classId => {
        const students = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
            .filter(s => String(s.classId || '') === classId);

        let totalAttPct = 0;
        let atRiskCount = 0;
        students.forEach(student => {
            const pct = calcStudentAttendancePct(student.studentId, availableSessions, activeYearAttendance);
            if (pct !== null) {
                totalAttPct += pct;
                if (pct < 75) atRiskCount++;
            }
        });
        const avgAtt = students.length > 0 ? Math.round(totalAttPct / students.length) : 0;

        // Average score %
        let totalScorePct = 0;
        let scoredCount = 0;
        const classAssessments = DATA_MODELS.assessments.filter(a => String(a.classId || '') === classId);
        classAssessments.forEach(assessment => {
            const scores = DATA_MODELS.scores.filter(sc => sc.assessmentId === assessment.id && sc.marks !== null);
            scores.forEach(sc => {
                totalScorePct += (sc.marks / assessment.totalMarks) * 100;
                scoredCount++;
            });
        });
        const avgScore = scoredCount > 0 ? Math.round(totalScorePct / scoredCount) : null;

        const attClass = avgAtt >= 75 ? 'perf-good' : avgAtt >= 50 ? 'perf-warn' : 'perf-bad';
        const scoreStr = avgScore !== null ? `<span class="${avgScore >= 60 ? 'perf-good' : avgScore >= 40 ? 'perf-warn' : 'perf-bad'}">${avgScore}%</span>` : 'N/A';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${escapeHtml(classId)}</td>
            <td>${students.length}</td>
            <td><span class="${attClass}">${avgAtt}%</span></td>
            <td>${atRiskCount > 0 ? `<span class="at-risk-badge">${atRiskCount}</span>` : '0'}</td>
            <td>${scoreStr}</td>
        `;
        tbody.appendChild(row);
    });
}

// -----------------
// 🔄 A6: STUDENT TRANSFER
// -----------------
function openTransferModal(studentId) {
    const student = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
        .find(s => String(s.studentId) === String(studentId));
    if (!student) return showError('Student not found.');

    document.getElementById('transfer-student-id').value = studentId;
    document.getElementById('transfer-student-info').textContent =
        `Transferring: ${student.firstName} ${student.lastName} (Current Class: ${student.classId || 'N/A'})`;

    // Populate target class dropdown (exclude current class)
    const targetSelect = document.getElementById('transfer-target-class');
    const allClasses = DATA_MODELS.classes || [];
    targetSelect.innerHTML = '<option value="">-- Select target class --</option>';
    allClasses.forEach(cls => {
        if (String(cls.id || cls.name) !== String(student.classId || '')) {
            const opt = document.createElement('option');
            opt.value = cls.id || cls.name;
            opt.textContent = cls.name || cls.id;
            targetSelect.appendChild(opt);
        }
    });

    document.getElementById('transfer-modal').style.display = 'flex';
}

async function confirmStudentTransfer() {
    const studentId = document.getElementById('transfer-student-id').value;
    const targetClassId = document.getElementById('transfer-target-class').value;

    if (!targetClassId) return showError('Please select a target class.');

    const student = DATA_MODELS.students.find(s => String(s.studentId) === String(studentId));
    if (!student) return showError('Student not found.');

    const confirmed = await showConfirm(
        'Confirm Transfer',
        `Transfer ${student.firstName} ${student.lastName} to class "${targetClassId}"?`
    );
    if (!confirmed.isConfirmed) return;

    showSpinner();
    try {
        const { doc, setDoc } = window;

        // Update student's classId
        await setDoc(doc(window.db, 'students', String(studentId)), { classId: targetClassId }, { merge: true });

        // Update enrollment: mark old as transferred, create new enrollment at correct ID
        const activeYearId = getActiveAcademicYearId() || window.APP_CONTEXT?.activeAcademicYearId;
        if (activeYearId) {
            const currentEnrollment = (DATA_MODELS.enrollments || []).find(e =>
                String(e.studentId) === String(studentId) &&
                isCurrentAcademicYear(e)
            );
            if (currentEnrollment) {
                // Mark old enrollment as transferred (no deletion — preserves history)
                await setDoc(
                    doc(window.db, 'enrollments', String(currentEnrollment.id)),
                    { status: 'transferred', transferredToClass: targetClassId, transferredAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
                    { merge: true }
                );
            }
            // Create new enrollment under the correct document ID (year_newClass_student)
            await createOrUpdateEnrollment(activeYearId, targetClassId, studentId, {
                fullName: `${student.firstName} ${student.lastName}`,
                status: 'active',
                transferredFromClass: student.classId || ''
            });
        }

        createAuditLog('student_transferred', {
            studentId,
            fromClass: student.classId,
            toClass: targetClassId
        });

        document.getElementById('transfer-modal').style.display = 'none';
        showSuccess('Student transferred successfully!');
    } catch (err) {
        showError('Transfer failed: ' + err.message);
    } finally {
        hideSpinner();
    }
}

// -----------------
// 📢 B8: ANNOUNCEMENTS (ADMIN)
// -----------------
let _announcementsListenerActive = false;
function startAnnouncementsListener() {
    if (_announcementsListenerActive) return;
    if (!window.db || !window.onSnapshot || !window.collection) return;
    _announcementsListenerActive = true;
    const { onSnapshot, collection, query, orderBy } = window;
    const q = query(collection(window.db, 'announcements'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
        DATA_MODELS.announcements = [];
        snap.forEach(d => DATA_MODELS.announcements.push({ id: d.id, ...d.data() }));
        renderAnnouncementsAdmin();
    }, err => {
        _announcementsListenerActive = false;
        console.warn('Announcements listener error:', err);
    });
    window.realtimeUnsubscribers.push(unsub);
}

function renderAnnouncementsAdmin() {
    const container = document.getElementById('announcements-admin-list');
    if (!container) return;

    const activeYearId = getActiveAcademicYearId();
    const announcements = (DATA_MODELS.announcements || []).filter(a =>
        !a.academicYearId || String(a.academicYearId) === String(activeYearId || '')
    );

    if (announcements.length === 0) {
        container.innerHTML = '<p style="color:var(--text-color-light);">No announcements yet.</p>';
        return;
    }

    const sorted = [...announcements].sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });

    container.innerHTML = sorted.map(ann => {
        const audienceCss = { all: 'audience-all', faculty: 'audience-faculty', students: 'audience-students' }[ann.audience] || 'audience-all';
        const expiry = ann.expiresAt ? ` | Expires: ${formatDate(ann.expiresAt)}` : '';
        return `
        <div class="announcement-card ${ann.pinned ? 'pinned' : ''}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                <div>
                    ${ann.pinned ? '<i class="fas fa-thumbtack" style="color:var(--warning);margin-right:6px;"></i>' : ''}
                    <strong>${escapeHtml(ann.title || '')}</strong>
                    <span class="announcement-audience-badge ${audienceCss}" style="margin-left:8px;">${escapeHtml(ann.audience || 'all')}</span>
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0;">
                    <button class="btn btn-warning btn-sm edit-announcement-btn" data-id="${escapeHtml(ann.id)}">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-danger btn-sm delete-announcement-btn" data-id="${escapeHtml(ann.id)}">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            <p style="margin:8px 0 4px;">${escapeHtml(ann.body || '')}</p>
            <small style="color:var(--text-color-light);">By ${escapeHtml(ann.createdByEmail || '')} | ${formatDate(ann.createdAt ? ann.createdAt.slice(0, 10) : '')}${expiry}</small>
        </div>`;
    }).join('');

    container.querySelectorAll('.edit-announcement-btn').forEach(btn => {
        btn.addEventListener('click', () => editAnnouncement(btn.dataset.id));
    });
    container.querySelectorAll('.delete-announcement-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteAnnouncement(btn.dataset.id));
    });
}

function editAnnouncement(announcementId) {
    const ann = (DATA_MODELS.announcements || []).find(a => a.id === announcementId);
    if (!ann) return;

    document.getElementById('announcement-id').value = ann.id;
    document.getElementById('announcement-title').value = ann.title || '';
    document.getElementById('announcement-body').value = ann.body || '';
    document.getElementById('announcement-audience').value = ann.audience || 'all';
    document.getElementById('announcement-expires').value = ann.expiresAt || '';
    document.getElementById('announcement-pinned').checked = !!ann.pinned;
    document.getElementById('announcement-form-title').textContent = 'Edit Announcement';
    document.getElementById('announcements-form-section').style.display = 'block';
}

async function saveAnnouncement() {
    const id = document.getElementById('announcement-id').value;
    const title = document.getElementById('announcement-title').value.trim();
    const body = document.getElementById('announcement-body').value.trim();
    const audience = document.getElementById('announcement-audience').value;
    const expiresAt = document.getElementById('announcement-expires').value || null;
    const pinned = document.getElementById('announcement-pinned').checked;

    if (!title || !body) return showError('Title and message are required.');

    showSpinner();
    try {
        const { doc, setDoc, collection } = window;
        const docId = id || crypto.randomUUID();
        const payload = withAcademicYear({
            title, body, audience, pinned,
            ...(expiresAt ? { expiresAt } : {})
        });

        await setDoc(doc(window.db, 'announcements', docId), payload, { merge: true });
        createAuditLog(id ? 'announcement_updated' : 'announcement_created', { announcementId: docId, title });

        document.getElementById('announcement-id').value = '';
        document.getElementById('announcement-title').value = '';
        document.getElementById('announcement-body').value = '';
        document.getElementById('announcement-audience').value = 'all';
        document.getElementById('announcement-expires').value = '';
        document.getElementById('announcement-pinned').checked = false;
        document.getElementById('announcement-form-title').textContent = 'New Announcement';
        document.getElementById('announcements-form-section').style.display = 'none';
        showSuccess('Announcement saved!');
    } catch (err) {
        showError('Failed to save announcement: ' + err.message);
    } finally {
        hideSpinner();
    }
}

async function deleteAnnouncement(announcementId) {
    const confirmed = await showConfirm('Delete Announcement?', 'This cannot be undone.');
    if (!confirmed.isConfirmed) return;

    showSpinner();
    try {
        const { doc, deleteDoc } = window;
        await deleteDoc(doc(window.db, 'announcements', announcementId));
        createAuditLog('announcement_deleted', { announcementId });
        showSuccess('Announcement deleted.');
    } catch (err) {
        showError('Failed to delete: ' + err.message);
    } finally {
        hideSpinner();
    }
}

// ==========================================
// FEATURE A5 — Print Class Register (Admin)
// ==========================================
function openPrintRegisterModal() {
    const modal = document.getElementById('print-register-modal');
    if (!modal) return;
    // Populate session dropdown
    const sesSelect = document.getElementById('register-session-select');
    sesSelect.innerHTML = '<option value="">-- Select session --</option>';
    const available = [...DATA_MODELS.sessions].filter(s => s.status === 'Available').sort((a, b) => new Date(b.date) - new Date(a.date));
    available.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = formatDate(s.date) + (s.topic ? ` — ${s.topic}` : '');
        sesSelect.appendChild(opt);
    });
    // Populate class dropdown
    const clsSelect = document.getElementById('register-class-select');
    clsSelect.innerHTML = '<option value="">-- All classes --</option>';
    (DATA_MODELS.classes || []).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = escapeHtml(c.name || c.id);
        clsSelect.appendChild(opt);
    });
    modal.style.display = 'flex';
}

function printClassRegister() {
    const sessionId = document.getElementById('register-session-select').value;
    const classId = document.getElementById('register-class-select').value;
    if (!sessionId) { showError('Please select a session.'); return; }

    const session = DATA_MODELS.sessions.find(s => s.id === sessionId);
    if (!session) { showError('Session not found.'); return; }

    const roster = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || []);
    const students = roster
        .filter(s => !classId || s.classId === classId)
        .sort((a, b) => (a.lastName || '').localeCompare(b.lastName || ''));

    const attendance = DATA_MODELS.attendance || [];
    const sessionAtt = attendance.filter(a => a.sessionId === sessionId);

    const className = classId ? ((DATA_MODELS.classes || []).find(c => c.id === classId)?.name || classId) : 'All Classes';

    let rows = students.map((s, idx) => {
        const rec = sessionAtt.find(a => String(a.studentId) === String(s.studentId));
        const status = rec ? rec.status : 'Absent';
        const statusColor = status === 'Present' ? '#22c55e' : '#ef4444';
        return `<tr>
            <td>${idx + 1}</td>
            <td>${escapeHtml(s.studentId)}</td>
            <td>${escapeHtml(s.firstName)} ${escapeHtml(s.lastName)}</td>
            <td>${escapeHtml(s.classId || '')}</td>
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
    <h3>Session Date: ${formatDate(session.date)}</h3>
    <p>Total Students: ${students.length}</p>
    <br>
    <table>
        <thead><tr><th>#</th><th>ID</th><th>Name</th><th>Class</th><th>Status</th><th>Signature</th></tr></thead>
        <tbody>${rows}</tbody>
    </table>
    <br><p>Printed: ${new Date().toLocaleString()}</p>
    <script>window.onload=()=>window.print();<\/script>
    </body></html>`;

    const w = window.open('', '_blank');
    if (w) {
        w.document.write(printHtml);
        w.document.close();
    }
    document.getElementById('print-register-modal').style.display = 'none';
}

// ==========================================
// FEATURE B1 — CSV Student Import (Admin)
// ==========================================
function downloadCSVTemplate() {
    const header = 'firstName,lastName,dob,guardian,phone,email,classId,notes,fatherName,fatherPhone,motherName,motherPhone';
    const example = 'John,Doe,2014-03-15,Mary Doe,9123456789,john@example.com,grade5,Sample note,James Doe,9000000001,Mary Doe,9000000002';
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
    // Reset state
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
    // Detect duplicates in existing students
    const roster = DATA_MODELS.students || [];
    const duplicates = validRows.filter(r => roster.some(s =>
        s.firstName?.toLowerCase() === r.firstname?.toLowerCase() &&
        s.lastName?.toLowerCase() === r.lastname?.toLowerCase() &&
        s.dob === r.dob));
    const importable = validRows.filter(r => !duplicates.includes(r));

    infoDiv.textContent = `${rows.length} rows parsed — ${importable.length} will be imported, ${duplicates.length} duplicates skipped, ${rows.filter(r => r._error).length} rows with errors skipped.`;

    // Render table
    const cols = ['firstname', 'lastname', 'dob', 'guardian', 'phone', 'email', 'classid'];
    theadRow.innerHTML = cols.map(c => `<th>${escapeHtml(c)}</th>`).concat(['<th>Status</th>']).join('');
    tbody.innerHTML = rows.map(r => {
        const isDup = duplicates.includes(r);
        const statusLabel = r._error ? '<span style="color:var(--danger)">Error</span>' : isDup ? '<span style="color:var(--warning)">Duplicate</span>' : '<span style="color:var(--success)">OK</span>';
        const rowStyle = r._error ? 'background:#fee2e2;' : isDup ? 'background:#fffbeb;' : '';
        return `<tr style="${rowStyle}">${cols.map(c => `<td>${escapeHtml(r[c] || '')}</td>`).join('')}<td>${statusLabel}</td></tr>`;
    }).join('');

    if (importable.length > 0) {
        confirmBtn.classList.remove('is-hidden');
        confirmBtn.dataset.importCount = importable.length;
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
                    classId: r.classid || (currentUserData?.classId || ''),
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
                await upsertEnrollmentForStudent(student, currentUserData?.uid || 'admin');
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
// FEATURE B7 — Attendance Date Filter (Admin)
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
// FEATURE C1 — Certificate Generator (Admin)
// ==========================================
function populateCertClassDropdown() {
    const sel = document.getElementById('cert-class-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Select class --</option>';
    (DATA_MODELS.classes || []).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = escapeHtml(c.name || c.id);
        sel.appendChild(opt);
    });
    // Set today's date as default
    const certDateEl = document.getElementById('cert-date');
    if (certDateEl && !certDateEl.value) {
        certDateEl.value = new Date().toISOString().split('T')[0];
    }
}

// Order classes KG → 1..10 → 11/12 (senior). KG first, unknown last.
function classOrderKey(classId) {
    const cls = (DATA_MODELS.classes || []).find(c => c.id === classId);
    const name = cls?.name || classId || '';
    if (/kg/i.test(String(classId || '')) || /kg/i.test(String(name))) return -1;
    const num = (typeof getClassNumber === 'function') ? getClassNumber(classId, cls?.name) : null;
    return num != null ? num : 999;
}

// Download a PDF of every enrolled student (KG → 12) and their attendance status
// for a chosen session date. Produces a standalone report, not a webpage print.
async function downloadTodaysAttendance() {
    const statusEl = document.getElementById('todays-att-status');
    const dateStr = document.getElementById('todays-att-date')?.value || new Date().toISOString().slice(0, 10);

    const roster = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || []);
    if (roster.length === 0) {
        if (statusEl) statusEl.textContent = 'No enrolled students found for the active year.';
        return showError('No enrolled students found for the active year.');
    }

    // Session for the selected date (sessions are aliased to expose `.date`)
    const session = (DATA_MODELS.sessions || []).find(s => String(s.date || s.sessionDate) === dateStr);

    // Status lookup for that session
    const attMap = new Map();
    if (session) {
        for (const a of (DATA_MODELS.attendance || [])) {
            if (a.sessionId === session.id) attMap.set(String(a.studentId), a.status);
        }
    }

    // Sort KG → 12, then by register number
    const sorted = [...roster].sort((a, b) => {
        const ck = classOrderKey(a.classId) - classOrderKey(b.classId);
        if (ck !== 0) return ck;
        return (Number(a.registerNo ?? a.studentId) || 0) - (Number(b.registerNo ?? b.studentId) || 0);
    });

    const classNameOf = (id) => (DATA_MODELS.classes || []).find(c => c.id === id)?.name || id || '—';
    const academicYear = getActiveAcademicYearId() || window.APP_CONTEXT?.activeAcademicYearId || '';

    let rowsHtml = '';
    let currentClass = '__none__';
    let presentCount = 0, total = 0;
    sorted.forEach(s => {
        if (s.classId !== currentClass) {
            currentClass = s.classId;
            rowsHtml += `<tr><td colspan="4" style="background:#eef2ff;font-weight:bold;padding:6px 8px;border-top:2px solid #c7d2fe;">${escapeHtml(classNameOf(s.classId))}</td></tr>`;
        }
        const status = session ? (attMap.get(String(s.studentId)) || 'Absent') : '—';
        if (status === 'Present' || status === 'Late') presentCount++;
        total++;
        const color = status === 'Present' ? '#16a34a' : status === 'Absent' ? '#dc2626' : status === 'Late' ? '#d97706' : '#6b7280';
        rowsHtml += `<tr>
            <td style="padding:4px 8px;border-bottom:1px solid #eee;">${escapeHtml(String(s.registerNo ?? s.studentId))}</td>
            <td style="padding:4px 8px;border-bottom:1px solid #eee;">${escapeHtml(s.firstName || '')} ${escapeHtml(s.lastName || '')}</td>
            <td style="padding:4px 8px;border-bottom:1px solid #eee;">${escapeHtml(classNameOf(s.classId))}</td>
            <td style="padding:4px 8px;border-bottom:1px solid #eee;color:${color};font-weight:600;">${escapeHtml(status)}</td>
        </tr>`;
    });

    const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#111;padding:18px 22px;">
        <div style="text-align:center;margin-bottom:12px;">
            <h2 style="margin:0;font-size:20px;color:#1e1b4b;">St. Jude's Catechism</h2>
            <h3 style="margin:4px 0;font-size:15px;color:#4f46e5;">Daily Attendance Report</h3>
            <p style="margin:2px 0;font-size:12px;color:#555;">Date: ${escapeHtml(formatDate(dateStr))} &nbsp;|&nbsp; Academic Year: ${escapeHtml(academicYear)}</p>
            ${session ? '' : '<p style="margin:2px 0;font-size:11px;color:#dc2626;">No session exists for this date — statuses shown as "&mdash;".</p>'}
        </div>
        <p style="font-size:12px;margin:6px 0;"><strong>Total:</strong> ${total} &nbsp;&nbsp; <strong>Present/Late:</strong> ${presentCount} &nbsp;&nbsp; <strong>Absent:</strong> ${total - presentCount}</p>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead>
                <tr style="background:#4f46e5;color:#fff;">
                    <th style="padding:6px 8px;text-align:left;">Reg No</th>
                    <th style="padding:6px 8px;text-align:left;">Name</th>
                    <th style="padding:6px 8px;text-align:left;">Class</th>
                    <th style="padding:6px 8px;text-align:left;">Status</th>
                </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
        </table>
    </div>`;

    if (statusEl) statusEl.textContent = 'Generating PDF…';
    await downloadHtmlAsPdf(html, `Attendance_${dateStr}.pdf`, 'portrait');
    if (statusEl) statusEl.textContent = `Report generated for ${formatDate(dateStr)} — ${total} students.`;
    createAuditLog('todays_attendance_report_downloaded', { date: dateStr, sessionId: session?.id || null, total, present: presentCount });
}

async function generateCertificates() {
    const classId = document.getElementById('cert-class-select')?.value;
    const certType = document.getElementById('cert-type-select')?.value || 'attendance';
    const parishPriest = document.getElementById('cert-authority-name')?.value?.trim() || '';
    const secretaryName = document.getElementById('cert-secretary-name')?.value?.trim() || '';
    const teacherName = document.getElementById('cert-teacher-name')?.value?.trim() || '';
    const certDate = document.getElementById('cert-date')?.value || new Date().toISOString().split('T')[0];
    const statusEl = document.getElementById('cert-status');

    if (!classId) { showError('Please select a class.'); return; }

    const roster = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
        .filter(s => s.classId === classId);

    if (roster.length === 0) {
        if (statusEl) statusEl.textContent = 'No students found in the selected class.';
        showError('No students found in the selected class.');
        return;
    }

    const sessions = DATA_MODELS.sessions.filter(s => s.status === 'Available' && isCurrentAcademicYear(s));
    const attendance = (DATA_MODELS.attendance || []).filter(a => isCurrentAcademicYear(a));

    let eligible = roster;
    if (certType === 'attendance') {
        eligible = roster.filter(s => {
            const pct = window.calcStudentAttendancePct ? window.calcStudentAttendancePct(s.studentId, sessions, attendance) : 0;
            return pct >= 75;
        });
    }

    if (eligible.length === 0) {
        if (statusEl) statusEl.textContent = 'No eligible students for the selected certificate type.';
        showError('No eligible students (attendance certificate requires ≥75%).');
        return;
    }

    const certTitle = certType === 'attendance' ? 'Certificate of Attendance' :
                      certType === 'participation' ? 'Certificate of Participation' : 'Certificate of Completion';

    const className = (DATA_MODELS.classes || []).find(c => c.id === classId)?.name || classId;
    const academicYear = getActiveAcademicYearId() || window.APP_CONTEXT?.activeAcademicYearId || '';
    const formattedDate = formatDate(certDate);

    // One signature block (name on top, role label underneath)
    const sigBlock = (name, role) => `
        <div style="text-align:center;flex:1;">
            <div style="height:1px;background:#1e1b4b;width:70%;margin:0 auto 6px;"></div>
            <p style="margin:0;font-size:13px;color:#1e1b4b;font-weight:bold;min-height:16px;">${escapeHtml(name || '')}</p>
            <p style="margin:2px 0 0;font-size:11px;color:#555;letter-spacing:0.5px;">${escapeHtml(role)}</p>
        </div>`;

    // Each certificate fills one landscape A4 page (297mm × 210mm).
    const certs = eligible.map(s => {
        const pct = window.calcStudentAttendancePct ? window.calcStudentAttendancePct(s.studentId, sessions, attendance) : null;
        const attendanceLine = certType === 'attendance'
            ? `<p style="font-size:14px;color:#666;margin:4px 0 0;">Attendance: ${pct !== null ? pct.toFixed(1) + '%' : 'N/A'}</p>` : '';
        return `<div class="cert-page" style="width:297mm;height:210mm;box-sizing:border-box;padding:14mm;page-break-after:always;background:#fff;">
            <div style="width:100%;height:100%;border:6px solid #4f46e5;border-radius:14px;box-sizing:border-box;padding:24px 48px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;font-family:Georgia,serif;">
                <p style="font-size:15px;letter-spacing:3px;color:#6366f1;text-transform:uppercase;margin:0 0 6px;">St. Jude's Catechism</p>
                <h1 style="font-size:34px;color:#1e1b4b;margin:0 0 4px;">${certTitle}</h1>
                <p style="font-size:14px;color:#555;margin:0 0 20px;">Academic Year: ${escapeHtml(academicYear)}</p>
                <p style="font-size:16px;color:#444;margin:0 0 4px;">This is to certify that</p>
                <h2 style="font-size:36px;color:#4f46e5;margin:8px 0;border-bottom:2px solid #c7d2fe;padding-bottom:10px;min-width:55%;">${escapeHtml(s.firstName)} ${escapeHtml(s.lastName || '')}</h2>
                <p style="font-size:16px;color:#444;margin:0 0 2px;">of Class <strong>${escapeHtml(className)}</strong></p>
                ${attendanceLine}
                <p style="font-size:15px;color:#555;margin:14px 0 0;">has successfully completed the catechism program.</p>
                <p style="font-size:12px;color:#888;margin:8px 0 0;">Date: ${escapeHtml(formattedDate)}</p>
                <div style="display:flex;justify-content:space-between;align-items:flex-end;width:100%;margin-top:auto;padding-top:36px;gap:30px;">
                    ${sigBlock(secretaryName, 'Catechism Secretary')}
                    ${sigBlock(teacherName, 'Class Teacher')}
                    ${sigBlock(parishPriest, 'Parish Priest')}
                </div>
            </div>
        </div>`;
    }).join('');

    if (statusEl) statusEl.textContent = 'Generating certificate PDF…';
    await downloadHtmlAsPdf(certs, `Certificates_${className.replace(/\s+/g, '_')}.pdf`, 'landscape');
    if (statusEl) statusEl.textContent = `Generated ${eligible.length} certificate(s) for ${className}.`;
    createAuditLog('certificates_generated', { classId, certType, count: eligible.length });
}

// ==========================================
// FEATURE C3 — Homework Overview (Admin)
// ==========================================

let _adminHomeworkListenerActive = false;
function startAdminHomeworkListener() {
    if (_adminHomeworkListenerActive) return;
    const activeYear = getActiveAcademicYearId() || window.APP_CONTEXT?.activeAcademicYearId;
    if (!activeYear || !window.onSnapshot) return;
    _adminHomeworkListenerActive = true;
    const { db, onSnapshot, collection, query, where } = window;
    const hwQ = query(collection(db, 'homework'), where('academicYearId', '==', activeYear));
    const unsubHw = onSnapshot(hwQ, snap => {
        DATA_MODELS.homework = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAdminHomeworkTable();
    }, err => {
        _adminHomeworkListenerActive = false;
        console.error('[admin] homework listener error', err);
    });
    window.realtimeUnsubscribers.push(unsubHw);

    const subQ = query(collection(db, 'homeworkSubmissions'), where('academicYearId', '==', activeYear));
    const unsubSub = onSnapshot(subQ, snap => {
        DATA_MODELS.homeworkSubmissions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAdminHomeworkTable();
    }, err => console.error('[admin] homeworkSubmissions listener error', err));
    window.realtimeUnsubscribers.push(unsubSub);
}

function renderAdminHomeworkTable() {
    const myClassId = ADMIN_MY_CLASS_ID || null;
    const allHw = (DATA_MODELS.homework || []).slice()
        .sort((a, b) => (b.dueDate || b.createdAt || '').localeCompare(a.dueDate || a.createdAt || ''));
    const subs = DATA_MODELS.homeworkSubmissions || [];
    const classes = DATA_MODELS.classes || [];
    const today = new Date().toISOString().split('T')[0];

    // Show/hide my-class section based on whether admin has an assigned class
    const myClassCard = document.getElementById('my-class-hw-card');
    if (myClassCard) myClassCard.style.display = myClassId ? 'block' : 'none';

    // Section 1: My class assignments (with edit/delete actions)
    const myTbody = document.getElementById('my-hw-tbody');
    if (myTbody) {
        const myHw = allHw.filter(h => h.classId === myClassId);
        if (!myHw.length) {
            myTbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">No assignments yet. Click "New Assignment" to add one.</td></tr>';
        } else {
            myTbody.innerHTML = myHw.map(hw => {
                const submittedCount = subs.filter(s => s.homeworkId === hw.id && s.status !== 'pending').length;
                const roster = getCurrentAcademicYearRoster(DATA_MODELS.students || [], DATA_MODELS.enrollments || []).filter(s => s.classId === hw.classId);
                const totalStudents = roster.length;
                const isOverdue = hw.dueDate && hw.dueDate < today;
                return '<tr>'
                    + '<td><strong>' + escapeHtml(hw.title) + '</strong>'
                    + (hw.subject ? '<br><small style="color:var(--text-muted)">' + escapeHtml(hw.subject) + '</small>' : '') + '</td>'
                    + '<td>' + (hw.dueDate ? '<span style="color:' + (isOverdue ? 'var(--danger)' : 'inherit') + '">' + formatDate(hw.dueDate) + '</span>' : '—') + '</td>'
                    + '<td><button class="btn btn-sm btn-primary hw-submissions-btn" data-hw-id="' + hw.id + '" title="View Submissions"><span class="' + (submittedCount >= totalStudents && totalStudents > 0 ? 'hw-submitted' : 'hw-pending') + '">' + submittedCount + '/' + totalStudents + '</span></button></td>'
                    + '<td style="white-space:nowrap;">'
                    + '<button class="btn btn-sm btn-outline admin-hw-edit-btn" data-hw-id="' + hw.id + '"><i class="fas fa-edit"></i></button> '
                    + '<button class="btn btn-sm btn-danger admin-hw-delete-btn" data-hw-id="' + hw.id + '"><i class="fas fa-trash"></i></button>'
                    + '</td></tr>';
            }).join('');
            myTbody.querySelectorAll('.hw-submissions-btn').forEach(btn => {
                btn.addEventListener('click', () => viewAdminHomeworkSubmissions(btn.dataset.hwId));
            });
        }
    }

    // Section 2: Other classes' assignments (read-only with submissions view)
    const tbody = document.getElementById('homework-tbody');
    if (!tbody) return;
    const otherHw = allHw.filter(h => !myClassId || h.classId !== myClassId);
    if (!otherHw.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted);">No assignments from other classes.</td></tr>';
        return;
    }
    tbody.innerHTML = otherHw.map(hw => {
        const cls = classes.find(c => c.id === hw.classId);
        const clsName = cls ? (cls.name || cls.id) : (hw.classId || '—');
        const submittedCount = subs.filter(s => s.homeworkId === hw.id && s.status !== 'pending').length;
        const roster = getCurrentAcademicYearRoster(DATA_MODELS.students || [], DATA_MODELS.enrollments || []).filter(s => s.classId === hw.classId);
        const totalStudents = roster.length;
        const isOverdue = hw.dueDate && hw.dueDate < today;
        return '<tr>'
            + '<td><strong>' + escapeHtml(hw.title) + '</strong></td>'
            + '<td>' + escapeHtml(hw.subject || '—') + '</td>'
            + '<td>' + escapeHtml(clsName) + '</td>'
            + '<td style="color:' + (isOverdue ? 'var(--danger)' : 'inherit') + '">' + (hw.dueDate ? formatDate(hw.dueDate) : '—') + '</td>'
            + '<td>' + escapeHtml(hw.createdByEmail || '—') + '</td>'
            + '<td><button class="btn btn-sm btn-primary hw-submissions-btn" data-hw-id="' + hw.id + '" title="View Submissions"><span class="' + (submittedCount >= totalStudents && totalStudents > 0 ? 'hw-submitted' : 'hw-pending') + '">' + submittedCount + '/' + totalStudents + '</span></button></td>'
            + '</tr>';
    }).join('');
    tbody.querySelectorAll('.hw-submissions-btn').forEach(btn => {
        btn.addEventListener('click', () => viewAdminHomeworkSubmissions(btn.dataset.hwId));
    });
}

function openAdminHomeworkForm() {
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
    populateAdminHwClassDropdown();
    container.style.display = 'block';
    document.getElementById('hw-title').focus();
}

function editAdminHomework(hwId) {
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
    populateAdminHwClassDropdown();
    const clsSel = document.getElementById('hw-class-select');
    if (clsSel && hw.classId) clsSel.value = hw.classId;
    container.style.display = 'block';
}

function populateAdminHwClassDropdown() {
    const sel = document.getElementById('hw-class-select');
    if (!sel) return;
    const classes = (DATA_MODELS.classes || []).sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
    sel.innerHTML = '<option value="">-- Select class --</option>';
    classes.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name ? `${c.id} — ${c.name}` : c.id;
        if (c.id === ADMIN_MY_CLASS_ID) opt.selected = true;
        sel.appendChild(opt);
    });
}

async function saveAdminHomework() {
    const title = document.getElementById('hw-title')?.value?.trim();
    if (!title) return showError('Title required.');
    const classId = document.getElementById('hw-class-select')?.value || ADMIN_MY_CLASS_ID;
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

async function deleteAdminHomework(hwId) {
    const hw = (DATA_MODELS.homework || []).find(h => h.id === hwId);
    if (!hw) return;
    const confirmed = await showConfirm('Delete Assignment', `Delete "${hw.title}"? This cannot be undone.`, 'Delete');
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

function viewAdminHomeworkSubmissions(hwId) {
    const hw = (DATA_MODELS.homework || []).find(h => h.id === hwId);
    if (!hw) return;
    const cls = (DATA_MODELS.classes || []).find(c => c.id === hw.classId);
    const infoEl = document.getElementById('hw-submissions-info');
    if (infoEl) infoEl.textContent = (hw.title || '') + ' — ' + (cls?.name || hw.classId || '') + ' — Due: ' + (hw.dueDate ? formatDate(hw.dueDate) : '—');
    const students = getCurrentAcademicYearRoster(DATA_MODELS.students || [], DATA_MODELS.enrollments || [])
        .filter(s => s.classId === hw.classId)
        .sort((a, b) => (a.firstName + ' ' + a.lastName).localeCompare(b.firstName + ' ' + b.lastName));
    const subs = DATA_MODELS.homeworkSubmissions || [];
    const tbody = document.getElementById('hw-submissions-tbody');
    if (!tbody) return;
    tbody.innerHTML = students.map(s => {
        const sub = subs.find(sb => sb.homeworkId === hwId && sb.studentId === s.studentId);
        const status = sub?.status || 'pending';
        const badge = status === 'submitted' ? '<span class="hw-submitted">Submitted</span>'
            : status === 'late' ? '<span class="hw-pending" style="background:#fee2e2;color:#991b1b;">Late</span>'
            : '<span class="hw-pending">Pending</span>';
        return `<tr><td>${escapeHtml(s.firstName + ' ' + s.lastName)}</td><td>${badge}</td>
            <td><select class="hw-status-select" data-student-id="${s.studentId}" data-hw-id="${hwId}" style="padding:4px 8px;border-radius:var(--radius-sm);border:1px solid var(--border);font-size:0.82rem;">
                <option value="pending"${status === 'pending' ? ' selected' : ''}>Pending</option>
                <option value="submitted"${status === 'submitted' ? ' selected' : ''}>Submitted</option>
                <option value="late"${status === 'late' ? ' selected' : ''}>Late</option>
            </select></td></tr>`;
    }).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--text-muted);">No students.</td></tr>';
    tbody.querySelectorAll('.hw-status-select').forEach(sel => {
        sel.addEventListener('change', async function () {
            const hwId = this.dataset.hwId;
            const studentId = this.dataset.studentId;
            const hwDoc = (DATA_MODELS.homework || []).find(h => h.id === hwId);
            const existing = (DATA_MODELS.homeworkSubmissions || []).find(s => s.homeworkId === hwId && s.studentId === studentId);
            const subId = existing?.id || crypto.randomUUID();
            try {
                const subPayload = {
                    id: subId, homeworkId: hwId, studentId,
                    classId: hwDoc?.classId || '', academicYearId: getActiveAcademicYearId(),
                    status: this.value,
                };
                if (this.value === 'submitted') subPayload.submittedAt = new Date().toISOString();
                await window.setDoc(window.doc(window.db, 'homeworkSubmissions', subId), subPayload, { merge: true });
            } catch (err) { showError('Update failed: ' + err.message); }
        });
    });
    document.getElementById('hw-submissions-modal').style.display = 'flex';
}