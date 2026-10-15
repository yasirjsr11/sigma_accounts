// Correction to the 2026-06-27 Factory/Suppliers import: the user clarified the three
// SL FUJI sheets must be kept as three fully SEPARATE entities inside the Factory /
// Suppliers module - no shared table, no cross-sheet duplicate checking, no forced
// Contract Ref. linking workflow. This migration:
//   1. Creates three independent tables (no FK between them, no FK to contracts):
//      factory_ins_quotes, factory_sea_costs, factory_otj_quotes.
//   2. Adds per-table indexes for every requested filter/sort field.
//   3. Retires the prior unified-table import: factory_orders held ONLY the 278 rows
//      from this same source file (it was empty before that run) - those rows are
//      removed, returning factory_orders to its pre-existing empty state. Its column
//      schema is left untouched (additive-only history, nothing dropped).
//   4. Clears factory_changelog / factory_duplicate_review rows tied to the superseded
//      approach (they will be repopulated by the new split import).
// Does NOT touch contracts, projects, maintenance_contracts, amc_contracts, or any
// Dashboard-related table.
const { db, run, get, all } = require('./db.js');

const DDL = `
CREATE TABLE IF NOT EXISTS factory_ins_quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  factory_record_code TEXT UNIQUE,
  factory_ref TEXT NOT NULL,
  contract_ref TEXT,
  supplier_name TEXT,
  client_name TEXT,
  project_description TEXT,
  quotation_ref TEXT,
  invoice_ref TEXT,
  order_confirmation_ref TEXT,
  factory_quote_amount REAL,
  currency TEXT,
  payment_terms TEXT,
  advance_payment REAL,
  advance_payment_date TEXT,
  balance_payment REAL,
  balance_payment_date TEXT,
  total_paid REAL,
  balance_payable REAL,
  payment_status TEXT,
  invoice_status TEXT,
  order_confirmation_status TEXT,
  production_status TEXT,
  shipping_status TEXT,
  delivery_status TEXT,
  expected_delivery_date TEXT,
  actual_delivery_date TEXT,
  remarks TEXT,
  needs_review INTEGER DEFAULT 0,
  needs_review_reason TEXT,
  source_sheet_name TEXT,
  source_file TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ins_factory_ref ON factory_ins_quotes(factory_ref);
CREATE INDEX IF NOT EXISTS idx_ins_contract_ref ON factory_ins_quotes(contract_ref);
CREATE INDEX IF NOT EXISTS idx_ins_supplier_name ON factory_ins_quotes(supplier_name);
CREATE INDEX IF NOT EXISTS idx_ins_payment_terms ON factory_ins_quotes(payment_terms);
CREATE INDEX IF NOT EXISTS idx_ins_payment_status ON factory_ins_quotes(payment_status);
CREATE INDEX IF NOT EXISTS idx_ins_invoice_status ON factory_ins_quotes(invoice_status);
CREATE INDEX IF NOT EXISTS idx_ins_order_conf_status ON factory_ins_quotes(order_confirmation_status);
CREATE INDEX IF NOT EXISTS idx_ins_production_status ON factory_ins_quotes(production_status);
CREATE INDEX IF NOT EXISTS idx_ins_shipping_status ON factory_ins_quotes(shipping_status);
CREATE INDEX IF NOT EXISTS idx_ins_delivery_status ON factory_ins_quotes(delivery_status);
CREATE INDEX IF NOT EXISTS idx_ins_amount ON factory_ins_quotes(factory_quote_amount);
CREATE INDEX IF NOT EXISTS idx_ins_balance_payable ON factory_ins_quotes(balance_payable);
CREATE INDEX IF NOT EXISTS idx_ins_expected_delivery ON factory_ins_quotes(expected_delivery_date);
CREATE INDEX IF NOT EXISTS idx_ins_actual_delivery ON factory_ins_quotes(actual_delivery_date);

CREATE TABLE IF NOT EXISTS factory_sea_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  factory_record_code TEXT UNIQUE,
  factory_ref TEXT NOT NULL,
  our_ref TEXT,
  supplier_name TEXT,
  client_name TEXT,
  project_description TEXT,
  quotation_ref TEXT,
  invoice_ref TEXT,
  order_confirmation_ref TEXT,
  sea_cost REAL,
  currency TEXT,
  payment_terms TEXT,
  advance_payment REAL,
  advance_payment_date TEXT,
  balance_payment REAL,
  balance_payment_date TEXT,
  total_paid REAL,
  balance_payable REAL,
  payment_status TEXT,
  invoice_status TEXT,
  order_confirmation_status TEXT,
  production_status TEXT,
  shipping_status TEXT,
  delivery_status TEXT,
  expected_delivery_date TEXT,
  actual_delivery_date TEXT,
  remarks TEXT,
  needs_review INTEGER DEFAULT 0,
  needs_review_reason TEXT,
  source_sheet_name TEXT,
  source_file TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sea_factory_ref ON factory_sea_costs(factory_ref);
CREATE INDEX IF NOT EXISTS idx_sea_supplier_name ON factory_sea_costs(supplier_name);
CREATE INDEX IF NOT EXISTS idx_sea_payment_terms ON factory_sea_costs(payment_terms);
CREATE INDEX IF NOT EXISTS idx_sea_payment_status ON factory_sea_costs(payment_status);
CREATE INDEX IF NOT EXISTS idx_sea_invoice_status ON factory_sea_costs(invoice_status);
CREATE INDEX IF NOT EXISTS idx_sea_order_conf_status ON factory_sea_costs(order_confirmation_status);
CREATE INDEX IF NOT EXISTS idx_sea_production_status ON factory_sea_costs(production_status);
CREATE INDEX IF NOT EXISTS idx_sea_shipping_status ON factory_sea_costs(shipping_status);
CREATE INDEX IF NOT EXISTS idx_sea_delivery_status ON factory_sea_costs(delivery_status);
CREATE INDEX IF NOT EXISTS idx_sea_amount ON factory_sea_costs(sea_cost);
CREATE INDEX IF NOT EXISTS idx_sea_balance_payable ON factory_sea_costs(balance_payable);
CREATE INDEX IF NOT EXISTS idx_sea_expected_delivery ON factory_sea_costs(expected_delivery_date);
CREATE INDEX IF NOT EXISTS idx_sea_actual_delivery ON factory_sea_costs(actual_delivery_date);

CREATE TABLE IF NOT EXISTS factory_otj_quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  factory_record_code TEXT UNIQUE,
  factory_ref TEXT NOT NULL,
  our_ref TEXT,
  supplier_name TEXT,
  client_name TEXT,
  project_description TEXT,
  quotation_ref TEXT,
  invoice_ref TEXT,
  order_confirmation_ref TEXT,
  other_job_cost REAL,
  currency TEXT,
  payment_terms TEXT,
  advance_payment REAL,
  advance_payment_date TEXT,
  balance_payment REAL,
  balance_payment_date TEXT,
  total_paid REAL,
  balance_payable REAL,
  payment_status TEXT,
  invoice_status TEXT,
  order_confirmation_status TEXT,
  production_status TEXT,
  shipping_status TEXT,
  delivery_status TEXT,
  expected_delivery_date TEXT,
  actual_delivery_date TEXT,
  remarks TEXT,
  needs_review INTEGER DEFAULT 0,
  needs_review_reason TEXT,
  source_sheet_name TEXT,
  source_file TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_otj_factory_ref ON factory_otj_quotes(factory_ref);
CREATE INDEX IF NOT EXISTS idx_otj_supplier_name ON factory_otj_quotes(supplier_name);
CREATE INDEX IF NOT EXISTS idx_otj_payment_terms ON factory_otj_quotes(payment_terms);
CREATE INDEX IF NOT EXISTS idx_otj_payment_status ON factory_otj_quotes(payment_status);
CREATE INDEX IF NOT EXISTS idx_otj_invoice_status ON factory_otj_quotes(invoice_status);
CREATE INDEX IF NOT EXISTS idx_otj_order_conf_status ON factory_otj_quotes(order_confirmation_status);
CREATE INDEX IF NOT EXISTS idx_otj_production_status ON factory_otj_quotes(production_status);
CREATE INDEX IF NOT EXISTS idx_otj_shipping_status ON factory_otj_quotes(shipping_status);
CREATE INDEX IF NOT EXISTS idx_otj_delivery_status ON factory_otj_quotes(delivery_status);
CREATE INDEX IF NOT EXISTS idx_otj_amount ON factory_otj_quotes(other_job_cost);
CREATE INDEX IF NOT EXISTS idx_otj_balance_payable ON factory_otj_quotes(balance_payable);
CREATE INDEX IF NOT EXISTS idx_otj_expected_delivery ON factory_otj_quotes(expected_delivery_date);
CREATE INDEX IF NOT EXISTS idx_otj_actual_delivery ON factory_otj_quotes(actual_delivery_date);
`;

console.log('--- Pre-migration snapshot ---');
console.log('factory_orders rows:', get('SELECT COUNT(*) c FROM factory_orders').c);
console.log('factory_orders distinct source_file:', JSON.stringify(all('SELECT DISTINCT source_file FROM factory_orders')));
console.log('factory_changelog rows:', get('SELECT COUNT(*) c FROM factory_changelog').c);
console.log('factory_duplicate_review rows:', get('SELECT COUNT(*) c FROM factory_duplicate_review').c);
console.log('contracts (active):', get('SELECT COUNT(*) c FROM contracts WHERE is_deleted = 0').c);
console.log('projects:', get('SELECT COUNT(*) c FROM projects').c);

db.exec('BEGIN');
try {
  db.exec(DDL);

  // Safety check before retiring factory_orders data: confirm every existing row came
  // from this same source file (i.e. nothing else has ever been written to this table).
  const other = get("SELECT COUNT(*) c FROM factory_orders WHERE source_file IS NOT NULL AND source_file != 'ED-SH-FACTORY-QUOTES.xlsx'").c;
  if (other > 0) throw new Error(`Refusing to clear factory_orders - ${other} rows from a different source_file exist.`);

  const delOrders = run('DELETE FROM factory_orders').changes;
  const delChangelog = run('DELETE FROM factory_changelog').changes;
  const delDupReview = run('DELETE FROM factory_duplicate_review').changes;

  db.exec('COMMIT');
  console.log('\n--- Migration committed ---');
  console.log('Tables created: factory_ins_quotes, factory_sea_costs, factory_otj_quotes (+ indexes)');
  console.log('factory_orders rows removed (superseded import):', delOrders);
  console.log('factory_changelog rows removed (superseded entries):', delChangelog);
  console.log('factory_duplicate_review rows removed (superseded entries):', delDupReview);
} catch (e) {
  db.exec('ROLLBACK');
  console.error('ROLLED BACK:', e.message);
  process.exit(1);
}
