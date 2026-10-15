// AMC Renewals module — routes.
// Manages the full lifecycle of AMC contract renewals via the amc_renewals table.
// Integrated with maintenance_projects for auto-populate and schedule generation.
//
// Endpoints:
//   GET    /api/renewals                    — list (search / filter / sort / paginate)
//   GET    /api/renewals/lookup             — lookup maintenance project for auto-populate
//   GET    /api/renewals/generate-ref       — generate next renewal_ref for a contract_ref
//   GET    /api/renewals/:id                — single record + audit log
//   POST   /api/renewals                    — create new renewal
//   PATCH  /api/renewals/:id               — update fields
//   POST   /api/renewals/:id/approve        — approve + optional activation/hold
//   POST   /api/renewals/:id/activate       — set amc_activation_status=Active + generate schedules
//   POST   /api/renewals/:id/hold           — set amc_activation_status=Hold
//   POST   /api/renewals/:id/payment        — update payment_status + amount_paid
//   DELETE /api/renewals/:id               — soft delete (admin only)

const express = require('express');
const { run, get, all } = require('../db/db.js');
const { requireModule, requireRole } = require('../middleware/auth.js');
const { refNotCancelledSql, isEligibleForRenewalAlert } = require('../db/amcEligibility.js');
const amcPay = require('../db/amcPayments.js');
const RS = require('../db/renewalSync.js');
const { AMC_PAYMENT_ENTRY, AMC_PAYMENT_ADMIN } = require('../middleware/permissions.js');
const payErr = (res, e) => res.status(e.status || (e instanceof amcPay.PaymentError ? 400 : 500)).json({ error: e.message });
const roleIn = (req, list) => req.session && req.session.user && list.includes(req.session.user.role);
const { writeAuditLog } = require('../db/audit.js');
const router = express.Router();

const RENEWAL_STATUS_OPTS     = ['Pending','Under Review','Approved','Rejected','Not Renewed','Cancelled','Hold'];
const PAYMENT_STATUS_OPTS     = ['Unpaid','Partial','Paid','Later','Overdue','Hold'];
const AMC_ACTIVATION_OPTS     = ['Active','Hold','Inactive'];

// ── Schedule generation helper (mirrors logic in routes/maintenance.js) ───────
// 2026-09-29: the local map only knew 'Once Every N Months' — 'Every 2 Months' /
// 'Every 3 Months' (the values actually stored) resolved to null. Now uses the
// single authoritative mapping in db/scheduleEngine.js.
function periodToMonths(period, customMonths) {
  return require('../db/scheduleEngine.js').periodToInterval(period, customMonths);
}

function generateRenewalSchedule(proj, startFrom, createdBy) {
  const months = periodToMonths(proj.maintenance_period, proj.custom_period_months);
  if (!months || !proj.end_date || !startFrom) return 0;
  const endDate  = new Date(proj.end_date);
  let curDate    = new Date(startFrom);
  curDate.setDate(1); // always start at 1st of month
  let count = 0;
  while (curDate <= endDate) {
    const curY = curDate.getFullYear();
    const curM = curDate.getMonth() + 1;
    const pad  = n => String(n).padStart(2,'0');
    const visitRef     = `${proj.maintenance_id}-${curY}${pad(curM)}`;
    const scheduledDate = `${curY}-${pad(curM)}-01`;
    try {
      run(`INSERT OR IGNORE INTO maintenance_project_visits
        (maintenance_project_id,maintenance_id,contract_ref,visit_ref,visit_type,
         visit_year,visit_month,scheduled_date,visit_status,total_elevator_units,created_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`,
        [proj.id, proj.maintenance_id, proj.contract_ref||null, visitRef, 'Routine',
         curY, curM, scheduledDate, 'Pending', proj.total_elevator_units||null, createdBy||'system']);
      count++;
    } catch(_) {}
    curDate.setMonth(curDate.getMonth() + months);
  }
  return count;
}

function logRenewalAudit(renewalId, renewalRef, action, fieldName, oldVal, newVal, performedBy, notes) {
  try {
    run(`INSERT INTO renewal_audit_log
      (amc_renewal_id,renewal_ref,action,field_name,old_value,new_value,performed_by,notes)
      VALUES(?,?,?,?,?,?,?,?)`,
      [renewalId, renewalRef, action, fieldName||null, oldVal!=null?String(oldVal):null,
       newVal!=null?String(newVal):null, performedBy, notes||null]);
  } catch(_) {}
}

// ── Schedule months helper (legacy maintenance_contracts/maintenance_schedule_months) ──
// Inserts month entries (1-12) for the contract's maintenance period window.
// INSERT OR IGNORE prevents duplicates on re-runs.
function generateScheduleMonths(mcId, period, customMonths, startDate, endDate) {
  // 2026-09-29: delegates to the central frequency engine. The regular cycle
  // CONTINUES the established cycle (latest completed regular month) inside the
  // new AMC period, from the current month forward — never restarted from the
  // renewal start date, never overwriting manual or historical months.
  const plan = require('../db/scheduleEngine.js').recalculateRegularSchedule(mcId, {
    apply: true, user: 'system:renewal', reason: 'AMC renewal activated',
  });
  return plan.add.length;
}

// ── Sync helper: propagate AMC activation → maintenance_contracts (legacy table) ──
// action: 'activate' | 'hold' | 'inactive'
// Ensures the legacy Maintenance Module frontend reflects the correct AMC state.
function syncMaintenanceContract(renewal, action, performedBy) {
  if (!renewal.contract_ref) return { synced: false, reason: 'no_contract_ref' };
  const mc = get('SELECT * FROM maintenance_contracts WHERE contract_ref=? AND is_deleted=0', [renewal.contract_ref]);
  if (!mc) return { synced: false, reason: 'no_mc_record' };
  // 2026-10-03: activation makes the New Period current ONLY together with a received
  // payment (Approved + Active + received > 0, Partial counts) — db/renewalSync.js.
  if (action === 'activate') {
    const fresh = get('SELECT * FROM amc_renewals WHERE id=?', [renewal.id]) || renewal;
    const res = RS.syncRenewal(fresh.id, performedBy, { source: 'activation' });
    if (res.state === 'retain' && res.reason === 'Initial Payment Not Received') {
      logRenewalAudit(fresh.id, fresh.renewal_ref, 'MC_SYNC_DEFERRED', null, null, null, performedBy,
        'Activated — the new AMC period becomes current when the first payment is received');
      return { synced: false, deferred: true, reason: res.reason };
    }
    // explicit activation of a synchronized renewal re-opens a record that was held / expired for renewal
    const cur = get('SELECT * FROM maintenance_contracts WHERE id=?', [mc.id]);
    if (res.synced && ['Hold', 'Expired / Renewal Required'].includes(cur.renewal_status)) {
      run(`UPDATE maintenance_contracts SET renewal_status='Active Maintenance', updated_at=? WHERE id=?`, [new Date().toISOString(), mc.id]);
      run(`INSERT INTO maintenance_contract_history (maintenance_contract_id, field_name, old_value, new_value, changed_by, remarks) VALUES (?,?,?,?,?,?)`,
        [mc.id, 'renewal_status', cur.renewal_status, 'Active Maintenance', performedBy, `Renewal ${fresh.renewal_ref} activated`]);
    }
    logRenewalAudit(fresh.id, fresh.renewal_ref, 'MC_SYNC', 'state', null, res.state, performedBy, `${res.reason || ''} ${res.before || ''} → ${res.after || ''}`.trim());
    return { synced: !!res.synced, mc_id: mc.id, state: res.state, reason: res.reason, months_added: res.schedule ? res.schedule.added : 0 };
  }
  const now = new Date().toISOString();
  const statusMap = { activate: 'Active Maintenance', hold: 'Hold', inactive: 'Expired / Renewal Required' };
  const newStatus = statusMap[action] || 'Active Maintenance';
  // Preserve the superseded period on the renewal record BEFORE the maintenance
  // record moves to the new current period (history is never lost).
  if (action === 'activate' && !renewal.prev_end_date && mc.end_date && renewal.new_end_date
      && renewal.new_end_date > mc.end_date) {
    run(`UPDATE amc_renewals SET prev_start_date=COALESCE(prev_start_date,?), prev_end_date=? WHERE id=?`,
      [mc.start_date || null, mc.end_date, renewal.id]);
    logRenewalAudit(renewal.id, renewal.renewal_ref, 'PREV_PERIOD_RECORDED', 'prev_end_date',
      null, mc.end_date, performedBy, `Previous AMC period ${mc.start_date || '?'} – ${mc.end_date} preserved`);
  }
  const updates = { renewal_status: newStatus, updated_at: now };
  if (action === 'activate' && renewal.new_end_date)   updates.end_date   = renewal.new_end_date;
  if (action === 'activate' && renewal.new_start_date) updates.start_date = renewal.new_start_date;
  const setSql = Object.keys(updates).map(k => `${k}=?`).join(', ');
  run(`UPDATE maintenance_contracts SET ${setSql} WHERE id=?`, [...Object.values(updates), mc.id]);
  let monthsAdded = 0;
  if (action === 'activate') {
    monthsAdded = generateScheduleMonths(
      mc.id, mc.maintenance_period, mc.custom_period_months,
      renewal.new_start_date || mc.start_date, renewal.new_end_date || mc.end_date
    );
  }
  logRenewalAudit(renewal.id, renewal.renewal_ref, 'MC_SYNC',
    'renewal_status', mc.renewal_status, newStatus, performedBy,
    `maintenance_contracts id=${mc.id} synced. Period ${mc.start_date || '?'} – ${mc.end_date || '?'} → ${updates.start_date || mc.start_date || '?'} – ${updates.end_date || mc.end_date || '?'}. schedule_months added: ${monthsAdded}`);
  return { synced: true, mc_id: mc.id, old_status: mc.renewal_status, new_status: newStatus, months_added: monthsAdded };
}

// ── Cancellation helper (shared by POST, PATCH /:id, and POST /:id/cancel) ───
// Normalises Rejected/Cancelled → final operational status 'Cancelled'.
// Updates the maintenance project, cancels future visits, writes audit trail.
function executeCancellation(renewal, originalDecision, reason, u, now) {
  const today = now.slice(0, 10);
  // 1. Update renewal record
  run(`UPDATE amc_renewals SET renewal_status='Cancelled', amc_activation_status='Inactive',
       remarks=COALESCE(NULLIF(?, ''), remarks), updated_at=? WHERE id=?`,
    [reason || null, now, renewal.id]);
  // 2. Update maintenance project
  let visitsCancelled = 0;
  if (renewal.maintenance_project_id) {
    run(`UPDATE maintenance_projects SET maintenance_status='Cancelled',
         cancellation_date=?, cancellation_reason=?, updated_at=? WHERE id=?`,
      [today, reason || null, now, renewal.maintenance_project_id]);
    // 3. Cancel future pending/scheduled visits
    const r = run(`UPDATE maintenance_project_visits SET visit_status='Cancelled',
         cancellation_reason=?, updated_at=?
         WHERE maintenance_project_id=? AND visit_status IN ('Pending','Scheduled')
         AND scheduled_date >= ?`,
      [`AMC Cancelled - ${reason || originalDecision || 'renewal not proceeding'}`, now,
       renewal.maintenance_project_id, today]);
    visitsCancelled = r.changes || 0;
  }
  // 4. Sync legacy maintenance_contracts (set renewal_status = 'Cancelled')
  if (renewal.contract_ref) {
    const mc = get('SELECT id FROM maintenance_contracts WHERE contract_ref=? AND is_deleted=0', [renewal.contract_ref]);
    if (mc) run(`UPDATE maintenance_contracts SET renewal_status='Cancelled', updated_at=? WHERE id=?`, [now, mc.id]);
  }
  // 5. Audit trail
  logRenewalAudit(renewal.id, renewal.renewal_ref, 'CANCELLED',
    'renewal_status', renewal.renewal_status, 'Cancelled', u,
    `Decision: ${originalDecision}. Reason: ${reason || '—'}. Visits cancelled: ${visitsCancelled}`);
  return { visits_cancelled: visitsCancelled };
}

// ── GET /api/renewals ─────────────────────────────────────────────────────────
// Returns ONE current renewal row per contract_ref (Active/Hold preferred, else latest).
// Uses a CTE to deduplicate — contracts with multiple renewal cycles only show the
// current one. Historical cycles are accessible via GET /api/renewals/contract/:ref/history.
// Payments are aggregated from amc_payment_transactions (never from stored amount_paid).
// The `payment_status` filter matches against effective_payment_status (derived), not stored.
router.get('/', requireModule('alerts'), (req, res) => {
  try {
    const { search, renewal_status, payment_status, amc_activation_status,
            sort_by, sort_dir, page, page_size, include_completed } = req.query;
    // 2026-10-03: Renewal Status is an ACTION QUEUE — operationally completed renewals
    // (Approved + Active + received > 0 + maintenance period synchronized) are excluded.
    // ?include_completed=1 shows them as well (history view). Nothing is deleted.
    const withCompleted = String(include_completed || '') === '1';

    // Outer WHERE filters operate on columns in current_base CTE (no r. prefix needed)
    const outerClauses = [];
    const params = [];
    if (search) {
      outerClauses.push('(renewal_ref LIKE ? OR contract_ref LIKE ? OR client_name LIKE ? OR maintenance_id LIKE ?)');
      params.push(`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`);
    }
    if (renewal_status)        { outerClauses.push('renewal_status = ?');            params.push(renewal_status); }
    if (payment_status)        { outerClauses.push('effective_payment_status = ?');  params.push(payment_status); }
    if (amc_activation_status) { outerClauses.push('amc_activation_status = ?');     params.push(amc_activation_status); }
    const outerWhere = outerClauses.length ? `WHERE ${outerClauses.join(' AND ')}` : '';

    const SORT_COLS = {
      renewal_ref:'renewal_ref', contract_ref:'contract_ref', client_name:'client_name',
      renewal_status:'renewal_status', payment_status:'effective_payment_status',
      amc_activation_status:'amc_activation_status', new_end_date:'new_end_date',
      updated_at:'updated_at', created_at:'created_at',
    };
    const col = SORT_COLS[sort_by] || 'updated_at';
    const dir = String(sort_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const pg  = Math.max(1, parseInt(page)||1);
    const ps  = Math.min(200, Math.max(10, parseInt(page_size)||25));

    // CTE: per_contract picks the single current renewal id.
    // Priority: any Active/Hold row (by max id) over the latest non-cancelled row.
    // current_base: joins that id to its payment aggregates and derives effective_payment_status.
    const cte = `
      WITH per_contract AS (
        SELECT COALESCE(
          MAX(CASE WHEN amc_activation_status IN ('Active','Hold') THEN id ELSE NULL END),
          MAX(id)
        ) AS current_id
        FROM amc_renewals r
        WHERE is_deleted = 0 AND renewal_status != 'Cancelled'
          ${withCompleted ? '' : `AND NOT ${RS.completedSql('r')}`}
        GROUP BY contract_ref
      ),
      current_base AS (
        SELECT r.*,
          COALESCE(t.total_received, 0) AS total_received,
          COALESCE(r.new_amc_value, 0) - COALESCE(t.total_received, 0) AS balance,
          CASE
            WHEN r.payment_status IN ('Later','Overdue','Hold') THEN r.payment_status
            WHEN COALESCE(t.total_received, 0) = 0 THEN 'Unpaid'
            WHEN COALESCE(r.new_amc_value, 0) > 0
                 AND COALESCE(t.total_received, 0) >= COALESCE(r.new_amc_value, 0) THEN 'Paid'
            ELSE 'Partial'
          END AS effective_payment_status
        FROM amc_renewals r
        INNER JOIN per_contract pc ON pc.current_id = r.id
        LEFT JOIN (
          SELECT amc_renewal_id, SUM(amount) AS total_received
          FROM amc_payment_transactions
          GROUP BY amc_renewal_id
        ) t ON t.amc_renewal_id = r.id
        WHERE r.is_deleted = 0
          -- Exclude contracts whose CURRENT AMC or Project status is Cancelled
          -- (they live under Maintenance → Cancelled AMC, not the active renewal workflow)
          AND ${refNotCancelledSql('r.contract_ref')}
      )`;

    const total = (get(`${cte} SELECT COUNT(*) c FROM current_base ${outerWhere}`, params)||{c:0}).c;
    const rows  = all(
      `${cte} SELECT * FROM current_base ${outerWhere} ORDER BY ${col} ${dir} LIMIT ? OFFSET ?`,
      [...params, ps, (pg-1)*ps]).map(r => {
        const qr = RS.queueReason(r);
        return { ...r, queue_reason: qr, completed: qr === null,
          operational_status: amcPay.evaluateAMCOperationalStatus({ renewal_status: r.renewal_status,
            amc_activation_status: r.amc_activation_status, total_received: r.total_received,
            cancelled: amcPay.isContractCancelled(r.contract_ref) }) };
      });
    const completed_hidden = withCompleted ? 0 : (get(`SELECT COUNT(DISTINCT contract_ref) c FROM amc_renewals r WHERE is_deleted=0 AND ${RS.completedSql('r')}
        AND NOT EXISTS (SELECT 1 FROM amc_renewals r2 WHERE r2.contract_ref=r.contract_ref AND r2.is_deleted=0 AND r2.renewal_status!='Cancelled' AND NOT ${RS.completedSql('r2')})`) || { c: 0 }).c;
    res.json({ rows, total, page: pg, page_size: ps, pages: Math.ceil(total/ps), completed_hidden, include_completed: withCompleted });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/renewals/contract/:contractRef/history ──────────────────────────
// Returns ALL non-deleted renewals for a given contract_ref, ordered newest first.
// Used by the detail modal to show prior renewal cycles for the same contract.
router.get('/contract/:contractRef/history', requireModule('alerts'), (req, res) => {
  try {
    const rows = all(
      `SELECT r.*, COALESCE(t.total_received, 0) AS total_received
       FROM amc_renewals r
       LEFT JOIN (
         SELECT amc_renewal_id, SUM(amount) AS total_received
         FROM amc_payment_transactions
         GROUP BY amc_renewal_id
       ) t ON t.amc_renewal_id = r.id
       WHERE r.contract_ref = ? AND r.is_deleted = 0
       ORDER BY r.id DESC`,
      [req.params.contractRef]);
    res.json({ rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/renewals/lookup?contract_ref=X ───────────────────────────────────
// Returns maintenance project data for auto-populating the Add Renewal form.
router.get('/lookup', requireModule('alerts'), (req, res) => {
  try {
    const { contract_ref } = req.query;
    if (!contract_ref) return res.status(400).json({ error: 'contract_ref required' });
    const proj = get(`SELECT * FROM maintenance_projects WHERE contract_ref=? AND is_deleted=0 ORDER BY id DESC LIMIT 1`,
      [contract_ref]);
    if (!proj) return res.status(404).json({ error: 'No maintenance project found for this Contract Ref.' });
    res.json({ project: proj });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/renewals/generate-ref?contract_ref=X ────────────────────────────
router.get('/generate-ref', requireModule('alerts'), (req, res) => {
  try {
    const { contract_ref } = req.query;
    if (!contract_ref) return res.status(400).json({ error: 'contract_ref required' });
    const last = get(`SELECT renewal_ref FROM amc_renewals WHERE contract_ref=? ORDER BY id DESC LIMIT 1`,
      [contract_ref]);
    let seq = 1;
    if (last && last.renewal_ref) {
      const m = last.renewal_ref.match(/-R(\d+)$/);
      if (m) seq = parseInt(m[1]) + 1;
    }
    const renewal_ref = `${contract_ref}-R${String(seq).padStart(2,'0')}`;
    res.json({ renewal_ref });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/renewals/:id/payments ────────────────────────────────────────────
// Returns all payment transactions for a renewal.
router.get('/:id/payments', requireModule('alerts'), (req, res) => {
  try {
    const L = amcPay.ledger(req.params.id);
    res.json({ transactions: L.transactions, voided: L.voided, total_received: L.total_received,
      balance: L.balance, outstanding: L.outstanding, amc_value: L.amc_value,
      payment_status: L.payment_status, latest_payment_date: L.latest_payment_date });
  } catch(e) { payErr(res, e); }
});

// ── POST /api/renewals/:id/payment-txn ───────────────────────────────────────
// Add a new payment transaction. Body: { amount, payment_date, invoice_ref, notes }
// Updates denorm fields on amc_renewals after insert.
// 2026-09-29: delegates to the shared AMC payment ledger service (db/amcPayments.js)
// — the same code path as Maintenance → AMC Renewal & Payment Details → + Add Payment.
router.post('/:id/payment-txn', requireModule('alerts'), (req, res) => {
  try {
    if (!roleIn(req, AMC_PAYMENT_ENTRY)) return res.status(403).json({ error: 'Your role cannot record AMC payments.' });
    const b = req.body || {};
    const out = amcPay.addPayment(req.params.id, { amount: b.amount, payment_date: b.payment_date,
      remarks: b.remarks ?? b.notes, invoice_ref: b.invoice_ref, payment_method: b.payment_method,
      client_request_id: b.client_request_id, allow_overpayment: b.allow_overpayment },
      req.session.user.username, roleIn(req, AMC_PAYMENT_ADMIN));
    const L = amcPay.ledger(req.params.id);
    res.json({ row: L.renewal, transactions: L.transactions, total_received: L.total_received, balance: L.balance,
      payment_status: L.payment_status, payment_id: out.payment_id, payment_ref: out.payment_ref, duplicate: !!out.duplicate });
  } catch(e) { payErr(res, e); }
});

// ── PATCH /api/renewals/:id/payment-txn/:txnId ───────────────────────────────
// Edit an existing payment transaction. Requires reason_for_change.
// Records old→new values in renewal_audit_log, recomputes totals on the renewal.
router.patch('/:id/payment-txn/:txnId', requireModule('alerts'), (req, res) => {
  try {
    if (!roleIn(req, AMC_PAYMENT_ADMIN)) return res.status(403).json({ error: 'Only Admin / Accounts can edit a recorded payment.' });
    const L = amcPay.editPayment(req.params.id, req.params.txnId, req.body || {}, req.session.user.username, true);
    res.json({ row: L.renewal, transactions: L.transactions, total_received: L.total_received, balance: L.balance, payment_status: L.payment_status });
  } catch(e) { payErr(res, e); }
});

// ── POST /api/renewals/:id/payment-txn/:txnId/void ───────────────────────────
router.post('/:id/payment-txn/:txnId/void', requireModule('alerts'), (req, res) => {
  try {
    if (!roleIn(req, AMC_PAYMENT_ADMIN)) return res.status(403).json({ error: 'Only Admin / Accounts can void a recorded payment.' });
    const L = amcPay.voidPayment(req.params.id, req.params.txnId, (req.body || {}).reason, req.session.user.username);
    res.json({ row: L.renewal, transactions: L.transactions, voided: L.voided, total_received: L.total_received, balance: L.balance, payment_status: L.payment_status });
  } catch(e) { payErr(res, e); }
});

// ── GET /api/renewals/sync-preview — admin dry run of the current-period sync ───
router.get('/sync-preview', requireModule('alerts'), requireRole('admin'), (req, res) => {
  try { res.json({ results: RS.reconcileAll(req.session.user.username, { dryRun: true }) }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/renewals/:id ─────────────────────────────────────────────────────
router.get('/:id', requireModule('alerts'), (req, res) => {
  try {
    const row = get('SELECT * FROM amc_renewals WHERE id=? AND is_deleted=0', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const auditLog = all('SELECT * FROM renewal_audit_log WHERE amc_renewal_id=? ORDER BY performed_at DESC', [row.id]);
    const transactions = all('SELECT * FROM amc_payment_transactions WHERE amc_renewal_id=? ORDER BY payment_date ASC, id ASC', [row.id]);
    const total_received = transactions.reduce((s,t) => s + (parseFloat(t.amount)||0), 0);
    const balance = (parseFloat(row.new_amc_value)||0) - total_received;
    // queue / data-review finding for the Details view (read-only evaluation, nothing stored or changed)
    let queue_reason = null, evaluated = false; try { queue_reason = RS.queueReason(row); evaluated = true; } catch (_) {}
    res.json({ row, auditLog, transactions, total_received, balance, queue_reason, completed: evaluated && queue_reason === null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/renewals ────────────────────────────────────────────────────────
router.post('/', requireModule('alerts'), (req, res) => {
  try {
    const b = req.body || {};
    const now = new Date().toISOString();
    const u = req.session.user.username;
    if (!b.contract_ref) return res.status(400).json({ error: 'contract_ref is required' });
    if (!b.renewal_ref)  return res.status(400).json({ error: 'renewal_ref is required' });
    // Cancelled guard — a cancelled AMC/project cannot be renewed from the active workflow
    if (!isEligibleForRenewalAlert(b.contract_ref))
      return res.status(409).json({ error: `Contract ${b.contract_ref} is Cancelled (see Maintenance → Cancelled AMC). A renewal cannot be created for a cancelled contract.` });
    // Duplicate-cycle guard (2026-09-26): block a second renewal while one is already
    // in process, or when an Approved renewal already covers an overlapping period.
    // A Cancelled/Rejected decision record is still allowed (it closes the cycle).
    if (!['Cancelled', 'Rejected', 'Not Renewed'].includes(b.renewal_status)) {
      const open = get(`SELECT renewal_ref, renewal_status FROM amc_renewals
        WHERE contract_ref=? AND is_deleted=0 AND renewal_status IN ('Pending','Under Review','Hold')
        ORDER BY id DESC LIMIT 1`, [b.contract_ref]);
      if (open) return res.status(409).json({ error: `Renewal ${open.renewal_ref} (${open.renewal_status}) is already in progress for ${b.contract_ref}. Update that renewal instead of creating a new one.` });
      if (b.new_start_date && b.new_end_date) {
        const overlap = get(`SELECT renewal_ref, new_start_date, new_end_date FROM amc_renewals
          WHERE contract_ref=? AND is_deleted=0 AND renewal_status='Approved'
            AND new_start_date <= ? AND new_end_date >= ? LIMIT 1`,
          [b.contract_ref, b.new_end_date, b.new_start_date]);
        if (overlap) return res.status(409).json({ error: `Approved renewal ${overlap.renewal_ref} already covers ${overlap.new_start_date} – ${overlap.new_end_date}, which overlaps the requested period.` });
      }
    }
    // Duplicate guard
    const dup = get('SELECT id FROM amc_renewals WHERE renewal_ref=? AND is_deleted=0', [b.renewal_ref]);
    if (dup) return res.status(409).json({ error: `Renewal ref ${b.renewal_ref} already exists.` });
    // Lookup maintenance project
    const proj = b.maintenance_project_id
      ? get('SELECT * FROM maintenance_projects WHERE id=?', [b.maintenance_project_id])
      : get('SELECT * FROM maintenance_projects WHERE contract_ref=? AND is_deleted=0 ORDER BY id DESC LIMIT 1', [b.contract_ref]);
    run(`INSERT INTO amc_renewals
      (renewal_ref,maintenance_project_id,maintenance_id,contract_ref,client_name,emirate,maintenance_type,
       prev_start_date,prev_end_date,prev_amc_value,
       new_start_date,new_end_date,new_amc_value,currency_code,currency_symbol,
       renewal_status,payment_status,amc_activation_status,
       amount_paid,invoice_ref,remarks,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [b.renewal_ref, proj?.id||null, proj?.maintenance_id||b.maintenance_id||null,
       b.contract_ref, b.client_name||proj?.client_name||null,
       b.emirate||proj?.emirate||null, b.maintenance_type||proj?.maintenance_type||null,
       b.prev_start_date||proj?.start_date||null, b.prev_end_date||proj?.end_date||null,
       parseFloat(b.prev_amc_value)||proj?.amc_value||null,
       b.new_start_date||null, b.new_end_date||null, parseFloat(b.new_amc_value)||null,
       b.currency_code||proj?.currency_code||'AED', b.currency_symbol||proj?.currency_symbol||'AED',
       b.renewal_status||'Pending', b.payment_status||'Unpaid', 'Inactive',
       parseFloat(b.amount_paid)||0, b.invoice_ref||null,
       b.remarks||null, u, now, now]);
    const row = get('SELECT * FROM amc_renewals WHERE id=last_insert_rowid()');
    logRenewalAudit(row.id, row.renewal_ref, 'CREATED', null, null, null, u, 'Renewal record created');
    // If created with Rejected/Cancelled status → immediately execute cancellation workflow
    if (row.renewal_status === 'Rejected' || row.renewal_status === 'Cancelled') {
      executeCancellation(row, row.renewal_status, b.cancellation_reason || b.remarks || null, u, now);
    }
    const finalRow = get('SELECT * FROM amc_renewals WHERE id=?', [row.id]);
    res.status(201).json({ row: finalRow });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/renewals/:id ───────────────────────────────────────────────────
router.patch('/:id', requireModule('alerts'), (req, res) => {
  try {
    const existing = get('SELECT * FROM amc_renewals WHERE id=? AND is_deleted=0', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    const u = req.session.user.username;
    const ALLOWED = [
      'contract_ref','client_name','emirate','maintenance_type',
      'prev_start_date','prev_end_date','prev_amc_value',
      'new_start_date','new_end_date','new_amc_value','currency_code','currency_symbol',
      'renewal_status','payment_status','amc_activation_status',
      'amount_paid','payment_date','invoice_ref',
      'approval_date','approved_by','activation_date','activated_by',
      'hold_date','hold_reason','remarks',
    ];
    const updates = {};
    for (const f of ALLOWED) { if (f in b) updates[f] = b[f]; }
    // Log changed fields
    for (const [k, v] of Object.entries(updates)) {
      if (String(existing[k]||'') !== String(v||'')) {
        logRenewalAudit(existing.id, existing.renewal_ref, 'FIELD_CHANGE', k, existing[k], v, u, null);
      }
    }
    updates.updated_at = new Date().toISOString();
    const setSql = Object.keys(updates).map(k => `${k}=?`).join(', ');
    run(`UPDATE amc_renewals SET ${setSql} WHERE id=?`, [...Object.values(updates), existing.id]);
    const patchedRenewal = get('SELECT * FROM amc_renewals WHERE id=?', [existing.id]);
    // Cancellation workflow: if status changed to Rejected or Cancelled
    if (updates.renewal_status && ['Rejected','Cancelled'].includes(updates.renewal_status)
        && !['Rejected','Cancelled'].includes(existing.renewal_status)) {
      executeCancellation(patchedRenewal, updates.renewal_status, b.cancellation_reason || null, u, new Date().toISOString());
    } else if ('amc_activation_status' in updates && updates.amc_activation_status !== existing.amc_activation_status) {
      // Sync maintenance_contracts if activation status changed via direct PATCH
      const act = updates.amc_activation_status;
      if (act === 'Active') syncMaintenanceContract(patchedRenewal, 'activate', u);
      else if (act === 'Hold') syncMaintenanceContract(patchedRenewal, 'hold', u);
      else if (act === 'Inactive') syncMaintenanceContract(patchedRenewal, 'inactive', u);
    }
    res.json({ row: get('SELECT * FROM amc_renewals WHERE id=?', [existing.id]) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/renewals/:id/approve ────────────────────────────────────────────
// Body: { activation: 'Active'|'Hold', hold_reason?, approval_date? }
router.post('/:id/approve', requireModule('alerts'), requireRole('admin', 'management'), (req, res) => {
  try {
    const renewal = get('SELECT * FROM amc_renewals WHERE id=? AND is_deleted=0', [req.params.id]);
    if (!renewal) return res.status(404).json({ error: 'Not found' });
    if (renewal.renewal_status === 'Approved')
      return res.status(409).json({ error: 'Already approved.' });
    const b = req.body || {};
    const u = req.session.user.username;
    const now = new Date().toISOString();
    const activation = b.activation || 'Hold';
    if (!AMC_ACTIVATION_OPTS.includes(activation))
      return res.status(400).json({ error: `Invalid activation value: ${activation}` });

    const updates = {
      renewal_status: 'Approved',
      approved_by: u,
      approval_date: b.approval_date || now.slice(0,10),
      amc_activation_status: activation,
      updated_at: now,
    };
    if (activation === 'Active') {
      updates.activation_date = now.slice(0,10);
      updates.activated_by = u;
    } else if (activation === 'Hold') {
      updates.hold_date = now.slice(0,10);
      if (b.hold_reason) updates.hold_reason = b.hold_reason;
    }

    // Update maintenance project if we have one
    let schedulesGenerated = 0;
    if (renewal.maintenance_project_id) {
      const proj = get('SELECT * FROM maintenance_projects WHERE id=?', [renewal.maintenance_project_id]);
      if (proj) {
        const projUpdates = { updated_at: now };
        if (renewal.new_start_date) projUpdates.start_date = renewal.new_start_date;
        if (renewal.new_end_date)   projUpdates.end_date   = renewal.new_end_date;
        if (renewal.new_amc_value)  projUpdates.amc_value  = renewal.new_amc_value;
        projUpdates.maintenance_status = activation === 'Active' ? 'Active' : 'Under Renewal';
        projUpdates.current_renewal_ref = renewal.renewal_ref;
        projUpdates.renewal_count = (proj.renewal_count||0) + 1;
        const ps = Object.keys(projUpdates).map(k=>`${k}=?`).join(', ');
        run(`UPDATE maintenance_projects SET ${ps} WHERE id=?`, [...Object.values(projUpdates), proj.id]);

        if (activation === 'Active' && renewal.new_start_date && renewal.new_end_date) {
          const refreshedProj = get('SELECT * FROM maintenance_projects WHERE id=?', [proj.id]);
          schedulesGenerated = generateRenewalSchedule(refreshedProj, renewal.new_start_date, u);
          updates.schedules_generated = 1;
          updates.schedules_generated_at = now;
        }
        updates.maintenance_updated = 1;
      }
    }

    const setSql = Object.keys(updates).map(k=>`${k}=?`).join(', ');
    run(`UPDATE amc_renewals SET ${setSql} WHERE id=?`, [...Object.values(updates), renewal.id]);
    logRenewalAudit(renewal.id, renewal.renewal_ref, 'APPROVED',
      'renewal_status', renewal.renewal_status, 'Approved', u,
      `Activation: ${activation}. Schedules generated: ${schedulesGenerated}`);
    // Sync legacy maintenance_contracts table so Maintenance Module reflects AMC state
    const approvedRenewal = get('SELECT * FROM amc_renewals WHERE id=?', [renewal.id]);
    if (activation === 'Active') syncMaintenanceContract(approvedRenewal, 'activate', u);
    else if (activation === 'Hold') syncMaintenanceContract(approvedRenewal, 'hold', u);
    res.json({
      row: get('SELECT * FROM amc_renewals WHERE id=?', [renewal.id]),
      schedules_generated: schedulesGenerated,
      activation,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/renewals/:id/activate ──────────────────────────────────────────
// Switches Hold → Active. Generates schedules for remaining period only (no duplicates).
router.post('/:id/activate', requireModule('alerts'), requireRole('admin', 'management'), (req, res) => {
  try {
    const renewal = get('SELECT * FROM amc_renewals WHERE id=? AND is_deleted=0', [req.params.id]);
    if (!renewal) return res.status(404).json({ error: 'Not found' });
    if (renewal.amc_activation_status === 'Active')
      return res.status(409).json({ error: 'Already Active.' });
    if (renewal.renewal_status !== 'Approved')
      return res.status(400).json({ error: 'Renewal must be Approved before activating.' });
    // 2026-09-26 validation: contract ref, period, cancellation, conflicting active renewal
    if (!renewal.contract_ref)
      return res.status(400).json({ error: 'Renewal has no Contract Ref. — link it before activating.' });
    if (!renewal.new_start_date || !renewal.new_end_date)
      return res.status(400).json({ error: 'Renewal period (new start and end date) is required before activating.' });
    if (renewal.new_end_date < renewal.new_start_date)
      return res.status(400).json({ error: 'Renewal end date is earlier than its start date.' });
    if (!isEligibleForRenewalAlert(renewal.contract_ref))
      return res.status(409).json({ error: `Contract ${renewal.contract_ref} is Cancelled — a renewal cannot be activated.` });
    const conflict = get(`SELECT renewal_ref FROM amc_renewals WHERE contract_ref=? AND is_deleted=0 AND id<>?
        AND renewal_status='Approved' AND amc_activation_status='Active'
        AND new_start_date < ? AND new_end_date > ?`,
      [renewal.contract_ref, renewal.id, renewal.new_end_date, renewal.new_start_date]);
    if (conflict)
      return res.status(409).json({ error: `Active renewal ${conflict.renewal_ref} already covers an overlapping period. Resolve it before activating ${renewal.renewal_ref}.` });
    const u   = req.session.user.username;
    const now = new Date().toISOString();
    let schedulesGenerated = 0;
    run('BEGIN');   // atomic: renewal activation + maintenance sync commit together
    try {

    if (renewal.maintenance_project_id && renewal.new_end_date) {
      const proj = get('SELECT * FROM maintenance_projects WHERE id=?', [renewal.maintenance_project_id]);
      if (proj) {
        // Update project to Active with the renewal end date
        run(`UPDATE maintenance_projects SET maintenance_status='Active', end_date=?, updated_at=? WHERE id=?`,
          [renewal.new_end_date, now, proj.id]);
        const refreshedProj = get('SELECT * FROM maintenance_projects WHERE id=?', [proj.id]);
        // Generate only from today forward (no duplicates via INSERT OR IGNORE)
        const startFrom = new Date().toISOString().slice(0,10);
        schedulesGenerated = generateRenewalSchedule(refreshedProj, startFrom, u);
      }
    }
    run(`UPDATE amc_renewals SET amc_activation_status='Active',activation_date=?,activated_by=?,
         maintenance_updated=1,schedules_generated=1,schedules_generated_at=?,updated_at=? WHERE id=?`,
      [now.slice(0,10), u, now, now, renewal.id]);
    logRenewalAudit(renewal.id, renewal.renewal_ref, 'ACTIVATED',
      'amc_activation_status', renewal.amc_activation_status, 'Active', u,
      `Schedules generated: ${schedulesGenerated}`);
    // Sync legacy maintenance_contracts table so Maintenance Module reflects AMC state
    const activatedRenewal = get('SELECT * FROM amc_renewals WHERE id=?', [renewal.id]);
    syncMaintenanceContract(activatedRenewal, 'activate', u);
    run('COMMIT');
    } catch (txErr) { try { run('ROLLBACK'); } catch(_) {} throw txErr; }
    res.json({ row: get('SELECT * FROM amc_renewals WHERE id=?', [renewal.id]), schedules_generated: schedulesGenerated });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/renewals/:id/hold ───────────────────────────────────────────────
// Switches Active → Hold. Preserves completed visits; marks future visits as Hold.
router.post('/:id/hold', requireModule('alerts'), requireRole('admin', 'management'), (req, res) => {
  try {
    const renewal = get('SELECT * FROM amc_renewals WHERE id=? AND is_deleted=0', [req.params.id]);
    if (!renewal) return res.status(404).json({ error: 'Not found' });
    if (renewal.amc_activation_status === 'Hold')
      return res.status(409).json({ error: 'Already on Hold.' });
    const b   = req.body || {};
    const u   = req.session.user.username;
    const now = new Date().toISOString();
    const today = now.slice(0,10);
    // Mark future (pending/scheduled) visits as Hold
    let visitsPaused = 0;
    if (renewal.maintenance_project_id) {
      const r = run(`UPDATE maintenance_project_visits SET visit_status='Cancelled',cancellation_reason='AMC Hold',updated_at=?
        WHERE maintenance_project_id=? AND visit_status IN ('Pending','Scheduled') AND scheduled_date > ?`,
        [now, renewal.maintenance_project_id, today]);
      visitsPaused = r.changes || 0;
      run(`UPDATE maintenance_projects SET maintenance_status='Under Renewal',updated_at=? WHERE id=?`,
        [now, renewal.maintenance_project_id]);
    }
    run(`UPDATE amc_renewals SET amc_activation_status='Hold',hold_date=?,hold_reason=?,updated_at=? WHERE id=?`,
      [today, b.hold_reason||null, now, renewal.id]);
    logRenewalAudit(renewal.id, renewal.renewal_ref, 'HOLD',
      'amc_activation_status', renewal.amc_activation_status, 'Hold', u,
      `Reason: ${b.hold_reason||'—'}. Visits paused: ${visitsPaused}`);
    // Sync legacy maintenance_contracts table so Maintenance Module reflects AMC state
    syncMaintenanceContract(renewal, 'hold', u);
    res.json({ row: get('SELECT * FROM amc_renewals WHERE id=?', [renewal.id]), visits_paused: visitsPaused });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/renewals/:id/cancel ────────────────────────────────────────────
// Body: { original_decision: 'Rejected'|'Cancelled', cancellation_reason }
// Both Rejected and Cancelled result in final operational status = 'Cancelled'.
router.post('/:id/cancel', requireModule('alerts'), requireRole('admin', 'management'), (req, res) => {
  try {
    const renewal = get('SELECT * FROM amc_renewals WHERE id=? AND is_deleted=0', [req.params.id]);
    if (!renewal) return res.status(404).json({ error: 'Not found' });
    if (renewal.renewal_status === 'Cancelled')
      return res.status(409).json({ error: 'Already cancelled.' });
    const b = req.body || {};
    const u = req.session.user.username;
    const now = new Date().toISOString();
    const originalDecision = b.original_decision || 'Cancelled';
    const reason = b.cancellation_reason || null;
    const result = executeCancellation(renewal, originalDecision, reason, u, now);
    res.json({ row: get('SELECT * FROM amc_renewals WHERE id=?', [renewal.id]), ...result });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/renewals/:id/payment ────────────────────────────────────────────
// Body: { payment_status, amount_paid, new_amc_value, payment_date, invoice_ref, notes }
// If amount_paid > 0 and differs from current, also writes to amc_payment_transactions.
router.post('/:id/payment', requireModule('alerts'), (req, res) => {
  // 2026-09-29: ledger-safe. Previously `amount_paid` (a CUMULATIVE figure) was inserted
  // as a NEW transaction, so entering "1000 received" when 500 was already recorded
  // produced 1500. Now: AMC value / manual status are updated on the renewal, and
  //   amount_paid > ledger total  → only the DIFFERENCE is posted as a new payment
  //   amount_paid = ledger total  → no new payment (payment_date fills undated rows)
  //   amount_paid < ledger total  → rejected (use Edit / Void on the transaction)
  try {
    const renewal = get('SELECT * FROM amc_renewals WHERE id=? AND is_deleted=0', [req.params.id]);
    if (!renewal) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    const u = req.session.user.username;
    if (b.payment_status && !PAYMENT_STATUS_OPTS.includes(b.payment_status))
      return res.status(400).json({ error: `Invalid payment_status: ${b.payment_status}` });
    const wantsPayment = b.amount_paid != null && b.amount_paid !== '' && parseFloat(b.amount_paid) > 0;
    if (wantsPayment && !roleIn(req, AMC_PAYMENT_ENTRY)) return res.status(403).json({ error: 'Your role cannot record AMC payments.' });
    amcPay.inTx(() => {
      const now = new Date().toISOString();
      if (b.new_amc_value != null && b.new_amc_value !== '') {
        const v = parseFloat(b.new_amc_value);
        if (!(v > 0)) throw new amcPay.PaymentError('AMC value must be greater than 0.');
        if (v !== renewal.new_amc_value) {
          run('UPDATE amc_renewals SET new_amc_value=?, updated_at=? WHERE id=?', [v, now, renewal.id]);
          logRenewalAudit(renewal.id, renewal.renewal_ref, 'AMC_VALUE_SET', 'new_amc_value', renewal.new_amc_value, v, u, 'Set via Update Payment');
        }
      }
      if (b.invoice_ref != null) run('UPDATE amc_renewals SET invoice_ref=? WHERE id=?', [b.invoice_ref || null, renewal.id]);
      if (wantsPayment) {
        const L = amcPay.ledger(renewal.id);
        const target = Math.round(parseFloat(b.amount_paid) * 100) / 100;
        const delta = Math.round((target - L.total_received) * 100) / 100;
        if (delta < -0.005) throw new amcPay.PaymentError(`Total received per ledger is already ${L.total_received.toFixed(2)}. To reduce it, edit or void the specific payment transaction.`);
        if (delta > 0.005) {
          amcPay.addPayment(renewal.id, { amount: delta, payment_date: b.payment_date || amcPay.localToday(),
            remarks: b.notes || 'Recorded via Update Payment (cumulative total entered)' }, u, roleIn(req, AMC_PAYMENT_ADMIN));
        } else if (b.payment_date) {
          const undated = all('SELECT id, payment_ref FROM amc_payment_transactions WHERE amc_renewal_id=? AND (payment_date IS NULL OR payment_date=?)', [renewal.id, '']);
          undated.forEach(t => {
            run('UPDATE amc_payment_transactions SET payment_date=?, updated_by=?, updated_at=? WHERE id=?', [b.payment_date, u, now, t.id]);
            logRenewalAudit(renewal.id, renewal.renewal_ref, 'PAYMENT_TXN_EDITED', `${t.payment_ref || 'txn_' + t.id}.payment_date`, null, b.payment_date, u, 'Missing payment date completed via Update Payment');
          });
        }
      }
      // Manual status override (Later / Overdue / Hold) is kept as an explicit choice;
      // Paid / Partial / Unpaid are always derived from the ledger.
      if (b.payment_status && ['Later','Overdue','Hold'].includes(b.payment_status) && b.payment_status !== renewal.payment_status) {
        run('UPDATE amc_renewals SET payment_status=? WHERE id=?', [b.payment_status, renewal.id]);
        logRenewalAudit(renewal.id, renewal.renewal_ref, 'PAYMENT_UPDATE', 'payment_status', renewal.payment_status, b.payment_status, u, 'Manual status override');
      }
      amcPay.recalc(renewal.id);
    });
    const L = amcPay.ledger(renewal.id);
    const updated = L.renewal;
    res.json({ row: updated, transactions: L.transactions, total_received: L.total_received, balance: L.balance,
      prompt_activate: L.payment_status === 'Paid' && updated.amc_activation_status === 'Hold' });
  } catch(e) { payErr(res, e); }
});

// ── DELETE /api/renewals/:id ──────────────────────────────────────────────────
router.delete('/:id', requireModule('alerts'), requireRole('admin'), (req, res) => {
  try {
    const row = get('SELECT * FROM amc_renewals WHERE id=? AND is_deleted=0', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Renewal not found' });
    run(`UPDATE amc_renewals SET is_deleted=1, updated_at=? WHERE id=?`, [new Date().toISOString(), row.id]);
    writeAuditLog({
      action: 'DELETE', module: 'amc_renewals', recordId: row.id, recordRef: row.renewal_ref,
      details: { contract_ref: row.contract_ref, renewal_status: row.renewal_status },
      performedBy: req.session.user.username,
    });
    logRenewalAudit(row.id, row.renewal_ref, 'DELETED', null, null, null, req.session.user.username, 'Record soft-deleted');
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/renewals/recover-sync ──────────────────────────────────────────
// Admin utility: scan all Active renewals and fix any maintenance_contracts that
// are out of sync (renewal_status !== 'Active Maintenance'). Safe to run multiple
// times — INSERT OR IGNORE prevents duplicate schedule_months entries.
router.post('/recover-sync', requireModule('alerts'), requireRole('admin'), (req, res) => {
  try {
    const u = req.session?.user?.username || 'system-recovery';
    const activeRenewals = all(
      `SELECT * FROM amc_renewals WHERE amc_activation_status='Active' AND is_deleted=0`, []
    );
    let fixed = 0, skipped = 0;
    const details = [];
    for (const renewal of activeRenewals) {
      const mc = get(
        `SELECT id, renewal_status FROM maintenance_contracts WHERE contract_ref=? AND is_deleted=0`,
        [renewal.contract_ref]
      );
      if (!mc) {
        skipped++;
        details.push({ renewal_ref: renewal.renewal_ref, reason: 'no_mc_record' });
        continue;
      }
      if (mc.renewal_status === 'Active Maintenance') {
        skipped++;
        details.push({ renewal_ref: renewal.renewal_ref, mc_id: mc.id, reason: 'already_synced' });
        continue;
      }
      const result = syncMaintenanceContract(renewal, 'activate', u);
      fixed++;
      details.push({ renewal_ref: renewal.renewal_ref, ...result });
    }
    res.json({ ok: true, active_renewals_scanned: activeRenewals.length, fixed, skipped, details });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 2026-10-03: one reconciliation pass at start-up (idempotent — already synchronized
// renewals are untouched; review cases stay in the queue).
setImmediate(() => {
  try {
    const out = RS.reconcileAll('system:startup', { source: 'startup reconciliation' });
    const n = out.filter(x => x.synced && !x.already).length;
    if (n) console.log(`[renewalSync] start-up: ${n} renewal(s) made the current AMC period`);
  } catch (e) { console.error('[renewalSync] start-up reconciliation:', e.message); }
});

module.exports = router;
