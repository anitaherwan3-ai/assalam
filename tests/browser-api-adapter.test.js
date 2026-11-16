"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

test("browser TiDB adapter accepts only its exact API paths and sends Firebase bearer tokens", async () => {
  const calls = [];
  const window = {
    crypto: { randomUUID: () => "request-uuid-test" },
    ASSALAM_FIREBASE_CONFIG: { projectId: "assalam-preview-test" },
    firebaseBackend: { auth: { currentUser: { getIdToken: async () => "firebase-test-token" } } }
  };
  const context = {
    window,
    fetch: async (path, init) => {
      calls.push({ path, init });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
  };
  const source = fs.readFileSync(require.resolve("../js/tidb-api.js"), "utf8");
  vm.runInNewContext(source, context);

  assert.equal(window.ASSALAM_TIDB_PREVIEW_BOOTSTRAP, true);
  await window.assalamTiDBApi.bootstrapPreviewOwner();
  assert.equal(calls[0].path, "/api/auth/bootstrap-preview-owner");
  assert.equal(calls[0].init.headers.Authorization, "Bearer firebase-test-token");
  await window.assalamTiDBApi.createTariff({ name: "Test", serviceType: "Test", price: "1000" }, "idempotency-key-1");
  assert.equal(calls[1].init.headers["Idempotency-Key"], "idempotency-key-1");
  await assert.rejects(
    window.assalamTiDBApi.request("/api/admin/users"),
    error => error.code === "TIDB_ENDPOINT_NOT_ALLOWED"
  );
});
