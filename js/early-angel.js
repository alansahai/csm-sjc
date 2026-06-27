/**
 * early-angel.js
 * Dedicated Early Angel portal for admin/faculty.
 */

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
    } catch (e) {
        console.error(e);
    }
}

const EA_STATE = {
    user: null,
    roleData: null,
    activeAcademicYearId: null,
    classes: [],
    students: [],
    leaderboard: [],
    entries: [],
    searchIndex: [],
    selectedStudent: null,
    dateWarningShown: false,
    availableEntryDates: [],
    lastInstantReportDate: '',
};

window.realtimeUnsubscribers = [];

function stopRealtimeListeners() {
    if (window.realtimeUnsubscribers && window.realtimeUnsubscribers.length > 0) {
        window.realtimeUnsubscribers.forEach(unsub => unsub());
        window.realtimeUnsubscribers = [];
    }
}

function normalizeRole(role) {
    return String(role || '').trim().toLowerCase();
}

function isAdminRole() {
    return normalizeRole(EA_STATE.roleData?.role) === 'admin';
}

function isFacultyRole() {
    return normalizeRole(EA_STATE.roleData?.role) === 'faculty';
}

function setDateToToday() {
    const dateInput = document.getElementById('ea-date-input');
    if (dateInput) {
        dateInput.value = new Date().toISOString().slice(0, 10);
    }
}

function toYmd(dateObj = new Date()) {
    return dateObj.toISOString().slice(0, 10);
}

function getTimeLabelFromIso(isoValue) {
    if (!isoValue) return '-';
    const dateObj = new Date(isoValue);
    if (Number.isNaN(dateObj.getTime())) return '-';
    return dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function slugify(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function getClassLabel(classId) {
    const cls = (EA_STATE.classes || []).find(c => String(c.id) === String(classId));
    return cls ? `${cls.id} - ${cls.name || cls.id}` : (classId || '-');
}

function compareClassIds(a, b) {
    return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
}

function getEntryDate(item) {
    return String(item?.entryDate || (item?.createdAt || '').slice(0, 10) || '');
}

function getEntriesForDate(targetDate) {
    return (EA_STATE.entries || []).filter(item => getEntryDate(item) === targetDate);
}

function getSortedClassIdsForReport() {
    const fromClasses = (EA_STATE.classes || []).map(c => String(c.id || '').trim()).filter(Boolean);
    const fallback = Array.from({ length: 12 }, (_, idx) => `class-${idx + 1}`);
    const classIds = new Set([...fallback, ...fromClasses]);
    return [...classIds].sort(compareClassIds);
}

function buildClasswiseCountRows(entries, classIds) {
    const countByClass = new Map();
    entries.forEach(item => {
        const classId = String(item.classId || '').trim();
        if (!classId) return;
        countByClass.set(classId, Number(countByClass.get(classId) || 0) + 1);
    });

    return classIds.map(classId => ({
        classId,
        classLabel: getClassLabel(classId),
        count: Number(countByClass.get(classId) || 0)
    }));
}

function renderReportDateMeta() {
    const metaBox = document.getElementById('ea-report-date-meta');
    if (!metaBox) return;

    const dates = EA_STATE.availableEntryDates || [];
    if (dates.length === 0) {
        metaBox.innerHTML = '<span class="ea-date-pill empty">No dates</span>';
        return;
    }

    metaBox.innerHTML = dates.slice(0, 8).map(dateValue => {
        return `<span class="ea-date-pill">${escapeHtml(formatDate(dateValue))}</span>`;
    }).join('');
}

function refreshInstantReportDateOptions() {
    const select = document.getElementById('ea-instant-report-date-select');
    const note = document.getElementById('ea-report-date-note');
    const instantBtn = document.getElementById('ea-generate-instant-report-btn');
    const entireBtn = document.getElementById('ea-generate-entire-report-btn');
    if (!select) return;

    const uniqueDates = [...new Set((EA_STATE.entries || []).map(getEntryDate).filter(Boolean))]
        .sort((a, b) => String(b).localeCompare(String(a)));

    EA_STATE.availableEntryDates = uniqueDates;
    renderReportDateMeta();

    select.innerHTML = '';
    if (uniqueDates.length === 0) {
        const noOption = document.createElement('option');
        noOption.value = '';
        noOption.textContent = 'No entry dates available';
        select.appendChild(noOption);
        select.disabled = true;
        if (instantBtn) instantBtn.disabled = true;
        if (entireBtn) entireBtn.disabled = true;
        if (note) note.textContent = 'Create at least one entry before generating reports.';
        EA_STATE.lastInstantReportDate = '';
        return;
    }

    uniqueDates.forEach(dateValue => {
        const option = document.createElement('option');
        option.value = dateValue;
        option.textContent = formatDate(dateValue);
        select.appendChild(option);
    });

    select.disabled = false;
    if (instantBtn) instantBtn.disabled = false;
    if (entireBtn) entireBtn.disabled = false;

    const today = toYmd();
    let selectedDate = today;

    if (EA_STATE.lastInstantReportDate && uniqueDates.includes(EA_STATE.lastInstantReportDate)) {
        selectedDate = EA_STATE.lastInstantReportDate;
    } else if (!uniqueDates.includes(today)) {
        selectedDate = uniqueDates[0];
    }

    if (!uniqueDates.includes(selectedDate)) {
        selectedDate = uniqueDates[0];
    }

    select.value = selectedDate;
    EA_STATE.lastInstantReportDate = selectedDate;

    if (note) {
        if (uniqueDates.includes(today)) {
            note.textContent = 'Default is current date. Selecting another date will show a warning.';
        } else {
            note.textContent = 'Current date has no entries yet. Latest available date is selected.';
        }
    }
}

async function handleInstantReportDateChange(e) {
    const selectedDate = String(e.target?.value || '').trim();
    if (!selectedDate) return;

    const today = toYmd();
    if (selectedDate !== today) {
        const result = await Swal.fire({
            icon: 'warning',
            title: 'Generate for another date?',
            text: `You selected ${formatDate(selectedDate)}. This is not the current date.`,
            showCancelButton: true,
            confirmButtonText: 'Use this date',
            cancelButtonText: 'Keep current date'
        });

        if (!result.isConfirmed) {
            const fallbackDate = EA_STATE.availableEntryDates.includes(today)
                ? today
                : (EA_STATE.lastInstantReportDate || selectedDate);
            e.target.value = fallbackDate;
            EA_STATE.lastInstantReportDate = fallbackDate;
            return;
        }
    }

    EA_STATE.lastInstantReportDate = selectedDate;
}

function ensureReportRenderHost() {
    const host = document.getElementById('ea-report-render-area');
    if (!host) throw new Error('Report render area is not available.');
    return host;
}

function activateReportRenderHost(host) {
    if (!host) return;
    host.classList.add('is-rendering');
}

function deactivateReportRenderHost(host) {
    if (!host) return;
    host.classList.remove('is-rendering');
    host.innerHTML = '';
}

async function waitForReportPaint() {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function getJsPdfConstructor() {
    const ctor = window.jspdf?.jsPDF || window.jsPDF;
    return typeof ctor === 'function' ? ctor : null;
}

function openReportPrintWindow(title, reportMarkup) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        throw new Error('Popup blocked. Allow popups to open printable report.');
    }

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${normalizePdfText(title)}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 0; color: #111827; }
    .sheet { width: 100%; min-height: 100vh; padding: 18mm 12mm; box-sizing: border-box; }
    .sheet h1, .sheet h2, .sheet h3 { margin: 0 0 8px 0; }
    .muted { color: #4b5563; font-size: 0.95rem; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #d1d5db; padding: 6px 8px; font-size: 12px; text-align: left; }
    th { background: #f3f4f6; }
    .page-break { page-break-before: always; break-before: page; }
    @media print {
      @page { size: A4 portrait; margin: 0; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>${reportMarkup}</body>
</html>`;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();

    setTimeout(() => {
        try {
            printWindow.focus();
            printWindow.print();
        } catch (err) {
            console.error('Print fallback failed:', err);
        }
    }, 350);
}

function normalizePdfText(value) {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
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
    const fontSize = 9;

    const effectiveWidths = Array.isArray(widths) && widths.length === columns.length
        ? widths
        : columns.map(() => (190 / columns.length));

    const drawRow = (cells, y, isHeader = false) => {
        let x = margin;

        doc.setFont('helvetica', isHeader ? 'bold' : 'normal');
        doc.setFontSize(fontSize);

        cells.forEach((cell, idx) => {
            const w = Number(effectiveWidths[idx] || 20);
            doc.rect(x, y, w, isHeader ? headerHeight : rowHeight);
            const text = normalizePdfText(cell);
            doc.text(text, x + 1.5, y + (isHeader ? 5.2 : 4.8), { maxWidth: w - 3 });
            x += w;
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

async function exportInstantReportWithJsPdf(reportDate, entries, filename) {
    const JsPdf = getJsPdfConstructor();
    if (!JsPdf) return false;

    const sortedEntries = [...entries].sort((a, b) => {
        const classCmp = compareClassIds(a.classId, b.classId);
        if (classCmp !== 0) return classCmp;
        return String(a.studentName || '').localeCompare(String(b.studentName || ''), undefined, { sensitivity: 'base' });
    });

    const classRows = buildClasswiseCountRows(sortedEntries, getSortedClassIdsForReport());
    const totalAchievers = sortedEntries.length;

    const doc = new JsPdf({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

    let y = addPdfHeader(doc, 'Early Angel Instant Report', `Date: ${formatDate(reportDate)}`);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`Total Early Achievers Of The Day: ${totalAchievers}`, 10, y);
    y += 6;

    y = drawPdfTable(
        doc,
        ['Class', 'Achievers Count'],
        classRows.map(row => [row.classLabel, String(row.count)]),
        y,
        [130, 60]
    );

    doc.addPage();
    y = addPdfHeader(doc, 'Daily Achievers Name List', formatDate(reportDate));
    drawPdfTable(
        doc,
        ['Sl. No.', 'Class', 'Student Name', 'Entry Time'],
        sortedEntries.map((item, index) => [
            String(index + 1),
            getClassLabel(item.classId),
            item.studentName || item.studentId || '-',
            item.entryTime || getTimeLabelFromIso(item.createdAt)
        ]),
        y,
        [20, 42, 92, 36]
    );

    doc.save(filename);
    return true;
}

async function exportEntireReportWithJsPdf(entries, filename) {
    const JsPdf = getJsPdfConstructor();
    if (!JsPdf) return false;

    const sortedEntries = [...entries].sort((a, b) => {
        const dateCmp = String(getEntryDate(b)).localeCompare(String(getEntryDate(a)));
        if (dateCmp !== 0) return dateCmp;
        const classCmp = compareClassIds(a.classId, b.classId);
        if (classCmp !== 0) return classCmp;
        return String(a.studentName || '').localeCompare(String(b.studentName || ''), undefined, { sensitivity: 'base' });
    });

    const classRows = buildClasswiseCountRows(sortedEntries, getSortedClassIdsForReport());
    const totalEntries = sortedEntries.length;
    const uniqueStudents = new Set(sortedEntries.map(item => `${item.classId || ''}::${item.studentId || ''}`)).size;
    const allDates = [...new Set(sortedEntries.map(getEntryDate).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
    const fromDate = allDates[0] || '-';
    const toDate = allDates[allDates.length - 1] || '-';

    const doc = new JsPdf({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

    let y = addPdfHeader(doc, 'Early Angel Entire Detailed Report', `Period: ${formatDate(fromDate)} to ${formatDate(toDate)}`);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`Total Entries: ${totalEntries}`, 10, y);
    doc.text(`Unique Achievers: ${uniqueStudents}`, 78, y);
    doc.text(`Entry Dates: ${allDates.length}`, 150, y);
    y += 6;

    y = drawPdfTable(
        doc,
        ['Class', 'Total Count'],
        classRows.map(row => [row.classLabel, String(row.count)]),
        y,
        [130, 60]
    );

    doc.addPage();
    y = addPdfHeader(doc, 'Detailed Achievers List', 'All available entry dates');
    drawPdfTable(
        doc,
        ['Sl. No.', 'Date', 'Time', 'Class', 'Student Name'],
        sortedEntries.map((item, index) => [
            String(index + 1),
            formatDate(getEntryDate(item)),
            item.entryTime || getTimeLabelFromIso(item.createdAt),
            getClassLabel(item.classId),
            item.studentName || item.studentId || '-'
        ]),
        y,
        [18, 34, 30, 36, 72]
    );

    doc.save(filename);
    return true;
}

async function exportReportMarkupToPdf(markup, filename) {
    if (typeof html2pdf !== 'function') {
        throw new Error('html2pdf library is not loaded.');
    }

    const stage = document.createElement('div');
    stage.className = 'ea-report-pdf-stage';
    stage.style.position = 'absolute';
    stage.style.left = '0';
    stage.style.top = '0';
    stage.style.width = '820px';
    stage.style.minHeight = '1123px';
    stage.style.background = '#ffffff';
    stage.style.color = '#111827';
    stage.style.zIndex = '2147483000';
    stage.style.pointerEvents = 'none';
    stage.style.opacity = '1';
    stage.style.overflow = 'visible';

    const mount = document.createElement('div');
    mount.className = 'ea-report-pdf-export-root';
    mount.style.width = '794px';
    mount.style.minHeight = '1123px';
    mount.style.background = '#ffffff';
    mount.style.color = '#111827';
    mount.innerHTML = markup;

    stage.appendChild(mount);
    document.body.appendChild(stage);

    try {
        window.scrollTo(0, 0);
        await waitForReportPaint();
        await new Promise(resolve => setTimeout(resolve, 150));

        const options = {
            margin: [8, 8, 8, 8],
            filename,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: {
                scale: 2,
                useCORS: true,
                logging: false,
                scrollX: 0,
                scrollY: 0,
                backgroundColor: '#ffffff',
                windowWidth: 900,
            },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['css', 'legacy'] }
        };

        const worker = html2pdf().set(options).from(mount).toContainer().toCanvas().toPdf();
        await worker.save();
        await new Promise(resolve => setTimeout(resolve, 120));
    } finally {
        if (stage.parentNode) {
            stage.parentNode.removeChild(stage);
        }
    }
}

function buildInstantReportMarkup(reportDate, entries) {
    const sortedEntries = [...entries].sort((a, b) => {
        const classCmp = compareClassIds(a.classId, b.classId);
        if (classCmp !== 0) return classCmp;
        return String(a.studentName || '').localeCompare(String(b.studentName || ''), undefined, { sensitivity: 'base' });
    });

    const classRows = buildClasswiseCountRows(sortedEntries, getSortedClassIdsForReport());
    const totalAchievers = sortedEntries.length;

    return `
        <div class="ea-report-sheet">
            <div class="ea-report-header">
                <h1>Early Angel Instant Report</h1>
                <p>Date: ${escapeHtml(formatDate(reportDate))}</p>
            </div>

            <div class="ea-report-kpi">
                <div class="ea-report-kpi-card">
                    <div class="label">Total Early Achievers Of The Day</div>
                    <div class="value">${totalAchievers}</div>
                </div>
            </div>

            <h3>Classwise Count</h3>
            <table class="ea-report-table">
                <thead>
                    <tr>
                        <th>Class</th>
                        <th>Achievers Count</th>
                    </tr>
                </thead>
                <tbody>
                    ${classRows.map(row => `
                        <tr>
                            <td>${escapeHtml(row.classLabel)}</td>
                            <td>${row.count}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <div class="ea-report-page-break"></div>

        <div class="ea-report-sheet">
            <div class="ea-report-header compact">
                <h2>Daily Achievers Name List</h2>
                <p>${escapeHtml(formatDate(reportDate))}</p>
            </div>

            <table class="ea-report-table">
                <thead>
                    <tr>
                        <th>Sl. No.</th>
                        <th>Class</th>
                        <th>Student Name</th>
                        <th>Entry Time</th>
                    </tr>
                </thead>
                <tbody>
                    ${sortedEntries.map((item, index) => `
                        <tr>
                            <td>${index + 1}</td>
                            <td>${escapeHtml(getClassLabel(item.classId))}</td>
                            <td>${escapeHtml(item.studentName || item.studentId || '-')}</td>
                            <td>${escapeHtml(item.entryTime || getTimeLabelFromIso(item.createdAt))}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function buildEntireReportMarkup(entries) {
    const sortedEntries = [...entries].sort((a, b) => {
        const dateCmp = String(getEntryDate(b)).localeCompare(String(getEntryDate(a)));
        if (dateCmp !== 0) return dateCmp;
        const classCmp = compareClassIds(a.classId, b.classId);
        if (classCmp !== 0) return classCmp;
        return String(a.studentName || '').localeCompare(String(b.studentName || ''), undefined, { sensitivity: 'base' });
    });

    const classRows = buildClasswiseCountRows(sortedEntries, getSortedClassIdsForReport());
    const totalEntries = sortedEntries.length;
    const uniqueStudents = new Set(sortedEntries.map(item => `${item.classId || ''}::${item.studentId || ''}`)).size;
    const allDates = [...new Set(sortedEntries.map(getEntryDate).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
    const fromDate = allDates[0] || '-';
    const toDate = allDates[allDates.length - 1] || '-';

    return `
        <div class="ea-report-sheet">
            <div class="ea-report-header">
                <h1>Early Angel Entire Detailed Report</h1>
                <p>Period: ${escapeHtml(formatDate(fromDate))} to ${escapeHtml(formatDate(toDate))}</p>
            </div>

            <div class="ea-report-kpi multi">
                <div class="ea-report-kpi-card">
                    <div class="label">Total Entries</div>
                    <div class="value">${totalEntries}</div>
                </div>
                <div class="ea-report-kpi-card">
                    <div class="label">Unique Achievers</div>
                    <div class="value">${uniqueStudents}</div>
                </div>
                <div class="ea-report-kpi-card">
                    <div class="label">Entry Dates</div>
                    <div class="value">${allDates.length}</div>
                </div>
            </div>

            <h3>Classwise Overall Count</h3>
            <table class="ea-report-table">
                <thead>
                    <tr>
                        <th>Class</th>
                        <th>Total Count</th>
                    </tr>
                </thead>
                <tbody>
                    ${classRows.map(row => `
                        <tr>
                            <td>${escapeHtml(row.classLabel)}</td>
                            <td>${row.count}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <div class="ea-report-page-break"></div>

        <div class="ea-report-sheet">
            <div class="ea-report-header compact">
                <h2>Detailed Achievers List</h2>
            </div>

            <table class="ea-report-table">
                <thead>
                    <tr>
                        <th>Sl. No.</th>
                        <th>Date</th>
                        <th>Time</th>
                        <th>Class</th>
                        <th>Student Name</th>
                    </tr>
                </thead>
                <tbody>
                    ${sortedEntries.map((item, index) => `
                        <tr>
                            <td>${index + 1}</td>
                            <td>${escapeHtml(formatDate(getEntryDate(item)))}</td>
                            <td>${escapeHtml(item.entryTime || getTimeLabelFromIso(item.createdAt))}</td>
                            <td>${escapeHtml(getClassLabel(item.classId))}</td>
                            <td>${escapeHtml(item.studentName || item.studentId || '-')}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

async function generateInstantReport() {
    const select = document.getElementById('ea-instant-report-date-select');
    const reportDate = String(select?.value || '').trim();
    if (!reportDate) {
        return showError('Please select a valid report date.');
    }

    const entries = getEntriesForDate(reportDate);
    if (entries.length === 0) {
        return showError('No entries found for selected date.');
    }

    showSpinner();
    try {
        const fileSafeDate = reportDate.replace(/[^0-9-]/g, '');
        const fileName = `Early_Angel_Instant_Report_${fileSafeDate}.pdf`;

        const exportedWithJsPdf = await exportInstantReportWithJsPdf(reportDate, entries, fileName);
        if (!exportedWithJsPdf) {
            const markup = buildInstantReportMarkup(reportDate, entries);
            openReportPrintWindow('Early Angel Instant Report', markup);
        }

        createAuditLog('early_angel_instant_report_generated', {
            reportDate,
            entryCount: entries.length,
            academicYearId: EA_STATE.activeAcademicYearId,
        });
    } catch (err) {
        showError('Failed to generate instant report: ' + err.message);
    } finally {
        hideSpinner();
    }
}

async function generateEntireReport() {
    const entries = [...(EA_STATE.entries || [])];
    if (entries.length === 0) {
        return showError('No entries found to generate entire report.');
    }

    showSpinner();
    try {
        const activeYear = String(EA_STATE.activeAcademicYearId || 'all').replace(/[^a-zA-Z0-9_-]/g, '_');
        const fileName = `Early_Angel_Entire_Report_${activeYear}.pdf`;

        const exportedWithJsPdf = await exportEntireReportWithJsPdf(entries, fileName);
        if (!exportedWithJsPdf) {
            const markup = buildEntireReportMarkup(entries);
            openReportPrintWindow('Early Angel Entire Detailed Report', markup);
        }

        createAuditLog('early_angel_entire_report_generated', {
            entryCount: entries.length,
            academicYearId: EA_STATE.activeAcademicYearId,
        });
    } catch (err) {
        showError('Failed to generate entire report: ' + err.message);
    } finally {
        hideSpinner();
    }
}

function updateClassField(editable, classId = '') {
    const classInput = document.getElementById('ea-class-input');
    if (!classInput) return;

    classInput.value = classId || '';
    classInput.readOnly = !editable;
    classInput.classList.toggle('ea-readonly', !editable);
}

function clearStudentSelection({ keepInput = false } = {}) {
    EA_STATE.selectedStudent = null;
    const hiddenInput = document.getElementById('ea-selected-student-id');
    if (hiddenInput) hiddenInput.value = '';

    if (!keepInput) {
        const searchInput = document.getElementById('ea-student-search-input');
        if (searchInput) searchInput.value = '';
    }

    // Global mode: class stays editable until an existing student is picked.
    updateClassField(true, '');

    const hint = document.getElementById('ea-student-mode-hint');
    if (hint) {
        hint.textContent = 'Global search: type any student’s name across all classes, or add a new one.';
    }
}

function selectExistingStudent(student) {
    EA_STATE.selectedStudent = {
        mode: 'existing',
        studentId: String(student.studentId || student.id || ''),
        studentName: String(student.studentName || `${student.firstName || ''} ${student.lastName || ''}`).trim(),
        classId: String(student.classId || ''),
        displayText: String(student.studentName || `${student.firstName || ''} ${student.lastName || ''}`).trim(),
        source: student.source || 'students',
    };

    const searchInput = document.getElementById('ea-student-search-input');
    const hiddenInput = document.getElementById('ea-selected-student-id');
    if (searchInput) searchInput.value = EA_STATE.selectedStudent.displayText;
    if (hiddenInput) hiddenInput.value = EA_STATE.selectedStudent.studentId;

    updateClassField(false, EA_STATE.selectedStudent.classId);

    const hint = document.getElementById('ea-student-mode-hint');
    if (hint) {
        hint.textContent = `Selected existing student (${EA_STATE.selectedStudent.source}). Class is locked.`;
    }

    hideStudentSuggestions();
}

// Next global sequential student id (max numeric id + 1), derived from loaded students.
function getNextEaStudentId() {
    let maxNum = 0;
    (EA_STATE.students || []).forEach(s => {
        const raw = s.studentId ?? s.id;
        const n = parseInt(raw, 10);
        if (!Number.isNaN(n) && String(n) === String(raw) && n > maxNum) maxNum = n;
    });
    return String(maxNum + 1);
}

// Next register number for a class (classNum*100 + nextSeq), from actual enrollments.
async function computeNextRegisterNo(classId) {
    const activeYear = EA_STATE.activeAcademicYearId;
    const classNum = (typeof getClassNumber === 'function') ? getClassNumber(classId) : null;
    let maxSeq = 0;
    try {
        const snap = await window.getDocs(window.query(
            window.collection(window.db, 'enrollments'),
            window.where('academicYearId', '==', activeYear),
            window.where('classId', '==', classId)
        ));
        snap.forEach(d => {
            const reg = Number((d.data() || {}).registerNo);
            if (!Number.isNaN(reg)) {
                const seq = classNum != null ? reg - classNum * 100 : reg;
                if (seq > maxSeq) maxSeq = seq;
            }
        });
    } catch (e) {
        console.warn('register compute failed:', e);
    }
    const nextSeq = maxSeq + 1;
    return classNum != null
        ? parseInt(`${classNum}${String(nextSeq).padStart(2, '0')}`, 10)
        : nextSeq;
}

// Open the "Add New Student" dialog: enter name + pick class → Student ID and
// Register No auto-fill from the DB → creates the student + enrollment, then
// selects them so the Early Angel entry can be saved.
async function openEarlyAngelAddStudent(prefillName) {
    const classesOptions = (EA_STATE.classes || [])
        .slice()
        .sort((a, b) => compareClassIds(a.id, b.id))
        .map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name || c.id)}</option>`)
        .join('');
    const defaultClass = isFacultyRole() ? String(EA_STATE.roleData?.classId || '') : '';

    const result = await Swal.fire({
        title: 'Add New Student',
        html: `
            <input id="ea-add-name" class="swal2-input" placeholder="Student name" value="${escapeHtml(prefillName || '')}">
            <select id="ea-add-class" class="swal2-input"><option value="">Select class</option>${classesOptions}</select>
            <input id="ea-add-studentid" class="swal2-input" placeholder="Student ID (auto)" readonly>
            <input id="ea-add-registerno" class="swal2-input" placeholder="Register No (select class)" readonly>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Add & Select',
        didOpen: () => {
            const classSel = document.getElementById('ea-add-class');
            const idEl = document.getElementById('ea-add-studentid');
            const regEl = document.getElementById('ea-add-registerno');
            if (idEl) idEl.value = getNextEaStudentId();
            const onClassChange = async () => {
                const cid = classSel.value;
                if (!cid) { regEl.value = ''; return; }
                regEl.value = 'Loading…';
                regEl.value = String(await computeNextRegisterNo(cid));
            };
            classSel?.addEventListener('change', onClassChange);
            if (defaultClass) { classSel.value = defaultClass; onClassChange(); }
        },
        preConfirm: () => {
            const name = String(document.getElementById('ea-add-name')?.value || '').trim();
            const classId = String(document.getElementById('ea-add-class')?.value || '').trim();
            const studentId = String(document.getElementById('ea-add-studentid')?.value || '').trim();
            const registerNo = parseInt(document.getElementById('ea-add-registerno')?.value || '', 10);
            if (!name) { Swal.showValidationMessage('Student name is required.'); return false; }
            if (!classId) { Swal.showValidationMessage('Please select a class.'); return false; }
            if (!studentId) { Swal.showValidationMessage('Could not assign a Student ID. Reload and try again.'); return false; }
            return { name, classId, studentId, registerNo };
        }
    });

    if (!result.isConfirmed || !result.value) return;
    const { name, classId, studentId, registerNo } = result.value;

    showSpinner();
    try {
        const parts = name.split(/\s+/);
        const firstName = parts[0];
        const lastName = parts.slice(1).join(' ');
        const studentRec = { studentId, firstName, lastName, classId };

        await window.setDoc(window.doc(window.db, 'students', String(studentId)), studentRec, { merge: true });
        await window.upsertEnrollmentForStudent(
            { ...studentRec, ...(registerNo && !Number.isNaN(registerNo) ? { _hintRegisterNo: registerNo } : {}) },
            EA_STATE.user?.uid || ''
        );

        // Optimistic local add so search/suggestions find them immediately
        EA_STATE.students.push({ id: studentId, ...studentRec, registerNo: (registerNo && !Number.isNaN(registerNo)) ? registerNo : null });
        rebuildSearchIndex();

        createAuditLog('early_angel_student_added', { studentId, classId, name });

        // Lock them in as the selected student for the entry
        selectExistingStudent({ studentId, studentName: name, classId, source: 'students' });
        showSuccess('Student added', `${name} added to ${getClassLabel(classId)}. Now click “Save Early Angel Entry”.`);
    } catch (err) {
        showError('Failed to add student: ' + err.message);
    } finally {
        hideSpinner();
    }
}

function hideStudentSuggestions() {
    const box = document.getElementById('ea-student-suggestions');
    if (!box) return;
    box.classList.add('is-hidden');
    box.innerHTML = '';
}

function rebuildSearchIndex() {
    const map = new Map();

    (EA_STATE.students || []).forEach(student => {
        const studentId = String(student.studentId || student.id || '');
        const classId = String(student.classId || '');
        if (!studentId) return;

        const studentName = `${student.firstName || ''} ${student.lastName || ''}`.trim() || studentId;
        map.set(`${classId}::${studentId}`, {
            source: 'students',
            studentId,
            studentName,
            classId,
            firstName: student.firstName || '',
            lastName: student.lastName || '',
        });
    });

    (EA_STATE.leaderboard || []).forEach(item => {
        const studentId = String(item.studentId || item.id || '');
        const classId = String(item.classId || '');
        if (!studentId) return;

        const key = `${classId}::${studentId}`;
        if (!map.has(key)) {
            map.set(key, {
                source: 'leaderboard',
                studentId,
                studentName: String(item.studentName || studentId),
                classId,
                firstName: '',
                lastName: '',
            });
        }
    });

    EA_STATE.searchIndex = [...map.values()].sort((a, b) =>
        String(a.studentName || '').localeCompare(String(b.studentName || ''), undefined, { sensitivity: 'base' })
    );
}

function rebuildLeaderboardFromEntries() {
    const byStudent = new Map();

    (EA_STATE.entries || []).forEach(entry => {
        const studentId = String(entry.studentId || '').trim();
        const classId = String(entry.classId || '').trim();
        if (!studentId || !classId) return;

        const key = `${classId}::${studentId}`;
        if (!byStudent.has(key)) {
            byStudent.set(key, {
                classId,
                studentId,
                studentName: String(entry.studentName || studentId),
                entryCount: 0,
            });
        }

        const row = byStudent.get(key);
        row.entryCount += 1;
        if (!row.studentName && entry.studentName) {
            row.studentName = String(entry.studentName);
        }
    });

    EA_STATE.leaderboard = [...byStudent.values()];
}

function renderStudentSuggestions(rawTerm) {
    const box = document.getElementById('ea-student-suggestions');
    if (!box) return;

    const term = String(rawTerm || '').trim().toLowerCase();
    if (!term) {
        hideStudentSuggestions();
        return;
    }

    const matches = EA_STATE.searchIndex.filter(item => {
        const name = String(item.studentName || '').toLowerCase();
        const id = String(item.studentId || '').toLowerCase();
        const cls = String(item.classId || '').toLowerCase();
        return name.includes(term) || id.includes(term) || cls.includes(term);
    }).slice(0, 12);

    box.innerHTML = '';

    matches.forEach(item => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ea-suggestion-item';
        btn.dataset.kind = 'existing';
        btn.dataset.studentId = item.studentId;
        btn.dataset.classId = item.classId;
        btn.dataset.studentName = item.studentName;
        btn.dataset.source = item.source;
        btn.innerHTML = `
            <span class="ea-suggestion-title">${escapeHtml(item.studentName)}</span>
            <span class="ea-suggestion-meta">${escapeHtml(item.studentId)} | ${escapeHtml(getClassLabel(item.classId))} | ${escapeHtml(item.source)}</span>
        `;
        box.appendChild(btn);
    });

    const addAsNew = document.createElement('button');
    addAsNew.type = 'button';
    addAsNew.className = 'ea-suggestion-item ea-new-option';
    addAsNew.dataset.kind = 'new';
    addAsNew.dataset.studentName = rawTerm.trim();
    addAsNew.innerHTML = `
        <span class="ea-suggestion-title"><i class="fas fa-user-plus"></i> Add new student: "${escapeHtml(rawTerm.trim())}"</span>
        <span class="ea-suggestion-meta">Enter class to auto-assign ID &amp; register number.</span>
    `;
    box.appendChild(addAsNew);

    box.classList.remove('is-hidden');
}

function handleSuggestionClick(e) {
    const option = e.target.closest('.ea-suggestion-item');
    if (!option) return;

    const kind = option.dataset.kind;
    if (kind === 'existing') {
        selectExistingStudent({
            source: option.dataset.source,
            studentId: option.dataset.studentId,
            studentName: option.dataset.studentName,
            classId: option.dataset.classId,
        });
        return;
    }

    if (kind === 'new') {
        const name = String(option.dataset.studentName || '').trim();
        hideStudentSuggestions();
        openEarlyAngelAddStudent(name);
    }
}

function resolveSelectionForSubmit() {
    const searchInput = document.getElementById('ea-student-search-input');
    const typedName = String(searchInput?.value || '').trim();

    if (!typedName) {
        throw new Error('Student name is required.');
    }

    if (EA_STATE.selectedStudent && EA_STATE.selectedStudent.displayText === typedName) {
        return { ...EA_STATE.selectedStudent };
    }

    // If the typed text is not selected from dropdown, always treat as new.
    return {
        mode: 'new',
        studentId: '',
        studentName: typedName,
        classId: isFacultyRole() ? String(EA_STATE.roleData?.classId || '') : '',
        displayText: typedName,
    };
}

function applyDateWarningOnce() {
    if (EA_STATE.dateWarningShown) return;
    EA_STATE.dateWarningShown = true;

    Swal.fire({
        icon: 'warning',
        title: 'Date Warning',
        text: 'Date is prefilled as today. Change it only when entering a back-dated entry.',
        confirmButtonText: 'Understood'
    });
}

function renderLeaderboardTable() {
    const tbody = document.querySelector('#ea-leaderboard-table tbody');
    if (!tbody) return;

    const term = String(document.getElementById('ea-table-search')?.value || '').trim().toLowerCase();
    const rows = [...(EA_STATE.leaderboard || [])]
        .sort((a, b) => Number(b.entryCount || 0) - Number(a.entryCount || 0))
        .filter(item => {
            if (!term) return true;
            const haystack = [
                item.studentName,
                item.studentId,
                item.classId,
                getClassLabel(item.classId)
            ].join(' ').toLowerCase();
            return haystack.includes(term);
        });

    tbody.innerHTML = '';
    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4">No count data.</td></tr>';
        return;
    }

    rows.forEach((row, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${index + 1}</td>
            <td>${escapeHtml(getClassLabel(row.classId))}</td>
            <td>${escapeHtml(row.studentName || row.studentId || '-')}</td>
            <td><strong>${Number(row.entryCount || 0)}</strong></td>
        `;
        tbody.appendChild(tr);
    });
}

function renderEntriesTable() {
    const tbody = document.querySelector('#ea-entries-table tbody');
    if (!tbody) return;

    const term = String(document.getElementById('ea-table-search')?.value || '').trim().toLowerCase();
    const rows = [...(EA_STATE.entries || [])]
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .filter(item => {
            if (!term) return true;
            const haystack = [
                item.studentName,
                item.studentId,
                item.classId,
                item.entryDate,
                item.entryTime,
                getClassLabel(item.classId)
            ].join(' ').toLowerCase();
            return haystack.includes(term);
        });

    tbody.innerHTML = '';
    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5">No entries found.</td></tr>';
        return;
    }

    rows.slice(0, 150).forEach(row => {
        const tr = document.createElement('tr');
        const entryDate = row.entryDate || (row.createdAt || '').slice(0, 10);
        const entryTime = row.entryTime || getTimeLabelFromIso(row.createdAt);
        tr.innerHTML = `
            <td>${escapeHtml(formatDate(entryDate))}</td>
            <td>${escapeHtml(entryTime)}</td>
            <td>${escapeHtml(getClassLabel(row.classId))}</td>
            <td>${escapeHtml(row.studentName || row.studentId || '-')}</td>
            <td>
                <button type="button" class="btn btn-secondary btn-sm ea-edit-name-btn" data-student-id="${escapeHtml(row.studentId || '')}" data-student-name="${escapeHtml(row.studentName || '')}" title="Correct the student's name">
                    <i class="fas fa-edit"></i> Edit
                </button>
                <button type="button" class="btn btn-danger btn-sm ea-delete-entry-btn" data-entry-id="${escapeHtml(row.id || '')}">
                    <i class="fas fa-trash"></i> Delete
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function deleteEntryById(entryId) {
    const target = (EA_STATE.entries || []).find(item => String(item.id) === String(entryId));
    if (!target) {
        return showError('Entry not found. Please refresh and try again.');
    }

    const result = await Swal.fire({
        icon: 'warning',
        title: 'Delete this entry?',
        text: 'This action cannot be undone. Count will be reduced automatically.',
        showCancelButton: true,
        confirmButtonText: 'Delete Entry',
        cancelButtonText: 'Cancel',
        confirmButtonColor: '#dc2626'
    });

    if (!result.isConfirmed) return;

    showSpinner();
    try {
        await deleteDoc(doc(window.db, 'earlyAngelEntries', String(entryId)));

        createAuditLog('early_angel_entry_deleted', {
            entryId,
            classId: target.classId || '',
            studentId: target.studentId || '',
            studentName: target.studentName || '',
            entryDate: target.entryDate || '',
            academicYearId: EA_STATE.activeAcademicYearId || null,
        });

        showSuccess('Entry deleted successfully.');
    } catch (err) {
        showError('Failed to delete entry: ' + err.message);
    } finally {
        hideSpinner();
    }
}

async function handleEntriesTableClick(e) {
    const editBtn = e.target.closest('.ea-edit-name-btn');
    if (editBtn) {
        await editEaStudentName(String(editBtn.dataset.studentId || '').trim(), String(editBtn.dataset.studentName || '').trim());
        return;
    }

    const deleteBtn = e.target.closest('.ea-delete-entry-btn');
    if (!deleteBtn) return;

    const entryId = String(deleteBtn.dataset.entryId || '').trim();
    if (!entryId) {
        return showError('Cannot delete: invalid entry id.');
    }

    await deleteEntryById(entryId);
}

// Correct a student's name so future searches/entries show the right spelling.
// Updates the master students record AND the denormalised name on this student's
// existing Early Angel entries.
async function editEaStudentName(studentId, currentName) {
    if (!studentId) return showError('Cannot edit: this entry has no linked student record.');

    const result = await Swal.fire({
        title: 'Edit Student Name',
        input: 'text',
        inputValue: currentName,
        inputPlaceholder: 'Correct full name',
        showCancelButton: true,
        confirmButtonText: 'Save',
        preConfirm: (val) => {
            const v = String(val || '').trim();
            if (!v) { Swal.showValidationMessage('Name cannot be empty.'); return false; }
            return v;
        }
    });
    if (!result.isConfirmed) return;

    const newName = String(result.value || '').trim();
    const parts = newName.split(/\s+/);
    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ');

    showSpinner();
    try {
        // 1) Master student record (fixes future searches/suggestions)
        await window.setDoc(window.doc(window.db, 'students', String(studentId)),
            { studentId, firstName, lastName }, { merge: true });

        // 2) This student's existing entries carry a denormalised studentName — update them
        const affected = (EA_STATE.entries || []).filter(en => String(en.studentId) === String(studentId));
        await Promise.all(affected.map(en =>
            window.setDoc(window.doc(window.db, 'earlyAngelEntries', String(en.id)),
                { studentName: newName }, { merge: true })
        ));

        // Optimistic local update
        const s = (EA_STATE.students || []).find(st => String(st.studentId ?? st.id) === String(studentId));
        if (s) { s.firstName = firstName; s.lastName = lastName; }
        (EA_STATE.entries || []).forEach(en => { if (String(en.studentId) === String(studentId)) en.studentName = newName; });
        rebuildSearchIndex();
        renderAllTables();

        createAuditLog('early_angel_student_renamed', { studentId, newName, entriesUpdated: affected.length });
        showSuccess('Name updated', `Updated to “${newName}”.`);
    } catch (err) {
        showError('Failed to update name: ' + err.message);
    } finally {
        hideSpinner();
    }
}

function renderAllTables() {
    renderLeaderboardTable();
    renderEntriesTable();
}

function renderClassDatalist() {
    const dataList = document.getElementById('ea-class-list');
    if (!dataList) return;

    dataList.innerHTML = '';
    (EA_STATE.classes || []).forEach(classDoc => {
        const opt = document.createElement('option');
        opt.value = classDoc.id;
        opt.label = classDoc.name || classDoc.id;
        dataList.appendChild(opt);
    });
}

let _eaSaving = false; // guards against rapid double-submit creating duplicates

async function saveEntry(e) {
    e.preventDefault();
    if (_eaSaving) return;

    const entryDate = document.getElementById('ea-date-input')?.value || new Date().toISOString().slice(0, 10);

    if (!EA_STATE.activeAcademicYearId) {
        return showError('Active academic year is not configured. Contact admin.');
    }

    let selection;
    try {
        selection = resolveSelectionForSubmit();
    } catch (err) {
        return showError(err.message || 'Please select or type a student name.');
    }

    const classInput = document.getElementById('ea-class-input');
    let classId = selection.mode === 'existing'
        ? String(selection.classId || '')
        : String(classInput?.value || '').trim();

    // For new (manually typed) students with no class, faculty's own class is the default
    if (!classId && isFacultyRole()) {
        classId = String(EA_STATE.roleData?.classId || '');
    }

    if (!classId) {
        return showError('Class is required. For new students, enter class before saving.');
    }

    let studentId = String(selection.studentId || '').trim();
    const studentName = String(selection.studentName || '').trim();

    if (!studentName) {
        return showError('Student name is required.');
    }

    const isNewStudent = selection.mode !== 'existing';
    if (isNewStudent || !studentId) {
        // early_angel_entries.student_id has a FK to students(student_id), so the
        // student must exist first. Open the Add Student dialog (auto ID + register),
        // which creates them and selects them — then the faculty saves again.
        openEarlyAngelAddStudent(studentName);
        return;
    }

    const nowIso = new Date().toISOString();
    const entryTime = new Date(nowIso).toTimeString().slice(0, 8); // HH:MM:SS for Postgres TIME

    // Duplicate check in-memory (entries are loaded globally) — avoids a DB round-trip.
    const isDup = (EA_STATE.entries || []).some(en =>
        String(en.classId) === String(classId) &&
        String(en.studentId) === String(studentId) &&
        String(en.entryDate) === String(entryDate));
    if (isDup) {
        return showError('Only one entry per day is allowed for a student. This entry already exists.');
    }

    const entryPayload = withAcademicYear({
        classId,
        studentId,
        studentName,
        category: 'Early Angel',
        points: 1,
        entryDate,
        entryTime,
        createdAt: nowIso,
    });

    _eaSaving = true;
    try {
        const saved = await window.addDoc(window.collection(window.db, 'earlyAngelEntries'), entryPayload);

        // Instant UI update — don't wait for the realtime/poll listener.
        EA_STATE.entries.push({ id: saved?.id, ...entryPayload });
        rebuildLeaderboardFromEntries();
        rebuildSearchIndex();
        renderAllTables();
        refreshInstantReportDateOptions();

        // Reset for the next entry and show a lightweight, non-blocking toast.
        document.getElementById('ea-entry-form')?.reset();
        clearStudentSelection();
        setDateToToday();
        eaToast(`${studentName} marked ✓`);

        // Audit log in the background (don't block the UI).
        createAuditLog('early_angel_entry_saved', {
            entryId: saved?.id || null, classId, studentId, studentName,
            entryDate, entryTime, academicYearId: EA_STATE.activeAcademicYearId,
        });
    } catch (err) {
        showError('Failed to save entry: ' + err.message);
    } finally {
        _eaSaving = false;
    }
}

// Lightweight non-blocking toast for the high-frequency Early Angel entry flow.
function eaToast(title, icon = 'success') {
    if (typeof Swal === 'undefined') return;
    Swal.fire({
        toast: true,
        position: 'top-end',
        icon,
        title,
        showConfirmButton: false,
        timer: 1100,
        timerProgressBar: true,
    });
}

function setupUiListeners() {
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

        if (!e.target.closest('.ea-search-wrap')) {
            hideStudentSuggestions();
        }
    });

    document.getElementById('ea-back-btn')?.addEventListener('click', () => {
        if (isAdminRole()) {
            window.location.href = 'admin.html';
            return;
        }
        window.location.href = 'faculty.html';
    });

    const searchInput = document.getElementById('ea-student-search-input');
    searchInput?.addEventListener('input', (e) => {
        const value = String(e.target.value || '');
        if (EA_STATE.selectedStudent && EA_STATE.selectedStudent.displayText !== value.trim()) {
            clearStudentSelection({ keepInput: true });
        }
        renderStudentSuggestions(value);
    });

    searchInput?.addEventListener('focus', (e) => {
        const value = String(e.target.value || '');
        if (value.trim()) renderStudentSuggestions(value);
    });

    searchInput?.addEventListener('blur', () => {
        setTimeout(hideStudentSuggestions, 160);
    });

    document.getElementById('ea-student-suggestions')?.addEventListener('click', handleSuggestionClick);
    document.getElementById('ea-add-student-btn')?.addEventListener('click', () => {
        openEarlyAngelAddStudent(document.getElementById('ea-student-search-input')?.value || '');
    });
    document.getElementById('ea-entry-form')?.addEventListener('submit', saveEntry);
    document.getElementById('ea-table-search')?.addEventListener('input', renderAllTables);
    document.querySelector('#ea-entries-table tbody')?.addEventListener('click', handleEntriesTableClick);
    document.getElementById('ea-instant-report-date-select')?.addEventListener('change', handleInstantReportDateChange);
    document.getElementById('ea-generate-instant-report-btn')?.addEventListener('click', generateInstantReport);
    document.getElementById('ea-generate-entire-report-btn')?.addEventListener('click', generateEntireReport);

    const dateInput = document.getElementById('ea-date-input');
    dateInput?.addEventListener('click', applyDateWarningOnce);
    dateInput?.addEventListener('focus', applyDateWarningOnce);
}

async function fetchRoleData(uid) {
    const roleRef = doc(window.db, 'userRoles', uid);
    const roleSnap = await getDoc(roleRef);
    if (!roleSnap.exists()) {
        throw new Error('No role assigned for this user.');
    }

    return { uid, ...roleSnap.data() };
}

async function loadClasses() {
    const snap = await getDocs(collection(window.db, 'classes'));
    const rows = [];
    snap.forEach(docSnap => {
        rows.push({ id: docSnap.id, ...(docSnap.data() || {}) });
    });
    EA_STATE.classes = rows;
    renderClassDatalist();
}

function buildStudentsQuery() {
    // Early Angel is a school-wide program: every faculty can mark any student,
    // so always load ALL students (no per-class scoping).
    return collection(window.db, 'students');
}

function buildEarlyAngelQuery(collectionName) {
    // Year-scoped only — all classes are visible to every faculty.
    if (EA_STATE.activeAcademicYearId) {
        return query(
            collection(window.db, collectionName),
            where('academicYearId', '==', EA_STATE.activeAcademicYearId)
        );
    }
    return collection(window.db, collectionName);
}

function startRealtimeListeners() {
    if (!window.db || !window.onSnapshot) {
        throw new Error('Realtime Firestore APIs are not available.');
    }

    stopRealtimeListeners();

    const studentsUnsub = onSnapshot(buildStudentsQuery(), snapshot => {
        EA_STATE.students = [];
        snapshot.forEach(docSnap => {
            EA_STATE.students.push({ id: docSnap.id, ...(docSnap.data() || {}) });
        });
        rebuildSearchIndex();

        const currentInput = document.getElementById('ea-student-search-input')?.value || '';
        if (currentInput.trim()) {
            renderStudentSuggestions(currentInput);
        }
    }, err => console.error('students listener error:', err));
    window.realtimeUnsubscribers.push(studentsUnsub);

    const entriesUnsub = onSnapshot(buildEarlyAngelQuery('earlyAngelEntries'), snapshot => {
        EA_STATE.entries = [];
        snapshot.forEach(docSnap => {
            EA_STATE.entries.push({ id: docSnap.id, ...(docSnap.data() || {}) });
        });
        rebuildLeaderboardFromEntries();
        rebuildSearchIndex();
        renderAllTables();
        refreshInstantReportDateOptions();
    }, err => console.error('earlyAngelEntries listener error:', err));
    window.realtimeUnsubscribers.push(entriesUnsub);
}

async function initializePortal(user) {
    const roleData = await fetchRoleData(user.uid);
    const role = normalizeRole(roleData.role);

    if (role !== 'admin' && role !== 'faculty') {
        throw new Error('Access denied. Early Angel portal is only for Admin or Faculty users.');
    }

    EA_STATE.user = user;
    EA_STATE.roleData = roleData;

    const localUser = {
        uid: user.uid,
        email: user.email || roleData.email || 'unknown',
        role: roleData.role,
        classId: roleData.classId || null,
    };
    localStorage.setItem('currentUser', JSON.stringify(localUser));

    document.getElementById('user-info-email').textContent = user.email || roleData.email || 'unknown';
    document.getElementById('user-info-role').textContent = role === 'admin'
        ? 'Administrator'
        : `Faculty - ${roleData.classId || 'Unassigned'}`;

    await loadAcademicYearContext(true);
    EA_STATE.activeAcademicYearId = getActiveAcademicYearId();

    if (isFacultyRole() && !EA_STATE.roleData.classId) {
        throw new Error('Faculty class is not configured. Contact admin.');
    }

    setupUiListeners();
    await loadClasses();

    // Global mode: class is editable for everyone (faculty can mark any class).
    // Pre-fill the faculty's own class as a convenience; it stays changeable.
    updateClassField(true, isFacultyRole() ? (EA_STATE.roleData.classId || '') : '');

    setDateToToday();
    refreshInstantReportDateOptions();
    startRealtimeListeners();

    document.getElementById('app-content').classList.remove('is-hidden');
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

        showSpinner();
        try {
            await initializePortal(user);
        } catch (err) {
            console.error(err);
            handleAppError(err.message || 'Failed to initialize Early Angel portal.');
        } finally {
            hideSpinner();
        }
    });
});
