"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const migration = require("../lib/migrations/014_better_auth_admin_fields");

test("Better Auth admin migration is additive and preserves existing accounts and sessions", () => {
  assert.equal(migration.version, "014_better_auth_admin_fields");
  assert.deepEqual([...migration.expectedTables].sort(), ["session", "user"]);
  const sql = migration.statements.join("\\n");
  assert.match(sql, /ADD COLUMN role VARCHAR\\(255\\) NOT NULL DEFAULT 'user'/);
  assert.match(sql, /ADD COLUMN banned TINYINT\\(1\\) NOT NULL DEFAULT 0/);
  assert.match(sql, /ADD COLUMN banReason VARCHAR\\(255\\) NULL/);
  assert.match(sql, /ADD COLUMN banExpires DATETIME\\(3\\) NULL/);
  assert.match(sql, /ADD COLUMN impersonatedBy VARCHAR\\(64\\) NULL/);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|TRUNCATE/);
});
