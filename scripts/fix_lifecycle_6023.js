// scripts/fix_lifecycle_6023.js
// Fix stale project_lifecycle entries for quote refs 6023 / 6023-2 / 6023-3
// Correct mapping: 6023-2 <-> SH-247 | 6023-3 <-> SH-248
//
// What this script does:
//   1. Finds old stale entries (quote_ref='6023') that hold SH-247 and SH-248
//   2. Clears their contract_ref and archives them (status='Archived')
//   3. Links SH-247 -> lifecycle entry for quote_ref='6023-2'
//   4. Links SH-248 -> lifecycle entry for quote_ref='6023-3'
//   5. Archives the duplicate 6023-2 entry (only one should remain)
//
// Run once from the app directory: node scripts/fix_lifecycle_6023.js

'use strict';
const path = require('path');
const { get, run, all } = require(path.join(__dirname, '..', 'db', 'db.js'));

const NOW = new Date().toISOString();
const BY  = 'system_fix_20260716';

function step(msg) { console.log('\n[FIX] ' + msg); }
function info(msg) { console.log('      ' + msg); }

step('Reading current state of project_lifecycle...');

// ── Old stale entries (quote_ref = bare '6023') ──────────────────────────────
const stale = all(
  `SELECT id, quote_ref, contract_ref, client_name, current_stage, status
   FROM project_lifecycle WHERE quote_ref = '6023' ORDER BY id`
);
info(`Stale entries (quote_ref='6023'): ${stale.length}`);
stale.forEach(r => info(`  ID ${r.id}: contract_ref=${r.contract_ref} client=${r.client_name} stage=${r.current_stage} status=${r.status}`));

// ── 6023-2 entries ───────────────────────────────────────────────────────────
const entries_6023_2 = all(
  `SELECT id, quote_ref, contract_ref, client_name, current_stage, status
   FROM project_lifecycle WHERE quote_ref = '6023-2' ORDER BY id`
);
info(`Entries for 6023-2: ${entries_6023_2.length}`);
entries_6023_2.forEach(r => info(`  ID ${r.id}: contract_ref=${r.contract_ref} stage=${r.current_stage} status=${r.status}`));

// ── 6023-3 entries ───────────────────────────────────────────────────────────
const entries_6023_3 = all(
  `SELECT id, quote_ref, contract_ref, client_name, current_stage, status
   FROM project_lifecycle WHERE quote_ref = '6023-3' ORDER BY id`
);
info(`Entries for 6023-3: ${entries_6023_3.length}`);
entries_6023_3.forEach(r => info(`  ID ${r.id}: contract_ref=${r.contract_ref} stage=${r.current_stage} status=${r.status}`));

// ── Verify contracts exist ───────────────────────────────────────────────────
const c247 = get(`SELECT contract_ref, client_name FROM contracts WHERE contract_ref='SH-247' AND is_deleted=0`);
const c248 = get(`SELECT contract_ref, client_name FROM contracts WHERE contract_ref='SH-248' AND is_deleted=0`);
if (!c247) { console.error('ERROR: SH-247 not found in contracts table. Aborting.'); process.exit(1); }
if (!c248) { console.error('ERROR: SH-248 not found in contracts table. Aborting.'); process.exit(1); }
info(`SH-247 client: ${c247.client_name}`);
info(`SH-248 client: ${c248.client_name}`);

// ── Step 1: Archive stale '6023' entries, clear their contract_refs ──────────
step('Archiving stale quote_ref=6023 entries and clearing contract_refs...');
for (const r of stale) {
  if (r.status === 'Archived') {
    info(`  ID ${r.id} already Archived — clearing contract_ref if set`);
  }
  run(
    `UPDATE project_lifecycle SET contract_ref=NULL, contract_linked_by=NULL,
     contract_linked_at=NULL, contract_link_remarks='Cleared by fix_lifecycle_6023 - stale entry',
     status='Archived', current_stage='Archived', updated_at=? WHERE id=?`,
    [NOW, r.id]
  );
  info(`  ID ${r.id}: archived, contract_ref cleared (was: ${r.contract_ref})`);
}

// ── Step 2: Choose canonical 6023-2 entry (lowest id), archive duplicates ───
step('Resolving 6023-2 duplicates...');
const keep_6023_2 = entries_6023_2[0];   // lowest id = canonical
const dup_6023_2  = entries_6023_2.slice(1);
if (!keep_6023_2) {
  console.error('ERROR: No lifecycle entry found for quote_ref=6023-2. Cannot link SH-247. Aborting.');
  process.exit(1);
}
info(`Keeping entry ID ${keep_6023_2.id} for 6023-2`);
for (const d of dup_6023_2) {
  run(`UPDATE project_lifecycle SET status='Archived', current_stage='Archived',
       remarks='Duplicate entry — archived by fix_lifecycle_6023', updated_at=? WHERE id=?`,
    [NOW, d.id]);
  info(`  Archived duplicate ID ${d.id}`);
}

// ── Step 3: Link SH-247 -> canonical 6023-2 entry ───────────────────────────
step('Linking SH-247 -> lifecycle entry ID ' + keep_6023_2.id + ' (6023-2)...');
// Confirm no other active entry holds SH-247 (after clearing stale above)
const check247 = get(
  `SELECT id FROM project_lifecycle WHERE contract_ref='SH-247' AND id != ? AND status != 'Archived'`,
  [keep_6023_2.id]
);
if (check247) {
  info(`WARNING: SH-247 is still linked to ID ${check247.id} — clearing it first`);
  run(`UPDATE project_lifecycle SET contract_ref=NULL, contract_linked_by=NULL,
       contract_linked_at=NULL, updated_at=? WHERE id=?`, [NOW, check247.id]);
}
run(
  `UPDATE project_lifecycle SET
     contract_ref='SH-247', client_name='Al Najam BC, Ajman (002)',
     contract_linked_by=?, contract_linked_at=?,
     contract_link_remarks='Linked by fix_lifecycle_6023 — corrected from stale bare-ref entry',
     current_stage='Contract Created', status=NULL, updated_at=?
   WHERE id=?`,
  [BY, NOW, NOW, keep_6023_2.id]
);
info(`  Done. Entry ${keep_6023_2.id} now has contract_ref=SH-247, stage=Contract Created`);

// ── Step 4: Link SH-248 -> 6023-3 entry ─────────────────────────────────────
const keep_6023_3 = entries_6023_3[0];
if (!keep_6023_3) {
  console.error('ERROR: No lifecycle entry found for quote_ref=6023-3. Cannot link SH-248. Aborting.');
  process.exit(1);
}
step('Linking SH-248 -> lifecycle entry ID ' + keep_6023_3.id + ' (6023-3)...');
const check248 = get(
  `SELECT id FROM project_lifecycle WHERE contract_ref='SH-248' AND id != ? AND status != 'Archived'`,
  [keep_6023_3.id]
);
if (check248) {
  info(`WARNING: SH-248 is still linked to ID ${check248.id} — clearing it first`);
  run(`UPDATE project_lifecycle SET contract_ref=NULL, contract_linked_by=NULL,
       contract_linked_at=NULL, updated_at=? WHERE id=?`, [NOW, check248.id]);
}
run(
  `UPDATE project_lifecycle SET
     contract_ref='SH-248', client_name='Al Najam BC, Ajman (003)',
     contract_linked_by=?, contract_linked_at=?,
     contract_link_remarks='Linked by fix_lifecycle_6023 — corrected from stale bare-ref entry',
     current_stage='Contract Created', status=NULL, updated_at=?
   WHERE id=?`,
  [BY, NOW, NOW, keep_6023_3.id]
);
info(`  Done. Entry ${keep_6023_3.id} now has contract_ref=SH-248, stage=Contract Created`);

// ── Final verification ───────────────────────────────────────────────────────
step('Final state verification...');
const final = all(
  `SELECT id, quote_ref, contract_ref, client_name, current_stage, status
   FROM project_lifecycle
   WHERE quote_ref IN ('6023','6023-2','6023-3') OR contract_ref IN ('SH-247','SH-248')
   ORDER BY id`
);
console.log('');
console.log('  ID  | quote_ref | contract_ref | client_name                    | stage              | status');
console.log('  ----|-----------|--------------|--------------------------------|--------------------|--------');
final.forEach(r => {
  const row = [
    String(r.id).padEnd(4),
    String(r.quote_ref||'').padEnd(9),
    String(r.contract_ref||'NULL').padEnd(12),
    String(r.client_name||'').padEnd(30).slice(0,30),
    String(r.current_stage||'').padEnd(18),
    String(r.status||'active'),
  ].join(' | ');
  console.log('  ' + row);
});

console.log('\n[FIX] Complete. Restart the app server for changes to reflect in the UI.');
