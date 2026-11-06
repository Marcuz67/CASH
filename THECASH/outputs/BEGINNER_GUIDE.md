# Working on C.A.S.H.

Open the folder containing `package.json`, `server.js`, and `THECASH` in VS Code. Your extracted ZIP places this folder inside a second `CASH-main` folder.

## Run the app

Use Node.js 24. In a terminal at the project root:

```sh
npm install
npm start
```

Open http://localhost:3000/buyer or http://localhost:3000/admin. Use the Node server instead of opening HTML directly or using Live Server: both pages call the server's `/api/shop` endpoint.

## Edit the interface

- `THECASH/outputs/index.html` contains the workspace chooser, both layouts, and forms.
- `THECASH/outputs/styles.css` contains solid-color styles, dark-mode variables, and responsive layouts. No framework or external font service is required.
- `THECASH/outputs/app.js` loads data, draws screens, handles forms, and downloads PDF receipts. No account or Firebase code is required.

## Shared data

- `server.js` serves files and the shared shop API.
- `database.js` uses PostgreSQL on Render and local SQLite for development.
- `shared-store.test.js` checks shared records, concurrent updates, and persistence.

The frontend sends a new state with its current revision. The server rejects stale revisions to protect newer edits. The interface refreshes and asks you to review and retry. If a connection is lost before a save can be confirmed, reload before retrying, to avoid duplicate purchases.

Existing database records keep the same structure. Sales retain recorded prices and costs after product edits or removal. Settings and photos use the same shared database. Older browser-only records are not automatically imported.

## Deployment and checks

Use a Render Node Web Service with build command `npm ci && npm run build`, start command `npm start`, and `DATABASE_URL` set privately to the PostgreSQL Internal Database URL. See the root README for details.

Run `npm run build` and `npm test` before sharing a change. Both workspaces have no accounts, Admin is intentionally public, and recording a purchase does not collect an online payment.
