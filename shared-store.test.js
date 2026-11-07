const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { randomBytes, createHash } = require('node:crypto');

async function boot(filename) {
  let temporary;
  if (filename === ':memory:') { temporary = await mkdtemp(path.join(os.tmpdir(), 'cash-auth-test-')); filename = path.join(temporary, 'test.sqlite'); }
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: '0', DATABASE_PATH: filename, DATABASE_URL: '', RENDER: '', NODE_ENV: 'test', GOOGLE_CLIENT_ID: 'cash-test.apps.googleusercontent.com', ADMIN_EMAILS: 'admin@gmail.com', APP_ORIGIN: '', RENDER_EXTERNAL_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Server startup timed out')); }, 10000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited: ${code}`)); });
    child.stdout.on('data', chunk => {
      const match = String(chunk).match(/port (\d+)/);
      if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`); }
    });
  });
  const db = new DatabaseSync(filename);
  const token = randomBytes(32).toString('hex');
  const buyerToken = randomBytes(32).toString('hex');
  const secondBuyerToken = randomBytes(32).toString('hex');
  for (const [raw, sub, email, eligible] of [[token,'seller-1','admin@gmail.com',true],[buyerToken,'buyer-1','buyer@gmail.com',true],[secondBuyerToken,'buyer-2','second@gmail.com',true]]) {
    db.prepare('INSERT INTO cash_sessions (token_hash,identity,expires_at) VALUES (?,?,?)').run(createHash('sha256').update(raw).digest('hex'), JSON.stringify({ purpose:'account', user:{sub,email,name:sub,sellerEligible:eligible} }), Date.now()+3600000);
  }
  db.close();
  const request = (route, options = {}) => fetch(base + route, { ...options, headers: { Cookie: `cash_session=${token}`, Origin: base, ...options.headers } });
  return { base, fetch: request, buyerCookie: `cash_session=${buyerToken}`, secondBuyerCookie: `cash_session=${secondBuyerToken}`,
    stop: async () => { await new Promise(resolve => { child.once('exit', resolve); child.kill(); }); if (temporary) { assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep)); await rm(temporary, { recursive:true, force:true }); } } };

}

test('buyer and admin share durable state and concurrent writes cannot overwrite each other', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cash-store-test-'));
  const filename = path.join(directory, 'test.sqlite');
  let service;
  try {
    service = await boot(filename);
    for (const route of ['/', '/buyer', '/admin', '/app.js', '/styles.css', '/health']) {
      assert.equal((await fetch(service.base + route)).status, 200, route);
    }
    for (const route of ['/database.js', '/.env', '/data/cash.sqlite']) {
      assert.equal((await fetch(service.base + route)).status, 404);
    }
    const read = () => service.fetch('/api/shop').then(response => response.json());
    const save = payload => service.fetch('/api/shop', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const initial = await read();
    assert.equal(initial.state.products.length, 8);
    assert.equal(initial.state.starterCatalogVersion, 1);
    const state = {
      products: [{ id: 'p1', name: 'Milk', category: 'Drinks', price: 20, cost: 10, stock: 5, sold: 0, threshold: 1 }],
      activity: [], weekByDay: [0, 0, 0, 0, 0, 0, 0], weekProfitByDay: [0, 0, 0, 0, 0, 0, 0],
      weekUnits: 0, lifetimeGrossProfit: 0, profile: { owner: 'Owner', store: 'Test shop', location: '' },
      profitGoals: { redBelow: 2000, goodFrom: 3000 }, starterCatalogVersion: 1, productPhotosVersion: 1,
    };
    assert.equal((await save({ state, revision: initial.revision })).status, 200);
    assert.equal((await save(null)).status, 400);
    const invalid = structuredClone(state); invalid.products[0].stock = -1;
    assert.equal((await save({ state: invalid, revision: initial.revision + 1 })).status, 400);
    const purchase = structuredClone(state);
    purchase.products[0].stock -= 2; purchase.products[0].sold += 2;
    purchase.activity.push({ name: 'Milk', qty: 2, date: Date.now(), unitPrice: 20, unitCost: 10, revenue: 40, grossProfit: 20 });
    const responses = await Promise.all([save({ state: purchase, revision: initial.revision + 1 }), save({ state, revision: initial.revision + 1 })]);
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    const stored = await read(); assert.equal(stored.revision, initial.revision + 2);
    // Two independent HTTP clients see the exact same records.
    assert.deepEqual(await read(), stored);
    await service.stop(); service = await boot(filename);
    assert.deepEqual(await read(), stored, 'records survive server restart');
  } finally {
    if (service) await service.stop();
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(directory, { recursive: true, force: true });
  }
});


test('server enforces offered products, stock, prices, and concurrent purchases', async (t) => {
  const service = await boot(':memory:');
  t.after(() => service.stop());
  const read = () => service.fetch('/api/shop').then(response => response.json());
  const put = (data) => service.fetch('/api/shop', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const buy = (data) => service.fetch('/api/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  let current = await read();
  const product = current.state.products[0];
  product.stock = 3; product.saleLimit = 1; product.saleEnabled = false;
  assert.equal((await put(current)).status, 200);
  let catalog = await service.fetch('/api/catalog').then(response => response.json());
  assert.ok(!catalog.state.products.some(item => item.id === product.id));
  assert.ok(catalog.state.products.every(item => item.cost === undefined && item.sold === undefined && item.saleLimit === undefined));
  assert.equal(catalog.state.activity, undefined);
  assert.equal((await buy({ productId: product.id, quantity: 1, revision: catalog.revision })).status, 400);
  current = await read(); current.state.products[0].saleEnabled = true;
  assert.equal((await put(current)).status, 200);
  current = await read();
  for (const quantity of [0, -1, 1.5, 4, 100]) {
    assert.equal((await buy({ productId: product.id, quantity, revision: current.revision })).status, 400);
  }
  const purchase = await buy({ productId: product.id, quantity: 2, revision: current.revision, price: 0, unitCost: 0 });
  assert.equal(purchase.status, 200);
  const receipt = (await purchase.json()).receipt;
  assert.equal(receipt.revenue, product.price * 2);
  assert.equal(receipt.unitCost, undefined); assert.equal(receipt.grossProfit, undefined);
  current = await read(); assert.equal(current.state.products[0].stock, 1);
  assert.equal(current.state.activity[0].unitCost, product.cost);
  // A legacy saleLimit value must not cap purchases; stock remains the limit.
  current.state.products[0].stock = 3;
  assert.equal((await put(current)).status, 200);
  current = await read();
  // Two simultaneous requests with one revision: exactly one can deduct stock.
  const responses = await Promise.all([buy({ productId: product.id, quantity: 2, revision: current.revision }), buy({ productId: product.id, quantity: 2, revision: current.revision })]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  current = await read(); assert.equal(current.state.products[0].stock, 1);
  assert.equal((await buy({ productId: product.id, quantity: 2, revision: current.revision })).status, 400);
  // An intentionally empty shop stays empty.
  current.state.products = []; assert.equal((await put(current)).status, 200);
  assert.equal((await read()).state.products.length, 0);
});


test('Google account sessions enforce buyer/seller separation and purchase ownership', async (t) => {
  const service = await boot(':memory:'); t.after(() => service.stop());
  assert.equal((await fetch(service.base + '/api/shop')).status, 401);
  assert.equal((await fetch(service.base + '/api/catalog')).status, 401);
  const buyerHeaders = { Cookie: service.buyerCookie, Origin: service.base, 'Content-Type': 'application/json' };
  assert.equal((await fetch(service.base + '/api/shop', { headers: buyerHeaders })).status, 403);
  assert.equal((await fetch(service.base + '/api/shop', { method: 'PUT', headers: buyerHeaders, body: '{}' })).status, 403);
  const catalog = await fetch(service.base + '/api/catalog', { headers: buyerHeaders }).then(r => r.json());
  const product = catalog.state.products[0];
  const purchase = await fetch(service.base + '/api/sales', { method: 'POST', headers: buyerHeaders,
    body: JSON.stringify({ productId:product.id, quantity:1, revision:catalog.revision, buyerId:'forged-owner' }) });
  assert.equal(purchase.status, 200);
  const own = await fetch(service.base + '/api/my-purchases', { headers:buyerHeaders }).then(r => r.json());
  assert.equal(own.purchases.length,1); assert.equal(own.purchases[0].unitCost, undefined); assert.equal(own.purchases[0].grossProfit,undefined);
  const other = await fetch(service.base + '/api/my-purchases', { headers:{Cookie:service.secondBuyerCookie} }).then(r=>r.json());
  assert.equal(other.purchases.length,0);
  const full = await service.fetch('/api/shop').then(r=>r.json()); assert.equal(full.state.activity[0].buyerId,'buyer-1');
  const unsafe = await service.fetch('/api/shop', {method:'PUT',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:JSON.stringify(full)});
  assert.equal(unsafe.status,403);
  const cookie = service.buyerCookie;
  assert.equal((await fetch(service.base+'/api/auth/logout',{method:'POST',headers:buyerHeaders,body:'{}'})).status,200);
  assert.equal((await fetch(service.base+'/api/catalog',{headers:{Cookie:cookie}})).status,401);
});

test('bundled product images are served locally and unknown asset paths are rejected', async (t) => {
  const service = await boot(':memory:'); t.after(() => service.stop());
  for (const name of ['rice','milk','eggs','bread','water','noodles','coffee','soap']) {
    const response = await fetch(`${service.base}/assets/products/${name}.png`);
    assert.equal(response.status,200); assert.equal(response.headers.get('content-type'),'image/png');
    assert.equal(response.headers.get('cache-control'),'public, max-age=86400');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  }
  assert.equal((await fetch(service.base+'/assets/products/missing.png')).status,404);
  assert.equal((await fetch(service.base+'/assets/products/../../database.js')).status,404);
});

test('photo migration keeps uploaded images, stock, sales, and later photo removals', async () => {
  const { initializeCatalog } = require('./catalog');
  const custom = 'data:image/png;base64,AAAA';
  let current = { revision:8,state:{ starterCatalogVersion:1, products:[
    {id:'sample_rice',name:'Rice',stock:23,price:99},
    {id:'sample_milk',name:'Milk',stock:7,photo:custom,saleEnabled:false},
    {id:'custom-product',name:'My product',stock:2},
  ],activity:[{id:'old-sale',qty:2}] } };
  const store={read:async()=>structuredClone(current),save:async(state,revision)=>{
    if(revision!==current.revision)return null;
    current={state:structuredClone(state),revision:revision+1};return current.revision;
  }};
  await initializeCatalog(store);
  assert.equal(current.state.products[0].photo,'/assets/products/rice.png');
  assert.equal(current.state.products[0].stock,23);assert.equal(current.state.products[0].price,99);
  assert.equal(current.state.products[1].photo,custom);assert.equal(current.state.products[1].saleEnabled,false);
  assert.equal(current.state.products[2].photo,undefined);assert.equal(current.state.activity.length,1);
  const revision=current.revision;
  delete current.state.products[0].photo;
  await initializeCatalog(store);
  assert.equal(current.revision,revision);assert.equal(current.state.products[0].photo,undefined);
});

test('Buyer login and Admin login serve distinct HTML pages without mixed options', async (t) => {
  const service = await boot(':memory:'); t.after(() => service.stop());
  const home = await fetch(service.base+'/').then(response=>response.text());
  const buyer = await fetch(service.base+'/buyer').then(response=>response.text());
  const admin = await fetch(service.base+'/admin').then(response=>response.text());
  for (const route of ['/', '/index.html']) {
    const redirect = await fetch(service.base+route,{redirect:'manual'});
    assert.equal(redirect.status,302);assert.equal(redirect.headers.get('location'),'/buyer');
    const head = await fetch(service.base+route,{method:'HEAD',redirect:'manual'});
    assert.equal(head.status,302);assert.equal(head.headers.get('location'),'/buyer');
  }
  assert.notEqual(buyer,admin);
  assert.match(buyer,/<title>Buyer login \| C\.A\.S\.H\.<\/title>/);
  assert.match(admin,/<title>Admin login \| C\.A\.S\.H\.<\/title>/);
  for (const html of [buyer,admin]) {
    const login=html.slice(html.indexOf('<section id="signInScreen"'),html.indexOf('<div id="workspace"'));
    assert.equal(login.includes('id="enterDemo"'), html === admin);
  }
  assert.equal(home,buyer);
  assert.ok(!buyer.includes('href="/admin"'));assert.ok(!buyer.includes('href="/seller"'));assert.ok(!buyer.includes('Switch workspace'));assert.ok(!buyer.includes('Choose a workspace'));
  assert.ok(!admin.includes('href="/buyer"'));assert.ok(!admin.includes('href="/"'));assert.ok(!admin.includes('Switch workspace'));
  assert.equal(await fetch(service.base+'/buyer.html').then(r=>r.text()),buyer);
  assert.equal(await fetch(service.base+'/admin.html').then(r=>r.text()),admin);
});

test('guest endpoints are removed and signed-out visitors cannot shop or read receipts',async(t)=>{
  const service=await boot(':memory:');t.after(()=>service.stop());
  const cookie='cash_guest='+'a'.repeat(64);
  const headers={Cookie:cookie,'X-Cash-Guest':'1',Origin:service.base,'Content-Type':'application/json'};
  assert.equal((await fetch(service.base+'/api/auth/guest',{method:'POST',headers,body:'{}'})).status,404);
  assert.equal((await fetch(service.base+'/api/auth/guest/session',{headers})).status,404);
  for(const route of ['/api/catalog','/api/my-purchases','/api/shop']){
    assert.equal((await fetch(service.base+route)).status,401);
    assert.equal((await fetch(service.base+route,{headers})).status,401);
  }
  assert.equal((await fetch(service.base+'/api/sales',{method:'POST',headers,body:'{}'})).status,401);
  const buyer=await fetch(service.base+'/buyer').then(r=>r.text());
  assert.ok(!buyer.includes('Continue as guest'));assert.ok(!buyer.includes('id="enterDemo"'));
  assert.ok(buyer.includes('id="buyerPasswordForm"'));assert.ok(buyer.includes('Create an account'));
});
