// Quotations module (redesigned 2026-07-02; CRM-only update 2026-07-16).
// 2026-09-21: Status simplified to 6 approved values:
//   quoted | follow_up | negotiation | approved | lost | tender
// Quote Ref. is the primary unique ID. Project Code not shown/generated in quotation stage.
// Contract Value stored as contract_value; aliased to quoted_value in API responses.
// Module is fully independent — no links to Contracts, Maintenance, Factory, or Accounts.
// Attachments and Factory Order links removed from GET /:id response (UI tabs removed).
// Payment fields (quotation_value, payment_terms, payment_received, balance_amount) hidden
// from API/UI — DB columns preserved for historical data integrity.
// Note: entity_type literal stays 'project' in status_history —
// that table has a CHECK(entity_type IN ('project','factory_order',...)) constraint
// that was deliberately left unchanged.
const express = require('express');
const { run, get, all } = require('../db/db.js');
const { requireModule, requireRole } = require('../middleware/auth.js');
const { filterFieldsForRole, can } = require('../middleware/permissions.js');
const { writeAuditLog } = require('../db/audit.js');
const router = express.Router();

// Centralized status list — matches DB CHECK constraint exactly (2026-09-21 simplified)
const ALLOWED_STATUSES = [
  'quoted', 'follow_up', 'negotiation', 'approved', 'lost', 'tender',
];

// Track status/payment changes; contract_value (internally) = Quoted Value in UI
const TRACKED_FIELDS = ['status', 'contract_value'];

// Add quoted_value alias to a row (DB stores as contract_value; UI shows as Quoted Value)
function aliasRow(r) {
  if (!r) return r;
  return { ...r, quoted_value: r.contract_value };
}

const QUOTATION_SORT_COLS = {
  quote_ref: 'quote_ref',
  client_name: 'client_name',
  project_name: 'project_name',   // UI label "Project Description"; DB column stays project_name
  salesperson: 'salesperson',
  status: 'status',
  quotation_date: 'quotation_date',
  quoted_value: 'contract_value', // UI alias; DB stores as contract_value
  updated_at: 'updated_at',
};

router.get('/', requireModule('quotations'), (req, res) => {
  const { search, status, salesperson, quote_ref, year, month, sort, dir, page = 1, pageSize = 50 } = req.query;
  const where = ['is_deleted = 0'];
  const params = [];
  if (search) {
    where.push('(client_name LIKE ? OR project_name LIKE ? OR quote_ref LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (quote_ref) { where.push('quote_ref = ?'); params.push(quote_ref); }
  if (status) { where.push('status = ?'); params.push(status); }
  if (salesperson) { where.push('salesperson = ?'); params.push(salesperson); }
  if (year && month) {
    const mm = String(parseInt(month)).padStart(2, '0');
    where.push('quotation_date LIKE ?');
    params.push(`${year}-${mm}%`);
  } else if (year) {
    where.push('quotation_date LIKE ?');
    params.push(`${year}%`);
  }

  const sortCol = QUOTATION_SORT_COLS[sort] || 'updated_at';
  const sortDir = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const whereSql = where.join(' AND ');
  const total = get(`SELECT COUNT(*) c FROM quotations WHERE ${whereSql}`, params).c;
  const limit = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;
  const rows = all(`SELECT * FROM quotations WHERE ${whereSql} ORDER BY ${sortCol} ${sortDir}, quotation_date DESC, quote_ref DESC, id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  res.json({ total, page: Number(page), pageSize: limit, rows: rows.map(aliasRow) });
});

router.get('/revisions/:quote_ref', requireModule('quotations'), (req, res) => {
  const revisions = all(
    `SELECT * FROM quotation_revisions WHERE quote_ref = ? ORDER BY revision_no ASC`,
    [req.params.quote_ref]
  );
  res.json({ revisions });
});

router.get('/:id', requireModule('quotations'), (req, res) => {
  const quotation = get('SELECT * FROM quotations WHERE id = ?', [req.params.id]);
  if (!quotation) return res.status(404).json({ error: 'Not found' });
  const history = all(`SELECT * FROM status_history WHERE entity_type = 'project' AND entity_id = ? ORDER BY changed_at DESC`, [req.params.id]);
  const q = aliasRow(quotation);
  res.json({ quotation: q, project: q, history });
});

router.post('/', requireModule('quotations'), (req, res) => {
  if (!can(req.session.user.role, 'create')) return res.status(403).json({ error: 'Your role cannot create new quotations' });
  const b = req.body || {};
  if (!b.client_name && !b.project_name) return res.status(400).json({ error: 'client_name or project_name required' });

  let qRef = (b.quote_ref && String(b.quote_ref).trim()) ? String(b.quote_ref).trim() : ('QR-' + Date.now());
  let finalRef = qRef, n = 1;
  while (get('SELECT id FROM quotations WHERE quote_ref = ? AND is_deleted = 0', [finalRef])) {
    finalRef = qRef + '-' + (++n);
  }

  let projectCode = 'PC-' + Date.now();
  if (get('SELECT id FROM quotations WHERE project_code = ?', [projectCode])) {
    projectCode = 'PC-' + Date.now() + '-' + Math.floor(Math.random() * 99999);
  }

  const contractValue = b.quoted_value !== undefined ? b.quoted_value : (b.contract_value || null);
  const statusVal = (b.status && String(b.status).trim()) ? String(b.status).trim() : 'quoted';

  if (!ALLOWED_STATUSES.includes(statusVal)) {
    return res.status(400).json({ error: 'Please select a valid quotation status.' });
  }

  try {
    run(`INSERT INTO quotations
      (project_code, quote_ref, client_name, project_name, location, salesperson, attn_name, phone, mobile, email,
       quotation_date, status, contract_value, remarks, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [projectCode, finalRef,
       b.client_name || null, b.project_name || null, b.location || null,
       b.salesperson || null, b.attn_name || null, b.phone || null, b.mobile || null, b.email || null,
       b.quotation_date || null, statusVal,
       contractValue,
       b.remarks || null, req.session.user.username]);

    const quotation = aliasRow(get('SELECT * FROM quotations WHERE quote_ref = ? AND is_deleted = 0 ORDER BY id DESC LIMIT 1', [finalRef]));
    res.status(201).json({ quotation, project: quotation });
  } catch (err) {
    console.error('[quotations] POST error:', err.message);
    if (err.message && (err.message.includes('CHECK constraint') || err.message.includes('FOREIGN KEY'))) {
      return res.status(400).json({ error: 'Please select a valid quotation status.' });
    }
    if (err.message && err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'A quotation with that Quote Ref already exists.' });
    }
    res.status(500).json({ error: 'Failed to create quotation. Please try again.' });
  }
});

router.patch('/:id', requireModule('quotations'), (req, res) => {
  const existing = get('SELECT * FROM quotations WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const role = req.session.user.role;
  const rawBody = Object.assign({}, req.body || {});
  if ('quoted_value' in rawBody) { rawBody.contract_value = rawBody.quoted_value; delete rawBody.quoted_value; }

  const incoming = filterFieldsForRole(role, 'project', rawBody);
  delete incoming.remarks_note;
  if (Object.keys(incoming).length === 0) return res.status(403).json({ error: 'No fields in this request are editable by your role' });

  const remarksNote = req.body.remarks_note || null;
  const updates = Object.assign({}, incoming, { updated_at: new Date().toISOString() });
  const setSql = Object.keys(updates).map(k => k + ' = ?').join(', ');
  if (incoming.status !== undefined && !ALLOWED_STATUSES.includes(incoming.status)) {
    return res.status(400).json({ error: 'Please select a valid quotation status.' });
  }

  try {
    run('UPDATE quotations SET ' + setSql + ' WHERE id = ?', [...Object.values(updates), req.params.id]);
  } catch (err) {
    console.error('[quotations] PATCH error:', err.message);
    if (err.message && err.message.includes('CHECK constraint')) {
      return res.status(400).json({ error: 'Please select a valid quotation status.' });
    }
    return res.status(500).json({ error: 'Failed to update quotation. Please try again.' });
  }

  for (const field of TRACKED_FIELDS) {
    if (field in incoming && String(existing[field]) !== String(incoming[field])) {
      run(`INSERT INTO status_history (entity_type, entity_id, field_name, old_value, new_value, changed_by, remarks)
           VALUES ('project', ?, ?, ?, ?, ?, ?)`,
        [req.params.id, field, existing[field], incoming[field], req.session.user.username, remarksNote]);
    }
  }

  res.json({ quotation: aliasRow(get('SELECT * FROM quotations WHERE id = ?', [req.params.id])) });
});

router.delete('/:id', requireModule('quotations'), requireRole('admin'), (req, res) => {
  const quotation = get('SELECT * FROM quotations WHERE id = ? AND is_deleted = 0', [req.params.id]);
  if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
  run('UPDATE quotations SET is_deleted = 1, updated_at = datetime(\'now\') WHERE id = ?', [req.params.id]);
  run(`INSERT INTO status_history (entity_type, entity_id, field_name, old_value, new_value, changed_by, remarks)
       VALUES ('project', ?, 'is_deleted', '0', '1', ?, 'Deleted via UI')`, [req.params.id, req.session.user.username]);
  writeAuditLog({
    action: 'DELETE', module: 'quotations',
    recordId: quotation.id, recordRef: quotation.quote_ref,
    details: { client_name: quotation.client_name, status: quotation.status, salesperson: quotation.salesperson },
    performedBy: req.session.user.username,
  });
  res.json({ ok: true });
});

router.post('/:id/restore', requireModule('quotations'), requireRole('admin'), (req, res) => {
  run('UPDATE quotations SET is_deleted = 0, updated_at = datetime(\'now\') WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// ── Quotation Revisions ───────────────────────────────────────────────────────

// POST /api/quotations/revisions — create a new revision
router.post('/revisions', requireModule('quotations'), (req, res) => {
  const { quote_ref, revision_reason, quoted_value, remarks } = req.body || {};
  if (!quote_ref) return res.status(400).json({ error: 'quote_ref required' });

  const quotation = get('SELECT * FROM quotations WHERE quote_ref = ? AND is_deleted=0', [quote_ref]);
  if (!quotation) return res.status(404).json({ error: `Quote Ref. ${quote_ref} not found` });

  const maxRev = get('SELECT COALESCE(MAX(revision_no), -1) m FROM quotation_revisions WHERE quote_ref = ?', [quote_ref]);
  const nextRevNo = (maxRev.m || 0) + 1;

  run(`UPDATE quotation_revisions SET status = 'Superseded', is_current = 0 WHERE quote_ref = ?`, [quote_ref]);

  run(`INSERT INTO quotation_revisions
    (quote_ref, revision_no, revision_date, revised_by, revision_reason,
     quoted_value, status, client_approval_status, is_current, remarks)
    VALUES (?,?,date('now'),?,?,?,'Active','Pending',1,?)`,
    [quote_ref, nextRevNo, req.session.user.username,
     revision_reason || null, quoted_value || quotation.contract_value, remarks || null]);

  // 'Revised' removed from approved status set (2026-09-21) — keep quotation at current status;
  // revision history is preserved in quotation_revisions.

  const lc = get('SELECT id FROM project_lifecycle WHERE quote_ref = ?', [quote_ref]);
  if (lc) {
    run(`UPDATE project_lifecycle SET current_stage='Revised', updated_at=datetime('now') WHERE id=?`, [lc.id]);
  }

  res.status(201).json({ revision_no: nextRevNo, label: `R${nextRevNo}` });
});

// PATCH /api/quotations/revisions/:id — update revision status / approval
router.patch('/revisions/:id', requireModule('quotations'), (req, res) => {
  const rev = get('SELECT * FROM quotation_revisions WHERE id = ?', [req.params.id]);
  if (!rev) return res.status(404).json({ error: 'Revision not found' });
  const { status, client_approval_status, remarks } = req.body || {};
  const sets = ['revision_date = revision_date'];
  const vals = [];
  if (status) { sets.push('status = ?'); vals.push(status); }
  if (client_approval_status) { sets.push('client_approval_status = ?'); vals.push(client_approval_status); }
  if (remarks !== undefined) { sets.push('remarks = ?'); vals.push(remarks); }

  if (client_approval_status === 'Approved') {
    const lc = get('SELECT id FROM project_lifecycle WHERE quote_ref = ?', [rev.quote_ref]);
    run(`UPDATE quotations SET status='Approved', updated_at=datetime('now') WHERE quote_ref=?`, [rev.quote_ref]);
    if (lc) run(`UPDATE project_lifecycle SET current_stage='Approved', updated_at=datetime('now') WHERE id=?`, [lc.id]);
  }
  run(`UPDATE quotation_revisions SET ${sets.join(', ')} WHERE id=?`, [...vals, req.params.id]);
  res.json({ revision: get('SELECT * FROM quotation_revisions WHERE id=?', [req.params.id]) });
});

module.exports = router;
