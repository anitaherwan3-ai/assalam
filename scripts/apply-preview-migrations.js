"use strict";

function migrationBuildEnabled() {
  return process.env.VERCEL_ENV === "preview" &&
    process.env.VERCEL_GIT_COMMIT_REF === "migration/tidb-foundation" &&
    process.env.TIDB_DATABASE === "assalam_db" &&
    process.env.TIDB_MIGRATIONS_ENABLED === "true";
}

async function main() {
  if (!migrationBuildEnabled()) {
    console.log("[ASSALAM-MIGRATION] Preview migration step skipped; deployment is not the explicitly enabled TiDB migration preview.");
    return;
  }
  if (process.env.TIDB_MIGRATION_BUILD_CONFIRM !== "ASSALAM_FOUNDATION_V1") {
    throw new Error("Preview migration build confirmation is missing or invalid.");
  }

  const { getPool } = require("../lib/tidb");
  const migrations = [
    require("../lib/migrations/001_identity_foundation"),
    require("../lib/migrations/002_audit_idempotency_outbox"),
    require("../lib/migrations/003_catalog_masters")
  ];
  const { applyMigrations } = require("../lib/migration-runner");
  const { runFoundationSmokeTest } = require("../lib/migration-smoke-test");
  const pool = getPool();
  let connection;
  try {
    connection = await pool.getConnection();
    const result = await applyMigrations(connection, migrations);
    const smoke = await runFoundationSmokeTest(connection);
    console.log("[ASSALAM-MIGRATION] Preview foundation migration verified", {
      applied: result.applied,
      alreadyApplied: result.alreadyApplied,
      current: result.current,
      syntheticSmokeTest: smoke
    });
  } catch (error) {
    console.error("[ASSALAM-MIGRATION] Preview migration failed", {
      code: error && error.code ? error.code : "UNKNOWN"
    });
    throw error;
  } finally {
    if (connection) connection.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error("[ASSALAM-MIGRATION] Build stopped; database migration was not confirmed.", {
    code: error && error.code ? error.code : "UNKNOWN"
  });
  process.exitCode = 1;
});
