"use strict";

const crypto = require("node:crypto");

function expectMysqlError(error, errno, code, label) {
  if (Number(error && error.errno) !== errno && error && error.code !== code) {
    const wrapped = new Error("TiDB smoke test expected " + label + " but received " +
      (error && error.code ? error.code : "unknown"));
    wrapped.code = "TIDB_SMOKE_EXPECTED_ERROR_MISMATCH";
    throw wrapped;
  }
}

async function runFoundationSmokeTest(connection) {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  const userA = "smoke_a_" + suffix;
  const userB = "smoke_b_" + suffix;
  const uid = "smoke-firebase-" + suffix;
  const requestId = "smoke-request-" + suffix;
  const tariffId = "smoke-tariff-" + suffix;
  const supplierId = "smoke-supplier-" + suffix;
  const idempotencyKey = "smoke-key-" + suffix;
  let roleAId = null;
  let failure = null;
  let transactionStarted = false;

  try {
    await connection.query("SET SESSION FOREIGN_KEY_CHECKS = 1");
    const [fk] = await connection.query("SELECT @@SESSION.FOREIGN_KEY_CHECKS AS fk_checks");
    if (Number(fk[0] && fk[0].fk_checks) !== 1) {
      throw new Error("TiDB smoke test refused to run while foreign key checks are disabled.");
    }
    await connection.beginTransaction();
    transactionStarted = true;

    const authUserId = "auth_" + suffix;
    const authSessionId = "session_" + suffix;
    const authAccountId = "account_" + suffix;
    await connection.execute(
      "INSERT INTO \`user\` (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'Synthetic Auth User', ?, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [authUserId, "auth-" + suffix + "@example.invalid"]
    );
    await connection.execute(
      "INSERT INTO \`session\` (id, expiresAt, token, createdAt, updatedAt, userId) VALUES (?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 DAY), ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), ?)",
      [authSessionId, "synthetic-session-token-" + suffix, authUserId]
    );
    await connection.execute(
      "INSERT INTO \`account\` (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, 'credential', ?, 'synthetic-not-a-real-password-hash', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [authAccountId, authUserId, authUserId]
    );
    await connection.execute(
      "INSERT INTO verification (id, identifier, value, expiresAt, createdAt, updatedAt) VALUES (?, ?, 'synthetic-verification-value', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 10 MINUTE), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      ["verify_" + suffix, "auth-" + suffix + "@example.invalid"]
    );

    await connection.execute(
      "INSERT INTO users (user_id, display_name, active, protected_owner, created_at_utc, updated_at_utc, version) VALUES (?, 'Synthetic Smoke A', 1, 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), 1)",
      [userA]
    );
    await connection.execute(
      "INSERT INTO users (user_id, display_name, active, protected_owner, created_at_utc, updated_at_utc, version) VALUES (?, 'Synthetic Smoke B', 1, 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), 1)",
      [userB]
    );

    const [roleA] = await connection.execute(
      "INSERT INTO role_assignments (user_id, role_code, scope_type, valid_from_utc, granted_by_user_id, created_at_utc) VALUES (?, 'pimpinan', 'clinic', UTC_TIMESTAMP(3), ?, UTC_TIMESTAMP(3))",
      [userA, userA]
    );
    roleAId = roleA.insertId;
    const [roleB] = await connection.execute(
      "INSERT INTO role_assignments (user_id, role_code, scope_type, valid_from_utc, granted_by_user_id, created_at_utc) VALUES (?, 'admin', 'clinic', UTC_TIMESTAMP(3), ?, UTC_TIMESTAMP(3))",
      [userB, userB]
    );

    let compositeRejected = false;
    try {
      await connection.execute(
        "INSERT INTO active_role_slots (user_id, role_assignment_id, activated_at_utc) VALUES (?, ?, UTC_TIMESTAMP(3))",
        [userB, roleAId]
      );
    } catch (error) {
      expectMysqlError(error, 1452, "ER_NO_REFERENCED_ROW_2", "composite owner FK rejection");
      compositeRejected = true;
    }
    if (!compositeRejected) throw new Error("TiDB accepted an active role slot owned by a different user.");

    await connection.execute(
      "INSERT INTO active_role_slots (user_id, role_assignment_id, activated_at_utc) VALUES (?, ?, UTC_TIMESTAMP(3))",
      [userA, roleAId]
    );
    await connection.execute(
      "INSERT INTO firebase_identities (provider, subject_uid, user_id, email_snapshot, created_at_utc) VALUES ('firebase', ?, ?, 'synthetic@example.invalid', UTC_TIMESTAMP(3))",
      [uid, userA]
    );

    let duplicateUidRejected = false;
    try {
      await connection.execute(
        "INSERT INTO firebase_identities (provider, subject_uid, user_id, email_snapshot, created_at_utc) VALUES ('firebase', ?, ?, 'duplicate@example.invalid', UTC_TIMESTAMP(3))",
        [uid, userB]
      );
    } catch (error) {
      expectMysqlError(error, 1062, "ER_DUP_ENTRY", "duplicate Firebase UID rejection");
      duplicateUidRejected = true;
    }
    if (!duplicateUidRejected) throw new Error("TiDB accepted a duplicate Firebase UID mapping.");

    await connection.execute(
      "INSERT INTO audit_events (event_uuid, actor_user_id, actor_role_snapshot, action_code, entity_type, entity_id, request_id, occurred_at_utc) VALUES (?, ?, 'pimpinan', 'SMOKE_TEST', 'smoke', ?, ?, UTC_TIMESTAMP(3))",
      [crypto.randomUUID(), userA, suffix, requestId]
    );
    await connection.execute(
      "INSERT INTO idempotency_requests (actor_user_id, command_name, idempotency_key, request_hash, status, created_at_utc) VALUES (?, 'smoke.check', ?, ?, 'completed', UTC_TIMESTAMP(3))",
      [userA, idempotencyKey, crypto.createHash("sha256").update(suffix).digest("hex")]
    );
    await connection.execute(
      "INSERT INTO outbox_jobs (job_type, aggregate_type, aggregate_id, payload_json, status, available_at_utc, created_at_utc) VALUES ('smoke', 'smoke', ?, '{\"ok\":true}', 'completed', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [suffix]
    );
    await connection.execute(
      "INSERT INTO tariffs (public_id, name, service_type, price, created_at_utc, updated_at_utc) VALUES (?, 'Synthetic Smoke Tariff', 'test', 1000, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [tariffId]
    );
    await connection.execute(
      "INSERT INTO suppliers (public_id, name, created_at_utc, updated_at_utc) VALUES (?, 'Synthetic Smoke Supplier', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [supplierId]
    );

    let restrictRejected = false;
    try {
      await connection.execute("DELETE FROM users WHERE user_id = ?", [userA]);
    } catch (error) {
      expectMysqlError(error, 1451, "ER_ROW_IS_REFERENCED_2", "RESTRICT delete policy");
      restrictRejected = true;
    }
    if (!restrictRejected) throw new Error("TiDB did not enforce RESTRICT on a referenced user.");

    return {
      ok: true,
      synthetic: true,
      checks: ["foreign_key_checks", "composite_owner_fk", "unique_firebase_uid", "audit_insert", "idempotency_insert", "outbox_insert", "catalog_inserts", "better_auth_user_session_account_verification", "delete_restrict"]
    };
  } catch (error) {
    failure = error;
  } finally {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        const cleanupError = new Error("Synthetic TiDB smoke-test rollback failed.");
        cleanupError.code = "TIDB_SMOKE_CLEANUP_FAILED";
        cleanupError.originalErrorCode = failure && failure.code ? failure.code : null;
        cleanupError.rollbackErrorCode = rollbackError && rollbackError.code ? rollbackError.code : "ROLLBACK_FAILED";
        throw cleanupError;
      }
    }
  }
  if (failure) throw failure;
}

module.exports = { runFoundationSmokeTest };
