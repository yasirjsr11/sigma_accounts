// ══════════════════════════════════════════════════════════════════════════════
// AUTHORITATIVE REGULAR-MAINTENANCE FREQUENCY ENGINE (2026-09-29)
//
// One service decides which months a maintenance record is REGULARLY due.
// Every schedule-producing path (Apply Suggested / Recalculate, renewal
// activation, maintenance-period change, one-time data repair) calls it.
// Reporting screens read the resulting maintenance_schedule_months rows through
// db/maintMetrics.js, so all screens show the same schedule.
//
// RULES
//   • Interval = Maintenance Period (Every Month=1, Every 2 Months=2, … Every
//     12 Months=12). Unknown / blank period → no automatic schedule.
//   • CYCLE ANCHOR = the latest COMPLETED REGULAR schedule month
//     (schedule_source 'auto'). Regular months are anchor ± k × interval.
//     The exact service DAY never shifts the cycle (Aug 26 → Oct, not Sep).
//     Manual months (recovery / extra services) never re-base the cycle.
//     Fallback anchors: latest completed manual month → contract start month.
//   • Regular months are generated only inside the current AMC period
//     (renewed Approved+Active period when one exists).
//   • Recalculation touches ONLY current/future months, and only rows that are
//     schedule_source='auto', schedule_status='Scheduled', with no genuine visit
//     and no user-entered planned date/remarks. Completed / Partial / Missed /
//     Postponed / Hold months, manual months and history are never removed.
//   • Every insert/remove is written to maintenance_schedule_audit together with
//     a full snapshot of the removed row (restorable).
//   • Idempotent: running it any number of times gives the same schedule.
//
// schedule_source mapping: 'auto' = AUTO_REGULAR, 'manual' = MANUAL (recovery /
// additional service entered by an authorised user).
// ══════════════════════════════════════════════════════════════════════════════
const { run, get, all, db } = require('./db.js');
const { getCurrentAMCPeriod } = require('./amcEligibility.js');

const PERIOD_MONTHS = {
  'Every Month': 1, 'Monthly': 1,
  'Every 2 Months': 2, 'Once Every 2 Months': 2, 'Bi-Monthly': 2,
  'Every 3 Months': 3, 'Once Every 3 Months': 3, 'Quarterly': 3,
  'Every 4 Months': 4, 'Once Every 4 Months': 4,
  'Every 6 Months': 6, 'Once Every 6 Months': 6, 'Half Yearly': 6,
  'Every 12 Months': 12, 'Once Every 12 Months': 12, 'Yearly': 12, 'Annual': 12,
};
/** Maintenance Period → interval in months (null when not a standard period). */
function periodToInterval(period, customMonths) {
  if (period == null || period === '') return null;
  const p = String(period).trim();
  if (PERIOD_MONTHS[p] !== undefined) return PERIOD_MONTHS[p];
  if (p === 'Custom') { const n = parseInt(customMonths, 10); return n > 0 && n <= 24 ? n : null; }
  const m = p.match(/^(?:once\s+)?every\s+(\d+)\s+months?$/i);
  if (m) return parseInt(m[1], 10);
  const n = Number(p);
  return Number.isInteger(n) && n > 0 && n <= 24 ? n : null;
}

const ymIndex = (y, m) => Number(y) * 12 + (Number(m) - 1);
const ymOf = idx => ({ year: Math.floor(idx / 12), month: (idx % 12) + 1 });
const ymKey = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
function ymFromDate(d) {
  if (!d || !/^\d{4}-\d{2}/.test(String(d))) return null;
  return ymIndex(parseInt(String(d).slice(0, 4), 10), parseInt(String(d).slice(5, 7), 10));
}
function todayIdx() {
  const n = new Date();
  return ymIndex(n.getFullYear(), n.getMonth() + 1);
}

const PROTECTED_STATUSES = new Set(['Completed', 'Partially Completed', 'Missed', 'Postponed', 'Hold', 'Cancelled']);
const NON_SCHEDULABLE = new Set(['Hold', 'Cancelled', 'Renewed']);

function ensureAuditTable() {
  db.exec(`CREATE TABLE IF NOT EXISTS maintenance_schedule_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    maintenance_contract_id INTEGER NOT NULL,
    contract_ref TEXT,
    schedule_year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    action TEXT NOT NULL,              -- REMOVED_OFF_CYCLE | ADDED_REGULAR | MANUAL_ADD | MANUAL_REMOVE | MANUAL_UPDATE
    old_status TEXT, old_source TEXT,
    snapshot TEXT,                     -- JSON of the row before the change (restorable)
    reason TEXT,
    batch_ref TEXT,
    performed_by TEXT,
    performed_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_msa_contract ON maintenance_schedule_audit(maintenance_contract_id, schedule_year, month)');
}
ensureAuditTable();

function logScheduleAudit(e) {
  run(`INSERT INTO maintenance_schedule_audit
      (maintenance_contract_id, contract_ref, schedule_year, month, action, old_status, old_source, snapshot, reason, batch_ref, performed_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [e.contract_id, e.contract_ref || null, e.year, e.month, e.action, e.old_status || null, e.old_source || null,
     e.snapshot ? JSON.stringify(e.snapshot) : null, e.reason || null, e.batch_ref || null, e.performed_by || 'system']);
}

/** Genuine visit = anything beyond an untouched Pending placeholder. */
function visitIsGenuine(v) {
  if (!v) return false;
  if (v.maintenance_status && !['Pending', 'Scheduled'].includes(v.maintenance_status)) return true;
  if (Number(v.units_serviced) > 0 || v.completion_date || Number(v.service_completed) === 1) return true;
  if (v.scheduled_date) return true;                          // a planned visit date was entered
  for (const k of ['work_performed', 'findings', 'parts_replaced', 'pending_issues', 'remarks', 'spare_parts_used']) {
    if (v[k] != null && String(v[k]).trim() !== '') return true;
  }
  if (v.technicians && v.technicians !== '[]') return true;
  return false;
}

/**
 * Determine the cycle anchor for a maintenance record.
 * Returns { idx, source: 'completed_regular'|'completed_manual'|'start_date'|null, label }.
 */
// Established cycle = the phase (month position within the interval) supported by
// the REGULAR service history of the last 18 months: regular (auto) schedule months
// that were Completed / Partially Completed / Missed / Postponed. Untouched
// 'Scheduled' rows are NOT evidence (they may be stale generated rows), manual
// recovery / extra months are NOT evidence (they never re-base the cycle).
// The phase with most evidence wins; a tie goes to the phase of the most recent
// completed regular month. The anchor is the latest history month of that phase.
function getCycleAnchor(mc) {
  const interval = periodToInterval(mc.maintenance_period, mc.custom_period_months) || 1;
  const nowIdx = todayIdx();
  const hist = all(`
    SELECT sm.schedule_year y, sm.month m, COALESCE(sm.schedule_source,'auto') src,
      COALESCE((SELECT mv.maintenance_status FROM maintenance_visits mv
                WHERE mv.maintenance_contract_id = sm.maintenance_contract_id
                  AND mv.visit_year = sm.schedule_year AND mv.visit_month = sm.month
                  AND mv.rescheduled_from_id IS NULL
                ORDER BY mv.id LIMIT 1), '') vst,
      sm.schedule_status st
    FROM maintenance_schedule_months sm
    WHERE sm.maintenance_contract_id = ?
    ORDER BY sm.schedule_year DESC, sm.month DESC`, [mc.id])
    .map(r => {
      const done = r.st === 'Completed' || ['Completed', 'Partially Completed'].includes(r.vst);
      const lapsed = !done && (['Missed', 'Postponed'].includes(r.st) || ['Missed', 'Postponed'].includes(r.vst));
      return { ...r, idx: ymIndex(r.y, r.m), done, lapsed };
    })
    .filter(r => (r.done || r.lapsed) && r.idx <= nowIdx && r.idx >= nowIdx - 18);

  const pick = (rows, source) => {
    if (!rows.length) return null;
    const score = new Map();
    for (const r of rows) { const ph = ((r.idx % interval) + interval) % interval; score.set(ph, (score.get(ph) || 0) + 1); }
    const best = Math.max(...score.values());
    const tied = [...score.entries()].filter(([, n]) => n === best).map(([ph]) => ph);
    const latestDone = rows.find(r => r.done) || rows[0];
    const latestPh = ((latestDone.idx % interval) + interval) % interval;
    const phase = tied.includes(latestPh) ? latestPh : tied[0];
    const a = rows.find(r => ((r.idx % interval) + interval) % interval === phase);
    return { idx: a.idx, source, label: ymKey(a.y, a.m), phase_evidence: best,
             ambiguous: tied.length > 1 || score.size > 1 };
  };
  const auto = pick(hist.filter(r => r.src === 'auto'), 'service_history');
  if (auto) return auto;
  const manual = pick(hist, 'manual_history');
  if (manual) return manual;
  const s = ymFromDate(mc.start_date);
  if (s != null) return { idx: s, source: 'start_date', label: String(mc.start_date).slice(0, 7) };
  return { idx: null, source: null, label: null };
}

/** Current AMC period (renewed Approved+Active period when present). */
function getPeriod(mc) {
  let start = mc.start_date, end = mc.end_date;
  try {
    const p = getCurrentAMCPeriod(mc.contract_ref);
    if (p) { start = p.current_start_date || start; end = p.current_end_date || end; }
  } catch (_) { /* fall back to record dates */ }
  return { start, end, startIdx: ymFromDate(start), endIdx: ymFromDate(end) };
}

/**
 * calculateRegularMaintenanceOccurrences(maintenanceRecord, periodStartIdx, periodEndIdx)
 * → array of { year, month } regular months in [periodStartIdx, periodEndIdx].
 */
function calculateRegularMaintenanceOccurrences(mc, fromIdx, toIdx, anchor) {
  const interval = periodToInterval(mc.maintenance_period, mc.custom_period_months);
  if (!interval) return [];
  anchor = anchor || getCycleAnchor(mc);
  if (anchor.idx == null || fromIdx == null || toIdx == null || toIdx < fromIdx) return [];
  const out = [];
  // first cycle month >= fromIdx
  let k = Math.ceil((fromIdx - anchor.idx) / interval);
  for (let i = anchor.idx + k * interval; i <= toIdx; i += interval) {
    if (i >= fromIdx) out.push(ymOf(i));
    if (out.length > 600) break;
  }
  return out;
}

/**
 * Plan (and optionally apply) the regular schedule for one maintenance record.
 * opts: { apply=false, fromIdx=current month, user, reason, batchRef, onlyIfMisaligned=false }
 * Returns a plan with keep/add/remove lists and the reason for each decision.
 */
function recalculateRegularSchedule(mcOrId, opts = {}) {
  const mc = typeof mcOrId === 'object' ? mcOrId
    : get('SELECT * FROM maintenance_contracts WHERE id=? AND is_deleted=0', [mcOrId]);
  const plan = { contract_id: mc && mc.id, contract_ref: mc && mc.contract_ref, add: [], remove: [], review: [], kept: [], applied: false };
  if (!mc) { plan.skipped = 'not_found'; return plan; }
  const interval = periodToInterval(mc.maintenance_period, mc.custom_period_months);
  plan.maintenance_period = mc.maintenance_period;
  plan.interval = interval;
  if (!interval) { plan.skipped = 'no_standard_period'; return plan; }
  if (NON_SCHEDULABLE.has(mc.renewal_status)) { plan.skipped = `renewal_status_${mc.renewal_status}`; return plan; }
  if (mc.maintenance_type === 'One-Time Service') { plan.skipped = 'one_time_service'; return plan; }

  const anchor = getCycleAnchor(mc);
  const period = getPeriod(mc);
  plan.anchor = anchor; plan.period = { start: period.start, end: period.end };
  const nowIdx = opts.fromIdx != null ? opts.fromIdx : todayIdx();
  const fromIdx = Math.max(nowIdx, period.startIdx != null ? period.startIdx : nowIdx);

  const rows = all(`SELECT * FROM maintenance_schedule_months WHERE maintenance_contract_id=? ORDER BY schedule_year, month`, [mc.id])
    .filter(r => ymIndex(r.schedule_year, r.month) >= fromIdx);
  const visits = all(`SELECT * FROM maintenance_visits WHERE maintenance_contract_id=? AND rescheduled_from_id IS NULL`, [mc.id]);
  const vmap = new Map(visits.map(v => [ymIndex(v.visit_year, v.visit_month), v]));

  // Horizon: current period end; never shorter than the furthest existing future auto row
  // (keeps coverage for expired-pending records that already carry future months).
  let toIdx = period.endIdx != null ? period.endIdx : fromIdx - 1;
  for (const r of rows) if ((r.schedule_source || 'auto') === 'auto') toIdx = Math.max(toIdx, ymIndex(r.schedule_year, r.month));

  const valid = new Set(calculateRegularMaintenanceOccurrences(mc, fromIdx, toIdx, anchor).map(o => ymIndex(o.year, o.month)));
  const existing = new Map(rows.map(r => [ymIndex(r.schedule_year, r.month), r]));

  for (const r of rows) {
    const idx = ymIndex(r.schedule_year, r.month);
    const src = r.schedule_source || 'auto';
    const v = vmap.get(idx);
    const item = { year: r.schedule_year, month: r.month, status: r.schedule_status, source: src };
    if (valid.has(idx)) { plan.kept.push({ ...item, reason: 'On regular cycle' }); continue; }
    if (src !== 'auto') { plan.kept.push({ ...item, reason: 'Manual month (recovery / additional) — preserved' }); continue; }
    if (PROTECTED_STATUSES.has(r.schedule_status)) { plan.kept.push({ ...item, reason: `Status ${r.schedule_status} — history preserved` }); continue; }
    if (visitIsGenuine(v)) { plan.review.push({ ...item, reason: `Off-cycle but visit ${v.visit_ref} has activity (${v.maintenance_status}) — kept for review` }); continue; }
    if (r.schedule_date || (r.schedule_remarks && String(r.schedule_remarks).trim())) {
      plan.review.push({ ...item, reason: 'Off-cycle but a planned date / remarks were entered — kept for review' }); continue;
    }
    plan.remove.push({ ...item, row: r, placeholder_visit: v ? v.visit_ref : null,
      reason: `Not a regular month for ${mc.maintenance_period} (cycle anchored on ${anchor.label}, ${anchor.source})` });
  }
  for (const idx of valid) {
    if (existing.has(idx)) continue;
    const o = ymOf(idx);
    // The current (running) month is never back-filled automatically — a missing
    // current-month regular service is flagged for the user instead.
    if (idx <= nowIdx) {
      if (visitIsGenuine(vmap.get(idx))) continue;   // service already recorded (counted as recovery)
      plan.review.push({ year: o.year, month: o.month, source: null, status: 'Not scheduled',
        reason: `Current month is a regular ${mc.maintenance_period} month (anchor ${anchor.label}) but has no schedule — add manually if still due` });
      continue;
    }
    plan.add.push({ year: o.year, month: o.month, reason: `Regular ${mc.maintenance_period} month (anchor ${anchor.label})` });
  }
  plan.misaligned = plan.remove.length > 0;
  if (opts.onlyIfMisaligned && !plan.misaligned) { plan.add = []; }

  if (opts.apply && (plan.add.length || plan.remove.length)) {
    const user = opts.user || 'system';
    const batch = opts.batchRef || `RECALC-${Date.now()}`;
    const reason = opts.reason || 'Recalculate regular schedule';
    const tx = () => {
      for (const r of plan.remove) {
        run('DELETE FROM maintenance_schedule_months WHERE id=? AND schedule_source=\'auto\' AND schedule_status=\'Scheduled\'', [r.row.id]);
        logScheduleAudit({ contract_id: mc.id, contract_ref: mc.contract_ref, year: r.year, month: r.month,
          action: 'REMOVED_OFF_CYCLE', old_status: r.status, old_source: r.source, snapshot: r.row,
          reason: `${reason}: ${r.reason}`, batch_ref: batch, performed_by: user });
      }
      for (const a of plan.add) {
        const res = run(`INSERT OR IGNORE INTO maintenance_schedule_months
            (maintenance_contract_id, schedule_year, month, schedule_status, schedule_source) VALUES (?,?,?,'Scheduled','auto')`,
          [mc.id, a.year, a.month]);
        if (res && res.changes) {
          logScheduleAudit({ contract_id: mc.id, contract_ref: mc.contract_ref, year: a.year, month: a.month,
            action: 'ADDED_REGULAR', reason: `${reason}: ${a.reason}`, batch_ref: batch, performed_by: user });
        }
      }
    };
    if (db.isTransaction) tx();
    else { db.exec('BEGIN'); try { tx(); db.exec('COMMIT'); } catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; } }
    plan.applied = true;
    plan.batch_ref = batch;
  }
  // strip heavy row snapshots from the returned plan
  plan.remove = plan.remove.map(({ row, ...rest }) => rest);
  return plan;
}

/** Diagnostic across all eligible non-monthly records (read-only unless apply). */
function auditAllRegularSchedules(opts = {}) {
  const recs = all(`SELECT * FROM maintenance_contracts WHERE is_deleted=0 ORDER BY contract_ref`);
  const out = [];
  for (const mc of recs) {
    const iv = periodToInterval(mc.maintenance_period, mc.custom_period_months);
    if (!iv || iv === 1) continue;
    const p = recalculateRegularSchedule(mc, { ...opts, onlyIfMisaligned: true });
    if (!p.skipped) out.push(p);
  }
  return out;
}

module.exports = {
  PERIOD_MONTHS, periodToInterval, getCycleAnchor, calculateRegularMaintenanceOccurrences,
  recalculateRegularSchedule, auditAllRegularSchedules, logScheduleAudit, visitIsGenuine,
  ymIndex, ymOf, ymKey,
};
