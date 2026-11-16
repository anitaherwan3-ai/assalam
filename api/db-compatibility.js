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
  return res.end(`<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TiDB Preview Compatibility Check</title><body style="font:16px system-ui;max-width:720px;margin:40px auto;padding:0 18px;line-height:1.5"><h2>TiDB Preview Compatibility Check</h2><p>Halaman ini hanya untuk project preview migrasi Klinik Assalaam. Jika seluruh pengaman server aktif, tombol akan membuat tabel uji sintetis dengan nama acak, menjalankan tes kompatibilitas, lalu mencoba menghapus tabel uji.</p><p><b>Jangan jalankan sebelum memastikan database preview yang benar. Tidak ada tabel aplikasi yang sengaja disentuh; tabel sintetis dibuat pada database preview yang diizinkan.</b></p><form method="post"><label for="token">Token akses pengujian</label><p><input id="token" name="token" type="password" autocomplete="off" required style="width:100%;padding:10px;box-sizing:border-box"></p><p><label><input type="checkbox" name="confirm" value="yes" required> Saya memahami tes akan membuat dan menghapus tabel sintetis di database preview.</label></p><button style="padding:12px 18px;font-size:16px">Jalankan tes kompatibilitas</button></form></body></html>`);
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

  // Require an explicit server-side enable switch and exact database allowlist.
  // The branch/environment check above is necessary but is not sufficient proof
  // that the configured credentials point to the intended preview database.
  if (
    process.env.COMPATIBILITY_TEST_ENABLED !== "true" ||
    process.env.TIDB_DATABASE !== "assalam_db"
  ) {
    return json(res, 503, {
      ok: false,
      message: "Compatibility test is locked: preview enable switch or database allowlist is not satisfied"
    });
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
  if (!requestBody || requestBody.confirm !== "yes") {
    return json(res, 400, {
      ok: false,
      message: "Explicit confirmation is required before synthetic DDL can run"
    });
  }
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
  const stockTable = `compat_${suffix}_stock`;
  const quote = (name) => "`" + name + "`";
  const tests = [];
  const testTables = [];
  let cleanupStatus = "NOT_STARTED";
  let tablesMayExist = false;
  const registerTable = (name) => {
    testTables.push(name);
    tablesMayExist = true;
  };
  const cleanupTestTables = async () => {
    const errors = [];
    for (const name of [...testTables].reverse()) {
      try {
        await connectionA.query(`DROP TABLE IF EXISTS ${quote(name)}`);
      } catch (error) {
        errors.push({ table: name, message: String(error.message).slice(0, 140) });
      }
    }
    if (errors.length) {
      const error = new Error("Synthetic table cleanup failed: " + JSON.stringify(errors));
      error.code = "COMPATIBILITY_CLEANUP_FAILED";
      throw error;
    }
    return testTables.length;
  };
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
      "SELECT VERSION() AS version, @@sql_mode AS sql_mode, @@time_zone AS session_time_zone, @@system_time_zone AS system_time_zone, @@character_set_server AS charset_server, @@collation_server AS collation_server, @@foreign_key_checks AS session_fk_checks, @@global.foreign_key_checks AS global_fk_checks"
    );
    pass("connection_and_server_metadata", metadata[0]);
    if (
      Number(metadata[0].session_fk_checks) !== 1 ||
      Number(metadata[0].global_fk_checks) !== 1
    ) {
      cleanupStatus = "NOT_CREATED";
      return json(res, 503, {
        ok: false,
        message: "Foreign key checks must be enabled at both session and global scope; no test tables were created",
        metadata: metadata[0],
        cleanup: cleanupStatus
      });
    }
    pass("foreign_key_checks_enabled", "Session and global foreign_key_checks are both enabled");

    registerTable(parentTable);
    await connectionA.query(
      `CREATE TABLE ${quote(parentTable)} (
        id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
        marker INT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    registerTable(childTable);
    await connectionA.query(
      `CREATE TABLE ${quote(childTable)} (
        id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
        parent_id BIGINT UNSIGNED NOT NULL,
        amount BIGINT NOT NULL,
        qty DECIMAL(18,3) NOT NULL,
        nullable_key VARCHAR(40) NULL,
        INDEX idx_parent (parent_id),
        UNIQUE KEY uq_parent_nullable (parent_id, nullable_key),
        CONSTRAINT fk_compat_parent FOREIGN KEY (parent_id)
          REFERENCES ${quote(parentTable)} (id)
          ON DELETE RESTRICT ON UPDATE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    registerTable(stockTable);
    await connectionA.query(
      `CREATE TABLE ${quote(stockTable)} (
        id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
        qty BIGINT NOT NULL,
        INDEX idx_stock_qty (qty)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    pass("create_innodb_foreign_key_and_indexes", "Synthetic parent, child and stock tables created");

    await connectionA.query(`INSERT INTO ${quote(parentTable)} (id, marker) VALUES (1, 0)`);
    await connectionA.query(
      `INSERT INTO ${quote(childTable)} (id,parent_id,amount,qty,nullable_key) VALUES
       (1,1,125000,1.250,NULL),(2,1,25000,0.125,NULL)`
    );
    pass("composite_nullable_unique_index", "Two NULL values accepted by a composite UNIQUE index");

    try {
      await connectionA.query(`UPDATE ${quote(parentTable)} SET id=2 WHERE id=1`);
      fail("foreign_key_on_update_restrict", new Error("Referenced parent key was unexpectedly updated"));
    } catch (error) {
      if (error.message.includes("unexpectedly updated")) throw error;
      if (error.code === "ER_ROW_IS_REFERENCED_2" || error.errno === 1451) {
        pass("foreign_key_on_update_restrict", "Referenced parent key update rejected");
      } else {
        fail("foreign_key_on_update_restrict", error);
      }
    }

    const [fkMetadata] = await connectionA.query(
      `SELECT kcu.CONSTRAINT_NAME AS constraint_name,
              kcu.COLUMN_NAME AS child_column,
              kcu.REFERENCED_TABLE_NAME AS parent_table,
              kcu.REFERENCED_COLUMN_NAME AS parent_column,
              kcu.ORDINAL_POSITION AS ordinal_position,
              rc.UPDATE_RULE AS update_rule,
              rc.DELETE_RULE AS delete_rule,
              tc.CONSTRAINT_TYPE AS constraint_type
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
       JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
         ON rc.CONSTRAINT_SCHEMA=kcu.CONSTRAINT_SCHEMA
        AND rc.CONSTRAINT_NAME=kcu.CONSTRAINT_NAME
        AND rc.TABLE_NAME=kcu.TABLE_NAME
       JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
         ON tc.CONSTRAINT_SCHEMA=kcu.CONSTRAINT_SCHEMA
        AND tc.CONSTRAINT_NAME=kcu.CONSTRAINT_NAME
        AND tc.TABLE_NAME=kcu.TABLE_NAME
       WHERE kcu.CONSTRAINT_SCHEMA=DATABASE()
         AND kcu.TABLE_NAME=?
         AND kcu.CONSTRAINT_NAME='fk_compat_parent'
       ORDER BY kcu.ORDINAL_POSITION`,
      [childTable]
    );
    if (
      fkMetadata.length === 1 &&
      fkMetadata[0].child_column === "parent_id" &&
      fkMetadata[0].parent_table === parentTable &&
      fkMetadata[0].parent_column === "id" &&
      String(fkMetadata[0].update_rule).toUpperCase() === "RESTRICT" &&
      String(fkMetadata[0].delete_rule).toUpperCase() === "RESTRICT" &&
      String(fkMetadata[0].constraint_type).toUpperCase() === "FOREIGN KEY"
    ) {
      pass("foreign_key_metadata", fkMetadata);
    } else {
      fail("foreign_key_metadata", new Error("Foreign key metadata does not match the declared relationship: " + JSON.stringify(fkMetadata)));
    }

    // Composite parent index in exact FK order; omit the child index and
    // verify TiDB creates it automatically.
    const compositeParent = `compat_${suffix}_cp`;
    const compositeChild = `compat_${suffix}_cc`;
    registerTable(compositeParent);
    await connectionA.query(
      `CREATE TABLE ${quote(compositeParent)} (
        a BIGINT UNSIGNED NOT NULL,
        b BIGINT UNSIGNED NOT NULL,
        PRIMARY KEY (a,b)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    registerTable(compositeChild);
    await connectionA.query(
      `CREATE TABLE ${quote(compositeChild)} (
        id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
        a BIGINT UNSIGNED NOT NULL,
        b BIGINT UNSIGNED NOT NULL,
        CONSTRAINT fk_composite_auto FOREIGN KEY (a,b)
          REFERENCES ${quote(compositeParent)} (a,b)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    const [autoIndexRows] = await connectionA.query(
      `SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [compositeChild]
    );
    const autoIndexGroups = new Map();
    for (const row of autoIndexRows) {
      if (!autoIndexGroups.has(row.INDEX_NAME)) autoIndexGroups.set(row.INDEX_NAME, []);
      autoIndexGroups.get(row.INDEX_NAME).push(row.COLUMN_NAME);
    }
    const autoChildIndex = [...autoIndexGroups.values()].some((columns) =>
      columns[0] === "a" && columns[1] === "b"
    );
    if (autoChildIndex) {
      pass("composite_child_index_auto_creation", autoIndexRows);
    } else {
      fail("composite_child_index_auto_creation", new Error("No child index with leading columns (a,b) was found"));
    }

    // Reverse parent index order: the FK references (a,b), but only (b,a)
    // is indexed on the parent. TiDB documentation requires exact order.
    const reversedParent = `compat_${suffix}_rp`;
    const reversedChild = `compat_${suffix}_rc`;
    registerTable(reversedParent);
    await connectionA.query(
      `CREATE TABLE ${quote(reversedParent)} (
        a BIGINT UNSIGNED NOT NULL,
        b BIGINT UNSIGNED NOT NULL,
        PRIMARY KEY (b,a)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    registerTable(reversedChild);
    try {
      await connectionA.query(
        `CREATE TABLE ${quote(reversedChild)} (
          id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
          a BIGINT UNSIGNED NOT NULL,
          b BIGINT UNSIGNED NOT NULL,
          CONSTRAINT fk_reversed_parent FOREIGN KEY (a,b)
            REFERENCES ${quote(reversedParent)} (a,b)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
      );
      fail("composite_parent_index_order", new Error("FK unexpectedly accepted parent index with reversed order"));
    } catch (error) {
      if (error.message.includes("unexpectedly accepted")) throw error;
      if (error.errno === 1822 || /missing index|referenced table/i.test(error.message)) {
        pass("composite_parent_index_order", String(error.message).slice(0, 200));
      } else {
        fail("composite_parent_index_order", error);
      }
    }

    // Parent column has no supporting index.
    const missingParent = `compat_${suffix}_mp`;
    const missingChild = `compat_${suffix}_mc`;
    registerTable(missingParent);
    await connectionA.query(
      `CREATE TABLE ${quote(missingParent)} (
        id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
        ref_code BIGINT UNSIGNED NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    registerTable(missingChild);
    try {
      await connectionA.query(
        `CREATE TABLE ${quote(missingChild)} (
          id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
          ref_code BIGINT UNSIGNED NOT NULL,
          CONSTRAINT fk_missing_parent_index FOREIGN KEY (ref_code)
            REFERENCES ${quote(missingParent)} (ref_code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
      );
      fail("missing_parent_index_rejected", new Error("FK unexpectedly accepted parent column without supporting index"));
    } catch (error) {
      if (error.message.includes("unexpectedly accepted")) throw error;
      if (error.errno === 1822 || /missing index|referenced table/i.test(error.message)) {
        pass("missing_parent_index_rejected", String(error.message).slice(0, 200));
      } else {
        fail("missing_parent_index_rejected", error);
      }
    }

    // Column compatibility: TiDB requires matching type definitions for FK pairs.
    // Each case uses isolated synthetic parent/child tables and expects DDL rejection.
    const mismatchCases = [
      {
        key: "signedness",
        parentColumn: "BIGINT UNSIGNED",
        childColumn: "BIGINT",
        parentIndex: "BIGINT UNSIGNED"
      },
      {
        key: "decimal_precision_scale",
        parentColumn: "DECIMAL(12,2)",
        childColumn: "DECIMAL(12,3)",
        parentIndex: "DECIMAL(12,2)"
      },
      {
        key: "charset_collation",
        parentColumn: "VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin",
        childColumn: "VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci",
        parentIndex: "VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"
      },
      {
        key: "varchar_length",
        parentColumn: "VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin",
        childColumn: "VARCHAR(48) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin",
        parentIndex: "VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"
      }
    ];
    for (const item of mismatchCases) {
      const parent = `compat_${suffix}_m_${item.key}_p`;
      const child = `compat_${suffix}_m_${item.key}_c`;
      registerTable(parent);
      await connectionA.query(
        `CREATE TABLE ${quote(parent)} (
          id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
          ref_value ${item.parentIndex} NOT NULL,
          UNIQUE KEY uq_ref_value (ref_value)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
      );
      registerTable(child);
      try {
        await connectionA.query(
          `CREATE TABLE ${quote(child)} (
            id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
            ref_value ${item.childColumn} NOT NULL,
            CONSTRAINT fk_mismatch_${item.key} FOREIGN KEY (ref_value)
              REFERENCES ${quote(parent)} (ref_value)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
        );
        fail(`foreign_key_mismatch_${item.key}`, new Error("Incompatible FK column definitions were unexpectedly accepted"));
      } catch (error) {
        if (error.message.includes("unexpectedly accepted")) throw error;
        if (/foreign key|referenced|incompatible|same type|different|column type|collation|precision|length|data type/i.test(error.message)) {
          pass(`foreign_key_mismatch_${item.key}`, {
            code: error.code || error.errno || "DB_ERROR",
            detail: String(error.message).slice(0, 180)
          });
        } else {
          fail(`foreign_key_mismatch_${item.key}`, error);
        }
      }
    }

    // Composite FK with one NULL component should not require a parent match;
    // a fully non-NULL orphan must still be rejected.
    const nullableParent = `compat_${suffix}_np`;
    const nullableChild = `compat_${suffix}_nc`;
    registerTable(nullableParent);
    await connectionA.query(
      `CREATE TABLE ${quote(nullableParent)} (
        a BIGINT UNSIGNED NOT NULL,
        b BIGINT UNSIGNED NOT NULL,
        PRIMARY KEY (a,b)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    registerTable(nullableChild);
    await connectionA.query(
      `CREATE TABLE ${quote(nullableChild)} (
        id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
        a BIGINT UNSIGNED NULL,
        b BIGINT UNSIGNED NULL,
        CONSTRAINT fk_nullable_composite FOREIGN KEY (a,b)
          REFERENCES ${quote(nullableParent)} (a,b)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    await connectionA.query(
      `INSERT INTO ${quote(nullableChild)} (id,a,b) VALUES (1,1,NULL)`
    );
    pass("composite_fk_partial_null", "A composite FK containing a NULL component accepted the row");
    try {
      await connectionA.query(
        `INSERT INTO ${quote(nullableChild)} (id,a,b) VALUES (2,999,999)`
      );
      fail("composite_fk_non_null_orphan", new Error("Fully non-NULL orphan unexpectedly accepted"));
    } catch (error) {
      if (error.message.includes("unexpectedly accepted")) throw error;
      if (error.code === "ER_NO_REFERENCED_ROW_2" || error.errno === 1452) {
        pass("composite_fk_non_null_orphan", "Fully non-NULL orphan rejected");
      } else {
        fail("composite_fk_non_null_orphan", error);
      }
    }

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
      fail("composite_unique_non_null_enforcement", new Error("Duplicate non-NULL composite unique key unexpectedly accepted"));
    } catch (error) {
      if (error.message.includes("unexpectedly accepted")) throw error;
      if (error.code === "ER_DUP_ENTRY" || error.errno === 1062) {
        pass("composite_unique_non_null_enforcement", "Duplicate non-NULL composite unique key rejected");
      } else {
        fail("composite_unique_non_null_enforcement", error);
      }
    }

    await connectionA.query(
      `INSERT INTO ${quote(childTable)} (id,parent_id,amount,qty,nullable_key) VALUES (6,1,9007199254740993,0.000,'bigint-boundary')`
    );
    const [bigintRows] = await connectionA.query(
      `SELECT amount FROM ${quote(childTable)} WHERE id=6`
    );
    if (String(bigintRows[0].amount) === "9007199254740993") {
      pass("bigint_above_js_safe_integer", "BIGINT value above Number.MAX_SAFE_INTEGER round-tripped exactly as string");
    } else {
      fail("bigint_above_js_safe_integer", new Error("BIGINT precision loss: " + String(bigintRows[0].amount)));
    }

    const [sums] = await connectionA.query(
      `SELECT SUM(qty) AS total_qty, SUM(amount) AS total_amount FROM ${quote(childTable)} WHERE id IN (1,2)`
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

    await connectionA.beginTransaction();
    await connectionA.query(`UPDATE ${quote(parentTable)} SET marker=2 WHERE id=1`);
    await connectionA.commit();
    const [committed] = await connectionA.query(
      `SELECT marker FROM ${quote(parentTable)} WHERE id=1`
    );
    if (Number(committed[0].marker) === 2) {
      pass("transaction_commit", "Committed update persisted");
    } else {
      fail("transaction_commit", new Error("Committed update was not visible"));
    }

    const [plan] = await connectionA.query(
      `EXPLAIN SELECT * FROM ${quote(childTable)} FORCE INDEX (idx_parent) WHERE parent_id=1`
    );
    pass("index_explain", plan[0]);

    connectionB = await mysql.createConnection(config);
    await connectionA.query(`INSERT INTO ${quote(stockTable)} (id,qty) VALUES (1,1)`);
    const stockUpdates = await Promise.all([
      connectionA.query(`UPDATE ${quote(stockTable)} SET qty=qty-1 WHERE id=1 AND qty>=1`),
      connectionB.query(`UPDATE ${quote(stockTable)} SET qty=qty-1 WHERE id=1 AND qty>=1`)
    ]);
    const affected = stockUpdates.reduce((sum, result) => sum + result[0].affectedRows, 0);
    const [stockAfter] = await connectionA.query(`SELECT qty FROM ${quote(stockTable)} WHERE id=1`);
    if (affected === 1 && Number(stockAfter[0].qty) === 0) {
      pass("concurrent_last_stock_guard", "Two concurrent sale attempts consumed only the single available unit");
    } else {
      fail("concurrent_last_stock_guard", new Error(`Expected one successful decrement; affected=${affected}, qty=${stockAfter[0].qty}`));
    }

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

    await connectionA.query("SET time_zone = '+00:00'");
    const [timeRows] = await connectionA.query(
      "SELECT @@time_zone AS session_time_zone, NOW(3) AS session_now, UTC_TIMESTAMP(3) AS utc_now"
    );
    const timeDifferenceMs = Math.abs(new Date(timeRows[0].session_now).getTime() - new Date(timeRows[0].utc_now).getTime());
    if (timeRows[0].session_time_zone === "+00:00" && timeDifferenceMs < 1500) {
      pass("explicit_utc_session_time", timeRows[0]);
    } else {
      fail("explicit_utc_session_time", new Error(JSON.stringify({ ...timeRows[0], timeDifferenceMs })));
    }

    try {
      const droppedCount = await cleanupTestTables();
      cleanupStatus = "PASS";
      pass("cleanup_test_tables", `All ${droppedCount} registered synthetic tables dropped`);
    } catch (cleanupError) {
      cleanupStatus = "FAIL: " + String(cleanupError.message).slice(0, 180);
      fail("cleanup_test_tables", cleanupError);
    }
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
    // Make cleanup outcome visible even when a test fails before the normal
    // cleanup block. A cleanup failure is a hard stop for schema-v1 work.
    if (tablesMayExist && connectionA) {
      try {
        const droppedCount = await cleanupTestTables();
        cleanupStatus = "PASS_AFTER_ERROR";
        pass("cleanup_test_tables_after_error", `All ${droppedCount} registered synthetic tables dropped after error`);
      } catch (cleanupError) {
        cleanupStatus = "FAIL: " + String(cleanupError.message).slice(0, 180);
        fail("cleanup_test_tables_after_error", cleanupError);
      }
    } else if (!tablesMayExist) {
      cleanupStatus = "NOT_CREATED";
    }
    return json(res, 500, {
      ok: false,
      message: "Compatibility test could not complete",
      tests,
      cleanup: cleanupStatus,
      stopSchemaV1: cleanupStatus.startsWith("FAIL")
    });
  } finally {
    if (connectionB) {
      try { await connectionB.end(); } catch (_) {}
    }
    if (connectionA) {
      try { await connectionA.end(); } catch (_) {}
    }
  }
};
