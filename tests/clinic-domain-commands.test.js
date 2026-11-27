"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createClinicDomainCommands } = require("../lib/clinic-domain-commands");

function createHarness(overrides = {}) {
  const state = {
    medicine: { medicineId: "med-1", quantityScale: 0, stockQty: "5", hpp: "1000", version: "1" },
    batches: [{ batchId: "batch-1", expiryDate: "2027-01-01", receivedAtUtc: "2026-10-01T00:00:00Z", remainingQty: "5", disposition: "sellable", version: "1" }],
    movements: [], audits: [], patients: [], encounters: [], tickets: [],
    invoiceDrafts: [], invoices: [], invoiceLines: [], batchAllocations: [], returnQuotas: [], encounterCompleted: null,
    payments: [], cashEntries: [],
    purchaseLine: { purchaseId: "purchase-1", purchaseLineId: "line-1", medicineId: "med-1", supplierId: "sup-1", quantityScale: 0, orderedQty: "5", receivedQty: "0", purchasedQty: "5", returnedQty: "0", originalBatchAllocations: [{ batchId: "batch-1" }] },
    receipts: [], payableUpserts: [], supplierReturnRequests: [], supplierReturnStatus: null,
    suppliers: [{ supplierId: 1, supplierName: "Kimia Farma" }],
    supplierInvoices: [], supplierInvoiceLines: [],
    supplierPayments: [], supplierPaymentAllocations: [],
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
      returnQuotas: state.returnQuotas, encounterCompleted: state.encounterCompleted,
      payments: state.payments, cashEntries: state.cashEntries,
      purchaseLine: state.purchaseLine, receipts: state.receipts, payableUpserts: state.payableUpserts,
      supplierReturnRequests: state.supplierReturnRequests, supplierReturnStatus: state.supplierReturnStatus,
      suppliers: state.suppliers, supplierInvoices: state.supplierInvoices, supplierInvoiceLines: state.supplierInvoiceLines,
      supplierPayments: state.supplierPayments, supplierPaymentAllocations: state.supplierPaymentAllocations,
      currentCall: state.currentCall,
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

    async lockPaymentSource() { return { sourceId: "invoice-1", status: "posted" }; },
    async appendPaymentEvent(_c, data) {
      state.payments.push(data);
      return "payment-" + state.payments.length;
    },
    async ensureCashAccount(_c, userId) { return "drawer-" + userId; },
    async appendCashLedgerMovement(_c, data) {
      state.cashEntries.push(data);
      return state.cashEntries.length;
    },
    async lockCheckoutContext(_c, encounterId, shiftId) {
      return {
        encounter: { encounterId: String(encounterId), patientId: "patient-" + encounterId, cashierUserId: "cashier-1", shiftId: String(shiftId), businessDate: "2026-11-17" },
        shift: { shiftId: String(shiftId), cashierUserId: "cashier-1", status: "open" }
      };
    },
    async buildAuthoritativeCheckoutSnapshot(_c, input) {
      const qty = String(input.requestedItems[0].quantity);
      const amount = String(Number(qty) * 1500);
      return {
        invoice: { number: "N20261117-" + qty, total: amount },
        lines: [{ name: "Obat Uji", medicineId: "med-1", quantity: qty, price: "1500", hpp: "1000" }],
        inventoryRequirements: [{ medicineId: "med-1", quantity: qty }]
      };
    },
    async createInvoiceDraft() { const id = "invoice-" + (state.invoiceDrafts.length + 1); state.invoiceDrafts.push({ id, status: "draft" }); return id; },
    async insertInvoiceLines(_c, id, lines) { state.invoiceLines.push({ invoiceId: id, lines }); },
    async insertSaleBatchAllocations(_c, id, rows) { state.batchAllocations.push({ invoiceId: id, rows }); },
    async postInvoice(_c, id, totals) { state.invoices.push({ invoiceId: id, ...totals, status: "posted" }); },
    async createReturnQuotas(_c, id, lines) { state.returnQuotas.push({ invoiceId: id, lineCount: lines.length }); },
    async markEncounterCompleted(_c, id, invoiceId) { state.encounterCompleted = { id, invoiceId }; },
    async previewMedicine() { return { ...state.medicine }; },
    async previewPurchaseLine() {
      return {
        medicineId: state.purchaseLine ? state.purchaseLine.medicineId : "med-1",
        supplierId: state.purchaseLine ? String(state.purchaseLine.supplierId) : "sup-1",
        unitCost: "2000",
        quantityScale: 0
      };
    },
    async lockPurchaseLine() { return state.purchaseLine; },
    async getPurchaseReceiptPolicy() { return { mode: "split_receipts" }; },
    async createPurchaseReceipt(_c, data) { state.receipts.push(data); return "receipt-" + state.receipts.length; },
    async createBatch(_c, data) {
      const batch = { batchId: "batch-new-" + state.batches.length, remainingQty: data.remainingQty, version: "1", ...data };
      state.batches.push(batch);
      return batch.batchId;
    },
    async updateMedicineProjection(_c, data) {
      state.medicine.stockQty = data.stockQty;
      state.medicine.hpp = data.hpp;
      state.medicine.version = String(Number(state.medicine.version) + 1);
    },
    async updatePurchaseLineReceived(_c, data) { state.purchaseLine.receivedQty = data.receivedQty; },
    async ensureSupplierPayable(_c, data) { state.payableUpserts.push(data); },
    async ensureSupplier(_c, name) {
      let sup = state.suppliers.find(s => s.supplierName.toLowerCase() === name.toLowerCase());
      if (!sup) {
        sup = { supplierId: state.suppliers.length + 1, supplierName: name };
        state.suppliers.push(sup);
      }
      return sup.supplierId;
    },
    async findSupplierInvoiceByNumber(_c, supplierId, invoiceNumber) {
      return state.supplierInvoices.find(inv => inv.supplierId === supplierId && inv.supplierInvoiceNumber === invoiceNumber) || null;
    },
    async createSupplierInvoice(_c, data) {
      const id = state.supplierInvoices.length + 1;
      const record = { supplierInvoiceId: id, ...data };
      state.supplierInvoices.push(record);
      return id;
    },
    async createSupplierInvoiceLine(_c, data) {
      const id = state.supplierInvoiceLines.length + 1;
      const record = { supplierInvoiceLineId: id, ...data };
      state.supplierInvoiceLines.push(record);
      return id;
    },
    async getSupplierPaymentPolicy() { return { approved: true, partialPayments: true }; },
    async lockSupplierPayable(_c, invoiceId) {
      const inv = state.supplierInvoices.find(i => String(i.supplierInvoiceId) === String(invoiceId));
      if (!inv) return null;
      const totalPaid = state.supplierPaymentAllocations
        .filter(a => String(a.payableId) === String(invoiceId))
        .reduce((sum, a) => sum + BigInt(a.amount), 0n);
      const gross = BigInt(inv.grossAmount || 0);
      const outstanding = gross > totalPaid ? gross - totalPaid : 0n;
      return { payableId: String(inv.supplierInvoiceId), supplierId: String(inv.supplierId), grossAmount: gross.toString(), outstandingAmount: outstanding.toString() };
    },
    async appendSupplierPayment(_c, data) {
      const id = "pay-" + (state.supplierPayments.length + 1);
      state.supplierPayments.push({ paymentId: id, ...data });
      return id;
    },
    async applySupplierPaymentAllocation(_c, data) {
      state.supplierPaymentAllocations.push({ ...data });
    },
    async previewSupplierReturnSource() {
      return {
        quantityScale: 0,
        purchase: { purchasedQty: "5", returnedQty: "0", originalBatchAllocations: [{ batchId: "batch-1" }] },
        batch: { batchId: "batch-1", remainingQty: "5" }
      };
    },
    async createSupplierReturnRequest(_c, data) {
      state.supplierReturnRequests.push({ supplierReturnId: "supplier-return-" + state.supplierReturnRequests.length, status: "requested", ...data });
      return state.supplierReturnRequests[state.supplierReturnRequests.length - 1].supplierReturnId;
    },
    async lockBatch(_c, id) { return state.batches.find(b => String(b.batchId) === String(id)); },
    async lockSupplierReturn(_c, id) { return state.supplierReturnRequests.find(r => r.supplierReturnId === id); },
    async markSupplierReturnDispatched(_c, data) {
      state.supplierReturnStatus = { ...data };
      const row = state.supplierReturnRequests.find(r => r.supplierReturnId === data.supplierReturnId);
      row.status = "dispatched";
      state.purchaseLine.returnedQty = String(Number(state.purchaseLine.returnedQty) + Number(row.quantity));
    },
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

test("quarantine approval enforces Admin and Pimpinan dual control", async () => {
  let approvedEventId = null;
  const { commands } = createHarness({
    async lockLatestQuarantineInspection() {
      return { eventId: "event-1", inspectionDecision: "release", inspectedByUserId: "admin-1" };
    },
    async approveQuarantineRelease(_connection, input) { approvedEventId = input.eventId; }
  });
  await assert.rejects(commands.approveQuarantineRelease({
    actor: { userId: "admin-1", role: "pimpinan" }, batchId: "batch-1",
    reason: "Sudah diperiksa", idempotencyKey: "quarantine-approve-same", requestId: "quarantine-approve-same"
  }), { code: "QUARANTINE_DUAL_CONTROL_REQUIRED" });
  const result = await commands.approveQuarantineRelease({
    actor: { userId: "lead-1", role: "pimpinan" }, batchId: "batch-1",
    reason: "Sudah diperiksa", idempotencyKey: "quarantine-approve-other", requestId: "quarantine-approve-other"
  });
  assert.equal(result.body.data.status, "release_approved_waiting_admin");
  assert.equal(approvedEventId, "event-1");
});

test("quarantine release execution records a reason after Pimpinan approval", async () => {
  let released = false, savedReason = "";
  const { commands } = createHarness({
    async lockLatestQuarantineInspection() {
      return {
        eventId: "event-1", inspectionDecision: "release",
        inspectedByUserId: "admin-1", releaseApprovedByUserId: "lead-1"
      };
    },
    async releaseQuarantineBatch(_connection, input) {
      released = true; savedReason = input.reason;
      return { sellableQuantity: "5" };
    }
  });
  await assert.rejects(commands.releaseQuarantineBatch({
    actor: { userId: "admin-1", role: "admin" }, batchId: "batch-1",
    idempotencyKey: "quarantine-release-no-reason", requestId: "quarantine-release-no-reason"
  }), { code: "QUARANTINE_RELEASE_COMPLETION_REASON_REQUIRED" });
  const result = await commands.releaseQuarantineBatch({
    actor: { userId: "admin-1", role: "admin" }, batchId: "batch-1",
    reason: "Dilepas setelah approval Pimpinan", idempotencyKey: "quarantine-release-approved", requestId: "quarantine-release-approved"
  });
  assert.equal(result.body.data.status, "sellable");
  assert.equal(savedReason, "Dilepas setelah approval Pimpinan");
  assert.equal(released, true);
});

test("quarantine disposal cannot be proposed without a physical evidence reference", async () => {
  const { commands } = createHarness();
  await assert.rejects(commands.inspectQuarantineBatch({
    actor: { userId: "admin-1", role: "admin" }, batchId: "batch-1",
    decision: "dispose", reason: "Rusak", idempotencyKey: "quarantine-dispose-no-proof", requestId: "quarantine-dispose-no-proof"
  }), { code: "QUARANTINE_DISPOSAL_EVIDENCE_REQUIRED" });
});

const cashier = { userId: "cashier-1", role: "kasir" };
const lead = { userId: "lead-1", role: "pimpinan" };

test("two simultaneous checkouts competing for the last batch cannot create negative stock", async () => {
  const { state, commands } = createHarness();
  const request = key => commands.postCheckout({
    actor: cashier, encounterId: "enc-" + key, shiftId: "shift-1",
    items: [{ medicineId: "med-1", quantity: "4" }],
    idempotencyKey: "key-" + key, requestId: "req-" + key
  });
  const results = await Promise.allSettled([request("one"), request("two")]);
  assert.equal(results.filter(x => x.status === "fulfilled").length, 1);
  assert.equal(results.filter(x => x.status === "rejected").length, 1);
  assert.equal(state.medicine.stockQty, "1");
  assert.equal(state.batches[0].remainingQty, "1");
  assert.equal(state.movements.length, 1);
  assert.equal(state.invoices.length, 1);
});

test("idempotent checkout retry returns the original invoice without duplicate movement", async () => {
  const { state, commands } = createHarness();
  const request = {
    actor: cashier, encounterId: "enc-idem", shiftId: "shift-1",
    items: [{ medicineId: "med-1", quantity: "2" }],
    idempotencyKey: "same-key-123", requestId: "req-1"
  };
  const first = await commands.postCheckout(request);
  const replay = await commands.postCheckout(request);
  assert.deepEqual(replay, first);
  assert.equal(state.movements.length, 1);
  assert.equal(state.invoices.length, 1);
  assert.equal(state.medicine.stockQty, "3");
});

test("checkout failure rolls back the invoice, batch and ledger writes together", async () => {
  const { state, commands } = createHarness({
    async appendInventoryMovement() { throw Object.assign(new Error("simulated failure"), { code: "WRITE_FAILED" }); }
  });
  await assert.rejects(commands.postCheckout({
    actor: cashier, encounterId: "enc-fail", shiftId: "shift-1",
    items: [{ medicineId: "med-1", quantity: "2" }],
    idempotencyKey: "failure-key-1", requestId: "req-fail"
  }), { code: "WRITE_FAILED" });
  assert.equal(state.medicine.stockQty, "5");
  assert.equal(state.batches[0].remainingQty, "5");
  assert.equal(state.movements.length, 0);
  assert.equal(state.invoiceDrafts.length, 0);
  assert.equal(state.invoices.length, 0);
  assert.equal(state.audits.length, 0);
});

test("checkout with cash payment writes to invoice_payments and cash_ledger_entries under shift", async () => {
  const { state, commands } = createHarness();
  const res = await commands.postCheckout({
    actor: cashier, encounterId: "enc-cash-1", shiftId: "shift-1",
    items: [{ medicineId: "med-1", quantity: "2" }],
    payment: { method: "cash", amountPaid: "3000" },
    idempotencyKey: "cash-key-1", requestId: "req-cash-1"
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.payment.method, "cash");
  assert.equal(res.body.data.payment.amount, "3000");
  assert.equal(state.payments.length, 1);
  assert.equal(state.payments[0].paymentMethod, "cash");
  assert.equal(state.payments[0].paymentStatus, "settled");
  assert.equal(state.cashEntries.length, 1);
  assert.equal(state.cashEntries[0].direction, "in");
  assert.equal(state.cashEntries[0].amount, "3000");
  assert.equal(state.cashEntries[0].shiftId, "shift-1");
  assert.equal(state.cashEntries[0].sourceType, "sale");
});

test("checkout with non-cash payment writes to invoice_payments but does not alter cash drawer", async () => {
  const { state, commands } = createHarness();
  const res = await commands.postCheckout({
    actor: cashier, encounterId: "enc-qris-1", shiftId: "shift-1",
    items: [{ medicineId: "med-1", quantity: "1" }],
    payment: { method: "qris", amountPaid: "1500" },
    idempotencyKey: "qris-key-1", requestId: "req-qris-1"
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.payment.method, "qris");
  assert.equal(res.body.data.payment.reviewStatus, "pending");
  assert.equal(res.body.data.payment.settlementStatus, "pending");
  assert.equal(res.body.data.payment.incomeRecognized, false);
  assert.equal(state.payments.length, 1);
  assert.equal(state.payments[0].paymentMethod, "qris");
  assert.equal(state.payments[0].paymentStatus, "pending_settlement");
  assert.equal(state.cashEntries.length, 0);
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

test("non-cash payment is recorded pending review while recognition policy remains unresolved", async () => {
  const { state, commands } = createHarness({
    async getPaymentRecognitionPolicy() { return null; }
  });
  const result = await commands.recordPayment({
    actor: cashier, idempotencyKey: "payment-key-1", requestId: "payment-req-1",
    payment: {
      sourceType: "invoice", sourceId: "invoice-1", amount: "50000",
      paymentMethod: "qris", paymentStatus: "pending_settlement",
      businessDate: "2026-11-17", eventAtUtc: "2026-11-17T00:00:00Z"
    }
  });
  assert.equal(result.body.data.paymentStatus, "pending_settlement");
  assert.equal(state.audits.length, 1);
});
test("supplier payment and refund payout fail closed until their owner policies are approved", async () => {
  const { commands } = createHarness({
    async getSupplierPaymentPolicy() { return null; },
    async getRefundPayoutPolicy() { return null; }
  });
  const payment = {
    sourceType: "supplier_payable", sourceId: "payable-1", amount: "10000",
    paymentMethod: "bank_transfer", paymentStatus: "settled",
    businessDate: "2026-11-17", eventAtUtc: "2026-11-17T00:00:00Z",
    settlementReference: "BANK-REF-1"
  };
  await assert.rejects(commands.recordSupplierPayment({
    actor: lead, payment, idempotencyKey: "supplier-pay-1", requestId: "supplier-pay-req"
  }), { code: "SUPPLIER_PAYMENT_POLICY_PENDING" });
  await assert.rejects(commands.payRefund({
    actor: cashier, payout: payment, idempotencyKey: "refund-pay-1", requestId: "refund-pay-req"
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
  assert.equal(state.encounterCompleted, null);
  assert.equal(state.audits.length, 0);
});

test("purchase receipt atomically creates receipt, batch, movement, HPP and supplier payable", async () => {
  const { state, commands } = createHarness();
  const result = await commands.receivePurchase({
    actor: { userId: "lead-1", role: "pimpinan" },
    purchaseLineId: "line-1", receivedQty: "5", purchaseValue: "10000",
    receiptReference: "GRN-001",
    batch: {
      batchNo: "BATCH-NEW", expiryDate: "2027-12-31",
      receivedAtUtc: "2026-11-17T00:00:00Z", disposition: "sellable"
    },
    idempotencyKey: "purchase-receipt-1", requestId: "purchase-receipt-req"
  });
  assert.equal(result.body.data.receivedQty, "5");
  assert.equal(result.body.data.stockQty, "10");
  assert.equal(result.body.data.hpp, "1500");
  assert.equal(state.receipts.length, 1);
  assert.equal(state.batches.length, 2);
  assert.equal(state.movements.length, 1);
  assert.equal(state.purchaseLine.receivedQty, "5");
  assert.equal(state.payableUpserts.length, 1);
});

test("purchase receipt failure rolls back receipt, batch, movement, stock and payable", async () => {
  const { state, commands } = createHarness({
    async updatePurchaseLineReceived() { throw Object.assign(new Error("line update failed"), { code: "PURCHASE_LINE_UPDATE_FAILED" }); }
  });
  await assert.rejects(commands.receivePurchase({
    actor: { userId: "lead-1", role: "pimpinan" },
    purchaseLineId: "line-1", receivedQty: "5", purchaseValue: "10000",
    receiptReference: "GRN-ROLLBACK",
    batch: {
      batchNo: "BATCH-ROLLBACK", expiryDate: "2027-12-31",
      receivedAtUtc: "2026-11-17T00:00:00Z", disposition: "inspection_pending"
    },
    idempotencyKey: "purchase-receipt-fail", requestId: "purchase-receipt-fail-req"
  }), { code: "PURCHASE_LINE_UPDATE_FAILED" });
  assert.equal(state.medicine.stockQty, "5");
  assert.equal(state.medicine.hpp, "1000");
  assert.equal(state.batches.length, 1);
  assert.equal(state.receipts.length, 0);
  assert.equal(state.movements.length, 0);
  assert.equal(state.purchaseLine.receivedQty, "0");
  assert.equal(state.payableUpserts.length, 0);
  assert.equal(state.audits.length, 0);
});

test("supplier return request reserves no stock; approved dispatch posts one negative movement", async () => {
  const { state, commands } = createHarness();
  const requested = await commands.createSupplierReturnRequest({
    actor: { userId: "lead-1", role: "pimpinan" },
    purchaseLineId: "line-1", batchId: "batch-1", quantity: "2",
    reason: "Barang rusak",
    idempotencyKey: "supplier-return-request-1", requestId: "supplier-return-request-req"
  });
  assert.equal(requested.body.data.stockMovementPosted, false);
  assert.equal(state.medicine.stockQty, "5");
  assert.equal(state.movements.length, 0);
  const row = state.supplierReturnRequests[0];
  row.status = "approved_for_dispatch";
  const dispatched = await commands.dispatchSupplierReturn({
    actor: { userId: "lead-1", role: "pimpinan" },
    supplierReturnId: row.supplierReturnId, dispatchReference: "DO-RET-001",
    idempotencyKey: "supplier-return-dispatch-1", requestId: "supplier-return-dispatch-req"
  });
  assert.equal(dispatched.body.data.stockMovementPosted, true);
  assert.equal(dispatched.body.data.supplierCreditRecognized, false);
  assert.equal(state.medicine.stockQty, "3");
  assert.equal(state.batches[0].remainingQty, "3");
  assert.equal(state.movements.length, 1);
  assert.equal(state.movements[0].direction, "out");
  assert.equal(state.supplierReturnStatus.settlementStatus, "owner_policy_pending");
});


test("queue transfer requires a reason and records old/new cashier and shift ownership", async () => {
  const { state, commands } = createHarness({
    async lockQueueTicket() {
      return { ticketId: "ticket-1", currentCashierUserId: "cashier-1", currentShiftId: "shift-morning", version: "3" };
    },
    async assertQueueTransferAllowed() {},
    async lockTargetOpenShift(_c, shiftId, cashierUserId) {
      return shiftId === "shift-evening" && cashierUserId === "cashier-2"
        ? { shiftId, cashierUserId } : null;
    },
    async transferQueueTicket(_c, input) {
      state.transfer = input;
      return "transfer-event-1";
    }
  });
  await assert.rejects(commands.transferQueue({
    actor: cashier, ticketId: "ticket-1", toCashierUserId: "cashier-2",
    toShiftId: "shift-evening", reason: " ",
    idempotencyKey: "queue-transfer-empty", requestId: "queue-transfer-empty-req"
  }), { code: "QUEUE_TRANSFER_REASON_REQUIRED" });
  const result = await commands.transferQueue({
    actor: cashier, ticketId: "ticket-1", toCashierUserId: "cashier-2",
    toShiftId: "shift-evening", reason: "Pelimpahan ke kasir sore",
    idempotencyKey: "queue-transfer-valid", requestId: "queue-transfer-valid-req"
  });
  assert.equal(result.body.data.transferEventId, "transfer-event-1");
  assert.equal(state.transfer.fromCashierUserId, "cashier-1");
  assert.equal(state.transfer.fromShiftId, "shift-morning");
  assert.equal(state.transfer.toCashierUserId, "cashier-2");
  assert.equal(state.transfer.toShiftId, "shift-evening");
  assert.equal(state.transfer.reason, "Pelimpahan ke kasir sore");
  assert.equal(state.audits.at(-1).actionCode, "QUEUE_TICKET_TRANSFERRED");
});

test("queue transfer requires an active target shift and rolls back on invalid target", async () => {
  const { state, commands } = createHarness({
    async lockQueueTicket() {
      return { ticketId: "ticket-1", currentCashierUserId: "cashier-1", currentShiftId: "shift-morning", version: "1" };
    },
    async assertQueueTransferAllowed() {},
    async lockTargetOpenShift() { return null; },
    async transferQueueTicket() { state.transfer = true; return "transfer-event-2"; }
  });
  await assert.rejects(commands.transferQueue({
    actor: cashier, ticketId: "ticket-1", toCashierUserId: "cashier-2",
    toShiftId: "shift-closed", reason: "Kasir sore mengambil alih",
    idempotencyKey: "queue-transfer-closed", requestId: "queue-transfer-closed-req"
  }), { code: "QUEUE_TRANSFER_TARGET_SHIFT_INVALID" });
  assert.equal(state.transfer, undefined);
  assert.equal(state.audits.length, 0);
});

test("createSupplierInvoice creates supplier invoice and lines atomically", async () => {
  const { state, commands } = createHarness();
  const res = await commands.createSupplierInvoice({
    actor: { userId: "admin-1", role: "admin" },
    supplierName: "Kimia Farma",
    supplierInvoiceNumber: "INV-KF-001",
    invoiceDate: "2026-11-25",
    dueDate: "2026-12-25",
    totalAmount: "50000",
    lines: [
      { medicineId: "med-1", orderedQty: "10", unitCost: "5000", subtotal: "50000" }
    ],
    idempotencyKey: "key-inv-1",
    requestId: "req-inv-1"
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.supplierInvoiceNumber, "INV-KF-001");
  assert.equal(res.body.data.lines.length, 1);
  assert.equal(res.body.data.lines[0].orderedQty, "10");
  assert.equal(state.supplierInvoices.length, 1);
  assert.equal(state.supplierInvoiceLines.length, 1);
  assert.equal(state.audits.at(-1).actionCode, "SUPPLIER_INVOICE_CREATED");
});

test("createSupplierInvoice rejects duplicate invoice number for the same supplier", async () => {
  const { commands } = createHarness();
  await commands.createSupplierInvoice({
    actor: { userId: "admin-1", role: "admin" },
    supplierName: "Kimia Farma",
    supplierInvoiceNumber: "INV-KF-DUP",
    invoiceDate: "2026-11-25",
    dueDate: "2026-12-25",
    totalAmount: "10000",
    lines: [{ medicineId: "med-1", orderedQty: "2", unitCost: "5000", subtotal: "10000" }],
    idempotencyKey: "key-dup-1",
    requestId: "req-dup-1"
  });

  await assert.rejects(commands.createSupplierInvoice({
    actor: { userId: "admin-1", role: "admin" },
    supplierName: "Kimia Farma",
    supplierInvoiceNumber: "INV-KF-DUP",
    invoiceDate: "2026-11-25",
    dueDate: "2026-12-25",
    totalAmount: "10000",
    lines: [{ medicineId: "med-1", orderedQty: "2", unitCost: "5000", subtotal: "10000" }],
    idempotencyKey: "key-dup-2",
    requestId: "req-dup-2"
  }), { code: "SUPPLIER_INVOICE_DUPLICATE" });
});

test("createSupplierInvoice retry with same idempotency key returns replayed response without duplicate lines", async () => {
  const { state, commands } = createHarness();
  const first = await commands.createSupplierInvoice({
    actor: { userId: "admin-1", role: "admin" },
    supplierName: "Kimia Farma",
    supplierInvoiceNumber: "INV-KF-RETRY",
    invoiceDate: "2026-11-25",
    dueDate: "2026-12-25",
    totalAmount: "25000",
    lines: [{ medicineId: "med-1", orderedQty: "5", unitCost: "5000", subtotal: "25000" }],
    idempotencyKey: "key-retry-1",
    requestId: "req-retry-1"
  });

  const retry = await commands.createSupplierInvoice({
    actor: { userId: "admin-1", role: "admin" },
    supplierName: "Kimia Farma",
    supplierInvoiceNumber: "INV-KF-RETRY",
    invoiceDate: "2026-11-25",
    dueDate: "2026-12-25",
    totalAmount: "25000",
    lines: [{ medicineId: "med-1", orderedQty: "5", unitCost: "5000", subtotal: "25000" }],
    idempotencyKey: "key-retry-1",
    requestId: "req-retry-1-attempt-2"
  });

  assert.equal(retry.body.data.supplierInvoiceNumber, first.body.data.supplierInvoiceNumber);
  assert.equal(state.supplierInvoices.length, 1);
  assert.equal(state.supplierInvoiceLines.length, 1);
});

test("receivePurchase connects to created supplier invoice line and updates stock and payable", async () => {
  const { state, commands } = createHarness();
  const invoiceRes = await commands.createSupplierInvoice({
    actor: { userId: "admin-1", role: "admin" },
    supplierName: "Kimia Farma",
    supplierInvoiceNumber: "INV-KF-RCV",
    invoiceDate: "2026-11-25",
    dueDate: "2026-12-25",
    totalAmount: "20000",
    lines: [{ medicineId: "med-1", orderedQty: "4", unitCost: "5000", subtotal: "20000" }],
    idempotencyKey: "key-inv-rcv",
    requestId: "req-inv-rcv"
  });

  const createdLine = invoiceRes.body.data.lines[0];
  state.purchaseLine = {
    purchaseId: invoiceRes.body.data.supplierInvoiceId,
    purchaseLineId: createdLine.purchaseLineId,
    medicineId: "med-1",
    supplierId: String(invoiceRes.body.data.supplierId),
    quantityScale: 0,
    orderedQty: "4",
    receivedQty: "0",
    purchasedQty: "4",
    returnedQty: "0",
    originalBatchAllocations: []
  };

  const receiveRes = await commands.receivePurchase({
    actor: { userId: "admin-1", role: "admin" },
    purchaseLineId: createdLine.purchaseLineId,
    receivedQty: "4",
    receiptReference: "RCV-KF-001",
    purchaseValue: "20000",
    batch: {
      batchNo: "BATCH-KF-99",
      expiryDate: "2028-12-31",
      receivedAtUtc: "2026-11-25T00:00:00Z",
      disposition: "sellable"
    },
    idempotencyKey: "key-rcv-1",
    requestId: "req-rcv-1"
  });

  assert.equal(receiveRes.body.ok, true);
  assert.equal(state.purchaseLine.receivedQty, "4");
  assert.equal(state.batches.length, 2);
  assert.equal(state.batches.at(-1).batchNo, "BATCH-KF-99");
  assert.equal(state.movements.length, 1);
  assert.equal(state.movements[0].direction, "in");
  assert.equal(state.movements[0].quantity, "4");
  assert.equal(state.payableUpserts.length >= 1, true);
});

test("failure in supplier invoice line creation rolls back invoice header cleanly", async () => {
  const { state, commands } = createHarness({
    async createSupplierInvoiceLine() {
      const err = new Error("Disk / Database error inserting line");
      err.code = "DB_LINE_INSERT_FAILED";
      throw err;
    }
  });

  await assert.rejects(commands.createSupplierInvoice({
    actor: { userId: "admin-1", role: "admin" },
    supplierName: "Kimia Farma",
    supplierInvoiceNumber: "INV-KF-FAIL",
    invoiceDate: "2026-11-25",
    dueDate: "2026-12-25",
    totalAmount: "10000",
    lines: [{ medicineId: "med-1", orderedQty: "2", unitCost: "5000", subtotal: "10000" }],
    idempotencyKey: "key-fail-1",
    requestId: "req-fail-1"
  }), { code: "DB_LINE_INSERT_FAILED" });

  assert.equal(state.supplierInvoices.length, 0);
  assert.equal(state.supplierInvoiceLines.length, 0);
  assert.equal(state.audits.length, 0);
});

test("createSupplierInvoice preserves lineTotal from subtotal without rounding loss and returns matching payableId and invoiceId", async () => {
  const { state, commands } = createHarness();
  // 3 unit dengan total 100.000 (unitCost dibulatkan 33.333, tetapi subtotal 100.000 tidak boleh turun jadi 99.999)
  const res = await commands.createSupplierInvoice({
    actor: { userId: "admin-1", role: "admin" },
    supplierName: "Kimia Farma",
    supplierInvoiceNumber: "INV-KF-ROUNDING",
    invoiceDate: "2026-11-25",
    dueDate: "2026-12-25",
    totalAmount: "100000",
    lines: [
      { medicineId: "med-1", orderedQty: "3", unitCost: "33333", subtotal: "100000" }
    ],
    idempotencyKey: "key-inv-round",
    requestId: "req-inv-round"
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.grossAmount, "100000");
  assert.equal(res.body.data.totalAmount, "100000");
  assert.equal(res.body.data.lines[0].lineTotal, "100000");
  assert.equal(res.body.data.lines[0].subtotal, "100000");
  assert.equal(res.body.data.payableId, res.body.data.invoiceId);
  assert.equal(res.body.data.supplierInvoiceId, res.body.data.invoiceId);
});

test("recordSupplierPayment accepts structured payment payload and allocates against supplier payable", async () => {
  const { state, commands } = createHarness();
  const invoiceRes = await commands.createSupplierInvoice({
    actor: { userId: "admin-1", role: "admin" },
    supplierName: "Kimia Farma",
    supplierInvoiceNumber: "INV-KF-PAY-1",
    invoiceDate: "2026-11-25",
    dueDate: "2026-12-25",
    totalAmount: "50000",
    lines: [{ medicineId: "med-1", orderedQty: "5", unitCost: "10000", subtotal: "50000" }],
    idempotencyKey: "key-inv-pay-1",
    requestId: "req-inv-pay-1"
  });

  const payableId = invoiceRes.body.data.payableId;
  const payRes = await commands.recordSupplierPayment({
    actor: { userId: "admin-1", role: "admin" },
    payableId: payableId,
    payment: {
      sourceType: "supplier_payable",
      sourceId: payableId,
      amount: "50000",
      paymentMethod: "cash",
      paymentStatus: "settled",
      businessDate: "2026-11-25",
      eventAtUtc: "2026-11-25T09:00:00Z",
      settlementReference: "KW-FISIK-001",
      evidenceFileId: "KW-FISIK-001"
    },
    idempotencyKey: "key-pay-struc",
    requestId: "req-pay-struc"
  });

  assert.equal(payRes.body.ok, true);
  assert.equal(payRes.body.data.amount, "50000");
  assert.equal(payRes.body.data.outstandingAfter, "0");
  assert.equal(state.supplierPayments.length, 1);
  assert.equal(state.supplierPaymentAllocations.length, 1);
});

test("recordSupplierPayment normalizes flat payload to payment object", async () => {
  const { state, commands } = createHarness();
  const invoiceRes = await commands.createSupplierInvoice({
    actor: { userId: "admin-1", role: "admin" },
    supplierName: "Kimia Farma",
    supplierInvoiceNumber: "INV-KF-PAY-2",
    invoiceDate: "2026-11-25",
    dueDate: "2026-12-25",
    totalAmount: "30000",
    lines: [{ medicineId: "med-1", orderedQty: "3", unitCost: "10000", subtotal: "30000" }],
    idempotencyKey: "key-inv-pay-2",
    requestId: "req-inv-pay-2"
  });

  const payableId = invoiceRes.body.data.payableId;
  // Pengiriman format datar
  const payRes = await commands.recordSupplierPayment({
    actor: { userId: "admin-1", role: "admin" },
    payableId: payableId,
    amount: "30000",
    paymentMethod: "bank_transfer",
    paymentStatus: "settled",
    businessDate: "2026-11-25",
    eventAtUtc: "2026-11-25T09:30:00Z",
    settlementReference: "bukti-transfer-002",
    evidenceFileId: "bukti-transfer-002",
    idempotencyKey: "key-pay-flat",
    requestId: "req-pay-flat"
  });

  assert.equal(payRes.body.ok, true);
  assert.equal(payRes.body.data.amount, "30000");
  assert.equal(payRes.body.data.outstandingAfter, "0");
  assert.equal(state.supplierPayments.length, 1);
});

test("recordSupplierPayment rejects payment without evidenceFileId", async () => {
  const { commands } = createHarness();
  const invoiceRes = await commands.createSupplierInvoice({
    actor: { userId: "admin-1", role: "admin" },
    supplierName: "Kimia Farma",
    supplierInvoiceNumber: "INV-KF-PAY-NO-EVID",
    invoiceDate: "2026-11-25",
    dueDate: "2026-12-25",
    totalAmount: "20000",
    lines: [{ medicineId: "med-1", orderedQty: "2", unitCost: "10000", subtotal: "20000" }],
    idempotencyKey: "key-inv-no-evid",
    requestId: "req-inv-no-evid"
  });

  const payableId = invoiceRes.body.data.payableId;
  await assert.rejects(commands.recordSupplierPayment({
    actor: { userId: "admin-1", role: "admin" },
    payment: {
      sourceType: "supplier_payable",
      sourceId: payableId,
      amount: "20000",
      paymentMethod: "cash",
      paymentStatus: "settled",
      businessDate: "2026-11-25",
      eventAtUtc: "2026-11-25T09:00:00Z"
      // evidenceFileId sengaja dihilangkan
    },
    idempotencyKey: "key-pay-no-evid",
    requestId: "req-pay-no-evid"
  }), { code: "SUPPLIER_PAYMENT_EVIDENCE_REQUIRED" });
});

test("queue call automatically reconciles a completed encounter left in the active guard", async () => {
  let cleared = false;
  const { state, commands } = createHarness({
    async lockQueueCallGuard() { return { prefix: "A", activeTicketId: "ticket-old", version: "2" }; },
    async lockQueueTicket(_connection, ticketId) {
      if (ticketId === "ticket-old") return { ticketId, laneCode: "A", status: "called", encounterStatus: "completed" };
      return { ticketId, laneCode: "A", status: "waiting", encounterStatus: "registered" };
    },
    async findActiveQueueCall() { return { ticketId: "ticket-old" }; },
    async clearStaleQueueCallGuard(_connection, guard) {
      cleared = true;
      return { ...guard, activeTicketId: null, version: "3" };
    },
    async setCurrentQueueCall(_connection, _guard, active) { state.currentCall = active; }
  });
  state.tickets = [{ ticketId: "ticket-new", laneCode: "A", queueNumber: "A-002" }];
  const result = await commands.appendQueueCallEvent({
    actor: cashier, ticketId: "ticket-new", laneCode: "A", eventType: "call",
    idempotencyKey: "call-after-complete", requestId: "call-after-complete"
  });
  assert.equal(result.statusCode, 200);
  assert.equal(cleared, true);
  assert.equal(state.currentCall.ticketId, "ticket-new");
});
