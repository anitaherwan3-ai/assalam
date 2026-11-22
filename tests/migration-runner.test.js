"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMigrations } = require("../lib/migration-runner");

const migrations = [
  { version: "001", description: "first", statements: ["CREATE TABLE IF NOT EXISTS alpha (id INT)"], expectedTables: ["alpha"] },
  { version: "002", description: "second", statements: ["CREATE TABLE IF NOT EXISTS beta (id INT)"], expectedTables: ["beta"] }
];

function mockConnection(fkEnabled = 1) {
  const tables = new Set();
  const versions = new Set();
  const ddl = [];
  return {
    tables, versions, ddl,
    async query(sql) {
      if (sql.includes("FOREIGN_KEY_CHECKS AS")) return [[{ fk_checks: fkEnabled }]];
      const match = sql.match(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/i);
      if (match) {
        tables.add(match[1]);
        if (match[1] !== "schema_migrations") ddl.push(match[1]);
      }
      return [{ affectedRows: 0 }];
    },
    async execute(sql, params) {
      if (sql.includes("SELECT version FROM schema_migrations")) {
        return [[...(versions.has(params[0]) ? [{ version: params[0] }] : [])]];
      }
      if (sql.includes("INFORMATION_SCHEMA.TABLES")) {
        return [[...params.filter(name => tables.has(name)).map(table_name => ({ table_name }))]];
      }
      if (sql.includes("INSERT INTO schema_migrations")) {
        versions.add(params[0]);
        return [{ affectedRows: 1 }];
      }
      throw new Error("Unexpected SQL in migration test: " + sql);
    }
  };
}

test("migration runner applies ordered migrations and verifies expected tables", async () => {
  const connection = mockConnection();
  const result = await applyMigrations(connection, migrations);
  assert.deepEqual(result.applied, ["001", "002"]);
  assert.deepEqual(result.current, ["001", "002"]);
  assert.deepEqual([...connection.tables].sort(), ["alpha", "beta", "schema_migrations"]);
});

test("migration runner is idempotent after successful application", async () => {
  const connection = mockConnection();
  await applyMigrations(connection, migrations);
  const firstDdlCount = connection.ddl.length;
  const result = await applyMigrations(connection, migrations);
  assert.deepEqual(result.applied, []);
  assert.deepEqual(result.alreadyApplied, ["001", "002"]);
  assert.equal(connection.ddl.length, firstDdlCount);
});

test("migration runner stops when foreign key checks are disabled", async () => {
  const connection = mockConnection(0);
  await assert.rejects(
    applyMigrations(connection, migrations),
    error => error.code === "DB_FOREIGN_KEY_CHECKS_DISABLED"
  );
  assert.equal(connection.versions.size, 0);
});


test("package base tables are created before snapshot migration 016 on a clean schema", () => {
  const operational = require("../lib/migrations/009_operational_controls_v1");
  const snapshots = require("../lib/migrations/016_service_package_price_snapshots");
  const buildScript = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "scripts", "apply-preview-migrations.js"),
    "utf8"
  );

  assert.ok(operational.expectedTables.includes("service_packages"));
  assert.ok(operational.expectedTables.includes("package_components"));
  assert.ok(operational.statements.some(sql => /CREATE TABLE IF NOT EXISTS service_packages/.test(sql)));
  assert.ok(operational.statements.some(sql => /CREATE TABLE IF NOT EXISTS package_components/.test(sql)));
  assert.deepEqual(snapshots.expectedTables, ["service_packages", "package_components"]);
  assert.ok(snapshots.statements.every(sql => /^ALTER TABLE (service_packages|package_components) /.test(sql)));

  const packageBasePosition = buildScript.indexOf('require("../lib/migrations/009_operational_controls_v1")');
  const packageSnapshotPosition = buildScript.indexOf('require("../lib/migrations/016_service_package_price_snapshots")');
  assert.ok(packageBasePosition >= 0, "base package migration must be included");
  assert.ok(packageSnapshotPosition > packageBasePosition, "package snapshot migration must run after base tables");
});
