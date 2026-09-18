
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const firebaseConfig = { apiKey: 'AIzaSyAsqhOmthGO-UWXfLmakUcSpnf10l87rJ8', authDomain: 'tpc-student-register.firebaseapp.com', projectId: 'tpc-student-register', storageBucket: 'tpc-student-register.firebasestorage.app', messagingSenderId: '189511938770', appId: '1:189511938770:web:57a7cea92ed78ba3a3330b', measurementId: 'G-BP7R6QJKVW' };
const auth = getAuth(initializeApp(firebaseConfig));
const database = getFirestore(auth.app);
const form = document.querySelector('#auth-form');
const nameField = document.querySelector('#name-field');
const confirmField = document.querySelector('#confirm-field');
const nameInput = document.querySelector('#name');
const confirmInput = document.querySelector('#confirm-password');
const submitButton = document.querySelector('#submit-button');
const status = document.querySelector('#status');
let isCreatingProfile = false;

function withTimeout(promise, milliseconds) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Registration timed out. Check your connection and try again.')), milliseconds))
  ]);
}

function setMode(createProfile) {
  isCreatingProfile = createProfile;
  nameField.classList.toggle('hidden', !createProfile);
  confirmField.classList.toggle('hidden', !createProfile);
  nameInput.required = createProfile;
  confirmInput.required = createProfile;
  document.querySelector('#login-tab').classList.toggle('active', !createProfile);
  document.querySelector('#signup-tab').classList.toggle('active', createProfile);
  document.querySelector('#form-title').textContent = createProfile ? 'Create your profile' : 'Sign in to your account';
  document.querySelector('#form-subtitle').textContent = createProfile ? 'Set up your account to access the student register.' : 'Enter your details to continue to the register.';
  submitButton.innerHTML = createProfile ? 'Create profile <span aria-hidden="true">&#8594;</span>' : 'Sign in <span aria-hidden="true">&#8594;</span>';
  document.querySelector('#password').autocomplete = createProfile ? 'new-password' : 'current-password';
  status.textContent = '';
}

function showError(error) {
  const messages = {
    'auth/api-key-not-valid': 'Firebase rejected this API key. Replace it with the current Web App key, and allow localhost in its API restrictions.',
    'auth/email-already-in-use': 'An account already exists for this email.',
    'auth/invalid-credential': 'The email or password is incorrect.',
    'auth/weak-password': 'Use a password with at least 6 characters.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/operation-not-allowed': 'Email sign-in is disabled. Enable Email/Password in Firebase Authentication.',
    'auth/network-request-failed': 'Network error. Check your internet connection and try again.',
    'permission-denied': 'Profile created, but Firestore denied saving it. Update your Firestore security rules.',
    'failed-precondition': 'Firestore is not ready yet. Create the database in the Firebase console first.',
    'unavailable': 'Firestore is temporarily unavailable. Please try again.'
  };
  status.textContent = messages[error.code] || `Firebase error: ${error.code || error.message || 'unknown error'}`;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  status.textContent = '';
  const email = form.email.value.trim();
  const password = form.password.value;
  submitButton.disabled = true;
  try {
    if (isCreatingProfile) {
      if (password !== confirmInput.value) throw new Error('Passwords do not match.');
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await withTimeout(setDoc(doc(database, 'users', credential.user.uid), { uid: credential.user.uid, name: nameInput.value.trim(), email, createdAt: serverTimestamp() }), 8000);
      window.location.replace('login.html?registered=1');
      return;
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
    window.location.href = '../dashboard/dashboard.html';
  } catch (error) {
    status.textContent = error.message === 'Passwords do not match.' ? error.message : '';
    if (!status.textContent) showError(error);
    submitButton.disabled = false;
  }
});

document.querySelector('#login-tab').addEventListener('click', () => setMode(false));
document.querySelector('#signup-tab').addEventListener('click', () => setMode(true));

document.querySelectorAll('.password-toggle').forEach((toggle) => {
  toggle.addEventListener('click', () => {
    const input = document.querySelector(`#${toggle.dataset.target}`);
    const isVisible = input.type === 'text';
    input.type = isVisible ? 'password' : 'text';
    toggle.textContent = isVisible ? 'Show' : 'Hide';
    toggle.setAttribute('aria-label', `${isVisible ? 'Show' : 'Hide'} password`);
  });
});

if (new URLSearchParams(window.location.search).get('registered') === '1') {
  status.textContent = 'Registration successful. You can now sign in.';
  status.className = 'status success';
  window.history.replaceState({}, document.title, window.location.pathname);
}