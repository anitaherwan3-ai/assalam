"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const migration = require("../lib/migrations/006_inventory_purchasing_v1");

test("inventory migration defines traceable purchasing and stock ledgers", () => {
  assert.equal(migration.version, "006_inventory_purchasing_v1");
  assert.equal(migration.expectedTables.length, 10);
  const sql = migration.statements.join("\n");
  for (const table of migration.expectedTables) assert.ok(sql.includes("CREATE TABLE IF NOT EXISTS " + table));
  assert.match(sql, /UNIQUE KEY uq_batch_source_receipt_line \(source_receipt_line_id\)/);
  assert.match(sql, /UNIQUE KEY uq_inventory_movement_idempotency \(idempotency_key\)/);
  assert.match(sql, /FOREIGN KEY \(batch_id, medicine_id\) REFERENCES inventory_batches\(batch_id, medicine_id\)/);
});

test("stock is integer-valued and HPP may remain unknown without erasing stock", () => {
  const sql = migration.statements.join("\n");
  assert.match(sql, /canonical_unit VARCHAR\(16\) NOT NULL/);
  assert.match(sql, /unit_cost_hpp BIGINT NULL/);
  assert.match(sql, /unknown_hpp_quantity BIGINT UNSIGNED NOT NULL DEFAULT 0/);
  assert.match(sql, /profit_calculation_status VARCHAR\(24\) NOT NULL/);
  assert.match(sql, /expiry_verified TINYINT\(1\) NOT NULL DEFAULT 0/);
  assert.match(sql, /origin_verified TINYINT\(1\) NOT NULL DEFAULT 0/);
});

test("monthly stocktake records counter and Pimpinan approver identities", () => {
  const sql = migration.statements.join("\n");
  assert.match(sql, /counted_by_user_id VARCHAR\(64\) NOT NULL/);
  assert.match(sql, /approved_by_user_id VARCHAR\(64\) NULL/);
  assert.match(sql, /UNIQUE KEY uq_stocktake_date \(stocktake_date\)/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
});
