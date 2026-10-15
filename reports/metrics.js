'use strict';
// ══════════════════════════════════════════════════════════════════════════════
// reports/metrics.js — ONE SOURCE OF TRUTH per reporting metric (2026-09-30)
//
// Every report (Monthly Management, Monthly Sales, Delivery, Installation
// Completion, Handover, Factory Orders, AMC Portfolio, Factory Payments …) reads
// its population from these functions, so the same business metric can never be
// calculated two different ways.
//
//   Sales Units            contracts.approval_date                 × elevator units
//   Delivery Units         contracts.delivery_date                 × elevator units
//   Mechanical Completion  contracts.mechanical_completion_date    × elevator units
//   Electrical Completion  contracts.electrical_completion_date    × elevator units
//   Handover Units         contracts.handover_date                 × elevator units
//   Cancelled Units        contracts.cancellation_date             × elevator units
//   Factory Ordered Units  factory_ins_quotes.order_date           × quantity
//   AMC Renewal Units      amc_renewals Approved — approval → activation → effective start date
//   Factory Payments       factory_payments.payment_date           SUM(paid_amount) per currency
//   Maintenance units      db/maintMetrics.js (schedule engine)    — not duplicated here
//
// Units = COALESCE(NULLIF(elevator_units,0),1) — one row per Contract record, so
// grouped refs count their real unit total and no join can multiply rows.
// Only genuine ISO milestone dates are used; legacy status text without a date is
// never assigned to a month (reported as data quality instead). created_at /
// updated_at are never used as business dates.
// ══════════════════════════════════════════════════════════════════════════════
const { all } = require('../db/db.js');

const UNIT = `COALESCE(NULLIF(c.elevator_units,0),1)`;
const ISO = col => `${col} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'`;
const MILESTONE_COLS = new Set(['approval_date', 'delivery_date', 'mechanical_completion_date',
  'electrical_completion_date', 'handover_date', 'cancellation_date']);

/** Period helper: { year, month } → SQL fragment on a date column. month null = whole year. */
function periodSql(col, period, p) {
  const w = [ISO(col)];
  if (period && period.year) {
    if (period.month) { w.push(`substr(${col},1,7) = ?`); p.push(`${period.year}-${String(period.month).padStart(2, '0')}`); }
    else { w.push(`substr(${col},1,4) = ?`); p.push(String(period.year)); }
  }
  return w;
}

/** Contract dimension filters shared by every contract-based report. */
function contractFilterSql(f, p, alias = 'c') {
  const w = [];
  if (f.salesperson)    { w.push(`${alias}.sales_by = ?`); p.push(f.salesperson); }
  if (f.emirate)        { w.push(`TRIM(${alias}.emirate) = ?`); p.push(String(f.emirate).trim()); }
  if (f.project_status) { w.push(`COALESCE(${alias}.project_status,'Active') = ?`); p.push(f.project_status); }
  if (f.search) {
    w.push(`(${alias}.contract_ref LIKE ? OR ${alias}.client_name LIKE ? OR COALESCE(${alias}.project_description,'') LIKE ?)`);
    p.push(`%${f.search}%`, `%${f.search}%`, `%${f.search}%`);
  }
  return w;
}

// 2026-10-10: authoritative Contract ↔ Factory relationship (db/factoryLinks.js)
const FACTORY_REF_SQL = require('../db/factoryLinks.js').FACTORY_REFS_SQL('c');
const MAINT_LINK_SQL = `(SELECT mc.maintenance_id FROM maintenance_contracts mc WHERE mc.is_deleted = 0 AND mc.contract_ref = c.contract_ref ORDER BY mc.id LIMIT 1)`;

/**
 * Contract records whose milestone `col` falls in the period.
 * period: { year, month|null } ; f: { salesperson, emirate, project_status, search }
 */
function contractMilestoneRows(col, period, f = {}) {
  if (!MILESTONE_COLS.has(col)) throw new Error(`Unsupported milestone column ${col}`);
  const p = [];
  const w = ['c.is_deleted = 0', ...periodSql(`c.${col}`, period, p), ...contractFilterSql(f, p)];
  return all(`SELECT c.id, c.contract_ref, c.quote_ref, c.client_name, c.project_description, c.emirate, c.sales_by,
      COALESCE(c.project_status,'Active') AS project_status, c.contract_value, COALESCE(c.currency_code,'AED') AS currency_code,
      c.approval_date, c.delivery_date, c.delivery_status, c.mechanical_completion_date, c.mechanical_status,
      c.electrical_completion_date, c.electrical_status, c.handover_date, c.cancellation_date, c.cancellation_type,
      substr(c.${col},1,10) AS milestone_date, ${UNIT} AS units,
      ${FACTORY_REF_SQL} AS factory_ref, ${MAINT_LINK_SQL} AS maintenance_id
    FROM contracts c WHERE ${w.join(' AND ')}
    ORDER BY c.${col}, c.contract_ref`, p);
}

/** Contracts with a legacy completed/delivered status text but NO milestone date (data quality). */
function contractMissingDateRows(col, statusCol, statusVal, f = {}) {
  const p = [];
  const w = ['c.is_deleted = 0', `(c.${col} IS NULL OR TRIM(c.${col}) = '')`, `c.${statusCol} = ?`, "COALESCE(c.project_status,'Active') <> 'Cancelled'"];
  p.push(statusVal);
  w.push(...contractFilterSql({ ...f, search: '' }, p));
  return all(`SELECT c.contract_ref, c.client_name, c.emirate, c.sales_by, ${UNIT} AS units,
      c.approval_date, COALESCE(c.project_status,'Active') AS project_status
    FROM contracts c WHERE ${w.join(' AND ')} ORDER BY c.contract_ref`, p);
}

/** Factory (SL Fuji New Orders) rows ordered in the period — units = quantity. */
function factoryOrderRows(period, f = {}) {
  const p = [];
  const w = ['f.is_deleted = 0', ...periodSql('f.order_date', period, p)];
  if (f.salesperson || f.emirate) {
    const sub = [];
    if (f.salesperson) { sub.push('c2.sales_by = ?'); p.push(f.salesperson); }
    if (f.emirate)     { sub.push('TRIM(c2.emirate) = ?'); p.push(String(f.emirate).trim()); }
    w.push(`EXISTS (SELECT 1 FROM contracts c2 WHERE c2.is_deleted = 0
             AND UPPER(TRIM(c2.contract_ref)) = UPPER(TRIM(f.contract_ref)) AND ${sub.join(' AND ')})`);
  }
  return all(`SELECT f.id, f.factory_ref, f.contract_ref, f.supplier_name, f.client_name, f.order_date,
      COALESCE(f.quantity,0) AS units, f.production_status, f.shipping_status, f.factory_delivery_status
    FROM factory_ins_quotes f WHERE ${w.join(' AND ')}
    ORDER BY f.order_date, f.factory_ref`, p);
}

/** Completed AMC renewals in the period — delegates to the ONE renewal service
 *  (db/amcRenewals.js): Approved + Active + payment received, month = first payment date,
 *  units = Maintenance Record units. (2026-10-07; previously approval → activation →
 *  effective start date, which put back-entered renewals in the wrong month.) */
function renewalRows(period, f = {}) {
  const AR = require('../db/amcRenewals.js');
  const y = period && period.year ? period.year : new Date().getFullYear();
  return AR.getRenewalMonthDetails(y, period && period.month ? period.month : null,
    { emirate: f.emirate, maintenance_type: f.maintenance_type, salesperson: f.salesperson, payment_status: f.payment_status, search: f.search })
    .rows.map(r => ({ id: r.id, renewal_ref: r.renewal_ref, contract_ref: r.contract_ref, client_name: r.client_name,
      new_start_date: r.new_start_date, new_end_date: r.new_end_date, renewal_status: r.renewal_status, amc_activation_status: r.amc_activation_status,
      new_amc_value: r.new_amc_value, currency_code: 'AED', report_date: r.renewal_date, date_basis: r.date_basis, units: r.units,
      mc_id: r.mc_id, emirate: r.emirate, maintenance_type: r.maintenance_type, payment_status: r.payment_status, received: r.received }));
}

/** Factory payment transactions in the period (per currency — never summed across currencies). */
function factoryPaymentRows(period, f = {}) {
  const p = [];
  const w = ['fp.is_deleted = 0', ...periodSql('fp.payment_date', period, p)];
  if (f.factory_table) { w.push('fp.factory_table = ?'); p.push(f.factory_table); }
  if (f.payment_type)  { w.push('fp.payment_type = ?');  p.push(f.payment_type); }
  if (f.supplier)      { w.push('fp.supplier_name LIKE ?'); p.push(`%${f.supplier}%`); }
  if (f.search) {
    w.push(`(fp.factory_ref LIKE ? OR fp.supplier_name LIKE ? OR COALESCE(fp.our_ref,'') LIKE ? OR fp.payment_ref LIKE ? OR COALESCE(fp.project_client_name,'') LIKE ?)`);
    p.push(`%${f.search}%`, `%${f.search}%`, `%${f.search}%`, `%${f.search}%`, `%${f.search}%`);
  }
  return all(`SELECT fp.id, fp.payment_ref, substr(fp.payment_date,1,10) AS payment_date, fp.factory_ref, fp.factory_table,
      fp.our_ref AS contract_ref, fp.supplier_name, fp.supplier_id, fp.project_client_name AS client_name, fp.payment_type, fp.payment_mode,
      COALESCE(fp.paid_amount,0) AS amount, COALESCE(NULLIF(fp.currency_code,''),'USD') AS currency, fp.remarks
    FROM factory_payments fp WHERE ${w.join(' AND ')}
    ORDER BY fp.payment_date, fp.payment_ref`, p);
}

const sumUnits = rows => rows.reduce((s, r) => s + (Number(r.units) || 0), 0);
function byCurrency(rows, amountKey = 'amount', curKey = 'currency') {
  const out = {};
  for (const r of rows) out[r[curKey]] = Math.round(((out[r[curKey]] || 0) + (Number(r[amountKey]) || 0)) * 100) / 100;
  return out;
}

module.exports = {
  UNIT, ISO, periodSql, contractFilterSql, FACTORY_REF_SQL, MAINT_LINK_SQL,
  contractMilestoneRows, contractMissingDateRows, factoryOrderRows, renewalRows, factoryPaymentRows,
  sumUnits, byCurrency,
};
