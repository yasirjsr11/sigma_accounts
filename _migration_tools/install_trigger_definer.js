'use strict';
// SH PMS Cloud — move the 10 supplier-sync triggers to a dedicated, LOCKED definer account.
// Run by the DBA (MySQL root / admin) — NEVER by the application. Run with the application stopped
// (each trigger is dropped and re-created; there is a sub-second window per trigger).
//
//   node install_trigger_definer.js --db sh_pms_test [--socket /var/run/mysqld/mysqld.sock] [--admin-user root]
//        [--env <file with MYSQL_ROOT_PASSWORD>] [--definer-host localhost] [--dry-run]
//        [--source <sqlite copy>]   take trigger bodies from schema_from_sqlite.js (current definition) instead of the database
//
// Account model:  'sh_pms_trigger'@'<host>'  — ACCOUNT LOCK (no interactive/app login), random 48-char
//   password generated in memory and discarded (never printed/stored), no global privileges.
// Privileges (minimum, column-level), on <db> only:
//   TRIGGER                                   on each of the 5 subject tables   (required to activate a trigger)
//   SELECT (supplier_id, supplier_name)       on each subject table            (read NEW./OLD. values)
//   UPDATE (supplier_id, supplier_name)       on each subject table            (SET NEW.col in BEFORE triggers)
//   SELECT (id, name, name_key)               on suppliers                     (supplier master lookup)
// No INSERT / DELETE anywhere: the triggers never create or remove rows.
const fs = require('fs'); const crypto = require('crypto'); const mysql = require('mysql2/promise');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, A) => a.startsWith('--') ? [a.slice(2), A[i + 1] && !A[i + 1].startsWith('--') ? A[i + 1] : true] : null).filter(Boolean));
const DB = args.db; if (!DB || !/^[A-Za-z0-9_]+$/.test(DB)) { console.error('--db <name> required'); process.exit(2); }
if (/prod/i.test(DB) && !args['allow-prod']) { console.error('Refusing a *prod* database without --allow-prod (requires explicit production approval).'); process.exit(2); }
const ACCT = 'sh_pms_trigger', HOST = args['definer-host'] || 'localhost', DEF = `\`${ACCT}\`@\`${HOST}\``;
const SUBJECT = ['factory_ins_quotes', 'factory_otj_quotes', 'factory_sea_costs', 'factory_payments', 'lifecycle_factory_links'];
const log = (...m) => console.log(`[${new Date().toISOString()}]`, ...m);
(async () => {
  let pw; if (args.env) { const e = fs.readFileSync(args.env, 'utf8').match(/^MYSQL_ROOT_PASSWORD=(.*)$/m); pw = e && e[1]; }
  const cn = await mysql.createConnection({ user: args['admin-user'] || 'root', password: pw, socketPath: args.socket || undefined,
    host: args.socket ? undefined : (args.host || '127.0.0.1'), port: args.port ? Number(args.port) : undefined, multipleStatements: false });
  const q = async (sql, p) => (await cn.query(sql, p))[0];
  const trg = await q(`SELECT TRIGGER_NAME n, EVENT_OBJECT_TABLE t, ACTION_TIMING ti, EVENT_MANIPULATION ev, ACTION_STATEMENT body, DEFINER d
    FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=? ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME`, [DB]);
  if (trg.length !== 10 || trg.some(x => !SUBJECT.includes(x.t))) { log(`ABORT: expected 10 supplier-sync triggers on ${SUBJECT.join(', ')}, found ${trg.length}`); process.exit(1); }
  if (args.source) {   // current trigger definitions from the schema generator (single source of truth)
    const gen = require('./schema_from_sqlite.js').buildSchema(args.source).triggers;
    for (const x of trg) { const g = gen.find(sql => sql.includes('`' + x.n + '`')); if (!g) { log(`ABORT: no generated definition for ${x.n}`); process.exit(1); }
      x.body = g.slice(g.indexOf('FOR EACH ROW') + 'FOR EACH ROW'.length).trim(); }
    log('trigger bodies taken from the schema generator (--source)');
  }
  // Safety: the bodies only read suppliers and set NEW.supplier_id / NEW.supplier_name
  for (const x of trg) { const b = x.body.replace(/\s+/g, ' ');
    const sets = [...b.matchAll(/SET\s+NEW\.(\w+)/gi)].map(m => m[1]); const tables = [...b.matchAll(/FROM\s+(\w+)/gi)].map(m => m[1]);
    if (sets.some(c => !['supplier_id', 'supplier_name'].includes(c)) || tables.some(t => t !== 'suppliers') || /\b(INSERT|DELETE|UPDATE\s+\w+\s+SET)\b/i.test(b))
      { log(`ABORT: trigger ${x.n} does more than the expected supplier sync`); process.exit(1); } }
  log(`db=${DB}: 10 triggers verified (read suppliers; set NEW.supplier_id/NEW.supplier_name only). Current definers: ${[...new Set(trg.map(x => x.d))].join(', ')}`);
  if (args['dry-run']) { log('dry run — no changes'); await cn.end(); return; }
  // 1. Locked account (password random, discarded)
  const [exists] = await cn.query('SELECT COUNT(*) n FROM mysql.user WHERE user=? AND host=?', [ACCT, HOST]);
  const secret = crypto.randomBytes(36).toString('base64url');
  if (!exists[0].n) { await cn.query(`CREATE USER ${DEF} IDENTIFIED BY ? PASSWORD EXPIRE NEVER ACCOUNT LOCK`, [secret]); log(`account ${ACCT}@${HOST} created (locked)`); }
  else { await cn.query(`ALTER USER ${DEF} IDENTIFIED BY ? ACCOUNT LOCK`, [secret]); log(`account ${ACCT}@${HOST} exists — credential rotated, locked`); }
  // 2. Minimum privileges (reset first so the grant set is exactly this)
  // reset this database's grants only (other databases' grants for the account are left as they are)
  for (const t of [...SUBJECT, 'suppliers']) { try { await cn.query(`REVOKE ALL PRIVILEGES ON \`${DB}\`.\`${t}\` FROM ${DEF}`); } catch (_) {} }
  try { await cn.query(`REVOKE ALL PRIVILEGES ON \`${DB}\`.* FROM ${DEF}`); } catch (_) {}
  for (const t of SUBJECT) {
    await cn.query(`GRANT TRIGGER ON \`${DB}\`.\`${t}\` TO ${DEF}`);
    await cn.query(`GRANT SELECT (supplier_id, supplier_name), UPDATE (supplier_id, supplier_name) ON \`${DB}\`.\`${t}\` TO ${DEF}`);
  }
  await cn.query(`GRANT SELECT (id, name, name_key) ON \`${DB}\`.\`suppliers\` TO ${DEF}`);
  log('privileges granted (column-level, see SHOW GRANTS below)');
  // 3. Re-create triggers with the new DEFINER
  for (const x of trg) {
    await cn.query(`DROP TRIGGER \`${DB}\`.\`${x.n}\``);
    await cn.query(`CREATE DEFINER=${DEF} TRIGGER \`${DB}\`.\`${x.n}\` ${x.ti} ${x.ev} ON \`${DB}\`.\`${x.t}\` FOR EACH ROW ${x.body}`);
  }
  const after = await q('SELECT TRIGGER_NAME n, DEFINER d FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=? ORDER BY TRIGGER_NAME', [DB]);
  log(`triggers re-created: ${after.length}; definers: ${[...new Set(after.map(x => x.d))].join(', ')}`);
  // 4. Prove the account cannot log in, even with its own (correct) credential
  try { const t = await mysql.createConnection({ user: ACCT, password: secret, socketPath: args.socket || undefined, host: args.socket ? undefined : (args.host || '127.0.0.1'), port: args.port ? Number(args.port) : undefined });
        await t.end(); log('ERROR: login as trigger account SUCCEEDED — account is not locked'); process.exitCode = 1; }
  catch (e) { log(`login as ${ACCT} with its correct credential refused: ${e.code} (${e.errno})`); }
  const scu = await q(`SHOW CREATE USER ${DEF}`);
  const createUserText = scu && scu[0] ? Object.values(scu[0]).join(' ') : '';
  log(`account lock verification: ${/ACCOUNT\s+LOCK/i.test(createUserText) ? 'LOCKED' : 'NOT CONFIRMED'}`);
  if (!/ACCOUNT\s+LOCK/i.test(createUserText)) process.exitCode = 1;
  for (const g of await q(`SHOW GRANTS FOR ${DEF}`)) log('  ' + Object.values(g)[0]);
  await cn.end();
})().catch(e => { console.error('FAILED:', e.code || '', e.message); process.exit(1); });
