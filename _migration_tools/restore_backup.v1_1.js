'use strict';
// SH PMS Local MariaDB — RESTORE a System Backup package (DBA procedure; never run by the application).
//
//   node restore_backup.js --zip <SHPMS-…zip> --target-db <db> --uploads-dir <dir>
//        [--socket /var/run/mysqld/mysqld.sock --admin-user root]  |  [--env <file with MYSQL_ROOT_PASSWORD> --port 3306]
//        [--replace]        allow dropping an existing non-empty target database / non-empty uploads dir
//        [--allow-prod]     required for any database name containing "prod" (production restore needs approval)
//        [--app-user shpms_app --app-host localhost]   grant the application DML on the restored database
//        [--report <file.json>]
//
// Steps: 1 package checksum (.sha256 sidecar) · 2 ZIP integrity + every file's SHA-256 vs manifest ·
//        3 create target DB · 4 load the logical dump (+ sessions table structure) · 5 verify every table's row
//        count and the trigger count against the manifest · 6 trigger definer grants for the target DB
//        (install_trigger_definer.js) · 7 restore uploads and verify each file's SHA-256 · 8 report.
const fs = require('fs'); const path = require('path'); const os = require('os'); const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process'); const mysql = require('mysql2/promise');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, A) => a.startsWith('--') ? [a.slice(2), A[i + 1] && !A[i + 1].startsWith('--') ? A[i + 1] : true] : null).filter(Boolean));
const log = (...m) => console.log(`[${new Date().toISOString()}]`, ...m);
const die = m => { console.error(`[${new Date().toISOString()}] RESTORE FAILED: ${m}`); process.exit(1); };
const ZIP = args.zip, DB = args['target-db'], UP = args['uploads-dir'];
if (!ZIP || !DB || !UP) die('--zip, --target-db and --uploads-dir are required');
if (!/^[A-Za-z0-9_]+$/.test(DB)) die('invalid database name');
if (/prod/i.test(DB) && !args['allow-prod']) die(`refusing to restore into ${DB} without --allow-prod (production restore requires explicit approval)`);
const ARCHIVE = process.env.ARCHIVE_TOOL_PATH || (process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : 'tar');
const MYSQL = process.env.MYSQL_PATH || (process.platform === 'win32' ? 'C:\\xampp\\mysql\\bin\\mysql.exe' : 'mariadb');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const archiveList = () => execFileSync(ARCHIVE, ['-tf', ZIP], { maxBuffer: 1 << 30 }).toString().split(/\r?\n/).filter(Boolean);
const archiveRead = entry => execFileSync(ARCHIVE, ['-xOf', ZIP, entry], { maxBuffer: 1 << 30 });
(async () => {
  const report = { zip: path.resolve(ZIP), target_db: DB, uploads_dir: path.resolve(UP), started_utc: new Date().toISOString(), steps: {} };
  // 1 package checksum
  const zipSha = sha(fs.readFileSync(ZIP));
  if (fs.existsSync(ZIP + '.sha256')) { const exp = fs.readFileSync(ZIP + '.sha256', 'utf8').trim().split(/\s+/)[0];
    if (exp !== zipSha) die(`package checksum mismatch (${zipSha} ≠ ${exp})`); report.steps.package_sha256 = 'match (.sha256 sidecar)'; }
  else report.steps.package_sha256 = 'no sidecar — computed ' + zipSha;
  log('1 package SHA-256', report.steps.package_sha256);
  // 2 integrity + manifest checksums
  const listed = archiveList(); if (!listed.includes('manifest.json')) die('manifest.json missing from package');
  const manifest = JSON.parse(archiveRead('manifest.json').toString());
  for (const f of manifest.files) { if (!listed.includes(f.path)) die(`missing package entry: ${f.path}`); if (sha(archiveRead(f.path)) !== f.sha256) die(`checksum mismatch inside package: ${f.path}`); }
  report.backup_id = manifest.backup_id; report.manifest = { created_at_uae: manifest.created_at_uae, database: manifest.database, app_version: manifest.app_version, tables: manifest.tables_count, rows: manifest.total_rows, uploads: manifest.uploads };
  report.steps.package_verified = `${manifest.files.length} files SHA-256 verified`; log('2', report.steps.package_verified, '·', manifest.backup_id);
  // admin connection (root via socket on the server; password file in the sandbox)
  let pw; if (args.env) { const e = fs.readFileSync(args.env, 'utf8').match(/^MYSQL_ROOT_PASSWORD=(.*)$/m); pw = e && e[1]; }
  const conn = { user: args['admin-user'] || 'root', password: pw, socketPath: args.socket || undefined, host: args.socket ? undefined : (args.host || '127.0.0.1'), port: args.port ? Number(args.port) : undefined };
  const cn = await mysql.createConnection(conn);
  // 3 target database
  const [[ex]] = await cn.query('SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=?', [DB]);
  if (ex.n && !args.replace) die(`target database ${DB} exists and is not empty (use --replace)`);
  await cn.query(`DROP DATABASE IF EXISTS \`${DB}\``); await cn.query(`CREATE DATABASE \`${DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin`);
  log('3 target database created', DB);
  // 4 load dump with the mysql client (credentials in a private option file)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shpms-restore-')); const cnf = path.join(tmp, 'c.cnf');
  fs.writeFileSync(cnf, `[client]\nuser=${conn.user}\n` + (pw ? `password="${pw.replace(/(["\\])/g, '\\$1')}"\n` : '') + (conn.socketPath ? `socket=${conn.socketPath}\n` : `host=${conn.host}\nport=${conn.port || 3306}\n`), { mode: 0o600 });

  // MariaDB's dump format may schema-qualify CREATE TRIGGER names even when the dump was
  // created without --databases, e.g. CREATE TRIGGER `source_db`.`trg_name` ... .
  // If such a dump is restored into another database, mysql's selected target database does
  // not override that qualifier. Retarget only SQL structure tokens; NEVER global-replace the
  // database name because it may legitimately occur inside business data.
  const retargetDump = (buf, sourceDb, targetDb) => {
    if (!sourceDb || sourceDb === targetDb) return buf;
    let sql = buf.toString('utf8');
    const esc = sourceDb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let changed = 0;
    sql = sql.replace(new RegExp('(\\bTRIGGER\\s+)`' + esc + '`\\.`', 'gi'), (m, p1) => { changed++; return p1 + '`' + targetDb + '`.`'; });
    sql = sql.replace(new RegExp('^\\s*USE\\s+`' + esc + '`\\s*;', 'gmi'), () => { changed++; return 'USE `' + targetDb + '`;'; });
    // Our backup format must not contain CREATE/DROP DATABASE statements. Refuse such a package
    // rather than attempting a broad rewrite that could target the wrong schema.
    if (/^\s*(?:CREATE|DROP)\s+DATABASE\b/im.test(sql)) throw new Error('backup dump unexpectedly contains CREATE/DROP DATABASE; refusing automatic retarget');
    report.steps.schema_retarget = changed ? `${changed} source-schema reference(s) retargeted ${sourceDb} → ${targetDb}` : 'no source-schema qualifiers needed';
    return Buffer.from(sql, 'utf8');
  };

  // Feed mysql from a real temporary file instead of a live stdin pipe. This is more reliable
  // on Windows and, when mysql exits on an SQL error, preserves the real stderr instead of
  // surfacing a secondary Node EPIPE error.
  const load = (entry, transform) => new Promise((ok, ko) => {
    const raw = archiveRead(entry); const body = transform ? transform(raw) : raw;
    const inFile = path.join(tmp, 'load-' + crypto.randomBytes(6).toString('hex') + '.sql');
    fs.writeFileSync(inFile, Buffer.concat([Buffer.from('SET autocommit=0;\n'), body, Buffer.from('\nCOMMIT;\n')]));
    const fd = fs.openSync(inFile, 'r');
    const p = spawn(MYSQL, [`--defaults-extra-file=${cnf}`, '--default-character-set=utf8mb4', DB], { stdio: [fd, 'ignore', 'pipe'] });
    let err = ''; p.stderr.on('data', d => err += d);
    p.on('error', e => { try { fs.closeSync(fd); } catch (_) {} ko(e); });
    p.on('close', c => { try { fs.closeSync(fd); } catch (_) {} try { fs.unlinkSync(inFile); } catch (_) {}
      c === 0 ? ok() : ko(new Error(`mysql exited ${c}: ${err.split('\n').filter(l => !/Using a password/.test(l)).join(' ').slice(0, 1000)}`)); });
  });
  const t0 = Date.now();
  await load(`database/${manifest.database}.sql`, b => retargetDump(b, manifest.database, DB)); await load('database/sessions_schema.sql');
  fs.rmSync(tmp, { recursive: true, force: true });
  report.steps.dump_loaded = `${((Date.now() - t0) / 1000).toFixed(1)} s`; log('4 dump loaded', report.steps.dump_loaded);
  // 5 verify counts + triggers
  const bad = [];
  for (const [t, n] of Object.entries(manifest.tables)) { const [[r]] = await cn.query(`SELECT COUNT(*) n FROM \`${DB}\`.\`${t}\``); if (Number(r.n) !== n) bad.push(`${t}: ${r.n} ≠ ${n}`); }
  const [[tg]] = await cn.query('SELECT COUNT(*) n, GROUP_CONCAT(DISTINCT DEFINER) d FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=?', [DB]);
  if (bad.length) die(`row counts differ from manifest: ${bad.join('; ')}`);
  if (Number(tg.n) !== manifest.triggers) die(`trigger count ${tg.n} ≠ manifest ${manifest.triggers}`);
  report.steps.verify_counts = `${Object.keys(manifest.tables).length} tables, ${manifest.total_rows} rows — all match the manifest; triggers ${tg.n} (definer ${tg.d})`; log('5', report.steps.verify_counts);
  // 6 trigger definer grants for this database
  const inst = path.join(__dirname, 'install_trigger_definer.js');
  const ia = ['--db', DB, ...(args.socket ? ['--socket', args.socket] : ['--port', String(conn.port || 3306)]), ...(args.env ? ['--env', args.env] : []), ...(args['admin-user'] ? ['--admin-user', args['admin-user']] : []), ...(/prod/i.test(DB) ? ['--allow-prod'] : [])];
  const io = execFileSync(process.execPath, [inst, ...ia], { encoding: 'utf8' }).split('\n').filter(l => /re-created|refused|locked=/.test(l));
  report.steps.trigger_definer = io.map(l => l.replace(/^\[[^\]]+\]\s*/, '')).join(' / '); log('6', report.steps.trigger_definer);
  // the package's own history row was captured while that backup was still running — record its known outcome
  try { await cn.query(`UPDATE \`${DB}\`.system_backups SET status='success', verify_details='restored from this package (status captured while running)' WHERE backup_id=? AND status='running'`, [manifest.backup_id]); } catch (_) {}
  if (args['app-user']) { const h = args['app-host'] || 'localhost'; await cn.query(`GRANT SELECT, INSERT, UPDATE, DELETE, CREATE TEMPORARY TABLES ON \`${DB}\`.* TO ?@?`, [args['app-user'], h]); report.steps.app_grant = `${args['app-user']}@${h} DML`; }
  await cn.end();
  // 7 uploads
  if (fs.existsSync(UP) && fs.readdirSync(UP).length && !args.replace) die(`uploads dir ${UP} is not empty (use --replace)`);
  fs.mkdirSync(UP, { recursive: true }); let nf = 0;
  for (const f of manifest.files.filter(x => x.path.startsWith('uploads/'))) {
    const rel = f.path.slice('uploads/'.length); if (rel.split('/').some(s => s === '..' || s === '')) die(`unsafe path in package: ${f.path}`);
    const dst = path.join(UP, rel); fs.mkdirSync(path.dirname(dst), { recursive: true }); const b = archiveRead(f.path);
    if (sha(b) !== f.sha256) die(`upload checksum mismatch: ${rel}`); fs.writeFileSync(dst, b); nf++; }
  report.steps.uploads = `${nf} files restored and SHA-256 verified`; log('7', report.steps.uploads);
  report.finished_utc = new Date().toISOString(); report.result = 'RESTORE COMPLETE';
  if (args.report) fs.writeFileSync(args.report, JSON.stringify(report, null, 1));
  log('8 RESTORE COMPLETE —', manifest.backup_id, '→', DB);
})().catch(e => die(e.message));
