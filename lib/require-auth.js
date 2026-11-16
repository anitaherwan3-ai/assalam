"use strict";

const { verifyFirebaseIdToken } = require("./firebase-token");

function authError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function verifyFirebaseRequest(req) {
  const header = req && req.headers && req.headers.authorization;
  const match = typeof header === "string" && header.match(/^Bearer\\s+([^\\s]+)$/i);
  if (!match) throw authError("Bearer token is required.", 401, "AUTH_REQUIRED");
  return verifyFirebaseIdToken(match[1], process.env.FIREBASE_PROJECT_ID);
}

async function requireFirebaseActor(req) {
  const identity = await verifyFirebaseRequest(req);
  const { getPool } = require("./tidb");
  const db = getPool();
  const [rows] = await db.execute(
    `SELECT u.user_id, u.display_name, u.active, u.protected_owner,
            ra.role_code, ra.scope_type, ra.scope_id
       FROM firebase_identities fi
       JOIN users u ON u.user_id = fi.user_id
       JOIN active_role_slots ars ON ars.user_id = u.user_id
       JOIN role_assignments ra
         ON ra.role_assignment_id = ars.role_assignment_id
        AND ra.user_id = u.user_id
      WHERE fi.provider = 'firebase'
        AND fi.subject_uid = ?
        AND u.active = 1
        AND ra.valid_from_utc <= UTC_TIMESTAMP(3)
        AND (ra.valid_to_utc IS NULL OR ra.valid_to_utc > UTC_TIMESTAMP(3))
      LIMIT 2`,
    [identity.uid]
  );

  if (rows.length !== 1) {
    throw authError(
      rows.length > 1 ? "Account has ambiguous active role assignments." : "Firebase identity has not been provisioned in TiDB.",
      403,
      rows.length > 1 ? "AUTH_ROLE_AMBIGUOUS" : "AUTH_IDENTITY_NOT_PROVISIONED"
    );
  }

  const row = rows[0];
  if (!["pimpinan", "admin", "kasir"].includes(row.role_code) ||
      row.scope_type !== "clinic") {
    throw authError("Account role or scope is not authorized.", 403, "AUTH_ROLE_INVALID");
  }

  return Object.freeze({
    userId: String(row.user_id),
    displayName: String(row.display_name),
    role: row.role_code,
    scopeType: row.scope_type,
    scopeId: row.scope_id === null ? null : String(row.scope_id),
    protectedOwner: Number(row.protected_owner) === 1,
    firebaseUid: identity.uid,
    email: identity.email
  });
}

function requireRole(actor, allowedRoles) {
  if (!actor || !Array.isArray(allowedRoles) || !allowedRoles.includes(actor.role)) {
    throw authError("Insufficient permission for this operation.", 403, "AUTH_FORBIDDEN");
  }
  return actor;
}

module.exports = { verifyFirebaseRequest, requireFirebaseActor, requireRole };
