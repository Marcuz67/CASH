const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAuth } = require('./auth');
const { OAuth2Client } = require('google-auth-library');
const { generateKeyPairSync, sign } = require('node:crypto');

function fixture({ configured = true } = {}) {
  const sessions = new Map(); const accounts = new Map();
  let clock = Date.now(); let claims;
  const store = {
    async getSession(key) { return sessions.get(key) || null; },
    async createSession(key, identity, expires) { sessions.set(key, { identity, expires }); },
    async takeSession(key) { const value = sessions.get(key); sessions.delete(key); return value || null; },
    async deleteSession(key) { sessions.delete(key); },
    async saveAccount(user) { accounts.set(user.sub, structuredClone(user)); },
  };
  const options = { store, clientId: configured ? 'cash-test.apps.googleusercontent.com' : '', adminEmails: 'seller@gmail.com',
    origin: 'https://cash.example', secure: true, now: () => clock, verifyToken: async () => {
      if (claims instanceof Error) throw claims;
      return claims;
    } };
  const auth = createAuth(options);
  const response = () => {
    const headers = new Map();
    return { getHeader: key => headers.get(key), setHeader: (key, value) => headers.set(key, value), headers };
  };
  const request = (cookie = '', origin = 'https://cash.example') => ({ headers: { host: 'cash.example', cookie, origin } });
  const cookie = (res, name) => (res.getHeader('Set-Cookie') || []).find(value => value.startsWith(name + '='))?.split(';')[0];
  async function challenge() {
    const res = response(); const session = await auth.session(request(), res);
    return { ...session, cookie: cookie(res, '__Host-cash_login') };
  }
  function identity(nonce, email = 'buyer@gmail.com', extra = {}) {
    claims = { sub: 'google-subject-123', email, name: 'Test account', email_verified: true, nonce, ...extra };
  }
  return { auth, options, accounts, sessions, response, request, cookie, challenge, identity,
    advance: ms => { clock += ms; }, setClaims: value => { claims = value; } };
}

test('Google buyer creates an account with an opaque, HttpOnly, expiring session', async () => {
  const f = fixture(); const challenge = await f.challenge(); f.identity(challenge.nonce);
  const res = f.response(); const result = await f.auth.login(f.request(challenge.cookie), res, { mode: 'buyer', credential: 'aaa.bbb.ccc' });
  assert.equal(result.user.role, 'buyer'); assert.equal(f.accounts.size, 1);
  const sessionCookie = f.cookie(res, '__Host-cash_session');
  assert.match(sessionCookie, /^__Host-cash_session=[a-f0-9]{64}$/);
  const raw = sessionCookie.split('=')[1]; assert.ok(!f.sessions.has(raw), 'only hashed session tokens are stored');
  assert.ok(res.getHeader('Set-Cookie').some(value => value.includes('HttpOnly') && value.includes('Secure') && value.includes('SameSite=Strict') && value.includes('Max-Age=28800')));
  assert.equal((await f.auth.requireUser(f.request(sessionCookie))).sub, 'google-subject-123');
  await assert.rejects(f.auth.requireUser(f.request(sessionCookie), true), { status: 403 });
  f.advance(8 * 60 * 60 * 1000 + 1);
  await assert.rejects(f.auth.requireUser(f.request(sessionCookie)), { status: 401 });
});

test('seller privileges require an approved, Google-authoritative verified email', async () => {
  const f = fixture(); const c = await f.challenge(); f.identity(c.nonce, 'seller@gmail.com');
  const res = f.response(); const result = await f.auth.login(f.request(c.cookie),res,{ mode:'admin',credential:'aaa.bbb.ccc' });
  assert.equal(result.user.role,'admin');
  const cookie = f.cookie(res,'__Host-cash_session');
  assert.equal((await f.auth.requireUser(f.request(cookie),true)).role,'admin');
  // Removing approval revokes seller authorization for an existing session immediately.
  const revoked = createAuth({ ...f.options, adminEmails:'' });
  await assert.rejects(revoked.requireUser(f.request(cookie),true), {status:403});
  const buyer = fixture(); const b = await buyer.challenge(); buyer.identity(b.nonce);
  await assert.rejects(buyer.auth.login(buyer.request(b.cookie),buyer.response(),{mode:'admin',credential:'aaa.bbb.ccc',role:'admin'}),{status:403});
  const thirdParty = fixture(); const t = await thirdParty.challenge(); thirdParty.identity(t.nonce,'owner@example.com');
  const protectedAuth = createAuth({ ...thirdParty.options, adminEmails:'owner@example.com' });
  await assert.rejects(protectedAuth.login(thirdParty.request(t.cookie),thirdParty.response(),{mode:'admin',credential:'aaa.bbb.ccc'}),{status:403});
});

test('login rejects forged identity, mismatched nonce, stale challenge and cross-site requests', async () => {
  const f = fixture(); const c = await f.challenge();
  const payload = {mode:'buyer',credential:'aaa.bbb.ccc'};
  f.setClaims(new Error('invalid signature'));
  await assert.rejects(f.auth.login(f.request(c.cookie),f.response(),payload),{status:401});
  f.identity('wrong-nonce');
  await assert.rejects(f.auth.login(f.request(c.cookie),f.response(),payload),{status:401});
  f.identity(c.nonce,'buyer@gmail.com',{email_verified:false});
  await assert.rejects(f.auth.login(f.request(c.cookie),f.response(),payload),{status:401});
  f.identity(c.nonce);
  await assert.rejects(f.auth.login(f.request(c.cookie,'https://attacker.example'),f.response(),payload),{status:403});
  await assert.rejects(f.auth.login(f.request(),f.response(),payload),{status:401});
  f.advance(10 * 60 * 1000 + 1);
  await assert.rejects(f.auth.login(f.request(c.cookie),f.response(),payload),{status:401});
});

test('nonce is single-use and logout revokes a session on the server', async () => {
  const f = fixture(); const c = await f.challenge(); f.identity(c.nonce);
  const res = f.response(); const payload={mode:'buyer',credential:'aaa.bbb.ccc'};
  await f.auth.login(f.request(c.cookie),res,payload);
  await assert.rejects(f.auth.login(f.request(c.cookie),f.response(),payload),{status:401});
  const cookie=f.cookie(res,'__Host-cash_session');
  await assert.rejects(f.auth.logout(f.request(cookie,'https://attacker.example'),f.response()),{status:403});
  assert.equal((await f.auth.logout(f.request(cookie),f.response())).signedOut,true);
  await assert.rejects(f.auth.requireUser(f.request(cookie)),{status:401});
});

test('missing client configuration never falls back to anonymous access', async () => {
  const f=fixture({configured:false});
  const session=await f.auth.session(f.request(),f.response());assert.equal(session.configured,false);
  await assert.rejects(f.auth.requireUser(f.request(),true),{status:401});
  await assert.rejects(f.auth.login(f.request(),f.response(),{mode:'buyer',credential:'aaa.bbb.ccc'}),{status:503});
});

test('Google authentication library validates real JWT signatures, audience, issuer and expiry', async () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const otherKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const f = fixture(); const challenge = await f.challenge();
  const google = new OAuth2Client(f.options.clientId);
  // Use a local test key instead of Google's network key endpoint, retaining real JWT verification.
  google.getFederatedSignonCertsAsync = async () => ({ certs: { test: keys.publicKey.export({type:'spki',format:'pem'}) } });
  const auth = createAuth({ ...f.options, verifyToken: async token => (await google.verifyIdToken({idToken:token,audience:f.options.clientId})).getPayload() });
  const now = Math.floor(Date.now()/1000);
  const claims = { sub:'signed-google-sub',email:'buyer@gmail.com',name:'Signed buyer',email_verified:true,nonce:challenge.nonce,
    iss:'https://accounts.google.com',aud:f.options.clientId,iat:now,exp:now+3600 };
  function jwt(overrides = {}, key = keys.privateKey) {
    const head = Buffer.from(JSON.stringify({alg:'RS256',kid:'test',typ:'JWT'})).toString('base64url');
    const body = Buffer.from(JSON.stringify({...claims,...overrides})).toString('base64url');
    const content = `${head}.${body}`;
    return `${content}.${sign('RSA-SHA256',Buffer.from(content),key).toString('base64url')}`;
  }
  for (const token of [jwt({},otherKeys.privateKey),jwt({aud:'another-client'}),jwt({iss:'https://attacker.example'}),jwt({iat:now-7200,exp:now-3600})]) {
    await assert.rejects(auth.login(f.request(challenge.cookie),f.response(),{mode:'buyer',credential:token}),{status:401});
  }
  const result = await auth.login(f.request(challenge.cookie),f.response(),{mode:'buyer',credential:jwt()});
  assert.equal(result.user.sub,'signed-google-sub'); assert.equal(result.user.role,'buyer');
});

test('guest access has a separate cookie, no Google account, and cannot become Admin',async()=>{
  const f=fixture({configured:false}),res=f.response();
  const guest=await f.auth.enterGuest(f.request(),res);
  assert.equal(guest.user.role,'buyer');assert.equal(guest.user.provider,'guest');assert.equal(f.accounts.size,0);
  const cookie=f.cookie(res,'__Host-cash_guest');assert.ok(cookie);
  assert.equal((await f.auth.requireShopper(f.request(cookie))).sub,guest.user.sub);
  await assert.rejects(f.auth.requireUser(f.request(cookie),true),{status:401});
  const replayAsAdmin=cookie.replace('__Host-cash_guest=','__Host-cash_session=');
  await assert.rejects(f.auth.requireUser(f.request(replayAsAdmin),true),{status:401});
  assert.equal((await f.auth.enterGuest(f.request(cookie),f.response())).user.sub,guest.user.sub);
  f.advance(30*24*60*60*1000+1);
  await assert.rejects(f.auth.requireShopper(f.request(cookie)),{status:401});
});

test('guest access does not replace an existing Admin session in the same browser',async()=>{
  const f=fixture();const challenge=await f.challenge();f.identity(challenge.nonce,'seller@gmail.com');const adminResponse=f.response();
  await f.auth.login(f.request(challenge.cookie),adminResponse,{mode:'admin',credential:'aaa.bbb.ccc'});
  const adminCookie=f.cookie(adminResponse,'__Host-cash_session');const guestResponse=f.response();
  const guest=await f.auth.enterGuest(f.request(adminCookie),guestResponse);const guestCookie=f.cookie(guestResponse,'__Host-cash_guest');
  const both=f.request(`${adminCookie}; ${guestCookie}`);
  assert.equal((await f.auth.requireUser(both,true)).role,'admin');assert.equal((await f.auth.requireShopper(both)).role,'admin');
  both.headers['x-cash-guest']='1';assert.equal((await f.auth.requireShopper(both)).sub,guest.user.sub);
});
