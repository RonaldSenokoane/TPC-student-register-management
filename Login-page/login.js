import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig } from '../firebase-config.js';

class LoginPage {
	constructor() {
		this.auth = getAuth(initializeApp(firebaseConfig));
		this.database = getFirestore(this.auth.app);
		this.isCreatingProfile = false;
		this.cacheElements();
		this.bindEvents();
		this.showRegistrationMessage();
	}

	cacheElements() {
		this.elements = {
			form: document.querySelector('#auth-form'),
			nameField: document.querySelector('#name-field'),
			confirmField: document.querySelector('#confirm-field'),
			nameInput: document.querySelector('#name'),
			confirmInput: document.querySelector('#confirm-password'),
			submitButton: document.querySelector('#submit-button'),
			status: document.querySelector('#status'),
			loginTab: document.querySelector('#login-tab'),
			signupTab: document.querySelector('#signup-tab'),
			formTitle: document.querySelector('#form-title'),
			formSubtitle: document.querySelector('#form-subtitle'),
			passwordInput: document.querySelector('#password')
		};
	}

	bindEvents() {
		this.elements.form.addEventListener('submit', (event) => this.submit(event));
		this.elements.loginTab.addEventListener('click', () => this.setMode(false));
		this.elements.signupTab.addEventListener('click', () => this.setMode(true));
		document.querySelectorAll('.password-toggle').forEach((toggle) => {
			toggle.addEventListener('click', () => this.togglePassword(toggle));
		});
	}

	static withTimeout(promise, milliseconds) {
		return Promise.race([
			promise,
			new Promise((_, reject) => setTimeout(() => reject(new Error('Registration timed out. Check your connection and try again.')), milliseconds))
		]);
	}

	setMode(createProfile) {
		this.isCreatingProfile = createProfile;
		this.elements.nameField.classList.toggle('hidden', !createProfile);
		this.elements.confirmField.classList.toggle('hidden', !createProfile);
		this.elements.nameInput.required = createProfile;
		this.elements.confirmInput.required = createProfile;
		this.elements.loginTab.classList.toggle('active', !createProfile);
		this.elements.signupTab.classList.toggle('active', createProfile);
		this.elements.loginTab.setAttribute('aria-selected', String(!createProfile));
		this.elements.signupTab.setAttribute('aria-selected', String(createProfile));
		this.elements.formTitle.textContent = createProfile ? 'Create your profile' : 'Sign in to your account';
		this.elements.formSubtitle.textContent = createProfile ? 'Set up your account to access the student register.' : 'Enter your details to continue to the register.';
		this.elements.submitButton.innerHTML = createProfile ? 'Create profile <span aria-hidden="true">&#8594;</span>' : 'Sign in <span aria-hidden="true">&#8594;</span>';
		this.elements.passwordInput.autocomplete = createProfile ? 'new-password' : 'current-password';
		this.elements.status.textContent = '';
	}

	showError(error) {
		if (error.code?.includes('api-key-not-valid') || error.message?.toLowerCase().includes('api key')) {
			this.elements.status.textContent = 'Firebase rejected the Web API key. Copy the current web app config from Firebase Console > Project settings > General and update firebase-config.js. Check that Identity Toolkit is enabled and the key allows this site as an HTTP referrer.';
			return;
		}
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
		this.elements.status.textContent = messages[error.code] || `Firebase error: ${error.code || error.message || 'unknown error'}`;
	}

	async submit(event) {
		event.preventDefault();
		this.elements.status.textContent = '';
		const email = this.elements.form.email.value.trim();
		const password = this.elements.form.password.value;
		this.elements.submitButton.disabled = true;
		try {
			if (this.isCreatingProfile) {
				if (password !== this.elements.confirmInput.value) throw new Error('Passwords do not match.');
				const credential = await createUserWithEmailAndPassword(this.auth, email, password);
				await LoginPage.withTimeout(setDoc(doc(this.database, 'users', credential.user.uid), {
					uid: credential.user.uid,
					name: this.elements.nameInput.value.trim(),
					email,
					createdAt: serverTimestamp()
				}), 8000);
				window.location.replace('login.html?registered=1');
				return;
			}
			await signInWithEmailAndPassword(this.auth, email, password);
			window.location.href = '../dashboard/dashboard.html';
		} catch (error) {
			this.elements.status.textContent = error.message === 'Passwords do not match.' ? error.message : '';
			if (!this.elements.status.textContent) this.showError(error);
			this.elements.submitButton.disabled = false;
		}
	}

	togglePassword(toggle) {
		const input = document.querySelector(`#${toggle.dataset.target}`);
		const isVisible = input.type === 'text';
		input.type = isVisible ? 'password' : 'text';
		toggle.textContent = isVisible ? 'Show' : 'Hide';
		toggle.setAttribute('aria-label', `${isVisible ? 'Show' : 'Hide'} password`);
	}

	showRegistrationMessage() {
		if (new URLSearchParams(window.location.search).get('registered') !== '1') return;
		this.elements.status.textContent = 'Registration successful. You can now sign in.';
		this.elements.status.className = 'status success';
		window.history.replaceState({}, document.title, window.location.pathname);
	}
}

new LoginPage();