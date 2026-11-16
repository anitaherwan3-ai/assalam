"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const migration = require("../lib/migrations/001_identity_foundation");

test("identity migration has a stable version and the four expected tables", () => {
  assert.equal(migration.version, "001_identity_foundation");
  const sql = migration.statements.join("\n").toLowerCase();
  for (const table of ["users", "role_assignments", "active_role_slots", "firebase_identities"]) {
    assert.match(sql, new RegExp("create table if not exists " + table));
  }
});

test("Firebase identity maps by immutable UID and cannot cascade-delete its user", () => {
  const sql = migration.statements.join("\n").toLowerCase();
  assert.match(sql, /unique key uq_firebase_identity_subject \(provider, subject_uid\)/);
  assert.match(sql, /foreign key \(user_id\)[\s\S]*on delete restrict on update restrict/);
  assert.doesNotMatch(sql, /on delete cascade/);
});

test("active role slot enforces that the selected assignment belongs to the same user", () => {
  const sql = migration.statements.join("\n").toLowerCase();
  assert.match(sql, /foreign key \(role_assignment_id, user_id\)[\s\S]*references role_assignments \(role_assignment_id, user_id\)/);
});
