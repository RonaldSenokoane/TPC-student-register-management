# Firebase setup

The application is configured for the `tpc-student-register` Firebase project. The sign-in page and dashboard import the public web app configuration from `firebase-config.js`. Firebase Authentication handles approved accounts. Cloud Firestore stores profiles, student records, attendance, holidays, and administrator-reviewed access requests. Firebase Functions performs privileged role assignment, invitation delivery, and account activation.

## Firebase Console

In the Firebase Console, open the `tpc-student-register` project and verify the following:

1. **Web app:** Confirm the registered web app's SDK configuration matches `firebase-config.js`. The project ID must be `tpc-student-register` and the sender ID must be `189511938770`. Do not substitute the web-app selector from the Console URL for the SDK `appId`.
2. **Authentication:** Enable Email/Password under Authentication > Sign-in method. Invitation acceptance verifies the invited email address when it activates the account.
3. **Authorized domains:** Add `localhost` for local testing and the project's `tpc-student-register.web.app` and `tpc-student-register.firebaseapp.com` Hosting domains if they are not already present. Add any custom Hosting domain used by the app.
4. **Firestore:** Create a Cloud Firestore database in Native mode if one does not already exist. Deploy `firestore.rules` before using the role workflow. Student, attendance, holiday, and profile data are accessible only to approved users; access requests can only be read by administrators.
5. **API key restrictions:** If the web API key is restricted in Google Cloud, allow the Firebase APIs used by the app and add the local and deployed web origins as HTTP referrers.
6. **Billing:** Cloud Functions deployment and execution require the Firebase project to use the Blaze plan.

The client Firebase configuration is visible to browsers by design. Roles are held in Firebase Authentication custom claims and only trusted Cloud Functions can set them. Never put service-account credentials or SMTP credentials in the client project.

## First administrator and approval workflow

1. Install the Firebase CLI, authenticate, and select the `tpc-student-register` project.
2. Create `functions\.env.tpc-student-register` from `functions\.env.example` (PowerShell: `Copy-Item functions\.env.example functions\.env.tpc-student-register`). The initial administrator email is `senokoaner@gmail.com`; keep it restricted to the intended owner. Set `APP_BASE_URL` to the exact public app origin (for example `https://tpc-student-register.web.app`, or `http://localhost:8000` while testing locally).
3. Configure the SMTP credentials as Firebase Functions secrets. Firebase prompts for each value:

   ```powershell
   firebase functions:secrets:set SMTP_HOST
   firebase functions:secrets:set SMTP_PORT
   firebase functions:secrets:set SMTP_USER
   firebase functions:secrets:set SMTP_PASSWORD
   firebase functions:secrets:set SMTP_FROM
   ```

   Use the SMTP host, port, mailbox username and password/app-password, and verified sender address provided by your email provider. Port 465 uses implicit TLS; other ports use STARTTLS.
4. Deploy the server functions, Firestore rules, and site:

   ```powershell
   Push-Location functions
   npm ci
   Pop-Location
   firebase deploy --only functions,firestore:rules,hosting --project tpc-student-register
   ```

   If deployment reports that the project must be upgraded to the Blaze plan, complete the upgrade in Firebase Console > Usage and billing, then rerun the deploy command. The role approval flow depends on Cloud Functions; it cannot run on the Spark plan.

5. Verify the owner mailbox. Sign in to the existing Firebase account for `senokoaner@gmail.com`; if Firebase says the email is unverified, use the verification link it sends and sign in again. The server bootstraps this verified account as the first administrator, once per project.
6. New people use **Request access** on the sign-in page and enter their name and email. They do not create a password or Firebase account yet. An administrator reviews the request and assigns **user** or **administrator**. The app sends a seven-day, single-use invitation link. The recipient accepts it and creates their password before their account and dashboard access are activated.

The `.env.tpc-student-register` file and SMTP values are excluded from source control. Do not commit credentials or deploy the SMTP password as a client environment variable.

## API key error

If sign-in reports `auth/api-key-not-valid`, open Project settings > General in the Firebase Console, select the web app belonging to `tpc-student-register`, and copy its complete Firebase SDK configuration. Update `firebase-config.js` with those values, especially `apiKey` and `appId`. Do not use the web-app selector from the Console URL as the SDK `appId`. If the key has Google Cloud API restrictions, allow Firebase Authentication / Identity Toolkit and add the local or deployed site origins under HTTP referrers. Reload the sign-in page after updating the file.

## Deploy

Install the Firebase CLI if needed and authenticate with an account that has access to the project:

```powershell
npm install -g firebase-tools
firebase login
firebase projects:list
```

The `.firebaserc` file already selects `tpc-student-register` as the default project. Explicitly naming the project in deploy commands prevents deploying to a different Firebase project.

## Local testing

Serve the project over HTTP so the browser can load the ES modules:

```powershell
python -m http.server 8000
```

Open `http://localhost:8000/Login-page/login.html` to submit an access request or sign in. Test role invitations with a configured SMTP mailbox and a deployed Functions backend; set `APP_BASE_URL=http://localhost:8000` before deploying if invitation links should return to the local server. A working registration workflow requires the Console settings, Firestore rules, Functions secrets, and approved role described above.