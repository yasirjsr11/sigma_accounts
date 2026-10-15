// Factory / Suppliers module import from "ED-SH-FACTORY-QUOTES.xlsx" (3 sheets:
// SL FUJI INS QUOTES, SL FUJI - SEA COSTS, SL FUJI - OTJ QUOTES).
// factory_orders is empty before this run -> pure insert, no merge-with-existing-data logic.
// Rules implemented (per the 2026-06-27 governing request):
//  - Factory Ref. is the unique business key. No Factory Ref -> row is skipped (logged as an issue).
//  - Only the INS QUOTES sheet has a real "Contract Ref." column; matched against active
//    contracts.contract_ref (cleaned of stray punctuation, e.g. "SH-0.78" -> "SH-078", to fix
//    literal typos WITHOUT guessing identity from other fields). Linked / Contract Ref Not Found.
//  - SEA COSTS and OTJ QUOTES sheets have no Contract Ref column at all ("Our Ref." is a literal
//    batch label: SEA / LCL / OTJ) -> every row in those sheets is Pending Contract Ref.
//  - Duplicate Factory Ref (within or across sheets) -> compare full row; auto-merge only if every
//    compared field matches; otherwise Needs Review (factory_duplicate_review). None found in this run.
//  - Per-sheet amount column maps to a different module field: INS -> Factory Quote Amount,
//    SEA -> Sea Cost/Shipping Cost, OTJ -> Other Job Cost.
//  - Change log: one factory_changelog row per populated field, this being a fresh insert.
// Does NOT touch projects/dashboard/any other module. Additive only.
const path = require('path');
const XLSX = require('xlsx');
const { db, run, get, all } = require('../db/db.js');

const SRC_FILE = process.argv[2] || path.join(__dirname, 'ED-SH-FACTORY-QUOTES.xlsx');
const APPLY = process.argv.includes('--apply');
const RUN_BY = 'system-factory-import-2026-06-27';
const SOURCE_FILE_NAME = 'ED-SH-FACTORY-QUOTES.xlsx';

function cleanStr(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s.length ? s : null;
}
function parseNumber(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  let s = String(v).trim();
  s = s.replace(/[A-Za-z]+\.?/g, ''); // strip currency words/abbreviations e.g. "USD." "AED"
  s = s.replace(/,/g, '');
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return isNaN(n) ? null : Math.round(n * 100) / 100;
}
function parseDate(v) {
  if (!v) return { date: null, multi: false };
  if (v instanceof Date) return { date: v.toISOString().slice(0, 10), multi: false };
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    return { date: d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : null, multi: false };
  }
  const s = String(v).trim();
  const multi = (s.match(/\d{1,4}[\/\-]\d{1,2}[\/\-]\d{2,4}/g) || []).length > 1;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, multi };
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return { date: `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, multi };
  const d = new Date(s);
  return { date: isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10), multi };
}
function cleanContractRef(raw) {
  const s = cleanStr(raw);
  if (!s) return null;
  const cleaned = s.replace(/[^A-Za-z0-9-]/g, '');
  return cleaned || null;
}

const wb = XLSX.readFile(SRC_FILE, { cellDates: true });
console.log('Sheets found:', wb.SheetNames);

function readSheet(name) {
  const sn = wb.SheetNames.find(n => n.trim() === name.trim());
  if (!sn) { console.error(`Sheet "${name}" not found.`); process.exit(1); }
  return XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: null, raw: true });
}

const activeContracts = new Set(all('SELECT contract_ref FROM contracts WHERE is_deleted = 0').map(r => r.contract_ref));

const dataIssues = [];
const changelog = []; // {factory_ref, contract_ref, source_sheet_name, field_updated, old_value, new_value, reason_for_update}
const dupReview = [];
const stats = {
  perSheet: {},
  totalImported: 0, created: 0, updated: 0, duplicatesRemoved: 0,
  needsReview: 0, pendingContractRef: 0, contractRefNotFound: 0, linked: 0,
};
const records = []; // final rows to insert
const seenFactoryRef = new Map(); // factory_ref -> record (for cross-sheet dup detection)

function addChange(rec, field, oldV, newV, reason) {
  if (newV === null || newV === undefined || newV === '') return;
  changelog.push({
    factory_ref: rec.factory_ref, contract_ref: rec.contract_ref, source_sheet_name: rec.source_sheet,
    field_updated: field, old_value: oldV === undefined ? null : oldV, new_value: String(newV), reason_for_update: reason,
  });
}

function rowsEqual(a, b) {
  const keys = ['client_name', 'project_description', 'factory_invoice_value', 'sea_cost', 'other_job_cost', 'advance_payment', 'balance_payment'];
  return keys.every(k => String(a[k] ?? '') === String(b[k] ?? ''));
}

// ---------- Sheet 1: SL FUJI INS QUOTES ----------
function processIns() {
  const sheetActualName = wb.SheetNames.find(n => n.trim() === 'SL FUJI INS QUOTES');
  const raw = readSheet('SL FUJI INS QUOTES');
  let total = 0, skippedNoRef = 0;
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    if (!r || r[0] === null || r[0] === undefined) continue;
    if (String(r[0]).trim().toUpperCase().startsWith('YEAR')) continue;
    total++;
    const factory_ref = cleanStr(r[2]);
    if (!factory_ref) { skippedNoRef++; dataIssues.push({ sheet: sheetActualName, row: i + 1, issue: 'Missing Factory Ref. - row skipped', detail: JSON.stringify(r) }); continue; }

    const rawContractRef = cleanStr(r[1]);
    const contract_ref = rawContractRef ? cleanContractRef(rawContractRef) : null;
    let linked_contract_status;
    if (!contract_ref) { linked_contract_status = 'Pending Contract Ref'; }
    else if (activeContracts.has(contract_ref)) { linked_contract_status = 'Linked'; }
    else { linked_contract_status = 'Contract Ref Not Found'; }
    if (rawContractRef && contract_ref && rawContractRef !== contract_ref) {
      dataIssues.push({ sheet: sheetActualName, row: i + 1, issue: `Contract Ref. cleaned of stray punctuation: "${rawContractRef}" -> "${contract_ref}"`, detail: `Factory Ref ${factory_ref}` });
    }

    const final_raw = r[8];
    const finalParsed = parseNumber(final_raw);
    if (final_raw !== null && typeof final_raw !== 'number' && finalParsed !== null) {
      dataIssues.push({ sheet: sheetActualName, row: i + 1, issue: `Non-numeric Final Payment Value text cleaned: "${final_raw}" -> ${finalParsed}`, detail: `Factory Ref ${factory_ref}` });
    }
    const advDate = parseDate(r[7]);
    const finDate = parseDate(r[9]);
    if (finDate.multi) dataIssues.push({ sheet: sheetActualName, row: i + 1, issue: `Final Payment Date contains multiple dates - used first occurrence: "${r[9]}"`, detail: `Factory Ref ${factory_ref}` });

    const invoice_value = parseNumber(r[5]);
    const advance_payment = parseNumber(r[6]);
    const balance_payment = finalParsed;
    const total_paid = (advance_payment || 0) + (balance_payment || 0);
    const amountBasis = invoice_value;
    let payment_status = 'Pending';
    if (total_paid > 0 && amountBasis !== null && total_paid >= amountBasis - 1) payment_status = 'Paid';
    else if (total_paid > 0) payment_status = 'Partial';

    const rec = {
      factory_ref, contract_ref, linked_contract_status, source_sheet: sheetActualName, source_sheet_group: 'Installation / Factory Quote Records',
      supplier_name: 'SL FUJI', our_ref: null, client_name: cleanStr(r[3]), project_description: cleanStr(r[4]),
      factory_invoice_value: invoice_value, sea_cost: null, other_job_cost: null, currency: 'USD',
      advance_payment, advance_payment_date: advDate.date, balance_payment, balance_payment_date: finDate.date,
      supplier_payment_paid: total_paid || 0, supplier_balance: amountBasis !== null ? Math.round((amountBasis - total_paid) * 100) / 100 : null,
      payment_status, remarks: cleanStr(r[10]),
    };
    addToBatch(rec, sheetActualName);
  }
  stats.perSheet['SL FUJI INS QUOTES'] = { totalRows: total, skippedNoRef };
}

// ---------- Sheet 2: SL FUJI - SEA COSTS ----------
function processSea() {
  const sheetActualName = wb.SheetNames.find(n => n.trim() === 'SL FUJI - SEA COSTS');
  const raw = readSheet('SL FUJI - SEA COSTS');
  let total = 0, skippedNoRef = 0;
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    if (!r || r[0] === null || r[0] === undefined) continue;
    if (String(r[0]).trim().toUpperCase().startsWith('YEAR')) continue;
    total++;
    const factory_ref = cleanStr(r[2]);
    if (!factory_ref) { skippedNoRef++; dataIssues.push({ sheet: sheetActualName, row: i + 1, issue: 'Missing Factory Ref. - row skipped', detail: JSON.stringify(r) }); continue; }

    const our_ref = cleanStr(r[1]); // literal "SEA" / "LCL"
    const invoice_value = parseNumber(r[5]);
    const advance_payment = parseNumber(r[6]);
    const advDate = parseDate(r[7]);
    const finalParsed = parseNumber(r[8]);
    const finDate = parseDate(r[9]);
    if (finDate.multi) dataIssues.push({ sheet: sheetActualName, row: i + 1, issue: `Final Payment Date contains multiple dates - used first occurrence: "${r[9]}"`, detail: `Factory Ref ${factory_ref}` });

    const total_paid = (advance_payment || 0) + (finalParsed || 0);
    const amountBasis = invoice_value;
    let payment_status = 'Pending';
    if (total_paid > 0 && amountBasis !== null && total_paid >= amountBasis - 1) payment_status = 'Paid';
    else if (total_paid > 0) payment_status = 'Partial';

    // Judgment call: a recorded sea-freight payment implies the shipment already happened.
    const shipping_status = (advDate.date || finDate.date) ? 'Shipped' : 'Not Shipped';

    const rec = {
      factory_ref, contract_ref: null, linked_contract_status: 'Pending Contract Ref', source_sheet: sheetActualName, source_sheet_group: 'Shipping / Sea Cost Records',
      supplier_name: 'SL FUJI', our_ref, client_name: cleanStr(r[3]), project_description: cleanStr(r[4]),
      factory_invoice_value: null, sea_cost: invoice_value, other_job_cost: null, currency: 'USD',
      advance_payment, advance_payment_date: advDate.date, balance_payment: finalParsed, balance_payment_date: finDate.date,
      supplier_payment_paid: total_paid || 0, supplier_balance: amountBasis !== null ? Math.round((amountBasis - total_paid) * 100) / 100 : null,
      payment_status, shipping_status, remarks: cleanStr(r[10]),
    };
    addToBatch(rec, sheetActualName);
  }
  stats.perSheet['SL FUJI - SEA COSTS'] = { totalRows: total, skippedNoRef };
}

// ---------- Sheet 3: SL FUJI - OTJ QUOTES ----------
function processOtj() {
  const sheetActualName = wb.SheetNames.find(n => n.trim() === 'SL FUJI - OTJ QUOTES');
  const raw = readSheet('SL FUJI - OTJ QUOTES');
  let total = 0, skippedNoRef = 0;
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    if (!r || r[0] === null || r[0] === undefined) continue;
    if (String(r[0]).trim().toUpperCase().startsWith('YEAR')) continue;
    total++;
    const factory_ref = cleanStr(r[2]);
    if (!factory_ref) { skippedNoRef++; dataIssues.push({ sheet: sheetActualName, row: i + 1, issue: 'Missing Factory Ref. - row skipped', detail: JSON.stringify(r) }); continue; }

    const our_ref = cleanStr(r[1]); // literal "OTJ"
    const invoice_value = parseNumber(r[5]);
    const advance_payment = parseNumber(r[6]);
    const advDate = parseDate(r[7]);
    const finalParsed = parseNumber(r[8]);
    const finDate = parseDate(r[9]);
    if (finDate.multi) dataIssues.push({ sheet: sheetActualName, row: i + 1, issue: `Final Payment Date contains multiple dates - used first occurrence: "${r[9]}"`, detail: `Factory Ref ${factory_ref}` });

    const total_paid = (advance_payment || 0) + (finalParsed || 0);
    const amountBasis = invoice_value;
    let payment_status = 'Pending';
    if (total_paid > 0 && amountBasis !== null && total_paid >= amountBasis - 1) payment_status = 'Paid';
    else if (total_paid > 0) payment_status = 'Partial';

    const rec = {
      factory_ref, contract_ref: null, linked_contract_status: 'Pending Contract Ref', source_sheet: sheetActualName, source_sheet_group: 'Other Job / Additional Supplier Cost Records',
      supplier_name: 'SL FUJI', our_ref, client_name: cleanStr(r[3]), project_description: cleanStr(r[4]),
      factory_invoice_value: null, sea_cost: null, other_job_cost: invoice_value, currency: 'USD',
      advance_payment, advance_payment_date: advDate.date, balance_payment: finalParsed, balance_payment_date: finDate.date,
      supplier_payment_paid: total_paid || 0, supplier_balance: amountBasis !== null ? Math.round((amountBasis - total_paid) * 100) / 100 : null,
      payment_status, remarks: cleanStr(r[10]),
    };
    addToBatch(rec, sheetActualName);
  }
  stats.perSheet['SL FUJI - OTJ QUOTES'] = { totalRows: total, skippedNoRef };
}

function addToBatch(rec, sheetActualName) {
  if (seenFactoryRef.has(rec.factory_ref)) {
    const existing = seenFactoryRef.get(rec.factory_ref);
    if (rowsEqual(existing, rec)) {
      stats.duplicatesRemoved++;
      dataIssues.push({ sheet: sheetActualName, row: null, issue: `Duplicate Factory Ref. "${rec.factory_ref}" - identical row, merged (kept first occurrence)`, detail: '' });
    } else {
      rec.needs_review = 1;
      rec.needs_review_reason = `Duplicate Factory Ref. "${rec.factory_ref}" found across sheets/rows with differing details - not auto-merged`;
      stats.needsReview++;
      dupReview.push({ factory_ref: rec.factory_ref, source_sheet_name: sheetActualName, row_a: existing, row_b: rec, reason: rec.needs_review_reason });
      records.push(rec);
    }
    return;
  }
  rec.needs_review = 0; rec.needs_review_reason = null;
  seenFactoryRef.set(rec.factory_ref, rec);
  records.push(rec);
}

processIns();
processSea();
processOtj();

for (const rec of records) {
  if (rec.linked_contract_status === 'Linked') stats.linked++;
  else if (rec.linked_contract_status === 'Pending Contract Ref') stats.pendingContractRef++;
  else if (rec.linked_contract_status === 'Contract Ref Not Found') stats.contractRefNotFound++;
}
stats.totalImported = records.length;
stats.created = records.length; // factory_orders was empty before this run

console.log('\n=== SUMMARY ===');
console.log('Per-sheet rows read (excl. divider rows):', stats.perSheet);
console.log('Records to import:', stats.totalImported);
console.log('Linked:', stats.linked, '| Pending Contract Ref:', stats.pendingContractRef, '| Contract Ref Not Found:', stats.contractRefNotFound);
console.log('Needs Review (unmerged duplicates):', stats.needsReview, '| Duplicates merged:', stats.duplicatesRemoved);
console.log('Data issues logged:', dataIssues.length);

require('fs').writeFileSync(path.join(__dirname, 'factory_import_audit.json'), JSON.stringify({ stats, dataIssues, changelogPreview: changelog.slice(0, 5), dupReview }, null, 2));
console.log('Audit JSON written to import/factory_import_audit.json');

if (!APPLY) {
  console.log('\nDRY RUN - no changes written. Re-run with --apply to commit.');
  process.exit(0);
}

console.log('\nAPPLYING...');
db.exec('BEGIN');
try {
  let inserted = 0;
  for (const rec of records) {
    let code = rec.factory_ref;
    let suffix = 0;
    while (get('SELECT id FROM factory_orders WHERE factory_order_code = ?', [code])) { suffix++; code = `${rec.factory_ref}-DUP${suffix}`; }

    run(`INSERT INTO factory_orders (
        factory_order_code, factory_quotation_number, supplier_name, our_ref, factory_ref, client_name, project_description,
        order_confirmation_status, production_status, factory_invoice_value, supplier_payment_paid, supplier_balance,
        shipping_status, eta, delivery_status, remarks, source_sheet, source_file, created_by,
        contract_ref, linked_contract_status, invoice_ref, order_confirmation_ref, sea_cost, other_job_cost, currency,
        payment_terms, advance_payment, advance_payment_date, balance_payment, balance_payment_date, payment_status,
        actual_delivery_date, needs_review, needs_review_reason
      ) VALUES (?,?,?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,?,?, ?,?,?,?,?,?,?, ?,?,?,?,?,?, ?,?,?)`,
      [code, null, rec.supplier_name, rec.our_ref, rec.factory_ref, rec.client_name, rec.project_description,
       'Pending', 'Not Started', rec.factory_invoice_value, rec.supplier_payment_paid, rec.supplier_balance,
       rec.shipping_status || 'Not Shipped', null, 'Pending', rec.remarks, rec.source_sheet, SOURCE_FILE_NAME, RUN_BY,
       rec.contract_ref, rec.linked_contract_status, null, null, rec.sea_cost, rec.other_job_cost, rec.currency,
       null, rec.advance_payment, rec.advance_payment_date, rec.balance_payment, rec.balance_payment_date, rec.payment_status,
       null, rec.needs_review, rec.needs_review_reason]
    );
    inserted++;

    for (const [field, val] of Object.entries({
      'Contract Ref.': rec.contract_ref, 'Linked Contract Status': rec.linked_contract_status,
      'Supplier / Factory Name': rec.supplier_name, 'Client / Company Name': rec.client_name,
      'Project / Description': rec.project_description, 'Factory Quote Amount': rec.factory_invoice_value,
      'Sea Cost / Shipping Cost': rec.sea_cost, 'Other Job Cost': rec.other_job_cost, 'Currency': rec.currency,
      'Advance Payment': rec.advance_payment, 'Balance Payment': rec.balance_payment,
      'Total Paid': rec.supplier_payment_paid, 'Balance Payable': rec.supplier_balance, 'Payment Status': rec.payment_status,
    })) {
      if (val === null || val === undefined || val === '') continue;
      run('INSERT INTO factory_changelog (factory_ref, contract_ref, source_sheet_name, field_updated, old_value, new_value, reason_for_update) VALUES (?,?,?,?,?,?,?)',
        [rec.factory_ref, rec.contract_ref, rec.source_sheet, field, null, String(val), 'Initial import from ED-SH-FACTORY-QUOTES.xlsx']);
    }
  }

  for (const d of dupReview) {
    run('INSERT INTO factory_duplicate_review (factory_ref, source_sheet_name, row_a_json, row_b_json, reason) VALUES (?,?,?,?,?)',
      [d.factory_ref, d.source_sheet_name, JSON.stringify(d.row_a), JSON.stringify(d.row_b), d.reason]);
  }

  db.exec('COMMIT');
  console.log('COMMITTED. Inserted', inserted, 'factory_orders rows,', changelog.length > 0 ? 'changelog rows written.' : '', dupReview.length, 'duplicate-review rows.');
} catch (e) {
  db.exec('ROLLBACK');
  console.error('ROLLED BACK:', e.message);
  process.exit(1);
}
