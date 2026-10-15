CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','sales','accounts','coordinator','installation','viewer')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS "quotations" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_code TEXT UNIQUE NOT NULL,
  quote_ref TEXT,
  client_name TEXT,
  project_name TEXT,
  location TEXT,
  salesperson TEXT,
  attn_name TEXT,
  phone TEXT,
  mobile TEXT,
  email TEXT,
  quotation_number TEXT,
  quotation_value REAL,
  quotation_date TEXT,
  status TEXT NOT NULL DEFAULT 'Enquiry' CHECK(status IN ('Enquiry','Quoted','Negotiation','Confirmed','On Hold','Lost')),
  contract_value REAL,
  payment_terms TEXT,
  payment_received REAL DEFAULT 0,
  balance_amount REAL,
  delivery_status TEXT DEFAULT 'Pending' CHECK(delivery_status IN ('Pending','In Transit','Delivered','Delayed')),
  installation_status TEXT DEFAULT 'Not Started' CHECK(installation_status IN ('Not Started','In Progress','Completed','On Hold')),
  handover_status TEXT DEFAULT 'Pending' CHECK(handover_status IN ('Pending','Handed Over')),
  remarks TEXT,
  legacy_status_text TEXT,
  source_sheet TEXT,
  source_file TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_quote_ref ON "quotations"(quote_ref);

CREATE INDEX IF NOT EXISTS idx_projects_status ON "quotations"(status);

CREATE INDEX IF NOT EXISTS idx_projects_salesperson ON "quotations"(salesperson);

CREATE TABLE IF NOT EXISTS factory_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  factory_order_code TEXT UNIQUE NOT NULL,
  factory_quotation_number TEXT,
  supplier_name TEXT,
  our_ref TEXT,
  factory_ref TEXT,
  client_name TEXT,
  project_description TEXT,
  order_confirmation_status TEXT DEFAULT 'Pending' CHECK(order_confirmation_status IN ('Pending','Confirmed','Cancelled')),
  production_status TEXT DEFAULT 'Not Started' CHECK(production_status IN ('Not Started','In Production','Ready','Delayed')),
  factory_invoice_value REAL,
  supplier_payment_paid REAL DEFAULT 0,
  supplier_balance REAL,
  packing_list TEXT,
  bl_copy TEXT,
  shipping_status TEXT DEFAULT 'Not Shipped' CHECK(shipping_status IN ('Not Shipped','Shipped','In Transit','Arrived','Delayed')),
  eta TEXT,
  delivery_status TEXT DEFAULT 'Pending' CHECK(delivery_status IN ('Pending','Delivered','Delayed')),
  remarks TEXT,
  legacy_remarks TEXT,
  source_sheet TEXT,
  source_file TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, contract_ref TEXT, linked_contract_status TEXT CHECK(linked_contract_status IN ('Linked','Pending Contract Ref','Contract Ref Not Found')), invoice_ref TEXT, order_confirmation_ref TEXT, sea_cost REAL, other_job_cost REAL, currency TEXT DEFAULT 'USD', payment_terms TEXT, advance_payment REAL, advance_payment_date TEXT, balance_payment REAL, balance_payment_date TEXT, payment_status TEXT CHECK(payment_status IN ('Pending','Partial','Paid')) DEFAULT 'Pending', actual_delivery_date TEXT, needs_review INTEGER NOT NULL DEFAULT 0, needs_review_reason TEXT);

CREATE INDEX IF NOT EXISTS idx_factory_our_ref ON factory_orders(our_ref);

CREATE INDEX IF NOT EXISTS idx_factory_supplier ON factory_orders(supplier_name);

CREATE TABLE IF NOT EXISTS project_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES "quotations"(id),
  factory_order_id INTEGER NOT NULL REFERENCES factory_orders(id),
  link_type TEXT NOT NULL DEFAULT 'manual' CHECK(link_type IN ('auto','manual')),
  linked_by TEXT,
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, factory_order_id)
);

CREATE TABLE IF NOT EXISTS import_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name TEXT NOT NULL,
  sheet_name TEXT,
  rows_processed INTEGER DEFAULT 0,
  rows_inserted INTEGER DEFAULT 0,
  rows_updated INTEGER DEFAULT 0,
  rows_skipped INTEGER DEFAULT 0,
  run_by TEXT,
  run_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS backup_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  backup_type TEXT NOT NULL CHECK(backup_type IN ('manual','daily','weekly')),
  file_path TEXT NOT NULL,
  size_bytes INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS "status_history" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('project','factory_order','maintenance_record','amc_contract')),
      entity_id INTEGER NOT NULL,
      field_name TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      changed_by TEXT NOT NULL,
      changed_at TEXT NOT NULL DEFAULT (datetime('now')),
      remarks TEXT
    );

CREATE INDEX IF NOT EXISTS idx_history_entity ON status_history(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS "attachments" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('project','factory_order','maintenance_record','amc_contract')),
      entity_id INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      uploaded_by TEXT,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

CREATE TABLE IF NOT EXISTS "alerts" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('project','factory_order','maintenance_record','amc_contract')),
      entity_id INTEGER NOT NULL,
      alert_type TEXT NOT NULL,
      message TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium' CHECK(severity IN ('low','medium','high')),
      is_resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );

CREATE INDEX IF NOT EXISTS idx_alerts_resolved ON alerts(is_resolved);

CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_ref TEXT UNIQUE NOT NULL,
  quote_ref TEXT,
  project_id INTEGER REFERENCES "quotations"(id),
  client_name TEXT,
  approval_date TEXT,
  sales_by TEXT,
  contract_value REAL,
  remarks TEXT,
  source_sheet TEXT,
  source_file TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, emirate TEXT, delivery_status TEXT, mechanical_status TEXT, electrical_status TEXT, handover_date TEXT, project_description TEXT);

CREATE INDEX IF NOT EXISTS idx_contracts_quote_ref ON contracts(quote_ref);

CREATE INDEX IF NOT EXISTS idx_contracts_sales_by ON contracts(sales_by);

CREATE INDEX IF NOT EXISTS idx_contracts_approval_date ON contracts(approval_date);

CREATE INDEX IF NOT EXISTS idx_contracts_project ON contracts(project_id);

CREATE TABLE IF NOT EXISTS contract_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL REFERENCES contracts(id),
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  remarks TEXT
);

CREATE INDEX IF NOT EXISTS idx_contract_history_contract ON contract_history(contract_id);

CREATE TABLE IF NOT EXISTS sales_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  salesperson TEXT NOT NULL,
  year INTEGER NOT NULL,
  target_units INTEGER NOT NULL,
  remarks TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(salesperson, year)
);

CREATE INDEX IF NOT EXISTS idx_sales_targets_year ON sales_targets(year);

CREATE INDEX IF NOT EXISTS idx_contracts_handover_date ON contracts(handover_date);

CREATE INDEX IF NOT EXISTS idx_contracts_emirate ON contracts(emirate);

CREATE TABLE IF NOT EXISTS contract_changelog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  old_contract_ref TEXT,
  new_contract_ref TEXT NOT NULL,
  client_name TEXT,
  reason TEXT NOT NULL,
  changed_by TEXT,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contract_duplicate_review (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_ref TEXT,
  client_name TEXT,
  duplicate_of_ref TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Needs Review' CHECK(status IN ('Needs Review','Resolved - Kept Both','Resolved - Removed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS maintenance_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  maintenance_id TEXT UNIQUE NOT NULL,
  contract_ref TEXT,
  current_status TEXT NOT NULL DEFAULT 'Linked' CHECK(current_status IN ('Linked','Pending Contract Ref','Contract Ref Not Found')),
  client_name TEXT,
  emirate TEXT,
  maintenance_type TEXT DEFAULT 'AMC',
  maintenance_period INTEGER,
  start_date TEXT,
  end_date TEXT,
  last_service_date TEXT,
  next_service_date TEXT,
  assigned_technician TEXT,
  remarks TEXT,
  renewal_status TEXT NOT NULL DEFAULT 'Active Maintenance' CHECK(renewal_status IN ('Active Maintenance','Hold','Expired / Renewal Required','Cancelled')),
  source_sheet TEXT,
  source_file TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_maint_contracts_ref ON maintenance_contracts(contract_ref);

CREATE INDEX IF NOT EXISTS idx_maint_contracts_end_date ON maintenance_contracts(end_date);

CREATE INDEX IF NOT EXISTS idx_maint_contracts_renewal ON maintenance_contracts(renewal_status);

CREATE TABLE IF NOT EXISTS maintenance_visit_log (
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
);

CREATE INDEX IF NOT EXISTS idx_visit_log_month ON maintenance_visit_log(month);

CREATE INDEX IF NOT EXISTS idx_visit_log_ref ON maintenance_visit_log(contract_ref);

CREATE TABLE IF NOT EXISTS maintenance_contract_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  maintenance_contract_id INTEGER NOT NULL REFERENCES maintenance_contracts(id),
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  remarks TEXT
);

CREATE TABLE IF NOT EXISTS maintenance_schedule_months (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    maintenance_contract_id INTEGER NOT NULL REFERENCES maintenance_contracts(id),
    month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(maintenance_contract_id, month)
  );

CREATE INDEX IF NOT EXISTS idx_sched_months_month ON maintenance_schedule_months(month);

CREATE INDEX IF NOT EXISTS idx_factory_contract_ref ON factory_orders(contract_ref);

CREATE INDEX IF NOT EXISTS idx_factory_linked_status ON factory_orders(linked_contract_status);

CREATE INDEX IF NOT EXISTS idx_factory_factory_ref ON factory_orders(factory_ref);

CREATE TABLE IF NOT EXISTS factory_changelog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    factory_ref TEXT NOT NULL,
    contract_ref TEXT,
    source_sheet_name TEXT,
    field_updated TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    reason_for_update TEXT,
    updated_date TEXT NOT NULL DEFAULT (datetime('now'))
  );

CREATE INDEX IF NOT EXISTS idx_factory_changelog_ref ON factory_changelog(factory_ref);

CREATE TABLE IF NOT EXISTS factory_duplicate_review (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    factory_ref TEXT NOT NULL,
    source_sheet_name TEXT,
    row_a_json TEXT NOT NULL,
    row_b_json TEXT NOT NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'Open',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

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
, linked_contract_status TEXT CHECK(linked_contract_status IN ('Linked','Pending Contract Ref.','Contract Ref. Not Found')), factory_delivery_status TEXT);

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
, contract_ref TEXT, linked_contract_status TEXT CHECK(linked_contract_status IN ('Linked','Pending Contract Ref.','Contract Ref. Not Found')), factory_delivery_status TEXT);

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
, contract_ref TEXT, linked_contract_status TEXT CHECK(linked_contract_status IN ('Linked','Pending Contract Ref.','Contract Ref. Not Found')), factory_delivery_status TEXT);

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

CREATE INDEX IF NOT EXISTS idx_sea_contract_ref ON factory_sea_costs(contract_ref);

CREATE INDEX IF NOT EXISTS idx_sea_linked_contract_status ON factory_sea_costs(linked_contract_status);

CREATE INDEX IF NOT EXISTS idx_sea_factory_delivery_status ON factory_sea_costs(factory_delivery_status);

CREATE INDEX IF NOT EXISTS idx_otj_contract_ref ON factory_otj_quotes(contract_ref);

CREATE INDEX IF NOT EXISTS idx_otj_linked_contract_status ON factory_otj_quotes(linked_contract_status);

CREATE INDEX IF NOT EXISTS idx_otj_factory_delivery_status ON factory_otj_quotes(factory_delivery_status);


-- factory_new_projects: manual-entry New Projects, shared across all Factory/Suppliers sections.
-- Added 2026-06-28 (Phase 3 task #115). Section column added 2026-07-01 to support per-section
-- sub-tabs under SEA COSTS, OTJ QUOTES and INS QUOTES.
CREATE TABLE IF NOT EXISTS factory_new_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  factory_ref TEXT,
  contract_ref TEXT,
  linked_contract_status TEXT CHECK(linked_contract_status IN ('Linked','Pending Contract Ref.','Contract Ref. Not Found')) DEFAULT 'Pending Contract Ref.',
  section TEXT DEFAULT 'ins-quotes',
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
);

CREATE INDEX IF NOT EXISTS idx_fnp_section ON factory_new_projects(section);
CREATE INDEX IF NOT EXISTS idx_fnp_contract_ref ON factory_new_projects(contract_ref);
CREATE INDEX IF NOT EXISTS idx_fnp_is_deleted ON factory_new_projects(is_deleted);

-- 2026-07-04: audit_log — records admin delete/restore actions across all modules.
-- 2026-07-06: added record_id column for direct DB id reference.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  module TEXT NOT NULL,
  record_id INTEGER,
  record_ref TEXT,
  details TEXT,
  performed_by TEXT NOT NULL,
  performed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2026-07-02: Added is_deleted (soft-delete) to the three main factory sheet tables.
-- These columns are added via ALTER TABLE on existing installs; the schema entries below
-- use IF NOT EXISTS logic for CREATE TABLE but ALTER TABLE cannot be conditional — on a
-- fresh install from this schema.sql the columns will be part of the CREATE TABLE.
-- No schema change for factory_new_projects (already has is_deleted since creation).
