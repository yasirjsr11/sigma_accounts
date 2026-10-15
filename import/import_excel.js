// Excel Import Engine
// Reads the client quotation file + factory/supplier file, cleans the data,
// detects duplicates, and UPSERTs into SQLite without ever deleting prior history.
// Re-running this import is always safe (idempotent) - it will neither duplicate
// nor delete records, it only fills gaps and adds genuinely new rows.

const path = require('path');
const { run, get, all } = require('../db/db.js');
const { cleanStr, parseDate, readSheet, listSheets } = require('./helpers.js');
const { normalizeStatus } = require('./statusNormalizer.js');

function getField(row, ...keys) {
  for (const k of keys) {
    if (row[k] !== undefined) return row[k];
  }
  const norm = (s) => s.toLowerCase().replace(/\s+/g, '').replace(/\./g, '');
  for (const actualKey of Object.keys(row)) {
    for (const k of keys) {
      if (norm(actualKey) === norm(k)) return row[actualKey];
    }
  }
  return null;
}

function betterParseNumber(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v);
  const m = s.match(/-?[\d][\d,]*\.?\d*/);
  if (!m) return null;
  const n = parseFloat(m[0].replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

let logCounters = {};
function logRow(sheet, kind) {
  logCounters[sheet] = logCounters[sheet] || { processed: 0, inserted: 0, updated: 0, skipped: 0 };
  logCounters[sheet][kind]++;
  logCounters[sheet].processed++;
}
function recordImportLog(fileName, runBy) {
  for (const [sheet, c] of Object.entries(logCounters)) {
    run(`INSERT INTO import_log (file_name, sheet_name, rows_processed, rows_inserted, rows_updated, rows_skipped, run_by)
         VALUES (?,?,?,?,?,?,?)`,
      [fileName, sheet, c.processed, c.inserted, c.updated, c.skipped, runBy || 'system']);
  }
  logCounters = {};
}

// ---------- PROJECT (client side) ----------

function findExistingProject(p) {
  if (p.quote_ref) {
    const m = get(`SELECT * FROM projects WHERE is_deleted = 0 AND quote_ref = ? COLLATE NOCASE
                   AND COALESCE(client_name,'') = COALESCE(?, '') COLLATE NOCASE`,
      [p.quote_ref, p.client_name]);
    if (m) return m;
  }
  // fallback natural key for rows that never had a quote ref in the original sheet
  return get(`SELECT * FROM projects WHERE is_deleted = 0 AND source_sheet = ?
              AND COALESCE(client_name,'') = COALESCE(?, '') COLLATE NOCASE
              AND COALESCE(project_name,'') = COALESCE(?, '') COLLATE NOCASE
              AND (quote_ref IS NULL OR quote_ref = '')`,
    [p.source_sheet, p.client_name, p.project_name]);
}

function upsertProject(p, runBy) {
  const existing = findExistingProject(p);

  if (existing) {
    const fieldsToFillIfEmpty = ['location', 'salesperson', 'attn_name', 'phone', 'mobile', 'email',
      'quotation_number', 'quotation_value', 'quotation_date', 'contract_value', 'remarks'];
    const updates = {};
    for (const f of fieldsToFillIfEmpty) {
      if ((existing[f] === null || existing[f] === '') && p[f] !== null && p[f] !== undefined) {
        updates[f] = p[f];
      }
    }
    updates.legacy_status_text = p.legacy_status_text || existing.legacy_status_text;
    updates.updated_at = new Date().toISOString();
    const setSql = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    if (setSql) run(`UPDATE projects SET ${setSql} WHERE id = ?`, [...Object.values(updates), existing.id]);
    return { id: existing.id, action: 'updated' };
  }

  let code = p.quote_ref ? p.quote_ref.replace(/\s+/g, '') : null;
  if (!code) code = `AUTO-${(p.source_sheet || 'X').replace(/\s+/g, '')}-${Math.abs(hashStr((p.client_name || '') + (p.project_name || ''))).toString(36)}`;
  let finalCode = code, n = 1;
  while (get('SELECT id FROM projects WHERE project_code = ?', [finalCode])) finalCode = `${code}-${++n}`;

  run(`INSERT INTO projects
    (project_code, quote_ref, client_name, project_name, location, salesperson, attn_name, phone, mobile, email,
     quotation_number, quotation_value, quotation_date, status, contract_value, remarks, legacy_status_text,
     delivery_status, installation_status, handover_status, source_sheet, source_file, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [finalCode, p.quote_ref, p.client_name, p.project_name, p.location, p.salesperson, p.attn_name,
     p.phone, p.mobile, p.email, p.quotation_number, p.quotation_value, p.quotation_date, p.status,
     p.contract_value, p.remarks, p.legacy_status_text, p.delivery_status, p.installation_status,
     p.handover_status, p.source_sheet, p.source_file, runBy || 'import']);

  const row = get('SELECT id FROM projects WHERE project_code = ?', [finalCode]);
  return { id: row.id, action: 'inserted' };
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return h;
}

function importClientFile(filePath, runBy = 'import') {
  const fileName = path.basename(filePath);
  const sheets = listSheets(filePath);

  const PLAIN_QUOTE_SHEETS = ['SH QUOTES - 2026', 'SH QUOTES - 2025', 'SH QUOTES - 2024', 'SH QUOTES'];
  const STATUS_SHEETS = ['SH INSTALLATION', 'SH ALL AS IT IS'];
  const AMC_SHEETS = ['SH AMC'];
  const OTJ_SHEETS = ['SH OTJ'];
  const BUILDIN_SHEETS = ['BuildIn'];

  for (const sheetName of sheets) {
    const rows = readSheet(filePath, sheetName);
    const trimmedName = sheetName.trim();

    if (PLAIN_QUOTE_SHEETS.includes(trimmedName)) {
      for (const row of rows) {
        const clientName = cleanStr(getField(row, 'Client Name'));
        const quoteRef = cleanStr(getField(row, 'Quote Ref.', 'Quote Ref. '));
        if (!clientName && !quoteRef) { logRow(sheetName, 'skipped'); continue; }
        const lastFollowUp = cleanStr(getField(row, 'Last Follow Up'));
        const remarksRaw = cleanStr(getField(row, 'Remarks'));
        const remarks = [lastFollowUp ? `Last follow-up: ${lastFollowUp}` : null, remarksRaw].filter(Boolean).join(' | ') || null;
        const p = {
          quote_ref: quoteRef, client_name: clientName,
          project_name: cleanStr(getField(row, 'Project Desceiption', 'Project Description')),
          location: null, salesperson: cleanStr(getField(row, 'Sales By')),
          attn_name: cleanStr(getField(row, 'Attn.')), phone: cleanStr(getField(row, 'Tel')),
          mobile: cleanStr(getField(row, 'Mob')), email: cleanStr(getField(row, 'E-mail')),
          quotation_number: quoteRef, quotation_value: null, quotation_date: null, status: 'Quoted',
          contract_value: null, remarks, legacy_status_text: null,
          delivery_status: 'Pending', installation_status: 'Not Started', handover_status: 'Pending',
          source_sheet: sheetName, source_file: fileName,
        };
        const res = upsertProject(p, runBy);
        logRow(sheetName, res.action === 'inserted' ? 'inserted' : 'updated');
      }
    } else if (STATUS_SHEETS.includes(trimmedName)) {
      for (const row of rows) {
        const clientName = cleanStr(getField(row, 'Client Name'));
        const quoteRef = cleanStr(getField(row, 'Quote Ref.', 'Quote Ref. '));
        if (!clientName && !quoteRef) { logRow(sheetName, 'skipped'); continue; }
        const statusText = cleanStr(getField(row, 'Status'));
        const contractDate = parseDate(getField(row, 'Contract Date'));
        const norm = normalizeStatus(statusText, { hasContractDate: !!contractDate, sheetImpliesConfirmed: true });
        const remarks = contractDate ? `Contract Date: ${contractDate}` : null;
        const p = {
          quote_ref: quoteRef, client_name: clientName,
          project_name: cleanStr(getField(row, 'Project Desceiption', 'Project Description')),
          location: null,
          salesperson: cleanStr(getField(row, 'Sales By')) || cleanStr(getField(row, 'Sales By.1')),
          attn_name: cleanStr(getField(row, 'Attn.')), phone: cleanStr(getField(row, 'Tel')),
          mobile: cleanStr(getField(row, 'Mob')), email: cleanStr(getField(row, 'E-mail')),
          quotation_number: quoteRef, quotation_value: null, quotation_date: contractDate,
          status: norm.status, contract_value: null, remarks, legacy_status_text: statusText,
          delivery_status: norm.delivery_status, installation_status: norm.installation_status, handover_status: norm.handover_status,
          source_sheet: sheetName, source_file: fileName,
        };
        const res = upsertProject(p, runBy);
        logRow(sheetName, res.action === 'inserted' ? 'inserted' : 'updated');
      }
    } else if (AMC_SHEETS.includes(trimmedName) || OTJ_SHEETS.includes(trimmedName)) {
      const tag = AMC_SHEETS.includes(trimmedName) ? '[AMC Contract]' : '[OTJ]';
      for (const row of rows) {
        const clientName = cleanStr(getField(row, 'Client Name'));
        const quoteRef = cleanStr(getField(row, 'Quote Ref.', 'Quote Ref. '));
        if (!clientName && !quoteRef) { logRow(sheetName, 'skipped'); continue; }
        const statusText = cleanStr(getField(row, 'Status'));
        const contractDate = parseDate(getField(row, 'Contract Date'));
        const norm = normalizeStatus(statusText, { hasContractDate: !!contractDate, sheetImpliesConfirmed: true });
        const totalValue = betterParseNumber(getField(row, 'Total Value'));
        const contRef = cleanStr(getField(row, 'Cont. Ref.'));
        const remarksParts = [tag, contRef ? `Contract Ref: ${contRef}` : null, contractDate ? `Contract Date: ${contractDate}` : null];
        const p = {
          quote_ref: quoteRef, client_name: clientName,
          project_name: cleanStr(getField(row, 'Project Desceiption', 'Project Description')),
          location: null, salesperson: cleanStr(getField(row, 'Sales By')),
          attn_name: cleanStr(getField(row, 'Attn.')), phone: cleanStr(getField(row, 'Tel')),
          mobile: cleanStr(getField(row, 'Mob')), email: cleanStr(getField(row, 'E-mail')),
          quotation_number: quoteRef, quotation_value: totalValue, quotation_date: contractDate,
          status: norm.status, contract_value: totalValue, remarks: remarksParts.filter(Boolean).join(' | '),
          legacy_status_text: statusText,
          delivery_status: norm.delivery_status, installation_status: norm.installation_status, handover_status: norm.handover_status,
          source_sheet: sheetName, source_file: fileName,
        };
        const res = upsertProject(p, runBy);
        logRow(sheetName, res.action === 'inserted' ? 'inserted' : 'updated');
      }
    } else if (BUILDIN_SHEETS.includes(trimmedName)) {
      for (const row of rows) {
        const clientName = cleanStr(getField(row, 'Client Name'));
        const quoteRef = cleanStr(getField(row, 'Quote Ref.', 'Quote Ref. '));
        if (!clientName && !quoteRef) { logRow(sheetName, 'skipped'); continue; }
        const p = {
          quote_ref: quoteRef, client_name: clientName,
          project_name: cleanStr(getField(row, 'Project Desceiption')) || cleanStr(getField(row, 'Project Ref.')),
          location: null, salesperson: cleanStr(getField(row, 'Sales By')),
          attn_name: cleanStr(getField(row, 'Attn.')), phone: null,
          mobile: cleanStr(getField(row, 'Mob')), email: null,
          quotation_number: quoteRef, quotation_value: betterParseNumber(getField(row, 'Offer')),
          quotation_date: parseDate(getField(row, 'Date')), status: 'Quoted', contract_value: null,
          remarks: ['[BuildIn]', cleanStr(getField(row, 'Unit ')), cleanStr(getField(row, 'Feed backs '))].filter(Boolean).join(' | '),
          legacy_status_text: null,
          delivery_status: 'Pending', installation_status: 'Not Started', handover_status: 'Pending',
          source_sheet: sheetName, source_file: fileName,
        };
        const res = upsertProject(p, runBy);
        logRow(sheetName, res.action === 'inserted' ? 'inserted' : 'updated');
      }
    } else {
      // unrecognized sheet layout - left untouched, nothing imported, nothing lost from the source file
    }
  }
  recordImportLog(fileName, runBy);
}

// ---------- FACTORY ORDER (supplier side) ----------

function findExistingFactoryOrder(f) {
  if (f.our_ref || f.factory_ref) {
    const m = get(`SELECT * FROM factory_orders WHERE is_deleted = 0 AND
            ((our_ref IS NOT NULL AND our_ref = ?) OR (factory_ref IS NOT NULL AND factory_ref = ?))
            AND COALESCE(supplier_name,'') = COALESCE(?, '') COLLATE NOCASE`,
      [f.our_ref || '__none__', f.factory_ref || '__none__', f.supplier_name]);
    if (m) return m;
  }
  return get(`SELECT * FROM factory_orders WHERE is_deleted = 0
              AND COALESCE(supplier_name,'') = COALESCE(?, '') COLLATE NOCASE
              AND COALESCE(client_name,'') = COALESCE(?, '') COLLATE NOCASE
              AND COALESCE(project_description,'') = COALESCE(?, '') COLLATE NOCASE
              AND source_sheet = ?
              AND (our_ref IS NULL OR our_ref = '') AND (factory_ref IS NULL OR factory_ref = '')`,
    [f.supplier_name, f.client_name, f.project_description, f.source_sheet]);
}

function upsertFactoryOrder(f, runBy) {
  const existing = findExistingFactoryOrder(f);

  if (existing) {
    const fieldsToFillIfEmpty = ['client_name', 'project_description', 'factory_quotation_number',
      'factory_invoice_value', 'packing_list', 'bl_copy', 'eta', 'remarks'];
    const updates = {};
    for (const fld of fieldsToFillIfEmpty) {
      if ((existing[fld] === null || existing[fld] === '') && f[fld] !== null && f[fld] !== undefined) {
        updates[fld] = f[fld];
      }
    }
    // Payments: only top-up the difference if the imported figure is higher than what's stored
    // (prevents double-counting on repeated imports while still catching genuinely new installments)
    if (f.supplier_payment_paid && f.supplier_payment_paid > (existing.supplier_payment_paid || 0)) {
      updates.supplier_payment_paid = f.supplier_payment_paid;
    }
    updates.legacy_remarks = f.legacy_remarks || existing.legacy_remarks;
    updates.updated_at = new Date().toISOString();
    const setSql = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    if (setSql) run(`UPDATE factory_orders SET ${setSql} WHERE id = ?`, [...Object.values(updates), existing.id]);
    return { id: existing.id, action: 'updated' };
  }

  let code = (f.our_ref || f.factory_ref || `AUTO-${(f.source_sheet || 'X').replace(/\s+/g, '')}-${Math.abs(hashStr((f.client_name || '') + (f.project_description || ''))).toString(36)}`).replace(/\s+/g, '');
  let finalCode = code, n = 1;
  while (get('SELECT id FROM factory_orders WHERE factory_order_code = ?', [finalCode])) finalCode = `${code}-${++n}`;

  run(`INSERT INTO factory_orders
    (factory_order_code, factory_quotation_number, supplier_name, our_ref, factory_ref, client_name,
     project_description, factory_invoice_value, supplier_payment_paid, packing_list, bl_copy, eta, remarks,
     legacy_remarks, source_sheet, source_file, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [finalCode, f.factory_quotation_number, f.supplier_name, f.our_ref, f.factory_ref, f.client_name,
     f.project_description, f.factory_invoice_value, f.supplier_payment_paid || 0, f.packing_list, f.bl_copy,
     f.eta, f.remarks, f.legacy_remarks, f.source_sheet, f.source_file, runBy || 'import']);

  const row = get('SELECT id FROM factory_orders WHERE factory_order_code = ?', [finalCode]);
  return { id: row.id, action: 'inserted' };
}

function importFactoryQuoteSheet(filePath, sheetName, supplierName, fileName, runBy) {
  const rows = readSheet(filePath, sheetName);
  for (const row of rows) {
    const ourRef = cleanStr(getField(row, 'Our Ref.', 'Our Ref. '));
    const factoryRef = cleanStr(getField(row, 'Factory Ref.'));
    const clientName = cleanStr(getField(row, 'Client Name'));
    if (!ourRef && !factoryRef && !clientName) { logRow(sheetName, 'skipped'); continue; }

    const invoiceValue = betterParseNumber(getField(row, 'Emirates Dirham'));
    const advance = betterParseNumber(getField(row, 'Advance Payment ', 'Advance Payment'));
    const finalPay = betterParseNumber(getField(row, 'Final Payment'));
    const paid = (advance || 0) + (finalPay || 0);

    const f = {
      factory_quotation_number: cleanStr(getField(row, 'Invoice ', 'Invoice')),
      supplier_name: supplierName, our_ref: ourRef, factory_ref: factoryRef, client_name: clientName,
      project_description: cleanStr(getField(row, 'Project Desceiption', 'Project Description')),
      factory_invoice_value: invoiceValue, supplier_payment_paid: paid,
      packing_list: null, bl_copy: null, eta: null,
      remarks: cleanStr(getField(row, 'Drawing Ref.')),
      legacy_remarks: cleanStr(getField(row, 'Remarks')),
      source_sheet: sheetName, source_file: fileName,
    };
    const res = upsertFactoryOrder(f, runBy);
    logRow(sheetName, res.action === 'inserted' ? 'inserted' : 'updated');
  }
}

function importFactoryPaymentsSheet(filePath, sheetName, supplierName, fileName, runBy) {
  const rows = readSheet(filePath, sheetName);
  for (const row of rows) {
    const sno = getField(row, 'S.No.');
    if (typeof sno !== 'number') { logRow(sheetName, 'skipped'); continue; }
    const ourRef = cleanStr(getField(row, 'Our Ref.', 'Our Ref. '));
    const factoryRef = cleanStr(getField(row, 'Factory Ref.'));
    if (!ourRef && !factoryRef) { logRow(sheetName, 'skipped'); continue; }

    const existing = get(
      `SELECT * FROM factory_orders WHERE is_deleted = 0 AND
       ((our_ref IS NOT NULL AND our_ref = ?) OR (factory_ref IS NOT NULL AND factory_ref = ?))`,
      [ourRef || '__none__', factoryRef || '__none__']);

    const amount = betterParseNumber(getField(row, 'Payment to be Made'));
    const remark = cleanStr(getField(row, 'Remarks'));
    const kind = cleanStr(getField(row, 'Kind of payment'));
    const paymentKey = `import:${sheetName}:row${sno}`;

    if (existing && amount && remark && remark.toLowerCase().includes('paid')) {
      // idempotency guard: skip if we've already recorded this exact import row before
      const already = get(`SELECT id FROM status_history WHERE entity_type='factory_order' AND entity_id=? AND remarks LIKE ?`,
        [existing.id, `%${paymentKey}%`]);
      if (already) { logRow(sheetName, 'skipped'); continue; }
      run(`UPDATE factory_orders SET supplier_payment_paid = supplier_payment_paid + ?, updated_at = datetime('now') WHERE id = ?`,
        [amount, existing.id]);
      run(`INSERT INTO status_history (entity_type, entity_id, field_name, old_value, new_value, changed_by, remarks)
           VALUES ('factory_order', ?, 'supplier_payment_paid', NULL, ?, ?, ?)`,
        [existing.id, String(amount), runBy || 'import', `${kind || ''} (${paymentKey})`]);
      logRow(sheetName, 'updated');
    } else {
      logRow(sheetName, 'skipped');
    }
  }
}

function importFactoryFile(filePath, runBy = 'import') {
  const fileName = path.basename(filePath);
  const sheets = listSheets(filePath);

  for (const sheetName of sheets) {
    const trimmed = sheetName.trim();
    if (trimmed === 'SL FUJI QUOTES') {
      importFactoryQuoteSheet(filePath, sheetName, 'SL Fuji', fileName, runBy);
    } else if (trimmed.startsWith('SL FUJI PAYMENTS')) {
      importFactoryPaymentsSheet(filePath, sheetName, 'SL Fuji', fileName, runBy);
    } else if (['DELFAR ELEVATORS', 'MAZ IND.', 'ITIMAT ELEVATORS', 'ARESFORTI ELEVATORS'].includes(trimmed)) {
      importFactoryQuoteSheet(filePath, sheetName, trimmed, fileName, runBy);
    } else {
      // e.g. 'CEO ELEVATORS' - irregular/unstructured layout, not auto-importable
    }
  }
  recordImportLog(fileName, runBy);
}

// ---------- AUTO-LINKING ----------

function autoLinkProjectsAndFactoryOrders(runBy = 'system') {
  const factoryOrders = all(`SELECT id, our_ref FROM factory_orders WHERE is_deleted = 0 AND our_ref IS NOT NULL`);
  let linked = 0;
  for (const fo of factoryOrders) {
    const project = get(`SELECT id FROM projects WHERE is_deleted = 0 AND quote_ref = ? COLLATE NOCASE`, [fo.our_ref]);
    if (!project) continue;
    const existingLink = get(`SELECT id FROM project_links WHERE project_id = ? AND factory_order_id = ?`, [project.id, fo.id]);
    if (existingLink) continue;
    run(`INSERT INTO project_links (project_id, factory_order_id, link_type, linked_by) VALUES (?,?,'auto',?)`,
      [project.id, fo.id, runBy]);
    linked++;
  }
  return linked;
}

module.exports = {
  importClientFile, importFactoryFile, autoLinkProjectsAndFactoryOrders,
  upsertProject, upsertFactoryOrder, getField, betterParseNumber,
};
