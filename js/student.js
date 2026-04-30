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
    enrollment: null,
    academicYearLabel: 'Current Year',
    attendance: [],
    assessments: [], // Stores full assessment objects
    scores: [],      // Stores score objects
    earlyAngelEntries: [],
    earlyAngelAccessDenied: false
};

let studentProfileDirty = false;

function getStudentPortalAcademicYearId() {
    return String(currentStudent?.academicYearId || getActiveAcademicYearId() || '').trim() || null;
}

document.addEventListener('DOMContentLoaded', async function () {
    // UI Setup
    setupNav();
    document.getElementById('student-logout-btn').addEventListener('click', studentLogout);
    setupProfileEditing();

    // Initial Render (Profile)
    renderProfile();

    // Data Fetching
    showSpinner();
    try {
        await loadAcademicYearContext();
        await watchAcademicYearContext(async () => {
            location.reload();
        });
        await loadStudentEnrollmentInfo();
        await fetchStudentData();
        renderProfile();
        renderAttendance();
        renderResults();
        renderEarlyAngel();
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
    const { collection, getDocs, query, where, db } = window;
    const studentId = String(currentStudent.studentId || '').trim();
    const portalAcademicYearId = getStudentPortalAcademicYearId();

    if (!studentId) {
        throw new Error('Student ID not available for this account.');
    }

    // 1. Fetch Attendance (Where studentId == ID)
    const attQuery = query(collection(db, 'attendance'), where('studentId', '==', studentId));
    const attSnap = await getDocs(attQuery);

    // We also need session dates. Attendance docs usually link to a sessionId.
    // Optimization: Fetch all sessions first to map dates
    const sessionSnap = await getDocs(collection(db, 'sessions'));
    const sessionsMap = {};
    sessionSnap.forEach(doc => {
        const sessionData = doc.data();
        if (!portalAcademicYearId || String(sessionData?.academicYearId || '').trim() === portalAcademicYearId) {
            sessionsMap[doc.id] = sessionData;
        }
    });

    STUDENT_DATA.attendance = [];
    attSnap.forEach(doc => {
        const data = doc.data();
        if (portalAcademicYearId && String(data?.academicYearId || '').trim() !== portalAcademicYearId) return;
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
        const assessmentData = doc.data();
        if (!portalAcademicYearId || String(assessmentData?.academicYearId || '').trim() === portalAcademicYearId) {
            assessMap[doc.id] = assessmentData;
        }
    });

    STUDENT_DATA.scores = [];
    scoreSnap.forEach(scoreDoc => {
        const data = scoreDoc.data();
        if (portalAcademicYearId && String(data?.academicYearId || '').trim() !== portalAcademicYearId) return;
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

    try {
        const earlyAngelQuery = query(collection(db, 'earlyAngelEntries'), where('studentId', '==', studentId));
        const earlyAngelSnap = await getDocs(earlyAngelQuery);

        STUDENT_DATA.earlyAngelEntries = [];
        earlyAngelSnap.forEach(entryDoc => {
            const data = entryDoc.data() || {};
            if (portalAcademicYearId && String(data?.academicYearId || '').trim() !== portalAcademicYearId) return;
            STUDENT_DATA.earlyAngelEntries.push({
                id: entryDoc.id,
                ...data
            });
        });

        STUDENT_DATA.earlyAngelEntries.sort((a, b) => getEarlyAngelSortValue(b) - getEarlyAngelSortValue(a));
        STUDENT_DATA.earlyAngelAccessDenied = false;
    } catch (earlyAngelError) {
        console.warn('Early Angel data unavailable for student view:', earlyAngelError);
        STUDENT_DATA.earlyAngelEntries = [];
        STUDENT_DATA.earlyAngelAccessDenied = true;
    }
}

async function loadStudentEnrollmentInfo() {
    const { collection, getDocs, query, where, doc, getDoc, db } = window;
    const studentId = String(currentStudent.studentId || '').trim();
    const portalAcademicYearId = getStudentPortalAcademicYearId();

    STUDENT_DATA.enrollment = null;
    STUDENT_DATA.academicYearLabel = portalAcademicYearId || 'Current Year';

    if (!studentId || !portalAcademicYearId || !collection || !getDocs || !query || !where || !doc || !getDoc || !db) {
        return;
    }

    try {
        const enrollmentQuery = query(
            collection(db, 'enrollments'),
            where('academicYearId', '==', portalAcademicYearId),
            where('studentId', '==', studentId)
        );

        const enrollmentSnap = await getDocs(enrollmentQuery);
        if (!enrollmentSnap.empty) {
            STUDENT_DATA.enrollment = enrollmentSnap.docs.map(item => ({ id: item.id, ...item.data() }))[0];
        }

        const yearSnap = await getDoc(doc(db, 'academicYears', portalAcademicYearId));
        if (yearSnap.exists()) {
            const yearData = yearSnap.data() || {};
            STUDENT_DATA.academicYearLabel = yearData.yearLabel || yearData.label || portalAcademicYearId;
        }
    } catch (err) {
        console.warn('Failed to load student enrollment context:', err);
    }
}

function getEarlyAngelEntryDate(entry) {
    return String(entry?.entryDate || (entry?.createdAt || '').slice(0, 10) || '');
}

function getEarlyAngelSortValue(entry) {
    const createdAtTs = new Date(entry?.createdAt || '').getTime();
    if (!Number.isNaN(createdAtTs)) return createdAtTs;

    const entryDate = getEarlyAngelEntryDate(entry);
    if (!entryDate) return 0;

    const dateOnlyTs = new Date(`${entryDate}T00:00:00Z`).getTime();
    return Number.isNaN(dateOnlyTs) ? 0 : dateOnlyTs;
}

function getEarlyAngelEntryTimeLabel(entry) {
    if (entry?.entryTime) return String(entry.entryTime);
    const createdAt = entry?.createdAt;
    if (!createdAt) return '-';

    const createdDate = new Date(createdAt);
    if (Number.isNaN(createdDate.getTime())) return '-';
    return createdDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function toUtcDateFromYmd(ymd) {
    if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
    const dateObj = new Date(`${ymd}T00:00:00Z`);
    return Number.isNaN(dateObj.getTime()) ? null : dateObj;
}

function calculateStreakStats(dateStrings) {
    const uniqueSortedAsc = [...new Set((dateStrings || []).filter(Boolean))]
        .sort((a, b) => String(a).localeCompare(String(b)));

    if (uniqueSortedAsc.length === 0) {
        return { current: 0, longest: 0 };
    }

    let run = 1;
    let longest = 1;
    for (let idx = 1; idx < uniqueSortedAsc.length; idx++) {
        const prev = toUtcDateFromYmd(uniqueSortedAsc[idx - 1]);
        const curr = toUtcDateFromYmd(uniqueSortedAsc[idx]);
        if (!prev || !curr) {
            run = 1;
            continue;
        }

        const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86400000);
        run = diffDays === 1 ? run + 1 : 1;
        longest = Math.max(longest, run);
    }

    let current = 1;
    for (let idx = uniqueSortedAsc.length - 1; idx > 0; idx--) {
        const latest = toUtcDateFromYmd(uniqueSortedAsc[idx]);
        const previous = toUtcDateFromYmd(uniqueSortedAsc[idx - 1]);
        if (!latest || !previous) break;

        const diffDays = Math.round((latest.getTime() - previous.getTime()) / 86400000);
        if (diffDays === 1) {
            current += 1;
        } else {
            break;
        }
    }

    return { current, longest };
}

function formatMonthKey(monthKey) {
    if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return monthKey || 'N/A';
    const [year, month] = monthKey.split('-').map(Number);
    const dateObj = new Date(Date.UTC(year, month - 1, 1));
    return dateObj.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// --- RENDERING ---

function renderProfile() {
    const s = STUDENT_DATA.details;
    const enrollment = STUDENT_DATA.enrollment || {};
    document.getElementById('st-name').textContent = `${s.firstName} ${s.lastName}`;
    document.getElementById('st-id').textContent = s.studentId;
    document.getElementById('st-class').textContent = s.classId || 'N/A';
    document.getElementById('st-register-no').textContent = enrollment.registerNo ? String(enrollment.registerNo) : 'N/A';
    document.getElementById('st-academic-year').textContent = STUDENT_DATA.academicYearLabel || 'N/A';
    document.getElementById('st-enrollment-status').textContent = enrollment.status || 'Not enrolled';
    document.getElementById('st-dob').textContent = s.dob || 'N/A';
    document.getElementById('st-guardian').textContent = s.guardian || 'N/A';
    document.getElementById('st-phone').textContent = s.phone || 'N/A';

    const behaviorEl = document.getElementById('st-behavior-note');
    if (behaviorEl) {
        const behaviorText = String(s.behaviorNote || s.notes || '').trim();
        const visibilityToken = String(s.behaviorVisibility ?? '').trim().toLowerCase();
        const isBehaviorVisible =
            s.behaviorVisibility === undefined
            || s.behaviorVisibility === null
            || s.behaviorVisibility === true
            || visibilityToken === ''
            || ['show', 'visible', 'student', 'public', 'yes', 'true'].includes(visibilityToken);

        if (!behaviorText) {
            behaviorEl.textContent = 'No behavior note available.';
        } else if (!isBehaviorVisible) {
            behaviorEl.textContent = 'Behavior note is currently hidden by faculty/admin.';
        } else {
            behaviorEl.textContent = behaviorText;
        }
    }

    const earlyCountEl = document.getElementById('st-early-count');
    if (earlyCountEl) {
        const uniqueDays = new Set((STUDENT_DATA.earlyAngelEntries || []).map(getEarlyAngelEntryDate).filter(Boolean));
        earlyCountEl.textContent = String(uniqueDays.size);
    }
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
    renderAttendanceOverview(sortedAtt);

    // Chart
    renderAttendanceChart(currentStudent.studentId, {
        sessions: sortedAtt.map(a => ({ date: a.date, id: a.sessionId, status: 'Available' })), // Mock session struct for common.js
        attendance: STUDENT_DATA.attendance
    });
}

function renderAttendanceOverview(sortedAttendance) {
    const summary = {
        total: sortedAttendance.length,
        presentOrLate: 0,
        absent: 0,
        excused: 0
    };

    const monthly = new Map();
    sortedAttendance.forEach(item => {
        const status = String(item.status || '').trim();
        if (status === 'Present' || status === 'Late') summary.presentOrLate += 1;
        else if (status === 'Absent') summary.absent += 1;
        else if (status === 'Excused') summary.excused += 1;

        const monthKey = String(item.date || '').slice(0, 7);
        if (!monthKey) return;

        if (!monthly.has(monthKey)) {
            monthly.set(monthKey, {
                total: 0,
                presentOrLate: 0,
                absent: 0,
                excused: 0
            });
        }

        const monthRow = monthly.get(monthKey);
        monthRow.total += 1;
        if (status === 'Present' || status === 'Late') monthRow.presentOrLate += 1;
        else if (status === 'Absent') monthRow.absent += 1;
        else if (status === 'Excused') monthRow.excused += 1;
    });

    document.getElementById('st-att-total').textContent = String(summary.total);
    document.getElementById('st-att-present').textContent = String(summary.presentOrLate);
    document.getElementById('st-att-absent').textContent = String(summary.absent);
    document.getElementById('st-att-excused').textContent = String(summary.excused);

    const monthlyTbody = document.querySelector('#st-attendance-monthly-table tbody');
    if (!monthlyTbody) return;

    monthlyTbody.innerHTML = '';
    const rows = [...monthly.entries()].sort((a, b) => String(b[0]).localeCompare(String(a[0])));
    if (rows.length === 0) {
        monthlyTbody.innerHTML = '<tr><td colspan="6">No attendance data available.</td></tr>';
        return;
    }

    rows.forEach(([monthKey, data]) => {
        const percentage = data.total > 0 ? Math.round((data.presentOrLate / data.total) * 100) : 0;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${formatMonthKey(monthKey)}</td>
            <td>${data.total}</td>
            <td>${data.presentOrLate}</td>
            <td>${data.absent}</td>
            <td>${data.excused}</td>
            <td>${percentage}%</td>
        `;
        monthlyTbody.appendChild(row);
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

function renderEarlyAngel() {
    const entries = [...(STUDENT_DATA.earlyAngelEntries || [])].sort((a, b) => getEarlyAngelSortValue(b) - getEarlyAngelSortValue(a));
    const uniqueDays = [...new Set(entries.map(getEarlyAngelEntryDate).filter(Boolean))];
    const currentMonth = new Date().toISOString().slice(0, 7);
    const thisMonthDays = uniqueDays.filter(day => String(day).startsWith(currentMonth));
    const streak = calculateStreakStats(uniqueDays);

    document.getElementById('st-early-total-days').textContent = String(uniqueDays.length);
    document.getElementById('st-early-this-month').textContent = String(thisMonthDays.length);
    document.getElementById('st-early-current-streak').textContent = String(streak.current);
    document.getElementById('st-early-longest-streak').textContent = String(streak.longest);

    const noteEl = document.getElementById('st-early-empty-note');
    if (noteEl) {
        if (STUDENT_DATA.earlyAngelAccessDenied) {
            noteEl.textContent = 'Early Angel data is currently restricted for student view.';
        } else if (entries.length === 0) {
            noteEl.textContent = 'No Early Angel entries recorded yet.';
        } else {
            noteEl.textContent = `Showing ${entries.length} Early Angel entries.`;
        }
    }

    const tbody = document.querySelector('#st-early-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3">No records found.</td></tr>';
        return;
    }

    entries.forEach(entry => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${formatDate(getEarlyAngelEntryDate(entry))}</td>
            <td>${getEarlyAngelEntryTimeLabel(entry)}</td>
            <td>${entry.classId || currentStudent.classId || 'N/A'}</td>
        `;
        tbody.appendChild(row);
    });
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

function setupProfileEditing() {
    document.getElementById('edit-profile-btn')?.addEventListener('click', openProfileEditor);
    document.getElementById('save-profile-btn')?.addEventListener('click', saveProfileEdits);
    document.getElementById('cancel-profile-edit-btn')?.addEventListener('click', closeProfileEditor);
    document.getElementById('close-profile-modal-btn')?.addEventListener('click', closeProfileEditor);

    const modal = document.getElementById('student-profile-modal');
    modal?.addEventListener('click', (e) => {
        if (e.target === modal) closeProfileEditor();
    });
}

function openProfileEditor() {
    const s = STUDENT_DATA.details || {};
    document.getElementById('profile-first-name').value = s.firstName || '';
    document.getElementById('profile-last-name').value = s.lastName || '';
    document.getElementById('profile-dob').value = s.dob || '';
    document.getElementById('profile-phone').value = s.phone || '';
    document.getElementById('profile-guardian').value = s.guardian || '';
    document.getElementById('profile-email').value = s.email || '';
    document.getElementById('profile-notes').value = s.notes || '';

    const modal = document.getElementById('student-profile-modal');
    if (modal) modal.style.display = 'flex';
    studentProfileDirty = false;
}

function closeProfileEditor() {
    const modal = document.getElementById('student-profile-modal');
    if (modal) modal.style.display = 'none';
}

async function saveProfileEdits() {
    const firstName = document.getElementById('profile-first-name').value.trim();
    const lastName = document.getElementById('profile-last-name').value.trim();
    const dob = document.getElementById('profile-dob').value || '';
    const phone = document.getElementById('profile-phone').value.trim();
    const guardian = document.getElementById('profile-guardian').value.trim();
    const email = document.getElementById('profile-email').value.trim();
    const notes = document.getElementById('profile-notes').value.trim();

    if (!firstName || !lastName || !guardian) {
        return showError('First name, last name, and guardian name are required.');
    }

    const studentId = String(STUDENT_DATA.details?.studentId || '').trim();
    if (!studentId) {
        return showError('Student ID is missing. Please log in again.');
    }

    showSpinner();
    try {
        const updatedProfile = {
            ...STUDENT_DATA.details,
            firstName,
            lastName,
            dob,
            phone,
            guardian,
            email,
            notes,
            updatedAt: new Date().toISOString(),
        };

        await setDoc(doc(window.db, 'students', studentId), updatedProfile, { merge: true });

        STUDENT_DATA.details = updatedProfile;
        sessionStorage.setItem('currentStudent', JSON.stringify(updatedProfile));

        renderProfile();
        closeProfileEditor();
        showSuccess('Profile Saved', 'Your profile was updated successfully.');
    } catch (err) {
        console.error(err);
        showError('Failed to save profile: ' + err.message);
    } finally {
        hideSpinner();
    }
}