const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

async function boot(filename) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: '0', DATABASE_PATH: filename, DATABASE_URL: '', RENDER: '', NODE_ENV: 'test' },
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
  return { base, stop: () => new Promise(resolve => { child.once('exit', resolve); child.kill(); }) };
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
    const read = () => fetch(service.base + '/api/shop').then(response => response.json());
    const save = payload => fetch(service.base + '/api/shop', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    assert.deepEqual(await read(), { state: null, revision: 0 });
    const state = {
      products: [{ id: 'p1', name: 'Milk', category: 'Drinks', price: 20, cost: 10, stock: 5, sold: 0, threshold: 1 }],
      activity: [], weekByDay: [0, 0, 0, 0, 0, 0, 0], weekProfitByDay: [0, 0, 0, 0, 0, 0, 0],
      weekUnits: 0, lifetimeGrossProfit: 0, profile: { owner: 'Owner', store: 'Test shop', location: '' },
      profitGoals: { redBelow: 2000, goodFrom: 3000 },
    };
    assert.equal((await save({ state, revision: 0 })).status, 200);
    assert.equal((await save(null)).status, 400);
    const invalid = structuredClone(state); invalid.products[0].stock = -1;
    assert.equal((await save({ state: invalid, revision: 1 })).status, 400);
    const purchase = structuredClone(state);
    purchase.products[0].stock -= 2; purchase.products[0].sold += 2;
    purchase.activity.push({ name: 'Milk', qty: 2, date: Date.now(), unitPrice: 20, unitCost: 10, revenue: 40, grossProfit: 20 });
    const responses = await Promise.all([save({ state: purchase, revision: 1 }), save({ state, revision: 1 })]);
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    const stored = await read(); assert.equal(stored.revision, 2);
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
