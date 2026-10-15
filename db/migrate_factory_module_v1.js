// Additive schema extension for the Factory / Suppliers module.
// Adds the columns/tables needed to support the ED-SH-FACTORY-QUOTES import
// (Contract Ref linking, payment breakdown, change log, duplicate review)
// WITHOUT touching any other module or dropping/renaming existing columns.
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.argv[2];
if (!DB_PATH) { console.error('Usage: node migrate_factory_module_v1.js <path-to-sqlite>'); process.exit(1); }
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = MEMORY;'); // mount write-reliability fix (see project memory)
db.exec('PRAGMA foreign_keys = ON;');

function run(sql, params = []) { return db.prepare(sql).run(...params); }
function get(sql, params = []) { return db.prepare(sql).get(...params); }
function all(sql, params = []) { return db.prepare(sql).all(...params); }
function columnExists(table, col) { return all(`PRAGMA table_info(${table})`).some(c => c.name === col); }

console.log('=== BEFORE ===');
console.log('factory_orders columns:', all('PRAGMA table_info(factory_orders)').map(c => c.name));
console.log('factory_orders rows:', get('SELECT COUNT(*) c FROM factory_orders').c);

db.exec('BEGIN');
try {
  const newCols = [
    ['contract_ref', "TEXT"],
    ['linked_contract_status', "TEXT CHECK(linked_contract_status IN ('Linked','Pending Contract Ref','Contract Ref Not Found'))"],
    ['invoice_ref', "TEXT"],
    ['order_confirmation_ref', "TEXT"],
    ['sea_cost', "REAL"],
    ['other_job_cost', "REAL"],
    ['currency', "TEXT DEFAULT 'USD'"],
    ['payment_terms', "TEXT"],
    ['advance_payment', "REAL"],
    ['advance_payment_date', "TEXT"],
    ['balance_payment', "REAL"],
    ['balance_payment_date', "TEXT"],
    ['payment_status', "TEXT CHECK(payment_status IN ('Pending','Partial','Paid')) DEFAULT 'Pending'"],
    ['actual_delivery_date', "TEXT"],
    ['needs_review', "INTEGER NOT NULL DEFAULT 0"],
    ['needs_review_reason', "TEXT"],
  ];
  for (const [col, def] of newCols) {
    if (!columnExists('factory_orders', col)) {
      run(`ALTER TABLE factory_orders ADD COLUMN ${col} ${def}`);
      console.log('Added factory_orders.' + col);
    } else {
      console.log('factory_orders.' + col + ' already exists, skipping');
    }
  }

  run('CREATE INDEX IF NOT EXISTS idx_factory_contract_ref ON factory_orders(contract_ref)');
  run('CREATE INDEX IF NOT EXISTS idx_factory_linked_status ON factory_orders(linked_contract_status)');
  run('CREATE INDEX IF NOT EXISTS idx_factory_factory_ref ON factory_orders(factory_ref)');
  console.log('Ensured indexes on contract_ref, linked_contract_status, factory_ref');

  run(`CREATE TABLE IF NOT EXISTS factory_changelog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    factory_ref TEXT NOT NULL,
    contract_ref TEXT,
    source_sheet_name TEXT,
    field_updated TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    reason_for_update TEXT,
    updated_date TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  run('CREATE INDEX IF NOT EXISTS idx_factory_changelog_ref ON factory_changelog(factory_ref)');
  console.log('Ensured factory_changelog');

  run(`CREATE TABLE IF NOT EXISTS factory_duplicate_review (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    factory_ref TEXT NOT NULL,
    source_sheet_name TEXT,
    row_a_json TEXT NOT NULL,
    row_b_json TEXT NOT NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'Open',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  console.log('Ensured factory_duplicate_review');

  db.exec('COMMIT');
  console.log('=== COMMITTED ===');
} catch (e) {
  db.exec('ROLLBACK');
  console.error('ROLLED BACK:', e.message);
  process.exit(1);
}

console.log('=== AFTER ===');
console.log('factory_orders columns:', all('PRAGMA table_info(factory_orders)').map(c => c.name));
console.log('integrity_check:', get('PRAGMA integrity_check').integrity_check);
console.log('foreign_key_check violations:', all('PRAGMA foreign_key_check').length);
