'use strict';

let PARENT_SESSION = null;
const PARENT_DATA = {
    student: null,
    className: '',
    academicYearId: null,
    sessions: [],
    attendance: [],
    assessments: [],
    scores: [],
    homework: [],
    submissions: {},
    announcements: []
};

document.addEventListener('DOMContentLoaded', async function () {
    const raw = sessionStorage.getItem('parentSession');
    if (!raw) { window.location.href = 'index.html'; return; }
    try { PARENT_SESSION = JSON.parse(raw); } catch (_) { window.location.href = 'index.html'; return; }
    if (!PARENT_SESSION.studentId) { window.location.href = 'index.html'; return; }

    document.getElementById('parent-child-name-display').textContent = PARENT_SESSION.studentName || 'Parent Portal';

    document.getElementById('parent-logout-btn').addEventListener('click', async function () {
        await createAuditLog('parent_logout', { studentId: PARENT_SESSION.studentId });
        sessionStorage.removeItem('parentSession');
        if (window.auth && window.signOut) {
            window.signOut(window.auth).finally(() => { window.location.href = 'index.html'; });
        } else {
            window.location.href = 'index.html';
        }
    });

    document.querySelectorAll('.parent-tab-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.parent-tab-btn').forEach(function (b) {
                b.classList.remove('btn-primary');
                b.classList.add('btn-secondary');
            });
            this.classList.add('btn-primary');
            this.classList.remove('btn-secondary');
            document.querySelectorAll('.parent-tab-content').forEach(function (t) {
                t.style.display = 'none';
            });
            const target = document.getElementById('parent-tab-' + this.dataset.tab);
            if (target) target.style.display = 'block';
        });
    });

    showSpinner('Loading your child\'s records...');
    try {
        await loadActiveYear();
        await Promise.all([
            loadStudentData(),
            loadSessions(),
            loadAttendance(),
            loadAssessments(),
            loadHomework(),
            loadAnnouncements()
        ]);
        hideSpinner();
        document.getElementById('parent-app').style.display = 'block';
        renderOverview();
        renderAttendance();
        renderResults();
        renderHomework();
        renderAnnouncements();
    } catch (err) {
        hideSpinner();
        console.error('Parent portal load error:', err);
        Swal.fire('Error', 'Failed to load data. Please try again.', 'error');
    }
});

async function loadActiveYear() {
    if (PARENT_SESSION.academicYearId) {
        PARENT_DATA.academicYearId = PARENT_SESSION.academicYearId;
        return;
    }
    try {
        const snap = await window.getDoc(window.doc(window.db, 'appConfig', 'global'));
        if (snap.exists()) {
            PARENT_DATA.academicYearId = snap.data()?.activeAcademicYearId || null;
        }
    } catch (err) {
        console.warn('Could not load academic year:', err);
    }
}

async function loadStudentData() {
    try {
        const snap = await window.getDoc(window.doc(window.db, 'students', PARENT_SESSION.studentId));
        if (snap.exists()) PARENT_DATA.student = snap.data();
    } catch (err) {
        console.warn('Could not load student:', err);
    }
    if (PARENT_SESSION.classId) {
        try {
            const cls = await window.getDoc(window.doc(window.db, 'classes', PARENT_SESSION.classId));
            PARENT_DATA.className = cls.exists() ? (cls.data().name || PARENT_SESSION.classId) : PARENT_SESSION.classId;
        } catch (_) {
            PARENT_DATA.className = PARENT_SESSION.classId;
        }
    }
}

async function loadSessions() {
    if (!PARENT_DATA.academicYearId) return;
    try {
        const snap = await window.getDocs(
            window.query(window.collection(window.db, 'sessions'), window.where('academicYearId', '==', PARENT_DATA.academicYearId))
        );
        PARENT_DATA.sessions = snap.docs.map(function (d) { return d.data(); });
    } catch (err) {
        console.warn('Could not load sessions:', err);
    }
}

async function loadAttendance() {
    if (!PARENT_DATA.academicYearId) return;
    try {
        const snap = await window.getDocs(
            window.query(
                window.collection(window.db, 'attendance'),
                window.where('studentId', '==', PARENT_SESSION.studentId),
                window.where('academicYearId', '==', PARENT_DATA.academicYearId)
            )
        );
        PARENT_DATA.attendance = snap.docs.map(function (d) { return d.data(); });
    } catch (err) {
        console.warn('Could not load attendance:', err);
    }
}

async function loadAssessments() {
    if (!PARENT_DATA.academicYearId || !PARENT_SESSION.classId) return;
    try {
        const aSnap = await window.getDocs(
            window.query(
                window.collection(window.db, 'assessments'),
                window.where('classId', '==', PARENT_SESSION.classId),
                window.where('academicYearId', '==', PARENT_DATA.academicYearId)
            )
        );
        PARENT_DATA.assessments = aSnap.docs.map(function (d) { return { id: d.id, ...d.data() }; });

        const sSnap = await window.getDocs(
            window.query(
                window.collection(window.db, 'scores'),
                window.where('studentId', '==', PARENT_SESSION.studentId),
                window.where('academicYearId', '==', PARENT_DATA.academicYearId)
            )
        );
        PARENT_DATA.scores = sSnap.docs.map(function (d) { return d.data(); });
    } catch (err) {
        console.warn('Could not load assessments:', err);
    }
}

async function loadHomework() {
    if (!PARENT_DATA.academicYearId || !PARENT_SESSION.classId) return;
    try {
        const hwSnap = await window.getDocs(
            window.query(
                window.collection(window.db, 'homework'),
                window.where('classId', '==', PARENT_SESSION.classId),
                window.where('academicYearId', '==', PARENT_DATA.academicYearId)
            )
        );
        PARENT_DATA.homework = hwSnap.docs
            .map(function (d) { return { id: d.id, ...d.data() }; })
            .sort(function (a, b) { return (b.dueDate || '').localeCompare(a.dueDate || ''); });

        const subSnap = await window.getDocs(
            window.query(
                window.collection(window.db, 'homeworkSubmissions'),
                window.where('studentId', '==', PARENT_SESSION.studentId),
                window.where('academicYearId', '==', PARENT_DATA.academicYearId)
            )
        );
        PARENT_DATA.submissions = {};
        subSnap.docs.forEach(function (d) {
            var data = d.data();
            PARENT_DATA.submissions[data.homeworkId] = data;
        });
    } catch (err) {
        console.warn('Could not load homework:', err);
    }
}

async function loadAnnouncements() {
    if (!PARENT_DATA.academicYearId) return;
    try {
        const snap = await window.getDocs(
            window.query(window.collection(window.db, 'announcements'), window.where('academicYearId', '==', PARENT_DATA.academicYearId))
        );
        PARENT_DATA.announcements = snap.docs
            .map(function (d) { return d.data(); })
            .filter(function (a) { return a.audience === 'all' || a.audience === 'students'; })
            .sort(function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.createdAt || '').localeCompare(a.createdAt || ''); });
    } catch (err) {
        console.warn('Could not load announcements:', err);
    }
}

function renderOverview() {
    var available = PARENT_DATA.sessions.filter(function (s) { return s.status === 'Available'; });
    var present = PARENT_DATA.attendance.filter(function (a) { return a.status === 'Present' || a.status === 'Late'; }).length;
    var pct = available.length ? Math.round((present / available.length) * 100) : null;

    var attEl = document.getElementById('p-att-pct');
    attEl.textContent = pct !== null ? pct + '%' : '—';
    attEl.style.color = pct === null ? 'var(--text-muted)' : pct >= 75 ? 'var(--success)' : pct >= 60 ? 'var(--warning)' : 'var(--danger)';
    document.getElementById('p-att-detail').textContent = available.length
        ? present + ' of ' + available.length + ' sessions attended'
        : 'No sessions recorded yet';

    var sortedAss = PARENT_DATA.assessments.slice().sort(function (a, b) {
        return (b.date || b.createdAt || '').localeCompare(a.date || a.createdAt || '');
    });
    var latestAss = sortedAss[0];
    if (latestAss) {
        var score = PARENT_DATA.scores.find(function (sc) { return sc.assessmentId === latestAss.id; });
        if (score && score.marks != null && latestAss.totalMarks > 0) {
            var assPct = Math.round((score.marks / latestAss.totalMarks) * 100);
            document.getElementById('p-latest-score').textContent = assPct + '%';
        } else {
            document.getElementById('p-latest-score').textContent = score ? score.marks + '/' + latestAss.totalMarks : '—';
        }
        document.getElementById('p-latest-assessment-name').textContent = latestAss.title || latestAss.name || '';
    } else {
        document.getElementById('p-latest-score').textContent = '—';
        document.getElementById('p-latest-assessment-name').textContent = 'No assessments yet';
    }

    document.getElementById('p-class-name').textContent = PARENT_DATA.className || PARENT_SESSION.classId || '—';

    var today = new Date().toISOString().split('T')[0];
    var pendingCount = PARENT_DATA.homework.filter(function (hw) {
        var sub = PARENT_DATA.submissions[hw.id];
        return !sub || sub.status === 'pending';
    }).length;
    var pendingEl = document.getElementById('p-hw-pending-count');
    pendingEl.textContent = pendingCount;
    pendingEl.style.color = pendingCount > 0 ? 'var(--warning)' : 'var(--success)';
}

function renderAttendance() {
    var summaryEl = document.getElementById('p-attendance-summary');
    var tbody = document.getElementById('p-attendance-tbody');
    var available = PARENT_DATA.sessions
        .filter(function (s) { return s.status === 'Available'; })
        .sort(function (a, b) { return b.date.localeCompare(a.date); });

    if (!available.length) {
        if (summaryEl) summaryEl.textContent = 'No sessions recorded yet.';
        if (tbody) tbody.innerHTML = '<tr><td colspan="2" style="text-align:center;color:var(--text-muted);">No sessions yet.</td></tr>';
        return;
    }

    var attMap = {};
    PARENT_DATA.attendance.forEach(function (a) { attMap[a.sessionId] = a.status; });
    var present = PARENT_DATA.attendance.filter(function (a) { return a.status === 'Present' || a.status === 'Late'; }).length;
    var pct = Math.round((present / available.length) * 100);
    if (summaryEl) summaryEl.innerHTML = '<strong>Overall: ' + pct + '%</strong> &nbsp;(' + present + ' of ' + available.length + ' sessions attended)';

    if (tbody) {
        tbody.innerHTML = available.map(function (s) {
            var status = attMap[s.sessionId || s.id] || 'No Record';
            var color = status === 'Present' ? 'var(--success)' : status === 'Late' ? 'var(--warning)' : status === 'Absent' ? 'var(--danger)' : 'var(--text-muted)';
            return '<tr><td>' + (typeof formatDate === 'function' ? formatDate(s.date) : s.date) + '</td>'
                + '<td style="color:' + color + ';font-weight:600;">' + status + '</td></tr>';
        }).join('');
    }
}

function renderResults() {
    var tbody = document.getElementById('p-results-tbody');
    if (!tbody) return;
    var assessments = PARENT_DATA.assessments.slice().sort(function (a, b) {
        return (b.date || b.createdAt || '').localeCompare(a.date || a.createdAt || '');
    });
    if (!assessments.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">No assessments yet.</td></tr>';
        return;
    }
    tbody.innerHTML = assessments.map(function (ass) {
        var score = PARENT_DATA.scores.find(function (sc) { return sc.assessmentId === ass.id; });
        var pct = score && score.marks != null && ass.totalMarks > 0
            ? Math.round((score.marks / ass.totalMarks) * 100)
            : null;
        var grade = pct !== null && typeof window.getLetterGrade === 'function' ? window.getLetterGrade(pct) : null;
        var scoreText = score && score.marks != null
            ? score.marks + '/' + (ass.totalMarks || '?') + ' (' + pct + '%)'
            : 'Not graded';
        var gradeCell = grade
            ? '<span class="grade-badge ' + grade.css + '">' + grade.grade + '</span>'
            : '—';
        return '<tr>'
            + '<td>' + escapeHtml(ass.title || ass.name || '—') + '</td>'
            + '<td>' + (ass.date ? (typeof formatDate === 'function' ? formatDate(ass.date) : ass.date) : '—') + '</td>'
            + '<td>' + escapeHtml(scoreText) + '</td>'
            + '<td>' + gradeCell + '</td>'
            + '</tr>';
    }).join('');
}

function renderHomework() {
    var container = document.getElementById('p-homework-list');
    if (!container) return;
    if (!PARENT_DATA.homework.length) {
        container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">No homework assigned yet.</p>';
        return;
    }
    var today = new Date().toISOString().split('T')[0];
    container.innerHTML = PARENT_DATA.homework.map(function (hw) {
        var sub = PARENT_DATA.submissions[hw.id];
        var status = sub ? (sub.status || 'pending') : 'pending';
        var isOverdue = hw.dueDate && hw.dueDate < today && status === 'pending';
        var badge = status === 'submitted'
            ? '<span class="hw-submitted">Submitted</span>'
            : status === 'late'
                ? '<span class="hw-pending" style="background:#fee2e2;color:#991b1b;">Late Submitted</span>'
                : isOverdue
                    ? '<span class="hw-pending" style="background:#fee2e2;color:#991b1b;">Overdue</span>'
                    : '<span class="hw-pending">Pending</span>';
        return '<div style="border:1px solid ' + (isOverdue ? 'var(--danger)' : 'var(--border)') + ';border-radius:var(--radius);padding:16px;margin-bottom:12px;background:var(--surface);">'
            + '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:6px;">'
            + '<strong style="font-size:1rem;">' + escapeHtml(hw.title) + '</strong>'
            + badge
            + '</div>'
            + (hw.subject ? '<span style="font-size:0.8rem;color:var(--text-muted);background:var(--surface-2);padding:2px 8px;border-radius:999px;display:inline-block;margin-bottom:6px;">' + escapeHtml(hw.subject) + '</span>' : '')
            + (hw.description ? '<p style="font-size:0.9rem;color:var(--text-secondary);margin:6px 0;">' + escapeHtml(hw.description) + '</p>' : '')
            + (hw.attachmentNote ? '<p style="font-size:0.82rem;color:var(--text-muted);margin:4px 0;"><i class="fas fa-paperclip"></i> ' + escapeHtml(hw.attachmentNote) + '</p>' : '')
            + '<div style="margin-top:8px;font-size:0.82rem;color:' + (isOverdue ? 'var(--danger)' : 'var(--text-muted)') + ';">'
            + '<i class="fas fa-calendar-alt"></i> Due: ' + (hw.dueDate ? (typeof formatDate === 'function' ? formatDate(hw.dueDate) : hw.dueDate) : '—')
            + '</div></div>';
    }).join('');
}

function renderAnnouncements() {
    var container = document.getElementById('p-announcements-list');
    if (!container) return;
    if (!PARENT_DATA.announcements.length) {
        container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:12px;">No announcements at this time.</p>';
        return;
    }
    container.innerHTML = PARENT_DATA.announcements.map(function (a) {
        var date = a.createdAt ? new Date(a.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
        return '<div class="announcement-card' + (a.pinned ? ' pinned' : '') + '">'
            + '<div style="font-weight:600;margin-bottom:4px;">' + (a.pinned ? '📌 ' : '') + escapeHtml(a.title) + '</div>'
            + '<div style="font-size:0.9rem;color:var(--text-secondary);">' + escapeHtml(a.body) + '</div>'
            + (date ? '<div style="font-size:0.78rem;color:var(--text-muted);margin-top:6px;">' + date + '</div>' : '')
            + '</div>';
    }).join('');
}
