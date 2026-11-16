"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { encodeSnapshot } = require("../lib/audit");

test("audit snapshot allows ordinary operational fields", () => {
  assert.equal(encodeSnapshot({ status: "approved", amount: 125000 }), '{"status":"approved","amount":125000}');
});

test("audit snapshot blocks credentials recursively", () => {
  assert.throws(() => encodeSnapshot({ user: { access_token: "secret" } }), error => error.code === "AUDIT_SECRET_FIELD_BLOCKED");
});

test("audit snapshot rejects oversized payloads and raw IP addresses", () => {
  assert.throws(() => encodeSnapshot({ note: "x".repeat(70000) }), error => error.code === "AUDIT_SNAPSHOT_TOO_LARGE");
});

const { writeAuditEvent } = require("../lib/audit");

test("audit writer inserts a sanitized event with a generated UUID and UTC time", async () => {
  let captured;
  const connection = { async execute(sql, params) {
    captured = { sql, params };
    return [{ insertId: 42 }];
  }};
  const id = await writeAuditEvent(connection, {
    actorUserId: "user-1", actorRole: "admin", actionCode: "PATIENT_UPDATED",
    entityType: "patient", entityId: "p-1", before: { status: "old" },
    after: { status: "new" }, requestId: "req-1"
  });
  assert.equal(id, "42");
  assert.match(captured.sql, /UTC_TIMESTAMP\(3\)/);
  assert.match(captured.params[0], /^[0-9a-f-]{36}$/i);
  assert.equal(captured.params[6], '{"status":"old"}');
});
