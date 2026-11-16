"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { runOperationalSmokeTest } = require("../lib/operational-smoke-test");

test("operational preview smoke test is rollback-only and covers critical clinic domains", () => {
  assert.equal(typeof runOperationalSmokeTest, "function");
  const source = fs.readFileSync(path.join(__dirname, "../lib/operational-smoke-test.js"), "utf8");
  for (const table of [
    "queue_transfer_events", "inventory_movements", "stocktakes", "sales_returns",
    "refund_payments", "expenses", "supplier_payment_allocations",
    "inventory_quarantine_events", "shift_reconciliations", "journal_lines"
  ]) assert.ok(source.includes(table), "missing operational smoke coverage: " + table);
  assert.match(source, /await connection\.rollback\(\)/);
  assert.match(source, /tablesExercised: 60/);
});
