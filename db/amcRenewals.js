'use strict';
// ══════════════════════════════════════════════════════════════════════════════
// AMC RENEWAL PERFORMANCE — single authoritative definition (2026-10-07)
//
//   Source: amc_renewals (renewal history — NOT the Alerts → Renewal Status action
//   queue, which drops renewals once they are completed) + amc_payment_transactions.
//
//   Completed renewal — the renewal became the CURRENT AMC period under the approved
//   operational rule (db/renewalSync.js):  Approved  +  Activation Active  +  received > 0.
//     • soft-deleted renewals (duplicates / removed records) are excluded
//     • a renewal that completed and was LATER cancelled stays in history when its
//       approval & activation dates were recorded (it did become current)
//
//   Renewal Date (month of the renewal) — the FIRST VALID PAYMENT DATE of a completed
//   renewal: the payment is the event that turns an approved, activated renewal into the
//   current AMC (the established Maintenance Dashboard rule). approval_date /
//   activation_date are NOT used for the month: 44 of 58 approved renewals have no
//   approval date and many activation dates are the day the record was back-entered
//   into SH PMS (e.g. SH-020-R02 paid 21-Aug, keyed in / activated 09-Sep).
//   Never substituted by created_at / updated_at / AMC start. A completed renewal with
//   no dated payment has no Renewal Date: flagged "Renewal Date Missing".
//
//   Units  — maintenance_contracts.total_elevator_units of the renewal's Contract Ref.
//            (amc_renewals has no unit snapshot). One row per renewal → payments never
//            multiply units. Missing record / 0 units → flagged "Legacy Data Review",
//            counted as 0 units (not invented).
//   Projects — DISTINCT Contract Ref. (maintenance project) renewed in the period.
//
//   Pending (not completed): Pending / Under Review / Hold, or Approved but not yet
//   Active, or Approved + Active with no payment yet ("Awaiting initial payment").
//
//   Consumers: Reports → AMC Portfolio & Renewal, Maintenance Dashboard → Renewal
//   Performance (+ month drill-down), Monthly Management Report (AMC Renewals).
// ══════════════════════════════════════════════════════════════════════════════
const { all } = require('./db.js');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const GLOB = `'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'`;
const isoOrNull = c => `CASE WHEN ${c} GLOB ${GLOB} THEN substr(${c},1,10) END`;

// One row per (non-deleted) renewal with ledger aggregates — payments aggregated FIRST.
const BASE_SQL = `
  WITH led AS (
    SELECT amc_renewal_id AS rid, COUNT(*) AS payment_count, ROUND(SUM(amount),2) AS received,
      MIN(${isoOrNull('payment_date')}) AS first_payment_date, MAX(${isoOrNull('payment_date')}) AS latest_payment_date
    FROM amc_payment_transactions GROUP BY amc_renewal_id
  ),
  mc1 AS (
    SELECT contract_ref, MIN(id) AS mc_id, COUNT(*) AS mc_count FROM maintenance_contracts WHERE is_deleted = 0 GROUP BY contract_ref
  ),
  base AS (
    SELECT r.id, r.renewal_ref, r.contract_ref, r.client_name, r.renewal_status, r.amc_activation_status,
      r.prev_start_date, r.prev_end_date, r.new_start_date, r.new_end_date, ROUND(COALESCE(r.new_amc_value,0),2) AS new_amc_value,
      ${isoOrNull('r.approval_date')} AS approval_date, ${isoOrNull('r.activation_date')} AS activation_date,
      COALESCE(l.payment_count,0) AS payment_count, COALESCE(l.received,0) AS received,
      l.first_payment_date, l.latest_payment_date,
      mc.id AS mc_id, mc.maintenance_id, m1.mc_count,
      CASE WHEN COALESCE(mc.total_elevator_units,0) > 0 THEN mc.total_elevator_units END AS units_raw,
      COALESCE(NULLIF(TRIM(mc.emirate),''), NULLIF(TRIM(r.emirate),'')) AS emirate,
      COALESCE(NULLIF(TRIM(mc.maintenance_type),''), NULLIF(TRIM(r.maintenance_type),'')) AS maintenance_type,
      (r.renewal_status = 'Approved' AND r.amc_activation_status = 'Active') AS is_current_rule,
      (r.renewal_status IN ('Cancelled','Not Renewed') AND ${isoOrNull('r.approval_date')} IS NOT NULL AND ${isoOrNull('r.activation_date')} IS NOT NULL) AS cancelled_after
    FROM amc_renewals r
    LEFT JOIN led l ON l.rid = r.id
    LEFT JOIN mc1 m1 ON m1.contract_ref = r.contract_ref
    LEFT JOIN maintenance_contracts mc ON mc.id = m1.mc_id
    WHERE r.is_deleted = 0
  )`;

function _qualDate(r) {
  return r.first_payment_date ? { date: r.first_payment_date, basis: 'First Payment Date' } : { date: null, basis: null };
}
const _payStatus = r => r.received <= 0 ? 'Unpaid' : (r.new_amc_value > 0 && r.received >= r.new_amc_value - 0.005) ? 'Paid' : 'Partial';

function _pendingReason(r) {
  if (['Cancelled', 'Rejected', 'Not Renewed'].includes(r.renewal_status)) return null;           // not pending — cancelled
  if (r.renewal_status !== 'Approved') return r.renewal_status === 'Hold' ? 'Renewal On Hold' : `Renewal ${r.renewal_status}`;
  if (r.amc_activation_status !== 'Active') return `Activation ${r.amc_activation_status || 'Pending'}`;
  if (!(r.received > 0)) return 'Awaiting initial payment';
  return null;
}

/** Every non-deleted renewal, classified. filters: { emirate, maintenance_type, payment_status, search, salesperson } */
function allRenewals(filters = {}) {
  const f = filters || {};
  const rows = all(`${BASE_SQL} SELECT * FROM base ORDER BY contract_ref, id`).map(r => {
    const completed = r.received > 0 && (r.is_current_rule === 1 || r.cancelled_after === 1);
    const q = completed ? _qualDate(r) : { date: null, basis: null };
    const flags = [];
    if (completed && !q.date) flags.push('Renewal Date Missing');
    if (completed && !r.units_raw) flags.push('Legacy Data Review — no unit quantity / Maintenance Record');
    if (completed && r.mc_count > 1) flags.push(`Legacy Data Review — ${r.mc_count} Maintenance Records share this Contract Ref.`);
    return { ...r, completed, renewal_date: q.date, date_basis: q.basis, units: r.units_raw || 0,
      payment_status: _payStatus(r), outstanding: Math.max(0, Math.round((r.new_amc_value - r.received) * 100) / 100),
      pending_reason: completed ? null : _pendingReason(r), cancelled_after_renewal: completed && r.cancelled_after === 1, flags };
  });
  let out = rows;
  if (f.emirate) out = out.filter(r => (r.emirate || '') === String(f.emirate).trim());
  if (f.maintenance_type) out = out.filter(r => r.maintenance_type === f.maintenance_type);
  if (f.payment_status) out = out.filter(r => r.payment_status === f.payment_status);
  if (f.search) { const s = String(f.search).toLowerCase(); out = out.filter(r => [r.renewal_ref, r.contract_ref, r.client_name, r.maintenance_id].some(v => String(v || '').toLowerCase().includes(s))); }
  if (f.salesperson) {
    const refs = new Set(all('SELECT UPPER(TRIM(contract_ref)) ref FROM contracts WHERE is_deleted = 0 AND sales_by = ?', [f.salesperson]).map(x => x.ref));
    out = out.filter(r => refs.has(String(r.contract_ref || '').trim().toUpperCase()));
  }
  return out;
}

const _sumUnits = rows => rows.reduce((s, r) => s + (Number(r.units) || 0), 0);
const _projects = rows => new Set(rows.map(r => String(r.contract_ref || '').trim().toUpperCase())).size;

/** Completed renewals whose Renewal Date falls in year (and month, when given). */
function getRenewalMonthDetails(year, month = null, filters = {}) {
  const ym = month ? `${year}-${String(parseInt(month, 10)).padStart(2, '0')}` : String(year);
  const rows = allRenewals(filters).filter(r => r.completed && r.renewal_date && r.renewal_date.startsWith(ym))
    .sort((a, b) => (a.renewal_date < b.renewal_date ? -1 : a.renewal_date > b.renewal_date ? 1 : a.id - b.id));
  return { year: Number(year), month: month ? Number(month) : null, rows, renewals: rows.length, projects: _projects(rows), units: _sumUnits(rows) };
}

/** Jan–Dec renewal performance (always 12 months) + pending / data-quality lists. */
function getRenewalPerformance(year, filters = {}) {
  const y = String(parseInt(year, 10) || new Date().getFullYear());
  const rs = allRenewals(filters);
  const done = rs.filter(r => r.completed && r.renewal_date && r.renewal_date.startsWith(y));
  const months = MONTHS.map((label, i) => {
    const mr = done.filter(r => r.renewal_date.slice(5, 7) === String(i + 1).padStart(2, '0'));
    return { month: i + 1, label, renewals: mr.length, projects: _projects(mr), units: _sumUnits(mr), amc_value: Math.round(mr.reduce((s, r) => s + r.new_amc_value, 0) * 100) / 100 };
  });
  return {
    year: Number(y), months,
    total: { renewals: done.length, projects: _projects(done), units: _sumUnits(done) },
    pending: rs.filter(r => r.pending_reason),
    undated: rs.filter(r => r.completed && !r.renewal_date),
    legacy_review: rs.filter(r => r.completed && r.flags.some(x => x.startsWith('Legacy'))),
    cancelled: rs.filter(r => ['Cancelled', 'Rejected', 'Not Renewed'].includes(r.renewal_status) && !r.completed),
    rule: 'Completed renewal = Approved + Activation Active + payment received > 0; Renewal Date = first valid payment date',
  };
}

module.exports = { allRenewals, getRenewalPerformance, getRenewalMonthDetails, MONTHS };
