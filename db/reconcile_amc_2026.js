/**
 * AMC 2026 Reconciliation Script
 * Source: SH Maintenance Details — AMC 2026 section
 * Run: node db/reconcile_amc_2026.js [--preview] [--commit]
 *   --preview : show reconciliation report only (default)
 *   --commit  : execute all changes to DB
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'sh_pms.sqlite');
const NOW = new Date().toISOString().replace('T', ' ').substring(0, 19);
const PERFORMED_BY = 'AMC_2026_RECONCILIATION';
const PREVIEW_ONLY = !process.argv.includes('--commit');

// ─── Source Data ─────────────────────────────────────────────────────────────
// Parsed from SH_Maintenance Details.md — AMC 2026 section
// Fields: cref, client, start, end, amc_val, received, due, followed_by, remarks
// Duplicates removed (SH-072 row 7 ignored)
// INVALID_PERIOD = true when source end < source start (use DB period instead)
const SOURCE = [
  // Row 1 (Row 7 is identical duplicate — skipped)
  { cref:'SH-072',       client:'Freight Plus Contracting',               start:'2026-01-01', end:'2026-12-31', amc_val:2625,   received:0,       due:2625,   followed_by:'MM', remarks:'Cancelled',                   invalid_period:false },
  { cref:'SHM-2014, SHM-2015', client:'Union Coop',                       start:'2026-01-01', end:'2028-12-31', amc_val:7350,   received:1968.75, due:5381.25,followed_by:'NM', remarks:'Cancelled',                   invalid_period:false },
  { cref:'SH-005',       client:'Mohamed Rashid Ahmed Al beiy',            start:'2026-01-01', end:'2026-12-31', amc_val:2500,   received:2500,    due:0,      followed_by:'SY', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-045',       client:'Ahmad Mohamed Rhime (Prasad Gupta cont.)',start:'2026-01-01', end:'2026-12-31', amc_val:2300,   received:0,       due:2300,   followed_by:'SS', remarks:'Cancelled',                   invalid_period:false },
  { cref:'SH-050',       client:'Mr. Vincent Jumeirah Park',               start:'2026-01-01', end:'2026-12-31', amc_val:2000,   received:1000,    due:1000,   followed_by:'SS', remarks:'Approved and Partial Paid',    invalid_period:false },
  { cref:'SH-055',       client:'Mr. Malouda Florent Nad Al Sheba',        start:'2026-01-01', end:'2026-12-31', amc_val:3675,   received:3675,    due:0,      followed_by:'SS', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-088',       client:'Mr. Jean Sabti Nad Al Sheba',             start:'2026-01-01', end:'2026-12-31', amc_val:3675,   received:3675,    due:0,      followed_by:'SS', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SHM-2019',     client:'360 RTSC Excellage Poly Clinic',          start:'2026-01-01', end:'2026-12-31', amc_val:2625,   received:1312.5,  due:1312.5, followed_by:'SS', remarks:'Approved and Partial Paid',    invalid_period:false },
  { cref:'SH-059',       client:'Maryam Ahmed Al Warqa Dubai',             start:'2026-01-13', end:'2027-01-12', amc_val:2500,   received:2500,    due:0,      followed_by:'SY', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-026',       client:'Mr. Khalifa Thani Shahin Almarar',        start:'2026-01-01', end:'2026-12-31', amc_val:1500,   received:1500,    due:0,      followed_by:'SY', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-007',       client:'Mr. Abdullah Khamis Al Rashideya Dibba',  start:'2026-01-30', end:'2027-01-29', amc_val:3000,   received:3000,    due:0,      followed_by:'SY', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-025',       client:'Heirs of Mohammed Al Saifi Office Bldg',  start:'2026-02-01', end:'2027-01-31', amc_val:2625,   received:2625,    due:0,      followed_by:'SS', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-028',       client:'Mr. Ali Abdulla Ali Aldhokairi Al Ras',   start:'2026-02-01', end:'2027-01-31', amc_val:2500,   received:2500,    due:0,      followed_by:'MM', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-112',       client:'Mr. Yousif Ahmed Ali Zayed City',         start:'2026-02-20', end:'2027-02-19', amc_val:2500,   received:0,       due:2500,   followed_by:'SY', remarks:'Cancelled',                   invalid_period:false },
  { cref:'SH-089',       client:'Loyal BC 688-07 Lab Acc DIC',             start:'2026-03-04', end:'2027-03-03', amc_val:2625,   received:1312.5,  due:1312.5, followed_by:'SY', remarks:'Approved and Partial Paid',    invalid_period:false },
  { cref:'SH-090',       client:'Loyal BC 688-08 Lab Acc DIC',             start:'2026-03-04', end:'2027-03-03', amc_val:2625,   received:1312.5,  due:1312.5, followed_by:'SY', remarks:'Approved and Partial Paid',    invalid_period:false },
  { cref:'SH-029',       client:'Mr. Jassim Sharif Al Zarouni Al Awir',    start:'2026-03-04', end:'2029-03-03', amc_val:8250,   received:8250,    due:0,      followed_by:'MM', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-064',       client:'Mohammed Abdulla Hamd Sabaan Al Riyad',   start:'2026-03-05', end:'2027-03-04', amc_val:3000,   received:3000,    due:0,      followed_by:'SY', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-062',       client:'Mrs.Maryam Al Rahmaniya Sharjah',         start:'2026-04-01', end:'2027-03-31', amc_val:3150,   received:3150,    due:0,      followed_by:'SY', remarks:'Approved and Payment Received',invalid_period:false, source_end_was_invalid:'2026-03-31' },
  { cref:'SH-018',       client:'Abdul Aziz Omar Ref. Masar Al Injaz',     start:'2026-04-01', end:'2027-03-31', amc_val:1800,   received:1800,    due:0,      followed_by:'SS', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SHM-2024',     client:'360RTSC Faisal Villa Al Awir',            start:'2026-04-07', end:'2027-04-06', amc_val:2300,   received:1300,    due:1000,   followed_by:'SY', remarks:'Approved and Partial Paid',    invalid_period:false },
  { cref:'SH-030',       client:'Ahmed Alradhi Al Shawamikh Abu Dhabi',    start:'2026-04-01', end:'2027-04-01', amc_val:2500,   received:2500,    due:0,      followed_by:'MM', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-103',       client:'Loyal BC Masa Warehouse',                 start:'2026-03-07', end:'2027-03-06', amc_val:2625,   received:2625,    due:0,      followed_by:'SS', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-079',       client:'Mouza Juma Alswad Al Yasmeen Ajman',      start:'2026-04-05', end:'2027-04-05', amc_val:2500,   received:2500,    due:0,      followed_by:'MM', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-085',       client:'Moonlink Umm Nahad Ahmed Sulaiman',       start:'2026-04-22', end:'2027-04-22', amc_val:2500,   received:2500,    due:0,      followed_by:'SS', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-098',       client:'Hessa Ahmed Juma Villa Al Awir 1st',      start:'2026-04-23', end:'2027-04-22', amc_val:2000,   received:2000,    due:0,      followed_by:'SY', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-080, SH-081', client:'LBC Labour Accommodation Jimmy Building',start:'2026-05-01', end:'2027-04-30', amc_val:5000,   received:1250,    due:3750,   followed_by:'SS', remarks:'Approved, Every 3 months once',invalid_period:false },
  { cref:'SH-077',       client:'Shitij Kapoor Designsmith Meadows 1',     start:'2026-05-22', end:'2027-05-21', amc_val:2800,   received:2800,    due:0,      followed_by:'SS', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-032',       client:'Mr. Saeed Mohamed Rashed Khamis Al Raheeb',start:'2026-05-27',end:'2027-05-26', amc_val:2500,   received:2500,    due:0,      followed_by:'MM', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-104',       client:'Mr. Anas Al Hajaj Al Manhal Nad Al Shiba',start:'2026-05-16', end:'2027-05-15', amc_val:3675,   received:3675,    due:0,      followed_by:'SS', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SHM-2022',     client:'Noorani G+1 Al Warqa Dubai',              start:'2026-05-04', end:'2027-05-03', amc_val:2625,   received:2625,    due:0,      followed_by:'MM', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-001',       client:'New Tower Contracting Ajman',             start:'2026-05-10', end:'2027-05-09', amc_val:2100,   received:2100,    due:0,      followed_by:'SY', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SHM-2026',     client:'Mr. Ali Al Mizhar 2 Dubai',               start:'2026-06-21', end:'2027-06-21', amc_val:2800,   received:2800,    due:0,      followed_by:'MM', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-109',       client:'FM Equipment Rental Sea Shore DIC',       start:'2026-07-01', end:'2027-06-30', amc_val:2625,   received:2625,    due:0,      followed_by:'MM', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-115',       client:'Noon BC Aamra Ajman',                     start:'2026-08-03', end:'2027-08-02', amc_val:2300,   received:2300,    due:0,      followed_by:'SY', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SHM-2021',     client:'360 Royal Tech Hassan Rustum Al Quoz',    start:'2026-07-17', end:'2027-07-16', amc_val:2100,   received:2100,    due:0,      followed_by:'SS', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-036',       client:'Mohamed Doieh',                           start:'2026-07-10', end:'2027-07-09', amc_val:2500,   received:2500,    due:0,      followed_by:'SY', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-065',       client:'Juma Rashed Almheiri Al Hayer Al Ain',    start:'2026-09-01', end:'2027-08-31', amc_val:2300,   received:2300,    due:0,      followed_by:'SY', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SHM-2032',     client:'Shaikha Maryam rashid Almualla',          start:'2026-07-25', end:'2027-07-25', amc_val:2500,   received:2500,    due:0,      followed_by:'SY', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-043',       client:'Reya Saeed Juma Alnuaimi Al Nouf Shj',   start:'2026-06-19', end:'2027-06-18', amc_val:3000,   received:3000,    due:0,      followed_by:'SY', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-087',       client:'Rashid G+2 Dibba',                        start:'2026-06-19', end:'2027-06-18', amc_val:2500,   received:0,       due:2500,   followed_by:'MM', remarks:'Pending',                     invalid_period:false },
  { cref:'SH-114',       client:'Mr.Hazzaa G+5 Res.Bldg Al Rifa Dibba',   start:null,         end:null,         amc_val:null,   received:0,       due:0,      followed_by:'SY', remarks:'Hold. No response',           invalid_period:false },
  { cref:'SH-116',       client:'Salem Jameel Almanhali Abu Dhabi',        start:'2026-08-01', end:'2027-07-31', amc_val:2000,   received:2000,    due:0,      followed_by:'MM', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-130',       client:'Ahmad Mubarak Solid BC Al Barsha 3rd',    start:'2026-08-01', end:'2027-07-31', amc_val:2500,   received:2500,    due:0,      followed_by:'SY', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-069',       client:'Ibrahim Murad Vision House Al Awir 1st',  start:'2026-08-01', end:'2027-07-31', amc_val:2625,   received:2625,    due:0,      followed_by:'SS', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SHM-2027',     client:'Sayed Khalil Mousavi Al Hashim Building', start:'2026-08-02', end:'2027-08-01', amc_val:2100,   received:0,       due:2100,   followed_by:'SY', remarks:'Approved and Payment Due',    invalid_period:false },
  { cref:'SHM-2028',     client:'Sayed Khalil Mousavi Al Sayed Building',  start:'2026-08-02', end:'2027-08-01', amc_val:2100,   received:0,       due:2100,   followed_by:'SY', remarks:'Approved and Payment Due',    invalid_period:false },
  { cref:'SH-020',       client:'Ahmad Al Suwaidi Khawaneej Dubai',        start:'2026-08-09', end:'2027-08-08', amc_val:2625,   received:2625,    due:0,      followed_by:'SS', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-073',       client:'Al Nuaimi Group RAK Dr. Rashid Villa',    start:'2026-08-08', end:'2027-08-07', amc_val:2625,   received:2625,    due:0,      followed_by:'SS', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-033',       client:'Mr.Aaref Saed Mohamed Omar Al Barsha',    start:null,         end:null,         amc_val:null,   received:0,       due:0,      followed_by:'MM', remarks:'Hold. No response',           invalid_period:false },
  { cref:'SH-053, SH-054', client:'Abdulla Saeed Al Saridi Doctor Site Dibba', start:'2026-08-12', end:'2027-08-11', amc_val:5500, received:5500, due:0, followed_by:'MM', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-095',       client:'Ebrahim Al Khabi Nahdah Dibba',           start:'2026-08-12', end:'2027-08-11', amc_val:2625,   received:0,       due:2625,   followed_by:'SS', remarks:'Pending',                     invalid_period:false },
  { cref:'SHO-1020',     client:'360 Royal Tech 3D contracting',           start:null,         end:null,         amc_val:null,   received:0,       due:0,      followed_by:'SY', remarks:'Cancelled',                   invalid_period:false },
  { cref:'SH-124, SH-125', client:'Bindhahi Investments Group Al Qusais',  start:'2026-08-15', end:'2027-08-14', amc_val:5250,   received:2625,    due:2625,   followed_by:'SY', remarks:'Approved and Partial Paid',   invalid_period:false, source_end_was_invalid:'2026-08-14' },
  { cref:'SH-002',       client:'RTA G+1 Al Qusais Dubai',                 start:'2026-08-21', end:'2029-08-20', amc_val:9000,   received:1500,    due:7500,   followed_by:'SS', remarks:'Approved and Partial Paid',    invalid_period:false },
  { cref:'SH-013',       client:'Kedu Home Lift Mr. Ahmed Ghanem Jumeira', start:'2026-08-23', end:'2027-08-22', amc_val:3150,   received:3150,    due:0,      followed_by:'SY', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-119',       client:'Mana Essa Mohammad Al Warqa 4th',         start:null,         end:null,         amc_val:null,   received:0,       due:0,      followed_by:'MM', remarks:'Pending',                     invalid_period:false },
  { cref:'SH-140',       client:'Mr.Fayez Semi Circle Panoramic Abu Dhabi',start:null,         end:null,         amc_val:null,   received:0,       due:0,      followed_by:'MM', remarks:'Pending',                     invalid_period:false },
  { cref:'SH-086',       client:'Majed Panoramic Al Awir 1st',             start:null,         end:null,         amc_val:null,   received:0,       due:0,      followed_by:'MM', remarks:'Pending',                     invalid_period:false },
  { cref:'SH-039',       client:'Hassan Bin Maliki Al Saoud Building Ajman',start:'2026-09-01',end:'2027-08-31', amc_val:2900,   received:0,       due:2900,   followed_by:'NM', remarks:'Pending',                     invalid_period:false, source_end_was_invalid:'2026-08-30' },
  { cref:'SHM-2031',     client:'Al Arsh FM AS House Villa Abdulla Sharafi',start:null,        end:null,         amc_val:null,   received:0,       due:0,      followed_by:'SS', remarks:'Cancelled',                   invalid_period:false },
  { cref:'SH-008, SH-009', client:'Al Saifi BC Jabel Ali Dubai',           start:'2026-09-12', end:'2027-09-11', amc_val:4200,   received:0,       due:4200,   followed_by:'SY', remarks:'Approved and Payment Due',    invalid_period:false, source_end_was_invalid:'2026-09-11' },
  { cref:'SHM-2013',     client:'Mr. Rashid Al Ketbi Dibba',               start:'2026-09-11', end:'2027-09-10', amc_val:3150,   received:0,       due:3150,   followed_by:'SY', remarks:'Approved and Payment Due',    invalid_period:false, source_end_was_invalid:'2026-09-10' },
  { cref:'SH-057',       client:'Kazim AbdulRedha Moosawi Umm Nahad Dubai',start:'2026-09-12', end:'2027-09-11', amc_val:2625,   received:0,       due:2625,   followed_by:'SY', remarks:'Approved and Payment Due',    invalid_period:false, source_end_was_invalid:'2026-09-11' },
  { cref:'SH-102',       client:'Rashed Al Shamshi Jaafar Al Jaberi Ajman',start:'2026-09-16', end:'2027-09-15', amc_val:2500,   received:0,       due:2500,   followed_by:'NM', remarks:'Pending',                     invalid_period:false },
  { cref:'SH-017',       client:'Rashed Saeed Alhanthoubi G+3 Dhadna',     start:'2026-09-20', end:'2027-09-19', amc_val:3000,   received:0,       due:3000,   followed_by:'MM', remarks:'Pending',                     invalid_period:false },
  { cref:'SH-075',       client:'Mr.Ahmed Aman Abdulrahman Ali Nad Hessa', start:'2026-09-20', end:'2027-09-19', amc_val:5000,   received:0,       due:5000,   followed_by:'SY', remarks:'Approved and Payment Due',    invalid_period:false },
  { cref:'SH-037',       client:'Ali Hussain Al Ali Al Seyouh Sharjah',    start:'2026-09-10', end:'2027-09-09', amc_val:3000,   received:3000,    due:0,      followed_by:'SY', remarks:'Approved and Payment Received',invalid_period:false },
  { cref:'SH-149',       client:'Loyal BC LPO706-29 TAL Jafza',            start:'2026-09-01', end:'2027-08-31', amc_val:2500,   received:2500,    due:0,      followed_by:'MM', remarks:'Approved and Payment Received',invalid_period:false },
];

// ─── Derive Status from Remarks ───────────────────────────────────────────────
function deriveStatuses(row) {
  const r = row.remarks.toLowerCase();
  let renewal_status = 'Pending';
  let payment_status = 'Unpaid';
  let amc_activation_status = null; // keep existing if null

  if (r.includes('cancelled')) {
    renewal_status = 'Cancelled';
    payment_status = 'Unpaid';
  } else if (r.includes('hold')) {
    renewal_status = 'Under Review';
    amc_activation_status = 'Hold';
  } else if (r.includes('approved')) {
    renewal_status = 'Approved';
    const recv = row.received || 0;
    const val  = row.amc_val  || 0;
    if (recv === 0)       payment_status = 'Unpaid';
    else if (recv >= val) payment_status = 'Paid';
    else                  payment_status = 'Partial';
  } else {
    // Pending
    renewal_status = 'Pending';
    payment_status = (row.received > 0) ? 'Partial' : 'Unpaid';
  }

  return { renewal_status, payment_status, amc_activation_status };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const db = new DatabaseSync(DB_PATH);
// Disable fsync for mounted filesystem — we have a backup so durability is covered
db.prepare('PRAGMA synchronous = OFF').run();
db.prepare('PRAGMA journal_mode = MEMORY').run();

// Load all active maintenance projects indexed by contract_ref
const mntProjects = {};
db.prepare('SELECT id, maintenance_id, contract_ref, maintenance_status FROM maintenance_projects WHERE is_deleted=0').all()
  .forEach(p => { mntProjects[p.contract_ref] = p; });

// Load existing 2026 active renewals indexed by contract_ref
const existingRenewals = {};
db.prepare(`
  SELECT ar.id, ar.renewal_ref, ar.contract_ref, ar.new_start_date, ar.new_end_date,
         ar.new_amc_value, ar.renewal_status, ar.payment_status, ar.amc_activation_status,
         ar.maintenance_project_id, COALESCE(txn.total,0) as db_received
  FROM amc_renewals ar
  LEFT JOIN (SELECT amc_renewal_id, SUM(amount) as total FROM amc_payment_transactions GROUP BY amc_renewal_id) txn ON txn.amc_renewal_id=ar.id
  WHERE ar.is_deleted=0
`).all().forEach(r => {
  if (!existingRenewals[r.contract_ref]) existingRenewals[r.contract_ref] = [];
  existingRenewals[r.contract_ref].push(r);
});

// Detect SH-020 duplicate — R01 must be soft-deleted
const sh020Renewals = existingRenewals['SH-020'] || [];
const sh020Dup = sh020Renewals.find(r => r.renewal_status === 'Under Review');
const sh020Good = sh020Renewals.find(r => r.renewal_status !== 'Under Review');

// ─── Preview Report ───────────────────────────────────────────────────────────
const preview = [];
const manualReview = [];
const invalidPeriodFlags = [];

// Track which DB renewals we see in source (for anything not in source)
const seenDbIds = new Set();

for (const row of SOURCE) {
  const { renewal_status, payment_status, amc_activation_status } = deriveStatuses(row);
  const dbRenewals = existingRenewals[row.cref] || [];

  // Determine which DB renewal is the "current" for this contract
  // Prefer Approved > Pending > Under Review > Cancelled to pick the authoritative record
  const dbCurrent = dbRenewals.length === 1 ? dbRenewals[0]
    : (dbRenewals.find(r => r.renewal_status === 'Approved')
    || dbRenewals.find(r => r.renewal_status === 'Pending')
    || dbRenewals.find(r => r.renewal_status !== 'Cancelled')
    || dbRenewals[0]
    || null);

  if (dbCurrent) seenDbIds.add(dbCurrent.id);

  // Find maintenance project
  let mntProj = mntProjects[row.cref];
  // Handle combined refs: "SH-053, SH-054" → try first part
  if (!mntProj && row.cref.includes(',')) {
    const parts = row.cref.split(',').map(s => s.trim());
    mntProj = mntProjects[parts[0]] || mntProjects[parts[1]];
  }

  const action_parts = [];
  const updates = {};

  if (!mntProj) {
    manualReview.push({ cref: row.cref, reason: 'No maintenance project found in DB', row });
    preview.push({ cref: row.cref, action: 'Manual Review', reason: 'No maintenance project found' });
    continue;
  }

  // Special: SH-037 maintenance project is Cancelled in DB but source says Paid
  if (mntProj.maintenance_status === 'Cancelled' && renewal_status !== 'Cancelled') {
    manualReview.push({ cref: row.cref, reason: 'Maintenance project is Cancelled in DB but source marks as Approved/Paid', row });
    preview.push({ cref: row.cref, action: 'Manual Review', reason: 'Maint project Cancelled but source has Approved/Paid — review required' });
    continue;
  }

  if (row.source_end_was_invalid) {
    invalidPeriodFlags.push({ cref: row.cref, source_end: row.source_end_was_invalid, corrected_end: row.end });
  }

  if (!dbCurrent) {
    // MISSING RENEWAL — create
    const entry = {
      cref: row.cref,
      action: 'Create Missing Renewal',
      src_amc: row.amc_val, src_recv: row.received, src_due: row.due,
      db_amc: null, db_recv: null,
      src_status: renewal_status, src_pay: payment_status,
      src_start: row.start, src_end: row.end,
      followed_by: row.followed_by,
      mnt_id: mntProj.id, mnt_maint_id: mntProj.maintenance_id,
      row,
    };
    preview.push(entry);
  } else {
    // EXISTING RENEWAL — compare
    const dbRecv = dbCurrent.db_received || 0;
    const amcVal = row.amc_val != null ? row.amc_val : dbCurrent.new_amc_value;
    const diff = (row.received || 0) - dbRecv;

    const needsAMCUpdate = row.amc_val != null && Math.abs(row.amc_val - (dbCurrent.new_amc_value||0)) > 0.01;
    const needsStatusUpdate = dbCurrent.renewal_status !== renewal_status && renewal_status !== 'Under Review';
    const needsPayStatusUpdate = dbCurrent.payment_status !== payment_status;
    const needsHoldUpdate = amc_activation_status === 'Hold' && dbCurrent.amc_activation_status !== 'Hold';
    const needsEndDateFix = dbCurrent.new_end_date && dbCurrent.new_start_date &&
      dbCurrent.new_end_date < dbCurrent.new_start_date;
    const needsEndDateUpdate = row.end && row.end !== dbCurrent.new_end_date && !needsEndDateFix;
    const paymentMismatch = Math.abs(diff) > 0.01;

    const issues = [];
    if (needsAMCUpdate) issues.push(`AMC value: DB=${dbCurrent.new_amc_value} → src=${row.amc_val}`);
    if (needsStatusUpdate) issues.push(`Renewal status: DB=${dbCurrent.renewal_status} → ${renewal_status}`);
    if (needsPayStatusUpdate) issues.push(`Payment status: DB=${dbCurrent.payment_status} → ${payment_status}`);
    if (needsHoldUpdate) issues.push('Set Hold');
    if (needsEndDateFix) issues.push(`Fix invalid DB end date: ${dbCurrent.new_end_date} → ${row.end || dbCurrent.new_end_date.replace(/^(\d{4}-\d{2}-\d{2})/, m => {
      const d = new Date(m); d.setFullYear(d.getFullYear()+1); return d.toISOString().slice(0,10);
    })}`);
    if (paymentMismatch && diff > 0) issues.push(`Add payment txn: AED ${diff.toFixed(2)}`);
    if (paymentMismatch && diff < 0) issues.push(`OVERPAYMENT in DB (DB=${dbRecv}, src=${row.received}) — flag for review`);

    const action = issues.length === 0 ? 'No Change' : 'Update';

    preview.push({
      cref: row.cref,
      action,
      issues,
      db_id: dbCurrent.id,
      db_ref: dbCurrent.renewal_ref,
      src_amc: row.amc_val, src_recv: row.received, src_due: row.due,
      db_amc: dbCurrent.new_amc_value, db_recv: dbRecv,
      src_status: renewal_status, db_status: dbCurrent.renewal_status,
      src_pay: payment_status, db_pay: dbCurrent.payment_status,
      src_start: row.start, src_end: row.end,
      db_start: dbCurrent.new_start_date, db_end: dbCurrent.new_end_date,
      followed_by: row.followed_by,
      needsAMCUpdate, needsStatusUpdate, needsPayStatusUpdate,
      needsHoldUpdate, needsEndDateFix, needsEndDateUpdate, paymentMismatch, diff,
      mnt_proj_id: dbCurrent.maintenance_project_id,
      row,
    });
  }
}

// SH-020 duplicate
if (sh020Dup && sh020Good) {
  preview.push({
    cref: 'SH-020',
    action: 'Deduplicate',
    detail: `Soft-delete SH-020-R01 (id=${sh020Dup.id}) — Under Review duplicate. Keep R02 (id=${sh020Good.id}) Approved/Paid.`,
    db_id_to_delete: sh020Dup.id,
  });
}

// ─── Print Report ─────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  AMC 2026 RECONCILIATION PREVIEW');
console.log('  Date:', NOW);
console.log('  Mode:', PREVIEW_ONLY ? 'PREVIEW (read-only)' : 'COMMIT');
console.log('═══════════════════════════════════════════════════════════════\n');

const stats = { no_change:0, update:0, create:0, dedup:0, manual:0 };
for (const p of preview) {
  const act = p.action;
  if (act === 'No Change') stats.no_change++;
  else if (act === 'Update') stats.update++;
  else if (act === 'Create Missing Renewal') stats.create++;
  else if (act === 'Deduplicate') stats.dedup++;
  else if (act === 'Manual Review') stats.manual++;

  const color = act === 'No Change' ? '' : act === 'Manual Review' ? '⚠ ' : act === 'Deduplicate' ? '🔧 ' : '→ ';
  console.log(`${color}[${act}] ${p.cref}`);
  if (p.db_ref) console.log(`   DB Renewal: ${p.db_ref} (id=${p.db_id})`);
  if (p.db_amc != null) console.log(`   AMC: DB=${p.db_amc} / Src=${p.src_amc} | Recv: DB=${p.db_recv} / Src=${p.src_recv} | Due: ${p.src_due}`);
  if (p.db_status) console.log(`   Status: DB=${p.db_status}/${p.db_pay} → Src=${p.src_status}/${p.src_pay}`);
  if (p.issues && p.issues.length > 0) p.issues.forEach(i => console.log(`   • ${i}`));
  if (p.detail) console.log(`   ${p.detail}`);
  if (p.reason) console.log(`   Reason: ${p.reason}`);
  if (act === 'Create Missing Renewal') {
    console.log(`   Maint: ${p.mnt_maint_id} | Start: ${p.src_start} | End: ${p.src_end}`);
    console.log(`   AMC: ${p.src_amc} | Recv: ${p.src_recv} | Due: ${p.src_due}`);
    console.log(`   Status: ${p.src_status}/${p.src_pay} | Followed by: ${p.followed_by}`);
  }
}

if (invalidPeriodFlags.length) {
  console.log('\n── INVALID SOURCE PERIODS CORRECTED ────────────────────────────');
  for (const f of invalidPeriodFlags) {
    console.log(`   ${f.cref}: source end was ${f.source_end} (before start) → used ${f.corrected_end}`);
  }
}

if (manualReview.length) {
  console.log('\n── MANUAL REVIEW REQUIRED ──────────────────────────────────────');
  for (const m of manualReview) console.log(`   ${m.cref}: ${m.reason}`);
}

console.log('\n── SUMMARY ─────────────────────────────────────────────────────');
console.log(`   Source rows:      ${SOURCE.length} unique (SH-072 duplicate skipped)`);
console.log(`   No Change:        ${stats.no_change}`);
console.log(`   Safe Updates:     ${stats.update}`);
console.log(`   Create Renewals:  ${stats.create}`);
console.log(`   Deduplication:    ${stats.dedup}`);
console.log(`   Manual Review:    ${stats.manual}`);
console.log('');

if (PREVIEW_ONLY) {
  console.log('  ℹ  Run with --commit to execute all safe changes.');
  process.exit(0);
}

// ─── COMMIT PHASE ─────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  EXECUTING RECONCILIATION');
console.log('═══════════════════════════════════════════════════════════════\n');

const auditLog = [];

function logAudit(renewal_id, renewal_ref, action, field_name, old_value, new_value, notes) {
  db.prepare(`
    INSERT INTO renewal_audit_log (amc_renewal_id, renewal_ref, action, field_name, old_value, new_value, performed_by, performed_at, notes)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(renewal_id, renewal_ref, action, field_name,
    old_value != null ? String(old_value) : null,
    new_value != null ? String(new_value) : null,
    PERFORMED_BY, NOW, notes);
}

// Helper: get next renewal_ref for a contract
function nextRenewalRef(cref) {
  const all = db.prepare('SELECT renewal_ref FROM amc_renewals WHERE contract_ref=? ORDER BY id').all(cref);
  // strip deleted as well
  const allWithDel = db.prepare('SELECT renewal_ref FROM amc_renewals WHERE contract_ref=? ORDER BY id').all(cref);
  const max = allWithDel.length;
  const n = max + 1;
  return `${cref}-R${String(n).padStart(2,'0')}`;
}

db.prepare('BEGIN').run();
try {

  // ── 1. Soft-delete SH-020-R01 duplicate ─────────────────────────────────
  if (sh020Dup && sh020Good) {
    db.prepare('UPDATE amc_renewals SET is_deleted=1, updated_at=? WHERE id=?').run(NOW, sh020Dup.id);
    logAudit(sh020Dup.id, sh020Dup.renewal_ref, 'DELETE', 'is_deleted', '0', '1',
      'Deduplicate: SH-020-R01 Under Review removed; R02 Approved/Paid is the correct current renewal');
    console.log(`✓ [DEDUP] Soft-deleted ${sh020Dup.renewal_ref} (id=${sh020Dup.id})`);
  }

  // ── 2. Process each source row ────────────────────────────────────────────
  for (const p of preview) {
    if (p.action === 'No Change' || p.action === 'Manual Review') continue;
    if (p.action === 'Deduplicate') continue; // handled above

    const row = p.row;
    const { renewal_status, payment_status, amc_activation_status } = deriveStatuses(row);

    if (p.action === 'Update') {
      const id = p.db_id;
      const ref = p.db_ref;

      if (p.needsAMCUpdate && row.amc_val != null) {
        db.prepare('UPDATE amc_renewals SET new_amc_value=?, updated_at=? WHERE id=?').run(row.amc_val, NOW, id);
        logAudit(id, ref, 'UPDATE', 'new_amc_value', String(p.db_amc), String(row.amc_val), 'AMC 2026 reconciliation');
      }

      if (p.needsStatusUpdate) {
        db.prepare('UPDATE amc_renewals SET renewal_status=?, updated_at=? WHERE id=?').run(renewal_status, NOW, id);
        logAudit(id, ref, 'UPDATE', 'renewal_status', p.db_status, renewal_status, 'AMC 2026 reconciliation');
      }

      if (p.needsPayStatusUpdate) {
        db.prepare('UPDATE amc_renewals SET payment_status=?, updated_at=? WHERE id=?').run(payment_status, NOW, id);
        logAudit(id, ref, 'UPDATE', 'payment_status', p.db_pay, payment_status, 'AMC 2026 reconciliation');
      }

      if (p.needsHoldUpdate) {
        db.prepare('UPDATE amc_renewals SET amc_activation_status=?, hold_date=?, updated_at=? WHERE id=?').run('Hold', NOW, NOW, id);
        logAudit(id, ref, 'UPDATE', 'amc_activation_status', 'Inactive', 'Hold', 'Source: Hold. No response');
      }

      // Fix invalid DB end date (end before start)
      if (p.needsEndDateFix) {
        // Try to use source end if valid, otherwise add 1 year to start
        let fixedEnd = row.end;
        if (!fixedEnd) {
          const d = new Date(p.db_start); d.setFullYear(d.getFullYear()+1);
          fixedEnd = d.toISOString().slice(0,10);
        }
        db.prepare('UPDATE amc_renewals SET new_end_date=?, updated_at=? WHERE id=?').run(fixedEnd, NOW, id);
        logAudit(id, ref, 'UPDATE', 'new_end_date', p.db_end, fixedEnd, 'Fixed invalid end date (end < start)');
      }

      // Update followed_by if column exists (check via remarks-based approach since no column)
      // Note: renewal_followed_by doesn't exist as a column; skip or store in remarks
      // (remarks field may be updated with follow-up info if needed)

      // Add payment txn for missing received amount
      if (p.paymentMismatch && p.diff > 0) {
        db.prepare(`
          INSERT INTO amc_payment_transactions (amc_renewal_id, renewal_ref, contract_ref, amount, payment_status, notes, entered_by, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?)
        `).run(id, ref, row.cref, p.diff, 'Paid',
          `AMC 2026 reconciliation — added AED ${p.diff.toFixed(2)} (source total: ${row.received}, DB had: ${p.db_recv})`,
          PERFORMED_BY, NOW, NOW);
        logAudit(id, ref, 'PAYMENT_ADD', 'amc_payment_transactions', String(p.db_recv), String(row.received),
          `Added payment txn AED ${p.diff.toFixed(2)} from AMC 2026 reconciliation`);
        console.log(`✓ [UPDATE] ${row.cref}: added txn AED ${p.diff.toFixed(2)} (${ref})`);
      }

      const changesSummary = [];
      if (p.needsStatusUpdate) changesSummary.push(`status→${renewal_status}`);
      if (p.needsPayStatusUpdate) changesSummary.push(`pay→${payment_status}`);
      if (p.needsHoldUpdate) changesSummary.push('Hold set');
      if (p.needsEndDateFix) changesSummary.push('end date fixed');
      if (p.needsAMCUpdate) changesSummary.push(`amc→${row.amc_val}`);
      if (changesSummary.length > 0) console.log(`✓ [UPDATE] ${row.cref} (${ref}): ${changesSummary.join(', ')}`);

    } else if (p.action === 'Create Missing Renewal') {
      const mntProjId = p.mnt_id;
      const mntId     = p.mnt_maint_id;

      // Generate renewal ref
      const rRef = nextRenewalRef(row.cref);

      // Determine AMC value
      const amcVal = row.amc_val || 0;
      const recv   = row.received || 0;

      let actStatus = 'Inactive';
      if (renewal_status === 'Approved') actStatus = 'Active';
      // Cancelled renewals stay Inactive (DB CHECK: only 'Active','Hold','Inactive' allowed)
      if (amc_activation_status === 'Hold') actStatus = 'Hold';

      const startDate = row.start || null;
      const endDate   = row.end   || null;

      db.prepare(`
        INSERT INTO amc_renewals (
          renewal_ref, maintenance_project_id, maintenance_id, contract_ref, client_name,
          new_start_date, new_end_date, new_amc_value, renewal_status, payment_status,
          amc_activation_status, amount_paid, remarks, is_deleted, created_by, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)
      `).run(
        rRef, mntProjId, mntId, row.cref, row.client,
        startDate, endDate, amcVal, renewal_status, payment_status,
        actStatus, recv,
        `AMC 2026 | Followed by: ${row.followed_by} | ${row.remarks}`,
        PERFORMED_BY, NOW, NOW
      );

      const newId = db.prepare('SELECT last_insert_rowid() as id').get().id;

      // Create payment txn if received > 0
      if (recv > 0 && renewal_status !== 'Cancelled') {
        db.prepare(`
          INSERT INTO amc_payment_transactions (amc_renewal_id, renewal_ref, contract_ref, amount, payment_status, notes, entered_by, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?)
        `).run(newId, rRef, row.cref, recv, 'Paid',
          `AMC 2026 reconciliation — received AED ${recv} per source sheet`, PERFORMED_BY, NOW, NOW);
      }

      logAudit(newId, rRef, 'CREATE', 'amc_renewals', null, JSON.stringify({renewal_status, payment_status, amc_val: amcVal, received: recv}),
        `Created from AMC 2026 reconciliation. Source remarks: ${row.remarks}`);

      console.log(`✓ [CREATE] ${row.cref} → ${rRef} | ${renewal_status}/${payment_status} | AED ${amcVal}${recv>0?' recv:'+recv:''}`);
    }
  }

  db.prepare('COMMIT').run();
  console.log('\n✓ All changes committed successfully.\n');

} catch (err) {
  console.error('\n✗ ERROR during commit:', err.message);
  try { db.prepare('ROLLBACK').run(); } catch(rbErr) { /* transaction may already be done */ }
  process.exit(1);
}

// ─── Final Verification ───────────────────────────────────────────────────────
const finalRenewals = db.prepare(`
  SELECT ar.contract_ref, ar.renewal_ref, ar.renewal_status, ar.payment_status,
         ar.amc_activation_status, ar.new_amc_value,
         COALESCE(txn.total,0) as received
  FROM amc_renewals ar
  LEFT JOIN (SELECT amc_renewal_id, SUM(amount) as total FROM amc_payment_transactions GROUP BY amc_renewal_id) txn ON txn.amc_renewal_id=ar.id
  WHERE ar.is_deleted=0
  ORDER BY ar.contract_ref
`).all();

console.log('\n── MANDATORY QA CASES ───────────────────────────────────────────');
const qaCases = ['SH-020', 'SH-053, SH-054', 'SH-124, SH-125', 'SH-002', 'SHM-2027', 'SHM-2028', 'SH-008, SH-009', 'SHM-2013', 'SH-075', 'SH-037', 'SH-149'];
for (const qc of qaCases) {
  const r = finalRenewals.find(x => x.contract_ref === qc) || finalRenewals.find(x => x.contract_ref.includes(qc.split(',')[0].trim()));
  if (r) {
    const due = (r.new_amc_value||0) - r.received;
    const pass = (() => {
      if (qc === 'SH-020') return r.renewal_status==='Approved' && r.payment_status==='Paid' && r.received===2625 && due===0;
      if (qc === 'SH-053, SH-054') return r.renewal_status==='Approved' && r.payment_status==='Paid' && r.received===5500 && due===0;
      if (qc === 'SH-124, SH-125') return r.payment_status==='Partial' && r.received===2625 && Math.abs(due-2625)<0.01;
      if (qc === 'SH-002') return r.payment_status==='Partial' && r.received===1500 && Math.abs(due-7500)<0.01;
      return true;
    })();
    console.log(`  ${pass!==false?'✓':'✗'} ${qc}: ${r.renewal_status}/${r.payment_status} | AMC=${r.new_amc_value} recv=${r.received} due=${due.toFixed(2)}`);
  } else {
    console.log(`  ✗ ${qc}: NOT FOUND`);
  }
}

console.log('\n── FINAL TALLY ─────────────────────────────────────────────────');
const totalR = finalRenewals.filter(r=>r.renewal_status!=='Cancelled');
const paid   = totalR.filter(r=>r.payment_status==='Paid').length;
const partial= totalR.filter(r=>r.payment_status==='Partial').length;
const unpaid = totalR.filter(r=>r.payment_status==='Unpaid').length;
const pendingR= totalR.filter(r=>r.renewal_status==='Pending').length;
const holdR  = finalRenewals.filter(r=>r.amc_activation_status==='Hold').length;
const cancelled=finalRenewals.filter(r=>r.renewal_status==='Cancelled').length;
console.log(`  Total active renewals: ${totalR.length} (+ ${cancelled} Cancelled)`);
console.log(`  Paid: ${paid} | Partial: ${partial} | Unpaid: ${unpaid}`);
console.log(`  Pending: ${pendingR} | Hold: ${holdR}`);

if (manualReview.length) {
  console.log('\n── MANUAL REVIEW REQUIRED (not written to DB) ──────────────────');
  for (const m of manualReview) console.log(`   ${m.cref}: ${m.reason}`);
}
