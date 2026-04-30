
/**
 * common.js
 * Shared utility functions for both faculty.html and admin.html.
 */

// -----------------
// 🎨 THEME TOGGLE
// -----------------
document.addEventListener('DOMContentLoaded', () => {
    const themeToggle = document.getElementById('theme-toggle');
    const currentTheme = localStorage.getItem('theme') || 'light';

    if (currentTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        if (themeToggle) themeToggle.checked = true;
    }

    if (themeToggle) {
        themeToggle.addEventListener('change', function () {
            if (this.checked) {
                document.documentElement.setAttribute('data-theme', 'dark');
                localStorage.setItem('theme', 'dark');
            } else {
                document.documentElement.setAttribute('data-theme', 'light');
                localStorage.setItem('theme', 'light');
            }
        });
    }
});

// -----------------
// 🔐 AUTH & SECURITY
// -----------------

async function logout() {
    if (typeof stopRealtimeListeners === 'function') {
        stopRealtimeListeners();
    }
    localStorage.removeItem('currentUser');
    try {
        if (window.auth && window.signOut) {
            await window.signOut(window.auth);
        }
    } catch (error) {
        console.error('Error signing out:', error);
    } finally {
        window.location.href = 'index.html';
    }
}

async function verifyRoleFromServer(uid, expectedRole) {
    if (!window.db || !window.doc || !window.getDoc) {
        throw new Error('Firestore connection not ready.');
    }
    try {
        const roleDocRef = window.doc(window.db, 'userRoles', uid);
        const docSnap = await window.getDoc(roleDocRef);

        if (!docSnap.exists()) {
            throw new Error('No role document found for this user.');
        }

        const userData = docSnap.data();
        if (userData.role !== expectedRole) {
            throw new Error(`Role mismatch. Expected "${expectedRole}", found "${userData.role}".`);
        }
        return userData;
    } catch (err) {
        console.error('Role verification failed:', err);
        throw err;
    }
}

// -----------------
// 🗓️ ACADEMIC YEAR CONTEXT
// -----------------
const APP_CONTEXT = {
    loaded: false,
    activeAcademicYearId: null,
    previousAcademicYearId: null,
    migrationEnabled: false,
};
window.APP_CONTEXT = APP_CONTEXT;

function setActiveAcademicYearContext(yearId) {
    APP_CONTEXT.loaded = true;
    APP_CONTEXT.activeAcademicYearId = yearId || null;
}

function getActiveAcademicYearId() {
    return APP_CONTEXT.activeAcademicYearId || null;
}

async function loadAcademicYearContext(forceRefresh = false) {
    if (APP_CONTEXT.loaded && !forceRefresh) {
        return APP_CONTEXT.activeAcademicYearId;
    }

    if (!window.db || !window.doc || !window.getDoc) {
        APP_CONTEXT.loaded = true;
        APP_CONTEXT.activeAcademicYearId = null;
        return null;
    }

    try {
        const configSnap = await window.getDoc(window.doc(window.db, 'appConfig', 'global'));
        if (configSnap.exists()) {
            const cfg = configSnap.data() || {};
            APP_CONTEXT.activeAcademicYearId = cfg.activeAcademicYearId || null;
        } else {
            APP_CONTEXT.activeAcademicYearId = null;
        }

        APP_CONTEXT.previousAcademicYearId = null;
        APP_CONTEXT.migrationEnabled = false;
        if (APP_CONTEXT.activeAcademicYearId) {
            const activeYearSnap = await window.getDoc(window.doc(window.db, 'academicYears', APP_CONTEXT.activeAcademicYearId));
            if (activeYearSnap.exists()) {
                const activeYear = activeYearSnap.data() || {};
                APP_CONTEXT.previousAcademicYearId = activeYear.previousYearId || null;
                APP_CONTEXT.migrationEnabled = !!activeYear.migrationEnabled;
            }
        }
    } catch (err) {
        console.warn('Failed to load academic year context:', err);
        APP_CONTEXT.activeAcademicYearId = null;
        APP_CONTEXT.previousAcademicYearId = null;
        APP_CONTEXT.migrationEnabled = false;
    }

    APP_CONTEXT.loaded = true;
    return APP_CONTEXT.activeAcademicYearId;
}

function withAcademicYear(payload) {
    const yearId = getActiveAcademicYearId();
    if (!payload || !yearId) return payload;
    return { ...payload, academicYearId: yearId };
}

function isInActiveAcademicYear(record) {
    if (!record) return false;
    const yearId = getActiveAcademicYearId();
    if (!yearId) return true;
    const previousYearId = APP_CONTEXT.previousAcademicYearId || null;
    // Keep legacy and previous-year docs visible in menus and selectors.
    return !record.academicYearId || record.academicYearId === yearId || (previousYearId && record.academicYearId === previousYearId);
}

function isCurrentAcademicYear(record) {
    if (!record) return false;
    const yearId = getActiveAcademicYearId();
    if (!yearId) return true;
    return String(record.academicYearId || '') === String(yearId);
}

function getCurrentAcademicYearRoster(students = [], enrollments = []) {
    const yearId = getActiveAcademicYearId();
    const safeStudents = Array.isArray(students) ? students : [];
    const safeEnrollments = Array.isArray(enrollments) ? enrollments : [];

    if (!yearId) {
        return safeStudents;
    }

    const studentMap = new Map(
        safeStudents.map(student => [String(student.studentId || ''), student])
    );

    return safeEnrollments
        .filter(enrollment => isCurrentAcademicYear(enrollment))
        .map(enrollment => {
            const masterProfile = studentMap.get(String(enrollment.studentId || '')) || {};
            return {
                ...masterProfile,
                ...enrollment,
                studentId: enrollment.studentId || masterProfile.studentId || '',
                classId: enrollment.classId || masterProfile.classId || '',
                fullName: enrollment.fullName || masterProfile.fullName || [masterProfile.firstName, masterProfile.lastName].filter(Boolean).join(' ').trim(),
            };
        })
        .filter(student => Boolean(student.studentId));
}

async function watchAcademicYearContext(onChange) {
    if (!window.db || !window.doc || !window.onSnapshot) return null;

    const configRef = window.doc(window.db, 'appConfig', 'global');
    const unsub = window.onSnapshot(configRef, async snapshot => {
        const previousYearId = getActiveAcademicYearId();
        const nextYearId = snapshot.exists() ? (snapshot.data()?.activeAcademicYearId || null) : null;

        setActiveAcademicYearContext(nextYearId);
        if (typeof loadAcademicYearContext === 'function') {
            await loadAcademicYearContext(true);
        }

        if (typeof onChange === 'function' && previousYearId !== nextYearId) {
            await onChange(nextYearId, previousYearId);
        }
    }, err => console.error('[realtime] appConfig listener error', err));

    return unsub;
}

async function upsertEnrollmentForStudent(student, updatedBy = '') {
    if (!student || !student.studentId || !student.classId) return null;
    if (!window.db || !window.doc || !window.getDoc || !window.setDoc) return null;

    const academicYearId = getActiveAcademicYearId();
    if (!academicYearId) return null;

    const studentId = String(student.studentId).trim();
    const classId = String(student.classId).trim();
    if (!studentId || !classId) return null;

    const enrollmentId = `${academicYearId}_${classId}_${studentId}`;
    const enrollmentRef = window.doc(window.db, 'enrollments', enrollmentId);
    const existingEnrollmentSnap = await window.getDoc(enrollmentRef);

    let registerNo = null;
    if (existingEnrollmentSnap.exists()) {
        const existingData = existingEnrollmentSnap.data() || {};
        if (existingData.registerNo !== undefined && existingData.registerNo !== null) {
            registerNo = Number(existingData.registerNo);
        }
    }

    if (registerNo === null || Number.isNaN(registerNo)) {
        const counterId = `${academicYearId}_${classId}`;
        const counterRef = window.doc(window.db, 'classYearCounters', counterId);
        const counterSnap = await window.getDoc(counterRef);
        const currentNo = counterSnap.exists() ? Number(counterSnap.data().lastRegisterNo || 0) : 0;
        registerNo = currentNo + 1;

        await window.setDoc(counterRef, {
            id: counterId,
            academicYearId,
            classId,
            lastRegisterNo: registerNo,
            updatedAt: new Date().toISOString(),
        }, { merge: true });
    }

    const fullName = [student.firstName, student.lastName].filter(Boolean).join(' ').trim();
    const enrollmentPayload = {
        id: enrollmentId,
        academicYearId,
        classId,
        studentId,
        registerNo,
        status: 'active',
        fullName: fullName || student.name || studentId,
        updatedAt: new Date().toISOString(),
    };

    if (!existingEnrollmentSnap.exists()) {
        enrollmentPayload.createdAt = new Date().toISOString();
    }
    if (updatedBy) {
        enrollmentPayload.updatedBy = updatedBy;
    }

    await window.setDoc(enrollmentRef, enrollmentPayload, { merge: true });
    return enrollmentPayload;
}

window.setActiveAcademicYearContext = setActiveAcademicYearContext;
window.getActiveAcademicYearId = getActiveAcademicYearId;
window.loadAcademicYearContext = loadAcademicYearContext;
window.withAcademicYear = withAcademicYear;
window.isInActiveAcademicYear = isInActiveAcademicYear;
window.isCurrentAcademicYear = isCurrentAcademicYear;
window.getCurrentAcademicYearRoster = getCurrentAcademicYearRoster;
window.watchAcademicYearContext = watchAcademicYearContext;
window.upsertEnrollmentForStudent = upsertEnrollmentForStudent;

// -----------------
// 🔄 SPINNER CONTROLS
// -----------------
function showSpinner(message = '') {
    const spinner = document.getElementById('full-page-spinner');
    if (spinner) {
        spinner.classList.remove('is-hidden');
    }
}

function hideSpinner() {
    const spinner = document.getElementById('full-page-spinner');
    if (spinner) {
        spinner.classList.add('is-hidden');
    }
}

// -----------------
// 🔔 SWEETALERT HELPERS
// -----------------
function showSuccess(title, text = '') {
    Swal.fire({
        icon: 'success',
        title: title,
        text: text,
        timer: 2000,
        showConfirmButton: false,
    });
}

function showError(title, text = '') {
    Swal.fire({
        icon: 'error',
        title: title,
        text: text,
    });
}

function showConfirm(title, text, confirmText = 'Yes, delete it!') {
    return Swal.fire({
        title: title,
        text: text,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: 'var(--danger)',
        cancelButtonColor: 'var(--primary)',
        confirmButtonText: confirmText
    });
}

function showConfirmWithInput(title, text, inputPlaceholder = '') {
    return Swal.fire({
        title: title,
        text: text,
        icon: 'warning',
        input: 'text',
        inputPlaceholder: inputPlaceholder,
        showCancelButton: true,
        confirmButtonColor: 'var(--danger)',
        confirmButtonText: 'Confirm',
    });
}

// -----------------
// 🛠️ UTILITY FUNCTIONS
// -----------------
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        timeZone: 'UTC',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function formatDateTime(date) {
    if (!date) return 'N/A';
    return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, chr => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[chr]));
}

function debounce(fn, wait = 300) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

function populateDropdown(selectId, data, valueKeyFn, textKeyFn) {
    const select = document.getElementById(selectId);
    if (!select) return;

    const currentValue = select.value;
    const firstOption = select.options[0] ? select.options[0].cloneNode(true) : document.createElement('option');
    if (!firstOption.value) {
        firstOption.value = "";
        firstOption.textContent = "-- Select --";
    }

    select.innerHTML = '';
    select.appendChild(firstOption);

    data.forEach(item => {
        const option = document.createElement('option');
        option.value = valueKeyFn(item);
        option.textContent = textKeyFn(item);
        select.appendChild(option);
    });

    select.value = currentValue;
}

async function createAuditLog(action, details = {}) {
    if (!window.db || !window.addDoc || !window.collection) return;

    try {
        const localUser = localStorage.getItem('currentUser');
        const currentUser = JSON.parse(localUser || '{}');

        const logEntry = {
            action: action,
            details: details,
            userEmail: currentUser.email || 'unknown',
            uid: currentUser.uid || 'unknown',
            timestamp: window.serverTimestamp ? window.serverTimestamp() : new Date()
        };

        const logCollectionRef = window.collection(window.db, 'activityLogs');
        await window.addDoc(logCollectionRef, logEntry);

    } catch (err) {
        console.warn('Failed to create audit log:', err);
    }
}

// -----------------
// 📜 REPORTING & CHARTING (Shared)
// -----------------

/**
 * UPDATED: Renders the marks chart.
 * Accepts `targetId` (string) and `enableAnimation` (bool).
 */
function renderMarksChart(assessmentDetails, targetId = 'marks-chart', enableAnimation = true) {
    const canvas = document.getElementById(targetId);
    if (!canvas) return;

    // Clear existing chart instance if it exists on this canvas
    const existingChart = Chart.getChart(canvas);
    if (existingChart) existingChart.destroy();

    const labels = assessmentDetails.map(d => d.name);
    const percentages = assessmentDetails.map(d =>
        d.totalMarks > 0 && d.marks !== null
            ? Math.round((d.marks / d.totalMarks) * 100)
            : null
    );

    // Create new chart
    new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Performance (%)',
                data: percentages,
                borderColor: '#3498db', // hardcoded hex for PDF consistency
                backgroundColor: 'rgba(52, 152, 219, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.3,
                spanGaps: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: enableAnimation ? { duration: 1000 } : false, // Disable animation for PDF
            scales: {
                y: { beginAtZero: true, max: 100 }
            }
        }
    });
}

/**
 * UPDATED: Renders the attendance chart.
 * Accepts `targetId` and `enableAnimation`.
 */
function renderAttendanceChart(studentId, DATA_MODELS, targetId = 'attendance-chart', enableAnimation = true) {
    const canvas = document.getElementById(targetId);
    if (!canvas) return;

    // Clear existing chart
    const existingChart = Chart.getChart(canvas);
    if (existingChart) existingChart.destroy();

    const monthlyAttendance = {};
    DATA_MODELS.sessions.filter(s => s.status === 'Available').forEach(session => {
        const month = session.date.substring(0, 7);
        if (!monthlyAttendance[month]) {
            monthlyAttendance[month] = { total: 0, present: 0 };
        }
        monthlyAttendance[month].total++;
        const att = DATA_MODELS.attendance.find(a => a.sessionId === session.id && a.studentId === studentId);
        if (att && (att.status === 'Present' || att.status === 'Late')) {
            monthlyAttendance[month].present++;
        }
    });

    const months = Object.keys(monthlyAttendance).sort();
    const percentages = months.map(m => {
        const d = monthlyAttendance[m];
        return d.total > 0 ? Math.round((d.present / d.total) * 100) : 0;
    });

    new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: months.map(m => m.replace('-', '/')),
            datasets: [{
                label: 'Attendance (%)',
                data: percentages,
                backgroundColor: '#27ae60', // Hardcoded hex for PDF
                borderColor: 'rgba(39, 174, 96, 0.7)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: enableAnimation ? { duration: 1000 } : false, // Disable for PDF
            scales: {
                y: { beginAtZero: true, max: 100 }
            }
        }
    });
}

// ---------------------------------------------------
// 🖨️ PRINTING & PDF EXPORT
// ---------------------------------------------------

function prepareChartsForPrint(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return () => { };

    const originalCanvases = [];

    container.querySelectorAll('canvas').forEach(canvas => {
        const parent = canvas.parentNode;
        const nextSibling = canvas.nextSibling;
        originalCanvases.push({ parent, canvas, nextSibling });

        const img = document.createElement('img');
        try {
            img.src = canvas.toDataURL('image/png');
        } catch (e) { console.warn("Canvas empty or tainted", e); }

        img.style.width = '100%';
        img.style.height = 'auto';
        img.className = 'chart-print-image';

        canvas.remove();
        if (nextSibling) {
            parent.insertBefore(img, nextSibling);
        } else {
            parent.appendChild(img);
        }
    });

    return function restoreCharts() {
        const images = container.querySelectorAll('.chart-print-image');
        images.forEach((img, index) => {
            const og = originalCanvases[index];
            if (og) {
                img.remove();
                if (og.nextSibling) {
                    og.parent.insertBefore(og.canvas, og.nextSibling);
                } else {
                    og.parent.appendChild(og.canvas);
                }
            }
        });
    };
}

function printReport(containerId, reportTitle) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const restoreCharts = prepareChartsForPrint(containerId);

    let titleEl = null;
    if (!container.querySelector('h2')) {
        titleEl = document.createElement('div');
        titleEl.innerHTML = `<h2 style="text-align:center; margin-bottom:10px;">${escapeHtml(reportTitle)}</h2>
                             <p style="text-align:center; color:gray; margin-bottom:20px;">Generated: ${new Date().toLocaleString()}</p>`;
        container.insertBefore(titleEl, container.firstChild);
    }

    window.print();

    if (titleEl) titleEl.remove();
    restoreCharts();
}

function downloadCSV(content, filename) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

/**
 * UPDATED: Fixed Download PDF logic for individual reports
 */
async function downloadReportPDF(studentId) {
    const student = getCurrentAcademicYearRoster(DATA_MODELS.students, DATA_MODELS.enrollments || [])
        .find(s => String(s.studentId) === String(studentId));
    if (!student) return alert('Student not found');

    const element = document.getElementById('report-content');

    // FIX: Scroll to top so content is visible for html2canvas
    window.scrollTo(0, 0);

    // Re-render charts WITHOUT animation
    const studentScores = DATA_MODELS.scores.filter(s => s.studentId === studentId);
    const assessmentDetails = studentScores.map(score => {
        const assessment = DATA_MODELS.assessments.find(a => a.id === score.assessmentId);
        return {
            name: assessment ? assessment.name : 'Unknown',
            totalMarks: (assessment && assessment.totalMarks > 0) ? assessment.totalMarks : 0,
            marks: score.marks
        };
    });

    // 1. Force instant render
    renderMarksChart(assessmentDetails, 'marks-chart', false);
    renderAttendanceChart(studentId, DATA_MODELS, 'attendance-chart', false);

    // FIX: Wait longer for canvas to paint (300ms)
    await new Promise(r => setTimeout(r, 300));

    // 2. Swap Charts -> Images
    const restoreCharts = prepareChartsForPrint('report-content');

    const opt = {
        margin: [10, 10, 10, 10],
        filename: `Report_${student.studentId}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, scrollY: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };

    html2pdf().set(opt).from(element).save().then(() => {
        restoreCharts();
        // Restore animation for UI
        renderMarksChart(assessmentDetails, 'marks-chart', true);
        renderAttendanceChart(studentId, DATA_MODELS, 'attendance-chart', true);
    }).catch(err => {
        console.error(err);
        restoreCharts();
    });
}

// Ensure function is exposed
window.downloadReportPDF = downloadReportPDF;

async function downloadContainerAsPDF(containerId, filename) {
    const element = document.getElementById(containerId);
    if (!element) return console.error('Container not found:', containerId);

    window.scrollTo(0, 0);

    const restoreCharts = prepareChartsForPrint(containerId);

    const opt = {
        margin: [10, 10, 10, 10],
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false, scrollY: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };

    try {
        await html2pdf().set(opt).from(element).save();
    } catch (err) {
        console.error('PDF Generation Error:', err);
    } finally {
        restoreCharts();
    }
}

// ---------------------------------------------------
// 🎓 PHASE 1: ACADEMIC YEAR CORE INFRASTRUCTURE
// ---------------------------------------------------

/**
 * PHASE 1: Initialize appConfig/global singleton
 * Creates or fetches the app-level configuration document
 */
async function initializeAppConfig() {
    if (!window.db || !window.getDoc || !window.setDoc || !window.doc) return null;

    try {
        const configRef = window.doc(window.db, 'appConfig', 'global');
        const configSnap = await window.getDoc(configRef);

        if (!configSnap.exists()) {
            // Create global config with defaults
            const defaultConfig = {
                activeAcademicYearId: null,
                earlyAngelEnabled: false,
                vbsEnabled: false,
                createdAt: window.serverTimestamp ? window.serverTimestamp() : new Date(),
                updatedAt: window.serverTimestamp ? window.serverTimestamp() : new Date()
            };
            await window.setDoc(configRef, defaultConfig);
            console.log('Created appConfig/global');
            return defaultConfig;
        } else {
            return configSnap.data();
        }
    } catch (err) {
        console.error('Failed to initialize appConfig/global:', err);
        return null;
    }
}

/**
 * PHASE 1: Set active academic year in appConfig/global
 */
async function setActiveAcademicYear(yearId) {
    if (!window.db || !window.updateDoc || !window.doc) return false;

    try {
        const configRef = window.doc(window.db, 'appConfig', 'global');
        await window.updateDoc(configRef, {
            activeAcademicYearId: yearId,
            updatedAt: window.serverTimestamp ? window.serverTimestamp() : new Date()
        });
        console.log(`Active academic year set to: ${yearId}`);
        return true;
    } catch (err) {
        console.error('Failed to set active academic year:', err);
        return false;
    }
}

/**
 * PHASE 1: Create a new academic year document
 * @param {string} yearLabel - e.g., "2026-27"
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @param {string} previousYearId - optional, for migration tracking
 */
async function createAcademicYear(yearLabel, startDate, endDate, previousYearId = null) {
    if (!window.db || !window.setDoc || !window.doc) return null;

    try {
        const yearId = yearLabel.replace(/\s+/g, '_').toLowerCase();
        const yearRef = window.doc(window.db, 'academicYears', yearId);

        const yearData = {
            id: yearId,
            yearLabel: yearLabel,
            startDate: startDate,
            endDate: endDate,
            status: 'active', // or 'archived', 'draft'
            previousYearId: previousYearId || null,
            migrationEnabled: false,
            createdAt: window.serverTimestamp ? window.serverTimestamp() : new Date(),
            updatedAt: window.serverTimestamp ? window.serverTimestamp() : new Date()
        };

        await window.setDoc(yearRef, yearData);
        console.log(`Academic year created: ${yearId}`);
        return { id: yearId, ...yearData };
    } catch (err) {
        console.error('Failed to create academic year:', err);
        return null;
    }
}

/**
 * PHASE 1: Fetch all academic years, sorted by start date descending
 */
async function fetchAllAcademicYears() {
    if (!window.db || !window.getDocs || !window.query || !window.collection) return [];

    try {
        const yearsRef = window.collection(window.db, 'academicYears');
        const yearsSnap = await window.getDocs(yearsRef);
        const years = [];
        yearsSnap.forEach(doc => {
            years.push({ id: doc.id, ...doc.data() });
        });
        // Sort by startDate descending
        years.sort((a, b) => {
            const dateA = new Date(a.startDate);
            const dateB = new Date(b.startDate);
            return dateB - dateA;
        });
        return years;
    } catch (err) {
        console.error('Failed to fetch academic years:', err);
        return [];
    }
}

/**
 * PHASE 1: Enable/disable migration for a year
 */
async function setMigrationEnabled(yearId, enabled) {
    if (!window.db || !window.updateDoc || !window.doc) return false;

    try {
        const yearRef = window.doc(window.db, 'academicYears', yearId);
        await window.updateDoc(yearRef, {
            migrationEnabled: !!enabled,
            updatedAt: window.serverTimestamp ? window.serverTimestamp() : new Date()
        });
        console.log(`Migration ${enabled ? 'enabled' : 'disabled'} for year: ${yearId}`);
        return true;
    } catch (err) {
        console.error('Failed to update migration status:', err);
        return false;
    }
}

/**
 * PHASE 1: Create or update an enrollment record
 * Links a student to a class in a specific academic year
 * Auto-generates register number from classYearCounters
 */
async function createOrUpdateEnrollment(academicYearId, classId, studentId, studentData = {}) {
    if (!window.db || !window.setDoc || !window.doc || !window.updateDoc || !window.serverTimestamp) return null;

    try {
        // Get/create class-year register counter
        const counterId = `${academicYearId}_${classId}`;
        const counterRef = window.doc(window.db, 'classYearCounters', counterId);

        // Atomic increment: get current count and increment
        const counterSnap = await window.getDoc(counterRef);
        let registerNo = 1;

        if (counterSnap.exists()) {
            registerNo = (counterSnap.data().count || 0) + 1;
        } else {
            // Create counter at 1
            await window.setDoc(counterRef, {
                academicYearId: academicYearId,
                classId: classId,
                count: 1,
                createdAt: window.serverTimestamp()
            });
        }

        // Update counter
        await window.updateDoc(counterRef, {
            count: registerNo,
            updatedAt: window.serverTimestamp()
        });

        // Create/update enrollment
        const enrollmentId = `${academicYearId}_${classId}_${studentId}`;
        const enrollmentRef = window.doc(window.db, 'enrollments', enrollmentId);

        const enrollmentData = {
            id: enrollmentId,
            academicYearId: academicYearId,
            classId: classId,
            studentId: studentId,
            registerNo: registerNo,
            status: 'active', // or 'inactive', 'transferred'
            migratedFromYearId: studentData.migratedFromYearId || null,
            createdAt: window.serverTimestamp(),
            updatedAt: window.serverTimestamp()
        };

        await window.setDoc(enrollmentRef, enrollmentData, { merge: true });
        console.log(`Enrollment created: ${enrollmentId} (Register: ${registerNo})`);
        return { id: enrollmentId, registerNo, ...enrollmentData };
    } catch (err) {
        console.error('Failed to create/update enrollment:', err);
        return null;
    }
}

/**
 * PHASE 1: Fetch enrollments for a specific class and academic year
 */
async function fetchEnrollmentsForClass(academicYearId, classId) {
    if (!window.db || !window.getDocs || !window.query || !window.collection || !window.where) return [];

    try {
        const enrollmentsRef = window.collection(window.db, 'enrollments');
        const q = window.query(
            enrollmentsRef,
            window.where('academicYearId', '==', academicYearId),
            window.where('classId', '==', classId)
        );
        const enrollmentsSnap = await window.getDocs(q);
        const enrollments = [];
        enrollmentsSnap.forEach(doc => {
            enrollments.push({ id: doc.id, ...doc.data() });
        });
        // Sort by registerNo ascending
        enrollments.sort((a, b) => a.registerNo - b.registerNo);
        return enrollments;
    } catch (err) {
        console.error('Failed to fetch enrollments:', err);
        return [];
    }
}