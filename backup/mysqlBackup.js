'use strict';
// ══════════════════════════════════════════════════════════════════════════════
// SH PMS Cloud — System Backup (MySQL edition)
//
//   One backup = one ZIP package:
//     database/<db>.sql              mysqldump logical dump (single consistent transaction; triggers included;
//                                    data of the `sessions` table excluded — login sessions are not business data)
//     database/sessions_schema.sql   structure only of `sessions`
//     uploads/…                      every file under UPLOAD_PATH (attachments, imported workbooks)
//     app/VERSION.json, app/package.json, app/package-lock.json   application version / dependency lock
//     manifest.json                  backup ID, date/time (UTC + UAE), database, versions, per-table row counts
//                                    (counted from the dump itself), SHA-256 + size of every file
//   + <package>.zip.sha256 next to the ZIP.  No environment secrets are ever included.
//
//   Verification after every backup: ZIP integrity test, every entry's SHA-256 re-checked against the
//   manifest, dump completeness marker, per-table INSERT counts. A backup is "success" only if verified
//   (and, when S3 is configured, uploaded and size-checked in S3).
//
//   Local storage only: BACKUP_DIR. The newest BACKUP_LOCAL_KEEP verified packages are retained.
//
//   Every run is recorded in system_backups (status running / success / failed, error text); failures are
//   also written to the service log (journald).  Restore is a DBA procedure (restore_backup.js), never a
//   button in the application.
// ══════════════════════════════════════════════════════════════════════════════
const fs = require('fs'); const path = require('path'); const os = require('os'); const crypto = require('crypto');
const { spawn } = require('child_process');
const archiver = require('archiver');
const { run, get, all } = require('../db/db.js');

const APP_DIR = path.join(__dirname, '..');
const cfg = () => ({
  db: process.env.DB_NAME, host: process.env.DB_HOST || '127.0.0.1', port: process.env.DB_PORT || '3306', socket: process.env.DB_SOCKET || '',
  user: process.env.BACKUP_DB_USER || '', password: process.env.BACKUP_DB_PASSWORD || '',
  dir: process.env.BACKUP_DIR || path.join(APP_DIR, 'backups'),
  uploads: process.env.UPLOAD_PATH || path.join(APP_DIR, 'uploads'),
  mysqldump: process.env.MYSQLDUMP_PATH || (process.platform === 'win32' ? 'C:\\xampp\\mysql\\bin\\mysqldump.exe' : 'mariadb-dump'),
  archiveTool: process.env.ARCHIVE_TOOL_PATH || (process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : 'tar'),
  keep: Math.max(1, Number(process.env.BACKUP_LOCAL_KEEP || 14)),
});
const RETENTION = { daily: '35 days', weekly: '13 weeks (91 days)', monthly: '13 months (395 days)', manual: '90 days' };
let running = null;

const nowUtc = () => new Date().toISOString();
const dubai = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'short' }).formatToParts(d).reduce((o, p) => (o[p.type] = p.value, o), {});
const sha256File = f => new Promise((ok, ko) => { const h = crypto.createHash('sha256'); fs.createReadStream(f).on('data', c => h.update(c)).on('end', () => ok(h.digest('hex'))).on('error', ko); });
function exec(cmd, args, opts = {}) {   // async child process; never logs arguments (no secrets in args by design)
  return new Promise((ok, ko) => { const p = spawn(cmd, args, { stdio: ['ignore', opts.stdout ? 'pipe' : 'ignore', 'pipe'], env: opts.env || process.env });
    let err = '', out = []; p.stderr.on('data', d => { err += d; if (err.length > 4000) err = err.slice(-4000); });
    if (opts.stdout) p.stdout.on('data', d => out.push(d));
    p.on('error', e => ko(new Error(`${path.basename(cmd)} could not start: ${e.message}`)));
    p.on('close', code => code === 0 ? ok(Buffer.concat(out)) : ko(new Error(`${path.basename(cmd)} exited ${code}: ${err.trim().split('\n').filter(l => !/Using a password/i.test(l)).slice(-3).join(' | ')}`))); });
}
function walk(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out); else if (e.isFile()) out.push(path.relative(base, p).split(path.sep).join('/')); }
  return out.sort();
}
function appVersion() { try { return JSON.parse(fs.readFileSync(path.join(APP_DIR, 'VERSION.json'), 'utf8')).version + ' (local MariaDB edition)'; } catch (_) { return 'unknown'; } }

/** Tier(s) for a scheduled daily backup, by UAE calendar date. */
function tiersFor(type, d = new Date()) {
  if (type !== 'daily') return [type];
  const p = dubai(d); const t = ['daily']; if (p.weekday === 'Sun') t.push('weekly'); if (p.day === '01') t.push('monthly'); return t;
}

async function createBackup(type = 'manual', user = 'system') {
  // Safety backups requested by application features (e.g. 'pre-reconcile-<batch>' before a payment
  // reconciliation commit) are stored as manual backups with that label.
  let label = null; if (/^pre-[a-z0-9_-]{1,60}$/i.test(type)) { label = type.toLowerCase(); type = 'manual'; }
  if (!['manual', 'daily'].includes(type)) throw Object.assign(new Error('Unknown backup type'), { status: 400 });
  if (running) throw Object.assign(new Error(`A backup is already running (${running})`), { status: 409 });
  const c = cfg();
  if (!c.user || !c.password) throw Object.assign(new Error('Backup database account is not configured (BACKUP_DB_USER / BACKUP_DB_PASSWORD).'), { status: 503 });
  const p = dubai(); const stamp = `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}`;
  const id = `SHPMS-${c.db}-${stamp}-${label || type}`; running = id;
  const tiers = tiersFor(type);
  run(`INSERT INTO system_backups (backup_id, backup_type, status, started_at, database_name, app_version, created_by) VALUES (?,?,?,?,?,?,?)`,
    [id, type, 'running', nowUtc(), c.db, appVersion(), user]);
  const work = path.join(c.dir, '.work', id); const zipName = `${id}.zip`; const zipPath = path.join(c.dir, zipName);
  let cnf = null;
  try {
    fs.mkdirSync(path.join(work, 'database'), { recursive: true, mode: 0o700 });
    // credentials for mysqldump via a private option file (never on the command line → not visible in ps)
    cnf = path.join(os.tmpdir(), `shpms-bk-${crypto.randomBytes(8).toString('hex')}.cnf`);
    fs.writeFileSync(cnf, `[client]\nuser=${c.user}\npassword="${c.password.replace(/(["\\])/g, '\\$1')}"\n` + (c.socket ? `socket=${c.socket}\n` : `host=${c.host}\nport=${c.port}\n`), { mode: 0o600 });
    const dumpFile = path.join(work, 'database', `${c.db}.sql`);
    const common = [`--defaults-extra-file=${cnf}`, '--single-transaction', '--quick',
      '--default-character-set=utf8mb4', '--hex-blob', '--skip-extended-insert', '--no-autocommit', '--triggers', '--skip-routines', '--skip-events'];
    await exec(c.mysqldump, [...common, `--ignore-table=${c.db}.sessions`, `--result-file=${dumpFile}`, c.db]);
    await exec(c.mysqldump, [...common, '--no-data', `--result-file=${path.join(work, 'database', 'sessions_schema.sql')}`, c.db, 'sessions']);
    // Dump completeness + per-table row counts taken from the dump itself (same consistent snapshot)
    const sql = fs.readFileSync(dumpFile, 'utf8');
    if (!/-- Dump completed on/.test(sql.slice(-400))) throw new Error('mysqldump output is incomplete (no completion marker)');
    const tables = {}; for (const m of sql.matchAll(/^CREATE TABLE `([^`]+)`/gm)) tables[m[1]] = 0;
    for (const m of sql.matchAll(/^INSERT INTO `([^`]+)` VALUES/gm)) tables[m[1]] = (tables[m[1]] || 0) + 1;
    const triggers = (sql.match(/\bCREATE\b[^\n]*\bTRIGGER\b/g) || []).length;
    const mysqlVersion = (sql.match(/-- Server version\s+(\S+)/) || [])[1] || null;
    // Package entries
    const uploads = walk(c.uploads);
    const entries = [{ name: `database/${c.db}.sql`, file: dumpFile }, { name: 'database/sessions_schema.sql', file: path.join(work, 'database', 'sessions_schema.sql') },
      ...uploads.map(u => ({ name: `uploads/${u}`, file: path.join(c.uploads, u) })),
      ...['VERSION.json', 'package.json', 'package-lock.json'].filter(f => fs.existsSync(path.join(APP_DIR, f))).map(f => ({ name: `app/${f}`, file: path.join(APP_DIR, f) }))];
    for (const e of entries) { e.size = fs.statSync(e.file).size; e.sha256 = await sha256File(e.file); }
    const dumpEntry = entries[0];
    const manifest = {
      format: 'sh-pms-cloud-backup/1', backup_id: id, backup_type: type, label, storage_tiers: tiers,
      created_at_utc: nowUtc(), created_at_uae: `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} (Asia/Dubai)`,
      database: c.db, mysql_server_version: mysqlVersion, app_version: appVersion(), node_version: process.version, host: os.hostname(),
      tables, tables_count: Object.keys(tables).length, total_rows: Object.values(tables).reduce((a, b) => a + b, 0), triggers,
      files: entries.map(e => ({ path: e.name, size: e.size, sha256: e.sha256 })),
      uploads: { files: uploads.length, bytes: entries.filter(e => e.name.startsWith('uploads/')).reduce((a, e) => a + e.size, 0) },
      excluded: ['data of the sessions table (login sessions)', 'environment file / secrets (SESSION_SECRET, DB passwords) — kept separately'],
      restore: 'See 05_Deployment/RESTORE_PROCEDURE.md — node restore_backup.js --zip <file> --target-db <db>',
    };
    fs.writeFileSync(path.join(work, 'manifest.json'), JSON.stringify(manifest, null, 1));
    // ZIP
    fs.mkdirSync(c.dir, { recursive: true, mode: 0o700 });
    await new Promise((ok, ko) => { const out = fs.createWriteStream(zipPath, { mode: 0o600 }); const a = archiver('zip', { zlib: { level: 9 } });
      out.on('close', ok); out.on('error', ko); a.on('error', ko); a.on('warning', ko); a.pipe(out);
      a.file(path.join(work, 'manifest.json'), { name: 'manifest.json' }); for (const e of entries) a.file(e.file, { name: e.name }); a.finalize(); });
    const zipSha = await sha256File(zipPath); const zipSize = fs.statSync(zipPath).size;
    fs.writeFileSync(zipPath + '.sha256', `${zipSha}  ${zipName}\n`, { mode: 0o600 });
    // Verify the package as written
    const verify = await verifyPackage(zipPath, manifest, c);
    // Local-only edition: no AWS/S3 dependency.
    const storage = 'local', s3Uris = [];
    run(`UPDATE system_backups SET status='success', finished_at=?, file_name=?, size_bytes=?, sha256=?, db_dump_sha256=?, tables_count=?, total_rows=?,
         uploads_files=?, uploads_bytes=?, verified=1, verify_details=?, storage=?, s3_uris=?, local_present=1, mysql_version=? WHERE backup_id=?`,
      [nowUtc(), zipName, zipSize, zipSha, dumpEntry.sha256, manifest.tables_count, manifest.total_rows, manifest.uploads.files, manifest.uploads.bytes,
        verify, storage, s3Uris.length ? JSON.stringify(s3Uris) : null, mysqlVersion, id]);
    pruneLocal(c);
    return { backup_id: id, fileName: zipName, sizeBytes: zipSize, sha256: zipSha, storage, s3: s3Uris, verified: true, tables: manifest.tables_count, total_rows: manifest.total_rows, uploads: manifest.uploads };
  } catch (e) {
    const msg = String(e.message || e).slice(0, 2000);
    console.error(`[backup] ${nowUtc()} BACKUP FAILED ${id}: ${msg}`);
    try { run(`UPDATE system_backups SET status='failed', finished_at=?, error=?, local_present=? WHERE backup_id=?`, [nowUtc(), msg, fs.existsSync(zipPath) ? 1 : 0, id]); } catch (_) {}
    throw Object.assign(new Error(`Backup failed: ${msg}`), { status: 500, backup_id: id });
  } finally {
    running = null; if (cnf) try { fs.unlinkSync(cnf); } catch (_) {}
    try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) {}
  }
}

/** ZIP integrity + every entry's SHA-256 vs manifest. Returns a short text summary; throws on any mismatch. */
async function verifyPackage(zipPath, manifest, c = cfg()) {
  const listing = (await exec(c.archiveTool, ['-tf', zipPath], { stdout: true })).toString().split(/\r?\n/).filter(Boolean);
  let n = 0;
  for (const f of manifest.files) {
    if (!listing.includes(f.path)) throw new Error(`verify: ${f.path} missing from package`);
    const h = crypto.createHash('sha256').update(await exec(c.archiveTool, ['-xOf', zipPath, f.path], { stdout: true })).digest('hex');
    if (h !== f.sha256) throw new Error(`verify: checksum mismatch for ${f.path}`); n++;
  }
  return `zip list OK; ${n}/${manifest.files.length} files SHA-256 verified; ${manifest.tables_count} tables / ${manifest.total_rows} rows in dump`;
}

function pruneLocal(c = cfg()) {
  const ok = all(`SELECT backup_id, file_name FROM system_backups WHERE status='success' AND local_present=1 ORDER BY id DESC`);
  for (const r of ok.slice(c.keep)) {
    for (const f of [r.file_name, r.file_name + '.sha256']) try { fs.unlinkSync(path.join(c.dir, f)); } catch (_) {}
    run('UPDATE system_backups SET local_present=0 WHERE backup_id=?', [r.backup_id]);
  }
}

function listBackups() {
  const c = cfg();
  return {
    rows: all(`SELECT backup_id, backup_type, status, started_at, finished_at, file_name, size_bytes, sha256, tables_count, total_rows, uploads_files,
                uploads_bytes, verified, verify_details, storage, s3_uris, local_present, error, created_by FROM system_backups ORDER BY id DESC LIMIT 100`),
    legacy: all('SELECT backup_type, file_path, size_bytes, created_at FROM backup_log ORDER BY created_at DESC LIMIT 100'),
    config: { s3_configured: false, s3_target: null, local_keep: c.keep, schedule: 'Daily 02:00 UAE time',
      retention: RETENTION, account_configured: !!(c.user && c.password), running },
  };
}
// Backup download — the ONLY way a package leaves the server through the application.
//   • the client supplies a backup ID, never a path; the ID must have the exact backup-ID shape
//   • the file name comes from system_backups (a successful, verified, locally present package) and must be a
//     plain "<backup id>.zip" name — no separators, no "..", no absolute paths, no encodings
//   • the resolved real path (symlinks followed) must be a REGULAR FILE directly inside the real backup directory;
//     a symlink planted in the backup directory is refused even if it points somewhere harmless
const BACKUP_ID_RE = /^SHPMS-[A-Za-z0-9_]{1,64}-\d{8}-\d{6}-[a-z0-9_-]{1,64}$/;
function localFile(backupId) {
  if (typeof backupId !== 'string' || !BACKUP_ID_RE.test(backupId)) return null;
  const r = get(`SELECT file_name FROM system_backups WHERE backup_id=? AND status='success' AND verified=1 AND local_present=1`, [backupId]);
  if (!r || r.file_name !== `${backupId}.zip`) return null;
  try {
    const dir = fs.realpathSync(cfg().dir); const f = path.join(dir, r.file_name);
    const st = fs.lstatSync(f); if (!st.isFile() || st.isSymbolicLink()) return null;
    const real = fs.realpathSync(f); if (path.dirname(real) !== dir) return null;
    return real;
  } catch (_) { return null; }
}
module.exports = { createBackup, listBackups, verifyPackage, localFile, tiersFor, RETENTION };
