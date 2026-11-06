# C.A.S.H.

Central Accountant and Storage Helper uses plain HTML, CSS and JavaScript, a Node.js server, and a shared store database.

## Access

- `/`: home page linking to two separate entry pages.
- `/buyer`: username/password login, with **Create an account** below the form. **Continue as guest** remains optional. Purchases use shared inventory and respect the Admin's availability and quantity limits.
- `/admin`: a separate username/password Admin login and first-time account setup. `/seller` is an alias.

Admin edits and reports require an authenticated Admin session. Guest buyers cannot edit inventory or read store accounting. Google sign-in remains paused.

## Buyer accounts

Open /buyer and choose Create an account below the login form. Enter your name, a unique username, and a password of at least 12 characters. Registration signs you in as a Buyer; it never grants Admin access. Later, use the username and password to log in on any device and view your account receipts.

Accounts are saved in PostgreSQL on Render and SQLite during local development. Passwords are stored as salted scrypt hashes. Local accounts do not automatically appear on Render. Buyer and Admin sessions are separate, even in the same browser. Guest purchases are not automatically transferred to a Buyer account. The current interface does not include password reset.

## Guest receipts

Guest access uses its own HttpOnly cookie, separate from Admin login. Purchases are linked to the browser's guest identity on the server. My purchases shows only that guest's receipts. Returning on the same browser restores access; clearing cookies or waiting beyond the 30-day guest session loses receipt access. The records remain in Admin accounting.

The Back to Buyer access button returns to the login screen while preserving the browser's guest identity. Choose Continue as guest to restore guest receipts. It does not erase receipts or sign out an Admin using another tab. Recording a purchase deducts stock and records a sale; no online payment is collected.

## Admin account

See ADMIN_ACCOUNT_SETUP.md. On localhost, open /admin and fill in Create Admin account. Choose your credentials privately. The password must have at least 12 characters and is stored as a salted scrypt hash. No default account or password is included.

Render first-time setup requires the owner's private ADMIN_SETUP_TOKEN. Setup closes after the first account is created. Remove the setup key afterward. Accounts made in local SQLite do not automatically exist in live PostgreSQL.

## Run locally

Use Node.js 24. From the project root:

```sh
npm install
npm start
```

Open http://localhost:3000/buyer or http://localhost:3000/admin. The current preview may use port 4182. Without DATABASE_URL, development uses SQLite at data/cash.sqlite. Google configuration is not required for Buyer accounts, Guest access, or Admin password login.

An empty, unused shop receives eight starter products once. Their prices and quantities are samples; review them in Admin. Existing products and recorded sales are preserved.

## Render

Use a Node Web Service with:

| Setting | Value |
| --- | --- |
| Root Directory | Leave blank |
| Build Command | npm ci && npm run build |
| Start Command | npm start |
| Health Check Path | /health |
| DATABASE_URL | PostgreSQL Internal Database URL |
| APP_ORIGIN | https://cash-rqu6.onrender.com |
| ADMIN_SETUP_TOKEN | Private random key of at least 32 characters, for first setup only |

The Web Service and database must share an account and region. Keep database credentials and setup keys in Render Environment, not Git or browser code. Production requires PostgreSQL and will not fall back to temporary files.

Render connection reference: https://render.com/docs/postgresql-creating-connecting

## Selling controls

Admin can offer or pause products, receive stock, set prices/costs, and choose maximum units per purchase. A paused product stays in inventory but disappears from the buyer catalog. Limits apply per purchase, not per person or per day.

The server checks availability, stock, quantity limits, prices and concurrent updates. Reports use the price and cost saved with each sale; removing or editing a product does not rewrite its sales. Gross profit excludes operating expenses and taxes.

## Optional Admin demo

Admin's Try demo mode option is still an isolated browser-only sample store. It does not authenticate to or change the shared database. Buyer accounts and optional Guest access use the real shared store.

## Project files

- THECASH/outputs/index.html: home only.
- THECASH/outputs/buyer.html: Buyer login, account setup, optional Guest entry, and buyer workspace.
- THECASH/outputs/admin.html: Admin login, setup, and store workspace.
- THECASH/outputs/app.js and styles.css: shared behavior and solid-color styling.
- server.js and database.js: HTTP routes and database storage.
- auth.js: opaque account and guest sessions; future Google sign-in support.
- local-admin.js: first-time setup, password hashing and login limits.
- local-buyer.js: Buyer registration, password login, and login limits.
- catalog.js: starter items and purchase validation.

No Firebase files or local test-login bypasses are included. For future Google account activation, see GOOGLE_SIGN_IN_SETUP.md.

## Product images

The eight starter products use generated, unbranded photos bundled in THECASH/outputs/assets/products. IMAGE_PROMPTS.md records the built-in imagegen prompts. Existing uploaded photos are preserved; Seller can replace or remove them through Edit product.

## Checks

Run npm run build and npm test. Automated checks cover account creation, session persistence, first-setup races, login limits, Google identity verification, Guest/Admin separation, private receipt ownership, stock limits, concurrency, product photos, and separate entry pages. UI checks use disposable databases. Live PostgreSQL and visual browser checks remain separate deployment verification steps.
