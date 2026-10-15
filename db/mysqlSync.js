'use strict';
// ══════════════════════════════════════════════════════════════════════════════
// SH PMS Cloud — synchronous MySQL adapter (approved Option A)
// Presents the synchronous API the application used with node:sqlite
// (db.exec, db.prepare().get/all/run, plus run/get/all helpers), so routes and
// business logic stay unchanged. A worker thread owns one MySQL connection; the
// main thread waits (Atomics.wait) for each statement — the same one-at-a-time
// execution model SQLite had. SQL is translated by db/sqlDialect.js.
// ══════════════════════════════════════════════════════════════════════════════
const path = require('path');
const { Worker, MessageChannel, receiveMessageOnPort } = require('worker_threads');
const { translate, classify } = require('./sqlDialect.js');

class SyncMySQL {
  constructor(cfg) {
    this.cfg = cfg; this.timeoutMs = cfg.queryTimeoutMs || 60000;
    this.sab = new SharedArrayBuffer(4); this.flag = new Int32Array(this.sab);
    const { port1, port2 } = new MessageChannel(); this.port = port1;
    this.worker = new Worker(path.join(__dirname, 'mysqlSyncWorker.js'), { workerData: { port: port2, sab: this.sab, cfg }, transferList: [port2] });
    this.worker.unref(); this.port.unref();
    this.cache = new Map(); this.setFlagCache = new Map(); this.savepoints = []; this.inTx = false; this.stats = { queries: 0, translated: 0 };
    this._call({ op: 'connect' });
  }
  _call(msg) {
    Atomics.store(this.flag, 0, 0); this.port.postMessage(msg);
    if (Atomics.wait(this.flag, 0, 0, this.timeoutMs) === 'timed-out') throw new Error(`MySQL request timed out after ${this.timeoutMs} ms`);
    const m = receiveMessageOnPort(this.port); if (!m) throw new Error('MySQL worker returned no result');
    const res = m.message;
    if (!res.ok) { const e = new Error(mapMessage(res.error)); e.code = res.error.code; e.errno = res.error.errno; e.sqlState = res.error.sqlState; throw e; }
    return res;
  }
  _sql(sql, params) { this.stats.queries++; return this._call({ op: 'query', sql, params: (params || []).map(v => v === undefined ? null : v) }); }
  _translate(sql) {
    let t = this.cache.get(sql);
    if (t === undefined) { t = translate(sql, { hasId: tb => this._tableHasId(tb), indexLead: tb => this._indexLead(tb) }); this.cache.set(sql, t); this.stats.translated++; }
    return t;
  }
  _tableHasId(tb) {
    if (!this.idTables) this.idTables = new Set(this._sql("SELECT LOWER(TABLE_NAME) t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'id' AND COLUMN_KEY = 'PRI'").rows.map(r => r.t));
    return this.idTables.has(String(tb).toLowerCase());
  }
  _indexLead(tb) {   // first columns of the (SQLite-origin) secondary indexes of a table
    if (!this.idxLead) { this.idxLead = new Map();
      for (const r of this._sql("SELECT LOWER(TABLE_NAME) t, LOWER(COLUMN_NAME) c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND SEQ_IN_INDEX = 1 AND INDEX_NAME <> 'PRIMARY' AND INDEX_NAME NOT LIKE 'fk\\_%' AND COLUMN_NAME IS NOT NULL").rows) {
        if (!this.idxLead.has(r.t)) this.idxLead.set(r.t, new Set()); this.idxLead.get(r.t).add(r.c); } }
    return this.idxLead.get(String(tb).toLowerCase()) || new Set();
  }
  _tx(v) { this.inTx = v; this._call({ op: 'tx', value: v }); }
  _exists(sql, p) { return this._sql(sql, p).rows[0].n > 0; }
  _execOne(sql, params) {   // SQLite semantics for transactions / savepoints / runtime DDL
    const c = classify(sql); const none = { rows: [], changes: 0 };
    switch (c.kind) {
      case 'begin': this._sql('START TRANSACTION'); this._tx(true); this.savepoints = ['__BEGIN__']; return none;
      case 'commit': this._sql('COMMIT'); this._tx(false); this.savepoints = []; return none;
      case 'rollback': this._sql('ROLLBACK'); this._tx(false); this.savepoints = []; return none;
      case 'savepoint': if (!this.inTx) { this._sql('START TRANSACTION'); this._tx(true); this.savepoints = []; }   // SQLite: a SAVEPOINT outside a transaction starts one
        this._sql('SAVEPOINT ' + c.name); this.savepoints.push(c.name); return none;
      case 'release': { const i = this.savepoints.lastIndexOf(c.name); if (i < 0) throw new Error('no such savepoint: ' + c.name);
        if (i === 0) { this._sql('COMMIT'); this._tx(false); this.savepoints = []; } else { this._sql('RELEASE SAVEPOINT ' + c.name); this.savepoints = this.savepoints.slice(0, i); }
        return none; }
      case 'rollback_to': { const i = this.savepoints.lastIndexOf(c.name); if (i < 0) throw new Error('no such savepoint: ' + c.name);
        this._sql('ROLLBACK TO SAVEPOINT ' + c.name); this.savepoints = this.savepoints.slice(0, i + 1); return none; }
      case 'table_info': return { rows: this._sql(`SELECT ORDINAL_POSITION - 1 AS cid, COLUMN_NAME AS name, UPPER(DATA_TYPE) AS type, (IS_NULLABLE = 'NO') AS notnull,
          COLUMN_DEFAULT AS dflt_value, (COLUMN_KEY = 'PRI') AS pk FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`, [c.table]).rows, changes: 0 };
      case 'noop': return none;
      case 'ddl_table': if (this._exists('SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [c.table])) return none;
        throw new Error(`Runtime DDL not permitted: table ${c.table} is missing from the MySQL schema`);
      case 'ddl_index': return none;   // indexes are created by the migration schema
      case 'ddl_addcol': if (this._exists('SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [c.table, c.column]))
          throw Object.assign(new Error(`duplicate column name: ${c.column}`), { code: 'ER_DUP_FIELDNAME' });   // same outcome as SQLite
        throw new Error(`Runtime DDL not permitted: column ${c.table}.${c.column} is missing from the MySQL schema`);
      case 'ddl_other': throw new Error('Runtime DDL not permitted in the cloud database: ' + sql.slice(0, 80));
      default: { const t = this._translate(sql);
        const sf = supplierSetFlags(sql, this.setFlagCache);   // SQLite "UPDATE OF" semantics for the supplier-sync triggers
        if (sf) this._sql('SET @shpms_set_supplier_id = ?, @shpms_set_supplier_name = ?', sf);
        try { return this._sql(t, params); }
        catch (e) {
          // Privilege / trigger-definer failures are configuration faults: always logged (to journald via stderr).
          // The statement — including any trigger work — has already been rolled back by InnoDB, so nothing is half-written.
          if (CONFIG_ERRNOS.has(e.errno)) console.error(`[db] ${new Date().toISOString()} DATABASE PRIVILEGE/TRIGGER ERROR ${e.code} (${e.errno}): ${e.message}`);
          if (process.env.DB_LOG_FAILED_SQL === '1') console.error('[mysqlSync] failed SQL:', t.replace(/\s+/g, ' ').slice(0, 4000));
          throw e; } }
    }
  }
  exec(sql) { for (const st of splitStatements(sql)) this._execOne(st, []); }
  prepare(sql) {
    const self = this;
    return {
      get: (...p) => { const r = self._execOne(sql, flat(p)); return r.rows && r.rows.length ? r.rows[0] : undefined; },
      all: (...p) => self._execOne(sql, flat(p)).rows || [],
      run: (...p) => { const r = self._execOne(sql, flat(p)); return { changes: r.changes || 0, lastInsertRowid: r.lastInsertRowid || 0 }; },
      iterate: (...p) => (self._execOne(sql, flat(p)).rows || [])[Symbol.iterator](),
    };
  }
  close() { try { this._call({ op: 'close' }); } catch (_) {} this.worker.terminate(); }
}
// 1142/1143 table/column access denied · 1227 specific privilege · 1449 definer account missing · 1370 routine access · 1644 SIGNAL
const CONFIG_ERRNOS = new Set([1142, 1143, 1227, 1449, 1370, 1644]);
// Supplier-sync trigger tables: SQLite's triggers fire on "UPDATE OF supplier_id / supplier_name", i.e. when the
// column is in the SET list (even if its value does not change). MySQL triggers cannot see the SET list, so the
// adapter tells them via two session variables, set right before each UPDATE of these tables.
const SUPPLIER_TABLES = /^\s*UPDATE\s+[`"]?(factory_ins_quotes|factory_otj_quotes|factory_sea_costs|factory_payments|lifecycle_factory_links)[`"]?\s+SET\s/i;
function supplierSetFlags(sql, cache) {
  if (cache.has(sql)) return cache.get(sql);
  let r = null; const m = sql.match(SUPPLIER_TABLES);
  if (m) {
    const body = sql.slice(m[0].length); let depth = 0, q = null, end = body.length, start = 0; const cols = [];
    for (let i = 0; i < body.length; i++) { const c = body[i];
      if (q) { if (c === q) q = null; continue; } if (c === "'" || c === '"' || c === '`') { q = c; continue; }
      if (c === '(') depth++; else if (c === ')') depth--;
      else if (depth === 0 && c === ',') { cols.push(body.slice(start, i)); start = i + 1; }
      else if (depth === 0 && /^\sWHERE\s/i.test(body.slice(i, i + 7))) { end = i; break; } }
    cols.push(body.slice(start, end));
    const names = cols.map(x => (x.split('=')[0] || '').trim().replace(/[`"]/g, '').toLowerCase());
    r = [names.includes('supplier_id') ? 1 : 0, names.includes('supplier_name') ? 1 : 0];
  }
  cache.set(sql, r); return r;
}
const flat = p => (p.length === 1 && Array.isArray(p[0])) ? p[0] : p;
function splitStatements(sql) { const out = []; let q = null, start = 0, depth = 0;
  for (let i = 0; i < sql.length; i++) { const c = sql[i];
    if (q) { if (c === q) { if (sql[i + 1] === q) i++; else q = null; } continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '-' && sql[i + 1] === '-') { const e = sql.indexOf('\n', i); i = e < 0 ? sql.length : e; continue; }
    if (c === ';' && depth === 0) { const st = sql.slice(start, i).trim(); if (st) out.push(st); start = i + 1; }
    else if (c === '(') depth++; else if (c === ')') depth--; }
  const last = sql.slice(start).trim(); if (last) out.push(last); return out; }
// Keep SQLite-style message prefixes that application code checks (quotations.js tests 'UNIQUE constraint')
function mapMessage(e) {
  if (e.code === 'ER_DUP_ENTRY') return `UNIQUE constraint failed: ${e.message}`;
  if (e.code === 'ER_NO_REFERENCED_ROW_2' || e.code === 'ER_ROW_IS_REFERENCED_2') return `FOREIGN KEY constraint failed: ${e.message}`;
  if (e.code === 'ER_CHECK_CONSTRAINT_VIOLATED') return `CHECK constraint failed: ${e.message}`;
  if (e.code === 'ER_BAD_NULL_ERROR') return `NOT NULL constraint failed: ${e.message}`;
  return e.message;
}
module.exports = { SyncMySQL };
