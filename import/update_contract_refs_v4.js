// Contract Ref. correction against the master file "All Contract Updates -a306bf99.xlsx"
// (sheet "Contracts "), per the 2026-06-27 request:
//   - Replace every contracts.contract_ref with the master file's value (single source of truth).
//   - Propagate the new ref to every soft-FK-linked table: maintenance_contracts.contract_ref,
//     maintenance_visit_log.contract_ref.
//   - No duplicates, no blanks; ambiguous matches -> Needs Review; unmatched -> Contract Ref Not Found.
//   - Full changelog (contract_changelog + contract_history) + a JSON audit log for the final report.
//
// Run modes:
//   node update_contract_refs_v4.js <master.xlsx> --dry-run     (default if no flag) - no DB writes
//   node update_contract_refs_v4.js <master.xlsx> --apply       - performs the writes in one transaction
const XLSX = require('xlsx');
const fs = require('fs');
const { db, run, get, all } = require('../db/db.js');

const SRC_FILE = process.argv[2];
const APPLY = process.argv.includes('--apply');
const RUN_BY = 'system-contract-ref-rebuild-2026-06-27';
const AUDIT_OUT = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : '/tmp/staging/contractref/audit_log.json';

if (!SRC_FILE) { console.error('Usage: node update_contract_refs_v4.js <master.xlsx> [auditOut.json] [--apply]'); process.exit(1); }

// ---------- helpers (identical to import_contracts_v3.js for consistency) ----------
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
function baseQuote(q) {
  if (!q) return null;
  const m = /^(\d+)/.exec(String(q).trim());
  return m ? m[1] : String(q).trim().toLowerCase();
}
function normClient(c) {
  if (!c) return '';
  return String(c).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// ---------- read master file ----------
const wb = XLSX.readFile(SRC_FILE, { cellDates: true });
const sheetName = wb.SheetNames.find(n => n.trim() === 'Contracts');
if (!sheetName) { console.error('Sheet "Contracts" not found. Sheets:', wb.SheetNames); process.exit(1); }
const ws = wb.Sheets[sheetName];
const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });

const masterRows = [];
for (let i = 1; i < raw.length; i++) {
  const row = raw[i];
  if (!row) continue;
  const sNo = row[0];
  const contractRef = cleanStr(row[1]);
  const quoteRef = cleanStr(row[2]);
  const clientName = cleanStr(row[3]);
  const contractValue = parseNumber(row[11]);
  if (contractRef === null && clientName === null) continue; // blank row
  if (sNo === 'S.No.' || contractRef === 'Conract Ref.') continue; // header row safeguard
  masterRows.push({ sNo, contractRef, quoteRef, clientName, contractValue });
}
console.log(`Master rows read: ${masterRows.length}`);

// ---------- duplicate/blank validation within master (defensive, per the stated rules) ----------
const blankRefs = masterRows.filter(r => !r.contractRef);
const byRef = new Map();
for (const r of masterRows) {
  if (!r.contractRef) continue;
  if (!byRef.has(r.contractRef)) byRef.set(r.contractRef, []);
  byRef.get(r.contractRef).push(r);
}
const masterDuplicateRefs = [...byRef.entries()].filter(([, g]) => g.length > 1);
console.log(`Master blank refs: ${blankRefs.length}`);
console.log(`Master duplicate refs: ${masterDuplicateRefs.length}`);

// ---------- match each master row to a live, active contract ----------
const existing = all(`SELECT * FROM contracts WHERE is_deleted = 0`);
const existingByKey = new Map();
for (const e of existing) {
  const k = `${baseQuote(e.quote_ref)}|${normClient(e.client_name)}`;
  if (!existingByKey.has(k)) existingByKey.set(k, []);
  existingByKey.get(k).push(e);
}

const matchedExistingIds = new Set();
const matches = [];          // { master, existing }
const needsReviewMaster = []; // master rows matching >1 candidate ambiguously, or matching a contract already claimed
const notFoundMaster = [];    // master rows with no live candidate at all

// Group master rows by the same key used for existingByKey, so ambiguous groups (multiple
// master rows sharing quote_ref+client_name - e.g. several units under one quotation) are
// resolved together rather than one row at a time.
const masterByKey = new Map();
for (const r of masterRows) {
  if (!r.contractRef) { needsReviewMaster.push({ row: r, reason: 'Blank Contract Ref. in master file' }); continue; }
  const k = `${baseQuote(r.quoteRef)}|${normClient(r.clientName)}`;
  if (!masterByKey.has(k)) masterByKey.set(k, []);
  masterByKey.get(k).push(r);
}

for (const [k, group] of masterByKey) {
  const candidates = (existingByKey.get(k) || []).filter(e => !matchedExistingIds.has(e.id));

  if (group.length === 1 && candidates.length === 1) {
    matchedExistingIds.add(candidates[0].id);
    matches.push({ master: group[0], existing: candidates[0] });
    continue;
  }
  if (!candidates.length) { notFoundMaster.push(...group); continue; }

  const remainingMaster = group.slice();
  const remainingCandidates = candidates.slice();

  function numCore(ref) {
    if (!ref) return null;
    const m = /(\d+)/.exec(String(ref));
    return m ? String(parseInt(m[1], 10)) : null;
  }

  // 1) Identity disambiguation: if a live candidate's CURRENT contract_ref's numeric core
  //    (e.g. "09" or "009" -> "9") already matches one of the group's master Contract Ref
  //    numeric cores, that pairing is unambiguous and risk-free - it's the same contract
  //    number, just reformatted (2-digit -> 3-digit zero-padding). Resolve these first.
  for (const cand of candidates.slice()) {
    const candCore = numCore(cand.contract_ref);
    const idx = remainingMaster.findIndex(m => numCore(m.contractRef) === candCore);
    if (idx !== -1) {
      matches.push({ master: remainingMaster[idx], existing: cand });
      matchedExistingIds.add(cand.id);
      remainingMaster.splice(idx, 1);
      remainingCandidates.splice(remainingCandidates.indexOf(cand), 1);
    }
  }

  // 2) Contract Value tie-break for whatever is left in the group.
  for (const m of remainingMaster.slice()) {
    const withValue = remainingCandidates.filter(c => m.contractValue != null && c.contract_value != null);
    if (!withValue.length) continue;
    const best = withValue.slice().sort((a, b) =>
      Math.abs(a.contract_value - m.contractValue) - Math.abs(b.contract_value - m.contractValue))[0];
    if (Math.abs(best.contract_value - m.contractValue) < 1) {
      matches.push({ master: m, existing: best });
      matchedExistingIds.add(best.id);
      remainingMaster.splice(remainingMaster.indexOf(m), 1);
      remainingCandidates.splice(remainingCandidates.indexOf(best), 1);
    }
  }

  // 3) Process of elimination: if exactly one master row and one live candidate remain in
  //    this group after steps 1-2, they must be each other's match (every other member of
  //    the group has already been claimed by a more specific rule) - pair them.
  if (remainingMaster.length === 1 && remainingCandidates.length === 1) {
    matches.push({ master: remainingMaster[0], existing: remainingCandidates[0] });
    matchedExistingIds.add(remainingCandidates[0].id);
    remainingMaster.length = 0;
    remainingCandidates.length = 0;
  }

  // 4) Anything still unresolved in this group is a genuine ambiguity - flag, do not guess.
  for (const m of remainingMaster) {
    needsReviewMaster.push({ row: m, reason: `Multiple live contracts share quote_ref+client_name (group size ${group.length} master / ${candidates.length} live) and cannot be safely disambiguated by Contract Value, ref numeric identity, or elimination`, candidates });
  }
}

const unmatchedExisting = existing.filter(e => !matchedExistingIds.has(e.id));

console.log(`Matched: ${matches.length}`);
console.log(`Needs Review (master side): ${needsReviewMaster.length}`);
console.log(`Contract Ref. Not Found (master row, no live candidate): ${notFoundMaster.length}`);
console.log(`Live active contracts with no master match: ${unmatchedExisting.length}`);

// ---------- enforce: no duplicate / blank Contract Ref. in the FINAL applied set ----------
const finalRefs = matches.map(m => m.master.contractRef);
const finalRefSet = new Set(finalRefs);
const dupCheck = finalRefs.length !== finalRefSet.size;
if (dupCheck) {
  console.error('FATAL: duplicate Contract Ref. values detected in the final matched set - aborting.');
  process.exit(1);
}
if (finalRefs.some(r => !r)) {
  console.error('FATAL: blank Contract Ref. detected in the final matched set - aborting.');
  process.exit(1);
}

// ---------- build change list ----------
const changes = matches.map(({ master, existing }) => ({
  oldRef: existing.contract_ref,
  newRef: master.contractRef,
  clientName: existing.client_name,
  quoteRef: existing.quote_ref,
  contractId: existing.id,
  changed: existing.contract_ref !== master.contractRef,
}));
const toChange = changes.filter(c => c.changed);
console.log(`Contract Ref. values that actually need updating: ${toChange.length}`);
console.log(`Already aligned with master (no change needed): ${changes.length - toChange.length}`);

// ---------- write audit log (always, dry-run or apply) ----------
const auditRows = [];
const nowIso = new Date().toISOString();

function countLinked(oldRef) {
  const mc = get('SELECT COUNT(*) c FROM maintenance_contracts WHERE contract_ref = ? AND is_deleted = 0', [oldRef]).c;
  const vl = get('SELECT COUNT(*) c FROM maintenance_visit_log WHERE contract_ref = ?', [oldRef]).c;
  return { mc, vl };
}

for (const c of changes) {
  const { mc, vl } = countLinked(c.oldRef);
  const modules = ['Contract Records'];
  if (mc > 0) modules.push(`Maintenance Records (${mc} record${mc === 1 ? '' : 's'})`);
  if (vl > 0) modules.push(`Service History / Monthly Visit Log (${vl} row${vl === 1 ? '' : 's'})`);
  auditRows.push({
    oldContractRef: c.oldRef,
    newContractRef: c.newRef,
    clientName: c.clientName,
    quotationRef: c.quoteRef,
    modulesUpdated: c.changed ? modules : ['Contract Records (no change - already correct)'],
    dateTime: nowIso,
    status: 'Success',
  });
}
for (const nr of needsReviewMaster) {
  auditRows.push({
    oldContractRef: null,
    newContractRef: nr.row.contractRef || '(blank in master)',
    clientName: nr.row.clientName,
    quotationRef: nr.row.quoteRef,
    modulesUpdated: [],
    dateTime: nowIso,
    status: 'Needs Review',
    reason: nr.reason,
  });
}
for (const r of notFoundMaster) {
  auditRows.push({
    oldContractRef: null,
    newContractRef: r.contractRef,
    clientName: r.clientName,
    quotationRef: r.quoteRef,
    modulesUpdated: [],
    dateTime: nowIso,
    status: 'Contract Ref Not Found',
    reason: 'Master file row has no matching live contract record (quote_ref + client_name) - not guessed, no DB row created',
  });
}
for (const u of unmatchedExisting) {
  auditRows.push({
    oldContractRef: u.contract_ref,
    newContractRef: null,
    clientName: u.client_name,
    quotationRef: u.quote_ref,
    modulesUpdated: [],
    dateTime: nowIso,
    status: 'Contract Ref Not Found',
    reason: 'Live contract record not found in the master file (All Contract Updates -a306bf99.xlsx) - left untouched',
  });
}

fs.mkdirSync(require('path').dirname(AUDIT_OUT), { recursive: true });
fs.writeFileSync(AUDIT_OUT, JSON.stringify({
  generatedAt: nowIso,
  masterFile: SRC_FILE,
  mode: APPLY ? 'apply' : 'dry-run',
  summary: {
    totalMasterRows: masterRows.length,
    totalMatched: matches.length,
    totalRefsUpdated: toChange.length,
    totalAlreadyAligned: changes.length - toChange.length,
    totalNeedsReview: needsReviewMaster.length,
    totalNotFoundMasterSide: notFoundMaster.length,
    totalNotFoundLiveSide: unmatchedExisting.length,
    totalMasterDuplicateRefs: masterDuplicateRefs.length,
    totalMasterBlankRefs: blankRefs.length,
  },
  rows: auditRows,
}, null, 2));
console.log(`Audit log written: ${AUDIT_OUT}`);

if (!APPLY) {
  console.log('--- DRY RUN ONLY: no database writes performed ---');
  process.exit(0);
}

// ---------- APPLY: perform the writes in one transaction ----------
db.exec('BEGIN');
try {
  let mcTotal = 0, vlTotal = 0;
  for (const c of toChange) {
    const collision = get('SELECT id FROM contracts WHERE contract_ref = ? AND id != ? AND is_deleted = 0', [c.newRef, c.contractId]);
    if (collision) throw new Error(`Refusing to set contract_ref='${c.newRef}' on contract id=${c.contractId}: already used by contract id=${collision.id}`);

    run(`UPDATE contracts SET contract_ref = ?, updated_at = datetime('now') WHERE id = ?`, [c.newRef, c.contractId]);

    const mcRes = run(`UPDATE maintenance_contracts SET contract_ref = ?, updated_at = datetime('now') WHERE contract_ref = ? AND is_deleted = 0`, [c.newRef, c.oldRef]);
    const vlRes = run(`UPDATE maintenance_visit_log SET contract_ref = ?, updated_at = datetime('now') WHERE contract_ref = ?`, [c.newRef, c.oldRef]);
    mcTotal += mcRes.changes; vlTotal += vlRes.changes;

    run(`INSERT INTO contract_history (contract_id, field_name, old_value, new_value, changed_by, remarks)
         VALUES (?, 'contract_ref', ?, ?, ?, ?)`,
      [c.contractId, c.oldRef, c.newRef, RUN_BY, 'Corrected to match master file All Contract Updates -a306bf99.xlsx (3-digit zero-padded format)']);

    run(`INSERT INTO contract_changelog (old_contract_ref, new_contract_ref, client_name, reason, changed_by)
         VALUES (?, ?, ?, ?, ?)`,
      [c.oldRef, c.newRef, c.clientName, 'Contract Ref. corrected to match updated master file (All Contract Updates -a306bf99.xlsx)', RUN_BY]);
  }

  for (const nr of needsReviewMaster) {
    run(`INSERT INTO contract_duplicate_review (contract_ref, client_name, duplicate_of_ref, reason, status)
         VALUES (?, ?, ?, ?, 'Needs Review')`,
      [nr.row.contractRef, nr.row.clientName, nr.row.quoteRef || null, nr.reason]);
  }

  db.exec('COMMIT');
  console.log('--- APPLY COMMITTED ---');
  console.log(`contracts.contract_ref updated: ${toChange.length}`);
  console.log(`maintenance_contracts.contract_ref rows updated: ${mcTotal}`);
  console.log(`maintenance_visit_log.contract_ref rows updated: ${vlTotal}`);
} catch (e) {
  db.exec('ROLLBACK');
  console.error('ROLLED BACK:', e.message);
  process.exit(1);
}
