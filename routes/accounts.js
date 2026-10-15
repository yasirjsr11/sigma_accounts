// Accounts & Payments module routes.
//
// Two main sections:
//   1. Client Contract Payments  — linked to contracts table
//   2. Factory Supplier Payments — three independent sub-sections:
//        a. Factory INS Payments  (factory_table='ins_quotes')
//        b. OTJ Payments          (factory_table='otj_quotes')
//        c. SEA Payments          (factory_table='sea_costs')

const express = require('express');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const multer = require('multer');
const path = require('path');
const { run, get, all, db } = require('../db/db.js');
const { requireModule, requireRole } = require('../middleware/auth.js');
const { writeAuditLog } = require('../db/audit.js');
const { createBackup } = require('../backup/backup.js');
const router = express.Router();

// Multer: in-memory storage for Excel reconciliation uploads (no disk writes)
const reconcileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
function _multerSingle(field) {
  return (req, res, next) => reconcileUpload.single(field)(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}

const LOGO_PATH = path.join(__dirname, '../public/img/logo.png');
const LOGO_RATIO = 1712 / 4855;
const ACCOUNTS_MANAGERS = ['admin', 'accounts'];

function requireAccountsManager(req, res, next) {
  if (!req.session || !req.session.user) return res.status(401).json({ error: 'Not logged in' });
  if (!ACCOUNTS_MANAGERS.includes(req.session.user.role))
    return res.status(403).json({ error: 'Insufficient permissions to manage payments' });
  next();
}

// ── DB migrations (idempotent) ───────────────────────────────────────────────
const _MIGRATIONS = [
  `ALTER TABLE factory_payments ADD COLUMN payment_date TEXT`,
  `ALTER TABLE factory_payments ADD COLUMN shipping_ref TEXT`,
  `ALTER TABLE factory_payments ADD COLUMN bl_no TEXT`,
  `ALTER TABLE factory_payments ADD COLUMN eta TEXT`,
  `ALTER TABLE factory_payments ADD COLUMN shipping_cost REAL`,
  `ALTER TABLE factory_payments ADD COLUMN clearance_cost REAL`,
  `ALTER TABLE factory_payments ADD COLUMN highlight_status TEXT`,
  // Payment sync columns
  `ALTER TABLE contracts ADD COLUMN last_payment_date TEXT`,
  `ALTER TABLE factory_ins_quotes ADD COLUMN last_payment_date TEXT`,
  `ALTER TABLE factory_otj_quotes ADD COLUMN last_payment_date TEXT`,
  `ALTER TABLE factory_sea_costs ADD COLUMN last_payment_date TEXT`,
  // 2026-09-11: Payment reconciliation batch tracking
  `ALTER TABLE client_payments ADD COLUMN reconcile_batch_id TEXT`,
];
for (const s of _MIGRATIONS) { try { run(s); } catch(_) {} }

// 2026-09-11: Payment reconciliation audit log table
try {
  run(`CREATE TABLE IF NOT EXISTS payment_reconcile_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL,
    source_file TEXT,
    contract_ref TEXT NOT NULL,
    existing_received REAL,
    source_received REAL,
    adjustment_amount REAL,
    existing_balance REAL,
    new_balance REAL,
    status TEXT,
    payment_ref TEXT,
    performed_by TEXT,
    performed_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
} catch(_) {}
try {
  run(`UPDATE factory_payments SET payment_date=entry_date WHERE payment_date IS NULL`);
  run(`UPDATE factory_payments SET shipping_ref=factory_ref WHERE factory_table='sea_costs' AND shipping_ref IS NULL`);
  run(`UPDATE factory_payments SET shipping_cost=total_amount WHERE factory_table='sea_costs' AND shipping_cost IS NULL`);
  run(`UPDATE factory_payments SET bl_no=(SELECT fsc.bl_no FROM factory_sea_costs fsc WHERE fsc.factory_ref=factory_payments.factory_ref AND fsc.is_deleted=0 LIMIT 1) WHERE factory_table='sea_costs' AND bl_no IS NULL`);
} catch(_) {}

// ── Ref generators ───────────────────────────────────────────────────────────
function nextClientPaymentRef() {
  const year = new Date().getFullYear();
  const rows = all(`SELECT payment_ref FROM client_payments WHERE payment_ref LIKE ?`, [`CP-${year}-%`]);
  let max = 0;
  for (const r of rows) { const m = /CP-\d{4}-(\d+)/.exec(r.payment_ref||''); if (m) max = Math.max(max, parseInt(m[1],10)); }
  return `CP-${year}-${String(max+1).padStart(4,'0')}`;
}
function nextFactoryPaymentRef() {
  const year = new Date().getFullYear();
  const rows = all(`SELECT payment_ref FROM factory_payments WHERE payment_ref LIKE ?`, [`FP-${year}-%`]);
  let max = 0;
  for (const r of rows) { const m = /FP-\d{4}-(\d+)/.exec(r.payment_ref||''); if (m) max = Math.max(max, parseInt(m[1],10)); }
  return `FP-${year}-${String(max+1).padStart(4,'0')}`;
}

// ── Contract payment sync ────────────────────────────────────────────────────
function syncContractPayments(contractRef) {
  if (!contractRef) return;
  const r = get(`SELECT COALESCE(SUM(received_amount),0) AS t, MAX(entry_date) AS last_date FROM client_payments WHERE contract_ref=? AND is_deleted=0`, [contractRef]) || {};
  const total = r.t || 0;
  const lastDate = r.last_date || null;
  const contract = get(`SELECT contract_value FROM contracts WHERE contract_ref=? AND is_deleted=0`, [contractRef]);
  if (!contract) return;
  const cv = contract.contract_value||0;
  const balance = cv - total;
  let status = 'Unpaid';
  if (total>0 && total<cv) status = 'Partial Paid';
  else if (total>0 && total>=cv) status = total>cv ? 'Overpaid' : 'Full Paid';
  run(`UPDATE contracts SET total_received=?,payment_status=?,balance_amount=?,last_payment_date=?,updated_at=datetime('now') WHERE contract_ref=?`, [total,status,balance,lastDate,contractRef]);
}

// ── Factory source record sync ───────────────────────────────────────────────
// After any factory payment add/edit/delete, recompute and push totals back
// to the source factory table so Factory & Suppliers module stays in sync.
function syncFactorySource(factoryRef, factoryTable) {
  if (!factoryRef || !factoryTable) return;
  let sourceTable, amountCol, inclClearance;
  if (factoryTable === 'ins_quotes')  { sourceTable = 'factory_ins_quotes'; amountCol = 'factory_quote_amount'; inclClearance = false; }
  else if (factoryTable === 'otj_quotes') { sourceTable = 'factory_otj_quotes'; amountCol = 'other_job_cost'; inclClearance = false; }
  else if (factoryTable === 'sea_costs')  { sourceTable = 'factory_sea_costs';  amountCol = 'sea_cost';            inclClearance = true;  }
  else return;
  try {
    const paid = get(`SELECT COALESCE(SUM(paid_amount),0) AS t, MAX(payment_date) AS last_date FROM factory_payments WHERE factory_table=? AND factory_ref=? AND is_deleted=0`, [factoryTable, factoryRef]) || {};
    const totalPaid = paid.t || 0;
    const lastDate  = paid.last_date || null;
    const src = get(`SELECT ${amountCol} AS amt ${inclClearance ? ', COALESCE(clearance_cost,0) AS cc' : ''} FROM ${sourceTable} WHERE factory_ref=? AND is_deleted=0 LIMIT 1`, [factoryRef]);
    if (!src) return;
    const total = inclClearance ? ((src.amt||0) + (src.cc||0)) : (src.amt||0);
    const balance = total - totalPaid;
    let status = 'Unpaid';
    if (totalPaid > 0 && totalPaid < total)  status = 'Partial Paid';
    else if (totalPaid > 0 && totalPaid >= total) status = totalPaid > total ? 'Overpaid' : 'Full Paid';
    run(`UPDATE ${sourceTable} SET total_paid=?,balance_payable=?,payment_status=?,last_payment_date=?,updated_at=datetime('now') WHERE factory_ref=? AND is_deleted=0`, [totalPaid, balance, status, lastDate, factoryRef]);
    // Also sync advance_payment_date and order_date for ins_quotes from earliest Advance payment
    if (sourceTable === 'factory_ins_quotes') {
      const advPay = get(`SELECT MIN(payment_date) AS adv_date FROM factory_payments WHERE factory_table=? AND factory_ref=? AND payment_type='Advance' AND is_deleted=0`, [factoryTable, factoryRef]);
      if (advPay && advPay.adv_date) {
        run(`UPDATE factory_ins_quotes SET advance_payment_date=?,order_date=?,updated_at=datetime('now') WHERE factory_ref=? AND is_deleted=0 AND (advance_payment_date IS NULL OR advance_payment_date='' OR advance_payment_date!=?)`, [advPay.adv_date, advPay.adv_date, factoryRef, advPay.adv_date]);
      }
    }
  } catch(e) { /* non-fatal */ }
}

// ── Factory balance helper ───────────────────────────────────────────────────
function computeFactoryBalance(total, paid) {
  const t = total||0, p = paid||0;
  const balance = t - p;
  let status = 'Unpaid';
  if (p>0 && p<t) status = 'Partial Paid';
  else if (p>0 && p>=t) status = p>t ? 'Overpaid' : 'Full Paid';
  return { balance, status };
}

// ── Section WHERE builder ────────────────────────────────────────────────────
function sectionWhere(table, q) {
  const { search, factory_ref, shipping_ref, supplier, payment_type, payment_status, date_from, date_to } = q;
  const where = [`is_deleted=0`, `factory_table='${table}'`];
  const params = [];
  if (search) {
    where.push('(payment_ref LIKE ? OR factory_ref LIKE ? OR shipping_ref LIKE ? OR supplier_name LIKE ? OR our_ref LIKE ?)');
    params.push(`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`);
  }
  if (factory_ref) { where.push('factory_ref LIKE ?'); params.push(`%${factory_ref}%`); }
  if (shipping_ref) { where.push('shipping_ref LIKE ?'); params.push(`%${shipping_ref}%`); }
  if (supplier) { where.push('supplier_name LIKE ?'); params.push(`%${supplier}%`); }
  if (payment_type) { where.push('payment_type=?'); params.push(payment_type); }
  if (payment_status) { where.push('payment_status=?'); params.push(payment_status); }
  if (date_from) { where.push('entry_date>=?'); params.push(date_from); }
  if (date_to) { where.push('entry_date<=?'); params.push(date_to); }
  return { wSql: `WHERE ${where.join(' AND ')}`, params };
}

const SORT_COLS_INS = { entry_date:'entry_date',payment_date:'payment_date',payment_ref:'payment_ref',factory_ref:'factory_ref',supplier_name:'supplier_name',paid_amount:'paid_amount',payment_status:'payment_status' };
const SORT_COLS_OTJ = SORT_COLS_INS;
const SORT_COLS_SEA = { entry_date:'entry_date',payment_date:'payment_date',payment_ref:'payment_ref',shipping_ref:'shipping_ref',supplier_name:'supplier_name',paid_amount:'paid_amount',payment_status:'payment_status' };

// ── Generic section list handler ─────────────────────────────────────────────
function sectionList(table, sortCols) {
  return (req, res) => {
    const { sort='entry_date', dir='desc', page=1, pageSize=50 } = req.query;
    const { wSql, params } = sectionWhere(table, req.query);
    const col = sortCols[sort] || 'entry_date';
    const direction = dir==='asc' ? 'ASC' : 'DESC';
    const total = (get(`SELECT COUNT(*) c FROM factory_payments ${wSql}`, params)||{}).c||0;
    const offset = (parseInt(page)-1)*parseInt(pageSize);
    const rows = all(`SELECT * FROM factory_payments ${wSql} ORDER BY ${col} ${direction} LIMIT ? OFFSET ?`, [...params,parseInt(pageSize),offset]);
    res.json({ rows, total, page:parseInt(page), pageSize:parseInt(pageSize) });
  };
}

// ── Generic section summary handler ─────────────────────────────────────────
function sectionSummary(table) {
  return (req, res) => {
    const r = get(`SELECT COALESCE(SUM(total_amount),0) AS total_payable, COALESCE(SUM(paid_amount),0) AS total_paid, COALESCE(SUM(balance_amount),0) AS total_balance FROM factory_payments WHERE is_deleted=0 AND factory_table='${table}'`);
    res.json(r||{total_payable:0,total_paid:0,total_balance:0});
  };
}

// ── Generic PATCH handler ─────────────────────────────────────────────────────
function sectionPatch(table, extraFields) {
  return (req, res) => {
    const p = get(`SELECT * FROM factory_payments WHERE id=? AND is_deleted=0 AND factory_table=?`, [req.params.id, table]);
    if (!p) return res.status(404).json({ error: 'Payment not found' });
    const ALLOWED = ['our_ref','factory_ref','shipping_ref','bl_no','eta','supplier_name','project_client_name',
      'total_amount','paid_amount','shipping_cost','clearance_cost','payment_type','payment_mode',
      'payment_date','remarks','entry_date','highlight_status', ...(extraFields||[])];
    const sets=[], vals=[];
    for (const f of ALLOWED) {
      if (req.body[f] !== undefined) { sets.push(`${f}=?`); vals.push(req.body[f]===''?null:req.body[f]); }
    }
    // Recompute balance
    let ta, pa;
    if (table==='sea_costs') {
      const sc = parseFloat(req.body.shipping_cost ?? p.shipping_cost)||0;
      const cc = parseFloat(req.body.clearance_cost ?? p.clearance_cost)||0;
      ta = sc+cc;
      sets.push('total_amount=?'); vals.push(ta);
    } else {
      ta = parseFloat(req.body.total_amount ?? p.total_amount)||0;
    }
    pa = parseFloat(req.body.paid_amount ?? p.paid_amount)||0;
    const { balance, status } = computeFactoryBalance(ta, pa);
    sets.push('balance_amount=?','payment_status=?',"updated_at=datetime('now')");
    vals.push(balance, status);
    if (sets.length) run(`UPDATE factory_payments SET ${sets.join(',')} WHERE id=?`, [...vals, req.params.id]);
    // Sync back to source factory table
    const updated = get(`SELECT factory_ref, factory_table FROM factory_payments WHERE id=?`, [req.params.id]);
    if (updated) syncFactorySource(updated.factory_ref || updated.shipping_ref, updated.factory_table);
    res.json({ ok: true });
  };
}

// ── Generic DELETE handler ────────────────────────────────────────────────────
function sectionDelete(table, module) {
  return (req, res) => {
    const p = get(`SELECT * FROM factory_payments WHERE id=? AND is_deleted=0 AND factory_table=?`, [req.params.id, table]);
    if (!p) return res.status(404).json({ error: 'Payment not found' });
    run(`UPDATE factory_payments SET is_deleted=1,updated_at=datetime('now') WHERE id=?`, [req.params.id]);
    syncFactorySource(p.factory_ref || p.shipping_ref, p.factory_table);
    writeAuditLog({ action:'DELETE', module, recordRef:p.payment_ref, details:{ factory_ref:p.factory_ref, paid_amount:p.paid_amount }, performedBy:req.session.user.username });
    res.json({ ok: true });
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY INS PAYMENTS  (factory_table = 'ins_quotes')
// ─────────────────────────────────────────────────────────────────────────────
router.get('/factory/ins', requireModule('accounts'), sectionList('ins_quotes', SORT_COLS_INS));
router.get('/factory/ins/summary', requireModule('accounts'), sectionSummary('ins_quotes'));

router.post('/factory/ins', requireModule('accounts'), requireAccountsManager, (req, res) => {
  const { our_ref, factory_ref, supplier_name, project_client_name,
          total_amount, paid_amount, payment_type, payment_mode,
          payment_date, remarks, entry_date } = req.body;
  if (!paid_amount || isNaN(paid_amount)) return res.status(400).json({ error: 'paid_amount is required' });
  // Dup check: factory_ref + payment_date + paid_amount
  if (factory_ref && payment_date && paid_amount) {
    const dup = get(`SELECT id,payment_ref FROM factory_payments WHERE factory_table='ins_quotes' AND factory_ref=? AND payment_date=? AND ABS(paid_amount-?)<=0.01 AND is_deleted=0`,
      [factory_ref, payment_date, parseFloat(paid_amount)]);
    if (dup) return res.status(409).json({ error:`Duplicate: payment for ${factory_ref} on ${payment_date} of ${paid_amount} already exists (${dup.payment_ref})`, existing_id:dup.id });
  }
  const ref = nextFactoryPaymentRef();
  const ta=parseFloat(total_amount)||0, pa=parseFloat(paid_amount)||0;
  // Overpayment check
  if (factory_ref && !req.body.force_overpay) {
    const existPaid = (get(`SELECT COALESCE(SUM(paid_amount),0) AS t FROM factory_payments WHERE factory_table='ins_quotes' AND factory_ref=? AND is_deleted=0`, [factory_ref])||{}).t||0;
    const src = get(`SELECT factory_quote_amount AS amt FROM factory_ins_quotes WHERE factory_ref=? AND is_deleted=0 LIMIT 1`, [factory_ref]);
    if (src && (existPaid + pa) > (src.amt||0)) {
      return res.status(422).json({ warning:'overpayment', message:`Total paid USD ${(existPaid+pa).toFixed(2)} would exceed factory quote amount USD ${(src.amt||0).toFixed(2)} for ${factory_ref}`, total_payable:src.amt||0, existing_paid:existPaid, new_amount:pa });
    }
  }
  const { balance, status } = computeFactoryBalance(ta, pa);
  run(`INSERT INTO factory_payments (payment_ref,entry_date,payment_date,our_ref,factory_ref,factory_table,supplier_name,project_client_name,total_amount,paid_amount,balance_amount,payment_type,payment_mode,payment_status,remarks,created_by,currency_code,currency_symbol)
       VALUES (?,?,?,?,?,'ins_quotes',?,?,?,?,?,?,?,?,?,?,'USD','USD')`,
    [ref, entry_date||new Date().toISOString().slice(0,10), payment_date||null,
     our_ref||null, factory_ref||null, supplier_name||null, project_client_name||null,
     ta, pa, balance, payment_type||null, payment_mode||null, status, remarks||null,
     req.session.user.username]);
  syncFactorySource(factory_ref, 'ins_quotes');
  writeAuditLog({ action:'CREATE', module:'factory_payments_ins', recordRef:ref, details:{factory_ref,paid_amount}, performedBy:req.session.user.username });
  res.json({ ok:true, payment_ref:ref });
});

router.patch('/factory/ins/:id', requireModule('accounts'), requireAccountsManager, sectionPatch('ins_quotes'));
router.delete('/factory/ins/:id', requireModule('accounts'), requireRole('admin'), sectionDelete('ins_quotes','factory_payments_ins'));

router.get('/factory/ins/export-excel', requireModule('accounts'), async (req, res) => {
  const rows = all(`SELECT * FROM factory_payments WHERE factory_table='ins_quotes' AND is_deleted=0 ORDER BY entry_date DESC`);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('INS Payments');
  const hdr = ws.addRow(['Payment Ref.','Entry Date','Payment Date','Our Ref.','Factory Ref.','Supplier / Factory',
    'Project / Client','Total Amount (USD)','Paid Amount (USD)','Balance (USD)','Payment Type','Payment Mode','Payment Status','Remarks','Last Updated']);
  hdr.font={bold:true}; hdr.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFDDEEFF'}};
  for (const r of rows) {
    const row = ws.addRow([r.payment_ref,r.entry_date,r.payment_date,r.our_ref,r.factory_ref,r.supplier_name,
      r.project_client_name,r.total_amount,r.paid_amount,r.balance_amount,r.payment_type,r.payment_mode,r.payment_status,r.remarks,r.updated_at]);
    if (r.highlight_status==='green') row.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFD4EDDA'}};
    else if (r.highlight_status==='yellow') row.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF3CD'}};
    else if (r.highlight_status==='red') row.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF8D7DA'}};
  }
  ws.columns.forEach(c=>{c.width=18;});
  res.setHeader('Content-Disposition','attachment; filename="ins_payments.xlsx"');
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(await wb.xlsx.writeBuffer());
});

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY OTJ PAYMENTS  (factory_table = 'otj_quotes')
// ─────────────────────────────────────────────────────────────────────────────
router.get('/factory/otj', requireModule('accounts'), sectionList('otj_quotes', SORT_COLS_OTJ));
router.get('/factory/otj/summary', requireModule('accounts'), sectionSummary('otj_quotes'));

router.post('/factory/otj', requireModule('accounts'), requireAccountsManager, (req, res) => {
  const { our_ref, factory_ref, supplier_name, project_client_name,
          total_amount, paid_amount, payment_type, payment_mode,
          payment_date, remarks, entry_date } = req.body;
  if (!paid_amount || isNaN(paid_amount)) return res.status(400).json({ error: 'paid_amount is required' });
  if (factory_ref && payment_date && paid_amount) {
    const dup = get(`SELECT id,payment_ref FROM factory_payments WHERE factory_table='otj_quotes' AND factory_ref=? AND payment_date=? AND ABS(paid_amount-?)<=0.01 AND is_deleted=0`,
      [factory_ref, payment_date, parseFloat(paid_amount)]);
    if (dup) return res.status(409).json({ error:`Duplicate: payment for ${factory_ref} on ${payment_date} of ${paid_amount} already exists (${dup.payment_ref})`, existing_id:dup.id });
  }
  const ref = nextFactoryPaymentRef();
  const ta=parseFloat(total_amount)||0, pa=parseFloat(paid_amount)||0;
  // Overpayment check
  if (factory_ref && !req.body.force_overpay) {
    const existPaid = (get(`SELECT COALESCE(SUM(paid_amount),0) AS t FROM factory_payments WHERE factory_table='otj_quotes' AND factory_ref=? AND is_deleted=0`, [factory_ref])||{}).t||0;
    const src = get(`SELECT other_job_cost AS amt FROM factory_otj_quotes WHERE factory_ref=? AND is_deleted=0 LIMIT 1`, [factory_ref]);
    if (src && (existPaid + pa) > (src.amt||0)) {
      return res.status(422).json({ warning:'overpayment', message:`Total paid USD ${(existPaid+pa).toFixed(2)} would exceed OTJ cost USD ${(src.amt||0).toFixed(2)} for ${factory_ref}`, total_payable:src.amt||0, existing_paid:existPaid, new_amount:pa });
    }
  }
  const { balance, status } = computeFactoryBalance(ta, pa);
  run(`INSERT INTO factory_payments (payment_ref,entry_date,payment_date,our_ref,factory_ref,factory_table,supplier_name,project_client_name,total_amount,paid_amount,balance_amount,payment_type,payment_mode,payment_status,remarks,created_by,currency_code,currency_symbol)
       VALUES (?,?,?,?,?,'otj_quotes',?,?,?,?,?,?,?,?,?,?,'USD','USD')`,
    [ref, entry_date||new Date().toISOString().slice(0,10), payment_date||null,
     our_ref||null, factory_ref||null, supplier_name||null, project_client_name||null,
     ta, pa, balance, payment_type||null, payment_mode||null, status, remarks||null,
     req.session.user.username]);
  syncFactorySource(factory_ref, 'otj_quotes');
  writeAuditLog({ action:'CREATE', module:'factory_payments_otj', recordRef:ref, details:{factory_ref,paid_amount}, performedBy:req.session.user.username });
  res.json({ ok:true, payment_ref:ref });
});

router.patch('/factory/otj/:id', requireModule('accounts'), requireAccountsManager, sectionPatch('otj_quotes'));
router.delete('/factory/otj/:id', requireModule('accounts'), requireRole('admin'), sectionDelete('otj_quotes','factory_payments_otj'));

router.get('/factory/otj/export-excel', requireModule('accounts'), async (req, res) => {
  const rows = all(`SELECT * FROM factory_payments WHERE factory_table='otj_quotes' AND is_deleted=0 ORDER BY entry_date DESC`);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('OTJ Payments');
  const hdr = ws.addRow(['Payment Ref.','Entry Date','Payment Date','Our Ref.','Factory Ref.','Supplier / Factory',
    'Project / Client','OTJ Total Amount (USD)','Paid Amount (USD)','Balance (USD)','Payment Type','Payment Mode','Payment Status','Remarks','Last Updated']);
  hdr.font={bold:true}; hdr.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFDDEEFF'}};
  for (const r of rows) {
    const row = ws.addRow([r.payment_ref,r.entry_date,r.payment_date,r.our_ref,r.factory_ref,r.supplier_name,
      r.project_client_name,r.total_amount,r.paid_amount,r.balance_amount,r.payment_type,r.payment_mode,r.payment_status,r.remarks,r.updated_at]);
    if (r.highlight_status==='green') row.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFD4EDDA'}};
    else if (r.highlight_status==='yellow') row.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF3CD'}};
    else if (r.highlight_status==='red') row.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF8D7DA'}};
  }
  ws.columns.forEach(c=>{c.width=18;});
  res.setHeader('Content-Disposition','attachment; filename="otj_payments.xlsx"');
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(await wb.xlsx.writeBuffer());
});

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY SEA PAYMENTS  (factory_table = 'sea_costs')
// ─────────────────────────────────────────────────────────────────────────────
router.get('/factory/sea', requireModule('accounts'), sectionList('sea_costs', SORT_COLS_SEA));
router.get('/factory/sea/summary', requireModule('accounts'), sectionSummary('sea_costs'));

router.post('/factory/sea', requireModule('accounts'), requireAccountsManager, (req, res) => {
  const { shipping_ref, bl_no, eta, supplier_name, shipping_cost, clearance_cost,
          paid_amount, payment_type, payment_mode, payment_date, remarks, entry_date } = req.body;
  if (!paid_amount || isNaN(paid_amount)) return res.status(400).json({ error: 'paid_amount is required' });
  const sc=parseFloat(shipping_cost)||0, cc=parseFloat(clearance_cost)||0;
  const total_payable = sc + cc;
  const pa=parseFloat(paid_amount)||0;
  if (shipping_ref && payment_date && paid_amount) {
    const dup = get(`SELECT id,payment_ref FROM factory_payments WHERE factory_table='sea_costs' AND shipping_ref=? AND payment_date=? AND ABS(paid_amount-?)<=0.01 AND is_deleted=0`,
      [shipping_ref, payment_date, pa]);
    if (dup) return res.status(409).json({ error:`Duplicate: SEA payment for ${shipping_ref} on ${payment_date} of ${paid_amount} already exists (${dup.payment_ref})`, existing_id:dup.id });
  }
  // Overpayment check
  if (shipping_ref && !req.body.force_overpay) {
    const existPaid = (get(`SELECT COALESCE(SUM(paid_amount),0) AS t FROM factory_payments WHERE factory_table='sea_costs' AND factory_ref=? AND is_deleted=0`, [shipping_ref])||{}).t||0;
    const src = get(`SELECT COALESCE(sea_cost,0)+COALESCE(clearance_cost,0) AS amt FROM factory_sea_costs WHERE factory_ref=? AND is_deleted=0 LIMIT 1`, [shipping_ref]);
    if (src && (existPaid + pa) > (src.amt||0)) {
      return res.status(422).json({ warning:'overpayment', message:`Total paid USD ${(existPaid+pa).toFixed(2)} would exceed SEA total payable USD ${(src.amt||0).toFixed(2)} for ${shipping_ref}`, total_payable:src.amt||0, existing_paid:existPaid, new_amount:pa });
    }
  }
  const { balance, status } = computeFactoryBalance(total_payable, pa);
  const ref = nextFactoryPaymentRef();
  run(`INSERT INTO factory_payments (payment_ref,entry_date,payment_date,factory_ref,factory_table,supplier_name,shipping_ref,bl_no,eta,shipping_cost,clearance_cost,total_amount,paid_amount,balance_amount,payment_type,payment_mode,payment_status,remarks,created_by,currency_code,currency_symbol)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'USD','USD')`,
    [ref, entry_date||new Date().toISOString().slice(0,10), payment_date||null,
     shipping_ref||null, 'sea_costs', supplier_name||null, shipping_ref||null,
     bl_no||null, eta||null, sc, cc, total_payable, pa, balance,
     payment_type||null, payment_mode||null, status, remarks||null,
     req.session.user.username]);
  syncFactorySource(shipping_ref, 'sea_costs');
  writeAuditLog({ action:'CREATE', module:'factory_payments_sea', recordRef:ref, details:{shipping_ref,paid_amount}, performedBy:req.session.user.username });
  res.json({ ok:true, payment_ref:ref });
});

router.patch('/factory/sea/:id', requireModule('accounts'), requireAccountsManager, sectionPatch('sea_costs'));
router.delete('/factory/sea/:id', requireModule('accounts'), requireRole('admin'), sectionDelete('sea_costs','factory_payments_sea'));

router.get('/factory/sea/export-excel', requireModule('accounts'), async (req, res) => {
  const rows = all(`SELECT * FROM factory_payments WHERE factory_table='sea_costs' AND is_deleted=0 ORDER BY entry_date DESC`);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('SEA Payments');
  const hdr = ws.addRow(['Payment Ref.','Entry Date','Payment Date','Shipping Ref.','BL No. & ETD','ETA',
    'Shipping Cost (USD)','Clearance Cost (USD)','Total Payable (USD)','Paid Amount (USD)','Balance (USD)',
    'Payment Type','Payment Mode','Payment Status','Supplier / Company','Remarks','Last Updated']);
  hdr.font={bold:true}; hdr.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFDDEEFF'}};
  for (const r of rows) {
    const row = ws.addRow([r.payment_ref,r.entry_date,r.payment_date,r.shipping_ref,r.bl_no,r.eta,
      r.shipping_cost,r.clearance_cost,r.total_amount,r.paid_amount,r.balance_amount,
      r.payment_type,r.payment_mode,r.payment_status,r.supplier_name,r.remarks,r.updated_at]);
    if (r.highlight_status==='green') row.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFD4EDDA'}};
    else if (r.highlight_status==='yellow') row.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF3CD'}};
    else if (r.highlight_status==='red') row.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF8D7DA'}};
  }
  ws.columns.forEach(c=>{c.width=18;});
  res.setHeader('Content-Disposition','attachment; filename="sea_payments.xlsx"');
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(await wb.xlsx.writeBuffer());
});

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY PAYMENT PDF  (shared, section-aware)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/factory/:section/:id/pdf', requireModule('accounts'), (req, res) => {
  const tableMap = { ins:'ins_quotes', otj:'otj_quotes', sea:'sea_costs' };
  const table = tableMap[req.params.section];
  if (!table) return res.status(404).json({ error: 'Unknown section' });
  const p = get(`SELECT * FROM factory_payments WHERE id=? AND is_deleted=0 AND factory_table=?`, [req.params.id, table]);
  if (!p) return res.status(404).json({ error: 'Payment not found' });

  const isSea = table === 'sea_costs';
  res.setHeader('Content-Disposition', `inline; filename="payment-advice-${p.payment_ref}.pdf"`);
  res.setHeader('Content-Type', 'application/pdf');
  const doc = new PDFDocument({ margin:50, size:'A4' });
  doc.pipe(res);

  let headerBottom = 50;
  try { const lw=130,lh=lw*LOGO_RATIO; doc.image(LOGO_PATH,50,50,{width:lw}); headerBottom=50+lh+8; } catch(_) {}
  doc.fontSize(9).fillColor('#555')
    .text('Sigma Height Elevators LLC',200,55,{align:'right'})
    .text('Dubai, UAE',200,67,{align:'right'})
    .text('Tel: +971-XX-XXXXXXX',200,79,{align:'right'});
  doc.y = Math.max(headerBottom,130);
  doc.moveTo(50,doc.y).lineTo(545,doc.y).strokeColor('#0f2a47').lineWidth(2).stroke();
  doc.y += 14;
  doc.fontSize(16).fillColor('#0f2a47').font('Helvetica-Bold').text('PAYMENT ADVICE',{align:'center'});
  doc.moveDown(0.4);
  doc.moveTo(50,doc.y).lineTo(545,doc.y).strokeColor('#dfe3e8').lineWidth(0.5).stroke();
  doc.moveDown(0.8);

  const leftX=50, rightX=310, rowH=22;
  const baseFields = [
    ['Payment Ref.', p.payment_ref],
    ['Entry Date', p.entry_date||''],
    ['Payment Date', p.payment_date||'—'],
  ];
  const sectionFields = isSea ? [
    ['Shipping Ref.', p.shipping_ref||'—'],
    ['BL No. & ETD', p.bl_no||'—'],
    ['ETA', p.eta||'—'],
    ['Supplier / Company', p.supplier_name||'—'],
  ] : [
    ['Our Ref.', p.our_ref||'—'],
    ['Factory Ref.', p.factory_ref||'—'],
    ['Supplier / Factory', p.supplier_name||'—'],
    ['Project / Client', p.project_client_name||'—'],
  ];
  const allFields = [...baseFields, ...sectionFields,
    ['Payment Type', p.payment_type||'—'],
    ['Payment Mode', p.payment_mode||'—'],
  ];

  doc.font('Helvetica').fontSize(10);
  let y = doc.y;
  for (const [label,value] of allFields) {
    doc.fillColor('#66758a').text(label,leftX,y,{width:210});
    doc.fillColor('#1f2a36').text(String(value),rightX,y,{width:230});
    y += rowH;
  }
  doc.y = y+8;
  doc.moveTo(50,doc.y).lineTo(545,doc.y).strokeColor('#dfe3e8').lineWidth(0.5).stroke();
  doc.y += 12;

  const amtFields = isSea ? [
    ['Shipping Cost (USD)', p.shipping_cost!=null?`$ ${Number(p.shipping_cost).toLocaleString('en-US',{minimumFractionDigits:2})}`:'—'],
    ['Clearance Cost (USD)', p.clearance_cost!=null?`$ ${Number(p.clearance_cost).toLocaleString('en-US',{minimumFractionDigits:2})}`:'—'],
    ['Total Payable (USD)', p.total_amount!=null?`$ ${Number(p.total_amount).toLocaleString('en-US',{minimumFractionDigits:2})}`:'—'],
    ['Paid Amount (USD)', p.paid_amount!=null?`$ ${Number(p.paid_amount).toLocaleString('en-US',{minimumFractionDigits:2})}`:'—'],
    ['Balance Amount (USD)', p.balance_amount!=null?`$ ${Number(p.balance_amount).toLocaleString('en-US',{minimumFractionDigits:2})}`:'—'],
  ] : [
    ['Total Amount (USD)', p.total_amount!=null?`$ ${Number(p.total_amount).toLocaleString('en-US',{minimumFractionDigits:2})}`:'—'],
    ['Paid Amount (USD)', p.paid_amount!=null?`$ ${Number(p.paid_amount).toLocaleString('en-US',{minimumFractionDigits:2})}`:'—'],
    ['Balance Amount (USD)', p.balance_amount!=null?`$ ${Number(p.balance_amount).toLocaleString('en-US',{minimumFractionDigits:2})}`:'—'],
  ];

  y = doc.y;
  for (let i=0;i<amtFields.length;i++) {
    const [label,value]=amtFields[i];
    const isBold=(i===amtFields.length-1);
    doc.fillColor('#66758a').font('Helvetica').fontSize(11).text(label,leftX,y,{width:250});
    doc.fillColor(isBold?'#c0392b':'#0f2a47').font('Helvetica-Bold').fontSize(isBold?13:11).text(value,rightX,y,{width:230});
    y += 26;
  }
  doc.y = y+8;
  doc.moveTo(50,doc.y).lineTo(545,doc.y).strokeColor('#dfe3e8').lineWidth(0.5).stroke();
  doc.y += 10;
  const statusColor={'Full Paid':'#1f7a5c','Partial Paid':'#d68910','Unpaid':'#c0392b','Overpaid':'#7e3ba8'};
  doc.fontSize(11).fillColor(statusColor[p.payment_status]||'#555').font('Helvetica-Bold')
    .text(`Payment Status: ${p.payment_status||'Unpaid'}`,{align:'center'});
  doc.moveDown(0.8);
  if (p.remarks) {
    doc.font('Helvetica').fontSize(9).fillColor('#66758a').text('Remarks:',leftX);
    doc.fontSize(10).fillColor('#1f2a36').text(p.remarks,leftX,doc.y,{width:495});
    doc.moveDown(0.8);
  }
  doc.fontSize(8).fillColor('#aaa').text(`Generated: ${new Date().toLocaleString()}`,50,760,{align:'center',width:495});
  doc.end();
});

// ═══════════════════════════════════════════════════════════════════════════
// CLIENT CONTRACT PAYMENTS  (unchanged)
// ═══════════════════════════════════════════════════════════════════════════

router.get('/client-payments', requireModule('accounts'), (req, res) => {
  const { search, contract_ref, client, payment_status, payment_type,
          date_from, date_to, sort='entry_date', dir='desc', page=1, pageSize=50 } = req.query;
  // Whitelisted sort columns — balance and status sort on the joined contracts columns (2026-09-21)
  const SORT_COLS = { entry_date:'p.entry_date', payment_ref:'p.payment_ref', contract_ref:'p.contract_ref', client_name:'p.client_name', contract_value:'p.contract_value', received_amount:'p.received_amount', total_received:'c.total_received', balance:'c.balance_amount', status:'c.payment_status', payment_type:'p.payment_type' };
  const col = SORT_COLS[sort]||'p.entry_date';
  const direction = dir==='asc'?'ASC':'DESC';
  const where=['p.is_deleted = 0']; const params=[];
  if (search) { where.push('(p.payment_ref LIKE ? OR p.contract_ref LIKE ? OR p.client_name LIKE ? OR p.project_name LIKE ?)'); params.push(`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`); }
  if (contract_ref) { where.push('p.contract_ref = ?'); params.push(contract_ref); }
  if (client) { where.push('p.client_name LIKE ?'); params.push(`%${client}%`); }
  if (payment_status) { where.push('(SELECT payment_status FROM contracts WHERE contract_ref=p.contract_ref) = ?'); params.push(payment_status); }
  if (payment_type) { where.push('p.payment_type = ?'); params.push(payment_type); }
  if (date_from) { where.push('p.entry_date >= ?'); params.push(date_from); }
  if (date_to) { where.push('p.entry_date <= ?'); params.push(date_to); }
  const wSql=where.length?`WHERE ${where.join(' AND ')}`:'';
  const total=(get(`SELECT COUNT(*) c FROM client_payments p ${wSql}`,params)||{}).c||0;
  const offset=(parseInt(page)-1)*parseInt(pageSize);
  const rows=all(`SELECT p.*, c.payment_status AS contract_payment_status, c.total_received, c.balance_amount AS contract_balance FROM client_payments p LEFT JOIN contracts c ON c.contract_ref=p.contract_ref AND c.is_deleted=0 ${wSql} ORDER BY ${col} ${direction} LIMIT ? OFFSET ?`,[...params,parseInt(pageSize),offset]);
  res.json({ rows, total, page:parseInt(page), pageSize:parseInt(pageSize) });
});

router.get('/client-payments/summary', requireModule('accounts'), (req, res) => {
  const r=get(`SELECT COALESCE(SUM(c.contract_value),0) AS total_receivable, COALESCE(SUM(c.total_received),0) AS total_received, COALESCE(SUM(c.balance_amount),0) AS total_balance FROM contracts c WHERE c.is_deleted=0`);
  res.json(r||{total_receivable:0,total_received:0,total_balance:0});
});

router.post('/client-payments', requireModule('accounts'), requireAccountsManager, (req, res) => {
  const { contract_ref, client_name, project_name, contract_value, received_amount, payment_type, payment_mode, received_by, remarks, entry_date } = req.body;
  if (!contract_ref) return res.status(400).json({ error: 'contract_ref is required' });
  if (!received_amount||isNaN(received_amount)) return res.status(400).json({ error: 'received_amount is required' });
  const c=get(`SELECT id,contract_ref,contract_value,total_received FROM contracts WHERE contract_ref=? AND is_deleted=0`,[contract_ref]);
  if (!c) return res.status(404).json({ error: `Contract Ref. "${contract_ref}" not found` });
  // Overpayment check
  if (!req.body.force_overpay) {
    const ra = parseFloat(received_amount)||0;
    const existPaid = c.total_received||0;
    const cv = c.contract_value||0;
    if (cv > 0 && (existPaid + ra) > cv) {
      return res.status(422).json({ warning:'overpayment', message:`Total received AED ${(existPaid+ra).toFixed(2)} would exceed contract value AED ${cv.toFixed(2)} for ${contract_ref}`, contract_value:cv, existing_received:existPaid, new_amount:ra });
    }
  }
  const payment_ref=nextClientPaymentRef();
  run(`INSERT INTO client_payments (payment_ref,entry_date,contract_ref,client_name,project_name,contract_value,received_amount,payment_type,payment_mode,received_by,remarks,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [payment_ref,entry_date||new Date().toISOString().slice(0,10),contract_ref,client_name||null,project_name||null,contract_value||null,parseFloat(received_amount),payment_type||null,payment_mode||null,received_by||null,remarks||null,req.session.user.username]);
  syncContractPayments(contract_ref);
  writeAuditLog({ action:'CREATE', module:'client_payments', recordRef:payment_ref, details:{contract_ref,received_amount}, performedBy:req.session.user.username });
  res.json({ ok:true, payment_ref });
});

router.patch('/client-payments/:id', requireModule('accounts'), requireAccountsManager, (req, res) => {
  const p=get(`SELECT * FROM client_payments WHERE id=? AND is_deleted=0`,[req.params.id]);
  if (!p) return res.status(404).json({ error: 'Payment not found' });
  const { received_amount, payment_type, payment_mode, received_by, remarks, entry_date, client_name, project_name, contract_value } = req.body;
  run(`UPDATE client_payments SET entry_date=COALESCE(?,entry_date),client_name=COALESCE(?,client_name),project_name=COALESCE(?,project_name),contract_value=COALESCE(?,contract_value),received_amount=COALESCE(?,received_amount),payment_type=COALESCE(?,payment_type),payment_mode=COALESCE(?,payment_mode),received_by=COALESCE(?,received_by),remarks=COALESCE(?,remarks),updated_at=datetime('now') WHERE id=?`,
    [entry_date||null,client_name||null,project_name||null,contract_value||null,received_amount!=null?parseFloat(received_amount):null,payment_type||null,payment_mode||null,received_by||null,remarks||null,req.params.id]);
  syncContractPayments(p.contract_ref);
  res.json({ ok:true });
});

router.delete('/client-payments/:id', requireModule('accounts'), requireRole('admin'), (req, res) => {
  const p=get(`SELECT * FROM client_payments WHERE id=? AND is_deleted=0`,[req.params.id]);
  if (!p) return res.status(404).json({ error: 'Payment not found' });
  run(`UPDATE client_payments SET is_deleted=1,updated_at=datetime('now') WHERE id=?`,[req.params.id]);
  syncContractPayments(p.contract_ref);
  writeAuditLog({ action:'DELETE', module:'client_payments', recordRef:p.payment_ref, details:{contract_ref:p.contract_ref,received_amount:p.received_amount}, performedBy:req.session.user.username });
  res.json({ ok:true });
});

router.get('/client-payments/export-excel', requireModule('accounts'), async (req, res) => {
  // Honour same sort/dir params as the list endpoint so export matches on-screen order (2026-09-21)
  const { sort='entry_date', dir='desc', search, contract_ref, client, payment_status, payment_type, date_from, date_to } = req.query;
  const EXPORT_SORT_COLS = { entry_date:'p.entry_date', payment_ref:'p.payment_ref', contract_ref:'p.contract_ref', client_name:'p.client_name', contract_value:'p.contract_value', received_amount:'p.received_amount', total_received:'c.total_received', balance:'c.balance_amount', status:'c.payment_status', payment_type:'p.payment_type' };
  const exportCol = EXPORT_SORT_COLS[sort] || 'p.entry_date';
  const exportDir = dir === 'asc' ? 'ASC' : 'DESC';
  const where=['p.is_deleted = 0']; const params=[];
  if (search) { where.push('(p.payment_ref LIKE ? OR p.contract_ref LIKE ? OR p.client_name LIKE ? OR p.project_name LIKE ?)'); params.push(`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`); }
  if (contract_ref) { where.push('p.contract_ref = ?'); params.push(contract_ref); }
  if (client) { where.push('p.client_name LIKE ?'); params.push(`%${client}%`); }
  if (payment_status) { where.push('(SELECT payment_status FROM contracts WHERE contract_ref=p.contract_ref) = ?'); params.push(payment_status); }
  if (payment_type) { where.push('p.payment_type = ?'); params.push(payment_type); }
  if (date_from) { where.push('p.entry_date >= ?'); params.push(date_from); }
  if (date_to) { where.push('p.entry_date <= ?'); params.push(date_to); }
  const wSql=where.length?`WHERE ${where.join(' AND ')}`:'';
  const rows=all(`SELECT p.payment_ref,p.entry_date,p.contract_ref,p.client_name,p.project_name,p.contract_value,p.received_amount,p.payment_type,p.payment_mode,p.received_by,c.total_received,c.balance_amount,c.payment_status,p.remarks FROM client_payments p LEFT JOIN contracts c ON c.contract_ref=p.contract_ref AND c.is_deleted=0 ${wSql} ORDER BY ${exportCol} ${exportDir}`, params);
  const wb=new ExcelJS.Workbook(); const ws=wb.addWorksheet('Client Payments');
  const hdr=ws.addRow(['Payment Ref.','Entry Date','Contract Ref.','Client Name','Project Name','Contract Value','Received Amount','Payment Type','Payment Mode','Received By','Total Received','Balance Amount','Payment Status','Remarks']);
  hdr.font={bold:true}; hdr.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFDDEEFF'}};
  for (const r of rows) ws.addRow([r.payment_ref,r.entry_date,r.contract_ref,r.client_name,r.project_name,r.contract_value,r.received_amount,r.payment_type,r.payment_mode,r.received_by,r.total_received,r.balance_amount,r.payment_status,r.remarks]);
  ws.columns.forEach(c=>{c.width=18;});
  res.setHeader('Content-Disposition','attachment; filename="client_payments.xlsx"');
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(await wb.xlsx.writeBuffer());
});

// ── Backward-compat combined factory-payments GET (used by dashboard) ─────────
router.get('/factory-payments/summary', requireModule('accounts'), (req, res) => {
  const r=get(`SELECT COALESCE(SUM(total_amount),0) AS total_payable, COALESCE(SUM(paid_amount),0) AS total_paid, COALESCE(SUM(balance_amount),0) AS total_balance FROM factory_payments WHERE is_deleted=0`);
  res.json(r||{total_payable:0,total_paid:0,total_balance:0});
});

// ── Dashboard summary ─────────────────────────────────────────────────────────
router.get('/dashboard-summary', requireModule('accounts'), (req, res) => {
  const cp=get(`SELECT COALESCE(SUM(c.contract_value),0) AS total_receivable, COALESCE(SUM(c.total_received),0) AS total_received, COALESCE(SUM(c.balance_amount),0) AS total_balance FROM contracts c WHERE c.is_deleted=0`)||{};
  const ins=get(`SELECT COALESCE(SUM(total_amount),0) AS total_payable, COALESCE(SUM(paid_amount),0) AS total_paid, COALESCE(SUM(balance_amount),0) AS total_balance FROM factory_payments WHERE is_deleted=0 AND factory_table='ins_quotes'`)||{};
  const otj=get(`SELECT COALESCE(SUM(total_amount),0) AS total_payable, COALESCE(SUM(paid_amount),0) AS total_paid, COALESCE(SUM(balance_amount),0) AS total_balance FROM factory_payments WHERE is_deleted=0 AND factory_table='otj_quotes'`)||{};
  const sea=get(`SELECT COALESCE(SUM(total_amount),0) AS total_payable, COALESCE(SUM(paid_amount),0) AS total_paid, COALESCE(SUM(balance_amount),0) AS total_balance FROM factory_payments WHERE is_deleted=0 AND factory_table='sea_costs'`)||{};
  const fp_total_payable=(ins.total_payable||0)+(otj.total_payable||0)+(sea.total_payable||0);
  const fp_total_paid=(ins.total_paid||0)+(otj.total_paid||0)+(sea.total_paid||0);
  const fp_total_balance=(ins.total_balance||0)+(otj.total_balance||0)+(sea.total_balance||0);
  res.json({
    client:{ total_receivable:cp.total_receivable||0, total_received:cp.total_received||0, total_balance:cp.total_balance||0 },
    factory:{ total_payable:fp_total_payable, total_paid:fp_total_paid, total_balance:fp_total_balance,
      ins:{ total_payable:ins.total_payable||0, total_paid:ins.total_paid||0, total_balance:ins.total_balance||0 },
      otj:{ total_payable:otj.total_payable||0, total_paid:otj.total_paid||0, total_balance:otj.total_balance||0 },
      sea:{ total_payable:sea.total_payable||0, total_paid:sea.total_paid||0, total_balance:sea.total_balance||0 },
    },
  });
});

// ── Contract lookup ────────────────────────────────────────────────────────────
router.get('/contract-lookup', requireModule('accounts'), (req, res) => {
  const q=req.query.q||'';
  res.json({ rows: all(`SELECT contract_ref,client_name,project_description,contract_value,payment_status,total_received,balance_amount FROM contracts WHERE is_deleted=0 AND (contract_ref LIKE ? OR client_name LIKE ?) ORDER BY contract_ref LIMIT 20`,[`%${q}%`,`%${q}%`]) });
});

// ── Factory ref lookup (section-filtered) ────────────────────────────────────
router.get('/factory-lookup', requireModule('accounts'), (req, res) => {
  const q=req.query.q||''; const table=req.query.table||''; const like=`%${q}%`;
  let rows=[];
  if (!table||table==='sea_costs') {
    rows=[...rows,...all(`SELECT factory_ref AS ref, our_ref, supplier_name, client_name, sea_cost AS amount, clearance_cost, bl_no, 'sea_costs' AS tbl FROM factory_sea_costs WHERE is_deleted=0 AND (factory_ref LIKE ? OR supplier_name LIKE ?) LIMIT 15`,[like,like])];
  }
  if (!table||table==='otj_quotes') {
    rows=[...rows,...all(`SELECT factory_ref AS ref, our_ref, supplier_name, client_name, other_job_cost AS amount, NULL AS clearance_cost, NULL AS bl_no, 'otj_quotes' AS tbl FROM factory_otj_quotes WHERE is_deleted=0 AND (factory_ref LIKE ? OR supplier_name LIKE ?) LIMIT 15`,[like,like])];
  }
  if (!table||table==='ins_quotes') {
    rows=[...rows,...all(`SELECT factory_ref AS ref, contract_ref AS our_ref, supplier_name, client_name, factory_quote_amount AS amount, NULL AS clearance_cost, NULL AS bl_no, 'ins_quotes' AS tbl FROM factory_ins_quotes WHERE is_deleted=0 AND (factory_ref LIKE ? OR supplier_name LIKE ?) LIMIT 15`,[like,like])];
  }
  res.json({ rows: rows.slice(0,25) });
});


// ── Factory source-record lookups with computed payment totals ────────────────
// Used by the new-payment selection modal for each sub-section.

router.get('/factory/ins-records', requireModule('accounts'), (req, res) => {
  const q = req.query.q || '';
  const like = '%' + q + '%';
  try {
    const rows = all(`
      SELECT
        fiq.id, fiq.factory_ref,
        fiq.contract_ref AS our_ref,
        fiq.supplier_name,
        COALESCE(fiq.client_name, c.client_name, '') AS client_name,
        COALESCE(fiq.project_description, c.project_description, '') AS project_description,
        COALESCE(fiq.factory_quote_amount,0) AS total_amount,
        COALESCE(SUM(CASE WHEN fp.is_deleted=0 THEN fp.paid_amount ELSE 0 END),0) AS total_paid,
        ROUND(COALESCE(fiq.factory_quote_amount,0) -
          COALESCE(SUM(CASE WHEN fp.is_deleted=0 THEN fp.paid_amount ELSE 0 END),0),2) AS balance
      FROM factory_ins_quotes fiq
      LEFT JOIN contracts c ON c.contract_ref=fiq.contract_ref AND c.is_deleted=0
      LEFT JOIN factory_payments fp
        ON fp.factory_ref=fiq.factory_ref AND fp.factory_table='ins_quotes'
      WHERE fiq.is_deleted=0
        AND (fiq.factory_ref LIKE ? OR fiq.supplier_name LIKE ? OR fiq.contract_ref LIKE ?)
      GROUP BY fiq.id, fiq.factory_ref, fiq.contract_ref, fiq.supplier_name,
               fiq.client_name, fiq.project_description, c.client_name, c.project_description,
               fiq.factory_quote_amount
      ORDER BY fiq.factory_ref
      LIMIT 500
    `, [like, like, like]);
    const withStatus = rows.map(r => {
      const { status } = computeFactoryBalance(r.total_amount, r.total_paid);
      return { ...r, payment_status: status };
    });
    res.json({ rows: withStatus });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/factory/otj-records', requireModule('accounts'), (req, res) => {
  const q = req.query.q || '';
  const like = '%' + q + '%';
  try {
    const rows = all(`
      SELECT
        foq.id, foq.factory_ref, foq.our_ref,
        foq.supplier_name,
        COALESCE(foq.client_name,'') AS client_name,
        COALESCE(foq.project_description,'') AS project_description,
        COALESCE(foq.other_job_cost,0) AS total_amount,
        COALESCE(SUM(CASE WHEN fp.is_deleted=0 THEN fp.paid_amount ELSE 0 END),0) AS total_paid,
        ROUND(COALESCE(foq.other_job_cost,0) -
          COALESCE(SUM(CASE WHEN fp.is_deleted=0 THEN fp.paid_amount ELSE 0 END),0),2) AS balance
      FROM factory_otj_quotes foq
      LEFT JOIN factory_payments fp
        ON fp.factory_ref=foq.factory_ref AND fp.factory_table='otj_quotes'
      WHERE foq.is_deleted=0
        AND (foq.factory_ref LIKE ? OR foq.supplier_name LIKE ? OR foq.our_ref LIKE ?)
      GROUP BY foq.id, foq.factory_ref, foq.our_ref, foq.supplier_name,
               foq.client_name, foq.project_description, foq.other_job_cost
      ORDER BY foq.factory_ref
      LIMIT 500
    `, [like, like, like]);
    const withStatus = rows.map(r => {
      const { status } = computeFactoryBalance(r.total_amount, r.total_paid);
      return { ...r, payment_status: status };
    });
    res.json({ rows: withStatus });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/factory/sea-records', requireModule('accounts'), (req, res) => {
  const q = req.query.q || '';
  const like = '%' + q + '%';
  try {
    const rows = all(`
      SELECT
        fsc.id, fsc.factory_ref AS shipping_ref, fsc.our_ref,
        fsc.supplier_name,
        COALESCE(fsc.client_name,'') AS client_name,
        COALESCE(fsc.project_description,'') AS project_description,
        COALESCE(fsc.sea_cost,0) AS shipping_cost,
        COALESCE(fsc.clearance_cost,0) AS clearance_cost,
        COALESCE(fsc.sea_cost,0) + COALESCE(fsc.clearance_cost,0) AS total_amount,
        COALESCE(fsc.bl_no,'') AS bl_no,
        COALESCE(SUM(CASE WHEN fp.is_deleted=0 THEN fp.paid_amount ELSE 0 END),0) AS total_paid,
        ROUND((COALESCE(fsc.sea_cost,0) + COALESCE(fsc.clearance_cost,0)) -
          COALESCE(SUM(CASE WHEN fp.is_deleted=0 THEN fp.paid_amount ELSE 0 END),0),2) AS balance
      FROM factory_sea_costs fsc
      LEFT JOIN factory_payments fp
        ON fp.factory_ref=fsc.factory_ref AND fp.factory_table='sea_costs'
      WHERE fsc.is_deleted=0
        AND (fsc.factory_ref LIKE ? OR fsc.supplier_name LIKE ? OR fsc.our_ref LIKE ?)
      GROUP BY fsc.id, fsc.factory_ref, fsc.our_ref, fsc.supplier_name,
               fsc.client_name, fsc.project_description, fsc.sea_cost, fsc.clearance_cost, fsc.bl_no
      ORDER BY fsc.factory_ref
      LIMIT 500
    `, [like, like, like]);
    const withStatus = rows.map(r => {
      const { status } = computeFactoryBalance(r.total_amount, r.total_paid);
      return { ...r, payment_status: status };
    });
    res.json({ rows: withStatus });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Factory payment history (for Factory & Suppliers module) ─────────────────
// Returns all payments for a given factory_ref + factory_table combination
router.get('/factory/history', requireModule('accounts'), (req, res) => {
  const { factory_ref, factory_table, shipping_ref } = req.query;
  const ref = factory_ref || shipping_ref;
  if (!ref) return res.status(400).json({ error: 'factory_ref or shipping_ref required' });
  const table = factory_table || 'ins_quotes';
  const rows = all(`SELECT payment_ref, payment_date, entry_date, paid_amount, payment_type, payment_mode, payment_status, balance_amount, remarks, created_by FROM factory_payments WHERE factory_ref=? AND factory_table=? AND is_deleted=0 ORDER BY payment_date DESC, entry_date DESC`, [ref, table]);
  const summary = get(`SELECT COALESCE(SUM(paid_amount),0) AS total_paid, COUNT(*) AS count FROM factory_payments WHERE factory_ref=? AND factory_table=? AND is_deleted=0`, [ref, table]) || {};
  res.json({ rows, total_paid: summary.total_paid||0, count: summary.count||0 });
});

// ── Contract payment history (for Contracts module) ───────────────────────────
router.get('/client-payments/history', requireModule('accounts'), (req, res) => {
  const { contract_ref } = req.query;
  if (!contract_ref) return res.status(400).json({ error: 'contract_ref required' });
  const rows = all(`SELECT payment_ref, entry_date, received_amount, payment_type, payment_mode, received_by, remarks, created_by FROM client_payments WHERE contract_ref=? AND is_deleted=0 ORDER BY entry_date DESC`, [contract_ref]);
  const summary = get(`SELECT COALESCE(SUM(received_amount),0) AS total_received, COUNT(*) AS count FROM client_payments WHERE contract_ref=? AND is_deleted=0`, [contract_ref]) || {};
  res.json({ rows, total_received: summary.total_received||0, count: summary.count||0 });
});

// ═══════════════════════════════════════════════════════════════════════════
// CLIENT CONTRACT PAYMENT RECONCILIATION
// ═══════════════════════════════════════════════════════════════════════════

// ── Excel parser ──────────────────────────────────────────────────────────────
async function _parseReconcileExcel(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('No worksheets found in Excel file');

  // Scan first 8 rows to find the header row (handles title rows / blank rows before headers)
  const cols = {};
  let headerRowNum = null;
  for (let rn = 1; rn <= 8; rn++) {
    const row = ws.getRow(rn);
    const tmp = {};
    row.eachCell((cell, c) => {
      const v = (cell.value || '').toString().toLowerCase().replace(/\s+/g, ' ').trim();
      if (v.includes('contract ref'))          tmp.contract_ref       = c;
      if (v.includes('company') || v === 'client' || v.includes('client name')) tmp.client_name = c;
      if (v.includes('contract value'))        tmp.contract_value     = c;
      if (v.includes('received in total') || (v.includes('received') && !v.includes('balance') && !v.includes('receivable'))) tmp.received_total = c;
      if (v.includes('balance receivable') || v === 'balance') tmp.balance_receivable = c;
    });
    if (tmp.contract_ref && tmp.received_total) {
      Object.assign(cols, tmp);
      headerRowNum = rn;
      break;
    }
  }

  if (!headerRowNum)        throw new Error('Cannot find header row in Excel (scanned first 8 rows). Expected columns: "Contract Ref." and "Received in Total".');
  if (!cols.contract_ref)   throw new Error('Cannot find "Contract Ref." column');
  if (!cols.received_total) throw new Error('Cannot find "Received in Total" column');

  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum <= headerRowNum) return;
    const rawRef = row.getCell(cols.contract_ref).value;
    if (!rawRef) return;
    const refStr = rawRef.toString().trim();
    if (!refStr || /^(contract ref|total|s\.no|sno)/i.test(refStr)) return;

    const recvRaw = row.getCell(cols.received_total).value;
    const cvRaw   = cols.contract_value      ? row.getCell(cols.contract_value).value      : null;
    const balRaw  = cols.balance_receivable  ? row.getCell(cols.balance_receivable).value  : null;
    const cliRaw  = cols.client_name         ? row.getCell(cols.client_name).value         : null;

    rows.push({
      contract_ref_raw:  refStr,
      client_name:       cliRaw  != null ? String(cliRaw).trim()   : null,
      contract_value:    cvRaw   != null && cvRaw  !== '' ? parseFloat(cvRaw)  : null,
      received_total:    recvRaw != null && recvRaw !== '' ? parseFloat(recvRaw) : null,
      balance_receivable:balRaw  != null && balRaw  !== '' ? parseFloat(balRaw)  : null,
    });
  });

  return rows;
}

// ── Preview builder (pure, no DB writes) ─────────────────────────────────────
function _buildReconcilePreview(rows) {
  const items = [];
  const seen  = new Set();

  for (const row of rows) {
    const rawRef = row.contract_ref_raw ? row.contract_ref_raw.trim() : '';
    if (!rawRef) continue;

    // ── STEP 1: Try the combined ref exactly as it appears in the contracts table ──
    // Many contracts are stored as "SH-235, SH-236, SH-237" — a single combined row.
    // Attempt an exact lookup before splitting so we process them as one billing entity.
    if (!seen.has(rawRef)) {
      const combinedContract = get(
        `SELECT contract_ref, client_name, project_description, contract_value,
                total_received, balance_amount, payment_status
         FROM contracts WHERE contract_ref=? AND is_deleted=0`, [rawRef]);

      if (combinedContract) {
        seen.add(rawRef);

        const srcRecv = row.received_total;
        if (srcRecv === null || isNaN(srcRecv)) {
          items.push({ status: 'incomplete_source', contract_ref: rawRef,
            client_name: combinedContract.client_name, message: 'No received total in source' });
          continue;
        }

        const existRecv  = combinedContract.total_received || 0;
        const cvSystem   = combinedContract.contract_value || 0;
        const cvSource   = row.contract_value;
        const cvFlag = cvSource !== null && !isNaN(cvSource) && Math.abs(cvSource - cvSystem) > 0.5
          ? { source: cvSource, system: cvSystem, diff: Math.round((cvSource - cvSystem)*100)/100 }
          : null;
        const expBal   = cvSystem - srcRecv;
        const srcBal   = row.balance_receivable;
        const balDisc  = srcBal !== null && !isNaN(srcBal) && Math.abs(srcBal - expBal) > 0.5
          ? { expected: Math.round(expBal*100)/100, source: Math.round(srcBal*100)/100 }
          : null;
        const diff   = Math.round((srcRecv - existRecv) * 100) / 100;
        const adjAmt = diff > 0 ? diff : 0;
        const newBal = Math.round((cvSystem - existRecv - adjAmt) * 100) / 100;
        const base = {
          contract_ref: rawRef,
          client_name: combinedContract.client_name || row.client_name,
          contract_value_system: cvSystem, contract_value_source: cvSource,
          contract_value_flag: cvFlag,
          existing_received: existRecv, source_received: srcRecv,
          existing_balance: combinedContract.balance_amount, new_balance: newBal,
          balance_discrepancy: balDisc,
        };

        if (diff > 0.5) {
          items.push({ ...base, status: 'new_payment_required', adjustment_amount: diff });
        } else if (Math.abs(diff) <= 0.5) {
          items.push({ ...base, status: 'already_up_to_date' });
        } else {
          items.push({ ...base, status: 'system_higher', diff,
            message: `System AED ${existRecv.toFixed(2)} > Source AED ${srcRecv.toFixed(2)}` });
        }
        continue; // handled — skip individual-ref splitting
      }
    }

    // ── STEP 2: No combined-ref row found — split and process individual refs ──
    const refs = rawRef
      .split(/[,;\/\n\r]+/)
      .map(r => r.trim())
      .filter(r => /^[A-Za-z0-9\-]+$/.test(r));

    if (!refs.length) continue;
    const isGrouped = refs.length > 1;

    for (const ref of refs) {
      if (seen.has(ref)) continue;
      seen.add(ref);

      const contract = get(
        `SELECT contract_ref, client_name, project_description, contract_value,
                total_received, balance_amount, payment_status
         FROM contracts WHERE contract_ref=? AND is_deleted=0`, [ref]);

      if (!contract) {
        items.push({ status: 'missing_contract', contract_ref: ref,
          client_name_source: row.client_name, source_received: row.received_total });
        continue;
      }

      const srcRecv = row.received_total;
      if (srcRecv === null || isNaN(srcRecv)) {
        items.push({ status: 'incomplete_source', contract_ref: ref,
          client_name: contract.client_name, message: 'No received total in source' });
        continue;
      }

      if (isGrouped) {
        // Individual components found but no combined row — flag for manual review
        items.push({ status: 'grouped_ref', contract_ref: ref, grouped_refs: refs,
          client_name: contract.client_name, source_received: srcRecv,
          existing_received: contract.total_received || 0,
          message: `Grouped ref (${refs.join(', ')}) — manual allocation required` });
        continue;
      }

      const existRecv    = contract.total_received   || 0;
      const cvSystem     = contract.contract_value    || 0;
      const cvSource     = row.contract_value;

      const cvFlag = cvSource !== null && !isNaN(cvSource) && Math.abs(cvSource - cvSystem) > 0.5
        ? { source: cvSource, system: cvSystem, diff: Math.round((cvSource - cvSystem)*100)/100 }
        : null;

      const expBal   = cvSystem - srcRecv;
      const srcBal   = row.balance_receivable;
      const balDisc  = srcBal !== null && !isNaN(srcBal) && Math.abs(srcBal - expBal) > 0.5
        ? { expected: Math.round(expBal*100)/100, source: Math.round(srcBal*100)/100 }
        : null;

      const diff     = Math.round((srcRecv - existRecv) * 100) / 100;
      const adjAmt   = diff > 0 ? diff : 0;
      const newBal   = Math.round((cvSystem - existRecv - adjAmt) * 100) / 100;

      const base = {
        contract_ref: ref,
        client_name: contract.client_name || row.client_name,
        contract_value_system: cvSystem, contract_value_source: cvSource,
        contract_value_flag: cvFlag,
        existing_received: existRecv, source_received: srcRecv,
        existing_balance: contract.balance_amount, new_balance: newBal,
        balance_discrepancy: balDisc,
      };

      if (diff > 0.5) {
        items.push({ ...base, status: 'new_payment_required', adjustment_amount: diff });
      } else if (Math.abs(diff) <= 0.5) {
        items.push({ ...base, status: 'already_up_to_date' });
      } else {
        items.push({ ...base, status: 'system_higher', diff,
          message: `System AED ${existRecv.toFixed(2)} > Source AED ${srcRecv.toFixed(2)}` });
      }
    }
  }

  const cnt = s => items.filter(i => i.status === s).length;
  return {
    items,
    summary: {
      total_source_rows:      rows.length,
      new_payment_required:   cnt('new_payment_required'),
      already_up_to_date:     cnt('already_up_to_date'),
      system_higher:          cnt('system_higher'),
      missing_contract:       cnt('missing_contract'),
      grouped_ref:            cnt('grouped_ref'),
      incomplete_source:      cnt('incomplete_source'),
      total_adjustment:       Math.round(
        items.filter(i => i.status === 'new_payment_required')
             .reduce((s, i) => s + (i.adjustment_amount || 0), 0) * 100) / 100,
    },
  };
}

// ── Markdown payment report parser ───────────────────────────────────────────
// Parses "Full Payment Contract Updates.md" Markdown table format.
// Handles two sections: main table (SH-001…SH-264) and Sheet1 (compact refs).
function _normalizeSheet1Ref(ref) {
  // "SH21-22" → "SH-021, SH-022"  (range notation)
  const rangeMatch = ref.match(/^SH(\d+)-(\d+)$/i);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end   = parseInt(rangeMatch[2], 10);
    const out   = [];
    for (let i = start; i <= end && out.length <= 20; i++) {
      out.push('SH-' + String(i).padStart(3, '0'));
    }
    return out.join(', ');
  }
  // "SH12" → "SH-012"  (no dash, no zero-pad)
  const single = ref.match(/^SH(\d+)$/i);
  if (single) return 'SH-' + single[1].padStart(3, '0');
  return ref;
}

function _parseReconcileMd(mdText) {
  const lines = mdText.split('\n');
  const rows  = [];
  let headerFound = false;
  let inSheet1    = false;
  let cols = {};   // field → column index (0-based, after pipe split)

  for (const raw of lines) {
    const line = raw.trim();

    // Section headers: detect ## Sheet1 boundary
    if (line.startsWith('## ') || line.startsWith('# ')) {
      if (/sheet\s*1/i.test(line)) {
        inSheet1    = true;
        headerFound = false;
        cols        = {};
      }
      continue;
    }

    if (!line.startsWith('|')) continue;
    // Skip separator rows (| --- | --- |)
    if (/^\|[\s|\-:]+\|$/.test(line)) continue;

    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (!cells.length) continue;

    if (!headerFound) {
      const lower = cells.map(c => c.toLowerCase().replace(/\s+/g, ' ').replace(/\./g, ''));
      const refIdx  = lower.findIndex(c => c.includes('contract ref') || c === 'cont ref' || c === 'cont ref');
      const recvIdx = lower.findIndex(c => c.includes('received in total'));
      if (refIdx >= 0 && recvIdx >= 0) {
        cols.contract_ref       = refIdx;
        cols.client_name        = lower.findIndex(c => c.includes('client name') || c === 'company' || c === 'client');
        cols.contract_value     = lower.findIndex(c => c.includes('contract value'));
        cols.received_total     = recvIdx;
        cols.balance_receivable = lower.findIndex(c => c.includes('balance receivable') || c === 'balance');
        headerFound = true;
      }
      continue;
    }

    // Data row
    const refRaw = (cells[cols.contract_ref] || '').trim();
    if (!refRaw || /^(s\.?no|total|#)/i.test(refRaw)) continue;

    const toNum = v => {
      if (!v || !String(v).trim() || String(v).trim() === '-') return null;
      const n = parseFloat(String(v).replace(/[,\s]/g, ''));
      return isNaN(n) ? null : n;
    };

    // Normalize Sheet1 compact refs
    const contractRefRaw = inSheet1 ? _normalizeSheet1Ref(refRaw) : refRaw;

    rows.push({
      contract_ref_raw:  contractRefRaw,
      client_name:       cols.client_name >= 0 ? (cells[cols.client_name] || '').trim() || null : null,
      contract_value:    cols.contract_value >= 0     ? toNum(cells[cols.contract_value])     : null,
      received_total:    toNum(cells[cols.received_total]),
      balance_receivable:cols.balance_receivable >= 0 ? toNum(cells[cols.balance_receivable]) : null,
    });
  }

  return rows;
}

// ── POST /client-payments/reconcile-md-preview  (Markdown payment report) ─────
router.post('/client-payments/reconcile-md-preview',
  requireModule('accounts'), requireAccountsManager,
  _multerSingle('file'),
  (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const mdText = req.file.buffer.toString('utf-8');
      const rows = _parseReconcileMd(mdText);
      if (!rows.length) {
        return res.status(400).json({
          error: 'No data rows found in Markdown file. Expected a table with "Contract Ref." and "Received in Total" columns.',
        });
      }
      const preview = _buildReconcilePreview(rows);
      preview.source_file = req.file.originalname;
      res.json(preview);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// ── POST /client-payments/reconcile-preview  (dry-run, no DB writes) ─────────
router.post('/client-payments/reconcile-preview',
  requireModule('accounts'), requireAccountsManager,
  _multerSingle('file'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const rows = await _parseReconcileExcel(req.file.buffer);
      if (!rows.length) return res.status(400).json({ error: 'No data rows found in Excel file' });
      const preview = _buildReconcilePreview(rows);
      preview.source_file = req.file.originalname;
      res.json(preview);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// ── POST /client-payments/reconcile-commit  (transactional write) ─────────────
router.post('/client-payments/reconcile-commit',
  requireModule('accounts'), requireAccountsManager,
  async (req, res) => {
    try {
    const { batch_id, adjustments, source_file } = req.body;
    if (!batch_id)                 return res.status(400).json({ error: 'batch_id is required' });
    if (!adjustments?.length)      return res.status(400).json({ error: 'No adjustments to commit' });

    const username     = req.session.user.username;
    const reconDate    = new Date().toISOString().slice(0, 10);
    const _d = new Date();
    const _months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const reconDateLabel = `${String(_d.getDate()).padStart(2,'0')}-${_months[_d.getMonth()]}-${_d.getFullYear()}`;
    const remarksBase  = `Payment reconciliation — Batch: ${batch_id}. Source: ${source_file || 'unknown'}. Date: ${reconDateLabel}.`;

    // ── Idempotency guard ───────────────────────────────────────────────────
    const already = (get(`SELECT COUNT(*) AS c FROM client_payments WHERE reconcile_batch_id=? AND is_deleted=0`, [batch_id]) || {}).c || 0;
    if (already > 0) {
      return res.status(409).json({
        error: `Batch "${batch_id}" has already been committed (${already} payment(s) exist). Re-running is not allowed to prevent duplicates.`,
      });
    }

    // ── Pre-reconciliation backup ───────────────────────────────────────────
    let backupFile = null;
    try {
      const safeLabel = batch_id.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase().slice(0, 48);
      const bk = await createBackup(`pre-reconcile-${safeLabel}`);
      backupFile = bk.fileName;
    } catch (e) {
      console.warn('[reconcile] Backup warning (non-fatal):', e.message);
    }

    const committed = [];
    const failed    = [];

    // ── Transactional commit ────────────────────────────────────────────────
    try {
      db.exec('BEGIN IMMEDIATE');
    } catch (e) {
      return res.status(500).json({ error: `Could not start database transaction: ${e.message}` });
    }

    try {
      for (const adj of adjustments) {
        const { contract_ref, source_received } = adj;
        if (!contract_ref) { failed.push({ contract_ref: '?', reason: 'Missing contract_ref' }); continue; }

        // Re-validate live data (guards against state changes since preview)
        const contract = get(
          `SELECT contract_ref, client_name, project_description, contract_value,
                  total_received, balance_amount
           FROM contracts WHERE contract_ref=? AND is_deleted=0`, [contract_ref]);
        if (!contract) { failed.push({ contract_ref, reason: 'Contract not found in SH-PMS' }); continue; }

        const existRecv  = contract.total_received || 0;
        const liveAdj    = Math.round((parseFloat(source_received) - existRecv) * 100) / 100;
        if (liveAdj <= 0.5) {
          failed.push({ contract_ref, reason: `No adjustment needed — system already at AED ${existRecv.toFixed(2)}` });
          continue;
        }

        // Per-contract idempotency within this batch
        const dupRow = get(`SELECT id FROM client_payments WHERE reconcile_batch_id=? AND contract_ref=? AND is_deleted=0`, [batch_id, contract_ref]);
        if (dupRow) { failed.push({ contract_ref, reason: 'Already committed in this batch' }); continue; }

        const pRef = nextClientPaymentRef();
        run(`INSERT INTO client_payments
               (payment_ref, entry_date, contract_ref, client_name, project_name,
                contract_value, received_amount, payment_type, payment_mode,
                received_by, remarks, created_by, reconcile_batch_id)
             VALUES (?,?,?,?,?,?,?,'Reconciliation Adjustment',NULL,?,?,?,?)`,
          [pRef, reconDate, contract_ref,
           contract.client_name || null,
           contract.project_description || null,
           contract.contract_value || null,
           liveAdj,
           username, remarksBase, username, batch_id]);

        syncContractPayments(contract_ref);

        const updated = get(`SELECT total_received, balance_amount FROM contracts WHERE contract_ref=? AND is_deleted=0`, [contract_ref]);

        try {
          run(`INSERT INTO payment_reconcile_audit
                 (batch_id, source_file, contract_ref, existing_received, source_received,
                  adjustment_amount, existing_balance, new_balance, status, payment_ref, performed_by)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            [batch_id, source_file || null, contract_ref, existRecv,
             parseFloat(source_received), liveAdj,
             contract.balance_amount,
             updated ? updated.balance_amount : null,
             'committed', pRef, username]);
        } catch (auditErr) {
          console.warn('[reconcile] Audit log insert failed (non-fatal):', auditErr.message);
        }

        try {
          writeAuditLog({
            action: 'RECONCILE', module: 'client_payments', recordRef: pRef,
            details: { contract_ref, batch_id, existing_received: existRecv, adjustment_amount: liveAdj, source_file },
            performedBy: username,
          });
        } catch (_) {}

        committed.push({ contract_ref, payment_ref: pRef, adjustment_amount: liveAdj });
      }

      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      return res.status(500).json({ error: `Transaction failed and was rolled back: ${e.message}` });
    }

    res.json({
      ok: true,
      batch_id,
      committed_count:   committed.length,
      failed_count:      failed.length,
      committed,
      failed,
      total_adjustment:  Math.round(committed.reduce((s, c) => s + c.adjustment_amount, 0) * 100) / 100,
      backup_file:       backupFile,
    });
    } catch (outerErr) {
      console.error('[reconcile-commit] Unhandled error:', outerErr);
      if (!res.headersSent) {
        res.status(500).json({ error: `Server error during commit: ${outerErr.message}` });
      }
    }
  }
);

// ── GET /client-payments/reconcile-audit  (audit trail viewer) ───────────────
router.get('/client-payments/reconcile-audit', requireModule('accounts'), (req, res) => {
  const { batch_id } = req.query;
  if (batch_id) {
    const rows = all(`SELECT * FROM payment_reconcile_audit WHERE batch_id=? ORDER BY id`, [batch_id]);
    const summary = get(`SELECT COUNT(*) AS count, COALESCE(SUM(adjustment_amount),0) AS total FROM payment_reconcile_audit WHERE batch_id=?`, [batch_id]);
    return res.json({ rows, summary });
  }
  // All batches summary
  const batches = all(`SELECT batch_id, MIN(performed_at) AS date, COUNT(*) AS contracts, COALESCE(SUM(adjustment_amount),0) AS total_added, MAX(performed_by) AS by FROM payment_reconcile_audit GROUP BY batch_id ORDER BY date DESC LIMIT 20`);
  res.json({ batches });
});

module.exports = router;
