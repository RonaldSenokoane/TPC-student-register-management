import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDashboardClass } from './dashboard-harness.mjs';
import { readFile } from 'node:fs/promises';
import { createProofArchive, proofFilename } from '../public/dashboard/proof-documents.js';
import JSZip from 'jszip';

const source = await readFile(new URL('../public/dashboard/dashboard.js', import.meta.url), 'utf8');
class Element {
    constructor() { this.children = []; this.dataset = {}; this.value = ''; this.listeners = {}; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    setAttribute() {}
    focus(options) { this.focusOptions = options; }
    scrollIntoView(options) { this.scrollOptions = options; }
    querySelectorAll() {
        return this.children.flatMap(child => [...(child.dataset?.proofStudentId ? [child] : []), ...child.querySelectorAll()]);
    }
}
function setup() {
    const storage = new Map();
    const records = new Map([['admin-a', []], ['admin-b', []]]);
    const fields = new Map();
    const field = id => { if (!fields.has(id)) fields.set(id, new Element()); return fields.get(id); };
    for (const [id, value] of Object.entries({ '#student-name': 'First', '#student-surname': 'Learner', '#student-id': 'TPC-1', '#student-course': 'Business', '#student-id-number': 'PASSPORT-1', '#student-email': 'student@example.test', '#student-phone': '', '#student-sponsor': '' })) field(id).value = value;
    let save = async (uid, data) => {
        const id = `doc-${records.get(uid).length + 1}`;
        records.get(uid).push({ ...data, id });
        return { id };
    };
    const context = {
        setTimeout, clearTimeout, URL, Blob, createProofArchive, proofFilename,
        firebaseConfig: { projectId: 'test-project' },
        window: { localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) }, JSZip, matchMedia: () => ({ matches: false }) },
        document: { querySelector: field, createElement: () => new Element() },
        addDoc: (uid, data) => save(uid, data),
        updateDoc: async () => {},
        getDocs: async uid => ({ docs: records.get(uid).map(record => ({ id: record.id, data: () => ({ ...record }) })) })
    };
    const Dashboard = loadDashboardClass(source, context);
    context.getDocsFromServer = context.getDocs;
    function instance(uid = 'admin-a') {
        const dashboard = Object.create(Dashboard.prototype);
        dashboard.students = [];
        dashboard.selectedProofStudentIds = new Set();
        dashboard.newlyRegisteredProofIds = new Set();
        dashboard.elements = new Proxy({}, { get: (target, key) => target[key] ||= new Element() });
        dashboard.elements.studentAcademicYear.value = '2026';
        dashboard.elements.studentDateOfBirth.value = '2000-01-01';
        dashboard.elements.studentFieldOfStudy.value = 'Business';
        dashboard.getStudentsRef = () => dashboard.currentUser.uid;
        dashboard.getStudentRef = id => id;
        dashboard.resetStudentForm = () => { dashboard.editingStudentId = null; };
        dashboard.renderStudents = () => {};
        dashboard.resetProofSelectionForUser(uid);
        dashboard.currentUser = { uid };
        dashboard.restoreProofSelection();
        return dashboard;
    }
    const submit = new Element();
    const event = { preventDefault() {}, target: { querySelector: () => submit } };
    return { instance, fields, records, storage, context, event, submit, setSave: callback => { save = callback; } };
}

test('successful registrations accumulate unique Firestore IDs and immediately enable individual proof', async () => {
    const harness = setup();
    const dashboard = harness.instance();
    for (let index = 0; index < 3; index++) await dashboard.saveStudent(harness.event);
    assert.deepEqual([...dashboard.selectedProofStudentIds], ['doc-1', 'doc-2', 'doc-3']);
    assert.equal(dashboard.selectedProofStudentId, 'doc-3');
    assert.equal(dashboard.elements.downloadProof.disabled, false);
    assert.equal(dashboard.elements.proofSelectionCount.textContent, '3 students selected');
    assert.equal(dashboard.elements.proofSearchResults.querySelectorAll().filter(box => box.checked).length, 3);
    assert.match(dashboard.elements.proofSearchResults.children[0].children[1].children[0].textContent, /Newly Registered/);
    dashboard.selectedProofStudentIds.add('doc-1');
    dashboard.searchProofStudents();
    assert.equal(dashboard.selectedProofStudentIds.size, 3);
});

test('reload, list refresh, and two administrators preserve isolated selections', async () => {
    const harness = setup();
    const first = harness.instance();
    await first.saveStudent(harness.event);
    await first.saveStudent(harness.event);
    const reloaded = harness.instance();
    await reloaded.refreshProofStudents();
    assert.deepEqual([...reloaded.selectedProofStudentIds], ['doc-1', 'doc-2']);
    const second = harness.instance('admin-b');
    assert.equal(second.selectedProofStudentIds.size, 0);
    await second.saveStudent(harness.event);
    assert.equal(second.selectedProofStudentIds.size, 1);
    first.resetProofSelectionForUser('admin-b');
    assert.equal(first.selectedProofStudentIds.size, 0);
    first.currentUser = { uid: 'admin-b' };
    first.restoreProofSelection();
    await first.refreshProofStudents();
    assert.equal(first.selectedProofStudentIds.size, 1);
    assert.equal(harness.storage.size, 2);
    assert.equal(JSON.parse(harness.storage.get('tpc-proof-selection:test-project:admin-a')).ids.length, 2);
});

test('manual checkbox deselection persists and deleted students are pruned', async () => {
    const harness = setup();
    const dashboard = harness.instance();
    await dashboard.saveStudent(harness.event);
    await dashboard.saveStudent(harness.event);
    const checkbox = dashboard.elements.proofSearchResults.querySelectorAll()[0];
    checkbox.checked = false;
    checkbox.listeners.change();
    assert.deepEqual([...dashboard.selectedProofStudentIds], ['doc-2']);
    assert.equal(dashboard.elements.proofSearchResults.querySelectorAll()[0].checked, false);
    const reloaded = harness.instance();
    await reloaded.refreshProofStudents();
    assert.deepEqual([...reloaded.selectedProofStudentIds], ['doc-2']);
    harness.records.set('admin-a', []);
    await reloaded.refreshProofStudents();
    assert.equal(reloaded.selectedProofStudentIds.size, 0);
});

test('pending saves block all downloads, and failed registration never selects a student', async () => {
    const harness = setup();
    const dashboard = harness.instance();
    await dashboard.saveStudent(harness.event);
    let rejectSave;
    harness.setSave(() => new Promise((resolve, reject) => { rejectSave = reject; }));
    const pending = dashboard.saveStudent(harness.event);
    assert.equal(dashboard.elements.downloadProof.disabled, true);
    assert.equal(dashboard.elements.downloadSelectedProofs.disabled, true);
    assert.equal(dashboard.elements.downloadAllProofs.disabled, true);
    await dashboard.downloadRegistrationProof();
    await dashboard.downloadSelectedRegistrationProofs();
    assert.match(dashboard.elements.proofBatchFeedback.textContent, /Please wait/);
    rejectSave(new Error('Permission denied'));
    await pending;
    assert.equal(dashboard.selectedProofStudentIds.size, 1);
    assert.equal(dashboard.elements.downloadSelectedProofs.disabled, false);
    assert.match(dashboard.elements.studentFeedback.textContent, /Permission denied/);
});

test('PDF failures preserve saved selection and exports refresh current Firestore data', async () => {
    const harness = setup();
    const dashboard = harness.instance();
    await dashboard.saveStudent(harness.event);
    harness.records.get('admin-a')[0].course = 'Updated programme from Firestore';
    const attempted = [];
    dashboard.createRegistrationProof = student => { attempted.push(student.course); throw new Error('PDF unavailable'); };
    await dashboard.downloadRegistrationProof();
    await dashboard.downloadSelectedRegistrationProofs();
    assert.deepEqual(attempted, ['Updated programme from Firestore', 'Updated programme from Firestore']);
    assert.equal(dashboard.selectedProofStudentIds.size, 1);
    assert.match(dashboard.elements.proofBatchFeedback.textContent, /1 failed/);
    assert.equal(harness.instance().selectedProofStudentIds.size, 1);
});

test('unavailable browser storage keeps selection usable and reports persistence failure', async () => {
    const harness = setup();
    harness.context.window.localStorage.setItem = () => { throw new Error('Storage disabled'); };
    const dashboard = harness.instance();
    await dashboard.saveStudent(harness.event);
    assert.equal(dashboard.selectedProofStudentIds.size, 1);
    assert.match(dashboard.elements.proofSelectionFeedback.textContent, /browser storage is unavailable/);
});

test('failed server refresh stops downloads and retains selection for retry', async () => {
    const harness = setup();
    const dashboard = harness.instance();
    await dashboard.saveStudent(harness.event);
    harness.context.getDocsFromServer = async () => { throw new Error('Server unavailable'); };
    dashboard.createRegistrationProof = () => { throw new Error('Must not generate from stale data'); };
    await dashboard.downloadRegistrationProof();
    await dashboard.downloadSelectedRegistrationProofs();
    assert.match(dashboard.elements.proofDownloadFeedback.textContent, /Server unavailable/);
    assert.match(dashboard.elements.proofBatchFeedback.textContent, /Server unavailable/);
    assert.equal(dashboard.selectedProofStudentIds.size, 1);
    assert.equal(harness.instance().selectedProofStudentIds.size, 1);
});

test('a save finishing after account change cannot select records for the other administrator', async () => {
    const harness = setup();
    const dashboard = harness.instance();
    let resolveSave;
    harness.setSave(() => new Promise(resolve => { resolveSave = resolve; }));
    const pending = dashboard.saveStudent(harness.event);
    dashboard.resetProofSelectionForUser('admin-b');
    dashboard.currentUser = { uid: 'admin-b' };
    dashboard.restoreProofSelection();
    resolveSave({ id: 'old-user-document' });
    await pending;
    assert.equal(dashboard.selectedProofStudentIds.size, 0);
    assert.equal(dashboard.students.length, 0);
});

test('individual downloads name the selected student and ignore unrelated incomplete records', async () => {
    const harness = setup();
    const dashboard = harness.instance();
    await dashboard.saveStudent(harness.event);
    harness.records.get('admin-a').push({ id: 'legacy', name: 'An unrelated full name', studentId: 'LEGACY' });
    const downloads = [];
    dashboard.createRegistrationProof = student => ({ save: filename => downloads.push({ filename, studentId: student.studentId }) });
    await dashboard.downloadRegistrationProof();
    assert.deepEqual(downloads, [{ filename: 'Proof_of_Registration_Learner_F.pdf', studentId: 'TPC-1' }]);
    assert.equal(dashboard.selectedProofStudentIds.size, 1);
});

test('Review shows and focuses the chosen student without changing the ZIP selection', async () => {
    const harness = setup();
    const dashboard = harness.instance();
    await dashboard.saveStudent(harness.event);
    harness.fields.get('#student-name').value = 'Second';
    await dashboard.saveStudent(harness.event);
    dashboard.clearProofSelection();

    const review = dashboard.elements.proofSearchResults.children[1].children[2];
    review.listeners.click();

    assert.equal(dashboard.selectedProofStudentId, 'doc-2');
    assert.equal(dashboard.elements.proofStudentCard.hidden, false);
    assert.equal(dashboard.elements.proofStudentName.textContent, 'Second Learner');
    assert.equal(dashboard.elements.proofStudentName.focusOptions.preventScroll, true);
    assert.equal(dashboard.elements.proofStudentCard.scrollOptions.behavior, 'smooth');
    assert.equal(dashboard.elements.downloadProof.disabled, false);
    assert.equal(dashboard.selectedProofStudentIds.size, 0);

    harness.context.window.matchMedia = () => ({ matches: true });
    review.listeners.click();
    assert.equal(dashboard.elements.proofStudentCard.scrollOptions.behavior, 'instant');
});
