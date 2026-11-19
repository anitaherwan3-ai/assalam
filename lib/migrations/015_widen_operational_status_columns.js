"use strict";

// Repair older preview databases where cashier shift status was created narrower
// than the current operational workflow requires. Additive and data-preserving.
module.exports = Object.freeze({
  version: "015_widen_operational_status_columns",
  description: "Widen shift status columns for pending verification workflow",
  expectedTables: Object.freeze(["cashier_shifts", "shift_reconciliations"]),
  statements: Object.freeze([
    "ALTER TABLE cashier_shifts MODIFY COLUMN status VARCHAR(32) NOT NULL",
    "ALTER TABLE shift_reconciliations MODIFY COLUMN status VARCHAR(32) NOT NULL"
  ])
});
