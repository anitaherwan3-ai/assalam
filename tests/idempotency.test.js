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
