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

test("queue ticket creation requires the latest active lane assignment authored by Pimpinan", async () => {
  const repository = createTidbQueueRepository();
  const statements = [];
  const connection = {
    async execute(sql) {
      statements.push(sql);
      if (sql.includes("FROM patient_encounters")) {
        return [[{ cashierUserId: "cashier-1", shiftId: "77" }], []];
      }
      if (sql.includes("SELECT a.assignment_id FROM cashier_queue_assignments a")) {
        return [[{ assignment_id: 12 }], []];
      }
      if (sql.includes("INSERT INTO queue_tickets")) return [{ insertId: 91 }, []];
      throw new Error("Unexpected SQL in queue ticket test: " + sql);
    }
  };
  const result = await repository.createQueueTicket(connection, {
    encounterId: "45", businessDate: "2026-11-25", prefix: "A", sequence: 3
  });
  const assignmentSql = statements.find(sql => sql.includes("SELECT a.assignment_id FROM cashier_queue_assignments a"));
  assert.equal(result.ticketId, "91");
  assert.equal(result.queueNumber, "A-003");
  assert.match(assignmentSql, /ra\.role_code = 'pimpinan'/);
  assert.match(assignmentSql, /a\.assignment_id = \(SELECT MAX\(a2\.assignment_id\)/);
});

test("display projection exposes the latest call event ID for repeat announcements", () => {
  const fs = require("node:fs");
  const repositorySource = fs.readFileSync(require.resolve("../lib/repositories/tidb-queue-repository"), "utf8");
  const displaySource = fs.readFileSync(require.resolve("../display.html"), "utf8");

  assert.match(repositorySource, /MAX\(.*qce\.(?:call_)?event_id\).*queue_call_events qce.*event_type IN \('call', 'recall'\)/);
  assert.match(repositorySource, /callEventId: activeCall\.callEventId == null \? null : String\(activeCall\.callEventId\)/);
  assert.match(displaySource, /_t: activeCall\.callEventId \|\| activeCall\.calledAtUtc \|\| activeCall\.ticketId/);
});

test("queue repository locks the active ticket with its encounter status for stale guard reconciliation", async () => {
  let captured = "";
  const connection = {
    async execute(sql) {
      captured = sql;
      return [[{ ticketId: "91", laneCode: "A", status: "called", encounterStatus: "completed" }], []];
    }
  };
  const row = await createTidbQueueRepository().lockQueueTicket(connection, "91");
  assert.equal(row.encounterStatus, "completed");
  assert.match(captured, /JOIN patient_encounters e ON e\.encounter_id = q\.encounter_id/);
  assert.match(captured, /FOR UPDATE/);
});

test("queue repository clears a stale active-call guard with optimistic versioning", async () => {
  let captured;
  const connection = {
    async execute(sql, params) {
      captured = { sql, params };
      if (sql.startsWith("UPDATE queue_tickets SET status = 'completed'")) return [{ affectedRows: 1 }, []];
      if (sql.startsWith("UPDATE queue_call_guards SET active_queue_ticket_id = NULL")) return [{ affectedRows: 1 }, []];
      throw new Error("Unexpected SQL: " + sql);
    }
  };
  const guard = { prefix: "A", activeTicketId: "91", version: "4" };
  const updated = await createTidbQueueRepository().clearStaleQueueCallGuard(connection, guard, {
    status: "called", encounterStatus: "completed"
  });
  assert.equal(updated.activeTicketId, null);
  assert.equal(updated.version, "5");
  assert.equal(captured.params[2], "4");
});

test("queue guard reconciliation does not reset a live registered ticket", async () => {
  const statements = [];
  const connection = {
    async execute(sql, params) {
      statements.push({ sql, params });
      if (sql.startsWith("UPDATE queue_call_guards SET active_queue_ticket_id = NULL")) return [{ affectedRows: 1 }, []];
      throw new Error("Unexpected SQL: " + sql);
    }
  };
  const updated = await createTidbQueueRepository().clearStaleQueueCallGuard(connection, {
    prefix: "B", activeTicketId: "92", version: "8"
  }, { status: "called", encounterStatus: "registered" });
  assert.equal(updated.activeTicketId, null);
  assert.equal(statements.length, 1, "only guard should be cleared for a registered encounter");
});
