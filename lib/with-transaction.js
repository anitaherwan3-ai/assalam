"use strict";

async function runInTransaction(connection, work) {
  let started = false;
  try {
    await connection.query("SET SESSION time_zone = '+00:00'");
    await connection.query("SET SESSION FOREIGN_KEY_CHECKS = 1");
    const [rows] = await connection.query("SELECT @@SESSION.FOREIGN_KEY_CHECKS AS fk_checks");
    if (Number(rows[0] && rows[0].fk_checks) !== 1) {
      const error = new Error("TiDB foreign key checks are not enabled.");
      error.code = "DB_FOREIGN_KEY_CHECKS_DISABLED";
      throw error;
    }
    await connection.beginTransaction();
    started = true;
    const result = await work(connection);
    await connection.commit();
    started = false;
    return result;
  } catch (error) {
    if (started) {
      try { await connection.rollback(); }
      catch (rollbackError) {
        error.rollbackErrorCode = rollbackError && rollbackError.code
          ? rollbackError.code : "ROLLBACK_FAILED";
      }
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function withTransaction(work) {
  if (typeof work !== "function") throw new TypeError("Transaction work callback is required.");
  const { getPool } = require("./tidb");
  const connection = await getPool().getConnection();
  return runInTransaction(connection, work);
}

module.exports = { withTransaction, runInTransaction };
