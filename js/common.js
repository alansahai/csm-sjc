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

/**
 * Signs the user out, stops listeners, and redirects to login.
 * This is now the single source of truth for logging out.
 */
async function logout() {
    // This function will be defined in admin.js/faculty.js
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
        window.location.href = 'index.html'; // Redirect to login
    }
}

/**
 * Verifies the user's role against Firestore.
 * This is the new security check from Section 4 of the plan.
 * @param {string} uid - The user's UID.
 * @param {string} expectedRole - The role required for the page ("admin" or "faculty").
 * @returns {object} The user's role data from Firestore.
 */
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

        // Success! Return the full user role data.
        return userData;

    } catch (err) {
        console.error('Role verification failed:', err);
        // Re-throw the error to be caught by the caller
        throw err;
    }
}

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
    // Use UTC to avoid timezone issues from date strings
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
    // Assumes 'date' is a Date object (e.g., from Firestore timestamp.toDate())
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

/**
 * Populates a <select> dropdown with data.
 * @param {string} selectId - The ID of the <select> element.
 * @param {Array} data - The array of data objects.
 * @param {Function} valueKeyFn - Function to get the value from an item.
 * @param {Function} textKeyFn - Function to get the text from an item.
 */
function populateDropdown(selectId, data, valueKeyFn, textKeyFn) {
    const select = document.getElementById(selectId);
    if (!select) return;

    const currentValue = select.value;

    // Keep the first option (e.g., "-- Select --")
    const firstOption = select.options[0] ? select.options[0].cloneNode(true) : document.createElement('option');
    if (!firstOption.value) {
        firstOption.value = "";
        firstOption.textContent = "-- Select --";
    }

    select.innerHTML = ''; // Clear all
    select.appendChild(firstOption); // Add the default back

    data.forEach(item => {
        const option = document.createElement('option');
        option.value = valueKeyFn(item);
        option.textContent = textKeyFn(item);
        select.appendChild(option);
    });

    // Restore previous selection if possible
    select.value = currentValue;
}

/**
 * Creates an audit log in Firestore.
 * @param {string} action - A short code for the action (e.g., 'student_created').
 * @param {object} details - Any extra details to store (e.g., { studentId: '101' }).
 */
async function createAuditLog(action, details = {}) {
    if (!window.db || !window.addDoc || !window.collection) return;

    try {
        const localUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
        const logEntry = {
            action,
            details,
            userEmail: localUser.email || 'unknown',
            uid: localUser.uid || 'unknown',
            timestamp: new Date() // Firestore server timestamp is better, but this is simpler
        };
        await window.addDoc(window.collection(window.db, 'activityLogs'), logEntry);
    } catch (err) {
        console.warn('Failed to create audit log:', err);
    }
}

// -----------------
// 📜 REPORTING & CHARTING (Shared)
// -----------------

/**
 * Renders the marks chart on a canvas.
 * @param {Array} assessmentDetails - Array of objects {name, marks, totalMarks}.
 */
function renderMarksChart(assessmentDetails) {
    const canvas = document.getElementById('marks-chart');
    if (!canvas) return;
    if (window.marksChart) window.marksChart.destroy(); // Destroy old chart

    const labels = assessmentDetails.map(d => d.name);
    const percentages = assessmentDetails.map(d =>
        d.totalMarks > 0 && d.marks !== null
            ? Math.round((d.marks / d.totalMarks) * 100)
            : null // Use null for "missing" data
    );

    window.marksChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Performance (%)',
                data: percentages,
                borderColor: 'var(--primary)',
                backgroundColor: 'rgba(52, 152, 219, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.3,
                spanGaps: true // Connects the line over null data points
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, max: 100 }
            }
        }
    });
}

/**
 * Renders the attendance chart on a canvas.
 * @param {string} studentId - The ID of the student.
 * @param {object} DATA_MODELS - The global data models object.
 */
function renderAttendanceChart(studentId, DATA_MODELS) {
    const canvas = document.getElementById('attendance-chart');
    if (!canvas) return;
    if (window.attendanceChart) window.attendanceChart.destroy();

    const monthlyAttendance = {};
    DATA_MODELS.sessions.filter(s => s.status === 'Available').forEach(session => {
        const month = session.date.substring(0, 7); // YYYY-MM
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

    window.attendanceChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: months.map(m => m.replace('-', '/')),
            datasets: [{
                label: 'Attendance (%)',
                data: percentages,
                backgroundColor: 'var(--success)',
                borderColor: 'rgba(39, 174, 96, 0.7)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, max: 100 }
            }
        }
    });
}

/**
 * Generates a PDF of the student report.
 * @param {string} studentId - The ID of the student.
 * @param {object} DATA_MODELS - The global data models object.
 */
function downloadReportPDF(studentId, DATA_MODELS) {
    const student = DATA_MODELS.students.find(s => s.studentId === studentId);
    if (!student) return showError('Student not found');
    const reportContainer = document.getElementById('report-content');
    if (!reportContainer) return showError('Report not generated');

    let marksDataUrl = null, attendanceDataUrl = null;
    try {
        if (window.marksChart) marksDataUrl = window.marksChart.toBase64Image();
    } catch (e) { console.warn("Could not get marks chart image", e); }
    try {
        if (window.attendanceChart) attendanceDataUrl = window.attendanceChart.toBase64Image();
    } catch (e) { console.warn("Could not get attendance chart image", e); }

    const clone = reportContainer.cloneNode(true);
    clone.querySelectorAll('.no-print').forEach(n => n.remove());

    const header = document.createElement('div');
    header.innerHTML = `<div class="report-header print-only">
            <h2>Student Report: ${escapeHtml(student.firstName)} ${escapeHtml(student.lastName)}</h2>
            <p>Generated: ${new Date().toLocaleString()}</p>
        </div>`;
    clone.insertBefore(header, clone.firstChild);

    function replaceCanvasWithImage(containerClone, selectorId, dataUrl) {
        const canvasNode = containerClone.querySelector(`#${selectorId}`);
        if (!canvasNode) return;
        const img = document.createElement('img');
        img.style.width = '100%';
        img.style.maxWidth = '100%';
        if (dataUrl) img.src = dataUrl;
        canvasNode.parentNode.replaceChild(img, canvasNode);
    }
    replaceCanvasWithImage(clone, 'marks-chart', marksDataUrl);
    replaceCanvasWithImage(clone, 'attendance-chart', attendanceDataUrl);

    const filename = `Report_${student.studentId}_${(new Date()).toISOString().slice(0, 10)}.pdf`;
    const opt = {
        margin: [10, 10, 10, 10], filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    html2pdf().set(opt).from(clone).save();
}

/**
 * Helper function to print the content of a specific container.
 * @param {string} containerId - The ID of the element to print.
 * @param {string} reportTitle - The title to display on the printout.
 */
function printReport(containerId, reportTitle) {
    const reportContainer = document.getElementById(containerId);
    if (!reportContainer) return;

    const printWindow = window.open('', '_blank', 'height=800,width=1000');
    const stylesheets = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .map(link => `<link rel="stylesheet" href="${link.href}">`)
        .join('');

    const printStyles = `
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; color: #000; }
            .no-print, .btn, .header-actions, .search-bar, [data-modal], header { display: none !important; }
            .print-only { display: block !important; }
            .report-header { text-align: center; margin-bottom: 20px; }
            table.data-table, table { width: 100% !important; border-collapse: collapse; margin: 20px 0; page-break-inside: auto; }
            tr { page-break-inside: avoid; page-break-after: auto; }
            th, td { padding: 8px; border: 1px solid #ddd; text-align: left; }
            th { background-color: #f5f7fa; }
            .report-section { page-break-inside: avoid; }
            .print-wrapper-daywise { page-break-inside: avoid !important; }
            .report-stats-grid { display: grid !important; grid-template-columns: 1fr 1fr 1fr !important; gap: 15px !important; page-break-inside: avoid !important; }
            .report-stat-card { border: 1px solid #ccc; padding: 15px; text-align: center; page-break-inside: avoid !important; }
            .attendance-list-container { display: flex !important; flex-direction: row !important; width: 100% !important; gap: 20px !important; page-break-inside: avoid !important; }
            .attendance-list { width: 50% !important; page-break-inside: avoid !important; }
            .attendance-list ul { height: auto !important; max-height: none !important; overflow-y: visible !important; border: 1px solid #ccc !important; }
            .card { border: 1px solid #ddd; box-shadow: none; }
        </style>
    `;

    printWindow.document.write(`<html><head><title>Print Report</title>${stylesheets}${printStyles}</head><body>`);
    printWindow.document.write(`<h1>${escapeHtml(reportTitle)}</h1><p>Generated on: ${new Date().toLocaleString()}</p><hr>`);
    printWindow.document.write(reportContainer.innerHTML);
    printWindow.document.write('</body></html>');
    printWindow.document.close();

    setTimeout(() => {
        printWindow.print();
        printWindow.close();
    }, 500);
}

/**
 * Helper to trigger a browser download of CSV text.
 * @param {string} content - The CSV string content.
 * @param {string} filename - The filename to save as.
 */
function downloadCSV(content, filename) {
    // Create a blob with the CSV content
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });

    // Create a temporary link element
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    // Set link attributes
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';

    // Add to DOM, click it, and remove it
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}