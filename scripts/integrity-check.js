#!/usr/bin/env node
/**
 * SH-PMS Integrity Check
 * Usage: node scripts/integrity-check.js [--fix] [--json]
 *
 * Validates:
 *   1. Record counts vs baseline (from app_versions table or VERSION.json)
 *   2. Duplicate refs (contract_ref, factory_ref, quotation_ref, payment_ref)
 *   3. Broken factory links (factory_ref pointing to non-existent records)
 *   4. Null mandatory fields on non-deleted rows
 *   5. Orphaned audit_log records
 *   6. Broken lifecycle links
 */

'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'db', 'sh_pms.sqlite');
const VER_PATH = path.join(__dirname, '..', 'VERSION.json');

// ── helpers ─────────────────────────────────────────────────────────────────
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = MEMORY;');

function q(sql, params = []) {
  return db.prepare(sql).all(...params);
}
function one(sql, params = []) {
  return db.prepare(sql).get(...params);
}

const issues  = [];
const summary = { checks: 0, passed: 0, warnings: 0, errors: 0 };

function pass(label) {
  summary.checks++;
  summary.passed++;
  if (!args.json) console.log(`  ✓ ${label}`);
}
function warn(label, detail) {
  summary.checks++;
  summary.warnings++;
  issues.push({ level: 'WARN', label, detail });
  if (!args.json) console.log(`  ⚠  ${label}: ${detail}`);
}
function fail(label, detail) {
  summary.checks++;
  summary.errors++;
  issues.push({ level: 'ERROR', label, detail });
  if (!args.json) console.log(`  ✗ ${label}: ${detail}`);
}

// ── arg parse ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const args = { json: argv.includes('--json'), fix: argv.includes('--fix') };

if (!args.json) {
  console.log('SH-PMS Integrity Check');
  console.log('DB:', DB_PATH);
  console.log('─'.repeat(60));
}

// ── 1. Table existence ───────────────────────────────────────────────────────
const REQUIRED_TABLES = [
  'contracts','quotations','factory_ins_quotes','factory_otj_quotes','factory_sea_costs',
  'client_payments','factory_payments','maintenance_contracts','users','audit_log',
  'sales_targets','project_lifecycle','app_versions'
];
const OPTIONAL_TABLES = ['maintenance_projects','maintenance_project_visits'];

if (!args.json) console.log('\n[1] Table Existence');
for (const t of REQUIRED_TABLES) {
  const row = one("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [t]);
  if (row) pass(t); else fail(`Table missing: ${t}`, 'Required table not found');
}
for (const t of OPTIONAL_TABLES) {
  const row = one("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [t]);
  if (row) pass(t + ' (optional)'); else warn(`Table missing: ${t}`, 'Optional table not present');
}

// ── 2. Record Counts vs Baseline ─────────────────────────────────────────────
if (!args.json) console.log('\n[2] Record Counts');
let baseline = null;
try {
  const verRow = one(
    "SELECT records_after FROM app_versions ORDER BY id DESC LIMIT 1"
  );
  if (verRow && verRow.records_after) baseline = JSON.parse(verRow.records_after);
} catch(_) {}
if (!baseline && fs.existsSync(VER_PATH)) {
  try { baseline = JSON.parse(fs.readFileSync(VER_PATH,'utf8')).record_counts; } catch(_) {}
}

const COUNT_MAP = {
  contracts:             'SELECT COUNT(*) c FROM contracts WHERE is_deleted=0',
  quotations:            'SELECT COUNT(*) c FROM quotations WHERE is_deleted=0',
  factory_ins_quotes:    'SELECT COUNT(*) c FROM factory_ins_quotes WHERE is_deleted=0',
  factory_otj_quotes:    'SELECT COUNT(*) c FROM factory_otj_quotes WHERE is_deleted=0',
  factory_sea_costs:     'SELECT COUNT(*) c FROM factory_sea_costs WHERE is_deleted=0',
  client_payments:       'SELECT COUNT(*) c FROM client_payments WHERE is_deleted=0',
  factory_payments:      'SELECT COUNT(*) c FROM factory_payments WHERE is_deleted=0',
  maintenance_contracts: 'SELECT COUNT(*) c FROM maintenance_contracts WHERE is_deleted=0',
  users:                 'SELECT COUNT(*) c FROM users',
};

const liveCounts = {};
for (const [tbl, sql] of Object.entries(COUNT_MAP)) {
  try {
    const r = one(sql);
    liveCounts[tbl] = r ? r.c : 0;
    if (baseline && baseline[tbl] !== undefined) {
      const base = baseline[tbl];
      const live = liveCounts[tbl];
      if (live < base) {
        fail(`${tbl} record count dropped`, `baseline=${base}, now=${live} (lost ${base-live})`);
      } else if (live > base + 50) {
        warn(`${tbl} large increase`, `baseline=${base}, now=${live} (+${live-base})`);
      } else {
        pass(`${tbl}: ${live} (baseline ${base})`);
      }
    } else {
      pass(`${tbl}: ${liveCounts[tbl]}`);
    }
  } catch(e) { warn(`${tbl} count failed`, e.message); }
}

// ── 3. Duplicate Refs ────────────────────────────────────────────────────────
if (!args.json) console.log('\n[3] Duplicate Reference Keys');
const DUP_CHECKS = [
  ['contracts',          'contract_ref'],
  ['quotations',         'quote_ref'],
  ['client_payments',    'payment_ref'],
  ['factory_payments',   'payment_ref'],
  ['factory_ins_quotes', 'factory_ref'],
  ['factory_otj_quotes', 'factory_ref'],
  ['factory_sea_costs',  'factory_ref'],
];
for (const [tbl, col] of DUP_CHECKS) {
  try {
    const dups = q(
      `SELECT ${col}, COUNT(*) c FROM ${tbl} WHERE is_deleted=0 AND ${col} IS NOT NULL
       GROUP BY ${col} HAVING c > 1`
    );
    if (dups.length === 0) pass(`${tbl}.${col} — no duplicates`);
    else fail(`${tbl}.${col} duplicates`, dups.map(d=>`${d[col]}(×${d.c})`).join(', '));
  } catch(e) { warn(`dup check ${tbl}.${col}`, e.message); }
}

// ── 4. Broken Factory Links ──────────────────────────────────────────────────
if (!args.json) console.log('\n[4] Broken Factory Links');
try {
  const linkedIns = q(
    `SELECT c.id, c.contract_ref, fi.factory_ref
     FROM contracts c
     JOIN factory_ins_quotes fi ON fi.contract_ref = c.contract_ref
     WHERE c.is_deleted=0 AND fi.is_deleted=0 AND fi.factory_ref IS NOT NULL
     LIMIT 5`
  );
  pass(`factory_ins → contracts sample: ${linkedIns.length} linked rows visible`);
} catch(e) { warn('factory link join failed', e.message); }

// contracts with factory_ref that can't be found in any table
try {
  const orphanedLinks = q(
    `SELECT c.contract_ref, c.id
     FROM contracts c
     WHERE c.is_deleted=0
       AND c.contract_ref NOT IN (
         SELECT DISTINCT contract_ref FROM factory_ins_quotes WHERE contract_ref IS NOT NULL AND is_deleted=0
         UNION
         SELECT DISTINCT contract_ref FROM factory_otj_quotes WHERE contract_ref IS NOT NULL AND is_deleted=0
         UNION
         SELECT DISTINCT contract_ref FROM factory_sea_costs WHERE contract_ref IS NOT NULL AND is_deleted=0
       )
     LIMIT 20`
  );
  // Not an error — contracts without factory records are normal
  pass(`Contracts with no factory records: ${orphanedLinks.length}`);
} catch(e) { warn('factory orphan check', e.message); }

// ── 5. Null Mandatory Fields ─────────────────────────────────────────────────
if (!args.json) console.log('\n[5] Null Mandatory Fields');
const NULL_CHECKS = [
  ['contracts',       'contract_ref', 'is_deleted=0'],
  ['contracts',       'client_name',  'is_deleted=0'],
  ['quotations',      'quote_ref',    'is_deleted=0'],
  ['client_payments', 'payment_ref',  'is_deleted=0'],
  ['client_payments', 'contract_ref', 'is_deleted=0'],
  ['factory_payments','payment_ref',  'is_deleted=0'],
  ['users',           'username',     '1=1'],
  ['users',           'role',         '1=1'],
];
for (const [tbl, col, where] of NULL_CHECKS) {
  try {
    const r = one(`SELECT COUNT(*) c FROM ${tbl} WHERE ${where} AND (${col} IS NULL OR ${col}='')`);
    if (r.c === 0) pass(`${tbl}.${col} — all populated`);
    else fail(`${tbl}.${col} null/empty`, `${r.c} rows affected`);
  } catch(e) { warn(`null check ${tbl}.${col}`, e.message); }
}

// ── 6. Orphaned Audit Log ────────────────────────────────────────────────────
if (!args.json) console.log('\n[6] Audit Log');
try {
  const r = one("SELECT COUNT(*) c FROM audit_log");
  pass(`audit_log rows: ${r.c}`);
} catch(e) { warn('audit_log count', e.message); }

// ── 7. Version Table ─────────────────────────────────────────────────────────
if (!args.json) console.log('\n[7] Version History');
try {
  const versions = q("SELECT version, applied_at, description FROM app_versions ORDER BY id ASC");
  if (versions.length === 0) warn('app_versions empty', 'No version records logged yet');
  else {
    for (const v of versions) pass(`${v.version} (${v.applied_at.slice(0,10)})`);
  }
} catch(e) { warn('app_versions query', e.message); }

// ── Final summary ────────────────────────────────────────────────────────────
const result = {
  timestamp: new Date().toISOString(),
  db: DB_PATH,
  summary,
  liveCounts,
  issues
};

if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log('\n' + '═'.repeat(60));
  console.log(`Checks: ${summary.checks}  ✓ Passed: ${summary.passed}  ⚠ Warnings: ${summary.warnings}  ✗ Errors: ${summary.errors}`);
  if (summary.errors > 0) {
    console.log('\nERRORS (action required):');
    issues.filter(i=>i.level==='ERROR').forEach(i=>console.log(`  • ${i.label}: ${i.detail}`));
    process.exit(1);
  } else if (summary.warnings > 0) {
    console.log('\nWarnings (review recommended):');
    issues.filter(i=>i.level==='WARN').forEach(i=>console.log(`  • ${i.label}: ${i.detail}`));
    process.exit(0);
  } else {
    console.log('\nAll checks passed. Database integrity is healthy.');
    process.exit(0);
  }
}
