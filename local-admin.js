const { scrypt, randomBytes, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const derive = promisify(scrypt);
const options = { N:32768,r:8,p:1,maxmem:64*1024*1024 };
const fail = (status,message) => Object.assign(new Error(message),{status});
const digest = value => createHash('sha256').update(value).digest();

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password,salt,64,options);
  return `scrypt-v1$${salt}$${key.toString('hex')}`;
}
async function verifyPassword(password, encoded) {
  const [version,salt,hash] = String(encoded).split('$');
  if (version !== 'scrypt-v1' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(hash || '')) return false;
  const key = await derive(password,salt,64,options);
  return timingSafeEqual(key,Buffer.from(hash,'hex'));
}

function createLocalAdmin({store,auth,setupToken=process.env.ADMIN_SETUP_TOKEN || '',
  production=Boolean(process.env.RENDER || process.env.NODE_ENV === 'production'),now=Date.now}) {
  const dummyHash = hashPassword(randomBytes(32).toString('hex'));
  const tokenConfigured = setupToken.length >= 32;
  function localSetup(request) {
    if (production || !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.socket?.remoteAddress)) return false;
    try { return ['localhost','127.0.0.1','[::1]'].includes(new URL(`http://${request.headers.host}`).hostname); }
    catch { return false; }
  }
  async function limit(request, action) {
    // Use the network peer, not client-supplied forwarding headers. One shared limit also
    // protects the single admin account if several app instances receive attempts.
    const key = createHash('sha256').update(`${action}:${request.socket?.remoteAddress || 'unknown'}`).digest('hex');
    const result = await store.bumpLoginLimit(key,now(),now()+10*60*1000);
    if (result.attempts > 10) throw Object.assign(fail(429,'Too many attempts. Please try again in ten minutes.'),{retryAfter:Math.max(1,Math.ceil((result.expires-now())/1000))});
    return key;
  }
  async function status(request) {
    const account = await store.getLocalAdmin();
    const user = await auth.currentUser(request);
    return { exists:Boolean(account),setupAvailable:!account && (tokenConfigured || localSetup(request)),
      tokenRequired:!localSetup(request), user:user?.role === 'admin' ? {sub:user.sub,name:user.name,username:user.username,email:user.email,role:'admin'} : null };
  }
  async function setup(request,response,payload) {
    auth.sameOrigin(request);
    const key = await limit(request,'admin-setup');
    if (await store.getLocalAdmin()) throw fail(409,'An Admin account already exists. Sign in instead.');
    if (!localSetup(request)) {
      if (!tokenConfigured) throw fail(503,'First-time Admin setup has not been enabled by the store owner.');
      if (typeof payload?.setupToken !== 'string' || payload.setupToken.length > 512 || !timingSafeEqual(digest(payload.setupToken),digest(setupToken))) throw fail(403,'The setup key is incorrect.');
    }
    const username = String(payload?.username || '').trim().toLowerCase();
    const name = String(payload?.name || '').trim();
    const password = payload?.password;
    if (!/^[a-z0-9_.-]{3,40}$/.test(username)) throw fail(400,'Use a username of 3-40 letters, numbers, dots, hyphens, or underscores.');
    if (!name || name.length > 80) throw fail(400,'Enter your display name (up to 80 characters).');
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw fail(400,'Use a password of 12-128 characters.');
    if (password !== payload.confirmPassword) throw fail(400,'The passwords do not match.');
    const passwordHash = await hashPassword(password);
    if (!(await store.createLocalAdmin({username,name,passwordHash}))) throw fail(409,'An Admin account was just created. Sign in instead.');
    await store.clearLoginLimit(key);
    return auth.issueSession(request,response,{sub:'local-admin:1',provider:'local-admin',username,name,version:1,role:'admin'});
  }
  async function login(request,response,payload) {
    auth.sameOrigin(request);
    const key = await limit(request,'admin-login');
    const username = typeof payload?.username === 'string' ? payload.username.trim().toLowerCase() : '';
    const password = payload?.password;
    if (typeof password !== 'string' || password.length > 128 || !/^[a-z0-9_.-]{3,40}$/.test(username)) throw fail(401,'The username or password is incorrect.');
    const account = await store.getLocalAdmin();
    const valid = await verifyPassword(password,account?.password_hash || await dummyHash);
    if (!account || account.username !== username || !valid) throw fail(401,'The username or password is incorrect.');
    await store.clearLoginLimit(key);
    return auth.issueSession(request,response,{sub:`local-admin:${account.id}`,provider:'local-admin',username:account.username,name:account.display_name,version:account.version,role:'admin'});
  }
  return {status,setup,login};
}

module.exports = {createLocalAdmin,hashPassword,verifyPassword};
