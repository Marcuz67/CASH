# C.A.S.H.

Central Accountant and Storage Helper uses plain HTML, CSS and browser JavaScript, with a Node.js server and a shared database.

## Links

- `/`: workspace chooser.
- `/buyer`: browse products and record a purchase. No account required.
- `/admin`: manage inventory, receive stock, view accounting reports and PDF receipts. No account required.

Both links use the same database. Admin is intentionally public: these pages are different views, not access controls. Purchases record a transaction and deduct stock; no online payment is collected. Buyer does not display administrative controls or other buyers' recent transactions.

## Run locally

Use Node.js 24. From the repository root:

```sh
npm install
npm start
```

Open http://localhost:3000/buyer or http://localhost:3000/admin. Without `DATABASE_URL`, local development uses SQLite at `data/cash.sqlite`. This folder is ignored by Git. The shared shop starts empty; add products in Admin. Older browser-only accounts and data are retained in browser storage but are not automatically imported.

## Deploy to Render

Use a Node **Web Service** with these settings:

| Setting | Value |
| --- | --- |
| Root Directory | Leave blank |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/health` |
| Environment variable | `DATABASE_URL`: your PostgreSQL connection URL |

Create or choose a Render PostgreSQL database in the same region/account as the Web Service. Copy its **Internal Database URL** into the Web Service's **Environment** as `DATABASE_URL`. Keep this URL in Render, not in browser JavaScript or Git. The root `render.yaml` also defines the service and prompts for `DATABASE_URL` when using a Blueprint. No database is provisioned automatically.

The server creates its `cash_shop` table on startup. Production/Render requires PostgreSQL; missing configuration or database failure prevents startup instead of falling back to temporary files. Firebase is not loaded or used by these account-free pages. Earlier Firebase files remain in the repository as legacy reference.

Render connection reference: https://render.com/docs/postgresql-creating-connecting

## Shared records

Both pages read and update `/api/shop`. Saves use a revision check so simultaneous pages cannot silently overwrite each other. When a change conflicts or fails, the page shows a reload prompt. Pages check for updates every five seconds while visible, except while an edit dialog or the profile editor is open. The database is authoritative; browser storage is a best-effort cache.

The state is kept as a single versioned database record. For larger stores, move products and transactions into separate tables with transaction-specific APIs. Current profit-by-product reports still estimate historical values using current product prices and costs. Gross profit excludes operating expenses and taxes.

## Files and checks

- `server.js`: HTTP routes and the shared shop API.
- `database.js`: PostgreSQL storage and local SQLite fallback.
- `THECASH/outputs/index.html`: both workspace layouts and chooser.
- `THECASH/outputs/app.js`: screen behavior and database synchronization.
- `THECASH/outputs/styles.css`: layouts, responsive styles and themes.

Run `npm run build` and `npm test`. Backend integration tests check both links, shared reads/writes, invalid updates, concurrent-write conflicts and persistence after restart using a disposable SQLite database. Separate DOM checks verified Admin product creation, an independent Buyer purchase, stock deduction, and reporting refresh. Live PostgreSQL and visual browser checks have not been performed in this session.
