/**
 * student.js
 * Logic for the Student Dashboard.
 */

const currentStudent = JSON.parse(sessionStorage.getItem('currentStudent'));

// --- 1. SESSION CHECK ---
if (!currentStudent) {
    window.location.href = 'index.html';
}

// Global Data Store
const STUDENT_DATA = {
    details: currentStudent,
    attendance: [],
    assessments: [], // Stores full assessment objects
    scores: []       // Stores score objects
};

document.addEventListener('DOMContentLoaded', async function () {
    // UI Setup
    setupNav();
    document.getElementById('student-logout-btn').addEventListener('click', studentLogout);

    // Initial Render (Profile)
    renderProfile();

    // Data Fetching
    showSpinner();
    try {
        await fetchStudentData();
        renderAttendance();
        renderResults();
        hideSpinner();
        document.getElementById('app-content').classList.remove('is-hidden');
    } catch (err) {
        console.error(err);
        hideSpinner();
        Swal.fire('Error', 'Failed to load data. Please try refreshing.', 'error');
    }
});

// --- DATA FETCHING ---
async function fetchStudentData() {
    const { collection, getDocs, query, where, getDoc, doc, db } = window;
    const studentId = currentStudent.studentId;

    // 1. Fetch Attendance (Where studentId == ID)
    const attQuery = query(collection(db, 'attendance'), where('studentId', '==', studentId));
    const attSnap = await getDocs(attQuery);

    // We also need session dates. Attendance docs usually link to a sessionId.
    // Optimization: Fetch all sessions first to map dates
    const sessionSnap = await getDocs(collection(db, 'sessions'));
    const sessionsMap = {};
    sessionSnap.forEach(doc => {
        sessionsMap[doc.id] = doc.data();
    });

    STUDENT_DATA.attendance = [];
    attSnap.forEach(doc => {
        const data = doc.data();
        // Merge with session date
        const session = sessionsMap[data.sessionId];
        if (session) {
            STUDENT_DATA.attendance.push({
                ...data,
                date: session.date,
                status: data.status
            });
        }
    });

    // 2. Fetch Scores (Where studentId == ID)
    const scoreQuery = query(collection(db, 'scores'), where('studentId', '==', studentId));
    const scoreSnap = await getDocs(scoreQuery);

    // Need Assessment Details (Name, Total Marks)
    // Fetch all assessments (filtered by class if possible, but fetch all is safer for matching)
    const assessSnap = await getDocs(collection(db, 'assessments'));
    const assessMap = {};
    assessSnap.forEach(doc => {
        assessMap[doc.id] = doc.data();
    });

    STUDENT_DATA.scores = [];
    scoreSnap.forEach(doc => {
        const data = doc.data();
        const assessment = assessMap[data.assessmentId];
        if (assessment) {
            STUDENT_DATA.scores.push({
                marks: data.marks,
                assessmentName: assessment.name,
                date: assessment.date,
                totalMarks: assessment.totalMarks
            });
        }
    });
}

// --- RENDERING ---

function renderProfile() {
    const s = STUDENT_DATA.details;
    document.getElementById('st-name').textContent = `${s.firstName} ${s.lastName}`;
    document.getElementById('st-id').textContent = s.studentId;
    document.getElementById('st-class').textContent = s.classId || 'N/A';
    document.getElementById('st-dob').textContent = s.dob || 'N/A';
    document.getElementById('st-guardian').textContent = s.guardian || 'N/A';
    document.getElementById('st-phone').textContent = s.phone || 'N/A';
}

function renderAttendance() {
    const tbody = document.querySelector('#st-attendance-table tbody');
    tbody.innerHTML = '';

    // Sort by Date Descending
    const sortedAtt = STUDENT_DATA.attendance.sort((a, b) => new Date(b.date) - new Date(a.date));

    let presentCount = 0;

    sortedAtt.forEach(att => {
        const row = document.createElement('tr');
        let badgeClass = 'status-absent';
        if (att.status === 'Present') { badgeClass = 'status-present'; presentCount++; }
        else if (att.status === 'Late') { badgeClass = 'status-late'; presentCount++; } // Counting late as present for basic stat
        else if (att.status === 'Excused') badgeClass = 'status-excused';

        row.innerHTML = `
            <td>${formatDate(att.date)}</td>
            <td><span class="status-badge ${badgeClass}">${att.status}</span></td>
        `;
        tbody.appendChild(row);
    });

    // Stats
    const total = sortedAtt.length;
    const perc = total > 0 ? Math.round((presentCount / total) * 100) : 0;
    document.getElementById('st-att-percent').textContent = `${perc}%`;

    // Chart
    renderAttendanceChart(currentStudent.studentId, {
        sessions: sortedAtt.map(a => ({ date: a.date, id: a.sessionId, status: 'Available' })), // Mock session struct for common.js
        attendance: STUDENT_DATA.attendance
    });
}

function renderResults() {
    const tbody = document.querySelector('#st-scores-table tbody');
    tbody.innerHTML = '';

    // 1. FOR TABLE: Sort Descending (Newest First)
    // We use [...STUDENT_DATA.scores] to create a copy so we don't mutate the original
    const scoresForTable = [...STUDENT_DATA.scores].sort((a, b) => new Date(b.date) - new Date(a.date));

    scoresForTable.forEach(score => {
        const row = document.createElement('tr');
        const percentage = score.marks !== null ? Math.round((score.marks / score.totalMarks) * 100) : 0;
        const color = percentage >= 40 ? 'green' : 'red';

        row.innerHTML = `
            <td>${score.assessmentName}</td>
            <td>${formatDate(score.date)}</td>
            <td>${score.marks !== null ? score.marks : 'Abs'}</td>
            <td>${score.totalMarks}</td>
            <td style="color:${color}; font-weight:bold;">${score.marks !== null ? percentage + '%' : '-'}</td>
        `;
        tbody.appendChild(row);
    });

    document.getElementById('st-assess-count').textContent = scoresForTable.length;

    // 2. FOR CHART: Sort Ascending (Oldest First -> Newest Last)
    // We can simply reverse the table data to flip the order for the graph
    const scoresForChart = [...scoresForTable].reverse();

    // Chart
    renderMarksChart(scoresForChart.map(s => ({
        name: s.assessmentName,
        marks: s.marks,
        totalMarks: s.totalMarks
    })));
}

// --- UTILS ---
function setupNav() {
    document.querySelectorAll('[data-tab]').forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            // Remove active
            document.querySelectorAll('[data-tab]').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            // Add active
            e.target.classList.add('active');
            const targetId = e.target.getAttribute('data-tab');
            document.getElementById(targetId).classList.add('active');
        });
    });
}

function studentLogout() {
    sessionStorage.removeItem('currentStudent');
    window.location.href = 'index.html';
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
    });
}