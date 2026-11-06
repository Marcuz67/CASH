# C.A.S.H.

**Central Accountant and Storage Helper** is a small-store inventory and sales tracker.

## Project map

- `outputs/index.html` contains the sign-in screen, app layout, dialogs, and photo controls.
- `outputs/styles.css` contains the light and dark themes and responsive layout.
- `outputs/app.js` contains inventory, sales, profit, local sign-in, and Firebase account behavior.
- `outputs/firebase-config.js` holds the public web app settings copied from Firebase Console.
- `outputs/firebase-setup.js` loads Firebase only after those settings are filled in.
- `firestore.rules` and `storage.rules` protect shop data and uploaded photos.
- `functions/index.js` contains the administrator approval and account deletion functions.
- `functions/scripts/bootstrap-admin.js` creates the first administrator using server credentials.
- `firebase.json` connects the app and backend files for deployment.
- `outputs/BEGINNER_GUIDE.md` explains the file map and common places to make a first change.
- `.editorconfig` and `.prettierrc.json` keep code formatting consistent.

Keep the web files together in `outputs`. Open the parent project folder in VS Code when working with Firebase so the rules and `functions` folder stay beside `firebase.json`.

## Photos

Profile pictures and product pictures use the same square image preparation: choose an image, check the preview, then save it. The profile has its own **Save photo** button; product photos are saved with the product. The app center-crops each photo to a small square and compresses it before saving. With Firebase configured, profile and product photos go to the signed-in owner's Storage folder.

## Firebase setup

Firebase is optional in the current files. With the fields in `outputs/firebase-config.js` blank, the app keeps using browser-only accounts and records. The Firebase backend code is prepared, but no live project is linked yet. Firebase mode needs a project created under your Google account and its web app settings added to the config file.

**Billing:** the requested Cloud Functions admin approval and Cloud Storage photo uploads require Firebase's pay-as-you-go Blaze plan. No-cost usage may apply, but charges can depend on storage location and usage. The current app remains in local mode until Firebase is configured; do not upgrade a project until you are ready to attach billing. See Firebase's [Cloud Functions pricing requirements](https://firebase.google.com/docs/functions/quotas-pricing) and [Storage billing requirements](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024).

1. In the [Firebase Console](https://console.firebase.google.com/), create a project and register a **Web app**. Copy its web settings into `outputs/firebase-config.js`.
2. Enable **Email/Password** in Authentication, create a Cloud Firestore database, and enable Cloud Storage.
3. Install the Firebase CLI, sign in, and select your project from this project folder:

   ```powershell
   npm install -g firebase-tools
   firebase login
   firebase use --add
   ```

4. Install the backend packages:

   ```powershell
   cd functions
   npm install
   cd ..
   ```

5. Create the first administrator from a trusted computer. Make a service account credential available through `GOOGLE_APPLICATION_CREDENTIALS`, then set `FIREBASE_PROJECT_ID`, `CASH_ADMIN_EMAIL`, `CASH_ADMIN_PASSWORD`, and optionally `CASH_ADMIN_NAME` in your PowerShell session. From the `functions` folder, run `npm run bootstrap-admin`. The password and service account key are never stored in the web files.
6. Deploy the rules, functions, and website:

   ```powershell
   firebase deploy --only firestore:rules,storage,functions,hosting
   ```

Cloud Functions deployment requires the Firebase project to use the [Blaze plan](https://firebase.google.com/docs/functions/quotas-pricing), and Storage also requires Blaze. Firebase's [web setup guide](https://firebase.google.com/docs/web/setup) explains how to register the web app and copy its config.

New Firebase sign-ups remain pending until an administrator approves them. The Admin tab appears only for the administrator created by the bootstrap script; it can approve requests and delete non-admin profiles. Authorization is enforced by server functions and Firebase rules, not by hiding buttons in the page. The Firebase web config is public; never place service account credentials or administrator passwords in it.

The Firebase version should be opened through `http://localhost` or Firebase Hosting rather than `file://`. Browser-only mode continues to work with the Firebase config left blank.

## Sign-in and saved data

With Firebase disabled, account records and inventory stay in the current browser. With Firebase enabled, approved accounts sync shop state across devices. Existing browser-only data is not automatically copied to Firebase.

Local passwords now need at least four characters so a class demo can use a short password. Firebase account creation and sign-in still require at least eight characters and use an email address.

## Sales and receipts

New sale records keep the date, item, quantity, unit price, unit cost, revenue, and gross profit. Older records may estimate receipt amounts from the item's current price and cost.

- **Latest sale this month** downloads a PDF receipt for the newest sale recorded this month.
- The date fields and **Download range PDF** export all recorded sales in the selected date range.

## Footnote: future store features to consider

- Supplier records and purchase orders.
- Stock receiving and adjustment history.
- Batch numbers and expiry alerts.
- Barcode scanning, variants, discounts, taxes, returns, and refunds.
- Scheduled backups and staff permissions.

## Open in VS Code

1. Choose **File → Open Folder…**.
2. Select the project folder that contains `firebase.json` and `outputs`.
3. Edit the web page in `outputs/index.html`, its appearance in `outputs/styles.css`, and its behavior in `outputs/app.js`.
