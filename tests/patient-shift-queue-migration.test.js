"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const migration = require("../lib/migrations/005_patient_shift_queue_v1");

test("operational v1 patient, shift and queue tables are declared", () => {
  assert.equal(migration.version, "005_patient_shift_queue_v1");
  assert.equal(migration.expectedTables.length, 11);
  const sql = migration.statements.join("\n");
  for (const table of migration.expectedTables) {
    assert.ok(sql.includes("CREATE TABLE IF NOT EXISTS " + table), "missing DDL for " + table);
  }
  assert.match(sql, /PRIMARY KEY \(business_date, prefix\)/);
  assert.match(sql, /UNIQUE KEY uq_queue_ticket_number \(business_date, prefix, sequence_no\)/);
});

test("A and B have independent call guards and transfers require a reason", () => {
  const sql = migration.statements.join("\n");
  assert.ok(sql.includes("VALUES ('A', NULL, 1, UTC_TIMESTAMP(3)), ('B', NULL, 1, UTC_TIMESTAMP(3))"));
  assert.match(sql, /reason VARCHAR\(255\) NOT NULL/);
  assert.match(sql, /UNIQUE KEY uq_queue_guard_active_ticket \(active_queue_ticket_id\)/);
});

test("encounters and queue transfers preserve cashier-to-shift ownership", () => {
  const sql = migration.statements.join("\n");
  assert.match(sql, /FOREIGN KEY \(shift_id, cashier_user_id\) REFERENCES cashier_shifts\(shift_id, cashier_user_id\)/);
  assert.match(sql, /FOREIGN KEY \(current_shift_id, current_cashier_user_id\) REFERENCES cashier_shifts\(shift_id, cashier_user_id\)/);
  assert.match(sql, /FOREIGN KEY \(from_shift_id, from_cashier_user_id\) REFERENCES cashier_shifts\(shift_id, cashier_user_id\)/);
  assert.match(sql, /FOREIGN KEY \(to_shift_id, to_cashier_user_id\) REFERENCES cashier_shifts\(shift_id, cashier_user_id\)/);
});

test("queue and patient operational records are protected from cascade deletion", () => {
  const sql = migration.statements.join("\n");
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
  assert.match(sql, /ON DELETE RESTRICT ON UPDATE RESTRICT/);
});
