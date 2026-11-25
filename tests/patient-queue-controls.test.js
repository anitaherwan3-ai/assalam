"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createClinicDomainCommands } = require("../lib/clinic-domain-commands");

function harness(overrides = {}) {
  const calls = { changes: [], audits: [] };
  const repository = {
    async lockEncounterForStatus() {
      return { encounterId: "41", businessDate: "2026-11-25", status: "registered", cashierUserId: "cashier-1", shiftId: "shift-1" };
    },
    async changeEncounterStatus(_connection, input) { calls.changes.push(input); },
    async getClinicBusinessDate() { return "2026-11-25"; },
    async lockOpenCashierShift() { return { cashierUserId: "cashier-1", status: "open" }; },
    ...overrides.repository
  };
  const commands = createClinicDomainCommands({
    repository,
    withTransaction: work => work({}),
    claimIdempotency: async () => ({ replayed: false, idempotencyId: 1 }),
    completeIdempotency: async () => {},
    writeAuditEvent: async (_connection, event) => { calls.audits.push(event); }
  });
  return { commands, calls };
}

const actor = { userId: "cashier-1", role: "kasir" };
const request = { actor, encounterId: "41", idempotencyKey: "idempotency-41", requestId: "request-41" };

test("patient cancellation is owner-scoped and writes server audit with status and reason", async () => {
  const { commands, calls } = harness();
  const result = await commands.cancelEncounter({ ...request, reason: "Pasien tidak jadi berobat" });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(calls.changes, [{
    encounterId: "41", status: "cancelled", reason: "Pasien tidak jadi berobat"
  }]);
  assert.equal(calls.audits[0].actionCode, "ENCOUNTER_CANCELLED");
  assert.equal(calls.audits[0].reason, "Pasien tidak jadi berobat");
});

test("patient cancellation rejects a different cashier", async () => {
  const { commands, calls } = harness();
  await assert.rejects(
    commands.cancelEncounter({ ...request, actor: { userId: "cashier-2", role: "kasir" } }),
    error => error.code === "ENCOUNTER_NOT_OWNED" && error.statusCode === 403
  );
  assert.equal(calls.changes.length, 0);
  assert.equal(calls.audits.length, 0);
});

test("same-day patient restoration requires the original cashier shift to remain open", async () => {
  const { commands, calls } = harness({
    repository: {
      async lockEncounterForStatus() {
        return { encounterId: "41", businessDate: "2026-11-25", status: "cancelled", cashierUserId: "cashier-1", shiftId: "shift-1" };
      }
    }
  });
  const result = await commands.restoreEncounter(request);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(calls.changes, [{ encounterId: "41", status: "registered", reason: null }]);
  assert.equal(calls.audits[0].actionCode, "ENCOUNTER_RESTORED");
});

test("patient restoration rejects a closed original shift", async () => {
  const { commands, calls } = harness({
    repository: {
      async lockEncounterForStatus() {
        return { encounterId: "41", businessDate: "2026-11-25", status: "cancelled", cashierUserId: "cashier-1", shiftId: "shift-1" };
      },
      async lockOpenCashierShift() { return null; }
    }
  });
  await assert.rejects(
    commands.restoreEncounter(request),
    error => error.code === "ENCOUNTER_RESTORE_SHIFT_CLOSED"
  );
  assert.equal(calls.changes.length, 0);
});

