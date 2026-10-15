'use strict';
// SH PMS — SQLite → MariaDB 10.4 schema translation (deterministic, data-aware). Reads the SQLite copy read-only.
//   Collation utf8mb4_nopad_bin = SQLite BINARY semantics (=, ORDER BY, UNIQUE are case-sensitive, NO PAD).
//   REAL money columns → DECIMAL(15,2) only when every stored value has ≤ 2 decimals (else DOUBLE + warning).
//   Text kept as text (dates stay exactly as stored — no date-type conversion, no time-zone shift).
const { DatabaseSync } = require('node:sqlite');
const MONEY = 'DECIMAL(15,2)';
const COLL = 'utf8mb4_nopad_bin';
const BIG_TEXT_NAME = /detail|snapshot|json|payload|note|remark|description|old_value|new_value|issue|reason|log|message|history|address|summary|comment|sql/i;
const q = n => '`' + n.replace(/`/g, '``') + '`';

function translateDefault(dflt, mysqlType) {
  if (dflt == null) return null;
  const v = String(dflt).trim();
  if (/^datetime\('now'\)$/i.test(v) || /^CURRENT_TIMESTAMP$/i.test(v)) return "(DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s'))";
  if (/^date\('now'\)$/i.test(v)) return "(DATE_FORMAT(UTC_DATE(), '%Y-%m-%d'))";
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  if (/^'.*'$/s.test(v)) return /TEXT$/.test(mysqlType) ? `(${v})` : v;
  throw new Error('Unsupported DEFAULT ' + v);
}
function balanced(s, open) { let depth = 0, inStr = false;
  for (let i = open; i < s.length; i++) { const ch = s[i]; if (ch === "'") inStr = !inStr; else if (!inStr) { if (ch === '(') depth++; else if (ch === ')') { depth--; if (depth === 0) return i; } } }
  return -1; }
function extractChecks(tableSql) {
  const out = []; const re = /CHECK\s*\(/gi; let m;
  while ((m = re.exec(tableSql))) { const open = m.index + m[0].length - 1, close = balanced(tableSql, open);
    out.push(tableSql.slice(open + 1, close).replace(/\s+/g, ' ').trim()); }
  return out;
}
function supplierTriggers(d) {
  // The 15 SQLite AFTER triggers (Supplier Master sync) update their own table, which MariaDB forbids
  // → 2 equivalent BEFORE triggers per table. The supplier name-key expression is copied verbatim.
  const trg = d.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
  const tables = [...new Set(trg.map(t => t.tbl_name))];
  const sample = trg.find(t => /_sup_ins$/.test(t.name)).sql;
  const st = sample.search(/name_key\s*=\s*lower\(/i); if (st < 0) throw new Error('Cannot extract supplier name_key expression');
  const i = sample.indexOf('lower(', st), j = balanced(sample, sample.indexOf('(', i));
  const k = sample.slice(i, j + 1).replace(/char\(9\)/gi, 'CHAR(9 USING utf8mb4)');
  const sql = [], covered = [];
  for (const t of tables) {
    const names = trg.filter(x => x.tbl_name === t).map(x => x.name).sort();
    if (names.length !== 3 || !names.every(n => /_sup_(ins|upd_id|upd_name)$/.test(n))) throw new Error(`Unexpected trigger set on ${t}: ${names}`);
    covered.push(...names);
    sql.push(`CREATE TRIGGER ${q('trg_' + t + '_sup_bi')} BEFORE INSERT ON ${q(t)} FOR EACH ROW
BEGIN
  DECLARE v_id BIGINT; DECLARE v_name TEXT;
  IF NEW.supplier_name IS NOT NULL OR NEW.supplier_id IS NOT NULL THEN
    SET v_id = COALESCE((SELECT id FROM suppliers WHERE id = NEW.supplier_id), (SELECT id FROM suppliers WHERE name_key = ${k}));
    SET v_name = COALESCE((SELECT name FROM suppliers WHERE id = NEW.supplier_id), (SELECT name FROM suppliers WHERE name_key = ${k}), NEW.supplier_name);
    SET NEW.supplier_id = v_id; SET NEW.supplier_name = v_name;
  END IF;
END`);
    // BEFORE UPDATE reproduces the net effect of SQLite's cascade (sup_upd_name → inner UPDATE re-fires sup_upd_id;
    // sup_upd_id → inner UPDATE fires sup_upd_name), measured in the SQLite-vs-MariaDB battery (07_Logs/stage4):
    //   • supplier_id SET (non-NULL)                  → name = Supplier Master name of that id
    //   • else supplier_name SET (non-NULL, id same/NULL) → id = master id matching the name (else unchanged);
    //                                                  name = master name of the resulting id (else as entered)
    // SQLite fires "UPDATE OF col" when the column is in the SET list (even with an unchanged value). The adapter
    // passes that SET-list information in @shpms_set_supplier_id / @shpms_set_supplier_name; any other session
    // (DBA tools) falls back to "value changed".
    sql.push(`CREATE TRIGGER ${q('trg_' + t + '_sup_bu')} BEFORE UPDATE ON ${q(t)} FOR EACH ROW
BEGIN
  DECLARE v_id BIGINT; DECLARE s_id, s_name BOOLEAN;
  SET s_id = COALESCE(@shpms_set_supplier_id, NOT (NEW.supplier_id <=> OLD.supplier_id));
  SET s_name = COALESCE(@shpms_set_supplier_name, NOT (NEW.supplier_name <=> OLD.supplier_name));
  IF s_id AND NEW.supplier_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM suppliers WHERE id = NEW.supplier_id) THEN SET NEW.supplier_name = (SELECT name FROM suppliers WHERE id = NEW.supplier_id); END IF;
  ELSEIF s_name AND NEW.supplier_name IS NOT NULL AND (NEW.supplier_id IS NULL OR NEW.supplier_id = OLD.supplier_id) THEN
    SET v_id = COALESCE((SELECT id FROM suppliers WHERE name_key = ${k}), NEW.supplier_id);
    SET NEW.supplier_id = v_id;
    IF v_id IS NOT NULL AND EXISTS (SELECT 1 FROM suppliers WHERE id = v_id) THEN SET NEW.supplier_name = (SELECT name FROM suppliers WHERE id = v_id); END IF;
  END IF;
END`);
  }
  return { sql, covered, all: trg.map(x => x.name) };
}
function buildSchema(sqlitePath) {
  const d = new DatabaseSync(sqlitePath, { readOnly: true });
  const warnings = [], plan = {}, tables = [], indexes = [], fks = [];
  const tlist = d.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const seq = Object.fromEntries(d.prepare('SELECT name, seq FROM sqlite_sequence').all().map(r => [r.name, r.seq]));
  for (const t of tlist) {
    const cols = d.prepare(`PRAGMA table_info("${t.name}")`).all();
    const idxl = d.prepare(`PRAGMA index_list("${t.name}")`).all();
    const fkl = d.prepare(`PRAGMA foreign_key_list("${t.name}")`).all();
    const indexedCols = new Set(); for (const i of idxl) for (const c of d.prepare(`PRAGMA index_info("${i.name}")`).all()) if (c.name) indexedCols.add(c.name);
    for (const f of fkl) indexedCols.add(f.from);
    const lines = []; plan[t.name] = {};
    for (const c of cols) {
      const decl = (c.type || '').toUpperCase(); const name = c.name;
      const maxlen = d.prepare(`SELECT MAX(LENGTH(CAST("${name}" AS TEXT))) m FROM "${t.name}"`).get().m || 0;
      let type;
      if (/INT/.test(decl)) type = 'BIGINT';
      else if (/REAL|FLOA|DOUB|NUM|DEC/.test(decl)) {
        const bad = d.prepare(`SELECT COUNT(*) n FROM "${t.name}" WHERE typeof("${name}")='real' AND ABS("${name}"*100 - ROUND("${name}"*100)) > 1e-6`).get().n;
        if (bad) { type = 'DOUBLE'; warnings.push(`${t.name}.${name}: ${bad} value(s) with more than 2 decimals — kept as DOUBLE`); } else type = MONEY;
      } else {
        const needsKey = indexedCols.has(name) || c.pk;
        const dv = c.dflt_value == null ? '' : String(c.dflt_value).trim();
        if (needsKey || dv) {
          if (maxlen > 255) { if (needsKey) warnings.push(`${t.name}.${name}: indexed text longer than 255`); type = maxlen <= 1000 ? 'VARCHAR(1000)' : 'TEXT'; }
          else type = 'VARCHAR(255)';
        } else type = (maxlen > 2000 || BIG_TEXT_NAME.test(name)) ? 'MEDIUMTEXT' : 'TEXT';
      }
      let line = `${q(name)} ${type}`;
      if (c.notnull && !c.pk) line += ' NOT NULL';
      const def = translateDefault(c.dflt_value, type); if (def != null) line += ' DEFAULT ' + def;
      if (c.pk) line += ' NOT NULL' + (/INT/.test(decl) ? ' AUTO_INCREMENT' : '');
      lines.push(line); plan[t.name][name] = { sqlite: c.type || '', mysql: type, notnull: !!c.notnull, default: c.dflt_value };
    }
    const pk = cols.filter(c => c.pk).sort((a, b) => a.pk - b.pk).map(c => q(c.name));
    if (pk.length) lines.push(`PRIMARY KEY (${pk.join(', ')})`);
    extractChecks(t.sql).forEach((ck, i) => lines.push(`CONSTRAINT ${q('chk_' + t.name + '_' + (i + 1))} CHECK (${ck})`));
    const ai = seq[t.name] != null ? ` AUTO_INCREMENT=${Number(seq[t.name]) + 1}` : '';
    tables.push({ name: t.name, ddl: `CREATE TABLE ${q(t.name)} (\n  ${lines.join(',\n  ')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${COLL}${ai}` });
    for (const i of idxl) {
      if (i.origin === 'pk') continue;
      const icols = d.prepare(`PRAGMA index_info("${i.name}")`).all().sort((a, b) => a.seqno - b.seqno).map(c => c.name);
      if (icols.some(c => c == null)) { warnings.push(`${i.name}: expression index skipped`); continue; }
      const iname = i.origin === 'c' ? i.name : `uq_${t.name}_${icols.join('_')}`.slice(0, 64);
      let keyparts = icols.map(q);
      if (i.partial) {
        const row = d.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(i.name);
        const where = (((row && row.sql) || '').match(/WHERE\s+(.*)$/is) || [])[1];
        if (!where) throw new Error(`Cannot read WHERE clause for partial index ${i.name}`);
        const pred = where.trim();

        // MariaDB 10.4 does not support SQLite-style partial UNIQUE indexes.
        // Preserve their semantics using VIRTUAL generated columns that expose the indexed values
        // only when the partial-index predicate is true; otherwise they return NULL. MariaDB UNIQUE
        // indexes allow multiple NULLs, so rows outside the predicate remain unconstrained.
        const nullPred = pred.match(/^[`"\[]?([A-Za-z_][A-Za-z0-9_]*)[`"\]]?\s+IS\s+(NOT\s+)?NULL$/i);
        if (i.unique && nullPred) {
          const predCol = nullPred[1];
          const isNotNull = !!nullPred[2];
          if (!plan[t.name][predCol]) throw new Error(`Partial UNIQUE index ${i.name} references unknown predicate column ${predCol}`);
          const condition = `${q(predCol)} IS ${isNotNull ? 'NOT ' : ''}NULL`;
          const helpers = icols.map((c, n) => `__shpms_uq_${i.name}_${n + 1}`.slice(0, 64));
          const adds = icols.map((c, n) => {
            if (!plan[t.name][c]) throw new Error(`Partial UNIQUE index ${i.name} references unknown indexed column ${c}`);
            return `ADD COLUMN ${q(helpers[n])} ${plan[t.name][c].mysql} AS (CASE WHEN ${condition} THEN ${q(c)} ELSE NULL END) VIRTUAL`;
          });
          indexes.push(`ALTER TABLE ${q(t.name)} ${adds.join(', ')}, ADD UNIQUE INDEX ${q(iname)} (${helpers.map(q).join(', ')})`);
          continue;
        } else if (i.unique && t.name === 'factory_contract_links' && /^is_deleted\s*=\s*0$/i.test(pred)) {
          // Preserve UNIQUE(... ) WHERE is_deleted = 0 using generated helper columns.
          const helpers = icols.map((c, n) => `__shpms_uq_${i.name}_${n + 1}`.slice(0, 64));
          const adds = icols.map((c, n) => `ADD COLUMN ${q(helpers[n])} ${plan[t.name][c].mysql} AS (CASE WHEN ${q('is_deleted')} = 0 THEN ${q(c)} ELSE NULL END) VIRTUAL`);
          indexes.push(`ALTER TABLE ${q(t.name)} ${adds.join(', ')}, ADD UNIQUE INDEX ${q(iname)} (${helpers.map(q).join(', ')})`);
          continue;
        } else if (i.unique) {
          throw new Error(`MariaDB 10.4 migration does not have a safe translation for partial UNIQUE index ${i.name} WHERE ${pred}`);
        } else warnings.push(`${i.name}: non-unique partial index created as a full index`);
      }
      indexes.push(`CREATE ${i.unique ? 'UNIQUE ' : ''}INDEX ${q(iname)} ON ${q(t.name)} (${keyparts.join(', ')})`);
    }
    for (const f of fkl.filter((f, k, a) => a.findIndex(x => x.id === f.id) === k)) {
      const parts = fkl.filter(x => x.id === f.id).sort((a, b) => a.seq - b.seq); const act = a => (a === 'NO ACTION' || !a) ? 'NO ACTION' : a;
      fks.push(`ALTER TABLE ${q(t.name)} ADD CONSTRAINT ${q(`fk_${t.name}_${parts.map(p => p.from).join('_')}`.slice(0, 64))} FOREIGN KEY (${parts.map(p => q(p.from)).join(', ')}) REFERENCES ${q(f.table)} (${parts.map(p => q(p.to || 'id')).join(', ')}) ON DELETE ${act(f.on_delete)} ON UPDATE ${act(f.on_update)}`);
    }
  }
  const trg = supplierTriggers(d); d.close();
  return { tables, indexes, fks, triggers: trg.sql, triggers_source: trg.all, triggers_covered: trg.covered, plan, warnings };
}
module.exports = { buildSchema, extractChecks };
