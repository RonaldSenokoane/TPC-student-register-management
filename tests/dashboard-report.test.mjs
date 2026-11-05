import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadDashboardClass } from './dashboard-harness.mjs';

const source = await readFile(new URL('../public/dashboard/dashboard.js', import.meta.url), 'utf8');
const baseline = JSON.parse(await readFile(new URL('./fixtures/existing-attendance-report.json', import.meta.url), 'utf8'));

test('attendance report preserves the original rows, formulas, layout and filename', () => {
    const downloads = [];
    const spreadsheet = {
        utils: {
            book_new: () => ({ sheets: [] }),
            aoa_to_sheet: () => ({}),
            sheet_add_aoa: (sheet, rows) => { sheet.rows = rows; },
            book_append_sheet: (workbook, sheet, name) => workbook.sheets.push({ name, sheet })
        },
        writeFile: (workbook, filename) => downloads.push({ workbook, filename })
    };
    const Dashboard = loadDashboardClass(source, { window: { XLSX: spreadsheet } });
    const dashboard = Object.create(Dashboard.prototype);
    dashboard.students = baseline.inputs.students;
    dashboard.attendanceRecords = new Map(baseline.inputs.attendance);
    dashboard.elements = {
        reportStartDate: { value: baseline.inputs.start },
        reportEndDate: { value: baseline.inputs.end },
        reportFeedback: {}
    };

    dashboard.exportReport();

    assert.equal(downloads.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(downloads[0])), baseline.output);
    assert.equal(dashboard.elements.reportFeedback.textContent, baseline.feedback);

    dashboard.elements.reportStartDate.value = '2027-01-01';
    dashboard.exportReport();
    assert.equal(downloads.length, 1);
    assert.equal(dashboard.elements.reportFeedback.textContent, 'Choose a valid date range before exporting.');
});
