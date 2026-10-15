'use strict';
// Worker thread for db/mysqlSync.js — owns ONE MySQL connection and answers the main thread's
// synchronous requests (reply via MessagePort + Atomics.notify on a shared flag).
const { workerData } = require('worker_threads');
const mysql = require('mysql2/promise');
const { port, sab, cfg } = workerData; const flag = new Int32Array(sab);
let cn = null, inTx = false;
const SESSION_SQL = [
  'SET NAMES utf8mb4 COLLATE utf8mb4_nopad_bin',
  `SET SESSION time_zone='${cfg.timezone || '+04:00'}'`,
  "SET SESSION sql_mode='STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION,PIPES_AS_CONCAT'",
  'SET SESSION group_concat_max_len = 1048576',
];
async function connect() {
  cn = await mysql.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database,
    socketPath: cfg.socketPath || undefined, charset: 'UTF8MB4_UNICODE_CI', timezone: cfg.timezone || '+04:00', dateStrings: true,
    decimalNumbers: true, supportBigNumbers: true, bigNumberStrings: false, multipleStatements: true, flags: ['+FOUND_ROWS'], connectTimeout: 10000 });
  for (const s of SESSION_SQL) await cn.query(s);
  cn.on('error', () => { cn = null; });
}
const reply = msg => { port.postMessage(msg); Atomics.store(flag, 0, 1); Atomics.notify(flag, 0); };
const LOST = new Set(['PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ER_CLIENT_INTERACTION_TIMEOUT']);
async function run(sql, params) {
  if (!cn) await connect();
  try { return await cn.query(sql, params); }
  catch (e) { if (LOST.has(e.code) && !inTx) { cn = null; await connect(); return await cn.query(sql, params); } throw e; }   // safe retry only outside a transaction
}
const isHeader = x => x && !Array.isArray(x) && typeof x === 'object' && 'affectedRows' in x;
port.on('message', async m => {
  try {
    if (m.op === 'connect') { await connect(); return reply({ ok: true }); }
    if (m.op === 'close') { if (cn) await cn.end(); cn = null; return reply({ ok: true }); }
    if (m.op === 'tx') { inTx = m.value; return reply({ ok: true }); }
    const [res] = await run(m.sql, m.params || []);
    if (isHeader(res)) return reply({ ok: true, rows: [], changes: res.affectedRows, lastInsertRowid: res.insertId });
    if (Array.isArray(res) && res.some(x => Array.isArray(x) || isHeader(x))) {   // multi-statement result
      const sets = res.filter(Array.isArray), hdrs = res.filter(isHeader), h = hdrs[hdrs.length - 1];
      return reply({ ok: true, rows: sets.length ? sets[sets.length - 1] : [], changes: h ? h.affectedRows : 0, lastInsertRowid: h ? h.insertId : 0 }); }
    reply({ ok: true, rows: res });
  } catch (e) { reply({ ok: false, error: { message: e.message, code: e.code, errno: e.errno, sqlState: e.sqlState } }); }
});
