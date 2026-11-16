"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createClinicDomainCommands } = require("../lib/clinic-domain-commands");

function createFinanceHarness(overrides = {}) {
  const state = { payment: null, expense: null, refund: null, supplier: null, events: [] };
  const repository = {
    async getPaymentRecognitionPolicy(method) { return method === "cash" ? { approved: true } : { approved: false, requiresPimpinanReview: true }; },
    async lockPaymentSource() { return { sourceId: "10", status: "posted" }; },
    async appendPaymentEvent(_c, input) { state.payment = { ...input, paymentId: "20", reviewStatus: input.paymentMethod === "cash" ? "not_required" : "pending" }; return "20"; },
    async appendCashLedgerMovement(_c, input) { state.events.push({ type: "cash", ...input }); },
    async lockPaymentEvent() { return { paymentId: "20", reviewStatus: "pending", settlementStatus: "settled" }; },
    async approvePaymentEvent(_c, input) { state.payment.reviewStatus = "approved"; state.payment.reviewer = input.reviewerUserId; },
    async createExpense(_c, input) { state.expense = { ...input, expenseId: "30", status: "requested" }; return "30"; },
    async appendExpenseEvent(_c, input) { state.events.push({ type: "expense", ...input }); },
    async lockExpense() { return state.expense; },
    async approveExpense(_c, input) { state.expense.status = "approved"; state.expense.approver = input.approverUserId; },
    async getRefundPayoutPolicy() { return { approved: true }; },
    async lockRefundObligation() { return { status: "approved_pending_payout", outstandingAmount: "2500" }; },
    async appendRefundPayout(_c, input) { state.refund = { ...input, payoutId: "40" }; return "40"; },
    async markRefundPaid() { state.refund.status = "transferred"; },
    ...overrides
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

test("non-cash payment stays pending and is recognized only after Pimpinan approval", async () => {
  const { state, commands } = createFinanceHarness();
  const payment = {
    sourceType: "invoice", sourceId: "10", amount: "50000", paymentMethod: "qris",
    paymentStatus: "settled", businessDate: "2026-11-17", eventAtUtc: "2026-11-17T10:00:00Z"
  };
  const recorded = await commands.recordPayment({
    actor: cashier, payment, idempotencyKey: "payment-record-1", requestId: "payment-req-1"
  });
  assert.equal(recorded.body.data.paymentStatus, "settled");
  assert.equal(state.payment.reviewStatus, "pending");
  assert.equal(state.payment.incomeRecognizedAtUtc, undefined);
  const approved = await commands.approvePayment({
    actor: owner, paymentId: "20", reason: "Sudah direview",
    idempotencyKey: "payment-approve-1", requestId: "payment-req-2"
  });
  assert.equal(approved.body.data.incomeRecognized, true);
  assert.equal(state.payment.reviewStatus, "approved");
});

test("cash payment is immediately recorded to the cashier shift ledger", async () => {
  const { state, commands } = createFinanceHarness();
  await commands.recordPayment({
    actor: cashier, payment: {
      sourceType: "invoice", sourceId: "10", amount: "20000", paymentMethod: "cash",
      paymentStatus: "settled", businessDate: "2026-11-17",
      eventAtUtc: "2026-11-17T10:00:00Z", cashAccountId: "1", shiftId: "2"
    },
    idempotencyKey: "cash-record-1", requestId: "cash-req-1"
  });
  assert.equal(state.payment.reviewStatus, "not_required");
  assert.equal(state.events.filter(x => x.type === "cash").length, 1);
});

test("supplier partial payments require evidence and reject overpayment", async () => {
  const { commands } = createFinanceHarness({
    async getSupplierPaymentPolicy() { return { approved: true, partialPayments: true }; },
    async lockSupplierPayable() { return { outstandingAmount: "10000" }; },
    async appendSupplierPayment() { return "50"; },
    async applySupplierPaymentAllocation() {}
  });
  const payment = {
    sourceType: "supplier_payable", sourceId: "70", amount: "4000",
    paymentMethod: "transfer", paymentStatus: "settled",
    businessDate: "2026-11-17", eventAtUtc: "2026-11-17T10:00:00Z",
    evidenceFileId: "file-1"
  };
  const result = await commands.recordSupplierPayment({
    actor: admin, payment, idempotencyKey: "supplier-partial-1", requestId: "supplier-req-1"
  });
  assert.equal(result.body.data.outstandingAfter, "6000");
  await assert.rejects(commands.recordSupplierPayment({
    actor: admin, payment: { ...payment, amount: "10001" },
    idempotencyKey: "supplier-over-1", requestId: "supplier-req-2"
  }), { code: "SUPPLIER_PAYMENT_EXCEEDS_PAYABLE" });
});

test("expense is submitted by Admin and requires separate Pimpinan approval", async () => {
  const { state, commands } = createFinanceHarness();
  const submitted = await commands.createExpense({
    actor: admin, category: "supplies", description: "Pembelian ATK",
    amount: "100000", businessDate: "2026-11-17", evidenceFileId: "file-2",
    idempotencyKey: "expense-submit-1", requestId: "expense-req-1"
  });
  assert.equal(submitted.body.data.status, "requested");
  assert.equal(state.expense.status, "requested");
  const approved = await commands.approveExpense({
    actor: owner, expenseId: "30", reason: "Bukti sesuai",
    idempotencyKey: "expense-approve-1", requestId: "expense-req-2"
  });
  assert.equal(approved.body.data.status, "approved");
  assert.equal(state.expense.approver, owner.userId);
});

test("refund payout does not require a destination account, payment method, or transfer reference", async () => {
  const { state, commands } = createFinanceHarness();
  const result = await commands.payRefund({
    actor: owner,
    payout: {
      sourceId: "88", amount: "2500", paymentStatus: "settled",
      businessDate: "2026-11-17", eventAtUtc: "2026-11-17T10:00:00Z"
    },
    idempotencyKey: "refund-transfer-1", requestId: "refund-req-1"
  });
  assert.equal(result.body.data.status, "transferred");
  assert.equal(state.refund.amount, "2500");
});
