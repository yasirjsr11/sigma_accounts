// Authoritative monthly maintenance metrics — single source of truth (2026-09-28).
//
// Every Maintenance screen (Monthly Calendar, Maintenance Dashboard service KPIs,
// 12 Month Visit Trend, Monthly Maintenance Report) derives its unit totals from
// getMonthlyMaintenanceMetrics(). No screen may compute its own totals.
//
// SERVICE POPULATION for (year, month) — one row per maintenance record:
//
//   REGULAR / MANUAL  A maintenance_schedule_months row exists for the month
//                     (schedule_source 'auto' = regular cycle, 'manual' = approved
//                     manual month) for an eligible contract.
//                     Due units = contract total_elevator_units.
//
//   RECOVERY          No schedule row for the month, but a visit in the month
//                     ACTUALLY serviced units (Completed / Partially Completed).
//                     This is a real service carried out off-cycle (e.g. a late
//                     service for a missed/overdue month). It is part of this
//                     month's operational workload, so it is added to BOTH Due and
//                     Scheduled (unified-population model) and also reported
//                     separately as recoveryUnits.
//
//   EXCLUDED          A visit row in a month with no schedule row and NO service
//                     (Pending / Scheduled / Hold / Missed / Postponed placeholder).
//                     These are stale stubs left behind when a schedule month was
//                     removed (period correction, renewal regeneration, off-cycle
//                     clean-up). They are NOT workload: excluded from every KPI and
//                     listed in exceptions.orphanPlaceholders for review.
//
// ELIGIBILITY: established rules — Hold, Renewed and Cancelled maintenance records
// are not active service obligations (renewal_status NOT IN Cancelled/Renewed/Hold),
// and contracts whose Project Status is Cancelled are excluded.
// HISTORY PRESERVATION: a visit on a now-Hold/Cancelled contract that ACTUALLY
// serviced units stays in its month (the work was done while the AMC was active),
// but such contracts never add Pending/Missed/outstanding workload.
//
// UNIT RULES (per population row, all in elevator units, never row counts):
//   due        = contract units (missing quantity → 1, reported as exception)
//   scheduled  = due, reduced only when the visit explicitly schedules fewer units
//   completed  = units actually serviced (Completed with no unit figure → scheduled)
//   then the scheduled units are split exactly once into:
//   completed + partialRemaining + pending + postponed + hold + missed = scheduled
//
// INVARIANTS (validated on every call, violations logged for admins):
//   0 <= completed <= scheduled <= due ;  completion % = completed / due <= 100

const { all } = require('./db.js');
const { mcNotCancelledSql } = require('./amcEligibility.js');

const SERVICED_STATUSES = ['Completed', 'Partially Completed'];

function eligibilitySql(mc = 'mc') {
  return `${mc}.is_deleted = 0
    AND COALESCE(${mc}.renewal_status,'') NOT IN ('Cancelled','Renewed','Hold')
    AND ${mcNotCancelledSql(mc)}`;
}

function filterSql(filters, params, mc = 'mc') {
  const w = [];
  const f = filters || {};
  if (f.contract_ref)     { w.push(`${mc}.contract_ref LIKE ?`);     params.push(`%${f.contract_ref}%`); }
  if (f.client)           { w.push(`${mc}.client_name LIKE ?`);      params.push(`%${f.client}%`); }
  if (f.emirate)          { w.push(`${mc}.emirate = ?`);             params.push(f.emirate); }
  if (f.maintenance_type) { w.push(`${mc}.maintenance_type = ?`);    params.push(f.maintenance_type); }
  if (f.renewal_status)   { w.push(`${mc}.renewal_status = ?`);      params.push(f.renewal_status); }
  return w.length ? ' AND ' + w.join(' AND ') : '';
}

const MC_COLS = `(${eligibilitySql('mc')}) AS is_active_obligation, mc.id AS contract_id, mc.maintenance_id, mc.contract_ref, mc.client_name, mc.emirate,
  mc.maintenance_type, mc.maintenance_period, mc.scheduling_method, mc.renewal_status,
  mc.total_elevator_units AS contract_units`;
const MV_COLS = `mv.id AS visit_id, mv.visit_ref, mv.maintenance_status, mv.units_scheduled,
  mv.units_serviced, mv.total_elevator_units AS visit_units, mv.scheduled_date, mv.completion_date,
  mv.postponed_date, mv.created_at AS visit_created_at`;

function classify(row, source, exceptions) {
  let due = Number(row.contract_units) || 0;
  if (due <= 0) {
    due = 1;
    exceptions.missingUnitQty.push({ contract_ref: row.contract_ref, maintenance_id: row.maintenance_id });
  }
  const st = row.visit_id ? (row.maintenance_status || 'Pending') : 'Pending';
  const vs = Number(row.units_scheduled);
  let scheduled = (row.visit_id && vs > 0) ? Math.min(vs, due) : due;
  if (row.visit_id && vs > due) {
    exceptions.scheduledExceedsUnits.push({ contract_ref: row.contract_ref, visit_ref: row.visit_ref, units_scheduled: vs, contract_units: due });
  }
  const serv = Math.max(0, Number(row.units_serviced) || 0);
  if (source === 'recovery') {
    // Recovery rows exist only because units were serviced: due = scheduled = serviced scope
    scheduled = Math.min(due, Math.max(serv, vs > 0 ? vs : serv));
    due = scheduled;
  }

  const out = { completed: 0, partialRemaining: 0, pending: 0, postponed: 0, hold: 0, missed: 0 };
  if (st === 'Completed') {
    out.completed = serv > 0 ? Math.min(serv, scheduled) : scheduled;
    if (serv > 0 && serv < scheduled) {
      out.partialRemaining = scheduled - serv;
      exceptions.completedButUnitsShort.push({ contract_ref: row.contract_ref, visit_ref: row.visit_ref, units_scheduled: scheduled, units_serviced: serv });
    }
  } else if (st === 'Partially Completed') {
    out.completed = Math.min(serv, scheduled);
    out.partialRemaining = scheduled - out.completed;
  } else if (st === 'Postponed') out.postponed = scheduled;
  else if (st === 'Hold')        out.hold = scheduled;
  else if (st === 'Missed')      out.missed = scheduled;
  else                           out.pending = scheduled;   // Pending / Scheduled / not yet logged
  if (serv > scheduled) {
    exceptions.servicedExceedsScheduled.push({ contract_ref: row.contract_ref, visit_ref: row.visit_ref, units_serviced: serv, units_scheduled: scheduled });
  }

  return {
    source,
    contract_id: row.contract_id, maintenance_id: row.maintenance_id, contract_ref: row.contract_ref,
    client_name: row.client_name, emirate: row.emirate, maintenance_type: row.maintenance_type,
    maintenance_period: row.maintenance_period, scheduling_method: row.scheduling_method,
    renewal_status: row.renewal_status,
    schedule_source: row.schedule_source || (source === 'recovery' ? 'recovery' : null),
    schedule_date: row.schedule_date || null,
    visit_id: row.visit_id || null, visit_ref: row.visit_ref || null,
    status: st, latest_status: st,
    scheduled_date: row.scheduled_date || null, completion_date: row.completion_date || null,
    postponed_date: row.postponed_date || null,
    total_elevator_units: Number(row.contract_units) || 0,
    due_units: due, sched_units: scheduled, units_serviced: serv,
    completed_units: out.completed, partial_remaining_units: out.partialRemaining,
    pending_units: out.pending, postponed_units: out.postponed, hold_units: out.hold, missed_units: out.missed,
    unscheduled_units: Math.max(0, due - scheduled),
    visit_logged: !!row.visit_id,
    // false = contract is now Hold/Cancelled; row kept only because units were actually serviced
    active_obligation: !!row.is_active_obligation,
  };
}

/**
 * Authoritative unit metrics for one month.
 * filters: { contract_ref, client, emirate, maintenance_type, renewal_status }
 */
function getMonthlyMaintenanceMetrics(year, month, filters = {}) {
  year = Number(year); month = Number(month);
  const exceptions = {
    orphanPlaceholders: [], missingUnitQty: [], scheduledExceedsUnits: [],
    servicedExceedsScheduled: [], completedButUnitsShort: [],
  };

  // REGULAR / MANUAL rows (schedule row exists). LEFT JOIN on the unique primary
  // visit (contract, year, month) — one visit per schedule row, no multiplication.
  const p1 = [year, year, month];
  const f1 = filterSql(filters, p1);
  const regular = all(`
    SELECT ${MC_COLS}, sm.schedule_source, sm.schedule_date, ${MV_COLS}
    FROM maintenance_schedule_months sm
    JOIN maintenance_contracts mc ON mc.id = sm.maintenance_contract_id
    LEFT JOIN maintenance_visits mv ON mv.maintenance_contract_id = sm.maintenance_contract_id
      AND mv.visit_year = ? AND mv.visit_month = sm.month AND mv.rescheduled_from_id IS NULL
    WHERE sm.schedule_year = ? AND sm.month = ? AND mc.is_deleted = 0 ${f1}
      AND ( (${eligibilitySql('mc')})
            OR (mv.maintenance_status IN ('Completed','Partially Completed') AND COALESCE(mv.units_serviced,0) > 0) )
    ORDER BY mc.emirate, mc.contract_ref`, p1);

  // Visits in the month with NO schedule row → recovery (serviced) or orphan placeholder
  const p2 = [year, month];
  const f2 = filterSql(filters, p2);
  const offSchedule = all(`
    SELECT ${MC_COLS}, NULL AS schedule_source, NULL AS schedule_date, ${MV_COLS}
    FROM maintenance_visits mv
    JOIN maintenance_contracts mc ON mc.id = mv.maintenance_contract_id
    WHERE mv.visit_year = ? AND mv.visit_month = ? AND mv.rescheduled_from_id IS NULL
      AND mc.is_deleted = 0 ${f2}
      AND ( (${eligibilitySql('mc')})
            OR (mv.maintenance_status IN ('Completed','Partially Completed') AND COALESCE(mv.units_serviced,0) > 0) )
      AND NOT EXISTS (SELECT 1 FROM maintenance_schedule_months s2
                      WHERE s2.maintenance_contract_id = mv.maintenance_contract_id
                        AND s2.schedule_year = mv.visit_year AND s2.month = mv.visit_month)
    ORDER BY mc.emirate, mc.contract_ref`, p2);

  const rows = regular.map(r => classify(r, r.schedule_source === 'manual' ? 'manual' : 'regular', exceptions));
  for (const r of offSchedule) {
    const serv = Number(r.units_serviced) || 0;
    if (SERVICED_STATUSES.includes(r.maintenance_status) && serv > 0) {
      rows.push(classify(r, 'recovery', exceptions));
    } else {
      exceptions.orphanPlaceholders.push({
        contract_ref: r.contract_ref, maintenance_id: r.maintenance_id, visit_id: r.visit_id,
        visit_ref: r.visit_ref, status: r.maintenance_status, maintenance_period: r.maintenance_period,
        units: Number(r.units_scheduled || r.contract_units) || 0, created_at: r.visit_created_at,
        reason: 'Visit row exists but the month is not on the maintenance schedule and no units were serviced',
      });
    }
  }

  const sum = k => rows.reduce((s, r) => s + (r[k] || 0), 0);
  const m = {
    year, month, filters,
    dueUnits: sum('due_units'),
    regularDueUnits: rows.filter(r => r.source !== 'recovery').reduce((s, r) => s + r.due_units, 0),
    recoveryUnits: rows.filter(r => r.source === 'recovery').reduce((s, r) => s + r.due_units, 0),
    manualUnits: rows.filter(r => r.source === 'manual').reduce((s, r) => s + r.due_units, 0),
    scheduledUnits: sum('sched_units'),
    unscheduledDueUnits: sum('unscheduled_units'),
    completedUnits: sum('completed_units'),
    completedFullUnits: rows.filter(r => r.status === 'Completed').reduce((s, r) => s + r.completed_units, 0),
    partialServicedUnits: rows.filter(r => r.status === 'Partially Completed').reduce((s, r) => s + r.completed_units, 0),
    partialRemainingUnits: sum('partial_remaining_units'),
    pendingUnits: sum('pending_units'),
    postponedUnits: sum('postponed_units'),
    holdUnits: sum('hold_units'),
    missedUnits: sum('missed_units'),
    notLoggedUnits: rows.filter(r => !r.visit_logged).reduce((s, r) => s + r.sched_units, 0),
    rows,
    exceptions,
  };
  m.completionPct = m.dueUnits > 0 ? Math.round((m.completedUnits / m.dueUnits) * 1000) / 10 : 0;

  // ── Sanity validation + admin diagnostic log ──────────────────────────────
  const violations = [];
  if (m.completedUnits > m.scheduledUnits) violations.push('Completed > Scheduled');
  if (m.scheduledUnits > m.dueUnits)      violations.push('Scheduled > Due');
  if (m.completedUnits > m.dueUnits)      violations.push('Completed > Due');
  const split = m.completedUnits + m.partialRemainingUnits + m.pendingUnits + m.postponedUnits + m.holdUnits + m.missedUnits;
  if (split !== m.scheduledUnits)         violations.push(`Status split ${split} ≠ Scheduled ${m.scheduledUnits}`);
  if (m.completionPct > 100) { violations.push('Completion % > 100'); m.completionPct = 100; }
  m.valid = violations.length === 0;
  m.violations = violations;
  if (!m.valid) {
    console.warn('[maintMetrics] KPI invariant violation', JSON.stringify({
      year, month, filters, violations,
      totals: { due: m.dueUnits, scheduled: m.scheduledUnits, completed: m.completedUnits },
      affected: rows.filter(r => r.completed_units > r.sched_units || r.sched_units > r.due_units).map(r => r.contract_ref),
    }));
  }
  return m;
}

/** Aggregate several months (e.g. full-year view) using the same per-month logic. */
function getPeriodMaintenanceMetrics(periods, filters = {}) {
  const keys = ['dueUnits','regularDueUnits','recoveryUnits','manualUnits','scheduledUnits','unscheduledDueUnits',
    'completedUnits','completedFullUnits','partialServicedUnits','partialRemainingUnits','pendingUnits',
    'postponedUnits','holdUnits','missedUnits','notLoggedUnits'];
  const agg = { rows: [], exceptions: {}, violations: [], months: [] };
  keys.forEach(k => { agg[k] = 0; });
  for (const { year, month } of periods) {
    const m = getMonthlyMaintenanceMetrics(year, month, filters);
    keys.forEach(k => { agg[k] += m[k]; });
    m.rows.forEach(r => agg.rows.push({ ...r, year, scheduled_month: month }));
    Object.entries(m.exceptions).forEach(([k, v]) => { (agg.exceptions[k] = agg.exceptions[k] || []).push(...v.map(x => ({ ...x, year, month }))); });
    m.violations.forEach(v => agg.violations.push(`${year}-${month}: ${v}`));
    agg.months.push({ year, month, due: m.dueUnits, scheduled: m.scheduledUnits, completed: m.completedUnits,
      completed_full: m.completedFullUnits, partial: m.partialServicedUnits, recovery: m.recoveryUnits, valid: m.valid });
  }
  agg.completionPct = agg.dueUnits > 0 ? Math.min(100, Math.round((agg.completedUnits / agg.dueUnits) * 1000) / 10) : 0;
  agg.valid = agg.violations.length === 0;
  return agg;
}

module.exports = { getMonthlyMaintenanceMetrics, getPeriodMaintenanceMetrics };
