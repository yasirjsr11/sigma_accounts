const express = require('express');
const bcrypt = require('bcryptjs');
const { run, get, all } = require('../db/db.js');
const { requireRole } = require('../middleware/auth.js');
const { writeAuditLog } = require('../db/audit.js');
const router = express.Router();

router.get('/', requireRole('admin'), (req, res) => {
  res.json({ rows: all('SELECT id, username, full_name, role, active, created_at FROM users ORDER BY id') });
});

router.post('/', requireRole('admin'), (req, res) => {
  const { username, full_name, role, password } = req.body || {};
  if (!username || !full_name || !role || !password) return res.status(400).json({ error: 'username, full_name, role, password required' });
  if (get('SELECT id FROM users WHERE username = ?', [username])) return res.status(409).json({ error: 'Username already exists' });
  const hash = bcrypt.hashSync(password, 10);
  run('INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,?)', [username, hash, full_name, role]);
  res.status(201).json({ ok: true });
});

router.patch('/:id', requireRole('admin'), (req, res) => {
  const { full_name, role, active, password } = req.body || {};
  if (full_name) run('UPDATE users SET full_name = ? WHERE id = ?', [full_name, req.params.id]);
  if (role) run('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
  if (active !== undefined) run('UPDATE users SET active = ? WHERE id = ?', [active ? 1 : 0, req.params.id]);
  res.json({ ok: true });
});

// Deactivate (soft-delete) a user — cannot delete own account
router.delete('/:id', requireRole('admin'), (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (req.session.user && String(req.session.user.id) === String(req.params.id)) {
    return res.status(400).json({ error: 'You cannot deactivate your own account.' });
  }
  run('UPDATE users SET active = 0 WHERE id = ?', [req.params.id]);
  writeAuditLog({
    action: 'DEACTIVATE', module: 'users',
    recordId: user.id, recordRef: user.username,
    details: { username: user.username, role: user.role, full_name: user.full_name },
    performedBy: req.session.user.username,
  });
  res.json({ ok: true });
});

// Admin-only: audit log viewer
router.get('/audit-log', requireRole('admin'), (req, res) => {
  const { module: mod, action, page = 1, pageSize = 50 } = req.query;
  const where = [];
  const params = [];
  if (mod)    { where.push('module = ?');    params.push(mod); }
  if (action) { where.push('action = ?');    params.push(action); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limit  = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;
  const total  = get(`SELECT COUNT(*) c FROM audit_log ${whereSql}`, params).c;
  const rows   = all(`SELECT * FROM audit_log ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]);
  res.json({ total, page: Number(page), pageSize: limit, rows });
});

// Admin-only: system info (version, counts, uptime)
router.get('/system-info', requireRole('admin'), (req, res) => {
  const { db } = require('../db/db.js');
  const fs = require('fs');
  const path = require('path');
  const VER_PATH = path.join(__dirname, '..', 'VERSION.json');

  const counts = {};
  const countQueries = [
    ['contracts',          "SELECT COUNT(*) c FROM contracts WHERE is_deleted=0"],
    ['quotations',         "SELECT COUNT(*) c FROM quotations WHERE is_deleted=0"],
    ['factory_ins_quotes', "SELECT COUNT(*) c FROM factory_ins_quotes WHERE is_deleted=0"],
    ['factory_otj_quotes', "SELECT COUNT(*) c FROM factory_otj_quotes WHERE is_deleted=0"],
    ['factory_sea_costs',  "SELECT COUNT(*) c FROM factory_sea_costs WHERE is_deleted=0"],
    ['client_payments',    "SELECT COUNT(*) c FROM client_payments WHERE is_deleted=0"],
    ['factory_payments',   "SELECT COUNT(*) c FROM factory_payments WHERE is_deleted=0"],
    ['maintenance_contracts',"SELECT COUNT(*) c FROM maintenance_contracts WHERE is_deleted=0"],
    ['users',              "SELECT COUNT(*) c FROM users"],
    ['audit_log',          "SELECT COUNT(*) c FROM audit_log"],
    ['project_lifecycle',  "SELECT COUNT(*) c FROM project_lifecycle"],
  ];
  for (const [k, sql] of countQueries) {
    try { counts[k] = db.prepare(sql).get().c; } catch(_) { counts[k] = null; }
  }

  let verInfo = { version: 'unknown', build_date: null, description: null };
  try {
    const row = db.prepare("SELECT version, applied_at, description, change_summary FROM app_versions ORDER BY id DESC LIMIT 1").get();
    if (row) verInfo = { version: row.version, applied_at: row.applied_at, description: row.description, change_summary: row.change_summary };
  } catch(_) {}
  if (verInfo.version === 'unknown' && fs.existsSync(VER_PATH)) {
    try { const v = JSON.parse(fs.readFileSync(VER_PATH,'utf8')); verInfo = { version: v.version, build_date: v.build_date, description: v.description }; } catch(_) {}
  }

  let versionHistory = [];
  try { versionHistory = db.prepare("SELECT version, migration_id, applied_at, description FROM app_versions ORDER BY id ASC").all(); } catch(_) {}

  res.json({
    current_version:   verInfo,
    version_history:   versionHistory,
    record_counts:     counts,
    server_uptime_sec: Math.floor(process.uptime()),
    node_version:      process.version,
    platform:          process.platform,
    timestamp:         new Date().toISOString(),
  });
});


module.exports = router;
