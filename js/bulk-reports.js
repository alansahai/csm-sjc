// ---------------------------------------------------------
// 📄 BULK CLASS REPORT GENERATION (Curtain Method + Tables)
// ---------------------------------------------------------

/**
 * Main Orchestrator - Generates bulk class reports with GRAPHS
 * Uses the "Visible Curtain Technique" to ensure html2canvas captures rendered content
 */
async function generateAndDownloadBulkClassReports() {
    const classSelect = document.getElementById('bulk-report-class-select');
    const selectedClassId = classSelect?.value;

    if (!selectedClassId) return showError('Please select a class first.');

    const selectedClass = DATA_MODELS.classes.find(c => c.id === selectedClassId);
    if (!selectedClass) return showError('Selected class not found.');

    const classStudents = DATA_MODELS.students
        .filter(s => s.classId === selectedClassId)
        .sort((a, b) => String(a.studentId).localeCompare(String(b.studentId), undefined, { numeric: true }));

    if (classStudents.length === 0) return showError('No students found in this class.');

    const btn = document.getElementById('generate-bulk-reports-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Initializing...';
    btn.disabled = true;

    // ----------------------------------------------------------
    // 1. THE CURTAIN (Dark overlay hiding the rendering work)
    // ----------------------------------------------------------
    const curtain = document.createElement('div');
    curtain.id = 'bulk-report-curtain';
    curtain.style.position = 'fixed';
    curtain.style.top = '0';
    curtain.style.left = '0';
    curtain.style.width = '100vw';
    curtain.style.height = '100vh';
    curtain.style.zIndex = '99999';
    curtain.style.background = 'rgba(44, 62, 80, 0.98)';
    curtain.style.display = 'flex';
    curtain.style.flexDirection = 'column';
    curtain.style.alignItems = 'center';
    curtain.style.justifyContent = 'center';
    curtain.style.color = 'white';
    curtain.style.fontFamily = 'Segoe UI, sans-serif';
    curtain.style.overflow = 'hidden';

    curtain.innerHTML = `
        <div style="font-size: 3rem; margin-bottom: 20px;"><i class="fas fa-print fa-spin"></i></div>
        <h2 id="bulk-curtain-title">Generating Class Reports</h2>
        <p id="bulk-curtain-status" style="font-size: 1.2rem; opacity: 0.8; margin-bottom: 20px;">Setting up environment...</p>
        <div style="width: 300px; height: 6px; background: rgba(255,255,255,0.2); border-radius: 3px; overflow: hidden;">
            <div id="bulk-progress-bar" style="width: 0%; height: 100%; background: linear-gradient(90deg, #3498db, #2ecc71); transition: width 0.3s;"></div>
        </div>
    `;
    document.body.appendChild(curtain);

    // Status Update Helper
    const updateStatus = (msg, percent) => {
        const statusEl = document.getElementById('bulk-curtain-status');
        const barEl = document.getElementById('bulk-progress-bar');
        if (statusEl) statusEl.innerText = msg;
        if (barEl) barEl.style.width = `${Math.min(percent, 99)}%`;
    };

    // ----------------------------------------------------------
    // 2. THE CONTAINER (Visible in viewport behind curtain)
    // ----------------------------------------------------------
    const container = document.createElement('div');
    container.id = 'bulk-pdf-container';
    container.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 800px;
        height: 100vh;
        background: white;
        zIndex: 1;
        padding: 0;
        margin: 0;
        overflow: auto;
        visibility: visible;
        opacity: 1;
        display: block;
        font-size: 16px;
    `;
    document.body.appendChild(container);

    // CRITICAL: Reset scroll to ensure html2canvas doesn't get confused
    window.scrollTo(0, 0);

    try {
        // --- Generate Cover Page ---
        updateStatus('Creating cover page...', 5);

        container.innerHTML = `
            <div style="width: 800px; height: 1100px; page-break-after: always; padding: 0; margin: 0; position: relative; background: white;">
                <div style="text-align: center; padding-top: 300px; font-family: 'Segoe UI', sans-serif;">
                    <h1 style="font-size: 48px; color: #2c3e50; margin: 0 0 20px 0;">${escapeHtml(selectedClass.name)}</h1>
                    <h2 style="font-size: 32px; color: #7f8c8d; font-weight: 300; margin: 0 0 50px 0;">Student Performance Reports</h2>
                    <div style="display: inline-block; padding: 20px 50px; border: 1px solid #bdc3c7; border-radius: 8px; background: #f8f9fa;">
                        <p style="font-size: 18px; color: #2c3e50; margin: 12px 0;"><strong>Date:</strong> ${formatDate(new Date().toISOString())}</p>
                        <p style="font-size: 18px; color: #2c3e50; margin: 12px 0;"><strong>Total Students:</strong> ${classStudents.length}</p>
                        <p style="font-size: 18px; color: #2c3e50; margin: 12px 0;"><strong>Generated By:</strong> Catechism Admin System</p>
                    </div>
                </div>
            </div>
        `;

        // --- Generate Student Report Pages ---
        for (let i = 0; i < classStudents.length; i++) {
            const student = classStudents[i];
            const percent = Math.round((i / classStudents.length) * 75) + 5;
            updateStatus(`Rendering Student Report ${i + 1} of ${classStudents.length}...`, percent);

            // Create page wrapper with explicit styling
            const pageWrapper = document.createElement('div');
            pageWrapper.style.cssText = `
                width: 800px;
                height: auto;
                min-height: 1100px;
                page-break-after: always;
                page-break-before: avoid;
                position: relative;
                background: white;
                margin: 0;
                padding: 0;
                display: block;
            `;

            // Populate with HTML
            pageWrapper.innerHTML = generateStudentReportDOM(student);
            container.appendChild(pageWrapper);

            // Render Charts
            const marksChartId = `bulk-marks-${student.studentId}`;
            const attChartId = `bulk-att-${student.studentId}`;

            // Prepare assessment data
            const studentScores = DATA_MODELS.scores.filter(s => s.studentId === student.studentId);
            const assessmentDetails = studentScores.map(score => {
                const assessment = DATA_MODELS.assessments.find(a => a.id === score.assessmentId);
                return {
                    name: assessment ? assessment.name : 'Unknown',
                    totalMarks: (assessment && assessment.totalMarks > 0) ? assessment.totalMarks : 0,
                    marks: score.marks
                };
            }).sort((a, b) => a.name.localeCompare(b.name));

            // Render charts WITHOUT animation for faster PDF capture
            renderMarksChart(assessmentDetails, marksChartId, false);
            renderAttendanceChart(student.studentId, DATA_MODELS, attChartId, false);

            // Small pause to prevent CPU overload
            if (i % 5 === 0) await new Promise(r => setTimeout(r, 50));
        }

        // --- Wait for Charts to Render & Paint ---
        updateStatus('Finalizing charts...', 80);
        await new Promise(r => setTimeout(r, 1500)); // Give Chart.js time

        // --- Freeze all Charts (Canvas -> PNG Image) ---
        updateStatus('Freezing charts for PDF...', 85);

        const canvases = container.querySelectorAll('canvas');
        console.log(`Found ${canvases.length} canvases to freeze`);

        canvases.forEach((canvas, idx) => {
            try {
                // Ensure canvas has rendered content
                if (canvas.width > 0 && canvas.height > 0) {
                    const imgData = canvas.toDataURL('image/png');

                    // Create replacement image
                    const img = document.createElement('img');
                    img.src = imgData;
                    img.style.cssText = `
                        width: 100%;
                        height: auto;
                        display: block;
                        margin: 0;
                        padding: 0;
                    `;

                    // Replace canvas with image in DOM
                    if (canvas.parentNode) {
                        canvas.parentNode.replaceChild(img, canvas);
                    }
                }
            } catch (err) {
                console.warn(`Could not freeze canvas ${idx}:`, err);
            }
        });

        // --- Generate PDF ---
        updateStatus('Generating PDF...', 90);

        const filename = `Class_${selectedClass.name.replace(/[^a-z0-9]/gi, '_')}_Reports.pdf`;
        const opt = {
            margin: 0,
            filename: filename,
            image: { type: 'jpeg', quality: 0.95 },
            html2canvas: {
                scale: 2,
                useCORS: true,
                logging: false,
                scrollY: 0,
                scrollX: 0,
                windowWidth: 800,
                windowHeight: 1100,
                backgroundColor: '#ffffff'
            },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: 'css', before: 'div.page-break', avoidAll: ['tr', 'td'] }
        };

        console.log(`Generating PDF with ${classStudents.length} pages...`);
        await html2pdf().set(opt).from(container).save();

        updateStatus('Complete!', 100);
        await new Promise(r => setTimeout(r, 500));

        showSuccess(`Success!`, `Generated reports for ${classStudents.length} students.`);
        createAuditLog('bulk_reports_generated', { classId: selectedClassId, count: classStudents.length });

    } catch (err) {
        console.error('Bulk report error:', err);
        updateStatus(`Error: ${err.message}`, 0);
        await new Promise(r => setTimeout(r, 2000));
        showError('Failed to generate reports', err.message || 'Unknown error occurred');
    } finally {
        // Cleanup: Remove curtain and container
        if (document.body.contains(curtain)) {
            document.body.removeChild(curtain);
        }
        if (document.body.contains(container)) {
            document.body.removeChild(container);
        }

        // Restore button
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

/**
 * Generates the HTML string for a single student.
 * Uses TABLES instead of Flexbox to ensure perfect PDF rendering.
 */
function generateStudentReportDOM(student) {
    const totalSessions = DATA_MODELS.sessions.filter(s => s.status === 'Available').length;
    const studentAttendance = DATA_MODELS.attendance.filter(a => a.studentId === student.studentId);
    const presentCount = studentAttendance.filter(a => a.status === 'Present' || a.status === 'Late').length;
    const attendancePercentage = totalSessions > 0 ? Math.round((presentCount / totalSessions) * 100) : 0;

    const marksChartId = `bulk-marks-${student.studentId}`;
    const attChartId = `bulk-att-${student.studentId}`;

    return `
        <div style="padding: 40px; font-family: 'Segoe UI', sans-serif; color: #333;">
            
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; border-bottom: 2px solid #3498db;">
                <tr>
                    <td style="padding-bottom: 15px; vertical-align: bottom;">
                        <h2 style="margin: 0; font-size: 28px; color: #2c3e50;">${escapeHtml(student.firstName)} ${escapeHtml(student.lastName)}</h2>
                        <div style="color: #7f8c8d; font-size: 14px; margin-top: 5px;">ID: ${escapeHtml(student.studentId)}</div>
                    </td>
                    <td style="text-align: right; padding-bottom: 15px; vertical-align: bottom; color: #7f8c8d; font-size: 14px;">
                        <div><strong>Guardian:</strong> ${escapeHtml(student.guardian || 'N/A')}</div>
                        <div><strong>Phone:</strong> ${escapeHtml(student.phone || 'N/A')}</div>
                    </td>
                </tr>
            </table>

            <table style="width: 100%; border-collapse: separate; border-spacing: 10px 0; margin-left: -10px; margin-bottom: 30px;">
                <tr>
                    <td style="width: 50%; background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 15px; vertical-align: top;">
                        <h4 style="margin: 0 0 10px; font-size: 14px; text-transform: uppercase; color: #6c757d;">Attendance</h4>
                        <div>
                            <span style="font-size: 32px; font-weight: bold; color: ${attendancePercentage < 75 ? '#e74c3c' : '#27ae60'};">${attendancePercentage}%</span>
                            <span style="font-size: 14px; color: #6c757d; margin-left: 5px;">(${presentCount}/${totalSessions})</span>
                        </div>
                    </td>
                    <td style="width: 50%; background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 15px; vertical-align: top;">
                        <h4 style="margin: 0 0 10px; font-size: 14px; text-transform: uppercase; color: #6c757d;">Status</h4>
                        <div style="font-size: 18px; font-weight: 600;">
                            ${attendancePercentage >= 75 ? '<span style="color:#27ae60">Good Standing</span>' : '<span style="color:#e74c3c">Needs Improvement</span>'}
                        </div>
                    </td>
                </tr>
            </table>

            <div style="margin-bottom: 30px; page-break-inside: avoid;">
                <h3 style="font-size: 16px; border-bottom: 1px solid #eee; padding-bottom: 8px; margin-bottom: 15px; color: #2c3e50;">Academic Performance</h3>
                <div style="height: 300px; width: 700px; position: relative; margin: 0 auto;">
                    <canvas id="${marksChartId}" width="700" height="300"></canvas>
                </div>
            </div>

            <div style="margin-bottom: 20px; page-break-inside: avoid;">
                <h3 style="font-size: 16px; border-bottom: 1px solid #eee; padding-bottom: 8px; margin-bottom: 15px; color: #2c3e50;">Attendance History</h3>
                <div style="height: 250px; width: 700px; position: relative; margin: 0 auto;">
                    <canvas id="${attChartId}" width="700" height="250"></canvas>
                </div>
            </div>
            
            <div style="text-align: center; color: #bdc3c7; font-size: 10px; margin-top: 40px; border-top: 1px solid #eee; padding-top: 10px;">
                Catechism Manager System
            </div>
        </div>
    `;

}