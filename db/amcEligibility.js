// AMC renewal-alert eligibility — single source of truth (2026-09-26).
//
// A maintenance contract is CANCELLED (and therefore NOT eligible for expiry /
// renewal monitoring) when ANY of the following is currently true:
//   1. maintenance_contracts.renewal_status = 'Cancelled'   (Cancelled AMC — authoritative)
//   2. maintenance_contracts.current_status = 'Cancelled'   (legacy explicit status)
//   3. contracts.project_status            = 'Cancelled'   (linked via contract_ref)
//
// Status precedence for active alert workflow:
//   Cancelled  → excluded from Expiring / Expired / ≤7 / ≤15 / ≤30 / Renewal Status
//   Hold       → existing Hold rules (still visible in expiry monitoring)
//   Expired    → end_date < today
//   Expiring   → end_date within 30 days
//   Active     → otherwise
//
// Only CURRENT status is evaluated, so a contract that is reactivated
// (renewal activation sets renewal_status = 'Active Maintenance', or project
// status set back to Active) automatically re-enters monitoring. No dates or
// history are modified by this module — it is read-only classification.

const { get } = require('./db.js');

/**
 * SQL boolean fragment: TRUE when the maintenance_contracts row (alias `mc`)
 * is NOT cancelled from any authoritative source. Uses NOT EXISTS (not a JOIN)
 * so it can never duplicate rows.
 */
function mcNotCancelledSql(mc = 'mc') {
  return `(COALESCE(${mc}.renewal_status,'') <> 'Cancelled'
    AND COALESCE(${mc}.current_status,'') <> 'Cancelled'
    AND NOT EXISTS (SELECT 1 FROM contracts _cps
                    WHERE _cps.contract_ref = ${mc}.contract_ref
                      AND _cps.is_deleted = 0
                      AND _cps.project_status = 'Cancelled'))`;
}

/**
 * SQL boolean fragment for any table that only carries contract_ref
 * (e.g. amc_renewals). TRUE when the contract is NOT currently cancelled.
 */
function refNotCancelledSql(refCol = 'contract_ref') {
  return `(NOT EXISTS (SELECT 1 FROM maintenance_contracts _mcx
                       WHERE _mcx.contract_ref = ${refCol} AND _mcx.is_deleted = 0
                         AND (_mcx.renewal_status = 'Cancelled' OR _mcx.current_status = 'Cancelled'))
       AND NOT EXISTS (SELECT 1 FROM contracts _cpx
                       WHERE _cpx.contract_ref = ${refCol} AND _cpx.is_deleted = 0
                         AND _cpx.project_status = 'Cancelled'))`;
}

// ── CURRENT AMC PERIOD (2026-09-26, SH-130 fix) ─────────────────────────────
// The current operational AMC end date for a maintenance_contracts row is the
// LATEST end date among:
//   • mc.end_date (the maintenance record's own period), and
//   • every renewal that is Approved AND Activation = Active (not deleted).
// Selection is by effective period dates — never by created_at — so a later
// draft/rejected/pending renewal can never supersede a valid active AMC, and a
// historical period can never re-enter the active expiry queue once a later
// active renewal exists. Hold / Pending renewals do NOT extend the period
// (established workflow: only activation makes a renewal operational).

/** SQL expression: the current AMC end date (YYYY-MM-DD) for alias `mc`. */
// 2026-10-03 rule: a renewal becomes the current AMC period only when it is
// Approved + Activation Active + ledger Total Received > 0 (Partial counts).
const _PAID = a => `COALESCE((SELECT SUM(_pt.amount) FROM amc_payment_transactions _pt WHERE _pt.amc_renewal_id = ${a}.id), 0) > 0`;
function currentEndSql(mc = 'mc') {
  return `MAX(COALESCE(${mc}.end_date,''),
      COALESCE((SELECT MAX(_ar.new_end_date) FROM amc_renewals _ar
                WHERE _ar.contract_ref = ${mc}.contract_ref AND _ar.is_deleted = 0
                  AND _ar.renewal_status = 'Approved' AND _ar.amc_activation_status = 'Active' AND ${_PAID('_ar')}
                  AND _ar.new_end_date IS NOT NULL AND _ar.new_end_date <> ''), ''))`;
}

/** SQL expression: current AMC start date matching currentEndSql. */
function currentStartSql(mc = 'mc') {
  return `COALESCE((SELECT _as.new_start_date FROM amc_renewals _as
                WHERE _as.contract_ref = ${mc}.contract_ref AND _as.is_deleted = 0
                  AND _as.renewal_status = 'Approved' AND _as.amc_activation_status = 'Active' AND ${_PAID('_as')}
                  AND _as.new_end_date > COALESCE(${mc}.end_date,'')
                ORDER BY _as.new_end_date DESC, _as.id DESC LIMIT 1), ${mc}.start_date)`;
}

/**
 * SQL subquery returning the id of the renewal to DISPLAY for a contract:
 * the most recent renewal cycle that is not Cancelled / Rejected / Not Renewed,
 * ordered by effective start date (undated drafts count as newest), then id.
 */
function displayRenewalIdSql(mc = 'mc') {
  return `(SELECT _dr.id FROM amc_renewals _dr
           WHERE _dr.contract_ref = ${mc}.contract_ref AND _dr.is_deleted = 0
             AND _dr.renewal_status NOT IN ('Cancelled','Rejected','Not Renewed')
           ORDER BY (_dr.new_start_date IS NULL OR _dr.new_start_date = '') DESC,
                    _dr.new_start_date DESC, _dr.id DESC LIMIT 1)`;
}

/**
 * SQL boolean: a renewal is IN PROGRESS for the NEXT period — i.e. a
 * Pending / Under Review / Approved-but-not-yet-active (incl. Hold) renewal
 * exists whose period is undated or ends after the current AMC end date.
 * When true, "+ Add Renewal" must not be offered (duplicate prevention).
 */
function renewalInProgressSql(mc = 'mc') {
  return `EXISTS (SELECT 1 FROM amc_renewals _ip
           WHERE _ip.contract_ref = ${mc}.contract_ref AND _ip.is_deleted = 0
             AND ( _ip.renewal_status IN ('Pending','Under Review','Hold')
                OR (_ip.renewal_status = 'Approved' AND COALESCE(_ip.amc_activation_status,'') <> 'Active') )
             AND (_ip.new_end_date IS NULL OR _ip.new_end_date = '' OR _ip.new_end_date > ${currentEndSql(mc)}))`;
}

/** SQL boolean: an Approved + Active renewal exists for this contract. */
function hasActiveRenewalSql(mc = 'mc') {
  return `EXISTS (SELECT 1 FROM amc_renewals _ha WHERE _ha.contract_ref = ${mc}.contract_ref
           AND _ha.is_deleted = 0 AND _ha.renewal_status = 'Approved' AND _ha.amc_activation_status = 'Active')`;
}

/** JS helper: authoritative current AMC period for a Contract Ref. */
function getCurrentAMCPeriod(contractRef) {
  if (!contractRef) return null;
  const row = get(`SELECT mc.id, mc.contract_ref, mc.start_date AS record_start, mc.end_date AS record_end,
      ${currentStartSql('mc')} AS current_start_date, ${currentEndSql('mc')} AS current_end_date,
      ${mcNotCancelledSql('mc')} AS not_cancelled
    FROM maintenance_contracts mc WHERE mc.contract_ref = ? AND mc.is_deleted = 0 LIMIT 1`, [contractRef]);
  if (!row) return null;
  const cur = get(`SELECT * FROM amc_renewals _cr WHERE contract_ref=? AND is_deleted=0
      AND renewal_status='Approved' AND amc_activation_status='Active' AND ${_PAID('_cr')}
      ORDER BY new_end_date DESC, id DESC LIMIT 1`, [contractRef]);
  return {
    contract_ref: contractRef,
    current_start_date: row.current_start_date || null,
    current_end_date: row.current_end_date || null,
    source: cur && cur.new_end_date && cur.new_end_date >= (row.record_end || '') ? 'renewal' : 'maintenance_record',
    current_renewal_ref: cur ? cur.renewal_ref : null,
    is_cancelled: !row.not_cancelled,
  };
}

// ── AMC ATTENTION QUEUE (2026-09-29) ─────────────────────────────────────────
// Expiring Contracts is an ACTION-REQUIRED list. A (non-cancelled) maintenance
// contract appears only when at least one of these is true:
//   • Current AMC period has expired / expires within 30 days (current period =
//     currentEndSql, i.e. renewed Approved+Active period when one exists)
//   • The applicable renewal is not yet Approved (Pending / Under Review / Hold)
//   • Approved renewal whose activation is Hold, or not yet activated (Pending Decision)
//   • Approved renewal with NO payment received yet (ledger total = 0) —
//     "Initial Payment Not Received". A PARTIAL balance is NOT a reason
//     (2026-09-29 rule: Approved + Active + any payment > 0 = Active maintenance;
//     the balance is tracked as Outstanding AMC Payment Due instead)
//   • Data inconsistency: missing AMC value on an approved renewal, approved
//     renewal without an end date, or overlapping Approved+Active renewals
// A fully settled renewal (Approved + Active + ledger balance 0) whose current
// AMC ends more than 30 days from today is NOT shown; it re-enters automatically
// when its current period reaches the 30-day window. "No renewal" alone is never
// a reason while more than 30 days remain.
//
// Input: one enriched row from the expiring-contracts query. Pure function —
// the same evaluation is used for table rows, KPI cards and counts.
const EXPIRY_REASON = { 'expired': 'Expired', 'within-7': 'Expires ≤7 Days', 'within-15': 'Expires ≤15 Days', 'within-30': 'Expires ≤30 Days' };
function evaluateAMCActionRequired(r) {
  const reasons = [];
  let action = null;                                  // permitted action for the row
  const inWindow = r.alert_level && r.alert_level !== 'ok';
  if (inWindow) reasons.push(EXPIRY_REASON[r.alert_level]);

  // Payment — authoritative ledger
  const value = Number(r.renewal_value) || 0;
  const received = Math.round((Number(r.renewal_received) || 0) * 100) / 100;
  const balance = Math.round((value - received) * 100) / 100;
  let paymentStatus = null;
  if (r.renewal_ref) {
    if (['Later','Overdue','Hold'].includes(r.stored_payment_status) && balance > 0) paymentStatus = r.stored_payment_status;
    else if (value > 0 && received >= value) paymentStatus = 'Paid';
    else if (received > 0) paymentStatus = 'Partial';
    else paymentStatus = 'Unpaid';
  }

  const rs = r.renewal_status, act = r.amc_activation_status;
  if (r.renewal_ref && rs !== 'Approved') {
    reasons.push(act === 'Hold' ? 'Renewal On Hold' : 'Renewal Pending Approval');
    action = action || 'review';
  }
  if (r.renewal_ref && rs === 'Approved') {
    if (act === 'Hold') { reasons.push('Activation Hold'); action = action || 'activation'; }
    else if (act !== 'Active') { reasons.push('Activation Pending Decision'); action = action || 'activation'; }
    // 2026-09-29 RULE: Approved + Active + ANY payment received (> 0) = ACTIVE maintenance.
    // A remaining (partial) balance is a financial receivable ("Outstanding AMC Payment
    // Due" on the Maintenance Dashboard) — it is NOT an expiry/renewal attention reason.
    // Only "no payment received at all" keeps an approved renewal in this queue.
    if (value <= 0) { reasons.push('Data Review — AMC value missing'); action = action || 'review'; }
    else if (!(received > 0)) { reasons.push('Initial Payment Not Received'); action = action || 'payment'; }
    if (!r.renewal_end_date) { reasons.push('Data Review — renewal end date missing'); action = action || 'review'; }
  }
  if (Number(r.dup_active_renewals) > 1) { reasons.push('Data Review — overlapping active renewals'); action = action || 'review'; }

  // Add Renewal only when the CURRENT period is in the expiry window and no
  // renewal for the next period is already in progress.
  const canAdd = inWindow && Number(r.renewal_in_progress) !== 1;
  if (canAdd) action = 'add_renewal';

  return {
    actionRequired: reasons.length > 0,
    reasons, reason: reasons[0] || null,
    paymentStatus, amountReceived: received, balanceDue: r.renewal_ref ? Math.max(0, balance) : null,
    expiryBucket: inWindow ? r.alert_level : null,
    permittedAction: action, canAddRenewal: canAdd,
  };
}

/** JS helper: is this Contract Ref currently eligible for renewal/expiry alerts? */
function isEligibleForRenewalAlert(contractRef) {
  if (!contractRef) return false;
  const row = get(`SELECT ${refNotCancelledSql('?')} AS ok`, [contractRef, contractRef]);
  return !!(row && row.ok);
}

module.exports = {
  mcNotCancelledSql, refNotCancelledSql, isEligibleForRenewalAlert,
  currentEndSql, currentStartSql, displayRenewalIdSql, renewalInProgressSql, hasActiveRenewalSql,
  getCurrentAMCPeriod, evaluateAMCActionRequired,
};
