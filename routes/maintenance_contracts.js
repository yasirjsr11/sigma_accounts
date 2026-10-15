// routes/maintenance_contracts.js — rebuilt 2026-07-11
// Monthly Maintenance Tracking: per-month visit records, alert status, auto visit-log,
// technician management, next-service-date calc, full audit trail.
'use strict';
const express = require('express');
const { mcNotCancelledSql, currentEndSql } = require('../db/amcEligibility.js');
const { getMonthlyMaintenanceMetrics, getPeriodMaintenanceMetrics } = require('../db/maintMetrics.js');
const amcPay = require('../db/amcPayments.js');
const amcCol = require('../db/amcCollections.js');
const amcRen = require('../db/amcRenewals.js');
const schedEngine = require('../db/scheduleEngine.js');
const { AMC_PAYMENT_ENTRY, AMC_PAYMENT_ADMIN } = require('../middleware/permissions.js');
const { run, get, all, db } = require('../db/db.js');
const { requireModule, requireRole } = require('../middleware/auth.js');
const { filterFieldsForRole, MAINTENANCE_CONTRACTS_MANAGERS } = require('../middleware/permissions.js');
const { writeAuditLog } = require('../db/audit.js');
const { toExcelBuffer, toPdfBuffer } = require('../reports/render.js');
const router = express.Router();

const TRACKED_FIELDS = [
  'contract_ref','client_name','emirate','maintenance_type','maintenance_period',
  'start_date','end_date','renewal_status','remarks',
  'last_service_date','next_service_date','scheduling_method','next_service_from','total_elevator_units',
];
const VISIT_STATUSES  = ['Pending','Scheduled','Completed','Partially Completed','Postponed','Hold','Missed','Cancelled'];
const ALERT_STATUSES  = ['Due This Month','Overdue','Scheduled','Closed'];
const MONTH_NAMES     = ['January','February','March','April','May','June','July','August','September','October','November','December'];
// Canonical Maintenance Type values — single authoritative list for backend validation and frontend
const MAINTENANCE_TYPES = ['Free AMC','Paid Comprehensive','Non-Comprehensive','One-Time Service'];

/**
 * calculateFreeAMCEligibility — single source of truth for Free AMC date logic.
 *
 * Rule: a contract is within its Free AMC window when:
 *   handoverDate <= today  AND  today < (handoverDate + 24 calendar months)
 *
 * @param {string|null} handoverDateStr  YYYY-MM-DD from contracts.handover_date
 * @param {Date}        [referenceDate]  defaults to today (for testability)
 * @returns {{
 *   isFreeAMCEligible: boolean,
 *   freeAMCStartDate: string|null,    // YYYY-MM-DD = handoverDate
 *   freeAMCExpiryDate: string|null,   // YYYY-MM-DD = handoverDate + 24 months
 *   monthsRemaining: number|null,     // positive = months left; negative = expired that many months ago
 *   missingHandoverDate: boolean,
 *   futureHandoverDate: boolean,
 * }}
 */
function calculateFreeAMCEligibility(handoverDateStr, referenceDate) {
  const today = referenceDate instanceof Date ? referenceDate : new Date();
  today.setHours(0, 0, 0, 0);

  if (!handoverDateStr) {
    return { isFreeAMCEligible: false, freeAMCStartDate: null, freeAMCExpiryDate: null,
             monthsRemaining: null, missingHandoverDate: true, futureHandoverDate: false };
  }

  const handover = new Date(handoverDateStr + 'T00:00:00');
  if (isNaN(handover.getTime())) {
    return { isFreeAMCEligible: false, freeAMCStartDate: null, freeAMCExpiryDate: null,
             monthsRemaining: null, missingHandoverDate: true, futureHandoverDate: false };
  }

  // Future handover: not yet handed over
  if (handover > today) {
    return { isFreeAMCEligible: false, freeAMCStartDate: handoverDateStr, freeAMCExpiryDate: null,
             monthsRemaining: null, missingHandoverDate: false, futureHandoverDate: true };
  }

  // Free AMC expiry = handover + 24 calendar months (exact, not day-count approximation)
  const expiry = new Date(handover);
  expiry.setMonth(expiry.getMonth() + 24);
  const expiryStr = expiry.toISOString().slice(0, 10);

  const isFreeAMCEligible = today < expiry;

  // Months remaining (positive = in window; negative = expired N months ago)
  const todayYear = today.getFullYear(), todayMonth = today.getMonth();
  const expiryYear = expiry.getFullYear(), expiryMonth = expiry.getMonth();
  const monthsRemaining = (expiryYear - todayYear) * 12 + (expiryMonth - todayMonth);

  return {
    isFreeAMCEligible,
    freeAMCStartDate: handoverDateStr,
    freeAMCExpiryDate: expiryStr,
    monthsRemaining,
    missingHandoverDate: false,
    futureHandoverDate: false,
  };
}

function requireMCM(req, res, next) {
  if (!req.session || !req.session.user) return res.status(401).json({ error: 'Not logged in' });
  if (!MAINTENANCE_CONTRACTS_MANAGERS.includes(req.session.user.role))
    return res.status(403).json({ error: `Role ${req.session.user.role} cannot manage maintenance records` });
  next();
}

function classifyContractRef(ref) {
  if (!ref) return 'Pending Contract Ref';
  return get('SELECT id FROM contracts WHERE contract_ref=? AND is_deleted=0', [ref]) ? 'Linked' : 'Contract Ref Not Found';
}

function monthsForRecord(id) {
  return all('SELECT DISTINCT month FROM maintenance_schedule_months WHERE maintenance_contract_id=? ORDER BY month', [id]).map(r => r.month);
}

// ── Date-based scheduling engine ──────────────────────────────────────────────
// Single authoritative Maintenance Period → months mapping (db/scheduleEngine.js)
const PERIOD_TO_MONTHS = schedEngine.PERIOD_MONTHS;

// ── Scheduling eligibility — centralised rule ─────────────────────────────────
// A contract may only receive new schedule rows and visit stubs when:
//   Renewal Status is NOT Hold, Cancelled, or Renewed.
// This is the single authoritative check consumed by every schedule-producing path.
const NON_SCHEDULABLE_STATUSES = new Set(['Hold', 'Cancelled', 'Renewed']);
function isSchedulingEligible(contract) {
  return contract != null && !NON_SCHEDULABLE_STATUSES.has(contract.renewal_status);
}

// ── Suspend future uncompleted visits when contract goes Hold/Cancelled ───────
// Marks future Pending/Scheduled visits as Hold so they don't appear as Overdue/Missed.
// NEVER touches Completed, Partially Completed, Missed, or Cancelled visits.
function suspendFutureVisits(contractId, byUser) {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const targets = all(`
    SELECT id, maintenance_status FROM maintenance_visits
    WHERE maintenance_contract_id=?
      AND maintenance_status NOT IN ('Completed','Partially Completed','Missed','Cancelled','Hold')
      AND (visit_year > ? OR (visit_year = ? AND visit_month >= ?))
  `, [contractId, curYear, curYear, curMonth]);
  for (const v of targets) {
    run(`UPDATE maintenance_visits SET maintenance_status='Hold', hold_reason='Contract on Hold',
         updated_at=datetime('now') WHERE id=?`, [v.id]);
    auditVisit(v.id, 'maintenance_status', v.maintenance_status, 'Hold', byUser||'system',
               'Contract renewal_status changed to Hold/Cancelled');
  }
  return targets.length;
}

// ── Re-activate Hold-suspended visits when contract returns to Active ─────────
// Only re-activates visits that were suspended by the system (hold_reason='Contract on Hold').
// Leaves manually-held visits alone.
function resumeSuspendedVisits(contractId, byUser) {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const targets = all(`
    SELECT id FROM maintenance_visits
    WHERE maintenance_contract_id=?
      AND maintenance_status='Hold'
      AND hold_reason='Contract on Hold'
      AND (visit_year > ? OR (visit_year = ? AND visit_month >= ?))
  `, [contractId, curYear, curYear, curMonth]);
  for (const v of targets) {
    run(`UPDATE maintenance_visits SET maintenance_status='Pending', hold_reason=NULL,
         updated_at=datetime('now') WHERE id=?`, [v.id]);
    auditVisit(v.id, 'maintenance_status', 'Hold', 'Pending', byUser||'system',
               'Contract renewal_status changed back to Active');
  }
  return targets.length;
}

// ── One-time startup reconciliation: fix existing Hold/Cancelled contracts ────
// Finds future Pending visits on Hold/Cancelled contracts and suspends them.
// Safe to run multiple times (idempotent).
function reconcileHoldContracts() {
  try {
    const now = new Date();
    const curYear  = now.getFullYear();
    const curMonth = now.getMonth() + 1;
    const holdContracts = all(
      `SELECT id FROM maintenance_contracts WHERE is_deleted=0 AND renewal_status IN ('Hold','Cancelled')`
    );
    let suspended = 0;
    for (const mc of holdContracts) {
      suspended += suspendFutureVisits(mc.id, 'system:reconcile');
    }
    if (suspended > 0) console.log(`[Hold Reconciliation] Suspended ${suspended} future visit(s) for Hold/Cancelled contracts.`);
  } catch (e) {
    console.error('[Hold Reconciliation] Error:', e.message);
  }
}
// Run reconciliation once at module load
reconcileHoldContracts();

// Add n months to a YYYY-MM-DD string; clamps day to last day of target month.
function addMonthsStr(dateStr, n) {
  const parts = dateStr.split('-');
  const yr = parseInt(parts[0]);
  const mo = parseInt(parts[1]) - 1; // 0-based
  const day = parseInt(parts[2]);
  const totalMonths = yr * 12 + mo + n;
  const newYr = Math.floor(totalMonths / 12);
  const newMo = totalMonths % 12; // 0-based
  const lastDay = new Date(newYr, newMo + 1, 0).getDate();
  const clampedDay = Math.min(day, lastDay);
  return `${newYr}-${String(newMo + 1).padStart(2,'0')}-${String(clampedDay).padStart(2,'0')}`;
}

// generateSchedule() — DEPRECATED 2026-09-29. The old version iterated from the
// contract START DATE (+interval), which put Every-2-Months contracts on the wrong
// cycle (e.g. Sep/Nov instead of Oct/Dec after an August service). All regular
// scheduling now goes through db/scheduleEngine.js.
function generateSchedule(contractId, _start, _end, _period, user) {
  const plan = schedEngine.recalculateRegularSchedule(contractId, { apply: true, user: user || 'system', reason: 'Regular schedule' });
  return plan.add.length;
}

// ── Alert status logic (month-based) ─────────────────────────────────────────
function calcAlertStatus(visit) {
  if (!visit) return 'Overdue';
  // Hold visits are suspended — not overdue, not pending service obligation
  if (visit.maintenance_status === 'Hold') return 'Closed';
  if (['Completed','Partially Completed','Missed','Cancelled'].includes(visit.maintenance_status)) return 'Closed';
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const vYear = visit.visit_year;
  const vMonth = visit.visit_month;
  if (!vYear || !vMonth) return 'Overdue';
  if (vYear < curYear || (vYear === curYear && vMonth < curMonth)) return 'Overdue';
  if (vYear === curYear && vMonth === curMonth) return 'Due This Month';
  return 'Scheduled';
}

// ── Next service date calc ────────────────────────────────────────────────────
function periodToMonths(period) {
  return schedEngine.periodToInterval(period);
}
function calcNextServiceDate(baseDate, period) {
  if (!baseDate || !period) return null;
  const months = periodToMonths(period);
  if (!months) return null;
  const d = new Date(baseDate);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

// ── Visit audit helper ────────────────────────────────────────────────────────
function auditVisit(visitId, field, oldVal, newVal, changedBy, reason) {
  if (String(oldVal ?? '') === String(newVal ?? '')) return;
  run(`INSERT INTO maintenance_visit_audit (visit_id,field_name,old_value,new_value,changed_by,reason)
       VALUES (?,?,?,?,?,?)`, [visitId, field, oldVal ?? null, newVal ?? null, changedBy, reason || null]);
}

// ── Ensure visit row exists for a given contract+year+month ──────────────────
function generateVisitRef(contractRef, year, month) {
  const prefix = contractRef ? contractRef.replace(/[^A-Z0-9]/gi,'').toUpperCase().slice(0,8) : 'MC';
  return `VR-${prefix}-${year}-${String(month).padStart(2,'0')}-${Date.now().toString().slice(-4)}`;
}
function ensureVisit(mc, year, month) {
  const existing = get('SELECT * FROM maintenance_visits WHERE maintenance_contract_id=? AND visit_year=? AND visit_month=?', [mc.id, year, month]);
  if (existing) return existing;
  const visitRef = generateVisitRef(mc.contract_ref, year, month);
  run(`INSERT INTO maintenance_visits (maintenance_contract_id,contract_ref,visit_ref,visit_year,visit_month,
       scheduling_method,total_elevator_units,units_scheduled,created_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    [mc.id, mc.contract_ref, visitRef, year, month, mc.scheduling_method || 'Automatic',
     mc.total_elevator_units || null, mc.total_elevator_units || null, mc.created_by || null]);
  return get('SELECT * FROM maintenance_visits WHERE maintenance_contract_id=? AND visit_year=? AND visit_month=?', [mc.id, year, month]);
}

// ── Auto-create visit log entry on completion ─────────────────────────────────
function autoCreateVisitLog(mc, visit, username) {
  const monthStr = `${visit.visit_year}-${String(visit.visit_month).padStart(2,'0')}`;
  let _techsArr = []; try { _techsArr = JSON.parse(visit.technicians||'[]'); } catch(_) {}
  const _firstTech = _techsArr[0] || null;
  // Prevent duplicate: check by visit_id link first, then by (contract_ref, month)
  if (visit.visit_log_id) {
    const existing = get('SELECT id FROM maintenance_visit_log WHERE id=?', [visit.visit_log_id]);
    if (existing) return existing;
  }
  // Check by (contract_ref, month) to match the UNIQUE constraint on maintenance_visit_log
  const existingByRef = mc.contract_ref
    ? get('SELECT id FROM maintenance_visit_log WHERE contract_ref=? AND month=?', [mc.contract_ref, monthStr])
    : get('SELECT id FROM maintenance_visit_log WHERE maintenance_contract_id=? AND month=?', [mc.id, monthStr]);
  if (existingByRef) {
    // Update existing entry with completion data
    run(`UPDATE maintenance_visit_log SET
        status='Completed', completion_date=?, visit_date=?, technician=?, technicians=?,
        total_elevator_units=?, units_serviced=?, units_not_serviced=?,
        work_performed=?, findings=?, parts_replaced=?, pending_issues=?,
        alert_status='Closed', updated_by=?, updated_at=datetime('now'),
        scheduled_date=?, client_name=?, emirate=?
        WHERE id=?`,
      [visit.completion_date || null, visit.scheduled_date || null,
       _firstTech,
       visit.technicians || null,
       visit.total_elevator_units || mc.total_elevator_units || null,
       visit.units_serviced || null, visit.units_not_serviced || null,
       visit.work_performed || null, visit.findings || null,
       visit.parts_replaced || null, visit.pending_issues || null,
       username, visit.scheduled_date || null,
       mc.client_name || null, mc.emirate || null,
       existingByRef.id]);
    run('UPDATE maintenance_visits SET visit_log_id=? WHERE id=?', [existingByRef.id, visit.id]);
    return existingByRef;
  }
  // Create new (wrapped in try-catch to handle rare UNIQUE race conditions)
  try {
    run(`INSERT INTO maintenance_visit_log
        (maintenance_contract_id, contract_ref, month, visit_date, scheduled_date,
         technician, technicians, status, completion_date, alert_status,
         client_name, emirate, total_elevator_units, units_serviced, units_not_serviced,
         work_performed, findings, parts_replaced, pending_issues, remarks, updated_by, visit_id)
        VALUES (?,?,?,?,?,?,?,'Completed',?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [mc.id, mc.contract_ref, monthStr,
       visit.scheduled_date || null, visit.scheduled_date || null,
       _firstTech, visit.technicians || null,
       visit.completion_date || null, 'Closed',
       mc.client_name || null, mc.emirate || null,
       visit.total_elevator_units || mc.total_elevator_units || null,
       visit.units_serviced || null, visit.units_not_serviced || null,
       visit.work_performed || null, visit.findings || null,
       visit.parts_replaced || null, visit.pending_issues || null,
       visit.remarks || null, username, visit.id]);
  } catch(insertErr) {
    // UNIQUE (contract_ref, month) race — find the conflicting row and link it instead
    if (insertErr.message && insertErr.message.includes('UNIQUE')) {
      const raceLog = mc.contract_ref
        ? get('SELECT id FROM maintenance_visit_log WHERE contract_ref=? AND month=?', [mc.contract_ref, monthStr])
        : get('SELECT id FROM maintenance_visit_log WHERE maintenance_contract_id=? AND month=?', [mc.id, monthStr]);
      if (raceLog) { run('UPDATE maintenance_visits SET visit_log_id=? WHERE id=?', [raceLog.id, visit.id]); return raceLog; }
    }
    throw insertErr;
  }
  const newLog = mc.contract_ref
    ? get('SELECT id FROM maintenance_visit_log WHERE contract_ref=? AND month=?', [mc.contract_ref, monthStr])
    : get('SELECT id FROM maintenance_visit_log WHERE maintenance_contract_id=? AND month=?', [mc.id, monthStr]);
  if (newLog) run('UPDATE maintenance_visits SET visit_log_id=? WHERE id=?', [newLog.id, visit.id]);
  return newLog;
}

// ── Enrich visit rows with alert_status ──────────────────────────────────────
function enrichVisit(v) {
  v.alert_status = calcAlertStatus(v);
  try { v.technicians_arr = v.technicians ? JSON.parse(v.technicians) : []; } catch(_) { v.technicians_arr = []; }
  return v;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// ── Natural-sort helper for contract_ref (e.g. SH-2 before SH-10 before SHM-2014) ──
// Splits on the first '-': prefix part sorts alphabetically, numeric part sorts as integer.
function contractRefOrderClause(dir) {
  const pfx = `SUBSTR(COALESCE(m.contract_ref,''), 1, MAX(0, INSTR(COALESCE(m.contract_ref,'')||'-', '-')-1))`;
  const num = `CAST(SUBSTR(COALESCE(m.contract_ref,''), INSTR(COALESCE(m.contract_ref,'')||'-', '-')+1) AS INTEGER)`;
  return `${pfx} ${dir}, ${num} ${dir}`;
}

// GET / — list with filters
// mode=operational → renewal_status IN ('Active Maintenance','Hold')
// mode=cancelled   → renewal_status = 'Cancelled'
// (default: no mode restriction — all non-deleted records)
router.get('/', requireModule('maintenance_contracts'), (req, res) => {
  const { search, emirate, renewal_status, current_status, month, sort, dir, page=1, pageSize=50, mode } = req.query;
  const where = ['m.is_deleted=0']; const params = [];
  if (mode === 'operational') { where.push("m.renewal_status NOT IN ('Cancelled','Renewed')"); }
  else if (mode === 'cancelled') { where.push("m.renewal_status='Cancelled'"); }
  if (search) { where.push('(m.contract_ref LIKE ? OR m.client_name LIKE ?)'); params.push(`%${search}%`,`%${search}%`); }
  if (emirate) { where.push('m.emirate=?'); params.push(emirate); }
  if (renewal_status) { where.push('m.renewal_status=?'); params.push(renewal_status); }
  if (current_status) { where.push('m.current_status=?'); params.push(current_status); }
  if (month) { where.push('EXISTS(SELECT 1 FROM maintenance_schedule_months sm WHERE sm.maintenance_contract_id=m.id AND sm.month=?)'); params.push(Number(month)); }
  // 2026-10-03: Cancelled AMC list shows cancellation info, not schedules (schedule data stays in the DB)
  const CANCELLED_ON_SQL = `COALESCE(NULLIF(m.cancellation_date,''), (SELECT substr(MAX(h.changed_at),1,10) FROM maintenance_contract_history h
      WHERE h.maintenance_contract_id=m.id AND h.field_name='renewal_status' AND h.new_value='Cancelled'))`;
  const SORT_COLS = { maintenance_id:'m.maintenance_id', client_name:'m.client_name', emirate:'m.emirate', start_date:'m.start_date', end_date:'m.end_date', last_service_date:'m.last_service_date', next_service_date:'m.next_service_date', renewal_status:'m.renewal_status', last_updated:'m.updated_at', total_elevator_units:'m.total_elevator_units', current_status:'m.current_status',
    ...(mode === 'cancelled' ? { cancelled_on: CANCELLED_ON_SQL } : {}) };
  const sortDir = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const orderClause = (sort === 'contract_ref' || !sort)
    ? contractRefOrderClause(sortDir)
    : `${SORT_COLS[sort] || 'm.contract_ref'} ${sortDir}`;
  const whereSql = where.join(' AND ');
  const total = get(`SELECT COUNT(*) c FROM maintenance_contracts m WHERE ${whereSql}`, params).c;
  const limit = Math.min(parseInt(pageSize)||50, 500);
  const offset = (Math.max(parseInt(page)||1,1)-1)*limit;
  if (mode === 'cancelled') {
    const rows = all(`SELECT m.*, ${CANCELLED_ON_SQL} AS cancelled_on,
        COALESCE(NULLIF(TRIM(m.cancellation_reason),''), m.remarks) AS cancellation_note
      FROM maintenance_contracts m WHERE ${whereSql}
      ORDER BY ${orderClause}, m.id ASC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return res.json({ total, page: Number(page), pageSize: limit, rows });
  }
  const rows = all(`SELECT m.*,
      (SELECT GROUP_CONCAT(sm.month) FROM maintenance_schedule_months sm WHERE sm.maintenance_contract_id=m.id ORDER BY sm.month) AS schedule_months
    FROM maintenance_contracts m
    WHERE ${whereSql}
    ORDER BY ${orderClause}, m.id ASC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  rows.forEach(r => { r.schedule_months = r.schedule_months ? r.schedule_months.split(',').map(Number) : []; });
  res.json({ total, page: Number(page), pageSize: limit, rows });
});

router.get('/meta/emirates', requireModule('maintenance_contracts'), (req, res) => {
  res.json({ rows: all(`SELECT DISTINCT emirate AS name FROM maintenance_contracts WHERE is_deleted=0 AND emirate IS NOT NULL ORDER BY name`).map(r=>r.name).filter(Boolean) });
});

router.get('/meta/months', requireModule('maintenance_contracts'), (req, res) => {
  res.json({ rows: MONTH_NAMES.map((name,i) => ({ month: i+1, name })) });
});

// GET /search — search for maintenance records to link to a contract
router.get('/search', requireModule('maintenance_contracts'), (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q || q.length < 2) return res.json({ rows: [] });
  const like = `%${q}%`;
  const rows = all(`
    SELECT id, maintenance_id, contract_ref, client_name, emirate, renewal_status, current_status
    FROM maintenance_contracts
    WHERE is_deleted=0 AND (contract_ref LIKE ? OR client_name LIKE ?)
    ORDER BY client_name, contract_ref LIMIT 30`, [like, like]);
  // Exclude already-linked records (those pointed to by another contract)
  const linkedIds = all(`SELECT linked_maintenance_id FROM contracts WHERE linked_maintenance_id IS NOT NULL AND is_deleted=0`).map(r => r.linked_maintenance_id);
  const filteredRows = rows.filter(r => !linkedIds.includes(r.id));
  res.json({ rows: filteredRows });
});

router.get('/summary', requireModule('maintenance_contracts'), (req, res) => {
  res.json({
    total: get(`SELECT COUNT(*) c FROM maintenance_contracts WHERE is_deleted=0`).c,
    byStatus: all(`SELECT renewal_status, COUNT(*) c FROM maintenance_contracts WHERE is_deleted=0 GROUP BY renewal_status`),
    byCurrentStatus: all(`SELECT current_status, COUNT(*) c FROM maintenance_contracts WHERE is_deleted=0 GROUP BY current_status`),
  });
});

// ── Maintenance Dashboard (visit-based KPIs) ─────────────────────────────────
router.get('/dashboard', requireModule('maintenance_contracts'), (req, res) => {
  const now = new Date();
  const year = parseInt(req.query.year) || now.getFullYear();
  const month = parseInt(req.query.month) || now.getMonth() + 1;
  const todayStr = now.toISOString().slice(0, 10);

  const total_amc = get(`SELECT COUNT(*) c FROM maintenance_contracts WHERE is_deleted=0`).c;
  const renewals_due = get(`SELECT COUNT(*) c FROM maintenance_contracts mc WHERE mc.is_deleted=0 AND mc.end_date IS NOT NULL AND (${currentEndSql('mc')}) BETWEEN date('now') AND date('now','+30 days') AND ${mcNotCancelledSql('mc')}`).c;
  const expired_amc = get(`SELECT COUNT(*) c FROM maintenance_contracts mc WHERE mc.is_deleted=0 AND mc.renewal_status='Expired / Renewal Required' AND ${mcNotCancelledSql('mc')}`).c;

  // All scheduled visits for the year = one row per contract+month where that month is in schedule_months
  // Excludes Hold, Cancelled, and Renewed contracts — Hold contracts are not active service obligations
  const scheduledVisits = all(`
    SELECT mv.*, mc.client_name, mc.emirate, mc.maintenance_period, mc.total_elevator_units AS mc_total_units,
           mc.contract_ref AS mc_contract_ref, mc.maintenance_type, mc.maintenance_period AS interval
    FROM maintenance_schedule_months sm
    JOIN maintenance_contracts mc ON mc.id = sm.maintenance_contract_id AND mc.is_deleted=0
         AND mc.renewal_status NOT IN ('Cancelled','Renewed','Hold')
    LEFT JOIN maintenance_visits mv ON mv.maintenance_contract_id = sm.maintenance_contract_id
      AND mv.visit_year = ? AND mv.visit_month = sm.month
    WHERE sm.schedule_year = ? AND sm.month = ?`,
    [year, year, month]);

  // ── Unit-based KPI counting (not visit-based) ────────────────────────────
  // Each row may have units_scheduled (or fall back to total_elevator_units)
  // Completion is based on actual units_serviced, not visit status alone.
  let total_scheduled=0, completed=0, pending=0, postponed=0, hold=0, overdue=0, missed=0, cancelled=0, partial=0;
  let visit_count=0, visit_completed=0;
  const upcomingList=[], dueTodayList=[], overdueList=[], postponedList=[], holdList=[], completedList=[], missedList=[], pendingList=[];

  for (const v of scheduledVisits) {
    const schedUnits = v.units_scheduled || v.total_elevator_units || v.mc_total_units || 1;
    const servUnits  = (v.units_serviced != null) ? Number(v.units_serviced) : 0;
    const status     = v.maintenance_status || 'Pending';
    const alert      = calcAlertStatus(v);
    let techs = []; try { techs = v.technicians ? JSON.parse(v.technicians) : []; } catch(_) {}

    total_scheduled += schedUnits;
    visit_count++;

    const row = {
      id: v.id, contract_ref: v.contract_ref || v.mc_contract_ref,
      client_name: v.client_name, emirate: v.emirate,
      visit_year: v.visit_year || year, visit_month: v.visit_month || month,
      service_month: MONTH_NAMES[(v.visit_month||month)-1],
      scheduled_date: v.postponed_date || v.scheduled_date,
      maintenance_status: status, alert_status: alert,
      technicians_arr: techs,
      units_scheduled: schedUnits, units_serviced: servUnits,
      units_not_serviced: Math.max(0, schedUnits - servUnits),
      total_elevator_units: v.total_elevator_units || v.mc_total_units,
      maintenance_type: v.maintenance_type,
    };

    if (status === 'Completed' || status === 'Partially Completed') {
      completed += servUnits;
      if (status === 'Completed') visit_completed++;
      if (status === 'Partially Completed') partial += schedUnits - servUnits;
      completedList.push(row);
    } else if (status === 'Postponed') {
      postponed += schedUnits;
      postponedList.push(row);
    } else if (status === 'Hold') {
      hold += schedUnits;
      holdList.push(row);
    } else if (status === 'Missed') {
      missed += schedUnits;
      missedList.push(row);
    } else if (status === 'Cancelled') {
      cancelled += schedUnits;
    } else {
      // Pending / Scheduled / no-visit-yet
      if (alert === 'Overdue') {
        overdue += schedUnits;
        overdueList.push(row);
      } else {
        pending += schedUnits;
        pendingList.push(row);
        if (alert === 'Upcoming') upcomingList.push(row);
        else if (alert === 'Due Today') dueTodayList.push(row);
      }
    }
  }

  // 2026-09-28: headline unit KPIs from the authoritative metrics service
  // (lists above are kept for the detail views).
  const _dm = getMonthlyMaintenanceMetrics(year, month);
  total_scheduled = _dm.scheduledUnits; completed = _dm.completedUnits; pending = _dm.pendingUnits;
  postponed = _dm.postponedUnits; hold = _dm.holdUnits; missed = _dm.missedUnits; partial = _dm.partialRemainingUnits;
  // Unserviced units: those in partially/not completed visits
  const unserviced = partial + missed;
  const completion_pct = _dm.completionPct;   // Completed / Due

  // Emirate-wise summary (unit-based)
  const emirateMap = {};
  const contractsByEmirate = all(`SELECT TRIM(emirate) AS emirate, COUNT(*) c FROM maintenance_contracts WHERE is_deleted=0 GROUP BY TRIM(emirate)`);
  for (const r of contractsByEmirate) {
    const e = (r.emirate || 'Unknown').trim();
    emirateMap[e] = { emirate: e, contracts: r.c, scheduled:0, completed:0, pending:0, postponed:0, hold:0, overdue:0 };
  }
  for (const v of scheduledVisits) {
    const e = (v.emirate || 'Unknown').trim();
    if (!emirateMap[e]) emirateMap[e] = { emirate: e, contracts: 0, scheduled:0, completed:0, pending:0, postponed:0, hold:0, overdue:0 };
    const schedUnits = v.units_scheduled || v.total_elevator_units || v.mc_total_units || 1;
    const servUnits  = (v.units_serviced != null) ? Number(v.units_serviced) : 0;
    const status = v.maintenance_status || 'Pending';
    const alert  = calcAlertStatus(v);
    emirateMap[e].scheduled += schedUnits;
    if (status === 'Completed' || status === 'Partially Completed') emirateMap[e].completed += servUnits;
    else if (status === 'Postponed') emirateMap[e].postponed += schedUnits;
    else if (status === 'Hold') emirateMap[e].hold += schedUnits;
    else if (status === 'Missed') { /* included as overdue/unserviced */ }
    else if (status !== 'Cancelled') emirateMap[e].pending += schedUnits;
    if (alert === 'Overdue') emirateMap[e].overdue += schedUnits;
  }
  const emirate_summary = Object.values(emirateMap).map(e => ({
    ...e, completion_pct: e.scheduled > 0 ? Math.round((e.completed/e.scheduled)*1000)/10 : 0
  }));

  res.json({
    year, month, today: todayStr,
    total_amc, renewals_due, expired_amc,
    // Unit-based operational KPIs
    total_scheduled, completed, pending, postponed, hold, overdue, missed, unserviced, partial,
    completion_pct,
    // Visit counts for reference
    visit_count, visit_completed,
    upcoming_count: upcomingList.length, due_today_count: dueTodayList.length,
    upcoming: upcomingList, due_today: dueTodayList, overdue_list: overdueList,
    postponed_list: postponedList, hold_list: holdList,
    completed_list: completedList, pending_list: pendingList,
    cancelled, missed_list: missedList,
    emirate_summary,
  });
});


// ── Monthly Calendar ───────────────────────────────────────────────────────────
router.get('/calendar', requireModule('maintenance_contracts'), (req, res) => {
  const now = new Date();
  const year  = parseInt(req.query.year)  || now.getFullYear();
  const month = parseInt(req.query.month) || now.getMonth() + 1;
  const todayStr = now.toISOString().slice(0, 10);
  // ── 2026-09-28: ALL summary figures come from the authoritative metrics service ──
  // (db/maintMetrics.js). Previously Due was computed from schedule rows while
  // Scheduled/Completed were summed from EVERY visit row in the month — including
  // stale placeholder visits for months no longer on the schedule and visits of
  // Hold/Cancelled contracts, and ignoring the page filters — producing e.g.
  // 117 Due vs 122 Scheduled for Sep 2026.
  const calFilters = {
    contract_ref: req.query.contract_ref, client: req.query.client,
    emirate: req.query.emirate, maintenance_type: req.query.maintenance_type,
  };
  const metrics = getMonthlyMaintenanceMetrics(year, month, calFilters);
  const popVisitIds = new Set(metrics.rows.filter(r => r.visit_id).map(r => r.visit_id));
  const contracts = metrics.rows.map(r => ({
    id: r.contract_id, maintenance_id: r.maintenance_id, contract_ref: r.contract_ref,
    client_name: r.client_name, emirate: r.emirate, maintenance_type: r.maintenance_type,
    maintenance_period: r.maintenance_period, total_elevator_units: r.due_units,
    source: r.source, sched_units: r.sched_units, status: r.status,
  }));
  const visitRowsAll = all(`
    SELECT mv.id, mv.maintenance_contract_id, mv.contract_ref, mv.visit_ref,
           mv.lift_no, mv.visit_type, mv.maintenance_status,
           mv.scheduled_date, mv.postponed_date, mv.completion_date,
           mv.units_scheduled, mv.units_serviced, mv.total_elevator_units, mv.technicians,
           mv.hold_date, mv.hold_reason, mv.postponement_reason, mv.remarks,
           mv.original_scheduled_date,
           mc.client_name, mc.emirate, mc.maintenance_type,
           mc.total_elevator_units AS contract_units,
           sm.schedule_date AS schedule_month_date
    FROM maintenance_visits mv
    JOIN maintenance_contracts mc ON mc.id = mv.maintenance_contract_id
    LEFT JOIN maintenance_schedule_months sm
      ON sm.maintenance_contract_id = mv.maintenance_contract_id
      AND sm.schedule_year = mv.visit_year
      AND sm.month = mv.visit_month
    WHERE mv.visit_year = ? AND mv.visit_month = ? AND mc.is_deleted = 0
    ORDER BY COALESCE(mv.completion_date, mv.postponed_date, mv.scheduled_date, sm.schedule_date), mv.id
  `, [year, month]);
  // Only visits that belong to the authoritative service population are shown and
  // counted (orphan placeholders for non-scheduled months are excluded; filters apply).
  const visitRows = visitRowsAll.filter(v => popVisitIds.has(v.id));
  const visitedContractIds = new Set(visitRows.map(v => v.maintenance_contract_id));
  const dayMap = {};
  const allEntries = [];
  for (const v of visitRows) {
    // Completed/Partially Completed → pin to actual completion date (may differ from scheduled).
    // Postponed → use revised date. Everything else → use scheduled_date, then fall back to
    // schedule_month_date (manually set planned date from maintenance_schedule_months).
    let effDate;
    if (v.maintenance_status === 'Postponed' && v.postponed_date) {
      effDate = v.postponed_date.slice(0, 10);
    } else if ((v.maintenance_status === 'Completed' || v.maintenance_status === 'Partially Completed') && v.completion_date) {
      effDate = v.completion_date.slice(0, 10);
    } else {
      effDate = v.scheduled_date
        ? v.scheduled_date.slice(0, 10)
        : (v.schedule_month_date ? v.schedule_month_date.slice(0, 10) : null);
    }
    const entry = {
      visit_id: v.id, contract_id: v.maintenance_contract_id,
      contract_ref: v.contract_ref, client_name: v.client_name,
      emirate: v.emirate, maintenance_type: v.maintenance_type,
      maintenance_status: v.maintenance_status, visit_type: v.visit_type,
      lift_no: v.lift_no, visit_ref: v.visit_ref,
      scheduled_date: v.scheduled_date
        ? v.scheduled_date.slice(0, 10)
        : (v.schedule_month_date ? v.schedule_month_date.slice(0, 10) : null),
      schedule_month_date: v.schedule_month_date ? v.schedule_month_date.slice(0, 10) : null,
      postponed_date: v.postponed_date ? v.postponed_date.slice(0, 10) : null,
      completion_date: v.completion_date ? v.completion_date.slice(0, 10) : null,
      hold_date: v.hold_date ? v.hold_date.slice(0, 10) : null,
      effective_date: effDate,
      units_scheduled: v.units_scheduled || v.total_elevator_units || v.contract_units || 0,
      units_serviced: v.units_serviced || 0,
      total_elevator_units: v.total_elevator_units || v.contract_units || 0,
      technicians: v.technicians,
      original_scheduled_date: v.original_scheduled_date ? v.original_scheduled_date.slice(0, 10) : null,
      hold_reason: v.hold_reason, postponement_reason: v.postponement_reason,
      remarks: v.remarks,
    };
    allEntries.push(entry);
    if (effDate) {
      if (!dayMap[effDate]) dayMap[effDate] = { entries: [], sched_units: 0, comp_units: 0 };
      dayMap[effDate].entries.push(entry);
      dayMap[effDate].sched_units += (entry.units_scheduled || entry.total_elevator_units || 0);
      if (v.maintenance_status === 'Completed' || v.maintenance_status === 'Partially Completed') dayMap[effDate].comp_units += v.units_serviced || 0;
    }
  }
  // ── Unit-based tracking maps ──────────────────────────────────────────────────
  // visitUnitsMap: contract_id → units_scheduled in visit records (supports partial scheduling)
  const visitUnitsMap = {};
  const visitStatusMap = {};
  for (const v of visitRows) {
    const u = v.units_scheduled || v.total_elevator_units || v.contract_units || 0;
    visitUnitsMap[v.maintenance_contract_id] = (visitUnitsMap[v.maintenance_contract_id] || 0) + u;
    if (!visitStatusMap[v.maintenance_contract_id]) visitStatusMap[v.maintenance_contract_id] = v.maintenance_status;
  }
  // Total AMC Units (Due) — authoritative metrics
  const total_amc_units = metrics.dueUnits;
  // Not-yet-logged detail: population rows where some/all units have no visit record yet
  const unscheduled = contracts
    .map(c => {
      const unitsLogged = visitUnitsMap[c.id] || 0;
      const unschedUnits = Math.max(0, (c.total_elevator_units || 0) - unitsLogged);
      return {
        contract_id: c.id, maintenance_id: c.maintenance_id,
        contract_ref: c.contract_ref, client_name: c.client_name,
        emirate: c.emirate, maintenance_type: c.maintenance_type,
        maintenance_period: c.maintenance_period || null,
        total_elevator_units: c.total_elevator_units || 0,
        units_logged: unitsLogged,
        unscheduled_units: unschedUnits,
        assigned_technician: c.assigned_technician,
      };
    })
    .filter(c => c.unscheduled_units > 0);
  const unscheduled_units = unscheduled.reduce((s, c) => s + c.unscheduled_units, 0);
  // All due contracts list for Total AMC Units drill-down
  const allDueContracts = contracts.map(c => {
    const unitsLogged = visitUnitsMap[c.id] || 0;
    return {
      contract_id: c.id, maintenance_id: c.maintenance_id,
      contract_ref: c.contract_ref, client_name: c.client_name,
      emirate: c.emirate, maintenance_type: c.maintenance_type,
      maintenance_period: c.maintenance_period || null,
      total_elevator_units: c.total_elevator_units || 0,
      units_logged: unitsLogged,
      unscheduled_units: Math.max(0, (c.total_elevator_units || 0) - unitsLogged),
      visit_status: visitStatusMap[c.id] || 'Not Logged',
    };
  });
  const total_visits = visitRows.length;
  // Unit-based summary — every figure from the authoritative metrics (same population)
  const total_scheduled_units = metrics.scheduledUnits;
  const completed_units = metrics.completedUnits;
  const pending_units   = metrics.pendingUnits;
  const postponed_units = metrics.postponedUnits;
  const hold_units      = metrics.holdUnits;
  const missed_units    = metrics.missedUnits;
  const partial_units   = metrics.partialRemainingUnits;
  // Completion % = Completed / Due (approved definition), capped at 100 by the service
  const completion_pct  = metrics.completionPct;
  // Legacy visit counts for backward compat
  const completed_v = visitRows.filter(v => v.maintenance_status === 'Completed').length;
  const pending_v   = visitRows.filter(v => ['Pending','Scheduled'].includes(v.maintenance_status)).length;
  const postponed_v = visitRows.filter(v => v.maintenance_status === 'Postponed').length;
  const hold_v      = visitRows.filter(v => v.maintenance_status === 'Hold').length;
  res.json({
    year, month, today: todayStr,
    days: dayMap,
    unscheduled,
    allDueContracts,
    summary: {
      total_visits,
      total_amc_units,
      total_scheduled_units, completed_units, pending_units, postponed_units,
      hold_units, missed_units, partial_units, completion_pct,
      unscheduled_units,
      unscheduled_count: unscheduled.length, // contract count (backward compat)
      regular_due_units: metrics.regularDueUnits,
      recovery_units: metrics.recoveryUnits,
      unscheduled_due_units: metrics.unscheduledDueUnits,
      kpi_valid: metrics.valid,
      // legacy visit-count fields
      completed: completed_v, pending: pending_v, postponed: postponed_v, hold: hold_v,
    },
  });
});

// ── Monthly schedule (12 views) ───────────────────────────────────────────────
function buildMonthlySchedule(year, month, teamFilter) {
  // 2026-09-28: rows = the authoritative monthly service population (db/maintMetrics.js),
  // so the Monthly Schedule / Monthly Maintenance Report reconcile exactly with the
  // Calendar and Dashboard (regular + manual + recovery rows; orphan placeholders excluded).
  const metrics = getMonthlyMaintenanceMetrics(year, month);
  const rows = [];
  for (const pr of metrics.rows) {
    const c = get('SELECT * FROM maintenance_contracts WHERE id=?', [pr.contract_id]);
    if (!c) continue;
    let visit = pr.visit_id ? get('SELECT * FROM maintenance_visits WHERE id=?', [pr.visit_id]) : null;
    const schedMonth = get('SELECT schedule_date FROM maintenance_schedule_months WHERE maintenance_contract_id=? AND schedule_year=? AND month=?', [c.id, year, month]);
    let techs = []; try { techs = visit && visit.technicians ? JSON.parse(visit.technicians) : []; } catch(_) {}
    const assignedTech = techs[0] || null;
    if (teamFilter && !techs.includes(teamFilter)) continue;
    const alertStatus = calcAlertStatus(visit);
    // scheduled_service_date: use visit postponed_date → visit scheduled_date → schedule_month.schedule_date
    const schedServiceDate = visit
      ? (visit.postponed_date || visit.scheduled_date || (schedMonth && schedMonth.schedule_date) || null)
      : (schedMonth && schedMonth.schedule_date) || null;
    rows.push({
      month: `${year}-${String(month).padStart(2,'0')}`,
      contract_ref: c.contract_ref, client_name: c.client_name, emirate: c.emirate,
      renewal_status: c.renewal_status,
      maintenance_start_date: c.start_date, maintenance_end_date: c.end_date,
      scheduled_service_date: schedServiceDate,
      assigned_technician: assignedTech,
      technicians_arr: techs,
      service_status: visit ? visit.maintenance_status : 'Pending',
      alert_status: alertStatus,
      completion_date: visit ? visit.completion_date : null,
      remarks: (visit && visit.remarks) || c.remarks,
      visit_id: visit ? visit.id : null,
      schedule_source: pr.source,            // regular | manual | recovery
      due_units: pr.due_units, scheduled_units: pr.sched_units,
      completed_units: pr.completed_units, remaining_units: pr.sched_units - pr.completed_units,
    });
  }
  rows.sort((a,b) => (a.emirate||'').localeCompare(b.emirate||'')||(a.contract_ref||'').localeCompare(b.contract_ref||''));
  return rows;
}

router.get('/schedule', requireModule('maintenance_contracts'), (req, res) => {
  const now = new Date();
  const year = parseInt(req.query.year) || now.getFullYear();
  const month = parseInt(req.query.month) || (now.getMonth()+1);
  const rows = buildMonthlySchedule(year, month, req.query.team || null);
  res.json({ month: `${year}-${String(month).padStart(2,'0')}`, monthName: `${MONTH_NAMES[month-1]} Maintenance`, total: rows.length, rows });
});

function scheduleReport(year, month, team) {
  const rows = buildMonthlySchedule(year, month, team || null);
  const columns = ['Contract Ref.','Client/Company Name','Emirate','Scheduled Month','Alert Status','Status','Actual Completion Date','Remarks'];
  const dataRows = rows.map(r => [r.contract_ref, r.client_name, r.emirate, r.month||'', r.alert_status||'', r.service_status||'Pending', r.completion_date||'', r.remarks||'']);
  return { title: `Sigma Height Elevators - ${MONTH_NAMES[month-1]} Maintenance - ${year}${team?` - ${team}`:''}`, columns, rows: dataRows };
}

router.get('/schedule.xlsx', requireModule('maintenance_contracts'), async (req, res) => {
  const now = new Date();
  const year = parseInt(req.query.year) || now.getFullYear();
  const month = parseInt(req.query.month) || (now.getMonth()+1);
  const buf = await toExcelBuffer(scheduleReport(year, month, req.query.team));
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',`attachment; filename="maintenance-schedule-${year}-${String(month).padStart(2,'0')}.xlsx"`);
  res.send(buf);
});

router.get('/schedule.pdf', requireModule('maintenance_contracts'), async (req, res) => {
  const now = new Date();
  const year = parseInt(req.query.year) || now.getFullYear();
  const month = parseInt(req.query.month) || (now.getMonth()+1);
  const buf = await toPdfBuffer(scheduleReport(year, month, req.query.team));
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition',`attachment; filename="maintenance-schedule-${year}-${String(month).padStart(2,'0')}.pdf"`);
  res.send(buf);
});


// ── Apply Suggested from Period = Recalculate Regular Schedule (idempotent) ───
// POST /:id/auto-generate   body { preview?: true }
// Uses the central frequency engine: regular months continue the ESTABLISHED
// cycle (anchored on the latest completed regular month), from the current month
// to the end of the current AMC period. Removes only off-cycle future AUTO months
// with no genuine visit; manual months, completed / missed / postponed / hold
// months and all history are preserved. Running it repeatedly changes nothing.
router.post('/:id/auto-generate', requireModule('maintenance_contracts'), (req, res) => {
  try {
    const contract = get('SELECT * FROM maintenance_contracts WHERE id=? AND is_deleted=0', [req.params.id]);
    if (!contract) return res.status(404).json({ error: 'Not found' });
    if (!isSchedulingEligible(contract)) {
      return res.status(422).json({
        hold: true,
        error: `Maintenance scheduling is suspended because this contract is currently "${contract.renewal_status}". ` +
               `Change the Renewal Status to Active Maintenance to resume scheduling.`,
      });
    }
    if (contract.maintenance_type === 'One-Time Service') {
      return res.status(422).json({
        error: `Auto-generate is not available for One-Time Service contracts. ` +
               `One-Time Service visits must be scheduled manually via the Monthly Schedule tab.`,
      });
    }
    if (!schedEngine.periodToInterval(contract.maintenance_period)) {
      return res.status(400).json({ error: `Cannot suggest: maintenance_period "${contract.maintenance_period}" is not a standard period. Set a period first.` });
    }
    if (!contract.start_date || !contract.end_date) {
      return res.status(400).json({ error: 'Cannot suggest: contract is missing start_date or end_date.' });
    }
    const preview = !!(req.body && req.body.preview);
    const plan = schedEngine.recalculateRegularSchedule(contract, {
      apply: !preview, user: req.session.user.username, reason: 'Apply Suggested from Period',
    });
    if (plan.applied) {
      writeAuditLog({ action: 'SCHEDULE_RECALC', module: 'maintenance_contracts', recordId: contract.id,
        recordRef: contract.maintenance_id || contract.contract_ref,
        details: { batch: plan.batch_ref, anchor: plan.anchor && plan.anchor.label, added: plan.add.map(x => `${x.year}-${x.month}`),
                   removed: plan.remove.map(x => `${x.year}-${x.month}`) },
        performedBy: req.session.user.username });
    }
    const schedule = all('SELECT schedule_year, month, schedule_date, schedule_status, schedule_source, schedule_remarks FROM maintenance_schedule_months WHERE maintenance_contract_id=? ORDER BY schedule_year, month', [contract.id]);
    res.json({ preview, generated_slots: plan.add.length, added: plan.add, removed: plan.remove, review: plan.review,
               anchor: plan.anchor, period: plan.period, interval: plan.interval, schedule });
  } catch(err) {
    console.error('[auto-generate] error:', err);
    res.status(500).json({ error: 'Auto-generate failed: ' + err.message });
  }
});

// ── Schedule diagnostic for one month (read-only) ─────────────────────────────
// GET /schedule-engine/diagnostic?year=&month=  — explains every scheduled unit.
router.get('/schedule-engine/diagnostic', requireModule('maintenance_contracts'), (req, res) => {
  try {
    const now = new Date();
    const year = parseInt(req.query.year) || now.getFullYear();
    const month = parseInt(req.query.month) || (now.getMonth() + 1);
    const m = getMonthlyMaintenanceMetrics(year, month, {});
    const idx = schedEngine.ymIndex(year, month);
    const rows = m.rows.map(r => {
      const mc = get('SELECT * FROM maintenance_contracts WHERE id=?', [r.contract_id]);
      const iv = schedEngine.periodToInterval(mc.maintenance_period);
      const anchor = schedEngine.getCycleAnchor(mc);
      const onCycle = iv && anchor.idx != null ? ((idx - anchor.idx) % iv + iv) % iv === 0 : null;
      return { contract_ref: r.contract_ref, units: r.sched_units, maintenance_period: mc.maintenance_period,
        expected_due: r.source === 'manual' || r.source === 'recovery' ? 'Manual/Recovery'
          : (!iv ? 'No standard period' : onCycle ? 'Yes'
          : (['Completed', 'Partially Completed'].includes(r.status) ? 'Off-cycle (service performed — kept as history)' : 'NO')),
        schedule_exists: r.source !== 'recovery', schedule_source: r.schedule_source || r.source,
        cycle_anchor: anchor.label, status: r.status };
    });
    res.json({ year, month, scheduledUnits: m.scheduledUnits, dueUnits: m.dueUnits, completedUnits: m.completedUnits,
      offCycle: rows.filter(r => r.expected_due !== 'Yes'), invalid: rows.filter(r => r.expected_due === 'NO'), rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── System-wide regular schedule audit / controlled rebuild (admin) ───────────
// POST /schedule-engine/recalculate-all  body { apply?: false }
// Dry-run by default; apply realigns only records whose future auto months are
// off their established cycle.
router.post('/schedule-engine/recalculate-all', requireRole('admin'), (req, res) => {
  try {
    const apply = !!(req.body && req.body.apply);
    const batch = `RECALC-ALL-${new Date().toISOString().slice(0,19).replace(/[-:T]/g,'')}`;
    const plans = schedEngine.auditAllRegularSchedules({ apply, user: req.session.user.username, batchRef: batch,
      reason: 'System-wide regular schedule recalculation' });
    const affected = plans.filter(p => p.remove.length || p.add.length || p.review.length);
    if (apply && affected.length) {
      writeAuditLog({ action: 'SCHEDULE_RECALC_ALL', module: 'maintenance_contracts', recordId: null, recordRef: batch,
        details: { contracts: affected.map(p => p.contract_ref) }, performedBy: req.session.user.username });
    }
    res.json({ apply, batch_ref: apply ? batch : null, checked: plans.length, affected: affected.map(p => ({
      contract_ref: p.contract_ref, period: p.maintenance_period, anchor: p.anchor && p.anchor.label,
      remove: p.remove, add: p.add, review: p.review })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Print / full export ───────────────────────────────────────────────────────
// GET /print — returns all filtered records + summary for the browser print view.
// No pagination; safe cap of 2000 rows.
router.get('/print', requireModule('maintenance_contracts'), (req, res) => {
  try {
    const { search, emirate, renewal_status, current_status, month, sort, dir, mode } = req.query;
    const where = ['m.is_deleted=0']; const params = [];
    if (mode === 'operational') { where.push("m.renewal_status NOT IN ('Cancelled','Renewed')"); }
    else if (mode === 'cancelled') { where.push("m.renewal_status='Cancelled'"); }
    if (search) { where.push('(m.contract_ref LIKE ? OR m.client_name LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
    if (emirate) { where.push('m.emirate=?'); params.push(emirate); }
    if (renewal_status) { where.push('m.renewal_status=?'); params.push(renewal_status); }
    if (current_status) { where.push('m.current_status=?'); params.push(current_status); }
    if (month) { where.push('EXISTS(SELECT 1 FROM maintenance_schedule_months sm WHERE sm.maintenance_contract_id=m.id AND sm.month=?)'); params.push(Number(month)); }
    const SORT_COLS = { maintenance_id:'m.maintenance_id', client_name:'m.client_name', emirate:'m.emirate', start_date:'m.start_date', end_date:'m.end_date', last_service_date:'m.last_service_date', next_service_date:'m.next_service_date', renewal_status:'m.renewal_status', last_updated:'m.updated_at', total_elevator_units:'m.total_elevator_units' };
    const sortDir = String(dir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const orderClause = (sort === 'contract_ref' || !sort)
      ? contractRefOrderClause(sortDir)
      : `${SORT_COLS[sort] || 'm.contract_ref'} ${sortDir}`;
    const whereSql = where.join(' AND ');

    const rows = all(`
      SELECT m.*,
        (SELECT GROUP_CONCAT(sm.month) FROM maintenance_schedule_months sm WHERE sm.maintenance_contract_id=m.id ORDER BY sm.month) AS schedule_months,
        lv.maintenance_status AS latest_visit_status,
        lv.scheduled_date     AS latest_visit_scheduled,
        lv.completion_date    AS latest_visit_completed,
        lv.technicians        AS latest_technicians,
        ar.payment_status     AS amc_payment_status,
        ar.amc_activation_status,
        ar.renewal_ref        AS latest_renewal_ref,
        ar.renewal_status     AS amc_renewal_status
      FROM maintenance_contracts m
      LEFT JOIN (
        SELECT v1.*
        FROM maintenance_visits v1
        INNER JOIN (
          SELECT maintenance_contract_id, MAX(id) AS max_id
          FROM maintenance_visits
          GROUP BY maintenance_contract_id
        ) v2 ON v1.maintenance_contract_id=v2.maintenance_contract_id AND v1.id=v2.max_id
      ) lv ON m.id=lv.maintenance_contract_id
      LEFT JOIN (
        SELECT ar1.*
        FROM amc_renewals ar1
        INNER JOIN (
          SELECT contract_ref, MAX(id) AS max_id
          FROM amc_renewals WHERE is_deleted=0
          GROUP BY contract_ref
        ) ar2 ON ar1.contract_ref=ar2.contract_ref AND ar1.id=ar2.max_id
      ) ar ON m.contract_ref=ar.contract_ref
      WHERE ${whereSql}
      ORDER BY ${orderClause}, m.id ASC
      LIMIT 2000
    `, params);

    rows.forEach(r => {
      r.schedule_months = r.schedule_months ? r.schedule_months.split(',').map(Number) : [];
      r.contract_link_status = classifyContractRef(r.contract_ref);
    });

    // ── Summary from the filtered result set ──
    const now = new Date();
    const curYear  = now.getFullYear();
    const curMonth = now.getMonth() + 1;
    const todayStr = now.toISOString().split('T')[0];

    const totalContracts      = rows.length;
    const totalElevatorUnits  = rows.reduce((s, r) => s + (r.total_elevator_units || 0), 0);
    const activeAMC           = rows.filter(r => r.renewal_status === 'Active Maintenance').length;
    const holdAMC             = rows.filter(r => r.renewal_status === 'Hold').length;
    const expiredAMC          = rows.filter(r => r.renewal_status && r.renewal_status !== 'Active Maintenance' && r.renewal_status !== 'Hold').length;
    const renewalPending      = rows.filter(r => r.amc_renewal_status && ['Pending','Under Review'].includes(r.amc_renewal_status)).length;
    const paymentPending      = rows.filter(r => r.amc_payment_status && !['Paid','Hold','Later'].includes(r.amc_payment_status)).length;

    // Visit stats for the current month, scoped to the same filter set
    const monthVisits = all(`
      SELECT v.maintenance_status, v.scheduled_date, v.postponed_date
      FROM maintenance_visits v
      WHERE v.visit_year=? AND v.visit_month=?
        AND EXISTS(SELECT 1 FROM maintenance_contracts m WHERE m.id=v.maintenance_contract_id AND ${whereSql})
    `, [curYear, curMonth, ...params]);

    let scheduledThisMonth = 0, completedThisMonth = 0, overdueThisMonth = 0;
    monthVisits.forEach(v => {
      const st = v.maintenance_status || '';
      if (['Completed','Partially Completed'].includes(st)) {
        completedThisMonth++;
      } else if (st !== 'Cancelled') {
        const dueDate = v.postponed_date || v.scheduled_date;
        if (st === 'Missed' || (dueDate && dueDate < todayStr)) overdueThisMonth++;
        else scheduledThisMonth++;
      }
    });

    res.json({
      rows,
      summary: {
        totalContracts, totalElevatorUnits,
        activeAMC, holdAMC, expiredAMC,
        renewalPending, paymentPending,
        scheduledThisMonth, completedThisMonth, overdueThisMonth,
        reportMonth: MONTH_NAMES[curMonth - 1],
        reportYear:  curYear,
      },
    });
  } catch (e) {
    console.error('[maintenance/print]', e);
    res.status(500).json({ error: 'Failed to generate print report' });
  }
});

// ── Comprehensive Management Dashboard ───────────────────────────────────────
router.get('/maint-dashboard', requireModule('maintenance_contracts'), (req, res) => {
  try {
    const now        = new Date();
    const y          = parseInt(req.query.year) || now.getFullYear();
    const monthParam = req.query.month;
    // monthAll=true when month='all' or not provided → show full-year view
    const monthAll   = !monthParam || monthParam === 'all';
    const m          = monthAll ? null : (parseInt(monthParam) || now.getMonth() + 1);

    // Optional filters
    const emirate        = req.query.emirate        || null;
    const mtype          = req.query.type           || null;
    const ren_status     = req.query.renewal_status || null;
    const pay_status     = req.query.payment_status || null;

    // Build WHERE clauses for maintenance_contracts (operational filters)
    const mcConds = ['mc.is_deleted=0'];
    const mcP     = [];
    if (emirate)    { mcConds.push('mc.emirate=?');           mcP.push(emirate); }
    if (mtype)      { mcConds.push('mc.maintenance_type=?'); mcP.push(mtype); }
    if (ren_status) { mcConds.push('mc.renewal_status=?');   mcP.push(ren_status); }
    const mcWhere = mcConds.join(' AND ');

    // amc_renewals – core filters (emirate/type/renewal_status only — NO payment_status)
    // Used for global financial KPIs so payment filter doesn't zero-out Total Received
    const arCoreConds = ['ar.is_deleted=0'];
    const arCoreP     = [];
    if (emirate)    { arCoreConds.push('ar.emirate=?');          arCoreP.push(emirate); }
    if (mtype)      { arCoreConds.push('ar.maintenance_type=?'); arCoreP.push(mtype); }
    if (ren_status) { arCoreConds.push('ar.renewal_status=?');   arCoreP.push(ren_status); }
    const arWhereCore = arCoreConds.join(' AND ');

    // amc_renewals – full filters including payment_status (for receivables detail only)
    const arConds = [...arCoreConds];
    const arP     = [...arCoreP];
    if (pay_status) { arConds.push('ar.payment_status=?'); arP.push(pay_status); }
    const arWhere = arConds.join(' AND ');

    // ── 1. Portfolio KPIs ────────────────────────────────────────────────────
    // NOTE: renewal_status in maintenance_contracts: 'Active Maintenance','Hold',
    //   'Expired / Renewal Required','Cancelled'  (NOT current_status which tracks contract linking)
    const p_total     = get(`SELECT COUNT(*) c, COALESCE(SUM(mc.total_elevator_units),0) u FROM maintenance_contracts mc WHERE ${mcWhere}`, mcP);
    const p_active    = get(`SELECT COUNT(*) c, COALESCE(SUM(mc.total_elevator_units),0) u FROM maintenance_contracts mc WHERE ${mcWhere} AND mc.renewal_status='Active Maintenance'`, mcP);
    const p_hold      = get(`SELECT COUNT(*) c FROM maintenance_contracts mc WHERE ${mcWhere} AND mc.renewal_status='Hold'`, mcP);
    const p_cancelled = get(`SELECT COUNT(*) c FROM maintenance_contracts mc WHERE ${mcWhere} AND mc.renewal_status='Cancelled'`, mcP);
    const p_exp30     = get(`SELECT COUNT(*) c FROM maintenance_contracts mc WHERE ${mcWhere} AND ${mcNotCancelledSql('mc')} AND (${currentEndSql('mc')}) BETWEEN date('now') AND date('now','+30 days')`, mcP);
    const p_exp60     = get(`SELECT COUNT(*) c FROM maintenance_contracts mc WHERE ${mcWhere} AND ${mcNotCancelledSql('mc')} AND (${currentEndSql('mc')}) BETWEEN date('now','+31 days') AND date('now','+60 days')`, mcP);
    const p_exp90     = get(`SELECT COUNT(*) c FROM maintenance_contracts mc WHERE ${mcWhere} AND ${mcNotCancelledSql('mc')} AND (${currentEndSql('mc')}) BETWEEN date('now','+61 days') AND date('now','+90 days')`, mcP);
    const p_expired   = get(`SELECT COUNT(*) c FROM maintenance_contracts mc WHERE ${mcWhere} AND mc.renewal_status='Expired / Renewal Required'`, mcP);
    // Renewed = contracts with an Approved renewal in amc_renewals (Approved + Active AMC)
    const p_renewed_r = get(`SELECT COUNT(DISTINCT mc.id) c, COALESCE(SUM(mc.total_elevator_units),0) u
      FROM maintenance_contracts mc
      INNER JOIN amc_renewals ar ON ar.contract_ref=mc.contract_ref AND ar.is_deleted=0
        AND ar.renewal_status='Approved' AND ar.amc_activation_status='Active'
      WHERE mc.is_deleted=0`, []);

    const portfolio = {
      total: p_total.c, total_units: p_total.u,
      active: p_active.c, active_units: p_active.u,
      hold: p_hold.c, cancelled: p_cancelled.c,
      expiring_30: p_exp30.c, expiring_60: p_exp60.c, expiring_90: p_exp90.c,
      expired: p_expired.c,
      renewed: p_renewed_r.c, renewed_units: p_renewed_r.u,
    };

    // ── 2. 12-Month Service Trend ────────────────────────────────────────────
    // Mode A (specific month): rolling 12 months ending at selected month
    // Mode B (all months):     Jan–Dec of selected year
    const monthly_service = [];
    const _svcMonths = monthAll
      ? Array.from({length:12}, (_,i) => ({ yr: y, mo: i+1 }))
      : Array.from({length:12}, (_,i) => {
          const d = new Date(y, m - 1 - (11 - i), 1);
          return { yr: d.getFullYear(), mo: d.getMonth() + 1 };
        });
    // 2026-09-28: every month comes from the authoritative metrics service — identical
    // to the Monthly Calendar for the same month and filters (no separate SQL).
    const _mdFilters = { emirate, maintenance_type: mtype, renewal_status: ren_status };
    for (const { yr, mo } of _svcMonths) {
      const mm = getMonthlyMaintenanceMetrics(yr, mo, _mdFilters);
      monthly_service.push({
        year: yr, month: mo,
        due: mm.dueUnits,
        scheduled: mm.scheduledUnits,
        completed: mm.completedFullUnits,      // fully completed visits (units)
        partial: mm.partialServicedUnits,      // serviced portion of partial visits (units)
        completed_total: mm.completedUnits,    // = completed + partial (Calendar "Completed Units")
        recovery: mm.recoveryUnits,
        completion_pct: mm.completionPct,
        valid: mm.valid,
      });
    }

    // ── 3. AMC Expiry Analysis ───────────────────────────────────────────────
    const exp_base = `SELECT mc.contract_ref, mc.client_name, mc.emirate, mc.maintenance_type,
      ${currentEndSql('mc')} AS end_date, mc.total_elevator_units, mc.renewal_status, mc.assigned_technician
      FROM maintenance_contracts mc WHERE ${mcWhere} AND ${mcNotCancelledSql('mc')}`;
    const expiry_d30 = all(`${exp_base} AND (${currentEndSql('mc')}) BETWEEN date('now') AND date('now','+30 days') ORDER BY end_date`, mcP);
    const expiry_d60 = all(`${exp_base} AND (${currentEndSql('mc')}) BETWEEN date('now','+31 days') AND date('now','+60 days') ORDER BY end_date`, mcP);
    const expiry_d90 = all(`${exp_base} AND (${currentEndSql('mc')}) BETWEEN date('now','+61 days') AND date('now','+90 days') ORDER BY end_date`, mcP);

    // ── 4. Renewal Performance ───────────────────────────────────────────────
    // Portfolio-wide totals (all-time, not filtered by period)
    const ren_total     = get(`SELECT COUNT(*) c FROM amc_renewals ar WHERE ${arWhereCore}`, arCoreP);
    const ren_approved  = get(`SELECT COUNT(*) c FROM amc_renewals ar WHERE ${arWhereCore} AND ar.renewal_status='Approved'`, arCoreP);
    // Renewed units from currently approved+active renewals (portfolio snapshot)
    const ren_approved_units = get(`SELECT COALESCE(SUM(mc.total_elevator_units),0) u
      FROM amc_renewals ar
      JOIN maintenance_contracts mc ON mc.contract_ref=ar.contract_ref AND mc.is_deleted=0
      WHERE ar.is_deleted=0 AND ar.renewal_status='Approved' AND ar.amc_activation_status='Active'`, []);

    // 2026-10-07: Period renewal performance from the ONE renewal service (db/amcRenewals.js),
    // shared with Reports → AMC Portfolio & Renewal and the Monthly Management Report.
    // Completed renewal = Approved + Active + payment received; month = first payment date;
    // units = Maintenance Record units (deduplicated per renewal).
    const _perf = amcRen.getRenewalPerformance(y, { emirate, maintenance_type: mtype, payment_status: pay_status });
    const _perfScope = monthAll ? _perf.total : _perf.months[m - 1];
    const ren_approved_p = { c: _perfScope.renewals, projects: _perfScope.projects };
    const ren_units_p = { u: _perfScope.units };

    // Pending / cancelled shown as portfolio-wide counts (no payment date to filter by)
    const ren_pending_p   = get(`SELECT COUNT(*) c FROM amc_renewals ar WHERE ${arWhereCore} AND ar.renewal_status='Pending'`, arCoreP);
    const ren_cancelled_p = get(`SELECT COUNT(*) c FROM amc_renewals ar WHERE ${arWhereCore} AND ar.renewal_status IN ('Cancelled','Rejected')`, arCoreP);

    // Renewal trend by month — c = renewals, p = projects, u = units, val = AMC value
    const ren_trend = _perf.months.filter(x => x.renewals > 0).map(x => ({ mo: x.month, c: x.renewals, p: x.projects, u: x.units, val: x.amc_value }));

    const renewals = {
      // Portfolio snapshot (all-time)
      total_portfolio: ren_total.c, approved_portfolio: ren_approved.c,
      approved_units: ren_approved_units.u,
      // Period-specific (by first payment date in selected month or year)
      approved: ren_approved_p.c,
      approved_projects_period: ren_approved_p.projects,
      approved_units_period: ren_units_p.u,
      pending: ren_pending_p.c, cancelled: ren_cancelled_p.c,
      trend: ren_trend,  // each row: { mo, c (projects/renewals), u (units), val (AMC value) }
    };

    // ── 5. Financial KPIs ────────────────────────────────────────────────────
    // CTE: one current row per contract_ref; uses amc_payment_transactions for accurate totals.
    // arCoreConds already has is_deleted=0 + optional emirate/mtype/renewal_status.
    const finCoreConds = [...arCoreConds, "ar.renewal_status NOT IN ('Cancelled','Rejected')"];
    const finCoreWhere = finCoreConds.join(' AND ');
    const finCTE = `
      WITH per_contract AS (
        SELECT COALESCE(
          MAX(CASE WHEN amc_activation_status IN ('Active','Hold') THEN id ELSE NULL END),
          MAX(id)
        ) AS current_id
        FROM amc_renewals
        WHERE is_deleted=0 AND renewal_status NOT IN ('Cancelled','Rejected')
        GROUP BY contract_ref
      ),
      fin_cur AS (
        SELECT ar.*,
          COALESCE(txn.total_received, 0) AS total_received
        FROM amc_renewals ar
        INNER JOIN per_contract pc ON pc.current_id = ar.id
        LEFT JOIN (
          SELECT amc_renewal_id, SUM(amount) AS total_received
          FROM amc_payment_transactions
          GROUP BY amc_renewal_id
        ) txn ON txn.amc_renewal_id = ar.id
        WHERE ${finCoreWhere}
      )`;

    // Portfolio = sum of new_amc_value for one current row per contract
    const fin_portfolio = get(`${finCTE} SELECT COALESCE(SUM(fc.new_amc_value),0) s, COUNT(*) c FROM fin_cur fc`, arCoreP);
    // Total Received = SUM(transactions) for current rows where payment was made
    const fin_received = get(`${finCTE} SELECT COALESCE(SUM(fc.total_received),0) s, COUNT(*) c FROM fin_cur fc WHERE fc.total_received > 0`, arCoreP);
    // Outstanding = portfolio value - received; unpaid_count from derived status
    const fin_outstanding = get(`${finCTE}
      SELECT
        COALESCE(SUM(fc.new_amc_value),0) - COALESCE(SUM(fc.total_received),0) balance,
        COUNT(CASE WHEN fc.payment_status != 'Paid' THEN 1 END) unpaid_count
      FROM fin_cur fc`, arCoreP);
    // Count by payment status (derived from transactions, best-effort from stored payment_status)
    const fin_by_pay = all(`${finCTE} SELECT fc.payment_status, COUNT(*) c, COALESCE(SUM(fc.new_amc_value),0) val
      FROM fin_cur fc GROUP BY fc.payment_status ORDER BY c DESC`, arCoreP);

    // 2026-10-07: AMC Collections — ONE authoritative calculation (db/amcCollections.js),
    // shared with Reports & Analytics → AMC Payments. Valid ledger transactions by their
    // actual payment_date (not the renewal's latest payment date / renewal total).
    // Only emirate / maintenance type filter collections; payment & renewal status do
    // not hide historical receipts.
    const _col = amcCol.getAmcCollections(y, { emirate, maintenance_type: mtype });
    const fin_monthly = _col.months.filter(x => x.payment_count > 0)
      .map(x => ({ mo: x.month, collected: x.received_amount, c: x.payment_count }));
    const _colPeriod = monthAll ? _col.total : _col.months[m - 1];
    const fin_received_period = { s: _colPeriod.received_amount, c: _colPeriod.payment_count };
    const fin_missing_date = { c: _col.missing_date.payment_count, s: _col.missing_date.received_amount };

    // 2026-09-29: Outstanding AMC Payment Due — Σ per-renewal balance of the CURRENT renewal
    // of each contract (db/amcPayments.js getOutstandingAMC). One balance per renewal; never
    // repeated per month; independent of expiry / activation status.
    const _od = amcPay.getOutstandingAMC({ emirate, maintenance_type: mtype, renewal_status: ren_status });
    const financial = {
      outstanding_due: _od.total_due,
      outstanding_count: _od.rows.length,
      payment_status_breakdown: _od.by_status,   // { Paid|Partial|Unpaid: { count, units } }
      total_amc_value:  fin_portfolio.s,
      total_received:   fin_received.s,
      received_count:   fin_received.c,
      total_receivable: _od.total_due,                    // kept for backward compatibility
      unpaid_count:     _od.by_status.Unpaid.count,
      by_payment_status: fin_by_pay,
      monthly_collection: fin_monthly,   // Jan–Dec of selected year
      received_period:    fin_received_period.s,    // amount received IN selected period
      received_period_count: fin_received_period.c,
      payments_missing_date:   fin_missing_date.c,   // count: amount_paid>0 but payment_date NULL
      payments_missing_amount: fin_missing_date.s,   // sum of undated valid ledger payments (never assigned to a month)
      collections_total_year: _col.total.received_amount,
      collections_count_year: _col.total.payment_count,
      collections_basis: _col.basis,
      collections_filters_ignored: [pay_status && 'Payment Status', ren_status && 'Renewal Status'].filter(Boolean),
      pay_status_filter: pay_status || null,
    };

    // ── 6. Top Receivables by Client ─────────────────────────────────────────
    // Uses full arWhere (including payment_status filter); deduped via CTE
    const recvCoreWhere = [...arCoreConds, "ar.renewal_status NOT IN ('Cancelled','Rejected')"].join(' AND ');
    const receivables = all(`
      WITH per_contract_r AS (
        SELECT COALESCE(
          MAX(CASE WHEN amc_activation_status IN ('Active','Hold') THEN id ELSE NULL END),
          MAX(id)
        ) AS current_id
        FROM amc_renewals WHERE is_deleted=0 AND renewal_status NOT IN ('Cancelled','Rejected')
        GROUP BY contract_ref
      ),
      rec_cur AS (
        SELECT ar.*, COALESCE(txn.total_received,0) AS total_received
        FROM amc_renewals ar
        INNER JOIN per_contract_r pc ON pc.current_id=ar.id
        LEFT JOIN (SELECT amc_renewal_id, SUM(amount) total_received FROM amc_payment_transactions GROUP BY amc_renewal_id) txn
          ON txn.amc_renewal_id=ar.id
        WHERE ${recvCoreWhere}
      )
      SELECT rc.client_name,
        COUNT(*) renewals,
        COALESCE(SUM(rc.new_amc_value),0) amc_value,
        COALESCE(SUM(rc.total_received),0) paid,
        COALESCE(SUM(rc.new_amc_value - rc.total_received),0) balance
      FROM rec_cur rc
      WHERE rc.payment_status != 'Paid'
      GROUP BY rc.client_name ORDER BY balance DESC LIMIT 10`, arCoreP);

    // ── 7. Emirate Portfolio ──────────────────────────────────────────────────
    const emirate_summary = all(`SELECT mc.emirate,
      COUNT(*) contracts,
      COALESCE(SUM(mc.total_elevator_units),0) units
      FROM maintenance_contracts mc WHERE ${mcWhere}
      GROUP BY mc.emirate ORDER BY contracts DESC`, mcP);

    // ── 8. Maintenance Type Summary ───────────────────────────────────────────
    const type_summary = all(`SELECT mc.maintenance_type,
      COUNT(*) contracts,
      COALESCE(SUM(mc.total_elevator_units),0) units
      FROM maintenance_contracts mc WHERE ${mcWhere}
      GROUP BY mc.maintenance_type ORDER BY contracts DESC`, mcP);

    // ── 9. Upcoming Workload (next 30 days based on next_service_date) ────────
    const upcoming_workload = all(`SELECT mc.contract_ref, mc.client_name, mc.emirate,
      mc.maintenance_type, mc.next_service_date, mc.total_elevator_units, mc.assigned_technician
      FROM maintenance_contracts mc WHERE ${mcWhere}
        AND mc.next_service_date BETWEEN date('now') AND date('now','+30 days')
      ORDER BY mc.next_service_date LIMIT 25`, mcP);

    // ── 10. Service Health (based on last_service_date) ───────────────────────
    const sh_30  = get(`SELECT COUNT(*) c FROM maintenance_contracts mc WHERE ${mcWhere} AND mc.last_service_date >= date('now','-30 days')`, mcP);
    const sh_90  = get(`SELECT COUNT(*) c FROM maintenance_contracts mc WHERE ${mcWhere} AND mc.last_service_date BETWEEN date('now','-90 days') AND date('now','-31 days')`, mcP);
    const sh_old = get(`SELECT COUNT(*) c FROM maintenance_contracts mc WHERE ${mcWhere} AND mc.last_service_date IS NOT NULL AND mc.last_service_date!='' AND mc.last_service_date < date('now','-90 days')`, mcP);
    const sh_nil = get(`SELECT COUNT(*) c FROM maintenance_contracts mc WHERE ${mcWhere} AND (mc.last_service_date IS NULL OR mc.last_service_date='')`, mcP);

    const service_health = {
      serviced_30d: sh_30.c,
      serviced_31_90d: sh_90.c,
      overdue_90d: sh_old.c,
      no_history: sh_nil.c,
    };

    // ── 11. Service Status (unit-based, period-scoped) ─────────────────────────
    // Authoritative source for all service KPIs on the Dashboard.
    // Logic mirrors GET /monthly-schedule/:year/:month — Dashboard ↔ Schedule reconcile.
    //
    // Classification rules:
    //   Scheduled Month  = sm.month (year-agnostic schedule definition)
    //   Year filter      = mv.visit_year = y
    //   No visit record  → status treated as 'Pending'
    //   Unit counts:
    //     sched_units    = mc.total_elevator_units ?? 1  (authoritative: contract-level)
    //     units_serviced = mv.units_serviced  ?? 0  (set on Completed/Partial)
    //
    // Excludes Cancelled and Hold contracts (no active scheduled maintenance)
    // monthAll=true → all 12 months of year y; specific → only sm.month = m

    // 2026-09-28: service KPIs come from the authoritative metrics service
    // (db/maintMetrics.js) — same population as Monthly Calendar & 12 Month Trend.
    const _svcPeriods = monthAll
      ? Array.from({ length: 12 }, (_, i) => ({ year: y, month: i + 1 }))
      : [{ year: y, month: m }];
    const _svcM = getPeriodMaintenanceMetrics(_svcPeriods, { emirate, maintenance_type: mtype, renewal_status: ren_status });
    const svc_scheduled = _svcM.scheduledUnits, svc_completed = _svcM.completedUnits,
          svc_pending = _svcM.pendingUnits, svc_hold = _svcM.holdUnits,
          svc_postponed = _svcM.postponedUnits, svc_missed = _svcM.missedUnits,
          svc_partial_done = _svcM.partialServicedUnits, svc_partial_remain = _svcM.partialRemainingUnits;
    const svc_detail = { completed: [], pending: [], hold: [], partial: [], postponed: [], missed: [] };
    for (const r of _svcM.rows) {
      if (r.status === 'Completed' && !r.partial_remaining_units) svc_detail.completed.push(r);
      else if (r.status === 'Partially Completed' || r.partial_remaining_units) svc_detail.partial.push(r);
      else if (r.status === 'Hold') svc_detail.hold.push(r);
      else if (r.status === 'Postponed') svc_detail.postponed.push(r);
      else if (r.status === 'Missed') svc_detail.missed.push(r);
      else svc_detail.pending.push(r);
    }
    // Cap detail arrays — full drill-down available via service-status-detail endpoint
    Object.keys(svc_detail).forEach(k => { svc_detail[k] = svc_detail[k].slice(0, 150); });

    const service_status = {
      scheduled_units: svc_scheduled,
      completed_units: svc_completed,
      pending_units:   svc_pending,
      hold_units:      svc_hold,
      partial_units:   svc_partial_done,    // serviced portion of Partially Completed
      partial_remain:  svc_partial_remain,  // remaining unserviced portion
      postponed_units: svc_postponed,
      missed_units:    svc_missed,
      due_units:       _svcM.dueUnits,
      recovery_units:  _svcM.recoveryUnits,
      unscheduled_due_units: _svcM.unscheduledDueUnits,
      completion_pct:  _svcM.completionPct,   // Completed / Due — same definition as Calendar
      kpi_valid:       _svcM.valid,
      detail:          svc_detail,
    };

    // Contracts past end_date that are still in 'Expired / Renewal Required' status
    const ex_expired = all(`SELECT mc.contract_ref, mc.client_name, mc.emirate, mc.maintenance_type, mc.end_date
      FROM maintenance_contracts mc WHERE mc.is_deleted=0 AND mc.end_date < date('now')
        AND mc.renewal_status='Expired / Renewal Required' AND ${mcNotCancelledSql('mc')} ORDER BY mc.end_date DESC LIMIT 10`);

    // Backward-compat exceptions object (used by Requires Attention in frontend)
    const exceptions = {
      pending:           svc_pending,
      hold:              svc_hold,
      postponed:         svc_postponed,
      missed:            svc_missed,
      partial:           svc_partial_done,
      expired_contracts: ex_expired,
    };

    // ── 12. Callbacks Snapshot ────────────────────────────────────────────────
    const cb_open  = get(`SELECT COUNT(*) c FROM alert_callbacks WHERE is_deleted=0 AND callback_status='Open'`);
    const cb_prog  = get(`SELECT COUNT(*) c FROM alert_callbacks WHERE is_deleted=0 AND callback_status='In Progress'`);
    const cb_res   = get(`SELECT COUNT(*) c FROM alert_callbacks WHERE is_deleted=0 AND callback_status='Resolved'`);
    const cb_tot   = get(`SELECT COUNT(*) c FROM alert_callbacks WHERE is_deleted=0`);
    const cb_high  = get(`SELECT COUNT(*) c FROM alert_callbacks WHERE is_deleted=0 AND priority='High' AND callback_status!='Resolved'`);
    const cb_recent= all(`SELECT callback_ref, contract_ref, client_name, priority, callback_status,
      complaint_datetime, assigned_technician FROM alert_callbacks
      WHERE is_deleted=0 ORDER BY complaint_datetime DESC LIMIT 6`);

    const callbacks = {
      total: cb_tot.c, open: cb_open.c, in_progress: cb_prog.c,
      resolved: cb_res.c, high_priority: cb_high.c,
      recent: cb_recent,
    };

    res.json({
      meta: { year: y, month: m, month_mode: monthAll ? 'all' : 'month' },
      portfolio,
      monthly_service,
      expiry_analysis: { d30: expiry_d30, d60: expiry_d60, d90: expiry_d90 },
      renewals,
      financial,
      receivables,
      emirate_summary,
      type_summary,
      upcoming_workload,
      service_health,
      service_status,   // unit-based, period-scoped — primary service KPI source
      exceptions,       // backward-compat (now sourced from service_status)
      callbacks,
    });
  } catch (e) {
    console.error('[maint-dashboard]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Payment drill-down: period payments OR missing-date payments ─────────────
// GET /maint-dashboard/payments?year=&month=&mode=period|missing
router.get('/maint-dashboard/payments', requireModule('maintenance_contracts'), (req, res) => {
  try {
    const now  = new Date();
    const y    = parseInt(req.query.year) || now.getFullYear();
    const mRaw = req.query.month;
    const mAll = !mRaw || mRaw === 'all';
    const m    = mAll ? null : (parseInt(mRaw) || now.getMonth() + 1);
    const mode = req.query.mode === 'missing' ? 'missing' : 'period';

    // 2026-10-07: legacy endpoint (no UI caller) — now served by the authoritative
    // AMC collections service so no second collection calculation exists.
    const f = { emirate: req.query.emirate || null, maintenance_type: req.query.mtype || req.query.type || null };
    if (mode === 'missing') {
      const r = amcCol.getAmcMissingDateTransactions(f);
      return res.json({ mode, year: y, month: null, monthAll: true, rows: r.rows, total: r.received_amount, count: r.payment_count });
    }
    const r = amcCol.getAmcCollectionTransactions(y, mAll ? null : m, f);
    return res.json({ mode, year: y, month: m, monthAll: mAll, rows: r.rows, total: r.received_amount, count: r.payment_count });
  } catch (e) {
    console.error('[maint-dashboard/payments]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Financial drill-down ──────────────────────────────────────────────────────
// GET /maint-dashboard/financial-detail?type=portfolio|received_all|received_period|outstanding|missing_payment_date
//   &year=&month=&emirate=&mtype=&renewal_status=
router.get('/maint-dashboard/financial-detail', requireModule('maintenance_contracts'), (req, res) => {
  try {
    const now  = new Date();
    const y    = parseInt(req.query.year) || now.getFullYear();
    const mRaw = req.query.month;
    const mAll = !mRaw || mRaw === 'all';
    const m    = mAll ? null : (parseInt(mRaw) || now.getMonth() + 1);
    const type = req.query.type || 'portfolio';

    const emirate    = req.query.emirate        || null;
    const mtype      = req.query.mtype          || null;
    const ren_status = req.query.renewal_status || null;

    const conds = ['ar.is_deleted=0'];
    const params = [];
    if (emirate)    { conds.push('ar.emirate=?');          params.push(emirate); }
    if (mtype)      { conds.push('ar.maintenance_type=?'); params.push(mtype); }
    if (ren_status) { conds.push('ar.renewal_status=?');   params.push(ren_status); }
    const baseWhere = conds.join(' AND ');

    // CTE: one current row per contract_ref (Active/Hold preferred, else max id)
    // Mirrors the same deduplication used in GET /api/renewals
    const dedupCTE = `
      WITH per_contract AS (
        SELECT COALESCE(
          MAX(CASE WHEN amc_activation_status IN ('Active','Hold') THEN id ELSE NULL END),
          MAX(id)
        ) AS current_id
        FROM amc_renewals
        WHERE is_deleted=0 AND renewal_status NOT IN ('Cancelled','Rejected')
        GROUP BY contract_ref
      ),
      cur AS (
        SELECT ar.*,
          COALESCE(txn.total_received, 0) AS total_received,
          COALESCE(ar.new_amc_value,0) - COALESCE(txn.total_received,0) AS balance
        FROM amc_renewals ar
        INNER JOIN per_contract pc ON pc.current_id = ar.id
        LEFT JOIN (
          SELECT amc_renewal_id, SUM(amount) AS total_received
          FROM amc_payment_transactions
          GROUP BY amc_renewal_id
        ) txn ON txn.amc_renewal_id = ar.id
        WHERE ar.is_deleted=0 AND ar.renewal_status NOT IN ('Cancelled','Rejected')
      )`;

    // Outer WHERE clauses applied after CTE (filters on cur.*)
    const outerConds = [];
    const outerParams = [...params]; // copy base filter params (emirate/mtype/renewal_status already baked into CTE via baseWhere? No — CTE is unfiltered; apply filters on outer)
    // Re-apply filters on cur alias (CTE doesn't use baseWhere)
    const outerFilterConds = [];
    if (emirate)    { outerFilterConds.push('cur.emirate=?'); }
    if (mtype)      { outerFilterConds.push('cur.maintenance_type=?'); }
    if (ren_status) { outerFilterConds.push('cur.renewal_status=?'); }
    const outerWhere = outerFilterConds.length ? `WHERE ${outerFilterConds.join(' AND ')}` : '';

    const baseSelect = `${dedupCTE}
      SELECT cur.id, cur.renewal_ref, cur.contract_ref, cur.client_name, cur.emirate,
        cur.maintenance_type, cur.new_amc_value,
        cur.total_received AS amount_paid,
        cur.balance,
        cur.payment_status, cur.amc_activation_status, cur.renewal_status,
        cur.new_start_date, cur.new_end_date, cur.payment_date,
        cur.invoice_ref, cur.approval_date, cur.updated_at
      FROM cur ${outerWhere}`;

    let rows = [], summary = {};

    if (type === 'portfolio') {
      rows = all(`${baseSelect} ORDER BY cur.client_name, cur.renewal_ref`, outerParams);
      const tot = get(`${dedupCTE} SELECT COALESCE(SUM(cur.new_amc_value),0) s, COUNT(*) c FROM cur ${outerWhere}`, outerParams);
      summary = { count: tot.c, total: tot.s, label: 'Total AMC Portfolio' };

    } else if (type === 'received_all') {
      const recWhere = outerWhere ? `${outerWhere} AND cur.total_received > 0` : `WHERE cur.total_received > 0`;
      rows = all(`${dedupCTE} SELECT cur.id, cur.renewal_ref, cur.contract_ref, cur.client_name, cur.emirate, cur.maintenance_type, cur.new_amc_value, cur.total_received AS amount_paid, cur.balance, cur.payment_status, cur.amc_activation_status, cur.renewal_status, cur.new_start_date, cur.new_end_date, cur.payment_date, cur.invoice_ref, cur.approval_date, cur.updated_at FROM cur ${recWhere} ORDER BY cur.client_name, cur.renewal_ref`, outerParams);
      const tot = get(`${dedupCTE} SELECT COALESCE(SUM(cur.total_received),0) s, COUNT(*) c FROM cur ${recWhere}`, outerParams);
      summary = { count: tot.c, total: tot.s, label: 'Total Received (All)' };

    } else if (type === 'received_period') {
      // 2026-10-07: transaction-level, same service as the AMC Collections chart and
      // Reports → AMC Payments → drill-down total always equals the month / year total.
      const tx = amcCol.getAmcCollectionTransactions(y, mAll ? null : m, { emirate, maintenance_type: mtype });
      rows = tx.rows.map(t => ({ ...t, id: t.amc_renewal_id, amount_paid: t.amount }));
      summary = { count: tx.payment_count, total: tx.received_amount, row_kind: 'transaction',
        label: mAll ? `AMC Collections ${y}` : `AMC Collections ${new Date(y, m-1).toLocaleString('en',{month:'long'})} ${y}` };
    } else if (type === 'outstanding') {
      // Same function as the dashboard KPI → drill-down total always equals the card.
      const od = amcPay.getOutstandingAMC({ emirate, maintenance_type: mtype, renewal_status: ren_status });
      rows = od.rows;
      summary = { count: od.rows.length, total: od.total_due, label: 'Outstanding AMC Payment Due', by_status: od.by_status };

    } else if (type === 'missing_payment_date') {
      // Valid ledger payments without a payment date — flagged, never assigned to a month.
      const mt = amcCol.getAmcMissingDateTransactions({ emirate, maintenance_type: mtype });
      rows = mt.rows.map(t => ({ ...t, id: t.amc_renewal_id, amount_paid: t.amount }));
      summary = { count: mt.payment_count, total: mt.received_amount, row_kind: 'transaction', label: 'Payment Date Missing' };

    } else {
      return res.status(400).json({ error: 'Invalid type' });
    }

    res.json({ type, year: y, month: m, monthAll: mAll, summary, rows, row_kind: summary.row_kind || 'renewal' });
  } catch (e) {
    console.error('[maint-dashboard/financial-detail]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Operational drill-down ────────────────────────────────────────────────────
// GET /maint-dashboard/operational-detail?optype=total|active|hold|cancelled|expiring_30|expiring_60|expiring_90|expired|renewed
//   &emirate=&mtype=&renewal_status=
router.get('/maint-dashboard/operational-detail', requireModule('maintenance_contracts'), (req, res) => {
  try {
    const optype = req.query.optype || 'total';
    const emirate    = req.query.emirate        || null;
    const mtype      = req.query.mtype          || null;
    const ren_status = req.query.renewal_status || null;

    const conds = ['mc.is_deleted=0'];
    const params = [];
    if (emirate)    { conds.push('mc.emirate=?');           params.push(emirate); }
    if (mtype)      { conds.push('mc.maintenance_type=?'); params.push(mtype); }
    if (ren_status) { conds.push('mc.renewal_status=?');   params.push(ren_status); }
    const mcWhere = conds.join(' AND ');

    const baseSelect = `SELECT mc.maintenance_id, mc.contract_ref, mc.client_name, mc.emirate,
      mc.maintenance_type, mc.maintenance_period, mc.start_date, mc.end_date,
      mc.renewal_status, mc.total_elevator_units, mc.assigned_technician,
      mc.last_service_date, mc.next_service_date, mc.current_status
      FROM maintenance_contracts mc WHERE ${mcWhere}`;

    const LABELS = {
      total: 'Total Contracts', active: 'Active Maintenance', hold: 'On Hold',
      cancelled: 'Cancelled', expiring_30: 'Expiring ≤30 Days', expiring_60: 'Expiring ≤60 Days',
      expiring_90: 'Expiring ≤90 Days', expired: 'Expired', renewed: 'Renewed (Active)',
    };

    let rows = [];
    if (optype === 'total') {
      rows = all(`${baseSelect} ORDER BY mc.contract_ref`, params);
    } else if (optype === 'active') {
      rows = all(`${baseSelect} AND mc.renewal_status='Active Maintenance' ORDER BY mc.contract_ref`, params);
    } else if (optype === 'hold') {
      rows = all(`${baseSelect} AND mc.renewal_status='Hold' ORDER BY mc.contract_ref`, params);
    } else if (optype === 'cancelled') {
      rows = all(`${baseSelect} AND mc.renewal_status='Cancelled' ORDER BY mc.contract_ref`, params);
    } else if (optype === 'expiring_30') {
      rows = all(`${baseSelect} AND ${mcNotCancelledSql('mc')} AND (${currentEndSql('mc')}) BETWEEN date('now') AND date('now','+30 days') ORDER BY mc.end_date`, params);
    } else if (optype === 'expiring_60') {
      rows = all(`${baseSelect} AND ${mcNotCancelledSql('mc')} AND (${currentEndSql('mc')}) BETWEEN date('now','+31 days') AND date('now','+60 days') ORDER BY mc.end_date`, params);
    } else if (optype === 'expiring_90') {
      rows = all(`${baseSelect} AND ${mcNotCancelledSql('mc')} AND (${currentEndSql('mc')}) BETWEEN date('now','+61 days') AND date('now','+90 days') ORDER BY mc.end_date`, params);
    } else if (optype === 'expired') {
      rows = all(`${baseSelect} AND mc.renewal_status='Expired / Renewal Required' AND ${mcNotCancelledSql('mc')} ORDER BY mc.end_date DESC`, params);
    } else if (optype === 'renewed') {
      rows = all(`SELECT mc.maintenance_id, mc.contract_ref, mc.client_name, mc.emirate,
        mc.maintenance_type, mc.maintenance_period, mc.start_date, mc.end_date,
        mc.renewal_status, mc.total_elevator_units, mc.assigned_technician,
        mc.last_service_date, mc.next_service_date, mc.current_status,
        ar.renewal_ref, ar.new_start_date, ar.new_end_date, ar.new_amc_value, ar.amount_paid
        FROM maintenance_contracts mc
        INNER JOIN amc_renewals ar ON ar.contract_ref=mc.contract_ref AND ar.is_deleted=0
          AND ar.renewal_status='Approved' AND ar.amc_activation_status='Active'
        WHERE mc.is_deleted=0
        ORDER BY mc.contract_ref`, []);
    } else {
      return res.status(400).json({ error: 'Invalid optype' });
    }

    res.json({ optype, label: LABELS[optype] || optype, summary: { count: rows.length }, rows });
  } catch (e) {
    console.error('[maint-dashboard/operational-detail]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Renewal month drill-down ──────────────────────────────────────────────────
// GET /maint-dashboard/renewal-month-detail?year=2026&mo=8
// Returns all approved renewals whose first payment date falls in the given year+month
router.get('/maint-dashboard/renewal-month-detail', requireModule('maintenance_contracts'), (req, res) => {
  // 2026-10-07: served by db/amcRenewals.js — same population / month rule / units as the
  // Renewal Performance chart; dashboard filters are applied server-side.
  try {
    const now = new Date();
    const y   = parseInt(req.query.year || now.getFullYear(), 10);
    const mo  = parseInt(req.query.mo || req.query.month || (now.getMonth() + 1), 10);
    if (!(mo >= 1 && mo <= 12)) return res.status(400).json({ error: 'month must be 1–12' });
    const d = amcRen.getRenewalMonthDetails(y, mo, { emirate: req.query.emirate || null, maintenance_type: req.query.type || req.query.mtype || null,
      payment_status: req.query.payment_status || null });
    const rows = d.rows.map(r => ({ id: r.id, renewal_ref: r.renewal_ref, contract_ref: r.contract_ref, client_name: r.client_name, emirate: r.emirate,
      maintenance_type: r.maintenance_type, prev_start_date: r.prev_start_date, prev_end_date: r.prev_end_date, new_start_date: r.new_start_date, new_end_date: r.new_end_date,
      new_amc_value: r.new_amc_value, renewal_status: r.renewal_status, payment_status: r.payment_status, amc_activation_status: r.amc_activation_status,
      first_pmt_date: r.first_payment_date, renewal_date: r.renewal_date, total_paid: r.received, outstanding: r.outstanding, payment_count: r.payment_count,
      total_elevator_units: r.units, units: r.units }));
    const totals = { renewals: d.renewals, projects: d.projects, units: d.units,
      amc_value: Math.round(d.rows.reduce((s, r) => s + r.new_amc_value, 0) * 100) / 100,
      paid: Math.round(d.rows.reduce((s, r) => s + r.received, 0) * 100) / 100 };
    res.json({ year: y, mo, ymStr: `${y}-${String(mo).padStart(2, '0')}`, totals, rows });
  } catch (e) {
    console.error('[maint-dashboard/renewal-month-detail]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Single record ────────────────────────────────────────────────────────────
router.get('/:id', requireModule('maintenance_contracts'), (req, res) => {
  const record = get(`SELECT * FROM maintenance_contracts WHERE id=?`, [req.params.id]);
  if (!record) return res.status(404).json({ error: 'Not found' });
  record.schedule_months = monthsForRecord(record.id);
  record._schedule = all('SELECT schedule_year, month, schedule_date, schedule_status, schedule_source, schedule_remarks FROM maintenance_schedule_months WHERE maintenance_contract_id=? ORDER BY schedule_year, month', [record.id]);
  // Find the contract that links TO this maintenance record
  const linkedContract = get(`
    SELECT id, contract_ref, client_name, emirate, approval_date, delivery_status,
           maintenance_linked_by, maintenance_linked_at, elevator_units
    FROM contracts WHERE linked_maintenance_id=? AND is_deleted=0 LIMIT 1`, [record.id]);
  record.linked_contract = linkedContract || null;
  const history = all(`SELECT * FROM maintenance_contract_history WHERE maintenance_contract_id=? ORDER BY changed_at DESC`, [req.params.id]);
  const visitLog = all(`SELECT * FROM maintenance_visit_log WHERE maintenance_contract_id=? ORDER BY month ASC`, [req.params.id]);
  const visits = all(`SELECT * FROM maintenance_visits WHERE maintenance_contract_id=? ORDER BY visit_year, visit_month`, [req.params.id]);
  visits.forEach(enrichVisit);

  // ── AMC Renewal & Payment Financial Block ─────────────────────────────────
  const contractRef = record.contract_ref;
  // Current (latest non-cancelled) renewal
  const currentRenewal = contractRef ? get(`
    SELECT r.*,
      COALESCE(txn.total_received, 0) AS total_received,
      COALESCE(r.new_amc_value, 0) - COALESCE(txn.total_received, 0) AS balance,
      CASE
        WHEN r.payment_status IN ('Later','Overdue','Hold') THEN r.payment_status
        WHEN COALESCE(txn.total_received, 0) = 0 THEN 'Unpaid'
        WHEN COALESCE(r.new_amc_value, 0) > 0 AND COALESCE(txn.total_received, 0) >= COALESCE(r.new_amc_value, 0) THEN 'Paid'
        ELSE 'Partial'
      END AS effective_payment_status
    FROM amc_renewals r
    LEFT JOIN (
      SELECT amc_renewal_id, SUM(amount) AS total_received, MAX(payment_date) AS latest_payment_date
      FROM amc_payment_transactions GROUP BY amc_renewal_id
    ) txn ON txn.amc_renewal_id = r.id
    WHERE r.contract_ref=? AND r.is_deleted=0
      AND r.renewal_status NOT IN ('Cancelled','Rejected')
    -- 2026-09-29: the APPLICABLE renewal (not simply the last created): an Approved+Active
    -- renewal whose period covers today first, then the most recent period.
    ORDER BY (r.renewal_status='Approved' AND r.amc_activation_status='Active'
              AND r.new_start_date <= date('now','localtime') AND r.new_end_date >= date('now','localtime')) DESC,
             COALESCE(r.new_start_date,'') DESC, r.id DESC LIMIT 1`, [contractRef]) : null;

  // Payment history for current renewal
  const paymentHistory = currentRenewal ? all(`
    SELECT * FROM amc_payment_transactions
    WHERE amc_renewal_id=? ORDER BY COALESCE(payment_date,'0000') DESC, id DESC`, [currentRenewal.id]) : [];   // newest first

  // Latest payment date from transactions
  if (currentRenewal) {
    currentRenewal.latest_payment_date = paymentHistory.map(t => t.payment_date).filter(Boolean).sort().pop() || null;
    currentRenewal.operational_status = amcPay.evaluateAMCOperationalStatus({ renewal_status: currentRenewal.renewal_status,
      amc_activation_status: currentRenewal.amc_activation_status, total_received: currentRenewal.total_received,
      cancelled: amcPay.isContractCancelled(currentRenewal.contract_ref) });
  }
  const voidedPayments = currentRenewal ? all('SELECT * FROM amc_payment_voids WHERE amc_renewal_id=? ORDER BY voided_at DESC', [currentRenewal.id]) : [];

  // Renewal history (all non-current renewals, descending)
  const renewalHistory = contractRef ? all(`
    SELECT r.*,
      COALESCE(txn.total_received, 0) AS total_received,
      COALESCE(r.new_amc_value, 0) - COALESCE(txn.total_received, 0) AS balance,
      CASE
        WHEN r.payment_status IN ('Later','Overdue','Hold') THEN r.payment_status
        WHEN COALESCE(txn.total_received, 0) = 0 THEN 'Unpaid'
        WHEN COALESCE(r.new_amc_value, 0) > 0 AND COALESCE(txn.total_received, 0) >= COALESCE(r.new_amc_value, 0) THEN 'Paid'
        ELSE 'Partial'
      END AS effective_payment_status
    FROM amc_renewals r
    LEFT JOIN (
      SELECT amc_renewal_id, SUM(amount) AS total_received
      FROM amc_payment_transactions GROUP BY amc_renewal_id
    ) txn ON txn.amc_renewal_id = r.id
    WHERE r.contract_ref=? AND r.is_deleted=0
      AND r.id != ${currentRenewal ? currentRenewal.id : 0}
    ORDER BY r.id DESC`, [contractRef]) : [];

  // ── Free AMC eligibility info ─────────────────────────────────────────────
  // Look up handover_date from the contracts table via contract_ref.
  // This is the authoritative date for the 24-month Free AMC window.
  let freeAMCInfo = null;
  if (record.contract_ref) {
    const contractRow = get(
      'SELECT handover_date FROM contracts WHERE contract_ref=? AND is_deleted=0 LIMIT 1',
      [record.contract_ref]
    );
    freeAMCInfo = calculateFreeAMCEligibility(contractRow ? contractRow.handover_date : null);
  } else {
    freeAMCInfo = calculateFreeAMCEligibility(null); // no contract_ref → no handover date
  }

  const _role = req.session && req.session.user ? req.session.user.role : '';
  const paymentPermissions = { can_add: AMC_PAYMENT_ENTRY.includes(_role), can_edit: AMC_PAYMENT_ADMIN.includes(_role) };
  res.json({ record, history, visitLog, visits, currentRenewal, paymentHistory, voidedPayments, renewalHistory, freeAMCInfo, paymentPermissions });
});


// ══════════════════════════════════════════════════════════════════════════════
// AMC PAYMENT LEDGER — Maintenance → AMC Renewal & Payment Details (2026-09-29)
// Same service (db/amcPayments.js) and same ledger table as Alerts → Renewal Status,
// so a payment entered here appears there immediately and vice-versa.
// ══════════════════════════════════════════════════════════════════════════════
function _mcRenewal(req) {
  const mc = get('SELECT * FROM maintenance_contracts WHERE id=? AND is_deleted=0', [req.params.id]);
  if (!mc) throw new amcPay.PaymentError('Maintenance record not found', 404);
  return mc;
}
function _checkRenewalBelongs(mc, renewalId) {
  const r = get('SELECT id, contract_ref FROM amc_renewals WHERE id=? AND is_deleted=0', [renewalId]);
  if (!r) throw new amcPay.PaymentError('Renewal not found', 404);
  if ((r.contract_ref || '').trim().toUpperCase() !== (mc.contract_ref || '').trim().toUpperCase())
    throw new amcPay.PaymentError('This renewal does not belong to this maintenance record.', 400);
}
const _payErr = (res, e) => res.status(e.status || (e instanceof amcPay.PaymentError ? 400 : 500)).json({ error: e.message });
const _ledgerOut = L => ({ renewal: L.renewal, transactions: L.transactions, voided: L.voided, amc_value: L.amc_value,
  total_received: L.total_received, outstanding: L.outstanding, balance: L.balance,
  payment_status: L.payment_status, latest_payment_date: L.latest_payment_date, operational_status: L.operational_status });

// Ledger for any renewal of this record (current or historical — never merged)
router.get('/:id/amc-payments/:renewalId', requireModule('maintenance_contracts'), (req, res) => {
  try { const mc = _mcRenewal(req); _checkRenewalBelongs(mc, req.params.renewalId); res.json(_ledgerOut(amcPay.ledger(req.params.renewalId))); }
  catch (e) { _payErr(res, e); }
});

// Add payment. Body: { renewal_id?, amount, payment_date, remarks, client_request_id, amc_value? }
// If the record has no renewal for its current AMC period, amc_value creates the
// payment record for that period first — both in ONE transaction.
router.post('/:id/amc-payments', requireModule('maintenance_contracts'), (req, res) => {
  try {
    const role = req.session.user.role;
    if (!AMC_PAYMENT_ENTRY.includes(role)) return res.status(403).json({ error: 'Your role cannot record AMC payments.' });
    const mc = _mcRenewal(req);
    const b = req.body || {};
    const user = req.session.user.username;
    const out = amcPay.inTx(() => {
      let renewalId = b.renewal_id;
      if (renewalId) _checkRenewalBelongs(mc, renewalId);
      else renewalId = amcPay.ensureCurrentPeriodRenewal(mc, b.amc_value, user).id;
      return amcPay.addPayment(renewalId, { amount: b.amount, payment_date: b.payment_date, remarks: b.remarks,
        invoice_ref: b.invoice_ref, client_request_id: b.client_request_id, allow_overpayment: b.allow_overpayment },
        user, AMC_PAYMENT_ADMIN.includes(role));
    });
    res.status(out.duplicate ? 200 : 201).json({ ..._ledgerOut(out), payment_id: out.payment_id, payment_ref: out.payment_ref, duplicate: !!out.duplicate });
  } catch (e) { _payErr(res, e); }
});

router.patch('/:id/amc-payments/:renewalId/:txnId', requireModule('maintenance_contracts'), (req, res) => {
  try {
    if (!AMC_PAYMENT_ADMIN.includes(req.session.user.role)) return res.status(403).json({ error: 'Only Admin / Accounts can edit a recorded payment.' });
    const mc = _mcRenewal(req); _checkRenewalBelongs(mc, req.params.renewalId);
    res.json(_ledgerOut(amcPay.editPayment(req.params.renewalId, req.params.txnId, req.body || {}, req.session.user.username, true)));
  } catch (e) { _payErr(res, e); }
});

router.post('/:id/amc-payments/:renewalId/:txnId/void', requireModule('maintenance_contracts'), (req, res) => {
  try {
    if (!AMC_PAYMENT_ADMIN.includes(req.session.user.role)) return res.status(403).json({ error: 'Only Admin / Accounts can void a recorded payment.' });
    const mc = _mcRenewal(req); _checkRenewalBelongs(mc, req.params.renewalId);
    res.json(_ledgerOut(amcPay.voidPayment(req.params.renewalId, req.params.txnId, (req.body || {}).reason, req.session.user.username)));
  } catch (e) { _payErr(res, e); }
});

// ── GET visits for a contract (with year filter) ─────────────────────────────
router.get('/:id/visits', requireModule('maintenance_contracts'), (req, res) => {
  const mc = get('SELECT * FROM maintenance_contracts WHERE id=?', [req.params.id]);
  if (!mc) return res.status(404).json({ error: 'Not found' });
  const year = parseInt(req.query.year) || new Date().getFullYear();
  // Get schedule months for the specific year (manual schedule model)
  const scheduleMonthData = all(
    'SELECT month, schedule_date, schedule_status, schedule_remarks FROM maintenance_schedule_months WHERE maintenance_contract_id=? AND schedule_year=? ORDER BY month',
    [mc.id, year]
  );
  const scheduledMonthsForYear = scheduleMonthData.map(s => s.month);
  // Ensure visit rows exist for scheduled months in the requested year —
  // ONLY for scheduling-eligible contracts. Hold/Cancelled must NOT auto-create stubs.
  if (isSchedulingEligible(mc)) {
    for (const m of scheduledMonthsForYear) ensureVisit(mc, year, m);
  }
  const visits = all('SELECT * FROM maintenance_visits WHERE maintenance_contract_id=? AND visit_year=? ORDER BY visit_month', [mc.id, year]);
  visits.forEach(enrichVisit);
  // scheduled_months = year-agnostic list (for backward compat); schedule_month_data = year-specific with status
  res.json({ visits, year, scheduled_months: scheduledMonthsForYear, schedule_month_data: scheduleMonthData });
});

// ── POST create maintenance record ────────────────────────────────────────────
router.post('/', requireMCM, (req, res) => {
  const b = req.body || {};
  if (!b.contract_ref && !b.client_name) return res.status(400).json({ error: 'contract_ref or client_name required' });
  if (b.maintenance_type && !MAINTENANCE_TYPES.includes(b.maintenance_type))
    return res.status(400).json({ error: `Invalid maintenance_type. Must be one of: ${MAINTENANCE_TYPES.join(', ')}` });
  const ref = b.contract_ref || null;
  const currentStatus = classifyContractRef(ref);
  const maintenanceId = `MR-${ref||'PENDING'}-${Date.now()}`;
  run(`INSERT INTO maintenance_contracts
    (maintenance_id,contract_ref,current_status,client_name,emirate,
     maintenance_type,maintenance_period,start_date,end_date,assigned_technician,
     last_service_date,next_service_date,remarks,renewal_status,
     scheduling_method,next_service_from,total_elevator_units,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [maintenanceId,ref,currentStatus,b.client_name||null,b.emirate||null,
     b.maintenance_type||'Paid Comprehensive',b.maintenance_period||null,b.start_date||null,b.end_date||null,
     b.assigned_technician||null,b.last_service_date||null,b.next_service_date||null,
     b.remarks||null,b.renewal_status||'Active Maintenance',
     b.scheduling_method||'Automatic',b.next_service_from||'scheduled_date',
     b.total_elevator_units||null,req.session.user.username]);
  const record = get('SELECT * FROM maintenance_contracts WHERE maintenance_id=?', [maintenanceId]);
  // Schedule months are now managed manually via the Monthly Schedule tab.
  // No auto-generation on create — coordinator adds months via schedule-months API.
  record.schedule_months = monthsForRecord(record.id);
  res.status(201).json({ record });
});

// ── PATCH update maintenance record ─────────────────────────────────────────
router.patch('/:id', requireMCM, (req, res) => {
  try {
    const existing = get('SELECT * FROM maintenance_contracts WHERE id=?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const scheduleMonthsInput = Array.isArray(req.body.schedule_months) ? req.body.schedule_months.slice() : null;
    const remarksNote = req.body.remarks_note || null;
    const hadScheduleMonthsField = 'schedule_months' in (req.body||{});
    const incoming = { ...(filterFieldsForRole(req.session.user.role,'maintenance_contract',req.body||{})) };
    delete incoming.remarks_note;
    delete incoming.schedule_months;
    // Validate maintenance_type if provided
    if ('maintenance_type' in incoming && incoming.maintenance_type !== null && !MAINTENANCE_TYPES.includes(incoming.maintenance_type))
      return res.status(400).json({ error: `Invalid maintenance_type. Must be one of: ${MAINTENANCE_TYPES.join(', ')}` });

    // ── maintenance_period_custom is a UI-only field, not a DB column ─────────
    // When period is 'Custom', map the numeric value into maintenance_period so
    // periodToMonths() can calculate intervals.  Then always remove the helper key.
    if (incoming.maintenance_period === 'Custom' && incoming.maintenance_period_custom) {
      const customMonths = parseInt(incoming.maintenance_period_custom);
      if (!isNaN(customMonths) && customMonths > 0) incoming.maintenance_period = String(customMonths);
    }
    delete incoming.maintenance_period_custom; // never a DB column — must strip before SQL

    // ── Convert empty date strings to null ─────────────────────────────────────
    const DATE_FIELDS = ['start_date','end_date','last_service_date','next_service_date'];
    for (const df of DATE_FIELDS) {
      if (df in incoming && (incoming[df] === '' || incoming[df] === undefined)) incoming[df] = null;
    }

    if (Object.keys(incoming).length===0 && !hadScheduleMonthsField) return res.status(400).json({ error: 'No editable fields provided' });
    if ('contract_ref' in incoming) incoming.current_status = classifyContractRef(incoming.contract_ref);
    if (Object.keys(incoming).length > 0) {
      const updates = { ...incoming, updated_at: new Date().toISOString() };
      const setSql = Object.keys(updates).map(k=>`${k}=?`).join(', ');
      run(`UPDATE maintenance_contracts SET ${setSql} WHERE id=?`, [...Object.values(updates), req.params.id]);
      for (const field of TRACKED_FIELDS) {
        if (field in incoming && String(existing[field]??'')!==String(incoming[field]??'')) {
          run(`INSERT INTO maintenance_contract_history (maintenance_contract_id,field_name,old_value,new_value,changed_by,remarks) VALUES (?,?,?,?,?,?)`,
            [req.params.id, field, existing[field]??null, incoming[field]??null, req.session.user.username, remarksNote]);
        }
      }
    }

    // ── Hold / Active status transition handling ──────────────────────────────
    // When a contract goes → Hold or Cancelled: suspend future uncompleted visits.
    // When a contract returns → Active: re-activate those system-suspended visits.
    const prevRenewalStatus = existing.renewal_status;
    const newRenewalStatus  = incoming.renewal_status;
    if (newRenewalStatus && newRenewalStatus !== prevRenewalStatus) {
      const nowHold = NON_SCHEDULABLE_STATUSES.has(newRenewalStatus);
      const wasHold = NON_SCHEDULABLE_STATUSES.has(prevRenewalStatus);
      if (nowHold && !wasHold) {
        const n = suspendFutureVisits(req.params.id, req.session.user.username);
        if (n > 0) console.log(`[Hold] Suspended ${n} future visit(s) for contract ${req.params.id} → ${newRenewalStatus}`);
      } else if (!nowHold && wasHold) {
        const n = resumeSuspendedVisits(req.params.id, req.session.user.username);
        if (n > 0) console.log(`[Hold] Re-activated ${n} suspended visit(s) for contract ${req.params.id} → ${newRenewalStatus}`);
      }
    }
    // 2026-10-03: Reactivation from Cancelled → evaluate the FUTURE regular schedule with the
    // authoritative engine (current Maintenance Period + current AMC period, idempotent, no
    // duplicates). History / manual / completed months are never touched.
    let reactivation_schedule = null;
    if (prevRenewalStatus === 'Cancelled' && newRenewalStatus && !NON_SCHEDULABLE_STATUSES.has(newRenewalStatus)) {
      try {
        const p = schedEngine.recalculateRegularSchedule(Number(req.params.id), { apply: true, user: req.session.user.username,
          reason: `Reactivated from Cancelled → ${newRenewalStatus}` });
        reactivation_schedule = { added: p.add, removed: p.remove, review: p.review, skipped: p.skipped || null, anchor: p.anchor && p.anchor.label,
          period: p.period || null };
      } catch (e) { console.error('[reactivation schedule]', e.message); reactivation_schedule = { error: e.message }; }
    }

    // Schedule rows are managed via the schedule-months API + the central engine.
    // Saving the record never creates schedules. ONLY a real Maintenance Period
    // change realigns FUTURE regular (auto) months to the new interval — manual
    // months and history are preserved. Saving unchanged values does nothing.
    let schedule_recalc = null;
    if ('maintenance_period' in incoming && String(existing.maintenance_period ?? '') !== String(incoming.maintenance_period ?? '')) {
      const p = schedEngine.recalculateRegularSchedule(Number(req.params.id), {
        apply: true, user: req.session.user.username,
        reason: `Maintenance Period changed ${existing.maintenance_period || '—'} → ${incoming.maintenance_period || '—'}`,
      });
      schedule_recalc = { added: p.add, removed: p.remove, review: p.review, skipped: p.skipped || null, anchor: p.anchor && p.anchor.label };
    }
    const record = get('SELECT * FROM maintenance_contracts WHERE id=?', [req.params.id]);
    record.schedule_months = monthsForRecord(req.params.id);
    res.json({ record, schedule_recalc, reactivation_schedule });
  } catch (err) {
    console.error('[maintenance_contracts PATCH] Error:', err);
    // Surface a clear message; keep full trace in server log
    const msg = err.message || 'Unexpected server error';
    if (msg.includes('no column named')) {
      return res.status(500).json({ error: 'Database update failed — an unexpected field was sent. Details: ' + msg });
    }
    res.status(500).json({ error: 'Failed to save maintenance record: ' + msg });
  }
});

// ── GET single visit ─────────────────────────────────────────────────────────
router.get('/:id/visits/:visitId', requireModule('maintenance_contracts'), (req, res) => {
  const visit = get('SELECT * FROM maintenance_visits WHERE id=? AND maintenance_contract_id=?', [req.params.visitId, req.params.id]);
  if (!visit) return res.status(404).json({ error: 'Not found' });
  enrichVisit(visit);
  const auditTrail = all('SELECT * FROM maintenance_visit_audit WHERE visit_id=? ORDER BY changed_at DESC', [visit.id]);
  const subVisits = all('SELECT * FROM maintenance_sub_visits WHERE visit_id=? ORDER BY sub_visit_seq', [visit.id]);
  res.json({ visit, audit: auditTrail, sub_visits: subVisits });
});

// ── GET sub_visits for a visit ────────────────────────────────────────────────
router.get('/:id/visits/:visitId/sub-visits', requireModule('maintenance_contracts'), (req, res) => {
  const visit = get('SELECT id FROM maintenance_visits WHERE id=? AND maintenance_contract_id=?', [req.params.visitId, req.params.id]);
  if (!visit) return res.status(404).json({ error: 'Not found' });
  const subVisits = all('SELECT * FROM maintenance_sub_visits WHERE visit_id=? ORDER BY sub_visit_seq', [visit.id]);
  res.json({ sub_visits: subVisits });
});

// ── PATCH update a visit (completion, status, postpone, hold, technicians) ───
router.patch('/:id/visits/:visitId', requireMCM, (req, res) => {
  try {
  const mc = get('SELECT * FROM maintenance_contracts WHERE id=?', [req.params.id]);
  const visit = get('SELECT * FROM maintenance_visits WHERE id=? AND maintenance_contract_id=?', [req.params.visitId, req.params.id]);
  if (!mc || !visit) return res.status(404).json({ error: 'Not found' });

  const b = req.body || {};
  const user = req.session.user.username;
  const now = new Date().toISOString();
  const errors = [];

  // Determine new status
  const newStatus = b.maintenance_status !== undefined ? b.maintenance_status : visit.maintenance_status;
  const newCompleted = b.service_completed !== undefined ? (b.service_completed ? 1 : 0) : visit.service_completed;

  // Validation
  if (b.maintenance_status && !VISIT_STATUSES.includes(b.maintenance_status)) errors.push(`Invalid status: ${b.maintenance_status}`);

  // Helper: field value — body takes priority, falls back to existing visit data
  const fv = (f) => (b[f] !== undefined && b[f] !== null && b[f] !== '') ? b[f] : (visit[f] || null);

  // Status-conditional validation (only when status is explicitly being set)
  if (b.maintenance_status) {
    switch (newStatus) {
      case 'Scheduled':
        if (!fv('scheduled_date')) errors.push('Scheduled status requires a Scheduled Date');
        else {
          // Scheduled date must fall within the visit's scheduled month
          const sd = new Date(fv('scheduled_date'));
          if (!isNaN(sd.getTime())) {
            if (sd.getFullYear() !== visit.visit_year || (sd.getMonth()+1) !== visit.visit_month) {
              errors.push(`Scheduled Date must fall within ${visit.visit_month}/${visit.visit_year} (the visit's scheduled month)`);
            }
          }
        }
        break;
      case 'Completed':
        if (!fv('completion_date')) errors.push('Completed status requires an Actual Completion Date');
        break;
      case 'Partially Completed':
        if (!fv('completion_date')) errors.push('Partially Completed status requires an Actual Completion Date');
        if (!fv('status_reason')) errors.push('Partially Completed status requires a Reason');
        break;
      case 'Hold':
        if (!fv('hold_reason') && !fv('status_reason')) errors.push('Hold status requires a Reason');
        break;
      case 'Postponed':
        if (!fv('postponed_date')) errors.push('Postponed status requires a Revised Scheduled Date');
        if (!fv('postponement_reason') && !fv('status_reason')) errors.push('Postponed status requires a Reason');
        break;
      case 'Missed':
        if (!fv('status_reason')) errors.push('Missed status requires a Reason');
        break;
      case 'Cancelled':
        if (!fv('status_reason')) errors.push('Cancelled status requires a Reason');
        if (!fv('cancellation_date')) errors.push('Cancelled status requires a Cancellation Date');
        break;
    }
  }

  // ── Multi-unit: determine units in this save ──────────────────────────────
  // b.add_units_serviced: additional units serviced in this event (cumulative mode)
  // b.units_serviced: absolute total (used in non-cumulative edits)
  const existingServiced = visit.units_serviced || 0;
  const unitsScheduled = b.units_scheduled !== undefined ? Number(b.units_scheduled) : (visit.units_scheduled || visit.total_elevator_units || mc.total_elevator_units || 0);
  const totalUnits = b.total_elevator_units !== undefined ? Number(b.total_elevator_units) : (visit.total_elevator_units || mc.total_elevator_units || 0);

  // Cumulative mode: "Service Remaining Unit" button sends add_units_serviced
  const isAddMode = b.add_units_serviced !== undefined;
  const addUnits = isAddMode ? Math.max(0, Number(b.add_units_serviced) || 0) : 0;
  let unitsServiced;
  if (isAddMode) {
    unitsServiced = existingServiced + addUnits;
  } else {
    unitsServiced = b.units_serviced !== undefined ? Number(b.units_serviced) : existingServiced;
  }

  if (totalUnits && unitsServiced > unitsScheduled) errors.push(`Units Serviced (${unitsServiced}) cannot exceed Units Scheduled (${unitsScheduled})`);
  if (unitsScheduled > totalUnits && totalUnits > 0) errors.push(`Units Scheduled (${unitsScheduled}) cannot exceed Total Elevator Units (${totalUnits})`);
  if (isAddMode && addUnits <= 0) errors.push('Additional units serviced must be at least 1');
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  // ── Auto-derive status from cumulative units ───────────────────────────────
  // IF units_serviced < units_scheduled → force Partially Completed
  // IF units_serviced >= units_scheduled → allow Completed
  // (only applies to completion-family statuses)
  let derivedStatus = newStatus;
  const isCompletionStatus = ['Completed', 'Partially Completed'].includes(newStatus);
  if (isCompletionStatus && unitsScheduled > 0) {
    if (unitsServiced < unitsScheduled) {
      derivedStatus = 'Partially Completed';
    } else if (unitsServiced >= unitsScheduled) {
      derivedStatus = 'Completed';
    }
  }
  // Also enforce if status not explicitly a completion status but units are being serviced
  if (!isCompletionStatus && (b.add_units_serviced !== undefined) && unitsScheduled > 0) {
    derivedStatus = unitsServiced >= unitsScheduled ? 'Completed' : 'Partially Completed';
  }

  // Build update
  const upd = { updated_by: user, updated_at: now, maintenance_status: derivedStatus };
  const auditFields = ['scheduled_date','next_service_date','scheduling_method','maintenance_status',
    'service_completed','completion_date','completed_by','postponed_date','postponement_reason',
    'original_scheduled_date','hold_reason','hold_date','expected_release_date',
    'technicians','total_elevator_units','units_scheduled','units_serviced','units_not_serviced','unserviced_reason',
    'work_performed','findings','parts_replaced','pending_issues','remarks',
    'lift_no','visit_type','checklist_completed','spare_parts_used','client_signature',
    'status_reason','cancellation_date','cancelled_by'];

  for (const f of auditFields) {
    if (f in b && f !== 'maintenance_status' && f !== 'units_serviced') upd[f] = b[f];
  }
  // units_serviced: always use our derived cumulative value when it changed
  if (b.units_serviced !== undefined || isAddMode) {
    upd.units_serviced = unitsServiced;
  }

  // Auto-derive: Completed status
  if (derivedStatus === 'Completed') {
    upd.service_completed = 1;
    if (!upd.completed_by) upd.completed_by = user;
    if (!upd.units_serviced && unitsScheduled) upd.units_serviced = unitsScheduled;
  } else if (derivedStatus === 'Partially Completed') {
    upd.service_completed = 0;
  }

  // Auto-derive: Cancelled status — fill cancelled_by and cancellation_date if not provided
  if (derivedStatus === 'Cancelled') {
    if (!upd.cancelled_by) upd.cancelled_by = user;
    if (!upd.cancellation_date) upd.cancellation_date = now.slice(0,10);
  }

  // Auto-derive: units_scheduled if provided
  if (b.units_scheduled !== undefined) {
    upd.units_scheduled = unitsScheduled;
  }
  // Auto-derive: units_not_serviced = units_scheduled - units_serviced
  const effectiveServiced = upd.units_serviced !== undefined ? Number(upd.units_serviced) : unitsServiced;
  if (unitsScheduled > 0) {
    upd.units_not_serviced = Math.max(0, unitsScheduled - effectiveServiced);
  }

  // Save original scheduled date when postponing for the first time
  if (derivedStatus === 'Postponed' && !visit.original_scheduled_date) {
    upd.original_scheduled_date = visit.scheduled_date || null;
  }

  const setSql = Object.keys(upd).map(k=>`${k}=?`).join(', ');
  run(`UPDATE maintenance_visits SET ${setSql} WHERE id=?`, [...Object.values(upd), visit.id]);

  // Audit each changed field
  for (const f of auditFields) {
    if (f in upd) auditVisit(visit.id, f, visit[f], upd[f], user, b.reason||null);
  }

  const updated = get('SELECT * FROM maintenance_visits WHERE id=?', [visit.id]);
  enrichVisit(updated);

  // ── Record sub_visit for each physical service event ──────────────────────
  // Create a sub_visit row whenever units are being recorded as serviced in this save.
  // This captures the history of individual service events for multi-unit visits.
  const unitsBeingRecorded = isAddMode ? addUnits : (
    isCompletionStatus && b.units_serviced !== undefined ? Number(b.units_serviced) : 0
  );
  if (unitsBeingRecorded > 0 && isCompletionStatus) {
    try {
      const existingSubVisits = all('SELECT COUNT(*) c FROM maintenance_sub_visits WHERE visit_id=?', [visit.id]);
      const seq = (existingSubVisits[0] && existingSubVisits[0].c ? existingSubVisits[0].c : 0) + 1;
      run(`INSERT INTO maintenance_sub_visits
        (visit_id, maintenance_contract_id, contract_ref, sub_visit_seq, actual_date,
         units_serviced, lift_no, work_performed, findings, parts_replaced,
         checklist_completed, spare_parts_used, remarks, created_by, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [visit.id, mc.id, mc.contract_ref, seq,
         b.completion_date || visit.completion_date || now.slice(0,10),
         unitsBeingRecorded,
         b.lift_no || visit.lift_no || null,
         b.work_performed || null,
         b.findings || null,
         b.parts_replaced || null,
         b.checklist_completed ? 1 : 0,
         b.spare_parts_used || null,
         b.remarks || null,
         user, now]);
    } catch(svErr) {
      console.error('[MCM PATCH visit] sub_visit create error:', svErr.message);
    }
  }

  // Attach sub_visits to response
  updated.sub_visits = all('SELECT * FROM maintenance_sub_visits WHERE visit_id=? ORDER BY sub_visit_seq', [visit.id]);

  // Auto-create visit log if just completed (transitioned from non-completed to Completed)
  const wasCompleted = visit.service_completed;
  if (updated.service_completed && !wasCompleted) {
    autoCreateVisitLog(mc, updated, user);
    // Update next_service_date (scheduling calculation)
    const completionBase = updated.completion_date || now.slice(0,10);
    const scheduledBase = updated.scheduled_date || completionBase;
    const base = (mc.next_service_from === 'completion_date') ? completionBase : scheduledBase;
    const nextDate = calcNextServiceDate(base, mc.maintenance_period);
    if (nextDate) {
      run(`UPDATE maintenance_contracts SET next_service_date=?, updated_at=? WHERE id=?`,
        [nextDate, now, mc.id]);
    }
  }
  // 2026-10-03: keep maintenance_schedule_months.schedule_status in step with the authoritative visit
  if (updated.maintenance_status === 'Completed') syncScheduleMonthCompleted(mc, updated, user, 'Visit saved as Completed (Manage Visit)');
  // Always sync last_service_date = MAX(completion_date) of all Completed visits
  if (updated.maintenance_status === 'Completed') {
    const latestSvc = get(
      `SELECT MAX(completion_date) AS lsd FROM maintenance_visits
       WHERE maintenance_contract_id=? AND maintenance_status='Completed'
         AND completion_date IS NOT NULL AND completion_date != ''`,
      [mc.id]
    );
    if (latestSvc && latestSvc.lsd) {
      run(`UPDATE maintenance_contracts SET last_service_date=?, updated_at=? WHERE id=?`,
        [latestSvc.lsd, now, mc.id]);
    }
  }

  // Update next_service_date on the visit if scheduling_method is Automatic and we have the data
  if (updated.maintenance_status === 'Completed' && mc.scheduling_method === 'Automatic') {
    const base = (mc.next_service_from === 'completion_date') ? (updated.completion_date||now.slice(0,10)) : (updated.scheduled_date||now.slice(0,10));
    const nextDate = calcNextServiceDate(base, mc.maintenance_period);
    if (nextDate && nextDate !== updated.next_service_date) {
      run('UPDATE maintenance_visits SET next_service_date=? WHERE id=?', [nextDate, visit.id]);
      updated.next_service_date = nextDate;
    }
  }

  // Include flag in response if status was auto-adjusted
  if (derivedStatus !== newStatus && isCompletionStatus) {
    updated._status_adjusted = true;
    updated._status_adjusted_reason = `Status auto-adjusted from '${newStatus}' to '${derivedStatus}' because ${unitsServiced} of ${unitsScheduled} units serviced`;
  }

  res.json({ visit: updated });
  } catch (err) {
    console.error('[MCM PATCH visit] Error saving visit', req.params.visitId, 'for contract', req.params.id,
      '| user:', req.session && req.session.user && req.session.user.username,
      '| msg:', err.message,
      '| stack:', err.stack || '');
    res.status(500).json({ error: 'Unable to save the Maintenance Visit: ' + err.message });
  }
});

// ── POST ensure a visit row ───────────────────────────────────────────────────
router.post('/:id/visits/ensure', requireMCM, (req, res) => {
  const mc = get('SELECT * FROM maintenance_contracts WHERE id=?', [req.params.id]);
  if (!mc) return res.status(404).json({ error: 'Not found' });
  const { year, month } = req.body;
  if (!year || !month) return res.status(400).json({ error: 'year and month required' });
  const visit = ensureVisit(mc, Number(year), Number(month));
  enrichVisit(visit);
  res.json({ visit });
});

// ── PATCH visit log entry (field team edits after auto-creation) ─────────────
router.patch('/visit-log/:id', requireMCM, (req, res) => {
  const existing = get('SELECT * FROM maintenance_visit_log WHERE id=?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  run(`UPDATE maintenance_visit_log SET
      visit_date=?, scheduled_date=?, technician=?, technicians=?, status=?,
      completion_date=?, work_performed=?, findings=?, parts_replaced=?,
      pending_issues=?, remarks=?, updated_by=?, updated_at=datetime('now')
      WHERE id=?`,
    [b.visit_date ?? existing.visit_date, b.scheduled_date ?? existing.scheduled_date,
     b.technician ?? existing.technician, b.technicians ?? existing.technicians,
     b.status ?? existing.status,
     b.completion_date ?? existing.completion_date,
     b.work_performed ?? existing.work_performed, b.findings ?? existing.findings,
     b.parts_replaced ?? existing.parts_replaced,
     b.pending_issues ?? existing.pending_issues,
     b.remarks ?? existing.remarks, req.session.user.username, req.params.id]);
  res.json({ visit: get('SELECT * FROM maintenance_visit_log WHERE id=?', [req.params.id]) });
});

// ── Legacy ensure endpoint (kept for backward compat) ────────────────────────
router.post('/:id/visit-log/ensure', requireMCM, (req, res) => {
  const record = get('SELECT * FROM maintenance_contracts WHERE id=?', [req.params.id]);
  if (!record) return res.status(404).json({ error: 'Not found' });
  const yyyymm = req.body.month;
  if (!yyyymm) return res.status(400).json({ error: 'month (YYYY-MM) required' });
  let visit = get('SELECT * FROM maintenance_visit_log WHERE maintenance_contract_id=? AND month=?', [record.id, yyyymm]);
  if (!visit) {
    run(`INSERT INTO maintenance_visit_log (maintenance_contract_id,contract_ref,month,technician,status) VALUES (?,?,?,?,'Pending')`,
      [record.id, record.contract_ref, yyyymm, record.assigned_technician||null]);
    visit = get('SELECT * FROM maintenance_visit_log WHERE maintenance_contract_id=? AND month=?', [record.id, yyyymm]);
  }
  res.json({ visit });
});

// ── Contract / Client Lookup (for CB form autocomplete) ─────────────────────
// GET /api/maintenance-contracts/contract-lookup?q=<partial>
// Searches contracts and maintenance_contracts by contract_ref or client_name.
// Returns up to 15 matches with all fields needed to auto-populate the CB form.
router.get('/contract-lookup', requireModule('maintenance_contracts'), (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ rows: [] });
    const like = `%${q.replace(/'/g,"''")}%`;
    // Pull from contracts table (primary source)
    const contractRows = all(`
      SELECT
        c.contract_ref,
        c.client_name,
        c.project_description AS project_description,
        c.emirate,
        c.total_elevator_units,
        c.status AS contract_status,
        NULL AS maintenance_status,
        NULL AS assigned_technician,
        NULL AS maintenance_id,
        'contracts' AS source
      FROM contracts c
      WHERE c.is_deleted = 0
        AND (c.contract_ref LIKE ? OR c.client_name LIKE ? OR c.project_description LIKE ?)
      ORDER BY c.contract_ref
      LIMIT 15
    `, [like, like, like]);
    // Pull from maintenance_contracts (secondary source for MC-only records)
    const mcRows = all(`
      SELECT
        mc.contract_ref,
        mc.client_name,
        NULL AS project_description,
        mc.emirate,
        mc.total_elevator_units,
        NULL AS contract_status,
        mc.renewal_status AS maintenance_status,
        mc.assigned_technician,
        mc.maintenance_id,
        'maintenance_contracts' AS source
      FROM maintenance_contracts mc
      WHERE mc.is_deleted = 0
        AND (mc.contract_ref LIKE ? OR mc.client_name LIKE ?)
        AND mc.contract_ref NOT IN (SELECT contract_ref FROM contracts WHERE is_deleted=0 AND contract_ref IS NOT NULL)
      ORDER BY mc.contract_ref
      LIMIT 10
    `, [like, like]);
    // Merge, deduplicate by contract_ref (contracts wins)
    const seen = new Set();
    const rows = [];
    for (const r of [...contractRows, ...mcRows]) {
      const key = (r.contract_ref || '').toUpperCase();
      if (!seen.has(key)) { seen.add(key); rows.push(r); }
      if (rows.length >= 15) break;
    }
    res.json({ rows });
  } catch(e) {
    console.error('[GET /api/maintenance-contracts/contract-lookup]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Delete ───────────────────────────────────────────────────────────────────
router.delete('/:id', requireModule('maintenance_contracts'), requireRole('admin'), (req, res) => {
  const mc = get(`SELECT * FROM maintenance_contracts WHERE id=? AND is_deleted=0`, [req.params.id]);
  if (!mc) return res.status(404).json({ error: 'Not found' });
  run(`UPDATE maintenance_contracts SET is_deleted=1, updated_at=datetime('now') WHERE id=?`, [req.params.id]);
  writeAuditLog({ action:'DELETE', module:'maintenance_contracts', recordId:mc.id, recordRef:mc.maintenance_id||mc.contract_ref,
    details:{ contract_ref:mc.contract_ref, client_name:mc.client_name, renewal_status:mc.renewal_status }, performedBy:req.session.user.username });
  res.json({ ok: true });
});

// Startup backfill removed 2026-09-24: schedule is now manually managed per contract.
// generateSchedule() is still available for the "Apply Suggested from Period" action.

// ── Manual schedule-months management ───────────────────────────────────────

// GET /:id/schedule-months?year= — list schedule months for a contract + year
router.get('/:id/schedule-months', requireModule('maintenance_contracts'), (req, res) => {
  const mc = get('SELECT id, contract_ref, renewal_status FROM maintenance_contracts WHERE id=? AND is_deleted=0', [req.params.id]);
  if (!mc) return res.status(404).json({ error: 'Not found' });
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const months = all(
    'SELECT schedule_year, month, schedule_date, schedule_status, schedule_remarks FROM maintenance_schedule_months WHERE maintenance_contract_id=? AND schedule_year=? ORDER BY month',
    [req.params.id, year]
  );
  res.json({ year, months, contract_ref: mc.contract_ref, renewal_status: mc.renewal_status });
});

// POST /:id/schedule-months — add or re-activate a month in the schedule
router.post('/:id/schedule-months', requireMCM, (req, res) => {
  try {
    const mc = get('SELECT * FROM maintenance_contracts WHERE id=? AND is_deleted=0', [req.params.id]);
    if (!mc) return res.status(404).json({ error: 'Not found' });
    if (!isSchedulingEligible(mc)) {
      return res.status(422).json({ hold: true, error: `Scheduling suspended — contract is ${mc.renewal_status}.` });
    }
    const { year, month, planned_date, remarks } = req.body;
    if (!year || !month) return res.status(400).json({ error: 'year and month are required' });
    const yr = parseInt(year); const mo = parseInt(month);
    if (mo < 1 || mo > 12) return res.status(400).json({ error: 'month must be 1–12' });

    const existing = get('SELECT * FROM maintenance_schedule_months WHERE maintenance_contract_id=? AND schedule_year=? AND month=?', [req.params.id, yr, mo]);
    if (existing) {
      // Already in schedule — update planned_date/remarks if provided; don't downgrade Completed
      if (existing.schedule_status !== 'Completed') {
        run(`UPDATE maintenance_schedule_months SET schedule_status='Scheduled', schedule_date=?, schedule_remarks=? WHERE id=?`,
          [planned_date || null, remarks || existing.schedule_remarks || null, existing.id]);
      }
    } else {
      run(`INSERT INTO maintenance_schedule_months (maintenance_contract_id, schedule_year, month, schedule_date, schedule_status, schedule_remarks, schedule_source) VALUES (?,?,?,?,?,?,?)`,
        [req.params.id, yr, mo, planned_date || null, 'Scheduled', remarks || null, 'manual']);
    }
    const row = get('SELECT * FROM maintenance_schedule_months WHERE maintenance_contract_id=? AND schedule_year=? AND month=?', [req.params.id, yr, mo]);
    schedEngine.logScheduleAudit({ contract_id: mc.id, contract_ref: mc.contract_ref, year: yr, month: mo,
      action: existing ? 'MANUAL_UPDATE' : 'MANUAL_ADD', old_status: existing && existing.schedule_status,
      old_source: existing && existing.schedule_source, snapshot: existing || null,
      reason: remarks || (existing ? 'Month re-activated / planned date updated' : 'Manual month added (recovery / additional service)'),
      performed_by: req.session.user.username });
    res.json({ row });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /:id/schedule-months/:year/:month — update status, planned_date, or remarks
router.patch('/:id/schedule-months/:year/:month', requireMCM, (req, res) => {
  try {
    const yr = parseInt(req.params.year); const mo = parseInt(req.params.month);
    const existing = get('SELECT * FROM maintenance_schedule_months WHERE maintenance_contract_id=? AND schedule_year=? AND month=?', [req.params.id, yr, mo]);
    if (!existing) return res.status(404).json({ error: 'Month not in schedule' });

    const b = req.body;
    const newStatus = b.schedule_status || existing.schedule_status;
    // 2026-10-03: "Completed" must be a real service record — it is saved through
    // POST /:id/schedule-months/:year/:month/complete (creates/links the visit), never as a bare status.
    if (b.schedule_status === 'Completed' && existing.schedule_status !== 'Completed') {
      return res.status(400).json({ error: 'Use Mark Completed (with Actual Completion Date) to complete a month.' });
    }
    if (b.schedule_status && !['Scheduled', 'Missed', 'Postponed', 'Hold', 'Completed'].includes(b.schedule_status)) {
      return res.status(400).json({ error: `Invalid month status: ${b.schedule_status}` });
    }

    // Protect Completed months from status downgrade
    if (existing.schedule_status === 'Completed' && b.schedule_status && b.schedule_status !== 'Completed') {
      return res.status(400).json({ error: 'Cannot change status of a Completed month — edit the visit record instead.' });
    }

    const newDate    = 'planned_date' in b ? (b.planned_date || null) : existing.schedule_date;
    const newRemarks = 'remarks' in b      ? (b.remarks || null)      : existing.schedule_remarks;

    run(`UPDATE maintenance_schedule_months SET schedule_status=?, schedule_date=?, schedule_remarks=? WHERE id=?`,
      [newStatus, newDate, newRemarks, existing.id]);
    if (newStatus !== existing.schedule_status || newDate !== existing.schedule_date || newRemarks !== existing.schedule_remarks) {
      const _mcRef = get('SELECT contract_ref FROM maintenance_contracts WHERE id=?', [req.params.id]);
      schedEngine.logScheduleAudit({ contract_id: Number(req.params.id), contract_ref: _mcRef && _mcRef.contract_ref, year: yr, month: mo,
        action: 'MANUAL_UPDATE', old_status: existing.schedule_status, old_source: existing.schedule_source, snapshot: existing,
        reason: `status ${existing.schedule_status}→${newStatus}`, performed_by: req.session.user.username });
    }

    const row = get('SELECT * FROM maintenance_schedule_months WHERE id=?', [existing.id]);
    res.json({ row });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id/schedule-months/:year/:month — remove a scheduled month
router.delete('/:id/schedule-months/:year/:month', requireMCM, (req, res) => {
  try {
    const yr = parseInt(req.params.year); const mo = parseInt(req.params.month);
    const existing = get('SELECT * FROM maintenance_schedule_months WHERE maintenance_contract_id=? AND schedule_year=? AND month=?', [req.params.id, yr, mo]);
    if (!existing) return res.status(404).json({ error: 'Month not in schedule' });

    // Protect completed months
    if (existing.schedule_status === 'Completed') {
      return res.status(400).json({ error: 'Cannot remove a Completed month — historical data is protected.' });
    }
    const completedVisit = get(
      "SELECT id FROM maintenance_visits WHERE maintenance_contract_id=? AND visit_year=? AND visit_month=? AND maintenance_status IN ('Completed','Partially Completed')",
      [req.params.id, yr, mo]
    );
    if (completedVisit) {
      return res.status(400).json({ error: 'Cannot remove a month with a completed visit — historical data is protected.' });
    }

    run('DELETE FROM maintenance_schedule_months WHERE id=?', [existing.id]);
    const _mcRef = get('SELECT contract_ref FROM maintenance_contracts WHERE id=?', [req.params.id]);
    schedEngine.logScheduleAudit({ contract_id: Number(req.params.id), contract_ref: _mcRef && _mcRef.contract_ref, year: yr, month: mo,
      action: 'MANUAL_REMOVE', old_status: existing.schedule_status, old_source: existing.schedule_source, snapshot: existing,
      reason: 'Month removed from schedule by user', performed_by: req.session.user.username });
    res.json({ ok: true });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 2026-10-03 — DIRECT "COMPLETED" FROM MONTHLY VISITS
// Authoritative completion = maintenance_visits (status + units_serviced) with a
// maintenance_sub_visits service event. maintenance_schedule_months.schedule_status is
// the month-tile mirror and is set to Completed only when ALL scheduled units are done.
// Reports (getMonthlyMaintenanceMetrics, Service Register, Dashboard, Calendar, trend)
// read the visit rows, so they update on the next load — nothing is written to reports.
// ══════════════════════════════════════════════════════════════════════════════
function syncScheduleMonthCompleted(mc, visit, user, reason) {
  const sm = get('SELECT * FROM maintenance_schedule_months WHERE maintenance_contract_id=? AND schedule_year=? AND month=?',
    [mc.id, visit.visit_year, visit.visit_month]);
  if (!sm || sm.schedule_status === 'Completed') return;
  run(`UPDATE maintenance_schedule_months SET schedule_status='Completed' WHERE id=?`, [sm.id]);
  schedEngine.logScheduleAudit({ contract_id: mc.id, contract_ref: mc.contract_ref, year: visit.visit_year, month: visit.visit_month,
    action: 'COMPLETED', old_status: sm.schedule_status, old_source: sm.schedule_source, snapshot: sm, reason, performed_by: user });
}
const _isoOk = d => {                       // real calendar date, timezone-independent
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return false;
  const [y, m, dd] = d.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, dd));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === dd;
};
const _localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const _dmy = d => d ? d.split('-').reverse().join('/') : '';

// POST /:id/schedule-months/:year/:month/complete
// body: { completion_date (required, actual), units_serviced (units serviced in THIS event;
//         required for multi-unit, defaults to the remaining unit for single-unit), remarks, client_request_id }
router.post('/:id/schedule-months/:year/:month/complete', requireMCM, (req, res) => {
  const user = req.session.user.username;
  const yr = parseInt(req.params.year, 10), mo = parseInt(req.params.month, 10);
  const b = req.body || {};
  const label = `${MONTH_NAMES[mo - 1] || '?'} ${yr}`;
  const fail = (code, msg, extra) => res.status(code).json({ error: msg, ...(extra || {}) });
  // ── validation (outside the transaction) ──
  const mc = get('SELECT * FROM maintenance_contracts WHERE id=? AND is_deleted=0', [req.params.id]);
  if (!mc) return fail(404, 'Maintenance Record not found');
  if (!(mo >= 1 && mo <= 12) || !(yr >= 2000 && yr <= 2100)) return fail(400, 'Invalid month');
  if (['Cancelled', 'Renewed'].includes(mc.renewal_status)) return fail(422, `Maintenance Record is ${mc.renewal_status} — completion cannot be recorded here.`);
  const sched = get('SELECT * FROM maintenance_schedule_months WHERE maintenance_contract_id=? AND schedule_year=? AND month=?', [mc.id, yr, mo]);
  if (!sched) return fail(400, `${label} is not scheduled. Schedule it first as a manual extra / recovery month, then mark it Completed.`);
  const today = _localToday();
  const monthStart = `${yr}-${String(mo).padStart(2, '0')}-01`;
  if (monthStart > today) return fail(400, `${label} is in the future — a service cannot be completed before its month.`);
  const cd = String(b.completion_date || '').slice(0, 10);
  if (!cd) return fail(400, 'Actual Completion Date is required.');
  if (!_isoOk(cd)) return fail(400, 'Actual Completion Date is not a valid date.');
  if (cd > today) return fail(400, 'Actual Completion Date cannot be in the future.');
  const earliest = new Date(Date.UTC(yr, mo - 2, 1)).toISOString().slice(0, 10);   // allow early service from the previous month
  if (cd < earliest) return fail(400, `Actual Completion Date (${_dmy(cd)}) is too early for ${label}.`);
  const crid = b.client_request_id ? String(b.client_request_id).slice(0, 80) : null;
  if (crid) {
    const dup = get('SELECT visit_id FROM maintenance_sub_visits WHERE client_request_id=?', [crid]);
    if (dup) return res.json({ duplicate: true, visit: enrichVisit(get('SELECT * FROM maintenance_visits WHERE id=?', [dup.visit_id])),
      row: get('SELECT * FROM maintenance_schedule_months WHERE id=?', [sched.id]) });
  }
  const remarks = b.remarks != null && String(b.remarks).trim() ? String(b.remarks).trim() : null;
  const now = new Date().toISOString();
  let out;
  try {
    db.exec('BEGIN IMMEDIATE');
    const visit = ensureVisit(mc, yr, mo);                       // link existing visit, or create the month's visit envelope
    if (visit.maintenance_status === 'Completed') {
      syncScheduleMonthCompleted(mc, visit, user, 'Already completed — schedule tile synced');
      db.exec('COMMIT');
      return res.json({ already_completed: true, message: `${label} is already Completed.`, visit: enrichVisit(get('SELECT * FROM maintenance_visits WHERE id=?', [visit.id])),
        row: get('SELECT * FROM maintenance_schedule_months WHERE id=?', [sched.id]) });
    }
    if (visit.maintenance_status === 'Cancelled') { db.exec('ROLLBACK'); return fail(400, `${label} visit is Cancelled — reopen it via Manage Visit before completing.`); }
    const unitsSched = Number(visit.units_scheduled || visit.total_elevator_units || mc.total_elevator_units) || 1;
    const served = Math.max(0, Number(visit.units_serviced) || 0);
    const remaining = Math.max(0, unitsSched - served);
    let add;
    if (b.units_serviced !== undefined && b.units_serviced !== null && b.units_serviced !== '') add = Number(b.units_serviced);
    else if (unitsSched === 1 || remaining <= 1) add = remaining;     // single unit / last unit: the remaining unit
    else { db.exec('ROLLBACK'); return fail(400, `Enter Units Serviced — ${served} of ${unitsSched} units already serviced, ${remaining} remaining.`, { units_scheduled: unitsSched, units_serviced: served }); }
    if (!Number.isInteger(add) || add < 0) { db.exec('ROLLBACK'); return fail(400, 'Units Serviced must be a whole number.'); }
    if (remaining > 0 && add < 1) { db.exec('ROLLBACK'); return fail(400, 'Units Serviced must be at least 1.'); }
    if (add > remaining) { db.exec('ROLLBACK'); return fail(400, `Units Serviced (${add}) exceeds the remaining units (${remaining} of ${unitsSched}).`); }
    const newServ = served + add;
    const newStatus = newServ >= unitsSched ? 'Completed' : 'Partially Completed';
    const prevStatus = visit.maintenance_status && visit.maintenance_status !== 'Pending' ? visit.maintenance_status : (sched.schedule_status || 'Scheduled');
    const upd = {
      maintenance_status: newStatus, service_completed: newStatus === 'Completed' ? 1 : 0, completion_date: cd,
      units_scheduled: unitsSched, units_serviced: newServ, units_not_serviced: unitsSched - newServ,
      updated_by: user, updated_at: now,
    };
    if (newStatus === 'Completed') upd.completed_by = user;
    if (newStatus === 'Partially Completed' && !visit.status_reason) upd.status_reason = `${newServ} of ${unitsSched} units serviced`;
    if (remarks) upd.remarks = visit.remarks ? `${visit.remarks}\n${remarks}` : remarks;
    run(`UPDATE maintenance_visits SET ${Object.keys(upd).map(k => `${k}=?`).join(', ')} WHERE id=?`, [...Object.values(upd), visit.id]);
    for (const f of Object.keys(upd)) if (!['updated_by', 'updated_at'].includes(f)) auditVisit(visit.id, f, visit[f], upd[f], user, `Monthly Visits — marked ${newStatus}`);
    if (add > 0) {
      const seq = (get('SELECT COUNT(*) c FROM maintenance_sub_visits WHERE visit_id=?', [visit.id]).c || 0) + 1;
      run(`INSERT INTO maintenance_sub_visits (visit_id, maintenance_contract_id, contract_ref, sub_visit_seq, actual_date, units_serviced,
           work_performed, remarks, created_by, created_at, client_request_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [visit.id, mc.id, mc.contract_ref, seq, cd, add, remarks, remarks, user, now, crid]);
    }
    const updated = get('SELECT * FROM maintenance_visits WHERE id=?', [visit.id]);
    if (newStatus === 'Completed') {
      autoCreateVisitLog(mc, updated, user);                    // Visit Log: create or update the month's entry (never a second one)
      if (remarks) run(`UPDATE maintenance_visit_log SET remarks=COALESCE(remarks, ?) WHERE id=(SELECT visit_log_id FROM maintenance_visits WHERE id=?)`, [remarks, visit.id]);
      syncScheduleMonthCompleted(mc, updated, user, `Marked Completed from Monthly Visits — actual ${_dmy(cd)}`);
      // Last Service Date = latest valid completed service (derived, never typed)
      const lsd = get(`SELECT MAX(completion_date) lsd FROM maintenance_visits WHERE maintenance_contract_id=? AND maintenance_status='Completed'
                       AND completion_date IS NOT NULL AND completion_date<>''`, [mc.id]).lsd;
      // Next service: existing "Calculate Next Service From" rule (scheduled vs completion date)
      const base = mc.next_service_from === 'completion_date' ? cd : (updated.scheduled_date || cd);
      const nextDate = calcNextServiceDate(base, mc.maintenance_period);
      run(`UPDATE maintenance_contracts SET last_service_date=COALESCE(?, last_service_date)${nextDate ? ', next_service_date=?' : ''}, updated_at=? WHERE id=?`,
        nextDate ? [lsd, nextDate, now, mc.id] : [lsd, now, mc.id]);
    }
    run(`INSERT INTO maintenance_contract_history (maintenance_contract_id, field_name, old_value, new_value, changed_by, remarks) VALUES (?,?,?,?,?,?)`,
      [mc.id, `Monthly Visit ${label}`, prevStatus,
       `${newStatus === 'Completed' ? 'Maintenance Completed' : 'Partially Serviced'} (${newServ}/${unitsSched} unit${unitsSched > 1 ? 's' : ''}) — Actual ${_dmy(cd)}`,
       user, remarks]);
    writeAuditLog({ action: 'UPDATE', module: 'maintenance_visits', recordId: visit.id, recordRef: `${mc.contract_ref} ${yr}-${String(mo).padStart(2, '0')}`,
      performedBy: user, details: { action: 'MONTH_COMPLETE', from: prevStatus, to: newStatus, completion_date: cd, units_added: add,
        units_serviced: newServ, units_scheduled: unitsSched, visit_ref: visit.visit_ref, remarks } });
    db.exec('COMMIT');
    out = { status: newStatus, units_serviced: newServ, units_scheduled: unitsSched,
      message: newStatus === 'Completed' ? `${label} maintenance marked as Completed.` : `${label}: ${newServ} of ${unitsSched} units serviced — Partial.`,
      visit: enrichVisit(get('SELECT * FROM maintenance_visits WHERE id=?', [visit.id])),
      row: get('SELECT * FROM maintenance_schedule_months WHERE id=?', [sched.id]) };
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) { /* already rolled back */ }
    if (crid && /UNIQUE/.test(e.message)) {
      const dup = get('SELECT visit_id FROM maintenance_sub_visits WHERE client_request_id=?', [crid]);
      if (dup) return res.json({ duplicate: true, visit: get('SELECT * FROM maintenance_visits WHERE id=?', [dup.visit_id]) });
    }
    console.error('[MCM complete month]', mc.contract_ref, label, e.message);
    return fail(500, 'Unable to save maintenance completion: ' + e.message);
  }
  res.json(out);
});

module.exports = router;
