const http = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { openStore, validateState } = require('./database');
let store;

const publicDirectory = path.join(__dirname, 'THECASH', 'outputs');
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/buyer', ['index.html', 'text/html; charset=utf-8']],
  ['/admin', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

const server = http.createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'HEAD', 'PUT'].includes(request.method)) {
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
  if (pathname === '/api/shop') {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    try {
      if (request.method === 'GET') {
        response.end(JSON.stringify(await store.read()));
        return;
      }
      if (request.method !== 'PUT') {
        response.writeHead(405, { Allow: 'GET, PUT' }); response.end(); return;
      }
      // Require JSON so a third-party HTML form cannot submit a store update.
      if (!request.headers['content-type']?.startsWith('application/json')) {
        response.writeHead(415); response.end(); return;
      }
      let size = 0;
      const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) {
          response.writeHead(413); response.end(JSON.stringify({ error: 'Shop data is too large.' })); return;
        }
        chunks.push(chunk);
      }
      let payload;
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { response.writeHead(400); response.end(JSON.stringify({ error: 'Invalid JSON.' })); return; }
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
      console.error('Database request failed:', error.code || error.name);
      response.writeHead(503); response.end(JSON.stringify({ error: 'Database unavailable. Please try again.' }));
    }
    return;
  }
  if (request.method === 'PUT') {
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
      'Cache-Control': 'no-cache',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    console.error('Could not serve asset:', asset[0], error.code);
    response.writeHead(500);
    response.end();
  }
});

const port = Number(process.env.PORT || 3000);
openStore().then(database => {
  store = database;
  server.listen(port, '0.0.0.0', () => {
    console.log(`C.A.S.H. listening on port ${server.address().port}`);
  });
}).catch(error => {
  console.error('Database startup failed:', error.code || error.message);
  process.exitCode = 1;
});
