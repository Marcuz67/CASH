const http = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { openStore, validateState } = require('./database');
const { initializeCatalog, publicCatalog, recordPurchase } = require('./catalog');
const { createAuth } = require('./auth');
const { createLocalAdmin } = require('./local-admin');
const { createLocalBuyer } = require('./local-buyer');
let store;
let auth;
let localAdmin;
let localBuyer;

async function jsonBody(request, limit = 8 * 1024 * 1024) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('Use application/json.'), { status: 415 });
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('The request is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
}

const publicDirectory = path.join(__dirname, 'THECASH', 'outputs');
const files = new Map([
  ['/buyer', ['buyer.html', 'text/html; charset=utf-8']],
  ['/buyer.html', ['buyer.html', 'text/html; charset=utf-8']],
  ['/admin', ['admin.html', 'text/html; charset=utf-8']],
  ['/admin.html', ['admin.html', 'text/html; charset=utf-8']],
  ['/seller', ['admin.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);
for (const product of ['rice', 'milk', 'eggs', 'bread', 'water', 'noodles', 'coffee', 'soap']) {
  files.set(`/assets/products/${product}.png`, [`assets/products/${product}.png`, 'image/png']);
}

const server = http.createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (!['GET', 'HEAD', 'PUT', 'POST'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }
  let pathname;
  try {
    pathname = new URL(request.url, 'http://localhost').pathname;
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }
  if (['/', '/index.html'].includes(pathname) && ['GET','HEAD'].includes(request.method)) {
    response.writeHead(302, { Location: '/buyer', 'Cache-Control': 'no-store' });
    response.end(); return;
  }
  if (pathname.startsWith('/api/auth/')) {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    try {
      let result;
      if (pathname === '/api/auth/buyer/status' && request.method === 'GET') result = await localBuyer.status(request);
      else if (pathname === '/api/auth/buyer/register' && request.method === 'POST') result = await localBuyer.register(request,response,await jsonBody(request,20000));
      else if (pathname === '/api/auth/buyer/login' && request.method === 'POST') result = await localBuyer.login(request,response,await jsonBody(request,20000));
      else if (pathname === '/api/auth/buyer/logout' && request.method === 'POST') result = await auth.buyerLogout(request,response);
      else if (pathname === '/api/auth/admin/status' && request.method === 'GET') result = await localAdmin.status(request);
      else if (pathname === '/api/auth/admin/setup' && request.method === 'POST') result = await localAdmin.setup(request, response, await jsonBody(request, 20000));
      else if (pathname === '/api/auth/admin/login' && request.method === 'POST') result = await localAdmin.login(request, response, await jsonBody(request, 20000));
      else if (pathname === '/api/auth/session' && request.method === 'GET') result = await auth.session(request, response);
      else if (pathname === '/api/auth/google' && request.method === 'POST') result = await auth.login(request, response, await jsonBody(request, 20000));
      else if (pathname === '/api/auth/logout' && request.method === 'POST') result = await auth.logout(request, response);
      else { response.writeHead(404); response.end(JSON.stringify({ error: 'Not found.' })); return; }
      response.end(JSON.stringify(result));
    } catch (error) {
      if (error.retryAfter) response.setHeader('Retry-After',String(error.retryAfter));
      response.writeHead(error.status || 503);
      response.end(JSON.stringify({ error: error.status ? error.message : 'Sign-in is temporarily unavailable. Please try again.' }));
    }
    return;
  }
  if (['/api/shop', '/api/catalog', '/api/sales', '/api/my-purchases'].includes(pathname)) {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    try {
      const user = pathname === '/api/shop' ? await auth.requireUser(request,true) : await auth.requireShopper(request);
      if (pathname === '/api/my-purchases') {
        if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }); response.end(); return; }
        const data = await store.read();
        const purchases = data.state.activity.filter(sale => sale.buyerId === user.sub).map(({ unitCost, grossProfit, buyerId, ...receipt }) => receipt);
        response.end(JSON.stringify({ purchases })); return;
      }
      if (request.method === 'GET' && pathname !== '/api/sales') {
        const data = await store.read();
        response.end(JSON.stringify(pathname === '/api/catalog' ? publicCatalog(data) : data));
        return;
      }
      const purchasing = pathname === '/api/sales';
      if (pathname === '/api/catalog' || request.method !== (purchasing ? 'POST' : 'PUT')) {
        response.writeHead(405, { Allow: pathname === '/api/catalog' ? 'GET' : purchasing ? 'POST' : 'GET, PUT' }); response.end(); return;
      }
      auth.sameOrigin(request);
      const payload = await jsonBody(request);
      if (purchasing) {
        const current = await store.read();
        const purchase = recordPurchase(current, payload, user);
        if (purchase.error) {
          response.writeHead(purchase.status); response.end(JSON.stringify({ error: purchase.error })); return;
        }
        if (!validateState(purchase.state)) {
          response.writeHead(400); response.end(JSON.stringify({ error: 'This purchase would exceed the supported stock or amount limits.' })); return;
        }
        const revision = await store.save(purchase.state, current.revision);
        if (revision === null) {
          response.writeHead(409); response.end(JSON.stringify({ error: 'Stock changed on another page. Review and try again.' })); return;
        }
        response.end(JSON.stringify({ revision, receipt: purchase.receipt })); return;
      }
      if (!payload || !Number.isSafeInteger(payload.revision) || payload.revision < 0 || !validateState(payload.state)) {
        response.writeHead(400); response.end(JSON.stringify({ error: 'Invalid shop data.' })); return;
      }
      const revision = await store.save(payload.state, payload.revision);
      if (revision === null) {
        response.writeHead(409);
        response.end(JSON.stringify({ error: 'Another page updated the shop. Refresh and try again.' })); return;
      }
      response.end(JSON.stringify({ revision }));
    } catch (error) {
      if (!error.status) console.error('Database request failed:', error.code || error.name);
      response.writeHead(error.status || 503);
      response.end(JSON.stringify({ error: error.status ? error.message : 'Database unavailable. Please try again.' }));
    }
    return;
  }
  if (request.method === 'PUT' || request.method === 'POST') {
    response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return;
  }
  if (pathname === '/health') {
    try {
      await store.read();
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok', database: store.kind }));
    } catch {
      response.writeHead(503); response.end();
    }
    return;
  }
  if (pathname === '/CASH.html' || pathname === '/CASH') {
    response.writeHead(302, { Location: '/' });
    response.end();
    return;
  }
  const asset = files.get(pathname);
  if (!asset) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(request.method === 'HEAD' ? undefined : 'Not found');
    return;
  }
  try {
    const body = await readFile(path.join(publicDirectory, asset[0]));
    response.writeHead(200, {
      'Content-Type': asset[1],
      'Content-Length': body.length,
      'Cache-Control': asset[1] === 'image/png' ? 'public, max-age=86400' : 'no-cache',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    console.error('Could not serve asset:', asset[0], error.code);
    response.writeHead(500);
    response.end();
  }
});

const port = Number(process.env.PORT || 3000);
openStore().then(async database => {
  store = database;
  auth = createAuth({ store });
  localAdmin = createLocalAdmin({ store,auth });
  localBuyer = createLocalBuyer({ store,auth });
  await initializeCatalog(store);
  server.listen(port, '0.0.0.0', () => {
    console.log(`C.A.S.H. listening on port ${server.address().port}`);
  });
}).catch(error => {
  console.error('Database startup failed:', error.code || error.message);
  process.exitCode = 1;
});
