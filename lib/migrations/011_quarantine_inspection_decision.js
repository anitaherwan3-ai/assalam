"use strict";

// Record the Admin's explicit physical inspection outcome before Pimpinan release approval.
module.exports = Object.freeze({
  version: "011_quarantine_inspection_decision",
  description: "Persist explicit quarantine inspection decision",
  expectedTables: Object.freeze(["inventory_quarantine_events"]),
  statements: Object.freeze([
    "ALTER TABLE inventory_quarantine_events ADD COLUMN inspection_decision VARCHAR(24) NULL AFTER reason"
  ])
});
