// Role -> module/field permission matrix.
// Admin can always do everything. Every other role is restricted both to which
// modules it can see AND which specific fields it is allowed to write on a status update.
//
// 2026-06-27 (Module Changes step): 'maintenance' and 'amc' module keys removed from every role's
// modules array, and the corresponding maintenanceFields/amcFields keys deleted entirely (those
// modules/tables - maintenance_records, amc_contracts - were dropped). 'projects' module key renamed
// to 'quotations' in every role's modules array (full rename of Client Projects -> Quotations).
// projectFields (the field-allowlist key) and ENTITY_FIELD_KEY['project'] are intentionally left
// UNCHANGED - they map to the entity_type = 'project' literal still used internally in
// status_history/attachments/alerts, which has a CHECK constraint that was deliberately left as-is.
// Renaming this key without rebuilding that CHECK constraint would create a confusing mismatch, so
// the underlying field-permission key name stays projectFields even though the user-facing module is
// now called Quotations.
// maintenance_contracts (the separate "Maintenance Records" module) and its maintenanceContractFields/
// MAINTENANCE_CONTRACTS_MANAGERS were NOT touched - out of scope for this change.

const ROLES = {
  admin: {
    modules: ['dashboard', 'quotations', 'factory', 'links', 'alerts', 'reports', 'users', 'backup', 'contracts', 'maintenance_contracts', 'accounts'],
    projectFields: '*', factoryFields: '*', contractFields: '*', maintenanceContractFields: '*',
    canDelete: true, canCreate: true, canUpload: true,
  },
  sales: {
    modules: ['dashboard', 'quotations', 'reports', 'contracts'],
    projectFields: ['client_name','project_name','location','salesperson','attn_name','phone','mobile','email',
      'quotation_number','quotation_value','quotation_date','status','contract_value','payment_terms','remarks'],
    factoryFields: [], contractFields: [], maintenanceContractFields: [],
    canDelete: false, canCreate: true, canUpload: true,
  },
  accounts: {
    modules: ['dashboard', 'quotations', 'factory', 'reports', 'contracts', 'maintenance_contracts', 'accounts'],
    projectFields: ['project_name','payment_received','payment_terms','remarks'],
    factoryFields: ['supplier_payment_paid','remarks'],
    contractFields: ['contract_value','approval_date','delivery_status','mechanical_status','electrical_status','handover_date','remarks','cancellation_type','cancellation_date','payment_retention_status','refund_status','cancellation_remarks','elevator_units','delivery_date','mechanical_completion_date','electrical_completion_date'],
    maintenanceContractFields: [], // view-only: renewal/expiry status feeds AMC financial planning, but no payment fields exist on this module
    canDelete: false, canCreate: false, canUpload: true,
  },
  coordinator: {
    // 2026-07-28: 'links' removed — Project Management module retired from nav. Admin retains access.
    modules: ['dashboard', 'quotations', 'factory', 'alerts', 'reports', 'maintenance_contracts'],
    projectFields: ['project_name','delivery_status','installation_status','remarks'],
    factoryFields: ['order_confirmation_status','production_status','packing_list','bl_copy',
      'shipping_status','eta','delivery_status','remarks'],
    contractFields: [],
    maintenanceContractFields: ['contract_ref','client_name','emirate','maintenance_type','maintenance_period',
      'start_date','end_date','assigned_technician','remarks','renewal_status','last_service_date','next_service_date',
      'scheduling_method','next_service_from','total_elevator_units'],
    canDelete: false, canCreate: true, canUpload: true,
  },
  installation: {
    modules: ['dashboard', 'quotations', 'alerts', 'maintenance_contracts'],
    projectFields: ['project_name','installation_status','handover_status','remarks'],
    factoryFields: [],
    contractFields: [],
    maintenanceContractFields: [], // view-only on the master record; visit-log status updates use a dedicated endpoint, not field-filtered
    canDelete: false, canCreate: false, canUpload: true,
  },
  viewer: {
    modules: ['dashboard', 'quotations', 'factory', 'alerts', 'reports', 'contracts', 'maintenance_contracts'],
    projectFields: [], factoryFields: [], contractFields: [], maintenanceContractFields: [],
    canDelete: false, canCreate: false, canUpload: false,
  },
};

// Roles allowed to create/edit/delete contracts and manage salesperson targets.
// Kept separate from the generic canCreate/canDelete flags above so enabling it
// doesn't change behavior for any other existing module.
const CONTRACT_MANAGERS = ['admin', 'accounts'];

// Roles allowed to create/edit/delete Maintenance Records (the new Contract-Ref-keyed
// module) and update visit-log entries. Installation is included so the field team can
// mark visits complete via the visit-log endpoint, even though they can't edit the
// master record's fields (maintenanceContractFields is empty for that role above).
const MAINTENANCE_CONTRACTS_MANAGERS = ['admin', 'coordinator', 'installation'];
// AMC payment ledger (2026-09-29): who may RECORD a payment vs who may EDIT / VOID one.
const AMC_PAYMENT_ENTRY = ['admin', 'accounts', 'coordinator'];
const AMC_PAYMENT_ADMIN = ['admin', 'accounts'];

// Roles allowed to create/edit/delete new Maintenance Projects and visit records.
const MAINTENANCE_MANAGERS = ['admin', 'coordinator', 'installation'];

function canAccessModule(role, moduleName) {
  if (role === 'admin') return true;
  const r = ROLES[role];
  return !!r && r.modules.includes(moduleName);
}

const ENTITY_FIELD_KEY = {
  project: 'projectFields',
  factory_order: 'factoryFields',
  contract: 'contractFields',
  maintenance_contract: 'maintenanceContractFields',
};

function allowedFields(role, entityType) {
  const r = ROLES[role];
  if (!r) return [];
  const key = ENTITY_FIELD_KEY[entityType] || 'projectFields';
  return r[key];
}

function filterFieldsForRole(role, entityType, fields) {
  const allowed = allowedFields(role, entityType);
  if (allowed === '*') return fields;
  const out = {};
  for (const k of Object.keys(fields)) {
    if (allowed.includes(k)) out[k] = fields[k];
  }
  return out;
}

function can(role, action) {
  const r = ROLES[role];
  if (role === 'admin') return true;
  if (!r) return false;
  if (action === 'delete') return r.canDelete;
  if (action === 'create') return r.canCreate;
  if (action === 'upload') return r.canUpload;
  return false;
}

module.exports = { ROLES, canAccessModule, allowedFields, filterFieldsForRole, can, CONTRACT_MANAGERS, MAINTENANCE_CONTRACTS_MANAGERS, MAINTENANCE_MANAGERS, AMC_PAYMENT_ENTRY, AMC_PAYMENT_ADMIN };
