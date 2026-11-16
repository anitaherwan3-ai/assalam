"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { hashPayload, canonicalize } = require("../lib/idempotency");

test("idempotency hash is independent of object key order", () => {
  assert.equal(hashPayload({ b: 2, a: 1 }), hashPayload({ a: 1, b: 2 }));
});

test("idempotency canonicalization preserves arrays and converts BigInt to exact strings", () => {
  assert.deepEqual(canonicalize({ amount: 9007199254740993n, rows: [2, 1] }), {
    amount: "9007199254740993",
    rows: [2, 1]
  });
});

test("idempotency rejects undefined and non-finite numeric values", () => {
  assert.throws(() => hashPayload({ a: undefined }), /undefined/);
  assert.throws(() => hashPayload({ amount: Number.NaN }), /non-finite/);
});

const { claimIdempotency, completeIdempotency } = require("../lib/idempotency");

function idempotencyConnection() {
  const records = new Map();
  let nextId = 1;
  return {
    records,
    async execute(sql, params) {
      if (sql.startsWith("INSERT INTO idempotency_requests")) {
        const [actor, command, key, hash] = params;
        const index = [actor, command, key].join("|");
        if (records.has(index)) {
          const error = new Error("Duplicate entry");
          error.code = "ER_DUP_ENTRY";
          error.errno = 1062;
          throw error;
        }
        const row = { idempotency_id: nextId++, actor_user_id: actor, command_name: command,
          idempotency_key: key, request_hash: hash, status: "processing",
          response_code: null, response_json: null, entity_type: null, entity_id: null };
        records.set(index, row);
        return [{ insertId: row.idempotency_id, affectedRows: 1 }];
      }
      if (sql.startsWith("SELECT idempotency_id")) {
        const row = records.get(params.join("|"));
        return [[...(row ? [Object.assign({}, row)] : [])]];
      }
      if (sql.startsWith("UPDATE idempotency_requests")) {
        const [code, json, entityType, entityId, id] = params;
        const row = [...records.values()].find(item => item.idempotency_id === id);
        if (!row || row.status !== "processing") return [{ affectedRows: 0 }];
        Object.assign(row, { status: "completed", response_code: code,
          response_json: json, entity_type: entityType, entity_id: entityId });
        return [{ affectedRows: 1 }];
      }
      throw new Error("Unexpected idempotency SQL: " + sql);
    }
  };
}

test("idempotency claim stores once and replays the completed response", async () => {
  const connection = idempotencyConnection();
  const input = { actorUserId: "user-1", commandName: "patient.register",
    idempotencyKey: "request-uuid-0001", payload: { name: "Test" } };
  const first = await claimIdempotency(connection, input);
  assert.equal(first.replayed, false);
  await completeIdempotency(connection, { idempotencyId: Number(first.idempotencyId),
    responseCode: 201, response: { patientId: "p-1" }, entityType: "patient", entityId: "p-1" });
  const replay = await claimIdempotency(connection, input);
  assert.equal(replay.replayed, true);
  assert.equal(replay.responseCode, 201);
  assert.deepEqual(replay.response, { patientId: "p-1" });
});

test("idempotency rejects reuse of a key with a different payload", async () => {
  const connection = idempotencyConnection();
  const input = { actorUserId: "user-1", commandName: "patient.register",
    idempotencyKey: "request-uuid-0002", payload: { name: "Test" } };
  await claimIdempotency(connection, input);
  await assert.rejects(
    claimIdempotency(connection, Object.assign({}, input, { payload: { name: "Other" } })),
    error => error.code === "IDEMPOTENCY_KEY_REUSED" && error.statusCode === 409
  );
});
