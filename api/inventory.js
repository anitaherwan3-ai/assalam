"use strict";

const crypto = require("node:crypto");
const { requireBetterAuthActor } = require("../lib/require-better-auth-actor");
const { createClinicDomainCommands } = require("../lib/clinic-domain-commands");
const { createTidbInventoryRepository } = require("../lib/repositories/tidb-inventory-repository");

const repository = createTidbInventoryRepository();
const commands = createClinicDomainCommands({ repository });

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, private");
  try {
    const actor = await requireBetterAuthActor(req);
    if (req.method === "GET") {
      const { getPool } = require("../lib/tidb");
      const pool = getPool();
      const [rows] = await pool.execute(
        "SELECT m.medicine_id AS medicineId, m.public_id AS publicId, m.name, m.canonical_unit AS unit, m.selling_price AS sellingPrice, m.minimum_stock AS minimumStock, m.active, " +
        "COALESCE(p.physical_quantity, 0) AS physicalQuantity, COALESCE(p.sellable_quantity, 0) AS sellableQuantity, " +
        "COALESCE(p.unknown_hpp_quantity, 0) AS unknownHppQuantity, p.weighted_hpp AS weightedHpp, " +
        "COALESCE(p.profit_calculation_status, 'uncalculated') AS profitCalculationStatus " +
        "FROM medicines m LEFT JOIN medicine_stock_projections p ON p.medicine_id = m.medicine_id WHERE m.active = 1 ORDER BY m.name LIMIT 500"
      );
      const [purchaseRows] = await pool.execute(
        "SELECT i.supplier_invoice_id AS invoiceId, i.public_id AS publicId, i.supplier_id AS supplierId, s.public_id AS supplierPublicId, s.name AS supplierName, " +
        "i.supplier_invoice_number AS invoiceNumber, DATE_FORMAT(i.invoice_date, '%Y-%m-%d') AS invoiceDate, DATE_FORMAT(i.due_date, '%Y-%m-%d') AS dueDate, " +
        "i.gross_amount AS grossAmount, i.status, COALESCE(p.paidAmount, 0) AS paidAmount, COALESCE(c.creditAmount, 0) AS settledCreditAmount, " +
        "GREATEST(0, i.gross_amount - COALESCE(p.paidAmount, 0) - COALESCE(c.creditAmount, 0)) AS outstandingAmount, CAST(i.version AS CHAR) AS version " +
        "FROM supplier_invoices i JOIN suppliers s ON s.supplier_id = i.supplier_id " +
        "LEFT JOIN (SELECT supplier_invoice_id, SUM(allocated_amount) AS paidAmount FROM supplier_payment_allocations GROUP BY supplier_invoice_id) p ON p.supplier_invoice_id = i.supplier_invoice_id " +
        "LEFT JOIN (SELECT supplier_invoice_id, SUM(credit_amount) AS creditAmount FROM supplier_credit_notes WHERE status = 'settled' GROUP BY supplier_invoice_id) c ON c.supplier_invoice_id = i.supplier_invoice_id " +
        "ORDER BY i.supplier_invoice_id DESC LIMIT 200"
      );
      const [purchaseLineRows] = await pool.execute(
        "SELECT l.supplier_invoice_line_id AS purchaseLineId, l.supplier_invoice_id AS invoiceId, m.public_id AS medicinePublicId, m.name AS medicineName, " +
        "l.line_number AS lineNumber, l.ordered_quantity AS orderedQty, l.received_quantity AS receivedQty, l.unit_cost AS unitCost, l.line_total AS lineTotal " +
        "FROM supplier_invoice_lines l JOIN medicines m ON m.medicine_id = l.medicine_id " +
        "JOIN supplier_invoices i ON i.supplier_invoice_id = l.supplier_invoice_id ORDER BY l.supplier_invoice_line_id DESC LIMIT 500"
      );
      const [batchRows] = await pool.execute(
        "SELECT b.batch_id AS batchId, b.medicine_id AS medicineId, m.public_id AS medicinePublicId, m.name AS medicineName, " +
        "i.public_id AS invoicePublicId, i.supplier_invoice_number AS invoiceNumber, b.batch_number AS batchNo, DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS expiryDate, " +
        "b.expiry_verified AS expiryVerified, b.origin_verified AS originVerified, b.original_quantity AS originalQty, b.remaining_quantity AS remainingQty, " +
        "b.unit_cost_hpp AS hpp, b.disposition, b.version, b.received_at_utc AS receivedAtUtc " +
        "FROM inventory_batches b JOIN medicines m ON m.medicine_id = b.medicine_id " +
        "LEFT JOIN purchase_receipt_lines r ON r.purchase_receipt_line_id = b.source_receipt_line_id " +
        "LEFT JOIN supplier_invoice_lines l ON l.supplier_invoice_line_id = r.supplier_invoice_line_id " +
        "LEFT JOIN supplier_invoices i ON i.supplier_invoice_id = l.supplier_invoice_id " +
        "ORDER BY b.batch_id DESC LIMIT 1000"
      );
      const [supplierReturnRows] = await pool.execute(
        "SELECT sr.supplier_return_id AS returnId, sr.public_id AS publicId, i.public_id AS invoicePublicId, i.supplier_invoice_number AS invoiceNumber, " +
        "s.name AS supplierName, sr.status, sr.settlement_status AS settlementStatus, sr.requested_at_utc AS requestedAtUtc, " +
        "rl.quantity, rl.batch_id AS batchId, m.public_id AS medicinePublicId, m.name AS medicineName " +
        "FROM supplier_returns sr JOIN supplier_invoices i ON i.supplier_invoice_id = sr.supplier_invoice_id " +
        "JOIN suppliers s ON s.supplier_id = i.supplier_id JOIN supplier_return_lines rl ON rl.supplier_return_id = sr.supplier_return_id " +
        "JOIN medicines m ON m.medicine_id = rl.medicine_id ORDER BY sr.supplier_return_id DESC LIMIT 300"
      );
      return res.status(200).json({
        ok: true,
        data: rows.map(row => ({
          ...row,
          medicineId: String(row.medicineId),
          sellingPrice: String(row.sellingPrice),
          minimumStock: String(row.minimumStock),
          physicalQuantity: String(row.physicalQuantity),
          sellableQuantity: String(row.sellableQuantity),
          unknownHppQuantity: String(row.unknownHppQuantity),
          weightedHpp: row.weightedHpp === null ? null : String(row.weightedHpp)
        })),
        purchases: purchaseRows.map(row => ({
          ...row, invoiceId: String(row.invoiceId), supplierId: String(row.supplierId),
          grossAmount: String(row.grossAmount), paidAmount: String(row.paidAmount),
          settledCreditAmount: String(row.settledCreditAmount), outstandingAmount: String(row.outstandingAmount),
          version: String(row.version)
        })),
        purchaseLines: purchaseLineRows.map(row => ({
          ...row, purchaseLineId: String(row.purchaseLineId), invoiceId: String(row.invoiceId),
          orderedQty: String(row.orderedQty), receivedQty: String(row.receivedQty),
          unitCost: String(row.unitCost), lineTotal: String(row.lineTotal)
        })),
        batches: batchRows.map(row => ({
          ...row, batchId: String(row.batchId), medicineId: String(row.medicineId),
          originalQty: String(row.originalQty), remainingQty: String(row.remainingQty),
          hpp: row.hpp === null ? null : String(row.hpp), version: String(row.version),
          expiryVerified: Number(row.expiryVerified) === 1, originVerified: Number(row.originVerified) === 1
        })),
        supplierReturns: supplierReturnRows.map(row => ({
          ...row, returnId: String(row.returnId), quantity: String(row.quantity), batchId: String(row.batchId)
        }))
      });
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
    }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const idempotencyKey = req.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8 || idempotencyKey.length > 100) {
      return res.status(400).json({ ok: false, code: "IDEMPOTENCY_KEY_REQUIRED" });
    }
    const requestId = String(req.headers["x-request-id"] || crypto.randomUUID()).slice(0, 100);
    const value = { ...body, actor, idempotencyKey, requestId };
    let result;
    if (body.action === "create_medicine") {
      result = await commands.createMedicine({
        actor, medicine: { ...body.medicine, actorUserId: actor.userId },
        idempotencyKey, requestId
      });
    } else if (body.action === "receive_purchase") {
      result = await commands.receivePurchase(value);
    } else if (body.action === "supplier_return_request") {
      result = await commands.createSupplierReturnRequest(value);
    } else if (body.action === "stocktake_create") {
      result = await commands.createStocktake(value);
    } else if (body.action === "stocktake_approve") {
      result = await commands.approveStocktake(value);
    } else if (body.action === "quarantine_inspect") {
      result = await commands.inspectQuarantineBatch(value);
    } else if (body.action === "quarantine_approve_release") {
      result = await commands.approveQuarantineRelease(value);
    } else if (body.action === "quarantine_approve_disposition") {
      result = await commands.approveQuarantineDisposition(value);
    } else if (body.action === "quarantine_dispose") {
      result = await commands.disposeQuarantineBatch(value);
    } else if (body.action === "quarantine_release") {
      result = await commands.releaseQuarantineBatch(value);
    } else if (body.action === "supplier_return_approve") {
      result = await commands.approveSupplierReturn(value);
    } else if (body.action === "supplier_return_dispatch") {
      result = await commands.dispatchSupplierReturn(value);
    } else {
      return res.status(400).json({ ok: false, code: "INVENTORY_ACTION_INVALID" });
    }
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    const status = Number(error && error.statusCode) || 503;
    if (status >= 500) console.error("[INVENTORY-API] Request failed", { code: error.code || "UNKNOWN" });
    return res.status(status).json({
      ok: false,
      code: error.code || "INVENTORY_SERVICE_UNAVAILABLE",
      message: status >= 500 ? "Inventory service unavailable." : error.message
    });
  }
};
