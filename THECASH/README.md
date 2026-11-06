# C.A.S.H.

## Current preview: demo mode

Google account sign-in is temporarily paused. Buyer and Seller/Admin access screens display "Google Play not available yet" with a **Try demo mode** button below it. Click this to explore the store without an account or Google client ID.

The demo uses eight sample products in a separate browser-only store. Seller demo can edit inventory and limits; Buyer demo can make sample purchases and download demo-marked receipts. Both views on the same browser/origin share this demo data. Demo actions never call live inventory or purchase APIs and do not modify the live database. Reset demo restores the sample items. If browser storage is unavailable, demo changes last only in that tab.

Real shop APIs remain protected by Google account sessions. The Google integration below is prepared for later activation; set GOOGLE_SIGN_IN_AVAILABLE to true in app.js only after configuring it. Demo mode is not a way to authenticate to the real database.

Central Accountant and Storage Helper uses plain HTML, CSS and browser JavaScript, with a Node.js server and a shared database.

## Links

- `/`: workspace chooser.
- `/buyer`: sign in with Google, browse products, record purchases, and view your own receipts.
- `/admin`: sign in with an approved Seller/Admin Google account to manage inventory, stock, accounting reports, and PDF receipts.

Both links use the same database. Both require Google sign-in, and Seller/Admin APIs require an approved Google email. Ordinary Buyer accounts cannot edit stock or read seller reports. Purchases record a transaction and deduct stock; no online payment is collected. Buyer does not display administrative controls or other buyers' recent transactions.

## Run locally

Use Node.js 24. First copy .env.example to .env and fill in your Google Web client ID and approved seller email. Then, from the repository root:

```sh
npm install
npm start
```

Open http://localhost:3000/buyer or http://localhost:3000/admin. Without `DATABASE_URL`, local development uses SQLite at `data/cash.sqlite`. This folder is ignored by Git. An empty, unused shop receives eight starter products once. Their prices and quantities are samples; review them in Admin before using the store. Existing stocked shops and recorded sales are preserved. Older browser-only accounts and data are retained in browser storage but are not automatically imported.

## Deploy to Render

Use a Node **Web Service** with these settings:

| Setting | Value |
| --- | --- |
| Root Directory | Leave blank |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/health` |
| Environment variable | `DATABASE_URL`: your PostgreSQL connection URL |

Create or choose a Render PostgreSQL database in the same region/account as the Web Service. Copy its **Internal Database URL** into the Web Service's **Environment** as `DATABASE_URL`. Keep this URL in Render, not in browser JavaScript or Git. The root `render.yaml` defines the service and prompts for its configuration when using a Blueprint. Also set GOOGLE_CLIENT_ID, ADMIN_EMAILS, and APP_ORIGIN as described in GOOGLE_SIGN_IN_SETUP.md. No database is provisioned automatically.

The server creates its `cash_shop` table on startup. Production/Render requires PostgreSQL; missing configuration or database failure prevents startup instead of falling back to temporary files. Firebase is not required. Its unused configuration, Cloud Functions, rules, and client setup files have been removed.

Render connection reference: https://render.com/docs/postgresql-creating-connecting

## Shared records

Admin reads and updates `/api/shop`. Buyer reads `/api/catalog` and submits purchases to `/api/sales`. Saves use a revision check so simultaneous pages cannot silently overwrite each other. When a change conflicts or fails, the page shows a reload prompt. Pages check for updates every five seconds while visible, except while an edit dialog or the profile editor is open. The database is authoritative; browser storage is a best-effort cache.

The state is kept as a single versioned database record. For larger stores, move products and transactions into separate tables with transaction-specific APIs. Reports use the prices and costs saved with each sale, so editing or removing a product does not change recorded amounts. Older records without saved amounts are labeled as estimates. Gross profit excludes operating expenses and taxes.

## Files and checks

- `server.js`: HTTP routes and the shared shop API.
- `database.js`: PostgreSQL storage and local SQLite fallback.
- `THECASH/outputs/index.html`: both workspace layouts and chooser.
- `THECASH/outputs/app.js`: screen behavior and database synchronization.
- `THECASH/outputs/styles.css`: solid colors, responsive layouts and light/dark themes.

The interface has been rebuilt in plain HTML, CSS and JavaScript. It uses Google account sign-in without local passwords, demo accounts, Firebase behavior, external fonts, or layered theme overrides.

Run `npm run build` and `npm test`. Backend integration tests check both links, shared reads/writes, invalid updates, concurrent-write conflicts and persistence after restart using a disposable SQLite database. DOM checks also verified independent Admin/Buyer sessions, purchases, stock receiving, historical amounts after product changes/removal, PDF receipts, conflict recovery, settings, and network failures. Live PostgreSQL and visual browser checks have not been performed in this session.

## Selling controls

Admin Inventory can offer or pause each product, change stock and price, and set a maximum quantity per purchase (default 5 for existing products). Paused products stay in Inventory but disappear from the buyer catalog. Purchases cannot exceed either the admin limit or remaining stock. Limits apply to each purchase, not a daily total or an identified customer.

The purchase API calculates prices, costs, and stock deductions on the server and rejects paused products, excess quantities, fractional quantities, and stale updates. Buyer catalog responses omit cost/profit and transaction-history fields. Admin editing APIs require a server-verified Seller/Admin session. Buyers receive only their own purchase records; receipt ownership is determined by the signed-in Google subject ID.

Starter catalog installation is marked in the database and does not repeat when all products are later removed. Sample sales are never inserted. Admin can mark the sample catalog reviewed after checking its stock and prices.

## Google sign-in

Follow GOOGLE_SIGN_IN_SETUP.md to create your Google Web client ID for https://cash-rqu6.onrender.com. Set GOOGLE_CLIENT_ID, a comma-separated ADMIN_EMAILS list, and APP_ORIGIN in Render. No OAuth client secret or Gmail inbox access is needed. Any verified Google account can become a Buyer. Only approved Gmail or Google Workspace accounts receive Seller/Admin access.

Google identities and opaque sessions are stored in separate tables in the same database. Cookies are HttpOnly and Secure on Render; sessions expire after eight hours and are revoked on sign-out. API writes check the website origin. The sign-in request uses a single-use nonce; Google ID tokens are verified on the server using Google's authentication library. No login tokens are kept in browser localStorage. Missing configuration does not reopen anonymous access.

A buyer can download their receipts from My purchases. Historical transactions without a buyer ID remain in seller accounting and are not assigned to arbitrary buyer accounts.

Authentication tests cover buyer/seller separation, private purchase ownership, revoked and expired sessions, invalid credentials, nonce replay, cross-site requests, and missing configuration. DOM checks mock the Google credential exchange; a real Google popup and live PostgreSQL still need verification once the client ID and approved seller emails are configured.

## Product photos

The eight starter/demo items use locally bundled generated catalog photos in THECASH/outputs/assets/products. The photos are generic and unbranded; they do not depict a specific supplier's goods. IMAGE_PROMPTS.md in that folder records the built-in imagegen prompts. Existing uploaded photos are preserved. Existing demo data receives missing images once without resetting stock or sales. Seller can replace or remove a photo through Edit product.
