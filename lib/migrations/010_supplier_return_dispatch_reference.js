"use strict";

// Supplier-return dispatch traceability and durable reference to the physical dispatch document.
module.exports = Object.freeze({
  version: "010_supplier_return_dispatch_reference",
  description: "Persist supplier return dispatch reference for reconciliation",
  expectedTables: Object.freeze(["supplier_returns"]),
  statements: Object.freeze([
    "ALTER TABLE supplier_returns ADD COLUMN dispatch_reference VARCHAR(120) NULL AFTER dispatched_at_utc",
    "ALTER TABLE supplier_returns ADD UNIQUE KEY uq_supplier_return_dispatch_reference (dispatch_reference)"
  ])
});
