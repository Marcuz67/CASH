const http = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const publicDirectory = path.join(__dirname, 'THECASH', 'outputs');
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/firebase-config.js', ['firebase-config.js', 'text/javascript; charset=utf-8']],
  ['/firebase-setup.js', ['firebase-setup.js', 'text/javascript; charset=utf-8']],
]);

const server = http.createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'HEAD'].includes(request.method)) {
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
  if (pathname === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok' }));
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
server.listen(port, '0.0.0.0', () => {
  console.log(`C.A.S.H. listening on port ${server.address().port}`);
});
