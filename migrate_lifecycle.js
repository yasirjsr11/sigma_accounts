'use strict';
const { run, get, all } = require('./db/db.js');

console.log('=== Creating project_lifecycle table ===');
run(`CREATE TABLE IF NOT EXISTS project_lifecycle (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_ref TEXT,
  quote_ref TEXT,
  maintenance_ref TEXT,
  client_name TEXT,
  project_name TEXT,
  salesperson TEXT,
  current_stage TEXT NOT NULL DEFAULT 'Contract Created',
  contract_linked_by TEXT,
  contract_linked_at TEXT,
  contract_link_remarks TEXT,
  quote_linked_by TEXT,
  quote_linked_at TEXT,
  maintenance_linked_by TEXT,
  maintenance_linked_at TEXT,
  status TEXT NOT NULL DEFAULT 'Active',
  remarks TEXT,
  linked_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_lifecycle_contract_ref
     ON project_lifecycle(contract_ref) WHERE contract_ref IS NOT NULL`);
run(`CREATE INDEX IF NOT EXISTS idx_lifecycle_quote_ref ON project_lifecycle(quote_ref)`);
run(`CREATE INDEX IF NOT EXISTS idx_lifecycle_stage ON project_lifecycle(current_stage)`);
run(`CREATE INDEX IF NOT EXISTS idx_lifecycle_status ON project_lifecycle(status)`);

console.log('=== Creating lifecycle_factory_links table ===');
run(`CREATE TABLE IF NOT EXISTS lifecycle_factory_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lifecycle_id INTEGER NOT NULL REFERENCES project_lifecycle(id) ON DELETE CASCADE,
  quote_ref TEXT,
  contract_ref TEXT,
  factory_ref TEXT NOT NULL,
  factory_table TEXT NOT NULL CHECK(factory_table IN ('sea_costs','otj_quotes','ins_quotes')),
  supplier_name TEXT,
  linked_by TEXT,
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  remarks TEXT
)`);
run(`CREATE INDEX IF NOT EXISTS idx_lfl_lifecycle_id ON lifecycle_factory_links(lifecycle_id)`);
run(`CREATE INDEX IF NOT EXISTS idx_lfl_factory_ref ON lifecycle_factory_links(factory_ref)`);

console.log('=== Creating quotation_revisions table ===');
run(`CREATE TABLE IF NOT EXISTS quotation_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_ref TEXT NOT NULL,
  revision_no INTEGER NOT NULL DEFAULT 0,
  revision_date TEXT,
  revised_by TEXT,
  revision_reason TEXT,
  quoted_value REAL,
  status TEXT DEFAULT 'Active' CHECK(status IN ('Active','Superseded','Approved','Rejected')),
  client_approval_status TEXT DEFAULT 'Pending' CHECK(client_approval_status IN ('Pending','Approved','Rejected')),
  is_current INTEGER DEFAULT 0,
  remarks TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(quote_ref, revision_no)
)`);
run(`CREATE INDEX IF NOT EXISTS idx_qrev_quote_ref ON quotation_revisions(quote_ref)`);

console.log('=== Auto-populating project_lifecycle from existing contracts ===');
const contracts = all(`
  SELECT c.*, mc.maintenance_id
  FROM contracts c
  LEFT JOIN maintenance_contracts mc ON mc.contract_ref = c.contract_ref AND mc.is_deleted = 0
  WHERE c.is_deleted = 0
  ORDER BY c.created_at`);

let inserted = 0, skipped = 0;
for (const c of contracts) {
  const existing = get('SELECT id FROM project_lifecycle WHERE contract_ref = ?', [c.contract_ref]);
  if (existing) { skipped++; continue; }

  // Infer stage
  let stage = 'Contract Created';
  if (c.maintenance_id) {
    if (c.handover_date) stage = 'Free Maintenance';
    else stage = 'Contract Created';
  }
  if (c.handover_date && !c.maintenance_id) stage = 'Handover';

  run(`INSERT INTO project_lifecycle
    (contract_ref, quote_ref, maintenance_ref, client_name, salesperson, current_stage, linked_by,
     contract_linked_by, contract_linked_at)
    VALUES (?,?,?,?,?,?,'system','system',?)`,
    [c.contract_ref, c.quote_ref || null, c.maintenance_id || null,
     c.client_name, c.sales_by || null, stage, c.created_at]);
  inserted++;
}

// Also create lifecycle records for quotations that don't have a matching contract
const quotationsWithoutLifecycle = all(`
  SELECT q.project_code, q.client_name, q.project_name, q.salesperson, q.status
  FROM quotations q
  WHERE q.is_deleted = 0
    AND NOT EXISTS (
      SELECT 1 FROM project_lifecycle pl WHERE pl.quote_ref = q.project_code
    )
  LIMIT 500`);

let quotInserted = 0;
for (const q of quotationsWithoutLifecycle) {
  let stage = 'Quotation';
  if (q.status === 'Approved') stage = 'Approved';
  else if (q.status === 'Revised') stage = 'Revised';

  run(`INSERT INTO project_lifecycle
    (quote_ref, client_name, project_name, salesperson, current_stage, linked_by)
    VALUES (?,?,?,?,?,'system')`,
    [q.project_code, q.client_name, q.project_name, q.salesperson, stage]);
  quotInserted++;
}

const total = get('SELECT COUNT(*) c FROM project_lifecycle').c;
console.log(`Contracts inserted: ${inserted}, skipped: ${skipped}`);
console.log(`Quotations without contract inserted: ${quotInserted}`);
console.log(`Total project_lifecycle rows: ${total}`);
console.log('Migration complete.');
