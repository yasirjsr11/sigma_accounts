// Re-sync of the Contracts module from the corrected source file
// "All Contract Updates -a306bf99.xlsx" -> sheet "Contracts " (note trailing space).
//
// This is an UPSERT, not a wipe-and-reload: existing contracts are matched by
// contract_ref and updated in place (preserves id, created_at, created_by, remarks,
// and contract_history audit trail); rows with a contract_ref not yet in the DB are
// inserted. The old payment-tracking sheet ("Sheet1" in the same workbook) is
// intentionally NOT imported - that feature was dropped per product decision.
//
// Run from a local (non-mounted) copy of the app dir if the live DB lives on a
// network/FUSE mount (ALTER/INSERT-heavy operations can throw "disk I/O error" on
// some mounts) - see db/migrate_contracts_redesign.js for the same caveat.
const XLSX = require('xlsx');
const { run, get, all } = require('../db/db.js');

const SRC_FILE = process.argv[2];
if (!SRC_FILE) { console.error('Usage: node import_contracts_v2.js <path-to-xlsx>'); process.exit(1); }

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
if (!sheetName) { console.error('Sheet "Contracts " not found. Sheets:', wb.SheetNames); process.exit(1); }
const ws = wb.Sheets[sheetName];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });

// Row 1 = title banner, Row 2 = column headers, Row 3 = blank, Row 4+ = data
// (0-indexed: rows[0]=title, rows[1]=headers, rows[2]=blank, rows[3..]=data)
let inserted = 0, updated = 0, skipped = 0, linked = 0;
const seenRefs = new Set();

for (let i = 3; i < rows.length; i++) {
  const row = rows[i];
  if (!row) continue;
  const contractRefRaw = cleanStr(row[1]);
  if (!contractRefRaw) { skipped++; continue; }

  let contractRef = contractRefRaw;
  let n = 1;
  while (seenRefs.has(contractRef)) contractRef = `${contractRefRaw}-dup${++n}`;
  seenRefs.add(contractRef);

  const quoteRef = cleanStr(row[2]);
  const clientName = cleanStr(row[3]);
  const emirate = cleanStr(row[4]);
  const approvalDate = parseDate(row[5]);
  const salesBy = cleanStr(row[6]);
  const deliveryStatus = cleanStr(row[7]);
  const mechanicalStatus = cleanStr(row[8]);
  const electricalStatus = cleanStr(row[9]);
  const handoverDate = parseDate(row[10]);
  const contractValue = parseNumber(row[11]);

  let projectId = null;
  if (quoteRef) {
    const p = get('SELECT id FROM projects WHERE quote_ref = ? AND is_deleted = 0 LIMIT 1', [quoteRef]);
    if (p) { projectId = p.id; linked++; }
  }

  const existing = get('SELECT id FROM contracts WHERE contract_ref = ?', [contractRef]);
  if (existing) {
    run(`UPDATE contracts SET
          quote_ref = ?, project_id = ?, client_name = ?, emirate = ?, approval_date = ?, sales_by = ?,
          delivery_status = ?, mechanical_status = ?, electrical_status = ?, handover_date = ?, contract_value = ?,
          source_sheet = ?, source_file = ?, updated_at = datetime('now')
        WHERE id = ?`,
      [quoteRef, projectId, clientName, emirate, approvalDate, salesBy,
       deliveryStatus, mechanicalStatus, electricalStatus, handoverDate, contractValue,
       'Contracts', 'All Contract Updates -a306bf99.xlsx', existing.id]);
    updated++;
  } else {
    run(`INSERT INTO contracts
      (contract_ref, quote_ref, project_id, client_name, emirate, approval_date, sales_by,
       delivery_status, mechanical_status, electrical_status, handover_date, contract_value,
       source_sheet, source_file, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [contractRef, quoteRef, projectId, clientName, emirate, approvalDate, salesBy,
       deliveryStatus, mechanicalStatus, electricalStatus, handoverDate, contractValue,
       'Contracts', 'All Contract Updates -a306bf99.xlsx', 'import']);
    inserted++;
  }
}

console.log(`Contracts re-sync complete: ${inserted} inserted, ${updated} updated, ${skipped} skipped (no contract ref), ${linked} linked to an existing project via quote_ref.`);
console.log('Total contracts rows in DB now:', get('SELECT COUNT(*) c FROM contracts').c);
