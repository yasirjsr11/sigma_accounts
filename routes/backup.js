const express = require('express');
const path = require('path');
const { requireModule, requireRole } = require('../middleware/auth.js');
const { createBackup, listBackups, BACKUP_DIR, CLOUD, cloud } = require('../backup/backup.js');
const router = express.Router();

router.get('/', requireModule('backup'), (req, res) => {
  res.json(CLOUD ? { cloud: true, ...listBackups() } : { rows: listBackups() });
});

router.post('/run', requireModule('backup'), requireRole('admin'), async (req, res) => {
  try {
    const result = await createBackup('manual', req.session.user.username);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Download — Cloud edition security fix: the original handler joined the client-supplied name onto the backup
// directory (path traversal). Here a client value is only ever used as a lookup key, never as a path.
router.get('/download/:fileName', requireModule('backup'), requireRole('admin'), (req, res) => {
  const notFound = () => res.status(404).json({ error: 'This backup is not available on the server (older packages are kept in off-server storage only).' });
  if (CLOUD) {   // MySQL: by backup ID, only verified packages recorded in system_backups
    const f = cloud.localFile(req.params.fileName);
    if (!f) return notFound();
    return res.download(f, path.basename(f), { dotfiles: 'deny' });
  }
  // DB_CLIENT=sqlite (staging comparison only): only a plain file name recorded in backup_log, resolved inside BACKUP_DIR
  const name = req.params.fileName;
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*\.zip$/.test(name) || name.includes('..')) return notFound();
  const { get } = require('../db/db.js');
  if (!get('SELECT id FROM backup_log WHERE file_path = ?', [name])) return notFound();
  try {
    const fs = require('fs'); const dir = fs.realpathSync(BACKUP_DIR); const f = path.join(dir, name);
    const st = fs.lstatSync(f); if (!st.isFile() || st.isSymbolicLink() || path.dirname(fs.realpathSync(f)) !== dir) return notFound();
    return res.download(f, name, { dotfiles: 'deny' });
  } catch (_) { return notFound(); }
});

module.exports = router;
