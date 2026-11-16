"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTidbInventoryRepository } = require("../lib/repositories/tidb-inventory-repository");

test("medicine creation writes a zero-stock projection without client-supplied stock or HPP", async () => {
  const calls = [];
  const connection = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith("INSERT INTO medicines")) return [{ insertId: 41, affectedRows: 1 }];
      if (sql.startsWith("INSERT INTO medicine_stock_projections")) return [{ affectedRows: 1 }];
      throw new Error("Unexpected SQL: " + sql);
    }
  };
  const repo = createTidbInventoryRepository();
  const result = await repo.createMedicine(connection, {
    name: "Paracetamol", canonicalUnit: "tablet", sellingPrice: "2000",
    minimumStock: "5", active: true, actorUserId: "owner-1"
  });
  assert.equal(result.medicineId, "41");
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /INSERT INTO medicines/);
  assert.match(calls[1].sql, /weighted_hpp, profit_calculation_status/);
  assert.equal(calls[1].params[0], 41);
});

test("medicine lock reads stock projection version and preserves unknown HPP as null", async () => {
  const connection = {
    async execute(sql) {
      assert.match(sql, /LEFT JOIN medicine_stock_projections/);
      return [[{
        medicineId: 8, stockQty: "12", hpp: null, unknownHppQuantity: "12",
        profitCalculationStatus: "uncalculated", version: "7", quantityScale: 0
      }]];
    }
  };
  const row = await createTidbInventoryRepository().lockMedicine(connection, "8");
  assert.equal(row.hpp, null);
  assert.equal(row.stockQty, "12");
  assert.equal(row.version, "7");
  assert.equal(row.unknownHppQuantity, "12");
});

test("batch with unknown expiry is quarantined and cannot be marked sellable", async () => {
  const calls = [];
  const connection = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith("SELECT pr.purchase_receipt_id")) return [[]];
      if (sql.startsWith("SELECT medicine_id AS medicineId")) return [[{ medicineId: 9, unitCost: "500" }]];
      if (sql.startsWith("INSERT INTO purchase_receipt_lines")) return [{ insertId: 51, affectedRows: 1 }];
      if (sql.startsWith("INSERT INTO inventory_batches")) return [{ insertId: 61, affectedRows: 1 }];
      throw new Error("Unexpected SQL: " + sql);
    }
  };
  const result = await createTidbInventoryRepository().createBatch(connection, {
    purchaseReceiptId: "31", sourcePurchaseLineId: "21", medicineId: "9",
    batchNo: "LOT-1", expiryDate: null, originVerified: true,
    receivedQty: "10", remainingQty: "10", purchaseValue: "5000",
    disposition: "quarantined"
  });
  assert.equal(result, "61");
  const batchInsert = calls.find(call => call.sql.startsWith("INSERT INTO inventory_batches"));
  assert.equal(batchInsert.params[3], null);
  assert.equal(batchInsert.params[4], 0);
  assert.equal(batchInsert.params[9], "quarantined");
});

test("stock-only update uses optimistic projection version and recalculates sellable batch total", async () => {
  let captured;
  const connection = {
    async execute(sql, params) {
      captured = { sql, params };
      return [{ affectedRows: 1 }];
    }
  };
  await createTidbInventoryRepository().updateMedicineStockOnly(connection, {
    medicineId: "9", stockQty: "6", expectedVersion: "3"
  });
  assert.match(captured.sql, /version = version \+ 1/);
  assert.match(captured.sql, /disposition = 'sellable'/);
  assert.equal(captured.params[3], "3");
});


test("batch with unverified origin is quarantined even when expiry date is present", async () => {
  let params;
  const connection = {
    async execute(sql, values) {
      if (sql.startsWith("SELECT pr.purchase_receipt_id")) return [[]];
      if (sql.startsWith("SELECT medicine_id AS medicineId")) return [[{ medicineId: 9, unitCost: "500" }]];
      if (sql.startsWith("INSERT INTO purchase_receipt_lines")) return [{ insertId: 52, affectedRows: 1 }];
      if (sql.startsWith("INSERT INTO inventory_batches")) { params = values; return [{ insertId: 62, affectedRows: 1 }]; }
      throw new Error("Unexpected SQL: " + sql);
    }
  };
  await createTidbInventoryRepository().createBatch(connection, {
    purchaseReceiptId: "32", sourcePurchaseLineId: "22", medicineId: "9",
    batchNo: "LOT-UNVERIFIED", expiryDate: "2027-12-31", originVerified: false,
    receivedQty: "5", remainingQty: "5", purchaseValue: "2500", disposition: "sellable"
  });
  assert.equal(params[4], 1, "expiry is verified");
  assert.equal(params[5], 0, "origin remains unverified");
  assert.equal(params[9], "quarantined", "unverified origin must never enter sellable stock");
});
