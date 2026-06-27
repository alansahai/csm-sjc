/**
 * auth.js
 * Handles login for Faculty (Supabase Auth), Students (DB Lookup),
 * and Parents (sessionStorage, no auth session needed).
 */

async function logAuthEvent(action, details = {}, actorEmail = 'unknown', actorUid = null) {
    try {
        if (!window.supabase) return;
        await window.supabase.from('activity_logs').insert({
            action, details,
            user_email: actorEmail,
            uid: actorUid,
            created_at: new Date().toISOString(),
        });
    } catch (_) {}
}

async function getActiveAcademicYearIdFromConfig() {
    if (!window.db) return null;
    try {
        const snap = await window.getDoc(window.doc(window.db, 'appConfig', 'global'));
        if (!snap.exists()) return null;
        return snap.data()?.activeAcademicYearId || null;
    } catch (err) {
        console.warn('Failed to fetch active academic year from config:', err);
        return null;
    }
}

function isStudentInActiveYear(studentData, activeAcademicYearId) {
    if (!studentData) return false;
    if (!activeAcademicYearId) return true;
    return !studentData.academicYearId || studentData.academicYearId === activeAcademicYearId;
}

document.addEventListener('DOMContentLoaded', function () {
    const loginForm = document.getElementById('login-form');             // Faculty
    const studentForm = document.getElementById('student-login-form');   // Student
    const parentForm = document.getElementById('parent-login-form');     // Parent

    // Toggles
    const btnFaculty = document.getElementById('btn-faculty-mode');
    const btnStudent = document.getElementById('btn-student-mode');
    const btnParent = document.getElementById('btn-parent-mode');

    // Faculty Inputs
    const loginButton = document.getElementById('login-button');
    const togglePassword = document.getElementById('toggle-password');
    const passwordInput = document.getElementById('login-password');

    // Student Inputs
    const studentLoginBtn = document.getElementById('student-login-btn');

    // Parent Inputs
    const parentLoginBtn = document.getElementById('parent-login-btn');

    showSpinner();

    // --- TOGGLE LOGIC ---
    if (btnFaculty && btnStudent) {
        btnFaculty.addEventListener('click', () => {
            btnFaculty.classList.add('active');
            btnStudent.classList.remove('active');
            if (btnParent) btnParent.classList.remove('active');
            loginForm.classList.remove('is-hidden');
            studentForm.classList.add('is-hidden');
            if (parentForm) parentForm.classList.add('is-hidden');
            hideError();
        });

        btnStudent.addEventListener('click', () => {
            btnStudent.classList.add('active');
            btnFaculty.classList.remove('active');
            if (btnParent) btnParent.classList.remove('active');
            studentForm.classList.remove('is-hidden');
            loginForm.classList.add('is-hidden');
            if (parentForm) parentForm.classList.add('is-hidden');
            hideError();
        });
    }

    if (btnParent && parentForm) {
        btnParent.addEventListener('click', () => {
            btnParent.classList.add('active');
            if (btnFaculty) btnFaculty.classList.remove('active');
            if (btnStudent) btnStudent.classList.remove('active');
            parentForm.classList.remove('is-hidden');
            loginForm.classList.add('is-hidden');
            studentForm.classList.add('is-hidden');
            hideError();
        });
    }

    // Password Eye Toggle
    if (togglePassword && passwordInput) {
        togglePassword.addEventListener('click', function () {
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);
            const icon = this.querySelector('i');
            icon.classList.toggle('fa-eye');
            icon.classList.toggle('fa-eye-slash');
        });
    }

    // --- 1. FACULTY LOGIN HANDLER ---
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!window.signInWithEmailAndPassword) return showError('Auth service not ready.');

            const email = document.getElementById('login-email').value.trim();
            const password = document.getElementById('login-password').value.trim();

            loginButton.disabled = true;
            loginButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging in...';
            hideError();

            try {
                const userCredential = await window.signInWithEmailAndPassword(window.auth, email, password);
                const user = userCredential.user;
                await handleUserRole(user);
            } catch (error) {
                console.error('Login error:', error.code, error.message);
                showError('Invalid email or password.');
            } finally {
                loginButton.disabled = false;
                loginButton.innerHTML = 'Faculty Login';
            }
        });
    }

    // --- 2. STUDENT LOGIN HANDLER ---
    if (studentForm) {
        studentForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const identifier = document.getElementById('student-identifier').value.trim();
            const dob = document.getElementById('student-dob-login').value;

            if (!identifier || !dob) return showError('Please fill in all fields.');

            studentLoginBtn.disabled = true;
            studentLoginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
            hideError();

            try {
                // Supabase anon key allows read-only access to public tables — no explicit sign-in needed
                let studentData = null;
                let enrollmentData = null;
                const { doc, getDoc, collection, query, where, getDocs, db } = window;
                const activeAcademicYearId = await getActiveAcademicYearIdFromConfig();

                const registerNoInt = parseInt(identifier, 10);
                const looksLikeRegisterNo = !Number.isNaN(registerNoInt) && String(registerNoInt) === identifier.trim();

                if (looksLikeRegisterNo && activeAcademicYearId) {
                    // 1. Look up by register number in active year's enrollments
                    const enrollSnap = await getDocs(query(
                        collection(db, 'enrollments'),
                        where('academicYearId', '==', activeAcademicYearId),
                        where('registerNo', '==', registerNoInt)
                    ));
                    if (!enrollSnap.empty) {
                        enrollmentData = enrollSnap.docs[0].data();
                        const studentSnap = await getDoc(doc(db, 'students', String(enrollmentData.studentId)));
                        if (studentSnap.exists()) studentData = studentSnap.data();
                    }
                }

                if (!studentData) {
                    // 2. Fallback: look up by phone number
                    const phoneSnap = await getDocs(query(collection(db, 'students'), where('phone', '==', identifier)));
                    if (!phoneSnap.empty) {
                        studentData = phoneSnap.docs[0].data();
                        if (activeAcademicYearId) {
                            const eSnap = await getDocs(query(
                                collection(db, 'enrollments'),
                                where('academicYearId', '==', activeAcademicYearId),
                                where('studentId', '==', studentData.studentId)
                            ));
                            enrollmentData = eSnap.empty ? null : eSnap.docs[0].data();
                        }
                    }
                }

                // 3. Validate DOB
                if (studentData) {
                    if (studentData.dob === dob) {
                        const activeStudentData = {
                            ...studentData,
                            academicYearId: enrollmentData?.academicYearId || studentData.academicYearId || activeAcademicYearId || null,
                            classId: enrollmentData?.classId || studentData.classId || null,
                            registerNo: enrollmentData?.registerNo ?? studentData.registerNo ?? null,
                            enrollmentId: enrollmentData?.id || null
                        };
                        sessionStorage.setItem('currentStudent', JSON.stringify(activeStudentData));
                        await logAuthEvent('student_login', { studentId: activeStudentData.studentId, registerNo: activeStudentData.registerNo, classId: activeStudentData.classId }, activeStudentData.email || activeStudentData.phone || 'student', activeStudentData.studentId);
                        window.location.href = 'student.html';
                    } else {
                        throw new Error('Date of Birth does not match our records.');
                    }
                } else {
                    throw new Error('Register number or mobile number not found.');
                }

            } catch (error) {
                console.warn(error);
                showError(error.message);
            } finally {
                studentLoginBtn.disabled = false;
                studentLoginBtn.innerHTML = 'Student Login';
            }
        });
    }

    // --- 3. PARENT LOGIN HANDLER ---
    if (parentForm) {
        parentForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const studentId = document.getElementById('parent-student-id').value.trim();
            const dob = document.getElementById('parent-dob-login').value;

            if (!studentId || !dob) return showError('Please fill in all fields.');

            if (parentLoginBtn) {
                parentLoginBtn.disabled = true;
                parentLoginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
            }
            hideError();

            try {
                const { doc, getDoc, collection, query, where, getDocs, db } = window;
                if (!db) throw new Error('Database service not ready.');

                // Supabase anon key allows read-only access — no explicit sign-in needed
                const activeAcademicYearId = await getActiveAcademicYearIdFromConfig();

                // Look up student by ID
                const docRef = doc(db, 'students', studentId);
                const docSnap = await getDoc(docRef);

                if (!docSnap.exists()) {
                    throw new Error('Student ID not found. Please check the ID and try again.');
                }

                const studentData = docSnap.data();

                if (studentData.dob !== dob) {
                    throw new Error('Date of Birth does not match our records.');
                }

                // Get enrollment data for active year
                let enrollmentData = null;
                if (activeAcademicYearId) {
                    const enrollmentQuery = query(
                        collection(db, 'enrollments'),
                        where('academicYearId', '==', activeAcademicYearId),
                        where('studentId', '==', studentData.studentId || studentId)
                    );
                    const enrollmentSnap = await getDocs(enrollmentQuery);
                    enrollmentData = enrollmentSnap.empty ? null : enrollmentSnap.docs[0].data();
                }

                // Build parent session object
                const parentSession = {
                    studentId: studentData.studentId || studentId,
                    studentName: `${studentData.firstName || ''} ${studentData.lastName || ''}`.trim(),
                    firstName: studentData.firstName || '',
                    lastName: studentData.lastName || '',
                    dob: studentData.dob || dob,
                    classId: enrollmentData?.classId || studentData.classId || null,
                    academicYearId: enrollmentData?.academicYearId || studentData.academicYearId || activeAcademicYearId || null,
                    registerNo: enrollmentData?.registerNo ?? studentData.registerNo ?? null,
                    enrollmentId: enrollmentData?.id || null,
                    guardianName: studentData.guardianName || studentData.fatherName || '',
                    phone: studentData.phone || '',
                    loginTime: new Date().toISOString()
                };

                sessionStorage.setItem('parentSession', JSON.stringify(parentSession));
                await logAuthEvent('parent_login', { studentId: parentSession.studentId, studentName: parentSession.studentName }, parentSession.phone || 'parent', parentSession.studentId);
                window.location.href = 'parent.html';

            } catch (error) {
                console.warn('Parent login error:', error);
                showError(error.message);
            } finally {
                if (parentLoginBtn) {
                    parentLoginBtn.disabled = false;
                    parentLoginBtn.innerHTML = 'View My Child\'s Portal';
                }
            }
        });
    }

    // --- 4. SESSION RESTORE (Faculty Only) ---
    // Students and Parents use sessionStorage — only restore faculty sessions here.
    if (window.onAuthStateChanged) {
        window.onAuthStateChanged(window.auth, async (user) => {
            if (user) {
                await handleUserRole(user);
            } else {
                hideSpinner();
                document.getElementById('login-screen').style.opacity = '1';
            }
        });
    } else {
        hideSpinner();
    }
});

async function handleUserRole(user) {
    try {
        const userRoleDoc = await getUserRole(user.uid);
        if (!userRoleDoc || !userRoleDoc.role) throw new Error("No role found.");

        const userData = {
            uid: user.uid,
            email: user.email,
            role: userRoleDoc.role,
            classId: userRoleDoc.classId || null
        };
        localStorage.setItem('currentUser', JSON.stringify(userData));

        await logAuthEvent('login', { role: userRoleDoc.role, classId: userRoleDoc.classId || null }, user.email, user.uid);
        if (userRoleDoc.role === 'admin') window.location.href = 'admin.html';
        else if (userRoleDoc.role === 'faculty') window.location.href = 'faculty.html';
        else throw new Error("Unauthorized role.");

    } catch (error) {
        if (window.supabase) await window.supabase.auth.signOut();
        localStorage.removeItem('currentUser');
        showError(error.message);
        hideSpinner();
    }
}

async function getUserRole(uid) {
    if (!window.db) return null;
    try {
        const docSnap = await window.getDoc(window.doc(window.db, 'userRoles', uid));
        return docSnap.exists() ? docSnap.data() : null;
    } catch (err) { return null; }
}

function showSpinner() {
    const spinner = document.getElementById('full-page-spinner');
    if (spinner) spinner.classList.remove('is-hidden');
}
function hideSpinner() {
    const spinner = document.getElementById('full-page-spinner');
    if (spinner) spinner.classList.add('is-hidden');
}
function showError(message) {
    let errorEl = document.getElementById('login-error');
    if (!errorEl) {
        errorEl = document.createElement('p');
        errorEl.id = 'login-error';
        errorEl.style.color = 'var(--danger)';
        errorEl.style.marginTop = '15px';
        const form = document.querySelector('form:not(.is-hidden)');
        if (form) form.appendChild(errorEl);
        else document.querySelector('.login-box').appendChild(errorEl);
    }
    errorEl.textContent = message;
    errorEl.style.display = 'block';
    Swal.fire({ icon: 'error', title: 'Login Failed', text: message });
}
function hideError() {
    const errorEl = document.getElementById('login-error');
    if (errorEl) errorEl.style.display = 'none';
}
