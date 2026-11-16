"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../lib/clinic-domain-model");

test("medicine master requires explicit unit precision and blocks direct stock/HPP edits", () => {
  const valid = model.validateMedicineMaster({
    name: "Amoxicillin", canonicalUnit: "tablet", quantityScale: 0,
    minimumStock: "2", sellingPrice: "15000"
  });
  assert.equal(valid.canonicalUnit, "tablet");
  assert.equal(valid.quantityScale, 0);
  assert.throws(() => model.validateMedicineMaster({
    name: "X", canonicalUnit: "tablet", quantityScale: 0,
    minimumStock: "0", sellingPrice: "1000", stockQty: "20"
  }), { code: "MEDICINE_PROJECTION_WRITE_BLOCKED" });
  assert.throws(() => model.validateMedicineMaster({
    name: "X", canonicalUnit: "strip", quantityScale: 0,
    minimumStock: "0", sellingPrice: "1000"
  }), { code: "MEDICINE_UNIT_NOT_APPROVED" });
  assert.throws(() => model.validateMedicineMaster({
    name: "X", canonicalUnit: "tablet", quantityScale: 1,
    minimumStock: "0", sellingPrice: "1000"
  }), { code: "MEDICINE_WHOLE_UNIT_REQUIRED" });
  assert.throws(() => model.validateMedicineMaster({
    name: "X", canonicalUnit: "tablet",
    minimumStock: "0", sellingPrice: "1000"
  }), { code: "INVALID_QUANTITY_SCALE" });
  for (const unit of ["tablet", "kapsul", "botol", "pcs"]) {
    assert.equal(model.validateMedicineMaster({
      name: "Uji", canonicalUnit: unit, quantityScale: 0,
      minimumStock: "0", sellingPrice: "1000"
    }).canonicalUnit, unit);
  }
});

test("batch requires source purchase, explicit disposition and bounded quantities", () => {
  const valid = model.validateBatch({
    medicineId: "med-1", sourcePurchaseLineId: "line-1",
    batchNo: "AMX-001", expiryDate: "2027-06-30",
    receivedAtUtc: "2026-11-17T00:00:00Z",
    receivedQty: "10", remainingQty: "8", disposition: "sellable"
  }, 0);
  assert.equal(valid.receivedQty, "10");
  assert.equal(valid.originVerified, false, "missing source verification must not be trusted");
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
  const verified = model.validateBatch({
    medicineId: "med-1", sourcePurchaseLineId: "line-1", batchNo: "AMX-002",
    expiryDate: "2027-06-30", receivedAtUtc: "2026-11-17T00:00:00Z",
    receivedQty: "10", remainingQty: "10", disposition: "sellable", originVerified: true
  }, 0);
  assert.equal(verified.originVerified, true);
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


test("finance reconciliation separates revenue, refunds, supplier payables, cash and journals", () => {
  const report = model.reconcileFinance({
    invoices: [
      { id: "i1", total: "100000", status: "posted" },
      { id: "i2", total: "50000", status: "cancelled" }
    ],
    approvedReturns: [{ id: "r1", status: "approved", amount: "10000" }],
    refundObligations: [{ id: "ro1", approvedAmount: "10000" }],
    refundPayouts: [{ obligationId: "ro1", amount: "4000" }],
    supplierPayables: [{ id: "sp1", originalAmount: "30000", recognizedCreditAmount: "5000" }],
    supplierPaymentAllocations: [{ payableId: "sp1", amount: "10000" }],
    cashAccounts: [{ id: "cash-1", openingBalance: "20000", countedBalance: "27000" }],
    cashEntries: [
      { accountId: "cash-1", direction: "in", amount: "10000" },
      { accountId: "cash-1", direction: "out", amount: "3000" }
    ],
    journals: [{
      id: "j1",
      lines: [
        { side: "debit", amount: "7000" },
        { side: "credit", amount: "7000" }
      ]
    }]
  });
  assert.deepEqual(report.revenue, { gross: "100000", approvedReturns: "10000", net: "90000" });
  assert.equal(report.refunds.outstanding, "6000");
  assert.equal(report.supplierPayables.outstanding, "15000");
  assert.equal(report.cashAccounts[0].expectedBalance, "27000");
  assert.equal(report.cashAccounts[0].variance, "0");
  assert.equal(report.allJournalsBalanced, true);
});

test("finance reconciliation rejects refund overpayment and payable over-settlement", () => {
  const base = {
    invoices: [], approvedReturns: [], refundObligations: [], refundPayouts: [],
    supplierPayables: [], supplierPaymentAllocations: [], cashAccounts: [], cashEntries: [], journals: []
  };
  assert.throws(() => model.reconcileFinance({
    ...base,
    refundObligations: [{ id: "ro1", approvedAmount: "100" }],
    refundPayouts: [{ obligationId: "ro1", amount: "101" }]
  }), { code: "REFUND_PAYOUT_EXCEEDS_OBLIGATION" });
  assert.throws(() => model.reconcileFinance({
    ...base,
    supplierPayables: [{ id: "sp1", originalAmount: "100", recognizedCreditAmount: "50" }],
    supplierPaymentAllocations: [{ payableId: "sp1", amount: "51" }]
  }), { code: "SUPPLIER_PAYABLE_OVER_SETTLED" });
});

test("inventory reconciliation rejects inconsistent medicine-specific quantity scales", () => {
  assert.throws(() => model.reconcileInventory({
    medicines: [{ id: "med-1", quantityScale: 0, stockQty: "5" }],
    batches: [{ medicineId: "med-1", quantityScale: 1, remainingQty: "5.0" }],
    movements: []
  }), { code: "RECONCILIATION_SCALE_MISMATCH" });
});
