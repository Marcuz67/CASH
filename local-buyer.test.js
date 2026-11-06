const {test} = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {mkdtemp,rm} = require('node:fs/promises');
const {DatabaseSync} = require('node:sqlite');
const {randomBytes} = require('node:crypto');
const path = require('node:path');
const os = require('node:os');

async function boot(filename) {
  const child=spawn(process.execPath,['server.js'],{cwd:__dirname,env:{...process.env,PORT:'0',DATABASE_PATH:filename,DATABASE_URL:'',GOOGLE_CLIENT_ID:'',ADMIN_EMAILS:'',ADMIN_SETUP_TOKEN:'',APP_ORIGIN:'',RENDER_EXTERNAL_URL:'',RENDER:'',NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});
  const base=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(new Error('Startup timed out'))},10000);
    child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Server exited ${code}`))});
    child.stdout.on('data',chunk=>{const match=String(chunk).match(/port (\d+)/);if(match){clearTimeout(timer);resolve('http://127.0.0.1:'+match[1])}});
  });
  return {base,stop:()=>new Promise(resolve=>{child.once('exit',resolve);child.kill()})};
}
const cookieOf=(response,name='cash_buyer')=>response.headers.getSetCookie().find(value=>value.startsWith(name+'='))?.split(';')[0];
const account=(username='buyer.one')=>({username,name:'Test Buyer',password:'Private-test-'+randomBytes(12).toString('hex')});
async function fixture(t) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'cash-buyer-test-')),filename=path.join(directory,'test.sqlite');let server=await boot(filename);
  t.after(async()=>{await server.stop();assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(directory,{recursive:true,force:true})});
  return {filename,get base(){return server.base},
    post(route,payload,cookie,extra={}){return fetch(server.base+route,{method:'POST',headers:{Origin:server.base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...extra},body:JSON.stringify(payload)})},
    get(route,cookie,extra={}){return fetch(server.base+route,{headers:{...(cookie?{Cookie:cookie}:{}),...extra}})},
    async restart(){await server.stop();server=await boot(filename)} };
}

test('Buyer registration stores hashed credentials and account receipts survive restart and device changes',async(t)=>{
  const f=await fixture(t),first=account();
  assert.equal((await f.post('/api/auth/buyer/register',{...first,confirmPassword:'wrong'})).status,400);
  const response=await f.post('/api/auth/buyer/register',{...first,confirmPassword:first.password,role:'admin',provider:'local-admin'});
  assert.equal(response.status,200);let cookie=cookieOf(response);assert.ok(cookie);
  assert.ok(response.headers.getSetCookie().some(value=>value.includes('HttpOnly')&&value.includes('SameSite=Strict')));
  const result=await response.json();assert.equal(result.user.role,'buyer');assert.equal(result.user.username,first.username);assert.equal(result.user.password,undefined);assert.equal(result.user.passwordHash,undefined);
  const db=new DatabaseSync(f.filename);const stored=db.prepare('SELECT * FROM cash_buyers').get();
  assert.notEqual(stored.password_hash,first.password);assert.match(stored.password_hash,/^scrypt-v1\$/);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cash_local_admin').get().n,0);db.close();
  assert.equal((await f.get('/api/shop',cookie)).status,401);
  const header={'X-Cash-Buyer':'1'};
  const catalog=await f.get('/api/catalog',cookie,header).then(r=>r.json());const product=catalog.state.products[0];
  assert.equal((await f.post('/api/sales',{productId:product.id,quantity:1,revision:catalog.revision,buyerId:'somebody-else'},cookie,header)).status,200);
  let purchases=await f.get('/api/my-purchases',cookie,header).then(r=>r.json());assert.equal(purchases.purchases.length,1);assert.equal(purchases.purchases[0].unitCost,undefined);
  await f.restart();assert.equal((await f.get('/api/catalog',cookie,header)).status,200,'existing session persists');
  const newDevice=await f.post('/api/auth/buyer/login',{username:first.username.toUpperCase(),password:first.password});assert.equal(newDevice.status,200);const secondCookie=cookieOf(newDevice);
  purchases=await f.get('/api/my-purchases',secondCookie,header).then(r=>r.json());assert.equal(purchases.purchases.length,1,'same account sees its receipts on another device');
  assert.equal((await f.post('/api/auth/buyer/logout',{},secondCookie)).status,200);assert.equal((await f.get('/api/catalog',secondCookie,header)).status,401);
  assert.equal((await f.get('/api/catalog',cookie,header)).status,200,'logging out one device does not revoke another device');
});

test('Buyers have unique usernames, private purchases, and cannot claim Admin permissions',async(t)=>{
  const f=await fixture(t),first=account(),second=account('buyer.two');
  const register=async user=>f.post('/api/auth/buyer/register',{...user,confirmPassword:user.password});
  const firstCookie=cookieOf(await register(first));
  assert.equal((await register({...first,username:first.username.toUpperCase()})).status,409);
  const secondCookie=cookieOf(await register(second));const header={'X-Cash-Buyer':'1'};
  const catalog=await f.get('/api/catalog',firstCookie,header).then(r=>r.json());
  await f.post('/api/sales',{productId:catalog.state.products[0].id,quantity:1,revision:catalog.revision},firstCookie,header);
  const other=await f.get('/api/my-purchases',secondCookie,header).then(r=>r.json());assert.equal(other.purchases.length,0);
  assert.equal((await f.post('/api/auth/admin/login',{username:first.username,password:first.password},firstCookie)).status,401);
  assert.equal((await f.post('/api/auth/buyer/register',{...account('cross.site'),confirmPassword:'invalid'},null,{Origin:'https://attacker.example'})).status,403);
  assert.equal((await f.post('/api/auth/buyer/login',{username:first.username,password:first.password},null,{Origin:'https://attacker.example'})).status,403);
});

test('concurrent Buyer signup cannot duplicate a username',async(t)=>{
  const f=await fixture(t),first=account('same.name'),second=account('SAME.NAME');
  const responses=await Promise.all([first,second].map(user=>f.post('/api/auth/buyer/register',{...user,confirmPassword:user.password})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const db=new DatabaseSync(f.filename);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cash_buyers').get().n,1);db.close();
});

test('Buyer and Admin login can coexist without replacing or sharing privileges',async(t)=>{
  const f=await fixture(t),owner=account('same.owner'),buyer=account('same.owner');
  const adminResponse=await f.post('/api/auth/admin/setup',{...owner,confirmPassword:owner.password});assert.equal(adminResponse.status,200);const adminCookie=cookieOf(adminResponse,'cash_session');
  const buyerResponse=await f.post('/api/auth/buyer/register',{...buyer,confirmPassword:buyer.password},adminCookie);assert.equal(buyerResponse.status,200);const buyerCookie=cookieOf(buyerResponse);
  assert.ok(buyerResponse.headers.getSetCookie().every(value=>!value.startsWith('cash_session=')));
  const both=adminCookie+'; '+buyerCookie;
  assert.equal((await f.get('/api/shop',adminCookie)).status,200);
  assert.equal((await f.get('/api/shop',buyerCookie)).status,401);
  assert.equal((await f.post('/api/auth/admin/login',{username:owner.username,password:buyer.password})).status,401);
  assert.equal((await f.post('/api/auth/buyer/login',{username:buyer.username,password:owner.password})).status,401);
  const catalog=await f.get('/api/catalog',both,{'X-Cash-Buyer':'1'}).then(r=>r.json());
  await f.post('/api/sales',{productId:catalog.state.products[0].id,quantity:1,revision:catalog.revision},both,{'X-Cash-Buyer':'1'});
  const full=await f.get('/api/shop',both).then(r=>r.json());assert.ok(full.state.activity[0].buyerId.startsWith('local-buyer:'));
  await f.post('/api/auth/buyer/logout',{},both);assert.equal((await f.get('/api/shop',adminCookie)).status,200);
  assert.equal((await f.get('/api/catalog',buyerCookie,{'X-Cash-Buyer':'1'})).status,401);
});

test('failed Buyer login attempts are limited across server restarts',async(t)=>{
  const f=await fixture(t),buyer=account();await f.post('/api/auth/buyer/register',{...buyer,confirmPassword:buyer.password});
  for(let i=0;i<10;i++)assert.equal((await f.post('/api/auth/buyer/login',{username:buyer.username,password:'incorrect-pass'})).status,401);
  await f.restart();const blocked=await f.post('/api/auth/buyer/login',buyer);assert.equal(blocked.status,429);assert.ok(Number(blocked.headers.get('retry-after'))>0);
});
