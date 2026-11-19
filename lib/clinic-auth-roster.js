"use strict";

// Bootstrap allowlist only. Once provisioned, the clinic database owns role changes.
const ROSTER = Object.freeze({
  "praktekrose@gmail.com": Object.freeze({ role: "pimpinan", protectedOwner: true }),
  "nursalim42@gmail.com": Object.freeze({ role: "pimpinan", protectedOwner: false }),
  "assalamkasir1@gmail.com": Object.freeze({ role: "kasir", protectedOwner: false }),
  "assalamkasir2@gmail.com": Object.freeze({ role: "kasir", protectedOwner: false }),
  "assalamadmin1@gmail.com": Object.freeze({ role: "admin", protectedOwner: false })
});

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function getBootstrapIdentity(email) {
  const normalized = normalizeEmail(email);
  const entry = ROSTER[normalized];
  return entry ? Object.freeze({ email: normalized, role: entry.role, protectedOwner: entry.protectedOwner }) : null;
}

module.exports = { ROSTER, normalizeEmail, getBootstrapIdentity };
