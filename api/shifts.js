"use strict";
const crypto = require("node:crypto");
const { getPool } = require("../lib/tidb");
const { requireBetterAuthActor } = require("../lib/require-better-auth-actor");
const { createClinicDomainCommands } = require("../lib/clinic-domain-commands");
const { createTidbQueueRepository } = require("../lib/repositories/tidb-queue-repository");

const repository = createTidbQueueRepository();
const commands = createClinicDomainCommands({ repository });

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, private");
  try {
    const actor = await requireBetterAuthActor(req);
    if (req.method === "GET") {
      const data = await repository.listCashierShifts(actor);
      return res.status(200).json({ ok: true, data });
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
    }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (body.action !== "open") return res.status(400).json({ ok: false, code: "SHIFT_ACTION_INVALID" });
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || key.length < 8 || key.length > 100) {
      return res.status(400).json({ ok: false, code: "IDEMPOTENCY_KEY_REQUIRED" });
    }
    const result = await commands.openShift({
      ...body, actor, idempotencyKey: key,
      requestId: String(req.headers["x-request-id"] || crypto.randomUUID()).slice(0, 100)
    });
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    const status = Number(error && error.statusCode) || 503;
    if (status >= 500) console.error("[SHIFTS-API] Request failed", { code: error.code || "UNKNOWN" });
    return res.status(status).json({ ok: false, code: error.code || "SHIFT_SERVICE_UNAVAILABLE",
      message: status >= 500 ? "Shift service unavailable." : error.message });
  }
};
