'use strict';
// ══════════════════════════════════════════════════════════════════════════════
// SH PMS Cloud — database entry point
//   DB_CLIENT=mysql (cloud default): MySQL 8 through the synchronous adapter (db/mysqlSync.js).
//     The schema is created by the migration tooling (03_MySQL_Migration), not at boot.
//   DB_CLIENT=sqlite: the original SQLite implementation (db/db.sqlite.js = unchanged copy of
//     the Windows application's db.js) — Linux/SQLite staging and parity testing only.
// Exports the same { db, run, get, all, DB_PATH } the application already uses.
// ══════════════════════════════════════════════════════════════════════════════
const CLIENT = (process.env.DB_CLIENT || 'mysql').toLowerCase();
if (CLIENT === 'sqlite') { module.exports = require('./db.sqlite.js'); return; }
if (CLIENT !== 'mysql') throw new Error(`Unsupported DB_CLIENT ${CLIENT}`);
const { SyncMySQL } = require('./mysqlSync.js');
const need = k => { const v = process.env[k]; if (v == null || v === '') throw new Error(`Missing environment variable ${k}`); return v; };
const db = new SyncMySQL({
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), socketPath: process.env.DB_SOCKET || undefined,
  user: need('DB_USER'), password: need('DB_PASSWORD'), database: need('DB_NAME'), timezone: process.env.DB_TIMEZONE || '+04:00',
  queryTimeoutMs: Number(process.env.DB_QUERY_TIMEOUT_MS || 60000),
});
function run(sql, params = []) { return db.prepare(sql).run(...params); }
function get(sql, params = []) { return db.prepare(sql).get(...params); }
function all(sql, params = []) { return db.prepare(sql).all(...params); }
module.exports = { db, run, get, all, DB_PATH: null, DB_CLIENT: 'mysql' };
