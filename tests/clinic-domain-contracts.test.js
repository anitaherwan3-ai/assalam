"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const domain = require("../lib/clinic-domain-contracts");

test("quantity precision is explicit and decimal arithmetic is string-safe", () => {
  assert.equal(domain.parseScaledQuantity("1.25", 2).toString(), "125");
  assert.equal(domain.formatScaledQuantity(125n, 2), "1.25");
  assert.throws(() => domain.parseScaledQuantity("1.251", 2), { code: "QUANTITY_PRECISION_EXCEEDED" });
  assert.throws(() => domain.parseScaledQuantity(0.1, 2), { code: "UNSAFE_QUANTITY_NUMBER" });
  assert.throws(() => domain.parseScaledQuantity("1", undefined), { code: "INVALID_QUANTITY_SCALE" });
});

test("Rupiah arithmetic rejects fractions and unsafe JavaScript numbers", () => {
  assert.equal(domain.parseIntegerMoney("9007199254740993").toString(), "9007199254740993");
  assert.throws(() => domain.parseIntegerMoney("100.5"), { code: "INVALID_MONEY" });
  assert.throws(() => domain.parseIntegerMoney(Number.MAX_SAFE_INTEGER + 1), { code: "UNSAFE_MONEY_NUMBER" });
});

test("FEFO allocation orders by expiry, receipt time and stable batch ID", () => {
  const result = domain.allocateFefo({
    quantityScale: 0,
    businessDate: "2026-11-17",
    requestedQty: "5",
    batches: [
      { batchId: "later", expiryDate: "2027-12-01", receivedAtUtc: "2026-10-01T00:00:00Z", remainingQty: "5", disposition: "sellable" },
      { batchId: "expired", expiryDate: "2026-11-16", receivedAtUtc: "2025-01-01T00:00:00Z", remainingQty: "99", disposition: "sellable" },
      { batchId: "same-later-id", expiryDate: "2027-01-01", receivedAtUtc: "2026-10-01T00:00:00Z", remainingQty: "2", disposition: "sellable" },
      { batchId: "same-earlier-id", expiryDate: "2027-01-01", receivedAtUtc: "2026-10-01T00:00:00Z", remainingQty: "3", disposition: "sellable" }
    ]
  });
  assert.deepEqual(result.allocations, [
    { batchId: "same-earlier-id", qty: "3" },
    { batchId: "same-later-id", qty: "2" }
  ]);
  assert.equal(result.mutatedSource, false);
});

test("FEFO never allocates quarantined, inspection-pending or rejected returned medicine", () => {
  const result = domain.allocateFefo({
    quantityScale: 0, businessDate: "2026-11-17", requestedQty: "2",
    batches: [
      { batchId: "quarantine", expiryDate: "2027-01-01", receivedAtUtc: "2026-10-01T00:00:00Z", remainingQty: "20", disposition: "quarantined" },
      { batchId: "inspection", expiryDate: "2027-02-01", receivedAtUtc: "2026-10-02T00:00:00Z", remainingQty: "20", disposition: "inspection_pending" },
      { batchId: "rejected", expiryDate: "2027-03-01", receivedAtUtc: "2026-10-03T00:00:00Z", remainingQty: "20", disposition: "rejected" },
      { batchId: "sellable", expiryDate: "2027-04-01", receivedAtUtc: "2026-10-04T00:00:00Z", remainingQty: "2", disposition: "sellable" }
    ]
  });
  assert.deepEqual(result.allocations, [{ batchId: "sellable", qty: "2" }]);
});

test("FEFO shortage rejects the whole plan without returning partial allocations", () => {
  assert.throws(() => domain.allocateFefo({
    quantityScale: 0,
    businessDate: "2026-11-17",
    requestedQty: "3",
    batches: [
      { batchId: "available", expiryDate: "2027-01-01", receivedAtUtc: "2026-10-01T00:00:00Z", remainingQty: "2", disposition: "sellable" },
      { batchId: "expired", expiryDate: "2026-11-16", receivedAtUtc: "2025-01-01T00:00:00Z", remainingQty: "100", disposition: "sellable" }
    ]
  }), { code: "INSUFFICIENT_SELLABLE_STOCK" });
});

test("weighted-average HPP reproduces the legacy result using exact Rupiah arithmetic", () => {
  assert.equal(domain.calculateWeightedAverageHpp({
    oldStockQty: "10",
    oldHpp: "100",
    receivedQty: "10",
    purchaseTotal: "3000",
    quantityScale: 0
  }), "200");
});

test("weighted-average HPP handles an explicit fractional quantity scale without floating point", () => {
  assert.equal(domain.calculateWeightedAverageHpp({
    oldStockQty: "1.5",
    oldHpp: "1000",
    receivedQty: "0.5",
    purchaseTotal: "1000",
    quantityScale: 1
  }), "1250");
});

test("supplier return rejects quantities above original purchase or source batch balance", () => {
  const purchase = {
    purchasedQty: "10",
    returnedQty: "2",
    originalBatchAllocations: [{ batchId: "batch-a", qtyReceived: "10" }]
  };
  const batch = { batchId: "batch-a", remainingQty: "3" };
  assert.throws(() => domain.validateSupplierReturn({
    purchase, batch, requestedQty: "9", quantityScale: 0
  }), { code: "SUPPLIER_RETURN_EXCEEDS_PURCHASE" });
  assert.throws(() => domain.validateSupplierReturn({
    purchase, batch, requestedQty: "4", quantityScale: 0
  }), { code: "SUPPLIER_RETURN_EXCEEDS_BATCH" });
  assert.throws(() => domain.validateSupplierReturn({
    purchase, batch: { batchId: "other-batch", remainingQty: "9" },
    requestedQty: "1", quantityScale: 0
  }), { code: "SUPPLIER_RETURN_BATCH_MISMATCH" });
});

test("valid supplier return is linked to its purchase batch and leaves finance settlement unresolved", () => {
  const result = domain.validateSupplierReturn({
    purchase: {
      purchasedQty: "10",
      returnedQty: "2",
      originalBatchAllocations: [{ batchId: "batch-a", qtyReceived: "10" }]
    },
    batch: { batchId: "batch-a", remainingQty: "5" },
    requestedQty: "2",
    quantityScale: 0
  });
  assert.equal(result.purchaseRemainingAfter, "6");
  assert.equal(result.batchRemainingAfter, "3");
  assert.equal(result.historicalInvoiceTotalChanged, false);
  assert.equal(result.supplierSettlementPolicy, "OWNER_DECISION_REQUIRED");
});

test("invoice checkout rejects missing or mismatched patient, encounter, cashier and shift links", () => {
  const valid = {
    invoice: { encounterId: "enc-1", patientId: "pat-1", cashierId: "cash-1", shiftId: "shift-1" },
    encounter: { id: "enc-1", patientId: "pat-1", cashierId: "cash-1", shiftId: "shift-1" },
    shift: { id: "shift-1", cashierId: "cash-1", status: "open" }
  };
  assert.equal(domain.assertInvoiceEncounterOwnership(valid), true);
  assert.throws(() => domain.assertInvoiceEncounterOwnership({
    ...valid, invoice: { ...valid.invoice, patientId: "other-patient" }
  }), { code: "CHECKOUT_OWNERSHIP_MISMATCH" });
  assert.throws(() => domain.assertInvoiceEncounterOwnership({
    ...valid, shift: { ...valid.shift, status: "closed" }
  }), { code: "CHECKOUT_SHIFT_NOT_OPEN" });
});

test("queue key separates date and caller-selected prefix without assuming A/B meanings", () => {
  assert.equal(domain.queueSequenceKey({
    businessDate: "2026-11-17", prefix: "A", sequence: 1
  }), "2026-11-17:A:1");
  assert.notEqual(
    domain.queueSequenceKey({ businessDate: "2026-11-17", prefix: "A", sequence: 1 }),
    domain.queueSequenceKey({ businessDate: "2026-11-17", prefix: "B", sequence: 1 })
  );
  assert.throws(() => domain.queueSequenceKey({
    businessDate: "2026-11-17", prefix: "A", sequence: 0
  }), { code: "INVALID_QUEUE_SEQUENCE" });
});

test("revenue bridge books approved returns by approval date and refunds by payout date", () => {
  const result = domain.calculateRevenueBridge({
    from: "2026-11-17",
    to: "2026-11-17",
    invoices: [
      { businessDate: "2026-11-17", total: "100000" },
      { businessDate: "2026-11-16", total: "90000" },
      { businessDate: "2026-11-17", total: "50000", cancelled: true }
    ],
    returns: [
      { status: "approved", approvedBusinessDate: "2026-11-17", total: "10000", refundStatus: "pending", refundAmount: "10000" },
      { status: "approved", approvedBusinessDate: "2026-11-17", total: "5000", refundStatus: "paid", refundAmount: "5000", refundPaidBusinessDate: "2026-11-16" },
      { status: "approved", approvedBusinessDate: "2026-11-17", total: "2000", refundStatus: "paid", refundAmount: "2000", refundPaidBusinessDate: "2026-11-17" }
    ],
    openingShiftFloats: "100000"
  });
  assert.equal(result.grossRevenue, "100000");
  assert.equal(result.approvedReturnValue, "17000");
  assert.equal(result.netRevenue, "83000");
  assert.equal(result.refundPaid, "2000");
  assert.equal(result.refundPending, "10000");
  assert.equal(result.openingShiftFloats, "100000");
  assert.equal(result.openingShiftFloatIncludedInRevenue, false);
});

test("business-date and timestamp validators reject malformed values", () => {
  assert.throws(() => domain.allocateFefo({
    quantityScale: 0, businessDate: "2026-02-30", requestedQty: "1", batches: []
  }), { code: "INVALID_BUSINESS_DATE" });
});
