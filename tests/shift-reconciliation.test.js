"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createClinicDomainCommands } = require("../lib/clinic-domain-commands");

function makeCommands(shift) {
  const state = { closed: null, verified: null, verifications: [] };
  const repository = {
    async lockShiftForClose() { return { ...shift, status: "open", expectedCash: "100000" }; },
    async closeShift(_c, input) { state.closed = input; return "recon-1"; },
    async lockShiftForVerification() { return { ...shift, status: "pending_verification" }; },
    async recordShiftVerification(_c, input) {
      if (state.verifications.some(x => x.verifierUserId === input.verifierUserId)) {
        throw Object.assign(new Error("duplicate verifier"), { code: "SHIFT_ALREADY_VERIFIED_BY_ACTOR" });
      }
      state.verifications.push(input);
      const verificationCount=state.verifications.length;
      const verified=verificationCount>=input.requiredApprovals;
      if(verified)state.verified=input;
      return {verificationCount,requiredApprovals:input.requiredApprovals,verified};
    }
  };
  const commands = createClinicDomainCommands({
    repository,
    withTransaction: async work => work({}),
    claimIdempotency: async (_c,x) => ({ replayed: false, idempotencyId: x.idempotencyKey }),
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

test("cashier shift requires two distinct Admin approvals; Admin shift requires one Pimpinan", async () => {
  const cashierShift = makeCommands({ shiftId: "1", cashierUserId: "cashier-1", shiftCode: "morning" });
  await assert.rejects(cashierShift.commands.verifyShift({
    actor: { userId: "owner-1", role: "pimpinan" }, shiftId: "1", reason: "test",
    idempotencyKey: "shift-verify-1", requestId: "shift-verify-req-1"
  }), { code: "SHIFT_VERIFIER_ROLE_INVALID" });
  const first = await cashierShift.commands.verifyShift({
    actor: { userId: "admin-1", role: "admin" }, shiftId: "1", reason: "Pemeriksaan pertama",
    idempotencyKey: "shift-verify-2", requestId: "shift-verify-req-2"
  });
  assert.equal(first.body.data.status, "pending_verification");
  assert.equal(first.body.data.verificationCount, 1);
  assert.equal(first.body.data.requiredApprovals, 2);
  await assert.rejects(cashierShift.commands.verifyShift({
    actor: { userId: "admin-1", role: "admin" }, shiftId: "1", reason: "Ulang",
    idempotencyKey: "shift-verify-duplicate", requestId: "shift-verify-duplicate-req"
  }), { code: "SHIFT_ALREADY_VERIFIED_BY_ACTOR" });
  const second = await cashierShift.commands.verifyShift({
    actor: { userId: "admin-2", role: "admin" }, shiftId: "1", reason: "Pemeriksaan kedua",
    idempotencyKey: "shift-verify-3", requestId: "shift-verify-req-3"
  });
  assert.equal(second.body.data.status, "verified");
  assert.equal(second.body.data.verificationCount, 2);
  assert.equal(cashierShift.state.verified.verifierUserId, "admin-2");

  const adminShift = makeCommands({ shiftId: "2", cashierUserId: "admin-1", shiftCode: "admin" });
  const final = await adminShift.commands.verifyShift({
    actor: { userId: "owner-1", role: "pimpinan" }, shiftId: "2", reason: "Sesuai",
    idempotencyKey: "shift-verify-4", requestId: "shift-verify-req-4"
  });
  assert.equal(final.body.data.status, "verified");
  assert.equal(final.body.data.requiredApprovals, 1);
});
