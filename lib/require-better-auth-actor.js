"use strict";

function authError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function toWebHeaders(headers) {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers || {})) {
    if (Array.isArray(value)) result.set(name, value.join(", "));
    else if (typeof value === "string") result.set(name, value);
  }
  return result;
}

async function requireBetterAuthActor(req) {
  const { getBetterAuth } = require("./better-auth");
  const { getPool } = require("./tidb");
  const auth = await getBetterAuth();
  const session = await auth.api.getSession({ headers: toWebHeaders(req && req.headers) });
  if (!session || !session.user || typeof session.user.id !== "string") {
    throw authError("Sesi login tidak ditemukan atau sudah berakhir.", 401, "AUTH_REQUIRED");
  }
  const [rows] = await getPool().execute(
    "SELECT u.user_id, u.display_name, u.active, u.protected_owner, ra.role_code, ra.scope_type, ra.scope_id " +
    "FROM users u JOIN active_role_slots ars ON ars.user_id = u.user_id " +
    "JOIN role_assignments ra ON ra.role_assignment_id = ars.role_assignment_id AND ra.user_id = u.user_id " +
    "WHERE u.user_id = ? AND u.active = 1 AND ra.scope_type = ? AND ra.scope_id IS NULL " +
    "AND ra.valid_from_utc <= UTC_TIMESTAMP(3) AND (ra.valid_to_utc IS NULL OR ra.valid_to_utc > UTC_TIMESTAMP(3)) LIMIT 2",
    [session.user.id, "clinic"]
  );
  if (rows.length !== 1) {
    throw authError(rows.length > 1 ? "Akun memiliki lebih dari satu peran aktif." : "Akun belum diprovisikan pada tabel pengguna klinik.", 403,
      rows.length > 1 ? "AUTH_ROLE_AMBIGUOUS" : "AUTH_IDENTITY_NOT_PROVISIONED");
  }
  const row = rows[0];
  if (!["pimpinan", "admin", "kasir"].includes(row.role_code)) {
    throw authError("Peran akun tidak diizinkan.", 403, "AUTH_ROLE_INVALID");
  }
  return Object.freeze({
    userId: String(row.user_id),
    displayName: String(row.display_name),
    role: row.role_code,
    scopeType: row.scope_type,
    scopeId: row.scope_id === null ? null : String(row.scope_id),
    protectedOwner: Number(row.protected_owner) === 1,
    email: session.user.email || null
  });
}

function requireRole(actor, allowedRoles) {
  if (!actor || !Array.isArray(allowedRoles) || !allowedRoles.includes(actor.role)) {
    throw authError("Akses tidak diizinkan.", 403, "AUTH_FORBIDDEN");
  }
  return actor;
}

module.exports = { requireBetterAuthActor, requireRole, toWebHeaders };
