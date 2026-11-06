# Create your Admin account

Admin now supports a username and password independently of Google. There is no default account or default password. The account is created only when you submit the setup form yourself.

## Local computer

Start the app and open http://localhost:3000/admin (or the current preview at http://localhost:4182/admin). If no Admin account exists, the page opens **Create Admin account** automatically.

Enter your display name, a username, a password of at least 12 characters, and the confirmation. Submit **Create Admin account**. The account is saved in your local SQLite database and you are signed in. On later visits, use the username/password form.

Local setup without a key is permitted only for a loopback connection, with a localhost host, outside production. It is not enabled for other computers on your network.

## Live Render website

Local and Render databases are separate. An account created on your computer does not automatically create an account on Render.

1. Deploy the updated source to the CASH Web Service.
2. In the service's **Environment**, keep the existing `DATABASE_URL` and set `APP_ORIGIN=https://cash-rqu6.onrender.com`.
3. Generate a private random setup key on your own computer:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

4. Set `ADMIN_SETUP_TOKEN` to that key in Render's Environment. Keep it private; do not put it in Git, a URL, or chat.
5. Save/redeploy and open https://cash-rqu6.onrender.com/admin. Choose your username and password in the setup form and enter the private setup key.
6. After creating the account, remove `ADMIN_SETUP_TOKEN` from Render. Setup is also blocked automatically once the first Admin exists, even if the key remains configured.

Render sessions use Secure, HttpOnly cookies. The password is stored as a salted scrypt hash; it is not stored in plaintext or browser storage. Login limits and the Admin account are stored in PostgreSQL and survive deploys. The single-account insert prevents two concurrent setup requests from creating different administrators.

Buyer uses account-free Guest access to the shared catalog and stock, with receipts tied to a browser cookie. The optional Admin demo is a separate browser-only sample store; it does not authenticate to the real database or create a real account.

The current UI does not include password reset or additional local Admin account creation. Do not share your password. Google authentication remains prepared for later activation.
