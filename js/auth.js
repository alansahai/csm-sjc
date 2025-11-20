/**
 * auth.js
 * Handles login, session restore, and redirection for the main index.html page.
 */

document.addEventListener('DOMContentLoaded', function () {
    const loginForm = document.getElementById('login-form');
    const loginButton = document.getElementById('login-button');
    const togglePassword = document.getElementById('toggle-password');
    const passwordInput = document.getElementById('login-password');

    // Show spinner on load
    showSpinner();

    if (togglePassword && passwordInput) {
        togglePassword.addEventListener('click', function () {
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);
            const icon = this.querySelector('i');
            if (type === 'password') {
                icon.classList.remove('fa-eye-slash');
                icon.classList.add('fa-eye');
            } else {
                icon.classList.remove('fa-eye');
                icon.classList.add('fa-eye-slash');
            }
        });
    }

    // 1. Login Form Submit Handler
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!window.auth || !window.signInWithEmailAndPassword) {
                return showError('Auth service not ready. Please wait...');
            }

            const email = document.getElementById('login-email').value.trim();
            const password = document.getElementById('login-password').value.trim();

            loginButton.disabled = true;
            loginButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging in...';
            hideError(); // Hide previous errors

            try {
                const userCredential = await window.signInWithEmailAndPassword(window.auth, email, password);
                const user = userCredential.user;

                // User is authenticated, now check their role.
                // This function (handleUserRole) will also perform the redirect.
                await handleUserRole(user);

            } catch (error) {
                console.error('Login error:', error.code, error.message);
                let msg = 'An error occurred. Please try again.';
                if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
                    msg = 'Invalid email or password.';
                } else if (error.message.includes("no role found")) {
                    msg = 'Login successful, but no role is assigned to this account.';
                }
                showError(msg); // Show error in UI
            } finally {
                loginButton.disabled = false;
                loginButton.innerHTML = 'Login';
            }
        });
    }

    // 2. Session Restore Logic (using onAuthStateChanged)
    if (window.onAuthStateChanged) {
        window.onAuthStateChanged(window.auth, async (user) => {
            if (user) {
                // User is signed in. Check role and redirect.
                console.log('onAuthStateChanged: User is signed in, checking role...');
                await handleUserRole(user);
            } else {
                // User is signed out. Show the login screen.
                console.log('onAuthStateChanged: User is signed out.');
                hideSpinner();
                document.getElementById('login-screen').style.opacity = '1';
            }
        });
    } else {
        showError("Fatal Error: Auth service failed to load.");
        hideSpinner();
    }
});

/**
 * Fetches a user's role from Firestore and redirects them to the correct dashboard.
 * @param {object} user - The Firebase Auth user object.
 */
async function handleUserRole(user) {
    try {
        const userRoleDoc = await getUserRole(user.uid);

        if (!userRoleDoc || !userRoleDoc.role) {
            throw new Error("Login success, but no role found in Firestore for this user.");
        }

        // Create user data object to store
        const userData = {
            uid: user.uid,
            email: user.email,
            role: userRoleDoc.role,
            classId: userRoleDoc.classId || null
        };
        // Store user data. This will be read by admin.js/faculty.js on the next page.
        localStorage.setItem('currentUser', JSON.stringify(userData));

        // --- REDIRECTION LOGIC ---
        if (userRoleDoc.role === 'admin') {
            window.location.href = 'admin.html';
        } else if (userRoleDoc.role === 'faculty') {
            window.location.href = 'faculty.html';
        } else {
            // Student or other role
            throw new Error(`Your role ("${userRoleDoc.role}") does not have access to this system.`);
        }

    } catch (error) {
        console.error("Role handling error:", error.message);
        // If role check fails, sign the user out to prevent a loop
        if (window.auth && window.signOut) {
            await window.signOut(window.auth);
        }
        localStorage.removeItem('currentUser'); // Clean up partial login
        showError(error.message); // Show error in UI
        hideSpinner(); // Hide spinner so they can try again
    }
}

/**
 * Helper to fetch user role from Firestore
 * @param {string} uid - The user's UID.
 * @returns {object | null} The user role document or null.
 */
async function getUserRole(uid) {
    if (!window.db || !window.doc || !window.getDoc) return null;
    try {
        const roleDocRef = window.doc(window.db, 'userRoles', uid);
        const docSnap = await window.getDoc(roleDocRef);
        if (docSnap.exists()) {
            return docSnap.data();
        } else {
            console.warn(`No role document found for UID: ${uid}`);
            return null;
        }
    } catch (err) {
        console.warn("Error fetching user role:", err.message);
        return null;
    }
}

// --- Spinner and Alert Helpers (Minimal versions for login page) ---
function showSpinner() {
    const spinner = document.getElementById('full-page-spinner');
    if (spinner) spinner.classList.remove('is-hidden');
}

function hideSpinner() {
    const spinner = document.getElementById('full-page-spinner');
    if (spinner) spinner.classList.add('is-hidden');
}

// Create a dedicated error spot in the login form
function showError(message) {
    let errorEl = document.getElementById('login-error');
    if (!errorEl) {
        errorEl = document.createElement('p');
        errorEl.id = 'login-error';
        errorEl.style.color = 'var(--danger)';
        errorEl.style.marginTop = '15px';
        document.getElementById('login-form').appendChild(errorEl);
    }
    errorEl.textContent = message;
    errorEl.style.display = 'block';

    // Also use SweetAlert for consistency
    Swal.fire({
        icon: 'error',
        title: 'Login Failed',
        text: message,
    });
}

function hideError() {
    const errorEl = document.getElementById('login-error');
    if (errorEl) errorEl.style.display = 'none';
}