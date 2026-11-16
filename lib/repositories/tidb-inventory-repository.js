"use strict";

const crypto = require("node:crypto");

function fail(code, message, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function createTidbInventoryRepository() {
  async function getMedicineUnitPolicy(_connection, unit) {
    const approved = ["tablet", "kapsul", "botol", "pcs"].includes(unit);
    return approved ? { approved: true, quantityScale: 0 } : null;
  }

  async function createMedicine(connection, data) {
    const publicId = crypto.randomUUID();
    const [result] = await connection.execute(
      "INSERT INTO medicines (public_id, name, canonical_unit, selling_price, minimum_stock, active, created_at_utc, created_by_user_id, updated_at_utc, updated_by_user_id) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?, UTC_TIMESTAMP(3), ?)",
      [publicId, data.name, data.canonicalUnit, data.sellingPrice, data.minimumStock, data.active ? 1 : 0, data.actorUserId, data.actorUserId]
    );
    await connection.execute(
      "INSERT INTO medicine_stock_projections (medicine_id, physical_quantity, sellable_quantity, unknown_hpp_quantity, weighted_hpp, profit_calculation_status, projected_at_utc) VALUES (?, 0, 0, 0, NULL, 'uncalculated', UTC_TIMESTAMP(3))",
      [result.insertId]
    );
    return { medicineId: String(result.insertId), version: "1" };
  }

  async function previewPurchaseLine(purchaseLineId) {
    const { getPool } = require("../tidb");
    const [rows] = await getPool().execute(
      "SELECT l.supplier_invoice_line_id AS purchaseLineId, l.supplier_invoice_id AS purchaseId, i.supplier_id AS supplierId, l.medicine_id AS medicineId, l.ordered_quantity AS orderedQty, l.received_quantity AS receivedQty, 0 AS quantityScale " +
      "FROM supplier_invoice_lines l JOIN supplier_invoices i ON i.supplier_invoice_id = l.supplier_invoice_id WHERE l.supplier_invoice_line_id = ?",
      [purchaseLineId]
    );
    return rows[0] || null;
  }

  async function lockPurchaseLine(connection, purchaseLineId, excludeSupplierReturnId = "0") {
    const [rows] = await connection.execute(
      "SELECT l.supplier_invoice_line_id AS purchaseLineId, l.supplier_invoice_id AS purchaseId, i.supplier_id AS supplierId, l.medicine_id AS medicineId, l.ordered_quantity AS orderedQty, l.received_quantity AS receivedQty, l.received_quantity AS purchasedQty, " +
      "COALESCE((SELECT SUM(rl.quantity) FROM supplier_return_lines rl JOIN supplier_returns sr ON sr.supplier_return_id = rl.supplier_return_id WHERE rl.supplier_invoice_line_id = l.supplier_invoice_line_id AND sr.status IN ('requested','approved_for_dispatch','dispatched') AND sr.supplier_return_id <> ?), 0) AS returnedQty, " +
      "0 AS quantityScale, l.unit_cost AS unitCost, l.line_total AS lineTotal " +
      "FROM supplier_invoice_lines l JOIN supplier_invoices i ON i.supplier_invoice_id = l.supplier_invoice_id WHERE l.supplier_invoice_line_id = ? FOR UPDATE",
      [excludeSupplierReturnId, purchaseLineId]
    );
    if (!rows[0]) return null;
    const [allocations] = await connection.execute(
      "SELECT b.batch_id AS batchId FROM inventory_batches b JOIN purchase_receipt_lines r ON r.purchase_receipt_line_id = b.source_receipt_line_id WHERE r.supplier_invoice_line_id = ?",
      [purchaseLineId]
    );
    return { ...rows[0], purchasedQty: String(rows[0].purchasedQty), returnedQty: String(rows[0].returnedQty), originalBatchAllocations: allocations.map(row => ({ batchId: String(row.batchId) })) };
  }

  async function lockMedicine(connection, medicineId) {
    const [rows] = await connection.execute(
      "SELECT m.medicine_id AS medicineId, m.canonical_unit AS canonicalUnit, m.selling_price AS sellingPrice, " +
      "COALESCE(p.physical_quantity, 0) AS stockQty, p.weighted_hpp AS hpp, " +
      "COALESCE(p.unknown_hpp_quantity, 0) AS unknownHppQuantity, COALESCE(p.profit_calculation_status, 'uncalculated') AS profitCalculationStatus, " +
      "COALESCE(p.version, 1) AS version, 0 AS quantityScale " +
      "FROM medicines m LEFT JOIN medicine_stock_projections p ON p.medicine_id = m.medicine_id WHERE m.medicine_id = ? AND m.active = 1 FOR UPDATE",
      [medicineId]
    );
    if (!rows[0]) return null;
    return { ...rows[0], medicineId: String(rows[0].medicineId), stockQty: String(rows[0].stockQty), hpp: rows[0].hpp === null ? null : String(rows[0].hpp), version: String(rows[0].version), quantityScale: 0 };
  }

  async function getPurchaseReceiptPolicy(_connection, _invoiceId, _lineId) {
    return { mode: "single_receipt" };
  }

  async function createPurchaseReceipt(connection, input) {
    const line = await lockPurchaseLine(connection, input.purchaseLineId);
    if (!line) throw fail("PURCHASE_LINE_NOT_FOUND", "Baris faktur pembelian tidak ditemukan.", 404);
    const publicId = crypto.randomUUID();
    const [result] = await connection.execute(
      "INSERT INTO purchase_receipts (public_id, supplier_invoice_id, received_at_utc, business_date, receipt_reference, received_by_user_id, created_at_utc) VALUES (?, ?, UTC_TIMESTAMP(3), DATE(CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+07:00')), ?, ?, UTC_TIMESTAMP(3))",
      [publicId, line.purchaseId, input.receiptReference, input.actorUserId]
    );
    return String(result.insertId);
  }

  async function createBatch(connection, input) {
    const [receiptRows] = await connection.execute(
      "SELECT pr.purchase_receipt_id AS receiptId, prl.supplier_invoice_line_id AS purchaseLineId, prl.medicine_id AS medicineId, prl.unit_cost_snapshot AS unitCost " +
      "FROM purchase_receipts pr JOIN purchase_receipt_lines prl ON prl.purchase_receipt_id = pr.purchase_receipt_id WHERE pr.purchase_receipt_id = ? AND prl.supplier_invoice_line_id = ?",
      [input.purchaseReceiptId, input.sourcePurchaseLineId]
    );
    if (receiptRows.length) throw fail("RECEIPT_LINE_ALREADY_LINKED", "Baris penerimaan sudah memiliki batch.");
    const [lineRows] = await connection.execute(
      "SELECT medicine_id AS medicineId, unit_cost AS unitCost FROM supplier_invoice_lines WHERE supplier_invoice_line_id = ? FOR UPDATE",
      [input.sourcePurchaseLineId]
    );
    if (!lineRows[0] || String(lineRows[0].medicineId) !== String(input.medicineId)) throw fail("PURCHASE_BATCH_SOURCE_MISMATCH", "Sumber batch tidak cocok.");
    const verifiedExpiry = !!input.expiryDate;
    const disposition = input.disposition === "sellable" && verifiedExpiry && input.originVerified !== false ? "sellable" : "quarantined";
    const [receiptLine] = await connection.execute(
      "INSERT INTO purchase_receipt_lines (purchase_receipt_id, supplier_invoice_line_id, medicine_id, received_quantity, unit_cost_snapshot, batch_number, expiry_date, expiry_verified, origin_verified, created_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))",
      [input.purchaseReceiptId, input.sourcePurchaseLineId, input.medicineId, input.receivedQty, lineRows[0].unitCost, input.batchNo, input.expiryDate || null, verifiedExpiry ? 1 : 0, input.originVerified === false ? 0 : 1]
    );
    const hpp = input.purchaseValue ? String(BigInt(input.purchaseValue) / BigInt(input.receivedQty)) : String(lineRows[0].unitCost);
    const [result] = await connection.execute(
      "INSERT INTO inventory_batches (medicine_id, source_receipt_line_id, batch_number, expiry_date, expiry_verified, origin_verified, received_at_utc, original_quantity, remaining_quantity, unit_cost_hpp, disposition) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?, ?, ?, ?)",
      [input.medicineId, receiptLine.insertId, input.batchNo, input.expiryDate || null, verifiedExpiry ? 1 : 0, input.originVerified === false ? 0 : 1, input.receivedQty, input.remainingQty, hpp, disposition]
    );
    return String(result.insertId);
  }

  async function appendInventoryMovement(connection, input) {
    const [result] = await connection.execute(
      "INSERT INTO inventory_movements (medicine_id, batch_id, movement_type, direction, quantity, source_type, source_id, actor_user_id, reason, occurred_at_utc, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?)",
      [input.medicineId, input.batchId, input.movementType, input.direction, input.quantity, input.sourceType, input.sourceId, input.actorUserId, input.reason || null, crypto.randomUUID()]
    );
    return String(result.insertId);
  }

  async function updateMedicineProjection(connection, input) {
    const [rows] = await connection.execute(
      "SELECT unknown_hpp_quantity, weighted_hpp FROM medicine_stock_projections WHERE medicine_id = ? FOR UPDATE",
      [input.medicineId]
    );
    if (!rows[0]) throw fail("STOCK_PROJECTION_NOT_FOUND", "Proyeksi stok obat tidak ditemukan.");
    const unknown = BigInt(String(rows[0].unknown_hpp_quantity));
    const hpp = input.hpp === null ? null : String(input.hpp);
    const status = unknown > 0n || hpp === null ? "uncalculated" : "calculated";
    const [result] = await connection.execute(
      "UPDATE medicine_stock_projections SET physical_quantity = ?, sellable_quantity = (SELECT COALESCE(SUM(remaining_quantity), 0) FROM inventory_batches WHERE medicine_id = ? AND disposition = 'sellable' AND expiry_verified = 1 AND origin_verified = 1 AND expiry_date >= DATE(CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+07:00'))), weighted_hpp = ?, profit_calculation_status = ?, version = version + 1, projected_at_utc = UTC_TIMESTAMP(3) WHERE medicine_id = ?",
      [input.stockQty, input.medicineId, hpp, status, input.medicineId]
    );
    if (result.affectedRows !== 1) throw fail("STOCK_PROJECTION_CONFLICT", "Proyeksi stok berubah bersamaan.");
  }

  async function updateMedicineStockOnly(connection, input) {
    const [result] = await connection.execute(
      "UPDATE medicine_stock_projections SET physical_quantity = ?, sellable_quantity = (SELECT COALESCE(SUM(remaining_quantity), 0) FROM inventory_batches WHERE medicine_id = ? AND disposition = 'sellable' AND expiry_verified = 1 AND origin_verified = 1 AND expiry_date >= DATE(CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+07:00'))), version = version + 1, projected_at_utc = UTC_TIMESTAMP(3) WHERE medicine_id = ? AND version = ?",
      [input.stockQty, input.medicineId, input.medicineId, input.expectedVersion]
    );
    if (result.affectedRows !== 1) throw fail("STOCK_PROJECTION_CONFLICT", "Proyeksi stok berubah bersamaan.");
  }

  async function updatePurchaseLineReceived(connection, input) {
    const [result] = await connection.execute(
      "UPDATE supplier_invoice_lines SET received_quantity = ? WHERE supplier_invoice_line_id = ?",
      [input.receivedQty, input.purchaseLineId]
    );
    if (result.affectedRows !== 1) throw fail("PURCHASE_LINE_UPDATE_CONFLICT", "Qty penerimaan faktur gagal diperbarui.");
  }

  async function ensureSupplierPayable(connection, input) {
    const [rows] = await connection.execute(
      "SELECT gross_amount, status FROM supplier_invoices WHERE supplier_invoice_id = ? AND supplier_id = ? FOR UPDATE",
      [input.purchaseId, input.supplierId]
    );
    if (!rows[0]) throw fail("SUPPLIER_INVOICE_NOT_FOUND", "Faktur supplier tidak ditemukan.", 404);
    const [paid] = await connection.execute(
      "SELECT COALESCE(SUM(a.allocated_amount), 0) AS paid_amount FROM supplier_payment_allocations a WHERE a.supplier_invoice_id = ?",
      [input.purchaseId]
    );
    const amountPaid = BigInt(String(paid[0].paid_amount));
    const obligation = BigInt(String(rows[0].gross_amount));
    const status = amountPaid >= obligation ? "paid" : amountPaid > 0n ? "partial" : "open";
    await connection.execute(
      "UPDATE supplier_invoices SET status = ?, updated_at_utc = UTC_TIMESTAMP(3), version = version + 1 WHERE supplier_invoice_id = ?",
      [status, input.purchaseId]
    );
  }


  async function lockBatch(connection, batchId) {
    const [rows] = await connection.execute(
      "SELECT batch_id AS batchId, medicine_id AS medicineId, source_receipt_line_id AS sourceReceiptLineId, batch_number AS batchNo, expiry_date AS expiryDate, expiry_verified AS expiryVerified, origin_verified AS originVerified, received_at_utc AS receivedAtUtc, original_quantity AS originalQty, remaining_quantity AS remainingQty, unit_cost_hpp AS hpp, disposition, version FROM inventory_batches WHERE batch_id = ? FOR UPDATE",
      [batchId]
    );
    if (!rows[0]) return null;
    return { ...rows[0], batchId: String(rows[0].batchId), medicineId: String(rows[0].medicineId), remainingQty: String(rows[0].remainingQty), originalQty: String(rows[0].originalQty), version: String(rows[0].version) };
  }

  async function previewSupplierReturnSource(purchaseLineId, batchId) {
    const { getPool } = require("../tidb");
    const pool = getPool();
    const [lines] = await pool.execute(
      "SELECT l.supplier_invoice_line_id AS purchaseLineId, l.supplier_invoice_id AS purchaseId, i.supplier_id AS supplierId, l.medicine_id AS medicineId, l.received_quantity AS purchasedQty, 0 AS quantityScale " +
      "FROM supplier_invoice_lines l JOIN supplier_invoices i ON i.supplier_invoice_id = l.supplier_invoice_id WHERE l.supplier_invoice_line_id = ?",
      [purchaseLineId]
    );
    if (!lines[0]) return null;
    const [batches] = await pool.execute(
      "SELECT b.batch_id AS batchId, b.remaining_quantity AS remainingQty, b.expiry_date AS expiryDate, b.disposition " +
      "FROM inventory_batches b JOIN purchase_receipt_lines r ON r.purchase_receipt_line_id = b.source_receipt_line_id " +
      "WHERE r.supplier_invoice_line_id = ? AND b.batch_id = ?",
      [purchaseLineId, batchId]
    );
    if (!batches[0]) return null;
    const [returned] = await pool.execute(
      "SELECT COALESCE(SUM(rl.quantity), 0) AS returnedQty FROM supplier_return_lines rl JOIN supplier_returns sr ON sr.supplier_return_id = rl.supplier_return_id WHERE rl.supplier_invoice_line_id = ? AND sr.status IN ('requested','approved_for_dispatch','dispatched')",
      [purchaseLineId]
    );
    const [allocations] = await pool.execute(
      "SELECT b.batch_id AS batchId FROM inventory_batches b JOIN purchase_receipt_lines r ON r.purchase_receipt_line_id = b.source_receipt_line_id WHERE r.supplier_invoice_line_id = ?",
      [purchaseLineId]
    );
    return {
      quantityScale: 0,
      purchase: {
        purchasedQty: String(lines[0].purchasedQty),
        returnedQty: String(returned[0].returnedQty),
        originalBatchAllocations: allocations.map(row => ({ batchId: String(row.batchId) }))
      },
      batch: { batchId: String(batches[0].batchId), remainingQty: String(batches[0].remainingQty), expiryDate: batches[0].expiryDate, disposition: batches[0].disposition }
    };
  }

  async function createSupplierReturnRequest(connection, input) {
    const [source] = await connection.execute(
      "SELECT i.supplier_invoice_id AS invoiceId, b.medicine_id AS medicineId FROM inventory_batches b JOIN purchase_receipt_lines r ON r.purchase_receipt_line_id = b.source_receipt_line_id JOIN supplier_invoice_lines l ON l.supplier_invoice_line_id = r.supplier_invoice_line_id JOIN supplier_invoices i ON i.supplier_invoice_id = l.supplier_invoice_id WHERE l.supplier_invoice_line_id = ? AND b.batch_id = ? FOR UPDATE",
      [input.purchaseLineId, input.batchId]
    );
    if (!source[0]) throw fail("SUPPLIER_RETURN_SOURCE_NOT_FOUND", "Batch tidak berasal dari baris pembelian ini.", 404);
    const [result] = await connection.execute(
      "INSERT INTO supplier_returns (public_id, supplier_invoice_id, status, requested_by_user_id, requested_at_utc, settlement_status, created_at_utc) VALUES (?, ?, 'requested', ?, UTC_TIMESTAMP(3), 'pending', UTC_TIMESTAMP(3))",
      [crypto.randomUUID(), source[0].invoiceId, input.requestedByUserId]
    );
    await connection.execute(
      "INSERT INTO supplier_return_lines (supplier_return_id, supplier_invoice_line_id, batch_id, medicine_id, quantity, created_at_utc) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3))",
      [result.insertId, input.purchaseLineId, input.batchId, source[0].medicineId, input.quantity]
    );
    return String(result.insertId);
  }

  async function lockSupplierReturn(connection, supplierReturnId) {
    const [rows] = await connection.execute(
      "SELECT sr.supplier_return_id AS supplierReturnId, sr.status, sr.supplier_invoice_id AS supplierInvoiceId, rl.supplier_invoice_line_id AS purchaseLineId, rl.batch_id AS batchId, rl.medicine_id AS medicineId, rl.quantity " +
      "FROM supplier_returns sr JOIN supplier_return_lines rl ON rl.supplier_return_id = sr.supplier_return_id WHERE sr.supplier_return_id = ? FOR UPDATE",
      [supplierReturnId]
    );
    if (!rows[0]) return null;
    return { ...rows[0], supplierReturnId: String(rows[0].supplierReturnId), purchaseLineId: String(rows[0].purchaseLineId), batchId: String(rows[0].batchId), medicineId: String(rows[0].medicineId), quantity: String(rows[0].quantity) };
  }

  async function markSupplierReturnDispatched(connection, input) {
    const [rows] = await connection.execute(
      "SELECT supplier_return_id FROM supplier_returns WHERE supplier_return_id = ? AND status = 'approved_for_dispatch' FOR UPDATE",
      [input.supplierReturnId]
    );
    if (!rows[0]) throw fail("SUPPLIER_RETURN_NOT_APPROVED", "Retur supplier belum disetujui Pimpinan.");
    await connection.execute(
      "UPDATE supplier_returns SET status = 'dispatched', dispatched_at_utc = UTC_TIMESTAMP(3), settlement_status = ? WHERE supplier_return_id = ?",
      [input.settlementStatus === "owner_policy_pending" ? "pending" : input.settlementStatus, input.supplierReturnId]
    );
  }

  return Object.freeze({
    getMedicineUnitPolicy, createMedicine, previewPurchaseLine, lockPurchaseLine,
    lockMedicine, getPurchaseReceiptPolicy, createPurchaseReceipt, createBatch,
    appendInventoryMovement, updateMedicineProjection, updateMedicineStockOnly,
    updatePurchaseLineReceived, ensureSupplierPayable, lockBatch,
    previewSupplierReturnSource, createSupplierReturnRequest, lockSupplierReturn,
    markSupplierReturnDispatched
  });
}

module.exports = { createTidbInventoryRepository };
