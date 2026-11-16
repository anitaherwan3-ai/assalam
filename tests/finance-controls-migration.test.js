"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const migration = require("../lib/migrations/008_finance_controls_v1");

test("finance controls migration declares approval and settlement ledgers", () => {
  assert.equal(migration.version, "008_finance_controls_v1");
  assert.equal(migration.expectedTables.length, 14);
  const sql = migration.statements.join("\n");
  for (const table of migration.expectedTables) assert.ok(sql.includes("CREATE TABLE IF NOT EXISTS " + table));
  assert.match(sql, /created_by_user_id VARCHAR\(64\) NOT NULL/);
  assert.match(sql, /approved_by_user_id VARCHAR\(64\) NULL/);
  assert.match(sql, /supplier_payment_allocation_id BIGINT UNSIGNED/);
  assert.match(sql, /allocated_amount BIGINT NOT NULL/);
});

test("supplier returns are stock-neutral until dispatch and settlement remains explicit", () => {
  const sql = migration.statements.join("\n");
  assert.match(sql, /dispatched_at_utc DATETIME\(3\) NULL/);
  assert.match(sql, /settlement_status VARCHAR\(24\) NOT NULL DEFAULT/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS supplier_credit_notes/);
  assert.match(sql, /settled_at_utc DATETIME\(3\) NULL/);
});

test("quarantine requires inspection and Pimpinan approval before release", () => {
  const sql = migration.statements.join("\n");
  assert.match(sql, /inspected_by_user_id VARCHAR\(64\) NULL/);
  assert.match(sql, /release_approved_by_user_id VARCHAR\(64\) NULL/);
  assert.match(sql, /released_at_utc DATETIME\(3\) NULL/);
  assert.match(sql, /FOREIGN KEY \(source_return_line_id\) REFERENCES sales_return_lines/);
});

test("finance and evidence ledgers retain rows through RESTRICT relationships", () => {
  const sql = migration.statements.join("\n");
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
  assert.match(sql, /FOREIGN KEY \(reversal_of_entry_id\) REFERENCES cash_ledger_entries/);
  assert.match(sql, /FOREIGN KEY \(reversal_of_entry_id\) REFERENCES bank_ledger_entries/);
});
