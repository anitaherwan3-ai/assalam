"use strict";

const crypto = require("node:crypto");

function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Idempotency payload contains a non-finite number.");
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new TypeError("Idempotency payload contains an invalid date.");
    return value.toISOString();
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Idempotency payload must contain plain objects only.");
    }
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) throw new TypeError("Idempotency payload contains undefined.");
      result[key] = canonicalize(value[key]);
    }
    return result;
  }
  throw new TypeError("Idempotency payload contains an unsupported value.");
}

function hashPayload(payload) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(canonicalize(payload)), "utf8")
    .digest("hex");
}

function conflict(message, code) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  return error;
}

function parseResponse(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); }
  catch (_) { throw new Error("Stored idempotency response is invalid JSON."); }
}

async function claimIdempotency(connection, input) {
  if (!input || typeof input.actorUserId !== "string" || !input.actorUserId ||
      typeof input.commandName !== "string" || !/^[a-z][a-z0-9_.-]{1,99}$/.test(input.commandName) ||
      typeof input.idempotencyKey !== "string" || input.idempotencyKey.length < 8 ||
      input.idempotencyKey.length > 100 || !Object.prototype.hasOwnProperty.call(input, "payload")) {
    throw new TypeError("Invalid idempotency command metadata.");
  }
  const requestHash = hashPayload(input.payload);

  try {
    const [result] = await connection.execute(
      "INSERT INTO idempotency_requests (actor_user_id, command_name, idempotency_key, request_hash, status, created_at_utc) VALUES (?, ?, ?, ?, 'processing', UTC_TIMESTAMP(3))",
      [input.actorUserId, input.commandName, input.idempotencyKey, requestHash]
    );
    return {
      replayed: false,
      idempotencyId: String(result.insertId),
      requestHash
    };
  } catch (error) {
    if (!(error && (error.code === "ER_DUP_ENTRY" || error.errno === 1062))) throw error;
  }

  const [rows] = await connection.execute(
    "SELECT idempotency_id, request_hash, status, response_code, response_json, entity_type, entity_id FROM idempotency_requests WHERE actor_user_id = ? AND command_name = ? AND idempotency_key = ? FOR UPDATE",
    [input.actorUserId, input.commandName, input.idempotencyKey]
  );
  if (rows.length !== 1) throw conflict("Idempotency key is being processed; retry shortly.", "IDEMPOTENCY_IN_PROGRESS");
  const prior = rows[0];
  if (String(prior.request_hash) !== requestHash) {
    throw conflict("Idempotency key was already used with a different request.", "IDEMPOTENCY_KEY_REUSED");
  }
  if (prior.status === "completed") {
    return {
      replayed: true,
      idempotencyId: String(prior.idempotency_id),
      responseCode: Number(prior.response_code) || 200,
      response: parseResponse(prior.response_json),
      entityType: prior.entity_type || null,
      entityId: prior.entity_id === null ? null : String(prior.entity_id),
      requestHash
    };
  }
  throw conflict("The original command is still in progress.", "IDEMPOTENCY_IN_PROGRESS");
}

async function completeIdempotency(connection, input) {
  if (!input || !input.idempotencyId || !Number.isInteger(input.responseCode) ||
      input.responseCode < 100 || input.responseCode > 599) {
    throw new TypeError("Invalid idempotency completion metadata.");
  }
  const json = JSON.stringify(canonicalize(input.response === undefined ? null : input.response));
  const [result] = await connection.execute(
    "UPDATE idempotency_requests SET status = 'completed', response_code = ?, response_json = ?, entity_type = ?, entity_id = ? WHERE idempotency_id = ? AND status = 'processing'",
    [input.responseCode, json, input.entityType || null, input.entityId === undefined ? null : String(input.entityId), input.idempotencyId]
  );
  if (Number(result.affectedRows) !== 1) {
    throw conflict("Idempotency claim is no longer in a processing state.", "IDEMPOTENCY_STATE_CONFLICT");
  }
}

module.exports = { canonicalize, hashPayload, claimIdempotency, completeIdempotency };
