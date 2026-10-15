// Factory / Suppliers module — routes.
//
// Three active sheet-based views, each backed by its own table:
//   SL FUJI - SEA COSTS  → factory_sea_costs  (40 imported rows + manual adds)
//   SL FUJI - OTJ COSTS  → factory_otj_quotes (38 imported rows + manual adds)
//   SL FUJI - INS QUOTES → factory_ins_quotes  (200 imported rows + manual adds)
//
// Each sheet has:
//   GET    /:sheet-name           list (filtered, sorted, is_deleted=0)
//   POST   /:sheet-name           create a new record manually
//   GET    /:sheet/:id            single record detail
//   PATCH  /:sheet/:id            edit a record
//   DELETE /:sheet/:id            soft-delete (is_deleted=1)
//
// Also:
//   GET  /counters                module-internal KPIs (not on Main Dashboard)
//   GET  /status-options          delivery status option list (per sheet)
//   GET  /contract-lookup         read-only Contract Ref. preview
//
// Legacy factory_orders CRUD routes kept unchanged for routes/links.js compatibility.
// factory_new_projects routes kept but UI sub-tabs are removed per 2026-07-02 redesign.
//
// IMPORTANT: single-segment named routes must be registered BEFORE /:id to avoid collision.

const express = require('express');
const { db, run, get, all } = require('../db/db.js');
const { requireModule, requireRole } = require('../middleware/auth.js');
const { filterFieldsForRole, can } = require('../middleware/permissions.js');
const { writeAuditLog } = require('../db/audit.js');
const SUP = require('../db/suppliers.js');   // 2026-10-03: Supplier Master (supplier_id identity)
const FL = require('../db/factoryLinks.js');
const router = express.Router();
// Resolve body.supplier_id / supplier_name against the Supplier Master (400 on unknown / inactive)
function applySupplier(b, existing) {
  const s = SUP.resolveForWrite(b, existing);
  if (s) { b.supplier_id = s.id; b.supplier_name = s.name; }
  return s;
}

const TRACKED_FIELDS = ['order_confirmation_status', 'production_status', 'supplier_payment_paid',
  'shipping_status', 'delivery_status', 'eta'];

// --- Status option lists ---
const FACTORY_DELIVERY_STATUS_OPTS = ['Order Confirmation', 'Production', 'Shipping', 'In Transit', 'Arrived', 'Delayed', 'Delivered'];
const INS_DELIVERY_STATUS_OPTS     = ['Production', 'Under Production', 'Ready', 'Hold', 'Shipping', 'On Shipping', 'Delivered', 'Cancel'];
const SEA_DELIVERY_STATUS_OPTS     = ['Production', 'Shipping', 'Arrived', 'Delayed', 'Delivered'];
const PRODUCTION_STATUS_OPTS       = ['Not Started', 'In Progress', 'Under Production', 'Completed', 'On Hold', 'Ready', 'Hold', 'Ready for Shipping'];
const SHIPPING_STATUS_OPTS         = ['Not Shipped', 'Ready for Shipping', 'Shipped', 'Shipping', 'On Shipping', 'In Transit', 'Delivered', 'Delayed'];
const SHIPPING_MODE_OPTS           = ['Sea', 'Air', 'Courier', 'Local'];
const DELIVERY_STATUS_OPTS         = ['Pending', 'On Track', 'Delayed', 'Delivered'];
const SEA_PAYMENT_STATUS_OPTS      = ['Partial', 'Full Paid', 'Unpaid'];
const OTHER_PAYMENT_STATUS_OPTS    = ['Paid', 'Partial', 'Pending', 'Unpaid'];
// 2026-09-30 Shipping Details (sea-costs) — simplified logistics vocabularies.
// New values only; legacy values already stored are preserved and may stay unchanged,
// but any NEW value written must be one of these.
const SEA_SHIPPING_STATUS_OPTS     = ['Shipped', 'Delivered', 'Delayed'];
const SEA_DELIVERY_STATUS_NEW_OPTS = ['On Track', 'Delayed', 'Delivered'];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Validates shipping-detail fields for a sea-costs create/update. Returns
// { error } or { warnings: [] }. `existing` = current row (PATCH) so an unchanged
// legacy status can be re-sent without being rejected.
function validateSeaShipping(u, existing) {
  const warnings = [];
  for (const [f, label] of [['etd', 'ETD'], ['bl_no', 'ETA']]) {
    if (f in u) {
      if (u[f] === '' || u[f] == null) u[f] = null;
      else if (!ISO_DATE_RE.test(String(u[f])) || isNaN(Date.parse(u[f] + 'T00:00:00Z')))
        return { error: `${label} must be a valid date (YYYY-MM-DD)` };
    }
  }
  const chk = (f, opts, label) => {
    if (!(f in u)) return null;
    if (u[f] === '' || u[f] == null) { u[f] = null; return null; }
    if (opts.includes(u[f])) return null;
    if (existing && existing[f] === u[f]) return null;          // unchanged legacy value — preserved
    return `${label} must be one of: ${opts.join(', ')}`;
  };
  const e1 = chk('shipping_status', SEA_SHIPPING_STATUS_OPTS, 'Shipping Status'); if (e1) return { error: e1 };
  const e2 = chk('delivery_status', SEA_DELIVERY_STATUS_NEW_OPTS, 'Delivery Status'); if (e2) return { error: e2 };
  for (const f of ['sea_cost', 'clearance_cost', 'total_paid']) {
    if (f in u && u[f] !== null && u[f] !== '' && !Number.isFinite(Number(u[f]))) return { error: `${f} must be a number` };
    if (f in u && (u[f] === '' )) u[f] = null;
  }
  const etd = 'etd' in u ? u.etd : existing && existing.etd;
  const eta = 'bl_no' in u ? u.bl_no : existing && existing.bl_no;
  if (etd && eta && ISO_DATE_RE.test(etd) && ISO_DATE_RE.test(eta) && eta < etd)
    warnings.push('ETA is earlier than ETD. Please verify the shipment dates.');
  return { warnings };
}
const NEW_PROJECT_STATUS_OPTS      = ['Planned', 'Quoted', 'Confirmed', 'In Production', 'On Hold', 'Cancelled'];

// --- Sheet config ---
function sheetConfig(sheet) {
  if (sheet === 'sea-costs')  return { table: 'factory_sea_costs',  amountCol: 'sea_cost',            title: 'Shipping Costs' };
  if (sheet === 'otj-quotes') return { table: 'factory_otj_quotes', amountCol: 'other_job_cost',       title: 'OTJ Orders' };
  if (sheet === 'ins-quotes') return { table: 'factory_ins_quotes', amountCol: 'factory_quote_amount', title: 'New Orders' };
  return null;
}

// --- Sort whitelists (prevent SQL injection, expose all visible/sortable columns) ---
const SORT_COLUMNS = {
  'sea-costs': {
    factory_ref: 'factory_ref', supplier_name: 'supplier_name', client_name: 'client_name',
    bl_no: 'bl_no', etd: 'etd', amount: 'sea_cost', clearance_cost: 'clearance_cost',
    payment_status: 'payment_status', shipping_status: 'shipping_status',
    delivery_status: 'delivery_status',
    expected_delivery_date: 'expected_delivery_date', actual_delivery_date: 'actual_delivery_date',
    updated_at: 'updated_at',
  },
  'otj-quotes': {
    factory_ref: 'factory_ref', supplier_name: 'supplier_name', client_name: 'client_name',
    amount: 'other_job_cost',
    payment_status: 'payment_status', production_status: 'production_status',
    shipping_status: 'shipping_status', delivery_status: 'delivery_status',
    factory_delivery_status: 'factory_delivery_status',
    expected_delivery_date: 'expected_delivery_date', actual_delivery_date: 'actual_delivery_date',
    updated_at: 'updated_at',
  },
  'ins-quotes': {
    factory_ref: 'f.factory_ref', contract_ref: 'f.contract_ref', supplier_name: 'f.supplier_name',
    amount: 'f.factory_quote_amount',
    order_date: 'f.order_date',
    payment_status: 'f.payment_status', production_status: 'f.production_status',
    shipping_status: 'f.shipping_status', delivery_status: 'f.delivery_status',
    factory_delivery_status: 'f.factory_delivery_status',
    expected_delivery_date: 'f.expected_delivery_date', actual_delivery_date: 'f.actual_delivery_date',
    updated_at: 'f.updated_at',
  },
};
function buildOrderBy(sheet, sortBy, sortDir) {
  const cols = SORT_COLUMNS[sheet] || {};
  const col  = cols[sortBy] || cols.updated_at || 'updated_at';
  const dir  = String(sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return `ORDER BY ${col} ${dir}`;
}

// --- Editable fields per PATCH (expanded from Phase 3) ---
const SHEET_EDITABLE = {
  'sea-costs':  ['factory_ref','our_ref','supplier_name','supplier_id','client_name','project_description','bl_no','etd',
                  'sea_cost','clearance_cost','currency','advance_payment','advance_payment_date',
                  'balance_payment','balance_payment_date','total_paid',
                  'payment_status','shipping_status','delivery_status',
                  'expected_delivery_date','actual_delivery_date','remarks'],
  'otj-quotes': ['factory_ref','our_ref','supplier_name','supplier_id','client_name','project_description','contract_ref',
                  'other_job_cost','currency','advance_payment','advance_payment_date',
                  'balance_payment','balance_payment_date','total_paid',
                  'payment_status','production_status','shipping_status','delivery_status',
                  'factory_delivery_status','expected_delivery_date','actual_delivery_date','remarks'],
  'ins-quotes': ['factory_ref','contract_ref','our_ref','common_client_name','supplier_name','supplier_id','order_confirmation_ref',
                  'factory_quote_amount','currency','advance_payment','advance_payment_date',
                  'balance_payment','balance_payment_date','total_paid',
                  'payment_status','production_status','shipping_status','shipping_mode','delivery_status',
                  'factory_delivery_status','expected_delivery_date','actual_delivery_date',
                  'quantity','remarks',
                  'factory_commercial_mode','factory_combined_invoice_ref'],
  // order_date is NOT editable directly — auto-synced from advance_payment_date
};
const INS_QUOTES_REVIEW_FIELDS = ['reviewed_status', 'review_note'];

function paymentOptsFor(sheet) { return sheet === 'sea-costs' ? SEA_PAYMENT_STATUS_OPTS : OTHER_PAYMENT_STATUS_OPTS; }
function deliveryOptsFor(sheet) {
  if (sheet === 'sea-costs')  return SEA_DELIVERY_STATUS_OPTS;
  if (sheet === 'ins-quotes') return INS_DELIVERY_STATUS_OPTS;
  return FACTORY_DELIVERY_STATUS_OPTS;
}

function computeContractLinkStatus(contractRef) {
  if (!contractRef) return 'Pending Contract Ref.';
  const c = get(`SELECT id FROM contracts WHERE contract_ref = ? AND is_deleted = 0`, [contractRef]);
  return c ? 'Linked' : 'Contract Ref. Not Found';
}

// Helper: recompute balance_payable after amount/clearance_cost/total_paid change
function recomputeBalance(table, amountCol, id, inclClearance = false) {
  const r = get(`SELECT ${amountCol} amt, ${inclClearance ? 'clearance_cost cc,' : ''} total_paid tp FROM ${table} WHERE id = ?`, [id]);
  if (r) {
    const bal = inclClearance ? ((r.amt||0) + (r.cc||0) - (r.tp||0)) : ((r.amt||0) - (r.tp||0));
    run(`UPDATE ${table} SET balance_payable = ? WHERE id = ?`, [bal, id]);
  }
}

// ========================
// SEA COSTS
// ========================
router.get('/sea-costs', requireModule('factory'), (req, res) => {
  const { search, payment_status, shipping_status, sort_by, sort_dir } = req.query;
  const where = ['is_deleted = 0'];
  const params = [];
  if (search) {
    where.push('(factory_ref LIKE ? OR supplier_name LIKE ? OR client_name LIKE ? OR project_description LIKE ? OR bl_no LIKE ?)');
    params.push(`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`);
  }
  if (payment_status)  { where.push('payment_status = ?');  params.push(payment_status); }
  if (shipping_status) { where.push('shipping_status = ?'); params.push(shipping_status); }
  if (req.query.delivery_status) { where.push('delivery_status = ?'); params.push(req.query.delivery_status); }
  if (req.query.supplier_id) { where.push('supplier_id = ?'); params.push(Number(req.query.supplier_id)); }
  const whereSql = 'WHERE ' + where.join(' AND ');
  const rows = all(`SELECT id, factory_ref, our_ref, supplier_name, supplier_id, client_name, project_description, bl_no,
                            bl_no AS eta, etd,
                            sea_cost AS amount, clearance_cost,
                            payment_status, total_paid, balance_payable,
                            shipping_status, delivery_status,
                            expected_delivery_date, actual_delivery_date, remarks, updated_at
                     FROM factory_sea_costs ${whereSql} ${buildOrderBy('sea-costs', sort_by, sort_dir)}`, params);
  const totals = get(`SELECT COALESCE(SUM(sea_cost),0) AS total_amount, COALESCE(SUM(clearance_cost),0) AS total_clearance,
                              COALESCE(SUM(total_paid),0) AS total_paid, COALESCE(SUM(balance_payable),0) AS total_balance
                       FROM factory_sea_costs ${whereSql}`, params);
  res.json({ title: 'SL Fuji - SEA COSTS', rows, totals, total: rows.length });
});

router.post('/sea-costs', requireModule('factory'), (req, res) => {
  try {
    const b = { ...(req.body || {}) };
    try { applySupplier(b, null); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
    const v = validateSeaShipping(b, null);
    if (v.error) return res.status(400).json({ error: v.error });
    const now = new Date().toISOString();
    const seaCost = parseFloat(b.sea_cost) || 0;
    const clearanceCost = parseFloat(b.clearance_cost) || 0;
    const totalPaid = parseFloat(b.total_paid) || 0;
    run(`INSERT INTO factory_sea_costs
      (factory_ref, our_ref, supplier_name, client_name, project_description, bl_no,
       sea_cost, clearance_cost, currency, advance_payment, advance_payment_date, balance_payment, balance_payment_date,
       total_paid, balance_payable, payment_status, shipping_status, delivery_status,
       expected_delivery_date, remarks, created_by, created_at, updated_at, etd)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [b.factory_ref||null, b.our_ref||null, b.supplier_name||null, b.client_name||null, b.project_description||null,
       b.bl_no||null,
       seaCost, clearanceCost, b.currency||'USD',
       parseFloat(b.advance_payment)||0, b.advance_payment_date||null,
       parseFloat(b.balance_payment)||0, b.balance_payment_date||null,
       totalPaid, seaCost + clearanceCost - totalPaid,
       b.payment_status||'Unpaid', b.shipping_status||null, b.delivery_status||null,
       b.expected_delivery_date||null, b.remarks||null,
       req.session.user.username, now, now, b.etd||null]);
    res.status(201).json({ row: get(`SELECT * FROM factory_sea_costs WHERE id = last_insert_rowid()`), warnings: v.warnings });
  } catch (err) {
    console.error('[POST /api/factory/sea-costs]', err.message);
    res.status(500).json({ error: err.message || 'Failed to save record. Please try again.' });
  }
});

router.delete('/sea-costs/:id', requireModule('factory'), requireRole('admin'), (req, res) => {
  const row = get(`SELECT * FROM factory_sea_costs WHERE id=? AND is_deleted=0`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Record not found' });
  run(`UPDATE factory_sea_costs SET is_deleted=1, updated_at=? WHERE id=?`, [new Date().toISOString(), req.params.id]);
  writeAuditLog({
    action: 'DELETE', module: 'factory_sea_costs',
    recordId: row.id, recordRef: row.factory_ref || String(row.id),
    details: { supplier_name: row.supplier_name, contract_ref: row.contract_ref },
    performedBy: req.session.user.username,
  });
  res.json({ ok: true });
});

// ========================
// OTJ COSTS (table: factory_otj_quotes)
// ========================
router.get('/otj-quotes', requireModule('factory'), (req, res) => {
  const { search, payment_status, factory_delivery_status, production_status, shipping_status, sort_by, sort_dir } = req.query;
  const where = ['is_deleted = 0'];
  const params = [];
  if (search) {
    where.push('(factory_ref LIKE ? OR supplier_name LIKE ? OR client_name LIKE ? OR project_description LIKE ? OR contract_ref LIKE ?)');
    params.push(`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`);
  }
  if (payment_status)         { where.push('payment_status = ?');         params.push(payment_status); }
  if (factory_delivery_status){ where.push('factory_delivery_status = ?');params.push(factory_delivery_status); }
  if (production_status)      { where.push('production_status = ?');       params.push(production_status); }
  if (shipping_status)        { where.push('shipping_status = ?');         params.push(shipping_status); }
  if (req.query.supplier_id)  { where.push('supplier_id = ?');            params.push(Number(req.query.supplier_id)); }
  const whereSql = 'WHERE ' + where.join(' AND ');
  const rows = all(`SELECT id, factory_ref, our_ref, supplier_name, supplier_id, client_name, project_description, contract_ref,
                            linked_contract_status, other_job_cost AS amount,
                            payment_status, total_paid, balance_payable,
                            production_status, shipping_status, delivery_status, factory_delivery_status,
                            expected_delivery_date, actual_delivery_date, remarks, updated_at
                     FROM factory_otj_quotes ${whereSql} ${buildOrderBy('otj-quotes', sort_by, sort_dir)}`, params);
  const totals = get(`SELECT COALESCE(SUM(other_job_cost),0) AS total_amount,
                              COALESCE(SUM(total_paid),0) AS total_paid,
                              COALESCE(SUM(balance_payable),0) AS total_balance
                       FROM factory_otj_quotes ${whereSql}`, params);
  res.json({ title: 'SL Fuji - OTJ COSTS', rows, totals, total: rows.length });
});

router.post('/otj-quotes', requireModule('factory'), (req, res) => {
  try {
    const b = req.body || {};
    try { applySupplier(b, null); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
    const now = new Date().toISOString();
    const amount = parseFloat(b.other_job_cost) || 0;
    const totalPaid = parseFloat(b.total_paid) || 0;
    const linkedStatus = computeContractLinkStatus(b.contract_ref || null);
    run(`INSERT INTO factory_otj_quotes
      (factory_ref, our_ref, supplier_name, client_name, project_description, contract_ref, linked_contract_status,
       other_job_cost, currency, advance_payment, advance_payment_date, balance_payment, balance_payment_date,
       total_paid, balance_payable, payment_status, production_status, shipping_status, delivery_status,
       factory_delivery_status, expected_delivery_date, remarks, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [b.factory_ref||null, b.our_ref||null, b.supplier_name||null, b.client_name||null, b.project_description||null,
       b.contract_ref||null, linkedStatus,
       amount, b.currency||'USD',
       parseFloat(b.advance_payment)||0, b.advance_payment_date||null,
       parseFloat(b.balance_payment)||0, b.balance_payment_date||null,
       totalPaid, amount - totalPaid,
       b.payment_status||'Unpaid', b.production_status||null, b.shipping_status||null, b.delivery_status||null,
       b.factory_delivery_status||null, b.expected_delivery_date||null, b.remarks||null,
       req.session.user.username, now, now]);
    res.status(201).json({ row: get(`SELECT * FROM factory_otj_quotes WHERE id = last_insert_rowid()`) });
  } catch (err) {
    console.error('[POST /api/factory/otj-quotes]', err.message);
    res.status(500).json({ error: err.message || 'Failed to save record. Please try again.' });
  }
});

router.delete('/otj-quotes/:id', requireModule('factory'), requireRole('admin'), (req, res) => {
  const row = get(`SELECT * FROM factory_otj_quotes WHERE id=? AND is_deleted=0`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Record not found' });
  run(`UPDATE factory_otj_quotes SET is_deleted=1, updated_at=? WHERE id=?`, [new Date().toISOString(), req.params.id]);
  writeAuditLog({
    action: 'DELETE', module: 'factory_otj_quotes',
    recordId: row.id, recordRef: row.factory_ref || String(row.id),
    details: { supplier_name: row.supplier_name, contract_ref: row.contract_ref },
    performedBy: req.session.user.username,
  });
  res.json({ ok: true });
});

// ========================
// INS QUOTES
// ========================
router.get('/ins-quotes', requireModule('factory'), (req, res) => {
  const { search, payment_status, factory_delivery_status, production_status, needs_review, sort_by, sort_dir } = req.query;
  const where = ['f.is_deleted = 0'];
  const params = [];
  if (search) {
    where.push(`(f.factory_ref LIKE ? OR f.contract_ref LIKE ? OR f.supplier_name LIKE ? OR f.client_name LIKE ? OR f.project_description LIKE ? OR f.common_client_name LIKE ? OR f.our_ref LIKE ? OR c.client_name LIKE ?
      OR EXISTS (SELECT 1 FROM factory_contract_links _sl WHERE _sl.is_deleted = 0 AND _sl.factory_table = 'factory_ins_quotes' AND UPPER(TRIM(_sl.factory_ref)) = UPPER(TRIM(f.factory_ref)) AND _sl.contract_ref LIKE ?))`);
    params.push(`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`);
  }
  if (payment_status)         { where.push('f.payment_status = ?');         params.push(payment_status); }
  if (factory_delivery_status){ where.push('f.factory_delivery_status = ?');params.push(factory_delivery_status); }
  if (production_status)      { where.push('f.production_status = ?');       params.push(production_status); }
  if (needs_review === '1')   { where.push('f.needs_review = 1'); }
  if (req.query.supplier_id)  { where.push('f.supplier_id = ?'); params.push(Number(req.query.supplier_id)); }
  const whereSql = 'WHERE ' + where.join(' AND ');
  const rows = all(`
    SELECT f.id, f.factory_ref, f.contract_ref, f.our_ref, f.common_client_name, f.linked_contract_status,
           ${FL.LINKED_CONTRACTS_SQL('factory_ins_quotes', 'f')} AS linked_contract_refs,
           ${FL.LINKED_CONTRACT_COUNT_SQL('factory_ins_quotes', 'f')} AS linked_contract_count,
           CASE WHEN ${FL.LINKED_CONTRACT_COUNT_SQL('factory_ins_quotes', 'f')} > 0 OR f.linked_contract_status = 'Linked' THEN 'Linked' ELSE 'Unmatched Contract Ref.' END AS contract_lookup_status,
           c.client_name AS contract_client_name, c.emirate AS contract_emirate,
           c.project_description AS contract_project_description,
           f.supplier_name, f.order_confirmation_ref, f.factory_quote_amount AS amount,
           f.quantity, f.order_date, f.shipping_mode,
           f.payment_status, f.total_paid, f.balance_payable,
           f.production_status, f.shipping_status, f.delivery_status, f.factory_delivery_status,
           f.expected_delivery_date, f.actual_delivery_date,
           f.remarks, f.needs_review, f.needs_review_reason,
           f.reviewed_status, f.reviewed_date, f.reviewed_by, f.review_note, f.updated_at,
           m.current_status AS maintenance_status, m.next_service_date AS maintenance_next_service_date,
           m.assigned_technician AS maintenance_technician
    FROM factory_ins_quotes f
    LEFT JOIN contracts c ON c.contract_ref = f.contract_ref AND c.is_deleted = 0
    LEFT JOIN maintenance_contracts m ON m.contract_ref = f.contract_ref AND m.is_deleted = 0
    ${whereSql}
    ${buildOrderBy('ins-quotes', sort_by, sort_dir)}`, params);
  const totals = get(`SELECT COALESCE(SUM(f.factory_quote_amount),0) AS total_amount,
                              COALESCE(SUM(f.total_paid),0) AS total_paid,
                              COALESCE(SUM(f.balance_payable),0) AS total_balance
                       FROM factory_ins_quotes f
                       LEFT JOIN contracts c ON c.contract_ref = f.contract_ref AND c.is_deleted = 0
                       ${whereSql}`, params);
  res.json({ title: 'New Orders', rows, totals, total: rows.length });
});

// POST /api/factory/ins-quotes — create a new SL Fuji factory order.
// Supports multi-contract mode: body.contract_links = [{contract_ref, linked_quantity, factory_value, factory_currency, factory_invoice_ref}]
// All validation + inserts (factory master + contract link rows) run in one transaction.
// Legacy single contract_ref string also supported for backward compat.
router.post('/ins-quotes', requireModule('factory'), (req, res) => {
  try {
    const b = req.body || {};
    try { applySupplier(b, null); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
    const now = new Date().toISOString();
    const username = req.session.user.username;

    // ── Duplicate factory_ref guard ─────────────────────────────────────────
    if (b.factory_ref) {
      const dup = get('SELECT id FROM factory_ins_quotes WHERE factory_ref=? AND is_deleted=0', [b.factory_ref]);
      if (dup) {
        return res.status(409).json({
          error: `Factory Ref. ${b.factory_ref} already exists. Link the contracts to the existing Factory Order instead.`,
          duplicate: true,
          existingId: dup.id,
        });
      }
    }

    // ── Multi-contract links (new UI) ────────────────────────────────────────
    // contract_links arrives as JSON array from the new Add New form
    let contractLinks = null;
    if (b.contract_links) {
      try {
        contractLinks = typeof b.contract_links === 'string'
          ? JSON.parse(b.contract_links)
          : b.contract_links;
        if (!Array.isArray(contractLinks) || contractLinks.length === 0) contractLinks = null;
      } catch(_) { contractLinks = null; }
    }

    // ── Validate each contract individually ─────────────────────────────────
    let contractRefStr = b.contract_ref || null;
    let linkedStatus = computeContractLinkStatus(contractRefStr);
    let ourRef = b.our_ref || null;

    if (contractLinks) {
      const invalidRefs = [];
      for (const lk of contractLinks) {
        if (!lk.contract_ref) continue;
        const c = get('SELECT id FROM contracts WHERE contract_ref=? AND is_deleted=0', [lk.contract_ref]);
        if (!c) invalidRefs.push(lk.contract_ref);
      }
      if (invalidRefs.length > 0) {
        return res.status(400).json({
          error: `Contract(s) not found: ${invalidRefs.join(', ')}. Each contract must exist before being linked.`,
          invalidRefs,
        });
      }
      // Build backward-compat contract_ref display string and our_ref
      const crefList = contractLinks.map(lk => lk.contract_ref);
      contractRefStr = crefList.join(', ');
      linkedStatus = 'Linked';
      if (!ourRef) ourRef = crefList.join(' / ');
    }

    // ── Quantity: auto-sum from allocated units, or use manual entry ─────────
    let qty;
    const _rawQty = (b.quantity !== undefined && b.quantity !== '' && b.quantity !== null) ? b.quantity : null;
    if (contractLinks && (_rawQty === null || _rawQty === '')) {
      // Auto-calculate from sum of linked units
      qty = contractLinks.reduce((s, lk) => s + (parseInt(lk.linked_quantity) || 0), 0) || null;
    } else {
      qty = _rawQty !== null ? parseInt(_rawQty) : null;
    }
    const needsRev = (qty === null || isNaN(qty)) ? 1 : 0;
    const needsRevReason = needsRev ? 'Quantity not set – requires manual entry' : null;

    const amount    = parseFloat(b.factory_quote_amount) || 0;
    const totalPaid = parseFloat(b.total_paid) || 0;

    // ── Common Client / Group Name ───────────────────────────────────────────
    // If frontend sent a value, use it. Otherwise derive from linked contracts.
    let commonClientName = (b.common_client_name || '').trim() || null;
    if (!commonClientName && contractLinks && contractLinks.length > 0) {
      // Look up each contract's client_name and normalize (trim + lower for comparison)
      const clientNames = [];
      for (const lk of contractLinks) {
        if (!lk.contract_ref) continue;
        const cRow = get('SELECT client_name FROM contracts WHERE contract_ref=? AND is_deleted=0', [lk.contract_ref]);
        if (cRow && cRow.client_name) clientNames.push(cRow.client_name.trim());
      }
      if (clientNames.length > 0) {
        const unique = [...new Set(clientNames.map(n => n.toLowerCase()))];
        commonClientName = unique.length === 1 ? clientNames[0] : 'Multiple Clients';
      }
    } else if (!commonClientName && contractRefStr && !contractLinks) {
      // Legacy single-contract: derive from the one contract
      const cRow = get('SELECT client_name FROM contracts WHERE contract_ref=? AND is_deleted=0', [contractRefStr]);
      if (cRow && cRow.client_name) commonClientName = cRow.client_name.trim();
    }

    // ── Transaction: factory master + all contract link rows ─────────────────
    db.exec('BEGIN');
    try {
      run(`INSERT INTO factory_ins_quotes
        (factory_ref, contract_ref, our_ref, common_client_name, linked_contract_status, supplier_name, order_confirmation_ref,
         factory_quote_amount, currency, advance_payment, advance_payment_date, balance_payment, balance_payment_date,
         total_paid, balance_payable, payment_status, production_status, shipping_status, shipping_mode, delivery_status,
         factory_delivery_status, expected_delivery_date, quantity, order_date, needs_review, needs_review_reason,
         remarks, created_by, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [b.factory_ref||null, contractRefStr, ourRef, commonClientName, linkedStatus,
         b.supplier_name||null, b.order_confirmation_ref||null,
         amount, b.currency||'USD',
         parseFloat(b.advance_payment)||0, b.advance_payment_date||null,
         parseFloat(b.balance_payment)||0, b.balance_payment_date||null,
         totalPaid, amount - totalPaid,
         b.payment_status||'Unpaid', b.production_status||null, b.shipping_status||null,
         b.shipping_mode||null, b.delivery_status||null,
         b.factory_delivery_status||null, b.expected_delivery_date||null,
         qty, b.advance_payment_date||null, needsRev, needsRevReason,
         b.remarks||null, username, now, now]);

      const newRecord = get('SELECT * FROM factory_ins_quotes WHERE id = last_insert_rowid()');

      // ── Insert factory_contract_links rows ───────────────────────────────
      if (contractLinks) {
        for (const lk of contractLinks) {
          if (!lk.contract_ref) continue;
          // Duplicate link guard (should not occur from UI but protect DB integrity)
          const dupLink = get(
            'SELECT id FROM factory_contract_links WHERE factory_ref=? AND factory_table=? AND contract_ref=? AND is_deleted=0',
            [b.factory_ref, 'factory_ins_quotes', lk.contract_ref]);
          if (dupLink) {   // already linked (e.g. order re-created) → point the link at this live record
            run('UPDATE factory_contract_links SET factory_record_id=?, updated_at=? WHERE id=?', [newRecord.id, now, dupLink.id]);
            continue;
          }
          run(`INSERT INTO factory_contract_links
            (factory_ref, factory_table, factory_record_id, contract_ref, linked_quantity,
             factory_invoice_ref, factory_value, factory_currency, linked_by, linked_date, status, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [b.factory_ref, 'factory_ins_quotes', newRecord.id, lk.contract_ref,
             parseInt(lk.linked_quantity) || null,
             lk.factory_invoice_ref || null,
             parseFloat(lk.factory_value) || null,
             lk.factory_currency || 'USD',
             username, now.slice(0, 10), 'Active', now, now]);
          writeAuditLog({
            action: 'LINK_CREATE', module: 'factory_contract_links',
            recordId: newRecord.id, recordRef: b.factory_ref || String(newRecord.id),
            details: {
              contract_ref: lk.contract_ref,
              linked_quantity: lk.linked_quantity,
              factory_value: lk.factory_value,
              factory_invoice_ref: lk.factory_invoice_ref,
            },
            performedBy: username,
          });
        }
      } else if (contractRefStr) {
        // Legacy single-contract: also insert into factory_contract_links if not already there
        const _singleContract = get('SELECT id FROM contracts WHERE contract_ref=? AND is_deleted=0', [contractRefStr]);
        if (_singleContract) {
          const _singleDup = get(
            'SELECT id FROM factory_contract_links WHERE factory_ref=? AND factory_table=? AND contract_ref=? AND is_deleted=0',
            [b.factory_ref, 'factory_ins_quotes', contractRefStr]);
          if (_singleDup) run('UPDATE factory_contract_links SET factory_record_id=?, updated_at=? WHERE id=?', [newRecord.id, now, _singleDup.id]);
          if (!_singleDup) {
            run(`INSERT INTO factory_contract_links
              (factory_ref, factory_table, factory_record_id, contract_ref, linked_by, linked_date, status, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?)`,
              [b.factory_ref, 'factory_ins_quotes', newRecord.id, contractRefStr, username, now.slice(0, 10), 'Active', now, now]);
          }
        }
      }

      db.exec('COMMIT');
      res.status(201).json({ row: newRecord, linksCreated: contractLinks ? contractLinks.length : 0 });
    } catch (txErr) {
      try { db.exec('ROLLBACK'); } catch(_) {}
      throw txErr;
    }
  } catch (err) {
    console.error('[POST /api/factory/ins-quotes]', err.message);
    res.status(500).json({ error: err.message || 'Failed to save record. Please try again.' });
  }
});

router.delete('/ins-quotes/:id', requireModule('factory'), requireRole('admin'), (req, res) => {
  const row = get(`SELECT * FROM factory_ins_quotes WHERE id=? AND is_deleted=0`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Record not found' });
  run(`UPDATE factory_ins_quotes SET is_deleted=1, updated_at=? WHERE id=?`, [new Date().toISOString(), req.params.id]);
  writeAuditLog({
    action: 'DELETE', module: 'factory_ins_quotes',
    recordId: row.id, recordRef: row.factory_ref || String(row.id),
    details: { supplier_name: row.supplier_name, contract_ref: row.contract_ref },
    performedBy: req.session.user.username,
  });
  res.json({ ok: true });
});

// ========================
// Counters + status options + contract lookup
// ========================
router.get('/counters', requireModule('factory'), (req, res) => {
  const seaTotal = get('SELECT COALESCE(SUM(sea_cost),0) AS v FROM factory_sea_costs WHERE is_deleted=0').v;
  const otjTotal = get('SELECT COALESCE(SUM(other_job_cost),0) AS v FROM factory_otj_quotes WHERE is_deleted=0').v;
  const insTotal = get('SELECT COALESCE(SUM(factory_quote_amount),0) AS v FROM factory_ins_quotes WHERE is_deleted=0').v;

  // Unit-based KPIs from SL Fuji - New Orders (factory_ins_quotes) — quantity field only
  // Cancelled orders ('Cancel') are excluded from all unit KPIs
  const insQty = (sql, params=[]) => (get(`SELECT COALESCE(SUM(CASE WHEN quantity > 0 THEN quantity ELSE 0 END),0) AS q FROM factory_ins_quotes WHERE is_deleted=0 AND COALESCE(factory_delivery_status,'') != 'Cancel' AND ${sql}`, params)||{}).q || 0;

  // Status priority to avoid double-counting: Delivered > Sea Shipping > Ready/Hold > Under Production
  const DELIVERED_SQL   = "factory_delivery_status = 'Delivered'";
  const SEA_SQL         = "factory_delivery_status IN ('Shipping','On Shipping','In Transit') OR (shipping_mode = 'Sea' AND shipping_status IN ('Shipping','On Shipping','In Transit'))";
  // Status stored in factory_delivery_status — INS_DELIVERY_STATUS_OPTS
  const READY_HOLD_SQL  = "factory_delivery_status IN ('Ready', 'Hold')";
  const UNDER_PROD_SQL  = "factory_delivery_status IN ('Production', 'Under Production')";

  // Total ordered — all valid records (quantity > 0)
  const total_ordered_units     = insQty('1=1');
  // 2026 orders by order_date year
  const total_ordered_units_2026 = insQty("strftime('%Y', order_date) = '2026'");
  // Status breakdown using priority (each record counted in highest applicable stage only)
  const units_delivered         = insQty(DELIVERED_SQL);
  const units_sea_shipping      = insQty(`(${SEA_SQL}) AND NOT (${DELIVERED_SQL})`);
  const units_ready_hold        = insQty(`(${READY_HOLD_SQL}) AND NOT (${DELIVERED_SQL}) AND NOT (${SEA_SQL})`);
  const units_under_production  = insQty(`(${UNDER_PROD_SQL}) AND NOT (${DELIVERED_SQL}) AND NOT (${SEA_SQL}) AND NOT (${READY_HOLD_SQL})`);

  const ins_quotes_needs_review = (get("SELECT COUNT(*) c FROM factory_ins_quotes WHERE is_deleted=0 AND needs_review=1 AND COALESCE(factory_delivery_status,'') != 'Cancel'")||{}).c || 0;

  res.json({
    // Financial totals (preserved, not removed)
    total_sea_costs:           seaTotal,
    // Shipment counts by the standardised Shipping Status (one status per shipment → no double counting)
    sea_shipping_status: Object.fromEntries(all(`SELECT COALESCE(shipping_status,'Not set') s, COUNT(*) n FROM factory_sea_costs
                                                 WHERE is_deleted=0 GROUP BY 1`).map(r => [r.s, r.n])),
    total_otj_quotes:          otjTotal,
    total_ins_quotes:          insTotal,
    // Unit-based KPI cards
    total_ordered_units,
    total_ordered_units_2026,
    units_under_production,
    units_ready_hold,
    units_sea_shipping,
    units_delivered,
    ins_quotes_needs_review,
  });
});

router.get('/status-options', requireModule('factory'), (req, res) => {
  const sheet = req.query.sheet;
  res.json({
    delivery_opts:        deliveryOptsFor(sheet),
    payment_opts:         paymentOptsFor(sheet),
    production_opts:      PRODUCTION_STATUS_OPTS,
    shipping_opts:        sheet === 'sea-costs' ? SEA_SHIPPING_STATUS_OPTS : SHIPPING_STATUS_OPTS,
    shipping_mode_opts:   SHIPPING_MODE_OPTS,
    delivery_status_opts: sheet === 'sea-costs' ? SEA_DELIVERY_STATUS_NEW_OPTS : DELIVERY_STATUS_OPTS,
  });
});

router.get('/contract-lookup', requireModule('factory'), (req, res) => {
  const ref = req.query.contract_ref;
  if (!ref) return res.json({ found: false, contract: null });
  const contract = get(`SELECT contract_ref, client_name, emirate, project_description FROM contracts WHERE contract_ref=? AND is_deleted=0`, [ref]);
  res.json({ found: !!contract, contract: contract||null });
});

// ========================
// /:sheet/:id  — single record GET + PATCH
// ========================
router.get('/:sheet/:id', requireModule('factory'), (req, res) => {
  const cfg = sheetConfig(req.params.sheet);
  if (!cfg) return res.status(404).json({ error: 'Unknown sheet' });
  let row = get(`SELECT * FROM ${cfg.table} WHERE id=? AND is_deleted=0`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (req.params.sheet === 'ins-quotes') {
    const c = get(`SELECT client_name, emirate, project_description FROM contracts WHERE contract_ref=? AND is_deleted=0`, [row.contract_ref]);
    row = {
      ...row,
      contract_lookup_status:       row.linked_contract_status === 'Linked' ? 'Linked' : 'Unmatched Contract Ref.',
      contract_client_name:         c ? c.client_name : null,
      contract_emirate:             c ? c.emirate      : null,
      contract_project_description: c ? c.project_description : null,
    };
  }
  // Shipping Details: Total Paid is authoritative from the Accounts factory-payment
  // ledger when payments exist (read-only summary; ledger rows are never modified here).
  let ledger;
  if (req.params.sheet === 'sea-costs' && row.factory_ref) {
    ledger = get(`SELECT COUNT(*) AS count, COALESCE(SUM(paid_amount),0) AS total FROM factory_payments
                  WHERE factory_table='sea_costs' AND factory_ref=? AND is_deleted=0`, [row.factory_ref]);
    row = { ...row, eta: row.bl_no };
  }
  res.json({ row, ledger });
});

router.patch('/:sheet/:id', requireModule('factory'), (req, res) => {
  try {
    const cfg = sheetConfig(req.params.sheet);
    if (!cfg) return res.status(404).json({ error: 'Unknown sheet' });
    const existing = get(`SELECT * FROM ${cfg.table} WHERE id=? AND is_deleted=0`, [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const body = req.body || {};
    const editableFields = SHEET_EDITABLE[req.params.sheet] || [];
    const updates = {};
    for (const f of editableFields) { if (f in body) updates[f] = body[f]; }
    // Supplier: identity from the Supplier Master (an unchanged inactive historical supplier is allowed)
    if ('supplier_id' in body || 'supplier_name' in body) {
      const sb = { supplier_id: body.supplier_id, supplier_name: 'supplier_id' in body ? undefined : body.supplier_name };
      try {
        const sres = SUP.resolveForWrite(sb, existing);
        if (sres) { updates.supplier_id = sres.id; updates.supplier_name = sres.name; }
        else { delete updates.supplier_id; delete updates.supplier_name; }
      } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
      if (Number(existing.supplier_id) === Number(updates.supplier_id)) { delete updates.supplier_id; delete updates.supplier_name; }
    }

    if (req.params.sheet === 'ins-quotes') {
      for (const f of INS_QUOTES_REVIEW_FIELDS) { if (f in body) updates[f] = body[f]; }
      // Auto-sync order_date from advance_payment_date (order_date is never manually set for ins-quotes)
      if ('advance_payment_date' in updates) {
        updates.order_date = updates.advance_payment_date || null;
      }
      // Auto-recalculate needs_review when quantity is patched (qty=0 = cancelled/transferred order, NOT invalid)
      if ('quantity' in updates) {
        const _rQty = (updates.quantity !== undefined && updates.quantity !== '' && updates.quantity !== null) ? updates.quantity : null;
        const qty = _rQty !== null ? parseInt(_rQty) : null;
        updates.needs_review = (qty === null || isNaN(qty)) ? 1 : 0;
        updates.needs_review_reason = updates.needs_review ? 'Quantity not set – requires manual entry' : null;
      }
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No editable fields supplied' });

    // Shipping Details (sea-costs): ETD/ETA date-only, standardised Shipping / Delivery
    // Status, numeric costs. Statuses never create or clear any date.
    let warnings = [];
    if (req.params.sheet === 'sea-costs') {
      const v = validateSeaShipping(updates, existing);
      if (v.error) return res.status(400).json({ error: v.error });
      warnings = v.warnings;
    }

    // Validate option-list fields
    const delivOpts = deliveryOptsFor(req.params.sheet);
    const payOpts   = paymentOptsFor(req.params.sheet);
    if ('factory_delivery_status' in updates && updates.factory_delivery_status && !delivOpts.includes(updates.factory_delivery_status))
      return res.status(400).json({ error: `factory_delivery_status must be one of: ${delivOpts.join(', ')}` });
    if ('payment_status' in updates && updates.payment_status && !payOpts.includes(updates.payment_status))
      return res.status(400).json({ error: `payment_status must be one of: ${payOpts.join(', ')}` });
    // INS QUOTES review guard
    if ('reviewed_status' in updates && updates.reviewed_status === 'Reviewed' && existing.linked_contract_status !== 'Linked')
      return res.status(400).json({ error: 'Cannot mark Reviewed: Contract Ref. must be Linked first.' });
    if ('reviewed_status' in updates && updates.reviewed_status === 'Reviewed') {
      updates.reviewed_date = new Date().toISOString().slice(0,10);
      updates.reviewed_by   = req.session.user.username;
    }
    // Auto-recompute contract link status if contract_ref changed
    if ('contract_ref' in updates) updates.linked_contract_status = computeContractLinkStatus(updates.contract_ref);

    updates.updated_at = new Date().toISOString();
    const setSql = Object.keys(updates).map(k=>`${k}=?`).join(', ');
    run(`UPDATE ${cfg.table} SET ${setSql} WHERE id=?`, [...Object.values(updates), req.params.id]);

    // Recompute balance_payable if amount, clearance_cost or total_paid changed
    if ('sea_cost' in updates || 'clearance_cost' in updates || 'other_job_cost' in updates || 'factory_quote_amount' in updates || 'total_paid' in updates)
      recomputeBalance(cfg.table, cfg.amountCol, req.params.id, cfg.table === 'factory_sea_costs');

    // Audit log when a factory order is cancelled (factory_delivery_status → 'Cancel')
    if ('factory_delivery_status' in updates && updates.factory_delivery_status === 'Cancel') {
      writeAuditLog({
        action: 'CANCEL',
        module: cfg.table,
        recordId: existing.id,
        recordRef: existing.factory_ref || String(existing.id),
        details: {
          previous_status: existing.factory_delivery_status,
          new_status: 'Cancel',
          contract_ref: existing.contract_ref || null,
          supplier_name: existing.supplier_name || null,
          quantity: existing.quantity != null ? existing.quantity : null,
        },
        performedBy: req.session.user.username,
      });
    }

    // Field-level audit trail for shipping-detail changes
    if (req.params.sheet === 'sea-costs') {
      const changed = {};
      for (const f of ['etd','bl_no','sea_cost','clearance_cost','total_paid','payment_status','shipping_status','delivery_status','remarks']) {
        if (f in updates && String(existing[f] ?? '') !== String(updates[f] ?? '')) changed[f === 'bl_no' ? 'eta' : f] = { from: existing[f] ?? null, to: updates[f] ?? null };
      }
      if (Object.keys(changed).length) writeAuditLog({ action: 'UPDATE', module: cfg.table, recordId: existing.id,
        recordRef: existing.factory_ref || String(existing.id), details: changed, performedBy: req.session.user.username });
    }

    res.json({ row: get(`SELECT * FROM ${cfg.table} WHERE id=?`, [req.params.id]), warnings });
  } catch (err) {
    console.error('[PATCH /api/factory/:sheet/:id]', err.message);
    res.status(500).json({ error: err.message || 'Failed to update record. Please try again.' });
  }
});

// ========================
// New Projects (kept for data integrity / future use; UI sub-tabs removed 2026-07-02)
// ========================
router.get('/new-projects', requireModule('factory'), (req, res) => {
  const { search, sort_by, sort_dir, section } = req.query;
  const where = ['is_deleted = 0'];
  const params = [];
  if (section) { where.push('section = ?'); params.push(section); }
  if (search) {
    where.push('(factory_ref LIKE ? OR contract_ref LIKE ? OR client_name LIKE ? OR project_description LIKE ?)');
    params.push(`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`);
  }
  const sortCols = { factory_ref:'factory_ref', contract_ref:'contract_ref', client_name:'client_name', value:'value', status:'status', updated_at:'updated_at' };
  const col = sortCols[sort_by] || 'updated_at';
  const dir = String(sort_dir).toLowerCase()==='asc' ? 'ASC' : 'DESC';
  const rows = all(`SELECT * FROM factory_new_projects WHERE ${where.join(' AND ')} ORDER BY ${col} ${dir}`, params);
  res.json({ title:'New Projects', rows, total:rows.length });
});

router.post('/new-projects', requireModule('factory'), (req, res) => {
  const b = req.body || {};
  const now = new Date().toISOString();
  const linkedStatus = computeContractLinkStatus(b.contract_ref || null);
  run(`INSERT INTO factory_new_projects (factory_ref,contract_ref,linked_contract_status,section,client_name,emirate,project_description,value,currency,status,remarks,last_updated_date,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [b.factory_ref||null, b.contract_ref||null, linkedStatus, b.section||'ins-quotes',
     b.client_name||null, b.emirate||null, b.project_description||null, b.value||null, b.currency||'USD', b.status||'Planned',
     b.remarks||null, now.slice(0,10), req.session.user.username, now, now]);
  res.status(201).json({ row: get(`SELECT * FROM factory_new_projects WHERE id=last_insert_rowid()`) });
});

router.get('/new-projects/:id', requireModule('factory'), (req, res) => {
  const row = get(`SELECT * FROM factory_new_projects WHERE id=?`, [req.params.id]);
  if (!row) return res.status(404).json({ error:'Not found' });
  res.json({ row });
});

router.patch('/new-projects/:id', requireModule('factory'), (req, res) => {
  const existing = get(`SELECT * FROM factory_new_projects WHERE id=?`, [req.params.id]);
  if (!existing) return res.status(404).json({ error:'Not found' });
  const body = req.body || {};
  const fields = ['factory_ref','contract_ref','section','client_name','emirate','project_description','value','currency','status','remarks'];
  const updates = {};
  for (const f of fields) { if (f in body) updates[f] = body[f]; }
  if (Object.keys(updates).length === 0) return res.status(400).json({ error:'No editable fields' });
  if ('contract_ref' in updates) updates.linked_contract_status = computeContractLinkStatus(updates.contract_ref);
  const now = new Date().toISOString();
  updates.updated_at = now; updates.last_updated_date = now.slice(0,10);
  const setSql = Object.keys(updates).map(k=>`${k}=?`).join(', ');
  run(`UPDATE factory_new_projects SET ${setSql} WHERE id=?`, [...Object.values(updates), req.params.id]);
  res.json({ row: get(`SELECT * FROM factory_new_projects WHERE id=?`, [req.params.id]) });
});

router.delete('/new-projects/:id', requireModule('factory'), requireRole('admin'), (req, res) => {
  const row = get(`SELECT * FROM factory_new_projects WHERE id=? AND is_deleted=0`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Record not found' });
  run(`UPDATE factory_new_projects SET is_deleted=1, updated_at=? WHERE id=?`, [new Date().toISOString(), req.params.id]);
  writeAuditLog({
    action: 'DELETE', module: 'factory_new_projects',
    recordId: row.id, recordRef: row.factory_ref || String(row.id),
    details: { client_name: row.client_name, contract_ref: row.contract_ref, section: row.section },
    performedBy: req.session.user.username,
  });
  res.json({ ok: true });
});


// ========================
// Contract-context factory search + create-for-link
// (Must come BEFORE legacy /:id wildcard routes — see comment at top of file)
// ========================

// GET /api/factory/search-for-link?q=&sheet=all|ins|otj|sea
// Called from Contract Details > Factory Link tab.
// Uses contracts permission since it's accessed from the contracts module.
router.get('/search-for-link', requireModule('contracts'), (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const sheet = String(req.query.sheet || 'all');
    if (!q || q.length < 2) return res.json({ rows: [] });
    const like = `%${q}%`;
    const rows = [];

    if (sheet === 'all' || sheet === 'ins') {
      const ins = all(
        `SELECT id, 'ins' AS sheet, factory_ref, client_name, supplier_name, project_description,
          contract_ref, linked_contract_status,
          factory_quote_amount AS amount, COALESCE(currency_code,'USD') AS currency_code,
          payment_status, production_status, factory_delivery_status AS delivery_status,
          total_paid, balance_payable, updated_at
         FROM factory_ins_quotes WHERE is_deleted = 0
          AND (factory_ref LIKE ? OR client_name LIKE ? OR supplier_name LIKE ? OR project_description LIKE ? OR contract_ref LIKE ?)
         ORDER BY factory_ref LIMIT 30`, [like, like, like, like, like]);
      rows.push(...ins);
    }
    if (sheet === 'all' || sheet === 'otj') {
      const otj = all(
        `SELECT id, 'otj' AS sheet, factory_ref, client_name, supplier_name, project_description,
          contract_ref, linked_contract_status,
          other_job_cost AS amount, COALESCE(currency_code,'USD') AS currency_code,
          payment_status, production_status, factory_delivery_status AS delivery_status,
          total_paid, balance_payable, updated_at
         FROM factory_otj_quotes WHERE is_deleted = 0
          AND (factory_ref LIKE ? OR client_name LIKE ? OR supplier_name LIKE ? OR project_description LIKE ? OR contract_ref LIKE ?)
         ORDER BY factory_ref LIMIT 30`, [like, like, like, like, like]);
      rows.push(...otj);
    }
    if (sheet === 'all' || sheet === 'sea') {
      const sea = all(
        `SELECT id, 'sea' AS sheet, factory_ref, client_name, supplier_name, project_description,
          contract_ref, linked_contract_status,
          sea_cost AS amount, COALESCE(currency_code,'USD') AS currency_code,
          payment_status, production_status, factory_delivery_status AS delivery_status,
          total_paid, balance_payable, updated_at
         FROM factory_sea_costs WHERE is_deleted = 0
          AND (factory_ref LIKE ? OR client_name LIKE ? OR supplier_name LIKE ? OR project_description LIKE ? OR contract_ref LIKE ?)
         ORDER BY factory_ref LIMIT 30`, [like, like, like, like, like]);
      rows.push(...sea);
    }

    rows.sort((a, b) => (a.factory_ref || '').localeCompare(b.factory_ref || ''));
    res.json({ rows: rows.slice(0, 50) });
  } catch (err) {
    console.error('[GET /api/factory/search-for-link]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/factory/create-for-link
// Create a new factory record and immediately link it to a contract.
// Body: { contractId, sheet, factory_ref, supplier_name, client_name, project_description,
//          amount, currency_code, payment_status, production_status, factory_delivery_status }
router.post('/create-for-link', requireModule('contracts'), (req, res) => {
  try {
    const b = req.body || {};
    const { contractId, sheet } = b;
    if (!contractId || !sheet) return res.status(400).json({ error: 'contractId and sheet required' });
    const TBL = { ins: 'factory_ins_quotes', otj: 'factory_otj_quotes', sea: 'factory_sea_costs' };
    const tbl = TBL[sheet];
    if (!tbl) return res.status(400).json({ error: 'Invalid sheet. Use ins, otj, or sea' });
    if (!b.factory_ref) return res.status(400).json({ error: 'Factory Ref. is required' });

    const contract = get(
      `SELECT id, contract_ref, client_name FROM contracts WHERE id = ? AND is_deleted = 0`,
      [contractId]);
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    if (!contract.contract_ref) return res.status(400).json({ error: 'Contract has no Contract Ref. — save a Contract Ref. first' });

    const existing = get(`SELECT id FROM ${tbl} WHERE factory_ref = ? AND is_deleted = 0`, [b.factory_ref]);
    if (existing) return res.status(409).json({ error: `Factory Ref. ${b.factory_ref} already exists in this section` });

    const amount = b.amount ? parseFloat(b.amount) : null;
    const currency = b.currency_code || 'USD';
    const now = new Date().toISOString();
    const amountCol = sheet === 'ins' ? 'factory_quote_amount'
                    : sheet === 'otj' ? 'other_job_cost' : 'sea_cost';

    run(`INSERT INTO ${tbl}
          (factory_ref, client_name, supplier_name, project_description,
           ${amountCol}, currency_code, payment_status, production_status, factory_delivery_status,
           contract_ref, linked_contract_status, created_by, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [b.factory_ref,
       b.client_name || contract.client_name || null,
       b.supplier_name || null,
       b.project_description || null,
       amount, currency,
       b.payment_status || 'Unpaid',
       b.production_status || 'Pending',
       b.factory_delivery_status || null,
       contract.contract_ref, 'Linked',
       req.session.user.username, now]);

    writeAuditLog({
      action: 'CREATE_AND_LINK', module: 'factory',
      recordId: contract.id, recordRef: contract.contract_ref,
      details: { factory_ref: b.factory_ref, sheet },
      performedBy: req.session.user.username,
    });

    res.status(201).json({ ok: true, factory_ref: b.factory_ref, contractRef: contract.contract_ref });
  } catch (err) {
    console.error('[POST /api/factory/create-for-link]', err);
    res.status(500).json({ error: 'Create failed: ' + err.message });
  }
});



// ========================
// 2026-09-16: Contract search for factory multi-link add form
// GET /api/factory/contract-search?q=&exclude=comma,separated,crefs
// Searched from the factory detail modal when adding a contract link.
// ========================
router.get('/contract-search', requireModule('factory'), (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q || q.length < 1) return res.json({ rows: [] });
  const like = `%${q}%`;
  const rows = all(
    `SELECT contract_ref, client_name, emirate, COALESCE(elevator_units,1) AS elevator_units, approval_date
     FROM contracts
     WHERE is_deleted = 0
       AND (contract_ref LIKE ? OR client_name LIKE ? OR project_description LIKE ? OR quote_ref LIKE ?)
     ORDER BY contract_ref DESC
     LIMIT 20`,
    [like, like, like, like]
  );
  res.json({ rows });
});

// GET /api/factory/multi-links/qty-check?factory_ref=X&factory_table=Y
// Returns factory record quantity and SUM of linked_quantity + factory_value total
// Used by the frontend to show allocation warnings and financial totals.
// Degrades gracefully if new columns (factory_commercial_mode, factory_value) not yet migrated.
router.get('/multi-links/qty-check', requireModule('factory'), (req, res) => {
  try {
    const { factory_ref, factory_table } = req.query;
    if (!factory_ref || !factory_table) return res.json({ factory_qty: null, linked_qty: 0, factory_value_total: 0, factory_commercial_mode: 'Separate' });
    let factory_qty = null;
    let factory_commercial_mode = 'Separate';
    let factory_combined_invoice_ref = null;
    if (factory_table === 'factory_ins_quotes') {
      // Check which columns exist before querying (new columns added via migration)
      let fiqRow = null;
      try {
        fiqRow = get(
          `SELECT quantity, factory_commercial_mode, factory_combined_invoice_ref FROM factory_ins_quotes WHERE factory_ref=? AND is_deleted=0 LIMIT 1`,
          [factory_ref]);
      } catch(_colErr) {
        // New columns not yet present (server not restarted) — fall back to quantity only
        fiqRow = get(`SELECT quantity FROM factory_ins_quotes WHERE factory_ref=? AND is_deleted=0 LIMIT 1`, [factory_ref]);
      }
      if (fiqRow) {
        factory_qty = fiqRow.quantity;
        factory_commercial_mode = fiqRow.factory_commercial_mode || 'Separate';
        factory_combined_invoice_ref = fiqRow.factory_combined_invoice_ref || null;
      }
    }
    // Sum linked_quantity and factory_value (factory_value may not exist yet — degrade gracefully)
    let linked_qty = 0;
    let fv_total = 0;
    try {
      const sumRow = get(
        `SELECT COALESCE(SUM(linked_quantity),0) AS linked_qty, COALESCE(SUM(factory_value),0) AS fv_total
         FROM factory_contract_links WHERE factory_ref=? AND factory_table=? AND is_deleted=0`,
        [factory_ref, factory_table]
      );
      if (sumRow) { linked_qty = sumRow.linked_qty; fv_total = sumRow.fv_total; }
    } catch(_colErr2) {
      // factory_value column not yet migrated — sum only linked_quantity
      const sumRow = get(
        `SELECT COALESCE(SUM(linked_quantity),0) AS linked_qty FROM factory_contract_links WHERE factory_ref=? AND factory_table=? AND is_deleted=0`,
        [factory_ref, factory_table]
      );
      if (sumRow) linked_qty = sumRow.linked_qty;
    }
    res.json({ factory_qty, linked_qty, factory_value_total: fv_total, factory_commercial_mode, factory_combined_invoice_ref });
  } catch(err) {
    console.error('[factory] qty-check error:', err.message);
    res.json({ factory_qty: null, linked_qty: 0, factory_value_total: 0, factory_commercial_mode: 'Separate' });
  }
});

// ========================
// Multi-Contract Links  (factory_contract_links)
// Allows one Factory Ref. to link to multiple Contract Refs with optional quantity/amount allocation.
// Payment records remain against the factory record — no double-counting.
// NOTE: these routes MUST be registered before the legacy wildcard /:id route.
// ========================

// GET /api/factory/multi-links?factory_ref=X&factory_table=Y  [or ?contract_ref=Z]
// Returns all active links with full contract commercial info for display:
//   contract_client, contract_emirate, contract_project  — from contracts table
//   contract_sales_value, contract_currency, contract_elevator_units — for Sales Value column
router.get('/multi-links', requireModule('factory'), (req, res) => {
  try {
    const { factory_ref, factory_table, contract_ref } = req.query;
    const where = ['fcl.is_deleted = 0'];
    const params = [];
    if (factory_ref)  { where.push('fcl.factory_ref = ?');  params.push(factory_ref); }
    if (factory_table){ where.push('fcl.factory_table = ?'); params.push(factory_table); }
    if (contract_ref) { where.push('fcl.contract_ref = ?');  params.push(contract_ref); }
    const rows = all(`
      SELECT fcl.*,
        c.client_name        AS contract_client,
        c.emirate            AS contract_emirate,
        c.project_description AS contract_project,
        c.contract_value     AS contract_sales_value,
        COALESCE(NULLIF(c.currency_code,''),'AED') AS contract_currency,   -- contracts has currency_code (no 'currency' column)
        COALESCE(c.elevator_units,1) AS contract_elevator_units
      FROM factory_contract_links fcl
      LEFT JOIN contracts c ON c.contract_ref = fcl.contract_ref AND c.is_deleted = 0
      WHERE ${where.join(' AND ')}
      ORDER BY fcl.linked_date DESC, fcl.id DESC`, params);

    // Build totals for the summary footer
    const totalAllocated = rows.reduce((s, r) => s + (Number(r.linked_quantity) || 0), 0);
    const totalFactoryValue = rows.reduce((s, r) => s + (Number(r.factory_value) || 0), 0);
    // Group sales totals by currency (don't mix AED and USD)
    const salesByCurrency = {};
    rows.forEach(r => {
      if (r.contract_sales_value != null) {
        const cur = r.contract_currency || 'AED';
        salesByCurrency[cur] = (salesByCurrency[cur] || 0) + Number(r.contract_sales_value);
      }
    });

    res.json({ rows, total: rows.length, totalAllocated, totalFactoryValue, salesByCurrency });
  } catch(err) {
    console.error('[factory] GET /multi-links error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/factory/multi-links
// Body fields:
//   factory_ref, factory_table, factory_record_id, contract_ref
//   linked_quantity      — units allocated to this contract from this factory order
//   factory_invoice_ref  — per-line factory invoice / PI ref (e.g. PI-888-A)
//   factory_value        — factory cost for this contract line
//   factory_currency     — currency (default USD)
//   model_lift_type, allocation_amount (legacy), status, remarks
router.post('/multi-links', requireModule('factory'), (req, res) => {
  try {
    const b = req.body || {};
    if (!b.factory_ref)   return res.status(400).json({ error: 'factory_ref required' });
    if (!b.contract_ref)  return res.status(400).json({ error: 'contract_ref required' });
    const validTables = ['factory_ins_quotes','factory_otj_quotes','factory_sea_costs'];
    if (!b.factory_table || !validTables.includes(b.factory_table))
      return res.status(400).json({ error: `factory_table must be one of: ${validTables.join(', ')}` });

    // Verify contract exists
    const contract = get(
      'SELECT id, COALESCE(elevator_units,1) AS elevator_units FROM contracts WHERE contract_ref = ? AND is_deleted = 0',
      [b.contract_ref]);
    if (!contract) return res.status(404).json({ error: `Contract "${b.contract_ref}" not found` });

    // Duplicate check (also enforced at DB level via unique index)
    const existing = get(
      'SELECT id FROM factory_contract_links WHERE factory_ref=? AND factory_table=? AND contract_ref=? AND is_deleted=0',
      [b.factory_ref, b.factory_table, b.contract_ref]);
    if (existing) return res.status(409).json({
      error: `${b.contract_ref} is already linked to Factory Ref. ${b.factory_ref}. Do not create another row.` });

    // Unit allocation validation: allocated ≤ contract elevator_units
    const allocQty = b.linked_quantity != null && b.linked_quantity !== '' ? parseInt(b.linked_quantity) : null;
    if (allocQty != null && allocQty > contract.elevator_units) {
      return res.status(400).json({
        error: `Allocated Factory quantity (${allocQty}) exceeds the Contract quantity (${contract.elevator_units} unit(s)) for ${b.contract_ref}.`
      });
    }

    const now = new Date().toISOString();
    run(`INSERT INTO factory_contract_links
      (factory_ref, factory_table, factory_record_id, contract_ref,
       linked_quantity, model_lift_type, allocation_amount,
       factory_invoice_ref, factory_value, factory_currency,
       linked_by, linked_date, status, remarks, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [b.factory_ref, b.factory_table, b.factory_record_id ? parseInt(b.factory_record_id) : null,
       b.contract_ref,
       allocQty,
       b.model_lift_type || null,
       b.allocation_amount != null && b.allocation_amount !== '' ? parseFloat(b.allocation_amount) : null,
       b.factory_invoice_ref || null,
       b.factory_value != null && b.factory_value !== '' ? parseFloat(b.factory_value) : null,
       b.factory_currency || 'USD',
       req.session.user.username, now.slice(0,10),
       b.status || 'Active', b.remarks || null, now, now]);

    writeAuditLog({
      action: 'LINK', module: 'factory_contract_links',
      recordId: null, recordRef: `${b.factory_ref} → ${b.contract_ref}`,
      details: {
        factory_table: b.factory_table,
        linked_quantity: allocQty,
        factory_invoice_ref: b.factory_invoice_ref,
        factory_value: b.factory_value,
        factory_currency: b.factory_currency || 'USD',
      },
      performedBy: req.session.user.username,
    });

    res.status(201).json({ row: get('SELECT * FROM factory_contract_links WHERE id = last_insert_rowid()') });
  } catch (err) {
    console.error('[POST /api/factory/multi-links]', err.message);
    res.status(500).json({ error: err.message || 'Failed to create link' });
  }
});

// PATCH /api/factory/multi-links/:id
router.patch('/multi-links/:id', requireModule('factory'), (req, res) => {
  try {
    const link = get('SELECT * FROM factory_contract_links WHERE id=? AND is_deleted=0', [req.params.id]);
    if (!link) return res.status(404).json({ error: 'Link not found' });
    const b = req.body || {};

    // Unit allocation validation if quantity is being changed
    if ('linked_quantity' in b && b.linked_quantity != null && b.linked_quantity !== '') {
      const allocQty = parseInt(b.linked_quantity);
      const contract = get(
        'SELECT COALESCE(elevator_units,1) AS elevator_units FROM contracts WHERE contract_ref=? AND is_deleted=0',
        [link.contract_ref]);
      if (contract && allocQty > contract.elevator_units) {
        return res.status(400).json({
          error: `Allocated Factory quantity (${allocQty}) exceeds the Contract quantity (${contract.elevator_units} unit(s)) for ${link.contract_ref}.`
        });
      }
    }

    const updates = {};
    for (const f of ['linked_quantity','model_lift_type','allocation_amount','factory_invoice_ref','factory_value','factory_currency','status','remarks']) {
      if (f in b) updates[f] = b[f];
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No editable fields supplied' });
    updates.updated_at = new Date().toISOString();
    const setSql = Object.keys(updates).map(k=>`${k}=?`).join(', ');
    run(`UPDATE factory_contract_links SET ${setSql} WHERE id=?`, [...Object.values(updates), req.params.id]);
    res.json({ row: get('SELECT * FROM factory_contract_links WHERE id=?', [req.params.id]) });
  } catch (err) {
    console.error('[PATCH /api/factory/multi-links/:id]', err.message);
    res.status(500).json({ error: err.message || 'Failed to update link' });
  }
});

// DELETE /api/factory/multi-links/:id  (soft-delete)
router.delete('/multi-links/:id', requireModule('factory'), (req, res) => {
  try {
    const link = get('SELECT * FROM factory_contract_links WHERE id=? AND is_deleted=0', [req.params.id]);
    if (!link) return res.status(404).json({ error: 'Link not found' });
    run('UPDATE factory_contract_links SET is_deleted=1, updated_at=? WHERE id=?',
      [new Date().toISOString(), req.params.id]);
    writeAuditLog({
      action: 'UNLINK', module: 'factory_contract_links',
      recordId: link.id, recordRef: `${link.factory_ref} → ${link.contract_ref}`,
      details: { factory_table: link.factory_table },
      performedBy: req.session.user.username,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/factory/multi-links/:id]', err.message);
    res.status(500).json({ error: err.message || 'Failed to remove link' });
  }
});

// ========================
// Legacy factory_orders routes (kept for routes/links.js compatibility, 0 rows)
// ========================
router.get('/', requireModule('factory'), (req, res) => {
  const { search, supplier_name, production_status, shipping_status, delivery_status, page=1, pageSize=50 } = req.query;
  const where = ['is_deleted = 0'];
  const params = [];
  if (search)           { where.push('(client_name LIKE ? OR project_description LIKE ? OR factory_order_code LIKE ? OR our_ref LIKE ? OR factory_ref LIKE ?)'); params.push(`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`); }
  if (supplier_name)    { where.push('supplier_name = ?');    params.push(supplier_name); }
  if (production_status){ where.push('production_status = ?');params.push(production_status); }
  if (shipping_status)  { where.push('shipping_status = ?');  params.push(shipping_status); }
  if (delivery_status)  { where.push('delivery_status = ?');  params.push(delivery_status); }
  const whereSql = where.join(' AND ');
  const total = get(`SELECT COUNT(*) c FROM factory_orders WHERE ${whereSql}`, params).c;
  const limit = Math.min(parseInt(pageSize)||50, 500);
  const offset = (Math.max(parseInt(page)||1,1)-1)*limit;
  const rows = all(`SELECT * FROM factory_orders WHERE ${whereSql} ORDER BY updated_at DESC LIMIT ? OFFSET ?`, [...params,limit,offset]);
  res.json({ total, page:Number(page), pageSize:limit, rows });
});

router.get('/:id', requireModule('factory'), (req, res) => {
  const order = get('SELECT * FROM factory_orders WHERE id=?', [req.params.id]);
  if (!order) return res.status(404).json({ error:'Not found' });
  const history     = all(`SELECT * FROM status_history WHERE entity_type='factory_order' AND entity_id=? ORDER BY changed_at DESC`, [req.params.id]);
  const attachments = all(`SELECT * FROM attachments WHERE entity_type='factory_order' AND entity_id=? ORDER BY uploaded_at DESC`, [req.params.id]);
  const links       = all(`SELECT p.*, pl.link_type, pl.linked_by, pl.linked_at, pl.id AS link_id FROM project_links pl JOIN quotations p ON p.id=pl.project_id WHERE pl.factory_order_id=?`, [req.params.id]);
  res.json({ order, history, attachments, links });
});

router.post('/', requireModule('factory'), (req, res) => {
  if (!can(req.session.user.role,'create')) return res.status(403).json({ error:'Your role cannot create factory orders' });
  const b = req.body || {};
  if (!b.client_name && !b.supplier_name) return res.status(400).json({ error:'client_name or supplier_name required' });
  let code=b.factory_order_code||b.our_ref||`MANUAL-${Date.now()}`, finalCode=code, n=1;
  while (get('SELECT id FROM factory_orders WHERE factory_order_code=?',[finalCode])) finalCode=`${code}-${++n}`;
  run(`INSERT INTO factory_orders (factory_order_code,factory_quotation_number,supplier_name,our_ref,factory_ref,client_name,project_description,order_confirmation_status,production_status,factory_invoice_value,supplier_payment_paid,packing_list,bl_copy,shipping_status,eta,delivery_status,remarks,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [finalCode,b.factory_quotation_number||null,b.supplier_name||null,b.our_ref||null,b.factory_ref||null,b.client_name||null,b.project_description||null,b.order_confirmation_status||'Pending',b.production_status||'Not Started',b.factory_invoice_value||null,b.supplier_payment_paid||0,b.packing_list||null,b.bl_copy||null,b.shipping_status||'Not Shipped',b.eta||null,b.delivery_status||'Pending',b.remarks||null,req.session.user.username]);
  res.status(201).json({ order: get('SELECT * FROM factory_orders WHERE factory_order_code=?',[finalCode]) });
});

router.patch('/:id', requireModule('factory'), (req, res) => {
  const existing = get('SELECT * FROM factory_orders WHERE id=?',[req.params.id]);
  if (!existing) return res.status(404).json({ error:'Not found' });
  const role = req.session.user.role;
  const items = Object.entries(req.body || {}).filter(([k]) => filterFieldsForRole(role, k));
  items.forEach(([k, v]) => run(`UPDATE factory_orders SET ${k} = ? WHERE id = ?`, [v, req.params.id]));
  res.json({ order: get('SELECT * FROM factory_orders WHERE id=?', [req.params.id]) });
});


module.exports = router;
