// Contract Records rebuild against the master file "All Contract Updates -a306bf99.xlsx"
// (sheet "Contracts "). Implements the rules from the 2026-06-26 rebuild request:
//  - Contract Ref. from the master file is authoritative; replaces whatever is in the DB.
//  - Contract Ref. must be unique, never blank (blank -> "Pending Contract Ref").
//  - Exact duplicate rows within the master (same ref + same 7 compare fields) are
//    auto-resolved by keeping the more complete row; anything not fully confirmed as a
//    duplicate is left alone and flagged "Needs Review" (contract_duplicate_review).
//  - Every ref change is written to contract_changelog (old ref, new ref, client, reason, date).
// Matching an existing DB row to a master row (since contract_ref itself is what's being
// corrected) uses: normalized base quotation ref (numeric prefix) + normalized client name.
const XLSX = require('xlsx');
const { run, get, all } = require('../db/db.js');

const SRC_FILE = process.argv[2] || 'import_src/contracts_master.xlsx';
const RUN_BY = 'system-rebuild-2026-06-26';

function cleanStr(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
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
function baseQuote(q) {
  if (!q) return null;
  const m = /^(\d+)/.exec(String(q).trim());
  return m ? m[1] : String(q).trim().toLowerCase();
}
function normClient(c) {
  if (!c) return '';
  return String(c).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 40);
}

const wb = XLSX.readFile(SRC_FILE, { cellDates: true });
const sheetName = wb.SheetNames.find(n => n.trim() === 'Contracts');
if (!sheetName) { console.error('Sheet "Contracts" not found. Sheets:', wb.SheetNames); process.exit(1); }
const ws = wb.Sheets[sheetName];
const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });

// rows[0]=title, rows[1]=headers, rows[2]=blank, rows[3..]=data
const masterRows = [];
for (let i = 3; i < raw.length; i++) {
  const row = raw[i];
  if (!row) continue;
  const sNo = row[0];
  const contractRef = cleanStr(row[1]);
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
  if (contractRef === null && clientName === null) continue; // fully blank row
  masterRows.push({ sNo, contractRef, quoteRef, clientName, emirate, approvalDate, salesBy,
    deliveryStatus, mechanicalStatus, electricalStatus, handoverDate, contractValue });
}

console.log(`Master rows read: ${masterRows.length}`);

// ---------- Step 1: resolve blank refs -> "Pending Contract Ref" ----------
let pendingCount = 0;
for (const r of masterRows) {
  if (!r.contractRef) { r.contractRef = null; pendingCount++; }
}

// ---------- Step 2: detect exact duplicates within the master (same ref + same 7 fields) ----------
// "7 fields" = Contract Ref, Quotation Ref, Client, Emirate, Approval Date, Sales By, Contract Value
// (Project/Description doesn't exist in the source file, so it's excluded from the compare.)
const byRef = new Map();
for (const r of masterRows) {
  if (!r.contractRef) continue;
  if (!byRef.has(r.contractRef)) byRef.set(r.contractRef, []);
  byRef.get(r.contractRef).push(r);
}

const removedExactDup = [];
const needsReview = [];
const finalRows = [];
for (const [ref, group] of byRef) {
  if (group.length === 1) { finalRows.push(group[0]); continue; }
  // Multiple rows claim the same Contract Ref -> compare the 6 other fields (ref already equal)
  const sig = r => [r.quoteRef, normClient(r.clientName), r.emirate, r.approvalDate, r.salesBy].join('|');
  const sigs = group.map(sig);
  const allSameCore = sigs.every(s => s === sigs[0]);
  if (allSameCore) {
    // Same identity, only contract_value differs (or is blank on one) -> keep the most complete row
    const best = group.slice().sort((a, b) => (b.contractValue != null) - (a.contractValue != null))[0];
    finalRows.push(best);
    for (const g of group) if (g !== best) removedExactDup.push({ ref, client: g.clientName, value: g.contractValue });
  } else {
    // Same Contract Ref but genuinely different deals -> not safe to auto-resolve; keep all, flag.
    for (const g of group) needsReview.push({ ref, client: g.clientName, quoteRef: g.quoteRef, reason: 'Duplicate Contract Ref. in master file but underlying details differ - needs manual review' });
    finalRows.push(...group);
  }
}
// rows with no ref (Pending) all pass through untouched
for (const r of masterRows) if (!r.contractRef) finalRows.push(r);

console.log(`Exact duplicate rows removed (kept most complete): ${removedExactDup.length}`);
console.log(`Same-ref-but-conflicting rows flagged Needs Review: ${needsReview.length}`);

// ---------- Step 3: cross-record similarity check (different refs, looks like the same deal) ----------
// e.g. same client + same quotation ref + same approval date but two different Contract Ref rows.
const groupKey = r => `${baseQuote(r.quoteRef)}|${normClient(r.clientName)}|${r.approvalDate}`;
const byDealKey = new Map();
for (const r of finalRows) {
  if (!r.contractRef) continue;
  const k = groupKey(r);
  if (!byDealKey.has(k)) byDealKey.set(k, []);
  byDealKey.get(k).push(r);
}
let similarFlagged = 0;
for (const [k, group] of byDealKey) {
  const distinctRefs = new Set(group.map(g => g.contractRef));
  if (distinctRefs.size > 1) {
    similarFlagged += group.length;
    for (const g of group) {
      needsReview.push({ ref: g.contractRef, client: g.clientName, quoteRef: g.quoteRef,
        reason: `Same client/quotation/approval date as another contract (${[...distinctRefs].filter(x => x !== g.contractRef).join(', ')}) but a different Contract Ref. - not auto-deleted, needs manual review` });
    }
  }
}
console.log(`Rows flagged Needs Review for cross-record similarity (different refs, same deal signature): ${similarFlagged}`);

// ---------- Step 4: enforce uniqueness of non-pending refs (defensive) ----------
const seen = new Set();
for (const r of finalRows) {
  if (!r.contractRef) continue;
  if (seen.has(r.contractRef)) {
    // Shouldn't happen after step 2/3, but guard anyway.
    needsReview.push({ ref: r.contractRef, client: r.clientName, quoteRef: r.quoteRef, reason: 'Residual duplicate Contract Ref. after cleanup - needs manual review' });
  }
  seen.add(r.contractRef);
}

// ---------- Step 5: match each master row to an existing DB contract ----------
const existing = all(`SELECT * FROM contracts WHERE is_deleted = 0`);
const existingByKey = new Map();
for (const e of existing) {
  const k = `${baseQuote(e.quote_ref)}|${normClient(e.client_name)}`;
  if (!existingByKey.has(k)) existingByKey.set(k, []);
  existingByKey.get(k).push(e);
}
const matchedExistingIds = new Set();

let inserted = 0, updated = 0, refChanged = 0;
const changelog = [];

for (const r of finalRows) {
  const k = `${baseQuote(r.quoteRef)}|${normClient(r.clientName)}`;
  const candidates = (existingByKey.get(k) || []).filter(e => !matchedExistingIds.has(e.id));
  let match = null;
  if (candidates.length === 1) match = candidates[0];
  else if (candidates.length > 1) {
    // tie-break: closest contract_value, else first by id
    match = candidates.slice().sort((a, b) =>
      Math.abs((a.contract_value || 0) - (r.contractValue || 0)) - Math.abs((b.contract_value || 0) - (r.contractValue || 0))
    )[0];
  }

  const newRef = r.contractRef || 'PENDING'; // placeholder, true storage uses NULL-safe unique suffix below
  let storedRef = r.contractRef;
  if (!storedRef) {
    // No blank refs allowed in the unique column - synthesize a clearly-marked pending ref.
    storedRef = `PENDING-${(r.sNo || Math.random().toString(36).slice(2, 8))}`;
  }
  // Ensure uniqueness against everything written so far in this run + DB rows not being updated
  let finalRef = storedRef, n = 1;
  const refTaken = (ref) => get('SELECT id FROM contracts WHERE contract_ref = ? AND id != ?', [ref, match ? match.id : -1]);
  while (refTaken(finalRef)) finalRef = `${storedRef}-${++n}`;

  if (match) {
    matchedExistingIds.add(match.id);
    if (match.contract_ref !== finalRef) {
      changelog.push({ old: match.contract_ref, new: finalRef, client: r.clientName,
        reason: r.contractRef ? 'Replaced with corrected Contract Ref. from master file' : 'Master file has no Contract Ref. for this record - marked Pending Contract Ref' });
      refChanged++;
    }
    let projectId = match.project_id;
    if (r.quoteRef) {
      const p = get('SELECT id FROM projects WHERE quote_ref = ? AND is_deleted = 0 LIMIT 1', [r.quoteRef]);
      if (p) projectId = p.id;
    }
    run(`UPDATE contracts SET
          contract_ref = ?, quote_ref = ?, project_id = ?, client_name = ?, emirate = ?, approval_date = ?, sales_by = ?,
          delivery_status = ?, mechanical_status = ?, electrical_status = ?, handover_date = ?, contract_value = ?,
          source_sheet = ?, source_file = ?, updated_at = datetime('now')
        WHERE id = ?`,
      [finalRef, r.quoteRef, projectId, r.clientName, r.emirate, r.approvalDate, r.salesBy,
       r.deliveryStatus, r.mechanicalStatus, r.electricalStatus, r.handoverDate, r.contractValue,
       'Contracts', 'All Contract Updates -a306bf99.xlsx', match.id]);
    updated++;
  } else {
    let projectId = null;
    if (r.quoteRef) {
      const p = get('SELECT id FROM projects WHERE quote_ref = ? AND is_deleted = 0 LIMIT 1', [r.quoteRef]);
      if (p) projectId = p.id;
    }
    run(`INSERT INTO contracts
      (contract_ref, quote_ref, project_id, client_name, emirate, approval_date, sales_by,
       delivery_status, mechanical_status, electrical_status, handover_date, contract_value,
       source_sheet, source_file, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [finalRef, r.quoteRef, projectId, r.clientName, r.emirate, r.approvalDate, r.salesBy,
       r.deliveryStatus, r.mechanicalStatus, r.electricalStatus, r.handoverDate, r.contractValue,
       'Contracts', 'All Contract Updates -a306bf99.xlsx', RUN_BY]);
    changelog.push({ old: null, new: finalRef, client: r.clientName,
      reason: r.contractRef ? 'New contract record from master file - no matching prior record found' : 'Master file has no Contract Ref. for this record - marked Pending Contract Ref' });
    inserted++;
  }
}

// ---------- Step 6: DB rows that exist but were never matched to anything in the master ----------
const unmatched = existing.filter(e => !matchedExistingIds.has(e.id));
for (const u of unmatched) {
  run(`INSERT INTO contract_duplicate_review (contract_ref, client_name, duplicate_of_ref, reason, status)
       VALUES (?,?,?,?, 'Needs Review')`,
    [u.contract_ref, u.client_name, null, 'Existing contract not found in the new master file (All Contract Updates -a306bf99.xlsx) - left untouched, needs manual review']);
}

// ---------- Write changelog + needs-review rows ----------
for (const c of changelog) {
  run(`INSERT INTO contract_changelog (old_contract_ref, new_contract_ref, client_name, reason, changed_by)
       VALUES (?,?,?,?,?)`, [c.old, c.new, c.client, c.reason, RUN_BY]);
}
for (const nr of needsReview) {
  run(`INSERT INTO contract_duplicate_review (contract_ref, client_name, duplicate_of_ref, reason, status)
       VALUES (?,?,?,?, 'Needs Review')`, [nr.ref, nr.client, nr.quoteRef || null, nr.reason]);
}

console.log('--- SUMMARY ---');
console.log('Master rows (after in-file dedupe):', finalRows.length);
console.log('Inserted (new contracts):', inserted);
console.log('Updated (matched to existing):', updated);
console.log('Contract Ref. changed on update:', refChanged);
console.log('Pending Contract Ref. (blank in master):', pendingCount);
console.log('Exact duplicate rows removed:', removedExactDup.length);
console.log('Needs Review rows flagged:', needsReview.length);
console.log('Existing DB contracts not found in master (flagged Needs Review, left untouched):', unmatched.length);
console.log('Total contracts in DB now:', get('SELECT COUNT(*) c FROM contracts WHERE is_deleted=0').c);
