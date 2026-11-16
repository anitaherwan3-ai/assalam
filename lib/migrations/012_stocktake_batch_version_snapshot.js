"use strict";

// Protect monthly stocktake counts from movements posted after physical counting.
module.exports = Object.freeze({
  version: "012_stocktake_batch_version_snapshot",
  description: "Add optimistic batch version snapshot to monthly stocktake lines",
  expectedTables: Object.freeze(["stocktake_lines"]),
  statements: Object.freeze([
    "ALTER TABLE stocktake_lines ADD COLUMN batch_version_snapshot BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER variance_quantity"
  ])
});
