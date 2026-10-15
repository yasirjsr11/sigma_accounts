// Builds the new Maintenance Records module from "AMC track 2025.xlsx", consolidating
// 3 of its 4 sheets (Expiry = status/period/remarks registry, HWC Drafts = lifts/client/
// contract-period registry, Month Track = per-month visit history). Sheet1 is a small
// redundant 2-month extract of Month Track and is not separately needed.
//
// Purely additive: writes only to maintenance_contracts / maintenance_visit_log
// (created by db/migrate_maintenance_contracts.js). Never touches maintenance_records,
// amc_contracts, projects, or contracts.
//
// Contract Ref. matching rule (per spec): look up the normalized ref against the
// Contracts master (contracts.contract_ref). Found -> contract_ref_status='Linked'.
// Blank in source -> 'Pending Contract Ref'. Non-blank but not found -> 'Contract Ref Not Found'.
const XLSX = require('xlsx');
const { run, get, all } = require('../db/db.js');

const SRC_FILE = process.argv[2] || 'import_src/amc_master.xlsx';
const TODAY = new Date().toISOString().slice(0, 10); // 2026-06-26

function cleanStr(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s.length ? s : null;
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
  if (!s || s === '-' ) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
function parseIntSafe(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/[^0-9]/g, '');
  return s ? parseInt(s, 10) : null;
}
// Normalize "SH29" / "SHM2026 " / "SH-04" / " sh37 " -> "SH-29" / "SHM-2026" / "SH-04" / "SH-37"
function normRef(v) {
  const s = cleanStr(v);
  if (!s) return null;
  const compact = s.replace(/\s+/g, '');
  const m = /^([A-Za-z]+)-?(\d+)$/.exec(compact);
  if (m) return `${m[1].toUpperCase()}-${m[2]}`;
  // No clean letters+digits match (e.g. combined refs like "SH89-90", "SHM2007-08",
  // or region header rows like "DUBAI"). Only treat as a real (if irregular) ref
  // if it contains at least one digit; pure-letter strings are region headers, not refs.
  if (!/\d/.test(compact)) return null;
  return compact.toUpperCase();
}
function extractFrequency(text) {
  if (!text) return null;
  const m = /\(([^)]*\b(?:month|months|weekly|week|year|annual)[^)]*)\)/i.exec(text);
  return m ? m[1].trim() : null;
}

const wb = XLSX.readFile(SRC_FILE, { cellDates: true });

// ---------- Sheet: Expiry ----------
const expiryWs = wb.Sheets[wb.SheetNames.find(n => n.trim() === 'Expiry')];
const expiryRaw = XLSX.utils.sheet_to_json(expiryWs, { header: 1, defval: null, raw: true });
const expiryByRef = new Map();
for (let i = 1; i < expiryRaw.length; i++) { // row0 = header
  const row = expiryRaw[i];
  if (!row) continue;
  const ref = normRef(row[0]);
  if (!ref) continue;
  expiryByRef.set(ref, {
    ref,
    quantity: parseIntSafe(row[1]),
    clientName: cleanStr(row[2]),
    emirate: cleanStr(row[3]),
    status: cleanStr(row[4]),
    maintenancePeriod: parseIntSafe(row[5]),
    startDate: parseDate(row[6]),
    endDate: parseDate(row[7]),
    remarks: cleanStr(row[8]),
  });
}
console.log(`Expiry sheet: ${expiryByRef.size} unique Contract Ref rows`);

// ---------- Sheet: HWC Drafts ----------
const hwcWs = wb.Sheets[wb.SheetNames.find(n => n.trim() === 'HWC Drafts')];
const hwcRaw = XLSX.utils.sheet_to_json(hwcWs, { header: 1, defval: null, raw: true });
const hwcByRef = new Map();
for (let i = 2; i < hwcRaw.length; i++) { // row0 = title, row1 = header
  const row = hwcRaw[i];
  if (!row) continue;
  const ref = normRef(row[1]);
  if (!ref) continue;
  hwcByRef.set(ref, {
    ref,
    lifts: parseIntSafe(row[2]),
    clientName: cleanStr(row[3]),
    contractDate: parseDate(row[4]),
    endDate: parseDate(row[5]),
  });
}
console.log(`HWC Drafts sheet: ${hwcByRef.size} unique Contract Ref rows`);

// ---------- Sheet: Month Track ----------
const mtWs = wb.Sheets[wb.SheetNames.find(n => n.trim() === 'Month Track')];
const mtRaw = XLSX.utils.sheet_to_json(mtWs, { header: 1, defval: null, raw: true });
const monthHeaders = mtRaw[0].slice(4).map(h => cleanStr(h)).filter(Boolean); // "Jan'25"..."Sep'26"
const mtByRef = new Map();
for (let i = 1; i < mtRaw.length; i++) {
  const row = mtRaw[i];
  if (!row) continue;
  const ref = normRef(row[0]);
  if (!ref) continue; // skips region header rows like "DUBAI" (no numeric ref)
  const visits = [];
  for (let m = 0; m < monthHeaders.length; m++) {
    const cellVal = row[4 + m];
    visits.push({ month: monthHeaders[m], raw: cellVal });
  }
  mtByRef.set(ref, {
    ref,
    lifts: parseIntSafe(row[1]),
    clientName: cleanStr(row[2]),
    location: cleanStr(row[3]),
    visits,
  });
}
console.log(`Month Track sheet: ${mtByRef.size} unique Contract Ref rows, ${monthHeaders.length} month columns (${monthHeaders[0]}..${monthHeaders[monthHeaders.length-1]})`);

// ---------- Consolidate by ref (union of all 3 sheets) ----------
const allRefs = new Set([...expiryByRef.keys(), ...hwcByRef.keys(), ...mtByRef.keys()]);
console.log(`Total unique Contract Ref values across all 3 sheets: ${allRefs.size}`);

const contractsByRef = new Map(all('SELECT contract_ref, client_name, emirate FROM contracts').map(c => [c.contract_ref, c]));

let linked = 0, notFound = 0, pending = 0, active = 0, expired = 0, cancelled = 0, inserted = 0, updated = 0, visitRows = 0;
const monthKeyToYYYYMM = (mh) => { // "Jan'25" -> "2025-01"
  const [mon, yy] = mh.split("'");
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mi = months.indexOf(mon);
  return `20${yy}-${String(mi + 1).padStart(2, '0')}`;
};

for (const ref of allRefs) {
  const e = expiryByRef.get(ref);
  const h = hwcByRef.get(ref);
  const mt = mtByRef.get(ref);

  const clientName = h?.clientName || e?.clientName || mt?.clientName || null;
  const projectSiteName = e?.remarks || mt?.clientName || h?.clientName || null;
  const emirate = e?.emirate || null;
  const lifts = h?.lifts ?? mt?.lifts ?? e?.quantity ?? null;
  const startDate = e?.startDate || h?.contractDate || null;
  const endDate = e?.endDate || h?.endDate || null;
  const maintenancePeriod = e?.maintenancePeriod || null;
  const remarks = e?.remarks || null;
  const serviceFrequency = extractFrequency(mt?.clientName) ||
    (maintenancePeriod ? `Every ${maintenancePeriod} Month(s)` : null);

  // Contract Ref. matching against the Contracts master
  let contractRefStatus;
  if (!ref) { contractRefStatus = 'Pending Contract Ref'; pending++; }
  else if (contractsByRef.has(ref)) { contractRefStatus = 'Linked'; linked++; }
  else { contractRefStatus = 'Contract Ref Not Found'; notFound++; }

  const linkedContract = contractsByRef.get(ref);
  const linkedContractStatus = linkedContract ? 'Linked to active sales contract' : null;

  // Renewal status
  let renewalStatus;
  if (e?.status && /cancel/i.test(e.status)) { renewalStatus = 'Cancelled'; cancelled++; }
  else if (endDate && endDate < TODAY) { renewalStatus = 'Expired / Renewal Required'; expired++; }
  else { renewalStatus = 'Active Maintenance'; active++; }

  // Visit log + last/next/this-month service status from Month Track
  let lastServiceDate = null, nextServiceDate = null, monthlyServiceStatus = null, assignedTechnician = null;
  const visitInserts = [];
  if (mt) {
    for (const v of mt.visits) {
      const ym = monthKeyToYYYYMM(v.month);
      let status, visitDate = null, technician = null, completionDate = null;
      const raw = v.raw;
      if (raw instanceof Date) {
        status = 'Completed'; visitDate = parseDate(raw); completionDate = visitDate;
      } else if (typeof raw === 'number') {
        visitDate = parseDate(raw);
        if (visitDate) { status = 'Completed'; completionDate = visitDate; }
        else { status = 'Pending'; }
      } else if (typeof raw === 'string') {
        const s = raw.trim();
        if (!s) { status = 'Not Active'; }
        else if (s === '-') { status = 'Not Active'; }
        else if (/^miss/i.test(s)) { status = 'Missed'; }
        else if (/^resched/i.test(s)) { status = 'Rescheduled'; }
        else if (/^cancel/i.test(s)) { status = 'Not Active'; } // contract cancelled - not a technician code
        else { status = 'Completed'; technician = s; } // technician initials = visit done, no date logged
      } else {
        status = 'Pending';
      }
      visitInserts.push({ ym, monthLabel: v.month, status, visitDate, technician, completionDate });
      if (technician) assignedTechnician = technician;
      if (status === 'Completed' && ym <= TODAY.slice(0, 7)) lastServiceDate = visitDate || lastServiceDate;
    }
    const curYm = TODAY.slice(0, 7);
    const curEntry = visitInserts.find(v => v.ym === curYm);
    if (curEntry) monthlyServiceStatus = curEntry.status;
    const future = visitInserts.filter(v => v.ym > curYm && v.visitDate);
    if (future.length) nextServiceDate = future.sort((a, b) => a.visitDate.localeCompare(b.visitDate))[0].visitDate;
  }

  const maintenanceId = `AMC-${ref}`;
  const existing = get('SELECT id FROM maintenance_contracts WHERE maintenance_id = ?', [maintenanceId]);
  const params = [
    maintenanceId, ref, contractRefStatus, clientName, projectSiteName, emirate,
    'AMC', maintenancePeriod, startDate, endDate, serviceFrequency, monthlyServiceStatus,
    lastServiceDate, nextServiceDate, assignedTechnician, remarks, renewalStatus, linkedContractStatus,
    lifts, [e && 'Expiry', h && 'HWC Drafts', mt && 'Month Track'].filter(Boolean).join('+'),
    'AMC track 2025.xlsx'
  ];
  let maintenanceContractId;
  if (existing) {
    run(`UPDATE maintenance_contracts SET
          contract_ref=?, contract_ref_status=?, client_name=?, project_site_name=?, emirate=?,
          maintenance_type=?, maintenance_period=?, start_date=?, end_date=?, service_frequency=?,
          monthly_service_status=?, last_service_date=?, next_service_date=?, assigned_technician=?,
          remarks=?, renewal_status=?, linked_contract_status=?, lifts_qty=?, source_sheet=?, source_file=?,
          updated_at=datetime('now')
        WHERE id=?`,
      [ref, contractRefStatus, clientName, projectSiteName, emirate, 'AMC', maintenancePeriod, startDate, endDate,
       serviceFrequency, monthlyServiceStatus, lastServiceDate, nextServiceDate, assignedTechnician, remarks,
       renewalStatus, linkedContractStatus, lifts, params[18], params[19], existing.id]);
    maintenanceContractId = existing.id;
    updated++;
  } else {
    run(`INSERT INTO maintenance_contracts
      (maintenance_id, contract_ref, contract_ref_status, client_name, project_site_name, emirate,
       maintenance_type, maintenance_period, start_date, end_date, service_frequency, monthly_service_status,
       last_service_date, next_service_date, assigned_technician, remarks, renewal_status, linked_contract_status,
       lifts_qty, source_sheet, source_file, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [...params, 'system-rebuild-2026-06-26']);
    maintenanceContractId = get('SELECT id FROM maintenance_contracts WHERE maintenance_id = ?', [maintenanceId]).id;
    inserted++;
  }

  for (const v of visitInserts) {
    const ex = get('SELECT id FROM maintenance_visit_log WHERE contract_ref=? AND month=?', [ref, v.ym]);
    if (ex) {
      run(`UPDATE maintenance_visit_log SET maintenance_contract_id=?, visit_date=?, technician=?, status=?, completion_date=?, updated_at=datetime('now') WHERE id=?`,
        [maintenanceContractId, v.visitDate, v.technician, v.status, v.completionDate, ex.id]);
    } else {
      run(`INSERT INTO maintenance_visit_log (maintenance_contract_id, contract_ref, month, visit_date, technician, status, completion_date)
           VALUES (?,?,?,?,?,?,?)`, [maintenanceContractId, ref, v.ym, v.visitDate, v.technician, v.status, v.completionDate]);
    }
    visitRows++;
  }
}

console.log('--- SUMMARY ---');
console.log('Total maintenance contract records:', allRefs.size, '(inserted', inserted, ', updated', updated, ')');
console.log('Contract Ref. Linked:', linked);
console.log('Contract Ref. Not Found:', notFound);
console.log('Pending Contract Ref.:', pending);
console.log('Active Maintenance:', active);
console.log('Expired / Renewal Required:', expired);
console.log('Cancelled:', cancelled);
console.log('Visit log rows written/updated:', visitRows);
console.log('Total maintenance_contracts in DB now:', get('SELECT COUNT(*) c FROM maintenance_contracts').c);
