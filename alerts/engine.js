// Alerts/Reminders engine. Re-run this any time data changes (status update, import, or on a schedule)
// to keep the alerts list current. It never deletes alert HISTORY - it only auto-resolves alerts
// whose underlying condition has gone away, and creates new ones for conditions that newly apply.
//
// 2026-06-27: maintenance_overdue, maintenance_upcoming, amc_expiring_soon, amc_expired rules removed
// (Module Changes step - maintenance_records/amc_contracts tables dropped). projects -> quotations renamed
// in the remaining rules' SQL; entity: 'project' kept as-is (status_history/attachments/alerts CHECK
// constraint compatibility - see [[sh_pms_contracts_module]]/migration notes).
//
// 2026-09-26: client_second_payment_pending, installation_pending, balance_before_handover rules removed.
// These queried installation_status / handover_status / delivery_status on the quotations table — columns
// that don't exist there (they lived on the old projects table, dropped during the 2026-06-27 migration).
// Any open alerts of those types are auto-resolved on first recompute after this change.

const { run, get, all } = require('../db/db.js');

const RULES = [
  {
    type: 'client_advance_pending',
    severity: 'high',
    query: `SELECT id, client_name, project_code FROM quotations WHERE is_deleted = 0 AND status = 'Confirmed' AND COALESCE(payment_received,0) = 0`,
    entity: 'project',
    message: (r) => `Advance payment pending for confirmed project ${r.project_code} (${r.client_name || 'client'})`,
  },
  {
    type: 'supplier_payment_due',
    severity: 'high',
    query: `SELECT id, supplier_name, factory_order_code FROM factory_orders WHERE is_deleted = 0
            AND COALESCE(factory_invoice_value,0) - COALESCE(supplier_payment_paid,0) > 0
            AND production_status IN ('In Production','Ready')`,
    entity: 'factory_order',
    message: (r) => `Supplier payment due to ${r.supplier_name || 'supplier'} for order ${r.factory_order_code}`,
  },
  {
    type: 'production_delay',
    severity: 'high',
    query: `SELECT id, supplier_name, factory_order_code FROM factory_orders WHERE is_deleted = 0 AND production_status = 'Delayed'`,
    entity: 'factory_order',
    message: (r) => `Production delayed at ${r.supplier_name || 'supplier'} for order ${r.factory_order_code}`,
  },
  {
    type: 'shipping_delay',
    severity: 'high',
    query: `SELECT id, supplier_name, factory_order_code FROM factory_orders WHERE is_deleted = 0 AND shipping_status = 'Delayed'`,
    entity: 'factory_order',
    message: (r) => `Shipping delayed for order ${r.factory_order_code} (${r.supplier_name || 'supplier'})`,
  },
  {
    type: 'material_delivery_pending',
    severity: 'medium',
    query: `SELECT id, supplier_name, factory_order_code FROM factory_orders WHERE is_deleted = 0
            AND production_status = 'Ready' AND delivery_status = 'Pending'`,
    entity: 'factory_order',
    message: (r) => `Material ready but not yet delivered to site - order ${r.factory_order_code}`,
  },
];

// Alert types removed in the 2026-09-26 engine cleanup — auto-resolve any open ones.
const REMOVED_ALERT_TYPES = ['client_second_payment_pending', 'installation_pending', 'balance_before_handover'];

function recomputeAlerts() {
  let created = 0, resolved = 0;

  // Resolve lingering open alerts whose rule no longer exists
  for (const type of REMOVED_ALERT_TYPES) {
    const stale = all(`SELECT id FROM alerts WHERE alert_type = ? AND is_resolved = 0`, [type]);
    for (const a of stale) {
      run(`UPDATE alerts SET is_resolved = 1, resolved_at = datetime('now') WHERE id = ?`, [a.id]);
      resolved++;
    }
  }

  for (const rule of RULES) {
    const matchingRows = all(rule.query);
    const matchingIds = new Set(matchingRows.map(r => r.id));

    const openAlerts = all(`SELECT * FROM alerts WHERE alert_type = ? AND is_resolved = 0`, [rule.type]);
    for (const alert of openAlerts) {
      if (!matchingIds.has(alert.entity_id)) {
        run(`UPDATE alerts SET is_resolved = 1, resolved_at = datetime('now') WHERE id = ?`, [alert.id]);
        resolved++;
      }
    }

    const alreadyOpenIds = new Set(openAlerts.map(a => a.entity_id));
    for (const row of matchingRows) {
      if (alreadyOpenIds.has(row.id)) continue;
      run(`INSERT INTO alerts (entity_type, entity_id, alert_type, message, severity) VALUES (?,?,?,?,?)`,
        [rule.entity, row.id, rule.type, rule.message(row), rule.severity]);
      created++;
    }
  }
  return { created, resolved };
}

module.exports = { recomputeAlerts, RULES };
