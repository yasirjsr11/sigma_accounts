'use strict';
// AMC PAYMENT LEDGER SERVICE — single source of truth (2026-09-29)
//
//   ONE AMC RENEWAL (Renewal Ref.)  →  ONE LEDGER  →  MANY PAYMENT TRANSACTIONS
//
// Ledger table: amc_payment_transactions (one row per actual payment, linked by
// amc_renewal_id + renewal_ref + contract_ref). Used by BOTH
//   • Maintenance → AMC Renewal & Payment Details  (routes/maintenance_contracts.js)
//   • Alerts → Renewal Status                       (routes/renewals.js)
// so a payment entered in one screen is the same row the other screen reads.
//
// Derived values (never stored independently of the ledger):
//   Total Received  = SUM(amount) of ledger rows for the renewal
//   Outstanding     = AMC Value − Total Received
//   Payment Status  = Unpaid (0) / Partial (0 < received < value) / Paid (≥ value)
//   Latest Payment  = MAX(payment_date)
// amc_renewals.amount_paid / payment_status / payment_date are refreshed as a
// cache after every change (inside the same DB transaction).
//
// Voiding: the transaction row is MOVED to amc_payment_voids with all original
// fields + void metadata (nothing is erased; every existing total automatically
// excludes voided payments). Every add / edit / void writes renewal_audit_log.

const { db, run, get, all } = require('./db.js');

const round2 = v => Math.round((Number(v) || 0) * 100) / 100;
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

class PaymentError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function audit(renewal, action, field, oldV, newV, user, notes) {
  run(`INSERT INTO renewal_audit_log (amc_renewal_id, renewal_ref, action, field_name, old_value, new_value, performed_by, notes)
       VALUES (?,?,?,?,?,?,?,?)`,
    [renewal.id, renewal.renewal_ref, action, field || null,
     oldV != null ? String(oldV) : null, newV != null ? String(newV) : null, user, notes || null]);
}

function derivedStatus(value, received, storedStatus) {
  if (['Later', 'Overdue', 'Hold'].includes(storedStatus) && received < value) return storedStatus;
  if (received <= 0) return 'Unpaid';
  if (value > 0 && received >= value - 0.005) return 'Paid';
  return 'Partial';
}

/** Ledger summary for one renewal (computed from transactions only). */
function ledger(renewalId) {
  const r = get('SELECT * FROM amc_renewals WHERE id=? AND is_deleted=0', [renewalId]);
  if (!r) throw new PaymentError('Renewal not found', 404);
  const txns = all(`SELECT * FROM amc_payment_transactions WHERE amc_renewal_id=?
                    ORDER BY COALESCE(payment_date,'0000') DESC, id DESC`, [r.id]);   // newest first
  const voided = all(`SELECT * FROM amc_payment_voids WHERE amc_renewal_id=? ORDER BY voided_at DESC`, [r.id]);
  const value = round2(r.new_amc_value);
  const received = round2(txns.reduce((s, t) => s + (Number(t.amount) || 0), 0));
  const latest = txns.map(t => t.payment_date).filter(Boolean).sort().pop() || null;
  return {
    renewal: r, transactions: txns, voided,
    amc_value: value, total_received: received, balance: round2(value - received),
    outstanding: Math.max(0, round2(value - received)),
    payment_status: derivedStatus(value, received, r.payment_status),
    latest_payment_date: latest,
    operational_status: evaluateAMCOperationalStatus({ renewal_status: r.renewal_status,
      amc_activation_status: r.amc_activation_status, total_received: received,
      cancelled: isContractCancelled(r.contract_ref) }),
  };
}

/** Refresh the renewal's cached payment fields from the ledger. */
function recalc(renewalId) {
  const L = ledger(renewalId);
  run(`UPDATE amc_renewals SET amount_paid=?, payment_status=?, payment_date=?, updated_at=? WHERE id=?`,
    [L.total_received, L.payment_status, L.latest_payment_date, new Date().toISOString(), renewalId]);
  // 2026-10-03: Approved + Active + first payment received → renewal becomes the current
  // AMC period (savepoint inside renewalSync: a sync problem never undoes the payment).
  try { require('./renewalSync.js').syncRenewal(renewalId, 'system:payment', { source: 'payment ledger' }); }
  catch (e) { console.error('[renewalSync after payment]', e.message); }
  return ledger(renewalId);
}

function nextPaymentRef(renewal) {
  const base = `AMP-${String(renewal.renewal_ref || ('R' + renewal.id)).replace(/[^A-Za-z0-9-]/g, '')}`;
  const rows = all(`SELECT payment_ref FROM amc_payment_transactions WHERE payment_ref LIKE ?
                    UNION ALL SELECT payment_ref FROM amc_payment_voids WHERE payment_ref LIKE ?`, [base + '-%', base + '-%']);
  let max = 0;
  rows.forEach(x => { const m = /-(\d+)$/.exec(x.payment_ref || ''); if (m) max = Math.max(max, parseInt(m[1], 10)); });
  return `${base}-${String(max + 1).padStart(3, '0')}`;
}

function validateAmount(v) {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !isFinite(n)) throw new PaymentError('Payment amount must be a number.');
  if (n <= 0) throw new PaymentError('Payment amount must be greater than 0.');
  return round2(n);
}
function validateDate(d) {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(String(d))) throw new PaymentError('Payment date is required (YYYY-MM-DD).');
  const t = new Date(d + 'T00:00:00');
  if (isNaN(t.getTime())) throw new PaymentError('Payment date is not a valid date.');
  if (d > localToday()) throw new PaymentError('Payment date cannot be in the future — record payments on the date they were actually received.');
  return d;
}

// Re-entrant transaction helper: nested calls join the outer transaction, so
// "create payment record + first payment" commits or rolls back as one unit.
let _txDepth = 0;
function inTx(fn) {
  if (_txDepth > 0) { _txDepth++; try { return fn(); } finally { _txDepth--; } }
  db.exec('BEGIN IMMEDIATE'); _txDepth = 1;
  try { const out = fn(); db.exec('COMMIT'); return out; }
  catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
  finally { _txDepth = 0; }
}

/**
 * Add a payment. opts: { amount, payment_date, remarks, client_request_id, allow_overpayment }
 * Idempotent on client_request_id (double-click / retry returns the existing row).
 */
function addPayment(renewalId, opts, user, canOverpay) {
  const amount = validateAmount(opts.amount);
  const date = validateDate(opts.payment_date);
  const remarks = opts.remarks != null ? String(opts.remarks).trim() || null : null;
  const invoiceRef = opts.invoice_ref != null ? String(opts.invoice_ref).trim() || null : null;
  const payMethod = opts.payment_method != null ? String(opts.payment_method).trim() || null : null;
  const reqId = opts.client_request_id ? String(opts.client_request_id).slice(0, 80) : null;
  return inTx(() => {
    if (reqId) {
      const dup = get('SELECT id FROM amc_payment_transactions WHERE client_request_id=?', [reqId]);
      if (dup) return { ...ledger(renewalId), duplicate: true, payment_id: dup.id };
    }
    const L = ledger(renewalId);
    const r = L.renewal;
    if (r.renewal_status === 'Cancelled' || r.renewal_status === 'Rejected')
      throw new PaymentError(`Renewal ${r.renewal_ref} is ${r.renewal_status} — payments cannot be recorded against it.`);
    if (!(L.amc_value > 0)) throw new PaymentError(`Set the AMC value for ${r.renewal_ref} before recording payments.`);
    if (amount > L.outstanding + 0.005 && !(opts.allow_overpayment && canOverpay))
      throw new PaymentError(`Payment amount exceeds the outstanding AMC balance of ${r.currency_code || 'AED'} ${L.outstanding.toFixed(2)}.`);
    const ref = nextPaymentRef(r);
    const now = new Date().toISOString();
    const res = run(`INSERT INTO amc_payment_transactions
        (amc_renewal_id, renewal_ref, contract_ref, payment_ref, payment_date, amount, payment_status, notes,
         invoice_ref, payment_method, entered_by, updated_by, client_request_id, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [r.id, r.renewal_ref, r.contract_ref || null, ref, date, amount, 'Paid', remarks, invoiceRef, payMethod,
       user, user, reqId, now, now]);
    audit(r, 'PAYMENT_TXN_ADDED', 'amount', null, amount, user,
      `${ref} | Date: ${date} | Invoice: ${invoiceRef || '-'} | Remarks: ${remarks || '-'} | Received before: ${L.total_received}`);
    const out = recalc(r.id);
    return { ...out, payment_id: Number(res.lastInsertRowid), payment_ref: ref };
  });
}

/** Edit an existing payment (amount / date / remarks). Requires a reason. */
function editPayment(renewalId, txnId, opts, user, canOverpay) {
  const reason = String(opts.reason_for_change || opts.reason || '').trim();
  if (!reason) throw new PaymentError('A reason for the change is required.');
  return inTx(() => {
    const L = ledger(renewalId);
    const r = L.renewal;
    const t = get('SELECT * FROM amc_payment_transactions WHERE id=? AND amc_renewal_id=?', [txnId, r.id]);
    if (!t) throw new PaymentError('Payment transaction not found', 404);
    const upd = {};
    if (opts.amount !== undefined && opts.amount !== null && opts.amount !== '') upd.amount = validateAmount(opts.amount);
    if (opts.payment_date !== undefined) upd.payment_date = validateDate(opts.payment_date);
    const newRemarks = opts.remarks !== undefined ? opts.remarks : opts.notes;
    if (newRemarks !== undefined) upd.notes = String(newRemarks || '').trim() || null;
    if (opts.invoice_ref !== undefined) upd.invoice_ref = opts.invoice_ref || null;
    if (opts.payment_method !== undefined) upd.payment_method = opts.payment_method || null;
    if (upd.amount !== undefined) {
      const newTotal = round2(L.total_received - Number(t.amount) + upd.amount);
      if (newTotal > L.amc_value + 0.005 && !(opts.allow_overpayment && canOverpay))
        throw new PaymentError(`This change would make total received (${newTotal.toFixed(2)}) exceed the AMC value (${L.amc_value.toFixed(2)}).`);
    }
    const changed = Object.entries(upd).filter(([k, v]) => String(t[k] ?? '') !== String(v ?? ''));
    if (!changed.length) return L;
    changed.forEach(([k, v]) => audit(r, 'PAYMENT_TXN_EDITED', `${t.payment_ref || 'txn_' + t.id}.${k}`, t[k], v, user, `Reason: ${reason}`));
    const sets = [...changed.map(([k]) => `${k}=?`), 'updated_by=?', 'updated_at=?'];
    run(`UPDATE amc_payment_transactions SET ${sets.join(', ')} WHERE id=?`,
      [...changed.map(([, v]) => v), user, new Date().toISOString(), t.id]);
    return recalc(r.id);
  });
}

/** Void a payment: moved to amc_payment_voids (fully auditable), totals recalculated. */
function voidPayment(renewalId, txnId, reason, user) {
  reason = String(reason || '').trim();
  if (!reason) throw new PaymentError('A reason is required to void a payment.');
  return inTx(() => {
    const L = ledger(renewalId);
    const r = L.renewal;
    const t = get('SELECT * FROM amc_payment_transactions WHERE id=? AND amc_renewal_id=?', [txnId, r.id]);
    if (!t) throw new PaymentError('Payment transaction not found', 404);
    run(`INSERT INTO amc_payment_voids (original_id, amc_renewal_id, renewal_ref, contract_ref, payment_ref, payment_date,
          amount, invoice_ref, payment_method, notes, entered_by, created_at, void_reason, voided_by, voided_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [t.id, t.amc_renewal_id, t.renewal_ref, t.contract_ref, t.payment_ref, t.payment_date, t.amount,
       t.invoice_ref, t.payment_method, t.notes, t.entered_by, t.created_at, reason, user, new Date().toISOString()]);
    run('DELETE FROM amc_payment_transactions WHERE id=?', [t.id]);
    audit(r, 'PAYMENT_TXN_VOIDED', t.payment_ref || `txn_${t.id}`, t.amount, 0, user,
      `Voided ${t.payment_ref || ''} (${t.payment_date || '-'} · ${t.amount}). Reason: ${reason}`);
    return recalc(r.id);
  });
}

/**
 * Ensure a renewal (payment ledger anchor) exists for a maintenance record's
 * CURRENT AMC period. Used when a paid AMC has no renewal record yet.
 * Creates it only on explicit user action (first payment), never in bulk.
 */
function ensureCurrentPeriodRenewal(mc, amcValue, user) {
  const value = validateAmount(amcValue);
  if (!mc.contract_ref) throw new PaymentError('This maintenance record has no Contract Ref. — link it before recording payments.');
  if (!mc.start_date || !mc.end_date) throw new PaymentError('The maintenance record needs AMC start and end dates before payments can be recorded.');
  const existing = get(`SELECT * FROM amc_renewals WHERE contract_ref=? AND is_deleted=0 AND new_start_date=? AND new_end_date=?
                          AND renewal_status NOT IN ('Cancelled','Rejected')`, [mc.contract_ref, mc.start_date, mc.end_date]);
  if (existing) return existing;
  const last = get(`SELECT renewal_ref FROM amc_renewals WHERE contract_ref=? ORDER BY id DESC LIMIT 1`, [mc.contract_ref]);
  let seq = 1; const m = last && /-R(\d+)$/.exec(last.renewal_ref || ''); if (m) seq = parseInt(m[1], 10) + 1;
  const ref = `${mc.contract_ref}-R${String(seq).padStart(2, '0')}`;
  const now = new Date().toISOString();
  const res = run(`INSERT INTO amc_renewals (renewal_ref, maintenance_id, contract_ref, client_name, emirate, maintenance_type,
      new_start_date, new_end_date, new_amc_value, currency_code, currency_symbol, renewal_status, payment_status,
      amc_activation_status, amount_paid, remarks, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [ref, mc.maintenance_id || null, mc.contract_ref, mc.client_name || null, mc.emirate || null, mc.maintenance_type || null,
     mc.start_date, mc.end_date, value, mc.currency_code || 'AED', mc.currency_symbol || 'AED',
     'Approved', 'Unpaid', 'Active', 0,
     'Payment record for the current AMC period (created from Maintenance → Add Payment)', user, now, now]);
  const r = get('SELECT * FROM amc_renewals WHERE id=?', [Number(res.lastInsertRowid)]);
  audit(r, 'CURRENT_PERIOD_PAYMENT_RECORD_CREATED', 'new_amc_value', null, value, user,
    `AMC period ${mc.start_date} – ${mc.end_date} (maintenance record ${mc.maintenance_id || mc.id}). No dates or statuses of the maintenance record changed.`);
  return r;
}

// ══════════════════════════════════════════════════════════════════════════════
// OPERATIONAL STATUS vs FINANCIAL BALANCE (2026-09-29 business rule)
//
//   Renewal Approved + AMC Activation Active + ANY valid payment received (> 0)
//        → Maintenance AMC = ACTIVE   (payment may be Partial or Full)
//   Remaining balance (AMC Value − Total Received) is a FINANCIAL receivable
//   ("Outstanding AMC Payment Due"), tracked once per renewal — never repeated
//   per month and never used to decide expiry / renewal attention.
//   Cancelled and Hold always override payment-based activation.
// ══════════════════════════════════════════════════════════════════════════════
function isContractCancelled(contractRef) {
  if (!contractRef) return false;
  const x = get(`SELECT
      EXISTS(SELECT 1 FROM maintenance_contracts WHERE contract_ref=? AND is_deleted=0 AND renewal_status='Cancelled') AS mc,
      EXISTS(SELECT 1 FROM contracts WHERE contract_ref=? AND is_deleted=0 AND project_status='Cancelled') AS pc`, [contractRef, contractRef]);
  return !!(x && (x.mc || x.pc));
}

/** Single source of truth for the AMC operational status of a renewal. */
function evaluateAMCOperationalStatus({ renewal_status, amc_activation_status, total_received, cancelled }) {
  if (cancelled || ['Cancelled', 'Rejected', 'Not Renewed'].includes(renewal_status)) return 'Cancelled';
  if (amc_activation_status === 'Hold' || renewal_status === 'Hold') return 'Hold';
  if (renewal_status !== 'Approved') return 'Pending Approval';
  if (amc_activation_status !== 'Active') return 'Pending Activation';
  if (!(Number(total_received) > 0)) return 'Pending First Payment';
  return 'Active';
}

/** calculateAMCBalance — ledger-derived figures for one renewal. */
function calculateAMCBalance(renewalId) {
  const L = ledger(renewalId);
  return { amc_value: L.amc_value, total_received: L.total_received, outstanding: L.outstanding,
    payment_status: L.payment_status, latest_payment_date: L.latest_payment_date };
}

/**
 * CURRENT / APPLICABLE renewal per contract (one row per Contract Ref., never per month):
 * an Approved+Active renewal whose period covers today first, then the latest period.
 * Cancelled / Rejected renewals are excluded.
 */
const CURRENT_LEDGER_CTE = `
  WITH ranked AS (
    SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.contract_ref ORDER BY
        (r.renewal_status='Approved' AND r.amc_activation_status='Active'
         AND r.new_start_date <= date('now','localtime') AND r.new_end_date >= date('now','localtime')) DESC,
        COALESCE(r.new_start_date,'') DESC, r.id DESC) AS rn
    FROM amc_renewals r
    WHERE r.is_deleted=0 AND r.renewal_status NOT IN ('Cancelled','Rejected')
  ),
  cur AS (
    SELECT rk.*, COALESCE(t.received,0) AS total_received, t.latest_payment_date,
      mc.id AS mc_id, mc.maintenance_id AS mc_maintenance_id, COALESCE(NULLIF(mc.total_elevator_units,0),1) AS units
    FROM ranked rk
    LEFT JOIN (SELECT amc_renewal_id, ROUND(SUM(amount),2) AS received, MAX(payment_date) AS latest_payment_date
               FROM amc_payment_transactions GROUP BY amc_renewal_id) t ON t.amc_renewal_id = rk.id
    LEFT JOIN maintenance_contracts mc ON mc.contract_ref = rk.contract_ref AND mc.is_deleted=0
    WHERE rk.rn = 1
  )`;

/**
 * Outstanding AMC Payment Due — Σ(max(0, AMC Value − Total Received)) over the current
 * APPROVED renewal of each contract (pending approvals are not yet receivables).
 * filters: { emirate, maintenance_type, renewal_status }
 */
function getOutstandingAMC(filters = {}) {
  const w = [], p = [];
  if (filters.emirate)          { w.push('cur.emirate=?');          p.push(filters.emirate); }
  if (filters.maintenance_type) { w.push('cur.maintenance_type=?'); p.push(filters.maintenance_type); }
  if (filters.renewal_status)   { w.push('cur.renewal_status=?');   p.push(filters.renewal_status); }
  const rows = all(`${CURRENT_LEDGER_CTE} SELECT * FROM cur ${w.length ? 'WHERE ' + w.join(' AND ') : ''}`, p);
  const today = new Date(localToday() + 'T00:00:00');
  const byStatus = { Paid: { count: 0, units: 0 }, Partial: { count: 0, units: 0 }, Unpaid: { count: 0, units: 0 } };
  const out = [];
  let total = 0;
  for (const r of rows) {
    const value = round2(r.new_amc_value), received = round2(r.total_received);
    if (!(value > 0)) continue;                          // no AMC value → not a receivable (data review elsewhere)
    if (r.renewal_status !== 'Approved') continue;       // not yet approved → not yet owed (shown in Renewal Status / Expiring Contracts)
    const status = received <= 0 ? 'Unpaid' : (received >= value - 0.005 ? 'Paid' : 'Partial');
    byStatus[status].count++; byStatus[status].units += Number(r.units) || 0;
    const bal = Math.max(0, round2(value - received));
    if (bal <= 0) continue;
    total = round2(total + bal);
    const since = r.latest_payment_date || r.approval_date || r.activation_date || r.new_start_date || null;
    out.push({
      id: r.id, mc_id: r.mc_id, renewal_ref: r.renewal_ref, contract_ref: r.contract_ref, client_name: r.client_name,
      emirate: r.emirate, maintenance_type: r.maintenance_type, new_start_date: r.new_start_date, new_end_date: r.new_end_date,
      new_amc_value: value, amount_paid: received, total_received: received, balance: bal, payment_status: status,
      renewal_status: r.renewal_status, amc_activation_status: r.amc_activation_status, currency_code: r.currency_code || 'AED',
      latest_payment_date: r.latest_payment_date || null, units: r.units,
      ageing_basis: r.latest_payment_date ? 'Last payment' : (r.approval_date ? 'Approval' : r.activation_date ? 'Activation' : 'AMC start'),
      days_since: since ? Math.max(0, Math.floor((today - new Date(String(since).slice(0, 10) + 'T00:00:00')) / 864e5)) : null,
      operational_status: evaluateAMCOperationalStatus({ renewal_status: r.renewal_status,
        amc_activation_status: r.amc_activation_status, total_received: received, cancelled: isContractCancelled(r.contract_ref) }),
    });
  }
  out.sort((a, b) => b.balance - a.balance || String(a.contract_ref).localeCompare(String(b.contract_ref)));
  return { rows: out, total_due: total, by_status: byStatus, current_renewals: rows.length };
}

module.exports = { ledger, recalc, addPayment, editPayment, voidPayment, ensureCurrentPeriodRenewal, PaymentError, localToday, inTx,
  evaluateAMCOperationalStatus, calculateAMCBalance, getOutstandingAMC, isContractCancelled, CURRENT_LEDGER_CTE };
