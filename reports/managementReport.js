'use strict';
// Monthly Management Report — UNIT-BASED (2026-09-29 redesign)
//
// Every operational metric is expressed in ELEVATOR UNITS. The ONLY monetary
// metric is Factory Payment, reported per currency (never summed across
// currencies, no invented exchange rates). The report is READ-ONLY.
//
// SOURCE-OF-TRUTH MAPPING (date field used for the month):
//   New Sales            contracts.approval_date            units = contracts.elevator_units
//   AMC Renewals         db/amcRenewals.js — completed (Approved + Active + paid) by first payment date
//                        month = approval_date → activation_date → new_start_date (effective)
//                        units = maintenance_contracts.total_elevator_units (by Contract Ref.)
//   Ordered              factory_ins_quotes.order_date      units = factory_ins_quotes.quantity
//   Production           NOT SUPPORTED — only current production_status exists (no dated milestone)
//   Shipping             NOT SUPPORTED — only current shipping_status / ETA exists (no dated milestone)
//   Delivered            contracts.delivery_date            units = contracts.elevator_units
//   Mech. Completed      contracts.mechanical_completion_date
//   Elec. Completed      contracts.electrical_completion_date
//   Handover             contracts.handover_date
//   Cancelled            contracts.cancellation_date
//   Maintenance Due      db/maintMetrics.js dueUnits        (authoritative monthly schedule engine)
//   Maintenance Completed db/maintMetrics.js completedUnits (actual units serviced, not visit rows)
//   Factory Payment      factory_payments.payment_date      SUM(paid_amount) per currency_code
//
// Legacy text milestones ("Delivered", "Completed") with no date are NEVER
// assigned to a month — they are counted in the data-quality section instead.
//
// TOTAL UNITS HANDLED (no double counting): the set of physical units with at
// least one qualifying activity in the month (sale, renewal, factory order,
// delivery, mech./elec. completion, handover, cancellation, maintenance service).
// Units are keyed by normalised Contract Ref.; the same Contract Ref. appearing
// in several stages counts ONCE, with the largest unit quantity seen for it.
// Factory orders without a Contract Ref. are keyed by their Factory Ref.
// "Maintenance Due" alone is workload, not activity, so it does not qualify.
// The annual figure is deduplicated across the whole year (not a sum of months).

const { all } = require('../db/db.js');
const { getMonthlyMaintenanceMetrics } = require('../db/maintMetrics.js');

const MONTH_LABELS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const UNIT = `COALESCE(NULLIF(c.elevator_units,0),1)`;
const normRef = r => String(r || '').trim().toUpperCase();

function contractFilterSql(f, p) {
  const w = [];
  if (f.salesperson) { w.push('c.sales_by = ?'); p.push(f.salesperson); }
  if (f.emirate)     { w.push('c.emirate = ?');  p.push(f.emirate); }
  return w.length ? ' AND ' + w.join(' AND ') : '';
}

// 2026-09-30: populations come from reports/metrics.js — the single source of truth
// shared with Monthly Sales, Delivery, Installation Completion, Handover, Factory
// Orders and Factory Payments reports (identical calculation everywhere).
const M = require('./metrics.js');
const ymPeriod = ym => ({ year: ym.slice(0, 4), month: parseInt(ym.slice(5, 7), 10) });
function contractMilestone(col, ym, f) { return M.contractMilestoneRows(col, ymPeriod(ym), { salesperson: f.salesperson, emirate: f.emirate }); }
function renewalRows(ym, f) { return M.renewalRows(ymPeriod(ym), { salesperson: f.salesperson, emirate: f.emirate }); }
function orderedRows(ym, f) { return M.factoryOrderRows(ymPeriod(ym), { salesperson: f.salesperson, emirate: f.emirate }); }
function paymentRows(ym) { return M.factoryPaymentRows(ymPeriod(ym)); }

const sumUnits = rows => rows.reduce((s, r) => s + (Number(r.units) || 0), 0);
function byCurrency(rows) {
  const out = {};
  for (const r of rows) out[r.currency] = Math.round(((out[r.currency] || 0) + (Number(r.amount) || 0)) * 100) / 100;
  return out;
}

/** All metrics + drill-down detail for one month. */
function monthData(year, month, f) {
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const d = {
    new_sales:  contractMilestone('approval_date', ym, f),
    renewals:   renewalRows(ym, f),
    ordered:    orderedRows(ym, f),
    delivered:  contractMilestone('delivery_date', ym, f),
    mechanical: contractMilestone('mechanical_completion_date', ym, f),
    electrical: contractMilestone('electrical_completion_date', ym, f),
    handover:   contractMilestone('handover_date', ym, f),
    cancelled:  contractMilestone('cancellation_date', ym, f),
    payments:   paymentRows(ym),
  };
  const mm = getMonthlyMaintenanceMetrics(year, month, { emirate: f.emirate });
  d.maintenance_completed = mm.rows.filter(r => r.completed_units > 0).map(r => ({
    contract_ref: r.contract_ref, client_name: r.client_name, emirate: r.emirate,
    visit_ref: r.visit_ref, completion_date: r.completion_date, status: r.status, units: r.completed_units,
  }));

  // Total Units Handled — unique physical units by Contract Ref. (max qty per key)
  const handled = new Map();
  const add = (key, units) => { if (!key) return; handled.set(key, Math.max(handled.get(key) || 0, Number(units) || 0)); };
  for (const k of ['new_sales','renewals','delivered','mechanical','electrical','handover','cancelled','maintenance_completed'])
    d[k].forEach(r => add(normRef(r.contract_ref), r.units));
  d.ordered.forEach(r => add(r.contract_ref ? normRef(r.contract_ref) : 'FACTORY:' + normRef(r.factory_ref), r.units));

  const metrics = {
    month: ym, month_label: `${MONTH_LABELS[month - 1]} ${year}`,
    new_sales: sumUnits(d.new_sales),
    amc_renewals: sumUnits(d.renewals),
    ordered: sumUnits(d.ordered),
    production: null,           // not supported — no dated production milestone
    shipping: null,             // not supported — no dated shipping milestone
    delivered: sumUnits(d.delivered),
    mechanical: sumUnits(d.mechanical),
    electrical: sumUnits(d.electrical),
    handover: sumUnits(d.handover),
    cancelled: sumUnits(d.cancelled),
    maint_due: mm.dueUnits,
    maint_completed: mm.completedUnits,
    maint_completion_pct: mm.completionPct,
    total_units_handled: [...handled.values()].reduce((s, v) => s + v, 0),
    factory_payment: byCurrency(d.payments),
    factory_payment_count: d.payments.length,
  };
  return { metrics, detail: d, handledKeys: handled };
}

function fmtMoney(obj) {
  const e = Object.entries(obj || {});
  if (!e.length) return '0.00';
  return e.map(([c, v]) => `${c} ${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(' + ');
}

function dataQuality(f) {
  const p = []; const fs = contractFilterSql(f, p);
  const q = all(`SELECT
      SUM(c.delivery_status = 'Delivered' AND (c.delivery_date IS NULL OR c.delivery_date = '')) AS delivered_no_date,
      SUM(c.mechanical_status = 'Completed' AND (c.mechanical_completion_date IS NULL OR c.mechanical_completion_date = '')) AS mech_no_date,
      SUM(c.electrical_status = 'Completed' AND (c.electrical_completion_date IS NULL OR c.electrical_completion_date = '')) AS elec_no_date,
      SUM(c.mechanical_status = 'Completed' AND c.electrical_status = 'Completed' AND (c.handover_date IS NULL OR c.handover_date = '')) AS completed_no_handover
    FROM contracts c WHERE c.is_deleted = 0 ${fs}`, p)[0] || {};
  const fo = all(`SELECT COUNT(*) n FROM factory_ins_quotes WHERE is_deleted = 0 AND (contract_ref IS NULL OR TRIM(contract_ref) = '')`)[0].n;
  const _perf = require('../db/amcRenewals.js').allRenewals({ emirate: f.emirate, salesperson: f.salesperson });
  const rn = { undated: _perf.filter(r => r.completed && !r.renewal_date).length, legacy: _perf.filter(r => r.completed && r.flags.some(x => x.startsWith('Legacy'))).length };
  return {
    'Delivered (legacy text) — no Delivery Date': q.delivered_no_date || 0,
    'Mechanical "Completed" — no completion date': q.mech_no_date || 0,
    'Electrical "Completed" — no completion date': q.elec_no_date || 0,
    'Mech. & Elec. Completed — no Handover Date': q.completed_no_handover || 0,
    'Factory orders without Contract Ref.': fo || 0,
    'Completed AMC renewals — Renewal Date Missing (no dated payment, excluded)': rn.undated || 0,
    'Completed AMC renewals — Legacy Data Review (units / Maintenance Record)': rn.legacy || 0,
  };
}

function currentStatusSnapshot(f) {
  const p = []; const fs = contractFilterSql(f, p);
  return all(`SELECT COALESCE(c.project_status,'Active') AS status, COUNT(*) AS contracts, SUM(${UNIT}) AS units
    FROM contracts c WHERE c.is_deleted = 0 ${fs} GROUP BY 1 ORDER BY 1`, p);
}

const TABLE_COLUMNS = ['Month','New Sales','AMC Renewals','Ordered','Production','Shipping','Delivered',
  'Mech. Completed','Elec. Completed','Handover','Cancelled','Maint. Due','Maint. Completed','Total Units Handled','Factory Payment'];

function tableRow(m) {
  return [m.month_label, m.new_sales, m.amc_renewals, m.ordered, 'N/A', 'N/A', m.delivered,
    m.mechanical, m.electrical, m.handover, m.cancelled, m.maint_due, m.maint_completed,
    m.total_units_handled, fmtMoney(m.factory_payment)];
}

/**
 * f: { year, month?, salesperson?, emirate?, detail? }
 * detail = metric key → returns that month's supporting records (drill-down).
 */
function buildMonthlyManagementReport(f) {
  const year = parseInt(f.year, 10) || new Date().getFullYear();
  const month = f.month ? parseInt(f.month, 10) : null;
  const filters = { salesperson: f.salesperson || '', emirate: f.emirate || '' };

  // Drill-down request
  if (f.detail && month) {
    const { metrics, detail } = monthData(year, month, filters);
    const key = { new_sales:'new_sales', amc_renewals:'renewals', ordered:'ordered', delivered:'delivered',
      mechanical:'mechanical', electrical:'electrical', handover:'handover', cancelled:'cancelled',
      maint_completed:'maintenance_completed', factory_payment:'payments' }[f.detail];
    if (!key) throw new Error(`Unknown drill-down metric: ${f.detail}`);
    return { report_type: 'monthly-management-detail', metric: f.detail, month: metrics.month,
      month_label: metrics.month_label, kpi_value: metrics[f.detail], rows: detail[key],
      total: detail[key].length, units: key === 'payments' ? null : sumUnits(detail[key]),
      amount_by_currency: key === 'payments' ? byCurrency(detail[key]) : null };
  }

  const months = month ? [month] : Array.from({ length: 12 }, (_, i) => i + 1);
  const perMonth = months.map(m => monthData(year, m, filters));
  const monthly = perMonth.map(x => x.metrics);

  // Annual totals (unique units handled deduplicated across the whole period)
  const annualKeys = new Map();
  perMonth.forEach(x => x.handledKeys.forEach((u, k) => annualKeys.set(k, Math.max(annualKeys.get(k) || 0, u))));
  const sum = k => monthly.reduce((s, m) => s + (m[k] || 0), 0);
  const payAll = {};
  monthly.forEach(m => Object.entries(m.factory_payment).forEach(([c, v]) => { payAll[c] = Math.round(((payAll[c] || 0) + v) * 100) / 100; }));
  const dueAll = sum('maint_due'), compAll = sum('maint_completed');
  const totals = {
    month_label: month ? monthly[0].month_label : `Annual Total ${year}`,
    new_sales: sum('new_sales'), amc_renewals: sum('amc_renewals'), ordered: sum('ordered'),
    production: null, shipping: null,
    delivered: sum('delivered'), mechanical: sum('mechanical'), electrical: sum('electrical'),
    handover: sum('handover'), cancelled: sum('cancelled'),
    maint_due: dueAll, maint_completed: compAll,
    maint_completion_pct: dueAll > 0 ? Math.min(100, Math.round(compAll / dueAll * 1000) / 10) : 0,
    total_units_handled_sum_of_months: sum('total_units_handled'),
    total_units_handled: [...annualKeys.values()].reduce((s, v) => s + v, 0),   // unique across period
    factory_payment: payAll,
    factory_payment_count: sum('factory_payment_count'),
  };

  const rows = monthly.map(tableRow);
  if (!month) rows.push([`ANNUAL TOTAL ${year}`, totals.new_sales, totals.amc_renewals, totals.ordered, 'N/A', 'N/A',
    totals.delivered, totals.mechanical, totals.electrical, totals.handover, totals.cancelled,
    totals.maint_due, totals.maint_completed, `${totals.total_units_handled} (unique)`, fmtMoney(totals.factory_payment)]);

  const k = month ? monthly[0] : totals;
  return {
    report_type: 'monthly-management',
    title: month ? `Monthly Management Report — ${monthly[0].month_label}` : `Monthly Management Report — ${year}`,
    year, month, filters,
    columns: TABLE_COLUMNS,
    rows, total: rows.length, page: 1, pageSize: rows.length,
    monthly, totals,
    kpis: {
      new_sales: k.new_sales, amc_renewals: k.amc_renewals, ordered: k.ordered, delivered: k.delivered,
      handover: k.handover, maint_completed: k.maint_completed, maint_due: k.maint_due,
      maint_completion_pct: k.maint_completion_pct, total_units_handled: k.total_units_handled,
      factory_payment: k.factory_payment,
    },
    current_status: currentStatusSnapshot(filters),
    data_quality: dataQuality(filters),
    unsupported: {
      production: 'No dated production milestone is recorded (only the current Production Status). Past months cannot be reconstructed without inventing dates.',
      shipping: 'No dated shipping milestone is recorded (only current Shipping Status / ETA).',
    },
    summary: {
      // Unit-based summary (also used by the Reports home "Current Month Overview")
      new_sales_units: k.new_sales, amc_renewal_units: k.amc_renewals, ordered_units: k.ordered,
      delivered_units: k.delivered, handover_units: k.handover,
      maintenance_completed_units: k.maint_completed, maintenance_due_units: k.maint_due,
      completion_pct: k.maint_completion_pct, total_units_handled: k.total_units_handled,
      factory_payment: fmtMoney(k.factory_payment),
    },
  };
}

module.exports = { buildMonthlyManagementReport, MONTH_LABELS };
