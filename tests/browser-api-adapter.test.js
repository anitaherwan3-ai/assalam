"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

test("browser TiDB adapter uses Better Auth cookies and only its exact API paths", async () => {
  const calls = [];
  const window = {
    crypto: { randomUUID: () => "request-uuid-test" },
    location: { hostname: "assalam-mysql-preview-test.vercel.app" }
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
  await window.assalamTiDBApi.getSession();
  assert.equal(calls[0].path, "/api/auth/session");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(calls[0].init.headers["X-Request-ID"], "request-uuid-test");
  await window.assalamTiDBApi.createTariff({ name: "Test", serviceType: "Test", price: "1000" }, "idempotency-key-1");
  assert.equal(calls[1].init.headers["Idempotency-Key"], "idempotency-key-1");
  await window.assalamTiDBApi.updateSupplier({ publicId: "supplier-public-id", expectedVersion: "1", name: "Supplier", phone: "", address: "" }, "supplier-update-key");
  assert.equal(calls[2].path, "/api/catalog/suppliers");
  assert.equal(calls[2].init.method, "PATCH");
  assert.equal(calls[2].init.headers["Idempotency-Key"], "supplier-update-key");
  await window.assalamTiDBApi.deactivateSupplier({ publicId: "supplier-public-id", expectedVersion: "2" }, "supplier-disable-key");
  assert.equal(calls[3].init.method, "DELETE");
  assert.equal(calls[3].init.headers["Idempotency-Key"], "supplier-disable-key");
  assert.equal(typeof window.assalamTiDBApi.bootstrapPreviewOwner, "function");
  assert.equal(typeof window.assalamTiDBApi.previewImportDryRun, "function");
  await window.assalamTiDBApi.listUsers();
  assert.equal(calls[4].path, "/api/admin/users");
  await assert.rejects(
    window.assalamTiDBApi.request("/api/not-allowlisted"),
    error => error.code === "TIDB_ENDPOINT_NOT_ALLOWED"
  );
});

test("browser TiDB adapter does not enable preview catalog on the production host", () => {
  const window = { crypto: { randomUUID: () => "id" }, location: { hostname: "klinikassalaam.vercel.app" } };
  const source = fs.readFileSync(require.resolve("../js/tidb-api.js"), "utf8");
  vm.runInNewContext(source, { window, fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
  assert.equal(window.ASSALAM_TIDB_PREVIEW_BOOTSTRAP, false);
});
