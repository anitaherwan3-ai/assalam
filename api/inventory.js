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
      const [rows] = await getPool().execute(
        "SELECT m.medicine_id AS medicineId, m.public_id AS publicId, m.name, m.canonical_unit AS unit, m.selling_price AS sellingPrice, m.minimum_stock AS minimumStock, m.active, " +
        "COALESCE(p.physical_quantity, 0) AS physicalQuantity, COALESCE(p.sellable_quantity, 0) AS sellableQuantity, " +
        "COALESCE(p.unknown_hpp_quantity, 0) AS unknownHppQuantity, p.weighted_hpp AS weightedHpp, " +
        "COALESCE(p.profit_calculation_status, 'uncalculated') AS profitCalculationStatus " +
        "FROM medicines m LEFT JOIN medicine_stock_projections p ON p.medicine_id = m.medicine_id WHERE m.active = 1 ORDER BY m.name LIMIT 500"
      );
      return res.status(200).json({ ok: true, data: rows.map(row => ({
        ...row,
        medicineId: String(row.medicineId),
        sellingPrice: String(row.sellingPrice),
        minimumStock: String(row.minimumStock),
        physicalQuantity: String(row.physicalQuantity),
        sellableQuantity: String(row.sellableQuantity),
        unknownHppQuantity: String(row.unknownHppQuantity),
        weightedHpp: row.weightedHpp === null ? null : String(row.weightedHpp)
      })) });
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
