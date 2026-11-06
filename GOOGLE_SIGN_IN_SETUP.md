# Enable Google accounts for C.A.S.H.

Google sign-in is temporarily paused. Buyer now uses Continue as guest with a separate browser cookie and the shared store inventory. Admin uses username/password login, with an optional isolated demo. No Google configuration is needed for these flows. To offer Google accounts later, complete this setup and enable GOOGLE_SIGN_IN_AVAILABLE in app.js; retain guest access as an alternative. Guest records are not automatically assigned to a later Google account.

The code supports separate Buyer and Seller/Admin sign-in screens. Both use Google Identity Services. No Firebase or Gmail inbox permissions are needed. The integration uses a Web client ID; it does not need an OAuth client secret.

## 1. Create a Google Web client ID

Open https://console.cloud.google.com/auth/clients and create or select a Google Cloud project.

In Google Auth Platform, configure Branding with your app name and support email. Set up the audience for your intended users. If the project is in Testing, add the buyer and seller Google accounts you plan to test with as test users. Use the standard email, profile, and OpenID identity scopes only.

Create a client with application type **Web application**. Under **Authorized JavaScript origins**, add:

```text
https://cash-rqu6.onrender.com
http://localhost
http://localhost:3000
http://localhost:4182
```

An origin must not include `/buyer` or `/admin`. This integration uses a JavaScript callback, so it does not need an application redirect URI. Copy the client ID ending in `.apps.googleusercontent.com`.

Official Google instructions: https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid

## 2. Configure the existing Render Web Service

On the CASH service, open **Environment** and set:

| Name | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Your Web application client ID |
| `ADMIN_EMAILS` | The approved Seller/Admin Google email; separate multiple emails with commas |
| `APP_ORIGIN` | `https://cash-rqu6.onrender.com` |
| `DATABASE_URL` | Keep your existing PostgreSQL Internal Database URL |

Use Gmail or verified Google Workspace accounts for Seller/Admin. Ordinary Google accounts can sign in as Buyers, but do not gain seller permission. Do not set every buyer email in `ADMIN_EMAILS`.

Save and redeploy after these values and the updated source are in place. Build command remains `npm ci && npm run build`; start command remains `npm start`.

## 3. Check both roles

- Open `https://cash-rqu6.onrender.com/buyer` and sign in as a buyer. Record a purchase and check My purchases.
- Open `https://cash-rqu6.onrender.com/admin` (or `/seller`) and sign in as an approved seller. Check Inventory and Accounting.
- A buyer account must not be able to load the seller's stock-editing API or enter Seller/Admin.
- Sign out and confirm that the private store view is cleared.

Both workspaces share one store. A Google account is identified by Google's stable subject ID. Buyer purchases are linked to that ID, not an email supplied by the browser. Earlier purchases without a buyer account stay in Accounting and are not automatically assigned to a user.

## Local development

Copy `.env.example` to `.env` and fill in your client ID and approved seller email. Keep `APP_ORIGIN=http://localhost:3000`. Run `npm install`, then `npm start`. For another local port, update the origin in `.env` and register that origin in Google Auth Platform.

Sessions last eight hours, use HttpOnly cookies, and are stored as hashed tokens in the existing database. Signing out revokes the session on the server. Removing an email from the seller list and restarting the service removes that account's seller access without deleting its buyer account.

Missing Google configuration leaves sign-in unavailable; it does not reopen anonymous access. Production sessions require HTTPS. No local password accounts or test-login bypasses are included in the application.
