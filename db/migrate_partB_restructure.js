// Part B structural changes:
// 1. Clear Client Projects module (data only - table/schema/relationships preserved)
// 2. Restructure maintenance_contracts to the new 14-field "Maintenance Records" spec
// 3. Add maintenance_schedule_months junction table for manual monthly scheduling
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.argv[2];
if (!DB_PATH) { console.error('Usage: node migrate_partB.js <path-to-sqlite>'); process.exit(1); }
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

function run(sql, params = []) { return db.prepare(sql).run(...params); }
function get(sql, params = []) { return db.prepare(sql).get(...params); }
function all(sql, params = []) { return db.prepare(sql).all(...params); }
function columnExists(table, col) { return all(`PRAGMA table_info(${table})`).some(c => c.name === col); }

console.log('=== BEFORE ===');
console.log('projects:', get('SELECT COUNT(*) c FROM projects').c);
console.log('contracts:', get('SELECT COUNT(*) c FROM contracts WHERE is_deleted=0').c);
console.log('contracts.project_id set:', get('SELECT COUNT(*) c FROM contracts WHERE project_id IS NOT NULL').c);
console.log('maintenance_contracts:', get('SELECT COUNT(*) c FROM maintenance_contracts WHERE is_deleted=0').c);
console.log('maintenance_visit_log:', get('SELECT COUNT(*) c FROM maintenance_visit_log').c);
console.log('maintenance_records (legacy):', get('SELECT COUNT(*) c FROM maintenance_records').c);
console.log('amc_contracts (legacy):', get('SELECT COUNT(*) c FROM amc_contracts').c);

db.exec('BEGIN');
try {
  // ---------- 1. Clear Client Projects module ----------
  // Soft display-only link on Contract Records - nulling it does not change any
  // visible Contract Record field except removing the "Linked Project" convenience value.
  const r1 = run('UPDATE contracts SET project_id = NULL WHERE project_id IS NOT NULL');
  console.log('Nulled contracts.project_id on', r1.changes, 'rows');

  // The only 2 rows in the OLD legacy Maintenance / AMC Contracts modules are
  // already soft-deleted (is_deleted=1) dev/test artifacts referencing the same
  // test project_id=62 - not real production data, just FK blockers for the wipe.
  const legacyMaint = all("SELECT id FROM maintenance_records WHERE project_id = 62 AND is_deleted = 1");
  const legacyAmc = all("SELECT id FROM amc_contracts WHERE project_id = 62 AND is_deleted = 1");
  if (legacyMaint.length) { run('DELETE FROM maintenance_records WHERE id IN (' + legacyMaint.map(r=>r.id).join(',') + ')'); console.log('Hard-deleted', legacyMaint.length, 'legacy test maintenance_records row(s)'); }
  if (legacyAmc.length) { run('DELETE FROM amc_contracts WHERE id IN (' + legacyAmc.map(r=>r.id).join(',') + ')'); console.log('Hard-deleted', legacyAmc.length, 'legacy test amc_contracts row(s)'); }

  // Safety check: refuse to proceed if any OTHER (non-test) rows still reference projects
  const remainingMaint = get('SELECT COUNT(*) c FROM maintenance_records WHERE project_id IS NOT NULL').c;
  const remainingAmc = get('SELECT COUNT(*) c FROM amc_contracts WHERE project_id IS NOT NULL').c;
  const remainingLinks = get('SELECT COUNT(*) c FROM project_links').c;
  if (remainingMaint > 0) throw new Error(`Refusing to wipe projects: ${remainingMaint} real maintenance_records rows still reference a project`);
  if (remainingAmc > 0) throw new Error(`Refusing to wipe projects: ${remainingAmc} real amc_contracts rows still reference a project`);
  if (remainingLinks > 0) { run('DELETE FROM project_links'); console.log('Cleared', remainingLinks, 'project_links row(s)'); }

  const delProjects = run('DELETE FROM projects');
  console.log('Deleted', delProjects.changes, 'projects rows. Table, schema, indexes, and constraints preserved.');

  // ---------- 2. Restructure maintenance_contracts schema ----------
  if (columnExists('maintenance_contracts', 'contract_ref_status') && !columnExists('maintenance_contracts', 'current_status')) {
    run('ALTER TABLE maintenance_contracts RENAME COLUMN contract_ref_status TO current_status');
    console.log('Renamed maintenance_contracts.contract_ref_status -> current_status');
  }
  for (const col of ['project_site_name', 'service_frequency', 'monthly_service_status', 'linked_contract_status', 'lifts_qty']) {
    if (columnExists('maintenance_contracts', col)) {
      run(`ALTER TABLE maintenance_contracts DROP COLUMN ${col}`);
      console.log('Dropped maintenance_contracts.' + col);
    }
  }

  // ---------- 3. Manual Monthly Schedule junction table ----------
  run(`CREATE TABLE IF NOT EXISTS maintenance_schedule_months (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    maintenance_contract_id INTEGER NOT NULL REFERENCES maintenance_contracts(id),
    month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(maintenance_contract_id, month)
  )`);
  run('CREATE INDEX IF NOT EXISTS idx_sched_months_month ON maintenance_schedule_months(month)');
  console.log('Ensured maintenance_schedule_months');

  db.exec('COMMIT');
  console.log('=== COMMITTED ===');
} catch (e) {
  db.exec('ROLLBACK');
  console.error('ROLLED BACK:', e.message);
  process.exit(1);
}

console.log('=== AFTER ===');
console.log('projects:', get('SELECT COUNT(*) c FROM projects').c);
console.log('contracts (unaffected count):', get('SELECT COUNT(*) c FROM contracts WHERE is_deleted=0').c);
console.log('contracts.project_id still set:', get('SELECT COUNT(*) c FROM contracts WHERE project_id IS NOT NULL').c);
console.log('maintenance_contracts (unaffected count):', get('SELECT COUNT(*) c FROM maintenance_contracts WHERE is_deleted=0').c);
console.log('maintenance_visit_log (unaffected count):', get('SELECT COUNT(*) c FROM maintenance_visit_log').c);
console.log('maintenance_contracts columns:', all('PRAGMA table_info(maintenance_contracts)').map(c => c.name));
console.log('integrity_check:', get('PRAGMA integrity_check').integrity_check);
console.log('foreign_key_check violations:', all('PRAGMA foreign_key_check').length);
