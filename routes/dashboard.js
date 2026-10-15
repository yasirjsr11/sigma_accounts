// Main Dashboard. Rebuilt 2026-06-28 (Phase 3 "2026 Dashboard rebuild"), then updated again same
// day (Phase 4 - "Dashboard v2: Total Contract rename, target 68, Salesperson Performance table +
// charts"). Only the Main Dashboard is touched by this file; no other module's data or routes
// are read/written here except via plain SELECTs against contracts/quotations.
//
// KPI definitions:
//  - total_contracts (renamed from total_contracts_2026): ALL-TIME contract units, not scoped to
//    2026. Sourced from db/contractMetrics.js's getTotalContractUnits() - the SAME function the
//    Contract Dashboard (routes/contracts.js GET /dashboard) uses for its own total_contracts. Both
//    dashboards previously diverged (246 here vs 253 there) because this file excluded
//    delivery_status='Cancel' rows while the Contract Dashboard didn't. Fixed 2026-06-28: a
//    cancelled contract still represents a contract that was created/approved (is_deleted=0), so
//    it counts. Do NOT re-inline a separate COUNT(*) query for this KPI here - always call
//    getTotalContractUnits() so the two dashboards can't drift apart again.
//  - total_sales_units_2026: still 2026-scoped, unchanged definition (1 Contract = 1 Unit - see
//    prior header note below; no quantity column exists anywhere in the schema).
//  - sales_target_2026: hardcoded at 68 per instruction (changed from 70).
//  - achievement_pct: total_sales_units_2026 / 68 * 100.
//  - units_in_production_2026 / units_delivered_2026: unchanged from the Phase 3 rebuild - sourced
//    from Factory/Suppliers factory_delivery_status, joined by contract_ref, plus contracts' own
//    delivery_status='Delivered' as an additional Delivered signal. NOTE (Phase 6, 2026-06-30): the
//    "Units in Production 2026" KPI CARD was removed from the dashboard UI per instruction (replaced
//    by the new "Quotations 2026" card below) - the units_in_production_2026 field itself is left
//    computed/returned here unchanged (harmless, not displayed) so nothing else that may reference it
//    breaks; this is a UI-only removal, not a data/architecture change.
//  - balance_units_2026: 68 - total_sales_units_2026 (not floored; can go negative = over-achievement).
//  - quotations_2026 (Phase 6, 2026-06-30): COUNT(*) of `quotations` rows (is_deleted=0) whose
//    quotation_date falls in 2026, i.e. total quotations submitted during 2026 - powers the new
//    "Quotations 2026" dashboard card, which replaces "Units in Production 2026". Counted purely by
//    quotation_date (submission date), independent of status/salesperson, so it always reflects the
//    live count the moment a new quotation is added - no caching/snapshotting involved. Clicking the
//    card opens the Quotations module pre-filtered to year=2026 (see public/js/dashboard.js +
//    public/js/quotations.js + this file's sibling routes/quotations.js `year` query param).
//  - monthly_quotations_2026 (2026-06-30, Emirates Quotes import): zero-filled Jan-Dec count of
//    `quotations` rows by quotation_date month, same shape as monthly_sales_2026. Powers the new
//    "Monthly Quotations (2026)" chart panel - added because the 150-row "SH QUOTES - 2026" import
//    has no explicit submission-date column; quotation_date for each imported row is derived from
//    the source sheet's own month-divider rows (1st of the row's month section), which is the most
//    reliable submission-month signal available in that sheet (cross-checked against the sheet's
//    "Last Follow Up" column - that column diverges from the section month in ~20% of rows, since
//    it's a later follow-up date, not the original submission date, so it was deliberately NOT used
//    for quotation_date; it is instead preserved verbatim inside the remarks field).
// Salesperson Performance (2026-scoped), per the user's explicit unit targets:
//    SY=30, MM=16, NM=12, SS=10 units. MGMT = "Optional Sales", no target assigned, so no
//    achievement % is computed for MGMT (only shown if/when a target is added).
//  - These unit targets are intentionally hardcoded here, NOT stored in the existing `sales_targets`
//    table - that table already backs the Contracts module's own per-year dashboard
//    (routes/contracts.js's GET /dashboard) where target_value is a CURRENCY value, not a unit
//    count. Reusing it for unit counts would silently corrupt that other module's currency-based
//    targets/achievement-% math. Keeping these as separate, dashboard-local constants avoids that
//    cross-contamination while still satisfying "do not change other modules."
//  - current_sales_achievement = confirmed 2026 contracts (same "confirmed" definition as above)
//    where sales_by = the salesperson code.
//  - total_quotations_submitted = rows in `quotations` where salesperson = the code and
//    quotation_date falls in 2026. Sourced live from the Quotations module's 2026 records (the
//    Emirates Quotes import populated this on 2026-06-30 - see import_log table).
//  - percentage_of_achievement = current_sales_achievement / 2026 Target Units * 100 (1 decimal),
//    null for MGMT (no target).
//  - Historical note: 7 contracts across 2020-2025 use a joint sales_by value of 'SYMM' (shared
//    SY/MM credit) - none fall in 2026, so they never appear in this 2026-scoped table. They are
//    still included in the all-time total_contracts count (which isn't split by salesperson).
//
// Charts (data only - rendering is in public/js/dashboard.js, plain inline SVG, no new dependency
// since no chart library was already in use anywhere else in this app):
//  - Sales Target vs Achievement / Achievement % / Quotation vs Contract Conversion: all derived
//    directly from salesperson_performance (SY/MM/NM/SS only for the target-comparison charts, per
//    instruction to exclude MGMT from target comparisons).
//  - Monthly Sales Progress: monthly_sales_2026 below - confirmed 2026 contracts grouped by month
//    (Jan-Dec, zero-filled for months with no data so the x-axis stays consistent) and by
//    salesperson, so the frontend can filter to one salesperson or show the total.
//  - Monthly Quotations (2026): monthly_quotations_2026 below - same zero-filled Jan-Dec shape,
//    counting `quotations` rows by quotation_date month (see KPI note above).
//  - Overall Target Progress: reuses sales_target_2026 / total_sales_units_2026 / balance_units_2026
//    from the top-level summary fields above.
const express = require('express');
const { all, get } = require('../db/db.js');
const { getTotalContractUnits } = require('../db/contractMetrics.js');
const { requireModule } = require('../middleware/auth.js');
const router = express.Router();

// SALES_TARGET_2026 and per-salesperson targets are now read from sales_targets DB table (2026-07-04).
// The table was migrated from target_value (currency) to target_units (integer unit count).
// Hardcoded constants removed. If no DB rows exist for a year, targets default to null/0.
const SALESPERSON_CODES = ['SY', 'MM', 'NM', 'SS', 'MGMT'];

// Sales Logic (2026-07-04 update): ALL contracts with a Contract Ref. count toward Total Sales,
// including those with delivery_status='Cancel'. Cancelled contracts are tracked continuously
// and shown as a separate breakdown (total_sales_cancelled / total_sales_active), but are
// always included in the grand total. Only contracts with is_deleted=0 are counted.
// Quotations without a Contract Ref. are never included in any sales figure.

router.get('/summary', requireModule('dashboard'), (req, res) => {
  // total_contracts: all-time ALL records (shared helper - kept for Contracts module parity).
  const totalContracts = getTotalContractUnits();

  // Read 2026 salesperson targets from DB (target_units INTEGER, migrated 2026-07-04)
  const dbTargets2026 = all(`SELECT salesperson, target_units FROM sales_targets WHERE year = 2026`);
  const dbTargetMap = Object.fromEntries(dbTargets2026.map(t => [t.salesperson, t.target_units]));
  const SALES_TARGET_2026 = dbTargets2026.reduce((s, t) => s + (t.target_units || 0), 0);

  // total_sales = all non-deleted contracts (incl Cancelled). Count-based (1 contract = 1 unit).
  const salesBreakdown = get(`
    SELECT COALESCE(SUM(COALESCE(elevator_units,1)),0) total_contracts,
      COALESCE(SUM(CASE WHEN delivery_status='Cancel' THEN COALESCE(elevator_units,1) ELSE 0 END),0) cancelled_contracts,
      COALESCE(SUM(COALESCE(contract_value,0)),0) total_value,
      COALESCE(SUM(CASE WHEN delivery_status='Cancel' THEN COALESCE(contract_value,0) ELSE 0 END),0) cancelled_value
    FROM contracts WHERE is_deleted=0`);

  // 2026-scoped total = SUM(elevator_units) (includes Cancelled).
  const totalSalesUnits2026 = get(`
    SELECT COALESCE(SUM(COALESCE(elevator_units,1)),0) c FROM contracts
    WHERE is_deleted = 0 AND approval_date LIKE '2026%'`).c;

  const inProduction = get(`
    SELECT COUNT(*) c FROM contracts ct
    WHERE ct.is_deleted = 0 AND ct.approval_date LIKE '2026%'
      AND (
        EXISTS (SELECT 1 FROM factory_sea_costs f WHERE f.contract_ref = ct.contract_ref AND f.factory_delivery_status = 'Production')
        OR EXISTS (SELECT 1 FROM factory_otj_quotes f WHERE f.contract_ref = ct.contract_ref AND f.factory_delivery_status = 'Production')
        OR EXISTS (SELECT 1 FROM factory_ins_quotes f WHERE f.contract_ref = ct.contract_ref AND f.factory_delivery_status = 'Production')
      )`).c;

  // ── Delivered to Site — hybrid date logic (2026-09-16 fix) ──────────────────────────────────
  // PRINCIPLE: Use actual delivery date when available; fall back to delivery_status + approval_date
  // for contracts that are marked Delivered but have no actual date recorded yet.
  // This prevents the KPI from showing artificially low counts due to missing date entries.
  // A contract approved in a prior year but actually delivered in the current year still counts
  // if it has an actual delivery date; the fallback arm is year-scoped via approval_date.
  const CUR_YEAR = new Date().getFullYear().toString();
  const CUR_MONTH = `${CUR_YEAR}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

  // Subquery: contract has NO actual delivery date recorded anywhere
  const _noActualDate = `(
    (ct.site_delivery_date IS NULL OR ct.site_delivery_date = '')
    AND NOT EXISTS (SELECT 1 FROM factory_sea_costs f WHERE f.contract_ref = ct.contract_ref AND f.actual_delivery_date IS NOT NULL AND f.actual_delivery_date != '')
    AND NOT EXISTS (SELECT 1 FROM factory_otj_quotes f WHERE f.contract_ref = ct.contract_ref AND f.actual_delivery_date IS NOT NULL AND f.actual_delivery_date != '')
    AND NOT EXISTS (SELECT 1 FROM factory_ins_quotes f WHERE f.contract_ref = ct.contract_ref AND f.actual_delivery_date IS NOT NULL AND f.actual_delivery_date != '')
  )`;

  // Hybrid WHERE: actual date in pattern OR (no date + delivery_status=Delivered + approval_date in pattern)
  const _deliveredWhere = (pattern) => `(
    (ct.site_delivery_date LIKE '${pattern}')
    OR EXISTS (SELECT 1 FROM factory_sea_costs f WHERE f.contract_ref = ct.contract_ref AND f.actual_delivery_date LIKE '${pattern}')
    OR EXISTS (SELECT 1 FROM factory_otj_quotes f WHERE f.contract_ref = ct.contract_ref AND f.actual_delivery_date LIKE '${pattern}')
    OR EXISTS (SELECT 1 FROM factory_ins_quotes f WHERE f.contract_ref = ct.contract_ref AND f.actual_delivery_date LIKE '${pattern}')
    OR (ct.delivery_status = 'Delivered' AND ${_noActualDate} AND ct.approval_date LIKE '${pattern}')
  )`;

  // YTD: delivered in current year (actual date) OR marked Delivered + approved in current year (fallback)
  const delivered = get(`
    SELECT COALESCE(SUM(COALESCE(ct.elevator_units,1)),0) c FROM contracts ct
    WHERE ct.is_deleted = 0
      AND ${_deliveredWhere(CUR_YEAR + '%')}`).c;

  // Current month: same hybrid logic scoped to this month
  const deliveredThisMonth = get(`
    SELECT COALESCE(SUM(COALESCE(ct.elevator_units,1)),0) c FROM contracts ct
    WHERE ct.is_deleted = 0
      AND ${_deliveredWhere(CUR_MONTH + '%')}`).c;

  // Missing delivery date flag: Delivered status but no actual date recorded (for data quality)
  const deliveredMissingDate = get(`
    SELECT COUNT(*) c FROM contracts ct
    WHERE ct.is_deleted = 0
      AND ct.delivery_status = 'Delivered'
      AND ${_noActualDate}`).c;

  // ── Handover Completed — scoped by actual handover_date (2026-09-16 new) ──
  const handoverYTD = get(`
    SELECT COALESCE(SUM(COALESCE(elevator_units,1)),0) c FROM contracts
    WHERE is_deleted = 0
      AND handover_date LIKE '${CUR_YEAR}%'`).c;

  const handoverProjects = get(`
    SELECT COUNT(*) c FROM contracts
    WHERE is_deleted = 0
      AND handover_date LIKE '${CUR_YEAR}%'`).c;

  const handoverThisMonth = get(`
    SELECT COALESCE(SUM(COALESCE(elevator_units,1)),0) c FROM contracts
    WHERE is_deleted = 0
      AND handover_date LIKE '${CUR_MONTH}%'`).c;

  const achievementPct = SALES_TARGET_2026 > 0 ? (totalSalesUnits2026 / SALES_TARGET_2026) * 100 : 0;

  const quotations2026 = get(`
    SELECT COUNT(*) c FROM quotations
    WHERE is_deleted = 0 AND quotation_date LIKE '2026%'`).c;


  // ---- Salesperson performance (2026) — includes Cancelled contracts ----
  // Target units now read from DB (sales_targets table, target_units column).
  const salesperson_performance = SALESPERSON_CODES.map(code => {
    const achRow = get(`
      SELECT COALESCE(SUM(COALESCE(elevator_units,1)),0) total_contracts,
        COALESCE(SUM(CASE WHEN delivery_status='Cancel' THEN COALESCE(elevator_units,1) ELSE 0 END),0) cancelled_contracts
      FROM contracts
      WHERE is_deleted = 0 AND approval_date LIKE '2026%' AND sales_by = ?`, [code]);
    const quotations = get(`
      SELECT COUNT(*) c FROM quotations
      WHERE is_deleted = 0 AND salesperson = ? AND quotation_date LIKE '2026%'`, [code]).c;
    const target = dbTargetMap[code] != null ? dbTargetMap[code] : null;
    const pct = (target != null && target > 0) ? Math.round((achRow.total_contracts / target) * 1000) / 10 : null;
    return {
      salesperson: code,
      target_units_2026: target,
      total_quotations_submitted: quotations,
      current_sales_achievement: achRow.total_contracts,
      cancelled_achievement: achRow.cancelled_contracts || 0,
      active_achievement: achRow.total_contracts - (achRow.cancelled_contracts || 0),
      total_contracts_2026: achRow.total_contracts,
      percentage_of_achievement: pct,
    };
  });

  // ---- Monthly sales progress (2026), zero-filled Jan-Dec, broken down per salesperson ----
  // Includes Cancelled contracts (they have a Contract Ref. and must be tracked).
  // Monthly sales: COUNT(*) per month per salesperson
  const monthlyRows = all(`
    SELECT strftime('%m', approval_date) AS mm, sales_by, COALESCE(SUM(COALESCE(elevator_units,1)),0) c
    FROM contracts
    WHERE is_deleted = 0 AND approval_date LIKE '2026%'
    GROUP BY mm, sales_by`);
  const monthly_sales_2026 = Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, '0');
    const entry = { month: `2026-${mm}`, total: 0 };
    for (const code of SALESPERSON_CODES) entry[code] = 0;
    for (const r of monthlyRows) {
      if (r.mm !== mm) continue;
      const code = SALESPERSON_CODES.includes(r.sales_by) ? r.sales_by : null;
      if (code) entry[code] += r.c;
      entry.total += r.c;
    }
    return entry;
  });

  // ---- Monthly quotation count (2026), zero-filled Jan-Dec (2026-06-30 update: Emirates
  // Quotes import). Counted purely by quotation_date (submission month), independent of
  // salesperson/status, mirroring monthly_sales_2026's shape for frontend consistency.
  const monthlyQuotationRows = all(`
    SELECT strftime('%m', quotation_date) AS mm, COUNT(*) c
    FROM quotations
    WHERE is_deleted = 0 AND quotation_date LIKE '2026%'
    GROUP BY mm`);
  const monthly_quotations_2026 = Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, '0');
    const row = monthlyQuotationRows.find(r => r.mm === mm);
    return { month: `2026-${mm}`, total: row ? row.c : 0 };
  });

  res.json({
    total_contracts: totalContracts,
    total_sales: salesBreakdown.total_contracts,
    total_sales_active: salesBreakdown.total_contracts - (salesBreakdown.cancelled_contracts || 0),
    total_sales_cancelled: salesBreakdown.cancelled_contracts || 0,
    total_sales_value: salesBreakdown.total_value,
    total_sales_cancelled_value: salesBreakdown.cancelled_value,
    total_sales_units_2026: totalSalesUnits2026,
    sales_target_2026: SALES_TARGET_2026,
    achievement_pct: Math.round(achievementPct * 10) / 10,
    units_in_production_2026: inProduction,
    units_delivered_2026: delivered,
    units_delivered_this_month: deliveredThisMonth,
    units_delivered_missing_date: deliveredMissingDate,
    handover_units_ytd: handoverYTD,
    handover_projects_ytd: handoverProjects,
    handover_units_this_month: handoverThisMonth,
    balance_units_2026: SALES_TARGET_2026 - totalSalesUnits2026,
    quotations_2026: quotations2026,
    salesperson_performance,
    monthly_sales_2026,
    monthly_quotations_2026,
  });
});

// ── Project Status — Monthly Lifecycle Chart ────────────────────────────────
// Returns unit-based milestone counts per month for the selected year.
// Series included: sales, production, delivery, handover.
// Shipping and installation are excluded — no reliable milestone-date columns exist in the schema.
// Production: uses factory_ins_quotes.order_date (primary) or advance_payment_date (fallback),
//   and factory_sea_costs.advance_payment_date — both representing when the factory order was placed.
// Delivery: COALESCE per contract of (site_delivery_date, factory actual_delivery_date) — MIN across
//   all factory table rows to prevent multi-row inflation, grouped by contract_ref.
// Handover: contracts.handover_date (actual project T&C handover date).
router.get('/project-status', requireModule('dashboard'), (req, res) => {
  const yr = ((req.query.year || '') + '').replace(/\D/g,'').slice(0,4) || String(new Date().getFullYear());
  const pct = yr + '%';

  // Sales: contracts confirmed in the year (approval_date scoped)
  const salesRows = all(
    `SELECT substr(approval_date,6,2) mo, SUM(COALESCE(elevator_units,1)) u
     FROM contracts WHERE is_deleted=0 AND approval_date LIKE ? GROUP BY mo ORDER BY mo`, [pct]);

  // Production: earliest factory order date per contract (deduplicated to avoid multi-row inflation)
  // Uses UNION to merge INS and SEA order signals; contract units are summed after deduplication.
  const prodRows = all(
    `SELECT substr(sub.best_order,6,2) mo, SUM(COALESCE(c.elevator_units,1)) u
     FROM (
       SELECT contract_ref, MIN(COALESCE(order_date, advance_payment_date)) best_order
       FROM factory_ins_quotes
       WHERE COALESCE(order_date, advance_payment_date) LIKE ? AND contract_ref IS NOT NULL
       GROUP BY contract_ref
       UNION
       SELECT contract_ref, MIN(advance_payment_date) best_order
       FROM factory_sea_costs
       WHERE advance_payment_date LIKE ? AND contract_ref IS NOT NULL
       GROUP BY contract_ref
     ) sub
     LEFT JOIN contracts c ON c.contract_ref = sub.contract_ref AND c.is_deleted = 0
     WHERE sub.best_order LIKE ?
     GROUP BY mo ORDER BY mo`, [pct, pct, pct]);

  // Delivery: earliest actual delivery date per contract across all factory tables + site_delivery_date
  // Grouped by contract_ref to prevent multi-JOIN row multiplication
  const delivRows = all(
    `SELECT substr(best_date,6,2) mo, SUM(u) u FROM (
       SELECT c.contract_ref,
         MIN(COALESCE(
           CASE WHEN c.site_delivery_date != '' THEN c.site_delivery_date END,
           CASE WHEN fi.actual_delivery_date IS NOT NULL AND fi.actual_delivery_date != '' THEN fi.actual_delivery_date END,
           CASE WHEN fs.actual_delivery_date IS NOT NULL AND fs.actual_delivery_date != '' THEN fs.actual_delivery_date END,
           CASE WHEN fo.actual_delivery_date IS NOT NULL AND fo.actual_delivery_date != '' THEN fo.actual_delivery_date END
         )) best_date,
         COALESCE(c.elevator_units, 1) u
       FROM contracts c
       LEFT JOIN factory_ins_quotes fi ON fi.contract_ref = c.contract_ref
       LEFT JOIN factory_sea_costs   fs ON fs.contract_ref = c.contract_ref
       LEFT JOIN factory_otj_quotes  fo ON fo.contract_ref = c.contract_ref
       WHERE c.is_deleted = 0
       GROUP BY c.contract_ref
       HAVING best_date LIKE ?
     ) GROUP BY mo ORDER BY mo`, [pct]);

  // Handover: actual handover date on contracts
  const handRows = all(
    `SELECT substr(handover_date,6,2) mo, SUM(COALESCE(elevator_units,1)) u
     FROM contracts WHERE is_deleted=0 AND handover_date LIKE ? GROUP BY mo ORDER BY mo`, [pct]);

  const toMap = rows => Object.fromEntries((rows||[]).map(r => [r.mo, r.u||0]));
  const sm = toMap(salesRows), pm = toMap(prodRows), dm = toMap(delivRows), hm = toMap(handRows);
  const months = Array.from({length:12}, (_, i) => {
    const mm = String(i+1).padStart(2,'0');
    return { month: i+1, sales: sm[mm]||0, production: pm[mm]||0, delivery: dm[mm]||0, handover: hm[mm]||0 };
  });
  res.json({
    year: parseInt(yr), metric: 'units', months,
    series_notes: {
      sales:      'contracts.approval_date — contract confirmation date',
      production: 'factory_ins_quotes.order_date / advance_payment_date; factory_sea_costs.advance_payment_date',
      delivery:   'contracts.site_delivery_date or factory actual_delivery_date (earliest per contract)',
      handover:   'contracts.handover_date — actual project T&C handover date',
      excluded:   ['shipping — no shipping date field in schema', 'installation — no installation date field in schema'],
    },
  });
});

// ── Project Status Drill-down Detail ────────────────────────────────────────
router.get('/project-status/detail', requireModule('dashboard'), (req, res) => {
  const yr = ((req.query.year || '') + '').replace(/\D/g,'').slice(0,4) || String(new Date().getFullYear());
  const mo = req.query.month ? String(req.query.month).padStart(2,'0') : null;
  const series = (req.query.series || '').replace(/[^a-z]/g,'');
  const pct = yr + (mo ? `-${mo}%` : '%');
  let rows = [];
  if (series === 'sales') {
    rows = all(`SELECT contract_ref, client_name, emirate, sales_by, approval_date,
        COALESCE(elevator_units,1) units, delivery_status
        FROM contracts WHERE is_deleted=0 AND approval_date LIKE ? ORDER BY approval_date`, [pct]);
  } else if (series === 'production') {
    rows = all(`SELECT sub.contract_ref, c.client_name, c.emirate, sub.best_order AS order_date,
        COALESCE(c.elevator_units,1) units, c.delivery_status
        FROM (
          SELECT contract_ref, MIN(COALESCE(order_date, advance_payment_date)) best_order
          FROM factory_ins_quotes WHERE COALESCE(order_date, advance_payment_date) LIKE ? AND contract_ref IS NOT NULL GROUP BY contract_ref
          UNION
          SELECT contract_ref, MIN(advance_payment_date) best_order
          FROM factory_sea_costs WHERE advance_payment_date LIKE ? AND contract_ref IS NOT NULL GROUP BY contract_ref
        ) sub
        LEFT JOIN contracts c ON c.contract_ref=sub.contract_ref AND c.is_deleted=0
        WHERE sub.best_order LIKE ? ORDER BY sub.best_order`, [pct, pct, pct]);
  } else if (series === 'delivery') {
    rows = all(`SELECT c.contract_ref, c.client_name, c.emirate,
        MIN(COALESCE(
          CASE WHEN c.site_delivery_date != '' THEN c.site_delivery_date END,
          CASE WHEN fi.actual_delivery_date IS NOT NULL AND fi.actual_delivery_date != '' THEN fi.actual_delivery_date END,
          CASE WHEN fs.actual_delivery_date IS NOT NULL AND fs.actual_delivery_date != '' THEN fs.actual_delivery_date END,
          CASE WHEN fo.actual_delivery_date IS NOT NULL AND fo.actual_delivery_date != '' THEN fo.actual_delivery_date END
        )) delivery_date,
        COALESCE(c.elevator_units,1) units
        FROM contracts c
        LEFT JOIN factory_ins_quotes fi ON fi.contract_ref=c.contract_ref
        LEFT JOIN factory_sea_costs   fs ON fs.contract_ref=c.contract_ref
        LEFT JOIN factory_otj_quotes  fo ON fo.contract_ref=c.contract_ref
        WHERE c.is_deleted=0
        GROUP BY c.contract_ref
        HAVING delivery_date LIKE ? ORDER BY delivery_date`, [pct]);
  } else if (series === 'handover') {
    rows = all(`SELECT contract_ref, client_name, emirate, sales_by, handover_date,
        COALESCE(elevator_units,1) units, mechanical_status, electrical_status
        FROM contracts WHERE is_deleted=0 AND handover_date LIKE ? ORDER BY handover_date`, [pct]);
  }
  res.json({ year: parseInt(yr), month: mo ? parseInt(mo) : null, series, rows });
});

// ── 2026-10-03: Recent activity for the Dashboard (read-only, from audit_log) ──
// Only business modules the user's role can access are shown; admin/system
// housekeeping (users, backups, logins) is never exposed here.
const ACTIVITY_MAP = [
  [/^(quotations|sales_followup)/, 'quotations', 'Sales Quotations'],
  [/^(client_payments|factory_payments)/, 'accounts', 'Accounts & Payments'],
  [/^contracts/, 'contracts', 'Contracts'],
  [/^(maintenance_contracts|maintenance_visits|callbacks)/, 'maintenance_contracts', 'Maintenance'],
  [/^(amc_renewals|alert_)/, 'alerts', 'Alerts & Notifications'],
  [/^(factory|suppliers|lifecycle_factory_links)/, 'factory', 'Factory & Suppliers'],
];
const ACTION_VERB = { CREATE: 'Created', UPDATE: 'Updated', DELETE: 'Deleted', LINK: 'Linked', LINK_CREATE: 'Linked', UNLINK: 'Unlinked',
  VOID: 'Voided', RECONCILE: 'Reconciled', MERGE: 'Merged', ARCHIVE: 'Archived', ACTIVATE: 'Activated', DEACTIVATE: 'Deactivated', SCHEDULE_RECALC: 'Schedule recalculated' };
router.get('/recent-activity', requireModule('dashboard'), (req, res) => {
  try {
    const { canAccessModule } = require('../middleware/permissions.js');
    const role = req.session.user.role;
    const limit = Math.min(30, Math.max(1, parseInt(req.query.limit) || 10));
    const out = [];
    const rows = all(`SELECT id, action, module, record_ref, performed_by, performed_at FROM audit_log ORDER BY id DESC LIMIT 400`);
    for (const r of rows) {
      const m = ACTIVITY_MAP.find(([re]) => re.test(r.module || ''));
      if (!m || !canAccessModule(role, m[1])) continue;
      out.push({ id: r.id, module_key: m[1], module_label: m[2], action: r.action, verb: ACTION_VERB[r.action] || r.action,
        source: r.module, record_ref: r.record_ref, performed_by: r.performed_by, performed_at: r.performed_at });
      if (out.length >= limit) break;
    }
    res.json({ rows: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
