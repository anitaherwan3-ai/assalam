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
      const [invoices] = await getPool().execute(
        "SELECT i.sales_invoice_id AS invoiceId, i.public_id AS publicId, DATE_FORMAT(i.business_date, '%Y-%m-%d') AS tgl, " +
        "i.gross_amount AS grossAmount, i.discount_amount AS discountAmount, i.net_amount AS total, " +
        "i.status, i.cashier_user_id AS cashierUserId, u.display_name AS cashierName, " +
        "p.patient_id AS patientId, p.full_name AS patientName, p.phone AS phone " +
        "FROM sales_invoices i " +
        "JOIN patients p ON p.patient_id = i.patient_id " +
        "JOIN users u ON u.user_id = i.cashier_user_id " +
        "ORDER BY i.sales_invoice_id DESC LIMIT 200"
      );
      const [lines] = await getPool().execute(
        "SELECT l.sales_invoice_id AS invoiceId, l.sales_invoice_line_id AS lineId, l.line_number AS lineNumber, " +
        "l.line_type AS lineType, l.item_name_snapshot AS itemName, l.unit_snapshot AS unit, l.quantity, " +
        "l.gross_unit_price AS unitPrice, l.gross_amount AS grossAmount, l.line_discount AS discount, l.net_charge AS netCharge, l.hpp_snapshot AS hpp, " +
        "m.public_id AS medicinePublicId, t.public_id AS tariffPublicId " +
        "FROM sales_invoice_lines l JOIN (SELECT sales_invoice_id FROM sales_invoices ORDER BY sales_invoice_id DESC LIMIT 200) recent " +
        "ON recent.sales_invoice_id = l.sales_invoice_id " +
        "LEFT JOIN medicines m ON m.medicine_id = l.medicine_id " +
        "LEFT JOIN tariffs t ON t.tariff_id = l.tariff_id " +
        "ORDER BY l.sales_invoice_id DESC, l.line_number"
      );
      const [payments] = await getPool().execute(
        "SELECT p.sales_invoice_id AS invoiceId, p.invoice_payment_id AS paymentId, p.payment_method AS method, " +
        "p.amount, p.review_status AS reviewStatus, p.settlement_status AS settlementStatus, " +
        "p.income_recognized_at_utc AS incomeRecognizedAt, p.paid_at_utc AS paidAt, " +
        "p.settlement_reference AS reference " +
        "FROM invoice_payments p JOIN (SELECT sales_invoice_id FROM sales_invoices ORDER BY sales_invoice_id DESC LIMIT 200) recent " +
        "ON recent.sales_invoice_id = p.sales_invoice_id " +
        "ORDER BY p.sales_invoice_id DESC, p.invoice_payment_id";
      const [returns] = await getPool().execute(
        "SELECT r.sales_return_id AS returnId, r.public_id AS publicId, r.sales_invoice_id AS invoiceId, " +
        "r.status, r.requested_by_user_id AS requestedByUserId, r.requested_at_utc AS requestedAt, " +
        "r.reason, ro.approved_amount AS refundAmount, ro.status AS refundStatus " +
        "FROM sales_returns r " +
        "LEFT JOIN refund_obligations ro ON ro.sales_return_id = r.sales_return_id " +
        "ORDER BY r.sales_return_id DESC LIMIT 100"
      );
      const linesByInvoice = new Map();
      for (const row of lines) {
        const key = String(row.invoiceId);
        if (!linesByInvoice.has(key)) linesByInvoice.set(key, []);
        linesByInvoice.get(key).push({
          lineId: String(row.lineId), lineNumber: Number(row.lineNumber),
          lineType: row.lineType, itemName: row.itemName, unit: row.unit,
          quantity: String(row.quantity), unitPrice: String(row.unitPrice),
          grossAmount: String(row.grossAmount), discount: String(row.discount),
          netCharge: String(row.netCharge),
          medicinePublicId: row.medicinePublicId || null,
          tariffPublicId: row.tariffPublicId || null
        });
      }
      const paymentsByInvoice = new Map();
      for (const row of payments) {
        const key = String(row.invoiceId);
        if (!paymentsByInvoice.has(key)) paymentsByInvoice.set(key, []);
        paymentsByInvoice.get(key).push({
          paymentId: String(row.paymentId), method: row.method, amount: String(row.amount),
          reviewStatus: row.reviewStatus, settlementStatus: row.settlementStatus,
          incomeRecognized: !!row.incomeRecognizedAt,
          incomeRecognizedAt: row.incomeRecognizedAt,
          paidAt: row.paidAt, reference: row.reference || null
        });
      }
      const [cancels] = await getPool().execute(
        "SELECT c.cancellation_request_id AS requestId, c.public_id AS publicId, c.sales_invoice_id AS invoiceId, " +
        "c.status, c.reason, c.requested_by_user_id AS requestedByUserId, c.requested_at_utc AS requestedAt, " +
        "c.resolved_by_user_id AS resolvedByUserId, c.resolved_at_utc AS resolvedAt, c.resolution_note AS resolutionNote " +
        "FROM invoice_cancellation_requests c " +
        "ORDER BY c.cancellation_request_id DESC LIMIT 100"
      );
      return res.status(200).json({
        ok: true,
        data: {
          invoices: invoices.map(row => ({
            ...row,
            invoiceId: String(row.invoiceId),
            grossAmount: String(row.grossAmount),
            discountAmount: String(row.discountAmount),
            total: Number(row.total),
            items: linesByInvoice.get(String(row.invoiceId)) || [],
            payments: paymentsByInvoice.get(String(row.invoiceId)) || []
          })),
          returns: returns.map(row => ({
            ...row,
            returnId: String(row.returnId),
            invoiceId: String(row.invoiceId),
            refundAmount: row.refundAmount === null ? null : String(row.refundAmount)
          })),
          cancels: cancels.map(row => ({
            ...row,
            requestId: String(row.requestId),
            invoiceId: String(row.invoiceId)
          }))
        }
      });
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
    }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (!["checkout", "return_request", "return_admin_review", "return_pimpinan_approve", "refund_pimpinan_approve", "cancel_transaction"].includes(body.action)) {
      return res.status(400).json({ ok: false, code: "SALES_ACTION_INVALID" });
    }
    const idempotencyKey = req.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8 || idempotencyKey.length > 100) {
      return res.status(400).json({ ok: false, code: "IDEMPOTENCY_KEY_REQUIRED" });
    }
    const requestId = String(req.headers["x-request-id"] || crypto.randomUUID()).slice(0, 100);
    const value = { ...body, actor, idempotencyKey, requestId };
    let result;
    if (body.action === "checkout") result = await commands.postCheckout(value);
    else if (body.action === "return_request") result = await commands.requestSalesReturn(value);
    else if (body.action === "return_admin_review") result = await commands.reviewSalesReturn(value);
    else if (body.action === "return_pimpinan_approve") result = await commands.approveSalesReturn(value);
    else if (body.action === "refund_pimpinan_approve") result = await commands.approveRefund(value);
    else if (body.action === "cancel_transaction") {
      const { getPool } = require("../lib/tidb");
      const pool = getPool();
      const saleId = String(body.saleId || body.invoiceId || "");
      if (!saleId) return res.status(400).json({ ok: false, code: "SALE_ID_REQUIRED" });
      
      const [invRows] = await pool.execute(
        "SELECT sales_invoice_id AS invoiceId, status FROM sales_invoices WHERE sales_invoice_id = ? OR public_id = ?",
        [saleId, saleId]
      );
      if (!invRows.length) return res.status(404).json({ ok: false, code: "SALES_INVOICE_NOT_FOUND", message: "Nota penjualan tidak ditemukan." });
      const invoiceId = invRows[0].invoiceId;

      if (body.decision) {
        if (!["admin", "pimpinan"].includes(actor.role)) {
          return res.status(403).json({ ok: false, code: "AUTH_FORBIDDEN", message: "Hanya Admin atau Pimpinan yang dapat memproses pembatalan." });
        }
        const decision = body.decision === "disetujui" || body.decision === "approve" ? "approved" : "rejected";
        const reason = String(body.reason || "").trim();
        await pool.execute(
          "UPDATE invoice_cancellation_requests SET status = ?, resolved_by_user_id = ?, resolved_at_utc = UTC_TIMESTAMP(3), resolution_note = ? WHERE sales_invoice_id = ? AND status = 'requested'",
          [decision, actor.userId, reason, invoiceId]
        );
        if (decision === "approved") {
          await pool.execute(
            "UPDATE sales_invoices SET status = 'cancelled', version = version + 1 WHERE sales_invoice_id = ?",
            [invoiceId]
          );
        }
        return res.status(200).json({ ok: true, status: decision, invoiceId: String(invoiceId) });
      } else {
        if (!["kasir", "admin", "pimpinan"].includes(actor.role)) {
          return res.status(403).json({ ok: false, code: "AUTH_FORBIDDEN" });
        }
        const [existing] = await pool.execute(
          "SELECT cancellation_request_id FROM invoice_cancellation_requests WHERE sales_invoice_id = ? AND status = 'requested'",
          [invoiceId]
        );
        if (existing.length) {
          return res.status(409).json({ ok: false, code: "CANCELLATION_ALREADY_REQUESTED", message: "Pengajuan pembatalan nota sudah ada dan sedang diproses." });
        }
        const pubId = "cncl_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex");
        const reason = String(body.reason || "Kesalahan input transaksi").slice(0, 255);
        await pool.execute(
          "INSERT INTO invoice_cancellation_requests (public_id, sales_invoice_id, status, requested_by_user_id, requested_at_utc, reason) VALUES (?, ?, 'requested', ?, UTC_TIMESTAMP(3), ?)",
          [pubId, invoiceId, actor.userId, reason]
        );
        return res.status(200).json({ ok: true, status: "requested", publicId: pubId, invoiceId: String(invoiceId) });
      }
    }
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    const status = Number(error && error.statusCode) || 503;
    if (status >= 500) console.error("[SALES-API] Request failed", { code: error.code || "UNKNOWN" });
    return res.status(status).json({
      ok: false,
      code: error.code || "SALES_SERVICE_UNAVAILABLE",
      message: status >= 500 ? "Sales service unavailable." : error.message
    });
  }
};
