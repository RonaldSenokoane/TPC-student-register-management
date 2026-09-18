import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { initializeFirestore, doc, getDoc, collection, addDoc, getDocs, setDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const firebaseConfig = { apiKey: 'AIzaSyAsqhOmthGO-UWXfLmakUcSpnf10l87rJ8', authDomain: 'tpc-student-register.firebaseapp.com', projectId: 'tpc-student-register', storageBucket: 'tpc-student-register.firebasestorage.app', messagingSenderId: '189511938770', appId: '1:189511938770:web:57a7cea92ed78ba3a3330b', measurementId: 'G-BP7R6QJKVW' };
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
let currentUser = null;
let students = [];
let attendance = new Map();
let attendanceRecords = new Map();
const getDateKey = () => document.querySelector('#attendance-date-input').value;
const getStudentsRef = () => collection(database, 'users', currentUser.uid, 'students');
const getAttendanceRef = (studentId, date) => doc(database, 'users', currentUser.uid, 'attendance', `${studentId}_${date}`);
const withTimeout = (promise, milliseconds) => Promise.race([
	promise,
	new Promise((_, reject) => setTimeout(() => reject(new Error('Save timed out after 2 minutes. Check your connection and try again.')), milliseconds))
]);

onAuthStateChanged(auth, async (user) => {
	if (!user) {
		window.location.replace('../Login-page/login.html');
		return;
	}
	currentUser = user;
	document.querySelector('#profile-email').textContent = user.email || 'No email available';
	try {
		const profileSnapshot = await withTimeout(getDoc(doc(database, 'users', user.uid)), 15000);
		const profile = profileSnapshot.exists() ? profileSnapshot.data() : {};
		document.querySelector('#profile-name').textContent = profile.name || user.email?.split('@')[0] || 'there';
		await loadRegister();
	} catch (error) {
		document.querySelector('#profile-name').textContent = user.email?.split('@')[0] || 'there';
		document.querySelector('#attendance-empty').textContent = `Database unavailable: ${error.code || error.message || 'check Firestore rules and connection.'}`;
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
		attendanceRecords.set(`${record.studentId}_${record.date}`, record.present === true);
		if (record.date === getDateKey()) attendance.set(record.studentId, record.present === true);
	});
}

function renderStudents() {
	const list = document.querySelector('#attendance-list');
	const empty = document.querySelector('#attendance-empty');
	list.querySelectorAll('.attendance-row').forEach((row) => row.remove());
	students.forEach((student) => {
		const row = document.createElement('label');
		row.className = 'attendance-row';
		row.dataset.student = `${student.name} ${student.studentId} ${student.course}`.toLowerCase();
		row.innerHTML = `<span><strong>${student.name}</strong><small>${student.studentId} · ${student.course}</small></span><input class="attendance-check" type="checkbox" data-student-id="${student.id}" ${attendance.get(student.id) ? 'checked' : ''}><span class="checkmark">${attendance.get(student.id) ? 'Present' : 'Absent'}</span>`;
		row.querySelector('.attendance-check').addEventListener('change', handleAttendanceChange);
		list.insertBefore(row, empty);
	});
	empty.hidden = students.length > 0;
	updateAttendanceCount();
}

function updateAttendanceCount() {
	const present = students.filter((student) => attendance.get(student.id) === true).length;
	document.querySelector('#attendance-count').textContent = `${present} present · ${students.length - present} absent`;
	document.querySelector('#report-count').textContent = students.length;
}

async function handleAttendanceChange(event) {
	const checkbox = event.target;
	const studentId = checkbox.dataset.studentId;
	const present = checkbox.checked;
	attendance.set(studentId, present);
	checkbox.closest('.attendance-row').querySelector('.checkmark').textContent = present ? 'Present' : 'Absent';
	updateAttendanceCount();
	await setDoc(getAttendanceRef(studentId, getDateKey()), { studentId, date: getDateKey(), present, updatedAt: new Date() });
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
document.querySelector('#student-form').addEventListener('submit', async (event) => {
	event.preventDefault();
	const feedback = document.querySelector('#student-feedback');
	const submitButton = event.target.querySelector('button[type="submit"]');
	submitButton.disabled = true;
	feedback.textContent = 'Saving student...';
	try {
		const student = { name: document.querySelector('#student-name').value.trim(), studentId: document.querySelector('#student-id').value.trim(), course: document.querySelector('#student-course').value.trim(), email: document.querySelector('#student-email').value.trim(), createdAt: new Date() };
		const savedStudent = await withTimeout(addDoc(getStudentsRef(), student), 120000);
		students.push({ id: savedStudent.id, ...student });
		feedback.textContent = 'Student saved successfully to the database.';
		event.target.reset();
		renderStudents();
	} catch (error) {
		feedback.textContent = `Unable to save student: ${error.code || error.message || 'check your Firestore rules.'}`;
	}
	submitButton.disabled = false;
});
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
	const totalDays = Math.round((end - start) / 86400000) + 1;
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
			if (attendanceRecords.get(`${studentId}_${currentDate.toISOString().slice(0, 10)}`) === true) attended += 1;
		}
		return attended;
	};
	const rows = students.map((student, index) => {
		const weeklyAttendance = weekRanges.map((range) => getWeekAttendance(student.id, range));
		const monthlyDays = weeklyAttendance.reduce((total, week) => total + week, 0);
		return { 'No.': index + 1, 'Name and Surname': student.name, 'Week 1 Attended': weeklyAttendance[0], 'Week 2 Attended': weeklyAttendance[1], 'Week 3 Attended': weeklyAttendance[2], 'Week 4 Attended': weeklyAttendance[3], 'Week 5 Attended': weeklyAttendance[4], 'Monthly Days': monthlyDays, 'Total Stipend': monthlyDays * 50, Unity: '', Summative: '', Payable: 0 };
	});
	const cohortTotals = new Map();
	students.forEach((student) => {
		const cohort = student.course || 'Unassigned';
		const weeklyAttendance = weekRanges.map((range) => getWeekAttendance(student.id, range));
		const existing = cohortTotals.get(cohort) || [0, 0, 0, 0, 0];
		cohortTotals.set(cohort, existing.map((total, index) => total + weeklyAttendance[index]));
	});
	const workbook = window.XLSX.utils.book_new();
	workbook.Workbook = { CalcPr: { calcMode: 'auto', fullCalcOnLoad: true, forceFullCalc: true } };
	const worksheet = window.XLSX.utils.json_to_sheet(rows, { origin: 'A2' });
	const summaryRows = Array.from(cohortTotals, ([cohort, weekly]) => ({ Cohort: cohort, 'Week 1': weekly[0], 'Week 2': weekly[1], 'Week 3': weekly[2], 'Week 4': weekly[3], 'Week 5': weekly[4], 'Monthly Average': Number((weekly.reduce((total, value) => total + value, 0) / 5).toFixed(1)) }));
	const summaryWorksheet = window.XLSX.utils.json_to_sheet(summaryRows, { origin: 'A2' });
	const monthLabel = new Date(`${reportStartDate.value}T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }).toUpperCase();
	window.XLSX.utils.sheet_add_aoa(worksheet, [[`${students[0]?.course || 'TPC'} STUDENTS REGISTER - ${monthLabel}`]], { origin: 'A1' });
	window.XLSX.utils.sheet_add_aoa(summaryWorksheet, [['WEEKLY AND MONTHLY ATTENDANCE REPORT']], { origin: 'A1' });
	worksheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 11 } }];
	summaryWorksheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }];
	rows.forEach((_, index) => {
		const rowNumber = index + 3;
		worksheet[`L${rowNumber}`] = {
			f: `IF(AND(IF(J${rowNumber}>1,J${rowNumber}/100,J${rowNumber})>=60%,IF(K${rowNumber}>1,K${rowNumber}/100,K${rowNumber})>=60%),I${rowNumber},0)`,
			v: 0,
			t: 'n'
		};
	});
	worksheet['!cols'] = [{ wch: 7 }, { wch: 26 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 15 }, { wch: 10 }, { wch: 12 }, { wch: 10 }];
	summaryWorksheet['!cols'] = [{ wch: 32 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 18 }];
	window.XLSX.utils.book_append_sheet(workbook, worksheet, 'Monthly Register');
	window.XLSX.utils.book_append_sheet(workbook, summaryWorksheet, 'Weekly Summary');
	window.XLSX.writeFile(workbook, `TPC-register-${reportStartDate.value}-to-${reportEndDate.value}.xlsx`);
	feedback.textContent = 'Excel report downloaded.';
});
