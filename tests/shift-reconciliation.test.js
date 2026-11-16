"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createClinicDomainCommands } = require("../lib/clinic-domain-commands");

function makeCommands(shift) {
  const state = { closed: null, verified: null };
  const repository = {
    async lockShiftForClose() { return { ...shift, status: "open", expectedCash: "100000" }; },
    async closeShift(_c, input) { state.closed = input; return "recon-1"; },
    async lockShiftForVerification() { return { ...shift, status: "closed_pending_verification" }; },
    async verifyShift(_c, input) { state.verified = input; }
  };
  const commands = createClinicDomainCommands({
    repository,
    withTransaction: async work => work({}),
    claimIdempotency: async () => ({ replayed: false, idempotencyId: "idem-1" }),
    completeIdempotency: async () => {},
    writeAuditEvent: async () => "audit-1"
  });
  return { commands, state };
}

test("cashier closes own shift with expected cash and variance reason", async () => {
  const { commands, state } = makeCommands({ shiftId: "1", cashierUserId: "cashier-1", shiftCode: "morning" });
  const result = await commands.closeShift({
    actor: { userId: "cashier-1", role: "kasir" },
    shiftId: "1", countedCash: "99000", varianceReason: "Selisih hitung",
    idempotencyKey: "shift-close-1", requestId: "shift-close-req"
  });
  assert.equal(result.body.data.expectedCash, "100000");
  assert.equal(result.body.data.varianceAmount, "-1000");
  assert.equal(state.closed.closedByUserId, "cashier-1");
});

test("shift variance without a reason is blocked", async () => {
  const { commands } = makeCommands({ shiftId: "1", cashierUserId: "cashier-1", shiftCode: "morning" });
  await assert.rejects(commands.closeShift({
    actor: { userId: "cashier-1", role: "kasir" },
    shiftId: "1", countedCash: "99000",
    idempotencyKey: "shift-close-2", requestId: "shift-close-req-2"
  }), { code: "SHIFT_VARIANCE_REASON_REQUIRED" });
});

test("cashier shift verification requires Admin; Admin shift requires Pimpinan", async () => {
  const cashierShift = makeCommands({ shiftId: "1", cashierUserId: "cashier-1", shiftCode: "evening" });
  await assert.rejects(cashierShift.commands.verifyShift({
    actor: { userId: "owner-1", role: "pimpinan" }, shiftId: "1", reason: "test",
    idempotencyKey: "shift-verify-1", requestId: "shift-verify-req-1"
  }), { code: "SHIFT_VERIFIER_ROLE_INVALID" });
  await cashierShift.commands.verifyShift({
    actor: { userId: "admin-1", role: "admin" }, shiftId: "1", reason: "Sesuai",
    idempotencyKey: "shift-verify-2", requestId: "shift-verify-req-2"
  });
  assert.equal(cashierShift.state.verified.verifierUserId, "admin-1");

  const adminShift = makeCommands({ shiftId: "2", cashierUserId: "admin-1", shiftCode: "admin" });
  await adminShift.commands.verifyShift({
    actor: { userId: "owner-1", role: "pimpinan" }, shiftId: "2", reason: "Sesuai",
    idempotencyKey: "shift-verify-3", requestId: "shift-verify-req-3"
  });
  assert.equal(adminShift.state.verified.verifierUserId, "owner-1");
});
