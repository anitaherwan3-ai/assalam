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
      const result = await repository.createMedicine(connection, { ...data, actorUserId: actor.userId });
      return { entityType: "medicine", entityId: String(result.medicineId), medicineId: String(result.medicineId), version: String(result.version || "1") };
    });
  }

  async function receivePurchase(value = {}) {
    const preview = await repository.previewPurchaseLine(value.purchaseLineId);
    if (!preview) throw domainError("PURCHASE_LINE_NOT_FOUND", "Baris pembelian tidak ditemukan.", 404);
    const scale = Number(preview.quantityScale);
    const requestedQuantity = contracts.parseScaledQuantity(value.receivedQty, scale, "receivedQty");
    const authoritativePurchaseValue = (BigInt(String(preview.unitCost)) * requestedQuantity / (10n ** BigInt(scale))).toString();
    const receipt = model.validatePurchaseReceipt({
      ...value, purchaseValue: authoritativePurchaseValue,
      medicineId: preview.medicineId, supplierId: preview.supplierId
    }, scale);
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
      const newHpp = oldStock === 0n
        ? contracts.calculateWeightedAverageHpp({ oldStockQty: "0", oldHpp: "0", receivedQty: receipt.receivedQty, purchaseTotal: receipt.purchaseValue, quantityScale: scale })
        : medicine.hpp === null
          ? null
          : contracts.calculateWeightedAverageHpp({ oldStockQty: medicine.stockQty, oldHpp: String(medicine.hpp), receivedQty: receipt.receivedQty, purchaseTotal: receipt.purchaseValue, quantityScale: scale });
      const receiptId = await repository.createPurchaseReceipt(connection, {
        purchaseLineId: receipt.purchaseLineId, receiptReference: receipt.receiptReference,
        receivedQty: receipt.receivedQty, purchaseValue: receipt.purchaseValue,
        actorUserId: value.actor.userId
      });
      const batchId = await repository.createBatch(connection, { ...batch, purchaseReceiptId: String(receiptId), purchaseValue: receipt.purchaseValue });
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
      items: requestedItems,
      payment: value.payment || null
    };
    if (value.actor && value.actor.role === "kasir" && requestedItems.some((item, index) => item && contracts.parseIntegerMoney(item.discount || "0", "items[" + index + "].discount") > 0n)) throw domainError("SERVICE_DISCOUNT_FORBIDDEN", "Diskon jasa hanya dapat diberikan oleh Admin atau Pimpinan.", 403);
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
            receivedAtUtc: batch.receivedAtUtc, remainingQty: String(batch.remainingQty),
            disposition: batch.disposition
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

      let paymentRecord = null;
      if (value.payment && value.payment.method) {
        const method = String(value.payment.method).toLowerCase();
        const paymentInput = {
          sourceType: "sales_invoice",
          sourceId: String(invoiceId),
          paymentMethod: method,
          amount: invoiceTotal.toString(),
          paymentStatus: "settled",
          eventAtUtc: new Date().toISOString(),
          settlementReference: value.payment.reference || ("PAY-" + invoiceId),
          recordedByUserId: value.actor.userId,
          idempotencyKey: (value.idempotencyKey || value.requestId) + ":payment"
        };
        const paymentId = await repository.appendPaymentEvent(connection, paymentInput);
        paymentRecord = { paymentId: String(paymentId), method, amount: invoiceTotal.toString() };

        if (method === "cash") {
          const cashAccountId = await repository.ensureCashAccount(connection, value.actor.userId);
          await repository.appendCashLedgerMovement(connection, {
            accountId: cashAccountId,
            shiftId: String(context.shift.shiftId),
            direction: "in",
            amount: invoiceTotal.toString(),
            sourceType: "sale",
            sourceId: String(invoiceId),
            actorUserId: value.actor.userId,
            idempotencyKey: (value.idempotencyKey || value.requestId) + ":cash"
          });
        }
      }

      return {
        entityType: "invoice", entityId: String(invoiceId),
        invoiceId: String(invoiceId), invoiceNumber: String(snapshot.invoice.number || ""),
        total: invoiceTotal.toString(), lineCount: snapshot.lines.length,
        batchAllocations,
        payment: paymentRecord
      };
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

  async function approveSupplierReturn(value = {}) {
    return execute({
      actor: value.actor, roles: ["pimpinan"],
      commandName: "inventory.supplier_return.approve", idempotencyKey: value.idempotencyKey,
      requestId: value.requestId, payload: { supplierReturnId: String(value.supplierReturnId), reason: String(value.reason || "").trim() },
      actionCode: "SUPPLIER_RETURN_APPROVED"
    }, async connection => {
      const request = await repository.lockSupplierReturn(connection, value.supplierReturnId);
      if (!request || request.status !== "requested") throw domainError("SUPPLIER_RETURN_NOT_REQUESTED", "Permintaan retur supplier tidak tersedia untuk persetujuan.");
      await repository.approveSupplierReturn(connection, {
        supplierReturnId: String(value.supplierReturnId), approvedByUserId: value.actor.userId,
        reason: String(value.reason || "").trim()
      });
      return { entityType: "supplier_return", entityId: String(value.supplierReturnId), supplierReturnId: String(value.supplierReturnId), status: "approved_for_dispatch", stockMovementPosted: false };
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
      const line = await repository.lockPurchaseLine(connection, request.purchaseLineId, String(value.supplierReturnId));
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
        actorUserId: value.actor.userId, settlementStatus: "owner_policy_pending"
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
        : String(await repository.createPatient(connection, { ...patient, createdByUserId: value.actor.userId }));
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
      if (typeof repository.assertQueueActionAllowed === "function") {
        await repository.assertQueueActionAllowed(connection, ticket, value.actor);
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

  async function transferQueue(value = {}) {
    const reason = String(value.reason || "").trim();
    if (!reason || reason.length > 255) throw domainError("QUEUE_TRANSFER_REASON_REQUIRED", "Alasan pelimpahan antrean wajib diisi maksimal 255 karakter.", 400);
    const payload = {
      ticketId: String(value.ticketId || ""),
      toCashierUserId: String(value.toCashierUserId || ""),
      toShiftId: String(value.toShiftId || ""),
      reason
    };
    return execute({
      actor: value.actor, roles: ["kasir", "admin", "pimpinan"],
      commandName: "queue.ticket.transfer", idempotencyKey: value.idempotencyKey,
      requestId: value.requestId, payload, actionCode: "QUEUE_TICKET_TRANSFERRED"
    }, async connection => {
      const ticket = await repository.lockQueueTicket(connection, payload.ticketId);
      if (!ticket) throw domainError("QUEUE_TICKET_NOT_FOUND", "Tiket antrean tidak ditemukan.", 404);
      await repository.assertQueueTransferAllowed(connection, ticket, value.actor);
      const target = await repository.lockTargetOpenShift(connection, payload.toShiftId, payload.toCashierUserId);
      if (!target) throw domainError("QUEUE_TRANSFER_TARGET_SHIFT_INVALID", "Shift tujuan tidak aktif atau bukan milik kasir tujuan.", 409);
      const eventId = await repository.transferQueueTicket(connection, {
        ticketId: payload.ticketId,
        fromCashierUserId: String(ticket.currentCashierUserId),
        fromShiftId: String(ticket.currentShiftId),
        toCashierUserId: payload.toCashierUserId,
        toShiftId: payload.toShiftId,
        reason: payload.reason,
        actorUserId: value.actor.userId,
        expectedVersion: String(ticket.version)
      });
      return {
        entityType: "queue_transfer",
        entityId: String(eventId),
        transferEventId: String(eventId),
        ticketId: payload.ticketId,
        fromCashierUserId: String(ticket.currentCashierUserId),
        toCashierUserId: payload.toCashierUserId,
        reason: payload.reason
      };
    });
  }

  async function createExpense(value = {}) {
    const category = String(value.category || "").trim();
    const description = String(value.description || "").trim();
    const evidenceFileId = String(value.evidenceFileId || "").trim();
    if (!category || category.length > 80 || !description || description.length > 255 || !evidenceFileId) {
      throw domainError("EXPENSE_INPUT_INVALID", "Kategori, uraian dan bukti pengeluaran wajib diisi.", 400);
    }
    const amount = contracts.parseIntegerMoney(value.amount, "expense.amount", false).toString();
    const businessDate = contracts.requireBusinessDate(value.businessDate, "businessDate");
    return execute({
      actor: value.actor, roles: ["admin"], commandName: "finance.expense.create",
      idempotencyKey: value.idempotencyKey, requestId: value.requestId,
      payload: { category, description, amount, businessDate, evidenceFileId }, actionCode: "EXPENSE_SUBMITTED"
    }, async connection => {
      const expenseId = await repository.createExpense(connection, {
        category, description, amount, businessDate, evidenceFileId, createdByUserId: value.actor.userId
      });
      await repository.appendExpenseEvent(connection, {
        expenseId, eventType: "requested", actorUserId: value.actor.userId, reason: description
      });
      return { entityType: "expense", entityId: String(expenseId), expenseId: String(expenseId), amount, status: "requested" };
    });
  }

  async function approveExpense(value = {}) {
    const reason = String(value.reason || "").trim();
    if (!reason) throw domainError("EXPENSE_APPROVAL_REASON_REQUIRED", "Catatan persetujuan Pimpinan wajib diisi.", 400);
    return execute({
      actor: value.actor, roles: ["pimpinan"], commandName: "finance.expense.approve",
      idempotencyKey: value.idempotencyKey, requestId: value.requestId,
      payload: { expenseId: String(value.expenseId), reason }, actionCode: "EXPENSE_APPROVED"
    }, async connection => {
      const expense = await repository.lockExpense(connection, value.expenseId);
      if (!expense || expense.status !== "requested") throw domainError("EXPENSE_NOT_PENDING", "Pengeluaran tidak menunggu persetujuan.");
      if (String(expense.createdByUserId) === value.actor.userId) throw domainError("EXPENSE_SELF_APPROVAL_BLOCKED", "Pimpinan tidak boleh menyetujui pengeluaran yang diajukan sendiri.", 403);
      await repository.approveExpense(connection, { expenseId: String(value.expenseId), approverUserId: value.actor.userId });
      await repository.appendExpenseEvent(connection, {
        expenseId: String(value.expenseId), eventType: "approved", actorUserId: value.actor.userId, reason
      });
      return { entityType: "expense", entityId: String(value.expenseId), expenseId: String(value.expenseId), status: "approved" };
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

  async function requestSalesReturn(value = {}) {
    if (!Array.isArray(value.lines) || value.lines.length === 0) throw domainError("RETURN_LINES_REQUIRED", "Pilih minimal satu item retur.", 400);
    const reason = String(value.reason || "").trim();
    if (!reason || reason.length > 255) throw domainError("RETURN_REASON_REQUIRED", "Alasan retur wajib diisi.", 400);
    const requested = value.lines.map(line => ({
      returnQuotaSubjectId: String(line.returnQuotaSubjectId || ""),
      quantity: String(line.quantity || "")
    }));
    if (requested.some(line => !line.returnQuotaSubjectId || !/^[1-9]\d*$/.test(line.quantity))) {
      throw domainError("RETURN_LINE_INVALID", "Baris retur atau jumlah qty tidak valid.", 400);
    }
    if (new Set(requested.map(line => line.returnQuotaSubjectId)).size !== requested.length) {
      throw domainError("RETURN_QUOTA_DUPLICATE", "Item retur yang sama tidak boleh dipilih dua kali.", 400);
    }
    return execute({
      actor: value.actor, roles: ["kasir"], commandName: "sales.return.request",
      idempotencyKey: value.idempotencyKey, requestId: value.requestId,
      payload: { invoiceId: String(value.invoiceId), lines: requested, reason }, actionCode: "SALES_RETURN_REQUESTED"
    }, async connection => {
      const invoice = await repository.lockSalesInvoice(connection, value.invoiceId);
      if (!invoice || !["posted", "paid", "partially_paid"].includes(invoice.status)) throw domainError("RETURN_INVOICE_NOT_RETURNABLE", "Nota tidak ditemukan atau belum dapat diretur.", 404);
      if (String(invoice.cashierUserId) !== value.actor.userId) throw domainError("RETURN_INVOICE_NOT_OWNED", "Kasir hanya dapat mengajukan retur untuk nota miliknya.", 403);
      const returnId = await repository.createSalesReturn(connection, {
        invoiceId: String(value.invoiceId), requestedByUserId: value.actor.userId, reason
      });
      let totalRefund = 0n;
      for (const line of requested) {
        const quota = await repository.lockReturnQuota(connection, line.returnQuotaSubjectId);
        if (!quota || String(quota.invoiceId) !== String(value.invoiceId)) throw domainError("RETURN_QUOTA_NOT_FOUND", "Hak retur item tidak ditemukan pada nota ini.", 404);
        const qty = contracts.parseScaledQuantity(line.quantity, Number(quota.quantityScale || 0), "return.quantity");
        const remaining = BigInt(String(quota.maximumQuantity)) - BigInt(String(quota.reservedQuantity)) - BigInt(String(quota.approvedQuantity));
        if (qty <= 0n || qty > remaining) throw domainError("RETURN_QUANTITY_EXCEEDS_REMAINING", "Qty retur melebihi sisa hak retur item.");
        const priorRefund = BigInt(String(quota.priorRefundAmount || "0"));
        const originalNet = BigInt(String(quota.netCharge));
        const maxQty = BigInt(String(quota.maximumQuantity));
        const refund = BigInt(String(quota.reservedQuantity)) + BigInt(String(quota.approvedQuantity)) + qty === maxQty
          ? originalNet - priorRefund
          : (originalNet * qty) / maxQty;
        await repository.reserveReturnQuota(connection, { quotaId: line.returnQuotaSubjectId, quantity: qty.toString() });
        const returnLineId = await repository.createSalesReturnLine(connection, {
          returnId, invoiceLineId: quota.invoiceLineId, quotaId: line.returnQuotaSubjectId,
          quantity: qty.toString(), originalNetCharge: originalNet.toString(),
          refundAmount: refund.toString(), stockDisposition: quota.batchId ? "quarantine" : "not_applicable"
        });
        totalRefund += refund;
        await repository.appendSalesReturnEvent(connection, {
          returnId, eventType: "line_requested", oldStatus: "requested", newStatus: "requested",
          actorUserId: value.actor.userId, reason: "Qty " + qty.toString() + " pada item retur"
        });
        if (!returnLineId) throw domainError("RETURN_LINE_CREATE_FAILED", "Baris retur gagal disimpan.");
      }
      await repository.appendSalesReturnEvent(connection, {
        returnId, eventType: "requested", oldStatus: null, newStatus: "requested",
        actorUserId: value.actor.userId, reason
      });
      return { entityType: "sales_return", entityId: String(returnId), salesReturnId: String(returnId), status: "requested", estimatedRefundAmount: totalRefund.toString(), stockDisposition: "pending_approval" };
    });
  }

  async function reviewSalesReturn(value = {}) {
    const approve = value.decision === "approve";
    if (!approve && value.decision !== "reject") throw domainError("RETURN_REVIEW_DECISION_INVALID", "Keputusan Admin harus approve atau reject.", 400);
    const reason = String(value.reason || "").trim();
    if (!reason) throw domainError("RETURN_REVIEW_REASON_REQUIRED", "Catatan verifikasi Admin wajib diisi.", 400);
    return execute({
      actor: value.actor, roles: ["admin"], commandName: "sales.return.admin_review",
      idempotencyKey: value.idempotencyKey, requestId: value.requestId,
      payload: { salesReturnId: String(value.salesReturnId), decision: value.decision, reason }, actionCode: approve ? "SALES_RETURN_ADMIN_REVIEWED" : "SALES_RETURN_REJECTED"
    }, async connection => {
      const request = await repository.lockSalesReturn(connection, value.salesReturnId);
      if (!request || request.status !== "requested") throw domainError("RETURN_NOT_REQUESTED", "Retur tidak tersedia untuk diverifikasi.");
      if (String(request.requestedByUserId) === value.actor.userId) throw domainError("RETURN_SELF_REVIEW_BLOCKED", "Pengaju retur tidak boleh memverifikasi pengajuannya sendiri.", 403);
      await repository.reviewSalesReturn(connection, {
        salesReturnId: String(value.salesReturnId), reviewerUserId: value.actor.userId,
        status: approve ? "admin_reviewed" : "rejected"
      });
      if (!approve) {
        for (const line of request.lines) await repository.releaseReturnQuota(connection, { quotaId: line.quotaId, quantity: line.quantity });
      }
      await repository.appendSalesReturnEvent(connection, {
        returnId: String(value.salesReturnId), eventType: approve ? "admin_reviewed" : "rejected",
        oldStatus: "requested", newStatus: approve ? "admin_reviewed" : "rejected",
        actorUserId: value.actor.userId, reason
      });
      return { entityType: "sales_return", entityId: String(value.salesReturnId), salesReturnId: String(value.salesReturnId), status: approve ? "admin_reviewed" : "rejected" };
    });
  }

  async function approveSalesReturn(value = {}) {
    const reason = String(value.reason || "").trim();
    if (!reason) throw domainError("RETURN_APPROVAL_REASON_REQUIRED", "Alasan persetujuan Pimpinan wajib diisi.", 400);
    return execute({
      actor: value.actor, roles: ["pimpinan"], commandName: "sales.return.pimpinan_approve",
      idempotencyKey: value.idempotencyKey, requestId: value.requestId,
      payload: { salesReturnId: String(value.salesReturnId), reason }, actionCode: "SALES_RETURN_PIMPINAN_APPROVED"
    }, async connection => {
      const request = await repository.lockSalesReturn(connection, value.salesReturnId);
      if (!request || request.status !== "admin_reviewed") throw domainError("RETURN_ADMIN_REVIEW_REQUIRED", "Retur harus diverifikasi Admin terlebih dahulu.");
      await repository.approveSalesReturn(connection, {
        salesReturnId: String(value.salesReturnId), approverUserId: value.actor.userId
      });
      for (const line of request.lines) {
        await repository.approveReturnQuota(connection, { quotaId: line.quotaId, quantity: line.quantity });
        if (line.batchId) {
          await repository.createPatientReturnQuarantine(connection, {
            returnLineId: line.returnLineId, medicineId: line.medicineId, sourceBatchId: line.batchId,
            quantity: line.quantity, actorUserId: value.actor.userId, reason
          });
        }
      }
      await repository.appendSalesReturnEvent(connection, {
        returnId: String(value.salesReturnId), eventType: "pimpinan_approved",
        oldStatus: "admin_reviewed", newStatus: "pimpinan_approved",
        actorUserId: value.actor.userId, reason
      });
      return { entityType: "sales_return", entityId: String(value.salesReturnId), salesReturnId: String(value.salesReturnId), status: "pimpinan_approved", stockDisposition: "quarantine", refundApproval: "separate" };
    });
  }

  async function approveRefund(value = {}) {
    const reason = String(value.reason || "").trim();
    if (!reason) throw domainError("REFUND_APPROVAL_REASON_REQUIRED", "Alasan persetujuan refund wajib diisi.", 400);
    return execute({
      actor: value.actor, roles: ["pimpinan"], commandName: "finance.refund.approve",
      idempotencyKey: value.idempotencyKey, requestId: value.requestId,
      payload: { salesReturnId: String(value.salesReturnId), reason }, actionCode: "REFUND_APPROVED"
    }, async connection => {
      const request = await repository.lockSalesReturn(connection, value.salesReturnId);
      if (!request || request.status !== "pimpinan_approved") throw domainError("REFUND_RETURN_NOT_APPROVED", "Retur barang/jasa harus disetujui Pimpinan sebelum refund.");
      const amount = request.lines.reduce((sum, line) => sum + BigInt(String(line.refundAmount)), 0n);
      if (amount <= 0n) throw domainError("REFUND_AMOUNT_ZERO", "Nominal refund tidak lebih dari nol.");
      const obligationId = await repository.createRefundObligation(connection, {
        salesReturnId: String(value.salesReturnId), amount: amount.toString(), approvedByUserId: value.actor.userId
      });
      await repository.appendSalesReturnEvent(connection, {
        returnId: String(value.salesReturnId), eventType: "refund_approved",
        oldStatus: "pimpinan_approved", newStatus: "pimpinan_approved",
        actorUserId: value.actor.userId, reason: reason + "; refund Rp " + amount.toString()
      });
      return { entityType: "refund_obligation", entityId: String(obligationId), refundObligationId: String(obligationId), amount: amount.toString(), status: "approved_pending_payout" };
    });
  }

  async function createStocktake(value = {}) {
    const stocktakeDate = contracts.requireBusinessDate(value.stocktakeDate, "stocktakeDate");
    if (!stocktakeDate.endsWith("-01")) throw domainError("STOCKTAKE_DATE_MUST_BE_FIRST", "Stock opname bulanan harus bertanggal 1.", 400);
    if (!Array.isArray(value.lines) || value.lines.length === 0) throw domainError("STOCKTAKE_LINES_REQUIRED", "Daftar batch hasil hitung wajib diisi.", 400);
    const lines = value.lines.map(line => ({
      batchId: String(line.batchId || ""),
      countedQuantity: contracts.parseScaledQuantity(line.countedQuantity, 0, "countedQuantity").toString(),
      reason: String(line.reason || "").trim()
    }));
    if (lines.some(line => !line.batchId) || new Set(lines.map(line => line.batchId)).size !== lines.length) {
      throw domainError("STOCKTAKE_BATCH_INVALID", "Batch opname kosong atau duplikat.", 400);
    }
    return execute({
      actor: value.actor, roles: ["admin"], commandName: "inventory.stocktake.create",
      idempotencyKey: value.idempotencyKey, requestId: value.requestId,
      payload: { stocktakeDate, lines }, actionCode: "STOCKTAKE_SUBMITTED"
    }, async connection => {
      const stocktakeId = await repository.createStocktake(connection, {
        stocktakeDate, lines, countedByUserId: value.actor.userId
      });
      return { entityType: "stocktake", entityId: String(stocktakeId), stocktakeId: String(stocktakeId), status: "counting", lineCount: lines.length };
    });
  }

  async function approveStocktake(value = {}) {
    const reason = String(value.reason || "").trim();
    if (!reason) throw domainError("STOCKTAKE_APPROVAL_REASON_REQUIRED", "Catatan persetujuan stok opname wajib diisi.", 400);
    return execute({
      actor: value.actor, roles: ["pimpinan"], commandName: "inventory.stocktake.approve",
      idempotencyKey: value.idempotencyKey, requestId: value.requestId,
      payload: { stocktakeId: String(value.stocktakeId), reason }, actionCode: "STOCKTAKE_APPROVED"
    }, async connection => {
      const stocktake = await repository.lockStocktake(connection, value.stocktakeId);
      if (!stocktake || stocktake.status !== "counting") throw domainError("STOCKTAKE_NOT_PENDING", "Stok opname tidak menunggu persetujuan.");
      for (const line of stocktake.lines) {
        if (BigInt(String(line.varianceQuantity)) !== 0n) {
          if (!line.reason) throw domainError("STOCKTAKE_VARIANCE_REASON_REQUIRED", "Setiap selisih stok harus memiliki alasan.");
          await repository.applyStocktakeVariance(connection, {
            stocktakeId: String(value.stocktakeId), line, actorUserId: value.actor.userId
          });
        }
      }
      await repository.approveStocktake(connection, {
        stocktakeId: String(value.stocktakeId), approverUserId: value.actor.userId, reason
      });
      return { entityType: "stocktake", entityId: String(value.stocktakeId), stocktakeId: String(value.stocktakeId), status: "approved" };
    });
  }

  async function inspectQuarantineBatch(value = {}) {
    const decision = value.decision;
    if (!["release", "hold", "dispose"].includes(decision)) throw domainError("QUARANTINE_INSPECTION_DECISION_INVALID", "Keputusan inspeksi harus release, hold atau dispose.", 400);
    const reason = String(value.reason || "").trim();
    if (!reason) throw domainError("QUARANTINE_INSPECTION_REASON_REQUIRED", "Catatan pemeriksaan fisik wajib diisi.", 400);
    if (decision === "dispose" && !value.evidenceFileId) throw domainError("QUARANTINE_DISPOSAL_EVIDENCE_REQUIRED", "Bukti kondisi batch wajib dilampirkan untuk usulan pemusnahan.", 400);
    return execute({
      actor: value.actor, roles: ["admin"], commandName: "inventory.quarantine.inspect",
      idempotencyKey: value.idempotencyKey, requestId: value.requestId,
      payload: { batchId: String(value.batchId), decision, reason, evidenceFileId: value.evidenceFileId || null },
      actionCode: "QUARANTINE_INSPECTED"
    }, async connection => {
      const eventId = await repository.inspectQuarantineBatch(connection, {
        batchId: String(value.batchId), decision, reason,
        evidenceFileId: value.evidenceFileId || null, actorUserId: value.actor.userId
      });
      return { entityType: "inventory_quarantine", entityId: String(eventId), quarantineEventId: String(eventId), decision, status: "awaiting_pimpinan_review" };
    });
  }

  async function approveQuarantineRelease(value = {}) {
    const reason = String(value.reason || "").trim();
    if (!reason) throw domainError("QUARANTINE_APPROVAL_REASON_REQUIRED", "Catatan persetujuan pelepasan karantina wajib diisi.", 400);
    return execute({
      actor: value.actor, roles: ["pimpinan"], commandName: "inventory.quarantine.approve_release",
      idempotencyKey: value.idempotencyKey, requestId: value.requestId,
      payload: { batchId: String(value.batchId), reason }, actionCode: "QUARANTINE_RELEASE_APPROVED"
    }, async connection => {
      const inspection = await repository.lockLatestQuarantineInspection(connection, value.batchId);
      if (!inspection || inspection.inspectionDecision !== "release") throw domainError("QUARANTINE_RELEASE_NOT_RECOMMENDED", "Admin belum merekomendasikan batch ini untuk dilepas.");
      await repository.approveQuarantineRelease(connection, {
        eventId: inspection.eventId, approverUserId: value.actor.userId, reason
      });
      return { entityType: "inventory_quarantine", entityId: String(inspection.eventId), batchId: String(value.batchId), status: "release_approved_waiting_admin" };
    });
  }

  async function approveQuarantineDisposition(value = {}) {
    const reason = String(value.reason || "").trim();
    if (!reason) throw domainError("QUARANTINE_DISPOSITION_REASON_REQUIRED", "Alasan persetujuan disposisi wajib diisi.", 400);
    return execute({
      actor: value.actor, roles: ["pimpinan"], commandName: "inventory.quarantine.approve_disposition",
      idempotencyKey: value.idempotencyKey, requestId: value.requestId,
      payload: { batchId: String(value.batchId), reason }, actionCode: "QUARANTINE_DISPOSITION_APPROVED"
    }, async connection => {
      const inspection = await repository.lockLatestQuarantineInspection(connection, value.batchId);
      if (!inspection || inspection.inspectionDecision !== "dispose") throw domainError("QUARANTINE_DISPOSITION_NOT_RECOMMENDED", "Admin belum mengusulkan batch untuk disposisi.");
      await repository.approveQuarantineDisposition(connection, {
        eventId: inspection.eventId, approverUserId: value.actor.userId, reason
      });
      return { entityType: "inventory_quarantine", entityId: String(inspection.eventId), batchId: String(value.batchId), status: "disposition_approved_waiting_admin" };
    });
  }

  async function disposeQuarantineBatch(value = {}) {
    return execute({
      actor: value.actor, roles: ["admin"], commandName: "inventory.quarantine.dispose",
      idempotencyKey: value.idempotencyKey, requestId: value.requestId,
      payload: { batchId: String(value.batchId) }, actionCode: "QUARANTINE_DISPOSITION_COMPLETED"
    }, async connection => {
      const result = await repository.disposeQuarantineBatch(connection, {
        batchId: String(value.batchId), actorUserId: value.actor.userId
      });
      return { entityType: "inventory_batch", entityId: String(value.batchId), batchId: String(value.batchId), status: result.disposition, disposedQuantity: result.quantity };
    });
  }

  async function releaseQuarantineBatch(value = {}) {
    return execute({
      actor: value.actor, roles: ["admin"], commandName: "inventory.quarantine.release",
      idempotencyKey: value.idempotencyKey, requestId: value.requestId,
      payload: { batchId: String(value.batchId) }, actionCode: "QUARANTINE_RELEASED"
    }, async connection => {
      const result = await repository.releaseQuarantineBatch(connection, {
        batchId: String(value.batchId), actorUserId: value.actor.userId
      });
      return { entityType: "inventory_batch", entityId: String(value.batchId), batchId: String(value.batchId), status: "sellable", sellableQuantity: result.sellableQuantity };
    });
  }

  async function openShift(value = {}) {
    const shiftCode = String(value.shiftCode || "morning").trim().toLowerCase();
    const allowedCodes = ["morning", "evening", "admin"];
    if (!allowedCodes.includes(shiftCode)) throw domainError("SHIFT_CODE_INVALID", "Kode shift tidak valid. Harus morning, evening, atau admin.", 400);
    const openingFloat = contracts.parseIntegerMoney(value.openingFloat || 0, "openingFloat").toString();
    const laneCode = value.laneCode ? String(value.laneCode).trim().toUpperCase() : null;
    if (laneCode && !["A", "B"].includes(laneCode)) {
      throw domainError("LANE_CODE_INVALID", "Jalur antrean tidak valid. Harus A atau B.", 400);
    }
    return execute({
      actor: value.actor, roles: ["kasir", "admin"], commandName: "finance.shift.open",
      idempotencyKey: value.idempotencyKey, requestId: value.requestId,
      payload: { shiftCode, openingFloat, laneCode }, actionCode: "SHIFT_OPENED"
    }, async connection => {
      const active = await repository.findActiveShiftSlot(connection, value.actor.userId);
      if (active) throw domainError("CASHIER_ALREADY_HAS_ACTIVE_SHIFT", "Pengguna sudah memiliki shift aktif yang belum ditutup.", 409);
      const result = await repository.openShift(connection, {
        cashierUserId: value.actor.userId,
        shiftCode,
        openingFloat,
        laneCode
      });
      return {
        entityType: "cashier_shift",
        entityId: String(result.shiftId),
        shiftId: String(result.shiftId),
        publicId: result.publicId,
        shiftCode,
        openingFloat,
        laneCode,
        status: "open"
      };
    });
  }

  async function assignQueueLane(value = {}) {
    const laneCode = String(value.laneCode || "").trim().toUpperCase();
    if (!["A", "B"].includes(laneCode)) throw domainError("LANE_CODE_INVALID", "Jalur antrean tidak valid. Harus A atau B.", 400);
    const targetUserId = String(value.userId || value.cashierUserId || "").trim();
    if (!targetUserId) throw domainError("TARGET_USER_ID_REQUIRED", "ID kasir wajib diisi.", 400);
    return execute({
      actor: value.actor, roles: ["admin", "pimpinan"], commandName: "queue.lane.assign",
      idempotencyKey: value.idempotencyKey, requestId: value.requestId,
      payload: { targetUserId, laneCode }, actionCode: "LANE_ASSIGNED"
    }, async connection => {
      const result = await repository.assignQueueLane(connection, {
        targetUserId,
        laneCode,
        assignedByUserId: value.actor.userId
      });
      return {
        entityType: "cashier_queue_assignment",
        entityId: String(result.assignmentId),
        userId: targetUserId,
        laneCode,
        assignedBy: value.actor.userId
      };
    });
  }

  async function closeShift(value = {}) {
    const countedCash = contracts.parseIntegerMoney(value.countedCash, "countedCash").toString();
    const reason = String(value.varianceReason || "").trim();
    return execute({
      actor: value.actor, roles: ["kasir", "admin"], commandName: "finance.shift.close",
      idempotencyKey: value.idempotencyKey, requestId: value.requestId,
      payload: { shiftId: String(value.shiftId), countedCash, varianceReason: reason },
      actionCode: "SHIFT_CLOSED"
    }, async connection => {
      const shift = await repository.lockShiftForClose(connection, value.shiftId);
      if (!shift || shift.status !== "open") throw domainError("SHIFT_NOT_OPEN", "Shift tidak tersedia untuk ditutup.");
      if (String(shift.cashierUserId) !== value.actor.userId) throw domainError("SHIFT_NOT_OWNED", "Pengguna hanya dapat menutup shift miliknya.", 403);
      if (shift.shiftCode === "admin" && value.actor.role !== "admin") throw domainError("SHIFT_ROLE_MISMATCH", "Shift Admin hanya dapat ditutup oleh Admin.", 403);
      if (shift.shiftCode !== "admin" && value.actor.role !== "kasir") throw domainError("SHIFT_ROLE_MISMATCH", "Shift Kasir hanya dapat ditutup oleh Kasir.", 403);
      const expected = BigInt(String(shift.expectedCash));
      const variance = BigInt(countedCash) - expected;
      if (variance !== 0n && !reason) throw domainError("SHIFT_VARIANCE_REASON_REQUIRED", "Alasan selisih kas wajib diisi.", 400);
      const reconciliationId = await repository.closeShift(connection, {
        shiftId: String(value.shiftId), expectedCash: expected.toString(),
        countedCash, varianceAmount: variance.toString(), varianceReason: reason,
        closedByUserId: value.actor.userId
      });
      return { entityType: "shift_reconciliation", entityId: String(reconciliationId), reconciliationId: String(reconciliationId), shiftId: String(value.shiftId), expectedCash: expected.toString(), countedCash, varianceAmount: variance.toString(), status: "pending_verification" };
    });
  }

  async function verifyShift(value = {}) {
    const reason = String(value.reason || "").trim();
    return execute({
      actor: value.actor, roles: ["admin", "pimpinan"], commandName: "finance.shift.verify",
      idempotencyKey: value.idempotencyKey, requestId: value.requestId,
      payload: { shiftId: String(value.shiftId), reason }, actionCode: "SHIFT_VERIFIED"
    }, async connection => {
      const shift = await repository.lockShiftForVerification(connection, value.shiftId);
      if (!shift || shift.status !== "pending_verification") throw domainError("SHIFT_NOT_PENDING_VERIFICATION", "Shift tidak menunggu verifikasi.");
      const expectedVerifier = shift.shiftCode === "admin" ? "pimpinan" : "admin";
      if (value.actor.role !== expectedVerifier) throw domainError("SHIFT_VERIFIER_ROLE_INVALID", "Peran verifikator tidak sesuai kebijakan shift.", 403);
      if (String(shift.cashierUserId) === value.actor.userId) throw domainError("SHIFT_SELF_VERIFICATION_BLOCKED", "Petugas tidak boleh memverifikasi penutupan shift sendiri.", 403);
      const requiredApprovals = shift.shiftCode === "admin" ? 1 : 2;
      const verification = await repository.recordShiftVerification(connection, {
        shiftId: String(value.shiftId), verifierUserId: value.actor.userId,
        verifierRole: value.actor.role, reason, requiredApprovals
      });
      return {
        entityType: "shift", entityId: String(value.shiftId), shiftId: String(value.shiftId),
        status: verification.verified ? "verified" : "pending_verification",
        verifiedBy: verification.verified ? value.actor.userId : null,
        verificationCount: verification.verificationCount,
        requiredApprovals: verification.requiredApprovals
      };
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
      if (payment.paymentMethod === "cash" && (!policy || policy.approved !== true)) throw domainError("PAYMENT_RECOGNITION_POLICY_PENDING", "Kebijakan penerimaan tunai belum disetujui.");
      const source = await repository.lockPaymentSource(connection, payment.sourceType, payment.sourceId);
      if (!source) throw domainError("PAYMENT_SOURCE_NOT_FOUND", "Sumber pembayaran tidak ditemukan.", 404);
      if (source.outstandingAmount !== undefined && contracts.parseIntegerMoney(payment.amount, "payment.amount") > contracts.parseIntegerMoney(source.outstandingAmount, "outstandingAmount")) throw domainError("PAYMENT_EXCEEDS_INVOICE", "Pembayaran melebihi sisa tagihan.");
      const paymentId = await repository.appendPaymentEvent(connection, { ...payment, recordedByUserId: value.actor.userId, idempotencyKey: value.idempotencyKey });
      if (payment.paymentMethod === "cash") {
        if (!payment.cashAccountId || !payment.shiftId) throw domainError("CASH_ACCOUNT_SHIFT_REQUIRED", "Penerimaan tunai harus terhubung ke akun kas dan shift.", 400);
        await repository.appendCashLedgerMovement(connection, {
          accountId: payment.cashAccountId, shiftId: payment.shiftId,
          direction: "in", amount: payment.amount, sourceType: "payment",
          sourceId: String(paymentId), actorUserId: value.actor.userId, idempotencyKey: value.idempotencyKey + ":cash"
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
      if (!payment.evidenceFileId) throw domainError("SUPPLIER_PAYMENT_EVIDENCE_REQUIRED", "Bukti pembayaran supplier wajib dilampirkan.", 400);
      const paymentId = await repository.appendSupplierPayment(connection, { ...payment, payableId: payment.sourceId, recordedByUserId: value.actor.userId, idempotencyKey: value.idempotencyKey });
      await repository.applySupplierPaymentAllocation(connection, { paymentId: String(paymentId), payableId: payment.sourceId, amount: payment.amount });
      return { entityType: "supplier_payment", entityId: String(paymentId), paymentId: String(paymentId), amount: payment.amount, outstandingAfter: (outstanding - amount).toString() };
    });
  }

  async function approvePayment(value = {}) {
    const reason = String(value.reason || "").trim();
    if (!reason) throw domainError("PAYMENT_APPROVAL_REASON_REQUIRED", "Catatan review Pimpinan wajib diisi.", 400);
    return execute({
      actor: value.actor, roles: ["pimpinan"], commandName: "finance.payment.approve",
      idempotencyKey: value.idempotencyKey, requestId: value.requestId,
      payload: { paymentId: String(value.paymentId), reason },
      actionCode: "NON_CASH_PAYMENT_APPROVED"
    }, async connection => {
      const payment = await repository.lockPaymentEvent(connection, value.paymentId);
      if (!payment || payment.reviewStatus !== "pending" || payment.settlementStatus === "reversed") throw domainError("PAYMENT_NOT_PENDING_REVIEW", "Pembayaran tidak menunggu review Pimpinan.");
      await repository.approvePaymentEvent(connection, {
        paymentId: String(value.paymentId), reviewerUserId: value.actor.userId
      });
      return { entityType: "payment", entityId: String(value.paymentId), paymentId: String(value.paymentId), reviewStatus: "approved", incomeRecognized: true, settlementStatus: payment.settlementStatus };
    });
  }

  async function payRefund(value = {}) {
    const raw = value.payout || {};
    const payout = {
      sourceType: "refund_obligation", sourceId: String(raw.sourceId || ""),
      amount: contracts.parseIntegerMoney(raw.amount, "refund.amount", false).toString(),
      paymentStatus: String(raw.paymentStatus || ""),
      businessDate: contracts.requireBusinessDate(raw.businessDate, "refund.businessDate"),
      eventAtUtc: contracts.requireTimestamp(raw.eventAtUtc, "refund.eventAtUtc"),
      settlementReference: raw.settlementReference ? String(raw.settlementReference).trim() : null
    };
    if (!payout.sourceId || payout.sourceId.length > 100) throw domainError("REFUND_OBLIGATION_ID_REQUIRED", "ID kewajiban refund wajib diisi.", 400);
    return execute({
      actor: value.actor, roles: ["pimpinan"],
      commandName: "finance.refund.payout", idempotencyKey: value.idempotencyKey,
      requestId: value.requestId, payload: payout, actionCode: "REFUND_PAYOUT_POSTED"
    }, async connection => {
      const policy = await repository.getRefundPayoutPolicy(connection);
      if (!policy || policy.approved !== true) throw domainError("REFUND_PAYOUT_POLICY_PENDING", "Persetujuan refund belum tersedia.");
      const obligation = await repository.lockRefundObligation(connection, payout.sourceId);
      if (!obligation || obligation.status !== "approved_pending_payout") throw domainError("REFUND_OBLIGATION_NOT_PAYABLE", "Kewajiban refund belum disetujui untuk dibayar.");
      const amount = contracts.parseIntegerMoney(payout.amount, "amount", false);
      const outstanding = contracts.parseIntegerMoney(obligation.outstandingAmount, "outstandingAmount");
      if (amount !== outstanding) throw domainError("REFUND_PARTIAL_PAYOUT_POLICY_PENDING", "Pembayaran sebagian refund belum diatur; nominal harus sama dengan kewajiban tersisa.");
      if (payout.paymentStatus !== "settled") throw domainError("REFUND_TRANSFER_NOT_CONFIRMED", "Status transfer harus sudah settled sebelum dicatat sebagai uang kembali.");
      const payoutId = await repository.appendRefundPayout(connection, { ...payout, obligationId: payout.sourceId, paidByUserId: value.actor.userId, idempotencyKey: value.idempotencyKey });
      await repository.markRefundPaid(connection, payout.sourceId, String(payoutId));
      return { entityType: "refund_payout", entityId: String(payoutId), payoutId: String(payoutId), amount: payout.amount, status: "transferred", receiptText: "Sudah ditransfer Rp " + payout.amount + " ke rekening." };
    });
  }

  return Object.freeze({
    createMedicine, receivePurchase, postCheckout, createSupplierReturnRequest,
    requestSalesReturn, reviewSalesReturn, approveSalesReturn, approveRefund,
    createStocktake, approveStocktake, inspectQuarantineBatch, approveQuarantineRelease, releaseQuarantineBatch,
    approveQuarantineDisposition, disposeQuarantineBatch,
    openShift, closeShift, verifyShift, assignQueueLane,
    dispatchSupplierReturn, registerEncounter, appendQueueCallEvent, transferQueue,
    postJournal, createExpense, approveExpense, recordPayment, approvePayment, recordSupplierPayment, payRefund
  });
}

module.exports = { createClinicDomainCommands };
