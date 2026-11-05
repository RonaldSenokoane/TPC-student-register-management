# TPC Student Register

Student registration, attendance tracking, Excel reports, and individual Proof of Registration PDFs with bulk ZIP downloads. The browser app uses Firebase Authentication and Firestore; Cloud Functions handles account invitations and roles.

## Project layout

```text
public/                         Firebase Hosting web root
  auth/                         Sign-in and invitation pages
    sign-in.html
    sign-in.js
    auth.css                    Shared authentication page styles
    accept-invitation.html
    accept-invitation.js
  dashboard/
    index.html                  Dashboard entry page
    dashboard.js                Page coordination and student workflows
    dashboard.css
    proof-documents.js          PDF filenames and ZIP generation
    registration-certificate.js Certificate layout
    attendance-report.js        Excel workbook layout
    vendor/                     Browser-ready jsPDF and JSZip libraries
  assets/images/tpc-logo.png
  firebase-config.js            Public Firebase web configuration
functions/                      Server-only Firebase Functions
scripts/                        Offline PDF separation utility
tests/                          Automated tests and regression fixtures
docs/                           Setup and feature guides
firebase.json                   Hosting, Functions and Firestore configuration
firestore.rules                 Database access rules
```

Root npm dependencies support tests and offline utilities. `functions/package.json` and its lockfile belong to the independently deployed server package. The browser vendor files are required runtime assets. Keep both lockfiles and the regression fixtures; `node_modules` and generated proof archives are ignored and should not be committed.

## Run locally

Use Node.js 22.13 or newer and Python 3:

```powershell
npm ci
npm test
npm run check
npm --prefix functions run lint
python -m http.server 8080 --directory public
```

Open [the sign-in page](http://localhost:8080/auth/sign-in.html). This static server uses the configured Firebase backend; it does not emulate Authentication, Firestore or Functions. The `/` sign-in redirect and legacy page redirects are configured in Firebase Hosting rather than Python's static server. There is no frontend build step.

For VS Code Live Server, the workspace settings serve `public/` as the web root. Open `http://127.0.0.1:5500/auth/sign-in.html` in that mode. If Live Server serves the project root instead, `http://127.0.0.1:5500/public/auth/sign-in.html` also works: asset links and navigation are relative to the page. Stop and restart Live Server when changing its root setting.

## Guides

- [Firebase setup and deployment](docs/firebase-setup.md)
- [Proof downloads, filenames, tests and older-PDF separation](docs/proof-of-registration.md)

Firebase Hosting serves only `public/`. Documentation, tests, dependencies, server code and generated files remain outside the web root. Existing `/Login-page/login.html`, `/Login-page/accept-invitation.html` and `/dashboard/dashboard.html` URLs are retained as Hosting aliases; new links use `/auth/` and `/dashboard/index.html`.

Deploy only after reviewing and approving the changes. Deployment commands are in the setup guide.
