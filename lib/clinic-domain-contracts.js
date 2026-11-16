"use strict";

// Deterministic, policy-neutral domain primitives for the TiDB migration.
// These helpers deliberately require quantity precision and business dates
// from the caller; they do not decide clinic-specific unit or A/B lane policy.

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireScale(scale) {
  if (!Number.isInteger(scale) || scale < 0 || scale > 6) {
    throw fail("INVALID_QUANTITY_SCALE", "Presisi kuantitas harus ditentukan secara eksplisit (0–6).");
  }
  return 10n ** BigInt(scale);
}

function parseScaledQuantity(value, scale, field = "quantity") {
  const factor = requireScale(scale);
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw fail("UNSAFE_QUANTITY_NUMBER", field + " harus dikirim sebagai string desimal atau integer aman.");
  }
  if (!["string", "number", "bigint"].includes(typeof value)) {
    throw fail("INVALID_QUANTITY", field + " harus berupa string desimal atau integer.");
  }
  const raw = String(value).trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(raw);
  if (!match) throw fail("INVALID_QUANTITY", field + " harus berupa kuantitas non-negatif.");
  const fraction = match[2] || "";
  if (fraction.length > scale) {
    throw fail("QUANTITY_PRECISION_EXCEEDED", field + " melebihi presisi yang diberikan.");
  }
  const padded = (fraction + "0".repeat(scale)).slice(0, scale);
  return BigInt(match[1]) * factor + (padded ? BigInt(padded) : 0n);
}

function formatScaledQuantity(value, scale) {
  const factor = requireScale(scale);
  const amount = typeof value === "bigint" ? value : BigInt(value);
  if (amount < 0n) throw fail("INVALID_QUANTITY", "Kuantitas tidak boleh negatif.");
  const whole = amount / factor;
  if (scale === 0) return whole.toString();
  const fraction = (amount % factor).toString().padStart(scale, "0").replace(/0+$/, "");
  return fraction ? whole.toString() + "." + fraction : whole.toString();
}

function parseIntegerMoney(value, field = "amount", allowZero = true) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw fail("UNSAFE_MONEY_NUMBER", field + " harus dikirim sebagai string Rupiah integer.");
  }
  if (!["string", "number", "bigint"].includes(typeof value)) {
    throw fail("INVALID_MONEY", field + " harus berupa integer Rupiah.");
  }
  const raw = String(value).trim();
  if (!/^(0|[1-9]\d*)$/.test(raw)) {
    throw fail("INVALID_MONEY", field + " harus berupa integer Rupiah non-negatif.");
  }
  const amount = BigInt(raw);
  if (!allowZero && amount === 0n) {
    throw fail("INVALID_MONEY", field + " harus lebih besar dari nol.");
  }
  return amount;
}

function requireBusinessDate(value, field = "businessDate") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw fail("INVALID_BUSINESS_DATE", field + " harus berformat YYYY-MM-DD.");
  }
  const parsed = new Date(value + "T00:00:00.000Z");
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw fail("INVALID_BUSINESS_DATE", field + " bukan tanggal kalender yang valid.");
  }
  return value;
}

function requireTimestamp(value, field) {
  const timestamp = typeof value === "number" ? value : Date.parse(String(value));
  if (!Number.isFinite(timestamp)) {
    throw fail("INVALID_TIMESTAMP", field + " harus berisi timestamp yang valid.");
  }
  return timestamp;
}

/**
 * Produces a non-mutating FEFO allocation plan. The caller supplies the
 * medicine-specific quantity scale and Asia/Jakarta business date.
 * Sorting is deterministic: expiry, receipt timestamp, then batch ID.
 */
function allocateFefo({ batches, requestedQty, quantityScale, businessDate }) {
  const factor = requireScale(quantityScale);
  const asOf = requireBusinessDate(businessDate);
  const requested = parseScaledQuantity(requestedQty, quantityScale, "requestedQty");
  if (requested <= 0n) throw fail("INVALID_REQUESTED_QTY", "Qty permintaan harus lebih besar dari nol.");
  if (!Array.isArray(batches)) throw fail("INVALID_BATCH_LIST", "Daftar batch tidak valid.");

  const seen = new Set();
  const eligible = [];
  for (const batch of batches) {
    if (!batch || typeof batch.batchId !== "string" || !batch.batchId.trim()) {
      throw fail("INVALID_BATCH_ID", "Setiap batch harus memiliki ID yang stabil.");
    }
    if (seen.has(batch.batchId)) throw fail("DUPLICATE_BATCH_ID", "ID batch ganda ditemukan.");
    seen.add(batch.batchId);
    const expiryDate = requireBusinessDate(batch.expiryDate, "expiryDate");
    const remaining = parseScaledQuantity(batch.remainingQty, quantityScale, "remainingQty");
    if (remaining === 0n || expiryDate < asOf) continue;
    eligible.push({
      batchId: batch.batchId,
      expiryDate,
      receivedAt: requireTimestamp(batch.receivedAtUtc, "receivedAtUtc"),
      remaining
    });
  }

  eligible.sort((a, b) =>
    a.expiryDate.localeCompare(b.expiryDate) ||
    a.receivedAt - b.receivedAt ||
    a.batchId.localeCompare(b.batchId)
  );

  const available = eligible.reduce((sum, item) => sum + item.remaining, 0n);
  if (available < requested) {
    throw fail("INSUFFICIENT_SELLABLE_STOCK", "Stok batch layak jual tidak mencukupi; tidak ada alokasi parsial dibuat.");
  }

  let outstanding = requested;
  const allocations = [];
  for (const batch of eligible) {
    if (outstanding === 0n) break;
    const take = batch.remaining < outstanding ? batch.remaining : outstanding;
    allocations.push({ batchId: batch.batchId, qty: formatScaledQuantity(take, quantityScale) });
    outstanding -= take;
  }

  return {
    requestedQty: formatScaledQuantity(requested, quantityScale),
    allocations,
    totalAllocatedQty: formatScaledQuantity(requested - outstanding, quantityScale),
    mutatedSource: false
  };
}

/**
 * Legacy-compatible weighted moving-average HPP, calculated without
 * JavaScript floating-point money arithmetic. Quantity precision is explicit.
 */
function calculateWeightedAverageHpp({
  oldStockQty,
  oldHpp,
  receivedQty,
  purchaseTotal,
  quantityScale
}) {
  const factor = requireScale(quantityScale);
  const oldQty = parseScaledQuantity(oldStockQty, quantityScale, "oldStockQty");
  const incomingQty = parseScaledQuantity(receivedQty, quantityScale, "receivedQty");
  const hpp = parseIntegerMoney(oldHpp, "oldHpp");
  const total = parseIntegerMoney(purchaseTotal, "purchaseTotal", false);
  if (incomingQty === 0n) throw fail("INVALID_RECEIPT_QTY", "Qty penerimaan harus lebih besar dari nol.");

  const denominator = oldQty + incomingQty;
  const numerator = oldQty * hpp + total * factor;
  const weightedHpp = (numerator + denominator / 2n) / denominator;
  return weightedHpp.toString();
}

/**
 * Validates that a supplier return points to a batch originating from the
 * purchase and stays within both remaining purchase quantity and physical
 * batch balance. Settlement treatment is intentionally not inferred here.
 */
function validateSupplierReturn({
  purchase,
  batch,
  requestedQty,
  quantityScale
}) {
  const purchased = parseScaledQuantity(purchase && purchase.purchasedQty, quantityScale, "purchasedQty");
  const alreadyReturned = parseScaledQuantity(purchase && purchase.returnedQty || "0", quantityScale, "returnedQty");
  const requested = parseScaledQuantity(requestedQty, quantityScale, "requestedQty");
  const batchRemaining = parseScaledQuantity(batch && batch.remainingQty, quantityScale, "batch.remainingQty");
  const factor = requireScale(quantityScale);

  if (requested === 0n) throw fail("INVALID_RETURN_QTY", "Qty retur supplier harus lebih besar dari nol.");
  if (!batch || typeof batch.batchId !== "string" || !batch.batchId) {
    throw fail("INVALID_BATCH_ID", "Batch sumber retur tidak ditemukan.");
  }
  const allocations = purchase && purchase.originalBatchAllocations;
  if (!Array.isArray(allocations) || !allocations.some(x => x && x.batchId === batch.batchId)) {
    throw fail("SUPPLIER_RETURN_BATCH_MISMATCH", "Batch bukan bagian dari penerimaan pembelian asal.");
  }
  if (alreadyReturned > purchased) {
    throw fail("PURCHASE_RETURN_LEDGER_INVALID", "Qty retur sebelumnya melebihi qty pembelian.");
  }
  const purchaseRemaining = purchased - alreadyReturned;
  if (requested > purchaseRemaining) {
    throw fail("SUPPLIER_RETURN_EXCEEDS_PURCHASE", "Qty retur melebihi sisa qty pembelian.");
  }
  if (requested > batchRemaining) {
    throw fail("SUPPLIER_RETURN_EXCEEDS_BATCH", "Qty retur melebihi sisa fisik batch.");
  }

  return {
    batchId: batch.batchId,
    requestedQty: formatScaledQuantity(requested, quantityScale),
    purchaseRemainingAfter: formatScaledQuantity(purchaseRemaining - requested, quantityScale),
    batchRemainingAfter: formatScaledQuantity(batchRemaining - requested, quantityScale),
    historicalInvoiceTotalChanged: false,
    supplierSettlementPolicy: "OWNER_DECISION_REQUIRED"
  };
}

/**
 * Prevents an invoice from being posted against the wrong/missing encounter,
 * patient, cashier or shift. Call from the server-side checkout transaction.
 */
function assertInvoiceEncounterOwnership({ invoice, encounter, shift }) {
  const required = [
    ["invoice.encounterId", invoice && invoice.encounterId],
    ["invoice.patientId", invoice && invoice.patientId],
    ["invoice.cashierId", invoice && invoice.cashierId],
    ["invoice.shiftId", invoice && invoice.shiftId],
    ["encounter.id", encounter && encounter.id],
    ["encounter.patientId", encounter && encounter.patientId],
    ["encounter.cashierId", encounter && encounter.cashierId],
    ["encounter.shiftId", encounter && encounter.shiftId],
    ["shift.id", shift && shift.id],
    ["shift.cashierId", shift && shift.cashierId],
    ["shift.status", shift && shift.status]
  ];
  for (const [field, value] of required) {
    if (value === null || value === undefined || value === "") {
      throw fail("CHECKOUT_LINK_MISSING", field + " wajib tersedia.");
    }
  }
  if (invoice.encounterId !== encounter.id ||
      invoice.patientId !== encounter.patientId ||
      invoice.cashierId !== encounter.cashierId ||
      invoice.shiftId !== encounter.shiftId ||
      shift.id !== encounter.shiftId ||
      shift.cashierId !== encounter.cashierId) {
    throw fail("CHECKOUT_OWNERSHIP_MISMATCH", "Nota, kunjungan, kasir dan shift tidak memiliki hubungan yang konsisten.");
  }
  if (!["open", "buka"].includes(shift.status)) {
    throw fail("CHECKOUT_SHIFT_NOT_OPEN", "Transaksi hanya dapat diposting pada shift yang masih terbuka.");
  }
  return true;
}

/**
 * Queue key includes the caller-supplied lane/prefix but does not define what
 * A/B mean. Database uniqueness and idempotency must still be enforced inside
 * the transaction; this helper only canonicalizes the subject key.
 */
function queueSequenceKey({ businessDate, prefix, sequence }) {
  const date = requireBusinessDate(businessDate);
  if (typeof prefix !== "string" || !/^[A-Z0-9]{1,8}$/.test(prefix)) {
    throw fail("INVALID_QUEUE_PREFIX", "Prefix antrean harus eksplisit dan valid.");
  }
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw fail("INVALID_QUEUE_SEQUENCE", "Nomor urut antrean harus integer positif.");
  }
  return date + ":" + prefix + ":" + String(sequence);
}

/**
 * Compatibility bridge for period reporting. Revenue follows invoice date and
 * approved-return date; cash refund follows actual payout date. Opening float
 * is reported separately and never included in omzet or operating profit.
 */
function calculateRevenueBridge({ invoices, returns, openingShiftFloats = "0", from, to }) {
  const start = requireBusinessDate(from, "from");
  const end = requireBusinessDate(to, "to");
  if (start > end) throw fail("INVALID_REPORT_PERIOD", "Tanggal awal laporan melewati tanggal akhir.");
  if (!Array.isArray(invoices) || !Array.isArray(returns)) {
    throw fail("INVALID_REPORT_INPUT", "Data invoice dan retur harus berupa daftar.");
  }
  const within = date => typeof date === "string" && date >= start && date <= end;
  const activeInvoices = invoices.filter(item =>
    item && item.cancelled !== true && item.status !== "cancelled" && within(item.businessDate)
  );
  const approvedReturns = returns.filter(item =>
    item && item.status === "approved" && within(item.approvedBusinessDate)
  );
  const paidRefunds = approvedReturns.filter(item =>
    item.refundStatus === "paid" && within(item.refundPaidBusinessDate)
  );
  const pendingRefunds = approvedReturns.filter(item => item.refundStatus === "pending");

  const grossRevenue = activeInvoices.reduce((sum, item) =>
    sum + parseIntegerMoney(item.total, "invoice.total"), 0n);
  const approvedReturnValue = approvedReturns.reduce((sum, item) =>
    sum + parseIntegerMoney(item.total, "return.total"), 0n);
  const refundPaid = paidRefunds.reduce((sum, item) =>
    sum + parseIntegerMoney(item.refundAmount, "return.refundAmount"), 0n);
  const refundPending = pendingRefunds.reduce((sum, item) =>
    sum + parseIntegerMoney(item.refundAmount == null ? item.total : item.refundAmount, "return.refundAmount"), 0n);

  return {
    grossRevenue: grossRevenue.toString(),
    approvedReturnValue: approvedReturnValue.toString(),
    netRevenue: (grossRevenue - approvedReturnValue).toString(),
    refundPaid: refundPaid.toString(),
    refundPending: refundPending.toString(),
    openingShiftFloats: parseIntegerMoney(openingShiftFloats, "openingShiftFloats").toString(),
    openingShiftFloatIncludedInRevenue: false
  };
}

module.exports = Object.freeze({
  parseScaledQuantity,
  formatScaledQuantity,
  parseIntegerMoney,
  allocateFefo,
  calculateWeightedAverageHpp,
  validateSupplierReturn,
  assertInvoiceEncounterOwnership,
  queueSequenceKey,
  calculateRevenueBridge,
  requireBusinessDate,
  requireTimestamp
});
