"use strict";

const crypto = require("node:crypto");

function bootstrapError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function bootstrapPreviewOwner(connection, identity, allowedEmail) {
  if (!identity || typeof identity.uid !== "string" || !identity.uid ||
      typeof identity.email !== "string" || identity.email !== allowedEmail) {
    throw bootstrapError("Only the configured preview owner identity may be bootstrapped.", 403, "BOOTSTRAP_IDENTITY_NOT_ALLOWED");
  }

  const [existing] = await connection.execute(
    "SELECT u.user_id, u.active, u.protected_owner, ra.role_code " +
    "FROM firebase_identities fi " +
    "JOIN users u ON u.user_id = fi.user_id " +
    "LEFT JOIN active_role_slots ars ON ars.user_id = u.user_id " +
    "LEFT JOIN role_assignments ra ON ra.role_assignment_id = ars.role_assignment_id AND ra.user_id = u.user_id " +
    "WHERE fi.provider = 'firebase' AND fi.subject_uid = ? LIMIT 2 FOR UPDATE",
    [identity.uid]
  );
  if (existing.length) {
    const row = existing[0];
    if (existing.length === 1 && Number(row.active) === 1 &&
        Number(row.protected_owner) === 1 && row.role_code === "pimpinan") {
      return { status: "already_provisioned", userId: String(row.user_id) };
    }
    throw bootstrapError("A TiDB identity already exists but does not match the protected preview-owner profile; no changes were made.", 409, "BOOTSTRAP_EXISTING_IDENTITY_CONFLICT");
  }

  const userId = crypto.randomUUID().replace(/-/g, "");
  await connection.execute(
    "INSERT INTO users (user_id, display_name, active, protected_owner, created_at_utc, updated_at_utc, version) VALUES (?, ?, 1, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), 1)",
    [userId, identity.displayName || "Pimpinan Preview"]
  );
  const [roleResult] = await connection.execute(
    "INSERT INTO role_assignments (user_id, role_code, scope_type, scope_id, valid_from_utc, valid_to_utc, granted_by_user_id, created_at_utc) VALUES (?, 'pimpinan', 'clinic', NULL, UTC_TIMESTAMP(3), NULL, ?, UTC_TIMESTAMP(3))",
    [userId, userId]
  );
  await connection.execute(
    "INSERT INTO active_role_slots (user_id, role_assignment_id, activated_at_utc) VALUES (?, ?, UTC_TIMESTAMP(3))",
    [userId, roleResult.insertId]
  );
  await connection.execute(
    "INSERT INTO firebase_identities (provider, subject_uid, user_id, email_snapshot, created_at_utc, last_seen_at_utc) VALUES ('firebase', ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
    [identity.uid, userId, identity.email]
  );
  return { status: "provisioned", userId };
}

module.exports = { bootstrapPreviewOwner };
