// SL FUJI - INS QUOTES reimport (2026-06-27, v2 - supersedes the INS portion of import_factory_split_v1.js).
// Wipes and rebuilds factory_ins_quotes ONLY from scratch. Does not touch factory_sea_costs,
// factory_otj_quotes, contracts, quotations, or maintenance_contracts data.
// New in v2 (per explicit user instructions this round):
//   - Contract Ref. IS NOW validated/linked against the live Contracts module
//     (linked_contract_status: Linked / Pending Contract Ref. / Contract Ref. Not Found).
//     Never guesses a missing/mismatched Contract Ref.
//   - Rows whose source Excel cells contain a literal #REF! formula error in an amount/date
//     field are flagged needs_review (amount is unrecoverable from the source file). Detected
//     at the raw-cell level (cell.t === 'e') because SheetJS silently returns null for error
//     cells in sheet_to_json - the error text/flag is only visible on the raw cell object.
//   - order_confirmation_ref is left NULL (sheet has no distinct Order Confirmation column;
//     Factory Ref. itself already serves as the order confirmation ID, per instruction).
//   - factory_delivery_status is left NULL (no source data for it - not guessed).
const path = require('path');
const XLSX = require('xlsx');
const { db, run, get, all } = require('../db/db.js');

const SRC_FILE = process.argv[2] || path.join(__dirname, 'ED-SH-FACTORY-QUOTES.xlsx');
const APPLY = process.argv.includes('--apply');
const RUN_BY = 'system-ins-quotes-reimport-v2-2026-06-27';
const SOURCE_FILE_NAME = 'ED-SH-FACTORY-QUOTES.xlsx';
const SHEET_LABEL = 'SL FUJI - INS QUOTES';

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
const sn = wb.SheetNames.find(n => n.trim() === SHEET_LABEL.trim());
if (!sn) { console.error(`Sheet "${SHEET_LABEL}" not found. Sheets: ${wb.SheetNames}`); process.exit(1); }
const ws = wb.Sheets[sn];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });

// SheetJS returns null (not the literal "#REF!") for formula-error cells in sheet_to_json -
// the error marker only survives on the raw cell object (`cell.t === 'e'`). Must check there.
function cellHasRefError(rowIdx0, colIdx0) {
  const addr = XLSX.utils.encode_cell({ r: rowIdx0, c: colIdx0 });
  const cell = ws[addr];
  return !!(cell && cell.t === 'e');
}

const dataIssues = [];
const result = { total: 0, skippedNoRef: 0, duplicatesRemoved: 0, needsReview: 0, records: [], dupReview: [] };
const seen = new Map();

for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  if (!r || r[0] === null || r[0] === undefined) continue;
  if (String(r[0]).trim().toUpperCase().startsWith('YEAR')) continue; // year-divider row, not a record
  result.total++;

  const factory_ref = cleanStr(r[2]);
  if (!factory_ref) { result.skippedNoRef++; dataIssues.push({ row: i + 1, issue: 'Missing Factory Ref. - row skipped' }); continue; }

  const rawContractRef = cleanStr(r[1]);
  const contract_ref = rawContractRef ? cleanRefPunctuation(rawContractRef) : null;
  if (rawContractRef && contract_ref && rawContractRef !== contract_ref) {
    dataIssues.push({ row: i + 1, issue: `Contract Ref. cleaned of stray punctuation: "${rawContractRef}" -> "${contract_ref}" (Factory Ref ${factory_ref})` });
  }

  const amountRaw = r[5], advanceRaw = r[6], finalRaw = r[8];
  const refErrorFields = [];
  if (cellHasRefError(i, 5)) refErrorFields.push('Invoice (USD)');
  if (cellHasRefError(i, 6)) refErrorFields.push('Advance Payment Value (USD)');
  if (cellHasRefError(i, 8)) refErrorFields.push('Final Payment Value (USD)');

  const finalParsed = parseNumber(finalRaw);
  if (finalRaw !== null && typeof finalRaw !== 'number' && finalParsed !== null) {
    dataIssues.push({ row: i + 1, issue: `Non-numeric Final Payment Value text cleaned: "${finalRaw}" -> ${finalParsed} (Factory Ref ${factory_ref})` });
  }
  const advDate = parseDate(r[7]);
  const finDate = parseDate(r[9]);
  if (finDate.multi) dataIssues.push({ row: i + 1, issue: `Final Payment Date contains multiple dates - used first occurrence: "${r[9]}" (Factory Ref ${factory_ref})` });

  const amount = parseNumber(amountRaw);
  const advance_payment = parseNumber(advanceRaw);
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
    linked_contract_status: null, // resolved after dedup pass, once we know the live contracts set
    factory_delivery_status: null, // no source data for this field - not guessed
    needs_review: 0, needs_review_reason: null,
  };

  if (refErrorFields.length) {
    rec.needs_review = 1;
    rec.needs_review_reason = `Source Excel cell(s) contained a #REF! formula error for: ${refErrorFields.join(', ')} - amount could not be derived from the file.`;
    result.needsReview++;
  }

  // duplicate Factory Ref. handling (within this sheet only)
  if (seen.has(factory_ref)) {
    const existing = seen.get(factory_ref);
    const dedupeKeys = ['client_name', 'project_description', 'factory_quote_amount', 'advance_payment', 'balance_payment'];
    const identical = dedupeKeys.every(k => String(existing[k] ?? '') === String(rec[k] ?? ''));
    if (identical) {
      result.duplicatesRemoved++;
      dataIssues.push({ issue: `Duplicate Factory Ref. "${factory_ref}" - identical row within this sheet, merged (kept first occurrence)` });
      continue;
    }
    rec.needs_review = 1;
    rec.needs_review_reason = rec.needs_review_reason
      ? rec.needs_review_reason + ` Also: duplicate Factory Ref. "${factory_ref}" found twice in this sheet with differing details - not auto-merged.`
      : `Duplicate Factory Ref. "${factory_ref}" found twice within ${SHEET_LABEL} with differing details - not auto-merged`;
    result.needsReview++;
    result.dupReview.push({ factory_ref, source_sheet_name: SHEET_LABEL, row_a: existing, row_b: rec, reason: rec.needs_review_reason });
    result.records.push(rec);
    continue;
  }
  seen.set(factory_ref, rec);
  result.records.push(rec);
}

// Resolve Contract Ref. linking against the LIVE Contracts module (never guessed).
const liveRefs = new Set(all('SELECT contract_ref FROM contracts WHERE is_deleted = 0').map(r => r.contract_ref));
let linked = 0, pending = 0, notFound = 0;
for (const rec of result.records) {
  if (!rec.contract_ref) { rec.linked_contract_status = 'Pending Contract Ref.'; pending++; }
  else if (liveRefs.has(rec.contract_ref)) { rec.linked_contract_status = 'Linked'; linked++; }
  else { rec.linked_contract_status = 'Contract Ref. Not Found'; notFound++; }
}

console.log('\n=== SL FUJI - INS QUOTES reimport summary ===');
console.log(`total rows seen=${result.total} skippedNoRef=${result.skippedNoRef} toImport=${result.records.length} duplicatesRemoved=${result.duplicatesRemoved} needsReview=${result.needsReview}`);
console.log(`Contract Ref. linking -> Linked=${linked} Pending Contract Ref.=${pending} Contract Ref. Not Found=${notFound}`);
console.log('Data issues logged:', dataIssues.length);
const totalAmount = result.records.reduce((s, r) => s + (r.factory_quote_amount || 0), 0);
const totalPaid = result.records.reduce((s, r) => s + (r.total_paid || 0), 0);
const totalBalance = result.records.reduce((s, r) => s + (r.balance_payable || 0), 0);
console.log(`Total Factory Order Value=${totalAmount} Total Paid=${totalPaid} Total Balance=${totalBalance}`);

const auditPath = path.join(__dirname, 'ins_quotes_reimport_v2_audit.json');
require('fs').writeFileSync(auditPath, JSON.stringify({
  summary: { total: result.total, skippedNoRef: result.skippedNoRef, toImport: result.records.length, duplicatesRemoved: result.duplicatesRemoved, needsReview: result.needsReview, linked, pending, notFound, totalAmount, totalPaid, totalBalance },
  dataIssues,
  dupReview: result.dupReview,
  needsReviewRecords: result.records.filter(r => r.needs_review).map(r => ({ factory_ref: r.factory_ref, contract_ref: r.contract_ref, needs_review_reason: r.needs_review_reason })),
}, null, 2));
console.log('Audit JSON written to', auditPath);

if (!APPLY) {
  console.log('\nDRY RUN - no changes written. Re-run with --apply to commit.');
  process.exit(0);
}

const COLS = ['factory_record_code', 'factory_ref', 'contract_ref', 'supplier_name', 'client_name', 'project_description',
  'quotation_ref', 'invoice_ref', 'order_confirmation_ref', 'factory_quote_amount', 'currency', 'payment_terms',
  'advance_payment', 'advance_payment_date', 'balance_payment', 'balance_payment_date', 'total_paid', 'balance_payable',
  'payment_status', 'invoice_status', 'order_confirmation_status', 'production_status', 'shipping_status', 'delivery_status',
  'expected_delivery_date', 'actual_delivery_date', 'remarks', 'needs_review', 'needs_review_reason', 'linked_contract_status',
  'factory_delivery_status', 'source_sheet_name', 'source_file', 'created_by'];

console.log('\nAPPLYING...');
db.exec('BEGIN');
try {
  // Wipe existing INS QUOTES data only (per "wipe and reimport fresh" decision). Nothing else touched.
  const delCount = get('SELECT COUNT(*) c FROM factory_ins_quotes').c;
  run('DELETE FROM factory_ins_quotes');
  run('DELETE FROM factory_duplicate_review WHERE source_sheet_name = ?', [SHEET_LABEL]);
  run('DELETE FROM factory_changelog WHERE source_sheet_name = ?', [SHEET_LABEL]);
  console.log(`Wiped ${delCount} existing factory_ins_quotes rows + related duplicate-review/changelog rows for this sheet.`);

  let totalInserted = 0;
  const placeholders = COLS.map(() => '?').join(',');
  for (const rec of result.records) {
    let code = rec.factory_ref, suffix = 0;
    while (get(`SELECT id FROM factory_ins_quotes WHERE factory_record_code = ?`, [code])) { suffix++; code = `${rec.factory_ref}-DUP${suffix}`; }
    const values = COLS.map(c => {
      if (c === 'factory_record_code') return code;
      if (c === 'source_sheet_name') return SHEET_LABEL;
      if (c === 'source_file') return SOURCE_FILE_NAME;
      if (c === 'created_by') return RUN_BY;
      return rec[c] === undefined ? null : rec[c];
    });
    run(`INSERT INTO factory_ins_quotes (${COLS.join(',')}) VALUES (${placeholders})`, values);
    totalInserted++;
  }
  for (const d of result.dupReview) {
    run('INSERT INTO factory_duplicate_review (factory_ref, source_sheet_name, row_a_json, row_b_json, reason) VALUES (?,?,?,?,?)',
      [d.factory_ref, d.source_sheet_name, JSON.stringify(d.row_a), JSON.stringify(d.row_b), d.reason]);
  }
  db.exec('COMMIT');
  console.log('COMMITTED. Inserted', totalInserted, 'rows into factory_ins_quotes.');
} catch (e) {
  db.exec('ROLLBACK');
  console.error('ROLLED BACK:', e.message);
  process.exit(1);
}
