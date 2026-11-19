"use strict";

const { getBootstrapIdentity, normalizeEmail } = require("./clinic-auth-roster");
const ROLES = Object.freeze(["pimpinan", "admin", "kasir"]);

function providerRole(clinicRole) {
  if (!ROLES.includes(clinicRole)) throw new TypeError("Peran klinik tidak valid.");
  return clinicRole === "pimpinan" ? "admin" : "user";
}

function validateNewUser(input) {
  if (!input || typeof input !== "object") throw new TypeError("Data akun wajib diisi.");
  const email = normalizeEmail(input.email);
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const role = input.role;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new TypeError("Email tidak valid.");
  if (!name || name.length > 120) throw new TypeError("Nama wajib diisi (maksimal 120 karakter).");
  if (!ROLES.includes(role)) throw new TypeError("Peran klinik tidak valid.");
  if (password.length < 12 || password.length > 128) throw new TypeError("Password harus 12–128 karakter.");
  if (getBootstrapIdentity(email)) {
    const error = new Error("Email lima akun awal sudah dicadangkan dan tidak dapat dibuat ulang.");
    error.code = "BOOTSTRAP_ROSTER_RESERVED";
    throw error;
  }
  return { email, name, password, role, providerRole: providerRole(role) };
}

function assertRosterImmutable(email, nextEmail, nextRole, userId, protectedOwner) {
  const current = getBootstrapIdentity(email);
  if (protectedOwner || current) {
    const unchangedEmail = normalizeEmail(nextEmail || email) === normalizeEmail(email);
    const unchangedRole = !nextRole || nextRole === current?.role;
    if (!unchangedEmail || !unchangedRole) {
      const error = new Error("Email dan peran lima akun awal tidak boleh diubah.");
      error.code = "BOOTSTRAP_ROSTER_IMMUTABLE";
      throw error;
    }
    const { ROSTER } = require("./clinic-auth-roster");
    if (current && userId === "never-match-placeholder") throw new Error("Invalid identity.");
  }
  return true;
}

module.exports = { ROLES, providerRole, validateNewUser, assertRosterImmutable };
