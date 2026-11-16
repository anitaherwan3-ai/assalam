"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createClinicDomainCommands } = require("../lib/clinic-domain-commands");

function createHarness(overrides = {}) {
  const state = {
    medicine: { medicineId: "med-1", quantityScale: 0, stockQty: "5", hpp: "1000", version: "1" },
    batches: [{ batchId: "batch-1", expiryDate: "2027-01-01", receivedAtUtc: "2026-10-01T00:00:00Z", remainingQty: "5", version: "1" }],
    movements: [], audits: [], patients: [], encounters: [], tickets: [],
    invoiceDrafts: [], invoices: [], invoiceLines: [], batchAllocations: [], returnQuotas: [],
    currentCall: null, nextSequence: 0, claims: new Map(), completed: new Map()
  };
  let queue = Promise.resolve();

  async function withTransaction(work) {
    const previous = queue;
    let release;
    queue = new Promise(resolve => { release = resolve; });
    await previous;
    const snapshot = structuredClone({
      medicine: state.medicine, batches: state.batches, movements: state.movements,
      audits: state.audits, patients: state.patients, encounters: state.encounters,
      tickets: state.tickets, invoiceDrafts: state.invoiceDrafts, invoices: state.invoices,
      invoiceLines: state.invoiceLines, batchAllocations: state.batchAllocations,
      returnQuotas: state.returnQuotas, currentCall: state.currentCall,
      nextSequence: state.nextSequence, claims: state.claims, completed: state.completed
    });
    try {
      return await work(state);
    } catch (error) {
      Object.assign(state, snapshot);
      throw error;
    } finally {
      release();
    }
  }

  const repo = {

    async lockCheckoutContext() {
      return {
        encounter: { encounterId: "enc-checkout", patientId: "pat-1", cashierUserId: "cashier-1", shiftId: "shift-1", businessDate: "2026-11-17" },
        shift: { shiftId: "shift-1", cashierUserId: "cashier-1", status: "open" }
      };
    },
    async buildAuthoritativeCheckoutSnapshot() {
      return {
        invoice: { number: "N20261117-0001", total: "6000" },
        lines: [{ name: "Obat Uji", medicineId: "med-1", quantity: "4", price: "1500", hpp: "1000" }],
        inventoryRequirements: [{ medicineId: "med-1", quantity: "4" }]
      };
    },
    async createInvoiceDraft() { const id = "invoice-" + (state.invoiceDrafts.length + 1); state.invoiceDrafts.push({ id, status: "draft" }); return id; },
    async insertInvoiceLines(_c, id, lines) { state.invoiceLines.push({ invoiceId: id, lines }); },
    async insertSaleBatchAllocations(_c, id, rows) { state.batchAllocations.push({ invoiceId: id, rows }); },
    async postInvoice(_c, id, totals) { state.invoices.push({ invoiceId: id, ...totals, status: "posted" }); },
    async createReturnQuotas(_c, id, lines) { state.returnQuotas.push({ invoiceId: id, lineCount: lines.length }); },
    async markEncounterCompleted(_c, id, invoiceId) { state.encounterCompleted = { id, invoiceId }; },
    async previewMedicine() { return { ...state.medicine }; },
    async lockSaleIssueSource(_c, id) { return { invoiceId: id, cashierUserId: "cashier-1", businessDate: "2026-11-17", status: "ready_for_stock_posting" }; },
    async lockMedicine() { return state.medicine; },
    async lockEligibleBatches() { return state.batches; },
    async decrementBatchBalance(_c, x) {
      const b = state.batches.find(item => item.batchId === x.batchId);
      if (!b || String(b.version) !== String(x.expectedVersion) || Number(b.remainingQty) < Number(x.quantity)) return 0;
      b.remainingQty = String(Number(b.remainingQty) - Number(x.quantity));
      b.version = String(Number(b.version) + 1);
      return 1;
    },
    async appendInventoryMovement(_c, movement) { state.movements.push(movement); return state.movements.length; },
    async updateMedicineStockOnly(_c, x) {
      if (state.medicine.version !== x.expectedVersion) throw Object.assign(new Error("version conflict"), { code: "VERSION_CONFLICT" });
      state.medicine.stockQty = x.stockQty;
      state.medicine.version = String(Number(state.medicine.version) + 1);
    },
    async lockOpenCashierShift() { return { cashierUserId: "cashier-1", status: "open" }; },
    async getClinicBusinessDate() { return "2026-11-17"; },
    async getServerNowUtc() { return "2026-11-17T00:00:00Z"; },
    async createPatient(_c, patient) { state.patients.push(patient); return "patient-" + state.patients.length; },
    async createEncounter(_c, data) { state.encounters.push(data); return { encounterId: "enc-" + state.encounters.length }; },
    async getQueuePrefixPolicy() { return { approved: true }; },
    async allocateQueueSequence() { state.nextSequence++; return state.nextSequence; },
    async createQueueTicket(_c, data) { const ticket = { ticketId: "ticket-" + (state.tickets.length + 1), queueNumber: data.prefix + "-" + String(data.sequence).padStart(3, "0"), laneCode: data.prefix, ...data }; state.tickets.push(ticket); return ticket; },
    async readQueueActiveCallPolicy() { return { mode: "per_lane" }; },
    async lockQueueCallGuard(_c, policy, lane) { return { policy, lane }; },
    async lockQueueTicket(_c, id) { return state.tickets.find(t => t.ticketId === id); },
    async findActiveQueueCall() { return state.currentCall; },
    async appendQueueCallEvent(_c, e) { state.lastQueueEvent = e; return "call-event-" + state.movements.length + "-" + state.tickets.length; },
    async setCurrentQueueCall(_c, _guard, value) { state.currentCall = value; },
    ...overrides
  };

  const deps = {
    repository: repo,
    withTransaction,
    claimIdempotency: async (_c, x) => {
      const key = [x.actorUserId, x.commandName, x.idempotencyKey].join("|");
      const prior = state.completed.get(key);
      if (prior) return { replayed: true, responseCode: prior.responseCode, response: prior.response };
      if (state.claims.has(key)) throw Object.assign(new Error("in progress"), { code: "IDEMPOTENCY_IN_PROGRESS" });
      state.claims.set(key, true);
      return { replayed: false, idempotencyId: key };
    },
    completeIdempotency: async (_c, x) => {
      const key = x.idempotencyId;
      state.completed.set(key, { responseCode: x.responseCode, response: x.response });
      state.claims.delete(key);
    },
    writeAuditEvent: async (_c, e) => { state.audits.push(e); return String(state.audits.length); }
  };
  return { state, repo, commands: createClinicDomainCommands(deps) };
}

const cashier = { userId: "cashier-1", role: "kasir" };
const lead = { userId: "lead-1", role: "pimpinan" };

test("two simultaneous checkouts competing for the last batch cannot create negative stock", async () => {
  const { state, commands } = createHarness();
  const request = key => commands.issueStock({
    actor: cashier, medicineId: "med-1", quantity: "4",
    sourceInvoiceId: "invoice-" + key, idempotencyKey: "key-" + key, requestId: "req-" + key
  });
  const results = await Promise.allSettled([request("one"), request("two")]);
  assert.equal(results.filter(x => x.status === "fulfilled").length, 1);
  assert.equal(results.filter(x => x.status === "rejected").length, 1);
  assert.equal(state.medicine.stockQty, "1");
  assert.equal(state.batches[0].remainingQty, "1");
  assert.equal(state.movements.length, 1);
  assert.equal(state.movements[0].quantity, "4");
});

test("idempotent retry returns the original result without a second stock movement", async () => {
  const { state, commands } = createHarness();
  const request = {
    actor: cashier, medicineId: "med-1", quantity: "2",
    sourceInvoiceId: "invoice-1", idempotencyKey: "same-key-123", requestId: "req-1"
  };
  const first = await commands.issueStock(request);
  const replay = await commands.issueStock(request);
  assert.deepEqual(replay, first);
  assert.equal(state.movements.length, 1);
  assert.equal(state.medicine.stockQty, "3");
});

test("failed movement write rolls back earlier batch changes and leaves no audit/idempotency result", async () => {
  const { state, commands } = createHarness({
    async appendInventoryMovement() { throw Object.assign(new Error("simulated failure"), { code: "WRITE_FAILED" }); }
  });
  await assert.rejects(commands.issueStock({
    actor: cashier, medicineId: "med-1", quantity: "2",
    sourceInvoiceId: "invoice-fail", idempotencyKey: "failure-key-1", requestId: "req-fail"
  }), { code: "WRITE_FAILED" });
  assert.equal(state.medicine.stockQty, "5");
  assert.equal(state.batches[0].remainingQty, "5");
  assert.equal(state.movements.length, 0);
  assert.equal(state.audits.length, 0);
});

test("concurrent encounter registration creates separate visit rows and unique queue numbers", async () => {
  const { state, commands } = createHarness();
  const register = (suffix, name) => commands.registerEncounter({
    actor: cashier, patient: { fullName: name },
    shiftId: "shift-1", serviceCode: "KONSULTASI", queuePrefix: "A",
    idempotencyKey: "registration-" + suffix, requestId: "req-" + suffix
  });
  const [a, b] = await Promise.all([register("a", "Pasien A"), register("b", "Pasien B")]);
  const numbers = [a.body.data.queueNumber, b.body.data.queueNumber].sort();
  assert.deepEqual(numbers, ["A-001", "A-002"]);
  assert.equal(state.patients.length, 2);
  assert.equal(state.encounters.length, 2);
  assert.notEqual(a.body.data.patientId, b.body.data.patientId);
});

test("queue call guard serializes concurrent announcements within the configured policy", async () => {
  const { state, commands } = createHarness();
  state.tickets = [
    { ticketId: "ticket-A", laneCode: "A", queueNumber: "A-001" },
    { ticketId: "ticket-B", laneCode: "A", queueNumber: "A-002" }
  ];
  const call = id => commands.appendQueueCallEvent({
    actor: cashier, ticketId: id, laneCode: "A", eventType: "call",
    idempotencyKey: "call-key-" + id, requestId: "call-req-" + id
  });
  const results = await Promise.allSettled([call("ticket-A"), call("ticket-B")]);
  assert.equal(results.filter(x => x.status === "fulfilled").length, 1);
  assert.equal(results.filter(x => x.status === "rejected").length, 1);
  assert.ok(state.currentCall);
});

test("balanced journal posts while unbalanced journal is rejected before storage", async () => {
  let inserted = 0;
  const { commands } = createHarness({
    async getAccountingPeriod() { return { status: "open" }; },
    async createJournal() { inserted++; return "journal-1"; },
    async insertJournalLines() {}
  });
  const input = {
    actor: lead, idempotencyKey: "journal-key-1", requestId: "journal-req-1",
    journal: {
      sourceType: "cash_receipt", sourceId: "pay-1", businessDate: "2026-11-17",
      description: "Penerimaan tunai",
      lines: [
        { accountId: "cash", side: "debit", amount: "100000" },
        { accountId: "revenue", side: "credit", amount: "100000" }
      ]
    }
  };
  await commands.postJournal(input);
  assert.equal(inserted, 1);
  await assert.rejects(commands.postJournal({
    ...input,
    idempotencyKey: "journal-key-2",
    journal: { ...input.journal, lines: [
      { accountId: "cash", side: "debit", amount: "100000" },
      { accountId: "revenue", side: "credit", amount: "90000" }
    ]}
  }), { code: "JOURNAL_UNBALANCED" });
  assert.equal(inserted, 1);
});

test("cash payment is blocked when non-cash settlement policy is still unresolved", async () => {
  const { commands } = createHarness({
    async getPaymentRecognitionPolicy() { return null; }
  });
  await assert.rejects(commands.recordPayment({
    actor: cashier, idempotencyKey: "payment-key-1", requestId: "payment-req-1",
    payment: {
      sourceType: "invoice", sourceId: "invoice-1", amount: "50000",
      paymentMethod: "qris", paymentStatus: "settled",
      businessDate: "2026-11-17", eventAtUtc: "2026-11-17T00:00:00Z",
      settlementReference: "QRIS-REF-1"
    }
  }), { code: "PAYMENT_RECOGNITION_POLICY_PENDING" });
});

test("supplier payment and refund payout fail closed until their owner policies are approved", async () => {
  const { commands } = createHarness({
    async getSupplierPaymentPolicy() { return null; },
    async getRefundPayoutPolicy() { return null; }
  });
  const payment = {
    sourceType: "supplier_payable", sourceId: "payable-1", amount: "10000",
    paymentMethod: "transfer", paymentStatus: "settled",
    businessDate: "2026-11-17", eventAtUtc: "2026-11-17T00:00:00Z",
    settlementReference: "BANK-REF-1"
  };
  await assert.rejects(commands.recordSupplierPayment({
    actor: lead, payment, idempotencyKey: "supplier-pay-1", requestId: "supplier-pay-req"
  }), { code: "SUPPLIER_PAYMENT_POLICY_PENDING" });
  await assert.rejects(commands.payRefund({
    actor: lead, payout: payment, idempotencyKey: "refund-pay-1", requestId: "refund-pay-req"
  }), { code: "REFUND_PAYOUT_POLICY_PENDING" });
});

test("checkout posts invoice, batch movements, allocations and encounter completion in one transaction", async () => {
  const { state, commands } = createHarness();
  const result = await commands.postCheckout({
    actor: cashier, encounterId: "enc-checkout", shiftId: "shift-1",
    items: [{ medicineId: "med-1", quantity: "4" }],
    idempotencyKey: "checkout-key-1", requestId: "checkout-req-1"
  });
  assert.equal(result.body.data.total, "6000");
  assert.equal(state.medicine.stockQty, "1");
  assert.equal(state.batches[0].remainingQty, "1");
  assert.equal(state.movements.length, 1);
  assert.equal(state.invoiceLines.length, 1);
  assert.equal(state.batchAllocations.length, 1);
  assert.equal(state.invoices[0].status, "posted");
  assert.equal(state.returnQuotas.length, 1);
  assert.equal(state.encounterCompleted.invoiceId, result.body.data.invoiceId);
});

test("checkout failure after invoice draft and stock deduction rolls back the complete transaction", async () => {
  const { state, commands } = createHarness({
    async createReturnQuotas() { throw Object.assign(new Error("quota write failed"), { code: "RETURN_QUOTA_WRITE_FAILED" }); }
  });
  await assert.rejects(commands.postCheckout({
    actor: cashier, encounterId: "enc-checkout", shiftId: "shift-1",
    items: [{ medicineId: "med-1", quantity: "4" }],
    idempotencyKey: "checkout-failure-1", requestId: "checkout-failure-req"
  }), { code: "RETURN_QUOTA_WRITE_FAILED" });
  assert.equal(state.medicine.stockQty, "5");
  assert.equal(state.batches[0].remainingQty, "5");
  assert.equal(state.movements.length, 0);
  assert.equal(state.invoiceDrafts.length, 0);
  assert.equal(state.invoices.length, 0);
  assert.equal(state.invoiceLines.length, 0);
  assert.equal(state.batchAllocations.length, 0);
  assert.equal(state.returnQuotas.length, 0);
  assert.equal(state.encounterCompleted, undefined);
  assert.equal(state.audits.length, 0);
});
