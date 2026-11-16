"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const migration = require("../lib/migrations/007_sales_returns_refunds_v1");

test("sales migration stores immutable line snapshots and line-level discount", () => {
  assert.equal(migration.version, "007_sales_returns_refunds_v1");
  assert.equal(migration.expectedTables.length, 10);
  const sql = migration.statements.join("\n");
  for (const table of migration.expectedTables) assert.ok(sql.includes("CREATE TABLE IF NOT EXISTS " + table));
  assert.match(sql, /line_discount BIGINT NOT NULL DEFAULT 0/);
  assert.match(sql, /net_charge BIGINT NOT NULL/);
  assert.match(sql, /hpp_snapshot BIGINT NULL/);
});

test("non-cash review and external settlement are separate from recognized income", () => {
  const sql = migration.statements.join("\n");
  assert.match(sql, /review_status VARCHAR\(24\) NOT NULL/);
  assert.match(sql, /settlement_status VARCHAR\(24\) NOT NULL/);
  assert.match(sql, /income_recognized_at_utc DATETIME\(3\) NULL/);
});

test("return quota is component-aware and refund approval is separate from transfer", () => {
  const sql = migration.statements.join("\n");
  assert.match(sql, /return_quota_subject_id BIGINT UNSIGNED NOT NULL/);
  assert.match(sql, /reason VARCHAR\(255\) NOT NULL/);
  assert.match(sql, /pimpinan_approved_by_user_id VARCHAR\(64\) NULL/);
  assert.match(sql, /approved_amount BIGINT NOT NULL/);
  assert.match(sql, /transfer_status VARCHAR\(24\) NOT NULL/);
  assert.match(sql, /transferred_at_utc DATETIME\(3\) NULL/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
});
