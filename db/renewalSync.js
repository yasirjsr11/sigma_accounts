'use strict';
// ══════════════════════════════════════════════════════════════════════════════
// RENEWAL → CURRENT AMC PERIOD SYNC (2026-10-03) — single source of truth
//
//   Renewal Approved  +  AMC Activation Active  +  ledger Total Received > 0
//        → the renewal's New Period becomes the CURRENT AMC period of the SAME
//          maintenance record (start/end dates updated, record kept Active)
//        → the renewal is "operationally completed" and leaves the Renewal Status
//          action queue (record, payments and history are never deleted)
//   A remaining balance stays a financial receivable (AMC Payments & Outstanding).
//   Hold / Pending Decision / zero payment / Cancelled never activate a period.
//
// "Synchronized" is derived from data, not a flag: the maintenance record's
// current end date has reached the renewal's new end date. Therefore the check
// is idempotent and survives refresh / restart.
//
// Safety guards (renewal stays in the queue for review instead of auto-syncing):
//   • no / ambiguous maintenance record for the Contract Ref.
//   • missing / invalid new period
//   • the new period does not follow the current one: its start is neither near
//     the current period's END (next period) nor near its START (same period with
//     corrected dates) — tolerance 31 days — e.g. a renewal that starts in the
//     middle of a running maintenance period.
// ══════════════════════════════════════════════════════════════════════════════
const { db, run, get, all } = require('./db.js');

const TOL_DAYS = 31;
const days = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
const ISO = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '').slice(0, 10)) ? String(d).slice(0, 10) : null;
const receivedSql = r => `COALESCE((SELECT SUM(_t.amount) FROM amc_payment_transactions _t WHERE _t.amc_renewal_id = ${r}.id), 0)`;

/** SQL boolean: renewal (alias r) is operationally completed = qualifies AND maintenance period synchronized. */
function completedSql(r = 'r') {
  return `(${r}.renewal_status = 'Approved' AND ${r}.amc_activation_status = 'Active'
    AND ${receivedSql(r)} > 0
    AND COALESCE(${r}.new_start_date,'') <> '' AND COALESCE(${r}.new_end_date,'') <> ''
    AND ${r}.new_end_date >= ${r}.new_start_date
    AND EXISTS (SELECT 1 FROM maintenance_contracts _mcs WHERE _mcs.contract_ref = ${r}.contract_ref AND _mcs.is_deleted = 0
                AND COALESCE(_mcs.end_date,'') >= ${r}.new_end_date))`;
}

function findMaintenance(r) {
  let rows = r.contract_ref ? all('SELECT * FROM maintenance_contracts WHERE contract_ref=? AND is_deleted=0', [r.contract_ref]) : [];
  if (!rows.length && r.maintenance_id) rows = all('SELECT * FROM maintenance_contracts WHERE maintenance_id=? AND is_deleted=0', [r.maintenance_id]);
  return rows;
}

/**
 * Evaluate one renewal. Returns { state, reason, mc, received } where state is one of
 *   'completed'  — already synchronized (leaves the queue)
 *   'sync'       — qualifies and can be synchronized now
 *   'retain'     — stays in the Renewal Status queue (reason explains why)
 */
function evaluate(r) {
  const received = Math.round((get('SELECT COALESCE(SUM(amount),0) s FROM amc_payment_transactions WHERE amc_renewal_id=?', [r.id]).s || 0) * 100) / 100;
  const out = (state, reason, mc) => ({ state, reason, mc: mc || null, received });
  if (['Cancelled', 'Rejected', 'Not Renewed'].includes(r.renewal_status)) return out('retain', 'Cancelled');
  const mcs = findMaintenance(r);
  const mc = mcs[0];
  if (mc && mc.renewal_status === 'Cancelled') return out('retain', 'Cancelled', mc);
  if (r.renewal_status !== 'Approved') return out('retain', r.renewal_status === 'Hold' ? 'Renewal On Hold' : 'Pending Approval', mc);
  if (r.amc_activation_status === 'Hold') return out('retain', 'Activation Hold', mc);
  if (r.amc_activation_status !== 'Active') return out('retain', 'Activation Pending Decision', mc);
  if (!(received > 0)) return out('retain', 'Initial Payment Not Received', mc);
  const ns = ISO(r.new_start_date), ne = ISO(r.new_end_date);
  if (!ns || !ne || ne < ns) return out('retain', 'Data Review — new period missing / invalid', mc);
  if (!mcs.length) return out('retain', 'Data Review — no Maintenance Record for this Contract Ref.');
  if (mcs.length > 1) return out('retain', `Data Review — ${mcs.length} Maintenance Records share this Contract Ref.`, mc);
  if (ISO(mc.end_date) && mc.end_date >= ne) return out('completed', 'Synchronized', mc);
  const nearEnd = ISO(mc.end_date) ? Math.abs(days(mc.end_date, ns)) <= TOL_DAYS : true;
  const nearStart = ISO(mc.start_date) ? Math.abs(days(mc.start_date, ns)) <= TOL_DAYS : false;
  if (!nearEnd && !nearStart) return out('retain', 'Data Review — new period overlaps / does not follow the current maintenance period', mc);
  return out('sync', nearEnd ? 'Next period' : 'Same period — dates corrected', mc);
}

function logRenewalAudit(r, action, field, oldV, newV, user, notes) {
  run(`INSERT INTO renewal_audit_log (amc_renewal_id, renewal_ref, action, field_name, old_value, new_value, performed_by, notes)
       VALUES (?,?,?,?,?,?,?,?)`, [r.id, r.renewal_ref, action, field || null, oldV != null ? String(oldV) : null,
       newV != null ? String(newV) : null, user, notes || null]);
}

let _sp = 0;
/** Run fn atomically. Uses a SAVEPOINT so it works inside or outside an open transaction. */
function atomic(fn) {
  const name = `rsync_${++_sp}`;
  db.exec(`SAVEPOINT ${name}`);
  try { const v = fn(); db.exec(`RELEASE ${name}`); return v; }
  catch (e) { try { db.exec(`ROLLBACK TO ${name}`); db.exec(`RELEASE ${name}`); } catch (_) {} throw e; }
}

/**
 * Make a qualifying renewal the current AMC period of its maintenance record.
 * Idempotent. Returns { synced, already, reason, before, after }.
 */
function syncRenewal(renewalId, user = 'system', opts = {}) {
  const r = get('SELECT * FROM amc_renewals WHERE id=? AND is_deleted=0', [renewalId]);
  if (!r) return { synced: false, reason: 'not_found' };
  const ev = evaluate(r);
  const base = { renewal_ref: r.renewal_ref, contract_ref: r.contract_ref, state: ev.state, reason: ev.reason, received: ev.received,
    new_period: `${r.new_start_date || '?'} → ${r.new_end_date || '?'}`,
    before: ev.mc ? `${ev.mc.start_date || '?'} → ${ev.mc.end_date || '?'}` : null };
  if (ev.state === 'completed') return { ...base, synced: true, already: true, after: base.before };
  if (ev.state !== 'sync') return { ...base, synced: false };
  if (opts.dryRun) return { ...base, synced: false, would_sync: true, after: `${r.new_start_date} → ${r.new_end_date}` };
  const mc = ev.mc;
  const now = new Date().toISOString();
  return atomic(() => {
    // 1. Preserve the superseded period on the renewal (history is never overwritten)
    if (!r.prev_start_date && !r.prev_end_date && ev.reason === 'Next period') {
      run('UPDATE amc_renewals SET prev_start_date=?, prev_end_date=? WHERE id=?', [mc.start_date || null, mc.end_date || null, r.id]);
      logRenewalAudit(r, 'PREV_PERIOD_RECORDED', 'prev_end_date', null, mc.end_date, user, `Previous AMC period ${mc.start_date || '?'} – ${mc.end_date || '?'} preserved`);
    }
    // 2. Current AMC period on the SAME maintenance record (no new record)
    const keepHold = mc.renewal_status === 'Hold';      // an operational Hold on the record is never overridden
    const upd = { start_date: r.new_start_date, end_date: r.new_end_date, updated_at: now };
    if (!keepHold && mc.renewal_status !== 'Active Maintenance') upd.renewal_status = 'Active Maintenance';
    run(`UPDATE maintenance_contracts SET ${Object.keys(upd).map(k => `${k}=?`).join(', ')} WHERE id=?`, [...Object.values(upd), mc.id]);
    const note = `Renewal ${r.renewal_ref} is now the current AMC period (Approved + Active + received ${ev.received.toFixed(2)})`;
    for (const f of ['start_date', 'end_date', 'renewal_status']) {
      if (f in upd && String(mc[f] ?? '') !== String(upd[f] ?? '')) {
        run(`INSERT INTO maintenance_contract_history (maintenance_contract_id, field_name, old_value, new_value, changed_by, remarks) VALUES (?,?,?,?,?,?)`,
          [mc.id, f, mc[f] ?? null, upd[f], user, note]);
      }
    }
    run('UPDATE amc_renewals SET maintenance_updated=1, updated_at=? WHERE id=?', [now, r.id]);
    // 3. Scheduling continuity — authoritative engine, idempotent (no duplicate months)
    let schedule = null;
    try {
      const p = require('./scheduleEngine.js').recalculateRegularSchedule(mc.id, { apply: true, user, reason: `AMC renewal ${r.renewal_ref} became current` });
      schedule = { added: p.add.length, removed: p.remove.length, skipped: p.skipped || null };
    } catch (e) { schedule = { error: e.message }; throw e; }
    logRenewalAudit(r, 'CURRENT_PERIOD_SYNC', 'maintenance_period', `${mc.start_date || '?'} – ${mc.end_date || '?'}`,
      `${r.new_start_date} – ${r.new_end_date}`, user,
      `${note}. Maintenance record id=${mc.id}${keepHold ? ' (record kept on Hold)' : ''}. Schedule: +${schedule.added || 0} / -${schedule.removed || 0}${opts.source ? '. Source: ' + opts.source : ''}`);
    try {
      require('./audit.js').writeAuditLog({ action: 'UPDATE', module: 'amc_renewals', recordId: r.id, recordRef: r.renewal_ref, performedBy: user,
        details: { action: 'CURRENT_PERIOD_SYNC', contract_ref: r.contract_ref, maintenance_id: mc.id, before: base.before,
          after: `${r.new_start_date} → ${r.new_end_date}`, received: ev.received, schedule, source: opts.source || null } });
    } catch (_) { /* audit_log is best-effort, renewal_audit_log already written */ }
    return { ...base, synced: true, already: false, after: `${r.new_start_date} → ${r.new_end_date}`, kept_hold: keepHold, schedule };
  });
}

/** Sync every qualifying renewal (oldest period first so the latest ends up current). */
function reconcileAll(user = 'system', opts = {}) {
  const rows = all(`SELECT id FROM amc_renewals WHERE is_deleted=0 AND renewal_status='Approved' AND amc_activation_status='Active'
                    ORDER BY COALESCE(new_end_date,''), id`);
  const results = [];
  for (const x of rows) {
    try { results.push(syncRenewal(x.id, user, opts)); }
    catch (e) { results.push({ id: x.id, synced: false, error: e.message }); }
  }
  return results;
}

/** Queue reason for a renewal shown in Renewal Status (null when completed). */
function queueReason(r) {
  const ev = evaluate(r);
  return ev.state === 'completed' ? null : ev.state === 'sync' ? 'Ready — synchronizing' : ev.reason;
}

module.exports = { completedSql, evaluate, syncRenewal, reconcileAll, queueReason, receivedSql };
