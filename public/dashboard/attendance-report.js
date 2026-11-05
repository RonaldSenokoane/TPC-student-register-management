export function createAttendanceWorkbook({ cohorts, weekRanges, getWeekAttendance, spreadsheet }) {
	const workbook = spreadsheet.utils.book_new();
	const reportSheet = spreadsheet.utils.aoa_to_sheet([]);
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
				...weekRanges.map((range) => getWeekAttendance(student.id, range)),
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

	spreadsheet.utils.sheet_add_aoa(reportSheet, rows, { origin: 'A1' });
	reportSheet['!merges'] = merges;
	reportSheet['!cols'] = [
		{ wch: 8 }, { wch: 26 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
		{ wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 12 }
	];
	spreadsheet.utils.book_append_sheet(workbook, reportSheet, 'Attendance Report');
	return workbook;
}
