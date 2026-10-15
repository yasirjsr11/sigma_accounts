'use strict';
// ══════════════════════════════════════════════════════════════════════════════
// AMC COLLECTIONS — single authoritative calculation (2026-10-07)
//
//   Monthly AMC Collection = SUM(amount) of unique, valid AMC payment ledger
//   transactions, grouped by their actual payment_date.
//
//   Valid transaction
//     • row in amc_payment_transactions (voided payments are moved out of this table
//       into amc_payment_voids by db/amcPayments.js voidPayment → never counted; their
//       audit history stays in amc_payment_voids + renewal_audit_log)
//     • its renewal exists and is NOT soft-deleted (amc_renewals.is_deleted = 0).
//       A soft-deleted renewal is a removed/duplicate record — its ledger rows are kept
//       for audit but are not cash collections.
//     • the renewal's current status does NOT matter: payments on renewals that were
//       later Cancelled, Renewed, Expired or put on Hold remain historical receipts.
//   Month = substr(payment_date,1,7) of the stored DATE-ONLY string — no Date()/UTC
//   conversion anywhere, so no timezone month shift.
//   Money = summed in integer fils (ROUND(amount*100)) then /100 → exact 2 decimals.
//   No payment_date → never moved into a month (no fallback to created_at / approval
//   date); reported separately as "Payment Date Missing".
//
//   Filters that apply to collections: emirate, maintenance_type (Maintenance Record, else renewal).
//   Payment Status / Renewal Status / search are portfolio filters and do NOT hide
//   historical receipts.
//
//   Consumers: Maintenance Dashboard (AMC Collections chart, period received KPI,
//   drill-downs, print) and Reports & Analytics → AMC Payments (chart, month-wise
//   table, month drill-down, exports).
// ══════════════════════════════════════════════════════════════════════════════
const { all, get } = require('./db.js');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ISO_GLOB = `'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'`;
const DATE_OK = `(t.payment_date GLOB ${ISO_GLOB})`;
const DATE_MISSING = `(t.payment_date IS NULL OR NOT (t.payment_date GLOB ${ISO_GLOB}))`;
const FROM_VALID = `FROM amc_payment_transactions t JOIN amc_renewals r ON r.id = t.amc_renewal_id AND r.is_deleted = 0`;
const fils = v => Math.round(Number(v || 0) * 100);
const aed = f => Math.round(Number(f || 0)) / 100;

// Emirate / maintenance type of a payment: the Maintenance Record (canonical master; one
// record per Contract Ref.) — falling back to the renewal's own copy. Many renewal rows
// carry no emirate / type, so filtering on the renewal alone silently drops receipts.
const _mcCol = c => `(SELECT NULLIF(TRIM(_mc.${c}),'') FROM maintenance_contracts _mc WHERE _mc.contract_ref = r.contract_ref AND _mc.is_deleted = 0 ORDER BY _mc.id LIMIT 1)`;
const EMIRATE_SQL = `COALESCE(${_mcCol('emirate')}, NULLIF(TRIM(r.emirate),''))`;
const TYPE_SQL = `COALESCE(${_mcCol('maintenance_type')}, NULLIF(TRIM(r.maintenance_type),''))`;

function _filters(f = {}) {
  const w = [], p = [];
  if (f.emirate) { w.push(`${EMIRATE_SQL} = TRIM(?)`); p.push(String(f.emirate)); }
  if (f.maintenance_type) { w.push(`${TYPE_SQL} = ?`); p.push(String(f.maintenance_type)); }
  return { w, p };
}
const _and = w => (w.length ? ' AND ' + w.join(' AND ') : '');

const TX_COLS = `t.id AS tx_id, t.amc_renewal_id, t.payment_ref, substr(t.payment_date,1,10) AS payment_date,
  ROUND(t.amount,2) AS amount, ROUND(t.amount*100) AS amount_fils, t.payment_method, t.invoice_ref, t.notes AS remarks,
  t.entered_by, t.created_at, t.updated_by, t.updated_at,
  r.renewal_ref, r.contract_ref, r.client_name, ${EMIRATE_SQL} AS emirate, ${TYPE_SQL} AS maintenance_type,
  r.new_start_date, r.new_end_date, r.new_amc_value, r.renewal_status, r.amc_activation_status, r.payment_status`;

/**
 * getAmcCollections(year, filters) → {
 *   year, months:[{ month, label, payment_count, received_amount }] (always 12),
 *   total:{ payment_count, received_amount },
 *   missing_date:{ payment_count, received_amount },          // valid but undated (all years)
 *   excluded_deleted_renewal:{ payment_count, received_amount } // ledger rows on soft-deleted renewals in the year (audit info)
 * }
 */
function getAmcCollections(year, filters = {}) {
  const y = String(parseInt(year, 10) || new Date().getFullYear());
  const { w, p } = _filters(filters);
  const rows = all(`SELECT CAST(substr(t.payment_date,6,2) AS INTEGER) AS mo, COUNT(*) AS n, SUM(ROUND(t.amount*100)) AS f
    ${FROM_VALID} WHERE ${DATE_OK} AND substr(t.payment_date,1,4) = ?${_and(w)} GROUP BY mo`, [y, ...p]);
  const by = Object.fromEntries(rows.map(r => [r.mo, r]));
  const months = MONTHS.map((label, i) => ({ month: i + 1, label, payment_count: by[i + 1] ? by[i + 1].n : 0, received_amount: aed(by[i + 1] ? by[i + 1].f : 0) }));
  const totF = rows.reduce((s, r) => s + Number(r.f || 0), 0);
  const miss = get(`SELECT COUNT(*) n, COALESCE(SUM(ROUND(t.amount*100)),0) f ${FROM_VALID} WHERE ${DATE_MISSING}${_and(w)}`, p);
  const del = get(`SELECT COUNT(*) n, COALESCE(SUM(ROUND(t.amount*100)),0) f FROM amc_payment_transactions t
    JOIN amc_renewals r ON r.id = t.amc_renewal_id AND r.is_deleted = 1 WHERE substr(t.payment_date,1,4) = ?${_and(w)}`, [y, ...p]);
  return {
    year: Number(y), months,
    total: { payment_count: rows.reduce((s, r) => s + r.n, 0), received_amount: aed(totF) },
    missing_date: { payment_count: miss.n, received_amount: aed(miss.f) },
    excluded_deleted_renewal: { payment_count: del.n, received_amount: aed(del.f) },
    basis: 'AMC payment ledger — valid transactions by actual Payment Date',
    filters_applied: { emirate: filters.emirate || null, maintenance_type: filters.maintenance_type || null },
  };
}

/** Valid transactions of a year (month = null) or of one month — the drill-down for getAmcCollections. */
function getAmcCollectionTransactions(year, month = null, filters = {}) {
  const y = String(parseInt(year, 10) || new Date().getFullYear());
  const { w, p } = _filters(filters);
  const mm = month ? String(parseInt(month, 10)).padStart(2, '0') : null;
  const rows = all(`SELECT ${TX_COLS} ${FROM_VALID} WHERE ${DATE_OK} AND substr(t.payment_date,1,4) = ?
    ${mm ? 'AND substr(t.payment_date,6,2) = ?' : ''}${_and(w)} ORDER BY t.payment_date, t.id`, mm ? [y, mm, ...p] : [y, ...p]);
  return { rows, payment_count: rows.length, received_amount: aed(rows.reduce((s, r) => s + Number(r.amount_fils || 0), 0)) };
}

/** Valid transactions without a usable payment date — flagged "Payment Date Missing", never assigned to a month. */
function getAmcMissingDateTransactions(filters = {}) {
  const { w, p } = _filters(filters);
  const rows = all(`SELECT ${TX_COLS},
      (SELECT ROUND(SUM(x.amount),2) FROM amc_payment_transactions x WHERE x.amc_renewal_id = t.amc_renewal_id) AS renewal_total_received
    ${FROM_VALID} WHERE ${DATE_MISSING}${_and(w)} ORDER BY r.contract_ref, t.id`, p)
    .map(r => ({ ...r, flag: 'Payment Date Missing' }));
  return { rows, payment_count: rows.length, received_amount: aed(rows.reduce((s, r) => s + Number(r.amount_fils || 0), 0)) };
}

/** Ledger rows that are NOT collections because their renewal is soft-deleted (audit / dry-run listing only). */
function getExcludedDeletedRenewalTransactions(year = null) {
  return all(`SELECT t.id AS tx_id, t.payment_ref, t.payment_date, ROUND(t.amount,2) amount, r.renewal_ref, r.contract_ref, r.updated_at AS renewal_deleted_at
    FROM amc_payment_transactions t JOIN amc_renewals r ON r.id = t.amc_renewal_id AND r.is_deleted = 1
    ${year ? 'WHERE substr(t.payment_date,1,4) = ?' : ''} ORDER BY t.payment_date, t.id`, year ? [String(year)] : []);
}

module.exports = { getAmcCollections, getAmcCollectionTransactions, getAmcMissingDateTransactions, getExcludedDeletedRenewalTransactions, MONTHS };
