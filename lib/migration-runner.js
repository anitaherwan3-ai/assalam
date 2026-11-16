"use strict";

async function applyMigrations(connection, migrations) {
  if (!connection || !Array.isArray(migrations)) throw new TypeError("Connection and migration list are required.");
  await connection.query("SET SESSION time_zone = '+00:00'");
  await connection.query("SET SESSION FOREIGN_KEY_CHECKS = 1");
  const [fkRows] = await connection.query("SELECT @@SESSION.FOREIGN_KEY_CHECKS AS fk_checks");
  if (Number(fkRows[0] && fkRows[0].fk_checks) !== 1) {
    const error = new Error("TiDB foreign key checks are not enabled for this session.");
    error.code = "DB_FOREIGN_KEY_CHECKS_DISABLED";
    throw error;
  }

  await connection.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (" +
    "version VARCHAR(120) NOT NULL, " +
    "description VARCHAR(255) NOT NULL, " +
    "applied_at_utc DATETIME(3) NOT NULL, " +
    "PRIMARY KEY (version)) " +
    "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin"
  );

  const applied = [];
  const alreadyApplied = [];
  for (const migration of migrations) {
    if (!migration || typeof migration.version !== "string" ||
        !Array.isArray(migration.statements) || !migration.statements.length) {
      throw new TypeError("Invalid migration definition.");
    }
    const [existing] = await connection.execute(
      "SELECT version FROM schema_migrations WHERE version = ? LIMIT 1",
      [migration.version]
    );
    if (!existing.length) {
      for (const statement of migration.statements) await connection.query(statement);
    }

    const expectedTables = migration.expectedTables || [
      "users", "role_assignments", "active_role_slots", "firebase_identities"
    ];
    const placeholders = expectedTables.map(() => "?").join(", ");
    const [tables] = await connection.execute(
      "SELECT TABLE_NAME AS table_name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (" + placeholders + ")",
      expectedTables
    );
    const names = tables.map(row => row.table_name).sort();
    if (names.length !== expectedTables.length) {
      const error = new Error("Migration table verification failed for " + migration.version);
      error.code = "DB_MIGRATION_VERIFY_FAILED";
      throw error;
    }

    if (!existing.length) {
      await connection.execute(
        "INSERT INTO schema_migrations (version, description, applied_at_utc) VALUES (?, ?, UTC_TIMESTAMP(3))",
        [migration.version, migration.description]
      );
      applied.push(migration.version);
    } else {
      alreadyApplied.push(migration.version);
    }
  }
  return { applied, alreadyApplied, current: migrations.map(item => item.version) };
}

module.exports = { applyMigrations };
