# C.A.S.H. beginner guide

This note is a friendly map for learning how the app is put together. You can edit the files in VS Code without adding a build step.

## Open the project

1. In VS Code, choose **File → Open Folder…**.
2. Open the `THECASH` project folder. It contains `firebase.json`, `functions`, and `outputs`.
3. Open `outputs/index.html` to change the page structure, `outputs/styles.css` to change its appearance, or `outputs/app.js` to change what the app does.
4. Save with **Ctrl+S**, then reload the browser page to see the change.

## What each file does

- `outputs/index.html` holds the page sections, buttons, forms, and pop-up dialogs. The `id` on an element is its name in the JavaScript.
- `outputs/styles.css` controls colors, spacing, mobile layout, dark mode, and photo previews.
- `outputs/app.js` connects buttons to actions and draws the dashboard, inventory, rankings, profits, and profile from the saved shop data.
- `outputs/firebase-config.js` holds the public Firebase web settings. It is blank until you connect a Firebase project.
- `outputs/firebase-setup.js` starts Firebase when the settings are filled in. With blank settings, the app uses browser-only accounts.
- `functions/index.js` contains the server-side administrator actions for approving and deleting accounts.
- `functions/scripts/bootstrap-admin.js` creates the first administrator after a Firebase project is connected.
- `firestore.rules` and `storage.rules` decide which signed-in accounts may read or change cloud data.
- `.editorconfig` and `.prettierrc.json` keep indentation and formatting consistent.

## How a button changes the app

Most app actions follow this simple pattern:

1. A form or button in `index.html` has a unique `id`.
2. `app.js` listens for that button or form near the bottom of the file.
3. The event handler updates `state`, the JavaScript object that holds the current shop's products, profile, and sales.
4. `persist()` saves the updated data. `render()` refreshes the visible page from that data.

For example, to change the text on the Add item button, search `index.html` for `addProductTop`. To change the work it performs, search `app.js` for `addProductTop`.

## Safe places to make a first change

- Change a label or heading in `index.html`.
- Change a color in the theme variables near the top of `styles.css`.
- Change a category icon in the `iconFor` helper in `app.js`.
- Change the example products in the `starter` list near the top of `app.js`.

When adding a new data field, update the form, its save handler, and `normalizeState()` so older saved shops receive a default value too.

## Accounts and saved data

With Firebase settings blank, usernames and shop records stay in this browser. Local account passwords are saved as salted hashes; the app does not save the plain password. A local username such as `student1` works in this mode.

The local password minimum is four characters for a class demo. Four-character passwords are easy to guess, so use a longer password and a real Firebase project before storing real shop records. Firebase sign-in uses an email address and the app currently asks for at least eight characters. New Firebase accounts wait for administrator approval.

Browser-only accounts are tied to the browser and page origin where they were created. They do not automatically move to another computer or into Firebase.

## Format the files

The project includes `.prettierrc.json` for consistent formatting. If you install the Prettier extension in VS Code, right-click a file and choose **Format Document**. Formatting changes indentation and line breaks; it does not add a new app dependency.

## Ideas for a fuller store system

The app currently tracks products, stock counts, recorded sales, gross profit, and receipt PDFs. Common next additions include suppliers, purchase orders, stock receiving and adjustment history, expiry dates, barcode scanning, returns, discounts, taxes, staff access, and backups. Add one feature at a time and decide how its records should be saved before building its screen.
