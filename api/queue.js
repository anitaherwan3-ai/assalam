"use strict";

const crypto = require("node:crypto");
const { requireBetterAuthActor } = require("../lib/require-better-auth-actor");
const { createClinicDomainCommands } = require("../lib/clinic-domain-commands");
const { createTidbQueueRepository } = require("../lib/repositories/tidb-queue-repository");

const queueRepository = createTidbQueueRepository();
const commands = createClinicDomainCommands({ repository: queueRepository });

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, private");
  try {
    const isDisplay = req.query && (req.query.display === "1" || req.query.display === "true");
    if (req.method === "GET" && isDisplay) {
      const displayData = await queueRepository.getDisplayQueue();
      return res.status(200).json({ ok: true, data: displayData });
    }

    const actor = await requireBetterAuthActor(req);
    if (req.method === "GET") {
      const rows = await queueRepository.listQueueTickets();
      const visible = actor.role === "kasir"
        ? rows.filter(row => row.cashierUserId === actor.userId)
        : rows;
      return res.status(200).json({ ok: true, data: visible });
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
    if (body.action === "register") result = await commands.registerEncounter(value);
    else if (body.action === "call") result = await commands.appendQueueCallEvent(value);
    else if (body.action === "transfer") result = await commands.transferQueue(value);
    else return res.status(400).json({ ok: false, code: "QUEUE_ACTION_INVALID" });

    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    const status = Number(error && error.statusCode) || 503;
    if (status >= 500) console.error("[QUEUE-API] Request failed", { code: error.code || "UNKNOWN" });
    return res.status(status).json({
      ok: false,
      code: error.code || "QUEUE_SERVICE_UNAVAILABLE",
      message: status >= 500 ? "Queue service unavailable." : error.message
    });
  }
};
