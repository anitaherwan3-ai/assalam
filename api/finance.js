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
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
    }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const allowed = [
      "record_payment", "approve_payment", "record_supplier_payment",
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
    if (body.action === "record_payment") result = await commands.recordPayment(value);
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
