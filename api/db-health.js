"use strict";

const { getPool } = require("../lib/tidb");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      ok: false,
      message: "Method not allowed"
    });
  }

  try {
    const db = getPool();
    const [rows] = await db.query("SELECT 1 AS connected");

    if (!rows || Number(rows[0] && rows[0].connected) !== 1) {
      const error = new Error("Database health check returned an unexpected result");
      error.code = "DB_HEALTH_CHECK_FAILED";
      throw error;
    }

    return res.status(200).json({
      ok: true,
      service: "tidb",
      status: "connected"
    });
  } catch (error) {
    // Never return connection details, SQL, hostnames, or credentials to clients.
    console.error("[DB-HEALTH] TiDB connection failed", {
      code: error && error.code ? error.code : "UNKNOWN"
    });

    return res.status(503).json({
      ok: false,
      service: "tidb",
      status: "unavailable",
      message: "Database connection failed"
    });
  }
};
