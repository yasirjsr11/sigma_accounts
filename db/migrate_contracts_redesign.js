// One-time migration: redesign the Contracts module's field set.
// Adds emirate, delivery_status, mechanical_status, electrical_status, handover_date
// to `contracts`; drops the now-unused total_received / balance_receivable columns
// and the contract_payments table (payment-ledger feature removed per product decision).
// Safe to re-run - every step checks current state first.
//
// NOTE: deliberately does NOT require('./db.js') - that module re-applies schema.sql
// on load, and schema.sql already assumes the NEW column set (e.g. the
// idx_contracts_handover_date index), which doesn't exist yet on a live DB that still
// has the old structure. So this script opens the database file directly first,
// runs the raw ALTER statements, and only then is it safe for schema.sql to be re-run.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const DB_PATH = path.join(__dirname, 'sh_pms.sqlite');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = OFF;');

function columns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
}

function tableExists(table) {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(table);
}

function run() {
  const cols = columns('contracts');
  const adds = [
    ['emirate', 'TEXT'],
    ['delivery_status', 'TEXT'],
    ['mechanical_status', 'TEXT'],
    ['electrical_status', 'TEXT'],
    ['handover_date', 'TEXT'],
  ];
  for (const [name, type] of adds) {
    if (!cols.includes(name)) {
      console.log(`Adding column contracts.${name} ...`);
      db.exec(`ALTER TABLE contracts ADD COLUMN ${name} ${type}`);
    } else {
      console.log(`Column contracts.${name} already present, skipping.`);
    }
  }

  const colsAfterAdd = columns('contracts');
  for (const name of ['total_received', 'balance_receivable']) {
    if (colsAfterAdd.includes(name)) {
      console.log(`Dropping column contracts.${name} ...`);
      db.exec(`ALTER TABLE contracts DROP COLUMN ${name}`);
    } else {
      console.log(`Column contracts.${name} already absent, skipping.`);
    }
  }

  if (tableExists('contract_payments')) {
    console.log('Dropping table contract_payments ...');
    db.exec('DROP TABLE contract_payments');
  } else {
    console.log('Table contract_payments already absent, skipping.');
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_contracts_handover_date ON contracts(handover_date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_contracts_emirate ON contracts(emirate)`);

  console.log('Migration complete. Current contracts columns:', columns('contracts'));
}

run();
