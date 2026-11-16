"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runInTransaction } = require("../lib/with-transaction");

function mockConnection(fkEnabled = 1) {
  const calls = [];
  return {
    calls,
    async query(sql) {
      calls.push(["query", sql]);
      if (sql.includes("FOREIGN_KEY_CHECKS AS")) return [[{ fk_checks: fkEnabled }]];
      return [{ affectedRows: 0 }];
    },
    async beginTransaction() { calls.push(["begin"]); },
    async commit() { calls.push(["commit"]); },
    async rollback() { calls.push(["rollback"]); },
    release() { calls.push(["release"]); }
  };
}

test("transaction sets UTC and FK checks, commits and releases", async () => {
  const connection = mockConnection();
  const value = await runInTransaction(connection, async () => "committed");
  assert.equal(value, "committed");
  assert.ok(connection.calls.some(call => call[1] === "SET SESSION time_zone = '+00:00'"));
  assert.ok(connection.calls.some(call => call[1] === "SET SESSION FOREIGN_KEY_CHECKS = 1"));
  assert.ok(connection.calls.some(call => call[0] === "commit"));
  assert.ok(connection.calls.some(call => call[0] === "release"));
  assert.ok(!connection.calls.some(call => call[0] === "rollback"));
});

test("transaction rolls back work failures and releases", async () => {
  const connection = mockConnection();
  await assert.rejects(runInTransaction(connection, async () => { throw new Error("fixture failure"); }), /fixture failure/);
  assert.ok(connection.calls.some(call => call[0] === "rollback"));
  assert.ok(connection.calls.some(call => call[0] === "release"));
  assert.ok(!connection.calls.some(call => call[0] === "commit"));
});

test("transaction refuses to run with FK checks disabled", async () => {
  const connection = mockConnection(0);
  await assert.rejects(
    runInTransaction(connection, async () => "must not run"),
    error => error.code === "DB_FOREIGN_KEY_CHECKS_DISABLED"
  );
  assert.ok(!connection.calls.some(call => call[0] === "begin"));
  assert.ok(connection.calls.some(call => call[0] === "release"));
});
