# C.A.S.H.

Central Accountant and Storage Helper, using plain HTML, CSS and JavaScript.

## Preview

From this repository folder, run:

```sh
npm install
npm start
```

Open http://localhost:3000. The source files are `THECASH/outputs/index.html`, `app.js`, and `styles.css`.

Sales records customer purchases. Inventory manages products and stock receiving. Accounting contains reports and PDF receipts. Dashboard provides the overview.

## Render

Deploy as a Render **Web Service**, using the root `render.yaml` or these manual settings:

- Runtime: Node.
- Root Directory: leave blank.
- Build Command: `npm ci && npm run build`.
- Start Command: `npm start`.
- Health Check Path: `/health`.

Push the updated repository before deploying. The plain JavaScript server serves the HTML, CSS and JavaScript on Render's `PORT` at `0.0.0.0`. Run `npm install` and `npm start` from the repository root to preview at http://localhost:3000.

The server hosts the website; accounts and shop records still use browser storage unless optional Firebase is configured. A Web Service alone does not add a shared database. Firebase backend services need their separate setup.

Checks performed: JavaScript syntax, Git whitespace validation, and DOM integration checks for screen visibility, sales, stock receiving, receipt history, search, invalid quantities, failed saves, and reload persistence. Live Firebase and visual browser checks were not performed.
