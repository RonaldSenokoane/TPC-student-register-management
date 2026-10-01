import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { initializeFirestore, doc, getDoc, collection, addDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig } from '../firebase-config.js';

class StudentRegisterDashboard {
	constructor() {
		this.app = initializeApp(firebaseConfig);
		this.auth = getAuth(this.app);
		this.database = initializeFirestore(this.app, { experimentalAutoDetectLongPolling: true });
		this.currentUser = null;
		this.students = [];
		this.attendance = new Map();
		this.attendanceRecords = new Map();
		this.holidays = new Set();
		this.editingStudentId = null;
		this.authStateResolved = false;
		this.cacheElements();
		this.initializeDates();
		this.bindEvents();
		this.watchAuthentication();
	}

	static getModeDisplay(mode) {
		return mode === 'in-class' ? 'In Class' : 'Online';
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

	static withTimeout(promise, milliseconds, message) {
		return Promise.race([
			promise,
			new Promise((_, reject) => setTimeout(() => reject(new Error(message)), milliseconds))
		]);
	}

	cacheElements() {
		this.elements = {
			profileEmail: document.querySelector('#profile-email'),
			profileName: document.querySelector('#profile-name'),
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
		this.elements.attendanceDate.value = new Date().toISOString().slice(0, 10);
		this.elements.reportStartDate.value = this.elements.attendanceDate.value;
		this.elements.reportEndDate.value = this.elements.attendanceDate.value;
		this.updateReportDates();
	}

	bindEvents() {
		document.querySelector('#sign-out').addEventListener('click', () => signOut(this.auth));
		this.elements.menuItems.forEach((item) => {
			item.addEventListener('click', () => {
				this.elements.menuItems.forEach((menuItem) => menuItem.classList.toggle('active', menuItem === item));
				this.elements.views.forEach((view) => view.classList.toggle('active-view', view.id === `${item.dataset.view}-view`));
				this.closeSidebar();
			});
		});
		document.querySelector('#mobile-menu').addEventListener('click', () => this.elements.sidebar.classList.add('open'));
		document.querySelector('#close-menu').addEventListener('click', () => this.closeSidebar());
		this.elements.attendanceDate.addEventListener('change', () => this.handleAttendanceDateChange());
		this.elements.reportStartDate.addEventListener('change', () => this.updateReportDates());
		this.elements.reportEndDate.addEventListener('change', () => this.updateReportDates());
		this.elements.studentSearch.addEventListener('input', (event) => this.searchStudents(event));
		this.elements.holidayForm.addEventListener('submit', (event) => this.addHoliday(event));
		this.elements.studentForm.addEventListener('submit', (event) => this.saveStudent(event));
		this.elements.cancelStudentEdit.addEventListener('click', () => this.resetStudentForm());
		document.querySelector('#print-report').addEventListener('click', () => this.exportReport());
	}

	watchAuthentication() {
		this.authFallbackTimer = setTimeout(() => {
			if (!this.authStateResolved) {
				this.elements.profileEmail.textContent = 'No active session';
				this.elements.profileName.textContent = 'there';
				this.elements.attendanceEmpty.textContent = 'Authentication is taking too long. Redirecting to the sign-in page...';
				setTimeout(() => window.location.replace('../Login-page/login.html'), 1200);
			}
		}, 4000);
		onAuthStateChanged(this.auth, (user) => this.handleAuthStateChanged(user));
	}

	async handleAuthStateChanged(user) {
		this.authStateResolved = true;
		clearTimeout(this.authFallbackTimer);
		if (!user) {
			this.elements.profileEmail.textContent = 'No active session';
			this.elements.profileName.textContent = 'there';
			this.elements.attendanceEmpty.textContent = 'You are not signed in. Redirecting to the login page...';
			setTimeout(() => window.location.replace('../Login-page/login.html'), 1200);
			return;
		}
		this.currentUser = user;
		this.elements.profileEmail.textContent = user.email || 'No email available';
		try {
			const profileSnapshot = await StudentRegisterDashboard.withTimeout(
				getDoc(doc(this.database, 'users', user.uid)),
				15000,
				'Profile load timed out.'
			);
			const profile = profileSnapshot.exists() ? profileSnapshot.data() : {};
			this.elements.profileName.textContent = profile.name || user.email?.split('@')[0] || 'there';
			await this.loadRegister();
		} catch (error) {
			this.elements.profileName.textContent = user.email?.split('@')[0] || 'there';
			this.elements.attendanceEmpty.textContent = `Database unavailable: ${error.code || error.message || 'check Firestore rules and connection.'}`;
		}
	}

	closeSidebar() {
		this.elements.sidebar.classList.remove('open');
	}

	getDateKey() {
		return this.elements.attendanceDate.value;
	}

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

	syncAttendanceRecord(studentId, date, present, mode) {
		const normalizedMode = mode === 'in-class' ? 'in-class' : 'online';
		const normalizedDate = StudentRegisterDashboard.formatDateKey(date);
		const attendanceState = { present: present === true, mode: normalizedMode };
		this.attendanceRecords.set(`${studentId}_${normalizedDate}`, attendanceState);
		if (normalizedDate === this.getDateKey()) this.attendance.set(studentId, attendanceState);
		return attendanceState;
	}

	async loadRegister() {
		try {
			const studentSnapshot = await getDocs(this.getStudentsRef());
			this.students = studentSnapshot.docs.map((studentDoc) => ({ id: studentDoc.id, ...studentDoc.data() }));
			await Promise.all([this.loadAttendance(), this.loadHolidays()]);
			this.renderStudents();
		} catch (error) {
			this.elements.attendanceEmpty.textContent = `Unable to load students: ${error.code || error.message || 'check your Firestore rules.'}`;
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

	renderStudents() {
		const empty = this.elements.attendanceEmpty;
		this.elements.attendanceList.querySelectorAll('.attendance-row').forEach((row) => row.remove());
		this.students.forEach((student) => {
			const row = document.createElement('div');
			const mode = student.mode === 'in-class' ? 'in-class' : 'online';
			const modeLabel = StudentRegisterDashboard.getModeDisplay(mode);
			const attendanceState = this.attendance.get(student.id) || { present: false, mode };
			const displayName = StudentRegisterDashboard.getStudentDisplayName(student);
			row.className = 'attendance-row';
			row.dataset.student = `${displayName} ${student.studentId} ${student.course} ${modeLabel}`.toLowerCase();
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
			row.querySelector('.attendance-check').addEventListener('change', (event) => this.handleAttendanceChange(event));
			row.querySelector('.edit-action').addEventListener('click', () => this.editStudent(student));
			row.querySelector('.delete-action').addEventListener('click', () => this.deleteStudent(student.id));
			this.elements.attendanceList.insertBefore(row, empty);
		});
		empty.hidden = this.students.length > 0;
		this.updateAttendanceCount();
		this.renderAbsenceAlerts();
	}

	updateAttendanceCount() {
		const present = this.students.filter((student) => this.attendance.get(student.id)?.present === true).length;
		this.elements.attendanceCount.textContent = `${present} present · ${this.students.length - present} absent`;
		this.elements.reportCount.textContent = this.students.length;
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

	async handleAttendanceChange(event) {
		const checkbox = event.target;
		const studentId = checkbox.dataset.studentId;
		const student = this.students.find((item) => item.id === studentId);
		const mode = student?.mode === 'in-class' ? 'in-class' : 'online';
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

	resetStudentForm() {
		this.editingStudentId = null;
		this.elements.studentForm.reset();
		this.elements.studentSubmit.innerHTML = 'Save student <span aria-hidden="true">&#8594;</span>';
		this.elements.cancelStudentEdit.hidden = true;
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
			document.querySelector('#student-course').value = student.course || '';
			document.querySelector('#student-id-number').value = student.idNumber || '';
			document.querySelector('#student-phone').value = student.phone || '';
			document.querySelector('#student-email').value = student.email || '';
			const mode = student.mode === 'in-class' ? 'in-class' : 'online';
			document.querySelector(`input[name="student-mode"][value="${mode}"]`).checked = true;
			this.elements.studentSubmit.innerHTML = 'Update student <span aria-hidden="true">&#8594;</span>';
			this.elements.cancelStudentEdit.hidden = false;
			document.querySelector('#student-name').focus();
		}, 0);
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
			this.elements.studentFeedback.textContent = 'Student deleted successfully.';
			if (this.editingStudentId === studentId) this.resetStudentForm();
			this.renderStudents();
		} catch (error) {
			this.elements.studentFeedback.textContent = `Unable to delete student: ${error.code || error.message || 'check your Firestore rules.'}`;
		}
	}

	async saveStudent(event) {
		event.preventDefault();
		const feedback = this.elements.studentFeedback;
		const submitButton = event.target.querySelector('button[type="submit"]');
		submitButton.disabled = true;
		feedback.textContent = this.editingStudentId ? 'Updating student...' : 'Saving student...';
		try {
			const firstName = document.querySelector('#student-name').value.trim();
			const surname = document.querySelector('#student-surname').value.trim();
			const mode = document.querySelector('input[name="student-mode"]:checked')?.value || 'online';
			const student = { name: firstName, surname, studentId: document.querySelector('#student-id').value.trim(), course: document.querySelector('#student-course').value.trim(), idNumber: document.querySelector('#student-id-number').value.trim(), phone: document.querySelector('#student-phone').value.trim(), email: document.querySelector('#student-email').value.trim(), mode, updatedAt: new Date() };
			if (this.editingStudentId) {
				await StudentRegisterDashboard.withTimeout(updateDoc(this.getStudentRef(this.editingStudentId), student), 120000, 'Save timed out after 2 minutes. Check your connection and try again.');
				const index = this.students.findIndex((item) => item.id === this.editingStudentId);
				if (index >= 0) this.students[index] = { ...this.students[index], ...student, id: this.editingStudentId };
				feedback.textContent = 'Student updated successfully.';
			} else {
				const savedStudent = await StudentRegisterDashboard.withTimeout(addDoc(this.getStudentsRef(), { ...student, createdAt: new Date() }), 120000, 'Save timed out after 2 minutes. Check your connection and try again.');
				this.students.push({ id: savedStudent.id, ...student, createdAt: new Date() });
				feedback.textContent = 'Student saved successfully to the database.';
			}
			this.resetStudentForm();
			this.renderStudents();
		} catch (error) {
			feedback.textContent = `Unable to save student: ${error.code || error.message || 'check your Firestore rules.'}`;
		}
		submitButton.disabled = false;
	}

	formatDate(date) {
		return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
	}

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
			const modeLabel = student.mode === 'in-class' ? 'PHYSICAL' : 'ONLINE';
			const course = student.course || 'Unassigned';
			const cohortName = `${course.toUpperCase()} ${modeLabel}`;
			const cohortKey = `${course.toLowerCase()}|${student.mode === 'in-class' ? 'physical' : 'online'}`;
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
		const workbook = window.XLSX.utils.book_new();
		const reportSheet = window.XLSX.utils.aoa_to_sheet([]);
		const rows = [['WEEKLY AND MONTHLY ATTENDANCE REPORT'], ['Cohort', 'Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Monthly Average']];
		const merges = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }];
		let currentRow = 3;

		cohorts.forEach((cohort) => {
			const summaryRow = currentRow;
			rows.push([cohort.cohortName, ...cohort.weekly, null]);
			reportSheet[`G${summaryRow}`] = { t: 'n', f: `AVERAGE(B${summaryRow}:F${summaryRow})`, v: 0 };
			currentRow += 1;
		});

		rows.push([]);
		currentRow += 1;
		cohorts.forEach((cohort) => {
			const titleRow = currentRow;
			rows.push([`${cohort.cohortName} STUDENTS REGISTER`]);
			merges.push({ s: { r: titleRow - 1, c: 0 }, e: { r: titleRow - 1, c: 11 } });
			rows.push(['No.', 'Name and Surname', 'Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Monthly Days', 'Total Stipend', 'Unity', 'Summative', 'Payable']);
			currentRow += 2;
			cohort.students.forEach((student, index) => {
				const rowNumber = currentRow;
				rows.push([
					index + 1,
					`${student.name || ''} ${student.surname || ''}`.trim(),
					...weekRanges.map((range) => this.getWeekAttendance(student.id, range)),
					null,
					null,
					'',
					'',
					null
				]);
				reportSheet[`H${rowNumber}`] = { t: 'n', f: `SUM(C${rowNumber}:G${rowNumber})`, v: 0 };
				reportSheet[`I${rowNumber}`] = { t: 'n', f: `H${rowNumber}*50`, v: 0 };
				reportSheet[`L${rowNumber}`] = { t: 'n', f: `IF(OR(J${rowNumber}="",K${rowNumber}=""),0,MAX(I${rowNumber}-J${rowNumber}-K${rowNumber},0))`, v: 0 };
				currentRow += 1;
			});
			rows.push([]);
			currentRow += 1;
		});

		window.XLSX.utils.sheet_add_aoa(reportSheet, rows, { origin: 'A1' });
		reportSheet['!merges'] = merges;
		reportSheet['!cols'] = [
			{ wch: 8 }, { wch: 26 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
			{ wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 12 }
		];
		window.XLSX.utils.book_append_sheet(workbook, reportSheet, 'Attendance Report');
		window.XLSX.writeFile(workbook, `TPC-register-${startValue}-to-${endValue}.xlsx`);
		feedback.textContent = 'Excel report downloaded with formulas now calculating correctly.';
	}
}

new StudentRegisterDashboard();