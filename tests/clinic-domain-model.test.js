"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../lib/clinic-domain-model");

test("medicine master requires explicit unit precision and blocks direct stock/HPP edits", () => {
  const valid = model.validateMedicineMaster({
    name: "Amoxicillin", canonicalUnit: "strip", quantityScale: 0,
    minimumStock: "2", sellingPrice: "15000"
  });
  assert.equal(valid.canonicalUnit, "strip");
  assert.equal(valid.quantityScale, 0);
  assert.throws(() => model.validateMedicineMaster({
    name: "X", canonicalUnit: "tablet", quantityScale: 0,
    minimumStock: "0", sellingPrice: "1000", stockQty: "20"
  }), { code: "MEDICINE_PROJECTION_WRITE_BLOCKED" });
  assert.throws(() => model.validateMedicineMaster({
    name: "X", canonicalUnit: "tablet",
    minimumStock: "0", sellingPrice: "1000"
  }), { code: "INVALID_QUANTITY_SCALE" });
});

test("batch requires source purchase, explicit disposition and bounded quantities", () => {
  const valid = model.validateBatch({
    medicineId: "med-1", sourcePurchaseLineId: "line-1",
    batchNo: "AMX-001", expiryDate: "2027-06-30",
    receivedAtUtc: "2026-11-17T00:00:00Z",
    receivedQty: "10", remainingQty: "8", disposition: "sellable"
  }, 0);
  assert.equal(valid.receivedQty, "10");
  assert.throws(() => model.validateBatch({
    medicineId: "med-1", sourcePurchaseLineId: "line-1",
    batchNo: "AMX-001", expiryDate: "2027-06-30",
    receivedAtUtc: "2026-11-17T00:00:00Z",
    receivedQty: "10", remainingQty: "11", disposition: "sellable"
  }, 0), { code: "BATCH_QUANTITY_INVALID" });
  assert.throws(() => model.validateBatch({
    medicineId: "med-1", sourcePurchaseLineId: "line-1",
    batchNo: "AMX-001", expiryDate: "2027-06-30",
    receivedAtUtc: "2026-11-17T00:00:00Z",
    receivedQty: "10", remainingQty: "10"
  }, 0), { code: "BATCH_DISPOSITION_REQUIRED" });
});

test("movement ledger requires signed direction, exact source and actor", () => {
  const movement = model.validateInventoryMovement({
    movementType: "sale_issue", direction: "out",
    quantity: "2", medicineId: "med-1", batchId: "batch-1",
    sourceType: "invoice", sourceId: "trx-1", actorUserId: "kasir-1",
    reason: "Penjualan", occurredAtUtc: "2026-11-17T01:00:00Z"
  }, 0);
  assert.equal(movement.direction, "out");
  assert.throws(() => model.validateInventoryMovement({
    movementType: "sale_issue", direction: "in",
    quantity: "2", medicineId: "med-1", batchId: "batch-1",
    sourceType: "invoice", sourceId: "trx-1", actorUserId: "kasir-1",
    reason: "Wrong direction", occurredAtUtc: "2026-11-17T01:00:00Z"
  }, 0), { code: "MOVEMENT_DIRECTION_MISMATCH" });
});

test("purchase receipt requires exact supplier line and positive integer Rupiah value", () => {
  const result = model.validatePurchaseReceipt({
    purchaseLineId: "line-1", medicineId: "med-1", supplierId: "sup-1",
    receivedQty: "3", purchaseValue: "45000", receiptReference: "GRN-1",
    batch: {
      batchNo: "B-1", expiryDate: "2027-10-01",
      receivedAtUtc: "2026-11-17T00:00:00Z", disposition: "inspection_pending"
    }
  }, 0);
  assert.equal(result.purchaseValue, "45000");
  assert.equal(result.batch.sourcePurchaseLineId, "line-1");
  assert.throws(() => model.validatePurchaseReceipt({
    purchaseLineId: "line-1", medicineId: "med-1", supplierId: "sup-1",
    receivedQty: "3", purchaseValue: "45000.5", receiptReference: "GRN-1",
    batch: {
      batchNo: "B-1", expiryDate: "2027-10-01",
      receivedAtUtc: "2026-11-17T00:00:00Z", disposition: "sellable"
    }
  }, 0), { code: "INVALID_MONEY" });
});

test("patient model allows new visit identity without fuzzy identity merging", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(model.validatePatient({ fullName: "Pasien Baru", phone: "" }))),
    { fullName: "Pasien Baru", phone: null }
  );
  assert.throws(() => model.validatePatient({ fullName: " " }), { code: "DOMAIN_TEXT_INVALID" });
});

test("queue call model fails closed until active-call policy is explicitly approved", () => {
  assert.throws(() => model.validateQueueCallEvent({
    ticketId: "ticket-1", laneCode: "A", eventType: "call", requestId: "req-1"
  }), { code: "QUEUE_ACTIVE_CALL_POLICY_REQUIRED" });
  const valid = model.validateQueueCallEvent({
    ticketId: "ticket-1", laneCode: "A", eventType: "call",
    activeCallPolicy: "per_lane", requestId: "req-1"
  });
  assert.equal(valid.activeCallPolicy, "per_lane");
});

test("journal validator rejects imbalance and uses exact integer Rupiah totals", () => {
  const journal = model.validateBalancedJournal({
    sourceType: "cash_payment", sourceId: "pay-1",
    businessDate: "2026-11-17", description: "Penerimaan tunai",
    lines: [
      { accountId: "cash", side: "debit", amount: "100000" },
      { accountId: "revenue", side: "credit", amount: "100000" }
    ]
  });
  assert.equal(journal.totalDebit, "100000");
  assert.equal(journal.totalCredit, "100000");
  assert.throws(() => model.validateBalancedJournal({
    sourceType: "cash_payment", sourceId: "pay-2",
    businessDate: "2026-11-17", description: "Tidak seimbang",
    lines: [
      { accountId: "cash", side: "debit", amount: "100000" },
      { accountId: "revenue", side: "credit", amount: "90000" }
    ]
  }), { code: "JOURNAL_UNBALANCED" });
});

test("reconciliation reports stock-to-batch and stock-to-movement variance", () => {
  const report = model.reconcileInventory({
    medicines: [{ id: "med-1", quantityScale: 0, stockQty: "8" }],
    batches: [
      { medicineId: "med-1", quantityScale: 0, remainingQty: "3" },
      { medicineId: "med-1", quantityScale: 0, remainingQty: "5" }
    ],
    movements: [
      { medicineId: "med-1", quantityScale: 0, direction: "in", quantity: "10" },
      { medicineId: "med-1", quantityScale: 0, direction: "out", quantity: "2" }
    ]
  });
  assert.equal(report[0].balancedToBatches, true);
  assert.equal(report[0].balancedToMovementNet, true);
});
