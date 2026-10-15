// Shared audit log writer — used by all delete/restore routes.
// Non-fatal: errors are caught and logged to console, never thrown to caller.
const { run } = require('./db.js');

/**
 * Write a record to the audit_log table.
 * @param {object} opts
 *   action      {string}  'DELETE' | 'RESTORE'
 *   module      {string}  e.g. 'contracts', 'quotations', 'factory_sea_costs'
 *   recordId    {number}  database row id
 *   recordRef   {string}  human-readable ref (Contract Ref., Quote Ref., etc.)
 *   details     {object}  any additional key/value pairs to serialise as JSON
 *   performedBy {string}  username from session
 */
function writeAuditLog({ action, module: mod, recordId, recordRef, details, performedBy }) {
  try {
    run(
      `INSERT INTO audit_log (action, module, record_id, record_ref, details, performed_by, performed_at)
       VALUES (?,?,?,?,?,?,datetime('now'))`,
      [
        action || 'DELETE',
        mod,
        recordId  || null,
        recordRef || null,
        details   ? JSON.stringify(details) : null,
        performedBy,
      ]
    );
  } catch (e) {
    console.error('[audit_log write error]', e.message);
  }
}

module.exports = { writeAuditLog };
