# Firebase setup

The application is configured for the `tpc-student-register` Firebase project. Both the sign-in page and dashboard import their client configuration from `firebase-config.js`. Firebase Authentication handles accounts, and Cloud Firestore stores profiles, student records, attendance, and each user's excluded holiday dates.

## Firebase Console

In the Firebase Console, open the `tpc-student-register` project and verify the following:

1. **Web app:** Confirm the registered web app's SDK configuration matches `firebase-config.js`. The project ID must be `tpc-student-register` and the sender ID must be `189511938770`. Do not substitute the web-app selector from the Console URL for the SDK `appId`.
2. **Authentication:** Enable Email/Password under Authentication > Sign-in method.
3. **Authorized domains:** Add `localhost` for local testing and the project's `tpc-student-register.web.app` and `tpc-student-register.firebaseapp.com` Hosting domains if they are not already present. Add any custom Hosting domain used by the app.
4. **Firestore:** Create a Cloud Firestore database in Native mode if one does not already exist. The application stores documents under `users/{uid}` and that user's `students`, `attendance`, and `holidays` subcollections.
5. **API key restrictions:** If the web API key is restricted in Google Cloud, allow the Firebase APIs used by the app and add the local and deployed web origins as HTTP referrers.

The client Firebase configuration is visible to browsers by design. Access control is provided by Firebase Authentication and `firestore.rules`, which restrict each signed-in user to their own documents in the `students`, `attendance`, and `holidays` subcollections. Never put service-account credentials or other server secrets in this project.

## API key error

If sign-in reports `auth/api-key-not-valid`, open Project settings > General in the Firebase Console, select the web app belonging to `tpc-student-register`, and copy its complete Firebase SDK configuration. Update `firebase-config.js` with those values, especially `apiKey` and `appId`. Do not use the web-app selector from the Console URL as the SDK `appId`. If the key has Google Cloud API restrictions, allow Firebase Authentication / Identity Toolkit and add the local or deployed site origins under HTTP referrers. Reload the sign-in page after updating the file.

## Deploy

Install the Firebase CLI if needed, authenticate with an account that has access to the project, then deploy Hosting and the Firestore rules from this directory:

```powershell
npm install -g firebase-tools
firebase login
firebase projects:list
firebase deploy --only hosting,firestore:rules --project tpc-student-register
```

The `.firebaserc` file already selects `tpc-student-register` as the default project. The deploy command also names it explicitly to prevent deploying to a different Firebase project. The Hosting root redirects to the sign-in page, and the hosting URL is printed when deployment finishes.

## Local testing

Serve the project over HTTP so the browser can load the ES modules:

```powershell
python -m http.server 8000
```

Open `http://localhost:8000/Login-page/login.html`, create or sign in to an account, then try the register and attendance workflows. A successful account sign-in requires the Console settings above and an active Firestore database.