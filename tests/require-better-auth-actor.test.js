"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { toWebHeaders, requireRole } = require("../lib/require-better-auth-actor");

test("Better Auth actor headers preserve cookie and authorization metadata", () => {
  const headers = toWebHeaders({
    cookie: "better-auth.session_token=opaque",
    origin: "https://preview.example",
    "x-request-id": "req-123",
    "x-forwarded-for": "192.0.2.10"
  });
  assert.equal(headers.get("cookie"), "better-auth.session_token=opaque");
  assert.equal(headers.get("origin"), "https://preview.example");
  assert.equal(headers.get("x-request-id"), "req-123");
});

test("clinic role authorization is server-side and rejects a client-only role", () => {
  const actor = { userId: "user-1", role: "kasir" };
  assert.equal(requireRole(actor, ["kasir"]).userId, "user-1");
  assert.throws(() => requireRole({ userId: "user-1", role: "pimpinan" }, ["kasir"]), {
    code: "AUTH_FORBIDDEN",
    statusCode: 403
  });
});
