import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
	initializeFirestore,
	doc,
	getDoc,
	collection,
	addDoc,
	getDocs,
	getDocsFromServer,
	setDoc,
	updateDoc,
	deleteDoc,
	query,
	where
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';
import { firebaseConfig } from '../firebase-config.js';
import { createProofArchive, proofFilename } from './proof-documents.js';
import { drawProofCertificate } from './registration-certificate.js';
import { createAttendanceWorkbook } from './attendance-report.js';

class StudentRegisterDashboard {
	// Startup and shared formatting

	constructor() {
		this.app = initializeApp(firebaseConfig);
		this.auth = getAuth(this.app);
		this.functions = getFunctions(this.app);
		this.database = initializeFirestore(this.app, { experimentalAutoDetectLongPolling: true });

		this.currentUser = null;
		this.isAdministrator = false;
		this.students = [];
		this.attendance = new Map();
		this.attendanceRecords = new Map();
		this.holidays = new Set();
		this.editingStudentId = null;
		this.selectedProofStudentId = null;
		this.selectedProofStudentIds = new Set();
		this.newlyRegisteredProofIds = new Set();
		this.authStateResolved = false;

		this.cacheElements();
		this.initializeDates();
		this.bindEvents();
		this.watchAuthentication();
	}

	static getModeDisplay(mode) {
		if (mode === 'in-class') return 'In Class';
		if (mode === 'hybrid') return 'Hybrid';
		return 'Online';
	}

	static normalizeMode(mode) {
		return mode === 'in-class' || mode === 'hybrid' ? mode : 'online';
	}

	static getStudentDisplayName(student) {
		if (student?.surname) return `${student.name || ''} ${student.surname}`.trim();
		if (student?.name) return student.name.trim();
		return 'Unknown student';
	}

	static getStudentNameParts(student) {
		const fullName = student?.name || '';
		if (student?.surname) return { firstName: student.name || '', surname: student.surname || '' };
		const parts = fullName.trim().split(/\s+/).filter(Boolean);
		if (parts.length <= 1) return { firstName: fullName.trim(), surname: '' };
		return { firstName: parts[0], surname: parts.slice(1).join(' ') };
	}

	static formatDateKey(dateValue) {
		const date = dateValue instanceof Date ? new Date(dateValue) : new Date(`${dateValue}T00:00:00`);
		const timezoneOffset = date.getTimezoneOffset();
		const normalizedDate = new Date(date.getTime() - timezoneOffset * 60000);
		return normalizedDate.toISOString().slice(0, 10);
	}

	formatDate(date) {
		return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
	}

	formatCertificateDate(dateValue) {
		const date = new Date(`${dateValue}T00:00:00`);
		if (Number.isNaN(date.getTime())) return '';
		return new Intl.DateTimeFormat('en-GB', {
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		}).format(date);
	}

	static withTimeout(promise, milliseconds, message) {
		let timer;
		return Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error(message)), milliseconds);
			})
		]).finally(() => clearTimeout(timer));
	}

	cacheElements() {
		this.elements = {
			profileEmail: document.querySelector('#profile-email'),
			profileName: document.querySelector('#profile-name'),

			administratorMenuItem: document.querySelector('.menu-item[data-view="administrator"]'),
			administratorRequests: document.querySelector('#administrator-requests'),
			administratorFeedback: document.querySelector('#administrator-feedback'),

			proofStudentSearch: document.querySelector('#proof-student-search'),
			proofSearchResults: document.querySelector('#proof-search-results'),
			proofSearchFeedback: document.querySelector('#proof-search-feedback'),
			selectMatchingProofs: document.querySelector('#select-matching-proofs'),
			clearProofSelection: document.querySelector('#clear-proof-selection'),
			proofSelectionCount: document.querySelector('#proof-selection-count'),
			proofSelectionFeedback: document.querySelector('#proof-selection-feedback'),
			proofSelectedList: document.querySelector('#proof-selected-list'),
			downloadSelectedProofs: document.querySelector('#download-selected-proofs'),
			proofBatchFeedback: document.querySelector('#proof-batch-feedback'),
			downloadAllProofs: document.querySelector('#download-all-proofs'),
			proofGenerationProgress: document.querySelector('#proof-generation-progress'),
			proofStudentCard: document.querySelector('#proof-student-card'),
			proofStudentName: document.querySelector('#proof-student-name'),
			proofStudentDetails: document.querySelector('#proof-student-details'),
			downloadProof: document.querySelector('#download-proof'),
			proofDownloadFeedback: document.querySelector('#proof-download-feedback'),

			attendanceEmpty: document.querySelector('#attendance-empty'),
			attendanceDate: document.querySelector('#attendance-date-input'),

			reportStartDate: document.querySelector('#report-start-date'),
			reportEndDate: document.querySelector('#report-end-date'),
			reportDate: document.querySelector('#report-date'),
			reportCount: document.querySelector('#report-count'),
			reportFeedback: document.querySelector('#report-feedback'),

			studentForm: document.querySelector('#student-form'),
			studentFeedback: document.querySelector('#student-feedback'),
			studentSubmit: document.querySelector('#student-submit'),
			cancelStudentEdit: document.querySelector('#cancel-student-edit'),
			attendanceList: document.querySelector('#attendance-list'),
			attendanceCount: document.querySelector('#attendance-count'),
			studentSearch: document.querySelector('#student-search'),
			studentAcademicYear: document.querySelector('#student-academic-year'),
			studentDateOfBirth: document.querySelector('#student-date-of-birth'),
			studentFieldOfStudy: document.querySelector('#student-field-of-study'),

			holidayForm: document.querySelector('#holiday-form'),
			holidayDate: document.querySelector('#holiday-date'),
			holidayList: document.querySelector('#holiday-list'),
			holidayCount: document.querySelector('#holiday-count'),
			holidayFeedback: document.querySelector('#holiday-feedback'),
			absenceAlertList: document.querySelector('#absence-alert-list'),

			sidebar: document.querySelector('#sidebar'),
			menuItems: document.querySelectorAll('.menu-item'),
			views: document.querySelectorAll('.view')
		};
	}

	initializeDates() {
		this.elements.studentAcademicYear.value = new Date().getFullYear();
		this.elements.attendanceDate.value = new Date().toISOString().slice(0, 10);
		this.elements.reportStartDate.value = this.elements.attendanceDate.value;
		this.elements.reportEndDate.value = this.elements.attendanceDate.value;
		this.updateReportDates();
	}

	bindEvents() {
		this.bindNavigationEvents();
		this.bindStudentEvents();
		this.bindAttendanceEvents();
		this.bindProofEvents();
	}

	// Navigation

	bindNavigationEvents() {
		document.querySelector('#sign-out').addEventListener('click', () => signOut(this.auth));
		this.elements.menuItems.forEach((item) => {
			item.addEventListener('click', () => this.showView(item));
		});
		document.querySelector('#mobile-menu').addEventListener('click', () => this.elements.sidebar.classList.add('open'));
		document.querySelector('#close-menu').addEventListener('click', () => this.closeSidebar());
	}

	showView(selectedItem) {
		const viewId = `${selectedItem.dataset.view}-view`;
		this.elements.menuItems.forEach((item) => {
			item.classList.toggle('active', item === selectedItem);
		});
		this.elements.views.forEach((view) => {
			view.classList.toggle('active-view', view.id === viewId);
		});
		this.closeSidebar();
		if (selectedItem.dataset.view === 'administrator') this.loadAccessRequests();
	}

	closeSidebar() {
		this.elements.sidebar.classList.remove('open');
	}

	// Authentication and access requests

	watchAuthentication() {
		this.authFallbackTimer = setTimeout(() => {
			if (!this.authStateResolved) {
				this.elements.profileEmail.textContent = 'No active session';
				this.elements.profileName.textContent = 'there';
				this.elements.attendanceEmpty.textContent = 'Authentication is taking too long. Redirecting to the sign-in page...';
				setTimeout(() => window.location.replace('../auth/sign-in.html'), 1200);
			}
		}, 4000);
		onAuthStateChanged(this.auth, (user) => this.handleAuthStateChanged(user));
	}

	async handleAuthStateChanged(user) {
		this.resetProofSelectionForUser(user?.uid);
		this.authStateResolved = true;
		clearTimeout(this.authFallbackTimer);
		if (!user) {
			this.elements.profileEmail.textContent = 'No active session';
			this.elements.profileName.textContent = 'there';
			this.elements.attendanceEmpty.textContent = 'You are not signed in. Redirecting to the login page...';
			setTimeout(() => window.location.replace('../auth/sign-in.html'), 1200);
			return;
		}
		this.currentUser = user;
		this.elements.profileEmail.textContent = user.email || 'No email available';
		try {
			const token = await user.getIdTokenResult();
			this.isAdministrator = token.claims.role === 'administrator';
			this.elements.administratorMenuItem.hidden = !this.isAdministrator;
			const profileSnapshot = await StudentRegisterDashboard.withTimeout(
				getDoc(doc(this.database, 'users', user.uid)),
				15000,
				'Profile load timed out.'
			);
			const profile = profileSnapshot.exists() ? profileSnapshot.data() : {};
			this.elements.profileName.textContent = profile.name || user.displayName || user.email?.split('@')[0] || 'there';
			await this.loadRegister();
			if (this.isAdministrator) await this.loadAccessRequests();
		} catch (error) {
			this.elements.profileName.textContent = user.displayName || user.email?.split('@')[0] || 'there';
			this.elements.attendanceEmpty.textContent = `Database unavailable: ${error.code || error.message || 'check Firestore rules and connection.'}`;
		}
	}

	async loadAccessRequests() {
		if (!this.isAdministrator) return;
		this.elements.administratorFeedback.textContent = 'Loading access requests...';
		try {
			const snapshot = await getDocs(collection(this.database, 'accessRequests'));
			const requests = snapshot.docs
				.map((requestDoc) => ({ id: requestDoc.id, ...requestDoc.data() }))
				.filter((request) => ['pending', 'invited', 'invite-failed', 'redeeming'].includes(request.status))
				.sort((first, second) => {
					const firstDate = first.requestedAt?.toMillis?.() || 0;
					const secondDate = second.requestedAt?.toMillis?.() || 0;
					return secondDate - firstDate;
				});
			this.renderAccessRequests(requests);
			this.elements.administratorFeedback.textContent = requests.length
				? `${requests.length} access request${requests.length === 1 ? '' : 's'} need attention.`
				: 'There are no outstanding access requests.';
		} catch (error) {
			const reason = error.code || error.message || 'check administrator access and Firestore rules.';
			this.elements.administratorFeedback.textContent = `Unable to load access requests: ${reason}`;
		}
	}

	renderAccessRequests(requests) {
		this.elements.administratorRequests.replaceChildren();
		if (requests.length === 0) {
			const empty = document.createElement('p');
			empty.className = 'empty-note';
			empty.textContent = 'No pending role assignments.';
			this.elements.administratorRequests.append(empty);
			return;
		}

		requests.forEach((request) => {
			this.elements.administratorRequests.append(this.createAccessRequestRow(request));
		});
	}

	createAccessRequestRow(request) {
		const row = document.createElement('article');
		const applicant = document.createElement('div');
		const name = document.createElement('strong');
		const email = document.createElement('small');
		const status = document.createElement('span');
		const actions = document.createElement('div');
		row.className = 'administrator-request';
		applicant.className = 'administrator-applicant';
		name.textContent = request.name || 'Unnamed applicant';
		email.textContent = request.email || 'No email address';
		status.className = 'administrator-request-status';
		status.textContent = this.getAccessRequestStatus(request);
		actions.className = 'administrator-request-actions';
		applicant.append(name, email);
		row.append(applicant, status);

		if (request.status !== 'redeeming') {
			[['user', 'Assign user'], ['administrator', 'Assign administrator']].forEach(([role, label]) => {
				const button = document.createElement('button');
				button.className = 'row-action';
				button.type = 'button';
				button.textContent = request.status === 'invited' && request.assignedRole === role
					? `Resend ${role} invitation`
					: label;
				button.addEventListener('click', () => this.assignRole(request.id, role, button));
				actions.append(button);
			});
			row.append(actions);
		}
		return row;
	}

	getAccessRequestStatus(request) {
		switch (request.status) {
			case 'invite-failed':
				return 'Email failed — retry role assignment';
			case 'redeeming':
				return 'Invitation being accepted';
			case 'invited':
				return `Invitation sent — ${request.assignedRole}`;
			default:
				return 'Awaiting role assignment';
		}
	}

	async assignRole(requestId, role, button) {
		button.disabled = true;
		this.elements.administratorFeedback.textContent = `Assigning ${role} role and sending invitation...`;
		try {
			await httpsCallable(this.functions, 'assignRoleAndInvite')({ requestId, role });
			this.elements.administratorFeedback.textContent = `Invitation sent. The applicant must use the email link to approve access and create their password.`;
			await this.loadAccessRequests();
		} catch (error) {
			const reason = error.message || error.code || 'check the SMTP configuration and try again.';
			this.elements.administratorFeedback.textContent = `Unable to send role invitation: ${reason}`;
			button.disabled = false;
		}
	}

	// Register storage

	getStudentsRef() {
		return collection(this.database, 'users', this.currentUser.uid, 'students');
	}

	getStudentRef(studentId) {
		return doc(this.database, 'users', this.currentUser.uid, 'students', studentId);
	}

	getAttendanceRef(studentId, date) {
		return doc(this.database, 'users', this.currentUser.uid, 'attendance', `${studentId}_${date}`);
	}

	getHolidaysRef() {
		return collection(this.database, 'users', this.currentUser.uid, 'holidays');
	}

	async loadRegister() {
		try {
			const uid = this.currentUser.uid;
			const studentSnapshot = await getDocs(this.getStudentsRef());
			if (this.currentUser?.uid !== uid) return;
			this.students = studentSnapshot.docs.map((studentDoc) => ({ ...studentDoc.data(), id: studentDoc.id }));
			this.restoreProofSelection();
			await Promise.all([this.loadAttendance(), this.loadHolidays()]);
			this.renderStudents();
			this.renderProofStudent();
			this.searchProofStudents();
		} catch (error) {
			this.elements.attendanceEmpty.textContent = `Unable to load students: ${error.code || error.message || 'check your Firestore rules.'}`;
			this.elements.proofSearchFeedback.textContent = 'Unable to load students. Reload the page to try again.';
		}
	}

	async loadAttendance() {
		this.attendance = new Map();
		this.attendanceRecords = new Map();
		const attendanceSnapshot = await getDocs(collection(this.database, 'users', this.currentUser.uid, 'attendance'));
		attendanceSnapshot.forEach((attendanceDoc) => {
			const record = attendanceDoc.data();
			this.syncAttendanceRecord(record.studentId, record.date, record.present, record.mode);
		});
	}

	async loadHolidays() {
		try {
			const holidaySnapshot = await getDocs(this.getHolidaysRef());
			this.holidays = new Set(holidaySnapshot.docs.map((holidayDoc) => holidayDoc.id));
			this.elements.holidayFeedback.textContent = '';
		} catch (error) {
			this.holidays = new Set();
			this.elements.holidayFeedback.textContent = `Unable to load holiday dates: ${error.code || error.message || 'check Firestore rules.'}`;
		}
		this.renderHolidays();
	}

	// Student registration

	bindStudentEvents() {
		this.elements.studentForm.addEventListener('submit', (event) => this.saveStudent(event));
		this.elements.cancelStudentEdit.addEventListener('click', () => this.resetStudentForm());
	}

	resetStudentForm() {
		this.editingStudentId = null;
		this.elements.studentForm.reset();
		this.elements.studentSubmit.innerHTML = 'Save student <span aria-hidden="true">&#8594;</span>';
		this.elements.cancelStudentEdit.hidden = true;
		this.elements.studentAcademicYear.value = new Date().getFullYear();
		document.querySelector('input[name="student-mode"][value="online"]').checked = true;
	}

	editStudent(student) {
		this.editingStudentId = student.id;
		const { firstName, surname } = StudentRegisterDashboard.getStudentNameParts(student);
		document.querySelector('.menu-item[data-view="register"]').click();
		setTimeout(() => {
			document.querySelector('#student-name').value = firstName || '';
			document.querySelector('#student-surname').value = surname || '';
			document.querySelector('#student-id').value = student.studentId || '';
			this.elements.studentAcademicYear.value = student.academicYear || new Date().getFullYear();
			document.querySelector('#student-course').value = student.course || '';
			document.querySelector('#student-id-number').value = student.idNumber || '';
			this.elements.studentDateOfBirth.value = student.dateOfBirth || '';
			this.elements.studentFieldOfStudy.value = student.fieldOfStudy || '';
			document.querySelector('#student-phone').value = student.phone || '';
			document.querySelector('#student-email').value = student.email || '';
			document.querySelector('#student-sponsor').value = student.sponsor || '';
			const mode = StudentRegisterDashboard.normalizeMode(student.mode);
			document.querySelector(`input[name="student-mode"][value="${mode}"]`).checked = true;
			this.elements.studentSubmit.innerHTML = 'Update student <span aria-hidden="true">&#8594;</span>';
			this.elements.cancelStudentEdit.hidden = false;
			document.querySelector('#student-name').focus();
		}, 0);
	}

	readStudentForm() {
		const firstName = document.querySelector('#student-name').value.trim();
		const surname = document.querySelector('#student-surname').value.trim();
		const mode = StudentRegisterDashboard.normalizeMode(document.querySelector('input[name="student-mode"]:checked')?.value);
		return {
			name: firstName,
			surname,
			studentId: document.querySelector('#student-id').value.trim(),
			academicYear: Number(this.elements.studentAcademicYear.value),
			course: document.querySelector('#student-course').value.trim(),
			idNumber: document.querySelector('#student-id-number').value.trim(),
			dateOfBirth: this.elements.studentDateOfBirth.value,
			fieldOfStudy: this.elements.studentFieldOfStudy.value.trim(),
			phone: document.querySelector('#student-phone').value.trim(),
			email: document.querySelector('#student-email').value.trim(),
			sponsor: document.querySelector('#student-sponsor').value.trim(),
			mode,
			updatedAt: new Date()
		};
	}

	waitForStudentSave(operation) {
		return StudentRegisterDashboard.withTimeout(
			operation,
			120000,
			'Save timed out after 2 minutes. Check your connection and try again.'
		);
	}

	async saveStudent(event) {
		event.preventDefault();
		const feedback = this.elements.studentFeedback;
		if (this.savingStudent) return;
		if (!this.currentUser || !this.proofSelectionRestored) {
			feedback.textContent = 'Please wait for your student register to finish loading, then save again.';
			return;
		}
		const uid = this.currentUser.uid;
		const submitButton = event.target.querySelector('button[type="submit"]');
		this.savingStudent = true;
		this.updateProofDownloadButtons();
		submitButton.disabled = true;
		feedback.textContent = this.editingStudentId ? 'Updating student...' : 'Saving student...';
		try {
			const student = this.readStudentForm();
			if (this.editingStudentId) {
				await this.waitForStudentSave(updateDoc(this.getStudentRef(this.editingStudentId), student));
				if (this.currentUser?.uid !== uid) return;
				const index = this.students.findIndex((item) => item.id === this.editingStudentId);
				if (index >= 0) this.students[index] = { ...this.students[index], ...student, id: this.editingStudentId };
				feedback.textContent = 'Student updated successfully.';
			} else {
				const savedStudent = await this.waitForStudentSave(
					addDoc(this.getStudentsRef(), { ...student, createdAt: new Date() })
				);
				if (this.currentUser?.uid !== uid) return;
				this.students.push({ id: savedStudent.id, ...student, createdAt: new Date() });
				this.selectNewlyRegisteredStudent(savedStudent.id);
				feedback.textContent = 'Student saved successfully and selected for Proof of Registration. '
					+ 'Register another student or open Proof of registration to download.';
			}
			this.resetStudentForm();
			this.renderStudents();
			this.renderProofStudent();
			this.searchProofStudents();
		} catch (error) {
			feedback.textContent = `Unable to save student: ${error.code || error.message || 'check your Firestore rules.'}`;
		} finally {
			this.savingStudent = false;
			submitButton.disabled = false;
			this.updateProofDownloadButtons();
		}
	}

	async deleteStudent(studentId) {
		const student = this.students.find((item) => item.id === studentId);
		if (!student || !window.confirm(`Delete ${student.name} from the register?`)) return;
		try {
			await deleteDoc(this.getStudentRef(studentId));
			const attendanceQuery = query(collection(this.database, 'users', this.currentUser.uid, 'attendance'), where('studentId', '==', studentId));
			const attendanceSnapshot = await getDocs(attendanceQuery);
			await Promise.all(attendanceSnapshot.docs.map((attendanceDoc) => {
				const record = attendanceDoc.data();
				this.attendanceRecords.delete(`${record.studentId}_${record.date}`);
				return deleteDoc(attendanceDoc.ref);
			}));
			this.students = this.students.filter((item) => item.id !== studentId);
			this.attendance.delete(studentId);
			if (this.selectedProofStudentId === studentId) {
				this.selectedProofStudentId = null;
				this.elements.proofStudentSearch.value = '';
				this.elements.proofSearchResults.hidden = true;
				this.elements.proofSearchFeedback.textContent = 'The selected student was removed from the register.';
			}
			this.renderProofStudent();
			this.elements.studentFeedback.textContent = 'Student deleted successfully.';
			if (this.editingStudentId === studentId) this.resetStudentForm();
			this.renderStudents();
			this.searchProofStudents();
		} catch (error) {
			this.elements.studentFeedback.textContent = `Unable to delete student: ${error.code || error.message || 'check your Firestore rules.'}`;
		}
	}

	// Attendance and absence follow-up

	bindAttendanceEvents() {
		this.elements.attendanceDate.addEventListener('change', () => this.handleAttendanceDateChange());
		this.elements.reportStartDate.addEventListener('change', () => this.updateReportDates());
		this.elements.reportEndDate.addEventListener('change', () => this.updateReportDates());
		this.elements.studentSearch.addEventListener('input', (event) => this.searchStudents(event));
		this.elements.holidayForm.addEventListener('submit', (event) => this.addHoliday(event));
		document.querySelector('#print-report').addEventListener('click', () => this.exportReport());
	}

	getDateKey() {
		return this.elements.attendanceDate.value;
	}

	syncAttendanceRecord(studentId, date, present, mode) {
		const normalizedMode = StudentRegisterDashboard.normalizeMode(mode);
		const normalizedDate = StudentRegisterDashboard.formatDateKey(date);
		const attendanceState = { present: present === true, mode: normalizedMode };
		this.attendanceRecords.set(`${studentId}_${normalizedDate}`, attendanceState);
		if (normalizedDate === this.getDateKey()) this.attendance.set(studentId, attendanceState);
		return attendanceState;
	}

	renderStudents() {
		const empty = this.elements.attendanceEmpty;
		this.elements.attendanceList.querySelectorAll('.attendance-row').forEach((row) => row.remove());
		this.students.forEach((student) => {
			this.elements.attendanceList.insertBefore(this.createAttendanceRow(student), empty);
		});
		empty.hidden = this.students.length > 0;
		this.updateAttendanceCount();
		this.renderAbsenceAlerts();
	}

	createAttendanceRow(student) {
		const row = document.createElement('div');
		const mode = StudentRegisterDashboard.normalizeMode(student.mode);
		const modeLabel = StudentRegisterDashboard.getModeDisplay(mode);
		const attendanceState = this.attendance.get(student.id) || { present: false, mode };
		const displayName = StudentRegisterDashboard.getStudentDisplayName(student);
		row.className = 'attendance-row';
		row.dataset.student = `${displayName} ${student.studentId} ${student.course} ${student.sponsor || ''} ${modeLabel}`.toLowerCase();
		row.innerHTML = `
			<span>
				<strong>${displayName}</strong>
				<small>${student.studentId} · ${student.course} · ${modeLabel}</small>
			</span>
			<div class="student-actions">
				<label class="attendance-toggle">
					<input class="attendance-check" type="checkbox" data-student-id="${student.id}" ${attendanceState.present ? 'checked' : ''}>
					<span class="checkmark">${attendanceState.present ? 'Present' : 'Absent'} · ${modeLabel}</span>
				</label>
				<button class="row-action edit-action" type="button" data-student-id="${student.id}">Edit</button>
				<button class="row-action delete-action" type="button" data-student-id="${student.id}">Delete</button>
			</div>
		`;
		if (student.sponsor) row.querySelector('small').textContent += ` · Sponsor: ${student.sponsor}`;
		row.querySelector('.attendance-check').addEventListener('change', (event) => this.handleAttendanceChange(event));
		row.querySelector('.edit-action').addEventListener('click', () => this.editStudent(student));
		row.querySelector('.delete-action').addEventListener('click', () => this.deleteStudent(student.id));
		return row;
	}

	updateAttendanceCount() {
		const present = this.students.filter((student) => this.attendance.get(student.id)?.present === true).length;
		this.elements.attendanceCount.textContent = `${present} present · ${this.students.length - present} absent`;
		this.elements.reportCount.textContent = this.students.length;
	}

	async handleAttendanceChange(event) {
		const checkbox = event.target;
		const studentId = checkbox.dataset.studentId;
		const student = this.students.find((item) => item.id === studentId);
		const mode = StudentRegisterDashboard.normalizeMode(student?.mode);
		const present = checkbox.checked;
		const attendanceDate = this.getDateKey();
		const attendanceState = this.syncAttendanceRecord(studentId, attendanceDate, present, mode);
		this.attendance.set(studentId, attendanceState);
		checkbox.closest('.attendance-row').querySelector('.checkmark').textContent = `${present ? 'Present' : 'Absent'} · ${StudentRegisterDashboard.getModeDisplay(mode)}`;
		this.updateAttendanceCount();
		this.renderAbsenceAlerts();
		await setDoc(this.getAttendanceRef(studentId, attendanceDate), { studentId, date: attendanceDate, present, mode, updatedAt: new Date() });
	}

	async handleAttendanceDateChange() {
		this.updateReportDates();
		if (this.currentUser) {
			await this.loadAttendance();
			this.renderStudents();
		}
	}

	searchStudents(event) {
		const searchTerm = event.target.value.trim().toLowerCase();
		const studentRows = document.querySelectorAll('.attendance-row');
		let visibleStudents = 0;
		studentRows.forEach((row) => {
			const matches = row.dataset.student.includes(searchTerm);
			row.hidden = !matches;
			if (matches) visibleStudents += 1;
		});
		const empty = this.elements.attendanceEmpty;
		empty.hidden = visibleStudents > 0 || (searchTerm.length === 0 && this.students.length > 0);
		if (searchTerm.length > 0 && visibleStudents === 0) empty.textContent = 'No students found for this search.';
	}

	async addHoliday(event) {
		event.preventDefault();
		const date = this.elements.holidayDate.value;
		if (!date) return;
		const submitButton = this.elements.holidayForm.querySelector('button[type="submit"]');
		submitButton.disabled = true;
		try {
			await setDoc(doc(this.getHolidaysRef(), date), { date, createdAt: new Date() });
			this.holidays.add(date);
			this.elements.holidayFeedback.textContent = 'Holiday date saved.';
			this.elements.holidayDate.value = '';
			this.renderHolidays();
			this.renderAbsenceAlerts();
		} catch (error) {
			this.elements.holidayFeedback.textContent = `Unable to save holiday date: ${error.code || error.message || 'check Firestore rules.'}`;
		}
		submitButton.disabled = false;
	}

	async removeHoliday(date) {
		try {
			await deleteDoc(doc(this.getHolidaysRef(), date));
			this.holidays.delete(date);
			this.elements.holidayFeedback.textContent = 'Holiday date removed.';
			this.renderHolidays();
			this.renderAbsenceAlerts();
		} catch (error) {
			this.elements.holidayFeedback.textContent = `Unable to remove holiday date: ${error.code || error.message || 'check Firestore rules.'}`;
		}
	}

	renderHolidays() {
		this.elements.holidayList.replaceChildren();
		const dates = Array.from(this.holidays).sort();
		this.elements.holidayCount.textContent = `${dates.length} ${dates.length === 1 ? 'date' : 'dates'}`;
		if (dates.length === 0) {
			const empty = document.createElement('p');
			empty.textContent = 'No holiday dates added.';
			this.elements.holidayList.append(empty);
			return;
		}
		dates.forEach((date) => {
			const row = document.createElement('span');
			const label = document.createElement('span');
			const removeButton = document.createElement('button');
			row.className = 'holiday-date-row';
			label.textContent = this.formatDate(date);
			removeButton.className = 'holiday-remove';
			removeButton.type = 'button';
			removeButton.textContent = 'Remove';
			removeButton.setAttribute('aria-label', `Remove holiday ${this.formatDate(date)}`);
			removeButton.addEventListener('click', () => this.removeHoliday(date));
			row.append(label, removeButton);
			this.elements.holidayList.append(row);
		});
	}

	getAbsenceStreak(student) {
		const creationValue = student.createdAt?.toDate?.() || student.createdAt;
		const startDate = creationValue ? new Date(creationValue) : new Date();
		if (Number.isNaN(startDate.getTime())) return 0;
		startDate.setHours(0, 0, 0, 0);
		const endDate = new Date();
		endDate.setHours(0, 0, 0, 0);
		const todayKey = StudentRegisterDashboard.formatDateKey(endDate);
		if (!this.attendanceRecords.has(`${student.id}_${todayKey}`)) endDate.setDate(endDate.getDate() - 1);

		let absenceStreak = 0;
		for (let date = endDate; date >= startDate; date.setDate(date.getDate() - 1)) {
			const day = date.getDay();
			const dateKey = StudentRegisterDashboard.formatDateKey(date);
			if (day === 0 || day === 5 || day === 6 || this.holidays.has(dateKey)) continue;
			const attendanceRecord = this.attendanceRecords.get(`${student.id}_${dateKey}`);
			if (attendanceRecord?.present === true) break;
			absenceStreak += 1;
		}
		return absenceStreak;
	}

	renderAbsenceAlerts() {
		this.elements.absenceAlertList.replaceChildren();
		const atRiskStudents = this.students
			.map((student) => ({ student, absenceStreak: this.getAbsenceStreak(student) }))
			.filter(({ absenceStreak }) => absenceStreak > 8)
			.sort((first, second) => second.absenceStreak - first.absenceStreak);

		if (atRiskStudents.length === 0) {
			const empty = document.createElement('p');
			empty.className = 'empty-note';
			empty.textContent = 'No learners currently exceed the absence threshold.';
			this.elements.absenceAlertList.append(empty);
			return;
		}

		atRiskStudents.forEach(({ student, absenceStreak }) => {
			const row = document.createElement('article');
			const details = document.createElement('div');
			const name = document.createElement('strong');
			const metadata = document.createElement('small');
			const count = document.createElement('span');
			row.className = 'absence-alert-row';
			name.textContent = StudentRegisterDashboard.getStudentDisplayName(student);
			metadata.textContent = `${student.course || 'Unassigned'} · ${StudentRegisterDashboard.getModeDisplay(student.mode)}`;
			count.className = 'absence-count';
			count.textContent = `${absenceStreak} working days absent`;
			details.append(name, metadata);
			row.append(details, count);
			if (student.email) {
				const reminder = document.createElement('a');
				const subject = encodeURIComponent('Attendance reminder');
				const body = encodeURIComponent(`Hello ${StudentRegisterDashboard.getStudentDisplayName(student)},\n\nOur register indicates that you have been absent for ${absenceStreak} working days. Please attend your ${StudentRegisterDashboard.getModeDisplay(student.mode).toLowerCase()} classes and contact the Training and Placement Cell if you need support.`);
				reminder.className = 'row-action email-reminder';
				reminder.href = `mailto:${encodeURIComponent(student.email)}?subject=${subject}&body=${body}`;
				reminder.textContent = 'Email reminder';
				row.append(reminder);
			} else {
				const missingEmail = document.createElement('small');
				missingEmail.textContent = 'No email address saved';
				row.append(missingEmail);
			}
			this.elements.absenceAlertList.append(row);
		});
	}

	// Proof selection and persistence

	bindProofEvents() {
		this.elements.proofStudentSearch.addEventListener('input', () => this.searchProofStudents());
		this.elements.downloadProof.addEventListener('click', () => this.downloadRegistrationProof());
		this.elements.selectMatchingProofs.addEventListener('click', () => this.selectMatchingProofs());
		this.elements.clearProofSelection.addEventListener('click', () => this.clearProofSelection());
		this.elements.downloadSelectedProofs.addEventListener('click', () => this.downloadSelectedRegistrationProofs());
		this.elements.downloadAllProofs.addEventListener('click', () => this.downloadSelectedRegistrationProofs(true));
	}

	selectMatchingProofs() {
		this.getMatchingProofStudents().forEach((student) => this.selectedProofStudentIds.add(student.id));
		this.renderProofSelection();
	}

	clearProofSelection() {
		this.selectedProofStudentIds.clear();
		this.newlyRegisteredProofIds.clear();
		this.searchProofStudents();
	}

	selectNewlyRegisteredStudent(studentId) {
		this.selectedProofStudentIds.add(studentId);
		this.newlyRegisteredProofIds.add(studentId);
		this.selectedProofStudentId = studentId;
		this.persistProofSelection();
	}

	getMatchingProofStudents() {
		const searchTerm = this.elements.proofStudentSearch.value.trim().toLowerCase();
		return this.students.filter((student) => {
			const searchableDetails = [
				StudentRegisterDashboard.getStudentDisplayName(student),
				student.studentId,
				student.course,
				student.email,
				student.idNumber,
				student.phone,
				student.sponsor,
				student.dateOfBirth,
				student.fieldOfStudy
			].join(' ').toLowerCase();
			return searchableDetails.includes(searchTerm);
		});
	}

	searchProofStudents() {
		const results = this.elements.proofSearchResults;
		results.replaceChildren();
		const matches = this.getMatchingProofStudents();
		this.elements.selectMatchingProofs.disabled = matches.length === 0;
		this.renderProofSelection();

		if (matches.length === 0) {
			results.hidden = true;
			this.elements.proofSearchFeedback.textContent = this.students.length
				? 'No registered students match that search.'
				: 'There are no registered students to select yet.';
			return;
		}

		results.hidden = false;
		this.elements.proofSearchFeedback.textContent = `${matches.length} matching student${matches.length === 1 ? '' : 's'}. `
			+ 'Tick names for separate PDFs in a ZIP, or choose Review for an individual proof.';
		matches.forEach((student) => {
			results.append(this.createProofSearchRow(student));
		});
	}

	createProofSearchRow(student) {
		const option = document.createElement('div');
		option.className = 'proof-search-row';
		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.id = `proof-select-${student.id}`;
		checkbox.dataset.proofStudentId = student.id;
		checkbox.checked = this.selectedProofStudentIds.has(student.id);
		const label = document.createElement('label');
		label.className = 'proof-search-label';
		label.htmlFor = checkbox.id;
		const name = document.createElement('strong');
		const details = document.createElement('small');
		const displayName = StudentRegisterDashboard.getStudentDisplayName(student);
		name.textContent = displayName;
		if (this.newlyRegisteredProofIds.has(student.id)) name.textContent += ' — Newly Registered';
		details.textContent = `${student.studentId || 'No student ID'} · ${student.course || 'No course'}`;
		label.append(name, details);
		const review = document.createElement('button');
		review.type = 'button';
		review.className = 'row-action';
		review.textContent = 'Review';
		review.setAttribute('aria-controls', 'proof-student-card');
		review.setAttribute('aria-label', `Review proof for ${displayName}`);
		review.addEventListener('click', () => this.selectProofStudent(student.id));
		checkbox.addEventListener('change', () => {
			if (checkbox.checked) this.selectedProofStudentIds.add(student.id);
			else this.selectedProofStudentIds.delete(student.id);
			this.searchProofStudents();
		});
		option.append(checkbox, label, review);
		return option;
	}

	resetProofSelectionForUser(uid) {
		if (this.proofSelectionUserId === (uid || null)) return;
		this.proofSelectionUserId = uid || null;
		this.currentUser = null;
		this.proofSelectionRestored = false;
		this.students = [];
		this.selectedProofStudentIds = new Set();
		this.newlyRegisteredProofIds = new Set();
		this.selectedProofStudentId = null;
		this.elements.proofStudentSearch.value = '';
		this.elements.proofSelectionFeedback.textContent = '';
		this.renderProofStudent();
		this.searchProofStudents();
	}

	proofSelectionStorageKey() {
		return `tpc-proof-selection:${firebaseConfig.projectId}:${this.currentUser.uid}`;
	}

	restoreProofSelection() {
		if (!this.currentUser || this.proofSelectionRestored) return;
		try {
			const saved = JSON.parse(window.localStorage.getItem(this.proofSelectionStorageKey()) || '{}');
			const ids = value => Array.isArray(value) ? value.filter(id => typeof id === 'string') : [];
			this.selectedProofStudentIds = new Set(ids(saved?.ids));
			this.newlyRegisteredProofIds = new Set(ids(saved?.newIds));
			this.selectedProofStudentId = typeof saved?.previewId === 'string' ? saved.previewId : null;
		} catch {
			this.elements.proofSelectionFeedback.textContent = 'Saved selections could not be restored. You can still select students for this session.';
		}
		this.proofSelectionRestored = true;
	}

	persistProofSelection() {
		// Do not replace stored IDs with an empty list before the first successful load.
		if (!this.currentUser || !this.proofSelectionRestored) return;
		try {
			window.localStorage.setItem(this.proofSelectionStorageKey(), JSON.stringify({
				ids: [...this.selectedProofStudentIds], newIds: [...this.newlyRegisteredProofIds],
				previewId: this.selectedProofStudentId
			}));
		} catch {
			this.elements.proofSelectionFeedback.textContent = 'Your selection is available for this session, '
				+ 'but browser storage is unavailable. It may not survive a reload.';
		}
	}

	renderProofSelection() {
		const currentIds = new Set(this.students.map((student) => student.id));
		for (const id of this.selectedProofStudentIds) {
			if (!currentIds.has(id)) this.selectedProofStudentIds.delete(id);
		}
		for (const id of this.newlyRegisteredProofIds) {
			if (!this.selectedProofStudentIds.has(id)) this.newlyRegisteredProofIds.delete(id);
		}
		this.persistProofSelection();
		const count = this.selectedProofStudentIds.size;
		this.elements.proofSelectionCount.textContent = `${count} student${count === 1 ? '' : 's'} selected`;
		this.updateProofDownloadButtons();
		this.elements.clearProofSelection.disabled = count === 0;
		if (!this.generatingProofs) this.elements.proofBatchFeedback.textContent = '';
		this.elements.proofSearchResults.querySelectorAll('input[data-proof-student-id]').forEach((checkbox) => {
			checkbox.checked = this.selectedProofStudentIds.has(checkbox.dataset.proofStudentId);
		});
		this.elements.proofSelectedList.replaceChildren();
		this.students.filter((student) => this.selectedProofStudentIds.has(student.id)).forEach((student) => {
			this.elements.proofSelectedList.append(this.createSelectedProofItem(student));
		});
	}

	createSelectedProofItem(student) {
		const item = document.createElement('li');
		const remove = document.createElement('button');
		remove.type = 'button';
		remove.className = 'row-action';
		const name = StudentRegisterDashboard.getStudentDisplayName(student);
		remove.textContent = `${name} (${student.studentId || 'No student ID'}) \u00d7`;
		remove.setAttribute('aria-label', `Remove ${name} (${student.studentId || 'No student ID'}) from selection`);
		remove.addEventListener('click', () => {
			this.selectedProofStudentIds.delete(student.id);
			this.searchProofStudents();
		});
		item.append(remove);
		return item;
	}

	selectProofStudent(studentId) {
		const student = this.students.find((item) => item.id === studentId);
		if (!student) {
			this.elements.proofSearchFeedback.textContent = 'That student is no longer in the register. Search again to select a current record.';
			return;
		}
		this.selectedProofStudentId = student.id;
		this.persistProofSelection();
		this.elements.proofDownloadFeedback.textContent = '';
		this.renderProofStudent();
		this.elements.proofStudentName.focus({ preventScroll: true });
		const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		this.elements.proofStudentCard.scrollIntoView({
			behavior: reduceMotion ? 'instant' : 'smooth',
			block: 'start'
		});
	}

	renderProofStudent() {
		const student = this.students.find((item) => item.id === this.selectedProofStudentId);
		if (!student) {
			this.elements.proofStudentCard.hidden = true;
			this.elements.downloadProof.disabled = true;
			return;
		}

		this.elements.proofStudentCard.hidden = false;
		this.updateProofDownloadButtons();
		this.elements.proofStudentName.textContent = StudentRegisterDashboard.getStudentDisplayName(student);
		this.elements.proofStudentDetails.replaceChildren();
		const details = [
			['Student Number', student.studentId],
			['Academic Year', student.academicYear || 'Not provided'],
			['Programme Name', student.course || 'Not provided'],
			['Field of Study', student.fieldOfStudy || 'Not provided'],
			['Date of Birth', student.dateOfBirth ? this.formatCertificateDate(student.dateOfBirth) : 'Not provided'],
			['ID/Passport Number', student.idNumber || 'Not provided']
		];
		details.forEach(([label, value]) => {
			if (!value) return;
			const term = document.createElement('dt');
			const description = document.createElement('dd');
			term.textContent = label;
			description.textContent = value;
			this.elements.proofStudentDetails.append(term, description);
		});
	}

	// Proof downloads

	updateProofDownloadButtons() {
		const busy = Boolean(this.savingStudent || this.generatingProofs);
		this.elements.downloadSelectedProofs.disabled = busy || this.selectedProofStudentIds.size === 0;
		this.elements.downloadAllProofs.disabled = busy || this.students.length === 0;
		this.elements.downloadProof.disabled = busy || !this.students.some(student => student.id === this.selectedProofStudentId);
	}

	async refreshProofStudents() {
		const uid = this.currentUser?.uid;
		if (!uid) throw new Error('Sign in before downloading proofs.');
		const snapshot = await StudentRegisterDashboard.withTimeout(
			getDocsFromServer(this.getStudentsRef()),
			15000,
			'Unable to refresh student details. Check your connection and retry.'
		);
		if (this.currentUser?.uid !== uid) throw new Error('Your account changed. Select students in the current register and retry.');
		this.students = snapshot.docs.map(student => ({ ...student.data(), id: student.id }));
		this.renderProofStudent();
		this.searchProofStudents();
	}

	createRegistrationProof(student) {
		const PdfDocument = window.jspdf?.jsPDF;
		if (!PdfDocument) throw new Error('PDF generation is unavailable. Check your connection and reload the page.');
		const logo = document.querySelector('.brand img');
		if (!logo?.complete || !logo.naturalWidth) throw new Error('The TPC logo is unavailable. Reload the page before creating certificates.');
		const pdf = new PdfDocument({ orientation: 'portrait', unit: 'mm', format: 'a4' });
		this.drawRegistrationCertificate(pdf, student, logo);
		return pdf;
	}

	drawRegistrationCertificate(pdf, student, logo) {
		drawProofCertificate(pdf, {
			student,
			logo,
			name: StudentRegisterDashboard.getStudentDisplayName(student),
			dateOfBirth: student.dateOfBirth
				? this.formatCertificateDate(student.dateOfBirth)
				: 'Not provided'
		});
	}

	downloadProofArchive(data) {
		const url = URL.createObjectURL(new Blob([data], { type: 'application/zip' }));
		const link = document.createElement('a');
		link.href = url;
		link.download = `TPC-Proofs-of-Registration-${StudentRegisterDashboard.formatDateKey(new Date())}.zip`;
		document.body.append(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 60000);
	}

	async downloadRegistrationProof() {
		const feedback = this.elements.proofDownloadFeedback;
		if (this.savingStudent || this.generatingProofs) {
			feedback.textContent = 'Please wait until saving or PDF generation has finished.';
			return;
		}
		const selectedId = this.selectedProofStudentId;
		this.generatingProofs = true;
		this.updateProofDownloadButtons();
		feedback.textContent = 'Loading the latest registration details...';
		try {
			await this.refreshProofStudents();
			const student = this.students.find(item => item.id === selectedId);
			if (!student) throw new Error('Select a current registered student before downloading a proof.');
			const filename = proofFilename(student);
			const pdf = this.createRegistrationProof(student);
			pdf.save(filename);
			feedback.textContent = `Proof of registration PDF downloaded for ${StudentRegisterDashboard.getStudentDisplayName(student)}.`;
			if (!student.idNumber || !student.dateOfBirth || !student.course || !student.fieldOfStudy) {
				feedback.textContent += ' Missing details are marked "Not provided"; update the record to complete the certificate.';
			}
		} catch (error) {
			feedback.textContent = `Unable to create the proof of registration PDF: ${error.message || 'PDF generation failed.'}`;
		} finally {
			this.generatingProofs = false;
			this.updateProofDownloadButtons();
		}
	}

	async downloadSelectedRegistrationProofs(all = false) {
		const exportUid = this.currentUser?.uid;
		const feedback = this.elements.proofBatchFeedback;
		if (this.generatingProofs || this.savingStudent) {
			feedback.textContent = 'Please wait until saving or PDF generation has finished.';
			return;
		}
		const requestedIds = new Set(this.selectedProofStudentIds);
		if (!all && !requestedIds.size) {
			feedback.textContent = 'Select at least one registered student before downloading proofs.';
			return;
		}
		this.generatingProofs = true;
		this.updateProofDownloadButtons();
		const progress = this.elements.proofGenerationProgress;
		progress.hidden = false;
		progress.max = 1;
		progress.value = 0;
		feedback.textContent = 'Loading the latest registration details...';
		try {
			await this.refreshProofStudents();
			const students = this.students.filter(student => all || requestedIds.has(student.id)).map(student => ({ ...student }));
			if (!students.length) throw new Error('No current registered students are available for this download.');
			if (!all && students.length !== requestedIds.size) {
				throw new Error('Some selected students are no longer in the register. Review the updated selection and retry.');
			}
			progress.max = students.length;
			const result = await createProofArchive({
				students,
				createPdf: student => this.createRegistrationProof(student),
				Zip: window.JSZip,
				onProgress: ({ completed, total }) => {
					progress.value = completed;
					feedback.textContent = completed === total ? 'Preparing ZIP download...' : `Processed ${completed} of ${total} students...`;
				}
			});
			if (this.currentUser?.uid !== exportUid) throw new Error('Your account changed. No ZIP was downloaded; retry from the current register.');
			if (result.data) this.downloadProofArchive(result.data);
			this.showProofArchiveResult(result, students);
		} catch (error) {
			feedback.textContent = `Unable to create ZIP: ${error.message || 'Generation failed.'}`;
		} finally {
			this.generatingProofs = false;
			this.updateProofDownloadButtons();
			progress.hidden = true;
		}
	}

	showProofArchiveResult(result, students) {
		const feedback = this.elements.proofBatchFeedback;
		feedback.textContent = result.data
			? `Downloaded ZIP containing ${result.generated} individual PDF${result.generated === 1 ? '' : 's'}.`
			: 'No PDFs were generated. No ZIP was downloaded.';
		if (result.failures.length) {
			const retryMessage = result.data
				? ' See GENERATION_FAILURES.txt inside the ZIP. Retry the failed students after correcting the errors.'
				: ' Correct the errors and retry.';
			feedback.textContent += ` ${result.failures.length} failed: ` + result.failures.map(({ student, message }) =>
				`${StudentRegisterDashboard.getStudentDisplayName(student)} (${student.studentId || student.id}): ${message}`
			).join('; ') + retryMessage;
		}
		if (students.some(student => !student.idNumber || !student.dateOfBirth || !student.course || !student.fieldOfStudy)) {
			feedback.textContent += ' Missing certificate details are marked "Not provided".';
		}
	}

	// Attendance reports

	updateReportDates() {
		const startDate = this.elements.reportStartDate.value;
		const endDate = this.elements.reportEndDate.value;
		if (!startDate || !endDate) {
			this.elements.reportDate.textContent = '';
			return;
		}
		this.elements.reportDate.textContent = startDate === endDate ? this.formatDate(startDate) : `${this.formatDate(startDate)} - ${this.formatDate(endDate)}`;
	}

	getWeekRanges(start, end) {
		const monthStart = new Date(start.getFullYear(), start.getMonth(), 1);
		const firstWeekStart = new Date(monthStart);
		const dayOffset = (firstWeekStart.getDay() + 6) % 7;
		firstWeekStart.setDate(firstWeekStart.getDate() - dayOffset);
		return Array.from({ length: 5 }, (_, index) => {
			const weekStart = new Date(firstWeekStart);
			weekStart.setDate(firstWeekStart.getDate() + index * 7);
			const weekEnd = new Date(weekStart);
			weekEnd.setDate(weekStart.getDate() + 6);
			if (weekEnd > end) weekEnd.setTime(end.getTime());
			return { start: weekStart, end: weekEnd };
		});
	}

	getWeekAttendance(studentId, range) {
		let attended = 0;
		for (let currentDate = new Date(range.start); currentDate <= range.end; currentDate.setDate(currentDate.getDate() + 1)) {
			const record = this.attendanceRecords.get(`${studentId}_${StudentRegisterDashboard.formatDateKey(currentDate)}`);
			if (record?.present === true) attended += 1;
		}
		return attended;
	}

	buildCohorts(weekRanges) {
		const cohorts = new Map();
		this.students.forEach((student) => {
			const mode = StudentRegisterDashboard.normalizeMode(student.mode);
			const modeLabel = mode === 'in-class' ? 'PHYSICAL' : mode.toUpperCase();
			const course = student.course || 'Unassigned';
			const cohortName = `${course.toUpperCase()} ${modeLabel}`;
			const cohortKey = `${course.toLowerCase()}|${mode === 'in-class' ? 'physical' : mode}`;
			if (!cohorts.has(cohortKey)) cohorts.set(cohortKey, { cohortName, students: [], weekly: [0, 0, 0, 0, 0] });
			const cohort = cohorts.get(cohortKey);
			cohort.students.push(student);
			const weekly = weekRanges.map((range) => this.getWeekAttendance(student.id, range));
			cohort.weekly = cohort.weekly.map((value, index) => value + weekly[index]);
		});
		return Array.from(cohorts.values());
	}

	exportReport() {
		const feedback = this.elements.reportFeedback;
		const startValue = this.elements.reportStartDate.value;
		const endValue = this.elements.reportEndDate.value;
		if (!window.XLSX || this.students.length === 0) {
			feedback.textContent = this.students.length === 0 ? 'Add a student before exporting a report.' : 'Excel export is unavailable. Check your connection.';
			return;
		}
		if (!startValue || !endValue || startValue > endValue) {
			feedback.textContent = 'Choose a valid date range before exporting.';
			return;
		}

		const weekRanges = this.getWeekRanges(new Date(`${startValue}T00:00:00`), new Date(`${endValue}T00:00:00`));
		const cohorts = this.buildCohorts(weekRanges);
		const workbook = createAttendanceWorkbook({
			cohorts,
			weekRanges,
			getWeekAttendance: (studentId, range) => this.getWeekAttendance(studentId, range),
			spreadsheet: window.XLSX
		});

		window.XLSX.writeFile(workbook, `TPC-register-${startValue}-to-${endValue}.xlsx`);
		feedback.textContent = 'Excel report downloaded with formulas now calculating correctly.';
	}
}

new StudentRegisterDashboard();
