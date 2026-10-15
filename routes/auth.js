const express = require('express');
const bcrypt = require('bcryptjs');
const { get } = require('../db/db.js');
const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = get('SELECT * FROM users WHERE username = ? AND active = 1', [username]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  req.session.user = { id: user.id, username: user.username, full_name: user.full_name, role: user.role };
  res.json({ user: req.session.user });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  const u = req.session.user || null;
  // 2026-10-03: include the role's module list so the menu shows only permitted modules
  let modules = null;
  try { const R = require('../middleware/permissions.js').ROLES; modules = u && R[u.role] ? R[u.role].modules : null; } catch (_) {}
  res.json({ user: u ? { ...u, modules } : null });
});

module.exports = router;
