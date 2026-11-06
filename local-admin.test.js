const {test} = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {mkdtemp,rm} = require('node:fs/promises');
const {DatabaseSync} = require('node:sqlite');
const {randomBytes} = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
const {createLocalAdmin,hashPassword,verifyPassword} = require('./local-admin');

async function boot(filename) {
  const child=spawn(process.execPath,['server.js'],{cwd:__dirname,env:{...process.env,PORT:'0',DATABASE_PATH:filename,DATABASE_URL:'',GOOGLE_CLIENT_ID:'',ADMIN_EMAILS:'',ADMIN_SETUP_TOKEN:'',APP_ORIGIN:'',RENDER_EXTERNAL_URL:'',RENDER:'',NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});
  const base=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(new Error('Startup timed out'));},10000);
    child.once('error',error=>{clearTimeout(timer);reject(error)});
    child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Server exited ${code}`))});
    child.stdout.on('data',chunk=>{const match=String(chunk).match(/port (\d+)/);if(match){clearTimeout(timer);resolve('http://127.0.0.1:'+match[1])}});
  });
  return {base,stop:()=>new Promise(resolve=>{child.once('exit',resolve);child.kill()})};
}
const cookieOf=response=>response.headers.getSetCookie().find(value=>value.startsWith('cash_session='))?.split(';')[0];
const credentials = () => ({username:'store.owner',name:'Store Owner',password:`Test-passphrase-${randomBytes(8).toString('hex')}`});

test('first Admin setup creates a hashed account, closes setup, and supports persistent login',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'cash-local-admin-'));const filename=path.join(directory,'test.sqlite');let service;
  try {
    service=await boot(filename);
    const get=(url,cookie)=>fetch(service.base+url,{headers:cookie?{Cookie:cookie}:{}});
    const post=(url,payload,cookie,origin)=>fetch(service.base+url,{method:'POST',headers:{Origin:origin||service.base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(payload)});
    const before=await get('/api/auth/admin/status').then(r=>r.json());
    assert.equal(before.exists,false);assert.equal(before.setupAvailable,true);assert.equal(before.tokenRequired,false);
    const owner=credentials();
    assert.equal((await post('/api/auth/admin/setup',{...owner,confirmPassword:'wrong'})).status,400);
    assert.equal((await post('/api/auth/admin/setup',{...owner,confirmPassword:owner.password},null,'https://attacker.example')).status,403);
    const response=await post('/api/auth/admin/setup',{...owner,confirmPassword:owner.password});assert.equal(response.status,200);
    const result=await response.json();assert.equal(result.user.role,'admin');assert.equal(result.user.username,owner.username);
    assert.equal(result.user.password,undefined);assert.equal(result.user.passwordHash,undefined);
    let cookie=cookieOf(response);assert.ok(cookie);assert.ok(response.headers.getSetCookie().some(value=>value.includes('HttpOnly')&&value.includes('SameSite=Strict')));
    assert.equal((await get('/api/shop',cookie)).status,200);
    assert.equal((await get('/api/shop')).status,401);
    const db=new DatabaseSync(filename);const record=db.prepare('SELECT * FROM cash_local_admin').get();
    assert.notEqual(record.password_hash,owner.password);assert.match(record.password_hash,/^scrypt-v1\$/);assert.equal(db.prepare('SELECT COUNT(*) AS count FROM cash_local_admin').get().count,1);db.close();
    const after=await get('/api/auth/admin/status').then(r=>r.json());assert.equal(after.exists,true);assert.equal(after.setupAvailable,false);assert.equal(after.user,null);
    assert.equal((await post('/api/auth/admin/setup',{...credentials(),confirmPassword:owner.password})).status,409);
    assert.equal((await post('/api/auth/logout',{},cookie)).status,200);assert.equal((await get('/api/shop',cookie)).status,401);
    assert.equal((await post('/api/auth/admin/login',{username:owner.username,password:'incorrect-password'})).status,401);
    const login=await post('/api/auth/admin/login',{username:owner.username.toUpperCase(),password:owner.password});assert.equal(login.status,200);cookie=cookieOf(login);
    await service.stop();service=await boot(filename);
    assert.equal((await get('/api/shop',cookie)).status,200,'session survives server restart');
    const again=await post('/api/auth/admin/login',{username:owner.username,password:owner.password});assert.equal(again.status,200,'password account survives restart');
    const currentCookie=cookieOf(again);const edit=new DatabaseSync(filename);edit.prepare('UPDATE cash_local_admin SET version=version+1').run();edit.close();
    assert.equal((await get('/api/shop',currentCookie)).status,401,'credential version change invalidates old sessions');
  } finally {
    if(service)await service.stop();assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(directory,{recursive:true,force:true});
  }
});

test('concurrent first-time setups cannot create a second administrator',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'cash-admin-race-'));let service;
  try {
    const filename=path.join(directory,'test.sqlite');service=await boot(filename);
    const first=credentials(),second={...credentials(),username:'second.owner'};
    const request=owner=>fetch(service.base+'/api/auth/admin/setup',{method:'POST',headers:{Origin:service.base,'Content-Type':'application/json'},body:JSON.stringify({...owner,confirmPassword:owner.password})});
    const responses=await Promise.all([request(first),request(second)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
    const db=new DatabaseSync(filename);assert.equal(db.prepare('SELECT COUNT(*) AS count FROM cash_local_admin').get().count,1);db.close();
  } finally {if(service)await service.stop();assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(directory,{recursive:true,force:true})}
});

test('password login attempts are limited in the database',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'cash-admin-limit-'));let service;
  try {
    service=await boot(path.join(directory,'test.sqlite'));
    const post=(path,payload)=>fetch(service.base+path,{method:'POST',headers:{Origin:service.base,'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const owner=credentials();await post('/api/auth/admin/setup',{...owner,confirmPassword:owner.password});
    for(let index=0;index<10;index++)assert.equal((await post('/api/auth/admin/login',{username:owner.username,password:'wrong-password'})).status,401);
    await service.stop();service=await boot(path.join(directory,'test.sqlite'));
    const blocked=await post('/api/auth/admin/login',owner);assert.equal(blocked.status,429);assert.ok(Number(blocked.headers.get('retry-after'))>0);
  } finally {if(service)await service.stop();assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(directory,{recursive:true,force:true})}
});

test('production setup requires an owner key even for a loopback request',async()=>{
  let account=null;
  const store={getLocalAdmin:async()=>account,bumpLoginLimit:async()=>({attempts:1,expires:Date.now()+600000}),clearLoginLimit:async()=>{},createLocalAdmin:async value=>{if(account)return false;account=value;return true}};
  const auth={sameOrigin:()=>{},currentUser:async()=>null,issueSession:async(_req,_res,user)=>({user})};
  const request={headers:{host:'localhost:3000'},socket:{remoteAddress:'127.0.0.1'}};
  const owner=credentials(),payload={...owner,confirmPassword:owner.password};
  const disabled=createLocalAdmin({store,auth,setupToken:'',production:true});
  assert.equal((await disabled.status(request)).setupAvailable,false);
  await assert.rejects(disabled.setup(request,{},payload),{status:503});
  const token=randomBytes(32).toString('hex');const enabled=createLocalAdmin({store,auth,setupToken:token,production:true});
  assert.equal((await enabled.status(request)).tokenRequired,true);
  await assert.rejects(enabled.setup(request,{},{...payload,setupToken:'wrong'}),{status:403});
  assert.equal((await enabled.setup(request,{},{...payload,setupToken:token})).user.role,'admin');
});

test('scrypt uses a fresh salt and never accepts an incorrect password',async()=>{
  const password=credentials().password;const first=await hashPassword(password),second=await hashPassword(password);
  assert.notEqual(first,second);assert.equal(await verifyPassword(password,first),true);assert.equal(await verifyPassword('wrong',first),false);
});
