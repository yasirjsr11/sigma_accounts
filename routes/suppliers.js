// Supplier Master routes (2026-10-03) — /api/suppliers
//   GET    /                 list (+ order / payment usage); ?status=Active|Inactive&search=
//   GET    /meta             types / statuses / can_manage
//   GET    /check?name=      duplicate check (case / space-insensitive)
//   POST   /                 create            (admin / management)
//   PATCH  /:id              edit / activate / deactivate (admin / management)
//   DELETE /:id              hard delete ONLY when never used (admin)
const express = require('express');
const { requireModule, requireRole } = require('../middleware/auth.js');
const SUP = require('../db/suppliers.js');
const router = express.Router();

const MANAGERS = ['admin', 'management'];
const canManage = req => !!(req.session && req.session.user && MANAGERS.includes(req.session.user.role));
const fail = (res, e) => res.status(e.status || 500).json({ error: e.message, ...(e.extra || {}) });

router.use(requireModule('factory'));

router.get('/meta', (req, res) => res.json({ types: SUP.TYPES, statuses: SUP.STATUSES, can_manage: canManage(req) }));

router.get('/check', (req, res) => {
  const s = SUP.findByName(req.query.name || '');
  res.json({ exists: !!s, supplier: s || null, normalized: SUP.normalizeSupplierName(req.query.name || '') });
});

router.get('/', (req, res) => {
  try { res.json({ rows: SUP.list({ status: req.query.status || null, search: req.query.search || null }), can_manage: canManage(req) }); }
  catch (e) { fail(res, e); }
});

router.post('/', requireRole(MANAGERS), (req, res) => {
  try { res.status(201).json({ supplier: SUP.create(req.body || {}, req.session.user.username) }); }
  catch (e) { fail(res, e); }
});

router.patch('/:id', requireRole(MANAGERS), (req, res) => {
  try { res.json(SUP.update(Number(req.params.id), req.body || {}, req.session.user.username)); }
  catch (e) { fail(res, e); }
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  try { res.json(SUP.remove(Number(req.params.id), req.session.user.username)); }
  catch (e) { fail(res, e); }
});

module.exports = router;
