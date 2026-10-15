#!/usr/bin/env node
// =============================================================
// migrate_quotation_statuses_20260921.js
// Normalises quotations.status to the approved six-status set:
//   quoted | follow_up | negotiation | approved | lost | tender
//
// INSTRUCTIONS (run BEFORE restarting the server):
//   1. Stop the app server.
//   2. Run: node db\migrate_quotation_statuses_20260921.js
//   3. Review the output for any FLAGGED records.
//   4. Restart the app server (db.js will update the CHECK constraint).
//
// MAPPING:
//   submitted   → quoted
//   revised     → quoted
//   draft       → quoted
//   under_review → follow_up
//   hold        → follow_up
//   rejected    → lost
//   cancelled   → lost
//   enquiry     → follow_up  (flagged — confirm manually)
//
//   quoted, negotiation, approved, lost  →  kept as-is
//   tender  — new status, no existing records
//
// Records with approved/lost are NEVER downgraded.
// All changes logged to status_history with changed_by='MIGRATION-20260921'.
// =============================================================
'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const DB_PATH = path.join(__dirname, 'sh_pms.sqlite');

const MAPPING = {
  submitted:    { to: 'quoted',    note: 'Migration: submitted → quoted' },
  revised:      { to: 'quoted',    note: 'Migration: revised → quoted (revision history preserved in quotation_revisions)' },
  draft:        { to: 'quoted',    note: 'Migration: draft → quoted' },
  under_review: { to: 'follow_up', note: 'Migration: under_review → follow_up' },
  hold:         { to: 'follow_up', note: 'Migration: hold → follow_up' },
  rejected:     { to: 'lost',      note: 'Migration: rejected → lost' },
  cancelled:    { to: 'lost',      note: 'Migration: cancelled → lost' },
  enquiry:      { to: 'follow_up', note: 'Migration: enquiry → follow_up [FLAGGED — confirm manually]', flag: true },
};

// Statuses that must never be downgraded
const PROTECTED = new Set(['approved', 'lost', 'quoted', 'negotiation', 'follow_up', 'tender']);

const APPROVED_SET = new Set(['quoted','follow_up','negotiation','approved','lost','tender']);

function main() {
  const db = new DatabaseSync(DB_PATH);
  const now = new Date().toISOString();

  // ── Audit: list all current statuses ───────────────────────────────────────
  console.log('\n=== STATUS AUDIT ===');
  const statCounts = db.prepare(`SELECT status, COUNT(*) AS cnt FROM quotations WHERE is_deleted=0 GROUP BY status ORDER BY cnt DESC`).all();
  statCounts.forEach(r => console.log(`  ${String(r.status || 'NULL').padEnd(20)} ${r.cnt} record(s)`));
  console.log('');

  // ── Identify records needing migration ─────────────────────────────────────
  const toMigrate = db.prepare(`SELECT id, quote_ref, client_name, status FROM quotations WHERE is_deleted=0 AND status NOT IN ('quoted','follow_up','negotiation','approved','lost','tender')`).all();

  if (toMigrate.length === 0) {
    console.log('✓ All active records already use approved statuses. Nothing to migrate.\n');
    db.close();
    return;
  }

  console.log(`Found ${toMigrate.length} record(s) requiring status migration:`);
  toMigrate.forEach(r => {
    const m = MAPPING[r.status];
    const arrow = m ? `→ ${m.to}` : '→ ??? (UNMAPPED — will SKIP)';
    const flag = m && m.flag ? ' [FLAGGED]' : '';
    console.log(`  [${r.id}] ${r.quote_ref} | ${r.status} ${arrow}${flag} | ${r.client_name || ''}`);
  });
  console.log('');

  // ── Run migration in one transaction ───────────────────────────────────────
  const updateStmt = db.prepare(`UPDATE quotations SET status=?, updated_at=? WHERE id=?`);
  const histStmt   = db.prepare(
    `INSERT INTO status_history (entity_type, entity_id, field_name, old_value, new_value, changed_by, remarks)
     VALUES ('project', ?, 'status', ?, ?, 'MIGRATION-20260921', ?)`
  );

  let migrated = 0, skipped = 0, flagged = 0;

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const rec of toMigrate) {
      const oldStatus = rec.status;

      // Already in approved set — shouldn't happen due to WHERE but guard anyway
      if (APPROVED_SET.has(oldStatus)) { skipped++; continue; }

      const m = MAPPING[oldStatus];
      if (!m) {
        console.log(`  SKIP [${rec.id}] ${rec.quote_ref}: no mapping for status '${oldStatus}'`);
        skipped++;
        continue;
      }

      // Never downgrade approved/lost
      if (PROTECTED.has(oldStatus) && oldStatus !== rec.status) { skipped++; continue; }

      const newStatus = m.to;
      updateStmt.run(newStatus, now, rec.id);
      histStmt.run(rec.id, oldStatus, newStatus, m.note);
      migrated++;
      if (m.flag) {
        flagged++;
        console.log(`  [FLAGGED] [${rec.id}] ${rec.quote_ref}: '${oldStatus}' → '${newStatus}' — please review manually`);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch(_) {}
    console.error('ERROR — rolled back:', err.message);
    process.exit(1);
  }

  console.log(`\n✓ Migration complete: ${migrated} updated, ${skipped} skipped`);
  if (flagged > 0) {
    console.log(`\n⚠  ${flagged} record(s) were FLAGGED (enquiry → follow_up). Please review these quotations manually and confirm the correct status.`);
  }

  // ── Post-migration audit ────────────────────────────────────────────────────
  console.log('\n=== POST-MIGRATION STATUS AUDIT ===');
  const postCounts = db.prepare(`SELECT status, COUNT(*) AS cnt FROM quotations WHERE is_deleted=0 GROUP BY status ORDER BY cnt DESC`).all();
  postCounts.forEach(r => {
    const ok = APPROVED_SET.has(r.status) ? '✓' : '✗ LEGACY';
    console.log(`  ${ok} ${String(r.status || 'NULL').padEnd(20)} ${r.cnt} record(s)`);
  });

  console.log('\nNext step: restart the app server. db.js will update the DB CHECK constraint automatically.\n');
  db.close();
}

main();
