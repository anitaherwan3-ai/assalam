"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const migration = require("../lib/migrations/004_better_auth_core");

test("Better Auth migration defines the four isolated core models", () => {
  assert.equal(migration.version, "004_better_auth_core");
  assert.deepEqual([...migration.expectedTables].sort(), ["account", "rateLimit", "session", "user", "verification"]);
  assert.equal(migration.statements.length, 5);
  const sql = migration.statements.join("\n");
  for (const table of ["user", "session", "account", "verification", "rateLimit"]) {
    assert.ok(sql.includes("CREATE TABLE IF NOT EXISTS " + (table === "user" || table === "session" || table === "account" ? "`" + table + "`" : table)));
  }
  assert.match(sql, /UNIQUE KEY uq_ba_user_email \(email\)/);
  assert.match(sql, /UNIQUE KEY uq_ba_session_token \(token\)/);
  assert.match(sql, /UNIQUE KEY uq_ba_account_provider_identity \(providerId, accountId\)/);
  assert.match(sql, /KEY idx_ba_verification_identifier \(identifier\)/);
});

test("Better Auth sessions and accounts reference provider users, not clinic role tables", () => {
  const sql = migration.statements.join("\n");
  assert.equal((sql.match(/FOREIGN KEY \(userId\)/g) || []).length, 2);
  assert.match(sql, /REFERENCES `user` \(id\) ON DELETE CASCADE ON UPDATE RESTRICT/);
  assert.doesNotMatch(sql, /REFERENCES (users|role_assignments|active_role_slots)/);
});

test("Better Auth migration preserves millisecond timestamp columns", () => {
  const sql = migration.statements.join("\n");
  assert.ok((sql.match(/DATETIME\(3\)/g) || []).length >= 8);
});
