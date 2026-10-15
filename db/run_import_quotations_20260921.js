#!/usr/bin/env node
// =============================================================
// SALES_QUOTATION_UPDATE_20260921 — Quotation Submitted Register
// Run from the SH-PMS-App directory:
//   node db/run_import_quotations_20260921.js
// Idempotent: safe to re-run. Skips existing quote_refs.
// =============================================================
'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, 'sh_pms.sqlite');
const BATCH_ID = 'SALES_QUOTATION_UPDATE_20260921';
const IMPORT_USER = 'system_import';
const TERMINAL_STATUSES = new Set(['approved','rejected','cancelled','revised','lost']);

function extractLocation(clientName) {
  if (!clientName) return null;
  const known = ['Dubai','Sharjah','Ajman','Abu Dhabi','Ras Al Khaimah','Fujairah','Umm Al Quwain'];
  for (const loc of known) {
    if (clientName.includes(', ' + loc)) return loc;
  }
  return null;
}

// 51 source records — Quotation Submitted Register
// Status "Forwarded to Client" → 'quoted'
const RECORDS = [
  { qr:'6183', sp:'SY', client:'Veronica Caponpon', attn:'Kuwait', phone:'', mobile:'965 944 61688', email:'vgc_babes@yahoo.com', date:'2026-07-28' },
  { qr:'6184', sp:'MM', client:'Khansaheb Bespoke Contracting', attn:'Engr. Mohideen Pitchai', phone:'', mobile:'056-1773319', email:'', date:'2026-07-28' },
  { qr:'6185', sp:'NM', client:'Al Temouh BC, Ajman', attn:'Engr. Hayath', phone:'', mobile:'050-7226210', email:'', date:'2026-07-28' },
  { qr:'6186', sp:'SY', client:'Designsmith Build Contracting LLC, Dubai', attn:'Mr. Jehangir', phone:'', mobile:'056-1583252', email:'tender@designsmith.ae; hemalatha@designsmith.ae; phani@designsmith.ae; sridher@designsmith.ae; jameer@designsmith.ae', date:'2026-07-30' },
  { qr:'6187', sp:'SY', client:'National Engineering Bureau, Dubai', attn:'Mr. Nasra Abed', phone:'04-3242020', mobile:'', email:'nasra.a@neb.ae; m.rafeek@neb.ae', date:'2026-07-30' },
  { qr:'6188', sp:'SY', client:'JKS Hills Construction Co. LLC, Dubai', attn:'Ms. Mariam', phone:'04-3882512', mobile:'', email:'procurement@jkshills.ae', date:'2026-07-30' },
  { qr:'6189', sp:'MM', client:'Golden Sand Cont., Sharjah', attn:'Engr. Ahamed', phone:'', mobile:'054-2329101', email:'', date:'2026-07-30' },
  { qr:'6190', sp:'SY', client:'Super Bazaar, Dubai', attn:'Mr. Samiuddin', phone:'', mobile:'', email:'sami@superbazaaruae.com', date:'2026-08-01' },
  { qr:'6191', sp:'SS', client:'Jaseera BC, Dubai', attn:'Engr. Rahul Kannikulam', phone:'04-2809055', mobile:'054-5831096', email:'rahul@jaseeracontracting.com; surya@jaseeracontracting.com; aneezraja@jaseeracontracting.com; mep@jaseeracontracting.com', date:'2026-08-01' },
  { qr:'6192', sp:'NM', client:'Mr. Saeed Salem Saeed Abdullah AlMadhaani, Ajman', attn:'', phone:'', mobile:'050-3099899', email:'', date:'2026-08-01' },
  { qr:'6193', sp:'NM', client:'Grand View BC, Dubai', attn:'Mr. Muhammad Tayyab', phone:'', mobile:'056-5488695', email:'pm@grandviewconstruction.ae', date:'2026-08-07' },
  { qr:'6194', sp:'MM', client:'Mr. Sheikh Suhail Khalifa Saeed Al Maktoum, Dubai', attn:'', phone:'', mobile:'', email:'', date:'2026-08-07' },
  { qr:'6195', sp:'NM', client:'Knzy Contracting LLC, Dubai', attn:'Engr. Qursith', phone:'', mobile:'056-3307442', email:'', date:'2026-08-17' },
  { qr:'6196', sp:'MM', client:'Khansaheb Bespoke Contracting', attn:'Mr. Mohideen Pitchai', phone:'04-6057200', mobile:'056-1773319', email:'mohideen.pitchai@khansaheb.com', date:'2026-08-17' },
  { qr:'6197', sp:'MM', client:'Chillco Building Cont. LLC, Dubai', attn:'Engr. John', phone:'', mobile:'050-6529862', email:'', date:'2026-08-18' },
  { qr:'6198', sp:'NM', client:'Mr. Ahmed Ahli, Dubai', attn:'', phone:'', mobile:'050-4961110', email:'', date:'2026-08-21' },
  { qr:'6199', sp:'SY', client:'Ritz Building Contracting, Dubai', attn:'Engr. Mirza', phone:'04-2691385', mobile:'055-1693150', email:'', date:'2026-08-24' },
  { qr:'6200', sp:'NM', client:'Mr. Hazza Abdulrahim Jehan Karam AlBlooshi, Sharjah', attn:'', phone:'', mobile:'050-9289200', email:'', date:'2026-08-24' },
  { qr:'6201', sp:'NM', client:'KEA BC, Dubai', attn:'', phone:'04-3251339', mobile:'', email:'info@kea-design.com', date:'2026-08-24' },
  { qr:'6202', sp:'MM', client:'Dass Building Cont., Dubai', attn:'Engr. Abdul Rahman', phone:'', mobile:'052-7147771', email:'', date:'2026-08-26' },
  { qr:'6203', sp:'MM', client:'Green Yard BC, Dubai', attn:'Engr. Mena Saeed', phone:'', mobile:'052-5912145', email:'', date:'2026-08-26' },
  { qr:'6204', sp:'SS', client:'E4 Group, Dubai', attn:'Mr. Thuvan Sameel', phone:'04-3400110', mobile:'056-8381467', email:'procurement@element4me.com', date:'2026-08-27' },
  { qr:'6205', sp:'NM', client:'Ahl Al Dar Development Cont. LLC, Ajman', attn:'Engr. Suriya', phone:'', mobile:'052-1424849', email:'', date:'2026-08-28' },
  { qr:'6206', sp:'NM', client:'Mr. Khalfan Hassan Khalfan AlFarraj AlKetbi, Ajman', attn:'', phone:'', mobile:'056-1331415', email:'', date:'2026-08-28' },
  { qr:'6207', sp:'NM', client:'Milestones for Building Contracting LLC', attn:'Engr. Ibrahim Sbaih', phone:'', mobile:'050-5590544', email:'', date:'2026-08-28' },
  { qr:'6208', sp:'NM', client:'Evolve Interiors LLC', attn:'Mr. Prateek Uppin', phone:'', mobile:'056-1362257', email:'', date:'2026-08-28' },
  { qr:'6209', sp:'SS', client:'Dass Contracing, Dubai', attn:'Engr. Abdul Aziz', phone:'', mobile:'052-7147771', email:'', date:'2026-08-28' },
  { qr:'6210', sp:'SY', client:'Qwaed Contracting LLC, Dubai', attn:'Engr. Abdel Monim', phone:'04-3344335', mobile:'050-7694231', email:'a.monem@qwaed.ae', date:'2026-09-05' },
  { qr:'6211', sp:'SY', client:'Qwaed Contracting LLC, Dubai', attn:'Engr. Abdel Monim', phone:'04-3344335', mobile:'050-7694231', email:'a.monem@qwaed.ae', date:'2026-09-05' },
  { qr:'6212', sp:'SY', client:'Qwaed Contracting LLC, Dubai', attn:'Engr. Abdel Monim', phone:'04-3344335', mobile:'050-7694231', email:'a.monem@qwaed.ae', date:'2026-09-05' },
  { qr:'6213', sp:'NM', client:'Property Simplified LLC, Dubai', attn:'Engr. Rajat Sahni', phone:'', mobile:'055-3760939', email:'', date:'2026-09-02' },
  { qr:'6214', sp:'NM', client:'Citi Consult Arch Consultant LLC, Dubai', attn:'Engr. Mohammed', phone:'', mobile:'055-9039002', email:'', date:'2026-09-02' },
  { qr:'6215-MAT', sp:'NM', client:'Mr. Khalifa Saif Khalifa, Dubai', attn:'', phone:'', mobile:'055-6555007', email:'', date:'2026-09-02' },
  { qr:'6216', sp:'SY', client:'Mr. Salem Obaid Ibrahim Al Qamti Al Ali', attn:'Engr. Akram', phone:'', mobile:'055-7540555', email:'', date:'2026-09-08' },
  { qr:'6217', sp:'NM', client:'Qasr Al Qurtuba BC, Sharjah', attn:'Engr. Zain Abu Ahamed', phone:'', mobile:'056-9972460', email:'', date:'2026-09-09' },
  { qr:'6218', sp:'NM', client:'Hassan Salmeen BC, Dubai', attn:'', phone:'04-2677909', mobile:'050-7084098', email:'', date:'2026-09-09' },
  { qr:'6219', sp:'NM', client:'Arab Land Contracting LLC, Dubai', attn:'Mr. Basshim Ahamed', phone:'04-8818961', mobile:'050-5496913', email:'baashim.a@arablandcont.com', date:'2026-09-11' },
  { qr:'6220', sp:'NM', client:'Omaxe Contracting LLC, Dubai', attn:'Engr. Siraj', phone:'', mobile:'058-6515595', email:'', date:'2026-09-11' },
  { qr:'6221', sp:'NM', client:'Al Beer Décor & BC LLC, Dubai', attn:'Engr. Victoria', phone:'', mobile:'052-8248741', email:'', date:'2026-09-11' },
  { qr:'6222', sp:'NM', client:'Al Masar Al Hadeth BC, Ajman', attn:'Engr. Halith', phone:'', mobile:'054-4657883', email:'', date:'2026-09-11' },
  { qr:'6223', sp:'MM', client:'Emirates Orbit Cont. Co. LLC, Dubai', attn:'Engr. Islam Basheer', phone:'04-6658288', mobile:'056-6858076', email:'', date:'2026-09-12' },
  { qr:'6224', sp:'NM', client:'Zakir Hassan Irfan Ali BC, Dubai', attn:'Engr. Irfan Ali', phone:'', mobile:'052-8866774', email:'', date:'2026-09-12' },
  { qr:'6225', sp:'SY', client:'Mr. Ali Abdulrahim Saeed Dafoos AlMarri, Dubai', attn:'', phone:'', mobile:'056-5118661', email:'', date:'2026-09-15' },
  { qr:'6226', sp:'SY', client:'Dar Al Asalah BC, Dubai', attn:'Mr. Muhib Ur Rahman', phone:'06-5481011', mobile:'056-5118661', email:'muhib@asalahco.ae', date:'2026-09-14' },
  { qr:'6227', sp:'SY', client:'Dar Al Asalah BC, Dubai', attn:'Mr. Muhib Ur Rahman', phone:'06-5481011', mobile:'056-5118661', email:'muhib@asalahco.ae', date:'2026-09-14' },
  { qr:'6228', sp:'SY', client:'Iris, Dubai', attn:'Mr. Sohail', phone:'', mobile:'', email:'sohail@iriscp.com', date:'2026-09-16' },
  { qr:'6229', sp:'NM', client:'D2B BC, Dubai', attn:'Engr. Rajesh Kumar', phone:'04-6658288', mobile:'056-6858076', email:'', date:'2026-09-16' },
  { qr:'6230', sp:'NM', client:'D2B BC, Dubai', attn:'Engr. Rajesh Kumar', phone:'04-6658288', mobile:'056-6858076', email:'', date:'2026-09-16' },
  { qr:'6231', sp:'NM', client:'Sterling House BC, Dubai', attn:'Engr. Ahmad', phone:'', mobile:'050-9648779', email:'', date:'2026-09-16' },
  { qr:'6232', sp:'NM', client:'Mesto Contracting LLC, Ajman', attn:'Engr. Mesto', phone:'', mobile:'050-6370034', email:'', date:'2026-09-16' },
  { qr:'6233', sp:'SY', client:'MZS Capital Bldg. Cont. LLC, Dubai', attn:'', phone:'04-2298352', mobile:'', email:'info@mzscapital.ae', date:'2026-09-16' },
];

function main() {
  console.log('Opening:', DB_PATH);
  const db = new DatabaseSync(DB_PATH);

  let created = 0, updated = 0, unchanged = 0, manual_review = 0;
  const log = [];

  const findByRef = db.prepare(
    `SELECT id, quote_ref, status, client_name, attn_name, phone, mobile, email, quotation_date
     FROM quotations WHERE quote_ref=? AND is_deleted=0`
  );
  const insertQ = db.prepare(
    `INSERT INTO quotations
       (project_code, quote_ref, client_name, project_name, location, salesperson,
        attn_name, phone, mobile, email, quotation_date, status, contract_value, remarks, created_by)
     VALUES (?,?,?,NULL,?,?,?,?,?,?,?,'quoted',NULL,NULL,?)`
  );
  const insertAudit = db.prepare(
    `INSERT INTO audit_log (action, module, record_id, record_ref, details, performed_by, performed_at)
     VALUES (?,?,?,?,?,?,datetime('now'))`
  );

  db.exec('BEGIN IMMEDIATE');
  try {
    const baseTs = Date.now();

    for (let i = 0; i < RECORDS.length; i++) {
      const r = RECORDS[i];
      const location = extractLocation(r.client);
      const existing = findByRef.get(r.qr);

      if (existing) {
        const isTerminal = TERMINAL_STATUSES.has(existing.status);
        const updates = {};
        if (r.client && r.client !== existing.client_name)   updates.client_name    = r.client;
        if (r.attn  && r.attn  !== existing.attn_name)       updates.attn_name      = r.attn;
        if (r.phone && r.phone !== existing.phone)            updates.phone          = r.phone;
        if (r.mobile && r.mobile !== existing.mobile)         updates.mobile         = r.mobile;
        if (r.email && r.email !== existing.email)            updates.email          = r.email;
        if (r.date  && r.date  !== existing.quotation_date)  updates.quotation_date = r.date;
        if (!isTerminal && existing.status !== 'quoted')      updates.status         = 'quoted';

        if (Object.keys(updates).length === 0) {
          unchanged++;
          log.push(`UNCHANGED  : ${r.qr}`);
        } else if (isTerminal) {
          manual_review++;
          log.push(`MANUAL_REV : ${r.qr} (status=${existing.status} protected)`);
        } else {
          const setCols = Object.keys(updates).map(k => `${k}=?`).join(', ');
          db.prepare(`UPDATE quotations SET ${setCols}, updated_at=datetime('now') WHERE id=?`)
            .run(...Object.values(updates), existing.id);
          updated++;
          log.push(`UPDATED    : ${r.qr}`);
          insertAudit.run('UPDATE','quotations', existing.id, r.qr,
            JSON.stringify({ batch: BATCH_ID, fields: Object.keys(updates) }), IMPORT_USER);
        }
      } else {
        const pc = `PC-${baseTs + i}`;
        insertQ.run(pc, r.qr, r.client, location, r.sp,
          r.attn || null, r.phone || null, r.mobile || null, r.email || null,
          r.date, IMPORT_USER);
        const newRow = db.prepare(`SELECT id FROM quotations WHERE project_code=?`).get(pc);
        created++;
        log.push(`CREATED    : ${r.qr} → id=${newRow.id}`);
        insertAudit.run('CREATE','quotations', newRow.id, r.qr,
          JSON.stringify({ batch: BATCH_ID, client: r.client, salesperson: r.sp }), IMPORT_USER);
      }
    }

    db.exec('COMMIT');

    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║   SALES QUOTATION IMPORT REPORT                     ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log(`  Batch    : ${BATCH_ID}`);
    console.log(`  Run At   : ${new Date().toISOString()}`);
    console.log(`  Source   : ${RECORDS.length} records`);
    console.log('  ────────────────────────────────────────────────────');
    console.log(`  Created  : ${created}`);
    console.log(`  Updated  : ${updated}`);
    console.log(`  Unchanged: ${unchanged}`);
    console.log(`  Manl Rev : ${manual_review}`);
    console.log('  ────────────────────────────────────────────────────');
    log.forEach(l => console.log(' ', l));
    const total = db.prepare('SELECT COUNT(*) c FROM quotations WHERE is_deleted=0').get().c;
    console.log(`\n  Total active quotations: ${total}`);
    console.log('\n  ✓ Import complete. Restart the app server now.\n');

  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    console.error('\n  !! IMPORT FAILED — ROLLED BACK !!');
    console.error('  Error:', err.message);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
