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
    if (!["checkout", "return_request", "return_admin_review", "return_pimpinan_approve", "refund_pimpinan_approve"].includes(body.action)) return res.status(400).json({ ok: false, code: "SALES_ACTION_INVALID" });
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
    else result = await commands.approveRefund(value);
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
