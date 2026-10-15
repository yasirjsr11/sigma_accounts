// Alerts & Reminders module — routes.
//
// Five sections:
//   1. Expiring Contracts  — dynamic query on maintenance_contracts (no separate table)
//   2. Renewal Status      — alert_renewals table (manual tracking)
//   3. Payment Status      — alert_payments table (manual tracking)
//   4. Call Back/Emergency — alert_callbacks table (auto-generated Call Back Ref.)
//   5. Monthly CB Summary  — aggregate query on alert_callbacks
//
// Legacy routes (engine recompute, resolve) kept for Dashboard badge compatibility.

const express = require('express');
const { run, get, all } = require('../db/db.js');
const { requireModule, requireRole } = require('../middleware/auth.js');
const { recomputeAlerts } = require('../alerts/engine.js');
const { writeAuditLog } = require('../db/audit.js');
const amcPay = require('../db/amcPayments.js');
const { mcNotCancelledSql, isEligibleForRenewalAlert, currentEndSql, currentStartSql,
        displayRenewalIdSql, renewalInProgressSql, hasActiveRenewalSql,
        evaluateAMCActionRequired } = require('../db/amcEligibility.js');
const router = express.Router();

// ── Helpers ────────────────────────────────────────────────────────────────
const RENEWAL_STATUS_OPTS   = ['Pending','Approved','Renewed','Not Renewed','Cancelled','Hold'];
const PAYMENT_STATUS_OPTS   = ['Unpaid','Partial','Paid','Overdue','Hold'];
const CALLBACK_STATUS_OPTS  = ['Open','Assigned','Attended','Completed','Pending Parts','Client Hold','Cancelled'];
const PRIORITY_OPTS         = ['Normal','Urgent','Emergency'];

function contractLinkStatus(contractRef) {
  if (!contractRef) return 'Pending Contract Ref.';
  const c = get(`SELECT id FROM contracts WHERE contract_ref = ? AND is_deleted = 0`, [contractRef]);
  if (c) return 'Linked';
  const m = get(`SELECT id FROM maintenance_contracts WHERE contract_ref = ? AND is_deleted = 0`, [contractRef]);
  return m ? 'Linked (MC)' : 'Contract Ref. Not Found';
}

function generateCallbackRef(contractRef) {
  const now = new Date();
  const pad2 = n => String(n).padStart(2,'0');
  const datePart = `${now.getFullYear()}${pad2(now.getMonth()+1)}${pad2(now.getDate())}`;
  const timePart = `${pad2(now.getHours())}${pad2(now.getMinutes())}`;
  const base = contractRef ? contractRef.replace(/[^A-Za-z0-9]/g,'') : 'UNLINKED';
  return `CB-${base}-${datePart}-${timePart}`;
}

function buildWhere(conditions, params, extras) {
  const where = ['is_deleted = 0', ...conditions];
  return 'WHERE ' + where.join(' AND ');
}

// ── 1. EXPIRING CONTRACTS (from maintenance_contracts — same table as Maintenance Records) ──
router.get('/expiring-contracts', requireModule('alerts'), (req, res) => {
  const { search, alert_level, sort_by, sort_dir } = req.query;
  const today = new Date().toISOString().slice(0,10);

  // Alert-level filter uses the SAME exclusive buckets as the KPI cards,
  // so card count always equals filtered table count.
  const LEVEL_MAP = { expired: 'expired', '7': 'within-7', '15': 'within-15', '30': 'within-30' };
  const levelFilter = LEVEL_MAP[alert_level] || null;   // applied after action evaluation

  const searchParams = [];
  let searchWhere = '';
  if (search) {
    searchWhere = `AND (contract_ref LIKE ? OR client_name LIKE ? OR location LIKE ? OR COALESCE(renewal_ref,'') LIKE ?)`;
    const s = `%${search}%`;
    searchParams.push(s, s, s, s);
  }

  const SORT_COLS = {
    contract_ref: 'contract_ref', client_name: 'client_name',
    end_date: 'maintenance_end_date', days_remaining: 'days_remaining',
    renewal_status: 'renewal_status',
  };
  const sortCol = SORT_COLS[sort_by] || 'days_remaining';
  const sortDir = String(sort_dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  // ── CURRENT-AMC-PERIOD EXPIRY (2026-09-26, SH-130 fix) ─────────────────────
  // 1. Cancelled contracts are excluded (mcNotCancelledSql — see db/amcEligibility.js).
  // 2. Expiry is calculated from the CURRENT AMC end date = latest of the
  //    maintenance record end date and any Approved + Active renewal end date.
  //    A superseded (historical) period can never drive an Expired alert.
  // 3. Renewal / Payment / Activation columns come from the actual renewal
  //    record (previously hard-coded NULL → every row showed "No renewal").
  // 4. can_add_renewal is decided here (backend), never in the browser.
  const candidates = all(`
    WITH base AS (
      SELECT
        mc.id, mc.maintenance_id, mc.contract_ref, mc.client_name,
        mc.emirate AS location, mc.maintenance_type, mc.maintenance_period,
        mc.total_elevator_units, mc.current_status,
        mc.renewal_status AS amc_status,
        mc.start_date AS record_start_date, mc.end_date AS record_end_date,
        ${currentStartSql('mc')} AS maintenance_start_date,
        ${currentEndSql('mc')}   AS maintenance_end_date,
        ${displayRenewalIdSql('mc')} AS display_renewal_id,
        ${renewalInProgressSql('mc')} AS renewal_in_progress,
        ${hasActiveRenewalSql('mc')}  AS has_active_renewal,
        (SELECT COUNT(*) FROM amc_renewals _rc WHERE _rc.contract_ref = mc.contract_ref AND _rc.is_deleted = 0) AS renewal_count
      FROM maintenance_contracts mc
      WHERE mc.is_deleted = 0 AND mc.end_date IS NOT NULL AND mc.end_date <> ''
        AND ${mcNotCancelledSql('mc')}
    ),
    enriched AS (
      SELECT b.*,
        ar.renewal_ref, ar.renewal_status, ar.payment_status AS stored_payment_status,
        ar.amc_activation_status, ar.new_start_date AS renewal_start_date, ar.new_end_date AS renewal_end_date,
        ar.new_amc_value AS renewal_value, ar.currency_code AS renewal_currency,
        (SELECT COALESCE(SUM(t.amount),0) FROM amc_payment_transactions t WHERE t.amc_renewal_id = ar.id) AS renewal_received,
        (SELECT COUNT(*) FROM amc_renewals d1 WHERE d1.contract_ref = b.contract_ref AND d1.is_deleted = 0
            AND d1.renewal_status = 'Approved' AND d1.amc_activation_status = 'Active'
            AND EXISTS (SELECT 1 FROM amc_renewals d2 WHERE d2.contract_ref = d1.contract_ref AND d2.is_deleted = 0 AND d2.id <> d1.id
                        AND d2.renewal_status = 'Approved' AND d2.amc_activation_status = 'Active'
                        AND d2.new_start_date < d1.new_end_date AND d2.new_end_date > d1.new_start_date)) AS dup_active_renewals,
        CAST(julianday(b.maintenance_end_date) - julianday('${today}') AS INTEGER) AS days_remaining,
        CASE
          WHEN b.maintenance_end_date <  '${today}'                  THEN 'expired'
          WHEN b.maintenance_end_date <= date('${today}','+7 days')  THEN 'within-7'
          WHEN b.maintenance_end_date <= date('${today}','+15 days') THEN 'within-15'
          WHEN b.maintenance_end_date <= date('${today}','+30 days') THEN 'within-30'
          ELSE 'ok'
        END AS alert_level
      FROM base b
      LEFT JOIN amc_renewals ar ON ar.id = b.display_renewal_id
    )
    SELECT *,
      renewal_ref AS latest_renewal_ref,
      renewal_ref AS current_renewal_ref,
      CASE WHEN renewal_in_progress = 0 AND (alert_level <> 'ok' OR has_active_renewal = 0) THEN 1 ELSE 0 END AS can_add_renewal,
      CASE WHEN renewal_in_progress = 0 AND alert_level <> 'ok' THEN 1 ELSE 0 END AS is_renewal_required
    FROM enriched
    WHERE 1=1 ${searchWhere}
    ORDER BY ${sortCol} ${sortDir}, contract_ref ASC
  `, searchParams);

  // ── AMC Attention Queue: keep only rows that genuinely require action ──────
  // (evaluateAMCActionRequired in db/amcEligibility.js — single source of truth)
  const queue = [];
  let reviewed = 0;
  for (const r of candidates) {
    reviewed++;
    const ev = evaluateAMCActionRequired(r);
    if (!ev.actionRequired) continue;
    queue.push({
      ...r,
      action_reason: ev.reason, action_reasons: ev.reasons,
      renewal_payment_status: ev.paymentStatus, renewal_balance: ev.balanceDue,
      renewal_received: ev.amountReceived, permitted_action: ev.permittedAction,
      operational_status: r.renewal_ref ? amcPay.evaluateAMCOperationalStatus({ renewal_status: r.renewal_status,
        amc_activation_status: r.amc_activation_status, total_received: ev.amountReceived, cancelled: false }) : null,
      can_add_renewal: ev.canAddRenewal ? 1 : 0,
      is_renewal_required: ev.expiryBucket && !Number(r.renewal_in_progress) ? 1 : 0,
    });
  }
  const rows = levelFilter ? queue.filter(r => r.alert_level === levelFilter) : queue;

  // Expiry KPI cards count only CURRENT-period expiry buckets of actionable rows
  // (payment / activation items outside the window never inflate them).
  const summary = {
    expired:  queue.filter(r => r.alert_level === 'expired').length,
    within7:  queue.filter(r => r.alert_level === 'within-7').length,
    within15: queue.filter(r => r.alert_level === 'within-15').length,
    within30: queue.filter(r => r.alert_level === 'within-30').length,
    other_attention: queue.filter(r => r.alert_level === 'ok').length,
    total:    rows.length,
    queue_total: queue.length,
    reviewed,
  };
  res.json({ rows, summary });
});

// ── MAINTENANCE LOOKUP for Add Renewal auto-populate ──────────────────────────
router.get('/maintenance-lookup', requireModule('alerts'), (req, res) => {
  try {
    const { contract_ref } = req.query;
    if (!contract_ref) return res.status(400).json({ error: 'contract_ref required' });
    if (!isEligibleForRenewalAlert(contract_ref))
      return res.status(409).json({ error: `Contract ${contract_ref} is Cancelled — renewal cannot be created from the active expiry workflow. See Maintenance → Cancelled AMC.` });
    const proj =get('SELECT * FROM maintenance_projects WHERE contract_ref=? AND is_deleted=0 ORDER BY id DESC LIMIT 1',
      [contract_ref]);
    if (!proj) return res.status(404).json({ error: 'No Maintenance project found for this Contract Ref.' });
    res.json({ project: proj });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 2. RENEWAL STATUS ──────────────────────────────────────────────────────
router.get('/renewals', requireModule('alerts'), (req, res) => {
  const { search, renewal_status, sort_by, sort_dir } = req.query;
  const where = ['is_deleted = 0'];
  const params = [];
  if (search) {
    where.push('(contract_ref LIKE ? OR client_name LIKE ? OR project_name LIKE ? OR renewal_contract_ref LIKE ?)');
    params.push(`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`);
  }
  if (renewal_status) { where.push('renewal_status = ?'); params.push(renewal_status); }
  const SORT_COLS = { contract_ref:'contract_ref', client_name:'client_name', renewal_status:'renewal_status',
                       approval_date:'approval_date', renewal_value:'renewal_value', updated_at:'updated_at' };
  const col = SORT_COLS[sort_by] || 'updated_at';
  const dir = String(sort_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const rows = all(`SELECT * FROM alert_renewals WHERE ${where.join(' AND ')} ORDER BY ${col} ${dir}`, params);
  res.json({ rows, total: rows.length });
});

router.post('/renewals', requireModule('alerts'), (req, res) => {
  const b = req.body || {};
  const now = new Date().toISOString();
  // Duplicate guard: same contract_ref + renewal_contract_ref
  if (b.contract_ref && b.renewal_contract_ref) {
    const dup = get(`SELECT id FROM alert_renewals WHERE contract_ref=? AND renewal_contract_ref=? AND is_deleted=0`,
      [b.contract_ref, b.renewal_contract_ref]);
    if (dup) return res.status(409).json({ error: 'A renewal record with this Contract Ref. and Renewal Contract Ref. already exists.' });
  }
  const status = contractLinkStatus(b.contract_ref || null);
  run(`INSERT INTO alert_renewals
    (contract_ref,linked_contract_status,client_name,project_name,previous_start_date,previous_end_date,
     new_start_date,new_end_date,renewal_value,approval_date,renewal_contract_ref,renewal_status,remarks,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [b.contract_ref||null, status, b.client_name||null, b.project_name||null,
     b.previous_start_date||null, b.previous_end_date||null,
     b.new_start_date||null, b.new_end_date||null,
     parseFloat(b.renewal_value)||null, b.approval_date||null,
     b.renewal_contract_ref||null, b.renewal_status||'Pending',
     b.remarks||null, req.session.user.username, now, now]);
  res.status(201).json({ row: get('SELECT * FROM alert_renewals WHERE id=last_insert_rowid()') });
});

router.patch('/renewals/:id', requireModule('alerts'), (req, res) => {
  const existing = get('SELECT * FROM alert_renewals WHERE id=? AND is_deleted=0', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const fields = ['contract_ref','client_name','project_name','previous_start_date','previous_end_date',
                   'new_start_date','new_end_date','renewal_value','approval_date','renewal_contract_ref',
                   'renewal_status','remarks'];
  const updates = {};
  for (const f of fields) { if (f in b) updates[f] = b[f]; }
  if ('contract_ref' in updates) updates.linked_contract_status = contractLinkStatus(updates.contract_ref);
  updates.updated_at = new Date().toISOString();
  const setSql = Object.keys(updates).map(k => `${k}=?`).join(', ');
  run(`UPDATE alert_renewals SET ${setSql} WHERE id=?`, [...Object.values(updates), req.params.id]);
  res.json({ row: get('SELECT * FROM alert_renewals WHERE id=?', [req.params.id]) });
});

router.delete('/renewals/:id', requireModule('alerts'), requireRole('admin'), (req, res) => {
  const row = get('SELECT * FROM alert_renewals WHERE id=? AND is_deleted=0', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Renewal record not found' });
  run(`UPDATE alert_renewals SET is_deleted=1, updated_at=? WHERE id=?`, [new Date().toISOString(), req.params.id]);
  writeAuditLog({
    action: 'DELETE', module: 'alert_renewals',
    recordId: row.id, recordRef: row.contract_ref,
    details: { contract_ref: row.contract_ref, renewal_contract_ref: row.renewal_contract_ref, renewal_status: row.renewal_status },
    performedBy: req.session.user.username,
  });
  res.json({ ok: true });
});

// ── 3. PAYMENT STATUS ──────────────────────────────────────────────────────
router.get('/payments', requireModule('alerts'), (req, res) => {
  const { search, payment_status, sort_by, sort_dir } = req.query;
  const where = ['is_deleted = 0'];
  const params = [];
  if (search) {
    where.push('(contract_ref LIKE ? OR client_name LIKE ? OR project_name LIKE ? OR invoice_ref LIKE ?)');
    params.push(`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`);
  }
  if (payment_status) { where.push('payment_status = ?'); params.push(payment_status); }
  const SORT_COLS = { contract_ref:'contract_ref', client_name:'client_name', invoice_date:'invoice_date',
                       invoice_amount:'invoice_amount', payment_due_date:'payment_due_date',
                       payment_status:'payment_status', updated_at:'updated_at' };
  const col = SORT_COLS[sort_by] || 'updated_at';
  const dir = String(sort_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const today = new Date().toISOString().slice(0,10);
  const rows = all(`
    SELECT *, COALESCE(invoice_amount,0) - COALESCE(paid_amount,0) AS balance_amount,
              CASE WHEN payment_due_date IS NOT NULL AND payment_due_date < '${today}' AND payment_status NOT IN ('Paid','Hold')
                   THEN CAST(julianday('${today}') - julianday(payment_due_date) AS INTEGER)
                   ELSE 0 END AS days_overdue
    FROM alert_payments WHERE ${where.join(' AND ')} ORDER BY ${col} ${dir}`, params);
  // Also return AMC renewal payment records that are outstanding
  const renewalWhere = ['is_deleted = 0', "payment_status NOT IN ('Paid','Hold')"];
  const renewalParams = [];
  if (search) {
    renewalWhere.push('(contract_ref LIKE ? OR client_name LIKE ? OR renewal_ref LIKE ?)');
    renewalParams.push(`%${search}%`,`%${search}%`,`%${search}%`);
  }
  if (payment_status) { renewalWhere.push('payment_status = ?'); renewalParams.push(payment_status); }
  const renewalPayments = all(
    `SELECT id, renewal_ref, contract_ref, client_name, renewal_ref AS invoice_ref,
            new_amc_value AS invoice_amount, amount_paid AS paid_amount,
            COALESCE(new_amc_value,0)-COALESCE(amount_paid,0) AS balance_amount,
            payment_status, payment_date, new_end_date AS payment_due_date, updated_at,
            'amc_renewal' AS record_type, amc_activation_status, renewal_status
     FROM amc_renewals WHERE ${renewalWhere.join(' AND ')} ORDER BY updated_at DESC`,
    renewalParams);
  res.json({ rows, total: rows.length, renewal_payments: renewalPayments, renewal_total: renewalPayments.length });
});

router.post('/payments', requireModule('alerts'), (req, res) => {
  const b = req.body || {};
  const now = new Date().toISOString();
  // Duplicate guard: same contract_ref + invoice_ref
  if (b.contract_ref && b.invoice_ref) {
    const dup = get(`SELECT id FROM alert_payments WHERE contract_ref=? AND invoice_ref=? AND is_deleted=0`,
      [b.contract_ref, b.invoice_ref]);
    if (dup) return res.status(409).json({ error: 'A payment record with this Contract Ref. and Invoice Ref. already exists.' });
  }
  const status = contractLinkStatus(b.contract_ref || null);
  const invAmt = parseFloat(b.invoice_amount) || 0;
  const paidAmt = parseFloat(b.paid_amount) || 0;
  run(`INSERT INTO alert_payments
    (contract_ref,linked_contract_status,client_name,project_name,invoice_ref,invoice_date,
     invoice_amount,paid_amount,balance_amount,payment_due_date,payment_status,remarks,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [b.contract_ref||null, status, b.client_name||null, b.project_name||null,
     b.invoice_ref||null, b.invoice_date||null,
     invAmt, paidAmt, invAmt - paidAmt, b.payment_due_date||null,
     b.payment_status||'Unpaid', b.remarks||null,
     req.session.user.username, now, now]);
  res.status(201).json({ row: get('SELECT * FROM alert_payments WHERE id=last_insert_rowid()') });
});

router.patch('/payments/:id', requireModule('alerts'), (req, res) => {
  const existing = get('SELECT * FROM alert_payments WHERE id=? AND is_deleted=0', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const fields = ['contract_ref','client_name','project_name','invoice_ref','invoice_date',
                   'invoice_amount','paid_amount','payment_due_date','payment_status','remarks'];
  const updates = {};
  for (const f of fields) { if (f in b) updates[f] = b[f]; }
  if ('contract_ref' in updates) updates.linked_contract_status = contractLinkStatus(updates.contract_ref);
  // Recompute balance
  const invAmt  = 'invoice_amount' in updates ? parseFloat(updates.invoice_amount)||0 : (existing.invoice_amount||0);
  const paidAmt = 'paid_amount'    in updates ? parseFloat(updates.paid_amount)||0    : (existing.paid_amount||0);
  updates.balance_amount = invAmt - paidAmt;
  updates.updated_at = new Date().toISOString();
  const setSql = Object.keys(updates).map(k => `${k}=?`).join(', ');
  run(`UPDATE alert_payments SET ${setSql} WHERE id=?`, [...Object.values(updates), req.params.id]);
  res.json({ row: get('SELECT * FROM alert_payments WHERE id=?', [req.params.id]) });
});

router.delete('/payments/:id', requireModule('alerts'), requireRole('admin'), (req, res) => {
  const row = get('SELECT * FROM alert_payments WHERE id=? AND is_deleted=0', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Payment record not found' });
  run(`UPDATE alert_payments SET is_deleted=1, updated_at=? WHERE id=?`, [new Date().toISOString(), req.params.id]);
  writeAuditLog({
    action: 'DELETE', module: 'alert_payments',
    recordId: row.id, recordRef: row.contract_ref,
    details: { contract_ref: row.contract_ref, invoice_ref: row.invoice_ref, payment_status: row.payment_status },
    performedBy: req.session.user.username,
  });
  res.json({ ok: true });
});

// ── 4. CALL BACK / EMERGENCY ALERTS ────────────────────────────────────────
router.get('/callbacks', requireModule('alerts'), (req, res) => {
  const { search, callback_status, priority, contract_ref, sort_by, sort_dir } = req.query;
  const where = ['is_deleted = 0'];
  const params = [];
  if (search) {
    where.push('(callback_ref LIKE ? OR contract_ref LIKE ? OR client_name LIKE ? OR project_name LIKE ? OR assigned_technician LIKE ? OR lift_unit_no LIKE ?)');
    params.push(`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`);
  }
  if (callback_status) { where.push('callback_status = ?'); params.push(callback_status); }
  if (priority)        { where.push('priority = ?');        params.push(priority); }
  if (contract_ref)    { where.push('contract_ref = ?');    params.push(contract_ref); }
  const SORT_COLS = { callback_ref:'callback_ref', contract_ref:'contract_ref', complaint_datetime:'complaint_datetime',
                       priority:'priority', callback_status:'callback_status', assigned_technician:'assigned_technician',
                       attended_datetime:'attended_datetime', updated_at:'updated_at' };
  const col = SORT_COLS[sort_by] || 'complaint_datetime';
  const dir = String(sort_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const rows = all(`SELECT * FROM alert_callbacks WHERE ${where.join(' AND ')} ORDER BY ${col} ${dir}`, params);
  res.json({ rows, total: rows.length });
});

router.post('/callbacks', requireModule('alerts'), (req, res) => {
  const b = req.body || {};
  const now = new Date().toISOString();
  // Auto-generate unique Call Back Ref
  let cbRef = generateCallbackRef(b.contract_ref || null);
  // Ensure uniqueness (add suffix if collision)
  let suffix = 0;
  while (get('SELECT id FROM alert_callbacks WHERE callback_ref=?', [cbRef])) {
    suffix++;
    cbRef = cbRef + '-' + suffix;
  }
  const status = contractLinkStatus(b.contract_ref || null);
  run(`INSERT INTO alert_callbacks
    (callback_ref,contract_ref,linked_contract_status,client_name,project_name,location,lift_unit_no,
     complaint_datetime,complaint_type,priority,assigned_technician,response_time,
     attended_datetime,completion_datetime,issue_description,action_taken,spare_parts_used,
     client_confirmation,callback_status,remarks,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [cbRef, b.contract_ref||null, status, b.client_name||null, b.project_name||null,
     b.location||null, b.lift_unit_no||null, b.complaint_datetime||now,
     b.complaint_type||null, b.priority||'Normal', b.assigned_technician||null,
     b.response_time||null, b.attended_datetime||null, b.completion_datetime||null,
     b.issue_description||null, b.action_taken||null, b.spare_parts_used||null,
     b.client_confirmation||null, b.callback_status||'Open',
     b.remarks||null, req.session.user.username, now, now]);
  res.status(201).json({ row: get('SELECT * FROM alert_callbacks WHERE callback_ref=?', [cbRef]) });
});

router.patch('/callbacks/:id', requireModule('alerts'), (req, res) => {
  const existing = get('SELECT * FROM alert_callbacks WHERE id=? AND is_deleted=0', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const fields = ['contract_ref','client_name','project_name','location','lift_unit_no',
                   'complaint_datetime','complaint_type','priority','assigned_technician','response_time',
                   'attended_datetime','completion_datetime','issue_description','action_taken',
                   'spare_parts_used','client_confirmation','callback_status','remarks'];
  const updates = {};
  for (const f of fields) { if (f in b) updates[f] = b[f]; }
  if ('contract_ref' in updates) updates.linked_contract_status = contractLinkStatus(updates.contract_ref);
  updates.updated_at = new Date().toISOString();
  const setSql = Object.keys(updates).map(k => `${k}=?`).join(', ');
  run(`UPDATE alert_callbacks SET ${setSql} WHERE id=?`, [...Object.values(updates), req.params.id]);
  res.json({ row: get('SELECT * FROM alert_callbacks WHERE id=?', [req.params.id]) });
});

router.delete('/callbacks/:id', requireModule('alerts'), requireRole('admin'), (req, res) => {
  const row = get('SELECT * FROM alert_callbacks WHERE id=? AND is_deleted=0', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Record not found.' });
  const now = new Date().toISOString();
  run(`UPDATE alert_callbacks SET is_deleted=1, updated_at=? WHERE id=?`, [now, req.params.id]);
  writeAuditLog({
    action: 'DELETE', module: 'alert_callbacks',
    recordId: row.id, recordRef: row.callback_ref,
    details: { callback_ref: row.callback_ref, contract_ref: row.contract_ref, client_name: row.client_name },
    performedBy: req.session.user.username,
  });
  res.json({ ok: true });
});

// ── 5. MONTHLY CALL BACK SUMMARY ───────────────────────────────────────────
router.get('/callback-summary', requireModule('alerts'), (req, res) => {
  const { month, year, contract_ref, client_name, assigned_technician, callback_status, priority } = req.query;

  const where = ['is_deleted = 0'];
  const params = [];
  if (year)  { where.push("strftime('%Y', complaint_datetime) = ?"); params.push(String(year)); }
  if (month) { where.push("strftime('%m', complaint_datetime) = ?"); params.push(String(month).padStart(2,'0')); }
  if (contract_ref)        { where.push('contract_ref = ?');        params.push(contract_ref); }
  if (client_name)         { where.push('client_name LIKE ?');      params.push(`%${client_name}%`); }
  if (assigned_technician) { where.push('assigned_technician = ?'); params.push(assigned_technician); }
  if (callback_status)     { where.push('callback_status = ?');     params.push(callback_status); }
  if (priority)            { where.push('priority = ?');            params.push(priority); }

  const whereSql = 'WHERE ' + where.join(' AND ');

  const rows = all(`SELECT * FROM alert_callbacks ${whereSql} ORDER BY complaint_datetime DESC`, params);

  // Compute totals
  const total     = rows.length;
  const attended  = rows.filter(r => ['Attended','Completed'].includes(r.callback_status)).length;
  const completed = rows.filter(r => r.callback_status === 'Completed').length;
  const pending   = rows.filter(r => ['Open','Assigned','Pending Parts'].includes(r.callback_status)).length;
  const emergency = rows.filter(r => r.priority === 'Emergency').length;

  // Average response time (in minutes, for rows that have both complaint_datetime + attended_datetime)
  let avgResponseMins = null;
  const withResponse = rows.filter(r => r.complaint_datetime && r.attended_datetime);
  if (withResponse.length) {
    const totalMins = withResponse.reduce((sum, r) => {
      const diff = (new Date(r.attended_datetime) - new Date(r.complaint_datetime)) / 60000;
      return sum + (diff > 0 ? diff : 0);
    }, 0);
    avgResponseMins = Math.round(totalMins / withResponse.length);
  }

  // Technician breakdown
  const techMap = {};
  rows.forEach(r => {
    const tech = r.assigned_technician || 'Unassigned';
    techMap[tech] = (techMap[tech] || 0) + 1;
  });
  const byTechnician = Object.entries(techMap).map(([tech, count]) => ({ tech, count })).sort((a,b)=>b.count-a.count);

  // Project breakdown
  const projMap = {};
  rows.forEach(r => {
    const proj = r.project_name || 'Unknown';
    projMap[proj] = (projMap[proj] || 0) + 1;
  });
  const byProject = Object.entries(projMap).map(([project, count]) => ({ project, count })).sort((a,b)=>b.count-a.count);

  // Contract Ref breakdown
  const crefMap = {};
  rows.forEach(r => {
    const cref = r.contract_ref || 'Unlinked';
    crefMap[cref] = (crefMap[cref] || 0) + 1;
  });
  const byContractRef = Object.entries(crefMap).map(([contract_ref, count]) => ({ contract_ref, count })).sort((a,b)=>b.count-a.count);

  // Filter option lists (for the UI dropdowns)
  const techOptions     = all(`SELECT DISTINCT assigned_technician FROM alert_callbacks WHERE is_deleted=0 AND assigned_technician IS NOT NULL ORDER BY assigned_technician`).map(r=>r.assigned_technician);
  const contractOptions = all(`SELECT DISTINCT contract_ref        FROM alert_callbacks WHERE is_deleted=0 AND contract_ref IS NOT NULL        ORDER BY contract_ref`).map(r=>r.contract_ref);

  res.json({
    rows,
    summary: { total, attended, completed, pending, emergency, avgResponseMins },
    byTechnician, byProject, byContractRef,
    filterOptions: { technicians: techOptions, contractRefs: contractOptions },
  });
});

// ── 6. CANCELLED AMC CONTRACTS ─────────────────────────────────────────────────
router.get('/cancelled-amc', requireModule('alerts'), (req, res) => {
  const { search, sort_by, sort_dir } = req.query;
  const where = ["is_deleted = 0", "renewal_status = 'Cancelled'"];
  const params = [];
  if (search) {
    where.push('(contract_ref LIKE ? OR client_name LIKE ? OR emirate LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const SORT_COLS = {
    contract_ref: 'contract_ref', client_name: 'client_name',
    end_date: 'end_date', cancellation_date: 'cancellation_date', updated_at: 'updated_at'
  };
  const col = SORT_COLS[sort_by] || 'updated_at';
  const dir = String(sort_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const rows = all(`SELECT * FROM maintenance_contracts WHERE ${where.join(' AND ')} ORDER BY ${col} ${dir}`, params);
  res.json({ rows, total: rows.length });
});

router.patch('/cancelled-amc/:id', requireModule('alerts'), (req, res) => {
  try {
    const existing = get('SELECT * FROM maintenance_contracts WHERE id=? AND is_deleted=0', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Cancelled AMC record not found' });

    const b = req.body || {};
    const VALID_RENEWAL = ['Active Maintenance', 'Hold', 'Expired / Renewal Required', 'Cancelled',
                           'Pending', 'Approved', 'Renewed', 'Not Renewed'];
    const allowed = ['cancellation_date', 'cancellation_reason', 'assigned_technician', 'renewal_status', 'remarks'];
    const updates = {};
    for (const f of allowed) {
      if (f in b) {
        if (f === 'renewal_status') {
          if (b[f] && !VALID_RENEWAL.includes(b[f])) {
            return res.status(400).json({ error: `Invalid renewal_status: ${b[f]}` });
          }
          updates[f] = b[f] || existing.renewal_status;
        } else {
          updates[f] = b[f] || null;
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No editable fields provided' });
    }

    updates.updated_at = new Date().toISOString();
    const setSql = Object.keys(updates).map(k => `${k}=?`).join(', ');
    run(`UPDATE maintenance_contracts SET ${setSql} WHERE id=?`, [...Object.values(updates), req.params.id]);

    const updated = get('SELECT * FROM maintenance_contracts WHERE id=?', [req.params.id]);
    res.json({ success: true, message: 'Cancelled AMC updated successfully.', row: updated });
  } catch (err) {
    console.error('[PATCH /api/alerts/cancelled-amc/:id]', err);
    res.status(500).json({ error: 'Unable to save the Cancelled AMC Contract. Please review and try again.' });
  }
});

// ── Legacy: engine recompute + resolve (for Dashboard badge) ────────────────
router.get('/', requireModule('alerts'), (req, res) => {
  const resolved = req.query.resolved === '1' ? 1 : 0;
  const rows = all(`SELECT mc.*, 'maintenance' AS alert_type
    FROM maintenance_contracts mc
    WHERE mc.is_deleted = 0
      AND mc.renewal_status IN ('Expiring Soon', 'Expired', 'Active')
      AND ${mcNotCancelledSql('mc')}
    ORDER BY mc.end_date ASC`);
  res.json({ alerts: rows, total: rows.length, resolved });
});

module.exports = router;
