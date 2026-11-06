const {randomUUID,randomBytes,createHash} = require('node:crypto');
const {hashPassword,verifyPassword} = require('./local-admin');
const fail=(status,message)=>Object.assign(new Error(message),{status});

function createLocalBuyer({store,auth,now=Date.now}) {
  const dummyHash=hashPassword(randomBytes(32).toString('hex'));
  async function limit(request,action,username='') {
    const key=createHash('sha256').update(`${action}:${request.socket?.remoteAddress || 'unknown'}:${username}`).digest('hex');
    const result=await store.bumpLoginLimit(key,now(),now()+10*60*1000);
    const maximum=action==='buyer-login-total'?50:10;
    if(result.attempts>maximum)throw Object.assign(fail(429,'Too many attempts. Please try again in ten minutes.'),{retryAfter:Math.max(1,Math.ceil((result.expires-now())/1000))});
    return key;
  }
  async function status(request) {
    const user=await auth.currentBuyer(request);
    return {user:user?{sub:user.sub,username:user.username,name:user.name,role:'buyer'}:null};
  }
  async function register(request,response,payload) {
    auth.sameOrigin(request);
    await limit(request,'buyer-register');
    const username=typeof payload?.username==='string'?payload.username.trim().toLowerCase():'';
    const name=typeof payload?.name==='string'?payload.name.trim():'';
    const password=payload?.password;
    if(!/^[a-z0-9_.-]{3,40}$/.test(username))throw fail(400,'Use a username of 3-40 letters, numbers, dots, hyphens, or underscores.');
    if(!name || name.length>80)throw fail(400,'Enter your name (up to 80 characters).');
    if(typeof password!=='string' || password.length<12 || password.length>128)throw fail(400,'Use a password of 12-128 characters.');
    if(password!==payload.confirmPassword)throw fail(400,'The passwords do not match.');
    const id=randomUUID();const passwordHash=await hashPassword(password);
    if(!(await store.createBuyer({id,username,name,passwordHash})))throw fail(409,'That username is already taken. Choose another or sign in.');
    const account=await store.getBuyerById(id);
    return auth.issueBuyerSession(request,response,account);
  }
  async function login(request,response,payload) {
    auth.sameOrigin(request);
    await limit(request,'buyer-login-total');
    const username=typeof payload?.username==='string'?payload.username.trim().toLowerCase():'';
    const key=await limit(request,'buyer-login',username.slice(0,40));
    const password=payload?.password;
    if(!/^[a-z0-9_.-]{3,40}$/.test(username) || typeof password!=='string' || password.length>128)throw fail(401,'The username or password is incorrect.');
    const account=await store.getBuyerByUsername(username);
    const valid=await verifyPassword(password,account?.password_hash || await dummyHash);
    if(!account || !valid)throw fail(401,'The username or password is incorrect.');
    await store.clearLoginLimit(key);
    return auth.issueBuyerSession(request,response,account);
  }
  return {status,register,login};
}

module.exports={createLocalBuyer};
