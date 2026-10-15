// Phase 3 update (2026-06-28): FJ-116 amount correction + Reviewed marking for FJ-094/FJ-116.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'sh_pms.sqlite'));
db.exec('PRAGMA journal_mode = MEMORY;');

function run(sql, params = []) { return db.prepare(sql).run(...params); }
function get(sql, params = []) { return db.prepare(sql).get(...params); }

const now = new Date().toISOString();
const today = '2026-06-28';
const reviewedBy = 'Shathurudeen Yasir';

// 1. FJ-116 (id 247) - #REF! resolved in the updated ED-SH-FACTORY-QUOTES upload.
run(`UPDATE factory_ins_quotes SET
       factory_quote_amount = 10500,
       advance_payment = 3150,
       balance_payment = 7350,
       total_paid = 10500,
       balance_payable = 0,
       needs_review = 0,
       needs_review_reason = NULL,
       updated_at = ?
     WHERE id = 247`, [now]);
console.log('FJ-116 (id 247) amount fields corrected:', get('SELECT factory_ref, factory_quote_amount, advance_payment, balance_payment, total_paid, balance_payable, needs_review FROM factory_ins_quotes WHERE id = 247'));

// 2. Mark FJ-094 (both rows) and FJ-116 as Reviewed, with verification notes.
const reviews = [
  { id: 238, note: 'Reviewed 2026-06-28. Verified against updated ED-SH-FACTORY-QUOTES upload - all fields match exactly, no changes needed. Linked Contract Ref.: SH-110 (Linked). Linked Factory Ref.: FJ-094. No missing/unmatched fields.' },
  { id: 284, note: 'Reviewed 2026-06-28. Verified against updated ED-SH-FACTORY-QUOTES upload - matches exactly, no changes needed. Linked Contract Ref.: SH-110 (Linked). Linked Factory Ref.: FJ-094 (duplicate occurrence - same Factory Ref. appears twice in source sheet with different line items; kept as separate records per original import decision, not a data error).' },
  { id: 247, note: 'Reviewed 2026-06-28. Source #REF! formula error resolved in updated ED-SH-FACTORY-QUOTES upload - factory_quote_amount/advance_payment/balance_payment corrected to 10500/3150/7350. Linked Contract Ref.: SH-042 (Linked). Linked Factory Ref.: FJ-116. No missing/unmatched fields remaining.' },
];

for (const r of reviews) {
  const existing = get('SELECT linked_contract_status FROM factory_ins_quotes WHERE id = ?', [r.id]);
  if (existing.linked_contract_status !== 'Linked') {
    console.log(`SKIPPED id ${r.id}: linked_contract_status is "${existing.linked_contract_status}", not Linked - cannot mark Reviewed.`);
    continue;
  }
  run(`UPDATE factory_ins_quotes SET reviewed_status = 'Reviewed', reviewed_date = ?, reviewed_by = ?, review_note = ? WHERE id = ?`,
    [today, reviewedBy, r.note, r.id]);
  console.log(`Marked id ${r.id} Reviewed.`);
}

console.log('\nFinal state:');
console.log(db.prepare(`SELECT id, factory_ref, contract_ref, linked_contract_status, factory_quote_amount, total_paid, balance_payable, needs_review, reviewed_status, reviewed_date, reviewed_by FROM factory_ins_quotes WHERE id IN (238,284,247) ORDER BY id`).all());

db.close();
