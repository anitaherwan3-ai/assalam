"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/auth/bootstrap-preview-owner");

test("Firebase-based preview owner bootstrap is permanently disabled", async () => {
  const response = {
    headers: {}, statusCode: 0, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
  await handler({ method: "POST", headers: {} }, response);
  assert.equal(response.statusCode, 404);
  assert.equal(response.body.code, "PREVIEW_BOOTSTRAP_DISABLED");
  assert.equal(response.headers["Cache-Control"], "no-store, private");
});
