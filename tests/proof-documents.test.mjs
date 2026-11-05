import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadDashboardClass } from './dashboard-harness.mjs';
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createProofArchive, proofFilename, proofFilenames } from '../public/dashboard/proof-documents.js';
import { splitCombinedPdf } from '../scripts/split-registration-pdf.mjs';

const students = [
    { id: 'a', name: 'Thabiso', surname: 'Zwane', studentId: 'TPC-001', idNumber: 'PASSPORT-A' },
    { id: 'b', name: 'Minenhle Nokwanda', surname: 'Zwane', studentId: 'TPC-002', idNumber: 'PASSPORT-B' },
    { id: 'c', name: 'Alfred', surname: 'Mapetla', studentId: 'TPC-003', idNumber: 'PASSPORT-C' }
].map(student => ({ ...student, academicYear: 2026, dateOfBirth: '2000-01-02', course: `Programme ${student.studentId}`, fieldOfStudy: 'Business Studies' }));
const reviewedNames = owners => owners.flatMap((student, index) => student ? [{ page: index + 1, name: `${student.name} ${student.surname}`, firstNames: student.name, surname: student.surname, studentId: student.studentId, reviewed: true }] : []);

const source = await readFile(new URL('../public/dashboard/dashboard.js', import.meta.url), 'utf8');
const baseline = JSON.parse(await readFile(new URL('./fixtures/existing-certificate.json', import.meta.url), 'utf8'));
const Dashboard = loadDashboardClass(source);
const logo = new Uint8Array(await readFile(new URL('../public/assets/images/tpc-logo.png', import.meta.url)));
function createPdf(student) {
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    Dashboard.prototype.drawRegistrationCertificate.call(Object.create(Dashboard.prototype), pdf, student, logo);
    return pdf;
}
async function extract(bytes) {
    const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false });
    const pdf = await task.promise;
    try {
        const pages = [];
        for (let index = 1; index <= pdf.numPages; index++) pages.push((await (await pdf.getPage(index)).getTextContent()).items.map(item => item.str || '').join(' '));
        return pages;
    } finally { await task.destroy(); }
}
async function combined(owners, continuation = false) {
    const pdf = new jsPDF();
    owners.forEach((student, index) => {
        if (index) pdf.addPage();
        pdf.text('PROOF OF REGISTRATION', 20, 20);
        if (student) {
            if (!(continuation && index === 1)) pdf.text(`Full Name: ${student.name} ${student.surname}`, 20, 40);
            pdf.text(`Student Number: ${student.studentId}`, 20, 50);
            pdf.text(`ID/Passport Number: ${student.idNumber}`, 20, 60);
        } else pdf.text('Unidentified continuation page', 20, 40);
    });
    return new Uint8Array(pdf.output('arraybuffer'));
}

test('one student creates one independent PDF with the complete certificate', async () => {
    const pages = await extract(createPdf(students[0]).output('arraybuffer'));
    assert.equal(pages.length, 1);
    for (const expected of ['TPC Menlyn', 'PROOF OF REGISTRATION', '2026', 'Thabiso Zwane', 'TPC-001', 'PASSPORT-A', '2 January 2000', 'Programme TPC-001', 'Business Studies', 'official confirmation', 'Conrad Janse van Rensburg', 'CEO', 'Date:', '060 509 6027', 'conrad@natedstudies.co.za']) assert.ok(pages[0].includes(expected), expected);
});

test('three students yield three isolated PDFs in one ZIP and progress is reported', async () => {
    const snapshot = JSON.stringify(students);
    const progress = [];
    const result = await createProofArchive({ students, createPdf, Zip: JSZip, onProgress: event => progress.push(event.completed) });
    const zip = await JSZip.loadAsync(result.data);
    assert.equal(result.generated, 3);
    assert.deepEqual(result.failures, []);
    assert.deepEqual(progress, [1, 2, 3]);
    assert.deepEqual(Object.keys(zip.files), proofFilenames(students));
    for (const [index, filename] of proofFilenames(students).entries()) {
        const pages = await extract(await zip.file(filename).async('uint8array'));
        assert.equal(pages.length, 1);
        assert.ok(pages[0].includes(`${students[index].name} ${students[index].surname}`));
        assert.ok(pages[0].includes(students[index].idNumber));
        for (const other of students.filter((_, otherIndex) => otherIndex !== index)) {
            assert.ok(!pages[0].includes(`${other.name} ${other.surname}`));
            assert.ok(!pages[0].includes(other.idNumber));
            assert.ok(!pages[0].includes(other.studentId));
        }
    }
    assert.equal(JSON.stringify(students), snapshot);
});

test('50 selected students produce 50 independent PDF files', async () => {
    const many = Array.from({ length: 50 }, (_, index) => ({ ...students[0], name: `Learner ${index}`, studentId: `TPC-${index}` }));
    const result = await createProofArchive({ students: many, createPdf, Zip: JSZip });
    assert.equal(result.generated, 50);
    assert.equal(Object.keys((await JSZip.loadAsync(result.data)).files).length, 50);
});

test('safe filenames handle duplicate names, duplicate numbers, case, and unsafe characters', () => {
    assert.equal(proofFilenames(students)[1], 'Proof_of_Registration_Zwane_M_N.pdf');
    const names = proofFilenames([{ name: '../A/B', surname: 'Zwane', studentId: 'TPC/1' }, { name: '../A/B', surname: 'Zwane', studentId: 'TPC/2' }, { name: '../a/b', surname: 'zwane', studentId: 'TPC/2' }]);
    assert.equal(new Set(names.map(name => name.toLowerCase())).size, 3);
    names.forEach(name => assert.match(name, /^Proof_of_Registration_[a-z0-9_-]+\.pdf$/i));
    assert.equal(names[0], 'Proof_of_Registration_Zwane_A.pdf');
    assert.ok(names[1].endsWith('_TPC_2.pdf'));
});

test('surname and all given-name initials follow the required naming examples', () => {
    for (const [name, surname, expected] of [
        ['Thabiso', 'Zwane', 'Zwane_T'],
        ['Minenhle Nokwanda', 'Zwane', 'Zwane_M_N'],
        ['Alfred', 'Mapetla', 'Mapetla_A'],
        ['Ronald Thabo James', 'Senokoane', 'Senokoane_R_T_J'],
        ['Ronald Thabo James Peter', 'Senokoane', 'Senokoane_R_T_J_P'],
        ['  ronald   thabo  ', '  van   der merwe  ', 'Van_Der_Merwe_R_T'],
        ['Anne-Marie Jean', 'Dlamini-Zuma', 'Dlamini-Zuma_A_M_J'],
        ['Élodie', 'McDonald', 'McDonald_E']
    ]) assert.equal(proofFilename({ name, surname }), `Proof_of_Registration_${expected}.pdf`);
    assert.equal(proofFilename({ firstNames: 'Ronald Thabo James', surname: 'Senokoane' }), 'Proof_of_Registration_Senokoane_R_T_J.pdf');
});

test('surname/initial collisions append student numbers and never passport numbers', () => {
    const names = proofFilenames([
        { name: 'Thabiso', surname: 'Zwane', studentId: 'TPC-1', idNumber: 'SECRET-PASSPORT-1' },
        { name: 'Thabo', surname: 'Zwane', studentId: 'TPC-2', idNumber: 'SECRET-PASSPORT-2' }
    ]);
    assert.deepEqual(names, ['Proof_of_Registration_Zwane_T.pdf', 'Proof_of_Registration_Zwane_T_TPC-2.pdf']);
    assert.ok(names.every(name => !name.includes('PASSPORT')));
});

test('legacy full names require correction without blocking other students in the ZIP', async () => {
    assert.throws(() => proofFilename({ name: 'Thabiso van der Merwe' }), /separate given names and surname/);
    assert.throws(() => proofFilename({ fullName: 'Thabiso Zwane' }), /surname cannot be guessed/);
    const result = await createProofArchive({ students: [students[0], { ...students[1], name: 'Minenhle Nokwanda Zwane', surname: '' }], createPdf, Zip: JSZip });
    assert.equal(result.generated, 1);
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0].message, /Correct the student record/);
    const zip = await JSZip.loadAsync(result.data);
    assert.ok(zip.file('Proof_of_Registration_Zwane_T.pdf'));
    assert.match(await zip.file('GENERATION_FAILURES.txt').async('string'), /surname cannot be guessed/);
});

test('same-name students retain separate PDF files with their own student numbers', async () => {
    const duplicates = [students[0], { ...students[0], studentId: 'TPC-OTHER', idNumber: 'PASSPORT-OTHER' }];
    const result = await createProofArchive({ students: duplicates, createPdf, Zip: JSZip });
    const zip = await JSZip.loadAsync(result.data);
    assert.equal(Object.keys(zip.files).length, 2);
    const filenames = proofFilenames(duplicates);
    assert.equal(filenames[0], 'Proof_of_Registration_Zwane_T.pdf');
    assert.equal(filenames[1], 'Proof_of_Registration_Zwane_T_TPC-OTHER.pdf');
    for (const [index, filename] of filenames.entries()) {
        const text = (await extract(await zip.file(filename).async('uint8array')))[0];
        assert.ok(text.includes(duplicates[index].idNumber));
        assert.ok(!text.includes(duplicates[1 - index].idNumber));
    }
});

test('an oversized certificate is reported without discarding valid certificates', async () => {
    const result = await createProofArchive({ students: [students[0], { ...students[1], course: 'Very long programme '.repeat(250) }], createPdf, Zip: JSZip });
    assert.equal(result.generated, 1);
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0].message, /Minenhle Nokwanda Zwane.*exceed/);
});

test('empty selections, missing dependency, partial failures, and total failures are explicit', async () => {
    await assert.rejects(createProofArchive({ students: [], createPdf, Zip: JSZip }), /Select/);
    await assert.rejects(createProofArchive({ students, createPdf }), /ZIP generation/);
    const result = await createProofArchive({ students, Zip: JSZip, createPdf: student => {
        if (student.id === 'b') throw new Error('Example failure');
        return createPdf(student);
    } });
    assert.equal(result.generated, 2);
    assert.equal(result.failures[0].student.id, 'b');
    const zip = await JSZip.loadAsync(result.data);
    assert.match(await zip.file('GENERATION_FAILURES.txt').async('string'), /Minenhle Nokwanda Zwane.*Example failure/);
    assert.equal(Object.keys(zip.files).filter(name => name.endsWith('.pdf')).length, 2);
    const failed = await createProofArchive({ students, Zip: JSZip, createPdf: () => { throw new Error('Unavailable'); } });
    assert.equal(failed.data, null);
    assert.equal(failed.failures.length, 3);
});

test('certificate drawing operations preserve the existing design and branding', () => {
    // Captured from the pre-change template; only the issue date varies.
    assert.deepEqual(createPdf(students[0]).internal.pages[1].map(line => line.replace(/\(Date: \d{2}\/\d{2}\/\d{4}\)/, '(Date: ISSUE_DATE)')), baseline.page);
});

test('existing authentication, record ownership and Firestore rules are preserved', async () => {
    const hash = text => createHash('sha256').update(text.replace(/\r/g, '')).digest('hex');
    for (const [method, expected] of Object.entries(baseline.methods)) {
        // Report output is now checked against its original workbook fixture.
        if (method === 'exportReport') continue;
        const implementation = Dashboard.prototype[method].toString().replace(/\r/g, '')
            .replace('\n\t\tthis.resetProofSelectionForUser(user?.uid);', '')
            .replaceAll('../auth/sign-in.html', '../Login-page/login.html');
        assert.equal(hash(implementation), expected, method);
    }
    const currentRules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
    assert.equal(hash(currentRules), baseline.rules);
});

test('splitter creates independent PDFs and copies the original pages without re-rendering', async () => {
    const bytes = await combined(students);
    const result = await splitCombinedPdf(bytes, reviewedNames(students));
    assert.equal(result.count, 3);
    const zip = await JSZip.loadAsync(result.data);
    const sourceDoc = await PDFDocument.load(bytes);
    for (const [index, filename] of proofFilenames(students).entries()) {
        const output = await zip.file(filename).async('uint8array');
        const doc = await PDFDocument.load(output);
        assert.equal(doc.getPageCount(), 1);
        assert.deepEqual(doc.getPage(0).getSize(), sourceDoc.getPage(index).getSize());
        const streams = (document, page) => {
            const content = page.node.Contents();
            return (typeof content.asArray === 'function' ? content.asArray().map(ref => document.context.lookup(ref)) : [content]).map(stream => Array.from(stream.getContents()));
        };
        assert.deepEqual(streams(doc, doc.getPage(0)), streams(sourceDoc, sourceDoc.getPage(index)));
        assert.ok((await extract(output))[0].includes(`${students[index].name} ${students[index].surname}`));
    }
});

test('splitter groups explicit continuation IDs and flags unknown ownership for review', async () => {
    const result = await splitCombinedPdf(await combined([students[0], students[0], students[1]], true), reviewedNames([students[0], null, students[1]]));
    assert.equal(result.count, 2);
    const zip = await JSZip.loadAsync(result.data);
    assert.equal((await extract(await zip.file(proofFilenames([students[0]])[0]).async('uint8array'))).length, 2);
    const bytes = await combined([students[0], null]);
    const ambiguous = await splitCombinedPdf(bytes, reviewedNames([students[0]]));
    assert.equal(ambiguous.data, null);
    assert.equal(ambiguous.review[0].page, 2);
    const reviewed = await splitCombinedPdf(bytes, [...reviewedNames([students[0]]), { page: 2, name: 'Thabiso Zwane', studentId: 'TPC-001', reviewed: true }]);
    assert.equal(reviewed.count, 1);
    await assert.rejects(splitCombinedPdf(bytes, [{ page: 1, name: 'Wrong owner', studentId: 'WRONG', reviewed: true }]), /contradicts/);
});

test('splitter recognizes the real certificate template including its logo and graphics', async () => {
    const combinedDoc = await PDFDocument.create();
    for (const student of students) {
        const certificate = await PDFDocument.load(createPdf(student).output('arraybuffer'));
        const [page] = await combinedDoc.copyPages(certificate, [0]);
        combinedDoc.addPage(page);
    }
    const result = await splitCombinedPdf(await combinedDoc.save(), reviewedNames(students));
    assert.equal(result.count, 3);
    assert.deepEqual(result.review, []);
});

test('splitter refuses multiple student identities on one page even with a manual mapping', async () => {
    const pdf = new jsPDF();
    pdf.text('Full Name: Thabiso Zwane', 20, 20);
    pdf.text('Student Number: TPC-001', 20, 30);
    pdf.text('Full Name: Alfred Mapetla', 20, 40);
    pdf.text('Student Number: TPC-003', 20, 50);
    const result = await splitCombinedPdf(new Uint8Array(pdf.output('arraybuffer')), [{ page: 1, name: 'Thabiso Zwane', studentId: 'TPC-001', reviewed: true }]);
    assert.equal(result.data, null);
    assert.match(result.review[0].reason, /Multiple student/);
});

test('splitter requests verified surname parts and preserves compound surnames in filenames', async () => {
    const student = { ...students[0], name: 'Ronald Thabo James', surname: 'van der Merwe' };
    const bytes = await combined([student]);
    const unresolved = await splitCombinedPdf(bytes);
    assert.equal(unresolved.data, null);
    assert.match(unresolved.review[0].reason, /compound surname/);
    const result = await splitCombinedPdf(bytes, reviewedNames([student]));
    const zip = await JSZip.loadAsync(result.data);
    assert.deepEqual(Object.keys(zip.files), ['Proof_of_Registration_Van_Der_Merwe_R_T_J.pdf']);
    assert.ok((await extract(await zip.file('Proof_of_Registration_Van_Der_Merwe_R_T_J.pdf').async('uint8array')))[0].includes('Ronald Thabo James van der Merwe'));
    await assert.rejects(splitCombinedPdf(bytes, [{ ...reviewedNames([student])[0], surname: 'Zwane' }]), /do not match/);
});
