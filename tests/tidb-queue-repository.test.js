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
  assert.equal(typeof repository.getDisplayQueue, "function");
});

test("queue calling is limited to the owning cashier or Pimpinan; Admin may transfer but not call",async()=>{
 const repository=createTidbQueueRepository();
 const ticket={status:"waiting",currentCashierUserId:"cashier-1"};
 await repository.assertQueueActionAllowed(null,ticket,{userId:"cashier-1",role:"kasir"});
 await repository.assertQueueActionAllowed(null,ticket,{userId:"owner-1",role:"pimpinan"});
 await assert.rejects(repository.assertQueueActionAllowed(null,ticket,{userId:"admin-1",role:"admin"}),{code:"QUEUE_CALL_ADMIN_NOT_ALLOWED"});
 await assert.rejects(repository.assertQueueActionAllowed(null,ticket,{userId:"cashier-2",role:"kasir"}),{code:"QUEUE_TICKET_NOT_OWNED"});
});
