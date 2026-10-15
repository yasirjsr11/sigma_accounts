const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { run, all, DB_PATH } = require('../db/db.js');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
// Cloud (MySQL) edition: System Backup = backup/mysqlBackup.js (mysqldump + uploads + manifest, off-server copy).
// The original SQLite-file ZIP logic below is kept only for DB_CLIENT=sqlite (staging comparison).
const CLOUD = !DB_PATH; const cloud = CLOUD ? require('./mysqlBackup.js') : null;
if (!CLOUD) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// Ensure backup_log table exists (idempotent)
if (!CLOUD) try {
  run(`CREATE TABLE IF NOT EXISTS backup_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    backup_type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    size_bytes INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
} catch (_) {}

function createBackup(type = 'manual', user = 'system') {
  if (CLOUD) return cloud.createBackup(type, user);
  return new Promise((resolve, reject) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `sh-pms-backup-${type}-${stamp}.zip`;
    const filePath = path.join(BACKUP_DIR, fileName);
    const output = fs.createWriteStream(filePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      const sizeBytes = archive.pointer();
      // Wrap in try/catch — a throw here escapes the Promise and crashes Node.js
      try {
        run(`INSERT INTO backup_log (backup_type, file_path, size_bytes) VALUES (?,?,?)`, [type, fileName, sizeBytes]);
      } catch (e) {
        console.warn('[backup] Could not log backup entry:', e.message);
      }
      resolve({ fileName, filePath, sizeBytes });
    });
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);

    // Database
    if (fs.existsSync(DB_PATH)) archive.file(DB_PATH, { name: 'database/sh_pms.sqlite' });
    // Uploaded source Excel files + attachments
    if (fs.existsSync(UPLOADS_DIR)) archive.directory(UPLOADS_DIR, 'uploads');

    archive.finalize();
  });
}

function listBackups() {
  if (CLOUD) return cloud.listBackups();
  return all('SELECT * FROM backup_log ORDER BY created_at DESC LIMIT 100');
}

function pruneOldBackups(keepDaily = 14, keepWeekly = 12) {
  if (CLOUD) return;   // cloud: local copies pruned after each backup; S3 lifecycle rules handle retention
  // Simple retention: keep N most recent of each type, delete the rest from disk + log
  for (const [type, keep] of [['daily', keepDaily], ['weekly', keepWeekly]]) {
    const rows = all(`SELECT * FROM backup_log WHERE backup_type = ? ORDER BY created_at DESC`, [type]);
    rows.slice(keep).forEach(r => {
      try { fs.unlinkSync(path.join(BACKUP_DIR, r.file_path)); } catch (e) {}
      run('DELETE FROM backup_log WHERE id = ?', [r.id]);
    });
  }
}

module.exports = { createBackup, listBackups, pruneOldBackups, BACKUP_DIR, CLOUD, cloud };
