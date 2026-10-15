// Single source of truth for "Total Sales Units" — the headline unit count shown on BOTH the
// Main Dashboard (routes/dashboard.js) and the Contract Dashboard (routes/contracts.js).
//
// 2026-07-12: Changed from COUNT(*) to SUM(COALESCE(elevator_units,1)).
// Each contract now carries an elevator_units field (positive integer, min 1, default 1).
// All sales reporting uses UNITS (total elevators), not contract count.
// COALESCE(elevator_units,1) ensures backward compatibility — existing contracts without
// the field populate it at 1 via the DEFAULT 1 migration, but COALESCE guards against NULLs.
//
// A cancelled contract (is_deleted=0, delivery_status='Cancel') still counts — it was approved.
// Never re-inline COUNT(*) anywhere — use this helper so both dashboards stay in sync.
const { get } = require('./db.js');

function getTotalContractUnits() {
  return get(`SELECT COALESCE(SUM(COALESCE(elevator_units,1)),0) c FROM contracts WHERE is_deleted = 0`).c;
}

module.exports = { getTotalContractUnits };
