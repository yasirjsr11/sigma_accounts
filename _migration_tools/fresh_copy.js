// Fresh, consistent copy of the protected authoritative SQLite database + provenance record.
// Usage: node fresh_copy.js --source "C:\...\db\sh_pms.sqlite" --outdir "C:\xampp\htdocs\SH_PMS\_migration_source"
'use strict';
const { DatabaseSync, backup } = require('node:sqlite');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const args = Object.fromEntries(process.argv.slice(2).map((a,i,A)=>a.startsWith('--')?[a.slice(2),A[i+1]]:null).filter(Boolean));
if (!args.source || !args.outdir) { console.error('Usage: node fresh_copy.js --source <sqlite> --outdir <folder>'); process.exit(2); }
const SRC = path.resolve(args.source), OUT = path.resolve(args.outdir); fs.mkdirSync(OUT,{recursive:true});
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
(async()=>{
  const st0=fs.statSync(SRC), sha0=sha(SRC);
  const src=new DatabaseSync(SRC,{readOnly:true});
  const batch='MIG-'+new Date().toISOString().replace(/[-:]/g,'').slice(0,15)+'Z';
  const out=path.join(OUT,`sh_pms_source_${batch}.sqlite`);
  await backup(src,out); src.close();
  const st1=fs.statSync(SRC), sha1=sha(SRC);
  const d=new DatabaseSync(out,{readOnly:true});
  const tables=d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
  const rows=Object.fromEntries(tables.map(t=>[t,d.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c]));
  const testUsers=d.prepare("SELECT COUNT(*) c FROM users WHERE username LIKE 'zz_stage3_%'").get().c;
  const prov={batch_id:batch,source_path:SRC,source_size_bytes:st0.size,source_last_modified_utc:st0.mtime.toISOString(),source_sha256:sha0,
    source_unchanged_during_copy:sha0===sha1&&st0.mtimeMs===st1.mtimeMs,copy_method:'SQLite online backup API from a read-only connection',
    copy_file:path.basename(out),copy_sha256:sha(out),copy_integrity:d.prepare('PRAGMA integrity_check').get().integrity_check,
    table_count:tables.length,total_rows:Object.values(rows).reduce((a,b)=>a+b,0),stage3_test_users_present:testUsers,copied_at_utc:new Date().toISOString(),row_counts:rows};
  d.close(); const pf=path.join(OUT,`sh_pms_source_${batch}.provenance.json`); fs.writeFileSync(pf,JSON.stringify(prov,null,2));
  console.log(JSON.stringify({...prov,row_counts:undefined,copy_path:out,provenance_path:pf},null,2));
})().catch(e=>{console.error(e.stack||e.message);process.exit(1)});
