"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { requireRole } = require("../lib/require-auth");

test("server role guard accepts only an explicit allowed role", () => {
  const actor = { userId: "u-1", role: "admin" };
  assert.equal(requireRole(actor, ["admin", "pimpinan"]), actor);
  assert.throws(
    () => requireRole(actor, ["kasir"]),
    error => error.statusCode === 403 && error.code === "AUTH_FORBIDDEN"
  );
});
