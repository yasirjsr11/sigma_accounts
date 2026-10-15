// One-time import of historical "Contracts " sheet from "All Contract Updates .xlsx"
// into the new contracts table. Purely additive - does not touch projects/factory_orders/etc.
// Run from a local (non-mounted) copy of the app dir, then copy db/sh_pms.sqlite back.
const path = require('path');
const XLSX = require('xlsx');
const { run, get, all } = require('../db/db.js');

const SRC_FILE = process.argv[2];
if (!SRC_FILE) { console.error('Usage: node import_contracts.js <path-to-xlsx>'); process.exit(1); }

function cleanStr(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}
function parseNumber(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[^0-9.\-]/g, '');
  if (!s) return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const wb = XLSX.readFile(SRC_FILE, { cellDates: true });
const sheetName = wb.SheetNames.find(n => n.trim() === 'Contracts');
if (!sheetName) { console.error('Sheet "Contracts" not found. Sheets:', wb.SheetNames); process.exit(1); }
const ws = wb.Sheets[sheetName];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });

// Data rows start after the 2 header rows (row1 = column titles, row2 = "Terms I..VI" sub-header)
let inserted = 0, skipped = 0, updatedProjectLink = 0;
const seenRefs = new Set();

for (let i = 3; i < rows.length; i++) {
  const row = rows[i];
  if (!row) continue;
  const contractRefRaw = cleanStr(row[1]);
  if (!contractRefRaw) { skipped++; continue; }

  let contractRef = contractRefRaw;
  let n = 1;
  while (seenRefs.has(contractRef) || get('SELECT id FROM contracts WHERE contract_ref = ?', [contractRef])) {
    contractRef = `${contractRefRaw}-dup${++n}`;
  }
  seenRefs.add(contractRef);

  const quoteRef = cleanStr(row[2]);
  const clientName = cleanStr(row[3]);
  const approvalDate = parseDate(row[4]);
  const salesBy = cleanStr(row[5]);
  const contractValue = parseNumber(row[11]);
  const totalReceived = parseNumber(row[12]) || 0;
  let balanceReceivable = parseNumber(row[13]);
  if (balanceReceivable === null) balanceReceivable = Math.round(((contractValue || 0) - totalReceived) * 100) / 100;
  const remarks = cleanStr(row[21]);

  let projectId = null;
  if (quoteRef) {
    const p = get('SELECT id FROM projects WHERE quote_ref = ? AND is_deleted = 0 LIMIT 1', [quoteRef]);
    if (p) { projectId = p.id; updatedProjectLink++; }
  }

  run(`INSERT INTO contracts
    (contract_ref, quote_ref, project_id, client_name, approval_date, sales_by, contract_value, total_received, balance_receivable, remarks, source_sheet, source_file, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [contractRef, quoteRef, projectId, clientName, approvalDate, salesBy, contractValue, totalReceived, balanceReceivable, remarks,
     'Contracts', 'All Contract Updates .xlsx', 'import']);
  inserted++;
}

console.log(`Contracts import complete: ${inserted} inserted, ${skipped} skipped (no contract ref), ${updatedProjectLink} linked to an existing project via quote_ref.`);
console.log('Total contracts rows in DB now:', get('SELECT COUNT(*) c FROM contracts').c);
