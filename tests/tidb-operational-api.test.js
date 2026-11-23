"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function loadAdapter() {
  const calls = [];
  const window = {
    location: { hostname: "assalam-mysql-preview.vercel.app" },
    crypto: { randomUUID: () => "request-id-12345678" }
  };
  const context = {
    window,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ ok: true, data: [] }) };
    },
    console
  };
  const source = fs.readFileSync(path.join(__dirname, "../js/tidb-api.js"), "utf8");
  vm.runInNewContext(source, context, { filename: "js/tidb-api.js" });
  return { api: window.assalamTiDBApi, calls };
}

test("operational GET adapters call the TiDB inventory and queue endpoints", async () => {
  const { api, calls } = loadAdapter();
  await api.listInventory();
  await api.listQueue();
  await api.listShifts();
  await api.getDisplayQueue();

  assert.deepEqual(calls.map(call => call.url), [
    "/api/inventory",
    "/api/queue",
    "/api/shifts",
    "/api/queue?display=1"
  ]);
  assert.ok(calls.every(call => call.init.method === "GET"));
});

test("operational command adapters send JSON and idempotency keys", async () => {
  const { api, calls } = loadAdapter();
  const payload = { action: "checkout", items: [{ medicineId: "med-1", quantity: "1" }] };
  await api.inventoryCommand({ action: "create_medicine" }, "inventory-key-123");
  await api.salesCommand(payload, "sales-key-123");
  await api.financeCommand({ action: "record_payment" }, "finance-key-123");
  await api.queueCommand({ action: "register" }, "queue-key-123");
  await api.openShift({ action: "open", openingFloat: "0" }, "shift-key-123");
  await api.assignQueueLane({ cashierUserId: "cashier-1", prefix: "A", validFrom: "2026-11-23" }, "lane-key-123");

  assert.deepEqual(calls.map(call => call.url), [
    "/api/inventory", "/api/sales", "/api/finance", "/api/queue", "/api/shifts", "/api/queue"
  ]);
  for (const call of calls) {
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.headers["Content-Type"], "application/json");
    assert.ok(call.init.headers["Idempotency-Key"]);
    assert.equal(call.init.credentials, "same-origin");
    assert.equal(call.init.cache, "no-store");
  }
});

test("adapter continues to reject endpoints outside its explicit allowlist", async () => {
  const { api } = loadAdapter();
  await assert.rejects(
    () => api.request("/api/admin/unlisted"),
    error => error && error.code === "TIDB_ENDPOINT_NOT_ALLOWED"
  );
});
