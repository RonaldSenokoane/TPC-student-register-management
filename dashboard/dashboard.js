import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { initializeFirestore, doc, getDoc, collection, addDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const firebaseConfig = { apiKey: 'AIzaSyAsqhOmthGO-UWXfLmakUcSpnf10l87rJ8', authDomain: 'tpc-student-register.firebaseapp.com', projectId: 'tpc-student-register', storageBucket: 'tpc-student-register.firebasestorage.app', messagingSenderId: '189511938770', appId: '1:189511938770:web:57a7cea92ed78ba3a3330b', measurementId: 'G-BP7R6QJKVW' };
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
let currentUser = null;
let students = [];
let attendance = new Map();
let attendanceRecords = new Map();
let editingStudentId = null;

const getModeDisplay = (mode) => (mode === 'in-class' ? 'In Class' : 'Online');
const getStudentDisplayName = (student) => {
	if (student?.surname) return `${student.name || ''} ${student.surname}`.trim();
	if (student?.name) return student.name.trim();
	return 'Unknown student';
};
const getStudentNameParts = (student) => {
	const fullName = student?.name || '';
	if (student?.surname) return { firstName: student.name || '', surname: student.surname || '' };
	const parts = fullName.trim().split(/\s+/).filter(Boolean);
	if (parts.length <= 1) return { firstName: fullName.trim(), surname: '' };
	return { firstName: parts[0], surname: parts.slice(1).join(' ') };
};
const getDateKey = () => document.querySelector('#attendance-date-input').value;
const getStudentsRef = () => collection(database, 'users', currentUser.uid, 'students');
const getStudentRef = (studentId) => doc(database, 'users', currentUser.uid, 'students', studentId);
const getAttendanceRef = (studentId, date) => doc(database, 'users', currentUser.uid, 'attendance', `${studentId}_${date}`);
const withTimeout = (promise, milliseconds) => Promise.race([
	promise,
	new Promise((_, reject) => setTimeout(() => reject(new Error('Save timed out after 2 minutes. Check your connection and try again.')), milliseconds))
]);

const profileEmailEl = document.querySelector('#profile-email');
const profileNameEl = document.querySelector('#profile-name');
const attendanceEmptyEl = document.querySelector('#attendance-empty');
let authStateResolved = false;

const authFallbackTimer = setTimeout(() => {
	if (!authStateResolved) {
		profileEmailEl.textContent = 'No active session';
		profileNameEl.textContent = 'there';
		attendanceEmptyEl.textContent = 'Authentication is taking too long. Redirecting to the sign-in page...';
		setTimeout(() => window.location.replace('../Login-page/login.html'), 1200);
	}
}, 4000);

onAuthStateChanged(auth, async (user) => {
	authStateResolved = true;
	clearTimeout(authFallbackTimer);
	if (!user) {
		profileEmailEl.textContent = 'No active session';
		profileNameEl.textContent = 'there';
		attendanceEmptyEl.textContent = 'You are not signed in. Redirecting to the login page...';
		setTimeout(() => window.location.replace('../Login-page/login.html'), 1200);
		return;
	}
	currentUser = user;
	profileEmailEl.textContent = user.email || 'No email available';
	try {
		const profileSnapshot = await withTimeout(getDoc(doc(database, 'users', user.uid)), 15000);
		const profile = profileSnapshot.exists() ? profileSnapshot.data() : {};
		profileNameEl.textContent = profile.name || user.email?.split('@')[0] || 'there';
		await loadRegister();
	} catch (error) {
		profileNameEl.textContent = user.email?.split('@')[0] || 'there';
		attendanceEmptyEl.textContent = `Database unavailable: ${error.code || error.message || 'check Firestore rules and connection.'}`;
	}
});

document.querySelector('#sign-out').addEventListener('click', async () => {
	await signOut(auth);
});

const menuItems = document.querySelectorAll('.menu-item');
const views = document.querySelectorAll('.view');
const sidebar = document.querySelector('#sidebar');
const closeSidebar = () => sidebar.classList.remove('open');
menuItems.forEach((item) => {
	item.addEventListener('click', () => {
		menuItems.forEach((menuItem) => menuItem.classList.toggle('active', menuItem === item));
		views.forEach((view) => view.classList.toggle('active-view', view.id === `${item.dataset.view}-view`));
		closeSidebar();
	});
});
document.querySelector('#mobile-menu').addEventListener('click', () => sidebar.classList.add('open'));
document.querySelector('#close-menu').addEventListener('click', closeSidebar);

const dateInput = document.querySelector('#attendance-date-input');
dateInput.value = new Date().toISOString().slice(0, 10);
const reportStartDate = document.querySelector('#report-start-date');
const reportEndDate = document.querySelector('#report-end-date');
reportStartDate.value = dateInput.value;
reportEndDate.value = dateInput.value;
const formatDate = (date) => new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
const updateDates = () => {
	document.querySelector('#report-date').textContent = reportStartDate.value === reportEndDate.value ? formatDate(reportStartDate.value) : `${formatDate(reportStartDate.value)} - ${formatDate(reportEndDate.value)}`;
};
updateDates();

async function loadRegister() {
	try {
		const studentSnapshot = await getDocs(getStudentsRef());
		students = studentSnapshot.docs.map((studentDoc) => ({ id: studentDoc.id, ...studentDoc.data() }));
		await loadAttendance();
		renderStudents();
	} catch (error) {
		document.querySelector('#attendance-empty').textContent = `Unable to load students: ${error.code || error.message || 'check your Firestore rules.'}`;
	}
}

async function loadAttendance() {
	attendance = new Map();
	attendanceRecords = new Map();
	const attendanceSnapshot = await getDocs(collection(database, 'users', currentUser.uid, 'attendance'));
	attendanceSnapshot.forEach((attendanceDoc) => {
		const record = attendanceDoc.data();
		const normalizedMode = record.mode === 'in-class' ? 'in-class' : 'online';
		const attendanceState = { present: record.present === true, mode: normalizedMode };
		attendanceRecords.set(`${record.studentId}_${record.date}`, attendanceState);
		if (record.date === getDateKey()) attendance.set(record.studentId, attendanceState);
	});
}

function renderStudents() {
	const list = document.querySelector('#attendance-list');
	const empty = document.querySelector('#attendance-empty');
	list.querySelectorAll('.attendance-row').forEach((row) => row.remove());
	students.forEach((student) => {
		const row = document.createElement('div');
		const mode = student.mode === 'in-class' ? 'in-class' : 'online';
		const modeLabel = getModeDisplay(mode);
		const attendanceState = attendance.get(student.id) || { present: false, mode };
		const displayName = getStudentDisplayName(student);
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
		row.querySelector('.attendance-check').addEventListener('change', handleAttendanceChange);
		row.querySelector('.edit-action').addEventListener('click', () => handleEditStudent(student));
		row.querySelector('.delete-action').addEventListener('click', () => handleDeleteStudent(student.id));
		list.insertBefore(row, empty);
	});
	empty.hidden = students.length > 0;
	updateAttendanceCount();
}

function updateAttendanceCount() {
	const present = students.filter((student) => attendance.get(student.id)?.present === true).length;
	document.querySelector('#attendance-count').textContent = `${present} present · ${students.length - present} absent`;
	document.querySelector('#report-count').textContent = students.length;
}

async function handleAttendanceChange(event) {
	const checkbox = event.target;
	const studentId = checkbox.dataset.studentId;
	const student = students.find((item) => item.id === studentId);
	const mode = student?.mode === 'in-class' ? 'in-class' : 'online';
	const present = checkbox.checked;
	const attendanceState = { present, mode };
	attendance.set(studentId, attendanceState);
	checkbox.closest('.attendance-row').querySelector('.checkmark').textContent = `${present ? 'Present' : 'Absent'} · ${getModeDisplay(mode)}`;
	updateAttendanceCount();
	await setDoc(getAttendanceRef(studentId, getDateKey()), { studentId, date: getDateKey(), present, mode, updatedAt: new Date() });
}

dateInput.addEventListener('change', async () => {
	updateDates();
	if (currentUser) {
		await loadAttendance();
		renderStudents();
	}
});
reportStartDate.addEventListener('change', updateDates);
reportEndDate.addEventListener('change', updateDates);
document.querySelector('#student-search').addEventListener('input', (event) => {
	const query = event.target.value.trim().toLowerCase();
	const studentRows = document.querySelectorAll('.attendance-row');
	let visibleStudents = 0;
	studentRows.forEach((row) => {
		const matches = row.dataset.student.includes(query);
		row.hidden = !matches;
		if (matches) visibleStudents += 1;
	});
	const empty = document.querySelector('#attendance-empty');
	empty.hidden = visibleStudents > 0 || (query.length === 0 && students.length > 0);
	if (query.length > 0 && visibleStudents === 0) empty.textContent = 'No students found for this search.';
});
function resetStudentForm() {
	editingStudentId = null;
	document.querySelector('#student-form').reset();
	document.querySelector('#student-submit').innerHTML = 'Save student <span aria-hidden="true">&#8594;</span>';
	document.querySelector('#cancel-student-edit').hidden = true;
	document.querySelector('input[name="student-mode"][value="online"]').checked = true;
}

function handleEditStudent(student) {
	editingStudentId = student.id;
	const { firstName, surname } = getStudentNameParts(student);
	document.querySelector('.menu-item[data-view="register"]').click();
	setTimeout(() => {
		document.querySelector('#student-name').value = firstName || '';
		document.querySelector('#student-surname').value = surname || '';
		document.querySelector('#student-id').value = student.studentId || '';
		document.querySelector('#student-course').value = student.course || '';
		document.querySelector('#student-email').value = student.email || '';
		const mode = student.mode === 'in-class' ? 'in-class' : 'online';
		document.querySelector(`input[name="student-mode"][value="${mode}"]`).checked = true;
		document.querySelector('#student-submit').innerHTML = 'Update student <span aria-hidden="true">&#8594;</span>';
		document.querySelector('#cancel-student-edit').hidden = false;
		document.querySelector('#student-name').focus();
	}, 0);
}

async function handleDeleteStudent(studentId) {
	const student = students.find((item) => item.id === studentId);
	if (!student) return;
	if (!window.confirm(`Delete ${student.name} from the register?`)) return;
	try {
		await deleteDoc(getStudentRef(studentId));
		const attendanceQuery = query(collection(database, 'users', currentUser.uid, 'attendance'), where('studentId', '==', studentId));
		const attendanceSnapshot = await getDocs(attendanceQuery);
		await Promise.all(attendanceSnapshot.docs.map((attendanceDoc) => deleteDoc(attendanceDoc.ref)));
		students = students.filter((item) => item.id !== studentId);
		attendance.delete(studentId);
		const feedback = document.querySelector('#student-feedback');
		feedback.textContent = 'Student deleted successfully.';
		if (editingStudentId === studentId) resetStudentForm();
		renderStudents();
	} catch (error) {
		document.querySelector('#student-feedback').textContent = `Unable to delete student: ${error.code || error.message || 'check your Firestore rules.'}`;
	}
}

document.querySelector('#student-form').addEventListener('submit', async (event) => {
	event.preventDefault();
	const feedback = document.querySelector('#student-feedback');
	const submitButton = event.target.querySelector('button[type="submit"]');
	submitButton.disabled = true;
	feedback.textContent = editingStudentId ? 'Updating student...' : 'Saving student...';
	try {
		const firstName = document.querySelector('#student-name').value.trim();
		const surname = document.querySelector('#student-surname').value.trim();
		const mode = document.querySelector('input[name="student-mode"]:checked')?.value || 'online';
		const name = `${firstName} ${surname}`.trim();
		const student = { name: firstName, surname, studentId: document.querySelector('#student-id').value.trim(), course: document.querySelector('#student-course').value.trim(), email: document.querySelector('#student-email').value.trim(), mode, updatedAt: new Date() };
		if (editingStudentId) {
			await withTimeout(updateDoc(getStudentRef(editingStudentId), student), 120000);
			const index = students.findIndex((item) => item.id === editingStudentId);
			if (index >= 0) students[index] = { ...students[index], ...student, id: editingStudentId, name: firstName, surname };
			feedback.textContent = 'Student updated successfully.';
		} else {
			const savedStudent = await withTimeout(addDoc(getStudentsRef(), { ...student, name: firstName, surname, createdAt: new Date() }), 120000);
			students.push({ id: savedStudent.id, ...student, name: firstName, surname, createdAt: new Date() });
			feedback.textContent = 'Student saved successfully to the database.';
		}
		resetStudentForm();
		renderStudents();
	} catch (error) {
		feedback.textContent = `Unable to save student: ${error.code || error.message || 'check your Firestore rules.'}`;
	}
	submitButton.disabled = false;
});

document.querySelector('#cancel-student-edit').addEventListener('click', resetStudentForm);
document.querySelector('#print-report').addEventListener('click', async () => {
	const feedback = document.querySelector('#report-feedback');
	if (!window.XLSX || students.length === 0) {
		feedback.textContent = students.length === 0 ? 'Add a student before exporting a report.' : 'Excel export is unavailable. Check your connection.';
		return;
	}
	if (!reportStartDate.value || !reportEndDate.value || reportStartDate.value > reportEndDate.value) {
		feedback.textContent = 'Choose a valid date range before exporting.';
		return;
	}
	const start = new Date(`${reportStartDate.value}T00:00:00`);
	const end = new Date(`${reportEndDate.value}T00:00:00`);
	const weekRanges = Array.from({ length: 5 }, (_, index) => {
		const weekStart = new Date(start);
		weekStart.setDate(start.getDate() + index * 7);
		const weekEnd = new Date(weekStart);
		weekEnd.setDate(weekStart.getDate() + 6);
		if (weekEnd > end) weekEnd.setTime(end.getTime());
		return { start: weekStart, end: weekEnd };
	});
	const getWeekAttendance = (studentId, range) => {
		let attended = 0;
		for (let currentDate = new Date(range.start); currentDate <= range.end; currentDate.setDate(currentDate.getDate() + 1)) {
			const record = attendanceRecords.get(`${studentId}_${currentDate.toISOString().slice(0, 10)}`);
			if (record && record.present === true && record.mode === (students.find((student) => student.id === studentId)?.mode || 'online')) attended += 1;
		}
		return attended;
	};
	const buildModeRows = (studentGroup, modeLabel) => studentGroup.map((student, index) => {
		const weeklyAttendance = weekRanges.map((range) => getWeekAttendance(student.id, range));
		const monthlyDays = weeklyAttendance.reduce((total, week) => total + week, 0);
		return { 'No.': index + 1, Mode: modeLabel, 'Name and Surname': student.name, Course: student.course || 'Unassigned', 'Week 1 Attended': weeklyAttendance[0], 'Week 2 Attended': weeklyAttendance[1], 'Week 3 Attended': weeklyAttendance[2], 'Week 4 Attended': weeklyAttendance[3], 'Week 5 Attended': weeklyAttendance[4], 'Monthly Days': monthlyDays, 'Total Stipend': monthlyDays * 50, Unity: '', Summative: '', Payable: 0 };
	});
	const buildSummaryRows = (studentGroup, modeLabel) => {
		const cohortTotals = new Map();
		studentGroup.forEach((student) => {
			const cohort = student.course || 'Unassigned';
			const weeklyAttendance = weekRanges.map((range) => getWeekAttendance(student.id, range));
			const existing = cohortTotals.get(cohort) || [0, 0, 0, 0, 0];
			cohortTotals.set(cohort, existing.map((total, index) => total + weeklyAttendance[index]));
		});
		return Array.from(cohortTotals, ([cohort, weekly]) => ({ Mode: modeLabel, Cohort: cohort, 'Week 1': weekly[0], 'Week 2': weekly[1], 'Week 3': weekly[2], 'Week 4': weekly[3], 'Week 5': weekly[4], 'Monthly Average': Number((weekly.reduce((total, value) => total + value, 0) / 5).toFixed(1)) }));
	};
	const onlineStudents = students.filter((student) => (student.mode || 'online') === 'online');
	const inClassStudents = students.filter((student) => (student.mode || 'in-class') === 'in-class');
	const workbook = window.XLSX.utils.book_new();
	workbook.Workbook = { CalcPr: { calcMode: 'auto', fullCalcOnLoad: true, forceFullCalc: true } };
	const monthLabel = new Date(`${reportStartDate.value}T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }).toUpperCase();
	const createWorksheet = (rows, title, modeLabel) => {
		const worksheet = window.XLSX.utils.json_to_sheet(rows, { origin: 'A2' });
		window.XLSX.utils.sheet_add_aoa(worksheet, [[`${modeLabel.toUpperCase()} STUDENTS REGISTER - ${monthLabel}`]], { origin: 'A1' });
		worksheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 12 } }];
		worksheet['!cols'] = [{ wch: 7 }, { wch: 12 }, { wch: 26 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 15 }, { wch: 10 }, { wch: 12 }, { wch: 10 }];
		rows.forEach((_, index) => {
			const rowNumber = index + 3;
			worksheet[`M${rowNumber}`] = {
				f: `IF(AND(IF(K${rowNumber}>1,K${rowNumber}/100,K${rowNumber})>=60%,IF(L${rowNumber}>1,L${rowNumber}/100,L${rowNumber})>=60%),J${rowNumber},0)`,
				v: 0,
				t: 'n'
			};
		});
		return worksheet;
	};
	const onlineRows = buildModeRows(onlineStudents, 'Online');
	const inClassRows = buildModeRows(inClassStudents, 'In Class');
	const onlineSummaryRows = buildSummaryRows(onlineStudents, 'Online');
	const inClassSummaryRows = buildSummaryRows(inClassStudents, 'In Class');
	const onlineWorksheet = createWorksheet(onlineRows, 'Online Students', 'Online');
	const inClassWorksheet = createWorksheet(inClassRows, 'In Class Students', 'In Class');
	const onlineSummaryWorksheet = window.XLSX.utils.json_to_sheet(onlineSummaryRows, { origin: 'A2' });
	const inClassSummaryWorksheet = window.XLSX.utils.json_to_sheet(inClassSummaryRows, { origin: 'A2' });
	window.XLSX.utils.sheet_add_aoa(onlineSummaryWorksheet, [['ONLINE WEEKLY AND MONTHLY ATTENDANCE REPORT']], { origin: 'A1' });
	window.XLSX.utils.sheet_add_aoa(inClassSummaryWorksheet, [['IN CLASS WEEKLY AND MONTHLY ATTENDANCE REPORT']], { origin: 'A1' });
	onlineSummaryWorksheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }];
	inClassSummaryWorksheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }];
	onlineSummaryWorksheet['!cols'] = [{ wch: 18 }, { wch: 28 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 18 }];
	inClassSummaryWorksheet['!cols'] = [{ wch: 18 }, { wch: 28 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 18 }];
	window.XLSX.utils.book_append_sheet(workbook, onlineWorksheet, 'Online Students');
	window.XLSX.utils.book_append_sheet(workbook, onlineSummaryWorksheet, 'Online Summary');
	window.XLSX.utils.book_append_sheet(workbook, inClassWorksheet, 'In Class Students');
	window.XLSX.utils.book_append_sheet(workbook, inClassSummaryWorksheet, 'In Class Summary');
	window.XLSX.writeFile(workbook, `TPC-register-${reportStartDate.value}-to-${reportEndDate.value}.xlsx`);
	feedback.textContent = 'Excel report downloaded with online and in-class reports separated.';
});
