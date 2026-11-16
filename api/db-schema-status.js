"use strict";

const { getPool } = require("../lib/tidb");

const expected = [
  "users", "role_assignments", "active_role_slots", "firebase_identities",
  "audit_events", "idempotency_requests", "outbox_jobs"
];

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
  }
  try {
    const [versions] = await getPool().execute(
      "SELECT version, applied_at_utc FROM schema_migrations ORDER BY version"
    );
    const placeholders = expected.map(() => "?").join(", ");
    const [tables] = await getPool().execute(
      "SELECT TABLE_NAME AS table_name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (" + placeholders + ")",
      expected
    );
    const found = tables.map(row => row.table_name).sort();
    const missing = expected.filter(name => !found.includes(name));
    return res.status(missing.length ? 503 : 200).json({
      ok: missing.length === 0,
      service: "assalam-tidb-schema",
      versions: versions.map(row => row.version),
      tables: found,
      missing
    });
  } catch (error) {
    console.error("[DB-SCHEMA-STATUS] Schema status unavailable", {
      code: error && error.code ? error.code : "UNKNOWN"
    });
    return res.status(503).json({ ok: false, code: "SCHEMA_STATUS_UNAVAILABLE" });
  }
};
