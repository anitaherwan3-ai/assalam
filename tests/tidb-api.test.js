"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function installAdapter(fetchImpl) {
  const window = {
    crypto: { randomUUID: () => "request-id-test" },
    location: { hostname: "klinik-assalaam.vercel.app" }
  };
  const source = fs.readFileSync(require.resolve("../js/tidb-api.js"), "utf8");
  vm.runInNewContext(source, {
    window,
    fetch: fetchImpl,
    AbortController,
    setTimeout,
    clearTimeout,
    URL
  });
  return window.assalamTiDBApi;
}

test("TiDB adapter permits query variants on explicitly allowed API routes", async () => {
  const requested = [];
  const api = installAdapter(async (path) => {
    requested.push(path);
    return { ok: true, status: 200, json: async () => ({ ok: true, data: [] }) };
  });

  await api.listAllQueueAssignments();
  await api.listQueueAssignments();
  await api.listBatches();
  await api.listQuarantine();
  await api.listSupplierReturns();
  await api.listStocktakes();
  await api.listSupplierInvoices();

  assert.deepEqual(requested, [
    "/api/queue?all_assignments=1",
    "/api/queue?assignments=1",
    "/api/inventory?batches=1",
    "/api/inventory?quarantine=1",
    "/api/inventory?supplier_returns=1",
    "/api/inventory?stocktakes=1",
    "/api/inventory?invoices=1"
  ]);
});

test("TiDB adapter still rejects unknown API pathnames", async () => {
  const api = installAdapter(async () => {
    throw new Error("fetch must not be called for an unknown endpoint");
  });
  await assert.rejects(
    api.request("/api/unknown?view=1"),
    error => error.code === "TIDB_ENDPOINT_NOT_ALLOWED"
  );
});
