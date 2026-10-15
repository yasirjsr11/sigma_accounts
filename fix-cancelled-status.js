// One-time reconciliation: set maintenance_status='Cancelled' for records
// whose matching old maintenance_contracts row has renewal_status='Cancelled'
// and have no approved amc_renewals entry.
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('db/sh_pms.sqlite');

const ids = db.prepare(`
  SELECT mp.id, mp.contract_ref, mp.maintenance_status
  FROM maintenance_projects mp
  JOIN maintenance_contracts mc ON mc.contract_ref = mp.contract_ref AND mc.renewal_status = 'Cancelled'
  LEFT JOIN amc_renewals ar ON ar.maintenance_project_id = mp.id AND ar.is_deleted = 0 AND ar.renewal_status = 'Approved'
  WHERE mp.is_deleted = 0 AND mp.maintenance_status != 'Cancelled' AND ar.id IS NULL
`).all();

console.log('Records to update:', ids.map(r => `${r.contract_ref} (was: ${r.maintenance_status})`).join(', '));

const upd = db.prepare(`UPDATE maintenance_projects SET maintenance_status='Cancelled', updated_at=datetime('now') WHERE id=?`);
ids.forEach(r => upd.run(r.id));
console.log(`Updated ${ids.length} records.`);

const check = db.prepare(`SELECT contract_ref, maintenance_status FROM maintenance_projects WHERE contract_ref IN ('SHM-2029','SHM-2031','SHO-1020','SH-094')`).all();
console.log('Verification:', check);
