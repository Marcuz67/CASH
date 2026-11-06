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
- `THECASH/outputs/app.js` loads data, draws screens, handles forms, and downloads PDF receipts. Google sign-in is handled by auth.js on the server; no Firebase code is required.

## Shared data

- `server.js` serves files and the shared shop API.
- `database.js` uses PostgreSQL on Render and local SQLite for development.
- `shared-store.test.js` checks shared records, concurrent updates, and persistence.

The frontend sends a new state with its current revision. The server rejects stale revisions to protect newer edits. The interface refreshes and asks you to review and retry. If a connection is lost before a save can be confirmed, reload before retrying, to avoid duplicate purchases.

Existing database records keep the same structure. Sales retain recorded prices and costs after product edits or removal. Settings and photos use the same shared database. Older browser-only records are not automatically imported.

## Deployment and checks

Use a Render Node Web Service with build command `npm ci && npm run build`, start command `npm start`, and `DATABASE_URL` set privately to the PostgreSQL Internal Database URL. See the root README for details.

Run `npm run build` and `npm test` before sharing a change. Both workspaces require Google sign-in. Seller/Admin needs an approved email, and recording a purchase does not collect an online payment.

## Offer items for sale

In Admin, open Inventory and choose Edit. Set Buyer availability and Maximum units per purchase. Use Pause sale to remove an item from the buyer page while retaining inventory. Use Offer for sale to restore it. Receive adds delivered units; it does not change the selling limit. The server checks the limit and current stock for every purchase.

The catalog.js file creates starter products only for an empty, unused shop and validates purchases. The auth.js module protects the editing API and verifies Google identities. Setup is described in GOOGLE_SIGN_IN_SETUP.md at the project root.

Before running, copy .env.example to .env and configure your Google client ID and seller email. The default local origin is http://localhost:3000. Use GOOGLE_CLIENT_ID, ADMIN_EMAILS, and APP_ORIGIN in Render.

## Demo preview

Google sign-in is currently paused. Click Try demo mode below the unavailable message on Buyer or Seller/Admin. The demo uses separate browser data and does not call live store APIs. Use Reset demo to restore sample items, or Exit demo to return to the access screen. Google setup is only required when the Google integration is enabled later.
