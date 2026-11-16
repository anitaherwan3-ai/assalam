"use strict";

const { execFileSync } = require("node:child_process");

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
  if (process.env.TIDB_MIGRATION_BUILD_CONFIRM !== "ASSALAM_OPERATIONAL_SCHEMA_V1_PASS62") {
    throw new Error("Preview migration build confirmation is missing or invalid.");
  }

  const { getPool } = require("../lib/tidb");
  const migrations = [
    require("../lib/migrations/001_identity_foundation"),
    require("../lib/migrations/002_audit_idempotency_outbox"),
    require("../lib/migrations/003_catalog_masters"),
    require("../lib/migrations/004_better_auth_core"),
    require("../lib/migrations/005_patient_shift_queue_v1"),
    require("../lib/migrations/006_inventory_purchasing_v1"),
    require("../lib/migrations/007_sales_returns_refunds_v1"),
    require("../lib/migrations/008_finance_controls_v1"),
    require("../lib/migrations/009_operational_controls_v1"),
    require("../lib/migrations/010_supplier_return_dispatch_reference"),
    require("../lib/migrations/011_quarantine_inspection_decision"),
    require("../lib/migrations/012_stocktake_batch_version_snapshot"),
    require("../lib/migrations/013_quarantine_disposition_approval")
  ];
  const { applyMigrations } = require("../lib/migration-runner");
  const { runFoundationSmokeTest } = require("../lib/migration-smoke-test");
  const { runOperationalSmokeTest } = require("../lib/operational-smoke-test");
  const pool = getPool();
  let connection;
  try {
    connection = await pool.getConnection();
    const result = await applyMigrations(connection, migrations);
    const smoke = await runFoundationSmokeTest(connection);
    const operationalSmoke = await runOperationalSmokeTest(connection);
    execFileSync("npm", ["run", "auth:schema-check"], { stdio: "inherit", env: process.env });
    console.log("[ASSALAM-MIGRATION] Preview operational schema and Better Auth schema verified", {
      applied: result.applied,
      alreadyApplied: result.alreadyApplied,
      current: result.current,
      foundationSmokeTest: smoke,
      operationalSmokeTest: operationalSmoke
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
