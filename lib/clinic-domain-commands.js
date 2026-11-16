"use strict";

const contracts = require("./clinic-domain-contracts");
const model = require("./clinic-domain-model");

function domainError(code, message, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function requireActor(actor, roles) {
  if (!actor || typeof actor.userId !== "string" || !actor.userId || !roles.includes(actor.role)) {
    throw domainError("DOMAIN_FORBIDDEN", "Aktor tidak memiliki izin untuk perintah ini.", 403);
  }
}

function createClinicDomainCommands(deps = {}) {
  const withTransaction = deps.withTransaction || require("./with-transaction").withTransaction;
  const claimIdempotency = deps.claimIdempotency || require("./idempotency").claimIdempotency;
  const completeIdempotency = deps.completeIdempotency || require("./idempotency").completeIdempotency;
  const writeAuditEvent = deps.writeAuditEvent || require("./audit").writeAuditEvent;
  const repository = deps.repository;
  if (!repository) throw new TypeError("Clinic domain repository adapter is required.");

  async function execute(ctx, work) {
    requireActor(ctx.actor, ctx.roles);
    if (typeof ctx.requestId !== "string" || !ctx.requestId.trim()) throw new TypeError("Request ID is required.");
    return withTransaction(async connection => {
      const claim = await claimIdempotency(connection, {
        actorUserId: ctx.actor.userId,
        commandName: ctx.commandName,
        idempotencyKey: ctx.idempotencyKey,
        payload: ctx.payload
      });
      if (claim.replayed) return { statusCode: claim.responseCode, body: claim.response };

      const result = await work(connection);
      const body = { ok: true, data: result };
      await writeAuditEvent(connection, {
        actorUserId: ctx.actor.userId,
        actorRole: ctx.actor.role,
        actionCode: ctx.actionCode,
        entityType: result.entityType || "clinic_domain",
        entityId: String(result.entityId || ctx.requestId),
        after: result.auditAfter || result,
        requestId: ctx.requestId
      });
      await completeIdempotency(connection, {
        idempotencyId: claim.idempotencyId,
        responseCode: 200,
        response: body,
        entityType: result.entityType || "clinic_domain",
        entityId: result.entityId || ctx.requestId
      });
      return { statusCode: 200, body };
    });
  }

  async function createMedicine({ actor, medicine, idempotencyKey, requestId }) {
    const data = model.validateMedicineMaster(medicine);
    return execute({
      actor, roles: ["admin", "pimpinan"], commandName: "inventory.medicine.create",
      idempotencyKey, requestId, payload: data, actionCode: "MEDICINE_CREATED"
    }, async connection => {
      const policy = await repository.getMedicineUnitPolicy(connection, data.canonicalUnit);
      if (!policy || policy.approved !== true || Number(policy.quantityScale) !== Number(data.quantityScale)) {
        throw domainError("MEDICINE_UNIT_POLICY_NOT_APPROVED", "Satuan dan presisi obat belum disetujui.");
      }
      const result = await repository.createMedicine(connection, data);
      return { entityType: "medicine", entityId: String(result.medicineId), medicineId: String(result.medicineId), version: String(result.version || "1") };
    });
  }

  async function receivePurchase(value = {}) {
    const preview = await repository.previewPurchaseLine(value.purchaseLineId);
    if (!preview) throw domainError("PURCHASE_LINE_NOT_FOUND", "Baris pembelian tidak ditemukan.", 404);
    const receipt = model.validatePurchaseReceipt({
      ...value, medicineId: preview.medicineId, supplierId: preview.supplierId
    }, Number(preview.quantityScale));
    return execute({
      actor: value.actor, roles: ["admin", "pimpinan"],
      commandName: "inventory.purchase.receive", idempotencyKey: value.idempotencyKey,
      requestId: value.requestId, payload: receipt, actionCode: "PURCHASE_RECEIPT_POSTED"
    }, async connection => {
      const line = await repository.lockPurchaseLine(connection, receipt.purchaseLineId);
      const medicine = await repository.lockMedicine(connection, receipt.medicineId);
      if (!line || !medicine) throw domainError("PURCHASE_SOURCE_NOT_FOUND", "Sumber pembelian atau obat tidak ditemukan.", 404);
      if (String(line.supplierId) !== receipt.supplierId || String(line.medicineId) !== receipt.medicineId) {
        throw domainError("PURCHASE_SOURCE_MISMATCH", "Supplier atau obat tidak cocok dengan faktur.");
      }
      const policy = await repository.getPurchaseReceiptPolicy(connection, line.purchaseId, line.purchaseLineId);
      if (!policy || !["single_receipt", "split_receipts"].includes(policy.mode)) {
        throw domainError("PURCHASE_RECEIPT_POLICY_NOT_CLOSED", "Aturan penerimaan satu kali/bertahap belum diverifikasi.");
      }
      if (policy.mode === "single_receipt" && String(line.receivedQty || "0") !== "0") {
        throw domainError("PURCHASE_ALREADY_RECEIVED", "Baris pembelian ini hanya boleh diterima satu kali.");
      }
      const scale = Number(medicine.quantityScale);
      const incoming = contracts.parseScaledQuantity(receipt.receivedQty, scale);
      const ordered = contracts.parseScaledQuantity(line.orderedQty, scale);
      const already = contracts.parseScaledQuantity(line.receivedQty || "0", scale);
      if (already > ordered || incoming > ordered - already) {
        throw domainError("PURCHASE_RECEIPT_EXCEEDS_ORDER", "Qty penerimaan melebihi sisa pesanan.");
      }
      const batch = model.validateBatch(receipt.batch, scale);
      const oldStock = contracts.parseScaledQuantity(medicine.stockQty, scale);
      const newHpp = contracts.calculateWeightedAverageHpp({
        oldStockQty: medicine.stockQty, oldHpp: String(medicine.hpp),
        receivedQty: receipt.receivedQty, purchaseTotal: receipt.purchaseValue,
        quantityScale: scale
      });
      const receiptId = await repository.createPurchaseReceipt(connection, {
        purchaseLineId: receipt.purchaseLineId, receiptReference: receipt.receiptReference,
        receivedQty: receipt.receivedQty, purchaseValue: receipt.purchaseValue,
        actorUserId: value.actor.userId
      });
      const batchId = await repository.createBatch(connection, { ...batch, purchaseReceiptId: String(receiptId) });
      await repository.appendInventoryMovement(connection, {
        movementType: "purchase_receipt", direction: "in", medicineId: receipt.medicineId,
        batchId: String(batchId), quantity: receipt.receivedQty,
        sourceType: "purchase_receipt", sourceId: String(receiptId),
        actorUserId: value.actor.userId, reason: "Penerimaan pembelian " + receipt.receiptReference
      });
      await repository.updateMedicineProjection(connection, {
        medicineId: receipt.medicineId,
        stockQty: contracts.formatScaledQuantity(oldStock + incoming, scale),
        hpp: newHpp, expectedVersion: String(medicine.version)
      });
      await repository.updatePurchaseLineReceived(connection, {
        purchaseLineId: receipt.purchaseLineId,
        receivedQty: contracts.formatScaledQuantity(already + incoming, scale)
      });
      await repository.ensureSupplierPayable(connection, {
        purchaseId: String(line.purchaseId), supplierId: String(line.supplierId)
      });
      return {
        entityType: "purchase_receipt", entityId: String(receiptId),
        receiptId: String(receiptId), batchId: String(batchId),
        receivedQty: receipt.receivedQty,
        stockQty: contracts.formatScaledQuantity(oldStock + incoming, scale), hpp: newHpp
      };
    });
  }

  async function postCheckout(value = {}) {
    const requestedItems = value.items;
    if (!Array.isArray(requestedItems) || requestedItems.length === 0) {
      throw domainError("CHECKOUT_ITEMS_REQUIRED", "Keranjang transaksi tidak boleh kosong.", 400);
    }
    const payload = {
      encounterId: String(value.encounterId || ""),
      shiftId: String(value.shiftId || ""),
      items: requestedItems
    };
    return execute({
      actor: value.actor, roles: ["kasir", "admin", "pimpinan"],
      commandName: "sales.checkout.post", idempotencyKey: value.idempotencyKey,
      requestId: value.requestId, payload, actionCode: "SALES_CHECKOUT_POSTED"
    }, async connection => {
      const context = await repository.lockCheckoutContext(connection, payload.encounterId, payload.shiftId);
      if (!context || !context.encounter || !context.shift) {
        throw domainError("CHECKOUT_CONTEXT_NOT_FOUND", "Kunjungan atau shift transaksi tidak ditemukan.", 404);
      }
      contracts.assertInvoiceEncounterOwnership({
        invoice: {
          encounterId: String(context.encounter.encounterId),
          patientId: String(context.encounter.patientId),
          cashierId: String(value.actor.userId),
          shiftId: String(context.shift.shiftId)
        },
        encounter: {
          id: String(context.encounter.encounterId),
          patientId: String(context.encounter.patientId),
          cashierId: String(context.encounter.cashierUserId),
          shiftId: String(context.encounter.shiftId)
        },
        shift: {
          id: String(context.shift.shiftId),
          cashierId: String(context.shift.cashierUserId),
          status: context.shift.status
        }
      });
      if (String(context.encounter.cashierUserId) !== value.actor.userId) {
        throw domainError("CHECKOUT_CASHIER_MISMATCH", "Kunjungan bukan milik kasir yang sedang aktif.", 403);
      }

      // Prices, packages, discounts, line totals and sale-time HPP are computed
      // from locked server-side masters; browser totals are never authoritative.
      const snapshot = await repository.buildAuthoritativeCheckoutSnapshot(connection, {
        encounter: context.encounter, shift: context.shift,
        requestedItems, actorUserId: value.actor.userId
      });
      if (!snapshot || !Array.isArray(snapshot.lines) || !Array.isArray(snapshot.inventoryRequirements)) {
        throw domainError("CHECKOUT_SNAPSHOT_INVALID", "Snapshot checkout server tidak lengkap.");
      }
      const invoiceTotal = contracts.parseIntegerMoney(snapshot.invoice && snapshot.invoice.total, "invoice.total");
      if (invoiceTotal < 0n) throw domainError("CHECKOUT_TOTAL_INVALID", "Total nota tidak valid.", 400);

      const invoiceId = await repository.createInvoiceDraft(connection, {
        encounterId: String(context.encounter.encounterId),
        patientId: String(context.encounter.patientId),
        cashierUserId: value.actor.userId,
        shiftId: String(context.shift.shiftId),
        businessDate: context.encounter.businessDate,
        invoiceSnapshot: snapshot.invoice
      });

      const medicineIds = [...new Set(snapshot.inventoryRequirements.map(x => String(x.medicineId)))].sort();
      const medicineRows = new Map();
      for (const id of medicineIds) {
        const medicine = await repository.lockMedicine(connection, id);
        if (!medicine) throw domainError("CHECKOUT_MEDICINE_NOT_FOUND", "Obat pada keranjang tidak ditemukan.", 404);
        medicineRows.set(id, medicine);
      }

      const batchAllocations = [];
      for (const requirement of snapshot.inventoryRequirements) {
        const medicineId = String(requirement.medicineId);
        const medicine = medicineRows.get(medicineId);
        const scale = Number(medicine.quantityScale);
        const quantity = contracts.parseScaledQuantity(requirement.quantity, scale, "checkout.quantity");
        if (quantity <= 0n) throw domainError("CHECKOUT_QUANTITY_INVALID", "Qty obat harus lebih besar dari nol.", 400);
        const batches = await repository.lockEligibleBatches(connection, medicineId);
        const allocation = contracts.allocateFefo({
          batches: batches.map(batch => ({
            batchId: String(batch.batchId), expiryDate: batch.expiryDate,
            receivedAtUtc: batch.receivedAtUtc, remainingQty: String(batch.remainingQty)
          })),
          requestedQty: String(requirement.quantity), quantityScale: scale,
          businessDate: context.encounter.businessDate
        });
        for (const part of allocation.allocations) {
          const batch = batches.find(row => String(row.batchId) === part.batchId);
          const changed = await repository.decrementBatchBalance(connection, {
            batchId: part.batchId, quantity: part.qty, expectedVersion: String(batch.version)
          });
          if (changed !== 1) throw domainError("BATCH_BALANCE_CONFLICT", "Saldo batch berubah bersamaan; transaksi harus diulang.");
          await repository.appendInventoryMovement(connection, {
            movementType: "sale_issue", direction: "out", medicineId,
            batchId: part.batchId, quantity: part.qty, sourceType: "invoice",
            sourceId: String(invoiceId), actorUserId: value.actor.userId,
            reason: "Pengeluaran obat saat checkout"
          });
          batchAllocations.push({
            medicineId, invoiceId: String(invoiceId),
            batchId: part.batchId, quantity: part.qty
          });
        }
        const oldStock = contracts.parseScaledQuantity(medicine.stockQty, scale);
        if (oldStock < quantity) throw domainError("MEDICINE_PROJECTION_INCONSISTENT", "Saldo master obat tidak cukup untuk checkout.");
        await repository.updateMedicineStockOnly(connection, {
          medicineId, stockQty: contracts.formatScaledQuantity(oldStock - quantity, scale),
          expectedVersion: String(medicine.version)
        });
      }

      await repository.insertInvoiceLines(connection, String(invoiceId), snapshot.lines);
      await repository.insertSaleBatchAllocations(connection, String(invoiceId), batchAllocations);
      await repository.postInvoice(connection, String(invoiceId), {
        total: invoiceTotal.toString(), lineCount: snapshot.lines.length
      });
      await repository.createReturnQuotas(connection, String(invoiceId), snapshot.lines);
      await repository.markEncounterCompleted(connection, String(context.encounter.encounterId), String(invoiceId));

      return {
        entityType: "invoice", entityId: String(invoiceId),
        invoiceId: String(invoiceId), invoiceNumber: String(snapshot.invoice.number || ""),
        total: invoiceTotal.toString(), lineCount: snapshot.lines.length,
        batchAllocations
      };
    });
  }

  async function issueStock(value = {}) {
    const preview = await repository.previewMedicine(value.medicineId);
    if (!preview) throw domainError("MEDICINE_NOT_FOUND", "Obat tidak ditemukan.", 404);
    const quantity = contracts.parseScaledQuantity(value.quantity, Number(preview.quantityScale));
    if (quantity <= 0n) throw domainError("ISSUE_QUANTITY_INVALID", "Qty pengeluaran harus positif.", 400);
    return execute({
      actor: value.actor, roles: ["kasir", "admin", "pimpinan"],
      commandName: "inventory.issue.post", idempotencyKey: value.idempotencyKey,
      requestId: value.requestId,
      payload: { sourceInvoiceId: value.sourceInvoiceId, medicineId: value.medicineId, quantity: String(value.quantity) },
      actionCode: "INVENTORY_ISSUE_POSTED"
    }, async connection => {
      const source = await repository.lockSaleIssueSource(connection, value.sourceInvoiceId);
      if (!source || source.status !== "ready_for_stock_posting") {
        throw domainError("SALE_SOURCE_NOT_READY", "Nota belum siap untuk posting pengeluaran stok.");
      }
      if (String(source.cashierUserId) !== value.actor.userId) {
        throw domainError("SALE_ACTOR_MISMATCH", "Nota bukan milik kasir aktif.", 403);
      }
      const medicine = await repository.lockMedicine(connection, value.medicineId);
      const scale = Number(medicine.quantityScale);
      const qty = contracts.parseScaledQuantity(value.quantity, scale);
      const batches = await repository.lockEligibleBatches(connection, value.medicineId);
      const allocation = contracts.allocateFefo({
        batches: batches.map(b => ({
          batchId: String(b.batchId), expiryDate: b.expiryDate,
          receivedAtUtc: b.receivedAtUtc, remainingQty: String(b.remainingQty)
        })),
        requestedQty: String(value.quantity), quantityScale: scale,
        businessDate: source.businessDate
      });
      for (const part of allocation.allocations) {
        const batch = batches.find(b => String(b.batchId) === part.batchId);
        const changed = await repository.decrementBatchBalance(connection, {
          batchId: part.batchId, quantity: part.qty, expectedVersion: String(batch.version)
        });
        if (changed !== 1) throw domainError("BATCH_BALANCE_CONFLICT", "Saldo batch berubah bersamaan.");
        await repository.appendInventoryMovement(connection, {
          movementType: "sale_issue", direction: "out", medicineId: value.medicineId,
          batchId: part.batchId, quantity: part.qty,
          sourceType: "invoice", sourceId: String(value.sourceInvoiceId),
          actorUserId: value.actor.userId, reason: "Pengeluaran obat pada nota"
        });
      }
      const stock = contracts.parseScaledQuantity(medicine.stockQty, scale);
      if (stock < qty) throw domainError("MEDICINE_PROJECTION_INCONSISTENT", "Saldo master obat tidak mencukupi.");
      await repository.updateMedicineStockOnly(connection, {
        medicineId: value.medicineId, stockQty: contracts.formatScaledQuantity(stock - qty, scale),
        expectedVersion: String(medicine.version)
      });
      return { entityType: "invoice", entityId: String(value.sourceInvoiceId), allocations: allocation.allocations, issuedQty: allocation.totalAllocatedQty };
    });
  }

  async function createSupplierReturnRequest(value = {}) {
    const preview = await repository.previewSupplierReturnSource(value.purchaseLineId, value.batchId);
    if (!preview) throw domainError("SUPPLIER_RETURN_SOURCE_NOT_FOUND", "Sumber pembelian/batch tidak ditemukan.", 404);
    const check = contracts.validateSupplierReturn({
      purchase: preview.purchase, batch: preview.batch,
      requestedQty: value.quantity, quantityScale: Number(preview.quantityScale)
    });
    return execute({
      actor: value.actor, roles: ["admin", "pimpinan"],
      commandName: "inventory.supplier_return.request", idempotencyKey: value.idempotencyKey,
      requestId: value.requestId,
      payload: { purchaseLineId: value.purchaseLineId, batchId: value.batchId, quantity: check.requestedQty, reason: value.reason },
      actionCode: "SUPPLIER_RETURN_REQUESTED"
    }, async connection => {
      const line = await repository.lockPurchaseLine(connection, value.purchaseLineId);
      const batch = await repository.lockBatch(connection, value.batchId);
      const validated = contracts.validateSupplierReturn({
        purchase: line, batch, requestedQty: check.requestedQty,
        quantityScale: Number(line.quantityScale)
      });
      const id = await repository.createSupplierReturnRequest(connection, {
        purchaseLineId: String(value.purchaseLineId), batchId: String(value.batchId),
        quantity: validated.requestedQty, reason: String(value.reason || "").trim(),
        requestedByUserId: value.actor.userId, settlementStatus: "owner_policy_pending"
      });
      return { entityType: "supplier_return", entityId: String(id), supplierReturnId: String(id), quantity: validated.requestedQty, stockMovementPosted: false, settlementStatus: "owner_policy_pending" };
    });
  }

  async function dispatchSupplierReturn(value = {}) {
    const reference = String(value.dispatchReference || "").trim();
    if (!reference) throw domainError("SUPPLIER_DISPATCH_REFERENCE_REQUIRED", "Referensi pengiriman retur wajib diisi.", 400);
    return execute({
      actor: value.actor, roles: ["admin", "pimpinan"],
      commandName: "inventory.supplier_return.dispatch", idempotencyKey: value.idempotencyKey,
      requestId: value.requestId, payload: { supplierReturnId: value.supplierReturnId, dispatchReference: reference },
      actionCode: "SUPPLIER_RETURN_DISPATCHED"
    }, async connection => {
      const request = await repository.lockSupplierReturn(connection, value.supplierReturnId);
      if (!request || request.status !== "approved_for_dispatch") throw domainError("SUPPLIER_RETURN_NOT_APPROVED", "Retur belum disetujui untuk dikirim.");
      const line = await repository.lockPurchaseLine(connection, request.purchaseLineId);
      const batch = await repository.lockBatch(connection, request.batchId);
      const scale = Number(line.quantityScale);
      const validated = contracts.validateSupplierReturn({
        purchase: line, batch, requestedQty: request.quantity, quantityScale: scale
      });
      const medicine = await repository.lockMedicine(connection, line.medicineId);
      const oldStock = contracts.parseScaledQuantity(medicine.stockQty, scale);
      const qty = contracts.parseScaledQuantity(validated.requestedQty, scale);
      if (oldStock < qty) throw domainError("SUPPLIER_RETURN_STOCK_INCONSISTENT", "Saldo master obat tidak cukup.");
      const changed = await repository.decrementBatchBalance(connection, {
        batchId: String(batch.batchId), quantity: validated.requestedQty, expectedVersion: String(batch.version)
      });
      if (changed !== 1) throw domainError("BATCH_BALANCE_CONFLICT", "Saldo batch berubah bersamaan.");
      await repository.appendInventoryMovement(connection, {
        movementType: "supplier_return", direction: "out", medicineId: String(line.medicineId),
        batchId: String(batch.batchId), quantity: validated.requestedQty,
        sourceType: "supplier_return", sourceId: String(value.supplierReturnId),
        actorUserId: value.actor.userId, reason: "Retur supplier " + reference
      });
      await repository.updateMedicineStockOnly(connection, {
        medicineId: String(line.medicineId), stockQty: contracts.formatScaledQuantity(oldStock - qty, scale),
        expectedVersion: String(medicine.version)
      });
      await repository.markSupplierReturnDispatched(connection, {
        supplierReturnId: String(value.supplierReturnId), dispatchReference: reference,
        settlementStatus: "owner_policy_pending"
      });
      return { entityType: "supplier_return", entityId: String(value.supplierReturnId), supplierReturnId: String(value.supplierReturnId), quantity: validated.requestedQty, stockMovementPosted: true, supplierCreditRecognized: false, settlementStatus: "owner_policy_pending" };
    });
  }

  async function registerEncounter(value = {}) {
    const patient = value.patientId ? null : model.validatePatient(value.patient);
    const payload = {
      patientId: value.patientId || null, patient,
      shiftId: String(value.shiftId || ""), serviceCode: String(value.serviceCode || ""),
      queuePrefix: String(value.queuePrefix || "").trim().toUpperCase()
    };
    return execute({
      actor: value.actor, roles: ["kasir", "admin", "pimpinan"],
      commandName: "patient.encounter.register", idempotencyKey: value.idempotencyKey,
      requestId: value.requestId, payload, actionCode: "ENCOUNTER_REGISTERED"
    }, async connection => {
      const shift = await repository.lockOpenCashierShift(connection, value.shiftId);
      if (!shift || String(shift.cashierUserId) !== value.actor.userId) throw domainError("ENCOUNTER_SHIFT_NOT_OWNED", "Shift aktif tidak ditemukan atau bukan milik kasir ini.", 403);
      const businessDate = await repository.getClinicBusinessDate(connection);
      contracts.requireBusinessDate(businessDate, "businessDate");
      const registeredAtUtc = await repository.getServerNowUtc(connection);
      contracts.requireTimestamp(registeredAtUtc, "registeredAtUtc");
      const patientId = value.patientId
        ? String((await repository.lockPatient(connection, value.patientId) || {}).patientId || "")
        : String(await repository.createPatient(connection, patient));
      if (!patientId) throw domainError("PATIENT_NOT_FOUND", "Pasien tidak ditemukan.", 404);
      const encounterData = model.validateEncounter({
        patientId, cashierUserId: value.actor.userId, shiftId: String(value.shiftId),
        serviceCode: value.serviceCode, businessDate, registeredAtUtc,
        queuePrefix: payload.queuePrefix
      });
      const encounter = await repository.createEncounter(connection, {
        patientId, cashierUserId: value.actor.userId, shiftId: String(value.shiftId),
        serviceCode: encounterData.serviceCode, businessDate, registeredAtUtc
      });
      const prefixPolicy = await repository.getQueuePrefixPolicy(connection, encounterData.queuePrefix);
      if (!prefixPolicy || prefixPolicy.approved !== true) {
        throw domainError("QUEUE_PREFIX_POLICY_PENDING", "Arti dan penggunaan prefix antrean belum disetujui (D16).");
      }
      const sequence = await repository.allocateQueueSequence(connection, { businessDate, prefix: encounterData.queuePrefix });
      const ticket = await repository.createQueueTicket(connection, {
        encounterId: String(encounter.encounterId), businessDate,
        prefix: encounterData.queuePrefix, sequence
      });
      return { entityType: "encounter", entityId: String(encounter.encounterId), patientId, encounterId: String(encounter.encounterId), queueTicketId: String(ticket.ticketId), queueNumber: String(ticket.queueNumber), businessDate };
    });
  }

  async function appendQueueCallEvent(value = {}) {
    const requestPayload = {
      ticketId: String(value.ticketId || ""),
      laneCode: String(value.laneCode || "").trim().toUpperCase(),
      eventType: value.eventType,
      requestId: value.requestId
    };
    return execute({
      actor: value.actor, roles: ["kasir", "admin", "pimpinan"],
      commandName: "queue.call_event.append", idempotencyKey: value.idempotencyKey,
      requestId: value.requestId, payload: requestPayload, actionCode: "QUEUE_CALL_EVENT_APPENDED"
    }, async connection => {
      // Read policy inside the same transaction that locks the active-call guard.
      // This prevents a policy change between pre-validation and row locking.
      const policy = await repository.readQueueActiveCallPolicy(connection);
      const event = model.validateQueueCallEvent({
        ...requestPayload, activeCallPolicy: policy && policy.mode
      });
      const guard = await repository.lockQueueCallGuard(connection, event.activeCallPolicy,
        event.activeCallPolicy === "global" ? null : event.laneCode);
      const ticket = await repository.lockQueueTicket(connection, event.ticketId);
      if (!ticket || String(ticket.laneCode) !== event.laneCode) {
        throw domainError("QUEUE_TICKET_NOT_FOUND", "Tiket tidak ditemukan pada jalur tersebut.", 404);
      }
      const current = await repository.findActiveQueueCall(connection, guard);
      if (event.eventType === "call" || event.eventType === "recall") {
        if (current && String(current.ticketId) !== event.ticketId) {
          throw domainError("QUEUE_ACTIVE_CALL_CONFLICT", "Masih ada nomor aktif dalam ruang lingkup panggilan ini.");
        }
      } else if (!current || String(current.ticketId) !== event.ticketId) {
        throw domainError("QUEUE_CALL_NOT_ACTIVE", "Tiket bukan panggilan aktif yang dapat dibatalkan.");
      }
      const eventId = await repository.appendQueueCallEvent(connection, {
        ticketId: event.ticketId, laneCode: event.laneCode, eventType: event.eventType,
        actorUserId: value.actor.userId, requestId: event.requestId
      });
      await repository.setCurrentQueueCall(connection, guard,
        event.eventType === "cancel_call" ? null : {
          ticketId: event.ticketId, eventId: String(eventId), laneCode: event.laneCode
        });
      return {
        entityType: "queue_call_event", entityId: String(eventId),
        eventId: String(eventId), ticketId: event.ticketId, eventType: event.eventType
      };
    });
  }

  async function postJournal(value = {}) {
    const journal = model.validateBalancedJournal(value.journal);
    return execute({
      actor: value.actor, roles: ["admin", "pimpinan"],
      commandName: "finance.journal.post", idempotencyKey: value.idempotencyKey,
      requestId: value.requestId, payload: journal, actionCode: "FINANCE_JOURNAL_POSTED"
    }, async connection => {
      const period = await repository.getAccountingPeriod(connection, journal.businessDate);
      if (!period || period.status !== "open") throw domainError("ACCOUNTING_PERIOD_CLOSED", "Periode akuntansi tidak terbuka.");
      const journalId = await repository.createJournal(connection, { ...journal, postedByUserId: value.actor.userId });
      await repository.insertJournalLines(connection, String(journalId), journal.lines);
      return { entityType: "journal", entityId: String(journalId), journalId: String(journalId), totalDebit: journal.totalDebit, totalCredit: journal.totalCredit };
    });
  }

  async function recordPayment(value = {}) {
    const payment = model.validateLedgerPayment(value.payment);
    return execute({
      actor: value.actor, roles: ["kasir", "admin", "pimpinan"],
      commandName: "finance.payment.record", idempotencyKey: value.idempotencyKey,
      requestId: value.requestId, payload: payment, actionCode: "PAYMENT_EVENT_RECORDED"
    }, async connection => {
      const policy = await repository.getPaymentRecognitionPolicy(connection, payment.paymentMethod);
      if (!policy || policy.approved !== true) throw domainError("PAYMENT_RECOGNITION_POLICY_PENDING", "Kebijakan metode pembayaran/settlement belum disetujui.");
      if (payment.paymentStatus === "settled" && payment.paymentMethod !== "cash" && !payment.settlementReference) {
        throw domainError("PAYMENT_SETTLEMENT_REFERENCE_REQUIRED", "Reference settlement non-tunai wajib diisi.", 400);
      }
      const source = await repository.lockPaymentSource(connection, payment.sourceType, payment.sourceId);
      if (!source) throw domainError("PAYMENT_SOURCE_NOT_FOUND", "Sumber pembayaran tidak ditemukan.", 404);
      const paymentId = await repository.appendPaymentEvent(connection, { ...payment, recordedByUserId: value.actor.userId });
      if (payment.paymentMethod === "cash") {
        if (!payment.cashAccountId || !payment.shiftId) throw domainError("CASH_ACCOUNT_SHIFT_REQUIRED", "Penerimaan tunai harus terhubung ke akun kas dan shift.", 400);
        await repository.appendCashLedgerMovement(connection, {
          accountId: payment.cashAccountId, shiftId: payment.shiftId,
          direction: "in", amount: payment.amount, sourceType: "payment",
          sourceId: String(paymentId), actorUserId: value.actor.userId
        });
      }
      return { entityType: "payment", entityId: String(paymentId), paymentId: String(paymentId), amount: payment.amount, paymentStatus: payment.paymentStatus };
    });
  }

  async function recordSupplierPayment(value = {}) {
    const payment = model.validateLedgerPayment(value.payment);
    return execute({
      actor: value.actor, roles: ["admin", "pimpinan"],
      commandName: "finance.supplier_payment.record", idempotencyKey: value.idempotencyKey,
      requestId: value.requestId, payload: payment, actionCode: "SUPPLIER_PAYMENT_RECORDED"
    }, async connection => {
      const policy = await repository.getSupplierPaymentPolicy(connection);
      if (!policy || policy.approved !== true) throw domainError("SUPPLIER_PAYMENT_POLICY_PENDING", "Kebijakan pembayaran sebagian/berulang supplier belum disetujui (D11).");
      const payable = await repository.lockSupplierPayable(connection, payment.sourceId);
      if (!payable) throw domainError("SUPPLIER_PAYABLE_NOT_FOUND", "Utang supplier tidak ditemukan.", 404);
      const amount = contracts.parseIntegerMoney(payment.amount, "amount", false);
      const outstanding = contracts.parseIntegerMoney(payable.outstandingAmount, "outstandingAmount");
      if (amount > outstanding) throw domainError("SUPPLIER_PAYMENT_EXCEEDS_PAYABLE", "Pembayaran melebihi sisa utang.");
      const paymentId = await repository.appendSupplierPayment(connection, { ...payment, payableId: payment.sourceId, recordedByUserId: value.actor.userId });
      await repository.applySupplierPaymentAllocation(connection, { paymentId: String(paymentId), payableId: payment.sourceId, amount: payment.amount });
      return { entityType: "supplier_payment", entityId: String(paymentId), paymentId: String(paymentId), amount: payment.amount, outstandingAfter: (outstanding - amount).toString() };
    });
  }

  async function payRefund(value = {}) {
    const payout = model.validateLedgerPayment(value.payout);
    return execute({
      actor: value.actor, roles: ["pimpinan"],
      commandName: "finance.refund.payout", idempotencyKey: value.idempotencyKey,
      requestId: value.requestId, payload: payout, actionCode: "REFUND_PAYOUT_POSTED"
    }, async connection => {
      const policy = await repository.getRefundPayoutPolicy(connection);
      if (!policy || policy.approved !== true) throw domainError("REFUND_PAYOUT_POLICY_PENDING", "Kebijakan akun, metode dan bukti pembayaran refund belum disetujui (D13).");
      const obligation = await repository.lockRefundObligation(connection, payout.sourceId);
      if (!obligation || obligation.status !== "approved_pending_payout") throw domainError("REFUND_OBLIGATION_NOT_PAYABLE", "Kewajiban refund belum disetujui untuk dibayar.");
      const amount = contracts.parseIntegerMoney(payout.amount, "amount", false);
      const outstanding = contracts.parseIntegerMoney(obligation.outstandingAmount, "outstandingAmount");
      if (amount !== outstanding) throw domainError("REFUND_PARTIAL_PAYOUT_POLICY_PENDING", "Pembayaran sebagian refund belum diatur; nominal harus sama dengan kewajiban tersisa.");
      if (!payout.cashAccountId) throw domainError("REFUND_CASH_ACCOUNT_REQUIRED", "Sumber kas/bank refund wajib dipilih.", 400);
      const payoutId = await repository.appendRefundPayout(connection, { ...payout, obligationId: payout.sourceId, paidByUserId: value.actor.userId });
      await repository.appendCashLedgerMovement(connection, {
        accountId: payout.cashAccountId, shiftId: payout.shiftId, direction: "out",
        amount: payout.amount, sourceType: "refund_payout",
        sourceId: String(payoutId), actorUserId: value.actor.userId
      });
      await repository.markRefundPaid(connection, payout.sourceId, String(payoutId));
      return { entityType: "refund_payout", entityId: String(payoutId), payoutId: String(payoutId), amount: payout.amount, status: "paid" };
    });
  }

  return Object.freeze({
    createMedicine, receivePurchase, postCheckout, issueStock, createSupplierReturnRequest,
    dispatchSupplierReturn, registerEncounter, appendQueueCallEvent,
    postJournal, recordPayment, recordSupplierPayment, payRefund
  });
}

module.exports = { createClinicDomainCommands };
