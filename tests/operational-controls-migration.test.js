"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const migration = require("../lib/migrations/009_operational_controls_v1");

test("operational controls migration defines all support domains", () => {
  assert.equal(migration.version, "009_operational_controls_v1");
  assert.equal(migration.expectedTables.length, 13);
  const sql = migration.statements.join("\n");
  for (const table of migration.expectedTables) assert.ok(sql.includes("CREATE TABLE IF NOT EXISTS " + table));
  assert.match(sql, /UNIQUE KEY uq_journal_source \(source_type, source_id\)/);
  assert.match(sql, /debit_amount BIGINT NOT NULL DEFAULT 0/);
  assert.match(sql, /credit_amount BIGINT NOT NULL DEFAULT 0/);
});

test("invoice cancellations and inventory losses preserve actor and source history", () => {
  const sql = migration.statements.join("\n");
  assert.match(sql, /reason VARCHAR\(255\) NOT NULL/);
  assert.match(sql, /resolved_by_user_id VARCHAR\(64\) NULL/);
  assert.match(sql, /inventory_movement_id BIGINT UNSIGNED NOT NULL/);
  assert.match(sql, /approved_by_user_id VARCHAR\(64\) NOT NULL/);
});

test("queue display audio assets store object references and independent clip types", () => {
  const sql = migration.statements.join("\n");
  assert.match(sql, /clip_type VARCHAR\(24\) NOT NULL/);
  assert.match(sql, /object_key VARCHAR\(512\) NOT NULL/);
  assert.match(sql, /sha256 CHAR\(64\) NOT NULL/);
  assert.match(sql, /running_text TEXT NULL/);
});

test("accounting and backup/export records are linked to periods and actors", () => {
  const sql = migration.statements.join("\n");
  assert.match(sql, /accounting_period_id BIGINT UNSIGNED NOT NULL/);
  assert.match(sql, /FOREIGN KEY \(accounting_period_id\) REFERENCES accounting_periods/);
  assert.match(sql, /requested_by_user_id VARCHAR\(64\) NOT NULL/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
});
