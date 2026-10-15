import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';
import { firebaseConfig } from '../firebase-config.js';

const app = initializeApp(firebaseConfig);
const functions = getFunctions(app);
const form = document.querySelector('#invitation-form');
const password = document.querySelector('#password');
const confirmPassword = document.querySelector('#confirm-password');
const submitButton = document.querySelector('#invitation-submit');
const status = document.querySelector('#invitation-status');
const invitationToken = new URLSearchParams(window.location.search).get('token');

document.querySelectorAll('.password-toggle').forEach((toggle) => {
	toggle.addEventListener('click', () => {
		const input = document.querySelector(`#${toggle.dataset.target}`);
		const isVisible = input.type === 'text';
		input.type = isVisible ? 'password' : 'text';
		toggle.textContent = isVisible ? 'Show' : 'Hide';
		toggle.setAttribute('aria-label', `${isVisible ? 'Show' : 'Hide'} password`);
	});
});

if (!invitationToken) {
	submitButton.disabled = true;
	status.textContent = 'This invitation link is missing its secure token. Ask an administrator to send you a new invitation.';
}

form.addEventListener('submit', async (event) => {
	event.preventDefault();
	status.textContent = '';
	if (password.value !== confirmPassword.value) {
		status.textContent = 'The passwords do not match.';
		return;
	}

	submitButton.disabled = true;
	try {
		await httpsCallable(functions, 'completeRoleInvitation')({
			token: invitationToken,
			password: password.value
		});
		window.location.replace('login.html?approved=1');
	} catch (error) {
		const messages = {
			'functions/deadline-exceeded': 'This invitation has expired. Ask an administrator to send a new one.',
			'functions/not-found': 'This invitation link is invalid or has already been used. Ask an administrator for a new link.',
			'functions/invalid-argument': error.message
		};
		status.textContent = messages[error.code] || `Unable to activate your account: ${error.message || 'Please try again.'}`;
		submitButton.disabled = false;
	}
});
