#!/usr/bin/env node
// recover-amc-sync.js
// One-time recovery: sync all Active AMC renewals → maintenance_contracts table.
// Run from the SH-PMS-App directory: node scripts/recover-amc-sync.js
//
// Safe to run multiple times — INSERT OR IGNORE prevents duplicate schedule months.

const path = require('path');
process.chdir(path.join(__dirname, '..'));

const { get, all, run } = require('../db/db.js');

function periodToMonths(period, customMonths) {
  const map = {
    'Every Month': 1, 'Once Every 2 Months': 2, 'Once Every 3 Months': 3,
    'Once Every 4 Months': 4, 'Once Every 6 Months': 6,
  };
  if (period === 'Custom') return parseInt(customMonths) || null;
  return map[period] || null;
}

function generateScheduleMonths(mcId, period, customMonths, startDate, endDate) {
  const interval = periodToMonths(period, customMonths);
  if (!interval || !startDate || !endDate) return 0;
  const end = new Date(endDate);
  let cur = new Date(startDate);
  cur.setDate(1);
  let count = 0;
  while (cur <= end) {
    const m = cur.getMonth() + 1;
    try {
      run('INSERT OR IGNORE INTO maintenance_schedule_months (maintenance_contract_id, month) VALUES (?, ?)',
        [mcId, m]);
      count++;
    } catch (_) {}
    cur.setMonth(cur.getMonth() + interval);
  }
  return count;
}

function logRenewalAudit(renewalId, renewalRef, action, fieldName, oldVal, newVal, performedBy, notes) {
  try {
    run(`INSERT INTO renewal_audit_log
      (amc_renewal_id,renewal_ref,action,field_name,old_value,new_value,performed_by,notes)
      VALUES(?,?,?,?,?,?,?,?)`,
      [renewalId, renewalRef, action, fieldName || null,
       oldVal != null ? String(oldVal) : null, newVal != null ? String(newVal) : null,
       performedBy, notes || null]);
  } catch (_) {}
}

function syncOne(renewal) {
  const mc = get('SELECT * FROM maintenance_contracts WHERE contract_ref=? AND is_deleted=0', [renewal.contract_ref]);
  if (!mc) return { synced: false, reason: 'no_mc_record' };
  const now = new Date().toISOString();
  const updates = { renewal_status: 'Active Maintenance', updated_at: now };
  if (renewal.new_end_date)   updates.end_date   = renewal.new_end_date;
  if (renewal.new_start_date) updates.start_date = renewal.new_start_date;
  const setSql = Object.keys(updates).map(k => `${k}=?`).join(', ');
  run(`UPDATE maintenance_contracts SET ${setSql} WHERE id=?`, [...Object.values(updates), mc.id]);
  const monthsAdded = generateScheduleMonths(
    mc.id, mc.maintenance_period, mc.custom_period_months,
    renewal.new_start_date || mc.start_date, renewal.new_end_date || mc.end_date
  );
  logRenewalAudit(renewal.id, renewal.renewal_ref, 'MC_SYNC',
    'renewal_status', mc.renewal_status, 'Active Maintenance', 'system-recovery',
    `maintenance_contracts id=${mc.id} synced. schedule_months added: ${monthsAdded}`);
  return { synced: true, mc_id: mc.id, old_status: mc.renewal_status, new_status: 'Active Maintenance', months_added: monthsAdded };
}

// ── Run recovery ──────────────────────────────────────────────────────────────
const activeRenewals = all(
  `SELECT * FROM amc_renewals WHERE amc_activation_status='Active' AND is_deleted=0`, []
);
console.log(`\nAMC Sync Recovery`);
console.log(`Active renewals found: ${activeRenewals.length}`);
console.log('─'.repeat(60));

let fixed = 0, skipped = 0;
for (const renewal of activeRenewals) {
  const mc = get(
    'SELECT id, renewal_status FROM maintenance_contracts WHERE contract_ref=? AND is_deleted=0',
    [renewal.contract_ref]
  );
  if (!mc) {
    console.log(`SKIP (no maintenance_contracts record): ${renewal.renewal_ref} [${renewal.contract_ref}]`);
    skipped++;
    continue;
  }
  if (mc.renewal_status === 'Active Maintenance') {
    console.log(`SKIP (already synced):  ${renewal.renewal_ref} → mc.id=${mc.id}`);
    skipped++;
    continue;
  }
  const result = syncOne(renewal);
  if (result.synced) {
    console.log(`FIXED: ${renewal.renewal_ref} → mc.id=${mc.id}  "${result.old_status}" → "Active Maintenance"  (+${result.months_added} schedule months)`);
    fixed++;
  } else {
    console.log(`ERROR: ${renewal.renewal_ref} — ${result.reason}`);
    skipped++;
  }
}

console.log('─'.repeat(60));
console.log(`Done. Scanned: ${activeRenewals.length} | Fixed: ${fixed} | Skipped: ${skipped}`);

// Verify SH-043 (the known broken case)
const sh043 = get(`SELECT id, contract_ref, renewal_status, start_date, end_date
  FROM maintenance_contracts WHERE contract_ref='SH-043'`);
if (sh043) {
  const months = all('SELECT month FROM maintenance_schedule_months WHERE maintenance_contract_id=?', [sh043.id]);
  console.log(`\nVerification — SH-043:`);
  console.log(`  renewal_status : ${sh043.renewal_status}`);
  console.log(`  start_date     : ${sh043.start_date}`);
  console.log(`  end_date       : ${sh043.end_date}`);
  console.log(`  schedule months: [${months.map(r => r.month).join(', ')}]`);
}
