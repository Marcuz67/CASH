/*
 * C.A.S.H. browser app
 * Read from top to bottom: starting data, saved data, sign-in, screen rendering,
 * photo tools, sales tools, form events, and finally app startup.
 */

/* Account and local data settings */
// These names are the keys used to find saved accounts and shop data in this browser.
const LEGACY_DATA_KEY = 'stocksy-shop-v1';
const ACCOUNTS_KEY = 'cash-accounts-v1';
const ACTIVE_ACCOUNT_KEY = 'cash-active-account-v1';
let activeShopDataKey = null;
let currentAccount = null;
// The shop currently shown on screen. Form actions update this object before saving it.
let state = null;
let remoteUser = null;
let remoteSignupBusy = false;
let remoteAuthMessage = '';
let remoteSavePromise = Promise.resolve(true);
const accounts = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]');
    return Array.isArray(saved)
      ? saved.filter(
          (account) => account && account.usernameKey && account.salt && account.passwordHash
        )
      : [];
  } catch {
    return [];
  }
})();
/* 1. Demo shop data used on first launch and when creating a new account. */
const starter = [
  {
    id: 'p1',
    name: 'Classic Milk 1L',
    category: 'Drinks',
    stock: 18,
    price: 89,
    cost: 68,
    sold: 48,
    threshold: 8,
    emoji: '🥛',
  },
  {
    id: 'p2',
    name: 'Golden Banana',
    category: 'Produce',
    stock: 24,
    price: 12,
    cost: 7,
    sold: 41,
    threshold: 10,
    emoji: '🍌',
  },
  {
    id: 'p3',
    name: 'Sea Salt Chips',
    category: 'Snacks',
    stock: 7,
    price: 45,
    cost: 29,
    sold: 35,
    threshold: 8,
    emoji: '🥔',
  },
  {
    id: 'p4',
    name: 'Garden Eggs',
    category: 'Produce',
    stock: 3,
    price: 10,
    cost: 6,
    sold: 29,
    threshold: 6,
    emoji: '🥚',
  },
  {
    id: 'p5',
    name: 'Pandesal Pack',
    category: 'Pantry',
    stock: 14,
    price: 35,
    cost: 22,
    sold: 24,
    threshold: 6,
    emoji: '🥖',
  },
  {
    id: 'p6',
    name: 'Sparkling Water',
    category: 'Drinks',
    stock: 1,
    price: 38,
    cost: 22,
    sold: 19,
    threshold: 5,
    emoji: '🫧',
  },
  {
    id: 'p7',
    name: 'Cocoa Biscuits',
    category: 'Snacks',
    stock: 32,
    price: 28,
    cost: 17,
    sold: 16,
    threshold: 8,
    emoji: '🍪',
  },
  {
    id: 'p8',
    name: 'Dish Soap',
    category: 'Household',
    stock: 0,
    price: 72,
    cost: 48,
    sold: 8,
    threshold: 4,
    emoji: '🧼',
  },
  {
    id: 'p9',
    name: 'Rice 1kg',
    category: 'Pantry',
    stock: 41,
    price: 58,
    cost: 45,
    sold: 7,
    threshold: 10,
    emoji: '🍚',
  },
  {
    id: 'p10',
    name: 'Coconut Candy',
    category: 'Snacks',
    stock: 19,
    price: 22,
    cost: 13,
    sold: 2,
    threshold: 5,
    emoji: '🥥',
  },
  {
    id: 'p11',
    name: 'Mint Toothpaste',
    category: 'Household',
    stock: 10,
    price: 65,
    cost: 42,
    sold: 1,
    threshold: 4,
    emoji: '🪥',
  },
  {
    id: 'p12',
    name: 'Tamarind Soup Mix',
    category: 'Pantry',
    stock: 12,
    price: 18,
    cost: 10,
    sold: 0,
    threshold: 4,
    emoji: '🍲',
  },
];
const defaults = {
  products: starter,
  activity: [],
  demo: true,
  weekByDay: [1800, 2200, 1650, 3050, 2700, 3900, 3120],
  weekProfitByDay: [1200, 1950, 2300, 900, 2800, 3400, 1800],
  weekUnits: 136,
  profile: { owner: 'Alex Morgan', store: 'Sunny Side Market', location: '' },
  profitGoals: { redBelow: 2000, goodFrom: 3000 },
  lastProfitCheck: null,
};
/* 2. Keep older saved shop data compatible with newer fields. */
function normalizeState(saved) {
  const data = saved && Array.isArray(saved.products) ? saved : structuredClone(defaults);
  data.activity ||= [];
  data.weekByDay ||= [0, 0, 0, 0, 0, 0, 0];
  data.weekProfitByDay ||= data.weekByDay.map((value) => Math.round(value * 0.25));
  data.weekUnits ??= 0;
  delete data.xp;
  data.profile = { owner: 'Shop owner', store: 'Your shop', location: '', ...(data.profile || {}) };
  data.profitGoals = {
    redBelow: Number(data.profitGoals?.redBelow ?? 2000),
    goodFrom: Number(data.profitGoals?.goodFrom ?? 3000),
  };
  data.lastProfitCheck ||= null;
  data.products.forEach((product) => {
    product.cost ??= Number((product.price * 0.7).toFixed(2));
  });
  data.lifetimeGrossProfit ??= data.products.reduce(
    (sum, product) =>
      sum + (Number(product.price || 0) - Number(product.cost || 0)) * Number(product.sold || 0),
    0
  );
  return data;
}
async function persistRemoteState() {
  const client = window.CASH_FIREBASE;
  if (!client || !remoteUser || !state) return true;
  try {
    await client.db
      .collection('shops')
      .doc(remoteUser.uid)
      .set(
        {
          state: JSON.parse(JSON.stringify(state)),
          updatedAt: client.firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    return true;
  } catch (error) {
    console.error('Cloud save failed', error);
    toast('Your changes could not sync to Firebase. Check your connection.');
    return false;
  }
}
// Save the current shop in this browser and, when configured, sync it to Firebase.
const persist = () => {
  if (!activeShopDataKey || !state) return false;
  let localSaved = false;
  try {
    localStorage.setItem(activeShopDataKey, JSON.stringify(state));
    localSaved = true;
  } catch {}
  if (remoteUser) {
    remoteSavePromise = persistRemoteState();
    return true;
  }
  return localSaved;
};
/* 3. Small helpers used by the screen renderers below. */
const iconFor = (c) =>
  ({ Produce: '🍊', Drinks: '🥤', Snacks: '🍪', Pantry: '🛍️', Household: '🧼', Other: '📦' })[c] ||
  '📦';
const productVisual = (product, className) =>
  product.photo
    ? `<img class="${className} product-photo" src="${escapeHtml(product.photo)}" alt="">`
    : `<span class="${className}">${product.emoji || iconFor(product.category)}</span>`;
const money = (n) => '₱' + Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 });
const byId = (id) => state.products.find((p) => p.id === id);
const stockState = (p) =>
  p.stock === 0
    ? ['Out of stock', 'stock-out']
    : p.stock <= p.threshold
      ? ['Low stock', 'stock-low']
      : ['In stock', 'stock-ok'];
const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
const el = (id) => document.getElementById(id);
/* 4. Local sign-in and optional Firebase sign-in. */
let authMode = 'login';
function accountDataKey(usernameKey) {
  return `${LEGACY_DATA_KEY}:account:${encodeURIComponent(usernameKey)}`;
}
function saveAccounts() {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}
function renderAuthMode() {
  const creating = authMode === 'create';
  const online = Boolean(window.CASH_FIREBASE);
  el('authNameField').hidden = !creating;
  el('authName').required = creating;
  el('authConfirmField').hidden = !creating;
  el('authConfirmPassword').required = creating;
  el('authConfirmPassword').minLength = online ? 8 : 4;
  el('authTitle').textContent = creating ? 'Create your account' : 'Welcome back';
  el('authIntro').textContent = creating
    ? online
      ? 'Request an online shop account. An admin must approve it.'
      : 'Set up a local account for your shop.'
    : 'Sign in to open your shop dashboard.';
  el('authSubmit').textContent = creating ? 'Create account' : 'Log in';
  el('authModeToggle').textContent = creating
    ? 'Already have an account? Log in'
    : 'Create an account';
  el('authPassword').autocomplete = creating ? 'new-password' : 'current-password';
  el('authPassword').minLength = online ? 8 : 4;
  el('authPassword').placeholder = online ? 'At least 8 characters' : 'At least 4 characters';
  el('authUsernameLabel').textContent = online ? 'Email address' : 'Username';
  el('authUsername').type = online ? 'email' : 'text';
  el('authUsername').autocomplete = online ? 'email' : 'username';
  el('authUsername').placeholder = online ? 'you@example.com' : 'Your username';
  el('authUsername').minLength = online ? 0 : 3;
  el('authUsername').maxLength = online ? 254 : 32;
  el('authLocalNote').textContent = online
    ? 'Online accounts and shop records are connected to Firebase. New accounts need admin approval.'
    : 'This school project saves accounts and shop records only in this browser. It does not use an online server.';
  el('authMessage').textContent = '';
  el('authMessage').classList.remove('is-error', 'is-info');
}
function showLoginScreen(message = '') {
  el('app').hidden = true;
  el('authScreen').hidden = false;
  authMode = 'login';
  renderAuthMode();
  if (message) {
    el('authMessage').textContent = message;
    el('authMessage').classList.add('is-info');
  }
}
function startAccountSession(account, importLegacy = false, remoteState) {
  currentAccount = account;
  profilePhotoDraft = null;
  profilePhotoRemoved = false;
  activeShopDataKey = accountDataKey(account.usernameKey);
  let saved = null;
  try {
    if (arguments.length >= 3) saved = remoteState;
    else {
      const serialized =
        localStorage.getItem(activeShopDataKey) ||
        (importLegacy ? localStorage.getItem(LEGACY_DATA_KEY) : null);
      saved = serialized ? JSON.parse(serialized) : null;
    }
  } catch {
    saved = null;
  }
  state = normalizeState(saved);
  if (!saved || importLegacy) state.profile.owner = account.displayName || state.profile.owner;
  localStorage.setItem(ACTIVE_ACCOUNT_KEY, account.usernameKey);
  document.body.dataset.view = 'overview';
  document
    .querySelectorAll('button[data-view]')
    .forEach((button) => button.classList.toggle('active', button.dataset.view === 'overview'));
  el('crumbText').textContent = 'Dashboard';
  el('pageTitle').textContent = 'Dashboard';
  el('pageSub').textContent = 'Here’s what’s happening with your store today.';
  el('activeAccountName').textContent = account.username;
  el('authScreen').hidden = true;
  el('app').hidden = false;
  render();
  if (remoteUser) remoteSavePromise = persistRemoteState();
  openProfitCheck();
}
function bytesToHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}
async function hashPassword(password, saltHex) {
  if (!window.crypto?.subtle)
    throw new Error(
      'Secure sign-in is unavailable in this browser. Open the app in a recent browser.'
    );
  const salt = Uint8Array.from(saltHex.match(/.{2}/g) || [], (byte) => parseInt(byte, 16));
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const hash = await window.crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(hash));
}
function createSalt() {
  return bytesToHex(window.crypto.getRandomValues(new Uint8Array(16)));
}
function firebaseErrorMessage(error) {
  const messages = {
    'auth/email-already-in-use': 'That email already has an account. Try logging in.',
    'auth/invalid-credential': 'The email or password is incorrect.',
    'auth/user-not-found': 'No account uses that email yet.',
    'auth/wrong-password': 'The email or password is incorrect.',
    'auth/weak-password': 'Choose a stronger password with at least 8 characters.',
    'auth/too-many-requests': 'Too many attempts. Wait a little and try again.',
    'permission-denied': 'Firebase rules blocked this action. Check the project setup.',
    'functions/permission-denied': 'Only the administrator can do that.',
  };
  return messages[error.code] || error.message || 'Firebase could not complete that action.';
}
async function submitFirebaseAuthentication({ creating, displayName, email, password }) {
  const client = window.CASH_FIREBASE;
  if (creating) {
    remoteSignupBusy = true;
    let createdUser = null;
    try {
      const credential = await client.auth.createUserWithEmailAndPassword(email, password);
      createdUser = credential.user;
      await client.db.collection('users').doc(createdUser.uid).set({
        email,
        displayName,
        status: 'pending',
        role: 'user',
        createdAt: client.firebase.firestore.FieldValue.serverTimestamp(),
      });
      remoteAuthMessage =
        'Request sent. An administrator must approve your account before you can sign in.';
      await client.auth.signOut();
      showLoginScreen(remoteAuthMessage);
    } catch (error) {
      if (createdUser) {
        await createdUser.delete().catch(() => {});
        await client.auth.signOut().catch(() => {});
      }
      throw error;
    } finally {
      remoteSignupBusy = false;
    }
    return;
  }
  await client.auth.signInWithEmailAndPassword(email, password);
}
async function handleFirebaseUser(user) {
  const client = window.CASH_FIREBASE;
  try {
    const token = await user.getIdTokenResult(true);
    const isAdmin = token.claims.admin === true;
    const profileSnapshot = await client.db.collection('users').doc(user.uid).get();
    const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
    if (
      !profile ||
      (!isAdmin && (profile.status !== 'approved' || token.claims.approved !== true))
    ) {
      remoteAuthMessage =
        profile?.status === 'rejected'
          ? 'This account request was declined. Contact the shop administrator.'
          : 'Your account request is waiting for administrator approval.';
      await client.auth.signOut();
      return;
    }
    remoteAuthMessage = '';
    remoteUser = user;
    const account = {
      username: user.email || profile.email,
      usernameKey: user.uid,
      displayName: profile.displayName || user.displayName || user.email,
      isAdmin,
    };
    const shopSnapshot = await client.db.collection('shops').doc(user.uid).get();
    const remoteState = shopSnapshot.exists ? shopSnapshot.data().state : null;
    el('adminNav').hidden = !isAdmin;
    el('adminView').hidden = !isAdmin;
    startAccountSession(account, false, remoteState);
  } catch (error) {
    console.error('Account could not be opened', error);
    remoteAuthMessage = firebaseErrorMessage(error);
    await client.auth.signOut().catch(() => {});
  }
}
function watchFirebaseAuth(client) {
  client.auth.onAuthStateChanged((user) => {
    if (remoteSignupBusy) return;
    if (!user) {
      remoteUser = null;
      profilePhotoDraft = null;
      profilePhotoRemoved = false;
      activeShopDataKey = null;
      state = null;
      currentAccount = null;
      el('adminNav').hidden = true;
      el('adminView').hidden = true;
      const message = remoteAuthMessage;
      remoteAuthMessage = '';
      showLoginScreen(message);
      return;
    }
    handleFirebaseUser(user);
  });
}
async function submitAuthentication(event) {
  event.preventDefault();
  const creating = authMode === 'create';
  const displayName = el('authName').value.trim();
  const username = el('authUsername').value.trim();
  const usernameKey = username.toLowerCase();
  const password = el('authPassword').value;
  const message = el('authMessage');
  const submit = el('authSubmit');
  message.textContent = '';
  message.classList.remove('is-error', 'is-info');
  if (window.CASH_FIREBASE) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
      message.textContent = 'Enter a valid email address.';
      message.classList.add('is-error');
      return;
    }
    if (creating && displayName.length < 2) {
      message.textContent = 'Enter the name you want shown on your shop profile.';
      message.classList.add('is-error');
      return;
    }
    if (password.length < 8) {
      message.textContent = 'Use a password with at least 8 characters.';
      message.classList.add('is-error');
      return;
    }
    if (creating && password !== el('authConfirmPassword').value) {
      message.textContent = 'The passwords do not match.';
      message.classList.add('is-error');
      return;
    }
    submit.disabled = true;
    submit.textContent = creating ? 'Sending request…' : 'Signing in…';
    try {
      await submitFirebaseAuthentication({ creating, displayName, email: username, password });
    } catch (error) {
      message.textContent = firebaseErrorMessage(error);
      message.classList.add('is-error');
    } finally {
      submit.disabled = false;
      submit.textContent = creating ? 'Create account' : 'Log in';
    }
    return;
  }
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
    message.textContent =
      'Use 3–32 letters, numbers, dots, dashes, or underscores for your username.';
    message.classList.add('is-error');
    return;
  }
  if (creating && displayName.length < 2) {
    message.textContent = 'Enter the name you want shown on your shop profile.';
    message.classList.add('is-error');
    return;
  }
  if (password.length < 4) {
    message.textContent = 'Use a password with at least 4 characters.';
    message.classList.add('is-error');
    return;
  }
  if (creating && password !== el('authConfirmPassword').value) {
    message.textContent = 'The passwords do not match.';
    message.classList.add('is-error');
    return;
  }
  submit.disabled = true;
  submit.textContent = creating ? 'Creating account…' : 'Signing in…';
  try {
    if (creating) {
      if (accounts.some((account) => account.usernameKey === usernameKey))
        throw new Error('That username is already in use on this device.');
      const salt = createSalt();
      const account = {
        username,
        usernameKey,
        displayName,
        salt,
        passwordHash: await hashPassword(password, salt),
      };
      const importLegacy = accounts.length === 0 && Boolean(localStorage.getItem(LEGACY_DATA_KEY));
      accounts.push(account);
      saveAccounts();
      startAccountSession(account, importLegacy);
      toast('Your local account is ready.');
    } else {
      const account = accounts.find((saved) => saved.usernameKey === usernameKey);
      if (!account) throw new Error('No account with that username exists on this device.');
      const candidate = await hashPassword(password, account.salt);
      if (candidate !== account.passwordHash)
        throw new Error('The username or password is incorrect.');
      startAccountSession(account);
    }
  } catch (error) {
    message.textContent = error.message || 'Could not sign in. Please try again.';
    message.classList.add('is-error');
  } finally {
    submit.disabled = false;
    submit.textContent = creating ? 'Create account' : 'Log in';
  }
}
async function switchAccount() {
  const saved = persist();
  if (!saved) {
    toast('This browser could not save your shop. Free up saved space, then try again.');
    return;
  }
  if (remoteUser && window.CASH_FIREBASE) {
    if (!(await remoteSavePromise)) return;
    profilePhotoDraft = null;
    profilePhotoRemoved = false;
    remoteAuthMessage = 'Signed out. Log in to a different account.';
    await window.CASH_FIREBASE.auth.signOut();
    return;
  }
  profilePhotoDraft = null;
  profilePhotoRemoved = false;
  localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
  activeShopDataKey = null;
  state = null;
  currentAccount = null;
  showLoginScreen('Your shop has been saved. Sign in to a different account.');
}
async function renderAdminPanel() {
  if (!currentAccount?.isAdmin || !window.CASH_FIREBASE) return;
  const pendingList = el('adminPendingList'),
    profilesList = el('adminProfilesList');
  pendingList.innerHTML = '<div class="empty">Loading approval requests…</div>';
  profilesList.innerHTML = '<div class="empty">Loading profiles…</div>';
  try {
    const snapshot = await window.CASH_FIREBASE.db.collection('users').get();
    const users = snapshot.docs.map((doc) => ({ uid: doc.id, ...doc.data() }));
    const pending = users.filter((user) => user.status === 'pending');
    const approved = users.filter((user) => user.status === 'approved');
    pendingList.innerHTML = pending.length
      ? pending
          .map(
            (user) => `
              <div class="admin-row">
                <div>
                  <strong>${escapeHtml(user.displayName || 'New shop owner')}</strong>
                  <small>${escapeHtml(user.email || 'No email')}</small>
                </div>
                <div class="admin-actions">
                  <button class="primary approve-account" data-uid="${escapeHtml(user.uid)}">
                    Approve
                  </button>
                  <button class="secondary decline-account" data-uid="${escapeHtml(user.uid)}">
                    Decline
                  </button>
                </div>
              </div>
            `
          )
          .join('')
      : '<div class="empty">No account requests waiting.</div>';
    profilesList.innerHTML = approved.length
      ? approved
          .map((user) => {
            const roleLabel = user.role === 'admin' ? ' · Admin' : '';
            const action =
              user.role === 'admin'
                ? '<span class="period">ADMIN</span>'
                : `<button class="secondary remove-account" data-uid="${escapeHtml(user.uid)}">Delete profile</button>`;

            return `
              <div class="admin-row">
                <div>
                  <strong>${escapeHtml(user.displayName || 'Shop owner')}${roleLabel}</strong>
                  <small>${escapeHtml(user.email || 'No email')}</small>
                </div>
                ${action}
              </div>
            `;
          })
          .join('')
      : '<div class="empty">No approved profiles yet.</div>';
    document
      .querySelectorAll('.approve-account')
      .forEach((button) =>
        button.addEventListener('click', () => approveFirebaseAccount(button.dataset.uid, button))
      );
    document
      .querySelectorAll('.decline-account')
      .forEach((button) =>
        button.addEventListener('click', () =>
          deleteFirebaseAccount(button.dataset.uid, button, true)
        )
      );
    document
      .querySelectorAll('.remove-account')
      .forEach((button) =>
        button.addEventListener('click', () => deleteFirebaseAccount(button.dataset.uid, button))
      );
  } catch (error) {
    pendingList.innerHTML = `<div class="empty">${escapeHtml(firebaseErrorMessage(error))}</div>`;
    profilesList.innerHTML = '<div class="empty">Admin data could not be loaded.</div>';
  }
}
async function approveFirebaseAccount(uid, button) {
  button.disabled = true;
  try {
    await window.CASH_FIREBASE.functions.httpsCallable('approveAccount')({ uid });
    toast('Account approved.');
    await renderAdminPanel();
  } catch (error) {
    button.disabled = false;
    toast(firebaseErrorMessage(error));
  }
}
async function deleteFirebaseAccount(uid, button, isRequest = false) {
  if (
    !confirm(
      isRequest
        ? 'Decline and remove this account request?'
        : 'Delete this profile and its shop records? This cannot be undone.'
    )
  )
    return;
  button.disabled = true;
  try {
    await window.CASH_FIREBASE.functions.httpsCallable('deleteAccount')({ uid });
    toast('Profile and shop data deleted.');
    await renderAdminPanel();
  } catch (error) {
    button.disabled = false;
    toast(firebaseErrorMessage(error));
  }
}
/* 5. Draw each screen from the current shop data. */
// Rebuild the visible numbers and lists after shop data changes.
function render() {
  const products = state.products;
  const low = products.filter((p) => p.stock <= p.threshold).length;
  const stock = products.reduce((a, p) => a + Number(p.stock), 0);
  const weeklySales = state.weekByDay.reduce((a, b) => a + b, 0);
  el('stockStat').textContent = stock.toLocaleString();
  el('stockFoot').textContent =
    `Across ${products.length} product${products.length === 1 ? '' : 's'}`;
  el('unitsStat').textContent = state.weekUnits.toLocaleString();
  el('lowStat').textContent = low;
  el('lowBadge').textContent = `${low} low`;
  el('lowBadge').style.display = low ? '' : 'none';
  el('salesStat').textContent = money(weeklySales);
  el('weekTotal').textContent = money(weeklySales);
  el('unitsStat').textContent = state.weekUnits.toLocaleString();
  const cats = [...new Set(products.map((p) => p.category))].sort();
  const prev = el('categoryFilter').value;
  el('categoryFilter').innerHTML =
    '<option value="all">All items</option>' +
    cats.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if (cats.includes(prev)) el('categoryFilter').value = prev;
  renderRows();
  renderSalesDesk();
  renderRanks();
  renderChart();
  renderProfits();
  renderSalesRecords();
  renderProfile();
}
function renderRows() {
  const query = el('search').value.trim().toLowerCase(),
    cat = el('categoryFilter').value;
  const items = state.products
    .filter((p) => (cat === 'all' || p.category === cat) && p.name.toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name));
  el('productRows').innerHTML = items.length
    ? items
        .map((product) => {
          const [status, statusClass] = stockState(product);

          return `
            <tr>
              <td>
                <div class="item-cell">
                  ${productVisual(product, 'mini-emoji')}${escapeHtml(product.name)}
                </div>
              </td>
              <td><span class="category">${escapeHtml(product.category)}</span></td>
              <td>${product.stock}</td>
              <td>${money(product.price)}</td>
              <td>${product.sold || 0}</td>
              <td><span class="stock-pill ${statusClass}">${status}</span></td>
              <td>
                <div class="row-actions">
                  <button class="row-action receive-btn" data-id="${escapeHtml(product.id)}">Receive stock</button>
                  <button class="row-action edit-btn" data-id="${product.id}">Edit</button>
                  <button
                    class="row-action remove delete-btn"
                    data-id="${product.id}"
                    aria-label="Remove ${escapeHtml(product.name)}"
                  >
                    ×
                  </button>
                </div>
              </td>
            </tr>
          `;
        })
        .join('')
    : `<tr><td colspan="7"><div class="empty">No products found. Add your first product to get started.</div></td></tr>`;
  document
    .querySelectorAll('.receive-btn')
    .forEach((b) => b.addEventListener('click', () => openReceiveStock(b.dataset.id)));
  document
    .querySelectorAll('.edit-btn')
    .forEach((b) => b.addEventListener('click', () => openEdit(b.dataset.id)));
  document
    .querySelectorAll('.delete-btn')
    .forEach((b) => b.addEventListener('click', () => removeProduct(b.dataset.id)));
}
function renderSalesDesk() {
  const query = el('salesSearch').value.trim().toLowerCase();
  const products = state.products.filter((product) => product.name.toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name));
  el('salesProductRows').innerHTML = products.length ? products.map((product) => `
    <tr><td><div class="item-cell">${productVisual(product, 'mini-emoji')}${escapeHtml(product.name)}</div></td>
    <td>${Number(product.stock)}</td><td>${money(product.price)}</td>
    <td><button class="row-action sell-btn" data-id="${escapeHtml(product.id)}" ${product.stock < 1 ? 'disabled' : ''}>${product.stock < 1 ? 'Out of stock' : 'Record sale'}</button></td></tr>`).join('')
    : '<tr><td colspan="4"><div class="empty">No matching products. Add products in Inventory.</div></td></tr>';
  el('salesProductRows').querySelectorAll('.sell-btn').forEach((button) =>
    button.addEventListener('click', () => openSale(button.dataset.id)));
  el('recentSalesRows').innerHTML = state.activity.slice(0, 10).map(saleFinancials).map((sale) => `
    <tr><td>${escapeHtml(new Date(sale.date).toLocaleString('en-PH'))}</td><td>${escapeHtml(sale.name)}</td>
    <td>${sale.qty}</td><td>${money(sale.revenue)}</td></tr>`).join('')
    || '<tr><td colspan="4"><div class="empty">No sales recorded yet.</div></td></tr>';
}
function openReceiveStock(id) {
  const product = byId(id);
  if (!product) return;
  el('receiveProductId').value = id;
  el('receiveProductName').textContent = `${product.name} ? ${product.stock} currently in stock`;
  el('receiveQty').value = '';
  el('receiveDialog').showModal();
  el('receiveQty').focus();
}
el('salesSearch').addEventListener('input', renderSalesDesk);
el('cancelReceive').addEventListener('click', () => el('receiveDialog').close());
el('receiveForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const product = byId(el('receiveProductId').value);
  const quantity = Number(el('receiveQty').value);
  if (!product || !Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(Number(product.stock) + quantity)) return;
  const previous = structuredClone(state);
  el('saveReceive').disabled = true;
  product.stock = Number(product.stock) + quantity;
  const saved = persist();
  const synced = remoteUser ? await remoteSavePromise : true;
  if (!saved || !synced) {
    state = previous;
    try { localStorage.setItem(activeShopDataKey, JSON.stringify(state)); } catch {}
    toast('Stock could not be saved. Please try again.');
  } else {
    el('receiveDialog').close();
    render();
    toast(`${quantity} units received.`);
  }
  el('saveReceive').disabled = false;
});

function renderRanks() {
  const mode = document.querySelector('.ranking-tabs button.selected')?.dataset.rank || 'best';
  const sorted = [...state.products].sort((a, b) =>
    mode === 'best'
      ? (b.sold || 0) - (a.sold || 0)
      : (a.sold || 0) - (b.sold || 0) || a.name.localeCompare(b.name)
  );
  el('rankCaption').textContent =
    mode === 'best' ? 'Ranked by units sold' : 'Low sellers · ranked by units sold';
  el('rankList').innerHTML = sorted.length
    ? sorted
        .map((product, index) => {
          const isTopThree = mode === 'best' && index < 3;
          const podiumClass = isTopThree ? `podium-${index + 1}` : '';
          const rankClass = isTopThree ? 'medal' : '';
          const medal = ['🥇', '🥈', '🥉'][index];
          const rankNumber = isTopThree ? medal : String(index + 1).padStart(2, '0');

          return `
            <div class="rank-row ${podiumClass}">
              <span class="rank-number ${rankClass}">${rankNumber}</span>
              ${productVisual(product, 'product-emoji')}
              <div>
                <div class="rank-name">${escapeHtml(product.name)}</div>
                <div class="rank-sub">
                  ${escapeHtml(product.category)} · ${product.stock} in stock
                </div>
              </div>
              <div class="rank-value">${product.sold || 0}<small>sold</small></div>
            </div>
          `;
        })
        .join('')
    : `<div class="empty">Add products to start your leaderboard.</div>`;
  el('rankFoot').innerHTML =
    mode === 'best'
      ? '🏆 <b>Top tip:</b> Keep your crowd favorite in stock to hold onto first place.'
      : '💡 <b>Little nudge:</b> Try a bundle or a spot near the counter for these slow movers.';
}
function renderChart() {
  const vals = state.weekProfitByDay,
    goals = state.profitGoals;
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const top = Math.max(1000, Math.ceil(Math.max(0, ...vals) / 1000) * 1000),
    mid = top / 2,
    best = Math.max(...vals),
    bestIndex = vals.indexOf(best);
  const compact = (n) => (n >= 1000 ? `₱${Number((n / 1000).toFixed(1))}k` : money(n));
  el('chartAxisTop').textContent = compact(top);
  el('chartAxisMid').textContent = compact(mid);
  el('chart').innerHTML = vals
    .map((v, i) => {
      const color = v < goals.redBelow ? 'bar-red' : v < goals.goodFrom ? 'bar-blue' : 'bar-green';
      const activeClass = i === bestIndex ? 'active' : '';
      const barHeight = Math.max(3, Math.min(100, (v / top) * 95));
      const valueLabel = i === bestIndex ? `<span class="bar-label">${money(v)}</span>` : '';

      return `
        <div class="bar-group">
          <div
            class="bar ${color} ${activeClass}"
            title="${days[i]} · ${money(v)} gross profit"
            aria-label="${days[i]}: ${money(v)} gross profit"
            style="height:${barHeight}%"
          >
            ${valueLabel}
          </div>
        </div>
      `;
    })
    .join('');
  el('dayLabels').innerHTML = days.map((d) => `<span>${d}</span>`).join('');
  el('bestDay').textContent = days[bestIndex];
  el('weekTotal').textContent = money(vals.reduce((sum, v) => sum + Number(v || 0), 0));
  el('chartLegendRed').textContent = `Below ${money(goals.redBelow)}`;
  el('chartLegendBlue').textContent = `${money(goals.redBelow)}–${money(goals.goodFrom)}`;
  el('chartLegendGreen').textContent = `${money(goals.goodFrom)}+`;
}
function renderProfits() {
  const rows = state.products
    .map((p) => {
      const sold = Number(p.sold || 0),
        revenue = Number(p.price || 0) * sold,
        cost = Number(p.cost || 0) * sold,
        gross = revenue - cost,
        margin =
          Number(p.price) > 0
            ? ((Number(p.price) - Number(p.cost || 0)) / Number(p.price)) * 100
            : 0;
      return { ...p, sold, revenue, cost, gross, margin };
    })
    .sort((a, b) => b.gross - a.gross);
  const revenue = rows.reduce((sum, p) => sum + p.revenue, 0),
    costs = rows.reduce((sum, p) => sum + p.cost, 0),
    profit = revenue - costs,
    margin = revenue ? (profit / revenue) * 100 : 0;
  el('profitGross').textContent = money(profit);
  el('profitRevenue').textContent = money(revenue);
  el('profitCosts').textContent = money(costs);
  el('profitMargin').textContent = `${margin.toFixed(1)}%`;
  el('profitRows').innerHTML = rows.length
    ? rows
        .map((product) => {
          const unitProfit = Number(product.price) - Number(product.cost);
          const bestProductProfit = Math.max(1, ...rows.map((row) => Math.max(0, row.gross)));
          const profitBarWidth = profit
            ? Math.max(0, Math.min(100, (Math.max(0, product.gross) / bestProductProfit) * 100))
            : 0;

          return `
            <tr>
              <td>
                <div class="item-cell">
                  ${productVisual(product, 'mini-emoji')}${escapeHtml(product.name)}
                </div>
              </td>
              <td>${product.sold}</td>
              <td>${money(product.cost)}</td>
              <td>${money(unitProfit)}</td>
              <td>
                <strong>${money(product.gross)}</strong>
                <div class="profit-bar"><i style="width:${profitBarWidth}%"></i></div>
              </td>
              <td>${product.margin.toFixed(1)}%</td>
            </tr>
          `;
        })
        .join('')
    : `<tr><td colspan="6"><div class="empty">Add products and record sales to see your profit picture.</div></td></tr>`;
}
function saleFinancials(sale) {
  const product = state.products.find((p) => p.name === sale.name),
    qty = Number(sale.qty || 1),
    unitPrice = Number(sale.unitPrice ?? product?.price ?? 0),
    unitCost = Number(sale.unitCost ?? product?.cost ?? 0);
  return {
    ...sale,
    qty,
    unitPrice,
    unitCost,
    estimated: sale.unitPrice == null || sale.unitCost == null,
    revenue: Number(sale.revenue ?? qty * unitPrice),
    grossProfit: Number(sale.grossProfit ?? qty * (unitPrice - unitCost)),
    date: Number(sale.date || 0),
  };
}
function rangeSales() {
  const from = el('recordFrom').value,
    to = el('recordTo').value;
  if (!from || !to) return [];
  const start = new Date(`${from}T00:00:00`).getTime(),
    end = new Date(`${to}T23:59:59.999`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return [];
  return (state.activity || [])
    .map(saleFinancials)
    .filter((s) => s.date >= start && s.date <= end)
    .sort((a, b) => b.date - a.date);
}
function renderSalesRecords() {
  const sales = rangeSales(),
    revenue = sales.reduce((sum, s) => sum + s.revenue, 0),
    profit = sales.reduce((sum, s) => sum + s.grossProfit, 0),
    estimated = sales.some((s) => s.estimated);
  const saleCount = `${sales.length} sale${sales.length === 1 ? '' : 's'}`;
  const estimateNote = estimated ? ' · older amounts estimated' : '';
  el('recordSummary').textContent = sales.length
    ? `${saleCount} · ${money(revenue)} revenue · ${money(profit)} gross profit${estimateNote}`
    : 'No sales in this date range.';
  el('salesRecordRows').innerHTML = sales.length
    ? sales
        .map((sale) => {
          const saleDate = new Date(sale.date).toLocaleDateString('en-PH', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          });

          return `
            <tr>
              <td>${saleDate}</td>
              <td>${escapeHtml(sale.name || 'Product')}</td>
              <td>${sale.qty}</td>
              <td>${money(sale.revenue)}</td>
              <td><strong>${money(sale.grossProfit)}</strong></td>
            </tr>
          `;
        })
        .join('')
    : `<tr><td colspan="5"><div class="empty">No sale records in this date range yet.</div></td></tr>`;
  el('rangePdf').disabled = !sales.length;
  el('latestMonthPdf').disabled = !(state.activity || []).some((s) => {
    const d = new Date(Number(s.date || 0)),
      now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });
}
let profilePhotoDraft = null;
let profilePhotoRemoved = false;
function renderProfilePhotoPreview() {
  const profile = state.profile;
  const photo = profilePhotoRemoved ? '' : profilePhotoDraft || profile.photo || '';
  const initial = (profile.owner || 'S').trim().charAt(0).toUpperCase() || 'S';

  [el('profileAvatarLarge'), document.querySelector('.profile .avatar')].forEach((avatar) => {
    avatar.textContent = photo ? '' : initial;
    avatar.classList.toggle('has-photo', Boolean(photo));
    avatar.style.setProperty('--profile-photo', photo ? `url("${photo}")` : 'none');
    avatar.style.backgroundImage = photo
      ? 'var(--profile-photo), var(--profile-photo-fallback)'
      : '';
  });

  el('removeProfilePhoto').hidden = !photo;
  el('saveProfilePhoto').hidden = !profilePhotoDraft && !profilePhotoRemoved;
  el('saveProfilePhoto').textContent = profilePhotoRemoved ? 'Apply removal' : 'Save photo';
  el('profilePhotoHelp').textContent = profilePhotoRemoved
    ? 'Photo will be removed when you apply this change.'
    : profilePhotoDraft
      ? 'Preview ready. Save the photo or save your profile.'
      : 'Square preview · up to 10 MB.';
}
function renderProfile() {
  const profile = state.profile;
  el('storeNameText').textContent = profile.store || 'Your shop';
  el('profilePreviewName').textContent = profile.owner || 'Shop owner';
  el('profilePreviewShop').textContent = profile.store || 'Your shop';
  el('profilePreviewLocation').textContent = profile.location || 'Location not set';
  el('profileDataBadge').textContent = remoteUser ? 'FIREBASE CLOUD' : 'LOCAL DATA';
  el('profileSaveNote').textContent = remoteUser
    ? 'Your profile syncs to your Firebase account.'
    : 'Your profile is saved in this browser.';
  renderProfilePhotoPreview();
  el('activeAccountName').textContent = currentAccount?.username || 'shop owner';
  document.querySelector('.profile strong').textContent = profile.owner || 'Shop owner';
  el('ownerName').value = profile.owner || '';
  el('shopName').value = profile.store || '';
  el('shopLocation').value = profile.location || '';
}
/* 6. Product and profile photos use the same square, compressed upload. */
let productPhotoDraft = null;
let productPhotoRemoved = false;
function showProductPhoto(photo = '') {
  const preview = el('productPhotoPreview');
  preview.hidden = !photo;
  if (photo) el('productPhotoPreviewImage').src = photo;
  else el('productPhotoPreviewImage').removeAttribute('src');
}
function prepareSquarePhoto(file, photoType) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error(`Choose an image file for the ${photoType}.`));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      reject(new Error(`Choose an image that is 10 MB or smaller for the ${photoType}.`));
      return;
    }
    const url = URL.createObjectURL(file),
      image = new Image();
    image.onload = () => {
      try {
        const size = 400,
          scale = Math.max(size / image.naturalWidth, size / image.naturalHeight),
          width = image.naturalWidth * scale,
          height = image.naturalHeight * scale,
          canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Your browser could not prepare that image.');
        context.fillStyle = '#e8edf4';
        context.fillRect(0, 0, size, size);
        context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
        const webp = canvas.toDataURL('image/webp', 0.84);
        resolve(webp.startsWith('data:image/webp;') ? webp : canvas.toDataURL('image/jpeg', 0.84));
      } catch (error) {
        reject(error);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That image could not be opened. Try another photo.'));
    };
    image.src = url;
  });
}
async function storeUserImage(path, dataUrl) {
  const client = window.CASH_FIREBASE;
  if (!client || !remoteUser) return dataUrl;
  const contentType = dataUrl.slice(5, dataUrl.indexOf(';'));
  const ref = client.storage.ref(`users/${remoteUser.uid}/${path}`);
  await ref.putString(dataUrl, 'data_url', { contentType });
  return ref.getDownloadURL();
}
async function savePendingProfilePhoto() {
  const button = el('saveProfilePhoto');
  const previousProfile = state.profile;
  button.disabled = true;

  try {
    const nextProfile = { ...previousProfile };
    if (profilePhotoRemoved) delete nextProfile.photo;
    else if (profilePhotoDraft)
      nextProfile.photo = await storeUserImage('profile/avatar.webp', profilePhotoDraft);
    else return;

    state.profile = nextProfile;
    if (!persist()) {
      state.profile = previousProfile;
      toast('This browser is low on saved space. Try a smaller photo.');
      return;
    }
    if (remoteUser && !(await remoteSavePromise)) {
      state.profile = previousProfile;
      persist();
      return;
    }

    profilePhotoDraft = null;
    profilePhotoRemoved = false;
    renderProfilePhotoPreview();
    toast('Profile photo saved.');
  } catch (error) {
    state.profile = previousProfile;
    persist();
    toast(error.message || 'Could not save the profile photo. Please try again.');
  } finally {
    button.disabled = false;
  }
}
function openProduct() {
  el('productForm').reset();
  el('editProductId').value = '';
  productPhotoDraft = null;
  productPhotoRemoved = false;
  showProductPhoto();
  el('modalTitle').textContent = 'Add a product';
  el('modalIntro').textContent = 'Add something new to your shelves.';
  el('saveProduct').textContent = 'Save product';
  el('productThreshold').value = 5;
  el('modalBackdrop').classList.add('show');
  setTimeout(() => el('productName').focus(), 30);
}
function openEdit(id) {
  const p = byId(id);
  if (!p) return;
  el('productForm').reset();
  el('editProductId').value = p.id;
  el('productName').value = p.name;
  el('productCategory').value = p.category;
  el('productStock').value = p.stock;
  el('productPrice').value = p.price;
  el('productCost').value = p.cost;
  el('productThreshold').value = p.threshold;
  productPhotoDraft = null;
  productPhotoRemoved = false;
  showProductPhoto(p.photo || '');
  el('modalTitle').textContent = 'Edit product';
  el('modalIntro').textContent = 'Update the details or adjust its stock.';
  el('saveProduct').textContent = 'Save changes';
  el('modalBackdrop').classList.add('show');
}
function removeProduct(id) {
  const p = byId(id);
  if (!p) return;
  if (!confirm(`Remove ${p.name} from your products?`)) return;
  state.products = state.products.filter((item) => item.id !== id);
  persist();
  render();
  toast(`${p.name} removed from your products.`);
}
function closeProduct() {
  el('modalBackdrop').classList.remove('show');
}
function openSale(id) {
  const p = byId(id);
  if (!p) return;
  if (p.stock < 1) {
    toast('This item is out of stock. Restock it before recording a sale.');
    return;
  }
  el('saleId').value = id;
  el('saleProduct').value = p.name;
  el('saleQty').value = 1;
  el('saleQty').max = p.stock;
  el('saleIntro').textContent =
    `${p.stock} ${p.stock === 1 ? 'item' : 'items'} in stock · ${money(p.price)} each`;
  el('saleBackdrop').classList.add('show');
}
function closeSale() {
  el('saleBackdrop').classList.remove('show');
}
function updateGoalSummary() {
  const red = Number(el('goalRedBelow').value || 0),
    good = Number(el('goalGoodFrom').value || 0);
  el('goalSummary').innerHTML =
    `<b>Red:</b> below ${money(red)} &nbsp; · &nbsp; <b>Blue:</b> ${money(red)} to under ${money(good)} &nbsp; · &nbsp; <b>Green:</b> ${money(good)} and above`;
}
function openGoals() {
  el('goalRedBelow').value = state.profitGoals.redBelow;
  el('goalGoodFrom').value = state.profitGoals.goodFrom;
  updateGoalSummary();
  el('goalsBackdrop').classList.add('show');
}
function closeGoals() {
  el('goalsBackdrop').classList.remove('show');
}
/* 8. Profit check-in and animation. */
let profitAnimationFrame = 0;
function animateProfitAmount(target, negative = false) {
  if (profitAnimationFrame) cancelAnimationFrame(profitAnimationFrame);
  const amount = Math.max(0, Number(target) || 0),
    output = el('profitCheckAmount'),
    dark = document.body.classList.contains('dark'),
    start = dark ? [157, 185, 230] : [101, 133, 184],
    finish = dark ? [102, 199, 135] : [48, 159, 92],
    render = (progress) => {
      const end = start.map((value, index) =>
          Math.round(value + (finish[index] - value) * progress)
        ),
        rgb = (color) => `rgb(${color.join(',')})`;
      output.style.backgroundImage = `linear-gradient(90deg,${rgb(start)} 0%,${rgb(end)} 100%)`;
      output.style.backgroundClip = 'text';
      output.style.webkitBackgroundClip = 'text';
      output.style.webkitTextFillColor = 'transparent';
      output.textContent = `${negative && amount * progress > 0 ? '−' : ''}${money(amount * progress)}`;
    };
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    render(1);
    return;
  }
  const started = performance.now(),
    duration = 1350;
  const frame = (now) => {
    const progress = Math.min(1, (now - started) / duration),
      eased = 1 - Math.pow(1 - progress, 3);
    render(eased);
    if (progress < 1) profitAnimationFrame = requestAnimationFrame(frame);
    else profitAnimationFrame = 0;
  };
  profitAnimationFrame = requestAnimationFrame(frame);
}
function openProfitCheck() {
  const current = Number(state.lifetimeGrossProfit || 0);
  const last = state.lastProfitCheck;
  const name = (
    state.profile.owner ||
    currentAccount?.displayName ||
    currentAccount?.username ||
    'there'
  )
    .trim()
    .split(/\s+/)[0];
  let amount = current;
  let negative = false;
  if (last) {
    const change = current - Number(last.profit || 0);
    amount = Math.abs(change);
    negative = change < 0;
    el('profitCheckTitle').textContent = `Welcome back, ${name}!`;
    el('profitCheckMessage').textContent =
      change > 0
        ? 'That’s the gross profit from sales recorded since your previous check.'
        : change < 0
          ? 'Your gross profit total has gone down since your previous check.'
          : 'No new gross profit has been recorded since your previous check.';
    el('profitCheckTime').textContent =
      `Last checked ${new Date(last.checkedAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}`;
  } else {
    el('profitCheckTitle').textContent = `Welcome, ${name}!`;
    el('profitCheckMessage').textContent =
      'This is your gross profit so far. We’ll track new profit from now on.';
    el('profitCheckTime').textContent = 'Dismiss this note to save your first check-in.';
  }
  el('profitCheckBackdrop').classList.add('show');
  animateProfitAmount(amount, negative);
}
function closeProfitCheck() {
  if (profitAnimationFrame) {
    cancelAnimationFrame(profitAnimationFrame);
    profitAnimationFrame = 0;
  }
  state.lastProfitCheck = { profit: Number(state.lifetimeGrossProfit || 0), checkedAt: Date.now() };
  persist();
  el('profitCheckBackdrop').classList.remove('show');
}
/* 9. Build and download sales receipt PDFs. */
function pdfText(value) {
  return String(value ?? '')
    .replace(/₱/g, 'PHP ')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}
function createPdf(lines) {
  const perPage = 48,
    pages = [];
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
  if (!pages.length) pages.push(['No sale records.']);
  const objects = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((page, i) => {
    const pageId = pageIds[i],
      contentId = pageId + 1;
    const stream = `BT\n/F1 10 Tf\n50 790 Td\n14 TL\n${page.map((line) => `(${pdfText(line)}) Tj\nT*`).join('\n')}\nET`;
    objects[pageId - 1] =
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ' +
      contentId +
      ' 0 R >>';
    objects[contentId - 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let pdf = '%PDF-1.4\n',
    offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++)
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: 'application/pdf' });
}
function downloadSalesPdf(sales, rangeLabel, fileName) {
  const sorted = [...sales].map(saleFinancials).sort((a, b) => a.date - b.date),
    revenue = sorted.reduce((sum, s) => sum + s.revenue, 0),
    profit = sorted.reduce((sum, s) => sum + s.grossProfit, 0),
    lines = [
      'C.A.S.H. - Central Accountant and Storage Helper',
      'SALES RECORD / RECEIPT',
      `Shop: ${state.profile?.store || 'Your shop'}`,
      `Owner: ${state.profile?.owner || 'Shop owner'}`,
      `Period: ${rangeLabel}`,
      `Generated: ${new Date().toLocaleString('en-PH')}`,
    ];
  if (sorted.some((s) => s.estimated))
    lines.push('Note: Older amounts are estimated from current product prices.');
  lines.push('------------------------------------------------');
  sorted.forEach((s) => {
    const ref = s.id || `SALE-${s.date}`;
    lines.push(
      `Receipt: ${ref}`,
      `Date: ${new Date(s.date).toLocaleString('en-PH')}`,
      `Product: ${s.name || 'Product'}`,
      `Quantity: ${s.qty} x ${money(s.unitPrice)}`,
      `Sale total: ${money(s.revenue)}`,
      `Gross profit: ${money(s.grossProfit)}`,
      '------------------------------------------------'
    );
  });
  lines.push(
    `Sales count: ${sorted.length}`,
    `Total revenue: ${money(revenue)}`,
    `Total gross profit: ${money(profit)}`,
    '',
    'Thank you for keeping your records with C.A.S.H.'
  );
  const url = URL.createObjectURL(createPdf(lines)),
    anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function downloadRangeSales() {
  const from = el('recordFrom').value,
    to = el('recordTo').value;
  if (!from || !to) {
    toast('Choose both a start date and an end date.');
    return;
  }
  if (from > to) {
    toast('The start date must be before the end date.');
    return;
  }
  const sales = rangeSales();
  if (!sales.length) {
    toast('There are no sale records in that date range.');
    return;
  }
  downloadSalesPdf(sales, `${from} through ${to}`, `cash-sales-${from}-to-${to}.pdf`);
}
function downloadLatestSaleThisMonth() {
  const now = new Date(),
    sales = (state.activity || [])
      .map(saleFinancials)
      .filter((s) => {
        const date = new Date(s.date);
        return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
      })
      .sort((a, b) => b.date - a.date);
  if (!sales.length) {
    toast('No sale has been recorded this month yet.');
    return;
  }
  const label = now.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }),
    date = sales[0].date;
  downloadSalesPdf(
    [sales[0]],
    label,
    `cash-last-sale-${new Date(date).toISOString().slice(0, 10)}.pdf`
  );
}
function localDateValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
function setReceiptDateDefaults() {
  const now = new Date();
  el('recordFrom').value = localDateValue(new Date(now.getFullYear(), now.getMonth(), 1));
  el('recordTo').value = localDateValue(now);
}
let toastTimer;
function toast(msg) {
  el('toast').textContent = msg;
  el('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el('toast').classList.remove('show'), 2800);
}
/* 10. Connect form events to shop data updates. */
el('productPhoto').addEventListener('change', async (event) => {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  try {
    productPhotoDraft = await prepareSquarePhoto(file, 'product photo');
    productPhotoRemoved = false;
    showProductPhoto(productPhotoDraft);
  } catch (error) {
    toast(error.message || 'Could not use that product photo.');
    event.currentTarget.value = '';
  }
});
el('removeProductPhoto').addEventListener('click', () => {
  productPhotoDraft = null;
  productPhotoRemoved = true;
  showProductPhoto();
  el('productPhoto').value = '';
});
el('productForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget),
    name = String(form.get('name')).trim();
  if (!name) return;
  const button = el('saveProduct');
  button.disabled = true;
  try {
    const category = form.get('category'),
      id = form.get('id');
    const values = {
      name,
      category,
      stock: Number(form.get('stock')),
      price: Number(form.get('price')),
      cost: Number(form.get('cost')),
      threshold: Number(form.get('threshold')),
      emoji: iconFor(category),
    };
    const existing = id ? byId(id) : null;
    let product = id ? { ...existing, ...values } : { id: 'p' + Date.now(), ...values, sold: 0 };
    if (productPhotoRemoved) delete product.photo;
    if (productPhotoDraft)
      product.photo = await storeUserImage(`products/${product.id}.webp`, productPhotoDraft);
    if (existing) Object.assign(existing, product);
    else state.products.push(product);
    persist();
    if (remoteUser && !(await remoteSavePromise)) return;
    render();
    closeProduct();
    toast(`${name} ${id ? 'updated' : 'added'}.`);
  } catch (error) {
    toast(error.message || 'Could not save the product photo. Please try again.');
  } finally {
    button.disabled = false;
  }
});
el('saleForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const p = byId(el('saleId').value),
    qty = Number(el('saleQty').value);
  if (!p || !Number.isSafeInteger(qty) || qty < 1 || qty > p.stock) {
    toast('Please enter a quantity available in stock.');
    return;
  }
  const previous = structuredClone(state);
  el('saveSale').disabled = true;
  const unitPrice = Number(p.price),
    unitCost = Number(p.cost || 0),
    unitProfit = unitPrice - unitCost,
    date = Date.now();
  p.stock -= qty;
  p.sold = (p.sold || 0) + qty;
  state.weekUnits += qty;
  const weekday = (new Date().getDay() + 6) % 7;
  state.weekByDay[weekday] += qty * unitPrice;
  state.weekProfitByDay[weekday] += qty * unitProfit;
  state.lifetimeGrossProfit += qty * unitProfit;
  state.activity.unshift({
    id: 'R' + date,
    name: p.name,
    qty,
    date,
    unitPrice,
    unitCost,
    revenue: qty * unitPrice,
    grossProfit: qty * unitProfit,
  });
  const saved = persist();
  const synced = remoteUser ? await remoteSavePromise : true;
  el('saveSale').disabled = false;
  if (!saved || !synced) {
    state = previous;
    try { localStorage.setItem(activeShopDataKey, JSON.stringify(state)); } catch {}
    toast('Sale could not be saved. Please try again.');
    return;
  }
  render();
  closeSale();
  toast('Sale recorded!');
});
el('addProductTop').addEventListener('click', openProduct);
el('closeModal').addEventListener('click', closeProduct);
el('cancelModal').addEventListener('click', closeProduct);
el('closeSale').addEventListener('click', closeSale);
el('cancelSale').addEventListener('click', closeSale);
el('modalBackdrop').addEventListener('click', (e) => {
  if (e.target === el('modalBackdrop')) closeProduct();
});
el('saleBackdrop').addEventListener('click', (e) => {
  if (e.target === el('saleBackdrop')) closeSale();
});
el('goalsBackdrop').addEventListener('click', (e) => {
  if (e.target === el('goalsBackdrop')) closeGoals();
});
el('profitCheckBackdrop').addEventListener('click', (e) => {
  if (e.target === el('profitCheckBackdrop')) closeProfitCheck();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeProduct();
    closeSale();
    closeGoals();
    if (el('profitCheckBackdrop').classList.contains('show')) closeProfitCheck();
  }
});
el('search').addEventListener('input', renderRows);
el('categoryFilter').addEventListener('change', renderRows);
document.querySelectorAll('.ranking-tabs button').forEach((b) =>
  b.addEventListener('click', () => {
    document
      .querySelectorAll('.ranking-tabs button')
      .forEach((x) => x.classList.remove('selected'));
    b.classList.add('selected');
    renderRanks();
  })
);
/* 11. Navigation, theme controls, and app startup. */
document.querySelectorAll('button[data-view]').forEach((b) =>
  b.addEventListener('click', () => {
    const view = b.dataset.view;
    document
      .querySelectorAll('button[data-view]')
      .forEach((x) => x.classList.toggle('active', x.dataset.view === view));
    document.body.dataset.view = view;
    const labels = {
      overview: 'Dashboard',
      inventory: 'Inventory',
      sales: 'Sales',
      rankings: 'Rankings',
      profits: 'Accounting',
      profile: 'Profile',
      admin: 'Admin',
    };
    el('crumbText').textContent = labels[view];
    if (view === 'sales') {
      el('pageTitle').textContent = 'Record customer sales';
      el('pageSub').textContent = 'Choose products, record quantities, and update stock.';
    } else if (view === 'inventory') {
      el('pageTitle').textContent = 'Your inventory, at a glance.';
      el('pageSub').textContent = 'Keep track of every item on your shelves.';
    } else if (view === 'rankings') {
      el('pageTitle').textContent = 'Your sale history.';
      el('pageSub').textContent = 'See which products sell most and least.';
    } else if (view === 'profits') {
      el('pageTitle').textContent = 'Accounting & reports';
      el('pageSub').textContent = 'Review revenue, product costs, gross profit, and sales receipts.';
    } else if (view === 'profile') {
      el('pageTitle').textContent = 'Your shop profile.';
      el('pageSub').textContent = 'Edit the details you use to manage your store.';
    } else if (view === 'admin') {
      el('pageTitle').textContent = 'Account administration';
      el('pageSub').textContent = 'Review new requests and manage approved profiles.';
      renderAdminPanel();
    } else {
      el('pageTitle').textContent = 'Dashboard';
      el('pageSub').textContent = 'Here’s what’s happening with your store today.';
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  })
);
const themeKey = 'stocksy-theme';
if (localStorage.getItem(themeKey) === 'dark') document.body.classList.add('dark');
function updateThemeToggle() {
  const dark = document.body.classList.contains('dark'),
    label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  el('themeToggle').querySelector('.theme-symbol').textContent = dark ? '☀' : '☾';
  el('mobileThemeToggle').querySelector('.nav-icon').textContent = dark ? '☀' : '☾';
  el('mobileThemeToggle').querySelector('.theme-label').textContent = dark
    ? 'Light mode'
    : 'Dark mode';
  [el('themeToggle'), el('mobileThemeToggle')].forEach((button) => {
    button.setAttribute('aria-label', label);
    button.title = label;
  });
}
[el('themeToggle'), el('mobileThemeToggle')].forEach((button) =>
  button.addEventListener('click', () => {
    document.body.classList.toggle('dark');
    localStorage.setItem(themeKey, document.body.classList.contains('dark') ? 'dark' : 'light');
    updateThemeToggle();
  })
);
updateThemeToggle();
el('profitGoalsButton').addEventListener('click', openGoals);
el('closeGoals').addEventListener('click', closeGoals);
el('cancelGoals').addEventListener('click', closeGoals);
el('goalRedBelow').addEventListener('input', updateGoalSummary);
el('goalGoodFrom').addEventListener('input', updateGoalSummary);
el('goalsForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const redBelow = Number(el('goalRedBelow').value),
    goodFrom = Number(el('goalGoodFrom').value);
  if (goodFrom <= redBelow) {
    toast('Green goal must be higher than the red cutoff.');
    return;
  }
  state.profitGoals = { redBelow, goodFrom };
  persist();
  renderChart();
  closeGoals();
  toast('Profit goals saved.');
});
el('profitCheckButton').addEventListener('click', openProfitCheck);
el('closeProfitCheck').addEventListener('click', closeProfitCheck);
el('dismissProfitCheck').addEventListener('click', closeProfitCheck);
el('recordFrom').addEventListener('change', renderSalesRecords);
el('recordTo').addEventListener('change', renderSalesRecords);
el('rangePdf').addEventListener('click', downloadRangeSales);
el('latestMonthPdf').addEventListener('click', downloadLatestSaleThisMonth);
el('profileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = e.currentTarget.querySelector('button[type="submit"]');
  const form = new FormData(e.currentTarget);
  const previousProfile = state.profile;
  button.disabled = true;
  try {
    const nextProfile = {
      ...previousProfile,
      owner: String(form.get('owner')).trim(),
      store: String(form.get('store')).trim(),
      location: String(form.get('location')).trim(),
    };

    if (profilePhotoRemoved) delete nextProfile.photo;
    else if (profilePhotoDraft)
      nextProfile.photo = await storeUserImage('profile/avatar.webp', profilePhotoDraft);

    state.profile = nextProfile;
    if (!persist()) {
      state.profile = previousProfile;
      renderProfile();
      toast('This browser is low on saved space. Try a smaller photo.');
      return;
    }
    if (remoteUser && !(await remoteSavePromise)) {
      state.profile = previousProfile;
      persist();
      renderProfile();
      return;
    }
    if (remoteUser) {
      try {
        await window.CASH_FIREBASE.db.collection('users').doc(remoteUser.uid).update({
          displayName: state.profile.owner,
          shopName: state.profile.store,
          location: state.profile.location,
        });
      } catch (error) {
        renderProfile();
        toast(firebaseErrorMessage(error));
        return;
      }
    }

    profilePhotoDraft = null;
    profilePhotoRemoved = false;
    renderProfile();
    toast('Profile saved. ✨');
  } catch (error) {
    state.profile = previousProfile;
    persist();
    renderProfile();
    toast(error.message || 'Could not save the profile photo. Please try again.');
  } finally {
    button.disabled = false;
  }
});
el('profilePhoto').addEventListener('change', async (event) => {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  try {
    profilePhotoDraft = await prepareSquarePhoto(file, 'profile photo');
    profilePhotoRemoved = false;
    renderProfilePhotoPreview();
  } catch (error) {
    toast(error.message || 'Could not use that profile photo.');
  } finally {
    event.currentTarget.value = '';
  }
});
el('removeProfilePhoto').addEventListener('click', () => {
  profilePhotoDraft = null;
  profilePhotoRemoved = true;
  renderProfilePhotoPreview();
});
el('saveProfilePhoto').addEventListener('click', savePendingProfilePhoto);
el('refreshAdmin').addEventListener('click', renderAdminPanel);
el('switchAccountButton').addEventListener('click', switchAccount);
el('authForm').addEventListener('submit', submitAuthentication);
el('authModeToggle').addEventListener('click', () => {
  authMode = authMode === 'login' ? 'create' : 'login';
  renderAuthMode();
  if (authMode === 'create') el('authName').focus();
  else el('authUsername').focus();
});
el('authMessage').textContent = '';
el('todayLabel').textContent = new Intl.DateTimeFormat('en-PH', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
})
  .format(new Date())
  .toUpperCase();
setReceiptDateDefaults();
el('authSubmit').disabled = true;
const launchApp = (client) => {
  el('authSubmit').disabled = false;
  if (client) {
    window.CASH_FIREBASE = client;
    renderAuthMode();
    watchFirebaseAuth(client);
    return;
  }
  window.CASH_FIREBASE = null;
  const rememberedUsername = localStorage.getItem(ACTIVE_ACCOUNT_KEY);
  const rememberedAccount = accounts.find((account) => account.usernameKey === rememberedUsername);
  if (rememberedAccount) startAccountSession(rememberedAccount);
  else {
    if (rememberedUsername) localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
    showLoginScreen();
  }
};
(window.CASH_FIREBASE_READY || Promise.resolve(null)).then(launchApp).catch((error) => {
  console.error('Firebase could not start', error);
  el('authSubmit').disabled = false;
  showLoginScreen('Firebase could not connect. Check your internet connection and Firebase setup.');
});
