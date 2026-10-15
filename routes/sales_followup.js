'use strict';
// Sales Follow-Up + Important Notes API (2026-10-01)
//   /api/sales-followup          register (KPIs + rows), history, add / edit / void follow-up, exports
//   /api/sales-followup/notes    personal reminder notes (separate from formal follow-up history)
// Works ON TOP of existing quotations: never creates/duplicates quotations, contracts,
// factory, maintenance or payment records. The only quotation fields a follow-up may
// change are status (explicit, role-checked) and contact details (explicit, role-checked),
// both logged to status_history / audit_log exactly like a normal quotation edit.
const express = require('express');
const { db, run, get, all } = require('../db/db.js');
const { requireModule } = require('../middleware/auth.js');
const { filterFieldsForRole } = require('../middleware/permissions.js');
const { writeAuditLog } = require('../db/audit.js');
const SF = require('../db/salesFollowup.js');
const { toExcelBuffer, toPdfBuffer } = require('../reports/render.js');
const router = express.Router();
router.use(requireModule('quotations'));

const WRITERS = new Set(['admin', 'sales']);              // roles that record follow-ups
const isAdmin = req => req.session.user.role === 'admin';
const user = req => req.session.user.username;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validDate = v => ISO.test(String(v || '')) && !isNaN(Date.parse(v + 'T00:00:00Z'));
const clean = v => (v === undefined || v === null) ? null : (String(v).trim() || null);
function requireWriter(req, res, next) {
  if (!WRITERS.has(req.session.user.role)) return res.status(403).json({ error: 'Your role can view follow-ups but cannot record them.' });
  next();
}

// ── Register ───────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const { rows, kpis, today } = SF.followupRegister(req.query);
    const pageSize = Math.min(9999, Math.max(1, parseInt(req.query.pageSize || req.query.page_size || '50', 10)));
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    res.json({ today, kpis, total: rows.length, page, pageSize, rows: rows.slice((page - 1) * pageSize, page * pageSize),
      options: { methods: SF.METHODS, results: SF.RESULTS, alerts: SF.ALERTS, statuses: SF.STATUS },
      can_write: WRITERS.has(req.session.user.role), is_admin: isAdmin(req) });
  } catch (e) { console.error('[sales-followup] list', e); res.status(500).json({ error: 'Unable to load Sales Follow-Up.' }); }
});

const EXPORT_COLS = ['Quote Ref.', 'Client', 'Project', 'Attention', 'Mobile', 'Tel', 'E-mail', 'Salesperson', 'Quotation Date',
  'Last Follow-Up', 'Next Follow-Up', 'Follow-Up Alert', 'Status', 'Latest Remarks'];
function registerReport(q) {
  const { rows, kpis } = SF.followupRegister(q);
  const fl = ['search', 'salesperson', 'status', 'alert', 'year', 'month', 'client'].filter(k => q[k]).map(k => `${k}: ${k === 'status' ? (SF.STATUS_LABEL[q[k]] || q[k]) : q[k]}`);
  return { title: 'Sales Follow-Up Register', columns: EXPORT_COLS,
    rows: rows.map(r => [r.quote_ref, r.client_name || '', r.project_name || '', r.attn_name || '', r.mobile || '', r.phone || '', r.email || '', r.salesperson || '',
      r.quotation_date || '', r.last_followup || '', r.next_followup || '', r.alert, r.status_label, r.last_remarks || '']),
    subtitle_lines: [fl.length ? `Filters: ${fl.join(' · ')}` : 'Filters: none'],
    pre_sections: [{ title: 'Summary', columns: ['Metric', 'Count'], rows: [['Open Quotations', kpis.open], ['Follow-Up Due Today', kpis.due_today],
      ['Overdue Follow-Ups', kpis.overdue], ['No Follow-Up Yet', kpis.no_followup], ['Negotiation', kpis.negotiation], ['Approved This Month', kpis.approved_this_month]] }],
    main_title: 'Follow-Up Register', excel_date_cols: ['Quotation Date', 'Last Follow-Up', 'Next Follow-Up'],
    col_weights: [5, 11, 16, 8, 7, 7, 9, 5, 6, 6, 6, 6, 6, 12] };
}
function historyReport(id) {
  const q = get('SELECT * FROM quotations WHERE id = ? AND is_deleted = 0', [id]);
  if (!q) return null;
  const h = SF.followupHistory(id, 'asc');
  return { title: `Follow-Up History — Quote ${q.quote_ref}`, columns: ['Date', 'Method', 'Result', 'Status', 'Next Follow-Up', 'Remarks', 'Entered By', 'Void'],
    rows: h.map(x => [x.followup_date, x.method, x.result, x.quotation_status_label, x.next_followup_date || '', x.remarks, x.entered_by || '', x.is_void ? `Voided: ${x.void_reason || ''}` : '']),
    subtitle_lines: [`${q.client_name || ''} — ${q.project_name || ''}`, `Salesperson: ${q.salesperson || ''} · Quotation Date: ${q.quotation_date || ''} · Status: ${SF.STATUS_LABEL[q.status] || q.status}`],
    main_title: 'All follow-up transactions', excel_date_cols: ['Date', 'Next Follow-Up'], col_weights: [7, 8, 11, 8, 8, 34, 8, 10] };
}
router.get('/export.:fmt', async (req, res) => {
  try {
    const rep = req.query.quotation_id ? historyReport(req.query.quotation_id) : registerReport(req.query);
    if (!rep) return res.status(404).json({ error: 'Quotation not found' });
    const fmt = req.params.fmt;
    if (fmt === 'xlsx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="sales-followup.xlsx"');
      return res.send(Buffer.from(await toExcelBuffer(rep)));
    }
    if (fmt === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="sales-followup.pdf"');
      return res.send(await toPdfBuffer(rep));
    }
    res.status(404).json({ error: 'Unknown format' });
  } catch (e) { console.error('[sales-followup] export', e); res.status(500).json({ error: 'Export failed' }); }
});

// ── Important Notes (personal reminders — NOT follow-up history) ───────────────
router.get('/notes', (req, res) => {
  const today = SF.localToday();
  const team = req.query.scope === 'team' && isAdmin(req);
  const view = req.query.view === 'completed' ? 1 : 0;
  const rows = all(`SELECT * FROM sales_notes WHERE is_deleted = 0 AND is_completed = ? ${team ? '' : 'AND owner = ?'}
      ORDER BY ${view ? 'completed_at DESC' : "CASE priority WHEN 'High' THEN 0 WHEN 'Normal' THEN 1 ELSE 2 END, COALESCE(reminder_date,'9999'), id DESC"}`,
    team ? [view] : [view, user(req)]);
  const badge = get(`SELECT COUNT(*) n FROM sales_notes WHERE is_deleted = 0 AND is_completed = 0 AND owner = ?
      AND (priority = 'High' OR (reminder_date IS NOT NULL AND reminder_date <= ?))`, [user(req), today]).n;
  res.json({ rows, badge, today, can_team: isAdmin(req) });
});
router.post('/notes', (req, res) => {
  const b = req.body || {};
  const note = clean(b.note);
  if (!note) return res.status(400).json({ error: 'Note text is required' });
  const priority = ['High', 'Normal', 'Low'].includes(b.priority) ? b.priority : 'Normal';
  if (b.reminder_date && !validDate(b.reminder_date)) return res.status(400).json({ error: 'Reminder date must be a valid date' });
  const qr = clean(b.quote_ref);
  if (qr && !get('SELECT id FROM quotations WHERE quote_ref = ? AND is_deleted = 0', [qr])) return res.status(400).json({ error: `Quote Ref. ${qr} not found` });
  const r = run(`INSERT INTO sales_notes (owner, quote_ref, note, priority, reminder_date, updated_at) VALUES (?,?,?,?,?,datetime('now'))`,
    [user(req), qr, note, priority, b.reminder_date || null]);
  res.status(201).json({ note: get('SELECT * FROM sales_notes WHERE id = ?', [Number(r.lastInsertRowid)]) });
});
router.patch('/notes/:id', (req, res) => {
  const n = get('SELECT * FROM sales_notes WHERE id = ? AND is_deleted = 0', [req.params.id]);
  if (!n) return res.status(404).json({ error: 'Note not found' });
  if (n.owner !== user(req) && !isAdmin(req)) return res.status(403).json({ error: 'You can only change your own notes' });
  const b = req.body || {}, u = {};
  if ('note' in b) { if (!clean(b.note)) return res.status(400).json({ error: 'Note text is required' }); u.note = clean(b.note); }
  if ('priority' in b) { if (!['High', 'Normal', 'Low'].includes(b.priority)) return res.status(400).json({ error: 'Invalid priority' }); u.priority = b.priority; }
  if ('reminder_date' in b) { if (b.reminder_date && !validDate(b.reminder_date)) return res.status(400).json({ error: 'Invalid reminder date' }); u.reminder_date = b.reminder_date || null; }
  if ('quote_ref' in b) u.quote_ref = clean(b.quote_ref);
  if ('is_completed' in b) {
    u.is_completed = b.is_completed ? 1 : 0;
    u.completed_at = b.is_completed ? new Date().toISOString() : null;
    u.completed_by = b.is_completed ? user(req) : null;
  }
  if (!Object.keys(u).length) return res.status(400).json({ error: 'Nothing to update' });
  run(`UPDATE sales_notes SET ${Object.keys(u).map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`, [...Object.values(u), n.id]);
  res.json({ note: get('SELECT * FROM sales_notes WHERE id = ?', [n.id]) });
});
router.delete('/notes/:id', (req, res) => {          // soft delete (kept in DB)
  const n = get('SELECT * FROM sales_notes WHERE id = ? AND is_deleted = 0', [req.params.id]);
  if (!n) return res.status(404).json({ error: 'Note not found' });
  if (n.owner !== user(req) && !isAdmin(req)) return res.status(403).json({ error: 'You can only remove your own notes' });
  run(`UPDATE sales_notes SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?`, [n.id]);
  res.json({ ok: true });
});

// ── Follow-up history for one quotation ─────────────────────────────────────────
router.get('/:quotationId/history', (req, res) => {
  const q = get('SELECT * FROM quotations WHERE id = ? AND is_deleted = 0', [req.params.quotationId]);
  if (!q) return res.status(404).json({ error: 'Quotation not found' });
  const history = SF.followupHistory(q.id, req.query.order === 'asc' ? 'asc' : 'desc');
  const live = history.filter(h => !h.is_void).sort((a, b) => (b.followup_date.localeCompare(a.followup_date)) || (b.id - a.id));
  const latest = live[0] || null;
  res.json({ quotation: { ...q, status_label: SF.STATUS_LABEL[q.status] || q.status },
    summary: { last_followup: latest ? latest.followup_date : null, next_followup: latest ? latest.next_followup_date : null,
      alert: SF.alertFor(q.status, latest && latest.followup_date, latest && latest.next_followup_date, SF.localToday()), count: live.length },
    history, can_write: WRITERS.has(req.session.user.role), is_admin: isAdmin(req), me: user(req),
    can_edit_status: (() => { const a = filterFieldsForRole(req.session.user.role, 'project', { status: 1 }); return 'status' in a; })(),
    options: { methods: SF.METHODS, results: SF.RESULTS, statuses: SF.STATUS } });
});

// ── Add follow-up (always a NEW history row) ────────────────────────────────────
router.post('/:quotationId', requireWriter, (req, res) => {
  const q = get('SELECT * FROM quotations WHERE id = ? AND is_deleted = 0', [req.params.quotationId]);
  if (!q) return res.status(404).json({ error: 'Quotation not found' });
  const b = req.body || {};
  const today = SF.localToday();
  if (!validDate(b.followup_date)) return res.status(400).json({ error: 'Follow-Up Date is required (valid date)' });
  if (b.followup_date > today) return res.status(400).json({ error: 'Follow-Up Date cannot be in the future — use Next Follow-Up Date for planning' });
  if (!SF.METHODS.includes(b.method)) return res.status(400).json({ error: 'Select a valid Follow-Up Method' });
  if (!SF.RESULTS.includes(b.result)) return res.status(400).json({ error: 'Select a valid Follow-Up Result' });
  const remarks = clean(b.remarks);
  if (!remarks) return res.status(400).json({ error: 'Remarks are required' });
  if (b.next_followup_date && !validDate(b.next_followup_date)) return res.status(400).json({ error: 'Next Follow-Up Date must be a valid date' });
  if (b.next_followup_date && b.next_followup_date < b.followup_date) return res.status(400).json({ error: 'Next Follow-Up Date cannot be before the Follow-Up Date' });
  const newStatus = b.quotation_status || q.status;
  if (!SF.STATUS_LABEL[newStatus]) return res.status(400).json({ error: 'Select a valid quotation status' });
  const statusChange = newStatus !== q.status;
  if (statusChange && !('status' in filterFieldsForRole(req.session.user.role, 'project', { status: newStatus })))
    return res.status(403).json({ error: 'Your role cannot change the quotation status' });
  if (statusChange && newStatus === 'lost' && remarks.length < 5) return res.status(400).json({ error: 'Enter the reason the quotation was lost in Remarks' });
  // Optional contact correction (explicit, role-checked)
  const contact = {};
  for (const k of ['attn_name', 'mobile', 'phone', 'email']) if (b.contact && k in b.contact && clean(b.contact[k]) !== clean(q[k])) contact[k] = clean(b.contact[k]);
  const contactAllowed = filterFieldsForRole(req.session.user.role, 'project', contact);
  if (Object.keys(contact).length !== Object.keys(contactAllowed).length) return res.status(403).json({ error: 'Your role cannot change contact details' });
  if (contact.email) contact.email = contact.email.replace(/^mailto:/i, '');

  const crid = clean(b.client_request_id);
  if (crid) {
    const dup = get('SELECT * FROM sales_quotation_followups WHERE client_request_id = ?', [crid]);
    if (dup) return res.json({ followup: dup, duplicate: true });       // double-click / retry protection
  }
  let id;
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = run(`INSERT INTO sales_quotation_followups (quotation_id, quote_ref, followup_date, method, result, quotation_status, status_changed_from,
        next_followup_date, remarks, entered_by, client_request_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [q.id, q.quote_ref, b.followup_date, b.method, b.result, newStatus, statusChange ? q.status : null, b.next_followup_date || null, remarks, user(req), crid]);
    id = Number(r.lastInsertRowid);
    if (statusChange || Object.keys(contact).length) {
      const u = { ...contact, ...(statusChange ? { status: newStatus } : {}) };
      run(`UPDATE quotations SET ${Object.keys(u).map(k => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...Object.values(u), new Date().toISOString(), q.id]);
      for (const [k, v] of Object.entries(u))
        run(`INSERT INTO status_history (entity_type, entity_id, field_name, old_value, new_value, changed_by, remarks) VALUES ('project', ?, ?, ?, ?, ?, ?)`,
          [q.id, k, q[k], v, user(req), `Sales Follow-Up ${b.followup_date}`]);
    }
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    if (crid && /UNIQUE/.test(e.message)) return res.json({ followup: get('SELECT * FROM sales_quotation_followups WHERE client_request_id = ?', [crid]), duplicate: true });
    console.error('[sales-followup] add', e); return res.status(500).json({ error: 'Unable to save the follow-up. Please try again.' });
  }
  writeAuditLog({ action: 'CREATE', module: 'sales_followup', recordId: id, recordRef: q.quote_ref, performedBy: user(req),
    details: { followup_date: b.followup_date, method: b.method, result: b.result, status: newStatus, status_changed_from: statusChange ? q.status : null,
      next_followup_date: b.next_followup_date || null, remarks, contact_changes: contact } });
  res.status(201).json({ followup: get('SELECT * FROM sales_quotation_followups WHERE id = ?', [id]) });
});

// ── Edit (correction) — audited; status is changed only through a new follow-up / quotation edit ──
router.patch('/entry/:id', requireWriter, (req, res) => {
  const f = get('SELECT * FROM sales_quotation_followups WHERE id = ?', [req.params.id]);
  if (!f || f.is_void) return res.status(404).json({ error: 'Follow-up not found' });
  if (f.entered_by !== user(req) && !isAdmin(req)) return res.status(403).json({ error: 'You can only correct your own follow-ups' });
  const b = req.body || {}, u = {};
  if ('followup_date' in b) { if (!validDate(b.followup_date) || b.followup_date > SF.localToday()) return res.status(400).json({ error: 'Invalid Follow-Up Date' }); u.followup_date = b.followup_date; }
  if ('method' in b) { if (!SF.METHODS.includes(b.method)) return res.status(400).json({ error: 'Invalid method' }); u.method = b.method; }
  if ('result' in b) { if (!SF.RESULTS.includes(b.result)) return res.status(400).json({ error: 'Invalid result' }); u.result = b.result; }
  if ('next_followup_date' in b) { if (b.next_followup_date && !validDate(b.next_followup_date)) return res.status(400).json({ error: 'Invalid Next Follow-Up Date' }); u.next_followup_date = b.next_followup_date || null; }
  if ('remarks' in b) { if (!clean(b.remarks)) return res.status(400).json({ error: 'Remarks are required' }); u.remarks = clean(b.remarks); }
  const nd = u.next_followup_date !== undefined ? u.next_followup_date : f.next_followup_date, fd = u.followup_date || f.followup_date;
  if (nd && nd < fd) return res.status(400).json({ error: 'Next Follow-Up Date cannot be before the Follow-Up Date' });
  const changed = Object.fromEntries(Object.entries(u).filter(([k, v]) => String(f[k] ?? '') !== String(v ?? '')));
  if (!Object.keys(changed).length) return res.json({ followup: f, unchanged: true });
  if (!clean(b.edit_reason)) return res.status(400).json({ error: 'A reason for the correction is required' });
  run(`UPDATE sales_quotation_followups SET ${Object.keys(changed).map(k => `${k} = ?`).join(', ')}, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
    [...Object.values(changed), user(req), f.id]);
  writeAuditLog({ action: 'UPDATE', module: 'sales_followup', recordId: f.id, recordRef: f.quote_ref, performedBy: user(req),
    details: { reason: clean(b.edit_reason), changes: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, { old: f[k], new: v }])) } });
  res.json({ followup: get('SELECT * FROM sales_quotation_followups WHERE id = ?', [f.id]) });
});

// ── Void (never hard-deleted) ──────────────────────────────────────────────────
router.post('/entry/:id/void', requireWriter, (req, res) => {
  const f = get('SELECT * FROM sales_quotation_followups WHERE id = ?', [req.params.id]);
  if (!f || f.is_void) return res.status(404).json({ error: 'Follow-up not found' });
  if (f.entered_by !== user(req) && !isAdmin(req)) return res.status(403).json({ error: 'You can only void your own follow-ups' });
  const reason = clean((req.body || {}).reason);
  if (!reason) return res.status(400).json({ error: 'A void reason is required' });
  run(`UPDATE sales_quotation_followups SET is_void = 1, void_reason = ?, voided_by = ?, voided_at = datetime('now') WHERE id = ?`, [reason, user(req), f.id]);
  writeAuditLog({ action: 'VOID', module: 'sales_followup', recordId: f.id, recordRef: f.quote_ref, performedBy: user(req), details: { reason, entry: f } });
  res.json({ ok: true });
});

module.exports = router;
