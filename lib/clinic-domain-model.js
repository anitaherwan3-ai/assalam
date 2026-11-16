"use strict";

const contracts = require("./clinic-domain-contracts");

function invalid(code, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 400;
  return error;
}

function requiredId(value, field) {
  if (typeof value !== "string" || !value.trim() || value.length > 100) {
    throw invalid("DOMAIN_ID_REQUIRED", field + " wajib berupa ID yang valid.");
  }
  return value.trim();
}

function requiredText(value, field, max = 180) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw invalid("DOMAIN_TEXT_INVALID", field + " wajib diisi dan maksimal " + max + " karakter.");
  }
  return value.trim();
}

function optionalText(value, field, max = 180) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > max) {
    throw invalid("DOMAIN_TEXT_INVALID", field + " tidak valid.");
  }
  return value.trim() || null;
}

function validateMedicineMaster(input) {
  const value = input || {};
  const forbidden = ["stock", "stockQty", "stok", "hpp", "currentHpp", "batch", "batches"];
  for (const key of forbidden) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw invalid("MEDICINE_PROJECTION_WRITE_BLOCKED", "Stok, HPP dan batch tidak boleh diubah melalui form master obat.");
    }
  }
  const price = contracts.parseIntegerMoney(value.sellingPrice, "sellingPrice");
  const minimumStock = contracts.parseScaledQuantity(value.minimumStock || "0", value.quantityScale, "minimumStock");
  return Object.freeze({
    name: requiredText(value.name, "Nama obat"),
    canonicalUnit: requiredText(value.canonicalUnit, "Satuan dasar", 40),
    quantityScale: value.quantityScale,
    minimumStock: contracts.formatScaledQuantity(minimumStock, value.quantityScale),
    sellingPrice: price.toString(),
    active: value.active === undefined ? true : value.active === true
  });
}

function validateBatch(input, quantityScale) {
  const value = input || {};
  const received = contracts.parseScaledQuantity(value.receivedQty, quantityScale, "receivedQty");
  const remaining = contracts.parseScaledQuantity(value.remainingQty === undefined ? value.receivedQty : value.remainingQty, quantityScale, "remainingQty");
  if (received <= 0n || remaining > received) {
    throw invalid("BATCH_QUANTITY_INVALID", "Qty batch harus positif dan sisa tidak boleh melebihi qty awal.");
  }
  const dispositions = ["inspection_pending", "sellable", "quarantined", "rejected", "expired"];
  if (!dispositions.includes(value.disposition)) {
    throw invalid("BATCH_DISPOSITION_REQUIRED", "Status disposisi batch harus ditentukan secara eksplisit.");
  }
  contracts.requireBusinessDate(value.expiryDate, "expiryDate");
  contracts.requireTimestamp(value.receivedAtUtc, "receivedAtUtc");
  return Object.freeze({
    medicineId: requiredId(value.medicineId, "medicineId"),
    sourcePurchaseLineId: requiredId(value.sourcePurchaseLineId, "sourcePurchaseLineId"),
    batchNo: requiredText(value.batchNo, "Nomor batch", 100),
    expiryDate: value.expiryDate,
    receivedAtUtc: value.receivedAtUtc,
    receivedQty: contracts.formatScaledQuantity(received, quantityScale),
    remainingQty: contracts.formatScaledQuantity(remaining, quantityScale),
    disposition: value.disposition
  });
}

function validateInventoryMovement(input, quantityScale) {
  const value = input || {};
  const types = {
    purchase_receipt: "in",
    sale_issue: "out",
    patient_return: "in",
    supplier_return: "out",
    loss: "out",
    stocktake_increase: "in",
    stocktake_decrease: "out",
    opening_balance: "in",
    reversal: null
  };
  if (!Object.prototype.hasOwnProperty.call(types, value.movementType)) {
    throw invalid("MOVEMENT_TYPE_INVALID", "Jenis pergerakan stok tidak dikenal.");
  }
  if (value.movementType === "reversal") {
    requiredId(value.reversesMovementId, "reversesMovementId");
  } else if (types[value.movementType] !== value.direction) {
    throw invalid("MOVEMENT_DIRECTION_MISMATCH", "Arah movement tidak sesuai jenis transaksi.");
  }
  const quantity = contracts.parseScaledQuantity(value.quantity, quantityScale, "quantity");
  if (quantity <= 0n) throw invalid("MOVEMENT_QUANTITY_INVALID", "Qty movement harus lebih besar dari nol.");
  requiredId(value.medicineId, "medicineId");
  requiredId(value.batchId, "batchId");
  requiredId(value.sourceId, "sourceId");
  requiredId(value.actorUserId, "actorUserId");
  requiredText(value.reason, "Alasan movement", 255);
  contracts.requireTimestamp(value.occurredAtUtc, "occurredAtUtc");
  return Object.freeze({
    movementType: value.movementType,
    direction: value.direction,
    quantity: contracts.formatScaledQuantity(quantity, quantityScale),
    medicineId: value.medicineId,
    batchId: value.batchId,
    sourceType: requiredText(value.sourceType, "sourceType", 60),
    sourceId: value.sourceId,
    actorUserId: value.actorUserId,
    reason: value.reason.trim(),
    occurredAtUtc: value.occurredAtUtc,
    reversesMovementId: value.reversesMovementId || null
  });
}

function validatePurchaseReceipt(input, quantityScale) {
  const value = input || {};
  const quantity = contracts.parseScaledQuantity(value.receivedQty, quantityScale, "receivedQty");
  if (quantity <= 0n) throw invalid("RECEIPT_QUANTITY_INVALID", "Qty penerimaan harus lebih besar dari nol.");
  const purchaseValue = contracts.parseIntegerMoney(value.purchaseValue, "purchaseValue", false);
  return Object.freeze({
    purchaseLineId: requiredId(value.purchaseLineId, "purchaseLineId"),
    medicineId: requiredId(value.medicineId, "medicineId"),
    supplierId: requiredId(value.supplierId, "supplierId"),
    receivedQty: contracts.formatScaledQuantity(quantity, quantityScale),
    purchaseValue: purchaseValue.toString(),
    receiptReference: requiredText(value.receiptReference, "Referensi penerimaan", 100),
    batch: validateBatch({
      ...value.batch,
      medicineId: value.medicineId,
      sourcePurchaseLineId: value.purchaseLineId,
      receivedQty: contracts.formatScaledQuantity(quantity, quantityScale),
      remainingQty: value.batch && value.batch.remainingQty !== undefined ? value.batch.remainingQty : contracts.formatScaledQuantity(quantity, quantityScale)
    }, quantityScale)
  });
}

function validatePatient(input) {
  const value = input || {};
  return Object.freeze({
    fullName: requiredText(value.fullName, "Nama pasien", 180),
    phone: optionalText(value.phone, "Nomor telepon", 32)
  });
}

function validateEncounter(input) {
  const value = input || {};
  contracts.requireBusinessDate(value.businessDate, "businessDate");
  contracts.requireTimestamp(value.registeredAtUtc, "registeredAtUtc");
  return Object.freeze({
    patientId: value.patientId ? requiredId(value.patientId, "patientId") : null,
    patient: value.patientId ? null : validatePatient(value.patient),
    cashierUserId: requiredId(value.cashierUserId, "cashierUserId"),
    shiftId: requiredId(value.shiftId, "shiftId"),
    serviceCode: requiredText(value.serviceCode, "serviceCode", 60),
    businessDate: value.businessDate,
    registeredAtUtc: value.registeredAtUtc,
    queuePrefix: requiredText(value.queuePrefix, "queuePrefix", 8).toUpperCase()
  });
}

function validateQueueCallEvent(input) {
  const value = input || {};
  if (!["call", "recall", "cancel_call"].includes(value.eventType)) {
    throw invalid("QUEUE_EVENT_TYPE_INVALID", "Jenis event antrean harus call, recall atau cancel_call.");
  }
  if (!["global", "per_lane"].includes(value.activeCallPolicy)) {
    const error = invalid("QUEUE_ACTIVE_CALL_POLICY_REQUIRED", "Kebijakan panggilan global/per-lane belum ditetapkan.");
    error.statusCode = 409;
    throw error;
  }
  return Object.freeze({
    ticketId: requiredId(value.ticketId, "ticketId"),
    laneCode: requiredText(value.laneCode, "laneCode", 8).toUpperCase(),
    eventType: value.eventType,
    activeCallPolicy: value.activeCallPolicy,
    requestId: requiredText(value.requestId, "requestId", 100)
  });
}

function validateLedgerPayment(input) {
  const value = input || {};
  const amount = contracts.parseIntegerMoney(value.amount, "amount", false);
  const paymentStatus = ["reported", "pending_settlement", "settled", "reversed"].includes(value.paymentStatus)
    ? value.paymentStatus : null;
  if (!paymentStatus) throw invalid("PAYMENT_STATUS_REQUIRED", "Status penerimaan/pelunasan wajib eksplisit.");
  return Object.freeze({
    sourceType: requiredText(value.sourceType, "sourceType", 60),
    sourceId: requiredId(value.sourceId, "sourceId"),
    amount: amount.toString(),
    paymentMethod: requiredText(value.paymentMethod, "paymentMethod", 40),
    paymentStatus,
    businessDate: contracts.requireBusinessDate(value.businessDate, "businessDate"),
    eventAtUtc: contracts.requireTimestamp(value.eventAtUtc, "eventAtUtc"),
    settlementReference: optionalText(value.settlementReference, "settlementReference", 120),
    cashAccountId: value.cashAccountId ? requiredId(value.cashAccountId, "cashAccountId") : null,
    shiftId: value.shiftId ? requiredId(value.shiftId, "shiftId") : null
  });
}

function validateBalancedJournal(input) {
  const value = input || {};
  const lines = value.lines;
  if (!Array.isArray(lines) || lines.length < 2) {
    throw invalid("JOURNAL_LINES_REQUIRED", "Jurnal membutuhkan minimal dua baris.");
  }
  let debits = 0n;
  let credits = 0n;
  const normalized = lines.map((line, index) => {
    const accountId = requiredId(line.accountId, "accountId[" + index + "]");
    const side = line.side;
    if (side !== "debit" && side !== "credit") throw invalid("JOURNAL_SIDE_INVALID", "Sisi jurnal harus debit atau credit.");
    const amount = contracts.parseIntegerMoney(line.amount, "journal.amount", false);
    if (side === "debit") debits += amount;
    else credits += amount;
    return Object.freeze({ accountId, side, amount: amount.toString(), memo: optionalText(line.memo, "memo", 255) });
  });
  if (debits !== credits) throw invalid("JOURNAL_UNBALANCED", "Total debit dan kredit jurnal harus sama.");
  return Object.freeze({
    sourceType: requiredText(value.sourceType, "sourceType", 60),
    sourceId: requiredId(value.sourceId, "sourceId"),
    businessDate: contracts.requireBusinessDate(value.businessDate, "businessDate"),
    description: requiredText(value.description, "description", 255),
    totalDebit: debits.toString(),
    totalCredit: credits.toString(),
    lines: normalized
  });
}

function reconcileInventory({ medicines, batches, movements }) {
  if (!Array.isArray(medicines) || !Array.isArray(batches) || !Array.isArray(movements)) {
    throw invalid("RECONCILIATION_INPUT_INVALID", "Data obat, batch dan movement harus berupa daftar.");
  }
  const batchByMedicine = new Map();
  for (const batch of batches) {
    const key = requiredId(batch.medicineId, "batch.medicineId");
    const scale = batch.quantityScale;
    const qty = contracts.parseScaledQuantity(batch.remainingQty, scale, "batch.remainingQty");
    batchByMedicine.set(key, (batchByMedicine.get(key) || 0n) + qty);
  }
  const movementByMedicine = new Map();
  for (const movement of movements) {
    const key = requiredId(movement.medicineId, "movement.medicineId");
    const quantity = contracts.parseScaledQuantity(movement.quantity, movement.quantityScale, "movement.quantity");
    const signed = movement.direction === "in" ? quantity : movement.direction === "out" ? -quantity : null;
    if (signed === null) throw invalid("MOVEMENT_DIRECTION_INVALID", "Arah movement tidak valid.");
    movementByMedicine.set(key, (movementByMedicine.get(key) || 0n) + signed);
  }
  return medicines.map(medicine => {
    const id = requiredId(medicine.id, "medicine.id");
    const scale = medicine.quantityScale;
    const projected = contracts.parseScaledQuantity(medicine.stockQty, scale, "medicine.stockQty");
    const batch = batchByMedicine.get(id) || 0n;
    const delta = movementByMedicine.get(id) || 0n;
    return {
      medicineId: id,
      stockQty: contracts.formatScaledQuantity(projected, scale),
      batchQty: contracts.formatScaledQuantity(batch, scale),
      movementNet: contracts.formatScaledQuantity(delta, scale),
      batchVariance: (projected - batch).toString(),
      stockVsMovementVariance: (projected - delta).toString(),
      balancedToBatches: projected === batch,
      balancedToMovementNet: projected === delta
    };
  });
}

module.exports = Object.freeze({
  validateMedicineMaster,
  validateBatch,
  validateInventoryMovement,
  validatePurchaseReceipt,
  validatePatient,
  validateEncounter,
  validateQueueCallEvent,
  validateLedgerPayment,
  validateBalancedJournal,
  reconcileInventory
});
