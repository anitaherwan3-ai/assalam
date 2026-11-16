"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTidbQueueRepository, jakartaBusinessDate } = require("../lib/repositories/tidb-queue-repository");

test("queue repository uses Asia/Jakarta business date, not UTC date", () => {
  assert.equal(jakartaBusinessDate(new Date("2026-11-16T18:00:00.000Z")), "2026-11-17");
  assert.equal(jakartaBusinessDate(new Date("2026-11-17T16:59:59.000Z")), "2026-11-17");
});

test("queue repository is wired for independent per-lane call policy", async () => {
  const repository = createTidbQueueRepository();
  assert.deepEqual(await repository.readQueueActiveCallPolicy(), { mode: "per_lane" });
  assert.deepEqual(await repository.getQueuePrefixPolicy(null, "A"), { approved: true, mode: "per_lane" });
  assert.deepEqual(await repository.getQueuePrefixPolicy(null, "B"), { approved: true, mode: "per_lane" });
  assert.deepEqual(await repository.getQueuePrefixPolicy(null, "C"), { approved: false, mode: "per_lane" });
});
