"use strict";

const crypto = require("node:crypto");
const { requireFirebaseActor, requireRole } = require("../../lib/require-auth");
const { listTariffs, createTariff, updateTariff, deactivateTariff } = require("../../lib/catalog");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, private");
  try {
    const actor = await requireFirebaseActor(req);
    if (req.method === "GET") {
      return res.status(200).json({ ok: true, data: await listTariffs() });
    }
    if (["POST", "PATCH", "DELETE"].includes(req.method)) {
      requireRole(actor, ["admin", "pimpinan"]);
      const key = req.headers["idempotency-key"];
      if (typeof key !== "string" || key.length < 8 || key.length > 100) {
        return res.status(400).json({ ok: false, code: "IDEMPOTENCY_KEY_REQUIRED" });
      }
      const requestId = String(req.headers["x-request-id"] || crypto.randomUUID()).slice(0, 100);
      const result = req.method === "POST"
        ? await createTariff(actor, req.body, key, requestId)
        : req.method === "PATCH"
          ? await updateTariff(actor, req.body, key, requestId)
          : await deactivateTariff(actor, req.body, key, requestId);
      return res.status(result.statusCode).json(result.body);
    }
    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
  } catch (error) {
    const status = Number(error && error.statusCode) || 503;
    if (status >= 500) console.error("[CATALOG-TARIFFS] Request failed", { code: error.code || "UNKNOWN" });
    return res.status(status).json({
      ok: false,
      code: error.code || "CATALOG_SERVICE_UNAVAILABLE",
      message: status >= 500 ? "Catalog service unavailable." : error.message
    });
  }
};
