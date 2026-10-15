'use strict';
// ══════════════════════════════════════════════════════════════════════════════
// CONTRACT ↔ FACTORY ORDER LINKS — single authoritative resolution (2026-10-10)
//
//   Source of truth: factory_contract_links (many-to-many; one row per Factory Ref. ×
//   factory table × Contract Ref.; UNIQUE while is_deleted = 0).
//   A link is LIVE when is_deleted = 0 AND a non-deleted factory record with the same
//   Factory Ref. exists in that factory table. Links are resolved by Factory Ref. +
//   table — NOT by factory_record_id, which goes stale when a factory record is
//   re-created (e.g. FJ-6051: links pointed at deleted records 429/430, live = 433).
//   Contract matching is by Contract Ref. (trimmed, case-insensitive) — never client name.
//   "Factory Ref." on contracts = factory ORDERS (INS / OTJ). SEA shipment links
//   (e.g. 2026-08) stay visible in the contract's Factory tab, not in the Factory Ref.
//   column.
//
//   The legacy single factory-record contract_ref text is NOT read for display. It is
//   only used by syncLegacyLinks() to back-fill missing junction rows (whole text equal
//   to an existing Contract Ref. first — grouped contract records such as
//   "SH-067, SH-068" exist — else split on , ; / and match each part exactly).
// ══════════════════════════════════════════════════════════════════════════════
const { db, run, get, all } = require('./db.js');

const ORDER_TABLES = ['factory_ins_quotes', 'factory_otj_quotes'];
const ALL_TABLES = ['factory_ins_quotes', 'factory_otj_quotes', 'factory_sea_costs'];
const SHEET = { factory_ins_quotes: 'ins', factory_otj_quotes: 'otj', factory_sea_costs: 'sea' };
const nref = s => String(s == null ? '' : s).trim().toUpperCase().replace(/\s*([,;/])\s*/g, '$1 ').replace(/\s+/g, ' ');

const _liveRec = l => `(${ALL_TABLES.map(t => `(${l}.factory_table = '${t}' AND EXISTS (SELECT 1 FROM ${t} _f WHERE _f.is_deleted = 0 AND UPPER(TRIM(_f.factory_ref)) = UPPER(TRIM(${l}.factory_ref))))`).join(' OR ')})`;
/** SQL condition: link row alias `l` is a live FACTORY ORDER link of contract alias `c`. */
const orderLinkOf = (c = 'c', l = 'fcl') => `${l}.is_deleted = 0 AND UPPER(TRIM(${l}.contract_ref)) = UPPER(TRIM(${c}.contract_ref))
  AND ${l}.factory_table IN ('factory_ins_quotes','factory_otj_quotes') AND ${_liveRec(l)}`;

/** "FJ-6051, FJ-6060" for contract alias c (NULL when not linked). */
const FACTORY_REFS_SQL = (c = 'c') => `(SELECT REPLACE(GROUP_CONCAT(DISTINCT TRIM(fcl.factory_ref)), ',', ', ') FROM factory_contract_links fcl WHERE ${orderLinkOf(c)})`;
const FACTORY_REF_COUNT_SQL = (c = 'c') => `(SELECT COUNT(DISTINCT UPPER(TRIM(fcl.factory_ref))) FROM factory_contract_links fcl WHERE ${orderLinkOf(c)})`;
/** WHERE fragment for the Factory Ref. filter (one LIKE parameter). */
const FACTORY_REF_FILTER_SQL = (c = 'c') => `EXISTS (SELECT 1 FROM factory_contract_links fcl WHERE ${orderLinkOf(c)} AND fcl.factory_ref LIKE ?)`;

/** Contract Refs linked to factory record alias f of table t (live links, existing contracts). */
const LINKED_CONTRACTS_SQL = (t, f = 'f') => `(SELECT REPLACE(GROUP_CONCAT(DISTINCT TRIM(_l.contract_ref)), ',', ', ') FROM factory_contract_links _l
  WHERE _l.is_deleted = 0 AND _l.factory_table = '${t}' AND UPPER(TRIM(_l.factory_ref)) = UPPER(TRIM(${f}.factory_ref))
    AND EXISTS (SELECT 1 FROM contracts _c WHERE _c.is_deleted = 0 AND UPPER(TRIM(_c.contract_ref)) = UPPER(TRIM(_l.contract_ref))))`;
const LINKED_CONTRACT_COUNT_SQL = (t, f = 'f') => `(SELECT COUNT(DISTINCT UPPER(TRIM(_l.contract_ref))) FROM factory_contract_links _l
  WHERE _l.is_deleted = 0 AND _l.factory_table = '${t}' AND UPPER(TRIM(_l.factory_ref)) = UPPER(TRIM(${f}.factory_ref))
    AND EXISTS (SELECT 1 FROM contracts _c WHERE _c.is_deleted = 0 AND UPPER(TRIM(_c.contract_ref)) = UPPER(TRIM(_l.contract_ref))))`;

/** Live links of one contract with the factory record details (orders + SEA shipments). */
function linksForContract(contractRef) {
  if (!contractRef) return [];
  const links = all(`SELECT * FROM factory_contract_links fcl WHERE fcl.is_deleted = 0 AND UPPER(TRIM(fcl.contract_ref)) = UPPER(TRIM(?)) AND ${_liveRec('fcl')}
    ORDER BY fcl.factory_table, fcl.factory_ref`, [contractRef]);
  return links.map(l => {
    const rec = get(`SELECT * FROM ${l.factory_table} WHERE is_deleted = 0 AND UPPER(TRIM(factory_ref)) = UPPER(TRIM(?)) ORDER BY id DESC LIMIT 1`, [l.factory_ref]);
    const shared = get(`SELECT COUNT(*) n FROM factory_contract_links WHERE is_deleted = 0 AND factory_table = ? AND UPPER(TRIM(factory_ref)) = UPPER(TRIM(?))`, [l.factory_table, l.factory_ref]).n;
    return { link: l, record: rec, sheet: SHEET[l.factory_table], shared_contracts: shared };
  });
}

/** Create (or keep) a live link. Idempotent. Returns { id, created }. */
function upsertLink({ factory_ref, factory_table, factory_record_id, contract_ref, linked_quantity = null }, user, reason) {
  const ex = get(`SELECT id, factory_record_id FROM factory_contract_links WHERE is_deleted = 0 AND factory_table = ?
    AND UPPER(TRIM(factory_ref)) = UPPER(TRIM(?)) AND UPPER(TRIM(contract_ref)) = UPPER(TRIM(?))`, [factory_table, factory_ref, contract_ref]);
  if (ex) {
    if (factory_record_id && ex.factory_record_id !== factory_record_id) run('UPDATE factory_contract_links SET factory_record_id = ?, updated_at = ? WHERE id = ?', [factory_record_id, new Date().toISOString(), ex.id]);
    return { id: ex.id, created: false };
  }
  const now = new Date().toISOString();
  const r = run(`INSERT INTO factory_contract_links (factory_ref, factory_table, factory_record_id, contract_ref, linked_quantity, linked_by, linked_date, status, remarks, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [factory_ref, factory_table, factory_record_id || null, contract_ref, linked_quantity, user, now.slice(0, 10), 'Active', reason || null, now, now]);
  _audit('LINK_CREATE', Number(r.lastInsertRowid), factory_ref, user, { factory_table, contract_ref, old_state: 'Not linked', new_state: 'Linked', reason });
  return { id: Number(r.lastInsertRowid), created: true };
}

/** Soft-delete live links of a contract to one factory ref/table (history kept). */
function removeLinks({ factory_ref, factory_table, contract_ref }, user, reason) {
  const rows = all(`SELECT id FROM factory_contract_links WHERE is_deleted = 0 AND factory_table = ? AND UPPER(TRIM(factory_ref)) = UPPER(TRIM(?))
    AND UPPER(TRIM(contract_ref)) = UPPER(TRIM(?))`, [factory_table, factory_ref, contract_ref]);
  for (const x of rows) {
    run('UPDATE factory_contract_links SET is_deleted = 1, status = ?, updated_at = ? WHERE id = ?', ['Unlinked', new Date().toISOString(), x.id]);
    _audit('UNLINK', x.id, factory_ref, user, { factory_table, contract_ref, old_state: 'Linked', new_state: 'Unlinked', reason });
  }
  return rows.length;
}

function _audit(action, id, ref, user, details) {
  try { require('./audit.js').writeAuditLog({ action, module: 'factory_contract_links', recordId: id, recordRef: ref, performedBy: user || 'system', details }); } catch (_) {}
}

/**
 * Reconcile legacy factory-record contract_ref text + stale factory_record_id into the
 * junction table. dryRun → report only. Never edits factory records, contracts, payments.
 */
function syncLegacyLinks({ dryRun = true, user = 'system' } = {}) {
  const contracts = new Map(all(`SELECT id, contract_ref FROM contracts WHERE is_deleted = 0 AND TRIM(COALESCE(contract_ref,'')) <> ''`).map(c => [nref(c.contract_ref), c]));
  const linkKey = new Set(all('SELECT factory_ref, factory_table, contract_ref FROM factory_contract_links WHERE is_deleted = 0')
    .map(l => `${nref(l.factory_ref)}|${l.factory_table}|${nref(l.contract_ref)}`));
  const report = [], inserts = [], repoints = [];
  for (const t of ALL_TABLES) {
    // "Our Ref." holds contract refs only on New Orders (INS); OTJ / SEA use it for categories (OTJ, SEA, LCL)
    const hasOur = t === 'factory_ins_quotes';
    for (const r of all(`SELECT * FROM ${t} WHERE is_deleted = 0 AND TRIM(COALESCE(factory_ref,'')) <> ''
        AND (TRIM(COALESCE(contract_ref,'')) <> ''${hasOur ? " OR TRIM(COALESCE(our_ref,'')) <> ''" : ''})`)) {
      let matched = [], missing = [], how = [];
      // legacy texts: contract_ref and (INS) "Our Ref." — e.g. "SH-259 / SH-260 / SH-261"
      for (const [field, txt] of [['Contract Ref.', r.contract_ref], ['Our Ref.', hasOur ? r.our_ref : null]]) {
        if (!txt || !String(txt).trim()) continue;
        if (contracts.has(nref(txt))) { const c = contracts.get(nref(txt)); if (!matched.includes(c)) matched.push(c); how.push(`${field}: whole text`); continue; }
        const parts = String(txt).split(/[,;/]/).map(x => x.trim()).filter(Boolean);
        for (const p of parts) { const c = contracts.get(nref(p)); if (c) { if (!matched.includes(c)) matched.push(c); } else if (!missing.includes(p)) missing.push(p); }
        how.push(`${field}: split ${parts.length}`);
      }
      r.contract_ref = [r.contract_ref, hasOur ? r.our_ref : null].filter(x => x && String(x).trim()).join(' ‖ ');
      how = how.join('; ');
      const existing = matched.filter(c => linkKey.has(`${nref(r.factory_ref)}|${t}|${nref(c.contract_ref)}`));
      const required = matched.filter(c => !linkKey.has(`${nref(r.factory_ref)}|${t}|${nref(c.contract_ref)}`));
      required.forEach(c => inserts.push({ factory_ref: r.factory_ref, factory_table: t, factory_record_id: r.id, contract_ref: c.contract_ref,
        linked_quantity: matched.length === 1 && r.quantity ? r.quantity : null }));
      report.push({ factory_ref: r.factory_ref, factory_table: t, factory_record_id: r.id, stored_text: r.contract_ref, normalization: how,
        matched: matched.map(c => `${c.contract_ref} (#${c.id})`), missing, existing_links: existing.length, required_links: required.map(c => c.contract_ref),
        action: missing.length ? (required.length ? 'Insert matched links · review unmatched' : 'Review unmatched') : required.length ? 'Insert link(s)' : 'OK' });
    }
  }
  // Stale factory_record_id → the single live record with the same Factory Ref. (ambiguous → left as is)
  for (const l of all('SELECT * FROM factory_contract_links WHERE is_deleted = 0')) {
    const lv = all(`SELECT id FROM ${l.factory_table} WHERE is_deleted = 0 AND UPPER(TRIM(factory_ref)) = UPPER(TRIM(?))`, [l.factory_ref]);
    if (lv.length === 1 && lv[0].id !== l.factory_record_id) repoints.push({ link_id: l.id, factory_ref: l.factory_ref, contract_ref: l.contract_ref, old_record_id: l.factory_record_id, new_record_id: lv[0].id });
  }
  if (!dryRun) {
    db.exec('SAVEPOINT fcl_sync');
    try {
      for (const i of inserts) upsertLink(i, user, 'Reconciliation 2026-10-10: back-filled from factory record Contract Ref. text');
      for (const p of repoints) {
        run('UPDATE factory_contract_links SET factory_record_id = ?, updated_at = ? WHERE id = ?', [p.new_record_id, new Date().toISOString(), p.link_id]);
        _audit('LINK_REPOINT', p.link_id, p.factory_ref, user, { contract_ref: p.contract_ref, old_state: `factory_record_id ${p.old_record_id} (deleted record)`, new_state: `factory_record_id ${p.new_record_id} (live record)`, reason: 'Reconciliation 2026-10-10' });
      }
      db.exec('RELEASE fcl_sync');
    } catch (e) { try { db.exec('ROLLBACK TO fcl_sync'); db.exec('RELEASE fcl_sync'); } catch (_) {} throw e; }
  }
  return { dryRun, report, inserts, repoints };
}

module.exports = { ORDER_TABLES, ALL_TABLES, SHEET, LINKED_CONTRACTS_SQL, LINKED_CONTRACT_COUNT_SQL, FACTORY_REFS_SQL, FACTORY_REF_COUNT_SQL, FACTORY_REF_FILTER_SQL, orderLinkOf,
  linksForContract, upsertLink, removeLinks, syncLegacyLinks };
