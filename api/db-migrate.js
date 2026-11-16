"use strict";

const crypto = require("node:crypto");
const { getPool } = require("../lib/tidb");
const migrations = [
  require("../lib/migrations/001_identity_foundation"),
  require("../lib/migrations/002_audit_idempotency_outbox"),
  require("../lib/migrations/003_catalog_masters")
];
const { applyMigrations } = require("../lib/migration-runner");

function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && a.length >= 32 && crypto.timingSafeEqual(a, b);
}

function isPreviewMigrationAllowed() {
  return process.env.VERCEL_ENV === "preview" &&
    process.env.VERCEL_GIT_COMMIT_REF === "migration/tidb-foundation" &&
    process.env.TIDB_DATABASE === "assalam_db" &&
    process.env.TIDB_MIGRATIONS_ENABLED === "true";
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, private");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
  }
  if (!isPreviewMigrationAllowed()) {
    return res.status(404).json({ ok: false, code: "MIGRATION_RUNNER_DISABLED" });
  }

  const expectedToken = process.env.ASSALAM_MIGRATION_TOKEN;
  const suppliedToken = req.headers["x-assalam-migration-token"];
  if (!safeEqual(suppliedToken, expectedToken)) {
    return res.status(403).json({ ok: false, code: "MIGRATION_TOKEN_INVALID" });
  }
  if (!req.body || req.body.confirm !== "APPLY_ASSALAM_FOUNDATION_V1") {
    return res.status(400).json({ ok: false, code: "MIGRATION_CONFIRMATION_REQUIRED" });
  }

  let connection;
  try {
    const pool = getPool();
    connection = await pool.getConnection();
    const result = await applyMigrations(connection, migrations);
    return res.status(200).json({
      ok: true,
      status: result.applied.length ? "applied" : "already_applied",
      applied: result.applied,
      alreadyApplied: result.alreadyApplied,
      current: result.current,
      note: "No user, role, Firebase UID, or operational data was inserted or modified."
    });
  } catch (error) {
    console.error("[DB-MIGRATE] Identity migration failed", {
      code: error && error.code ? error.code : "UNKNOWN"
    });
    return res.status(500).json({
      ok: false,
      code: "IDENTITY_MIGRATION_FAILED",
      message: "Migration failed; inspect migration status before retrying."
    });
  } finally {
    if (connection) connection.release();
  }
};
