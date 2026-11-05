import vm from 'node:vm';
import { drawProofCertificate } from '../public/dashboard/registration-certificate.js';
import { createAttendanceWorkbook } from '../public/dashboard/attendance-report.js';

export function loadDashboardClass(source, context = {}) {
    Object.assign(context, { drawProofCertificate, createAttendanceWorkbook });
    const code = source
        .replace(/^import\b[\s\S]*?;\r?\n/gm, '')
        .replace('new StudentRegisterDashboard();', 'StudentRegisterDashboard;');
    return vm.runInNewContext(code, context);
}
