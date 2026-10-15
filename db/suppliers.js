'use strict';
// ══════════════════════════════════════════════════════════════════════════════
// SUPPLIER MASTER (2026-10-03)
//   suppliers.id is the identity; factory / payment tables carry supplier_id and a
//   synchronised display copy (supplier_name) kept consistent by DB triggers
//   (db/db.js). Names are compared trimmed, case-insensitive, spaces collapsed.
//   Suppliers used by any record are never hard-deleted — they are deactivated.
// ══════════════════════════════════════════════════════════════════════════════
const { db, run, get, all } = require('./db.js');

const TYPES = ['Elevator Factory', 'Component Supplier', 'Shipping / Logistics', 'Other'];
const STATUSES = ['Active', 'Inactive'];
const ORDER_TABLES = ['factory_ins_quotes', 'factory_otj_quotes', 'factory_sea_costs'];
const LINKED_TABLES = [...ORDER_TABLES, 'factory_payments', 'lifecycle_factory_links'];
const FIELDS = ['name', 'code', 'supplier_type', 'country', 'contact_person', 'telephone', 'mobile', 'email', 'address', 'status', 'remarks'];

class SupplierError extends Error { constructor(m, status = 400, extra) { super(m); this.status = status; this.extra = extra; } }
const normalizeSupplierName = n => String(n == null ? '' : n).replace(/\s+/g, ' ').trim();
const supplierKey = n => normalizeSupplierName(n).toLowerCase();
const clean = v => { const s = v == null ? '' : String(v).trim(); return s === '' ? null : s; };

function usage(id) {
  const u = { orders: 0, payments: 0, linked: 0 };
  for (const t of ORDER_TABLES) u.orders += get(`SELECT COUNT(*) n FROM ${t} WHERE supplier_id=? AND is_deleted=0`, [id]).n;
  u.payments = get('SELECT COUNT(*) n FROM factory_payments WHERE supplier_id=?', [id]).n;
  for (const t of LINKED_TABLES) u.linked += get(`SELECT COUNT(*) n FROM ${t} WHERE supplier_id=?`, [id]).n;
  return u;
}

function list({ status, search } = {}) {
  const w = [], p = [];
  if (status) { w.push('status=?'); p.push(status); }
  if (search) { w.push('(name LIKE ? OR COALESCE(code,\'\') LIKE ? OR COALESCE(contact_person,\'\') LIKE ?)'); p.push(...Array(3).fill(`%${search}%`)); }
  return all(`SELECT * FROM suppliers ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY status='Inactive', name COLLATE NOCASE`, p)
    .map(s => ({ ...s, ...usage(s.id) }));
}

function findByName(name) { return get('SELECT * FROM suppliers WHERE name_key=?', [supplierKey(name)]); }

function validate(data, existing) {
  const out = {};
  for (const f of FIELDS) if (f in data) out[f] = f === 'name' ? normalizeSupplierName(data[f]) : clean(data[f]);
  const name = 'name' in out ? out.name : existing && existing.name;
  if (!name) throw new SupplierError('Supplier Name is required.');
  if (name.length > 120) throw new SupplierError('Supplier Name is too long (max 120 characters).');
  const status = 'status' in out ? (out.status || 'Active') : (existing ? existing.status : 'Active');
  if (!STATUSES.includes(status)) throw new SupplierError('Status must be Active or Inactive.');
  out.status = status;
  if (out.supplier_type && !TYPES.includes(out.supplier_type)) throw new SupplierError(`Supplier Type must be one of: ${TYPES.join(', ')}.`);
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw new SupplierError('E-mail address is not valid.');
  const dup = get('SELECT id, name FROM suppliers WHERE name_key=? AND id<>?', [supplierKey(name), existing ? existing.id : 0]);
  if (dup) throw new SupplierError(`Supplier already exists as ${dup.name}.`, 409, { existing_id: dup.id, existing_name: dup.name });
  if (out.code) {
    const dc = get('SELECT id, name FROM suppliers WHERE lower(code)=lower(?) AND id<>?', [out.code, existing ? existing.id : 0]);
    if (dc) throw new SupplierError(`Supplier Code ${out.code} is already used by ${dc.name}.`, 409);
  }
  return out;
}

function audit(action, s, user, details) {
  try { require('./audit.js').writeAuditLog({ action, module: 'suppliers', recordId: s.id, recordRef: s.name, performedBy: user, details }); } catch (_) {}
}

function create(data, user) {
  const v = validate(data || {}, null);
  const r = run(`INSERT INTO suppliers (name, name_key, code, supplier_type, country, contact_person, telephone, mobile, email, address, status, remarks, created_by, updated_by, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
    [v.name, supplierKey(v.name), v.code || null, v.supplier_type || null, v.country || null, v.contact_person || null, v.telephone || null,
     v.mobile || null, v.email || null, v.address || null, v.status, v.remarks || null, user, user]);
  const s = get('SELECT * FROM suppliers WHERE id=?', [Number(r.lastInsertRowid)]);
  audit('CREATE', s, user, { supplier: s });
  return s;
}

function update(id, data, user) {
  const ex = get('SELECT * FROM suppliers WHERE id=?', [id]);
  if (!ex) throw new SupplierError('Supplier not found', 404);
  const v = validate(data || {}, ex);
  const changes = {};
  for (const [k, val] of Object.entries(v)) if (String(ex[k] ?? '') !== String(val ?? '')) changes[k] = { old: ex[k], new: val };
  if (!Object.keys(changes).length) return { supplier: ex, changed: false };
  db.exec('SAVEPOINT sup_upd');
  try {
    const set = { ...Object.fromEntries(Object.entries(changes).map(([k, c]) => [k, c.new])), updated_by: user };
    if (changes.name) set.name_key = supplierKey(set.name);
    run(`UPDATE suppliers SET ${Object.keys(set).map(k => `${k}=?`).join(', ')}, updated_at=datetime('now') WHERE id=?`, [...Object.values(set), id]);
    // Renamed → refresh the display copy on every linked record (identity unchanged)
    if (changes.name) for (const t of LINKED_TABLES) run(`UPDATE ${t} SET supplier_name=? WHERE supplier_id=?`, [set.name, id]);
    db.exec('RELEASE sup_upd');
  } catch (e) { try { db.exec('ROLLBACK TO sup_upd'); db.exec('RELEASE sup_upd'); } catch (_) {} throw e; }
  const s = get('SELECT * FROM suppliers WHERE id=?', [id]);
  audit(changes.status && Object.keys(changes).length === 1 ? (s.status === 'Active' ? 'ACTIVATE' : 'DEACTIVATE') : 'UPDATE', s, user, { changes });
  return { supplier: s, changed: true };
}

/** Hard delete only when the supplier was never used (otherwise: deactivate). */
function remove(id, user) {
  const ex = get('SELECT * FROM suppliers WHERE id=?', [id]);
  if (!ex) throw new SupplierError('Supplier not found', 404);
  const u = usage(id);
  if (u.linked > 0) throw new SupplierError(`${ex.name} is used by ${u.linked} record(s) — deactivate it instead of deleting.`, 409);
  run('DELETE FROM suppliers WHERE id=?', [id]);
  audit('DELETE', ex, user, { supplier: ex });
  return { ok: true };
}

/**
 * Resolve the supplier for a factory record write.
 * body.supplier_id (preferred) or body.supplier_name (matched case/space-insensitively).
 * New links must point to an ACTIVE supplier; an unchanged historical link may stay inactive.
 * Returns { id, name } or null when no supplier was supplied.
 */
function resolveForWrite(body, existing) {
  const hasId = body.supplier_id !== undefined && body.supplier_id !== null && body.supplier_id !== '';
  const hasName = body.supplier_name !== undefined && body.supplier_name !== null && String(body.supplier_name).trim() !== '';
  if (!hasId && !hasName) return null;
  const s = hasId ? get('SELECT * FROM suppliers WHERE id=?', [Number(body.supplier_id)]) : findByName(body.supplier_name);
  if (!s) throw new SupplierError(hasId ? 'Selected supplier not found.' : `Supplier "${normalizeSupplierName(body.supplier_name)}" is not in the Supplier Master — add it first (Factory & Suppliers → + Add Supplier).`);
  const unchanged = existing && Number(existing.supplier_id) === s.id;
  if (s.status !== 'Active' && !unchanged) throw new SupplierError(`${s.name} is Inactive — reactivate it in Manage Suppliers before using it on an order.`);
  return { id: s.id, name: s.name };
}

module.exports = { TYPES, STATUSES, SupplierError, normalizeSupplierName, supplierKey, list, findByName, create, update, remove, usage, resolveForWrite };
