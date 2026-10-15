'use strict';
// SH PMS — SQLite (source copy) vs MySQL: every table, every row, every column + business totals + structure.
const fs = require('fs'); const { DatabaseSync } = require('node:sqlite'); const mysql = require('mysql2/promise');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, A) => a.startsWith('--') ? [a.slice(2), A[i + 1]] : null).filter(Boolean));
const env = Object.fromEntries(fs.readFileSync(args.env, 'utf8').split('\n').filter(l => /^\w+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const q = n => '`' + n + '`';
const sameVal = (a, b) => { if (String(a) === String(b)) return true; const A = String(a).split(' / '), B = String(b).split(' / ');
  return A.length === B.length && A.every((x, i) => x !== '' && !isNaN(Number(x)) && Number(x) === Number(B[i])); };
(async () => {
  const d = new DatabaseSync(args.source, { readOnly: true });
  const cn = await mysql.createConnection({ host: env.DB_HOST, port: +env.DB_PORT, user: env.MIGRATION_DB_USER, password: env.MIGRATION_DB_PASSWORD, database: args.target, dateStrings: true, decimalNumbers: true, supportBigNumbers: true, charset: 'UTF8MB4_UNICODE_CI' });
  await cn.query('SET NAMES utf8mb4 COLLATE utf8mb4_nopad_bin'); await cn.query("SET SESSION sql_mode='STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION,PIPES_AS_CONCAT', time_zone='+04:00', group_concat_max_len=1048576");
  const tables = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);
  const res = { tables: [], mismatches: [], totals: [], dates: {} };
  const DATE_COL = /date|_at$|^eta$|^etd$|period_(start|end)|start|end/i; let dateCols = 0, dateVals = 0;
  for (const t of tables) {
    const cols = d.prepare(`PRAGMA table_info("${t}")`).all(); const pk = cols.filter(c => c.pk).map(c => c.name);
    const types = Object.fromEntries(cols.map(c => [c.name, (c.type || '').toUpperCase()]));
    const sRows = d.prepare(`SELECT * FROM "${t}" ORDER BY ${pk.map(p => `"${p}"`).join(',')}`).all();
    const [mRows] = await cn.query(`SELECT * FROM ${q(t)} ORDER BY ${pk.map(q).join(',')}`);
    const [mcols0] = await cn.query(`SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`, [args.target, t]);
    const mcols = mcols0.filter(m => !String(m.c).startsWith('__shpms_uq_'));
    const colsOk = mcols.length === cols.length && cols.every(c => mcols.some(m => m.c === c.name));
    for (const c of cols) if (DATE_COL.test(c.name) && !/INT|REAL/.test(types[c.name])) { dateCols++; dateVals += sRows.filter(r => r[c.name] != null && r[c.name] !== '').length; }
    let bad = 0; const n = Math.max(sRows.length, mRows.length);
    for (let i = 0; i < n; i++) { const a = sRows[i], b = mRows[i];
      if (!a || !b) { bad++; res.mismatches.push({ t, i, issue: !a ? 'extra row in MySQL' : 'missing row in MySQL' }); continue; }
      for (const c of cols) { const x = a[c.name], y = b[c.name]; let eq;
        if (x === null || y === null) eq = x === y;
        else if (/REAL|FLOA|DOUB|NUM|DEC/.test(types[c.name])) eq = Math.round(Number(x) * 100) === Math.round(Number(y) * 100);
        else if (typeof x === 'number' || typeof x === 'bigint') eq = Number(x) === Number(y);
        else eq = String(x) === String(y);
        if (!eq) { bad++; if (res.mismatches.length < 50) res.mismatches.push({ t, pk: pk.map(p => a[p]).join('/'), col: c.name, sqlite: /password|secret|token/i.test(c.name) ? '<redacted>' : x, mysql: /password|secret|token/i.test(c.name) ? '<redacted>' : y }); } } }
    res.tables.push({ table: t, source: sRows.length, mysql: mRows.length, diff: mRows.length - sRows.length, value_mismatches: bad, columns_ok: colsOk, status: (bad === 0 && colsOk && sRows.length === mRows.length) ? 'MATCH' : 'MISMATCH' });
  }
  res.dates = { date_like_text_columns: dateCols, non_empty_date_values_compared: dateVals, shifted: res.mismatches.filter(m => m.col && DATE_COL.test(m.col)).length };
  const T = JSON.parse(fs.readFileSync(__dirname + '/business_totals.json', 'utf8'));
  for (const [label, sql, sqliteSql] of T) {
    const a = d.prepare(sqliteSql || sql).get().v; const [[b]] = await cn.query(sql);
    const st = sameVal(a, b.v) || (a == null && b.v == null) ? 'MATCH' : 'MISMATCH';
    // credential material is never written to logs: compare in memory, record only a SHA-256 digest
    const red = v => /password|hash|secret/i.test(label) && v != null ? 'sha256:' + require('crypto').createHash('sha256').update(String(v)).digest('hex') : v;
    res.totals.push({ metric: label, sqlite: red(a), mysql: red(b.v), status: st });
  }
  const [[fkc]] = await cn.query("SELECT COUNT(*) n FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=?", [args.target]);
  const [[trc]] = await cn.query("SELECT COUNT(*) n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=?", [args.target]);
  const [[ixc]] = await cn.query("SELECT COUNT(DISTINCT TABLE_NAME, INDEX_NAME) n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND INDEX_NAME<>'PRIMARY'", [args.target]);
  const ai = []; for (const t of tables) { const [[m]] = await cn.query(`SELECT AUTO_INCREMENT a FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`, [args.target, t]);
    const mx = d.prepare(`SELECT MAX(rowid) m FROM "${t}"`).get().m || 0; const sq = (d.prepare('SELECT seq FROM sqlite_sequence WHERE name=?').get(t) || {}).seq || 0;
    if (m.a != null && m.a <= Math.max(mx, sq)) ai.push(`${t}: auto_increment ${m.a} <= ${Math.max(mx, sq)}`); }
  const [[tu]] = await cn.query("SELECT COUNT(*) n FROM users WHERE username LIKE 'zz\\_stage3\\_%'");
  res.structure = { foreign_keys: fkc.n, triggers: trc.n, secondary_indexes: ixc.n, auto_increment_issues: ai, test_users_in_target: tu.n };
  fs.writeFileSync(args.out, JSON.stringify(res, null, 1));
  const tm = res.tables.filter(x => x.status !== 'MATCH'), bm = res.totals.filter(x => x.status !== 'MATCH');
  console.log(`tables ${res.tables.length}: ${res.tables.length - tm.length} MATCH, ${tm.length} MISMATCH · rows source ${res.tables.reduce((s, x) => s + x.source, 0)} / mysql ${res.tables.reduce((s, x) => s + x.mysql, 0)} · value mismatches ${res.tables.reduce((s, x) => s + x.value_mismatches, 0)}`);
  console.log(`business totals ${res.totals.length}: ${res.totals.length - bm.length} MATCH, ${bm.length} MISMATCH`); bm.forEach(x => console.log('  ', JSON.stringify(x)));
  console.log('dates', JSON.stringify(res.dates)); console.log('structure', JSON.stringify(res.structure)); tm.forEach(x => console.log('  ', JSON.stringify(x))); res.mismatches.slice(0, 10).forEach(x => console.log('  ', JSON.stringify(x)));
  await cn.end();
})().catch(e => { console.error(e); process.exit(1); });
