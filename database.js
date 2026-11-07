const path = require('node:path');
const { mkdirSync } = require('node:fs');

async function openStore() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('CREATE TABLE IF NOT EXISTS cash_shop (id INTEGER PRIMARY KEY, state TEXT, revision INTEGER NOT NULL DEFAULT 0)');
    await pool.query('INSERT INTO cash_shop (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
    await pool.query('CREATE TABLE IF NOT EXISTS cash_google_accounts (google_sub TEXT PRIMARY KEY, email TEXT NOT NULL, display_name TEXT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)');
    await pool.query('CREATE TABLE IF NOT EXISTS cash_sessions (token_hash TEXT PRIMARY KEY, identity TEXT NOT NULL, expires_at BIGINT NOT NULL)');
    await pool.query('CREATE TABLE IF NOT EXISTS cash_local_admin (id INTEGER PRIMARY KEY CHECK (id = 1), username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at BIGINT NOT NULL)');
    await pool.query('CREATE TABLE IF NOT EXISTS cash_login_limits (attempt_key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at BIGINT NOT NULL)');
    await pool.query('CREATE TABLE IF NOT EXISTS cash_buyers (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at BIGINT NOT NULL)');
    return {
      kind: 'postgresql',
      async getBuyerById(id) { return (await pool.query('SELECT * FROM cash_buyers WHERE id=$1',[id])).rows[0] || null; },
      async getBuyerByUsername(username) { return (await pool.query('SELECT * FROM cash_buyers WHERE username=$1',[username])).rows[0] || null; },
      async createBuyer(account) {
        const result=await pool.query('INSERT INTO cash_buyers (id,username,display_name,password_hash,created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (username) DO NOTHING RETURNING id',[account.id,account.username,account.name,account.passwordHash,Date.now()]);
        return result.rows.length === 1;
      },
      async getLocalAdmin() { return (await pool.query('SELECT * FROM cash_local_admin WHERE id = 1')).rows[0] || null; },
      async createLocalAdmin(account) {
        const result = await pool.query('INSERT INTO cash_local_admin (id,username,display_name,password_hash,created_at) VALUES (1,$1,$2,$3,$4) ON CONFLICT (id) DO NOTHING RETURNING id', [account.username,account.name,account.passwordHash,Date.now()]);
        return result.rows.length === 1;
      },
      async bumpLoginLimit(key, now, until) {
        await pool.query('DELETE FROM cash_login_limits WHERE expires_at <= $1',[now]);
        const result = await pool.query('INSERT INTO cash_login_limits (attempt_key,attempts,expires_at) VALUES ($1,1,$2) ON CONFLICT (attempt_key) DO UPDATE SET attempts = cash_login_limits.attempts + 1 RETURNING attempts,expires_at',[key,until]);
        return { attempts:result.rows[0].attempts,expires:Number(result.rows[0].expires_at) };
      },
      async clearLoginLimit(key) { await pool.query('DELETE FROM cash_login_limits WHERE attempt_key = $1',[key]); },
      async saveAccount(user) {
        const now = Date.now();
        await pool.query('INSERT INTO cash_google_accounts (google_sub, email, display_name, created_at, updated_at) VALUES ($1,$2,$3,$4,$4) ON CONFLICT (google_sub) DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name, updated_at = EXCLUDED.updated_at', [user.sub, user.email, user.name, now]);
      },
      async createSession(hash, identity, expires) {
        await pool.query('DELETE FROM cash_sessions WHERE expires_at <= $1', [Date.now()]);
        await pool.query('INSERT INTO cash_sessions (token_hash, identity, expires_at) VALUES ($1,$2,$3)', [hash, JSON.stringify(identity), expires]);
      },
      async getSession(hash) {
        const result = await pool.query('SELECT identity, expires_at FROM cash_sessions WHERE token_hash = $1', [hash]);
        return decodeSession(result.rows[0]);
      },
      async takeSession(hash) {
        const result = await pool.query('DELETE FROM cash_sessions WHERE token_hash = $1 RETURNING identity, expires_at', [hash]);
        return decodeSession(result.rows[0]);
      },
      async deleteSession(hash) { await pool.query('DELETE FROM cash_sessions WHERE token_hash = $1', [hash]); },
      async read() {
        const result = await pool.query('SELECT state, revision FROM cash_shop WHERE id = 1');
        return decode(result.rows[0]);
      },
      async save(state, revision) {
        const result = await pool.query('UPDATE cash_shop SET state = $1, revision = revision + 1 WHERE id = 1 AND revision = $2 RETURNING revision', [JSON.stringify(state), revision]);
        return result.rows[0]?.revision ?? null;
      },
    };
  }
  if (process.env.RENDER || process.env.NODE_ENV === 'production') {
    throw new Error('Set DATABASE_URL to a PostgreSQL connection URL before deploying.');
  }
  const { DatabaseSync } = require('node:sqlite');
  const filename = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'cash.sqlite');
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('CREATE TABLE IF NOT EXISTS cash_shop (id INTEGER PRIMARY KEY, state TEXT, revision INTEGER NOT NULL DEFAULT 0); INSERT OR IGNORE INTO cash_shop (id) VALUES (1)');
  db.exec('CREATE TABLE IF NOT EXISTS cash_google_accounts (google_sub TEXT PRIMARY KEY, email TEXT NOT NULL, display_name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS cash_sessions (token_hash TEXT PRIMARY KEY, identity TEXT NOT NULL, expires_at INTEGER NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS cash_local_admin (id INTEGER PRIMARY KEY CHECK (id = 1), username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS cash_login_limits (attempt_key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS cash_buyers (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)');
  return {
    kind: 'sqlite',
    async getBuyerById(id) { return db.prepare('SELECT * FROM cash_buyers WHERE id=?').get(id) || null; },
    async getBuyerByUsername(username) { return db.prepare('SELECT * FROM cash_buyers WHERE username=?').get(username) || null; },
    async createBuyer(account) {
      return Boolean(db.prepare('INSERT INTO cash_buyers (id,username,display_name,password_hash,created_at) VALUES (?,?,?,?,?) ON CONFLICT (username) DO NOTHING RETURNING id').get(account.id,account.username,account.name,account.passwordHash,Date.now()));
    },
    async getLocalAdmin() { return db.prepare('SELECT * FROM cash_local_admin WHERE id = 1').get() || null; },
    async createLocalAdmin(account) {
      return Boolean(db.prepare('INSERT INTO cash_local_admin (id,username,display_name,password_hash,created_at) VALUES (1,?,?,?,?) ON CONFLICT (id) DO NOTHING RETURNING id').get(account.username,account.name,account.passwordHash,Date.now()));
    },
    async bumpLoginLimit(key, now, until) {
      db.prepare('DELETE FROM cash_login_limits WHERE expires_at <= ?').run(now);
      const result = db.prepare('INSERT INTO cash_login_limits (attempt_key,attempts,expires_at) VALUES (?,1,?) ON CONFLICT (attempt_key) DO UPDATE SET attempts = cash_login_limits.attempts + 1 RETURNING attempts,expires_at').get(key,until);
      return { attempts:result.attempts,expires:result.expires_at };
    },
    async clearLoginLimit(key) { db.prepare('DELETE FROM cash_login_limits WHERE attempt_key = ?').run(key); },
    async saveAccount(user) {
      const now = Date.now();
      db.prepare('INSERT INTO cash_google_accounts (google_sub,email,display_name,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT (google_sub) DO UPDATE SET email=excluded.email,display_name=excluded.display_name,updated_at=excluded.updated_at').run(user.sub,user.email,user.name,now,now);
    },
    async createSession(hash, identity, expires) {
      db.prepare('DELETE FROM cash_sessions WHERE expires_at <= ?').run(Date.now());
      db.prepare('INSERT INTO cash_sessions (token_hash,identity,expires_at) VALUES (?,?,?)').run(hash, JSON.stringify(identity), expires);
    },
    async getSession(hash) { return decodeSession(db.prepare('SELECT identity,expires_at FROM cash_sessions WHERE token_hash = ?').get(hash)); },
    async takeSession(hash) { return decodeSession(db.prepare('DELETE FROM cash_sessions WHERE token_hash = ? RETURNING identity,expires_at').get(hash)); },
    async deleteSession(hash) { db.prepare('DELETE FROM cash_sessions WHERE token_hash = ?').run(hash); },
    async read() { return decode(db.prepare('SELECT state, revision FROM cash_shop WHERE id = 1').get()); },
    async save(state, revision) {
      const result = db.prepare('UPDATE cash_shop SET state = ?, revision = revision + 1 WHERE id = 1 AND revision = ? RETURNING revision').get(JSON.stringify(state), revision);
      return result?.revision ?? null;
    },
  };
}

function decode(row) {
  return { state: row.state ? JSON.parse(row.state) : null, revision: row.revision };
}

function decodeSession(row) {
  return row ? { identity: JSON.parse(row.identity), expires: Number(row.expires_at) } : null;
}

function validateState(state) {
  if (!state || !Array.isArray(state.products) || !Array.isArray(state.activity)) return false;
  const nonnegative = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const ids = new Set();
  for (const product of state.products) {
    if (!product || typeof product.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(product.id) || ids.has(product.id)) return false;
    ids.add(product.id);
    if (typeof product.name !== 'string' || !product.name.trim() || product.name.length > 200 || typeof product.category !== 'string') return false;
    if (!Number.isSafeInteger(product.stock) || product.stock < 0 || !Number.isSafeInteger(product.sold) || product.sold < 0) return false;
    if (![product.price, product.cost, product.threshold].every(nonnegative)) return false;
    if (product.saleEnabled !== undefined && typeof product.saleEnabled !== 'boolean') return false;
    if (product.emoji && (typeof product.emoji !== 'string' || /[<>"'&]/.test(product.emoji))) return false;
    if (product.photo && (typeof product.photo !== 'string' || (!/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(product.photo)
      && !/^\/assets\/products\/(rice|milk|eggs|bread|water|noodles|coffee|soap)\.png$/.test(product.photo)))) return false;
  }
  for (const sale of state.activity) {
    if (!sale || typeof sale.name !== 'string' || !Number.isSafeInteger(sale.qty) || sale.qty < 1 || !nonnegative(sale.date)) return false;
    if (![sale.unitPrice, sale.unitCost, sale.revenue].every(nonnegative) || typeof sale.grossProfit !== 'number' || !Number.isFinite(sale.grossProfit)) return false;
  }
  if (![state.weekByDay, state.weekProfitByDay].every(values => Array.isArray(values) && values.length === 7 && values.every(value => typeof value === 'number' && Number.isFinite(value)))) return false;
  if (!Number.isSafeInteger(state.weekUnits) || state.weekUnits < 0 || !Number.isFinite(state.lifetimeGrossProfit)) return false;
  if (!state.profile || !['owner', 'store', 'location'].every(key => typeof state.profile[key] === 'string')) return false;
  if (state.profile.photo && (typeof state.profile.photo !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(state.profile.photo))) return false;
  if (!state.profitGoals || !nonnegative(state.profitGoals.redBelow) || !nonnegative(state.profitGoals.goodFrom)) return false;
  return true;
}

module.exports = { openStore, validateState };
