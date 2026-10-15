#!/usr/bin/env node
/**
 * SH-PMS Safe Backup / Restore
 *
 * Usage:
 *   node scripts/safe-backup.js backup [--label <label>]
 *     Creates a timestamped copy of sh_pms.sqlite in db/backups/.
 *     Writes a .meta.json sidecar with version, record counts, and label.
 *
 *   node scripts/safe-backup.js restore <backup-file>
 *     Copies <backup-file> over sh_pms.sqlite.
 *     REFUSES if the backup is older than the current DB version unless --force is passed.
 *
 *   node scripts/safe-backup.js list
 *     Lists all backups in db/backups/ with version, date, label.
 *
 * Safety rules:
 *   - Never restores an older version over a newer one without --force.
 *   - Always reads record counts before restoring so they are logged.
 *   - Backup filenames are immutable (timestamped); never overwritten.
 */

'use strict';
const fs   = require('fs');
const path = require('path');

const APP_DIR     = path.join(__dirname, '..');
const DB_PATH     = path.join(APP_DIR, 'db', 'sh_pms.sqlite');
const BACKUP_DIR  = path.join(APP_DIR, 'db', 'backups');
const VER_PATH    = path.join(APP_DIR, 'VERSION.json');

// ── helpers ──────────────────────────────────────────────────────────────────
function die(msg) { console.error('ERROR:', msg); process.exit(1); }
function log(msg)  { console.log(msg); }

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function readCurrentVersion() {
  // Try app_versions table first
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = MEMORY;');
    const row = db.prepare(
      "SELECT version, applied_at FROM app_versions ORDER BY id DESC LIMIT 1"
    ).get();
    db.close();
    return row ? { version: row.version, applied_at: row.applied_at } : null;
  } catch(_) {}
  // Fallback to VERSION.json
  if (fs.existsSync(VER_PATH)) {
    try {
      const v = JSON.parse(fs.readFileSync(VER_PATH,'utf8'));
      return { version: v.version, applied_at: v.build_date };
    } catch(_) {}
  }
  return null;
}

function getRecordCounts() {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = MEMORY;');
    const counts = {};
    const tables = [
      ['contracts',          'SELECT COUNT(*) c FROM contracts WHERE is_deleted=0'],
      ['quotations',         'SELECT COUNT(*) c FROM quotations WHERE is_deleted=0'],
      ['factory_ins',        'SELECT COUNT(*) c FROM factory_ins_quotes WHERE is_deleted=0'],
      ['factory_otj',        'SELECT COUNT(*) c FROM factory_otj_quotes WHERE is_deleted=0'],
      ['factory_sea',        'SELECT COUNT(*) c FROM factory_sea_costs WHERE is_deleted=0'],
      ['client_payments',    'SELECT COUNT(*) c FROM client_payments WHERE is_deleted=0'],
      ['factory_payments',   'SELECT COUNT(*) c FROM factory_payments WHERE is_deleted=0'],
      ['maintenance',        'SELECT COUNT(*) c FROM maintenance_contracts WHERE is_deleted=0'],
    ];
    for (const [k, sql] of tables) {
      try { counts[k] = db.prepare(sql).get().c; } catch(_) { counts[k] = null; }
    }
    db.close();
    return counts;
  } catch(e) {
    return { error: e.message };
  }
}

function versionToDate(v) {
  // SH-PMS-v2026.07.13.01 → 20260713.01
  const m = String(v).match(/v(\d{4})\.(\d{2})\.(\d{2})\.(\d{2})/);
  if (!m) return 0;
  return Number(`${m[1]}${m[2]}${m[3]}.${m[4]}`);
}

// ── commands ─────────────────────────────────────────────────────────────────
const cmd    = process.argv[2];
const argv   = process.argv.slice(3);
const force  = argv.includes('--force');
const labelIdx = argv.indexOf('--label');
const label  = labelIdx >= 0 ? argv[labelIdx + 1] : 'manual';

if (!cmd) {
  console.log('Usage: node scripts/safe-backup.js backup|restore|list [options]');
  process.exit(0);
}

// ── backup ───────────────────────────────────────────────────────────────────
if (cmd === 'backup') {
  ensureBackupDir();
  if (!fs.existsSync(DB_PATH)) die(`DB not found: ${DB_PATH}`);

  const ver   = readCurrentVersion();
  const verStr = ver ? ver.version : 'unknown';
  const now   = new Date();
  const ts    = now.toISOString().replace(/[:.]/g,'-').slice(0,19);
  const fname = `sh_pms_${ts}_${verStr}.sqlite`;
  const dest  = path.join(BACKUP_DIR, fname);

  if (fs.existsSync(dest)) die(`Backup already exists: ${fname}`);

  fs.copyFileSync(DB_PATH, dest);

  const counts = getRecordCounts();
  const meta = {
    backup_file:  fname,
    version:      verStr,
    backup_time:  now.toISOString(),
    label,
    record_counts: counts,
    db_size_bytes: fs.statSync(dest).size,
  };
  fs.writeFileSync(dest + '.meta.json', JSON.stringify(meta, null, 2));

  log(`Backup created: db/backups/${fname}`);
  log(`Version: ${verStr}`);
  log(`Records: ${JSON.stringify(counts)}`);
  log(`Size: ${(meta.db_size_bytes / 1024).toFixed(1)} KB`);
  process.exit(0);
}

// ── list ──────────────────────────────────────────────────────────────────────
if (cmd === 'list') {
  ensureBackupDir();
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.sqlite'))
    .sort();
  if (files.length === 0) { log('No backups found in db/backups/'); process.exit(0); }
  log(`\nBackups in db/backups/ (${files.length} total):\n`);
  for (const f of files) {
    const metaPath = path.join(BACKUP_DIR, f + '.meta.json');
    if (fs.existsSync(metaPath)) {
      const m = JSON.parse(fs.readFileSync(metaPath,'utf8'));
      const sz = (m.db_size_bytes/1024).toFixed(0);
      log(`  ${f}`);
      log(`    Version: ${m.version}  Date: ${m.backup_time.slice(0,10)}  Label: ${m.label}  Size: ${sz} KB`);
    } else {
      const sz = (fs.statSync(path.join(BACKUP_DIR,f)).size/1024).toFixed(0);
      log(`  ${f}  (no meta, ${sz} KB)`);
    }
  }
  process.exit(0);
}

// ── restore ───────────────────────────────────────────────────────────────────
if (cmd === 'restore') {
  let src = argv.find(a => !a.startsWith('--'));
  if (!src) die('Specify backup file: node scripts/safe-backup.js restore <file>');
  if (!path.isAbsolute(src)) src = path.join(BACKUP_DIR, src);
  if (!fs.existsSync(src)) die(`Backup not found: ${src}`);

  // Read backup meta
  let backupVersion = 'unknown';
  const metaPath = src + '.meta.json';
  if (fs.existsSync(metaPath)) {
    const m = JSON.parse(fs.readFileSync(metaPath,'utf8'));
    backupVersion = m.version;
    log(`Backup version: ${backupVersion}  Date: ${m.backup_time.slice(0,10)}  Label: ${m.label}`);
  }

  // Read current DB version
  const cur = readCurrentVersion();
  const curVersion = cur ? cur.version : 'unknown';
  log(`Current DB version: ${curVersion}`);

  // Safety check: refuse to restore older over newer
  if (backupVersion !== 'unknown' && curVersion !== 'unknown') {
    const bv = versionToDate(backupVersion);
    const cv = versionToDate(curVersion);
    if (bv < cv && !force) {
      die(
        `REFUSED: backup version (${backupVersion}) is older than current DB (${curVersion}).\n` +
        '  This could cause data loss. If you are sure, re-run with --force.'
      );
    }
    if (bv < cv && force) {
      log(`WARNING: restoring OLDER version ${backupVersion} over ${curVersion} (--force active)`);
    }
  }

  // Current record counts (pre-restore)
  const preCounts = getRecordCounts();
  log(`Pre-restore counts: ${JSON.stringify(preCounts)}`);

  // Write the backup over the live DB
  fs.copyFileSync(src, DB_PATH);

  log(`\nRestore complete.`);
  log(`Restored: ${path.basename(src)}`);
  log(`To DB:    ${DB_PATH}`);
  log('\nIMPORTANT: Restart the Node.js server to pick up the restored database.');
  process.exit(0);
}

die(`Unknown command: ${cmd}. Use backup, restore, or list.`);
