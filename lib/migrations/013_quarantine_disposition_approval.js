"use strict";

// Explicit Pimpinan disposition approval and Admin execution for non-releasable quarantined stock.
module.exports = Object.freeze({
  version: "013_quarantine_disposition_approval",
  description: "Record approval and completion of quarantined stock disposal",
  expectedTables: Object.freeze(["inventory_quarantine_events"]),
  statements: Object.freeze([
    "ALTER TABLE inventory_quarantine_events ADD COLUMN disposition_approved_by_user_id VARCHAR(64) NULL AFTER release_approved_at_utc",
    "ALTER TABLE inventory_quarantine_events ADD COLUMN disposition_approved_at_utc DATETIME(3) NULL AFTER disposition_approved_by_user_id",
    "ALTER TABLE inventory_quarantine_events ADD COLUMN disposition_completed_by_user_id VARCHAR(64) NULL AFTER disposition_approved_at_utc",
    "ALTER TABLE inventory_quarantine_events ADD COLUMN disposition_completed_at_utc DATETIME(3) NULL AFTER disposition_completed_by_user_id",
    "ALTER TABLE inventory_quarantine_events ADD KEY idx_quarantine_disposition_approver (disposition_approved_by_user_id)",
    "ALTER TABLE inventory_quarantine_events ADD KEY idx_quarantine_disposition_executor (disposition_completed_by_user_id)",
    "ALTER TABLE inventory_quarantine_events ADD CONSTRAINT fk_quarantine_disposition_approver FOREIGN KEY (disposition_approved_by_user_id) REFERENCES users(user_id) ON DELETE RESTRICT ON UPDATE RESTRICT",
    "ALTER TABLE inventory_quarantine_events ADD CONSTRAINT fk_quarantine_disposition_executor FOREIGN KEY (disposition_completed_by_user_id) REFERENCES users(user_id) ON DELETE RESTRICT ON UPDATE RESTRICT"
  ])
});
