"use strict";

const crypto = require("node:crypto");
const { getPool } = require("../lib/tidb");
const migration = require("../lib/migrations/001_identity_foundation");

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
  if (!req.body || req.body.confirm !== "APPLY_ASSALAM_IDENTITY_V1") {
    return res.status(400).json({ ok: false, code: "MIGRATION_CONFIRMATION_REQUIRED" });
  }

  let connection;
  try {
    const pool = getPool();
    connection = await pool.getConnection();
    await connection.query("SET SESSION FOREIGN_KEY_CHECKS = 1");
    const [fkRows] = await connection.query("SELECT @@SESSION.FOREIGN_KEY_CHECKS AS fk_checks");
    if (Number(fkRows[0] && fkRows[0].fk_checks) !== 1) {
      throw new Error("TiDB foreign key checks are not enabled for this session.");
    }

    await connection.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (" +
      "version VARCHAR(120) NOT NULL, " +
      "description VARCHAR(255) NOT NULL, " +
      "applied_at_utc DATETIME(3) NOT NULL, " +
      "PRIMARY KEY (version)) " +
      "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin"
    );

    const [existing] = await connection.execute(
      "SELECT version FROM schema_migrations WHERE version = ? LIMIT 1",
      [migration.version]
    );

    if (!existing.length) {
      for (const statement of migration.statements) {
        await connection.query(statement);
      }
    }

    const [tables] = await connection.execute(
      "SELECT TABLE_NAME AS table_name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?, ?, ?)",
      ["users", "role_assignments", "active_role_slots", "firebase_identities"]
    );
    const names = tables.map(row => row.table_name).sort();
    if (names.length !== 4) {
      throw new Error("Identity foundation table verification failed.");
    }

    if (!existing.length) {
      await connection.execute(
        "INSERT INTO schema_migrations (version, description, applied_at_utc) VALUES (?, ?, UTC_TIMESTAMP(3))",
        [migration.version, migration.description]
      );
    }

    return res.status(200).json({
      ok: true,
      status: existing.length ? "already_applied" : "applied",
      version: migration.version,
      tables: names,
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
