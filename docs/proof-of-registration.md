# Proof of registration downloads

Each student gets a new independent jsPDF document. Individual downloads save exactly one PDF. **Download Selected Proofs (ZIP)** exports the checked students; **Download All Proofs (ZIP)** exports all students loaded from the signed-in user's register, regardless of the search filter. Existing Firebase role checks and owner-scoped Firestore reads remain unchanged. These actions never write student records.

Successful new registrations automatically join the selection using their Firestore document IDs. The newest saved student also appears in the individual-proof card, and selected new records show **Newly Registered**. Registering more students retains earlier selections; editing an existing record does not automatically select it again. Checkboxes, removal buttons, Clear Selection and Select all matching remain available.

Selections and new-record markers persist in this browser's local storage, scoped by Firebase project and authenticated user ID. Only document IDs and the individual-preview ID are stored, with no student details. Navigation, list refreshes, reloads and downloads retain selection; removed records are pruned when the list refreshes. Clearing or deselecting students persists too. On shared browsers, switching accounts resets the visible list before restoring that account's selection. If storage is disabled or full, a status message explains that selection may not survive reload. This is browser-local persistence, not cross-device synchronization.

Proof downloads are disabled during registration saves and PDF generation. Failed saves do not select students; failed PDF generation retains selection for retry. Before each download, the current user's students are fetched from Firestore, so documents use the latest saved information. If this refresh fails, the download stops and reports the problem rather than generating stale records.

PDFs use `Proof_of_Registration_Surname_Initials.pdf`, for example `Proof_of_Registration_Zwane_M_N.pdf`. The shared `proofFilename` helper uses the separate surname and every given-name initial in order, with uppercase initials and no empty placeholders. The database's `name` field holds given names; the helper also accepts explicit `firstNames` for reviewed PDF mappings. It preserves compound surnames, normalizes extra spaces, and treats hyphenated given-name parts as separate initials (`Anne-Marie Jean` becomes `A_M_J`). Uniformly lowercase/uppercase surname words receive initial capitalization, while existing mixed capitalization such as `McDonald` is retained. Accents are transliterated for filenames and unsafe characters removed/replaced; certificate text remains unchanged.

Within a ZIP, the first surname/initial combination keeps the base filename; subsequent collisions append the student number. Numeric suffixes also prevent collisions when student numbers are absent or repeated. ID/passport numbers are never used. Each individual download names only its own selected student, without being blocked by unrelated incomplete records. Records without separate given names and surname are flagged for correction rather than guessing from a full name. Successful PDFs remain downloadable when another student fails. The dashboard names every failure, and partial ZIPs contain `GENERATION_FAILURES.txt`. No ZIP is downloaded if every certificate fails. Missing other optional/legacy certificate details remain marked "Not provided". The existing one-page size check reports oversized records rather than clipping them silently.

The existing certificate drawing commands, logo, signature line, CEO, and contact information are preserved. jsPDF and JSZip are served locally from `public/dashboard/vendor`, so ZIP/PDF generation does not depend on their CDNs. Vendor files include their upstream license headers. npm packages also support validation and the offline splitter. After an intentional dependency update, refresh the browser copies with:

```powershell
Copy-Item node_modules/jszip/dist/jszip.min.js public/dashboard/vendor/jszip.min.js
Copy-Item node_modules/jspdf/dist/jspdf.umd.min.js public/dashboard/vendor/jspdf.umd.min.js
```

`dashboard.js` coordinates the page, with methods grouped by startup, navigation, authentication, storage, registration, attendance, proof selection, downloads and reports. Event binding, form reading, row construction and result messages have dedicated methods. `registration-certificate.js` owns the certificate drawing commands; `attendance-report.js` owns spreadsheet rows, formulas and column layout. Neither document-layout module reads dashboard state or writes database records. Regression fixtures compare both outputs with the original implementation.

## Local validation

Requires Node.js 22.13 or newer (PDF extraction uses the PDF.js legacy Node build).

```powershell
npm ci
npm test
npm run check
npm --prefix functions run lint
python -m http.server 8080 --directory public
```

Open `http://localhost:8080/auth/sign-in.html`, sign in, and select **Proof of registration**. Check individual download, select several names, search without losing selections, download selected ZIP, and download all ZIP. Repeat at a mobile viewport. The project serves `public/` as a static Firebase Hosting application and has no production build script.

Tests inspect actual PDF text, ZIP entries, 50-student export, filename collisions, failure reporting, original certificate drawing commands, unchanged authentication/attendance/reporting methods and Firestore rules, copied PDF content streams, and ambiguous-page handling. Permission checks compare the unchanged access code/rules; they do not exercise a live Firebase project or emulator. No production records are used by tests.

## Separate an older combined PDF

```powershell
node scripts/split-registration-pdf.mjs "C:\path\combined.pdf" --out proof-output
```

The utility writes `proof-output/Separated_Proofs_of_Registration.zip`. Extract it to obtain the independent PDFs. Pages are copied with pdf-lib, preserving original page content/resources and dimensions without re-rendering. It reads full-name and student-number labels from each page; pages with the same student number are grouped, including continuation pages repeating only that number. The current certificate template stores only a full-name label, so a first run requests human verification of separate `firstNames` and `surname` fields instead of guessing compound surnames. Once verified on one page for a student number, those parts apply to that student's other identified pages. Conflicting identities, multiple student labels on one page, and pages without sufficient readable text block the entire export pending review. Unlabelled continuation pages are never assigned to the preceding student automatically.

If review is needed, open the original PDF and edit the generated `pages-needing-review.json`, supplying the verified full `name`, separate `firstNames` and `surname`, `studentId`, and `"reviewed": true`. Given names plus surname must match the original full-name label. Page numbers start at 1. For example:

```json
[
  { "page": 2, "name": "Thabiso Zwane", "firstNames": "Thabiso", "surname": "Zwane", "studentId": "TPC-001", "reviewed": true }
]
```

```powershell
node scripts/split-registration-pdf.mjs "C:\path\combined.pdf" --out proof-output-reviewed --mapping proof-output/pages-needing-review.json
```

A mapping cannot override conflicting readable labels or a page containing multiple student identities. Such source pages require manual correction. Scanned PDFs require human page review; there is no OCR or guessing. Existing output files are never overwritten; choose a fresh output directory for another attempt. The original PDF is read only. Keep private PDFs and output archives outside `public/`. The default `proof-output` directory is at the project root. Firebase Hosting serves only `public/`; scripts, tests, documentation, npm files and `proof-output` stay outside that directory. PDF and ZIP files are also excluded from Hosting.

## Deployment after review and approval

No deployment was performed. From the project root, after approval:

```powershell
npm ci
npm test
npm run check
firebase deploy --only hosting --project tpc-student-register
```

This uses the existing `.firebaserc` project and `firebase.json` static Hosting configuration. Use an installed Firebase CLI authenticated to this project. Hosting-only deployment publishes the reorganized browser app and preserves legacy invitation URLs. The Function now generates `/auth/accept-invitation.html` links; include `functions` in a separately reviewed deployment to start issuing those new links. Existing deployed Functions remain compatible through the legacy Hosting aliases. Firestore rules are unchanged.

Suggested commit message: `fix: standardize proof of registration filenames using surname and initials`

## Changed files

- `public/dashboard/index.html`, `public/dashboard/dashboard.css`, `public/dashboard/dashboard.js`: selection controls, independent PDF downloads, ZIP actions, progress and error messages.
- `public/dashboard/proof-documents.js`: filename handling and ZIP generation.
- `public/dashboard/registration-certificate.js`, `public/dashboard/attendance-report.js`: document layouts extracted from dashboard coordination.
- `public/dashboard/vendor/jspdf.umd.min.js`, `public/dashboard/vendor/jszip.min.js`: locally served browser dependencies.
- `scripts/split-registration-pdf.mjs`: existing-PDF inspection, review mapping and page-copy utility.
- `tests/proof-documents.test.mjs`, `tests/proof-selection.test.mjs`, `tests/fixtures/existing-certificate.json`: automated PDF/ZIP, registration-selection and persistence validation, with a baseline captured from the original template/access code.
- `tests/dashboard-harness.mjs`, `tests/dashboard-report.test.mjs`, `tests/fixtures/existing-attendance-report.json`: shared dashboard loading and regression validation for the original spreadsheet output.
- `package.json`, `package-lock.json`: pinned development/utility dependencies and validation commands.
- `.gitignore`, `firebase.json`: exclude dependencies, validation files, and private generated exports from source control/Hosting as appropriate.
- `docs/proof-of-registration.md`: usage, tests, utility workflow and deployment instructions.
