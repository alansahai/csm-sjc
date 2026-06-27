/**
 * vbs.js
 * VBS Portal: Turnover system with portal-backed storage,
 * manual onboarding, class-wise attendance, and report generation.
 * Uses fixed school grades: PreKG, LKG, UKG, 1-12
 */

window.addEventListener('error', (ev) => handleAppError(ev.message, ev.filename, ev.lineno));
window.addEventListener('unhandledrejection', (ev) => handleAppError(ev.reason?.message || JSON.stringify(ev.reason || 'Unknown error')));

const VBS_YEAR_FIXED = '2026';
const DELETE_CONFIRM_TEXT = 'DELETE';
const VBS_FIXED_GRADES = ['PreKG', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

const VBS_STATE = {
    user: null,
    roleData: null,
    activeAcademicYearId: null,
    portalActive: false,
    portalDocId: null,
    portalRoster: [],
    portalAttendance: [],
    availableAttendanceDates: [],
    lastTodayReportDate: '',
};

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
    } catch (e) {
        console.error(e);
    }
}

function normalizeRole(role) {
    return String(role || '').trim().toLowerCase();
}

function isAdminRole() {
    return normalizeRole(VBS_STATE.roleData?.role) === 'admin';
}

function isFacultyRole() {
    return normalizeRole(VBS_STATE.roleData?.role) === 'faculty';
}

function toYmd(dateObj = new Date()) {
    return dateObj.toISOString().slice(0, 10);
}

function slugify(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function getClassLabel(classId) {
    const cls = (VBS_STATE.classes || []).find(item => String(item.id) === String(classId));
    return cls ? `${cls.id} - ${cls.name || cls.id}` : (classId || '-');
}

function getGlobalStudentFullName(student) {
    return `${student.firstName || ''} ${student.lastName || ''}`.trim() || String(student.studentId || 'Unknown');
}

function getRosterStudentName(item) {
    return String(item.fullName || `${item.firstName || ''} ${item.lastName || ''}`.trim() || item.studentId || '').trim();
}

function isRecordInScope(record) {
    if (!record) return false;

    if (String(record.vbsYear || '') && String(record.vbsYear) !== VBS_YEAR_FIXED) {
        return false;
    }

    const activeYear = VBS_STATE.activeAcademicYearId;
    if (activeYear && String(record.academicYearId || '') && String(record.academicYearId) !== String(activeYear)) {
        return false;
    }

    if (isFacultyRole()) {
        const facultyClassId = String(VBS_STATE.roleData?.classId || '');
        if (!facultyClassId) return false;
        return String(record.classId || '') === facultyClassId;
    }

    return true;
}

// VBS portal helpers (turnover portal stored under collection 'vbs_portal')
function getPortalDocId() {
    return `${VBS_STATE.activeAcademicYearId || 'no_year'}_${VBS_YEAR_FIXED}`;
}

function getPortalDocRef() {
    const id = getPortalDocId();
    return doc(window.db, 'vbs_portal', id);
}

function getPortalStudentsCollectionRef() {
    return query(collection(window.db, 'vbsStudents'), where('portalId', '==', getPortalDocId()));
}

function getPortalAttendanceCollectionRef() {
    return query(collection(window.db, 'vbsAttendance'), where('portalId', '==', getPortalDocId()));
}

async function checkPortalExists() {
    try {
        const ref = getPortalDocRef();
        const snap = await getDoc(ref);
        VBS_STATE.portalActive = !!(snap && snap.exists());
        VBS_STATE.portalDocId = getPortalDocId();
        const statusEl = document.getElementById('vbs-portal-status');
        if (statusEl) statusEl.textContent = VBS_STATE.portalActive ? `Portal: active (${VBS_STATE.portalDocId})` : 'Portal: inactive';
    } catch (err) {
        console.warn('Failed to check portal existence', err);
        VBS_STATE.portalActive = false;
    }
}

async function createPortal() {
    const ref = getPortalDocRef();
    const payload = {
        id: getPortalDocId(),
        vbsYear: VBS_YEAR_FIXED,
        academicYearId: VBS_STATE.activeAcademicYearId || null,
        createdAt: new Date().toISOString(),
    };

    try {
        await setDoc(ref, payload, { merge: true });
        VBS_STATE.portalActive = true;
        VBS_STATE.portalDocId = payload.id;
        const statusEl = document.getElementById('vbs-portal-status');
        if (statusEl) statusEl.textContent = `Portal: active (${VBS_STATE.portalDocId})`;
        await Promise.all([loadPortalStudents(), loadPortalAttendance()]);
        renderPortalRosterTable();
        renderAttendanceTable();
        refreshTodayReportDateOptions();
        createAuditLog('vbs_portal_created', { portalId: payload.id, vbsYear: VBS_YEAR_FIXED });
        showSuccess('Portal created', 'VBS turnover portal created for active year.');
    } catch (err) {
        console.error(err);
        showError('Failed to create portal: ' + err.message);
    }
}

async function loadPortalStudents() {
    const rows = [];
    try {
        const coll = getPortalStudentsCollectionRef();
        // For VBS: load all students regardless of role/class
        const snap = await getDocs(coll);
        snap.forEach(sd => {
            const d = sd.data() || {};
            rows.push({ id: sd.id, ...d });
        });
    } catch (err) {
        console.warn('Failed to load portal students', err);
    }

    rows.sort((a, b) => {
        const classCmp = String(a.classId || '').localeCompare(String(b.classId || ''), undefined, { numeric: true });
        if (classCmp !== 0) return classCmp;
        return String(a.fullName || a.name || '').localeCompare(String(b.fullName || b.name || ''), undefined, { sensitivity: 'base' });
    });

    VBS_STATE.portalRoster = rows;
}

async function loadPortalAttendance() {
    const rows = [];
    try {
        const coll = getPortalAttendanceCollectionRef();
        // For VBS: load all attendance records regardless of role/class
        const snap = await getDocs(coll);
        snap.forEach(at => {
            const d = at.data() || {};
            rows.push({ id: at.id, ...d });
        });
    } catch (err) {
        console.warn('Failed to load portal attendance', err);
    }

    rows.sort((a, b) => {
        const dateCmp = String(b.vbsDate || '').localeCompare(String(a.vbsDate || ''));
        if (dateCmp !== 0) return dateCmp;
        const classCmp = String(a.classId || '').localeCompare(String(b.classId || ''), undefined, { numeric: true });
        if (classCmp !== 0) return classCmp;
        return String(a.studentName || '').localeCompare(String(b.studentName || ''), undefined, { sensitivity: 'base' });
    });

    VBS_STATE.portalAttendance = rows;
}

async function addPortalStudentFromForm() {
    const name = String(document.getElementById('vbs-portal-student-name')?.value || '').trim();
    const classId = String(document.getElementById('vbs-portal-student-class')?.value || '').trim();
    const father = String(document.getElementById('vbs-portal-student-father')?.value || '').trim();
    const phone = String(document.getElementById('vbs-portal-student-phone')?.value || '').trim();
    const studentIdInput = String(document.getElementById('vbs-portal-student-id')?.value || '').trim();

    if (!name || !classId) return showError('Please enter student name and class.');

    const studentId = studentIdInput || slugify(name) + '_' + Date.now();
    const docId = `${classId}_${studentId}`;

    const payload = {
        id: docId,
        portalId: getPortalDocId(),
        name,
        fullName: name,
        classId,
        studentId,
        father: father || '',
        phone: phone || '',
        vbsYear: VBS_YEAR_FIXED,
        academicYearId: VBS_STATE.activeAcademicYearId || null,
        createdAt: new Date().toISOString(),
    };

    try {
        await setDoc(doc(window.db, 'vbsStudents', docId), payload, { merge: false });
        await createAuditLog('vbs_portal_student_added', { docId, classId, studentId });
        VBS_STATE.portalRoster = [payload, ...(VBS_STATE.portalRoster || []).filter(item => String(item.id) !== docId)];
        await Promise.all([renderPortalRosterTable(), renderAttendanceTable(), refreshTodayReportDateOptions()]);
        showSuccess('Added', `${name} added to portal roster.`);
        // clear inputs
        document.getElementById('vbs-portal-student-name').value = '';
        document.getElementById('vbs-portal-student-father').value = '';
        document.getElementById('vbs-portal-student-phone').value = '';
        document.getElementById('vbs-portal-student-id').value = '';
    } catch (err) {
        console.error(err);
        showError('Failed to add portal student: ' + err.message);
    }
}

function renderPortalRosterTable() {
    const tbody = document.querySelector('#vbs-portal-students-table tbody');
    if (!tbody) return;

    const classFilter = String(document.getElementById('vbs-portal-class-filter')?.value || '').trim();
    const term = String(document.getElementById('vbs-portal-search')?.value || '').trim().toLowerCase();

    const rows = (VBS_STATE.portalRoster || []).filter(item => {
        if (!isRecordInScope(item)) return false;
        if (classFilter && String(item.classId || '') !== classFilter) return false;
        if (!term) return true;
        const hay = [item.studentId, item.fullName || item.name, item.classId, item.father, item.phone].join(' ').toLowerCase();
        return hay.includes(term);
    });

    tbody.innerHTML = '';
    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6">No portal students found.</td></tr>';
        return;
    }

    rows.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(item.studentId || '-')}</td>
            <td>${escapeHtml(item.fullName || item.name || '-')}</td>
            <td>${escapeHtml(getClassLabel(item.classId))}</td>
            <td>${escapeHtml(item.father || '-')}</td>
            <td>${escapeHtml(item.phone || '-')}</td>
            <td>
                <button class="btn btn-secondary btn-sm vbs-portal-edit-btn" data-id="${escapeHtml(item.id || '')}">Edit</button>
                <button class="btn btn-danger btn-sm vbs-portal-delete-btn" data-id="${escapeHtml(item.id || '')}">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function editPortalStudent(id) {
    const student = (VBS_STATE.portalRoster || []).find(item => String(item.id) === String(id));
    if (!student) return showError('Portal student not found.');

    const result = await Swal.fire({
        title: 'Edit Student',
        html: `
            <input id="vbs-edit-student-name" class="swal2-input" placeholder="Student name" value="${escapeHtml(student.fullName || student.name || '')}">
            <select id="vbs-edit-student-class" class="swal2-input"></select>
            <input id="vbs-edit-student-father" class="swal2-input" placeholder="Father / Guardian" value="${escapeHtml(student.father || '')}">
            <input id="vbs-edit-student-phone" class="swal2-input" placeholder="Phone" value="${escapeHtml(student.phone || '')}">
            <input id="vbs-edit-student-id" class="swal2-input" placeholder="Student ID" value="${escapeHtml(student.studentId || '')}">
        `,
        didOpen: () => {
            const classSelect = document.getElementById('vbs-edit-student-class');
            if (classSelect) {
                classSelect.innerHTML = '<option value="">Select class</option>';
                VBS_FIXED_GRADES.forEach(grade => {
                    const option = document.createElement('option');
                    option.value = grade;
                    option.textContent = grade;
                    classSelect.appendChild(option);
                });
                classSelect.value = String(student.classId || '');
            }
        },
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Save',
        preConfirm: () => ({
            name: String(document.getElementById('vbs-edit-student-name')?.value || '').trim(),
            classId: String(document.getElementById('vbs-edit-student-class')?.value || '').trim(),
            father: String(document.getElementById('vbs-edit-student-father')?.value || '').trim(),
            phone: String(document.getElementById('vbs-edit-student-phone')?.value || '').trim(),
            studentId: String(document.getElementById('vbs-edit-student-id')?.value || '').trim(),
        })
    });

    if (!result.isConfirmed) return;

    if (!result.value?.name || !result.value?.classId) {
        return showError('Student name and class are required.');
    }

    const updated = {
        ...student,
        fullName: result.value.name,
        name: result.value.name,
        classId: result.value.classId,
        father: result.value.father,
        phone: result.value.phone,
        studentId: result.value.studentId || student.studentId,
        updatedAt: new Date().toISOString(),
    };

    try {
        // If class changed, delete old attendance records to prevent orphaned data
        const oldClassId = String(student.classId || '');
        const newClassId = String(result.value.classId || '');
        const studentId = String(student.studentId || '');

        if (oldClassId && oldClassId !== newClassId && studentId) {
            const recordsToDelete = (VBS_STATE.portalAttendance || []).filter(att =>
                String(att.classId || '') === oldClassId && String(att.studentId || '') === studentId
            );

            for (const record of recordsToDelete) {
                try {
                    const attendanceId = String(record.id || '');
                    if (attendanceId) {
                        await deleteDoc(doc(window.db, 'vbsAttendance', attendanceId));
                    }
                } catch (delErr) {
                    console.warn('Failed to delete orphaned attendance record:', delErr);
                }
            }
        }

        await setDoc(doc(window.db, 'vbsStudents', id), updated, { merge: true });
        VBS_STATE.portalRoster = (VBS_STATE.portalRoster || []).map(item => String(item.id) === String(id) ? updated : item);
        createAuditLog('vbs_portal_student_updated', { id, classId: updated.classId, studentId: updated.studentId });
        renderPortalRosterTable();
        renderAttendanceTable();
        refreshTodayReportDateOptions();
        showSuccess('Updated', 'Portal student updated successfully.');
    } catch (err) {
        console.error(err);
        showError('Failed to update portal student: ' + err.message);
    }
}

async function handlePortalRosterClick(e) {
    const edit = e.target.closest('.vbs-portal-edit-btn');
    if (edit) {
        const id = String(edit.dataset.id || '').trim();
        if (id) await editPortalStudent(id);
        return;
    }

    const del = e.target.closest('.vbs-portal-delete-btn');
    if (!del) return;
    const id = String(del.dataset.id || '').trim();
    if (!id) return;

    const can = await confirmTypedDelete('portal student');
    if (!can) return;

    try {
        await deleteDoc(doc(window.db, 'vbsStudents', id));
        const removedStudent = VBS_STATE.portalRoster.find(item => String(item.id) === id);
        const studentId = String(removedStudent?.studentId || '').trim();
        const classId = String(removedStudent?.classId || '').trim();
        const linked = (VBS_STATE.portalAttendance || []).filter(item =>
            String(item.studentId || '') === studentId && String(item.classId || '') === classId
        );
        await Promise.all(linked.map(item => deleteDoc(doc(window.db, 'vbsAttendance', item.id))));
        await createAuditLog('vbs_portal_student_deleted', { id });
        VBS_STATE.portalRoster = (VBS_STATE.portalRoster || []).filter(item => String(item.id) !== id);
        VBS_STATE.portalAttendance = (VBS_STATE.portalAttendance || []).filter(item => !(String(item.studentId || '') === studentId && String(item.classId || '') === classId));
        renderPortalRosterTable();
        renderAttendanceTable();
        refreshTodayReportDateOptions();
        showSuccess('Deleted', 'Portal student deleted.');
    } catch (err) {
        console.error(err);
        showError('Failed to delete portal student: ' + err.message);
    }
}

function getAttendanceDocId(classId, studentId, dateValue) {
    return `${VBS_STATE.activeAcademicYearId || 'no_year'}_${VBS_YEAR_FIXED}_${classId}_${dateValue}_${studentId}`;
}

function getRosterDocId(classId, studentId) {
    return `${VBS_STATE.activeAcademicYearId || 'no_year'}_${VBS_YEAR_FIXED}_${classId}_${studentId}`;
}

function getJsPdfConstructor() {
    const ctor = window.jspdf?.jsPDF || window.jsPDF;
    return typeof ctor === 'function' ? ctor : null;
}

function normalizePdfText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function addPdfHeader(doc, title, subtitle) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(normalizePdfText(title), 10, 14);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text(normalizePdfText(subtitle), 10, 20);
    return 26;
}

function drawPdfTable(doc, columns, rows, startY, widths) {
    const margin = 10;
    const rowHeight = 7;
    const headerHeight = 8;
    const pageBottom = 287;

    const effectiveWidths = Array.isArray(widths) && widths.length === columns.length
        ? widths
        : columns.map(() => (190 / columns.length));

    const drawRow = (cells, y, isHeader = false) => {
        let x = margin;
        doc.setFont('helvetica', isHeader ? 'bold' : 'normal');
        doc.setFontSize(9);

        cells.forEach((cell, index) => {
            const width = Number(effectiveWidths[index] || 20);
            doc.rect(x, y, width, isHeader ? headerHeight : rowHeight);
            doc.text(normalizePdfText(cell), x + 1.5, y + (isHeader ? 5.2 : 4.8), { maxWidth: width - 3 });
            x += width;
        });
    };

    let y = startY;
    drawRow(columns, y, true);
    y += headerHeight;

    rows.forEach(row => {
        if (y + rowHeight > pageBottom) {
            doc.addPage();
            y = 12;
            drawRow(columns, y, true);
            y += headerHeight;
        }
        drawRow(row, y, false);
        y += rowHeight;
    });

    return y + 4;
}

async function confirmTypedDelete(entityLabel) {
    const result = await Swal.fire({
        icon: 'warning',
        title: `Delete ${entityLabel}?`,
        text: `This action is only for VBS and cannot be undone. Type ${DELETE_CONFIRM_TEXT} to confirm.`,
        input: 'text',
        inputPlaceholder: DELETE_CONFIRM_TEXT,
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        confirmButtonText: 'Delete',
        cancelButtonText: 'Cancel'
    });

    if (!result.isConfirmed) return false;

    if (String(result.value || '').trim().toUpperCase() !== DELETE_CONFIRM_TEXT) {
        showError('Delete cancelled: typed confirmation text did not match.');
        return false;
    }

    return true;
}

async function fetchRoleData(uid) {
    const roleRef = doc(window.db, 'userRoles', uid);
    const roleSnap = await getDoc(roleRef);
    if (!roleSnap.exists()) {
        throw new Error('No role assigned for this user.');
    }

    return { uid, ...roleSnap.data() };
}

function setupUiListeners() {
    // Tab switching with vbs-tab-btn and vbs-tab-content classes
    document.querySelectorAll('.vbs-tab-btn').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.getAttribute('data-tab');
            if (!tabName) return;

            // Remove active class from all tabs and content
            document.querySelectorAll('.vbs-tab-btn').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.vbs-tab-content').forEach(c => c.classList.remove('active'));

            // Add active class to clicked tab and corresponding content
            tab.classList.add('active');
            const contentId = tabName + '-tab';
            const contentElement = document.getElementById(contentId);
            if (contentElement) contentElement.classList.add('active');
        });
    });

    document.getElementById('logout-btn')?.addEventListener('click', logout);

    document.getElementById('profile-btn')?.addEventListener('click', () => {
        document.getElementById('profile-menu')?.classList.toggle('is-hidden');
    });

    window.addEventListener('click', (e) => {
        const menu = document.getElementById('profile-menu');
        const btn = document.getElementById('profile-btn');
        if (menu && btn && !menu.classList.contains('is-hidden') && !menu.contains(e.target) && !btn.contains(e.target)) {
            menu.classList.add('is-hidden');
        }
    });

    document.getElementById('vbs-back-btn')?.addEventListener('click', () => {
        window.location.href = isAdminRole() ? 'admin.html' : 'faculty.html';
    });

    document.getElementById('vbs-attendance-date')?.addEventListener('change', renderAttendanceTable);
    document.getElementById('vbs-attendance-class-filter')?.addEventListener('change', renderAttendanceTable);
    document.getElementById('vbs-attendance-search')?.addEventListener('input', renderAttendanceTable);
    document.getElementById('vbs-attendance-sort')?.addEventListener('change', renderAttendanceTable);
    document.querySelector('#vbs-attendance-table tbody')?.addEventListener('click', handleAttendanceActionClick);
    document.getElementById('vbs-quick-add-student-btn')?.addEventListener('click', quickAddStudentAndMarkNow);
    document.getElementById('vbs-save-attendance-btn')?.addEventListener('click', saveAttendanceForVisibleRows);

    document.getElementById('vbs-today-report-date-select')?.addEventListener('change', handleTodayReportDateChange);
    document.getElementById('vbs-generate-today-report-btn')?.addEventListener('click', generateTodayReport);
    document.getElementById('vbs-remove-attendance-range-btn')?.addEventListener('click', removeAttendanceByDateRange);
    document.getElementById('vbs-generate-detailed-report-btn')?.addEventListener('click', generateDetailedReport);
    document.getElementById('vbs-generate-100-percent-report-btn')?.addEventListener('click', generateHundredPercentReport);

    // Turnover portal UI
    document.getElementById('vbs-create-portal-btn')?.addEventListener('click', async () => {
        const confirmed = await Swal.fire({
            icon: 'question',
            title: 'Create VBS Portal?',
            text: 'This will create a dedicated vbs_portal document for the active academic year. Proceed?',
            showCancelButton: true,
            confirmButtonText: 'Create',
        });

        if (confirmed.isConfirmed) await createPortal();
    });

    document.getElementById('vbs-portal-add-btn')?.addEventListener('click', addPortalStudentFromForm);
    document.getElementById('vbs-portal-class-filter')?.addEventListener('change', renderPortalRosterTable);
    document.getElementById('vbs-portal-search')?.addEventListener('input', renderPortalRosterTable);
    document.querySelector('#vbs-portal-students-table tbody')?.addEventListener('click', handlePortalRosterClick);
}

async function reloadAllData() {
    try {
        // ensure portal state is known before loading data
        await checkPortalExists();
        if (VBS_STATE.portalActive) {
            await Promise.all([loadPortalStudents(), loadPortalAttendance()]);
            renderPortalRosterTable();
        }
        populateClassFilters();
        renderAttendanceTable();
        refreshTodayReportDateOptions();
    } catch (err) {
        console.error('Failed to reload VBS data:', err);
    }
}

function populateClassFilters() {
    // For VBS Portal: All faculty can manage all classes (no restrictions)
    const ids = [
        'vbs-portal-student-class',
        'vbs-portal-class-filter',
        'vbs-attendance-class-filter'
    ];

    ids.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (!select) return;

        const current = select.value;
        select.innerHTML = '<option value="">All Classes</option>';

        VBS_FIXED_GRADES.forEach(grade => {
            const option = document.createElement('option');
            option.value = grade;
            option.textContent = grade;
            select.appendChild(option);
        });

        if (current && [...select.options].some(option => option.value === current)) {
            select.value = current;
        }
    });
}

function sortPortalRosterRows(rows, sortMode) {
    const sorted = [...rows];

    sorted.sort((a, b) => {
        const classCmp = String(a.classId || '').localeCompare(String(b.classId || ''), undefined, { numeric: true });
        const nameA = a.fullName || a.name || '';
        const nameB = b.fullName || b.name || '';
        const nameCmp = nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
        const idCmp = String(a.studentId || '').localeCompare(String(b.studentId || ''), undefined, { numeric: true, sensitivity: 'base' });

        if (sortMode === 'name_asc') return nameCmp;
        if (sortMode === 'name_desc') return -nameCmp;
        if (sortMode === 'student_id_asc') return idCmp;
        return classCmp !== 0 ? classCmp : nameCmp;
    });

    return sorted;
}

function buildAttendanceRowsForView() {
    const classFilter = String(document.getElementById('vbs-attendance-class-filter')?.value || '').trim();
    const term = String(document.getElementById('vbs-attendance-search')?.value || '').trim().toLowerCase();
    const sortMode = String(document.getElementById('vbs-attendance-sort')?.value || 'class_name_asc');
    const dateValue = String(document.getElementById('vbs-attendance-date')?.value || toYmd());

    // Use portal roster if portal is active, otherwise use global roster
    const sourceRoster = VBS_STATE.portalActive ? (VBS_STATE.portalRoster || []) : (VBS_STATE.roster || []);
    const sourceAttendance = VBS_STATE.portalActive ? (VBS_STATE.portalAttendance || []) : (VBS_STATE.attendance || []);

    const filteredRoster = sourceRoster.filter(item => {
        if (VBS_STATE.portalActive && !isRecordInScope(item)) return false;
        if (classFilter && String(item.classId || '') !== classFilter) return false;
        if (!term) return true;

        const haystack = [
            item.studentId,
            VBS_STATE.portalActive ? (item.fullName || item.name) : getRosterStudentName(item),
            item.classId,
            VBS_STATE.portalActive ? item.father : item.guardian,
            item.phone
        ].join(' ').toLowerCase();

        return haystack.includes(term);
    });

    const sortedRoster = sortPortalRosterRows(filteredRoster, sortMode);

    return sortedRoster.map(item => {
        const existing = sourceAttendance.find(att =>
            String(att.classId || '') === String(item.classId || '')
            && String(att.studentId || '') === String(item.studentId || '')
            && String(att.vbsDate || '') === dateValue
        );

        return {
            roster: item,
            existing,
            status: existing?.status || 'Present',
        };
    });
}

function getFixedGradeSortValue(classId) {
    const index = VBS_FIXED_GRADES.indexOf(String(classId || ''));
    return index === -1 ? 999 : index;
}

function compareClassIds(a, b) {
    const gradeCmp = getFixedGradeSortValue(a) - getFixedGradeSortValue(b);
    if (gradeCmp !== 0) return gradeCmp;
    return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
}

function getAttendanceStatusSortValue(status) {
    const normalized = String(status || '').trim();
    if (normalized === 'Present') return 0;
    if (normalized === 'Absent') return 1;
    return 2;
}

function formatMatrixDateLabel(dateValue) {
    const parts = String(dateValue || '').split('-');
    if (parts.length === 3) {
        return `${parts[2]}/${parts[1]}`;
    }
    return String(dateValue || '');
}

function drawLandscapeMatrixTable(doc, columns, rows, startY, widths) {
    const margin = 10;
    const rowHeight = 7;
    const headerHeight = 9;
    const pageBottom = 195;

    const drawRow = (cells, y, isHeader = false, highlightedColumns = []) => {
        let x = margin;
        const cellHeight = isHeader ? headerHeight : rowHeight;
        const isFullRowHighlighted = !isHeader && cells.length > 0 && highlightedColumns.length === cells.length;

        if (isFullRowHighlighted) {
            const totalWidth = widths.slice(0, cells.length).reduce((sum, value) => sum + Number(value || 20), 0);
            doc.setFillColor(220, 245, 220);
            doc.rect(margin, y, totalWidth, cellHeight, 'F');
        }

        doc.setFont('helvetica', isHeader ? 'bold' : 'normal');
        doc.setFontSize(8);

        cells.forEach((cell, index) => {
            const width = Number(widths[index] || 20);
            const shouldHighlight = !isHeader && highlightedColumns.includes(index);
            if (shouldHighlight && !isFullRowHighlighted) {
                doc.setFillColor(220, 245, 220);
                doc.rect(x, y, width, cellHeight, 'FD');
            } else {
                doc.rect(x, y, width, cellHeight);
            }
            doc.text(normalizePdfText(cell), x + 1.5, y + (isHeader ? 5.5 : 4.8), { maxWidth: width - 3 });
            x += width;
        });
    };

    let y = startY;
    drawRow(columns, y, true);
    y += headerHeight;

    rows.forEach(row => {
        const rowCells = Array.isArray(row) ? row : (Array.isArray(row?.cells) ? row.cells : []);
        const highlightedColumns = Array.isArray(row?.highlightColumns)
            ? row.highlightColumns
            : (row?.highlightAll ? rowCells.map((_, index) => index) : []);

        if (y + rowHeight > pageBottom) {
            doc.addPage('a4', 'l');
            y = 12;
            drawRow(columns, y, true);
            y += headerHeight;
        }

        drawRow(rowCells, y, false, highlightedColumns);
        y += rowHeight;
    });
}

function renderAttendanceTable() {
    const dateInput = document.getElementById('vbs-attendance-date');
    if (dateInput && !dateInput.value) {
        dateInput.value = toYmd();
    }

    const tbody = document.querySelector('#vbs-attendance-table tbody');
    if (!tbody) return;

    const rows = buildAttendanceRowsForView();
    tbody.innerHTML = '';

    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5">No roster students found for selected filters.</td></tr>';
        return;
    }

    rows.forEach(row => {
        const roster = row.roster;
        const isPortalMode = VBS_STATE.portalActive;
        const studentName = isPortalMode ? (roster.fullName || roster.name) : getRosterStudentName(roster);
        const tr = document.createElement('tr');
        tr.dataset.studentId = String(roster.studentId || '');
        tr.dataset.classId = String(roster.classId || '');

        const deleteBtn = row.existing
            ? `<button class="btn btn-secondary btn-sm vbs-edit-attendance-btn" data-id="${escapeHtml(row.existing.id || '')}">Edit</button> <button class="btn btn-danger btn-sm vbs-delete-attendance-btn" data-id="${escapeHtml(row.existing.id || '')}"><i class="fas fa-trash"></i> Delete</button>`
            : '-';

        tr.innerHTML = `
            <td>${escapeHtml(roster.studentId || '-')}</td>
            <td>${escapeHtml(studentName || '-')}</td>
            <td>${escapeHtml(getClassLabel(roster.classId))}</td>
            <td>
                <select class="vbs-attendance-status">
                    <option value="Present" ${row.status === 'Present' ? 'selected' : ''}>Present</option>
                    <option value="Absent" ${row.status === 'Absent' ? 'selected' : ''}>Absent</option>
                </select>
            </td>
            <td>${deleteBtn}</td>
        `;

        tbody.appendChild(tr);
    });
}

async function handleAttendanceActionClick(e) {
    const editBtn = e.target.closest('.vbs-edit-attendance-btn');
    if (editBtn) {
        const attendanceId = String(editBtn.dataset.id || '').trim();
        if (attendanceId) await editAttendanceEntry(attendanceId);
        return;
    }

    const deleteBtn = e.target.closest('.vbs-delete-attendance-btn');
    if (!deleteBtn) return;

    const attendanceId = String(deleteBtn.dataset.id || '').trim();
    if (!attendanceId) return;

    const sourceAttendance = VBS_STATE.portalActive ? (VBS_STATE.portalAttendance || []) : (VBS_STATE.attendance || []);
    const target = sourceAttendance.find(item => String(item.id) === attendanceId);
    if (!target) return showError('Attendance entry not found. Please refresh.');

    const canDelete = await confirmTypedDelete(`attendance entry for ${target.studentName || target.studentId || 'student'}`);
    if (!canDelete) return;

    try {
        if (VBS_STATE.portalActive) {
            await deleteDoc(doc(window.db, 'vbsAttendance', attendanceId));
            VBS_STATE.portalAttendance = (VBS_STATE.portalAttendance || []).filter(item => String(item.id) !== attendanceId);
        } else {
            await deleteDoc(doc(window.db, 'vbsAttendance', attendanceId));
            VBS_STATE.attendance = (VBS_STATE.attendance || []).filter(item => String(item.id) !== attendanceId);
        }
        await createAuditLog('vbs_attendance_deleted', {
            attendanceId,
            classId: target.classId,
            studentId: target.studentId,
            vbsDate: target.vbsDate,
            vbsYear: VBS_YEAR_FIXED,
        });

        renderAttendanceTable();
        refreshTodayReportDateOptions();
        showSuccess('Deleted', 'Attendance entry deleted.');
    } catch (err) {
        console.error(err);
        showError('Failed to delete attendance entry: ' + err.message);
    }
}

async function editAttendanceEntry(attendanceId) {
    const entry = (VBS_STATE.portalAttendance || []).find(item => String(item.id) === attendanceId);
    if (!entry) return showError('Attendance entry not found.');

    const result = await Swal.fire({
        title: 'Edit Attendance',
        html: `
            <select id="vbs-edit-attendance-status" class="swal2-input">
                <option value="Present">Present</option>
                <option value="Absent">Absent</option>
            </select>
            <input id="vbs-edit-attendance-date" type="date" class="swal2-input" value="${escapeHtml(entry.vbsDate || toYmd())}">
        `,
        didOpen: () => {
            const statusSelect = document.getElementById('vbs-edit-attendance-status');
            if (statusSelect) statusSelect.value = String(entry.status || 'Present');
        },
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Save',
        preConfirm: () => ({
            status: String(document.getElementById('vbs-edit-attendance-status')?.value || 'Present'),
            vbsDate: String(document.getElementById('vbs-edit-attendance-date')?.value || '').trim(),
        })
    });

    if (!result.isConfirmed) return;
    if (!result.value?.vbsDate) return showError('Attendance date is required.');

    const updated = {
        ...entry,
        status: result.value.status,
        vbsDate: result.value.vbsDate,
        updatedAt: new Date().toISOString(),
    };

    try {
        if (VBS_STATE.portalActive) {
            await setDoc(doc(window.db, 'vbsAttendance', attendanceId), updated, { merge: true });
            VBS_STATE.portalAttendance = (VBS_STATE.portalAttendance || []).map(item => String(item.id) === attendanceId ? updated : item);
        } else {
            await setDoc(doc(window.db, 'vbsAttendance', attendanceId), updated, { merge: true });
            VBS_STATE.attendance = (VBS_STATE.attendance || []).map(item => String(item.id) === attendanceId ? updated : item);
        }
        createAuditLog('vbs_attendance_entry_updated', { attendanceId, status: updated.status, vbsDate: updated.vbsDate });
        renderAttendanceTable();
        refreshTodayReportDateOptions();
        showSuccess('Updated', 'Attendance entry updated successfully.');
    } catch (err) {
        console.error(err);
        showError('Failed to update attendance entry: ' + err.message);
    }
}

async function quickAddStudentAndMarkNow() {
    if (!VBS_STATE.portalActive) {
        return showError('Portal mode must be active to use this feature.');
    }

    const result = await Swal.fire({
        title: 'Add Student & Mark Attendance',
        html: `
            <input id="qa-student-name" class="swal2-input" placeholder="Student name" autofocus>
            <select id="qa-student-class" class="swal2-input"></select>
            <input id="qa-student-father" class="swal2-input" placeholder="Father / Guardian (optional)">
            <input id="qa-student-phone" class="swal2-input" placeholder="Phone (optional)">
            <div style="margin: 12px 0;">
                <label style="font-weight: 500; color: #333;">Mark as:</label>
                <select id="qa-attendance-status" class="swal2-input">
                    <option value="Present">Present</option>
                    <option value="Absent">Absent</option>
                </select>
            </div>
        `,
        didOpen: () => {
            const classSelect = document.getElementById('qa-student-class');
            if (classSelect) {
                classSelect.innerHTML = '<option value="">Select class</option>';
                VBS_FIXED_GRADES.forEach(grade => {
                    const option = document.createElement('option');
                    option.value = grade;
                    option.textContent = grade;
                    classSelect.appendChild(option);
                });
            }
        },
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Add & Mark',
        preConfirm: () => ({
            name: String(document.getElementById('qa-student-name')?.value || '').trim(),
            classId: String(document.getElementById('qa-student-class')?.value || '').trim(),
            father: String(document.getElementById('qa-student-father')?.value || '').trim(),
            phone: String(document.getElementById('qa-student-phone')?.value || '').trim(),
            status: String(document.getElementById('qa-attendance-status')?.value || 'Present').trim(),
        })
    });

    if (!result.isConfirmed) return;

    if (!result.value?.name || !result.value?.classId) {
        return showError('Student name and class are required.');
    }

    const studentId = slugify(result.value.name) + '_' + Date.now();
    const docId = `${result.value.classId}_${studentId}`;

    const portalDocId = getPortalDocId();
    const studentPayload = {
        id: docId,
        portalId: portalDocId,
        name: result.value.name,
        fullName: result.value.name,
        classId: result.value.classId,
        studentId,
        father: result.value.father || '',
        phone: result.value.phone || '',
        vbsYear: VBS_YEAR_FIXED,
        academicYearId: VBS_STATE.activeAcademicYearId || null,
        createdAt: new Date().toISOString(),
    };

    const attendanceDate = String(document.getElementById('vbs-attendance-date')?.value || '').trim() || toYmd();
    const attendanceDocId = getAttendanceDocId(result.value.classId, studentId, attendanceDate);

    const attendancePayload = {
        id: attendanceDocId,
        portalId: portalDocId,
        vbsStudentId: docId,
        vbsYear: VBS_YEAR_FIXED,
        academicYearId: VBS_STATE.activeAcademicYearId || null,
        classId: result.value.classId,
        studentId,
        studentName: result.value.name,
        status: result.value.status,
        vbsDate: attendanceDate,
        createdAt: new Date().toISOString(),
    };

    try {
        // Add student to roster
        await setDoc(doc(window.db, 'vbsStudents', docId), studentPayload, { merge: false });

        // Mark attendance immediately
        await setDoc(doc(window.db, 'vbsAttendance', attendanceDocId), attendancePayload, { merge: true });

        // Update local state
        VBS_STATE.portalRoster = [studentPayload, ...(VBS_STATE.portalRoster || [])];
        VBS_STATE.portalAttendance = [attendancePayload, ...(VBS_STATE.portalAttendance || [])];

        await createAuditLog('vbs_quick_add_student', {
            docId,
            studentId,
            classId: result.value.classId,
            attendanceDate,
            attendanceStatus: result.value.status,
        });

        // Refresh UI
        renderAttendanceTable();
        refreshTodayReportDateOptions();
        showSuccess('Added & Marked', `${result.value.name} added to class ${result.value.classId} and marked ${result.value.status} for ${attendanceDate}.`);
    } catch (err) {
        console.error(err);
        showError('Failed to add student and mark attendance: ' + err.message);
    }
}

async function saveAttendanceForVisibleRows() {
    const dateValue = String(document.getElementById('vbs-attendance-date')?.value || '').trim() || toYmd();
    const rows = [...document.querySelectorAll('#vbs-attendance-table tbody tr[data-student-id]')];

    if (rows.length === 0) {
        return showError('No visible rows to save attendance.');
    }

    const sourceRoster = VBS_STATE.portalActive ? (VBS_STATE.portalRoster || []) : (VBS_STATE.roster || []);

    const updates = rows.map(row => {
        const studentId = String(row.dataset.studentId || '').trim();
        const classId = String(row.dataset.classId || '').trim();
        const status = String(row.querySelector('.vbs-attendance-status')?.value || 'Absent');

        const roster = sourceRoster.find(item =>
            String(item.studentId || '') === studentId
            && String(item.classId || '') === classId
        );

        const studentName = VBS_STATE.portalActive
            ? (roster ? (roster.fullName || roster.name) : studentId)
            : (roster ? getRosterStudentName(roster) : studentId);

        const docId = getAttendanceDocId(classId, studentId, dateValue);

        const portalDocId = getPortalDocId();
        return {
            docId,
            payload: {
                id: docId,
                portalId: portalDocId,
                vbsStudentId: `${classId}_${studentId}`,
                vbsYear: VBS_YEAR_FIXED,
                academicYearId: VBS_STATE.activeAcademicYearId || null,
                classId,
                studentId,
                studentName,
                status,
                vbsDate: dateValue,
                updatedAt: new Date().toISOString(),
                    }
        };
    });

    try {
        await Promise.all(updates.map(item =>
            setDoc(doc(window.db, 'vbsAttendance', item.docId), item.payload, { merge: true })
        ));
        const updatedMap = new Map(updates.map(item => [item.docId, item.payload]));
        if (VBS_STATE.portalActive) {
            VBS_STATE.portalAttendance = (VBS_STATE.portalAttendance || []).filter(item => !updatedMap.has(item.id)).concat([...updatedMap.values()]);
        } else {
            VBS_STATE.attendance = (VBS_STATE.attendance || []).filter(item => !updatedMap.has(item.id)).concat([...updatedMap.values()]);
        }
        await createAuditLog('vbs_attendance_saved', {
            count: updates.length,
            vbsDate: dateValue,
            vbsYear: VBS_YEAR_FIXED,
            classId: isFacultyRole() ? VBS_STATE.roleData?.classId || null : (document.getElementById('vbs-attendance-class-filter')?.value || null),
            academicYearId: VBS_STATE.activeAcademicYearId || null,
            portalMode: VBS_STATE.portalActive,
        });

        renderAttendanceTable();
        refreshTodayReportDateOptions();
        showSuccess('Attendance Saved', `${updates.length} attendance records saved.`);
    } catch (err) {
        console.error(err);
        showError('Failed to save attendance: ' + err.message);
    }
}

function renderTodayReportDateMeta() {
    const box = document.getElementById('vbs-report-date-meta');
    if (!box) return;

    const dates = VBS_STATE.availableAttendanceDates || [];
    if (dates.length === 0) {
        box.innerHTML = '<span class="ea-date-pill empty">No dates</span>';
        return;
    }

    box.innerHTML = dates.slice(0, 8).map(dateValue => (
        `<span class="ea-date-pill">${escapeHtml(formatDate(dateValue))}</span>`
    )).join('');
}

function refreshTodayReportDateOptions() {
    const select = document.getElementById('vbs-today-report-date-select');
    const note = document.getElementById('vbs-report-date-note');
    const todayBtn = document.getElementById('vbs-generate-today-report-btn');
    const detailedBtn = document.getElementById('vbs-generate-detailed-report-btn');
    if (!select) return;

    const sourceAttendance = VBS_STATE.portalActive ? (VBS_STATE.portalAttendance || []) : (VBS_STATE.attendance || []);
    const uniqueDates = [...new Set(sourceAttendance.map(item => String(item.vbsDate || '').trim()).filter(Boolean))]
        .sort((a, b) => String(b).localeCompare(String(a)));

    VBS_STATE.availableAttendanceDates = uniqueDates;
    renderTodayReportDateMeta();

    select.innerHTML = '';
    if (uniqueDates.length === 0) {
        select.appendChild(new Option('No attendance dates available', ''));
        select.disabled = true;
        if (todayBtn) todayBtn.disabled = true;
        if (detailedBtn) detailedBtn.disabled = true;
        if (note) note.textContent = 'Mark attendance first to generate reports.';
        VBS_STATE.lastTodayReportDate = '';
        return;
    }

    uniqueDates.forEach(dateValue => {
        select.appendChild(new Option(formatDate(dateValue), dateValue));
    });

    select.disabled = false;
    if (todayBtn) todayBtn.disabled = false;
    if (detailedBtn) detailedBtn.disabled = false;

    const today = toYmd();
    let selectedDate = today;

    if (VBS_STATE.lastTodayReportDate && uniqueDates.includes(VBS_STATE.lastTodayReportDate)) {
        selectedDate = VBS_STATE.lastTodayReportDate;
    } else if (!uniqueDates.includes(today)) {
        selectedDate = uniqueDates[0];
    }

    if (!uniqueDates.includes(selectedDate)) {
        selectedDate = uniqueDates[0];
    }

    select.value = selectedDate;
    VBS_STATE.lastTodayReportDate = selectedDate;
    if (note) {
        note.textContent = uniqueDates.includes(today)
            ? 'Default is current date. Selecting another date will show a warning.'
            : 'Current date has no attendance entries. Latest available date selected.';
    }
}

async function handleTodayReportDateChange(e) {
    const selectedDate = String(e.target?.value || '').trim();
    if (!selectedDate) return;

    const today = toYmd();
    if (selectedDate !== today) {
        const result = await Swal.fire({
            icon: 'warning',
            title: 'Use another date?',
            text: `You selected ${formatDate(selectedDate)}. This is not the current date.`,
            showCancelButton: true,
            confirmButtonText: 'Use this date',
            cancelButtonText: 'Keep current date'
        });

        if (!result.isConfirmed) {
            const fallback = (VBS_STATE.availableAttendanceDates || []).includes(today)
                ? today
                : (VBS_STATE.lastTodayReportDate || selectedDate);
            e.target.value = fallback;
            VBS_STATE.lastTodayReportDate = fallback;
            return;
        }
    }

    VBS_STATE.lastTodayReportDate = selectedDate;
}

async function removeAttendanceByDateRange() {
    const sourceAttendance = VBS_STATE.portalActive ? (VBS_STATE.portalAttendance || []) : (VBS_STATE.attendance || []);
    if (sourceAttendance.length === 0) {
        return showError('No attendance entries available to remove.');
    }

    const uniqueDates = [...new Set(sourceAttendance.map(item => String(item.vbsDate || '').trim()).filter(Boolean))]
        .sort((a, b) => String(a).localeCompare(String(b)));

    const defaultDate = String(document.getElementById('vbs-today-report-date-select')?.value || uniqueDates[0] || '').trim();
    const result = await Swal.fire({
        title: 'Remove Test Attendance',
        html: `
            <div style="text-align:left; margin-bottom: 10px; color:#555; font-size:14px;">
                Remove attendance records for the selected date range. This permanently deletes them from Firestore.
            </div>
            <label style="display:block; text-align:left; font-size:13px; margin-bottom:4px;">From Date</label>
            <input id="vbs-remove-attendance-from" type="date" class="swal2-input" value="${escapeHtml(defaultDate)}">
            <label style="display:block; text-align:left; font-size:13px; margin-bottom:4px;">To Date</label>
            <input id="vbs-remove-attendance-to" type="date" class="swal2-input" value="${escapeHtml(defaultDate)}">
        `,
        showCancelButton: true,
        confirmButtonText: 'Remove',
        cancelButtonText: 'Cancel',
        focusConfirm: false,
        preConfirm: () => ({
            fromDate: String(document.getElementById('vbs-remove-attendance-from')?.value || '').trim(),
            toDate: String(document.getElementById('vbs-remove-attendance-to')?.value || '').trim(),
        })
    });

    if (!result.isConfirmed) return;

    const fromDate = result.value?.fromDate;
    const toDate = result.value?.toDate;
    if (!fromDate || !toDate) {
        return showError('Select both from and to dates.');
    }

    if (String(fromDate).localeCompare(String(toDate)) > 0) {
        return showError('From Date cannot be after To Date.');
    }

    const entriesToDelete = sourceAttendance.filter(item => {
        const dateValue = String(item.vbsDate || '').trim();
        return dateValue && dateValue >= fromDate && dateValue <= toDate;
    });

    if (entriesToDelete.length === 0) {
        return showError('No attendance entries found in the selected range.');
    }

    const confirmDelete = await Swal.fire({
        icon: 'warning',
        title: 'Confirm Deletion',
        text: `Delete ${entriesToDelete.length} attendance record(s) from ${formatDate(fromDate)} to ${formatDate(toDate)}?`,
        showCancelButton: true,
        confirmButtonText: 'Yes, delete them',
        cancelButtonText: 'Cancel'
    });

    if (!confirmDelete.isConfirmed) return;

    try {
        const portalDocId = getPortalDocId();
        await Promise.all(entriesToDelete.map(item => {
            if (!item.id) return Promise.resolve();
            return deleteDoc(doc(window.db, 'vbsAttendance', item.id));
        }));

        const remainingAttendance = sourceAttendance.filter(item => !entriesToDelete.some(target => String(target.id || '') === String(item.id || '')));
        if (VBS_STATE.portalActive) {
            VBS_STATE.portalAttendance = remainingAttendance;
        } else {
            VBS_STATE.attendance = remainingAttendance;
        }

        await createAuditLog('vbs_attendance_range_deleted', {
            fromDate,
            toDate,
            deletedCount: entriesToDelete.length,
            portalMode: VBS_STATE.portalActive,
            vbsYear: VBS_YEAR_FIXED,
        });

        renderAttendanceTable();
        refreshTodayReportDateOptions();
        showSuccess('Removed', `${entriesToDelete.length} attendance record(s) deleted.`);
    } catch (err) {
        console.error(err);
        showError('Failed to remove attendance records: ' + err.message);
    }
}

function buildTodayReportData(reportDate) {
    const sourceRoster = VBS_STATE.portalActive ? (VBS_STATE.portalRoster || []) : (VBS_STATE.roster || []);
    const sourceAttendance = VBS_STATE.portalActive ? (VBS_STATE.portalAttendance || []) : (VBS_STATE.attendance || []);

    const scopedEntries = sourceAttendance.filter(item => String(item.vbsDate || '') === reportDate);

    const rowsByClass = new Map();
    sourceRoster.forEach(item => {
        const classId = String(item.classId || '');
        if (!rowsByClass.has(classId)) {
            rowsByClass.set(classId, { classId, total: 0, present: 0, absent: 0, notMarked: 0 });
        }
        rowsByClass.get(classId).total += 1;
    });

    scopedEntries.forEach(entry => {
        const classId = String(entry.classId || '');
        if (!rowsByClass.has(classId)) {
            rowsByClass.set(classId, { classId, total: 0, present: 0, absent: 0, notMarked: 0 });
        }

        const row = rowsByClass.get(classId);
        if (entry.status === 'Present') row.present += 1;
        else if (entry.status === 'Absent') row.absent += 1;
    });

    rowsByClass.forEach(row => {
        row.notMarked = Math.max(0, Number(row.total) - Number(row.present) - Number(row.absent));
    });

    const classRows = [...rowsByClass.values()].sort((a, b) => compareClassIds(a.classId, b.classId));

    const classSections = [...new Set(sourceRoster.map(item => String(item.classId || '')).filter(Boolean).concat(scopedEntries.map(item => String(item.classId || '')).filter(Boolean)))]
        .sort(compareClassIds)
        .map(classId => {
            const studentRows = sourceRoster
                .filter(item => String(item.classId || '') === classId)
                .map(item => {
                    const entry = scopedEntries.find(att =>
                        String(att.classId || '') === String(item.classId || '')
                        && String(att.studentId || '') === String(item.studentId || '')
                    );

                    const studentName = VBS_STATE.portalActive ? (item.fullName || item.name) : getRosterStudentName(item);

                    return {
                        classId: item.classId,
                        studentId: item.studentId,
                        studentName,
                        status: entry?.status || 'Not Marked',
                    };
                })
                .sort((a, b) => {
                    const statusCmp = getAttendanceStatusSortValue(a.status) - getAttendanceStatusSortValue(b.status);
                    if (statusCmp !== 0) return statusCmp;
                    const nameCmp = String(a.studentName || '').localeCompare(String(b.studentName || ''), undefined, { sensitivity: 'base' });
                    if (nameCmp !== 0) return nameCmp;
                    return String(a.studentId || '').localeCompare(String(b.studentId || ''), undefined, { numeric: true, sensitivity: 'base' });
                });

            return { classId, studentRows };
        });

    const detailedRows = sourceRoster.map(item => {
        const entry = scopedEntries.find(att =>
            String(att.classId || '') === String(item.classId || '')
            && String(att.studentId || '') === String(item.studentId || '')
        );

        const studentName = VBS_STATE.portalActive ? (item.fullName || item.name) : getRosterStudentName(item);

        return {
            classId: item.classId,
            studentId: item.studentId,
            studentName,
            status: entry?.status || 'Not Marked',
        };
    }).sort((a, b) => {
        const classCmp = String(a.classId || '').localeCompare(String(b.classId || ''), undefined, { numeric: true });
        if (classCmp !== 0) return classCmp;
        return String(a.studentName || '').localeCompare(String(b.studentName || ''), undefined, { sensitivity: 'base' });
    });

    return { classRows, detailedRows, classSections };
}

function buildDetailedReportData() {
    const sourceRoster = VBS_STATE.portalActive ? (VBS_STATE.portalRoster || []) : (VBS_STATE.roster || []);
    const sourceAttendance = VBS_STATE.portalActive ? (VBS_STATE.portalAttendance || []) : (VBS_STATE.attendance || []);
    const allDates = [...new Set(sourceAttendance.map(item => String(item.vbsDate || '').trim()).filter(Boolean))]
        .sort((a, b) => String(a).localeCompare(String(b)));
    const attendanceLookup = new Map();

    sourceAttendance.forEach(item => {
        const classId = String(item.classId || '');
        const studentId = String(item.studentId || '');
        const dateValue = String(item.vbsDate || '').trim();
        if (!classId || !studentId || !dateValue) return;
        attendanceLookup.set(`${classId}__${studentId}__${dateValue}`, String(item.status || 'Absent'));
    });

    const classIds = [...new Set([
        ...sourceRoster.map(item => String(item.classId || '')).filter(Boolean),
        ...sourceAttendance.map(item => String(item.classId || '')).filter(Boolean)
    ])].sort(compareClassIds);

    const classRows = [];
    const summaryRows = [];
    const matrixSections = classIds.map(classId => {
        const rosterRows = sourceRoster
            .filter(item => String(item.classId || '') === classId)
            .sort((a, b) => {
                const nameA = String(a.fullName || a.name || '').toLowerCase();
                const nameB = String(b.fullName || b.name || '').toLowerCase();
                const nameCmp = nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
                if (nameCmp !== 0) return nameCmp;
                return String(a.studentId || '').localeCompare(String(b.studentId || ''), undefined, { numeric: true, sensitivity: 'base' });
            });

        const studentRows = rosterRows.map(item => {
            let presentCount = 0;
            const cells = allDates.reduce((acc, dateValue) => {
                const status = attendanceLookup.get(`${classId}__${String(item.studentId || '')}__${dateValue}`) || 'Absent';
                const value = status === 'Present' ? 'P' : 'A';
                if (value === 'P') presentCount += 1;
                acc[dateValue] = value;
                return acc;
            }, {});

            const percentage = allDates.length > 0
                ? Math.round((presentCount / allDates.length) * 1000) / 10
                : 0;

            return {
                studentId: String(item.studentId || ''),
                studentName: String(item.fullName || item.name || item.studentName || '-'),
                presentCount,
                percentage,
                cells,
            };
        });

        studentRows.forEach(student => {
            summaryRows.push({
                classId,
                studentName: student.studentName,
                presentCount: student.presentCount,
                totalDays: allDates.length,
                percentage: student.percentage,
            });
        });

        const classAttendance = sourceAttendance.filter(item => String(item.classId || '') === classId);
        const presentCount = classAttendance.filter(item => String(item.status || '') === 'Present').length;
        const absentCount = classAttendance.filter(item => String(item.status || '') === 'Absent').length;
        const totalMarks = studentRows.length * allDates.length;
        const overallPercentage = totalMarks > 0 ? Math.round((presentCount / totalMarks) * 1000) / 10 : 0;

        classRows.push({
            classId,
            totalStudents: studentRows.length,
            totalDates: allDates.length,
            present: presentCount,
            absent: absentCount,
            attendancePercentage: overallPercentage,
        });

        return {
            classId,
            studentRows,
        };
    });

    summaryRows.sort((a, b) => {
        const percentageCmp = Number(b.percentage || 0) - Number(a.percentage || 0);
        if (percentageCmp !== 0) return percentageCmp;

        const classCmp = compareClassIds(a.classId, b.classId);
        if (classCmp !== 0) return classCmp;

        return String(a.studentName || '').localeCompare(String(b.studentName || ''), undefined, { sensitivity: 'base' });
    });

    return {
        classRows,
        matrixSections,
        summaryRows,
        allDates,
        fromDate: allDates[0] || '',
        toDate: allDates[allDates.length - 1] || '',
    };
}

async function persistReportSnapshot(type, payload) {
    try {
        const timestamp = Date.now();
        const docId = `${VBS_STATE.activeAcademicYearId || 'no_year'}_${VBS_YEAR_FIXED}_${type}_${timestamp}`;
        const scopedClassId = isFacultyRole()
            ? String(VBS_STATE.roleData?.classId || '')
            : String(payload?.classId || '');

        // Extract non-schema fields into report_data JSONB
        const { classId: _cid, reportDate, entryCount, ...extraStats } = payload || {};
        await setDoc(doc(window.db, 'vbsReports', docId), {
            id: docId,
            reportType: type,
            vbsYear: VBS_YEAR_FIXED,
            academicYearId: VBS_STATE.activeAcademicYearId || null,
            classId: scopedClassId,
            reportDate: reportDate || null,
            entryCount: entryCount || null,
            generatedAt: new Date().toISOString(),
            generatedBy: VBS_STATE.user?.uid || null,
            generatedByRole: VBS_STATE.roleData?.role || null,
            reportData: extraStats,
        }, { merge: true });
    } catch (err) {
        console.warn('Failed to persist vbs report snapshot:', err);
    }
}

async function generateTodayReport() {
    const reportDate = String(document.getElementById('vbs-today-report-date-select')?.value || '').trim();
    if (!reportDate) {
        return showError('Select a date before generating today report.');
    }

    const JsPdf = getJsPdfConstructor();
    if (!JsPdf) {
        return showError('PDF library unavailable. Please refresh and try again.');
    }

    const { classRows, detailedRows, classSections } = buildTodayReportData(reportDate);
    const totalRoster = detailedRows.length;
    const totalPresent = detailedRows.filter(row => row.status === 'Present').length;
    const totalAbsent = detailedRows.filter(row => row.status === 'Absent').length;
    const totalNotMarked = detailedRows.filter(row => row.status === 'Not Marked').length;

    const doc = new JsPdf({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

    let y = addPdfHeader(doc, 'VBS Today Report', `Date: ${formatDate(reportDate)} | VBS Year: ${VBS_YEAR_FIXED}`);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`Total Students: ${totalRoster} | Present: ${totalPresent} | Absent: ${totalAbsent} | Not Marked: ${totalNotMarked}`, 10, y);
    y += 6;

    y = drawPdfTable(
        doc,
        ['Class', 'Total', 'Present', 'Absent', 'Not Marked'],
        classRows.map(row => [
            getClassLabel(row.classId),
            String(row.total),
            String(row.present),
            String(row.absent),
            String(row.notMarked)
        ]),
        y,
        [58, 28, 34, 34, 36]
    );

    classSections.forEach((section, sectionIndex) => {
        doc.addPage();
        const className = getClassLabel(section.classId);
        y = addPdfHeader(doc, `VBS Today Detailed List - ${className}`, formatDate(reportDate));
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        const sectionPresent = section.studentRows.filter(r => r.status === 'Present').length;
        const sectionAbsent = section.studentRows.filter(r => r.status === 'Absent').length;
        doc.text(`Students: ${section.studentRows.length} | Present: ${sectionPresent} | Absent: ${sectionAbsent}`, 10, y);
        y += 6;

        drawPdfTable(
            doc,
            ['Sl. No.', 'Student ID', 'Student Name', 'Status'],
            section.studentRows.map((row, index) => [
                String(index + 1),
                String(row.studentId || '-'),
                String(row.studentName || '-'),
                String(row.status || '-')
            ]),
            y,
            [18, 36, 100, 36]
        );
    });

    const fileSafeDate = String(reportDate).replace(/[^0-9-]/g, '');
    doc.save(`VBS_Today_Report_${fileSafeDate}.pdf`);

    await persistReportSnapshot('today', {
        reportDate,
        totalRoster,
        totalPresent,
        totalAbsent,
        totalNotMarked,
        classCount: classRows.length,
    });

    createAuditLog('vbs_today_report_generated', {
        reportDate,
        classCount: classRows.length,
        totalStudents: totalRoster,
        vbsYear: VBS_YEAR_FIXED,
    });
}

async function generateDetailedReport() {
    const JsPdf = getJsPdfConstructor();
    if (!JsPdf) {
        return showError('PDF library unavailable. Please refresh and try again.');
    }

    const { classRows, matrixSections, summaryRows, allDates, fromDate, toDate } = buildDetailedReportData();
    if (allDates.length === 0 || matrixSections.length === 0) {
        return showError('No attendance data available for detailed report.');
    }

    const doc = new JsPdf({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

    let y = addPdfHeader(doc, 'VBS Detailed Report', `Period: ${formatDate(fromDate)} to ${formatDate(toDate)} | VBS Year: ${VBS_YEAR_FIXED}`);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    const totalStudents = classRows.reduce((sum, row) => sum + Number(row.totalStudents || 0), 0);
    const totalPresent = classRows.reduce((sum, row) => sum + Number(row.present || 0), 0);
    const totalAbsent = classRows.reduce((sum, row) => sum + Number(row.absent || 0), 0);
    doc.text(`Classes: ${classRows.length} | Students: ${totalStudents} | Dates: ${allDates.length} | Present: ${totalPresent} | Absent: ${totalAbsent}`, 10, y);
    y += 6;

    y = drawPdfTable(
        doc,
        ['Class', 'Students', 'Dates', 'Present', 'Absent', 'Attendance %'],
        classRows.map(row => [
            getClassLabel(row.classId),
            String(row.totalStudents),
            String(row.totalDates),
            String(row.present),
            String(row.absent),
            `${String(row.attendancePercentage || 0).replace(/\.0$/, '')}%`
        ]),
        y,
        [38, 26, 20, 24, 24, 38]
    );

    const landscapeMargin = 10;
    const landscapePageWidth = 297;
    const nameWidth = 62;
    const percentageWidth = 18;
    const dateWidth = 12;
    const availableDateWidth = landscapePageWidth - (landscapeMargin * 2) - nameWidth - percentageWidth;
    const datesPerPage = Math.max(1, Math.floor(availableDateWidth / dateWidth));

    matrixSections.forEach((section, sectionIndex) => {
        for (let offset = 0; offset < allDates.length; offset += datesPerPage) {
            const chunkDates = allDates.slice(offset, offset + datesPerPage);
            doc.addPage('a4', 'l');
            const startY = addPdfHeader(
                doc,
                `VBS Attendance Matrix - ${getClassLabel(section.classId)}`,
                `Period: ${formatDate(fromDate)} to ${formatDate(toDate)} | Dates ${offset + 1}-${offset + chunkDates.length} of ${allDates.length}`
            );

            const columns = ['Student Name', ...chunkDates.map(formatMatrixDateLabel), 'Attendance %'];
            const widths = [nameWidth, ...chunkDates.map(() => dateWidth), percentageWidth];
            const rows = section.studentRows.map(student => {
                const percentageValue = Number(student.percentage || 0);
                return {
                    cells: [
                        student.studentName,
                        ...chunkDates.map(dateValue => student.cells[dateValue] || 'A'),
                        `${String(student.percentage || 0).replace(/\.0$/, '')}%`
                    ],
                    highlightAll: percentageValue >= 100,
                };
            });

            drawLandscapeMatrixTable(doc, columns, rows, startY, widths);
        }
    });

    if (summaryRows.length > 0) {
        doc.addPage('a4', 'p');
        let summaryY = addPdfHeader(doc, 'VBS Attendance Summary', `All students sorted by attendance percentage | VBS Year: ${VBS_YEAR_FIXED}`);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text('Top rows show the highest attendance percentage, with 100% students listed first.', 10, summaryY);
        summaryY += 6;

        summaryY = drawPdfTable(
            doc,
            ['Sno', 'Name', 'Class', 'Total Days Present', 'Total Days of Class', 'Attendance Percentage'],
            summaryRows.map((row, index) => [
                String(index + 1),
                String(row.studentName || '-'),
                getClassLabel(row.classId),
                String(row.presentCount || 0),
                String(row.totalDays || 0),
                `${String(row.percentage || 0).replace(/\.0$/, '')}%`
            ]),
            summaryY,
            [16, 68, 26, 30, 30, 20]
        );
    }

    doc.save(`VBS_Detailed_Report_${VBS_YEAR_FIXED}.pdf`);

    await persistReportSnapshot('detailed', {
        fromDate,
        toDate,
        totalEntries: allDates.length,
        classCount: classRows.length,
        uniqueDates: allDates.length,
    });

    createAuditLog('vbs_detailed_report_generated', {
        fromDate,
        toDate,
        totalEntries: allDates.length,
        classCount: classRows.length,
        vbsYear: VBS_YEAR_FIXED,
    });
}

async function generateHundredPercentReport() {
    const JsPdf = getJsPdfConstructor();
    if (!JsPdf) {
        return showError('PDF library unavailable. Please refresh and try again.');
    }

    const { summaryRows, allDates, fromDate, toDate } = buildDetailedReportData();
    if (allDates.length === 0) {
        return showError('No attendance data available for 100% report.');
    }

    const perfectRows = (summaryRows || []).filter(row => Number(row.percentage || 0) >= 100);
    if (perfectRows.length === 0) {
        return showError('No students with 100% attendance for the selected data period.');
    }

    const doc = new JsPdf({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

    let y = addPdfHeader(doc, 'VBS 100% Attendance List', `Period: ${formatDate(fromDate)} to ${formatDate(toDate)} | VBS Year: ${VBS_YEAR_FIXED}`);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`Students with 100% attendance: ${perfectRows.length}`, 10, y);
    y += 6;

    drawPdfTable(
        doc,
        ['Sno', 'Name', 'Class', 'Total Days Present', 'Total Days of Class', 'Attendance Percentage'],
        perfectRows.map((row, index) => [
            String(index + 1),
            String(row.studentName || '-'),
            getClassLabel(row.classId),
            String(row.presentCount || 0),
            String(row.totalDays || 0),
            `${String(row.percentage || 0).replace(/\.0$/, '')}%`
        ]),
        y,
        [16, 68, 26, 30, 30, 20]
    );

    doc.save(`VBS_100_Percent_Attendance_${VBS_YEAR_FIXED}.pdf`);

    await persistReportSnapshot('100_percent', {
        fromDate,
        toDate,
        totalEntries: allDates.length,
        studentCount: perfectRows.length,
        classCount: new Set(perfectRows.map(row => String(row.classId || ''))).size,
    });

    createAuditLog('vbs_100_percent_report_generated', {
        fromDate,
        toDate,
        totalEntries: allDates.length,
        studentCount: perfectRows.length,
        vbsYear: VBS_YEAR_FIXED,
    });
}

async function initializePortal(user) {
    const roleData = await fetchRoleData(user.uid);
    const role = normalizeRole(roleData.role);

    if (role !== 'admin' && role !== 'faculty') {
        throw new Error('Access denied. VBS portal is only for Admin or Faculty users.');
    }

    VBS_STATE.user = user;
    VBS_STATE.roleData = roleData;

    await loadAcademicYearContext(true);
    VBS_STATE.activeAcademicYearId = getActiveAcademicYearId();

    if (isFacultyRole() && !roleData.classId) {
        throw new Error('Faculty class is not configured. Contact admin.');
    }

    const yearTag = document.getElementById('vbs-year-fixed');
    if (yearTag) yearTag.textContent = VBS_YEAR_FIXED;

    const dateInput = document.getElementById('vbs-attendance-date');
    if (dateInput && !dateInput.value) {
        dateInput.value = toYmd();
    }

    document.getElementById('user-info-email').textContent = user.email || roleData.email || 'unknown';
    document.getElementById('user-info-role').textContent = role === 'admin'
        ? 'Administrator'
        : `Faculty - ${roleData.classId || 'Unassigned'}`;

    localStorage.setItem('currentUser', JSON.stringify({
        uid: user.uid,
        email: user.email || roleData.email || 'unknown',
        role: roleData.role,
        classId: roleData.classId || null
    }));

    setupUiListeners();

    document.getElementById('app-content').classList.remove('is-hidden');
    hideSpinner();
    reloadAllData().catch(err => console.error('Failed to load VBS data:', err));

}

document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.onAuthStateChanged !== 'function') {
        return handleAppError('Firebase Auth is not loaded. Cannot start app.');
    }

    window.onAuthStateChanged(window.auth, async user => {
        if (!user) {
            await logout();
            return;
        }

        try {
            await initializePortal(user);
        } catch (err) {
            console.error(err);
            handleAppError(err.message || 'Failed to initialize VBS portal.');
        }
    });
});
