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
/**
 * 🛡️ Creates an audit log in Firestore using Server Timestamp.
 */
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
            // FIX: Use serverTimestamp() for accurate, tamper-proof time
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

// ---------------------------------------------------
// 🖨️ PRINTING & PDF EXPORT (Fixes Truncation & OCR)
// ---------------------------------------------------

/**
 * Converts Chart.js canvases to Images.
 * This fixes the "Graph cut off" and "Blank Graph" issues in Print/PDF.
 * @returns {Function} A restore function to revert changes.
 */
function prepareChartsForPrint(containerId) {
    const container = document.getElementById(containerId);
    const originalCanvases = [];

    container.querySelectorAll('canvas').forEach(canvas => {
        // Save original state
        const parent = canvas.parentNode;
        const nextSibling = canvas.nextSibling;
        originalCanvases.push({ parent, canvas, nextSibling });

        // Create Image from Canvas data
        const img = document.createElement('img');
        img.src = canvas.toDataURL('image/png'); // High-quality PNG
        img.style.width = '100%';
        img.style.height = 'auto';
        img.style.maxWidth = '100%';
        img.className = 'chart-print-image'; // Marker class

        // Remove canvas, insert Image
        canvas.remove();
        if (nextSibling) {
            parent.insertBefore(img, nextSibling);
        } else {
            parent.appendChild(img);
        }
    });

    // Return a function to undo this swap
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

/**
 * Robust Print Function.
 * 1. Converts charts to images.
 * 2. Uses CSS to hide everything except the report.
 * 3. Triggers window.print().
 */
function printReport(containerId, reportTitle) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // 1. Swap Charts -> Images
    const restoreCharts = prepareChartsForPrint(containerId);

    // 2. Add title temporarily if missing
    let titleEl = null;
    if (!container.querySelector('h2')) {
        titleEl = document.createElement('div');
        titleEl.innerHTML = `<h2 style="text-align:center; margin-bottom:10px;">${escapeHtml(reportTitle)}</h2>
                             <p style="text-align:center; color:gray; margin-bottom:20px;">Generated: ${new Date().toLocaleString()}</p>`;
        container.insertBefore(titleEl, container.firstChild);
    }

    // 3. Print
    // We rely on the updated @media print CSS to hide the sidebar/buttons
    // and show only this container.
    window.print();

    // 4. Cleanup (Restore interactivity)
    if (titleEl) titleEl.remove();
    restoreCharts();
}

/**
 * "Export to PDF" using html2pdf.js.
 * Note: This creates an IMAGE-based PDF (Non-OCR).
 * For Selectable Text, use the "Print" button -> "Save as PDF".
 */
function downloadReportPDF(studentId) {
    const student = DATA_MODELS.students.find(s => s.studentId === studentId);
    if (!student) return alert('Student not found');

    const element = document.getElementById('report-content');

    // Swap charts to images to prevent cutting
    const restoreCharts = prepareChartsForPrint('report-content');

    // Options to handle page breaks better
    const opt = {
        margin: [10, 10, 10, 10], // Top, Right, Bottom, Left
        filename: `Report_${student.studentId}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, scrollY: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        // This prevents elements from being sliced in half
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };

    // Generate
    html2pdf().set(opt).from(element).save().then(() => {
        restoreCharts(); // Restore after download
    }).catch(err => {
        console.error(err);
        restoreCharts();
    });
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

/**
 * Generic function to download ANY container as a PDF.
 * Uses html2pdf and handles chart safety.
 */
/**
 * Generic function to download ANY container as a PDF.
 * Uses html2pdf and handles chart safety.
 */
/**
 * Generic function to download ANY container as a PDF.
 */
async function downloadContainerAsPDF(containerId, filename) {
    const element = document.getElementById(containerId);
    if (!element) return console.error('Container not found:', containerId);

    // Ensure html2pdf is loaded
    if (typeof html2pdf === 'undefined') {
        return alert("Error: html2pdf library not found. Please check your script tags.");
    }

    // 1. Swap Charts -> Images (If any exist)
    const restoreCharts = (typeof prepareChartsForPrint === 'function')
        ? prepareChartsForPrint(containerId)
        : () => { };

    const opt = {
        margin: [10, 10, 10, 10],
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };

    // Visual feedback
    let btn = null;
    let originalText = "";
    if (document.activeElement && document.activeElement.tagName === 'BUTTON') {
        btn = document.activeElement;
        originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
        btn.disabled = true;
    }

    try {
        await html2pdf().set(opt).from(element).save();
    } catch (err) {
        console.error('PDF Generation Error:', err);
        alert('Failed to generate PDF: ' + err.message);
    } finally {
        restoreCharts();
        if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }
}