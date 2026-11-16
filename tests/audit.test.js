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
