// One-time migration (2026-06-27): Module changes per user instruction.
// 1. Rename projects -> quotations (Client Projects -> Quotations full rename)
// 2. Drop maintenance_records (the "Maintenance" module only; maintenance_contracts/"Maintenance Records" untouched)
// 3. Drop amc_contracts (the "AMC Contracts" module)
// 4. Add contract_ref, linked_contract_status, factory_delivery_status to factory_sea_costs and factory_otj_quotes
//
// Usage: node db/migrate_modules_v4.js --apply   (defaults to dry-run / report-only without --apply)
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const APPLY = process.argv.includes('--apply');
const DB_PATH = path.join(__dirname, 'sh_pms.sqlite');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = MEMORY;');

function count(table) {
  try { return db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c; }
  catch (e) { return null; }
}

console.log('=== Pre-migration state ===');
const before = {
  projects: count('projects'),
  maintenance_records: count('maintenance_records'),
  amc_contracts: count('amc_contracts'),
  contracts: count('contracts'),
  maintenance_contracts: count('maintenance_contracts'),
  factory_sea_costs: count('factory_sea_costs'),
  factory_otj_quotes: count('factory_otj_quotes'),
};
console.log(JSON.stringify(before, null, 2));

if (!APPLY) {
  console.log('\nDRY RUN (no changes made). Re-run with --apply to execute.');
  console.log('Planned actions:');
  console.log('  ALTER TABLE projects RENAME TO quotations;');
  console.log('  DROP TABLE maintenance_records;');
  console.log('  DROP TABLE amc_contracts;');
  console.log('  ALTER TABLE factory_sea_costs ADD COLUMN contract_ref TEXT;');
  console.log('  ALTER TABLE factory_sea_costs ADD COLUMN linked_contract_status TEXT;');
  console.log('  ALTER TABLE factory_sea_costs ADD COLUMN factory_delivery_status TEXT;');
  console.log('  ALTER TABLE factory_otj_quotes ADD COLUMN contract_ref TEXT;');
  console.log('  ALTER TABLE factory_otj_quotes ADD COLUMN linked_contract_status TEXT;');
  console.log('  ALTER TABLE factory_otj_quotes ADD COLUMN factory_delivery_status TEXT;');
  process.exit(0);
}

db.exec('PRAGMA foreign_keys = OFF;'); // rename/drop must not be blocked mid-transaction; re-check after
db.exec('BEGIN IMMEDIATE;');
try {
  // 1. Rename projects -> quotations (SQLite auto-fixes REFERENCES projects(id) in contracts/project_links)
  db.exec('ALTER TABLE projects RENAME TO quotations;');

  // 2. Drop maintenance_records (Maintenance module only)
  db.exec('DROP TABLE IF EXISTS maintenance_records;');
  db.exec('DROP INDEX IF EXISTS idx_maintenance_project;');
  db.exec('DROP INDEX IF EXISTS idx_maintenance_service_date;');
  db.exec('DROP INDEX IF EXISTS idx_maintenance_next_date;');
  db.exec('DROP INDEX IF EXISTS idx_maintenance_status;');

  // 3. Drop amc_contracts (AMC Contracts module)
  db.exec('DROP TABLE IF EXISTS amc_contracts;');
  db.exec('DROP INDEX IF EXISTS idx_amc_project;');
  db.exec('DROP INDEX IF EXISTS idx_amc_status;');
  db.exec('DROP INDEX IF EXISTS idx_amc_expiry;');

  // 4. Factory module: add Contract Ref. linking fields + 7-stage delivery status
  for (const t of ['factory_sea_costs', 'factory_otj_quotes']) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
    if (!cols.includes('contract_ref')) db.exec(`ALTER TABLE ${t} ADD COLUMN contract_ref TEXT;`);
    if (!cols.includes('linked_contract_status')) db.exec(`ALTER TABLE ${t} ADD COLUMN linked_contract_status TEXT CHECK(linked_contract_status IN ('Linked','Pending Contract Ref.','Contract Ref. Not Found'));`);
    if (!cols.includes('factory_delivery_status')) db.exec(`ALTER TABLE ${t} ADD COLUMN factory_delivery_status TEXT CHECK(factory_delivery_status IN ('Order Confirmation','Production','Shipping','In Transit','Arrived','Delayed','Delivered'));`);
  }

  db.exec('COMMIT;');
} catch (e) {
  db.exec('ROLLBACK;');
  console.error('MIGRATION FAILED, rolled back:', e.message);
  process.exit(1);
}
db.exec('PRAGMA foreign_keys = ON;');

console.log('\n=== Migration applied ===');
const integrity = db.prepare('PRAGMA integrity_check').all();
console.log('integrity_check:', JSON.stringify(integrity));
const fkCheck = db.prepare('PRAGMA foreign_key_check').all();
console.log('foreign_key_check violations:', fkCheck.length);
if (fkCheck.length) console.log(JSON.stringify(fkCheck, null, 2));

console.log('\n=== Post-migration state ===');
const after = {
  quotations: count('quotations'),
  projects_should_be_null: count('projects'),
  maintenance_records_should_be_null: count('maintenance_records'),
  amc_contracts_should_be_null: count('amc_contracts'),
  contracts: count('contracts'),
  maintenance_contracts: count('maintenance_contracts'),
  factory_sea_costs: count('factory_sea_costs'),
  factory_otj_quotes: count('factory_otj_quotes'),
};
console.log(JSON.stringify(after, null, 2));
console.log('\nfactory_sea_costs columns:', db.prepare('PRAGMA table_info(factory_sea_costs)').all().map(c=>c.name).join(','));
console.log('factory_otj_quotes columns:', db.prepare('PRAGMA table_info(factory_otj_quotes)').all().map(c=>c.name).join(','));
