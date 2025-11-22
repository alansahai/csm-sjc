/**
 * auth.js
 * Handles login for Faculty (Firebase Auth) and Students (Firestore Lookup).
 */

document.addEventListener('DOMContentLoaded', function () {
    const loginForm = document.getElementById('login-form');       // Faculty
    const studentForm = document.getElementById('student-login-form'); // Student

    // Toggles
    const btnFaculty = document.getElementById('btn-faculty-mode');
    const btnStudent = document.getElementById('btn-student-mode');

    // Faculty Inputs
    const loginButton = document.getElementById('login-button');
    const togglePassword = document.getElementById('toggle-password');
    const passwordInput = document.getElementById('login-password');

    // Student Inputs
    const studentLoginBtn = document.getElementById('student-login-btn');

    showSpinner();

    // --- TOGGLE LOGIC ---
    if (btnFaculty && btnStudent) {
        btnFaculty.addEventListener('click', () => {
            btnFaculty.classList.add('active');
            btnStudent.classList.remove('active');
            loginForm.classList.remove('is-hidden');
            studentForm.classList.add('is-hidden');
            hideError();
        });

        btnStudent.addEventListener('click', () => {
            btnStudent.classList.add('active');
            btnFaculty.classList.remove('active');
            studentForm.classList.remove('is-hidden');
            loginForm.classList.add('is-hidden');
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
            if (!window.auth || !window.signInWithEmailAndPassword) return showError('Auth service not ready.');

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
                // 1. Try to find by Student ID (Doc ID)
                let studentData = null;
                const { doc, getDoc, collection, query, where, getDocs, db } = window;

                // Check by ID first (assuming identifier is the doc ID)
                const docRef = doc(db, 'students', identifier);
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    studentData = docSnap.data();
                } else {
                    // 2. If not found by ID, try finding by Phone
                    const q = query(collection(db, 'students'), where('phone', '==', identifier));
                    const querySnap = await getDocs(q);
                    if (!querySnap.empty) {
                        studentData = querySnap.docs[0].data();
                    }
                }

                // 3. Validate DOB
                if (studentData) {
                    if (studentData.dob === dob) {
                        // SUCCESS: Store in Session Storage (Cleared on browser close)
                        sessionStorage.setItem('currentStudent', JSON.stringify(studentData));
                        window.location.href = 'student.html';
                    } else {
                        throw new Error('Date of Birth does not match our records.');
                    }
                } else {
                    throw new Error('Student ID or Mobile Number not found.');
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

    // --- 3. SESSION RESTORE (Faculty Only) ---
    // Students use sessionStorage, so they don't auto-login via Firebase Auth state
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

// ... [Keep handleUserRole, getUserRole, showSpinner, hideSpinner, showError, hideError exactly as they were] ...
// (Re-paste the helper functions from your original auth.js here if you are replacing the file completely)

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

        if (userRoleDoc.role === 'admin') window.location.href = 'admin.html';
        else if (userRoleDoc.role === 'faculty') window.location.href = 'faculty.html';
        else throw new Error("Unauthorized role.");

    } catch (error) {
        if (window.auth && window.signOut) await window.signOut(window.auth);
        localStorage.removeItem('currentUser');
        showError(error.message);
        hideSpinner();
    }
}

async function getUserRole(uid) {
    if (!window.db || !window.doc || !window.getDoc) return null;
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