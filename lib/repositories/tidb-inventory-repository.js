"use strict";

const crypto = require("node:crypto");

function fail(code, message, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function dateString(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function timestampString(value) {
  if (value instanceof Date) return value.toISOString();
  return value;
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
      "SELECT l.supplier_invoice_line_id AS purchaseLineId, l.supplier_invoice_id AS purchaseId, i.supplier_id AS supplierId, l.medicine_id AS medicineId, l.ordered_quantity AS orderedQty, l.received_quantity AS receivedQty, l.unit_cost AS unitCost, 0 AS quantityScale " +
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
    return { ...rows[0], batchId: String(rows[0].batchId), medicineId: String(rows[0].medicineId), expiryDate: dateString(rows[0].expiryDate), receivedAtUtc: timestampString(rows[0].receivedAtUtc), remainingQty: String(rows[0].remainingQty), originalQty: String(rows[0].originalQty), version: String(rows[0].version) };
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
      batch: { batchId: String(batches[0].batchId), remainingQty: String(batches[0].remainingQty), expiryDate: dateString(batches[0].expiryDate), disposition: batches[0].disposition }
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

  async function approveSupplierReturn(connection, input) {
    const [result] = await connection.execute(
      "UPDATE supplier_returns SET status = 'approved_for_dispatch', approved_by_user_id = ?, approved_at_utc = UTC_TIMESTAMP(3) WHERE supplier_return_id = ? AND status = 'requested'",
      [input.approvedByUserId, input.supplierReturnId]
    );
    if (result.affectedRows !== 1) throw fail("SUPPLIER_RETURN_APPROVAL_CONFLICT", "Permintaan retur supplier berubah atau sudah diproses.");
  }

  async function markSupplierReturnDispatched(connection, input) {
    const [rows] = await connection.execute(
      "SELECT sr.supplier_return_id, sr.supplier_invoice_id AS invoiceId, rl.quantity, l.unit_cost AS unitCost, i.gross_amount AS invoiceGross, " +
      "COALESCE((SELECT SUM(a.allocated_amount) FROM supplier_payment_allocations a WHERE a.supplier_invoice_id = i.supplier_invoice_id), 0) AS paidAmount " +
      "FROM supplier_returns sr JOIN supplier_return_lines rl ON rl.supplier_return_id = sr.supplier_return_id " +
      "JOIN supplier_invoice_lines l ON l.supplier_invoice_line_id = rl.supplier_invoice_line_id " +
      "JOIN supplier_invoices i ON i.supplier_invoice_id = sr.supplier_invoice_id " +
      "WHERE sr.supplier_return_id = ? AND sr.status = 'approved_for_dispatch' FOR UPDATE",
      [input.supplierReturnId]
    );
    if (!rows[0]) throw fail("SUPPLIER_RETURN_NOT_APPROVED", "Retur supplier belum disetujui Pimpinan.");
    const row = rows[0];
    const creditAmount = (BigInt(String(row.quantity)) * BigInt(String(row.unitCost))).toString();
    const settlementType = BigInt(String(row.paidAmount)) >= BigInt(String(row.invoiceGross)) ? "receivable" : "payable_offset";
    await connection.execute(
      "UPDATE supplier_returns SET status = 'dispatched', dispatch_reference = ?, dispatched_by_user_id = ?, dispatched_at_utc = UTC_TIMESTAMP(3), settlement_status = 'pending' WHERE supplier_return_id = ? AND status = 'approved_for_dispatch'",
      [input.dispatchReference, input.actorUserId, input.supplierReturnId]
    );
    await connection.execute(
      "INSERT INTO supplier_credit_notes (supplier_return_id, supplier_invoice_id, credit_amount, settlement_type, status, recorded_by_user_id, created_at_utc) VALUES (?, ?, ?, ?, 'pending', ?, UTC_TIMESTAMP(3))",
      [input.supplierReturnId, row.invoiceId, creditAmount, settlementType, input.actorUserId]
    );
  }


  async function lockCheckoutContext(connection, encounterId, shiftId) {
    const [rows] = await connection.execute(
      "SELECT e.encounter_id AS encounterId, e.patient_id AS patientId, e.cashier_user_id AS cashierUserId, e.shift_id AS shiftId, e.business_date AS businessDate, e.status AS encounterStatus, " +
      "s.cashier_user_id AS shiftCashierUserId, s.status AS shiftStatus " +
      "FROM patient_encounters e JOIN cashier_shifts s ON s.shift_id = e.shift_id AND s.cashier_user_id = e.cashier_user_id " +
      "JOIN active_shift_slots a ON a.shift_id = s.shift_id AND a.cashier_user_id = s.cashier_user_id " +
      "WHERE e.encounter_id = ? AND s.shift_id = ? FOR UPDATE",
      [encounterId, shiftId]
    );
    if (!rows[0] || rows[0].encounterStatus !== "registered" || rows[0].shiftStatus !== "open") return null;
    const row = rows[0];
    return {
      encounter: { encounterId: String(row.encounterId), patientId: String(row.patientId), cashierUserId: String(row.cashierUserId), shiftId: String(row.shiftId), businessDate: dateString(row.businessDate), status: row.encounterStatus },
      shift: { shiftId: String(row.shiftId), cashierUserId: String(row.shiftCashierUserId), status: row.shiftStatus }
    };
  }

  async function buildAuthoritativeCheckoutSnapshot(connection, input) {
    const lines = [];
    const inventoryRequirements = [];
    const seenMedicines = new Set();
    let gross = 0n;
    let discount = 0n;
    let net = 0n;
    for (const requested of input.requestedItems) {
      if (!requested || typeof requested !== "object") throw fail("CHECKOUT_ITEM_INVALID", "Item transaksi tidak valid.", 400);
      const quantity = BigInt(String(requested.quantity || "1"));
      if (quantity <= 0n) throw fail("CHECKOUT_QUANTITY_INVALID", "Qty transaksi harus lebih besar dari nol.", 400);
      if (requested.medicineId !== undefined && requested.medicineId !== null) {
        if (requested.discount !== undefined && requested.discount !== null && String(requested.discount) !== "0") throw fail("MEDICINE_DISCOUNT_NOT_SUPPORTED", "Diskon obat belum diaktifkan dalam kebijakan v1.", 400);
        const medicineId = String(requested.medicineId);
        if (seenMedicines.has(medicineId)) throw fail("CHECKOUT_DUPLICATE_MEDICINE_LINE", "Obat yang sama harus digabung dalam satu baris transaksi.", 400);
        seenMedicines.add(medicineId);
        const [rows] = await connection.execute(
          "SELECT m.medicine_id AS medicineId, m.name, m.canonical_unit AS unit, m.selling_price AS price, p.weighted_hpp AS hpp, COALESCE(p.profit_calculation_status, 'uncalculated') AS profitStatus " +
          "FROM medicines m LEFT JOIN medicine_stock_projections p ON p.medicine_id = m.medicine_id WHERE m.medicine_id = ? AND m.active = 1",
          [medicineId]
        );
        if (!rows[0]) throw fail("CHECKOUT_MEDICINE_NOT_FOUND", "Obat tidak ditemukan atau tidak aktif.", 404);
        const unitPrice = BigInt(String(rows[0].price));
        const amount = unitPrice * quantity;
        gross += amount; net += amount;
        lines.push({
          lineType: "medicine", medicineId, tariffId: null,
          name: String(rows[0].name), unit: String(rows[0].unit),
          quantity: quantity.toString(), grossUnitPrice: unitPrice.toString(),
          grossAmount: amount.toString(), discount: "0", netCharge: amount.toString(),
          hpp: rows[0].hpp === null ? null : String(rows[0].hpp),
          profitCalculationStatus: rows[0].hpp === null || rows[0].profitStatus !== "calculated" ? "uncalculated" : "calculated"
        });
        inventoryRequirements.push({ medicineId, quantity: quantity.toString() });
      } else if (requested.tariffId !== undefined && requested.tariffId !== null) {
        const tariffId = String(requested.tariffId);
        const [rows] = await connection.execute(
          "SELECT tariff_id AS tariffId, name, price, service_type AS serviceType FROM tariffs WHERE tariff_id = ? AND active = 1",
          [tariffId]
        );
        if (!rows[0]) throw fail("CHECKOUT_TARIFF_NOT_FOUND", "Tarif layanan tidak ditemukan atau tidak aktif.", 404);
        const unitPrice = BigInt(String(rows[0].price));
        const amount = unitPrice * quantity;
        const lineDiscount = BigInt(String(requested.discount || "0"));
        if (lineDiscount < 0n || lineDiscount > amount) throw fail("SERVICE_DISCOUNT_INVALID", "Diskon layanan melebihi nilai baris.", 400);
        gross += amount; discount += lineDiscount; net += amount - lineDiscount;
        lines.push({
          lineType: "service", medicineId: null, tariffId,
          name: String(rows[0].name), unit: "jasa",
          quantity: quantity.toString(), grossUnitPrice: unitPrice.toString(),
          grossAmount: amount.toString(), discount: lineDiscount.toString(),
          netCharge: (amount - lineDiscount).toString(), hpp: null,
          profitCalculationStatus: "uncalculated"
        });
      } else {
        throw fail("CHECKOUT_ITEM_REFERENCE_REQUIRED", "Setiap baris harus menunjuk obat atau tarif layanan.", 400);
      }
    }
    return {
      invoice: {
        number: "AS-" + new Date().toISOString().replace(/\D/g, "").slice(0, 14),
        grossAmount: gross.toString(), discountAmount: discount.toString(),
        total: net.toString()
      },
      lines,
      inventoryRequirements
    };
  }

  async function createInvoiceDraft(connection, input) {
    const snapshot = input.invoiceSnapshot || {};
    const [result] = await connection.execute(
      "INSERT INTO sales_invoices (public_id, encounter_id, patient_id, cashier_user_id, shift_id, business_date, gross_amount, discount_amount, net_amount, status, issued_at_utc, created_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [crypto.randomUUID(), input.encounterId, input.patientId, input.cashierUserId, input.shiftId, input.businessDate, snapshot.grossAmount || snapshot.total, snapshot.discountAmount || "0", snapshot.total]
    );
    return String(result.insertId);
  }

  async function lockEligibleBatches(connection, medicineId) {
    const [rows] = await connection.execute(
      "SELECT batch_id AS batchId, expiry_date AS expiryDate, received_at_utc AS receivedAtUtc, remaining_quantity AS remainingQty, disposition, version " +
      "FROM inventory_batches WHERE medicine_id = ? AND disposition = 'sellable' AND expiry_verified = 1 AND origin_verified = 1 " +
      "AND expiry_date >= DATE(CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+07:00')) AND remaining_quantity > 0 ORDER BY expiry_date, received_at_utc, batch_id FOR UPDATE",
      [medicineId]
    );
    return rows.map(row => ({ ...row, batchId: String(row.batchId), expiryDate: dateString(row.expiryDate), receivedAtUtc: timestampString(row.receivedAtUtc), remainingQty: String(row.remainingQty), version: String(row.version) }));
  }

  async function decrementBatchBalance(connection, input) {
    const [result] = await connection.execute(
      "UPDATE inventory_batches SET remaining_quantity = remaining_quantity - ?, version = version + 1 WHERE batch_id = ? AND version = ? AND remaining_quantity >= ? AND disposition = 'sellable'",
      [input.quantity, input.batchId, input.expectedVersion, input.quantity]
    );
    return result.affectedRows;
  }

  async function insertInvoiceLines(connection, invoiceId, lines) {
    let lineNumber = 0;
    for (const line of lines) {
      lineNumber++;
      await connection.execute(
        "INSERT INTO sales_invoice_lines (sales_invoice_id, line_number, line_type, medicine_id, tariff_id, item_name_snapshot, unit_snapshot, quantity, gross_unit_price, gross_amount, line_discount, net_charge, hpp_snapshot, profit_calculation_status, created_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))",
        [invoiceId, lineNumber, line.lineType, line.medicineId, line.tariffId, line.name, line.unit, line.quantity, line.grossUnitPrice, line.grossAmount, line.discount, line.netCharge, line.hpp, line.profitCalculationStatus]
      );
    }
  }

  async function insertSaleBatchAllocations(connection, invoiceId, allocations) {
    const [lines] = await connection.execute(
      "SELECT sales_invoice_line_id AS lineId, medicine_id AS medicineId FROM sales_invoice_lines WHERE sales_invoice_id = ? AND line_type = 'medicine' ORDER BY line_number",
      [invoiceId]
    );
    for (const allocation of allocations) {
      const line = lines.find(row => String(row.medicineId) === String(allocation.medicineId));
      if (!line) throw fail("SALE_ALLOCATION_LINE_MISSING", "Baris obat untuk alokasi batch tidak ditemukan.");
      const [batchRows] = await connection.execute(
        "SELECT unit_cost_hpp AS hpp FROM inventory_batches WHERE batch_id = ? AND medicine_id = ?",
        [allocation.batchId, allocation.medicineId]
      );
      const hpp = batchRows[0] && batchRows[0].hpp !== null ? String(batchRows[0].hpp) : null;
      const totalHpp = hpp === null ? null : (BigInt(hpp) * BigInt(allocation.quantity)).toString();
      await connection.execute(
        "INSERT INTO sales_batch_allocations (sales_invoice_line_id, batch_id, medicine_id, quantity, hpp_unit_snapshot, hpp_total_snapshot, created_at_utc) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))",
        [line.lineId, allocation.batchId, allocation.medicineId, allocation.quantity, hpp, totalHpp]
      );
    }
  }

  async function postInvoice(connection, invoiceId, totals) {
    const [result] = await connection.execute(
      "UPDATE sales_invoices SET status = 'posted', net_amount = ?, version = version + 1 WHERE sales_invoice_id = ? AND status = 'draft'",
      [totals.total, invoiceId]
    );
    if (result.affectedRows !== 1) throw fail("INVOICE_POST_CONFLICT", "Nota gagal diposting karena status berubah.");
  }

  async function createReturnQuotas(connection, invoiceId, lines) {
    const [stored] = await connection.execute(
      "SELECT sales_invoice_line_id AS lineId, line_type AS lineType, quantity, medicine_id AS medicineId FROM sales_invoice_lines WHERE sales_invoice_id = ? ORDER BY line_number",
      [invoiceId]
    );
    for (const line of stored) {
      if (line.lineType === "medicine") {
        const [allocations] = await connection.execute(
          "SELECT batch_id AS batchId, medicine_id AS medicineId, quantity FROM sales_batch_allocations WHERE sales_invoice_line_id = ? ORDER BY batch_id",
          [line.lineId]
        );
        for (const allocation of allocations) {
          await connection.execute(
            "INSERT INTO return_quota_subjects (sales_invoice_line_id, component_key, batch_id, medicine_id, maximum_quantity, reserved_quantity, approved_quantity) VALUES (?, ?, ?, ?, ?, 0, 0)",
            [line.lineId, "batch-" + allocation.batchId, allocation.batchId, allocation.medicineId, allocation.quantity]
          );
        }
      } else {
        await connection.execute(
          "INSERT INTO return_quota_subjects (sales_invoice_line_id, component_key, batch_id, medicine_id, maximum_quantity, reserved_quantity, approved_quantity) VALUES (?, 'service', NULL, NULL, ?, 0, 0)",
          [line.lineId, line.quantity]
        );
      }
    }
  }

  async function markEncounterCompleted(connection, encounterId, invoiceId) {
    const [result] = await connection.execute(
      "UPDATE patient_encounters SET status = 'completed', updated_at_utc = UTC_TIMESTAMP(3), version = version + 1 WHERE encounter_id = ? AND status = 'registered'",
      [encounterId]
    );
    if (result.affectedRows !== 1) throw fail("ENCOUNTER_COMPLETION_CONFLICT", "Kunjungan sudah diproses atau berubah.");
  }


  async function lockSalesInvoice(connection, invoiceId) {
    const [rows] = await connection.execute(
      "SELECT sales_invoice_id AS invoiceId, cashier_user_id AS cashierUserId, status, net_amount AS netAmount FROM sales_invoices WHERE sales_invoice_id = ? FOR UPDATE",
      [invoiceId]
    );
    return rows[0] ? { ...rows[0], invoiceId: String(rows[0].invoiceId), cashierUserId: String(rows[0].cashierUserId), netAmount: String(rows[0].netAmount) } : null;
  }

  async function lockReturnQuota(connection, quotaId) {
    const [rows] = await connection.execute(
      "SELECT q.return_quota_subject_id AS quotaId, q.sales_invoice_line_id AS invoiceLineId, i.sales_invoice_id AS invoiceId, " +
      "q.batch_id AS batchId, q.medicine_id AS medicineId, q.maximum_quantity AS maximumQuantity, q.reserved_quantity AS reservedQuantity, q.approved_quantity AS approvedQuantity, " +
      "l.quantity AS originalQuantity, CASE WHEN q.return_quota_subject_id = (SELECT MAX(q3.return_quota_subject_id) FROM return_quota_subjects q3 WHERE q3.sales_invoice_line_id = q.sales_invoice_line_id) " +
      "THEN l.net_charge - COALESCE((SELECT SUM(FLOOR(l.net_charge * q2.maximum_quantity / l.quantity)) FROM return_quota_subjects q2 WHERE q2.sales_invoice_line_id = q.sales_invoice_line_id AND q2.return_quota_subject_id < q.return_quota_subject_id), 0) " +
      "ELSE FLOOR(l.net_charge * q.maximum_quantity / l.quantity) END AS componentNetCharge, 0 AS quantityScale, " +
      "COALESCE((SELECT SUM(rl.refund_amount) FROM sales_return_lines rl JOIN sales_returns sr ON sr.sales_return_id = rl.sales_return_id WHERE rl.return_quota_subject_id = q.return_quota_subject_id AND sr.status <> 'rejected'), 0) AS priorRefundAmount " +
      "FROM return_quota_subjects q JOIN sales_invoice_lines l ON l.sales_invoice_line_id = q.sales_invoice_line_id JOIN sales_invoices i ON i.sales_invoice_id = l.sales_invoice_id " +
      "WHERE q.return_quota_subject_id = ? FOR UPDATE",
      [quotaId]
    );
    if (!rows[0]) return null;
    return {
      ...rows[0], quotaId: String(rows[0].quotaId), invoiceLineId: String(rows[0].invoiceLineId),
      invoiceId: String(rows[0].invoiceId), batchId: rows[0].batchId === null ? null : String(rows[0].batchId),
      medicineId: rows[0].medicineId === null ? null : String(rows[0].medicineId),
      maximumQuantity: String(rows[0].maximumQuantity), reservedQuantity: String(rows[0].reservedQuantity),
      approvedQuantity: String(rows[0].approvedQuantity), originalQuantity: String(rows[0].originalQuantity),
      netCharge: String(rows[0].componentNetCharge), priorRefundAmount: String(rows[0].priorRefundAmount), quantityScale: 0
    };
  }

  async function reserveReturnQuota(connection, input) {
    const [result] = await connection.execute(
      "UPDATE return_quota_subjects SET reserved_quantity = reserved_quantity + ? WHERE return_quota_subject_id = ? AND maximum_quantity - reserved_quantity - approved_quantity >= ?",
      [input.quantity, input.quotaId, input.quantity]
    );
    if (result.affectedRows !== 1) throw fail("RETURN_QUOTA_RESERVATION_CONFLICT", "Hak retur sudah dipakai oleh permintaan lain.");
  }

  async function releaseReturnQuota(connection, input) {
    const [result] = await connection.execute(
      "UPDATE return_quota_subjects SET reserved_quantity = reserved_quantity - ? WHERE return_quota_subject_id = ? AND reserved_quantity >= ?",
      [input.quantity, input.quotaId, input.quantity]
    );
    if (result.affectedRows !== 1) throw fail("RETURN_QUOTA_RELEASE_CONFLICT", "Reservasi hak retur tidak konsisten.");
  }

  async function approveReturnQuota(connection, input) {
    const [result] = await connection.execute(
      "UPDATE return_quota_subjects SET reserved_quantity = reserved_quantity - ?, approved_quantity = approved_quantity + ? WHERE return_quota_subject_id = ? AND reserved_quantity >= ? AND maximum_quantity - approved_quantity >= ?",
      [input.quantity, input.quantity, input.quotaId, input.quantity, input.quantity]
    );
    if (result.affectedRows !== 1) throw fail("RETURN_QUOTA_APPROVAL_CONFLICT", "Hak retur berubah sebelum persetujuan.");
  }

  async function createSalesReturn(connection, input) {
    const [result] = await connection.execute(
      "INSERT INTO sales_returns (public_id, sales_invoice_id, status, requested_by_user_id, requested_at_utc, reason) VALUES (?, ?, 'requested', ?, UTC_TIMESTAMP(3), ?)",
      [crypto.randomUUID(), input.invoiceId, input.requestedByUserId, input.reason]
    );
    return String(result.insertId);
  }

  async function createSalesReturnLine(connection, input) {
    const [result] = await connection.execute(
      "INSERT INTO sales_return_lines (sales_return_id, sales_invoice_line_id, return_quota_subject_id, quantity, original_net_charge_snapshot, refund_amount, stock_disposition, created_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))",
      [input.returnId, input.invoiceLineId, input.quotaId, input.quantity, input.originalNetCharge, input.refundAmount, input.stockDisposition]
    );
    return String(result.insertId);
  }

  async function appendSalesReturnEvent(connection, input) {
    await connection.execute(
      "INSERT INTO sales_return_events (sales_return_id, event_type, old_status, new_status, actor_user_id, reason, occurred_at_utc) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))",
      [input.returnId, input.eventType, input.oldStatus, input.newStatus, input.actorUserId, input.reason || null]
    );
  }

  async function lockSalesReturn(connection, returnId) {
    const [headers] = await connection.execute(
      "SELECT sales_return_id AS returnId, sales_invoice_id AS invoiceId, status, requested_by_user_id AS requestedByUserId FROM sales_returns WHERE sales_return_id = ? FOR UPDATE",
      [returnId]
    );
    if (!headers[0]) return null;
    const [lines] = await connection.execute(
      "SELECT rl.sales_return_line_id AS returnLineId, rl.return_quota_subject_id AS quotaId, rl.quantity, rl.refund_amount AS refundAmount, rl.sales_invoice_line_id AS invoiceLineId, q.batch_id AS batchId, q.medicine_id AS medicineId " +
      "FROM sales_return_lines rl JOIN return_quota_subjects q ON q.return_quota_subject_id = rl.return_quota_subject_id " +
      "WHERE rl.sales_return_id = ? ORDER BY rl.sales_return_line_id FOR UPDATE",
      [returnId]
    );
    return {
      ...headers[0], returnId: String(headers[0].returnId), invoiceId: String(headers[0].invoiceId),
      requestedByUserId: String(headers[0].requestedByUserId),
      lines: lines.map(line => ({
        ...line, returnLineId: String(line.returnLineId), quotaId: String(line.quotaId),
        quantity: String(line.quantity), refundAmount: String(line.refundAmount),
        invoiceLineId: String(line.invoiceLineId), batchId: line.batchId === null ? null : String(line.batchId),
        medicineId: line.medicineId === null ? null : String(line.medicineId)
      }))
    };
  }

  async function reviewSalesReturn(connection, input) {
    const [result] = await connection.execute(
      "UPDATE sales_returns SET status = ?, admin_reviewed_by_user_id = ?, admin_reviewed_at_utc = UTC_TIMESTAMP(3), version = version + 1 WHERE sales_return_id = ? AND status = 'requested'",
      [input.status, input.reviewerUserId, input.salesReturnId]
    );
    if (result.affectedRows !== 1) throw fail("RETURN_REVIEW_CONFLICT", "Status retur berubah sebelum diverifikasi.");
  }

  async function approveSalesReturn(connection, input) {
    const [result] = await connection.execute(
      "UPDATE sales_returns SET status = 'pimpinan_approved', pimpinan_approved_by_user_id = ?, pimpinan_approved_at_utc = UTC_TIMESTAMP(3), version = version + 1 WHERE sales_return_id = ? AND status = 'admin_reviewed'",
      [input.approverUserId, input.salesReturnId]
    );
    if (result.affectedRows !== 1) throw fail("RETURN_APPROVAL_CONFLICT", "Retur berubah sebelum persetujuan Pimpinan.");
  }

  async function createPatientReturnQuarantine(connection, input) {
    const [sourceRows] = await connection.execute(
      "SELECT batch_number AS batchNo, expiry_date AS expiryDate, expiry_verified AS expiryVerified, unit_cost_hpp AS hpp FROM inventory_batches WHERE batch_id = ? AND medicine_id = ? FOR UPDATE",
      [input.sourceBatchId, input.medicineId]
    );
    if (!sourceRows[0]) throw fail("RETURN_SOURCE_BATCH_NOT_FOUND", "Batch asal retur tidak ditemukan.");
    const source = sourceRows[0];
    const [batchResult] = await connection.execute(
      "INSERT INTO inventory_batches (medicine_id, source_receipt_line_id, batch_number, expiry_date, expiry_verified, origin_verified, received_at_utc, original_quantity, remaining_quantity, unit_cost_hpp, disposition) VALUES (?, NULL, ?, ?, ?, 1, UTC_TIMESTAMP(3), ?, ?, ?, 'quarantined')",
      [input.medicineId, "RET-" + input.returnLineId + "-" + String(source.batchNo || "UNKNOWN").slice(0, 60), source.expiryDate, source.expiryVerified, input.quantity, input.quantity, source.hpp]
    );
    const returnedBatchId = String(batchResult.insertId);
    await connection.execute(
      "INSERT INTO inventory_movements (medicine_id, batch_id, movement_type, direction, quantity, source_type, source_id, actor_user_id, reason, occurred_at_utc, idempotency_key) VALUES (?, ?, 'patient_return', 'in', ?, 'sales_return_line', ?, ?, ?, UTC_TIMESTAMP(3), ?)",
      [input.medicineId, returnedBatchId, input.quantity, input.returnLineId, input.actorUserId, input.reason, crypto.randomUUID()]
    );
    await connection.execute(
      "INSERT INTO inventory_quarantine_events (batch_id, event_type, quantity, reason, source_return_line_id, actor_user_id, occurred_at_utc) VALUES (?, 'patient_return', ?, ?, ?, ?, UTC_TIMESTAMP(3))",
      [returnedBatchId, input.quantity, input.reason, input.returnLineId, input.actorUserId]
    );
    const unknownHpp = source.hpp === null ? String(input.quantity) : "0";
    await connection.execute(
      "UPDATE medicine_stock_projections SET physical_quantity = physical_quantity + ?, unknown_hpp_quantity = unknown_hpp_quantity + ?, profit_calculation_status = CASE WHEN unknown_hpp_quantity + ? > 0 THEN 'uncalculated' ELSE profit_calculation_status END, version = version + 1, projected_at_utc = UTC_TIMESTAMP(3) WHERE medicine_id = ?",
      [input.quantity, unknownHpp, unknownHpp, input.medicineId]
    );
    return returnedBatchId;
  }

  async function createRefundObligation(connection, input) {
    const [result] = await connection.execute(
      "INSERT INTO refund_obligations (sales_return_id, approved_amount, outstanding_amount, status, approved_by_user_id, approved_at_utc, created_at_utc) VALUES (?, ?, ?, 'approved_pending_payout', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [input.salesReturnId, input.amount, input.amount, input.approvedByUserId]
    );
    return String(result.insertId);
  }


  async function getAccountingPeriod(connection, businessDate) {
    await connection.execute("INSERT IGNORE INTO accounting_periods (period_start, period_end, status) VALUES (DATE_FORMAT(?, '%Y-%m-01'), LAST_DAY(?), 'open')", [businessDate, businessDate]);
    const [rows] = await connection.execute(
      "SELECT accounting_period_id AS periodId, period_start AS periodStart, period_end AS periodEnd, status FROM accounting_periods WHERE period_start <= ? AND period_end >= ? FOR UPDATE",
      [businessDate, businessDate]
    );
    return rows[0] || null;
  }

  async function createJournal(connection, input) {
    const [period] = await connection.execute(
      "SELECT accounting_period_id AS periodId FROM accounting_periods WHERE period_start <= ? AND period_end >= ? AND status = 'open' FOR UPDATE",
      [input.businessDate, input.businessDate]
    );
    if (!period[0]) throw fail("ACCOUNTING_PERIOD_CLOSED", "Periode akuntansi tidak terbuka.");
    const [result] = await connection.execute(
      "INSERT INTO journal_entries (public_id, accounting_period_id, business_date, source_type, source_id, status, description, created_by_user_id, posted_by_user_id, posted_at_utc, created_at_utc) VALUES (?, ?, ?, ?, ?, 'posted', ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [crypto.randomUUID(), period[0].periodId, input.businessDate, input.sourceType, input.sourceId, input.description || null, input.postedByUserId, input.postedByUserId]
    );
    return String(result.insertId);
  }

  async function insertJournalLines(connection, journalId, lines) {
    let number = 0;
    for (const line of lines) {
      number++;
      await connection.execute(
        "INSERT INTO journal_lines (journal_entry_id, line_number, account_code, debit_amount, credit_amount, description) VALUES (?, ?, ?, ?, ?, ?)",
        [journalId, number, line.accountId, line.side === "debit" ? line.amount : "0", line.side === "credit" ? line.amount : "0", line.description || null]
      );
    }
  }

  async function getPaymentRecognitionPolicy(_connection, paymentMethod) {
    return paymentMethod === "cash" ? { approved: true, recognizeImmediately: true } : { approved: false, requiresPimpinanReview: true };
  }

  async function lockPaymentSource(connection, sourceType, sourceId) {
    if (sourceType !== "invoice") return null;
    const [rows] = await connection.execute(
      "SELECT i.sales_invoice_id AS sourceId, i.status, i.net_amount AS amount, " +
      "GREATEST(0, i.net_amount - COALESCE((SELECT SUM(p.amount) FROM invoice_payments p WHERE p.sales_invoice_id = i.sales_invoice_id AND p.settlement_status <> 'reversed'), 0)) AS outstandingAmount " +
      "FROM sales_invoices i WHERE i.sales_invoice_id = ? FOR UPDATE",
      [sourceId]
    );
    return rows[0] ? { ...rows[0], outstandingAmount: String(rows[0].outstandingAmount) } : null;
  }

  async function refreshInvoicePaymentStatus(connection, invoiceId) {
    await connection.execute(
      "UPDATE sales_invoices SET status = CASE " +
      "WHEN COALESCE((SELECT SUM(p.amount) FROM invoice_payments p WHERE p.sales_invoice_id = sales_invoices.sales_invoice_id AND p.income_recognized_at_utc IS NOT NULL AND p.settlement_status <> 'reversed'), 0) >= net_amount THEN 'paid' " +
      "WHEN COALESCE((SELECT SUM(p.amount) FROM invoice_payments p WHERE p.sales_invoice_id = sales_invoices.sales_invoice_id AND p.income_recognized_at_utc IS NOT NULL AND p.settlement_status <> 'reversed'), 0) > 0 THEN 'partially_paid' ELSE 'posted' END, version = version + 1 WHERE sales_invoice_id = ?",
      [invoiceId]
    );
  }

  async function appendPaymentEvent(connection, input) {
    const cash = input.paymentMethod === "cash";
    const reviewStatus = cash ? "not_required" : "pending";
    const settlementStatus = input.paymentStatus === "settled" ? "settled" : input.paymentStatus === "reversed" ? "reversed" : "pending";
    const [result] = await connection.execute(
      "INSERT INTO invoice_payments (sales_invoice_id, payment_method, amount, review_status, settlement_status, income_recognized_at_utc, settlement_reference, paid_at_utc, recorded_by_user_id, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [input.sourceId, input.paymentMethod, input.amount, reviewStatus, settlementStatus, cash ? new Date(input.eventAtUtc) : null, input.settlementReference, new Date(input.eventAtUtc), input.recordedByUserId, input.idempotencyKey || crypto.randomUUID()]
    );
    if (cash) await refreshInvoicePaymentStatus(connection, input.sourceId);
    return String(result.insertId);
  }

  async function lockPaymentEvent(connection, paymentId) {
    const [rows] = await connection.execute(
      "SELECT invoice_payment_id AS paymentId, review_status AS reviewStatus, settlement_status AS settlementStatus FROM invoice_payments WHERE invoice_payment_id = ? FOR UPDATE",
      [paymentId]
    );
    return rows[0] ? { ...rows[0], paymentId: String(rows[0].paymentId) } : null;
  }

  async function approvePaymentEvent(connection, input) {
    const [result] = await connection.execute(
      "UPDATE invoice_payments SET review_status = 'approved', reviewed_by_user_id = ?, reviewed_at_utc = UTC_TIMESTAMP(3), income_recognized_at_utc = UTC_TIMESTAMP(3) WHERE invoice_payment_id = ? AND review_status = 'pending' AND settlement_status <> 'reversed'",
      [input.reviewerUserId, input.paymentId]
    );
    if (result.affectedRows !== 1) throw fail("PAYMENT_REVIEW_CONFLICT", "Pembayaran berubah sebelum review Pimpinan.");
    const [rows] = await connection.execute("SELECT sales_invoice_id AS invoiceId FROM invoice_payments WHERE invoice_payment_id = ?", [input.paymentId]);
    await refreshInvoicePaymentStatus(connection, rows[0].invoiceId);
  }

  async function appendCashLedgerMovement(connection, input) {
    await connection.execute(
      "INSERT INTO cash_ledger_entries (cash_account_id, shift_id, direction, amount, source_type, source_id, actor_user_id, occurred_at_utc, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?)",
      [input.accountId, input.shiftId || null, input.direction, input.amount, input.sourceType, input.sourceId, input.actorUserId, input.idempotencyKey || crypto.randomUUID()]
    );
  }

  async function getSupplierPaymentPolicy(_connection) {
    return { approved: true, partialPayments: true, repeatedPayments: true };
  }

  async function lockSupplierPayable(connection, invoiceId) {
    const [rows] = await connection.execute(
      "SELECT supplier_invoice_id AS payableId, supplier_id AS supplierId, gross_amount AS grossAmount FROM supplier_invoices WHERE supplier_invoice_id = ? FOR UPDATE",
      [invoiceId]
    );
    if (!rows[0]) return null;
    const [payments] = await connection.execute(
      "SELECT COALESCE(SUM(allocated_amount), 0) AS paidAmount FROM supplier_payment_allocations WHERE supplier_invoice_id = ?",
      [invoiceId]
    );
    const [credits] = await connection.execute(
      "SELECT COALESCE(SUM(credit_amount), 0) AS creditAmount FROM supplier_credit_notes WHERE supplier_invoice_id = ? AND status = 'settled'",
      [invoiceId]
    );
    const gross = BigInt(String(rows[0].grossAmount));
    const paid = BigInt(String(payments[0].paidAmount));
    const credit = BigInt(String(credits[0].creditAmount));
    const outstanding = gross > paid + credit ? gross - paid - credit : 0n;
    return { payableId: String(rows[0].payableId), supplierId: String(rows[0].supplierId), grossAmount: gross.toString(), outstandingAmount: outstanding.toString() };
  }

  async function appendSupplierPayment(connection, input) {
    const payable = await lockSupplierPayable(connection, input.payableId);
    if (!payable) throw fail("SUPPLIER_PAYABLE_NOT_FOUND", "Faktur supplier tidak ditemukan.", 404);
    const [result] = await connection.execute(
      "INSERT INTO supplier_payments (public_id, supplier_id, payment_date, amount, payment_method, evidence_file_id, external_reference, recorded_by_user_id, created_at_utc, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?)",
      [crypto.randomUUID(), payable.supplierId, input.businessDate, input.amount, input.paymentMethod, input.evidenceFileId || null, input.settlementReference || null, input.recordedByUserId, input.idempotencyKey || crypto.randomUUID()]
    );
    return String(result.insertId);
  }

  async function applySupplierPaymentAllocation(connection, input) {
    const payable = await lockSupplierPayable(connection, input.payableId);
    if (!payable) throw fail("SUPPLIER_PAYABLE_NOT_FOUND", "Faktur supplier tidak ditemukan.", 404);
    if (BigInt(input.amount) > BigInt(payable.outstandingAmount)) throw fail("SUPPLIER_PAYMENT_EXCEEDS_PAYABLE", "Pembayaran melebihi sisa faktur.");
    await connection.execute(
      "INSERT INTO supplier_payment_allocations (supplier_payment_id, supplier_invoice_id, allocated_amount, created_at_utc) VALUES (?, ?, ?, UTC_TIMESTAMP(3))",
      [input.paymentId, input.payableId, input.amount]
    );
    const remaining = BigInt(payable.outstandingAmount) - BigInt(input.amount);
    await connection.execute(
      "UPDATE supplier_invoices SET status = ?, updated_at_utc = UTC_TIMESTAMP(3), version = version + 1 WHERE supplier_invoice_id = ?",
      [remaining === 0n ? "paid" : "partial", input.payableId]
    );
  }

  async function getRefundPayoutPolicy(_connection) {
    return { approved: true, transferReferenceOptional: true, evidenceOptional: true };
  }

  async function lockRefundObligation(connection, obligationId) {
    const [rows] = await connection.execute(
      "SELECT refund_obligation_id AS obligationId, approved_amount AS approvedAmount, outstanding_amount AS outstandingAmount, status FROM refund_obligations WHERE refund_obligation_id = ? FOR UPDATE",
      [obligationId]
    );
    return rows[0] ? { ...rows[0], obligationId: String(rows[0].obligationId), approvedAmount: String(rows[0].approvedAmount), outstandingAmount: String(rows[0].outstandingAmount) } : null;
  }

  async function appendRefundPayout(connection, input) {
    const [result] = await connection.execute(
      "INSERT INTO refund_payments (refund_obligation_id, amount, transfer_status, transfer_reference, transferred_by_user_id, transferred_at_utc, recorded_at_utc, idempotency_key) VALUES (?, ?, 'transferred', ?, ?, ?, UTC_TIMESTAMP(3), ?)",
      [input.obligationId, input.amount, input.settlementReference || null, input.paidByUserId, new Date(input.eventAtUtc), input.idempotencyKey || crypto.randomUUID()]
    );
    return String(result.insertId);
  }

  async function markRefundPaid(connection, obligationId, _payoutId) {
    const [result] = await connection.execute(
      "UPDATE refund_obligations SET outstanding_amount = 0, status = 'transferred' WHERE refund_obligation_id = ? AND status = 'approved_pending_payout'",
      [obligationId]
    );
    if (result.affectedRows !== 1) throw fail("REFUND_SETTLEMENT_CONFLICT", "Kewajiban refund berubah sebelum ditandai lunas.");
  }


  async function createExpense(connection, input) {
    const [result] = await connection.execute(
      "INSERT INTO expenses (public_id, business_date, category, description, amount, evidence_file_id, status, created_by_user_id, created_at_utc) VALUES (?, ?, ?, ?, ?, ?, 'requested', ?, UTC_TIMESTAMP(3))",
      [crypto.randomUUID(), input.businessDate, input.category, input.description, input.amount, input.evidenceFileId, input.createdByUserId]
    );
    return String(result.insertId);
  }

  async function lockExpense(connection, expenseId) {
    const [rows] = await connection.execute(
      "SELECT expense_id AS expenseId, status, created_by_user_id AS createdByUserId, amount FROM expenses WHERE expense_id = ? FOR UPDATE",
      [expenseId]
    );
    return rows[0] ? { ...rows[0], expenseId: String(rows[0].expenseId), createdByUserId: String(rows[0].createdByUserId), amount: String(rows[0].amount) } : null;
  }

  async function approveExpense(connection, input) {
    const [result] = await connection.execute(
      "UPDATE expenses SET status = 'approved', approved_by_user_id = ?, approved_at_utc = UTC_TIMESTAMP(3), version = version + 1 WHERE expense_id = ? AND status = 'requested'",
      [input.approverUserId, input.expenseId]
    );
    if (result.affectedRows !== 1) throw fail("EXPENSE_APPROVAL_CONFLICT", "Pengeluaran berubah sebelum persetujuan Pimpinan.");
  }

  async function appendExpenseEvent(connection, input) {
    await connection.execute(
      "INSERT INTO expense_events (expense_id, event_type, actor_user_id, reason, occurred_at_utc) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))",
      [input.expenseId, input.eventType, input.actorUserId, input.reason || null]
    );
  }


  async function createStocktake(connection, input) {
    const [allBatches] = await connection.execute("SELECT batch_id AS batchId FROM inventory_batches WHERE remaining_quantity > 0 ORDER BY batch_id");
    const expectedIds = allBatches.map(row => String(row.batchId)).sort();
    const suppliedIds = input.lines.map(line => String(line.batchId)).sort();
    if (expectedIds.length !== suppliedIds.length || expectedIds.some((id, index) => id !== suppliedIds[index])) throw fail("STOCKTAKE_BATCH_COVERAGE_INCOMPLETE", "Stok opname harus mencakup seluruh batch yang masih memiliki saldo.");
    const [header] = await connection.execute(
      "INSERT INTO stocktakes (public_id, stocktake_date, status, counted_by_user_id, created_at_utc) VALUES (?, ?, 'counting', ?, UTC_TIMESTAMP(3))",
      [crypto.randomUUID(), input.stocktakeDate, input.countedByUserId]
    );
    for (const line of input.lines) {
      const batch = await lockBatch(connection, line.batchId);
      if (!batch) throw fail("STOCKTAKE_BATCH_NOT_FOUND", "Batch untuk opname tidak ditemukan.", 404);
      const systemQty = BigInt(String(batch.remainingQty));
      const countedQty = BigInt(String(line.countedQuantity));
      const variance = countedQty - systemQty;
      if (variance !== 0n && !line.reason) throw fail("STOCKTAKE_VARIANCE_REASON_REQUIRED", "Setiap selisih stok harus memiliki alasan.", 400);
      await connection.execute(
        "INSERT INTO stocktake_lines (stocktake_id, medicine_id, batch_id, system_quantity, counted_quantity, variance_quantity, batch_version_snapshot, reason, created_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))",
        [header.insertId, batch.medicineId, line.batchId, systemQty.toString(), countedQty.toString(), variance.toString(), batch.version, line.reason || null]
      );
    }
    return String(header.insertId);
  }

  async function lockStocktake(connection, stocktakeId) {
    const [headers] = await connection.execute(
      "SELECT stocktake_id AS stocktakeId, stocktake_date AS stocktakeDate, status, counted_by_user_id AS countedByUserId FROM stocktakes WHERE stocktake_id = ? FOR UPDATE",
      [stocktakeId]
    );
    if (!headers[0]) return null;
    const [lines] = await connection.execute(
      "SELECT stocktake_line_id AS lineId, medicine_id AS medicineId, batch_id AS batchId, system_quantity AS systemQuantity, counted_quantity AS countedQuantity, variance_quantity AS varianceQuantity, batch_version_snapshot AS batchVersionSnapshot, reason FROM stocktake_lines WHERE stocktake_id = ? ORDER BY stocktake_line_id FOR UPDATE",
      [stocktakeId]
    );
    return {
      ...headers[0], stocktakeId: String(headers[0].stocktakeId),
      lines: lines.map(line => ({
        ...line, lineId: String(line.lineId), medicineId: String(line.medicineId),
        batchId: String(line.batchId), systemQuantity: String(line.systemQuantity),
        countedQuantity: String(line.countedQuantity), varianceQuantity: String(line.varianceQuantity),
        batchVersionSnapshot: String(line.batchVersionSnapshot)
      }))
    };
  }

  async function applyStocktakeVariance(connection, input) {
    const line = input.line;
    const delta = BigInt(String(line.varianceQuantity));
    if (delta === 0n) return;
    const [batchRows] = await connection.execute(
      "SELECT disposition, expiry_verified AS expiryVerified, origin_verified AS originVerified, expiry_date AS expiryDate, unit_cost_hpp AS hpp FROM inventory_batches WHERE batch_id = ? AND medicine_id = ? FOR UPDATE",
      [line.batchId, line.medicineId]
    );
    if (!batchRows[0]) throw fail("STOCKTAKE_BATCH_NOT_FOUND", "Batch opname tidak ditemukan.");
    const batch = batchRows[0];
    const [updated] = await connection.execute(
      "UPDATE inventory_batches SET remaining_quantity = ?, version = version + 1 WHERE batch_id = ? AND medicine_id = ? AND version = ? AND remaining_quantity = ?",
      [line.countedQuantity, line.batchId, line.medicineId, line.batchVersionSnapshot, line.systemQuantity]
    );
    if (updated.affectedRows !== 1) throw fail("STOCKTAKE_BATCH_CHANGED", "Batch berubah setelah dihitung; lakukan hitung ulang sebelum persetujuan.");
    const direction = delta > 0n ? "in" : "out";
    const movementType = delta > 0n ? "stocktake_increase" : "stocktake_decrease";
    const quantity = (delta > 0n ? delta : -delta).toString();
    await connection.execute(
      "INSERT INTO inventory_movements (medicine_id, batch_id, movement_type, direction, quantity, source_type, source_id, actor_user_id, reason, occurred_at_utc, idempotency_key) VALUES (?, ?, ?, ?, ?, 'stocktake', ?, ?, ?, UTC_TIMESTAMP(3), ?)",
      [line.medicineId, line.batchId, movementType, direction, quantity, input.stocktakeId, input.actorUserId, line.reason, crypto.randomUUID()]
    );
    const sellable = batch.disposition === "sellable" && Number(batch.expiryVerified) === 1 &&
      Number(batch.originVerified) === 1 && batch.expiryDate &&
      dateString(batch.expiryDate) >= new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
    const sellableDelta = sellable ? delta.toString() : "0";
    const unknownDelta = batch.hpp === null ? delta.toString() : "0";
    await connection.execute(
      "UPDATE medicine_stock_projections SET physical_quantity = physical_quantity + ?, sellable_quantity = sellable_quantity + ?, unknown_hpp_quantity = GREATEST(0, unknown_hpp_quantity + ?), profit_calculation_status = CASE WHEN GREATEST(0, unknown_hpp_quantity + ?) > 0 THEN 'uncalculated' ELSE profit_calculation_status END, version = version + 1, projected_at_utc = UTC_TIMESTAMP(3) WHERE medicine_id = ? AND physical_quantity + ? >= 0 AND sellable_quantity + ? >= 0",
      [delta.toString(), sellableDelta, unknownDelta, unknownDelta, line.medicineId, delta.toString(), sellableDelta]
    );
  }

  async function approveStocktake(connection, input) {
    const [result] = await connection.execute(
      "UPDATE stocktakes SET status = 'approved', approved_by_user_id = ?, approved_at_utc = UTC_TIMESTAMP(3), approval_note = ? WHERE stocktake_id = ? AND status = 'counting'",
      [input.approverUserId, input.reason, input.stocktakeId]
    );
    if (result.affectedRows !== 1) throw fail("STOCKTAKE_APPROVAL_CONFLICT", "Stok opname berubah sebelum disetujui.");
  }

  async function inspectQuarantineBatch(connection, input) {
    const [batches] = await connection.execute(
      "SELECT batch_id, medicine_id, remaining_quantity, disposition, expiry_date, expiry_verified, origin_verified FROM inventory_batches WHERE batch_id = ? FOR UPDATE",
      [input.batchId]
    );
    const batch = batches[0];
    if (!batch || batch.disposition !== "quarantined") throw fail("QUARANTINE_BATCH_NOT_FOUND", "Batch tidak sedang berada dalam karantina.", 404);
    if (input.decision === "release" && (Number(batch.expiry_verified) !== 1 || Number(batch.origin_verified) !== 1 || !batch.expiry_date || String(batch.expiry_date).slice(0, 10) < new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date()))) {
      throw fail("QUARANTINE_RELEASE_NOT_ELIGIBLE", "Batch tanpa asal dan kedaluwarsa terverifikasi atau sudah kedaluwarsa tidak dapat direkomendasikan untuk dijual.");
    }
    const [result] = await connection.execute(
      "INSERT INTO inventory_quarantine_events (batch_id, event_type, quantity, reason, inspection_decision, inspected_by_user_id, inspected_at_utc, evidence_file_id, actor_user_id, occurred_at_utc) VALUES (?, 'inspection', ?, ?, ?, ?, UTC_TIMESTAMP(3), ?, ?, UTC_TIMESTAMP(3))",
      [input.batchId, String(batch.remaining_quantity), input.reason, input.decision, input.actorUserId, input.evidenceFileId || null, input.actorUserId]
    );
    return String(result.insertId);
  }

  async function lockLatestQuarantineInspection(connection, batchId) {
    const [rows] = await connection.execute(
      "SELECT q.quarantine_event_id AS eventId, q.inspection_decision AS inspectionDecision, q.inspected_by_user_id AS inspectedByUserId, b.disposition, b.expiry_date AS expiryDate, b.expiry_verified AS expiryVerified, b.origin_verified AS originVerified " +
      "FROM inventory_quarantine_events q JOIN inventory_batches b ON b.batch_id = q.batch_id WHERE q.batch_id = ? AND q.event_type = 'inspection' ORDER BY q.occurred_at_utc DESC, q.quarantine_event_id DESC LIMIT 1 FOR UPDATE",
      [batchId]
    );
    if (!rows[0]) return null;
    if (rows[0].disposition !== "quarantined" || !rows[0].inspectedByUserId) return null;
    return { ...rows[0], expiryDate: dateString(rows[0].expiryDate), eventId: String(rows[0].eventId), inspectionDecision: rows[0].inspectionDecision };
  }

  async function approveQuarantineRelease(connection, input) {
    const [checks] = await connection.execute(
      "SELECT q.inspection_decision AS decision, b.expiry_date AS expiryDate, b.expiry_verified AS expiryVerified, b.origin_verified AS originVerified, b.disposition " +
      "FROM inventory_quarantine_events q JOIN inventory_batches b ON b.batch_id = q.batch_id WHERE q.quarantine_event_id = ? FOR UPDATE",
      [input.eventId]
    );
    const row = checks[0];
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
    if (!row || row.decision !== "release" || row.disposition !== "quarantined" || Number(row.expiryVerified) !== 1 || Number(row.originVerified) !== 1 || !row.expiryDate || dateString(row.expiryDate) < today) {
      throw fail("QUARANTINE_RELEASE_NOT_ELIGIBLE", "Batch belum memenuhi syarat asal dan kedaluwarsa untuk dilepas.");
    }
    const [result] = await connection.execute(
      "UPDATE inventory_quarantine_events SET release_approved_by_user_id = ?, release_approved_at_utc = UTC_TIMESTAMP(3), reason = CONCAT(reason, '; persetujuan Pimpinan: ', ?) WHERE quarantine_event_id = ? AND event_type = 'inspection' AND inspection_decision = 'release' AND release_approved_by_user_id IS NULL",
      [input.approverUserId, input.reason, input.eventId]
    );
    if (result.affectedRows !== 1) throw fail("QUARANTINE_APPROVAL_CONFLICT", "Hasil inspeksi berubah sebelum persetujuan Pimpinan.");
  }

  async function approveQuarantineDisposition(connection, input) {
    const [result] = await connection.execute(
      "UPDATE inventory_quarantine_events SET disposition_approved_by_user_id = ?, disposition_approved_at_utc = UTC_TIMESTAMP(3), reason = CONCAT(reason, '; persetujuan disposisi Pimpinan: ', ?) WHERE quarantine_event_id = ? AND event_type = 'inspection' AND inspection_decision = 'dispose' AND disposition_approved_by_user_id IS NULL",
      [input.approverUserId, input.reason, input.eventId]
    );
    if (result.affectedRows !== 1) throw fail("QUARANTINE_DISPOSITION_APPROVAL_CONFLICT", "Usulan disposisi berubah sebelum persetujuan Pimpinan.");
  }

  async function disposeQuarantineBatch(connection, input) {
    const [events] = await connection.execute(
      "SELECT quarantine_event_id AS eventId, inspection_decision AS inspectionDecision, disposition_approved_by_user_id AS approverUserId, evidence_file_id AS evidenceFileId " +
      "FROM inventory_quarantine_events WHERE batch_id = ? AND event_type = 'inspection' ORDER BY occurred_at_utc DESC, quarantine_event_id DESC LIMIT 1 FOR UPDATE",
      [input.batchId]
    );
    const event = events[0];
    if (!event || event.inspectionDecision !== "dispose" || !event.approverUserId) throw fail("QUARANTINE_DISPOSITION_NOT_APPROVED", "Pimpinan belum menyetujui disposisi batch.");
    const [batches] = await connection.execute(
      "SELECT medicine_id AS medicineId, remaining_quantity AS remainingQuantity, disposition, expiry_date AS expiryDate, unit_cost_hpp AS hpp, expiry_verified AS expiryVerified, origin_verified AS originVerified " +
      "FROM inventory_batches WHERE batch_id = ? FOR UPDATE",
      [input.batchId]
    );
    const batch = batches[0];
    if (!batch || batch.disposition !== "quarantined" || BigInt(String(batch.remainingQuantity)) <= 0n) throw fail("QUARANTINE_DISPOSITION_STATE_INVALID", "Batch tidak dapat didisposisikan.");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
    const expired = batch.expiryDate && dateString(batch.expiryDate) < today;
    const lossType = expired ? "expired" : Number(batch.originVerified) !== 1 ? "untraceable" : "damaged";
    const disposition = expired ? "expired" : "rejected";
    const quantity = String(batch.remainingQuantity);
    const [updated] = await connection.execute(
      "UPDATE inventory_batches SET remaining_quantity = 0, disposition = ?, version = version + 1 WHERE batch_id = ? AND disposition = 'quarantined' AND remaining_quantity = ?",
      [disposition, input.batchId, quantity]
    );
    if (updated.affectedRows !== 1) throw fail("QUARANTINE_DISPOSITION_CONFLICT", "Saldo batch berubah saat disposisi.");
    const [movement] = await connection.execute(
      "INSERT INTO inventory_movements (medicine_id, batch_id, movement_type, direction, quantity, source_type, source_id, actor_user_id, reason, occurred_at_utc, idempotency_key) VALUES (?, ?, 'loss', 'out', ?, 'quarantine_disposition', ?, ?, 'Disposisi batch karantina', UTC_TIMESTAMP(3), ?)",
      [batch.medicineId, input.batchId, quantity, event.eventId, input.actorUserId, crypto.randomUUID()]
    );
    await connection.execute(
      "INSERT INTO loss_events (batch_id, medicine_id, loss_type, quantity, hpp_snapshot, inventory_movement_id, approved_by_user_id, approved_at_utc, evidence_file_id, reason, created_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?, 'Disposisi batch karantina', UTC_TIMESTAMP(3))",
      [input.batchId, batch.medicineId, lossType, quantity, batch.hpp, movement.insertId, event.approverUserId, event.evidenceFileId]
    );
    const unknownDelta = batch.hpp === null ? quantity : "0";
    const [projection] = await connection.execute(
      "UPDATE medicine_stock_projections SET physical_quantity = physical_quantity - ?, unknown_hpp_quantity = GREATEST(0, unknown_hpp_quantity - ?), profit_calculation_status = CASE WHEN GREATEST(0, unknown_hpp_quantity - ?) > 0 OR weighted_hpp IS NULL THEN 'uncalculated' ELSE 'calculated' END, version = version + 1, projected_at_utc = UTC_TIMESTAMP(3) WHERE medicine_id = ? AND physical_quantity >= ?",
      [quantity, unknownDelta, unknownDelta, batch.medicineId, quantity]
    );
    if (projection.affectedRows !== 1) throw fail("QUARANTINE_PROJECTION_CONFLICT", "Proyeksi stok tidak cukup untuk disposisi batch.");
    const [eventUpdate] = await connection.execute(
      "UPDATE inventory_quarantine_events SET disposition_completed_by_user_id = ?, disposition_completed_at_utc = UTC_TIMESTAMP(3) WHERE quarantine_event_id = ? AND disposition_completed_at_utc IS NULL",
      [input.actorUserId, event.eventId]
    );
    if (eventUpdate.affectedRows !== 1) throw fail("QUARANTINE_EVENT_CONFLICT", "Event karantina sudah diproses.");
    return { quantity, disposition };
  }

  async function releaseQuarantineBatch(connection, input) {
    const [events] = await connection.execute(
      "SELECT q.quarantine_event_id AS eventId, q.inspection_decision AS inspectionDecision, q.release_approved_by_user_id AS approverUserId, q.released_at_utc AS releasedAtUtc FROM inventory_quarantine_events q " +
      "WHERE q.batch_id = ? AND q.event_type = 'inspection' ORDER BY q.occurred_at_utc DESC, q.quarantine_event_id DESC LIMIT 1 FOR UPDATE",
      [input.batchId]
    );
    if (!events[0] || events[0].inspectionDecision !== "release" || !events[0].approverUserId || events[0].releasedAtUtc) throw fail("QUARANTINE_RELEASE_NOT_APPROVED", "Inspeksi terakhir belum disetujui Pimpinan untuk pelepasan.");
    const [batch] = await connection.execute(
      "SELECT medicine_id AS medicineId, remaining_quantity AS remainingQuantity, disposition, expiry_date AS expiryDate, expiry_verified AS expiryVerified, origin_verified AS originVerified FROM inventory_batches WHERE batch_id = ? FOR UPDATE",
      [input.batchId]
    );
    if (!batch[0] || batch[0].disposition !== "quarantined" || BigInt(String(batch[0].remainingQuantity)) <= 0n) throw fail("QUARANTINE_BATCH_STATE_INVALID", "Batch karantina tidak dapat dilepas.");
    if (Number(batch[0].expiryVerified) !== 1 || Number(batch[0].originVerified) !== 1 || !batch[0].expiryDate ||
        dateString(batch[0].expiryDate) < new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date())) throw fail("QUARANTINE_RELEASE_NOT_ELIGIBLE", "Asal atau kedaluwarsa batch belum terverifikasi atau sudah kedaluwarsa.");
    const [updated] = await connection.execute(
      "UPDATE inventory_batches SET disposition = 'sellable', version = version + 1 WHERE batch_id = ? AND disposition = 'quarantined'",
      [input.batchId]
    );
    if (updated.affectedRows !== 1) throw fail("QUARANTINE_RELEASE_CONFLICT", "Status batch berubah bersamaan.");
    await connection.execute(
      "UPDATE inventory_quarantine_events SET released_by_user_id = ?, released_at_utc = UTC_TIMESTAMP(3) WHERE quarantine_event_id = ? AND released_at_utc IS NULL",
      [input.actorUserId, events[0].eventId]
    );
    await connection.execute(
      "UPDATE medicine_stock_projections SET sellable_quantity = (SELECT COALESCE(SUM(remaining_quantity), 0) FROM inventory_batches WHERE medicine_id = ? AND disposition = 'sellable' AND expiry_verified = 1 AND origin_verified = 1 AND expiry_date >= DATE(CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+07:00'))), version = version + 1, projected_at_utc = UTC_TIMESTAMP(3) WHERE medicine_id = ?",
      [batch[0].medicineId, batch[0].medicineId]
    );
    return { sellableQuantity: String(batch[0].remainingQuantity) };
  }


  async function findActiveShiftSlot(connection, cashierUserId) {
    const [rows] = await connection.execute(
      "SELECT s.shift_id AS shiftId, s.cashier_user_id AS cashierUserId, s.shift_code AS shiftCode, s.status, s.public_id AS publicId " +
      "FROM cashier_shifts s JOIN active_shift_slots a ON a.shift_id = s.shift_id AND a.cashier_user_id = s.cashier_user_id " +
      "WHERE a.cashier_user_id = ? AND s.status = 'open' FOR UPDATE",
      [cashierUserId]
    );
    return rows[0] ? { ...rows[0], shiftId: String(rows[0].shiftId), cashierUserId: String(rows[0].cashierUserId) } : null;
  }

  async function getCashierLaneAssignment(connection, cashierUserId) {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
    const [rows] = await connection.execute(
      "SELECT qa.prefix AS laneCode, LOWER(ba.email) AS email, ra.role_code AS roleCode, u.active AS active " +
      "FROM cashier_queue_assignments qa JOIN users u ON u.user_id = qa.user_id " +
      "JOIN `user` ba ON ba.id = u.user_id " +
      "JOIN active_role_slots ars ON ars.user_id = u.user_id " +
      "JOIN role_assignments ra ON ra.role_assignment_id = ars.role_assignment_id AND ra.user_id = u.user_id " +
      "WHERE qa.user_id = ? AND qa.valid_from <= ? AND (qa.valid_to IS NULL OR qa.valid_to >= ?) " +
      "AND ra.scope_type = 'clinic' AND ra.scope_id IS NULL " +
      "AND ra.valid_from_utc <= UTC_TIMESTAMP(3) AND (ra.valid_to_utc IS NULL OR ra.valid_to_utc > UTC_TIMESTAMP(3)) " +
      "ORDER BY qa.valid_from DESC, qa.assignment_id DESC LIMIT 1 FOR UPDATE",
      [cashierUserId, date, date]
    );
    if (rows.length) {
      if (Number(rows[0].active) !== 1 || rows[0].roleCode !== "kasir") return null;
      const expectedLane = rows[0].email === "assalamkasir1@gmail.com" ? "A"
        : rows[0].email === "assalamkasir2@gmail.com" ? "B" : null;
      if (!expectedLane || rows[0].laneCode !== expectedLane) return null;
      return { laneCode: rows[0].laneCode, email: rows[0].email };
    }

    // First shift bootstrap: the lane is derived only from the two fixed cashier
    // identities; the browser cannot choose or create a different lane.
    const [identity] = await connection.execute(
      "SELECT LOWER(ba.email) AS email, u.active AS active, ra.role_code AS roleCode " +
      "FROM users u JOIN `user` ba ON ba.id = u.user_id " +
      "JOIN active_role_slots ars ON ars.user_id = u.user_id " +
      "JOIN role_assignments ra ON ra.role_assignment_id = ars.role_assignment_id AND ra.user_id = u.user_id " +
      "WHERE u.user_id = ? AND ra.scope_type = 'clinic' AND ra.scope_id IS NULL " +
      "AND ra.valid_from_utc <= UTC_TIMESTAMP(3) AND (ra.valid_to_utc IS NULL OR ra.valid_to_utc > UTC_TIMESTAMP(3)) " +
      "FOR UPDATE",
      [cashierUserId]
    );
    if (identity.length !== 1 || Number(identity[0].active) !== 1 || identity[0].roleCode !== "kasir") return null;
    const expectedLane = identity[0].email === "assalamkasir1@gmail.com" ? "A"
      : identity[0].email === "assalamkasir2@gmail.com" ? "B" : null;
    if (!expectedLane) return null;
    await connection.execute(
      "INSERT INTO cashier_queue_assignments (user_id, prefix, valid_from, assigned_by_user_id, created_at_utc) " +
      "VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))",
      [cashierUserId, expectedLane, date, cashierUserId]
    );
    return { laneCode: expectedLane, email: identity[0].email, initialized: true };
  }

  async function openShift(connection, input) {
    const publicId = "sh-" + crypto.randomUUID().slice(0, 18);
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
    const [shiftResult] = await connection.execute(
      "INSERT INTO cashier_shifts (public_id, cashier_user_id, business_date, shift_code, opening_float, expected_cash, status, opened_at_utc) " +
      "VALUES (?, ?, ?, ?, ?, ?, 'open', UTC_TIMESTAMP(3))",
      [publicId, input.cashierUserId, date, input.shiftCode, input.openingFloat, input.openingFloat]
    );
    const shiftId = String(shiftResult.insertId);
    await connection.execute(
      "INSERT INTO active_shift_slots (cashier_user_id, shift_id, activated_at_utc) VALUES (?, ?, UTC_TIMESTAMP(3))",
      [input.cashierUserId, shiftId]
    );
    return { shiftId, publicId };
  }

  async function assignQueueLane(connection, input) {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
    await connection.execute(
      "UPDATE cashier_queue_assignments SET valid_to = ? WHERE user_id = ? AND valid_to IS NULL",
      [date, input.targetUserId]
    );
    const [result] = await connection.execute(
      "INSERT INTO cashier_queue_assignments (user_id, prefix, valid_from, assigned_by_user_id, created_at_utc) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))",
      [input.targetUserId, input.laneCode, date, input.assignedByUserId]
    );
    return { assignmentId: String(result.insertId) };
  }

  async function lockShiftForClose(connection, shiftId) {
    const [rows] = await connection.execute(
      "SELECT s.shift_id AS shiftId, s.cashier_user_id AS cashierUserId, s.shift_code AS shiftCode, s.opening_float AS openingFloat, s.status, " +
      "(s.opening_float + COALESCE((SELECT SUM(CASE WHEN e.direction = 'in' THEN e.amount ELSE -e.amount END) FROM cash_ledger_entries e WHERE e.shift_id = s.shift_id), 0)) AS expectedCash " +
      "FROM cashier_shifts s JOIN active_shift_slots a ON a.shift_id = s.shift_id AND a.cashier_user_id = s.cashier_user_id WHERE s.shift_id = ? FOR UPDATE",
      [shiftId]
    );
    return rows[0] ? { ...rows[0], shiftId: String(rows[0].shiftId), cashierUserId: String(rows[0].cashierUserId), openingFloat: String(rows[0].openingFloat), expectedCash: String(rows[0].expectedCash) } : null;
  }

  async function closeShift(connection, input) {
    const [result] = await connection.execute(
      "UPDATE cashier_shifts SET expected_cash = ?, counted_cash = ?, variance_amount = ?, status = 'pending_verification', closed_at_utc = UTC_TIMESTAMP(3), closed_by_user_id = ?, variance_reason = ?, version = version + 1 WHERE shift_id = ? AND status = 'open'",
      [input.expectedCash, input.countedCash, input.varianceAmount, input.closedByUserId, input.varianceReason || null, input.shiftId]
    );
    if (result.affectedRows !== 1) throw fail("SHIFT_CLOSE_CONFLICT", "Shift berubah sebelum penutupan.");
    const [reconciliation] = await connection.execute(
      "INSERT INTO shift_reconciliations (shift_id, revision_no, expected_cash, counted_cash, variance_amount, variance_reason, status, created_at_utc) VALUES (?, 1, ?, ?, ?, ?, 'pending_verification', UTC_TIMESTAMP(3))",
      [input.shiftId, input.expectedCash, input.countedCash, input.varianceAmount, input.varianceReason || null]
    );
    await connection.execute(
      "DELETE FROM active_shift_slots WHERE shift_id = ?",
      [input.shiftId]
    );
    return String(reconciliation.insertId);
  }

  async function lockShiftForVerification(connection, shiftId) {
    const [rows] = await connection.execute(
      "SELECT shift_id AS shiftId, cashier_user_id AS cashierUserId, shift_code AS shiftCode, status FROM cashier_shifts WHERE shift_id = ? FOR UPDATE",
      [shiftId]
    );
    return rows[0] ? { ...rows[0], shiftId: String(rows[0].shiftId), cashierUserId: String(rows[0].cashierUserId) } : null;
  }

  async function recordShiftVerification(connection, input) {
    try {
      await connection.execute(
        "INSERT INTO shift_verification_events (shift_id, verifier_user_id, verifier_role, reason, occurred_at_utc) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))",
        [input.shiftId, input.verifierUserId, input.verifierRole, input.reason || null]
      );
    } catch (error) {
      if (error && error.code === "ER_DUP_ENTRY") throw fail("SHIFT_ALREADY_VERIFIED_BY_ACTOR", "Pengguna ini sudah memberikan verifikasi untuk shift tersebut.");
      throw error;
    }
    const [counts] = await connection.execute(
      "SELECT COUNT(*) AS verificationCount FROM shift_verification_events WHERE shift_id = ?",
      [input.shiftId]
    );
    const verificationCount = Number(counts[0] && counts[0].verificationCount || 0);
    const verified = verificationCount >= input.requiredApprovals;
    if (verified) {
      const [rows] = await connection.execute(
        "SELECT shift_reconciliation_id AS reconciliationId FROM shift_reconciliations WHERE shift_id = ? AND status = 'pending_verification' ORDER BY revision_no DESC LIMIT 1 FOR UPDATE",
        [input.shiftId]
      );
      if (!rows[0]) throw fail("SHIFT_RECONCILIATION_NOT_FOUND", "Rekonsiliasi shift tidak ditemukan.");
      const [rec] = await connection.execute(
        "UPDATE shift_reconciliations SET status = 'verified', verified_by_user_id = ?, verified_at_utc = UTC_TIMESTAMP(3) WHERE shift_reconciliation_id = ? AND status = 'pending_verification'",
        [input.verifierUserId, rows[0].reconciliationId]
      );
      const [shift] = await connection.execute(
        "UPDATE cashier_shifts SET status = 'verified', verified_by_user_id = ?, verified_at_utc = UTC_TIMESTAMP(3), version = version + 1 WHERE shift_id = ? AND status = 'pending_verification'",
        [input.verifierUserId, input.shiftId]
      );
      if (rec.affectedRows !== 1 || shift.affectedRows !== 1) throw fail("SHIFT_VERIFY_CONFLICT", "Rekonsiliasi shift berubah sebelum diverifikasi.");
    }
    return { verificationCount, requiredApprovals: input.requiredApprovals, verified };
  }

  return Object.freeze({
    getMedicineUnitPolicy, createMedicine, previewPurchaseLine, lockPurchaseLine,
    lockMedicine, getPurchaseReceiptPolicy, createPurchaseReceipt, createBatch,
    appendInventoryMovement, updateMedicineProjection, updateMedicineStockOnly,
    updatePurchaseLineReceived, ensureSupplierPayable, lockBatch,
    previewSupplierReturnSource, createSupplierReturnRequest, lockSupplierReturn,
    markSupplierReturnDispatched, approveSupplierReturn,
    lockCheckoutContext, buildAuthoritativeCheckoutSnapshot, createInvoiceDraft,
    lockEligibleBatches, decrementBatchBalance, insertInvoiceLines,
    insertSaleBatchAllocations, postInvoice, createReturnQuotas, markEncounterCompleted,
    lockSalesInvoice, lockReturnQuota, reserveReturnQuota, releaseReturnQuota,
    approveReturnQuota, createSalesReturn, createSalesReturnLine, appendSalesReturnEvent,
    lockSalesReturn, reviewSalesReturn, approveSalesReturn, createPatientReturnQuarantine,
    createRefundObligation, getAccountingPeriod, createJournal, insertJournalLines,
    getPaymentRecognitionPolicy, lockPaymentSource, appendPaymentEvent, lockPaymentEvent,
    approvePaymentEvent, appendCashLedgerMovement, getSupplierPaymentPolicy,
    lockSupplierPayable, appendSupplierPayment, applySupplierPaymentAllocation,
    getRefundPayoutPolicy, lockRefundObligation, appendRefundPayout, markRefundPaid,
    createExpense, lockExpense, approveExpense, appendExpenseEvent,
    createStocktake, lockStocktake, applyStocktakeVariance, approveStocktake,
    inspectQuarantineBatch, lockLatestQuarantineInspection, approveQuarantineRelease, releaseQuarantineBatch,
    approveQuarantineDisposition, disposeQuarantineBatch,
    lockShiftForClose, closeShift, lockShiftForVerification, recordShiftVerification,
    findActiveShiftSlot, getCashierLaneAssignment, openShift, assignQueueLane
  });
}

module.exports = { createTidbInventoryRepository };
