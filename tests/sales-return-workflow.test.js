"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createClinicDomainCommands } = require("../lib/clinic-domain-commands");

function harness() {
  const state = {
    invoice: { invoiceId: "100", cashierUserId: "cashier-1", status: "posted" },
    quota: {
      quotaId: "9", invoiceLineId: "12", invoiceId: "100", batchId: "4", medicineId: "7",
      maximumQuantity: "2", reservedQuantity: "0", approvedQuantity: "0",
      netCharge: "5000", priorRefundAmount: "0", quantityScale: 0
    },
    request: null, lines: [], events: [], reserved: 0, approved: 0,
    quarantined: [], refundObligation: null, reviewed: null, approval: null
  };
  const repository = {
    async lockSalesInvoice() { return state.invoice; },
    async lockReturnQuota() { return { ...state.quota, reservedQuantity: String(state.reserved), approvedQuantity: String(state.approved) }; },
    async reserveReturnQuota(_c, x) { state.reserved += Number(x.quantity); },
    async releaseReturnQuota(_c, x) { state.reserved -= Number(x.quantity); },
    async approveReturnQuota(_c, x) { state.reserved -= Number(x.quantity); state.approved += Number(x.quantity); },
    async createSalesReturn(_c, x) { state.request = { ...x, status: "requested", returnId: "55" }; return "55"; },
    async createSalesReturnLine(_c, x) { state.lines.push({ ...x, returnLineId: String(state.lines.length + 1) }); return String(state.lines.length); },
    async appendSalesReturnEvent(_c, x) { state.events.push(x); },
    async lockSalesReturn() { return { returnId: "55", status: state.request.status, requestedByUserId: "cashier-1", lines: state.lines.map((x, i) => ({ returnLineId: String(i + 1), quotaId: x.quotaId, quantity: x.quantity, refundAmount: x.refundAmount, batchId: "4", medicineId: "7" })) }; },
    async reviewSalesReturn(_c, x) { state.reviewed = x; state.request.status = x.status; },
    async approveSalesReturn(_c, x) { state.approval = x; state.request.status = "pimpinan_approved"; },
    async createPatientReturnQuarantine(_c, x) { state.quarantined.push(x); },
    async createRefundObligation(_c, x) { state.refundObligation = x; return "88"; }
  };
  const commands = createClinicDomainCommands({
    repository,
    withTransaction: async work => work({}),
    claimIdempotency: async () => ({ replayed: false, idempotencyId: "idem-1" }),
    completeIdempotency: async () => {},
    writeAuditEvent: async () => "audit-1"
  });
  return { state, commands };
}

const cashier = { userId: "cashier-1", role: "kasir" };
const admin = { userId: "admin-1", role: "admin" };
const owner = { userId: "owner-1", role: "pimpinan" };

test("return request reserves quota but does not change stock or create refund obligation", async () => {
  const { state, commands } = harness();
  const result = await commands.requestSalesReturn({
    actor: cashier, invoiceId: "100", reason: "Kemasan rusak",
    lines: [{ returnQuotaSubjectId: "9", quantity: "1" }],
    idempotencyKey: "return-request-1", requestId: "req-return-1"
  });
  assert.equal(result.body.data.status, "requested");
  assert.equal(result.body.data.estimatedRefundAmount, "2500");
  assert.equal(state.reserved, 1);
  assert.equal(state.quarantined.length, 0);
  assert.equal(state.refundObligation, null);
});

test("Admin cannot review own return request", async () => {
  const { state, commands } = harness();
  state.request = { status: "requested", requestedByUserId: admin.userId };
  await assert.rejects(commands.reviewSalesReturn({
    actor: admin, salesReturnId: "55", decision: "approve", reason: "Checked",
    idempotencyKey: "return-review-1", requestId: "req-review-1"
  }), { code: "RETURN_SELF_REVIEW_BLOCKED" });
});

test("Pimpinan approval moves returned medicine to quarantine; refund approval stays separate", async () => {
  const { state, commands } = harness();
  state.request = { status: "admin_reviewed" };
  state.lines = [{ quotaId: "9", quantity: "1", refundAmount: "2500" }];
  state.reserved = 1;
  const approved = await commands.approveSalesReturn({
    actor: owner, salesReturnId: "55", reason: "Setuju masuk karantina",
    idempotencyKey: "return-approve-1", requestId: "req-approve-1"
  });
  assert.equal(approved.body.data.stockDisposition, "quarantine");
  assert.equal(state.approved, 1);
  assert.equal(state.reserved, 0);
  assert.equal(state.quarantined.length, 1);
  assert.equal(state.refundObligation, null);

  const refund = await commands.approveRefund({
    actor: owner, salesReturnId: "55", reason: "Setuju pengembalian dana",
    idempotencyKey: "refund-approve-1", requestId: "req-refund-1"
  });
  assert.equal(refund.body.data.amount, "2500");
  assert.equal(refund.body.data.status, "approved_pending_payout");
  assert.equal(state.refundObligation.amount, "2500");
});
