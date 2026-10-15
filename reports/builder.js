'use strict';
// reports/builder.js — rewritten 2026-07-02
// Primary rule: Reports Module no longer queries the quotations table.
// Data sources: contracts, client_payments, maintenance_contracts, factory tables (sea_costs/otj_quotes/ins_quotes), alert_payments (metadata only).

const { getMonthlyMaintenanceMetrics } = require('../db/maintMetrics.js');
const { all, get } = require('../db/db.js');

// ── Shared Helpers ────────────────────────────────────────────────────────────

function addDateFilter(where, params, f, field) {
  if (f.year && f.month) {
    where.push(`${field} LIKE ?`);
    params.push(`${f.year}-${String(parseInt(f.month)).padStart(2, '0')}%`);
  } else if (f.year) {
    where.push(`${field} LIKE ?`);
    params.push(`${f.year}%`);
  }
  if (f.date_from) { where.push(`${field} >= ?`); params.push(f.date_from); }
  if (f.date_to) { where.push(`${field} <= ?`); params.push(f.date_to); }
}

function paginateRows(rows, f) {
  const page = Math.max(1, parseInt(f.page) || 1);
  const pageSize = Math.min(parseInt(f.page_size) || 100, 9999);
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize };
}

function sortObjRows(rows, f) {
  if (!f.sort_by) return rows;
  const dir = f.sort_dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = a[f.sort_by] != null ? a[f.sort_by] : '';
    const vb = b[f.sort_by] != null ? b[f.sort_by] : '';
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });
}

function toRows(objArr, keys) {
  return objArr.map(row => keys.map(k => row[k] !== undefined ? row[k] : null));
}

// SALESPERSON_UNIT_TARGETS removed 2026-07-04: targets now read from sales_targets DB table.

// ── Report 1: Sales ───────────────────────────────────────────────────────────

// ── Report 2: Client Payment Pending ─────────────────────────────────────────
function buildPaymentPendingReport(f) {
  // Data source: contracts.total_received / balance_amount / payment_status
  // These are authoritative pre-computed columns maintained by syncContractPayments()
  // after every payment add/edit/delete (including reconciliation commits).
  // Using these directly avoids a JOIN that breaks for combined-ref contracts
  // (e.g. "SH-235, SH-236, SH-237") where payment_ref contains commas.
  const where = ['c.is_deleted = 0'];
  const p = [];

  if (f.search) {
    where.push('(c.client_name LIKE ? OR c.contract_ref LIKE ?)');
    p.push(`%${f.search}%`, `%${f.search}%`);
  }
  if (f.contract_ref) { where.push('c.contract_ref LIKE ?'); p.push(`%${f.contract_ref}%`); }
  if (f.client) { where.push('c.client_name LIKE ?'); p.push(`%${f.client}%`); }
  if (f.salesperson) { where.push('c.sales_by = ?'); p.push(f.salesperson); }
  if (f.emirate) { where.push('c.emirate LIKE ?'); p.push(`%${f.emirate}%`); }
  if (f.contract_status) { where.push("COALESCE(c.delivery_status,'Active') = ?"); p.push(f.contract_status); }
  addDateFilter(where, p, f, 'c.approval_date');

  // Effective balance: use pre-computed balance_amount when available,
  // fall back to (contract_value - total_received) for contracts that have
  // never had syncContractPayments() run (e.g. newly imported contracts).
  const effectiveBal = `COALESCE(c.balance_amount, COALESCE(c.contract_value, 0) - COALESCE(c.total_received, 0))`;

  const rows = all(`
    SELECT
      c.contract_ref,
      c.client_name,
      COALESCE(ai.invoice_ref, '-') AS invoice_ref,
      COALESCE(c.contract_value, 0) AS contract_value,
      COALESCE(c.total_received, 0) AS received_amount,
      ${effectiveBal} AS balance_receivable,
      c.last_payment_date,
      COALESCE(c.delivery_status, 'Active') AS contract_status,
      COALESCE(c.sales_by, '') AS salesperson,
      COALESCE(c.emirate, '') AS emirate,
      COALESCE(c.remarks, '') AS remarks,
      COALESCE(c.payment_status,
        CASE
          WHEN COALESCE(c.total_received, 0) = 0 THEN 'Unpaid'
          WHEN COALESCE(c.contract_value, 0) > 0
               AND COALESCE(c.total_received, 0) > COALESCE(c.contract_value, 0) THEN 'Overpaid'
          WHEN COALESCE(c.contract_value, 0) > 0
               AND COALESCE(c.total_received, 0) >= COALESCE(c.contract_value, 0) THEN 'Full Paid'
          WHEN COALESCE(c.total_received, 0) > 0 THEN 'Partial Paid'
          ELSE 'Unpaid'
        END
      ) AS payment_status,
      0 AS has_mismatch
    FROM contracts c
    LEFT JOIN (
      SELECT contract_ref, MAX(invoice_ref) AS invoice_ref
      FROM alert_payments
      GROUP BY contract_ref
    ) ai ON ai.contract_ref = c.contract_ref
    WHERE ${where.join(' AND ')}
      AND ${effectiveBal} > 0
    ORDER BY ${effectiveBal} DESC
  `, p);

  // Post-query derived filters (payment_status is calculated, not stored)
  let filtered = rows;
  if (f.payment_status) { filtered = filtered.filter(r => r.payment_status === f.payment_status); }
  if (f.needs_review === '1') { filtered = filtered.filter(r => r.has_mismatch || r.payment_status === 'Overpaid'); }

  const sorted = sortObjRows(filtered, f);
  const { rows: paged, total, page, pageSize } = paginateRows(sorted, f);
  const COLS = ['contract_ref','client_name','invoice_ref','contract_value','received_amount',
                'balance_receivable','payment_status','last_payment_date','contract_status',
                'salesperson','emirate','remarks'];
  return {
    title: 'Client Payment Pending',
    report_type: 'payment-pending',
    columns: ['Contract Ref.','Client / Company','Invoice Ref.','Contract Value (AED)',
              'Received Amount (AED)','Balance Receivable (AED)','Payment Status',
              'Last Payment Date','Contract Status','Salesperson','Emirate','Remarks'],
    rows: toRows(paged, COLS),
    total, page, pageSize,
    _objects: filtered,
    summary: {
      pending_count: filtered.length,
      total_received: filtered.reduce((s, r) => s + (r.received_amount || 0), 0),
      total_outstanding: filtered.reduce((s, r) => s + (r.balance_receivable || 0), 0),
    },
  };
}

// ── Report 3: Supplier Payment ────────────────────────────────────────────────

// ── Report 4: Delivery Status ─────────────────────────────────────────────────

// ── Report 5: Project Delay ───────────────────────────────────────────────────

// ── Report 6: Salesperson Performance ────────────────────────────────────────

// ── Report 7: Monthly Management ─────────────────────────────────────────────
// 2026-09-29: replaced by the unit-based management report (reports/managementReport.js).
// The previous version was value-based and derived Production/Shipping/Delivered
// months from updated_at (not a milestone date) — removed.
function buildMonthlyManagementReport(f) {
  return require('./managementReport.js').buildMonthlyManagementReport(f);
}

// ── Report 8: Sea Costs ───────────────────────────────────────────────────────

// ── Report 9: OTJ Costs ───────────────────────────────────────────────────────

// ── Report 10: Contracts List ─────────────────────────────────────────────────

// ── Report 11: Contracts by Salesperson ──────────────────────────────────────

// ── Report 12: Contract Target Achievement ────────────────────────────────────


// ── Report 13: Cancelled / Terminated After Payment ──────────────────────────


// ── Report 14: SL Fuji New Orders — Unit Report ───────────────────────────────

// ── Report MN-1: Monthly Maintenance (new module) ─────────────────────────────

// ── Report MN-2: AMC Contract Status ─────────────────────────────────────────

// ── Report MN-3: Technician Performance ──────────────────────────────────────

// ── Report MN-4: Cancelled AMC ────────────────────────────────────────────────

// ── Report MN-5: Renewal Status ───────────────────────────────────────────────

// ── Report MN-6: Visit History ────────────────────────────────────────────────


// ── Quotation status normalisation (shared by Register + Status Summary) ─────
// Stored keys (quotations module): quoted | follow_up | negotiation | approved | lost | tender.
// 2026-09-29: accept labels or keys in filters ("Follow Up", "follow up", "follow_up")
// and map anything else to a visible "Unrecognised" bucket instead of crashing/dropping.

// ── Quotations Register ──────────────────────────────────────────────────────
// 2026-09-29 FIX: the query selected a non-existent column `quotation_value`
// (SQLite "no such column") → every load failed with "Unable to Load Report".
// The quoted amount is stored in quotations.contract_value.

// ── Quotation Status Summary ─────────────────────────────────────────────────
// 2026-09-29 FIX: same non-existent `quotation_value` column. Also: statuses are now
// shown as labels, ALL six standard statuses are always listed (0 when none), and a
// reconciliation row proves Σ statuses = total quotations for the same filters.
// Counting: one row per quote_ref (quote_ref is unique — revisions are not stored
// as separate quotation rows), verified with COUNT(DISTINCT quote_ref).

// ── NEW: Contracts by Emirate ─────────────────────────────────────────────────

// ── NEW: Factory Payments Register ───────────────────────────────────────────

// ── NEW: Maintenance Contract Register ───────────────────────────────────────

// ── NEW: Cancelled AMC Contracts ─────────────────────────────────────────────

// ── NEW: Renewal Status Report ────────────────────────────────────────────────

// ── NEW: Expiring AMC Contracts ───────────────────────────────────────────────

// ── NEW: Maintenance Pending Report ──────────────────────────────────────────

// ── NEW: Current Month Renewed Contracts ──────────────────────────────────────

// ── NEW: Technician Performance (maintenance_visits) ─────────────────────────

// ── NEW: Emirate-Wise Maintenance ────────────────────────────────────────────

// ── NEW: Callback Detail Register ─────────────────────────────────────────────

// ── NEW: Monthly Callback Summary ─────────────────────────────────────────────

// ── NEW: Monthly Cash Flow Summary ────────────────────────────────────────────

// ── Main Dispatcher ───────────────────────────────────────────────────────────

// ── Report 15: Monthly Maintenance Report ────────────────────────────────────
function buildMonthlyMaintenanceReport(f) {
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  const year  = parseInt(f.year)  || new Date().getFullYear();
  const month = parseInt(f.month) || (new Date().getMonth() + 1); // default to current month

  // ── Contract-level WHERE (applies to all queries) ────────────────────────
  const mcWhere  = ['mc.is_deleted=0'];
  const mcParams = [];
  if (f.search)            { mcWhere.push('(mc.contract_ref LIKE ? OR mc.client_name LIKE ?)'); mcParams.push(`%${f.search}%`,`%${f.search}%`); }
  if (f.emirate)           { mcWhere.push('mc.emirate=?');           mcParams.push(f.emirate); }
  if (f.maintenance_type)  { mcWhere.push('mc.maintenance_type=?');  mcParams.push(f.maintenance_type); }
  if (f.contract_ref)      { mcWhere.push('mc.contract_ref=?');      mcParams.push(f.contract_ref); }
  if (f.client)            { mcWhere.push('mc.client_name LIKE ?');  mcParams.push(`%${f.client}%`); }

  // ── Card 1: Total Maintenance Contracts (lifetime, never visit-based) ────
  const totalContracts = (all(
    `SELECT COUNT(*) AS cnt FROM maintenance_contracts mc WHERE ${mcWhere.join(' AND ')}`,
    mcParams
  )[0] || {}).cnt || 0;

  // ── Helper: alert classification ─────────────────────────────────────────
  function calcAlert(r) {
    const s = r.maintenance_status || 'Pending';
    if (s === 'Completed' || s === 'Partially Completed') return 'Closed';
    const dueStr = r.postponed_date || r.scheduled_date;
    if (!dueStr) return 'Overdue';
    const today = new Date(); today.setHours(0,0,0,0);
    const due   = new Date(dueStr); due.setHours(0,0,0,0);
    const diff  = Math.floor((due - today) / 86400000);
    if (diff < 0)          return 'Overdue';
    if (diff === 0)        return 'Due Today';
    if (diff <= 7)         return 'Upcoming';
    return 'Scheduled';
  }

  // ── Fetch the authoritative service population for a month ──────────────
  // 2026-09-28: rows come from getMonthlyMaintenanceMetrics (db/maintMetrics.js) —
  // the same population as Monthly Calendar, Dashboard and 12 Month Trend.
  // Each row carries its unit breakdown in r._pr (due/sched/completed/...).
  function fetchVisitsForMonth(mo) {
    const mm = getMonthlyMaintenanceMetrics(year, mo, {
      client: f.client, emirate: f.emirate, maintenance_type: f.maintenance_type,
    });
    let pop = mm.rows;
    if (f.contract_ref) pop = pop.filter(r => r.contract_ref === f.contract_ref);
    if (f.search) {
      const q = String(f.search).toLowerCase();
      pop = pop.filter(r => (r.contract_ref||'').toLowerCase().includes(q) || (r.client_name||'').toLowerCase().includes(q));
    }
    return pop.map(pr => {
      const v = pr.visit_id ? (all('SELECT * FROM maintenance_visits WHERE id=?', [pr.visit_id])[0] || {}) : {};
      return {
        ...v,
        maintenance_contract_id: pr.contract_id,
        mc_maintenance_id: pr.maintenance_id, client_name: pr.client_name, emirate: pr.emirate,
        maintenance_type: pr.maintenance_type, maintenance_period: pr.maintenance_period,
        mc_total_units: pr.total_elevator_units, mc_scheduling_method: pr.scheduling_method,
        mc_contract_ref: pr.contract_ref, mc_renewal_status: pr.renewal_status,
        schedule_source: pr.source,
        _pr: pr,
      };
    });
  }

  // ── Apply visit-level filters ─────────────────────────────────────────────
  function applyVisitFilters(rows) {
    if (f.maintenance_status) rows = rows.filter(r => (r.maintenance_status||'Pending') === f.maintenance_status);
    if (f.alert_status) rows = rows.filter(r => {
      const s = r.maintenance_status || 'Pending';
      if (s === 'Completed') return f.alert_status === 'Closed';
      const dueStr = r.postponed_date || r.scheduled_date;
      if (!dueStr) return f.alert_status === 'Overdue';
      const today = new Date(); today.setHours(0,0,0,0);
      const due   = new Date(dueStr); due.setHours(0,0,0,0);
      const diff  = Math.floor((due - today) / 86400000);
      if (f.alert_status === 'Overdue')   return diff < 0;
      if (f.alert_status === 'Due Today') return diff === 0;
      if (f.alert_status === 'Upcoming')  return diff >= 0 && diff <= 7;
      return false;
    });
    if (f.technician) rows = rows.filter(r => {
      let techs = []; try { techs = JSON.parse(r.technicians||'[]'); } catch(_) {}
      return techs.some(t => (t||'').toLowerCase().includes(f.technician.toLowerCase()));
    });
    if (f.scheduling_method) rows = rows.filter(r => (r.scheduling_method || r.mc_scheduling_method || 'Automatic') === f.scheduling_method);
    if (f.date_from || f.date_to) rows = rows.filter(r => {
      const d = r.scheduled_date || r.postponed_date;
      if (!d) return false;
      if (f.date_from && d < f.date_from) return false;
      if (f.date_to   && d > f.date_to)   return false;
      return true;
    });
    return rows;
  }

  // ── Unit helpers — unit figures come from the authoritative population row ──
  function schedUnitsFor(r) { return r._pr ? r._pr.sched_units : (Number(r.units_scheduled || r.total_elevator_units || r.mc_total_units) || 1); }
  function servedUnitsFor(r) { return r._pr ? r._pr.completed_units : (Number(r.units_serviced) || 0); }
  function isCompleted(r)  { return r.maintenance_status === 'Completed' || r.maintenance_status === 'Partially Completed'; }
  function isPending(r)    { const s = r.maintenance_status || 'Pending'; return s === 'Pending' || s === 'Scheduled'; }
  function sumPr(rows, k)  { return rows.reduce((s, r) => s + ((r._pr && r._pr[k]) || 0), 0); }

  // ── Selected-month KPIs (authoritative unit split) ────────────────────────
  const rawMonth   = fetchVisitsForMonth(month);
  const filteredM  = applyVisitFilters(rawMonth);
  const opRows     = filteredM;   // Hold/Cancelled already excluded by the metrics service

  const dueThisMonth        = sumPr(opRows, 'due_units');
  const scheduledThisMonth  = sumPr(opRows, 'sched_units');
  const completedThisMonth  = sumPr(opRows, 'completed_units');
  const partialThisMonth    = sumPr(opRows, 'partial_remaining_units');
  const pendingThisMonth    = sumPr(opRows, 'pending_units');
  const postponedThisMonth  = sumPr(opRows, 'postponed_units');
  const holdThisMonth       = sumPr(opRows, 'hold_units');
  const missedThisMonth     = sumPr(opRows, 'missed_units');
  const recoveryThisMonth   = opRows.filter(r => r._pr && r._pr.source === 'recovery').reduce((s, r) => s + r._pr.due_units, 0);
  let overdueThisMonth = 0;
  for (const r of opRows) if (!isCompleted(r) && calcAlert(r) === 'Overdue') overdueThisMonth += schedUnitsFor(r) - servedUnitsFor(r);

  // Completion % = Completed / Due (same definition as Calendar & Dashboard), max 100
  const completionPct = dueThisMonth > 0 ? Math.min(100, Math.round((completedThisMonth / dueThisMonth) * 1000) / 10) : 0;
  const unitsServicedThisMonth    = completedThisMonth;
  const unitsNotServicedThisMonth = Math.max(0, scheduledThisMonth - completedThisMonth);

  // ── Jan–Dec summary (each month independent, same authoritative logic) ────
  const monthlySummary = MONTH_NAMES.map((name, i) => {
    const mo   = i + 1;
    const mOp  = applyVisitFilters(fetchVisitsForMonth(mo));
    const mDue       = sumPr(mOp, 'due_units');
    const mSched     = sumPr(mOp, 'sched_units');
    const mCompleted = sumPr(mOp, 'completed_units');
    const mPartial   = sumPr(mOp, 'partial_remaining_units');
    const mPending   = sumPr(mOp, 'pending_units');
    const mPostponed = sumPr(mOp, 'postponed_units');
    const mHold      = sumPr(mOp, 'hold_units');
    const mMissed    = sumPr(mOp, 'missed_units');
    let mOverdue = 0;
    for (const r of mOp) if (!isCompleted(r) && calcAlert(r) === 'Overdue') mOverdue += schedUnitsFor(r) - servedUnitsFor(r);
    const mPct       = mDue > 0 ? Math.min(100, Math.round((mCompleted / mDue) * 1000) / 10) : 0;
    return { month: name, due: mDue, scheduled: mSched, completed: mCompleted, partial: mPartial, pending: mPending,
             postponed: mPostponed, hold: mHold, missed: mMissed, overdue: mOverdue, completion_pct: mPct };
  });

  // ── Technician performance (selected month, operational rows only) ─────────
  const techMap = {};
  for (const r of opRows) {
    let techs = []; try { techs = JSON.parse(r.technicians||'[]'); } catch(_) {}
    const su = schedUnitsFor(r);
    const sv = servedUnitsFor(r);
    const al = calcAlert(r);
    const ms = r.maintenance_status || 'Pending';
    for (const t of techs) {
      if (!t) continue;
      if (!techMap[t]) techMap[t] = { technician: t, assigned: 0, completed: 0, pending: 0, postponed: 0, hold: 0, overdue: 0, visits: 0, visits_completed: 0 };
      techMap[t].visits++;
      techMap[t].assigned += su;
      if (isCompleted(r))        { techMap[t].completed += sv; techMap[t].visits_completed++; }
      else if (isPending(r))     { techMap[t].pending   += su; }
      else if (ms === 'Postponed') techMap[t].postponed += su;
      else if (ms === 'Hold')      techMap[t].hold      += su;
      if (al === 'Overdue')        techMap[t].overdue   += su;
    }
  }
  const techPerf = Object.values(techMap).map(t => ({
    ...t, completion_pct: t.assigned > 0 ? Math.round((t.completed / t.assigned) * 1000) / 10 : 0
  }));

  // ── Emirate summary (selected month, operational rows only) ───────────────
  const emirateMap = {};
  for (const r of opRows) {
    const e = (r.emirate || 'Unknown').trim();
    if (!emirateMap[e]) emirateMap[e] = { emirate: e, scheduled: 0, completed: 0, pending: 0, postponed: 0, hold: 0, overdue: 0 };
    emirateMap[e].scheduled += schedUnitsFor(r);
    const ms = r.maintenance_status || 'Pending';
    if (isCompleted(r))        emirateMap[e].completed += servedUnitsFor(r);
    else if (ms === 'Postponed') emirateMap[e].postponed += schedUnitsFor(r);
    else if (ms === 'Hold')      emirateMap[e].hold      += schedUnitsFor(r);
    else                         emirateMap[e].pending   += schedUnitsFor(r);
    if (calcAlert(r) === 'Overdue') emirateMap[e].overdue += schedUnitsFor(r);
  }
  const emirateSummary = Object.values(emirateMap).map(e => ({
    ...e, completion_pct: e.scheduled > 0 ? Math.min(100, Math.round((e.completed / e.scheduled) * 1000) / 10) : 0
  }));

  // ── Detail rows (selected month) ─────────────────────────────────────────
  const DETAIL_KEYS = [
    'sno','maintenance_id','contract_ref','client_name','emirate','maintenance_type',
    'maintenance_interval','service_month','scheduled_date','actual_visit_date','completion_date',
    'total_units','units_serviced','units_not_serviced','technicians',
    'maintenance_status','contract_renewal_status','alert_status','lift_no','visit_type',
    'checklist_completed','spare_parts_used','client_signature','work_performed',
    'findings','pending_issues','postponement_reason','hold_reason','remarks'
  ];
  let sno = 0;
  const detailRows = filteredM.map(r => {
    sno++;
    let techs = []; try { techs = JSON.parse(r.technicians||'[]'); } catch(_) {}
    return {
      sno,
      maintenance_id:        r.mc_maintenance_id || '-',
      contract_ref:          r.contract_ref || r.mc_contract_ref || '-',
      client_name:           r.client_name || '-',
      emirate:               r.emirate || '-',
      maintenance_type:      r.maintenance_type || '-',
      maintenance_interval:  r.maintenance_period || '-',
      service_month:         MONTH_NAMES[month - 1],
      scheduled_date:        r.scheduled_date || '-',
      actual_visit_date:     r.completion_date || r.scheduled_date || '-',
      completion_date:       r.completion_date || '-',
      total_units:           r.total_elevator_units != null ? r.total_elevator_units : (r.mc_total_units != null ? r.mc_total_units : '-'),
      units_serviced:        r.units_serviced != null ? r.units_serviced : '-',
      units_not_serviced:    r.units_not_serviced != null ? r.units_not_serviced : '-',
      technicians:           techs.join(', ') || '-',
      maintenance_status:    r.maintenance_status || 'Pending',
      contract_renewal_status: r.mc_renewal_status || 'Active Maintenance',
      schedule_source:       r.schedule_source || 'regular',
      alert_status:          r.mc_renewal_status === 'Hold' ? 'Contract On Hold' : calcAlert(r),
      lift_no:               r.lift_no || '-',
      visit_type:            r.visit_type || '-',
      checklist_completed:   r.checklist_completed ? 'Yes' : 'No',
      spare_parts_used:      r.spare_parts_used || '-',
      client_signature:      r.client_signature || '-',
      work_performed:        r.work_performed || '-',
      findings:              r.findings || '-',
      pending_issues:        r.pending_issues || '-',
      postponement_reason:   r.postponement_reason || '-',
      hold_reason:           r.hold_reason || '-',
      remarks:               r.remarks || '-',
    };
  });

  const paginated = paginateRows(toRows(detailRows, DETAIL_KEYS), f);

  return {
    report_type:  'monthly-maintenance',
    year,
    month,
    month_name:   MONTH_NAMES[month - 1],
    summary: {
      total_contracts:           totalContracts,
      due_this_month:            dueThisMonth,
      recovery_this_month:       recoveryThisMonth,
      partial_this_month:        partialThisMonth,
      missed_this_month:         missedThisMonth,
      scheduled_this_month:      scheduledThisMonth,
      completed_this_month:      completedThisMonth,
      pending_this_month:        pendingThisMonth,
      postponed_this_month:      postponedThisMonth,
      hold_this_month:           holdThisMonth,
      overdue_this_month:        overdueThisMonth,
      completion_pct:            completionPct,
      units_serviced_this_month: unitsServicedThisMonth,
      units_not_serviced_this_month: unitsNotServicedThisMonth,
    },
    monthly_summary:        monthlySummary,
    technician_performance: techPerf,
    emirate_summary:        emirateSummary,
    columns: ['S.No.','Maintenance ID','Contract Ref.','Client','Emirate','Type','Period','Month','Scheduled Date','Actual Visit Date','Completion Date','Total Units','Serviced','Not Serviced','Technicians','Status','Contract Status','Alert','Lift No.','Visit Type','Checklist','Spare Parts Used','Client Signature','Work Performed','Findings','Pending Issues','Postpone Reason','Hold Reason','Remarks'],
    ...paginated,
  };
}

// ── Report MN-7: Upcoming Month Scheduled Visits ─────────────────────────────

// ── Report 14: Client Payment Entry ─────────────────────────────────────────
function buildClientPaymentEntryReport(f) {
  // Single source of truth: client_payments table (Accounts & Payments module).
  // Matches to contracts via contract_ref. Unlinked payments flagged separately.
  const where = ['cp.is_deleted = 0'];
  const p = [];

  if (f.search) {
    where.push('(cp.contract_ref LIKE ? OR COALESCE(c.client_name,cp.client_name,\'\') LIKE ? OR cp.payment_ref LIKE ? OR COALESCE(c.project_description,cp.project_name,\'\') LIKE ?)');
    p.push(`%${f.search}%`, `%${f.search}%`, `%${f.search}%`, `%${f.search}%`);
  }
  if (f.contract_ref) { where.push('cp.contract_ref LIKE ?'); p.push(`%${f.contract_ref}%`); }
  if (f.client) { where.push("COALESCE(c.client_name,cp.client_name,'') LIKE ?"); p.push(`%${f.client}%`); }
  addDateFilter(where, p, f, 'cp.entry_date');
  if (f.payment_type) { where.push('cp.payment_type = ?'); p.push(f.payment_type); }
  if (f.payment_mode) { where.push('cp.payment_mode LIKE ?'); p.push(`%${f.payment_mode}%`); }
  if (f.salesperson) { where.push('c.sales_by = ?'); p.push(f.salesperson); }
  if (f.emirate) { where.push('c.emirate LIKE ?'); p.push(`%${f.emirate}%`); }
  if (f.contract_status) { where.push("COALESCE(c.delivery_status,'Active') = ?"); p.push(f.contract_status); }

  const rows = all(`
    SELECT
      cp.id AS cp_id,
      cp.payment_ref,
      cp.entry_date AS payment_date,
      COALESCE(cp.contract_ref,'') AS contract_ref,
      COALESCE(c.client_name, cp.client_name, '') AS client_name,
      COALESCE(c.project_description, cp.project_name, '') AS project_description,
      COALESCE(c.contract_value, cp.contract_value, 0) AS contract_value,
      COALESCE(cp.received_amount, 0) AS received_amount,
      COALESCE(ct.total_received, 0) AS total_received,
      COALESCE(c.contract_value, cp.contract_value, 0) - COALESCE(ct.total_received, 0) AS balance_receivable,
      COALESCE(cp.payment_type, '') AS payment_type,
      COALESCE(cp.payment_mode, '') AS payment_mode,
      COALESCE(cp.received_by, '') AS received_by,
      COALESCE(cp.remarks, '') AS remarks,
      cp.updated_at,
      COALESCE(c.delivery_status,
        CASE WHEN cp.contract_ref IS NULL OR cp.contract_ref = '' THEN 'Unlinked'
             ELSE 'Contract Not Found' END) AS contract_status,
      COALESCE(c.sales_by, '') AS salesperson,
      COALESCE(c.emirate, '') AS emirate,
      COALESCE(c.cancellation_type, '') AS cancellation_type,
      COALESCE(c.payment_retention_status, '') AS payment_retention_status,
      COALESCE(c.refund_status, '') AS refund_status,
      CASE WHEN cp.contract_ref IS NULL OR cp.contract_ref = '' OR c.id IS NULL
           THEN 1 ELSE 0 END AS is_unlinked,
      CASE
        WHEN COALESCE(ct.total_received, 0) = 0 THEN 'Unpaid'
        WHEN COALESCE(c.contract_value, cp.contract_value, 0) > 0
             AND COALESCE(ct.total_received, 0) > COALESCE(c.contract_value, cp.contract_value, 0)
             THEN 'Overpaid'
        WHEN COALESCE(c.contract_value, cp.contract_value, 0) > 0
             AND COALESCE(ct.total_received, 0) >= COALESCE(c.contract_value, cp.contract_value, 0)
             THEN 'Full Paid'
        WHEN COALESCE(ct.total_received, 0) > 0 THEN 'Partial Paid'
        ELSE 'Unpaid'
      END AS payment_status,
      CASE WHEN c.total_received IS NOT NULL
                AND ABS(c.total_received - COALESCE(ct.total_received, 0)) > 0.01
           THEN 1 ELSE 0 END AS has_mismatch,
      COALESCE(c.total_received, 0) AS contract_stored_total
    FROM client_payments cp
    LEFT JOIN contracts c ON c.contract_ref = cp.contract_ref AND c.is_deleted = 0
    LEFT JOIN (
      SELECT contract_ref, SUM(COALESCE(received_amount, 0)) AS total_received
      FROM client_payments WHERE is_deleted = 0
      GROUP BY contract_ref
    ) ct ON ct.contract_ref = cp.contract_ref
    WHERE ${where.join(' AND ')}
    ORDER BY cp.contract_ref, cp.entry_date
  `, p);

  // Post-query derived filters (payment_status, needs_review are computed fields)
  let filtered = rows;
  if (f.payment_status) { filtered = filtered.filter(r => r.payment_status === f.payment_status); }
  if (f.needs_review === '1') { filtered = filtered.filter(r => r.is_unlinked || r.has_mismatch || r.payment_status === 'Overpaid'); }

  // Summary statistics — spec-required 6 KPI cards
  const now        = new Date();
  const todayStr   = now.toISOString().slice(0, 10);        // YYYY-MM-DD
  const thisMonthP = now.toISOString().slice(0, 7);          // YYYY-MM prefix

  const totalEntries         = filtered.length;
  const totalReceivedAmount  = filtered.reduce((s, r) => s + (r.received_amount || 0), 0);
  const contractsWithPayments = new Set(filtered.map(r => r.contract_ref).filter(Boolean)).size;
  const paymentsThisMonth    = filtered.filter(r => r.payment_date && String(r.payment_date).startsWith(thisMonthP))
                                       .reduce((s, r) => s + (r.received_amount || 0), 0);
  const paymentsToday        = filtered.filter(r => r.payment_date && String(r.payment_date).startsWith(todayStr))
                                       .reduce((s, r) => s + (r.received_amount || 0), 0);
  const averagePayment       = totalEntries > 0 ? totalReceivedAmount / totalEntries : 0;

  const summary = {
    total_entries:           totalEntries,
    total_received_amount:   totalReceivedAmount,
    contracts_with_payments: contractsWithPayments,
    payments_this_month:     paymentsThisMonth,
    payments_today:          paymentsToday,
    average_payment:         averagePayment,
  };

  // ── SUMMARY VIEW (one row per contract) ──────────────────────────────────
  if (f.view_mode === 'summary') {
    const summaryMap = new Map();
    for (const r of filtered) {
      const key = r.contract_ref || ('__ul_' + r.cp_id);
      if (!summaryMap.has(key)) {
        summaryMap.set(key, {
          contract_ref:        r.contract_ref || 'Unlinked',
          client_name:         r.client_name,
          project_description: r.project_description,
          contract_value:      r.contract_value,
          payment_count:       0,
          total_received:      r.total_received,
          balance_receivable:  r.balance_receivable,
          payment_status:      r.payment_status,
          last_payment_date:   r.payment_date,
          contract_status:     r.contract_status,
          salesperson:         r.salesperson,
          emirate:             r.emirate,
          flag: r.is_unlinked ? 'Unlinked'
              : r.has_mismatch ? 'Amount Mismatch'
              : r.payment_status === 'Overpaid' ? 'Overpaid'
              : '',
        });
      }
      const entry = summaryMap.get(key);
      entry.payment_count++;
      if (r.payment_date && r.payment_date > entry.last_payment_date) entry.last_payment_date = r.payment_date;
    }
    const summaryRows = [...summaryMap.values()];
    const sorted = sortObjRows(summaryRows, f);
    const { rows: paged, total, page, pageSize } = paginateRows(sorted, f);
    const SCOLS = ['contract_ref','client_name','project_description','contract_value','payment_count',
                   'total_received','balance_receivable','payment_status','last_payment_date',
                   'contract_status','salesperson','emirate','flag'];
    return {
      title: 'Client Payment Entry — Project Summary',
      report_type: 'client-payment-entry-summary',
      view_mode: 'summary',
      columns: ['Contract Ref.','Client / Company','Project / Description','Contract Value (AED)',
                'No. of Payments','Total Received (AED)','Balance Receivable (AED)','Payment Status',
                'Last Payment Date','Contract Status','Salesperson','Emirate','Flag'],
      rows: toRows(paged, SCOLS),
      total, page, pageSize, summary, _objects: filtered,
    };
  }

  // ── DETAIL VIEW (one row per payment transaction) ─────────────────────────
  const detailRows = filtered.map(r => ({
    ...r,
    alert: r.is_unlinked       ? 'Unlinked / Needs Review'
         : r.has_mismatch      ? 'Amount Mismatch'
         : r.payment_status === 'Overpaid' ? 'Overpaid / Needs Review'
         : '',
  }));
  const sorted = sortObjRows(detailRows, f);
  const { rows: paged, total, page, pageSize } = paginateRows(sorted, f);
  const COLS = ['payment_ref','payment_date','contract_ref','client_name','project_description',
                'contract_value','received_amount','total_received','balance_receivable',
                'payment_type','payment_mode','payment_status','received_by','remarks',
                'updated_at','contract_status','cancellation_type','payment_retention_status',
                'refund_status','salesperson','emirate','alert'];
  return {
    title: 'Client Payment Entry',
    report_type: 'client-payment-entry',
    view_mode: 'detail',
    columns: ['Payment Ref.','Payment Date','Contract Ref.','Client / Company','Project / Description',
              'Contract Value (AED)','Received Amount (AED)','Total Received (AED)',
              'Balance Receivable (AED)','Payment Type','Payment Mode','Payment Status',
              'Received By','Remarks','Last Updated','Contract Status','Cancellation Type',
              'Retention Status','Refund Status','Salesperson','Emirate','Alert'],
    rows: toRows(paged, COLS),
    total, page, pageSize, summary, _objects: filtered,
  };
}


// ── 2026-09-16: Handover Report ───────────────────────────────────────────────
// Uses actual handover_date — never approval_date. Contracted in any prior year
// but handed over in the selected year are correctly counted.
// ── Handover Report (2026-09-29 redesign) ────────────────────────────────────
// ONE authoritative filtered dataset drives everything (KPIs, 12-month trend,
// cumulative, month drill-down, emirate / salesperson breakdowns, register,
// Excel / PDF / Print):
//   population = contracts (not deleted) with an ACTUAL Handover Date in the
//                selected year  + Salesperson / Emirate / Search filters.
//   Month filter scopes KPIs, breakdowns and register to that month; the
//   12-month trend stays visible for context (selected month highlighted).
// Units  = contracts.elevator_units (0/NULL → 1) — one row per Contract record,
//          so grouped refs (e.g. "SH-252, SH-253") count their real unit total,
//          and no joins to payments / factory / maintenance can multiply rows.
// Projects = number of Contract records.
// YTD = all actual handover dates recorded in the selected year (no future
//       handover dates exist; the current year is therefore "to date").
// Avg Units / Month = YTD units ÷ months with ≥1 handover ("active months").
// Legacy status text is never assigned to a month; Mechanical + Electrical
// "Completed" contracts without a Handover Date are reported as data quality.

// ── 2026-07-30: Expanded report catalog ──────────────────────────────────────
// 14 new report types added; mn-* orphaned (old module) kept for backward compat
// but are NOT in the frontend REPORT_CATALOG visible UI.
// ══════════════════════════════════════════════════════════════════════════════
// 2026-09-30 REPORTS CONSOLIDATION — 22 authoritative reports (was 34 in the UI
// catalog + 7 orphaned API types). Removed report types keep NO route; their data
// is untouched and now served by the consolidated report shown in brackets:
//   quotation-status-summary → quotations-register · contracts-target-achievement,
//   contracts-salesperson-performance → salesperson-performance · contracts-by-emirate,
//   sales → monthly-sales · delivery-status → delivery-report · project-delay →
//   project-status · otj-quotes, supplier-payment → factory-payments-register ·
//   maintenance-register, maintenance-renewal, current-month-renewed → amc-portfolio ·
//   mn-upcoming-visits, maintenance-pending, maintenance-emirate → monthly-maintenance ·
//   callback-monthly → callback-detail · maintenance-technician + mn-* (orphaned, unused).
// ══════════════════════════════════════════════════════════════════════════════
const S = require('./std.js');

const REPORT_TYPES = [
  // Management
  'monthly-management',
  // Sales & Quotations
  'quotations-register', 'salesperson-performance',
  // Contracts
  'contracts-list', 'monthly-sales', 'delivery-report', 'installation-completion', 'handover-report', 'project-status',
  // Factory, Shipping & Supplier
  'ins-quotes-units', 'sea-costs', 'factory-payments-register',
  // Maintenance
  'monthly-maintenance', 'service-register', 'amc-portfolio', 'amc-payments',
  // Call Back & Emergency
  'callback-detail',
  // Accounts & Payments
  'payment-pending', 'client-payment-entry', 'monthly-cashflow',
  // Alerts, Expiry & Compliance
  'maintenance-expiring',
  // Historical & Cancelled Records
  'cancelled-contracts', 'maintenance-cancelled',
];

const ALL_ROWS = { page: 1, page_size: 99999 };

function buildReport(type, filters, forExport) {
  const f = Object.assign({}, filters || {});
  // Exports return ALL matching rows unless the user ticked "Current page only".
  // KPIs / charts / breakdowns always use the full filtered population; only the
  // detailed register is paginated.
  if (forExport && String(f.current_page_only) !== '1') { f.page = 1; f.page_size = 9999; }
  switch (type) {
    case 'monthly-management':        return buildMonthlyManagementReport(f);
    case 'quotations-register':       return S.buildQuotationsReport(f);
    case 'salesperson-performance':   return S.buildSalespersonReport(f);
    case 'contracts-list':            return S.buildContractRegister(f);
    case 'monthly-sales':             return S.buildMilestoneReport('monthly-sales', f);
    case 'delivery-report':           return S.buildMilestoneReport('delivery-report', f);
    case 'installation-completion':   return S.buildInstallationReport(f);
    case 'handover-report':           return S.buildMilestoneReport('handover-report', f);
    case 'project-status':            return S.buildProjectStatusReport(f);
    case 'ins-quotes-units':          return S.buildFactoryOrdersReport(f);
    case 'sea-costs':                 return S.buildShippingReport(f);
    case 'factory-payments-register': return S.buildFactoryPaymentsReport(f);
    case 'monthly-maintenance': {
      const d = buildMonthlyMaintenanceReport({ ...f, ...ALL_ROWS });
      d._allRows = d.rows;
      return S.standardiseMonthlyMaintenance(d, f);
    }
    case 'service-register':          return S.buildServiceRegister(f);
    case 'amc-portfolio':             return S.buildAmcPortfolioReport(f);
    case 'amc-payments':              return S.buildAmcPaymentsReport(f);
    case 'callback-detail':           return S.buildCallbackReport(f);
    case 'payment-pending': {
      const d = buildPaymentPendingReport({ ...f, ...ALL_ROWS });
      d._allRows = d.rows;
      return S.standardiseReceivables(d, d._objects, f);
    }
    case 'client-payment-entry': {
      const d = buildClientPaymentEntryReport({ ...f, ...ALL_ROWS });
      d._allRows = d.rows;
      if (f.year && S.monthOf(f)) d._yearRows = buildClientPaymentEntryReport({ ...f, month: '', ...ALL_ROWS })._objects;
      return S.standardiseClientPayments(d, d._objects, f);
    }
    case 'monthly-cashflow':          return S.buildCashFlowReport(f);
    case 'maintenance-expiring':      return S.buildAmcExpiryReport(f);
    case 'cancelled-contracts':       return S.buildCancelledContractsReport(f);
    case 'maintenance-cancelled':     return S.buildCancelledAmcReport(f);
    default: throw new Error(`Unknown report type: ${type}`);
  }
}

module.exports = { buildReport, REPORT_TYPES };
