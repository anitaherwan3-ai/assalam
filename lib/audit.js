"use strict";

const crypto = require("node:crypto");
const { canonicalize } = require("./idempotency");

const SECRET_KEY = /password|passcode|token|secret|api.?key|authorization|cookie|^pw$/i;

function assertSafeSnapshot(value, path = "snapshot") {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeSnapshot(item, path + "[" + index + "]"));
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) {
      const error = new Error("Audit snapshot contains a prohibited credential field.");
      error.code = "AUDIT_SECRET_FIELD_BLOCKED";
      throw error;
    }
    assertSafeSnapshot(item, path + "." + key);
  }
}

function encodeSnapshot(value) {
  if (value === undefined || value === null) return null;
  assertSafeSnapshot(value);
  const json = JSON.stringify(canonicalize(value));
  if (Buffer.byteLength(json, "utf8") > 65536) {
    const error = new Error("Audit snapshot exceeds the 64 KiB limit.");
    error.code = "AUDIT_SNAPSHOT_TOO_LARGE";
    throw error;
  }
  return json;
}

async function writeAuditEvent(connection, event) {
  if (!event || typeof event.actionCode !== "string" || !event.actionCode ||
      typeof event.entityType !== "string" || !event.entityType ||
      typeof event.entityId !== "string" || !event.entityId ||
      typeof event.requestId !== "string" || !event.requestId) {
    throw new TypeError("Audit event requires action, entity and request identifiers.");
  }
  if (event.sourceIpHash !== undefined && event.sourceIpHash !== null &&
      !/^[a-f0-9]{64}$/i.test(event.sourceIpHash)) {
    throw new TypeError("Audit source IP must be a SHA-256 hash, never a raw address.");
  }
  const [result] = await connection.execute(
    "INSERT INTO audit_events (event_uuid, actor_user_id, actor_role_snapshot, action_code, entity_type, entity_id, before_json, after_json, reason, request_id, occurred_at_utc, source_ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?)",
    [
      crypto.randomUUID(),
      event.actorUserId || null,
      event.actorRole || null,
      event.actionCode,
      event.entityType,
      event.entityId,
      encodeSnapshot(event.before),
      encodeSnapshot(event.after),
      event.reason || null,
      event.requestId,
      event.sourceIpHash || null
    ]
  );
  return String(result.insertId);
}

module.exports = { writeAuditEvent, encodeSnapshot };
