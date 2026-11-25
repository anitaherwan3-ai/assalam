"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTidbInventoryRepository } = require("../lib/repositories/tidb-inventory-repository");

test("shift opening reads only the latest active assignment authored by Pimpinan", async () => {
  const repository = createTidbInventoryRepository();
  let query = "";
  const connection = {
    async execute(sql) {
      query = sql;
      return [[{ assignmentId: 7, prefix: "B" }], []];
    }
  };
  const assignment = await repository.getAssignedQueueLane(connection, "cashier-2");
  assert.deepEqual(assignment, { assignmentId: "7", prefix: "B" });
  assert.match(query, /ra\.role_code = 'pimpinan'/);
  assert.match(query, /a\.assignment_id = \(SELECT MAX\(a2\.assignment_id\)/);
});

test("opening a shift never creates or changes a queue-lane assignment", async () => {
  const repository = createTidbInventoryRepository();
  const statements = [];
  const connection = {
    async execute(sql) {
      statements.push(sql);
      if (sql.includes("INSERT INTO cashier_shifts")) return [{ insertId: 44 }, []];
      if (sql.includes("INSERT INTO active_shift_slots")) return [{ affectedRows: 1 }, []];
      throw new Error("Unexpected SQL in shift opening test: " + sql);
    }
  };
  const opened = await repository.openShift(connection, {
    cashierUserId: "cashier-1", shiftCode: "morning", openingFloat: "100000", laneCode: "A"
  });
  assert.deepEqual(opened, { shiftId: "44", publicId: opened.publicId });
  assert.equal(statements.some(sql => /INSERT INTO cashier_queue_assignments|UPDATE cashier_queue_assignments/.test(sql)), false);
});
