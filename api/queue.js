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
      if (req.query && (req.query.all_assignments === "1" || req.query.all_assignments === "true")) {
        if (actor.role !== "pimpinan") return res.status(403).json({ ok: false, code: "SHIFT_ASSIGNMENT_FORBIDDEN" });
        const { getPool } = require("../lib/tidb");
        const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
        const [assignments] = await getPool().execute(
          "SELECT a.assignment_id AS assignmentId, a.user_id AS userId, u.display_name AS userName, a.prefix, " +
          "DATE_FORMAT(a.valid_from, '%Y-%m-%d') AS validFrom, DATE_FORMAT(a.valid_to, '%Y-%m-%d') AS validTo " +
          "FROM cashier_queue_assignments a JOIN users u ON u.user_id = a.user_id " +
          "JOIN active_role_slots ars ON ars.user_id = a.user_id JOIN role_assignments ra ON ra.role_assignment_id = ars.role_assignment_id AND ra.user_id = ars.user_id AND ra.role_code = 'kasir' AND ra.valid_from_utc <= UTC_TIMESTAMP(3) AND (ra.valid_to_utc IS NULL OR ra.valid_to_utc > UTC_TIMESTAMP(3)) " +
          "WHERE a.valid_from <= ? AND (a.valid_to IS NULL OR a.valid_to >= ?) " +
          "AND a.assignment_id = (SELECT MAX(a2.assignment_id) FROM cashier_queue_assignments a2 WHERE a2.user_id = a.user_id AND a2.valid_from <= ? AND (a2.valid_to IS NULL OR a2.valid_to >= ?)) " +
          "ORDER BY a.prefix, u.display_name",
          [date, date, date, date]
        );
        return res.status(200).json({ ok: true, data: assignments });
      }
      if (req.query && (req.query.assignments === "1" || req.query.assignments === "true")) {
        const { getPool } = require("../lib/tidb");
        const [assignments] = await getPool().execute(
          "SELECT a.assignment_id AS assignmentId, a.user_id AS userId, u.display_name AS userName, " +
          "a.prefix, s.shift_id AS shiftId, s.shift_code AS shiftCode, (a.user_id = ?) AS isCurrentUser, DATE_FORMAT(a.valid_from, '%Y-%m-%d') AS validFrom, DATE_FORMAT(a.valid_to, '%Y-%m-%d') AS validTo " +
          "FROM cashier_queue_assignments a JOIN users u ON u.user_id = a.user_id " +
          "JOIN active_shift_slots active ON active.cashier_user_id = a.user_id " +
          "JOIN active_role_slots ars ON ars.user_id = a.user_id JOIN role_assignments ra ON ra.role_assignment_id = ars.role_assignment_id AND ra.user_id = ars.user_id AND ra.role_code = 'kasir' AND ra.valid_from_utc <= UTC_TIMESTAMP(3) AND (ra.valid_to_utc IS NULL OR ra.valid_to_utc > UTC_TIMESTAMP(3)) " +
          "JOIN cashier_shifts s ON s.shift_id = active.shift_id AND s.cashier_user_id = a.user_id AND s.status = 'open' " +
          "WHERE a.valid_to IS NULL ORDER BY a.valid_from DESC", [actor.userId]
        );
        return res.status(200).json({ ok: true, data: assignments });
      }
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
    else if (body.action === "cancel_encounter") result = await commands.cancelEncounter(value);
    else if (body.action === "restore_encounter") result = await commands.restoreEncounter(value);
    else if (body.action === "call") result = await commands.appendQueueCallEvent(value);
    else if (body.action === "transfer") result = await commands.transferQueue(value);
    else if (body.action === "assign_lane") result = await commands.assignQueueLane(value);
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
