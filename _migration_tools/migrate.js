'use strict';
// SH PMS — repeatable SQLite → MariaDB 10.4 migration.
//   node migrate.js --source <sqlite copy> --env <env file> --target <db> [--apply] [--batch <id>] [--logdir <dir>]
//   Without --apply: DRY RUN — complete load into the scratch database <target>_dryrun, then it is dropped.
//   Only *_test / *_dryrun targets are accepted at Stage 4 (production refused).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const mysql = require('mysql2/promise');
const { buildSchema } = require('./schema_from_sqlite.js');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, A) => a.startsWith('--') ? [a.slice(2), A[i + 1] && !A[i + 1].startsWith('--') ? A[i + 1] : true] : null).filter(Boolean));
const env = Object.fromEntries(fs.readFileSync(args.env, 'utf8').split('\n').filter(l => /^\w+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const APPLY = !!args.apply, TARGET = APPLY ? args.target : args.target + '_dryrun';
const BATCH = args.batch || ('MIG-' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z');
const LOGDIR = args.logdir || path.join(process.cwd(), 'logs'); fs.mkdirSync(LOGDIR, { recursive: true });
const LOGF = path.join(LOGDIR, `migration_${BATCH}_${APPLY ? 'apply' : 'dryrun'}.log`);
const log = (...m) => { const l = `[${new Date().toISOString()}] ${m.join(' ')}`; console.log(l); fs.appendFileSync(LOGF, l + '\n'); };
const EXCLUDE_USERS = /^zz_stage3_/;   // Stage-3/4 test logins must never be migrated
const q = n => '`' + n.replace(/`/g, '``') + '`';
(async () => {
  if (!/_(test|dryrun)$/.test(TARGET) || /prod/i.test(TARGET)) throw new Error(`Refusing target ${TARGET}: only *_test / *_dryrun at Stage 4`);
  const src = path.resolve(args.source); const sha = crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex');
  log(`BATCH ${BATCH} · mode=${APPLY ? 'APPLY' : 'DRY RUN'} · target=${TARGET} · source=${src} sha256=${sha}`);
  const d = new DatabaseSync(src, { readOnly: true });
  if (d.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Source integrity_check failed');
  const S = buildSchema(src);
  log(`schema: ${S.tables.length} tables, ${S.indexes.length} indexes, ${S.fks.length} foreign keys, ${S.triggers.length} triggers (replacing ${S.triggers_covered.length} SQLite triggers); warnings=${S.warnings.length}`);
  S.warnings.forEach(w => log('WARN', w));
  const cn = await mysql.createConnection({ host: env.DB_HOST, port: +env.DB_PORT, user: env.MIGRATION_DB_USER, password: env.MIGRATION_DB_PASSWORD,
    multipleStatements: true, dateStrings: true, decimalNumbers: true, timezone: '+04:00', charset: 'UTF8MB4_UNICODE_CI' });
  await cn.query('SET NAMES utf8mb4 COLLATE utf8mb4_nopad_bin');
  await cn.query(`SET SESSION sql_mode='STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION', time_zone='+04:00'`);
  await cn.query(`CREATE DATABASE IF NOT EXISTS ${q(TARGET)} CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin`);
  await cn.query(`USE ${q(TARGET)}`);
  await cn.query('SET FOREIGN_KEY_CHECKS=0');
  const [old] = await cn.query(`SELECT TABLE_NAME n FROM information_schema.TABLES WHERE TABLE_SCHEMA=?`, [TARGET]);
  for (const r of old) await cn.query(`DROP TABLE ${q(r.n)}`);
  log(`target cleared (${old.length} existing tables dropped)`);
  fs.writeFileSync(path.join(LOGDIR, `mysql_schema_${BATCH}.sql`), [...S.tables.map(t => t.ddl), ...S.indexes, ...S.fks].join(';\n\n') + ';\n\nDELIMITER //\n' + S.triggers.join(' //\n\n') + ' //\nDELIMITER ;\n');
  for (const t of S.tables) await cn.query(t.ddl);
  log('tables created');
  const counts = {}; let excludedUsers = 0;
  for (const t of S.tables) {
    const cols = d.prepare(`PRAGMA table_info("${t.name}")`).all().map(c => c.name);
    let rows = d.prepare(`SELECT * FROM "${t.name}" ORDER BY rowid`).all(); const srcN = rows.length;
    if (t.name === 'users') { rows = rows.filter(r => !EXCLUDE_USERS.test(r.username || '')); excludedUsers = srcN - rows.length; }
    await cn.beginTransaction();
    for (let i = 0; i < rows.length; i += 500)
      await cn.query(`INSERT INTO ${q(t.name)} (${cols.map(q).join(',')}) VALUES ?`, [rows.slice(i, i + 500).map(r => cols.map(c => r[c] === undefined ? null : r[c]))]);
    await cn.commit();
    const [[c]] = await cn.query(`SELECT COUNT(*) n FROM ${q(t.name)}`);
    counts[t.name] = { source: srcN, loaded: c.n, excluded: srcN - rows.length };
    if (c.n !== rows.length) throw new Error(`Row count mismatch in ${t.name}: ${rows.length} vs ${c.n}`);
  }
  log(`data loaded: ${Object.values(counts).reduce((a, x) => a + x.loaded, 0)} rows in ${S.tables.length} tables; excluded test users: ${excludedUsers}`);
  for (const ix of S.indexes) { try { await cn.query(ix); } catch (e) { throw new Error(`Index failed: ${ix}\n  ${e.message}`); } }
  log('indexes created');
  await cn.query('SET FOREIGN_KEY_CHECKS=1');
  for (const fk of S.fks) { try { await cn.query(fk); } catch (e) { throw new Error(`Foreign key failed: ${fk}\n  ${e.message}`); } }
  log('foreign keys created and validated against the loaded data');
  for (const tg of S.triggers) await cn.query(tg);
  log('triggers created after the data load (migrated rows were not altered by triggers)');
  for (const [n, ddl] of Object.entries(require('./cloud_tables.js').DDL)) await cn.query(ddl);
  log('cloud-only tables created: sessions (persistent login sessions), system_backups (cloud System Backup history)');
  log('NEXT (DBA): node install_trigger_definer.js --db ' + TARGET + ' --source <sqlite copy>  → triggers owned by the locked sh_pms_trigger account');
  const [[sv]] = await cn.query('SELECT VERSION() v');
  await cn.query(`CREATE TABLE _migration_batches (batch_id VARCHAR(64) PRIMARY KEY, mode VARCHAR(16), source_path TEXT, source_sha256 CHAR(64), source_size BIGINT,
    mysql_version VARCHAR(64), tables_json MEDIUMTEXT, warnings_json MEDIUMTEXT, finished_at VARCHAR(32)) ENGINE=InnoDB`);
  await cn.query('INSERT INTO _migration_batches VALUES (?,?,?,?,?,?,?,?,?)', [BATCH, APPLY ? 'apply' : 'dryrun', src, sha, fs.statSync(src).size, sv.v, JSON.stringify(counts), JSON.stringify(S.warnings), new Date().toISOString()]);
  fs.writeFileSync(path.join(LOGDIR, `migration_counts_${BATCH}_${APPLY ? 'apply' : 'dryrun'}.json`), JSON.stringify({ batch: BATCH, target: TARGET, source_sha256: sha, excluded_test_users: excludedUsers, counts, warnings: S.warnings }, null, 1));
  if (!APPLY) { await cn.query(`DROP DATABASE ${q(TARGET)}`); log(`DRY RUN complete — scratch database ${TARGET} dropped; sh_pms_test untouched`); }
  else log(`APPLY complete — ${TARGET} populated`);
  await cn.end(); d.close();
})().catch(e => { log('FAILED', e.stack || e.message); process.exit(1); });
