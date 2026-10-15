// Migration for the Phase 3 update (2026-06-28):
//  - adds Reviews-module columns to factory_ins_quotes (reviewed_status/reviewed_date/reviewed_by/review_note)
//  - adds the new factory_new_projects table (manual-entry "New Projects" section in Factory/Suppliers)
// Safe to re-run (checks pragma table_info / sqlite_master before adding).
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'sh_pms.sqlite'));
db.exec('PRAGMA journal_mode = MEMORY;'); // FUSE mount workaround - see memory: fuse-mount-write-quirks Bug 1

function run(sql) { return db.prepare(sql).run(); }
function all(sql) { return db.prepare(sql).all(); }

const insCols = all("PRAGMA table_info(factory_ins_quotes)").map(c => c.name);
const reviewCols = [
  ['reviewed_status', `TEXT CHECK(reviewed_status IN ('Reviewed','Pending Review') OR reviewed_status IS NULL)`],
  ['reviewed_date', 'TEXT'],
  ['reviewed_by', 'TEXT'],
  ['review_note', 'TEXT'],
];
for (const [col, def] of reviewCols) {
  if (!insCols.includes(col)) {
    run(`ALTER TABLE factory_ins_quotes ADD COLUMN ${col} ${def}`);
    console.log(`Added ${col} to factory_ins_quotes`);
  } else {
    console.log(`${col} already present on factory_ins_quotes`);
  }
}

const tableExists = all(`SELECT name FROM sqlite_master WHERE type='table' AND name='factory_new_projects'`).length > 0;
if (!tableExists) {
  run(`CREATE TABLE factory_new_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    factory_ref TEXT,
    contract_ref TEXT,
    client_name TEXT,
    emirate TEXT,
    project_description TEXT,
    value REAL,
    currency TEXT DEFAULT 'USD',
    status TEXT,
    remarks TEXT,
    last_updated_date TEXT,
    is_deleted INTEGER DEFAULT 0,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  console.log('Created factory_new_projects table');
} else {
  console.log('factory_new_projects table already exists');
}

console.log('Final factory_ins_quotes columns:', all("PRAGMA table_info(factory_ins_quotes)").map(c => c.name));
console.log('factory_new_projects columns:', all("PRAGMA table_info(factory_new_projects)").map(c => c.name));
db.close();
