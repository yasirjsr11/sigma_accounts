// Migration: add linked_contract_status + factory_delivery_status to factory_ins_quotes,
// matching the convention already applied to factory_sea_costs / factory_otj_quotes.
// Run once. Safe to re-run (checks pragma table_info before adding).
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'sh_pms.sqlite'));
db.exec('PRAGMA journal_mode = MEMORY;'); // FUSE mount workaround - see memory: fuse-mount-write-quirks Bug 1

function run(sql, params = []) { return db.prepare(sql).run(...params); }
function all(sql, params = []) { return db.prepare(sql).all(...params); }

const cols = all("PRAGMA table_info(factory_ins_quotes)").map(c => c.name);

if (!cols.includes('linked_contract_status')) {
  run(`ALTER TABLE factory_ins_quotes ADD COLUMN linked_contract_status TEXT CHECK(linked_contract_status IN ('Linked','Pending Contract Ref.','Contract Ref. Not Found'))`);
  console.log('Added linked_contract_status to factory_ins_quotes');
} else {
  console.log('linked_contract_status already present');
}

if (!cols.includes('factory_delivery_status')) {
  run(`ALTER TABLE factory_ins_quotes ADD COLUMN factory_delivery_status TEXT CHECK(factory_delivery_status IN ('Order Confirmation','Production','Shipping','In Transit','Arrived','Delayed','Delivered'))`);
  console.log('Added factory_delivery_status to factory_ins_quotes');
} else {
  console.log('factory_delivery_status already present');
}

console.log('Final columns:', all("PRAGMA table_info(factory_ins_quotes)").map(c => c.name));
db.close();
