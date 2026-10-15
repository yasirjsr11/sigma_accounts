// Adds the new Contract Records fields, the contract change log, and the new
// Maintenance Records module (maintenance_contracts + maintenance_visit_log).
// Purely additive - does not alter any existing table's columns or constraints,
// and does not touch projects / factory_orders / maintenance_records / amc_contracts.
const { run, get, all } = require('../db/db.js');

function columnExists(table, col) {
  const cols = all(`PRAGMA table_info(${table})`);
  return cols.some(c => c.name === col);
}

if (!columnExists('contracts', 'project_description')) {
  run(`ALTER TABLE contracts ADD COLUMN project_description TEXT`);
  console.log('Added contracts.project_description');
} else console.log('contracts.project_description already exists');

run(`CREATE TABLE IF NOT EXISTS contract_changelog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  old_contract_ref TEXT,
  new_contract_ref TEXT NOT NULL,
  client_name TEXT,
  reason TEXT NOT NULL,
  changed_by TEXT,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
console.log('Ensured contract_changelog');

run(`CREATE TABLE IF NOT EXISTS contract_duplicate_review (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_ref TEXT,
  client_name TEXT,
  duplicate_of_ref TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Needs Review' CHECK(status IN ('Needs Review','Resolved - Kept Both','Resolved - Removed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
console.log('Ensured contract_duplicate_review');

run(`CREATE TABLE IF NOT EXISTS maintenance_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  maintenance_id TEXT UNIQUE NOT NULL,
  contract_ref TEXT,
  contract_ref_status TEXT NOT NULL DEFAULT 'Linked' CHECK(contract_ref_status IN ('Linked','Pending Contract Ref','Contract Ref Not Found')),
  client_name TEXT,
  project_site_name TEXT,
  emirate TEXT,
  maintenance_type TEXT DEFAULT 'AMC',
  maintenance_period INTEGER,
  start_date TEXT,
  end_date TEXT,
  service_frequency TEXT,
  monthly_service_status TEXT,
  last_service_date TEXT,
  next_service_date TEXT,
  assigned_technician TEXT,
  remarks TEXT,
  renewal_status TEXT NOT NULL DEFAULT 'Active Maintenance' CHECK(renewal_status IN ('Active Maintenance','Expired / Renewal Required','Cancelled')),
  linked_contract_status TEXT,
  lifts_qty INTEGER,
  source_sheet TEXT,
  source_file TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
run(`CREATE INDEX IF NOT EXISTS idx_maint_contracts_ref ON maintenance_contracts(contract_ref)`);
run(`CREATE INDEX IF NOT EXISTS idx_maint_contracts_end_date ON maintenance_contracts(end_date)`);
run(`CREATE INDEX IF NOT EXISTS idx_maint_contracts_renewal ON maintenance_contracts(renewal_status)`);
console.log('Ensured maintenance_contracts');

run(`CREATE TABLE IF NOT EXISTS maintenance_visit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  maintenance_contract_id INTEGER REFERENCES maintenance_contracts(id),
  contract_ref TEXT,
  month TEXT NOT NULL,
  visit_date TEXT,
  technician TEXT,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Scheduled','Completed','Missed','Rescheduled','Not Active','Expired')),
  completion_date TEXT,
  remarks TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(contract_ref, month)
)`);
run(`CREATE INDEX IF NOT EXISTS idx_visit_log_month ON maintenance_visit_log(month)`);
run(`CREATE INDEX IF NOT EXISTS idx_visit_log_ref ON maintenance_visit_log(contract_ref)`);
console.log('Ensured maintenance_visit_log');

run(`CREATE TABLE IF NOT EXISTS maintenance_contract_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  maintenance_contract_id INTEGER NOT NULL REFERENCES maintenance_contracts(id),
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  remarks TEXT
)`);
console.log('Ensured maintenance_contract_history');

console.log('Migration complete.');
