const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { run, all, get } = require('../db/db.js');
const { requireLogin } = require('../middleware/auth.js');
const { can } = require('../middleware/permissions.js');
const router = express.Router();

const ATTACH_DIR = path.join(process.env.UPLOAD_PATH || path.join(__dirname, '..', 'uploads'), 'attachments');
fs.mkdirSync(ATTACH_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ATTACH_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`),
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

router.post('/:entityType/:entityId', requireLogin, upload.single('file'), (req, res) => {
  if (!can(req.session.user.role, 'upload')) return res.status(403).json({ error: 'Your role cannot upload attachments' });
  const { entityType, entityId } = req.params;
  if (!['project', 'factory_order', 'maintenance_record', 'amc_contract'].includes(entityType)) return res.status(400).json({ error: 'Invalid entity type' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  run(`INSERT INTO attachments (entity_type, entity_id, file_name, file_path, uploaded_by) VALUES (?,?,?,?,?)`,
    [entityType, entityId, req.file.originalname, req.file.filename, req.session.user.username]);
  res.status(201).json({ ok: true });
});

router.get('/:entityType/:entityId', requireLogin, (req, res) => {
  const rows = all(`SELECT * FROM attachments WHERE entity_type = ? AND entity_id = ? ORDER BY uploaded_at DESC`,
    [req.params.entityType, req.params.entityId]);
  res.json({ rows });
});

router.get('/download/:id', requireLogin, (req, res) => {
  const a = get('SELECT * FROM attachments WHERE id = ?', [req.params.id]);
  if (!a) return res.status(404).json({ error: 'Not found' });
  res.download(path.join(ATTACH_DIR, a.file_path), a.file_name);
});

router.delete('/:id', requireLogin, (req, res) => {
  const a = get('SELECT * FROM attachments WHERE id = ?', [req.params.id]);
  if (a) {
    try { fs.unlinkSync(path.join(ATTACH_DIR, a.file_path)); } catch (e) {}
    run('DELETE FROM attachments WHERE id = ?', [req.params.id]);
  }
  res.json({ ok: true });
});

module.exports = router;
