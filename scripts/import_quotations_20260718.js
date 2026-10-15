#!/usr/bin/env node
// SH-PMS Import: 18 New Quotations — 2026-07-18
// Run from app root: node scripts/import_quotations_20260718.js

const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(__dirname, '..', 'db', 'sh_pms.sqlite');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=MEMORY; PRAGMA foreign_keys=ON;');

const RAW = [
  ["6152",     "SY", "Dar Al Omran Architectural & Engineering Consultants", "Various Bed / Goods Lifts - Phase 2 Expansion Building for Luseili and Lehbab Medical Center at Dubai", "Alaa Almuzaini", "04-2999980", "054-4447997", "a.almuzaini@daralomran.com", "2026-07-06"],
  ["6153-OTJ", "SY", "Green Yard BC, Dubai", "Installation of Two (2) Nos. of 825 kg MITSUBISHI Passenger Elevators at G+1P+6+R Residential Building, Griffin Project, Plot No. 6185434, Nad Al Sheba 1, Dubai, UAE.", "Engr. Mena Saeed", "", "052-5912145", "", "2026-07-04"],
  ["6154",     "MM", "Bow house building construction LLC", "2346-SHJ: 1No. 800Kg PL - G+M Proposed Shed for Haiyan Xiong, Plot No. 312 at Al Madina Al Qasimia / Industrial 1, Sharjah", "Engr. Osama", "", "054-7866743", "", "2026-07-06"],
  ["6155",     "MM", "Bow house building construction LLC", "2339-SHJ: 1No. 800Kg PL - G+M Proposed Shed for Haiyan Xiong, Plot No. 916 at Al Madina Al Qasimia / Industrial 1, Sharjah", "Engr. Osama", "", "054-7866743", "", "2026-07-06"],
  ["6156",     "NM", "Sea Shore Constructions LLC", "3Nos. 1050Kg PL - G+4 (05 Stops) Proposed Building for Mr.Hadi Ahmad Qasim Alkhatib, Plot No. 5997644, Jebal Ali, Dubai", "Engr. Vinooj", "04-2510464", "055-1283108", "", "2026-07-06"],
  ["6157",     "SY", "Mr. Hamid Abdulla Ali Rashid Al Bedewi", "1No. 450Kg PL - G+1 (02 Stops) Proposed Villa, Plot No. 2569, Al Rahmaniyah-6, Sharjah", "Umm Abdullah", "", "052-8000089", "", "2026-07-06"],
  ["6158-MAT", "SY", "Dar Al Mehairi Real Estate LLC", "Comprehensive Maintenance of Lifts installed in Various Buildings in Dubai", "Ms. Jannat Ghumman", "", "050-9675700", "jannat@alfursancont.com", "2026-07-07"],
  ["6159",     "SY", "Loyal BC - Sun Power", "2Nos: 180 Deg. Door Opening, 1No. 630Kg PL, G+2 (03 Stops) & 1No. 630Kgs G+2 (03 Stops) PL with Steel Structure - Existing & Proposed Warehouse for Sun Power at Technopark, Dubai", "Mr. Arun Prathab", "04-4412398", "055-2219894", "arun@loyalbuild.ae,projectcdr@loyalbuild.ae,jenson@loyalbuild.ae,skumar@loyalbuild.ae,frandafdilip@gmail.com", "2026-07-08"],
  ["6160",     "SY", "Saliheen Construction LLC", "1No. 1050Kg PL - G+1 (02 Stops) Office Building at Jebal Ali, Dubai", "Mr. Anuj Gandhi", "04-4324490", "052-9368867", "saliheen.saliheen@gmail.com", "2026-07-09"],
  ["6161-OTJ", "SY", "Mr. Khalid Mohammed Haidar Ali Alamadi Ref. SKJ Creative Cont.", "Power Load Letter for 1No. 630Kgs G+1 (02 Stops) Villa - Plot No. 685, Hay Hoshi Al Bedea Suburb, Sharjah", "Er. Abdul Samad", "", "056-3290296", "", "2026-07-11"],
  ["6162",     "NM", "Hassan Salmeen BC, Dubai", "180Deg: 2Nos. 800Kg PL - B+G+6+R Residential Apartment for Al Danah Capital (FZC), Plot No. RG-21, Dubai Aviation City, Dubai", "Eng. Aman Pratap Singh", "04-2677909", "052-1042077", "amanhsbcl@gmail.com,qamarlari.hsbcl@gmail.com,hsbcl.uae@gmail.com", "2026-07-16"],
  ["6163",     "NM", "Al Masar Al Hadeth BC, Ajman", "2Nos. 800Kg PL - G+5 Comm. & RB for Zainab Ahmed Mohammed Al Marzooqi, Plot No. 2296, Aalia, Ajman", "Engr. Halith", "", "054-4657883", "", "2026-07-16"],
  ["6164",     "SY", "Blue Rhine Cont. Dubai", "8Nos. 630Kg PL - G+1 Villa (A1) - Al Furjan Elite Real Estate (LLC), Jalabl Ali First - 591, Dubai", "Mr. Shaqueb Imteyaz", "04-8231444", "056-4157509", "shaqueb@bluerhinecontracting.com", "2026-07-16"],
  ["6165",     "SY", "Modern Architecture EC, Dibba", "1No. 1050Kg PL - G+5 RB - Mr. Saeed Rashed Ahmed Rashed AlDhanhani, Plot No. 3010021, Al Rifaa, Dibba", "Engr. Abdullah", "", "052-9977119", "", "2026-07-16"],
  ["6166-MAT", "SY", "Amal Owners Community Management", "Comprehensive Maintenance of 8 Nos. Sigma Lifts installed in Amal Tower, Dubai Sports City", "Mr. Baghya Gladwin", "04-4430813", "", "baghya@amalcommunitymanagement.com", "2026-07-17"],
  ["6167",     "SY", "Falcon Rising Cont., Dubai", "1No. 630Kg Brown Tinted - GL with SS & GC - B+G+1+R Villa for Mr. Zeeshan Ahmed Iftikhar Ahmed, Plot No. 6316568, HSMBR, Dubai", "Engr. Jithin / Azar", "", "056-7225578", "", "2026-07-18"],
  ["6168-OTJ", "SY", "Bin Suloom Group, Dubai", "Elevator Snag Rectification Works (OTJ) for Elevators at G+P1+P2+5 Typical Building, Muweillah, Sharjah", "Mr. Anoop Krishnan", "04-2834455", "052-3747991", "procurment@binsuloomgroup.com", "2026-07-18"],
  ["6169",     "NM", "Al Ishrak Cont. Co. LLC, Dubai", "2Nos. PL & 1No. SL for 2B+G+12 Typical Floors Building for Mr. Mohamed Atiq Abdulla Bin Saifan Alfalasi, Plot No. 6488735, Wadi Al Safa-5, Dubai", "Engr. Nawazish Khan", "04-3416841", "", "info@alishrak.com", "2026-07-18"],
];

function extractLocation(client, desc) {
  const t = (client + ' ' + desc).toLowerCase();
  if (t.includes('ajman'))        return 'Ajman';
  if (t.includes('sharjah') || t.includes('shj')) return 'Sharjah';
  if (t.includes('dibba'))        return 'Fujairah';
  if (t.includes('dubai'))        return 'Dubai';
  if (t.includes('abu dhabi'))    return 'Abu Dhabi';
  return '';
}

const inserted = [], updated = [], errors = [];
let ts = Date.now();

const stmtCheck   = db.prepare('SELECT id FROM quotations WHERE quote_ref=? AND is_deleted=0');
const stmtUpdate  = db.prepare(`UPDATE quotations SET
  client_name=?, project_name=?, salesperson=?, attn_name=?,
  phone=?, mobile=?, email=?, quotation_date=?, location=?,
  status='Quoted', updated_at=datetime('now')
  WHERE id=? AND is_deleted=0`);
const stmtInsert  = db.prepare(`INSERT INTO quotations
  (project_code, quote_ref, client_name, project_name, location, salesperson,
   attn_name, phone, mobile, email, quotation_date, status,
   currency_code, currency_symbol, source_sheet, created_by)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const stmtPcCheck = db.prepare('SELECT id FROM quotations WHERE project_code=?');

for (const [qref, sp, client, proj, attn, phone, mobile, email, qdate] of RAW) {
  try {
    const existing = stmtCheck.get(qref);
    const location = extractLocation(client, proj);
    if (existing) {
      stmtUpdate.run(client, proj, sp, attn,
        phone||null, mobile||null, email||null, qdate, location||null, existing.id);
      updated.push(qref);
    } else {
      let pc = 'PC-' + (++ts);
      if (stmtPcCheck.get(pc)) pc = 'PC-' + (++ts) + '-' + Math.floor(Math.random()*9999);
      stmtInsert.run(pc, qref, client, proj, location||null, sp,
        attn, phone||null, mobile||null, email||null,
        qdate, 'Quoted', 'AED', 'AED', 'Manual Import 2026-07-18', 'system');
      inserted.push(qref);
    }
  } catch(e) {
    errors.push(`${qref}: ${e.message}`);
  }
}

const total = db.prepare('SELECT COUNT(*) AS c FROM quotations WHERE is_deleted=0').get().c;
db.close();

console.log('========================================');
console.log('SH-PMS Quotation Import — 2026-07-18');
console.log('========================================');
console.log(`Records in source : ${RAW.length}`);
console.log(`New records added : ${inserted.length}`);
console.log(`Existing updated  : ${updated.length}`);
console.log(`Errors            : ${errors.length}`);
console.log(`Total in DB now   : ${total}`);
if (inserted.length) console.log('\nINSERTED:', inserted.join(', '));
if (updated.length)  console.log('UPDATED :', updated.join(', '));
if (errors.length)   console.log('ERRORS  :', errors.join('\n          '));
console.log('\nDone. No other modules were modified.');
