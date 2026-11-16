"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTidbInventoryRepository } = require("../lib/repositories/tidb-inventory-repository");

test("checkout snapshot derives prices from TiDB masters and applies only per-service-line discounts", async () => {
  const calls = [];
  const connection = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("FROM medicines m")) return [[{
        medicineId: 11, name: "Paracetamol", unit: "tablet", price: "1500",
        hpp: null, profitStatus: "uncalculated"
      }]];
      if (sql.includes("FROM tariffs")) return [[{
        tariffId: 4, name: "Konsultasi", price: "5000", serviceType: "service"
      }]];
      throw new Error("Unexpected SQL: " + sql);
    }
  };
  const snapshot = await createTidbInventoryRepository().buildAuthoritativeCheckoutSnapshot(connection, {
    requestedItems: [
      { medicineId: "11", quantity: "2", price: "1" },
      { tariffId: "4", quantity: "1", discount: "500", price: "1" }
    ]
  });
  assert.equal(snapshot.invoice.grossAmount, "8000");
  assert.equal(snapshot.invoice.discountAmount, "500");
  assert.equal(snapshot.invoice.total, "7500");
  assert.deepEqual(snapshot.inventoryRequirements, [{ medicineId: "11", quantity: "2" }]);
  assert.equal(snapshot.lines[0].grossUnitPrice, "1500");
  assert.equal(snapshot.lines[0].hpp, null);
  assert.equal(snapshot.lines[0].profitCalculationStatus, "uncalculated");
  assert.equal(snapshot.lines[1].discount, "500");
  assert.ok(calls.every(call => !call.params.includes("1")), "client-supplied prices must never be used");
});

test("checkout rejects duplicate medicine rows and service discounts above the line value", async () => {
  const connection = {
    async execute(sql) {
      if (sql.includes("FROM medicines m")) return [[{ medicineId: 11, name: "Paracetamol", unit: "tablet", price: "1500", hpp: "500", profitStatus: "calculated" }]];
      if (sql.includes("FROM tariffs")) return [[{ tariffId: 4, name: "Konsultasi", price: "5000", serviceType: "service" }]];
      throw new Error("Unexpected SQL: " + sql);
    }
  };
  const repo = createTidbInventoryRepository();
  await assert.rejects(repo.buildAuthoritativeCheckoutSnapshot(connection, {
    requestedItems: [{ medicineId: "11", quantity: "1" }, { medicineId: "11", quantity: "2" }]
  }), { code: "CHECKOUT_DUPLICATE_MEDICINE_LINE" });
  await assert.rejects(repo.buildAuthoritativeCheckoutSnapshot(connection, {
    requestedItems: [{ tariffId: "4", quantity: "1", discount: "5001" }]
  }), { code: "SERVICE_DISCOUNT_INVALID" });
});

test("FEFO batch query excludes quarantine, unknown origin/expiry and expired stock", async () => {
  let query = "";
  const connection = {
    async execute(sql) { query = sql; return [[{ batchId: 2, remainingQty: "3", version: "8" }]]; }
  };
  const rows = await createTidbInventoryRepository().lockEligibleBatches(connection, "11");
  assert.equal(rows[0].batchId, "2");
  assert.match(query, /disposition = 'sellable'/);
  assert.match(query, /expiry_verified = 1 AND origin_verified = 1/);
  assert.match(query, /ORDER BY expiry_date, received_at_utc, batch_id FOR UPDATE/);
});

test("invoice posting preserves gross and line discounts recorded at draft time", async () => {
  let captured;
  const connection = {
    async execute(sql, params) { captured = { sql, params }; return [{ affectedRows: 1 }]; }
  };
  await createTidbInventoryRepository().postInvoice(connection, "99", { total: "7500", lineCount: 2 });
  assert.match(captured.sql, /SET status = 'posted', net_amount = \?/);
  assert.doesNotMatch(captured.sql, /gross_amount =|discount_amount =/);
  assert.deepEqual(captured.params, ["7500", "99"]);
});
