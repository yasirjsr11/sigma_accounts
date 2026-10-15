'use strict';
// ══════════════════════════════════════════════════════════════════════════════
// SH PMS Cloud — SQLite → MariaDB 10.4 SQL dialect translation (used by db/mysqlSync.js)
// The application's SQL was written for SQLite. Every statement passes through
// translate() once (cached) so route / business code stays unchanged.
// Target semantics = SQLite on a utf8mb4_nopad_bin database:
//   =, ORDER BY, GROUP BY, UNIQUE      → binary / case-sensitive (as SQLite BINARY)
//   LIKE, COLLATE NOCASE               → case-insensitive (as SQLite)
//   ||                                 → string concat (session sql_mode PIPES_AS_CONCAT)
//   date('now') / datetime('now')      → UTC (as SQLite); 'localtime' → session +04:00
//   GROUP BY output order / ORDER BY ties → reproduced (see stabilizeOrder)
// ══════════════════════════════════════════════════════════════════════════════
const CI = 'utf8mb4_unicode_nopad_ci';
// MariaDB 10.4.0 reserved words (information_schema.KEYWORDS RESERVED=1) — quoted when used as aliases
const RESERVED = new Set(['accessible','add','all','alter','analyze','and','as','asc','asensitive','before','between','bigint','binary','blob','both','by','call','cascade','case','change','char','character','check','collate','column','condition','constraint','continue','convert','create','cross','cube','cume_dist','current_date','current_time','current_timestamp','current_user','cursor','database','databases','day_hour','day_microsecond','day_minute','day_second','dec','decimal','declare','default','delayed','delete','dense_rank','desc','describe','deterministic','distinct','distinctrow','div','double','drop','dual','each','else','elseif','empty','enclosed','escaped','except','exists','exit','explain','false','fetch','first_value','float','float4','float8','for','force','foreign','from','fulltext','function','generated','get','grant','group','grouping','groups','having','high_priority','hour_microsecond','hour_minute','hour_second','if','ignore','in','index','infile','inner','inout','insensitive','insert','int','int1','int2','int3','int4','int8','integer','intersect','interval','into','io_after_gtids','io_before_gtids','is','iterate','join','json_table','key','keys','kill','lag','last_value','lateral','lead','leading','leave','left','like','limit','linear','lines','load','localtime','localtimestamp','lock','long','longblob','longtext','loop','low_priority','master_bind','master_ssl_verify_server_cert','match','maxvalue','mediumblob','mediumint','mediumtext','middleint','minute_microsecond','minute_second','mod','modifies','natural','no_write_to_binlog','not','nth_value','ntile','null','numeric','of','on','optimize','optimizer_costs','option','optionally','or','order','out','outer','outfile','over','partition','percent_rank','precision','primary','procedure','purge','range','rank','read','read_write','reads','real','recursive','references','regexp','release','rename','repeat','replace','require','resignal','restrict','return','revoke','right','rlike','row','row_number','rows','schema','schemas','second_microsecond','select','sensitive','separator','set','show','signal','smallint','spatial','specific','sql','sql_big_result','sql_calc_found_rows','sql_small_result','sqlexception','sqlstate','sqlwarning','ssl','starting','stored','straight_join','system','table','terminated','then','tinyblob','tinyint','tinytext','to','trailing','trigger','true','undo','union','unique','unlock','unsigned','update','usage','use','using','utc_date','utc_time','utc_timestamp','values','varbinary','varchar','varcharacter','varying','virtual','when','where','while','window','with','write','xor','year_month','zerofill']);

function literalMask(s) { const mask = new Uint8Array(s.length); let q = null;
  for (let i = 0; i < s.length; i++) { const c = s[i];
    if (q) { mask[i] = 1; if (c === q) { if (s[i + 1] === q) { mask[i + 1] = 1; i++; } else q = null; } continue; }
    if (c === "'") { q = c; mask[i] = 1; } }
  return mask; }
function matchParen(s, open) { let depth = 0, q = null;
  for (let i = open; i < s.length; i++) { const c = s[i];
    if (q) { if (c === q) { if (s[i + 1] === q) i++; else q = null; } continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '(') depth++; else if (c === ')') { depth--; if (depth === 0) return i; } }
  return -1; }
function splitArgs(s) { const out = []; let depth = 0, q = null, start = 0;
  for (let i = 0; i < s.length; i++) { const c = s[i];
    if (q) { if (c === q) { if (s[i + 1] === q) i++; else q = null; } continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '(') depth++; else if (c === ')') depth--; else if (c === ',' && depth === 0) { out.push(s.slice(start, i).trim()); start = i + 1; } }
  out.push(s.slice(start).trim()); return out; }
// Rewrite every call fn(...) outside literals; cb(args) → replacement string, or null to keep
function rewriteCalls(sql, fn, cb) {
  const re = new RegExp(`\\b${fn}\\s*\\(`, 'ig'); let out = '', last = 0, m; const lit = literalMask(sql);
  while ((m = re.exec(sql))) {
    if (lit[m.index]) continue;
    const open = m.index + m[0].length - 1, close = matchParen(sql, open); if (close < 0) break;
    const rep = cb(splitArgs(sql.slice(open + 1, close)));
    if (rep == null) continue;
    out += sql.slice(last, m.index) + rep; last = close + 1; re.lastIndex = close + 1; }
  return out + sql.slice(last);
}
const unq = a => (/^'(.*)'$/s.test(a) ? a.slice(1, -1).replace(/''/g, "'") : null);

function nowExpr(mods, base) { // SQLite date modifiers → MariaDB datetime expression
  let local = false, adds = [], startOfMonth = false;
  for (const m of mods) { const v = unq(m); if (v == null) throw new Error('Non-literal date modifier: ' + m);
    if (/^localtime$/i.test(v)) local = true; else if (/^utc$/i.test(v)) local = false;
    else if (/^start of month$/i.test(v)) startOfMonth = true;
    else { const k = v.match(/^([+-]?\d+)\s+(day|days|month|months|year|years|hour|hours|minute|minutes)$/i);
      if (!k) throw new Error('Unsupported date modifier: ' + v);
      adds.push(` + INTERVAL ${parseInt(k[1], 10)} ${k[2].toUpperCase().replace(/S$/, '')}`); } }
  let expr = base || (local ? 'NOW()' : 'UTC_TIMESTAMP()');
  if (startOfMonth) expr = `CAST(DATE_FORMAT(${expr}, '%Y-%m-01') AS DATETIME)`;
  return `(${expr}${adds.join('')})`;
}
const ISO_RE = "'^[0-9]{4}-[0-9]{2}-[0-9]{2}'";
const STRF = { '%Y': [1, 4], '%m': [6, 2], '%d': [9, 2], '%Y-%m': [1, 7], '%Y-%m-%d': [1, 10], '%H': [12, 2], '%M': [15, 2], '%Y-%m-%d %H:%M:%S': [1, 19] };
const DFMT = { '%Y': '%Y', '%m': '%m', '%d': '%d', '%Y-%m': '%Y-%m', '%Y-%m-%d': '%Y-%m-%d', '%H': '%H', '%M': '%i', '%Y-%m-%d %H:%M:%S': '%Y-%m-%d %H:%i:%s' };

function globToRegex(p) { let r = '^';
  for (let i = 0; i < p.length; i++) { const c = p[i];
    if (c === '*') r += '.*'; else if (c === '?') r += '.';
    else if (c === '[') { const j = p.indexOf(']', i + 1); r += '[' + p.slice(i + 1, j) + ']'; i = j; }
    else r += /[.+(){}|\\$^]/.test(c) ? '\\\\' + c : c; }
  return r + '$'; }

function addDerivedAliases(sql) { // MariaDB requires an alias on every derived table
  let out = sql, n = 0, from = 0;
  for (;;) {
    const lit = literalMask(out); const re = /\b(FROM|JOIN)\s*\(\s*(SELECT|WITH)\b/ig; re.lastIndex = from; let m, found = false;
    while ((m = re.exec(out))) { if (lit[m.index]) continue;
      const open = out.indexOf('(', m.index + m[1].length), close = matchParen(out, open); if (close < 0) break;
      const next = (out.slice(close + 1).match(/^\s*([A-Za-z_`][\w`]*)/) || [])[1];
      if (!next || /^(WHERE|GROUP|ORDER|LIMIT|UNION|JOIN|LEFT|RIGHT|INNER|CROSS|ON|HAVING|EXCEPT|INTERSECT|WINDOW)$/i.test(next)) {
        out = out.slice(0, close + 1) + ` AS _dt${++n}` + out.slice(close + 1); from = close + 1; found = true; break; }
      from = close + 1; }
    if (!found) break; }
  return out;
}
// Positions of top-level (depth 0) clause keywords of the outermost statement
function topLevel(s) {
  const lit = literalMask(s); const pos = []; let depth = 0; const depthAt = new Int32Array(s.length + 1);
  for (let i = 0; i < s.length; i++) { if (!lit[i]) { if (s[i] === '(') depth++; else if (s[i] === ')') depth--; } depthAt[i] = depth; }
  const re = /\b(SELECT|FROM|WHERE|GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT|UNION|WINDOW|DISTINCT)\b/ig; let m;
  while ((m = re.exec(s))) if (!lit[m.index] && depthAt[m.index] === 0) pos.push({ kw: m[1].toUpperCase().replace(/\s+/g, ' '), i: m.index, end: m.index + m[0].length });
  return pos;
}
function fixNulls(item) { // "<expr> [ASC|DESC] NULLS FIRST|LAST" → MariaDB equivalent
  const m = item.match(/^(.*?)(\s+(ASC|DESC))?\s+NULLS\s+(FIRST|LAST)$/is); if (!m) return item;
  const expr = m[1].trim(), dir = (m[3] || 'ASC').toUpperCase(), nl = m[4].toUpperCase();
  return `(${expr} IS NULL) ${nl === 'LAST' ? 'ASC' : 'DESC'}, ${expr} ${dir}`;
}
// SQLite returns GROUP BY results in group-key order and resolves ORDER BY ties in a predictable order
// (verified against SQLite: plain sort → scan order = ascending id; ORDER BY led by an indexed column →
// index direction; GROUP BY + ORDER BY → group keys in the direction of the first sort term).
// MariaDB guarantees none of this, so the outermost query gets explicit tie-breakers.
function stabilizeOrder(s, ctx) {
  const pos = topLevel(s); if (!pos.length || pos[0].kw !== 'SELECT') return s;
  if (pos.some(p => p.kw === 'UNION' || p.kw === 'WINDOW')) return s;
  const at = kw => pos.find(p => p.kw === kw);
  const from = at('FROM'), group = at('GROUP BY'), order = at('ORDER BY'), limit = at('LIMIT');
  const distinct = pos.find(p => p.kw === 'DISTINCT' && from && p.i < from.i);
  if (!from) return s;
  const clauseEnd = start => { const nxt = pos.filter(p => p.i > start && ['WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT'].includes(p.kw)); return nxt.length ? nxt[0].i : s.replace(/[\s;]+$/, '').length; };
  if (group) {
    const keys = s.slice(group.end, clauseEnd(group.end)).trim().replace(/;\s*$/, '');
    if (!keys || /\bWITH\s+ROLLUP\b/i.test(keys)) return s;
    if (!order) { const ins = limit ? limit.i : s.replace(/[\s;]+$/, '').length;
      return s.slice(0, ins).replace(/\s*$/, '') + ` ORDER BY ${keys} ` + s.slice(ins); }
    const oEnd = clauseEnd(order.end); const firstO = splitArgs(s.slice(order.end, oEnd).trim())[0] || '';
    const gdir = /\bDESC\s*$/i.test(firstO.trim()) ? 'DESC' : 'ASC';
    return s.slice(0, oEnd).replace(/\s*$/, '') + ', ' + splitArgs(keys).map(k => `${k} ${gdir}`).join(', ') + ' ' + s.slice(oEnd);
  }
  // Unordered, ungrouped JOIN query: SQLite drives from the first table (index/rowid order) — pin that
  // order explicitly; MariaDB may pick another join order (e.g. Maintenance Dashboard overdue list).
  if (!order && !distinct && ctx && ctx.hasId && /\bJOIN\b/i.test(s.slice(from.end, clauseEnd(from.end)))
      && !/\b(COUNT|SUM|AVG|MIN|MAX|TOTAL|GROUP_CONCAT)\s*\(/i.test(s.slice(0, from.i))) {
    const fm = s.slice(from.end).match(/^\s*`?(\w+)`?(?:\s+(?:AS\s+)?(?!(?:WHERE|LEFT|RIGHT|INNER|JOIN|CROSS|ORDER|GROUP|LIMIT|ON)\b)(\w+))?/i);
    if (!fm || !ctx.hasId(fm[1])) return s;
    const ins = limit ? limit.i : s.replace(/[\s;]+$/, '').length;
    return s.slice(0, ins).replace(/\s*$/, '') + ` ORDER BY ${fm[2] || fm[1]}.id ` + s.slice(ins);
  }
  if (order && !distinct && ctx && ctx.hasId) {
    const fm = s.slice(from.end).match(/^\s*`?(\w+)`?(?:\s+(?:AS\s+)?(?!(?:WHERE|LEFT|RIGHT|INNER|JOIN|CROSS|ORDER|GROUP|LIMIT|ON)\b)(\w+))?/i);
    if (!fm || !ctx.hasId(fm[1])) return s;
    const alias = fm[2] || fm[1]; const oEnd = clauseEnd(order.end); const items = s.slice(order.end, oEnd).trim();
    if (new RegExp(`(^|[\\s,(])(${alias}\\.)?id(\\s+(ASC|DESC))?\\s*(,|$)`, 'i').test(items)) return s;
    const first = (splitArgs(items)[0] || '').trim();
    const fm2 = first.match(new RegExp(`^(?:${alias}\\.)?\`?(\\w+)\`?(?:\\s+(ASC|DESC))?$`, 'i'));
    const dir = fm2 && ctx.indexLead && ctx.indexLead(fm[1]).has(fm2[1].toLowerCase()) && /DESC/i.test(fm2[2] || '') ? 'DESC' : 'ASC';
    return s.slice(0, oEnd).replace(/\s*$/, '') + `, ${alias}.id ${dir} ` + s.slice(oEnd);
  }
  return s;
}

function translate(sql, ctx) {
  let s = sql;
  s = s.replace(/\bINSERT\s+OR\s+IGNORE\b/ig, 'INSERT IGNORE').replace(/\bINSERT\s+OR\s+REPLACE\b/ig, 'REPLACE');
  s = s.replace(/\blast_insert_rowid\s*\(\s*\)/ig, 'LAST_INSERT_ID()');
  s = s.replace(/\bCOLLATE\s+NOCASE\b/ig, `COLLATE ${CI}`);
  // julianday(a) - julianday(b) (used only as whole-day differences of dates) → DATEDIFF
  s = s.replace(/CAST\s*\(\s*julianday\s*\(([^()]*)\)\s*-\s*julianday\s*\(([^()]*)\)\s+AS\s+INTEGER\s*\)/ig, 'DATEDIFF($1, $2)');
  if (/\bjulianday\s*\(/i.test(s)) throw new Error('Untranslated julianday() usage');
  s = rewriteCalls(s, 'datetime', a => { if ((unq(a[0]) || '').toLowerCase() !== 'now') throw new Error('Unsupported datetime(): ' + a.join(','));
    return `DATE_FORMAT(${nowExpr(a.slice(1))}, '%Y-%m-%d %H:%i:%s')`; });
  s = rewriteCalls(s, 'date', a => (unq(a[0]) || '').toLowerCase() === 'now' ? `DATE_FORMAT(${nowExpr(a.slice(1))}, '%Y-%m-%d')`
    : a.length === 1 ? `(CASE WHEN ${a[0]} REGEXP ${ISO_RE} THEN SUBSTR(${a[0]},1,10) END)`
    : `(CASE WHEN ${a[0]} REGEXP ${ISO_RE} THEN DATE_FORMAT(${nowExpr(a.slice(1), `CAST(SUBSTR(${a[0]},1,10) AS DATETIME)`)}, '%Y-%m-%d') END)`);
  s = rewriteCalls(s, 'strftime', a => { const f = unq(a[0]); if (!(f in STRF)) throw new Error('Unsupported strftime format ' + a[0]);
    if ((unq(a[1]) || '').toLowerCase() === 'now') return `DATE_FORMAT(${nowExpr(a.slice(2))}, '${DFMT[f]}')`;
    if (a.length > 2) throw new Error('strftime modifiers unsupported');
    const [st, len] = STRF[f]; return `(CASE WHEN ${a[1]} REGEXP ${ISO_RE} THEN SUBSTR(${a[1]},${st},${len}) END)`; });
  s = rewriteCalls(s, 'group_concat', a => a.length === 1 ? null : a.length === 2 ? `GROUP_CONCAT(${a[0]} SEPARATOR ${a[1]})` : (() => { throw new Error('GROUP_CONCAT args'); })());
  s = rewriteCalls(s, 'CAST', a => { const m = a[0].match(/^(.*)\s+AS\s+(TEXT|INTEGER|REAL|NUMERIC)$/is); if (!m) return null;
    return `CAST(${m[1]} AS ${{ TEXT: 'CHAR', INTEGER: 'SIGNED', REAL: 'DOUBLE', NUMERIC: 'DECIMAL(30,10)' }[m[2].toUpperCase()]})`; });
  // SQLite scalar max(a,b,…) / min(a,b,…) → GREATEST / LEAST (aggregates have one argument)
  s = rewriteCalls(s, 'MAX', a => a.length >= 2 ? `GREATEST(${a.join(', ')})` : null);
  s = rewriteCalls(s, 'MIN', a => a.length >= 2 ? `LEAST(${a.join(', ')})` : null);
  // GLOB → REGEXP (binary collation keeps it case-sensitive like GLOB)
  s = s.replace(/\b(NOT\s+)?GLOB\s+'((?:[^']|'')*)'/ig, (m0, not, p) => `${not ? 'NOT ' : ''}REGEXP '${globToRegex(p.replace(/''/g, "'"))}'`);
  if (/\bGLOB\b/i.test(s.replace(/'(?:[^']|'')*'/g, ''))) throw new Error('Untranslated GLOB usage');
  // LIKE is case-insensitive in SQLite → explicit case-insensitive collation on the pattern
  s = s.replace(/\bLIKE\s+(\?|'(?:[^']|'')*')(?!\s*COLLATE)/ig, `LIKE $1 COLLATE ${CI}`);
  // reserved words used as aliases (e.g. "MAX(performed_by) AS by"), excluding CAST target types
  { const lit = literalMask(s); const TYPES = /^(CHAR|SIGNED|UNSIGNED|DOUBLE|DECIMAL|DATE|DATETIME|TIME|BINARY|JSON|FLOAT|REAL|INTEGER|NCHAR)$/i;
    s = s.replace(/\bAS\s+([A-Za-z_]\w*)\b/g, (m0, w, off) => (!lit[off] && RESERVED.has(w.toLowerCase()) && !TYPES.test(w)) ? `AS \`${w}\`` : m0); }
  // ORDER BY … NULLS FIRST/LAST
  if (/\bNULLS\s+(FIRST|LAST)\b/i.test(s)) s = s.replace(/\bORDER\s+BY\s+((?:(?!\bLIMIT\b|\)|;).)*?\bNULLS\s+(?:FIRST|LAST)\b(?:(?!\bLIMIT\b|\)|;).)*)/igs, (m0, items) => 'ORDER BY ' + splitArgs(items).map(fixNulls).join(', ') + ' ');
  s = addDerivedAliases(s);
  if (/^\s*(SELECT|WITH)\b/i.test(s)) s = stabilizeOrder(s, ctx);
  return s;
}

// Statement classification for the sync facade (transactions, PRAGMA, runtime DDL)
function classify(sql) {
  const t = sql.trim().replace(/;\s*$/, ''); let m;
  if (/^BEGIN(\s+(DEFERRED|IMMEDIATE|EXCLUSIVE))?(\s+TRANSACTION)?$/i.test(t)) return { kind: 'begin' };
  if (/^(COMMIT|END)(\s+TRANSACTION)?$/i.test(t)) return { kind: 'commit' };
  if (/^ROLLBACK(\s+TRANSACTION)?$/i.test(t)) return { kind: 'rollback' };
  if ((m = t.match(/^SAVEPOINT\s+(\w+)$/i))) return { kind: 'savepoint', name: m[1] };
  if ((m = t.match(/^RELEASE(\s+SAVEPOINT)?\s+(\w+)$/i))) return { kind: 'release', name: m[2] };
  if ((m = t.match(/^ROLLBACK(\s+TRANSACTION)?\s+TO(\s+SAVEPOINT)?\s+(\w+)$/i))) return { kind: 'rollback_to', name: m[3] };
  if ((m = t.match(/^PRAGMA\s+table_info\s*\(\s*['"`]?(\w+)['"`]?\s*\)$/i))) return { kind: 'table_info', table: m[1] };
  if (/^PRAGMA\b/i.test(t)) return { kind: 'noop' };
  if ((m = t.match(/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+[`"']?(\w+)/i))) return { kind: 'ddl_table', table: m[1] };
  if ((m = t.match(/^CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+[`"']?(\w+)[`"']?\s+ON\s+[`"']?(\w+)/i))) return { kind: 'ddl_index', index: m[2], table: m[3] };
  if ((m = t.match(/^ALTER\s+TABLE\s+[`"']?(\w+)[`"']?\s+ADD\s+(COLUMN\s+)?[`"']?(\w+)/i))) return { kind: 'ddl_addcol', table: m[1], column: m[3] };
  if (/^(CREATE|ALTER|DROP)\s/i.test(t)) return { kind: 'ddl_other' };
  return { kind: 'sql' };
}
module.exports = { translate, classify, globToRegex, CI };
