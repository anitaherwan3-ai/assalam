"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTidbInventoryRepository } = require("../lib/repositories/tidb-inventory-repository");

test("stocktake variance uses the captured batch version and writes a signed movement", async () => {
  const calls = [];
  const connection = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith("SELECT disposition")) return [[{
        disposition: "sellable", expiryVerified: 1, originVerified: 1,
        expiryDate: "2027-12-31", hpp: "500"
      }]];
      if (sql.startsWith("UPDATE inventory_batches")) return [{ affectedRows: 1 }];
      if (sql.startsWith("INSERT INTO inventory_movements")) return [{ insertId: 90 }];
      if (sql.startsWith("UPDATE medicine_stock_projections")) return [{ affectedRows: 1 }];
      throw new Error("Unexpected SQL: " + sql);
    }
  };
  await createTidbInventoryRepository().applyStocktakeVariance(connection, {
    stocktakeId: "12", actorUserId: "owner-1",
    line: {
      medicineId: "7", batchId: "8", systemQuantity: "10",
      countedQuantity: "12", varianceQuantity: "2",
      batchVersionSnapshot: "4", reason: "Selisih fisik"
    }
  });
  const update = calls.find(x => x.sql.startsWith("UPDATE inventory_batches"));
  assert.equal(update.params[3], "4");
  assert.equal(update.params[4], "10");
  const movement = calls.find(x => x.sql.startsWith("INSERT INTO inventory_movements"));
  assert.equal(movement.params[2], "stocktake_increase");
  assert.equal(movement.params[3], "in");
  assert.equal(movement.params[4], "2");
});

test("stocktake batch version conflict aborts before movement or projection update", async () => {
  let movementWritten = false;
  const connection = {
    async execute(sql) {
      if (sql.startsWith("SELECT disposition")) return [[{
        disposition: "sellable", expiryVerified: 1, originVerified: 1,
        expiryDate: "2027-12-31", hpp: "500"
      }]];
      if (sql.startsWith("UPDATE inventory_batches")) return [{ affectedRows: 0 }];
      if (sql.startsWith("INSERT INTO inventory_movements")) movementWritten = true;
      return [{ affectedRows: 1 }];
    }
  };
  await assert.rejects(createTidbInventoryRepository().applyStocktakeVariance(connection, {
    stocktakeId: "12", actorUserId: "owner-1",
    line: {
      medicineId: "7", batchId: "8", systemQuantity: "10",
      countedQuantity: "12", varianceQuantity: "2",
      batchVersionSnapshot: "4", reason: "Selisih fisik"
    }
  }), { code: "STOCKTAKE_BATCH_CHANGED" });
  assert.equal(movementWritten, false);
});

test("quarantine release requires approved inspection and only changes sellable projection", async () => {
  const calls = [];
  const connection = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith("SELECT q.quarantine_event_id")) return [[{ eventId: 33, inspectionDecision: "release", approverUserId: "owner-1", releasedAtUtc: null }]];
      if (sql.startsWith("SELECT medicine_id AS medicineId")) return [[{
        medicineId: 7, remainingQuantity: "2", disposition: "quarantined",
        expiryDate: "2027-12-31", expiryVerified: 1, originVerified: 1
      }]];
      return [{ affectedRows: 1 }];
    }
  };
  const result = await createTidbInventoryRepository().releaseQuarantineBatch(connection, {
    batchId: "8", actorUserId: "admin-1"
  });
  assert.equal(result.sellableQuantity, "2");
  assert.ok(calls.some(x => x.sql.startsWith("UPDATE inventory_batches SET disposition = 'sellable'")));
  assert.ok(calls.some(x => x.sql.startsWith("UPDATE inventory_quarantine_events SET released_by_user_id")));
  assert.ok(calls.some(x => x.sql.startsWith("UPDATE medicine_stock_projections SET sellable_quantity")));
  assert.equal(calls.some(x => x.sql.startsWith("INSERT INTO inventory_movements")), false);
});

test("supplier dispatch records a durable reference and pending supplier receivable when invoice is paid", async () => {
  const calls = [];
  const connection = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith("SELECT sr.supplier_return_id")) return [[{
        invoiceId: 3, quantity: "2", unitCost: "500", invoiceGross: "1000", paidAmount: "1000"
      }]];
      if (sql.startsWith("UPDATE supplier_returns")) return [{ affectedRows: 1 }];
      if (sql.startsWith("INSERT INTO supplier_credit_notes")) return [{ insertId: 55 }];
      throw new Error("Unexpected SQL: " + sql);
    }
  };
  await createTidbInventoryRepository().markSupplierReturnDispatched(connection, {
    supplierReturnId: "44", dispatchReference: "DO-44",
    actorUserId: "admin-1", settlementStatus: "pending"
  });
  const update = calls.find(x => x.sql.startsWith("UPDATE supplier_returns"));
  assert.equal(update.params[0], "DO-44");
  assert.equal(update.params[1], "admin-1");
  const credit = calls.find(x => x.sql.startsWith("INSERT INTO supplier_credit_notes"));
  assert.equal(credit.params[2], "1000");
  assert.equal(credit.params[3], "receivable");
  assert.equal(credit.params[4], "admin-1");
});

test("return quota component value uses proportional snapshot and preserves line rounding remainder", async () => {
  let sql = "";
  const connection = {
    async execute(query) {
      sql = query;
      return [[{
        quotaId: 1, invoiceLineId: 2, invoiceId: 3, batchId: 4, medicineId: 5,
        maximumQuantity: "1", reservedQuantity: "0", approvedQuantity: "0",
        originalQuantity: "3", componentNetCharge: "3334", priorRefundAmount: "0"
      }]];
    }
  };
  const quota = await createTidbInventoryRepository().lockReturnQuota(connection, "1");
  assert.match(sql, /MAX\(q3.return_quota_subject_id\)/);
  assert.match(sql, /l.net_charge - COALESCE/);
  assert.equal(quota.netCharge, "3334");
});
