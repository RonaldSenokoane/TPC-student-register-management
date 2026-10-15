const crypto = require('node:crypto');
const nodemailer = require('nodemailer');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, Timestamp, getFirestore } = require('firebase-admin/firestore');
const { defineSecret, defineString } = require('firebase-functions/params');
const { HttpsError, onCall } = require('firebase-functions/v2/https');

initializeApp();

const database = getFirestore();
const initialAdminEmail = defineString('INITIAL_ADMIN_EMAIL');
const appBaseUrl = defineString('APP_BASE_URL', {
	default: 'https://tpc-student-register.web.app'
});
const smtpHost = defineSecret('SMTP_HOST');
const smtpPort = defineSecret('SMTP_PORT');
const smtpUser = defineSecret('SMTP_USER');
const smtpPassword = defineSecret('SMTP_PASSWORD');
const smtpFrom = defineSecret('SMTP_FROM');
const invitationSecrets = [smtpHost, smtpPort, smtpUser, smtpPassword, smtpFrom];

function hash(value) {
	return crypto.createHash('sha256').update(value).digest('hex');
}

function requireAdministrator(request) {
	if (!request.auth || request.auth.token.role !== 'administrator') {
		throw new HttpsError('permission-denied', 'Administrator access is required.');
	}
	return request.auth;
}

function normalizeEmail(value) {
	if (typeof value !== 'string') return '';
	return value.trim().toLowerCase();
}

function validateRequestDetails(name, email) {
	if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
		throw new HttpsError('invalid-argument', 'Enter a name between 2 and 100 characters.');
	}
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
		throw new HttpsError('invalid-argument', 'Enter a valid email address.');
	}
}

function getSmtpTransport() {
	const port = Number(smtpPort.value());
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new HttpsError('failed-precondition', 'SMTP_PORT must be a valid TCP port.');
	}
	return nodemailer.createTransport({
		host: smtpHost.value(),
		port,
		secure: port === 465,
		requireTLS: port !== 465,
		auth: {
			user: smtpUser.value(),
			pass: smtpPassword.value()
		}
	});
}

exports.requestAccess = onCall(async (request) => {
	const name = typeof request.data?.name === 'string' ? request.data.name.trim() : '';
	const email = normalizeEmail(request.data?.email);
	validateRequestDetails(name, email);

	const requestRef = database.collection('accessRequests').doc(hash(email));
	await database.runTransaction(async (transaction) => {
		const existing = await transaction.get(requestRef);
		if (existing.exists) {
			const status = existing.get('status');
			if (status === 'approved') {
				throw new HttpsError('already-exists', 'This email already has an approved account. Sign in instead.');
			}
			if (status === 'pending' || status === 'invited' || status === 'redeeming') {
				throw new HttpsError('already-exists', 'An access request for this email is already being processed.');
			}
		}

		transaction.set(requestRef, {
			name,
			email,
			status: 'pending',
			requestedAt: FieldValue.serverTimestamp(),
			requestedBy: request.auth?.uid || null,
			assignedRole: FieldValue.delete(),
			invitationTokenHash: FieldValue.delete(),
			invitationExpiresAt: FieldValue.delete()
		}, { merge: true });
	});

	return { status: 'pending' };
});

exports.ensureFirstAdministrator = onCall(async (request) => {
	if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before administrator setup.');
	const email = normalizeEmail(request.auth.token.email);
	const configuredEmail = normalizeEmail(initialAdminEmail.value());
	if (!configuredEmail || email !== configuredEmail || request.auth.token.email_verified !== true) {
		return { role: null, verificationRequired: email === configuredEmail };
	}

	const user = await getAuth().getUser(request.auth.uid);
	const settingsRef = database.doc('system/accessControl');
	await database.runTransaction(async (transaction) => {
		const settings = await transaction.get(settingsRef);
		const administratorUid = settings.get('initialAdministratorUid');
		if (administratorUid && administratorUid !== user.uid) {
			throw new HttpsError('permission-denied', 'The initial administrator has already been assigned.');
		}
		if (!administratorUid) {
			transaction.set(settingsRef, {
				initialAdministratorUid: user.uid,
				initializedAt: FieldValue.serverTimestamp()
			}, { merge: true });
		}
	});

	await getAuth().setCustomUserClaims(user.uid, {
		...user.customClaims,
		role: 'administrator'
	});
	await database.doc(`users/${user.uid}`).set({
		uid: user.uid,
		name: user.displayName || user.email?.split('@')[0] || '',
		email,
		role: 'administrator',
		status: 'approved',
		updatedAt: FieldValue.serverTimestamp()
	}, { merge: true });

	return { role: 'administrator' };
});

exports.assignRoleAndInvite = onCall({ secrets: invitationSecrets }, async (request) => {
	const administrator = requireAdministrator(request);
	const requestId = request.data?.requestId;
	const role = request.data?.role;
	if (typeof requestId !== 'string' || !/^[a-f0-9]{64}$/.test(requestId)) {
		throw new HttpsError('invalid-argument', 'Select a valid access request.');
	}
	if (role !== 'user' && role !== 'administrator') {
		throw new HttpsError('invalid-argument', 'Choose either user or administrator.');
	}

	const requestRef = database.collection('accessRequests').doc(requestId);
	const requestSnapshot = await requestRef.get();
	if (!requestSnapshot.exists) throw new HttpsError('not-found', 'The access request no longer exists.');
	const accessRequest = requestSnapshot.data();
	if (!['pending', 'invited', 'invite-failed', 'redeeming'].includes(accessRequest.status)) {
		throw new HttpsError('failed-precondition', 'This access request cannot be assigned a role.');
	}

	const rawToken = crypto.randomBytes(32).toString('base64url');
	const tokenHash = hash(rawToken);
	const expiresAt = Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);
	await requestRef.update({
		status: 'invited',
		assignedRole: role,
		assignedBy: administrator.uid,
		assignedAt: FieldValue.serverTimestamp(),
		invitationTokenHash: tokenHash,
		invitationExpiresAt: expiresAt
	});

	const invitationUrl = new URL('/Login-page/accept-invitation.html', appBaseUrl.value());
	invitationUrl.searchParams.set('token', rawToken);
	try {
		await getSmtpTransport().sendMail({
			from: smtpFrom.value(),
			to: accessRequest.email,
			subject: 'Your TPC Student Register access is ready',
			text: `Hello ${accessRequest.name},\n\nAn administrator assigned you the ${role} role for the TPC Student Register. Open this secure link within 7 days to approve your account and create your password:\n\n${invitationUrl.href}\n\nIf you were not expecting this invitation, you can ignore this email.`,
			html: `<p>Hello ${escapeHtml(accessRequest.name)},</p><p>An administrator assigned you the <strong>${escapeHtml(role)}</strong> role for the TPC Student Register.</p><p><a href="${escapeHtml(invitationUrl.href)}">Approve access and create your password</a></p><p>This secure link expires in 7 days. If you were not expecting this invitation, you can ignore this email.</p>`
		});
		await requestRef.update({ invitationSentAt: FieldValue.serverTimestamp() });
		return { status: 'invited' };
	} catch (error) {
		console.error('Unable to send role invitation', {
			requestId,
			error: error.message
		});
		await requestRef.update({
			status: 'invite-failed',
			invitationTokenHash: FieldValue.delete(),
			invitationExpiresAt: FieldValue.delete()
		});
		throw new HttpsError('unavailable', 'The role was assigned but the invitation email could not be sent. Check the SMTP settings and retry.');
	}
});

function escapeHtml(value) {
	return String(value).replace(/[&<>"']/g, (character) => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#39;'
	})[character]);
}

exports.completeRoleInvitation = onCall(async (request) => {
	const token = request.data?.token;
	const password = request.data?.password;
	if (typeof token !== 'string' || token.length < 32 || token.length > 128) {
		throw new HttpsError('invalid-argument', 'This invitation link is invalid.');
	}
	if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
		throw new HttpsError('invalid-argument', 'Choose a password between 8 and 128 characters.');
	}

	const invitationQuery = await database.collection('accessRequests')
		.where('invitationTokenHash', '==', hash(token))
		.limit(2)
		.get();
	if (invitationQuery.size !== 1) throw new HttpsError('not-found', 'This invitation link is invalid or has already been used.');

	const requestDocument = invitationQuery.docs[0];
	const requestRef = requestDocument.ref;
	const accessRequest = requestDocument.data();
	if (accessRequest.status !== 'invited' || !accessRequest.invitationExpiresAt || accessRequest.invitationExpiresAt.toMillis() <= Date.now()) {
		throw new HttpsError('deadline-exceeded', 'This invitation has expired. Ask an administrator to send a new one.');
	}
	if (accessRequest.assignedRole !== 'user' && accessRequest.assignedRole !== 'administrator') {
		throw new HttpsError('failed-precondition', 'This invitation has no valid role. Contact an administrator.');
	}

	await database.runTransaction(async (transaction) => {
		const current = await transaction.get(requestRef);
		if (current.get('status') !== 'invited' || current.get('invitationTokenHash') !== hash(token)) {
			throw new HttpsError('already-exists', 'This invitation has already been used.');
		}
		transaction.update(requestRef, { status: 'redeeming' });
	});

	try {
		const auth = getAuth();
		let user;
		try {
			user = await auth.getUserByEmail(accessRequest.email);
			user = await auth.updateUser(user.uid, {
				password,
				displayName: accessRequest.name,
				emailVerified: true,
				disabled: false
			});
		} catch (error) {
			if (error.code !== 'auth/user-not-found') throw error;
			user = await auth.createUser({
				email: accessRequest.email,
				password,
				displayName: accessRequest.name,
				emailVerified: true
			});
		}

		const role = accessRequest.assignedRole;
		await auth.setCustomUserClaims(user.uid, { ...user.customClaims, role });
		const batch = database.batch();
		batch.set(database.doc(`users/${user.uid}`), {
			uid: user.uid,
			name: accessRequest.name,
			email: accessRequest.email,
			role,
			status: 'approved',
			createdAt: FieldValue.serverTimestamp(),
			updatedAt: FieldValue.serverTimestamp()
		}, { merge: true });
		batch.update(requestRef, {
			status: 'approved',
			approvedAt: FieldValue.serverTimestamp(),
			approvedUid: user.uid,
			invitationTokenHash: FieldValue.delete(),
			invitationExpiresAt: FieldValue.delete()
		});
		await batch.commit();
		return { status: 'approved' };
	} catch (error) {
		await database.runTransaction(async (transaction) => {
			const current = await transaction.get(requestRef);
			if (current.get('status') === 'redeeming') transaction.update(requestRef, { status: 'invited' });
		});
		if (error instanceof HttpsError) throw error;
		console.error('Unable to complete role invitation', {
			requestId: requestDocument.id,
			error: error.message
		});
		throw new HttpsError('internal', 'Unable to complete account setup. Try again or contact the administrator.');
	}
});
