// Phase 6 migration (2026-06-30) - "Factory/Suppliers Module & Main Dashboard Update".
// Idempotent: safe to run multiple times.
//
// Changes:
//  1. factory_sea_costs: add clearance_cost column (new field after Shipping Cost per spec).
//  2. factory_sea_costs: remap existing payment_status 'Paid' -> 'Full Paid' (SEA COSTS-only
//     narrowed option list is Partial/Full Paid/Unpaid; all 40 existing rows were 'Paid').
//  3. factory_new_projects: add linked_contract_status column (manual Contract Ref./Factory Ref.
//     linking feature - mirrors the same column already present on factory_sea_costs/
//     factory_otj_quotes/factory_ins_quotes).
//
// Does NOT touch any other table. No CHECK-constraint rebuild needed anywhere (verified:
// payment_status has no CHECK constraint on any factory_* table; factory_delivery_status's
// existing 7-value CHECK already permits the new SEA COSTS-only 5-value subset).
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'sh_pms.sqlite'));
db.exec('PRAGMA journal_mode = MEMORY;');

function hasColumn(table, col) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some(r => r.name === col);
}

console.log('--- Phase 6 migration start ---');

if (!hasColumn('factory_sea_costs', 'clearance_cost')) {
  db.exec(`ALTER TABLE factory_sea_costs ADD COLUMN clearance_cost REAL;`);
  console.log('Added factory_sea_costs.clearance_cost');
} else {
  console.log('factory_sea_costs.clearance_cost already exists, skipping');
}

const remapped = db.prepare(`UPDATE factory_sea_costs SET payment_status = 'Full Paid' WHERE payment_status = 'Paid'`).run();
console.log(`Remapped payment_status 'Paid' -> 'Full Paid' on factory_sea_costs: ${remapped.changes} row(s)`);

if (!hasColumn('factory_new_projects', 'linked_contract_status')) {
  db.exec(`ALTER TABLE factory_new_projects ADD COLUMN linked_contract_status TEXT CHECK(linked_contract_status IN ('Linked','Pending Contract Ref.','Contract Ref. Not Found')) DEFAULT 'Pending Contract Ref.';`);
  console.log('Added factory_new_projects.linked_contract_status');
} else {
  console.log('factory_new_projects.linked_contract_status already exists, skipping');
}

const backfilled = db.prepare(`UPDATE factory_new_projects SET linked_contract_status = 'Pending Contract Ref.' WHERE linked_contract_status IS NULL`).run();
console.log(`Backfilled NULL linked_contract_status on factory_new_projects: ${backfilled.changes} row(s)`);

const check = db.prepare('PRAGMA integrity_check').get();
console.log('PRAGMA integrity_check:', JSON.stringify(check));

console.log('--- Phase 6 migration complete ---');
db.close();
