// Factory / Suppliers module import - SPLIT VERSION (2026-06-27 correction).
// Each of the 3 SL FUJI sheets is processed by its own fully independent function and
// written to its own dedicated table. There is NO shared state between the three
// processing functions (separate duplicate-detection maps, separate record arrays,
// separate change logs) - this guarantees no cross-sheet linking or merging can occur
// even by accident.
//   SL FUJI INS QUOTES   -> factory_ins_quotes
//   SL FUJI - SEA COSTS  -> factory_sea_costs
//   SL FUJI - OTJ QUOTES -> factory_otj_quotes
// Contract Ref. is kept (text only, cleaned of stray punctuation) on the INS table only,
// because that is the only sheet with a Contract Ref. column in the source. It is NOT
// validated/matched against the Contracts module - no linking workflow, per instruction.
// Does NOT touch contracts, projects, maintenance_contracts, amc_contracts, or the
// Main Dashboard.
const path = require('path');
const XLSX = require('xlsx');
const { db, run, get } = require('../db/db.js');

const SRC_FILE = process.argv[2] || path.join(__dirname, 'ED-SH-FACTORY-QUOTES.xlsx');
const APPLY = process.argv.includes('--apply');
const RUN_BY = 'system-factory-split-import-2026-06-27';
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
  s = s.replace(/[A-Za-z]+\.?/g, '');
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
function cleanRefPunctuation(raw) {
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
  return { name: sn, rows: XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: null, raw: true }) };
}

const dataIssues = [];

// Each sheet gets its OWN duplicate map, OWN records array, OWN changelog rows -
// no cross-sheet variable is ever read by more than one of the three functions below.

function buildSheetResult(table, sheetLabel) {
  return { table, sheetLabel, total: 0, skippedNoRef: 0, duplicatesRemoved: 0, needsReview: 0, records: [], dupReview: [], changelog: [] };
}

function rowsEqual(a, b, keys) {
  return keys.every(k => String(a[k] ?? '') === String(b[k] ?? ''));
}

function addToBatch(result, rec, dedupeKeys) {
  const seen = result._seen || (result._seen = new Map());
  if (seen.has(rec.factory_ref)) {
    const existing = seen.get(rec.factory_ref);
    if (rowsEqual(existing, rec, dedupeKeys)) {
      result.duplicatesRemoved++;
      dataIssues.push({ sheet: result.sheetLabel, issue: `Duplicate Factory Ref. "${rec.factory_ref}" - identical row within this sheet, merged (kept first occurrence)` });
      return;
    }
    rec.needs_review = 1;
    rec.needs_review_reason = `Duplicate Factory Ref. "${rec.factory_ref}" found twice within ${result.sheetLabel} with differing details - not auto-merged`;
    result.needsReview++;
    result.dupReview.push({ factory_ref: rec.factory_ref, source_sheet_name: result.sheetLabel, row_a: existing, row_b: rec, reason: rec.needs_review_reason });
    result.records.push(rec);
    return;
  }
  rec.needs_review = 0; rec.needs_review_reason = null;
  seen.set(rec.factory_ref, rec);
  result.records.push(rec);
}

// ---------- SL FUJI INS QUOTES -> factory_ins_quotes ----------
function processIns() {
  const { name, rows } = readSheet('SL FUJI INS QUOTES');
  const result = buildSheetResult('factory_ins_quotes', name);
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r[0] === null || r[0] === undefined) continue;
    if (String(r[0]).trim().toUpperCase().startsWith('YEAR')) continue;
    result.total++;
    const factory_ref = cleanStr(r[2]);
    if (!factory_ref) { result.skippedNoRef++; dataIssues.push({ sheet: name, row: i + 1, issue: 'Missing Factory Ref. - row skipped' }); continue; }

    const rawContractRef = cleanStr(r[1]);
    const contract_ref = rawContractRef ? cleanRefPunctuation(rawContractRef) : null;
    if (rawContractRef && contract_ref && rawContractRef !== contract_ref) {
      dataIssues.push({ sheet: name, row: i + 1, issue: `Contract Ref. cleaned of stray punctuation: "${rawContractRef}" -> "${contract_ref}" (Factory Ref ${factory_ref}; not matched/linked against Contracts module per instruction)` });
    }

    const final_raw = r[8];
    const finalParsed = parseNumber(final_raw);
    if (final_raw !== null && typeof final_raw !== 'number' && finalParsed !== null) {
      dataIssues.push({ sheet: name, row: i + 1, issue: `Non-numeric Final Payment Value text cleaned: "${final_raw}" -> ${finalParsed} (Factory Ref ${factory_ref})` });
    }
    const advDate = parseDate(r[7]);
    const finDate = parseDate(r[9]);
    if (finDate.multi) dataIssues.push({ sheet: name, row: i + 1, issue: `Final Payment Date contains multiple dates - used first occurrence: "${r[9]}" (Factory Ref ${factory_ref})` });

    const amount = parseNumber(r[5]);
    const advance_payment = parseNumber(r[6]);
    const balance_payment = finalParsed;
    const total_paid = (advance_payment || 0) + (balance_payment || 0);
    let payment_status = 'Pending';
    if (total_paid > 0 && amount !== null && total_paid >= amount - 1) payment_status = 'Paid';
    else if (total_paid > 0) payment_status = 'Partial';

    const rec = {
      factory_ref, contract_ref, supplier_name: 'SL FUJI', client_name: cleanStr(r[3]), project_description: cleanStr(r[4]),
      quotation_ref: null, invoice_ref: null, order_confirmation_ref: null,
      factory_quote_amount: amount, currency: 'USD', payment_terms: null,
      advance_payment, advance_payment_date: advDate.date, balance_payment, balance_payment_date: finDate.date,
      total_paid: total_paid || 0, balance_payable: amount !== null ? Math.round((amount - total_paid) * 100) / 100 : null,
      payment_status, invoice_status: null, order_confirmation_status: null, production_status: null,
      shipping_status: null, delivery_status: null, expected_delivery_date: null, actual_delivery_date: null,
      remarks: cleanStr(r[10]),
    };
    addToBatch(result, rec, ['client_name', 'project_description', 'factory_quote_amount', 'advance_payment', 'balance_payment']);
  }
  return result;
}

// ---------- SL FUJI - SEA COSTS -> factory_sea_costs ----------
function processSea() {
  const { name, rows } = readSheet('SL FUJI - SEA COSTS');
  const result = buildSheetResult('factory_sea_costs', name);
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r[0] === null || r[0] === undefined) continue;
    if (String(r[0]).trim().toUpperCase().startsWith('YEAR')) continue;
    result.total++;
    const factory_ref = cleanStr(r[2]);
    if (!factory_ref) { result.skippedNoRef++; dataIssues.push({ sheet: name, row: i + 1, issue: 'Missing Factory Ref. - row skipped' }); continue; }

    const our_ref = cleanStr(r[1]); // literal "SEA" / "LCL" batch label - not a contract ref
    const amount = parseNumber(r[5]);
    const advance_payment = parseNumber(r[6]);
    const advDate = parseDate(r[7]);
    const finalParsed = parseNumber(r[8]);
    const finDate = parseDate(r[9]);
    if (finDate.multi) dataIssues.push({ sheet: name, row: i + 1, issue: `Final Payment Date contains multiple dates - used first occurrence: "${r[9]}" (Factory Ref ${factory_ref})` });

    const total_paid = (advance_payment || 0) + (finalParsed || 0);
    let payment_status = 'Pending';
    if (total_paid > 0 && amount !== null && total_paid >= amount - 1) payment_status = 'Paid';
    else if (total_paid > 0) payment_status = 'Partial';

    // Judgment call (kept from original import): a recorded sea-freight payment implies the shipment already happened.
    const shipping_status = (advDate.date || finDate.date) ? 'Shipped' : 'Not Shipped';

    const rec = {
      factory_ref, our_ref, supplier_name: 'SL FUJI', client_name: cleanStr(r[3]), project_description: cleanStr(r[4]),
      quotation_ref: null, invoice_ref: null, order_confirmation_ref: null,
      sea_cost: amount, currency: 'USD', payment_terms: null,
      advance_payment, advance_payment_date: advDate.date, balance_payment: finalParsed, balance_payment_date: finDate.date,
      total_paid: total_paid || 0, balance_payable: amount !== null ? Math.round((amount - total_paid) * 100) / 100 : null,
      payment_status, invoice_status: null, order_confirmation_status: null, production_status: null,
      shipping_status, delivery_status: null, expected_delivery_date: null, actual_delivery_date: null,
      remarks: cleanStr(r[10]),
    };
    addToBatch(result, rec, ['client_name', 'project_description', 'sea_cost', 'advance_payment', 'balance_payment']);
  }
  return result;
}

// ---------- SL FUJI - OTJ QUOTES -> factory_otj_quotes ----------
function processOtj() {
  const { name, rows } = readSheet('SL FUJI - OTJ QUOTES');
  const result = buildSheetResult('factory_otj_quotes', name);
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r[0] === null || r[0] === undefined) continue;
    if (String(r[0]).trim().toUpperCase().startsWith('YEAR')) continue;
    result.total++;
    const factory_ref = cleanStr(r[2]);
    if (!factory_ref) { result.skippedNoRef++; dataIssues.push({ sheet: name, row: i + 1, issue: 'Missing Factory Ref. - row skipped' }); continue; }

    const our_ref = cleanStr(r[1]); // literal "OTJ" batch label - not a contract ref
    const amount = parseNumber(r[5]);
    const advance_payment = parseNumber(r[6]);
    const advDate = parseDate(r[7]);
    const finalParsed = parseNumber(r[8]);
    const finDate = parseDate(r[9]);
    if (finDate.multi) dataIssues.push({ sheet: name, row: i + 1, issue: `Final Payment Date contains multiple dates - used first occurrence: "${r[9]}" (Factory Ref ${factory_ref})` });

    const total_paid = (advance_payment || 0) + (finalParsed || 0);
    let payment_status = 'Pending';
    if (total_paid > 0 && amount !== null && total_paid >= amount - 1) payment_status = 'Paid';
    else if (total_paid > 0) payment_status = 'Partial';

    const rec = {
      factory_ref, our_ref, supplier_name: 'SL FUJI', client_name: cleanStr(r[3]), project_description: cleanStr(r[4]),
      quotation_ref: null, invoice_ref: null, order_confirmation_ref: null,
      other_job_cost: amount, currency: 'USD', payment_terms: null,
      advance_payment, advance_payment_date: advDate.date, balance_payment: finalParsed, balance_payment_date: finDate.date,
      total_paid: total_paid || 0, balance_payable: amount !== null ? Math.round((amount - total_paid) * 100) / 100 : null,
      payment_status, invoice_status: null, order_confirmation_status: null, production_status: null,
      shipping_status: null, delivery_status: null, expected_delivery_date: null, actual_delivery_date: null,
      remarks: cleanStr(r[10]),
    };
    addToBatch(result, rec, ['client_name', 'project_description', 'other_job_cost', 'advance_payment', 'balance_payment']);
  }
  return result;
}

const insResult = processIns();
const seaResult = processSea();
const otjResult = processOtj();
const allResults = [insResult, seaResult, otjResult];

console.log('\n=== SUMMARY (per sheet, fully independent) ===');
for (const res of allResults) {
  console.log(`${res.sheetLabel} -> ${res.table}: total=${res.total} skippedNoRef=${res.skippedNoRef} toImport=${res.records.length} duplicatesRemoved=${res.duplicatesRemoved} needsReview=${res.needsReview}`);
}
console.log('Data issues logged:', dataIssues.length);

const auditPath = path.join(__dirname, 'factory_split_import_audit.json');
require('fs').writeFileSync(auditPath, JSON.stringify({
  perSheet: allResults.map(r => ({ table: r.table, sheetLabel: r.sheetLabel, total: r.total, skippedNoRef: r.skippedNoRef, toImport: r.records.length, duplicatesRemoved: r.duplicatesRemoved, needsReview: r.needsReview })),
  dataIssues,
  dupReview: allResults.flatMap(r => r.dupReview),
}, null, 2));
console.log('Audit JSON written to', auditPath);

if (!APPLY) {
  console.log('\nDRY RUN - no changes written. Re-run with --apply to commit.');
  process.exit(0);
}

const FIELD_MAP = {
  factory_ins_quotes: ['factory_quote_amount'],
  factory_sea_costs: ['sea_cost'],
  factory_otj_quotes: ['other_job_cost'],
};
const COLS = {
  factory_ins_quotes: ['factory_record_code', 'factory_ref', 'contract_ref', 'supplier_name', 'client_name', 'project_description',
    'quotation_ref', 'invoice_ref', 'order_confirmation_ref', 'factory_quote_amount', 'currency', 'payment_terms',
    'advance_payment', 'advance_payment_date', 'balance_payment', 'balance_payment_date', 'total_paid', 'balance_payable',
    'payment_status', 'invoice_status', 'order_confirmation_status', 'production_status', 'shipping_status', 'delivery_status',
    'expected_delivery_date', 'actual_delivery_date', 'remarks', 'needs_review', 'needs_review_reason', 'source_sheet_name', 'source_file', 'created_by'],
  factory_sea_costs: ['factory_record_code', 'factory_ref', 'our_ref', 'supplier_name', 'client_name', 'project_description',
    'quotation_ref', 'invoice_ref', 'order_confirmation_ref', 'sea_cost', 'currency', 'payment_terms',
    'advance_payment', 'advance_payment_date', 'balance_payment', 'balance_payment_date', 'total_paid', 'balance_payable',
    'payment_status', 'invoice_status', 'order_confirmation_status', 'production_status', 'shipping_status', 'delivery_status',
    'expected_delivery_date', 'actual_delivery_date', 'remarks', 'needs_review', 'needs_review_reason', 'source_sheet_name', 'source_file', 'created_by'],
  factory_otj_quotes: ['factory_record_code', 'factory_ref', 'our_ref', 'supplier_name', 'client_name', 'project_description',
    'quotation_ref', 'invoice_ref', 'order_confirmation_ref', 'other_job_cost', 'currency', 'payment_terms',
    'advance_payment', 'advance_payment_date', 'balance_payment', 'balance_payment_date', 'total_paid', 'balance_payable',
    'payment_status', 'invoice_status', 'order_confirmation_status', 'production_status', 'shipping_status', 'delivery_status',
    'expected_delivery_date', 'actual_delivery_date', 'remarks', 'needs_review', 'needs_review_reason', 'source_sheet_name', 'source_file', 'created_by'],
};

console.log('\nAPPLYING...');
db.exec('BEGIN');
try {
  let totalInserted = 0;
  for (const res of allResults) {
    const cols = COLS[res.table];
    const placeholders = cols.map(() => '?').join(',');
    for (const rec of res.records) {
      let code = rec.factory_ref, suffix = 0;
      while (get(`SELECT id FROM ${res.table} WHERE factory_record_code = ?`, [code])) { suffix++; code = `${rec.factory_ref}-DUP${suffix}`; }
      const values = cols.map(c => {
        if (c === 'factory_record_code') return code;
        if (c === 'source_sheet_name') return res.sheetLabel;
        if (c === 'source_file') return SOURCE_FILE_NAME;
        if (c === 'created_by') return RUN_BY;
        return rec[c] === undefined ? null : rec[c];
      });
      run(`INSERT INTO ${res.table} (${cols.join(',')}) VALUES (${placeholders})`, values);
      totalInserted++;
    }
    for (const d of res.dupReview) {
      run('INSERT INTO factory_duplicate_review (factory_ref, source_sheet_name, row_a_json, row_b_json, reason) VALUES (?,?,?,?,?)',
        [d.factory_ref, d.source_sheet_name, JSON.stringify(d.row_a), JSON.stringify(d.row_b), d.reason]);
    }
  }
  db.exec('COMMIT');
  console.log('COMMITTED. Inserted', totalInserted, 'rows across 3 independent tables.');
} catch (e) {
  db.exec('ROLLBACK');
  console.error('ROLLED BACK:', e.message);
  process.exit(1);
}
