# Firebase setup

The app is already connected to the `tpc-student-register` Firebase project. Firebase Authentication stores sign-in accounts, and Firestore stores each user's students and attendance records.

## Deploy the app

1. Install the Firebase CLI if it is not installed:

   ```powershell
   npm install -g firebase-tools
   ```

2. From this project folder, sign in and deploy:

   ```powershell
   firebase login
   firebase deploy
   ```

3. Open the Hosting URL printed by the deploy command on any computer. Sign in with the same account to see the same register data.

## Firebase console checklist

- Authentication > Sign-in method > enable Email/Password.
- Firestore Database > create the database if it does not exist.
- Add the deployed Hosting domain to Authentication > Settings > Authorized domains if Firebase asks for it.

The Firestore rules in `firestore.rules` allow a signed-in user to access only documents under their own user ID.