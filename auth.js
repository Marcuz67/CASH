const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { OAuth2Client } = require('google-auth-library');

const hash = value => createHash('sha256').update(value).digest('hex');
const failure = (status, message) => Object.assign(new Error(message), { status });

function createAuth({ store, clientId = process.env.GOOGLE_CLIENT_ID || '',
  adminEmails = process.env.ADMIN_EMAILS || '', origin = process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL || '',
  secure = Boolean(process.env.RENDER || process.env.NODE_ENV === 'production'), verifyToken, now = Date.now }) {
  const emails = new Set(adminEmails.split(',').map(email => email.trim().toLowerCase()).filter(Boolean));
  const sessionCookie = secure ? '__Host-cash_session' : 'cash_session';
  const challengeCookie = secure ? '__Host-cash_login' : 'cash_login';
  const buyerCookie = secure ? '__Host-cash_buyer' : 'cash_buyer';
  const google = new OAuth2Client(clientId);
  const verify = verifyToken || (async credential => (await google.verifyIdToken({ idToken: credential, audience: clientId })).getPayload());
  const role = user => user.sellerEligible === true && emails.has(user.email.toLowerCase()) ? 'admin' : 'buyer';
  function cookies(request) {
    const result = {};
    for (const part of (request.headers.cookie || '').split(';')) {
      const index = part.indexOf('='); if (index < 0) continue;
      result[part.slice(0, index).trim()] = part.slice(index + 1).trim();
    }
    return result;
  }
  function setCookie(response, name, value, seconds) {
    const cookie = `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure ? '; Secure' : ''}`;
    const existing = response.getHeader('Set-Cookie') || [];
    response.setHeader('Set-Cookie', [...(Array.isArray(existing) ? existing : [existing]), cookie]);
  }
  function sameOrigin(request) {
    let expected;
    try {
      if (origin) expected = new URL(origin).origin;
      else {
        const local = new URL(`http://${request.headers.host}`);
        if (secure || !['localhost', '127.0.0.1', '[::1]'].includes(local.hostname)) throw new Error();
        expected = local.origin;
      }
    } catch { throw failure(503, 'Set APP_ORIGIN to the website URL before enabling sign-in.'); }
    if (request.headers.origin !== expected) throw failure(403, 'This request must come from the store website.');
  }
  async function currentUser(request) {
    const token = cookies(request)[sessionCookie];
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const session = await store.getSession(hash(token));
    if (!session || session.expires <= now() || session.identity.purpose !== 'account') return null;
    const user = session.identity.user;
    if (user.provider === 'local-admin') {
      const account = await store.getLocalAdmin();
      if (!account || user.sub !== `local-admin:${account.id}` || user.version !== account.version) return null;
      return { sub:user.sub,provider:'local-admin',username:account.username,name:account.display_name,version:account.version,role:'admin' };
    }
    return { ...user, role: role(user) };
  }
  async function requireUser(request, seller = false) {
    const user = await currentUser(request);
    if (!user) throw failure(401, 'Sign in to continue.');
    if (seller && user.role !== 'admin') throw failure(403, 'This account does not have Seller/Admin access.');
    return user;
  }
  async function requireShopper(request) {
    if (request.headers['x-cash-buyer'] === '1') {
      const buyer=await currentBuyer(request);
      if (!buyer) throw failure(401,'Sign in to your Buyer account to continue.');
      return buyer;
    }
    const user = await currentUser(request);
    if (user) return user;
    const buyer=await currentBuyer(request);
    if (buyer) return buyer;
    throw failure(401,'Sign in or create a Buyer account to access the store.');
  }
  async function currentBuyer(request) {
    const token=cookies(request)[buyerCookie];
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const session=await store.getSession(hash(token));
    if (!session || session.expires <= now() || session.identity.purpose !== 'buyer-account') return null;
    const identity=session.identity.user;
    const account=await store.getBuyerById(identity.id);
    if (!account || identity.sub !== `local-buyer:${account.id}` || identity.version !== account.version) return null;
    return {sub:identity.sub,id:account.id,provider:'local-buyer',username:account.username,name:account.display_name,version:account.version,role:'buyer'};
  }
  async function issueBuyerSession(request,response,account) {
    const old=cookies(request)[buyerCookie];
    if (old && /^[a-f0-9]{64}$/.test(old)) await store.deleteSession(hash(old));
    const user={id:account.id,sub:`local-buyer:${account.id}`,provider:'local-buyer',username:account.username,name:account.display_name,version:account.version,role:'buyer'};
    const token=randomBytes(32).toString('hex');
    await store.createSession(hash(token),{purpose:'buyer-account',user},now()+8*60*60*1000);
    setCookie(response,buyerCookie,token,8*60*60);
    return {user:publicUser(user)};
  }
  async function buyerLogout(request,response) {
    sameOrigin(request);
    const token=cookies(request)[buyerCookie];
    if (token && /^[a-f0-9]{64}$/.test(token)) await store.deleteSession(hash(token));
    setCookie(response,buyerCookie,'',0);
    return {signedOut:true};
  }
  async function session(request, response) {
    const user = await currentUser(request);
    let nonce = cookies(request)[challengeCookie];
    let challenge = nonce && /^[a-f0-9]{64}$/.test(nonce) ? await store.getSession(hash(nonce)) : null;
    if (clientId && (!challenge || challenge.expires <= now() || challenge.identity.purpose !== 'google-login')) {
      nonce = randomBytes(32).toString('hex');
      await store.createSession(hash(nonce), { purpose: 'google-login' }, now() + 10 * 60 * 1000);
      setCookie(response, challengeCookie, nonce, 600);
    }
    return { configured: Boolean(clientId), sellerConfigured: emails.size > 0, clientId: clientId || null, nonce: clientId ? nonce : null,
      user: user ? publicUser(user) : null };
  }
  async function login(request, response, payload) {
    sameOrigin(request);
    if (!clientId) throw failure(503, 'Google sign-in is not configured yet.');
    if (!payload || !['buyer', 'admin'].includes(payload.mode) || typeof payload.credential !== 'string'
      || payload.credential.length > 16000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(payload.credential)) {
      throw failure(400, 'The Google sign-in response was invalid. Please try again.');
    }
    const nonce = cookies(request)[challengeCookie];
    if (!nonce || !/^[a-f0-9]{64}$/.test(nonce)) throw failure(401, 'Refresh the sign-in page and try again.');
    const challenge = await store.getSession(hash(nonce));
    if (!challenge || challenge.expires <= now() || challenge.identity.purpose !== 'google-login') throw failure(401, 'The sign-in request expired. Refresh and try again.');
    let claims;
    try { claims = await verify(payload.credential); }
    catch { throw failure(401, 'Google could not verify this sign-in. Please try again.'); }
    const supplied = Buffer.from(String(claims?.nonce || ''));
    const expected = Buffer.from(nonce);
    if (!claims || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)
      || claims.email_verified !== true || typeof claims.email !== 'string' || typeof claims.sub !== 'string' || !claims.sub) {
      throw failure(401, 'The Google identity could not be verified.');
    }
    const user = { sub: String(claims.sub), email: claims.email.toLowerCase(), name: String(claims.name || claims.email).slice(0, 200),
      sellerEligible: claims.email.toLowerCase().endsWith('@gmail.com') || Boolean(claims.hd) };
    if (payload.mode === 'admin' && role(user) !== 'admin') throw failure(403, 'This Google account is not approved for Seller/Admin. You can sign in as a Buyer.');
    const consumed = await store.takeSession(hash(nonce));
    if (!consumed || consumed.expires <= now() || consumed.identity.purpose !== 'google-login') throw failure(401, 'This sign-in request has already been used. Refresh and try again.');
    await store.saveAccount(user);
    const result = await issueSession(request, response, user);
    setCookie(response, challengeCookie, '', 0);
    return result;
  }
  function publicUser(user) {
    return { sub:user.sub,name:user.name,role:user.role || role(user),...(user.email ? {email:user.email} : {}),...(user.username ? {username:user.username} : {}) };
  }
  async function issueSession(request, response, user) {
    const token = randomBytes(32).toString('hex');
    // Rotate the session on every sign-in, and retain only its hash in the database.
    const oldToken = cookies(request)[sessionCookie];
    if (oldToken && /^[a-f0-9]{64}$/.test(oldToken)) await store.deleteSession(hash(oldToken));
    await store.createSession(hash(token), { purpose: 'account', user }, now() + 8 * 60 * 60 * 1000);
    setCookie(response, sessionCookie, token, 8 * 60 * 60);
    return { user:publicUser(user) };
  }
  async function logout(request, response) {
    sameOrigin(request);
    const token = cookies(request)[sessionCookie];
    if (token && /^[a-f0-9]{64}$/.test(token)) await store.deleteSession(hash(token));
    setCookie(response, sessionCookie, '', 0); setCookie(response, challengeCookie, '', 0);
    return { signedOut: true };
  }
  return { session, login, logout, requireUser, sameOrigin, currentUser, issueSession, requireShopper, currentBuyer, issueBuyerSession, buyerLogout };
}

module.exports = { createAuth };
