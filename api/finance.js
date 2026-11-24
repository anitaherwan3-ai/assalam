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
      const [expenses] = await getPool().execute(
        "SELECT e.expense_id AS expenseId, e.public_id AS publicId, DATE_FORMAT(e.business_date, '%Y-%m-%d') AS tgl, " +
        "e.category AS kat, e.description AS ket, e.amount AS jml, e.status, " +
        "e.created_by_user_id AS createdByUserId, u.display_name AS creatorName " +
        "FROM expenses e JOIN users u ON u.user_id = e.created_by_user_id " +
        "ORDER BY e.expense_id DESC LIMIT 200"
      );
      const [shifts] = await getPool().execute(
        "SELECT s.shift_id AS shiftId, s.public_id AS publicId, s.cashier_user_id AS cashierUserId, u.display_name AS cashierName, " +
        "DATE_FORMAT(s.business_date, '%Y-%m-%d') AS tgl, s.shift_code AS shiftCode, s.opening_float AS openingFloat, " +
        "(SELECT qa.prefix FROM cashier_queue_assignments qa WHERE qa.user_id = s.cashier_user_id AND qa.valid_from <= s.business_date AND (qa.valid_to IS NULL OR qa.valid_to >= s.business_date) ORDER BY qa.valid_from DESC LIMIT 1) AS laneCode, " +
        "s.status, " +
        "r.expected_cash AS expectedCash, r.counted_cash AS countedCash, r.variance_amount AS varianceAmount, " +
        "r.variance_reason AS varianceReason, r.status AS verifStatus " +
        "FROM cashier_shifts s " +
        "JOIN users u ON u.user_id = s.cashier_user_id " +
        "LEFT JOIN shift_reconciliations r ON r.shift_id = s.shift_id " +
        "ORDER BY s.shift_id DESC LIMIT 100"
      );
      return res.status(200).json({
        ok: true,
        data: {
          expenses: expenses.map(row => ({
            ...row,
            expenseId: String(row.expenseId),
            jml: Number(row.jml)
          })),
          shifts: shifts.map(row => ({
            ...row,
            shiftId: String(row.shiftId),
            openingFloat: row.openingFloat === null ? null : String(row.openingFloat),
            expectedCash: row.expectedCash === null ? null : String(row.expectedCash),
            countedCash: row.countedCash === null ? null : String(row.countedCash),
            varianceAmount: row.varianceAmount === null ? null : String(row.varianceAmount)
          }))
        }
      });
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
    }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const allowed = [
      "record_payment", "approve_payment", "record_supplier_payment", "open_shift", "close_shift", "verify_shift",
      "refund_transfer", "create_expense", "approve_expense", "post_journal"
    ];
    if (!allowed.includes(body.action)) return res.status(400).json({ ok: false, code: "FINANCE_ACTION_INVALID" });
    const idempotencyKey = req.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8 || idempotencyKey.length > 100) {
      return res.status(400).json({ ok: false, code: "IDEMPOTENCY_KEY_REQUIRED" });
    }
    const requestId = String(req.headers["x-request-id"] || crypto.randomUUID()).slice(0, 100);
    const value = { ...body, actor, idempotencyKey, requestId };
    let result;
    if (body.action === "open_shift") result = await commands.openShift(value);
    else if (body.action === "close_shift") result = await commands.closeShift(value);
    else if (body.action === "verify_shift") result = await commands.verifyShift(value);
    else if (body.action === "record_payment") result = await commands.recordPayment(value);
    else if (body.action === "approve_payment") result = await commands.approvePayment(value);
    else if (body.action === "record_supplier_payment") result = await commands.recordSupplierPayment(value);
    else if (body.action === "refund_transfer") result = await commands.payRefund(value);
    else if (body.action === "create_expense") result = await commands.createExpense(value);
    else if (body.action === "approve_expense") result = await commands.approveExpense(value);
    else result = await commands.postJournal(value);
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    const status = Number(error && error.statusCode) || 503;
    if (status >= 500) console.error("[FINANCE-API] Request failed", { code: error.code || "UNKNOWN" });
    return res.status(status).json({
      ok: false,
      code: error.code || "FINANCE_SERVICE_UNAVAILABLE",
      message: status >= 500 ? "Finance service unavailable." : error.message
    });
  }
};
