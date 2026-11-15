"use strict";

const crypto = require("node:crypto");
const mysql = require("mysql2/promise");

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  return res.end(JSON.stringify(body, null, 2));
}

function page(res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  return res.end(`<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TiDB Preview Compatibility Check</title><body style="font:16px system-ui;max-width:720px;margin:40px auto;padding:0 18px;line-height:1.5"><h2>TiDB Preview Compatibility Check</h2><p>Halaman ini hanya untuk project preview migrasi Klinik Assalaam. Tombol akan membuat tabel uji sintetis dengan nama acak, menguji foreign key, unique index, transaksi, DECIMAL/BIGINT, EXPLAIN, dan row lock, lalu menghapus semua tabel uji.</p><p><b>Tidak ada tabel aplikasi atau data klinik yang disentuh.</b></p><form method="post"><label for="token">Token akses pengujian (diatur sebagai COMPATIBILITY_TEST_TOKEN pada preview)</label><p><input id="token" name="token" type="password" autocomplete="off" required style="width:100%;padding:10px;box-sizing:border-box"></p><button style="padding:12px 18px;font-size:16px">Jalankan tes kompatibilitas</button></form></body></html>`);
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");

  // Fail closed: this diagnostic must never run outside the isolated preview branch.
  if (
    process.env.VERCEL_ENV !== "preview" ||
    process.env.VERCEL_GIT_COMMIT_REF !== "migration/tidb-foundation"
  ) {
    return json(res, 404, { ok: false, message: "Not found" });
  }

  if (req.method === "GET") return page(res);
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { ok: false, message: "Method not allowed" });
  }

  // Preview URLs are publicly reachable. Require a separately configured secret
  // before allowing any DDL or row-lock test to run against the preview database.
  const expectedToken = process.env.COMPATIBILITY_TEST_TOKEN || "";
  if (!expectedToken) {
    return json(res, 503, {
      ok: false,
      message: "Compatibility test is locked: preview access token is not configured"
    });
  }
  let requestBody = req.body;
  if (typeof requestBody === "string") {
    requestBody = Object.fromEntries(new URLSearchParams(requestBody));
  }
  const suppliedToken = requestBody && typeof requestBody.token === "string"
    ? requestBody.token
    : "";
  const expectedBuffer = Buffer.from(expectedToken);
  const suppliedBuffer = Buffer.from(suppliedToken);
  const tokenMatches = expectedBuffer.length === suppliedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
  if (!tokenMatches) {
    return json(res, 401, { ok: false, message: "Invalid compatibility test token" });
  }

  let connectionA;
  let connectionB;
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const parentTable = `compat_${suffix}_parent`;
  const childTable = `compat_${suffix}_child`;
  const quote = (name) => "`" + name + "`";
  const tests = [];
  const pass = (name, detail) => tests.push({ name, status: "PASS", detail });
  const fail = (name, error) => tests.push({
    name,
    status: "FAIL",
    code: error && (error.code || error.errno) ? (error.code || error.errno) : "ERROR",
    detail: String(error && error.message ? error.message : error).slice(0, 220)
  });

  try {
    const required = ["TIDB_HOST", "TIDB_PORT", "TIDB_USER", "TIDB_PASSWORD", "TIDB_DATABASE"];
    if (required.some((key) => !process.env[key])) {
      return json(res, 503, { ok: false, message: "Preview database configuration is incomplete" });
    }

    const config = {
      host: process.env.TIDB_HOST,
      port: Number(process.env.TIDB_PORT),
      user: process.env.TIDB_USER,
      password: process.env.TIDB_PASSWORD,
      database: process.env.TIDB_DATABASE,
      ssl: { minVersion: "TLSv1.2" },
      connectTimeout: 12000,
      supportBigNumbers: true,
      bigNumberStrings: true
    };
    connectionA = await mysql.createConnection(config);

    const [metadata] = await connectionA.query(
      "SELECT VERSION() AS version, @@sql_mode AS sql_mode, @@time_zone AS session_time_zone, @@system_time_zone AS system_time_zone, @@character_set_server AS charset_server, @@collation_server AS collation_server"
    );
    pass("connection_and_server_metadata", metadata[0]);

    await connectionA.query(
      `CREATE TABLE ${quote(parentTable)} (
        id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
        marker INT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    await connectionA.query(
      `CREATE TABLE ${quote(childTable)} (
        id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
        parent_id BIGINT UNSIGNED NOT NULL,
        amount BIGINT NOT NULL,
        qty DECIMAL(18,3) NOT NULL,
        nullable_key VARCHAR(40) NULL,
        INDEX idx_parent (parent_id),
        UNIQUE KEY uq_nullable (nullable_key),
        CONSTRAINT fk_compat_parent FOREIGN KEY (parent_id)
          REFERENCES ${quote(parentTable)} (id)
          ON DELETE RESTRICT ON UPDATE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    pass("create_innodb_foreign_key_and_indexes", "Both isolated test tables created");

    await connectionA.query(`INSERT INTO ${quote(parentTable)} (id, marker) VALUES (1, 0)`);
    await connectionA.query(
      `INSERT INTO ${quote(childTable)} (id,parent_id,amount,qty,nullable_key) VALUES
       (1,1,125000,1.250,NULL),(2,1,25000,0.125,NULL)`
    );
    pass("nullable_unique_index", "Two NULL values accepted by a UNIQUE index");

    try {
      await connectionA.query(
        `INSERT INTO ${quote(childTable)} (id,parent_id,amount,qty,nullable_key) VALUES (3,999,100,1,NULL)`
      );
      fail("foreign_key_enforcement", new Error("Invalid parent reference was unexpectedly accepted"));
    } catch (error) {
      if (error.message.includes("unexpectedly accepted")) throw error;
      if (error.code === "ER_NO_REFERENCED_ROW_2" || error.errno === 1452) {
        pass("foreign_key_enforcement", "Invalid parent reference rejected");
      } else {
        fail("foreign_key_enforcement", error);
      }
    }

    try {
      await connectionA.query(`DELETE FROM ${quote(parentTable)} WHERE id=1`);
      fail("foreign_key_on_delete_restrict", new Error("Referenced parent was unexpectedly deleted"));
    } catch (error) {
      if (error.message.includes("unexpectedly deleted")) throw error;
      if (error.code === "ER_ROW_IS_REFERENCED_2" || error.errno === 1451) {
        pass("foreign_key_on_delete_restrict", "Referenced parent deletion rejected");
      } else {
        fail("foreign_key_on_delete_restrict", error);
      }
    }

    try {
      await connectionA.query(
        `INSERT INTO ${quote(childTable)} (id,parent_id,amount,qty,nullable_key) VALUES (4,1,1,1,'unique-value'),(5,1,1,1,'unique-value')`
      );
      fail("unique_non_null_enforcement", new Error("Duplicate non-NULL unique key unexpectedly accepted"));
    } catch (error) {
      if (error.message.includes("unexpectedly accepted")) throw error;
      if (error.code === "ER_DUP_ENTRY" || error.errno === 1062) {
        pass("unique_non_null_enforcement", "Duplicate non-NULL unique key rejected");
      } else {
        fail("unique_non_null_enforcement", error);
      }
    }

    const [sums] = await connectionA.query(
      `SELECT SUM(qty) AS total_qty, SUM(amount) AS total_amount FROM ${quote(childTable)}`
    );
    if (String(sums[0].total_qty) === "1.375" && String(sums[0].total_amount) === "150000") {
      pass("decimal_and_bigint_round_trip", sums[0]);
    } else {
      fail("decimal_and_bigint_round_trip", new Error(JSON.stringify(sums[0])));
    }

    await connectionA.beginTransaction();
    await connectionA.query(`UPDATE ${quote(parentTable)} SET marker=7 WHERE id=1`);
    await connectionA.rollback();
    const [rolledBack] = await connectionA.query(
      `SELECT marker FROM ${quote(parentTable)} WHERE id=1`
    );
    if (Number(rolledBack[0].marker) === 0) {
      pass("transaction_rollback", "Uncommitted update was rolled back");
    } else {
      fail("transaction_rollback", new Error("Rollback did not restore the original value"));
    }

    const [plan] = await connectionA.query(
      `EXPLAIN SELECT * FROM ${quote(childTable)} FORCE INDEX (idx_parent) WHERE parent_id=1`
    );
    pass("index_explain", plan[0]);

    connectionB = await mysql.createConnection(config);
    await connectionA.beginTransaction();
    await connectionA.query(`SELECT id FROM ${quote(parentTable)} WHERE id=1 FOR UPDATE`);
    let updateFinished = false;
    const concurrentUpdate = connectionB
      .query(`UPDATE ${quote(parentTable)} SET marker=marker+1 WHERE id=1`)
      .then(() => { updateFinished = true; });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const waitedForLock = !updateFinished;
    await connectionA.commit();
    await concurrentUpdate;
    if (waitedForLock) {
      pass("row_lock_wait", "Concurrent UPDATE waited while SELECT FOR UPDATE held the row lock");
    } else {
      fail("row_lock_wait", new Error("Concurrent UPDATE did not wait; inspect TiDB transaction mode and isolation"));
    }

    const [timeRows] = await connectionA.query(
      "SELECT @@time_zone AS session_time_zone, NOW(3) AS session_now, UTC_TIMESTAMP(3) AS utc_now"
    );
    pass("session_time_functions", timeRows[0]);

    let cleanupStatus = "PASS";
    try {
      await connectionA.query(`DROP TABLE IF EXISTS ${quote(childTable)}`);
      await connectionA.query(`DROP TABLE IF EXISTS ${quote(parentTable)}`);
    } catch (cleanupError) {
      cleanupStatus = "FAIL: " + String(cleanupError.message).slice(0, 180);
      fail("cleanup_test_tables", cleanupError);
    }
    if (cleanupStatus === "PASS") pass("cleanup_test_tables", "All compatibility tables dropped");
    const failed = tests.filter((test) => test.status === "FAIL").length;
    return json(res, failed ? 207 : 200, {
      ok: failed === 0,
      scope: "isolated-preview-only",
      database: process.env.TIDB_DATABASE,
      metadata: metadata[0],
      tests,
      cleanup: cleanupStatus,
      note: "This is a compatibility spike only, not application schema validation."
    });
  } catch (error) {
    fail("suite_runtime", error);
    return json(res, 500, {
      ok: false,
      message: "Compatibility test could not complete",
      tests
    });
  } finally {
    if (connectionB) {
      try { await connectionB.end(); } catch (_) {}
    }
    if (connectionA) {
      try { await connectionA.query(`DROP TABLE IF EXISTS ${quote(childTable)}`); } catch (_) {}
      try { await connectionA.query(`DROP TABLE IF EXISTS ${quote(parentTable)}`); } catch (_) {}
      try { await connectionA.end(); } catch (_) {}
    }
  }
};
