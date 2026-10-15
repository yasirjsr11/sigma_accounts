'use strict';
// routes/links.js — Project Lifecycle Hub (redesigned 2026-07-03)
// Central link manager: Quotation ↔ Contract ↔ Factory ↔ Maintenance

const express = require('express');
const router = express.Router();
const { run, get, all } = require('../db/db.js');
const { requireLogin, requireModule, requireRole } = require('../middleware/auth.js');
const { writeAuditLog } = require('../db/audit.js');

const auth = [requireLogin, requireModule('links')];

const STAGES = [
  'Quotation','Revised','Approved','Contract Created','Production',
  'Shipping','Delivered','Installation','Testing & Commissioning',
  'Handover','Free Maintenance','AMC Active','AMC Expired'
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function enrichLifecycle(row) {
  if (!row) return row;
  // Attach factory links
  row.factory_links = all(
    `SELECT * FROM lifecycle_factory_links WHERE lifecycle_id = ? ORDER BY linked_at`,
    [row.id]
  );
  return row;
}

// ── LIST ──────────────────────────────────────────────────────────────────────

router.get('/lifecycle', ...auth, (req, res) => {
  const { search, stage, salesperson, status = 'Active', page = 1, page_size = 50 } = req.query;
  const where = ["pl.status != 'Archived'"];
  const params = [];

  if (status && status !== 'all') { where.push('pl.status = ?'); params.push(status); }
  if (stage) { where.push('pl.current_stage = ?'); params.push(stage); }
  if (salesperson) { where.push('pl.salesperson = ?'); params.push(salesperson); }
  if (search) {
    where.push(`(pl.quote_ref LIKE ? OR pl.contract_ref LIKE ? OR pl.maintenance_ref LIKE ?
      OR pl.client_name LIKE ? OR pl.project_name LIKE ? OR pl.salesperson LIKE ?)`);
    const s = `%${search}%`;
    params.push(s, s, s, s, s, s);
  }

  const whereSql = where.join(' AND ');
  const total = get(`SELECT COUNT(*) c FROM project_lifecycle pl WHERE ${whereSql}`, params).c;
  const lim = Math.min(parseInt(page_size) || 50, 500);
  const off = (Math.max(parseInt(page) || 1, 1) - 1) * lim;

  const rows = all(`
    SELECT pl.*,
      q.project_name AS q_project_name, q.status AS q_status, q.contract_value AS q_value,
      c.approval_date, c.contract_value, c.emirate,
      mc.renewal_status, mc.end_date AS mc_end_date
    FROM project_lifecycle pl
    LEFT JOIN quotations q ON q.project_code = pl.quote_ref AND q.is_deleted = 0
    LEFT JOIN contracts c ON c.contract_ref = pl.contract_ref AND c.is_deleted = 0
    LEFT JOIN maintenance_contracts mc ON mc.maintenance_id = pl.maintenance_ref AND mc.is_deleted = 0
    WHERE ${whereSql}
    ORDER BY pl.updated_at DESC
    LIMIT ? OFFSET ?`, [...params, lim, off]);

  // Attach factory link counts (not full data for list view)
  const ids = rows.map(r => r.id);
  const flinks = ids.length
    ? all(`SELECT lifecycle_id, COUNT(*) c FROM lifecycle_factory_links WHERE lifecycle_id IN (${ids.map(()=>'?').join(',')}) GROUP BY lifecycle_id`, ids)
    : [];
  const flinkMap = {};
  flinks.forEach(f => { flinkMap[f.lifecycle_id] = f.c; });
  rows.forEach(r => { r.factory_link_count = flinkMap[r.id] || 0; });

  res.json({ total, page: Number(page), pageSize: lim, rows });
});

// ── SINGLE ────────────────────────────────────────────────────────────────────

router.get('/lifecycle/:id', ...auth, (req, res) => {
  const row = get(`
    SELECT pl.*,
      q.project_name AS q_project_name, q.status AS q_status, q.contract_value AS q_value,
      c.approval_date, c.contract_value, c.emirate, c.project_description,
      mc.renewal_status, mc.end_date AS mc_end_date, mc.client_name AS mc_client
    FROM project_lifecycle pl
    LEFT JOIN quotations q ON q.project_code = pl.quote_ref AND q.is_deleted = 0
    LEFT JOIN contracts c ON c.contract_ref = pl.contract_ref AND c.is_deleted = 0
    LEFT JOIN maintenance_contracts mc ON mc.maintenance_id = pl.maintenance_ref AND mc.is_deleted = 0
    WHERE pl.id = ?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(enrichLifecycle(row));
});

// ── CREATE ────────────────────────────────────────────────────────────────────

router.post('/lifecycle', ...auth, (req, res) => {
  const { quote_ref, contract_ref, client_name, project_name, salesperson, current_stage, remarks } = req.body || {};
  if (!quote_ref && !contract_ref) return res.status(400).json({ error: 'quote_ref or contract_ref required' });

  // Prevent duplicate contract_ref
  if (contract_ref) {
    const ex = get('SELECT id FROM project_lifecycle WHERE contract_ref = ?', [contract_ref]);
    if (ex) return res.status(409).json({ error: `Contract Ref. ${contract_ref} already has a lifecycle entry (ID ${ex.id})` });
  }

  const stage = STAGES.includes(current_stage) ? current_stage : (contract_ref ? 'Contract Created' : 'Quotation');
  const user = req.session.user.username;

  const result = run(`INSERT INTO project_lifecycle
    (quote_ref, contract_ref, client_name, project_name, salesperson, current_stage,
     linked_by, contract_linked_by, contract_linked_at, quote_linked_by, quote_linked_at, remarks)
    VALUES (?,?,?,?,?,?,?,?,datetime('now'),?,datetime('now'),?)`,
    [quote_ref || null, contract_ref || null, client_name || null, project_name || null,
     salesperson || null, stage, user,
     contract_ref ? user : null,
     quote_ref ? user : null,
     remarks || null]);

  res.status(201).json({ id: result.lastInsertRowid });
});

// ── UPDATE ────────────────────────────────────────────────────────────────────

router.patch('/lifecycle/:id', ...auth, (req, res) => {
  const lc = get('SELECT * FROM project_lifecycle WHERE id = ?', [req.params.id]);
  if (!lc) return res.status(404).json({ error: 'Not found' });
  const user = req.session.user.username;
  const now = new Date().toISOString();
  const b = req.body || {};

  const sets = ['updated_at = datetime(\'now\')'];
  const vals = [];

  // Stage update
  if (b.current_stage && STAGES.includes(b.current_stage)) {
    sets.push('current_stage = ?'); vals.push(b.current_stage);
  }

  // Link a quotation
  if (b.link_quote_ref !== undefined) {
    if (b.link_quote_ref) {
      const q = get('SELECT project_code FROM quotations WHERE project_code = ? AND is_deleted=0', [b.link_quote_ref]);
      if (!q) return res.status(404).json({ error: `Quote Ref. ${b.link_quote_ref} not found` });
    }
    sets.push('quote_ref = ?', 'quote_linked_by = ?', 'quote_linked_at = ?');
    vals.push(b.link_quote_ref || null, user, now);
  }

  // Link a contract
  if (b.link_contract_ref !== undefined) {
    if (b.link_contract_ref) {
      const c = get('SELECT contract_ref FROM contracts WHERE contract_ref = ? AND is_deleted=0', [b.link_contract_ref]);
      if (!c) return res.status(404).json({ error: `Contract Ref. ${b.link_contract_ref} not found` });
      const ex = get('SELECT id FROM project_lifecycle WHERE contract_ref = ? AND id != ?', [b.link_contract_ref, lc.id]);
      if (ex) return res.status(409).json({ error: `Contract Ref. ${b.link_contract_ref} is already linked to another lifecycle entry` });
      // Sync client/project/salesperson from contract if not set
      const cRow = get('SELECT * FROM contracts WHERE contract_ref = ?', [b.link_contract_ref]);
      if (cRow) {
        if (!lc.client_name && cRow.client_name) { sets.push('client_name = ?'); vals.push(cRow.client_name); }
        if (!lc.salesperson && cRow.sales_by) { sets.push('salesperson = ?'); vals.push(cRow.sales_by); }
      }
    }
    sets.push('contract_ref = ?', 'contract_linked_by = ?', 'contract_linked_at = ?', 'contract_link_remarks = ?');
    vals.push(b.link_contract_ref || null, user, now, b.contract_link_remarks || null);
  }

  // Link a maintenance record
  if (b.link_maintenance_ref !== undefined) {
    if (b.link_maintenance_ref) {
      const mc = get('SELECT maintenance_id FROM maintenance_contracts WHERE maintenance_id = ? AND is_deleted=0', [b.link_maintenance_ref]);
      if (!mc) return res.status(404).json({ error: `Maintenance Ref. ${b.link_maintenance_ref} not found` });
    }
    sets.push('maintenance_ref = ?', 'maintenance_linked_by = ?', 'maintenance_linked_at = ?');
    vals.push(b.link_maintenance_ref || null, user, now);
  }

  // Free-form fields
  ['client_name','project_name','salesperson','remarks'].forEach(f => {
    if (f in b) { sets.push(`${f} = ?`); vals.push(b[f] || null); }
  });

  run(`UPDATE project_lifecycle SET ${sets.join(', ')} WHERE id = ?`, [...vals, lc.id]);
  res.json({ ok: true });
});

// ── ARCHIVE ───────────────────────────────────────────────────────────────────

router.delete('/lifecycle/:id', ...auth, requireRole('admin'), (req, res) => {
  const lc = get('SELECT * FROM project_lifecycle WHERE id = ?', [req.params.id]);
  if (!lc) return res.status(404).json({ error: 'Lifecycle entry not found' });
  run(`UPDATE project_lifecycle SET status = 'Archived', updated_at = datetime('now') WHERE id = ?`, [req.params.id]);
  writeAuditLog({
    action: 'ARCHIVE', module: 'project_lifecycle',
    recordId: lc.id, recordRef: lc.quote_ref || lc.contract_ref || String(lc.id),
    details: { quote_ref: lc.quote_ref, contract_ref: lc.contract_ref, client_name: lc.client_name, stage: lc.current_stage },
    performedBy: req.session.user.username,
  });
  res.json({ ok: true });
});

// ── FACTORY LINKS ─────────────────────────────────────────────────────────────

router.post('/lifecycle/:id/factory-link', ...auth, (req, res) => {
  const lc = get('SELECT * FROM project_lifecycle WHERE id = ?', [req.params.id]);
  if (!lc) return res.status(404).json({ error: 'Lifecycle entry not found' });

  const { factory_ref, factory_table, supplier_name, remarks } = req.body || {};
  if (!factory_ref) return res.status(400).json({ error: 'factory_ref required' });
  const validTable = ['sea_costs','otj_quotes','ins_quotes'].includes(factory_table);
  if (!validTable) return res.status(400).json({ error: 'factory_table must be sea_costs, otj_quotes, or ins_quotes' });

  run(`INSERT INTO lifecycle_factory_links
    (lifecycle_id, quote_ref, contract_ref, factory_ref, factory_table, supplier_name, linked_by, remarks)
    VALUES (?,?,?,?,?,?,?,?)`,
    [lc.id, lc.quote_ref, lc.contract_ref, factory_ref, factory_table, supplier_name || null,
     req.session.user.username, remarks || null]);

  run(`UPDATE project_lifecycle SET updated_at = datetime('now') WHERE id = ?`, [lc.id]);
  res.status(201).json({ ok: true });
});

router.delete('/factory-link/:id', ...auth, (req, res) => {
  const fl = get('SELECT * FROM lifecycle_factory_links WHERE id = ?', [req.params.id]);
  if (!fl) return res.status(404).json({ error: 'Not found' });
  run('DELETE FROM lifecycle_factory_links WHERE id = ?', [req.params.id]);
  run(`UPDATE project_lifecycle SET updated_at = datetime('now') WHERE id = ?`, [fl.lifecycle_id]);
  writeAuditLog({
    action: 'UNLINK', module: 'lifecycle_factory_links',
    recordId: fl.id, recordRef: fl.factory_ref,
    details: { factory_ref: fl.factory_ref, factory_table: fl.factory_table, lifecycle_id: fl.lifecycle_id },
    performedBy: req.session.user.username,
  });
  res.json({ ok: true });
});

// ── CREATE MAINTENANCE FROM CONTRACT ──────────────────────────────────────────

router.post('/lifecycle/:id/create-maintenance', ...auth, (req, res) => {
  const lc = get('SELECT * FROM project_lifecycle WHERE id = ?', [req.params.id]);
  if (!lc) return res.status(404).json({ error: 'Lifecycle entry not found' });
  if (!lc.contract_ref) return res.status(400).json({ error: 'No contract linked to this lifecycle entry' });
  if (lc.maintenance_ref) return res.status(409).json({ error: `Maintenance record already exists: ${lc.maintenance_ref}` });

  const contract = get('SELECT * FROM contracts WHERE contract_ref = ? AND is_deleted=0', [lc.contract_ref]);
  if (!contract) return res.status(404).json({ error: `Contract ${lc.contract_ref} not found` });

  const { assigned_technician, warranty_period, free_maintenance_period, start_date, remarks } = req.body || {};

  // Generate maintenance_id: MC-{year}-{seq}
  const year = new Date().getFullYear();
  const seq = (get(`SELECT COUNT(*) c FROM maintenance_contracts WHERE maintenance_id LIKE 'MC-${year}-%'`).c || 0) + 1;
  const maintenance_id = `MC-${year}-${String(seq).padStart(3, '0')}`;

  const user = req.session.user.username;
  const now = new Date().toISOString().slice(0, 10);

  run(`INSERT INTO maintenance_contracts
    (maintenance_id, contract_ref, current_status, client_name, emirate,
     maintenance_type, maintenance_period, start_date, end_date,
     assigned_technician, remarks, renewal_status, created_by)
    VALUES (?,?,'Linked',?,?,?,?,?,?,?,?,?,?)`,
    [
      maintenance_id, lc.contract_ref, contract.client_name, contract.emirate || null,
      'AMC', free_maintenance_period ? parseInt(free_maintenance_period) : null,
      start_date || contract.handover_date || now,
      null,  // end_date calculated from period if needed
      assigned_technician || null,
      remarks || `Auto-created from Contract ${lc.contract_ref} via Project Lifecycle`,
      'Active Maintenance', user
    ]);

  // Link maintenance ref back to lifecycle
  run(`UPDATE project_lifecycle
    SET maintenance_ref = ?, maintenance_linked_by = ?, maintenance_linked_at = datetime('now'),
        current_stage = 'Free Maintenance', updated_at = datetime('now')
    WHERE id = ?`,
    [maintenance_id, user, lc.id]);

  res.status(201).json({ maintenance_id, ok: true });
});

// ── SEARCH ENDPOINTS ──────────────────────────────────────────────────────────

router.get('/search/quotes', ...auth, (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const rows = all(`SELECT project_code AS quote_ref, client_name, project_name, salesperson, status, contract_value
    FROM quotations
    WHERE is_deleted = 0 AND (project_code LIKE ? OR client_name LIKE ? OR project_name LIKE ?)
    ORDER BY updated_at DESC LIMIT 30`, [q, q, q]);
  res.json({ rows });
});

router.get('/search/contracts', ...auth, (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const rows = all(`SELECT contract_ref, quote_ref, client_name, sales_by AS salesperson,
      approval_date, contract_value, emirate
    FROM contracts
    WHERE is_deleted = 0 AND (contract_ref LIKE ? OR client_name LIKE ? OR quote_ref LIKE ?)
    ORDER BY updated_at DESC LIMIT 30`, [q, q, q]);
  res.json({ rows });
});

router.get('/search/factory', ...auth, (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const sea = all(`SELECT factory_ref, supplier_name, client_name, contract_ref, 'sea_costs' AS factory_table
    FROM factory_sea_costs WHERE factory_ref LIKE ? OR supplier_name LIKE ? OR client_name LIKE ? LIMIT 15`, [q,q,q]);
  const otj = all(`SELECT factory_ref, supplier_name, client_name, contract_ref, 'otj_quotes' AS factory_table
    FROM factory_otj_quotes WHERE factory_ref LIKE ? OR supplier_name LIKE ? OR client_name LIKE ? LIMIT 15`, [q,q,q]);
  const ins = all(`SELECT factory_ref, supplier_name, client_name, contract_ref, 'ins_quotes' AS factory_table
    FROM factory_ins_quotes WHERE factory_ref LIKE ? OR supplier_name LIKE ? OR client_name LIKE ? LIMIT 15`, [q,q,q]);
  res.json({ rows: [...sea, ...otj, ...ins] });
});

module.exports = router;
