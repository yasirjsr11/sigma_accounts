#!/usr/bin/env node
// =============================================================
// update_project_descriptions_20260921.js
// Updates project_name (Project Description) for the 51 quotation
// records imported by SALES_QUOTATION_UPDATE_20260921.
//
// INSTRUCTIONS:
//   1. Fill in the 'desc' field for each quote ref below.
//   2. Stop the app server.
//   3. Run: node db/update_project_descriptions_20260921.js
//   4. Restart the app server.
//
// Leave desc: null or '' for any record you want to skip.
// =============================================================
'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const DB_PATH = path.join(__dirname, 'sh_pms.sqlite');

// ── Descriptions from Quotation Submitted Register ─────────────
const DESCRIPTIONS = [
  { qr: '6183', desc: '1No. 630Kgs Semi-Circular GL - Proposed (B+G+1) Villa for Mr. Sulaiman Al Bassam, Plot No. 1169, Al Mizhar 2nd, Dubai' },
  { qr: '6184', desc: 'Project No. T161: 3Nos. 1150Kgs PL - Proposed (G+P2+12+R) RB for DIVO Home Estate Development LLC at Dubai' },
  { qr: '6185', desc: '1No. 800Kg PL - G+2 RB for Mr. Javed Khan Akbar Khan, Plot No. 3805 at Zahya-1, Ajman' },
  { qr: '6186', desc: '2Nos. PL & 1No. SL - G+1POD+6+R RB for Serene Marina RE Development LLC, Plot No. DIA-RE-0210, Deira Islands, Dubai' },
  { qr: '6187', desc: '2Nos. PL & 1No. SL - G+1POD+6+R RB for Serene Marina RE Development LLC, Plot No. DIA-RE-0210, Deira Islands, Dubai' },
  { qr: '6188', desc: '2Nos. PL - B+G+6 RB & CB for Mr. Muhammad Imran Haider Zaman & Abdul Samad Abdul Hameed & Sagar Larai Sundoo Larai, Plot IC3-59.13, Warsan 4th - 624, Dubai' },
  { qr: '6189', desc: '1No. 2Ton Cargo Lift - G+M Shed Project for Hao Zhang, Plot No. 2410 at Al Madina Al Qasimia / Industrial 1, Sharjah' },
  { qr: '6190', desc: '1No. 2Ton Cargo Lift - G+1 Hyper Market Building at Jabal Ali Ind.-1, Dubai' },
  { qr: '6191', desc: '2Nos. 1350 Kg - G+2P+8 RB for Grovy Develipers, Plot No. DIA-RE-220, Nakhalat Deira-101 (Dubai Island), Dubai' },
  { qr: '6192', desc: '1No. 630 Kg - G+4 RB, Plot No. 2824, Aalia, Ajman' },
  { qr: '6193', desc: '1No. 1250Kg PL - G+M+1 Proposed Factory for M/s. Suntech Glass Industries LLC, Plot No. 5337847, Dubai Industrial City, Saih Shuaib-4, Dubai' },
  { qr: '6194', desc: '7Nos. PL including with Separator Beam for G+2P+12+RF (16 Stops) RA-42 Residential at Dubai South, UAE' },
  { qr: '6195', desc: '1No. 1250 Kg PL - G+1P+1+R RB for Mr. Abdulla Athiek Abdullab Bourqiebah, Plot No. 3541791, Al Quoz 1st, Dubai' },
  { qr: '6196', desc: 'T166: 1No. 750 Kg GL with SS & GC - B+G+2+R Residential Villa at Umm Suqeim-1, Dubai' },
  { qr: '6197', desc: '1No. 630Kgs PL - Mr. Reza Bahramirad (G+1) Villa, Plot No. AFNBVIL005, Jabal Ali 1st - 591, Dubai' },
  { qr: '6198', desc: '1No. 400Kgs PL - G+1 Villa in Al Khawaneej 2nd, Dubai' },
  { qr: '6199', desc: '1No. 750Kgs PL - G+1 Villa for Mr. Abdulla Mohd Abdulla AlKhaja, Plot No. 7117458, Al Awir 1st, Dubai' },
  { qr: '6200', desc: '1No. 450Kgs PL - G+2 Villa, Plot No. 2973, Hay Al Ghazir, Sharjah' },
  { qr: '6201', desc: 'RG-98: 4No. 450Kgs PL - G+4+R RB, Plot No. RG-98, Dubai South, Dubai' },
  { qr: '6202', desc: '2Nos. 1050 Kg - G+P+6+R (09 Stops) RB for Mr. Mohammad Abdulrahim Abdulkarim, Plot No. 4210463, Al Warqa 1st, Dubai' },
  { qr: '6203', desc: '1No. 750 Kg B+G+1+R Villa & 1No. 2Ton Car Lift - Mr. Neeraj Bhatia Rajesh Bhatia, WS 37, Sobha Hartland, Plot No. 3473253, Al Merkadh, Dubai' },
  { qr: '6204', desc: '180 Deg, 2Nos. 1050 Kg - B+G+6+R (10 Stops) RB for Al Danah Capital (FZC), Plot No. RG-21 at Dubai Aviation City, Dubai' },
  { qr: '6205', desc: '1No. 750 Kg - G+4 (05 Stops) RB, Plot No. 2622, Ajman' },
  { qr: '6206', desc: '1No. 750 Kg PL - G+1 (02 Stops) Villa, Plot No. 406132391, Awafi, Sharjah' },
  { qr: '6207', desc: '1No. 630 Kg PL - G+1+R (03 Stops) Extension Villa - Mr. Sultan Juma Suhail Al Zaffin, Plot No. 342-820, Jumeirah 2nd, Dubai' },
  { qr: '6208', desc: '1No. 630 Kg Home Platform Lift with AS & GC - G+1 (02 Stops) Private Villa, Al Khawaneej, Dubai' },
  { qr: '6209', desc: "2Nos. 1050 Kg PL - G+1P+6+R RB - Mr. Mohammad Abdulrahim Abdulkarim Al Banna, Mohammed Ahmad Abdulrahman Al Mohammed, Plot No. 4210463, Al Warqa'a 1st, Dubai" },
  { qr: '6210', desc: 'PRO-24-414: 1No. 750 Kg PL - G+1+2 Villa for Mr. Saeed Humaid Abdulla Al Shaiba Al Nuaimi, Plot No. 71113414, Al Awir 1st, Dubai (Shaft: 1900 x 2650, GF: 5.4M, 1F: 4.5M, 2F: 4.4M)' },
  { qr: '6211', desc: 'PRO-24-415: 1No. 450 Kg PL - G+1 Villa for Mr. Khalifa Nasser Humaid Al Shaiba Al Nuaimi, Plot No. 5138231, Saih Shuaib-1, Dubai (Shaft: 1700 x 1500, GF: 5.95M, 1F: 3.7M)' },
  { qr: '6212', desc: 'PRO-24-416: 1No. 450 Kg PL - G+1 Villa for Mr. Humaid Nasser Humaid Al Shaiba Al Nuaimi, Plot No. 5138232, Saih Shuaib-1, Dubai (Shaft: 1700 x 1500, GF: 5.95M, 1F: 3.7M)' },
  { qr: '6213', desc: '1No. 630Kgs GL with SS & GC - G+1+R Villa at Dubai South, Dubai' },
  { qr: '6214', desc: '1No. 450Kgs PL - B+G+1+R Villa for Mr. Nabil Abdulla Yahya Alalawi, Plot No. 3751683, Al Barsha 3rd, Dubai' },
  { qr: '6215-MAT', desc: 'Non-Comprehensive AMC of Fuji Hitech Brand installed at G+4 RB, Plot No. 6439736, Wadi Al Safa-2, Dubai' },
  { qr: '6216', desc: 'Dismantling of Existings Lift, Supply and Replacement of 1No. 630Kgs PL - G+M+2 (04 Stops) Residential Building, Plot No. 0799, Al Zourah, Umm Al Quwain' },
  { qr: '6217', desc: '1No. 630Kgs PL - G+3 RB for Mr. Saeed Obaid Ali Alabd Al Ketbi, Plot No. 3602, Muweillah, Sharjah' },
  { qr: '6218', desc: 'P364 / P383: 1No. 800Kgs PL - G+1+R (03 Stops) Residential and Commercial Building for Mr. Salem Hamad Saeed Malhoof Al Ketbi, Plot No. 3541793, Al Quoz 1st, Dubai' },
  { qr: '6219', desc: '1No. PL, 1No. SL & 2Nos. Escalators - B+G+1+R Nad Al Sheba Retail & Offices for Symphony Ventures Real Estate LLC SOC, Plot No. 6159661, Nad Al Sheba 2nd, Dubai' },
  { qr: '6220', desc: '1No. 630Kgs PL - G+1 Villa for Mr. Abdulla Abdulrahman Al Ali, Plot No. 7117720, Al Awir 1st, Dubai' },
  { qr: '6221', desc: '1No. 750Kgs PL & 1No. 3Ton CL - B+G+2 Villa for Mr. Falih Hashim Hussein Al Janabi, Plot No. JPMVIL017, Al Thanyah 1st, Dubai' },
  { qr: '6222', desc: '2Nos. 630Kgs PL - G+5 Comm + RB for Zainab Ahmed Mohjammed Al Marzooqi, Plot No. 2284, Aalia, Ajman' },
  { qr: '6223', desc: '1No. 750 kg PL - G+M Juma Masjid Project for Islamic Affairs & Charitable Activities Department, Plot 71111392, Al Awir 1st, Dubai' },
  { qr: '6224', desc: '1No. 630 kg PL - G+2+R RB, Plot 2160263, Al Rashideya, Dubai' },
  { qr: '6225', desc: '1No. 630 kg PL - G+1+R Villa No. 34, Plot No. 2276638, Al Twar 2nd, Dubai' },
  { qr: '6226', desc: '1No. 630 kg PL - G+3 RB for Mr. Muhammad Qasim Muhammad Dharwarwala Mohammad Owais Dharwala Ashfaq, Plot 4882, Al Tilal, Sharjah (Ref. Quote. 2199)' },
  { qr: '6227', desc: '1No. 630 kg PL - G+4 RB for Mr. Muhammad Amin Memon Haji Sattar, Plot 6670, Al Tilal, Sharjah (Ref. Quote. 2557)' },
  { qr: '6228', desc: '1No. 6m Dia Car Rotatin Platfrom for Shikha Jatin Shan Villa, Villa C23, Plot No. 3323789 at La Mer, Jumeirah First, Dubai' },
  { qr: '6229', desc: '1No. 630Kgs PL - G+1+R Proposed Villa for Mr. Saeed Younes Salem Humaid AlSuwaidi, Plot No. 71112196, Al Awir 1st, Dubai' },
  { qr: '6230', desc: '1No. 630Kgs PL - G+1+R Proposed Villa for Mr. Saeed Younes Salem Humaid AlSuwaidi, Plot No. 71112195, Al Awir 1st, Dubai' },
  { qr: '6231', desc: '1No. 450Kgs PL - G+1+R Proposed Villa, Plot No. 6185653, Nad Al Sheba Gardens, Dubai' },
  { qr: '6232', desc: '1No. 630Kgs GL - G+1+R Proposed Villa - Al Zorah Development (Private) Company Limited FZC, Plot No. 1322, Zorah, Ajman' },
  { qr: '6233', desc: '2Nos. PL & 1No. SL - G+2P+11 RB for Sheikh Abdulaziz Mohamed Majid, Plot No. 232-0301 at Al Qusais 1st, Dubai' },
];
// ───────────────────────────────────────────────────────────────

function main() {
  const db = new DatabaseSync(DB_PATH);
  const stmt = db.prepare(
    `UPDATE quotations SET project_name=?, updated_at=?
     WHERE quote_ref=? AND is_deleted=0`
  );
  const now = new Date().toISOString();
  let updated = 0, skipped = 0;

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const { qr, desc } of DESCRIPTIONS) {
      if (desc === null || desc === '') { skipped++; continue; }
      const info = stmt.run(desc.trim(), now, qr);
      if (info.changes > 0) {
        console.log(`  Updated ${qr}: ${desc.trim().slice(0, 60)}...`);
        updated++;
      } else {
        console.log(`  WARN: ${qr} not found in DB`);
        skipped++;
      }
    }
    db.exec('COMMIT');
    console.log(`\nDone: ${updated} updated, ${skipped} skipped`);
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    console.error('ERROR:', err.message);
    process.exit(1);
  }
  db.close();
}

main();
