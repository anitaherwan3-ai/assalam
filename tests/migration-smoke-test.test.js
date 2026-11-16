"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runFoundationSmokeTest } = require("../lib/migration-smoke-test");

function mysqlError(errno, code) {
  const error = new Error(code);
  error.errno = errno;
  error.code = code;
  return error;
}

function mockConnection(options = {}) {
  const calls = [];
  const seenFirebaseUids = new Set();
  let nextRoleId = 100;
  return {
    calls,
    async query(sql) {
      calls.push(["query", sql]);
      if (sql.includes("FOREIGN_KEY_CHECKS AS")) return [[{ fk_checks: 1 }]];
      return [{ affectedRows: 0 }];
    },
    async execute(sql, params) {
      calls.push(["execute", sql, params]);
      if (sql.startsWith("INSERT INTO role_assignments")) return [{ insertId: nextRoleId++ }];
      if (sql.startsWith("INSERT INTO active_role_slots") && params[1] === 100 && params[0].startsWith("smoke_b_")) {
        throw mysqlError(1452, "ER_NO_REFERENCED_ROW_2");
      }
      if (sql.startsWith("INSERT INTO firebase_identities")) {
        if (seenFirebaseUids.has(params[0])) throw mysqlError(1062, "ER_DUP_ENTRY");
        seenFirebaseUids.add(params[0]);
        return [{ affectedRows: 1 }];
      }
      if (sql === "DELETE FROM users WHERE user_id = ?") {
        throw mysqlError(1451, "ER_ROW_IS_REFERENCED_2");
      }
      if (options.failCleanup && sql.startsWith("DELETE FROM users WHERE user_id IN")) {
        throw new Error("cleanup fixture");
      }
      return [{ insertId: 1, affectedRows: 1 }];
    }
  };
}

test("foundation smoke test exercises FK/unique constraints and cleans fixtures", async () => {
  const connection = mockConnection();
  const result = await runFoundationSmokeTest(connection);
  assert.equal(result.ok, true);
  assert.equal(result.synthetic, true);
  assert.ok(result.checks.includes("composite_owner_fk"));
  assert.ok(result.checks.includes("delete_restrict"));
  assert.ok(connection.calls.some(call => call[1] && call[1].startsWith("DELETE FROM users WHERE user_id IN")));
});

test("foundation smoke test fails closed when fixture cleanup fails", async () => {
  const connection = mockConnection({ failCleanup: true });
  await assert.rejects(
    runFoundationSmokeTest(connection),
    error => error.code === "TIDB_SMOKE_CLEANUP_FAILED"
  );
});
