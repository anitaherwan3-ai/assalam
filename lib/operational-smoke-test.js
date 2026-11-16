"use strict";

const crypto = require("node:crypto");
const { createTidbInventoryRepository } = require("./repositories/tidb-inventory-repository");

async function runOperationalSmokeTest(connection) {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 18);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  const [year, month] = date.split("-").map(Number);
  const monthStart = year + "-" + String(month).padStart(2, "0") + "-01";
  const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const ids = {};
  let started = false;
  let failure = null;
  const insert = async (sql, params) => {
    const [result] = await connection.execute(sql, params);
    return result.insertId === undefined ? null : String(result.insertId);
  };

  try {
    await connection.query("SET SESSION FOREIGN_KEY_CHECKS = 1");
    await connection.beginTransaction();
    started = true;

    ids.owner = "op_owner_" + suffix;
    ids.admin = "op_admin_" + suffix;
    ids.cashierA = "op_cashier_a_" + suffix;
    ids.cashierB = "op_cashier_b_" + suffix;
    for (const [id, name] of [[ids.owner, "Smoke Pimpinan"], [ids.admin, "Smoke Admin"], [ids.cashierA, "Smoke Kasir A"], [ids.cashierB, "Smoke Kasir B"]]) {
      await connection.execute(
        "INSERT INTO users (user_id, display_name, active, protected_owner, created_at_utc, updated_at_utc) VALUES (?, ?, 1, 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        [id, name]
      );
    }

    ids.shiftA = await insert(
      "INSERT INTO cashier_shifts (public_id, cashier_user_id, business_date, shift_code, opening_float, status, opened_at_utc) VALUES (?, ?, ?, 'morning', 100000, 'open', UTC_TIMESTAMP(3))",
      ["op-shift-a-" + suffix, ids.cashierA, date]
    );
    ids.shiftB = await insert(
      "INSERT INTO cashier_shifts (public_id, cashier_user_id, business_date, shift_code, opening_float, status, opened_at_utc) VALUES (?, ?, ?, 'evening', 100000, 'open', UTC_TIMESTAMP(3))",
      ["op-shift-b-" + suffix, ids.cashierB, date]
    );
    await connection.execute(
      "INSERT INTO active_shift_slots (cashier_user_id, shift_id, activated_at_utc) VALUES (?, ?, UTC_TIMESTAMP(3)), (?, ?, UTC_TIMESTAMP(3))",
      [ids.cashierA, ids.shiftA, ids.cashierB, ids.shiftB]
    );

    ids.patient = await insert(
      "INSERT INTO patients (public_id, full_name, phone, active, created_at_utc, created_by_user_id, updated_at_utc) VALUES (?, 'Synthetic Operational Patient', '080000000001', 1, UTC_TIMESTAMP(3), ?, UTC_TIMESTAMP(3))",
      ["op-patient-" + suffix, ids.cashierA]
    );
    ids.encounter = await insert(
      "INSERT INTO patient_encounters (public_id, patient_id, business_date, service_name_snapshot, cashier_user_id, shift_id, status, created_at_utc, updated_at_utc) VALUES (?, ?, ?, 'Pemeriksaan umum', ?, ?, 'registered', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      ["op-encounter-" + suffix, ids.patient, date, ids.cashierA, ids.shiftA]
    );
    await connection.execute(
      "INSERT INTO cashier_queue_assignments (user_id, prefix, valid_from, assigned_by_user_id, created_at_utc) VALUES (?, 'A', ?, ?, UTC_TIMESTAMP(3)), (?, 'B', ?, ?, UTC_TIMESTAMP(3))",
      [ids.cashierA, date, ids.owner, ids.cashierB, date, ids.owner]
    );
    await connection.execute(
      "INSERT INTO queue_counters (business_date, prefix, last_sequence, updated_at_utc) VALUES (?, 'A', 1, UTC_TIMESTAMP(3))",
      [date]
    );
    ids.ticket = await insert(
      "INSERT INTO queue_tickets (public_id, encounter_id, business_date, prefix, sequence_no, display_number, status, current_cashier_user_id, current_shift_id, registered_by_user_id, registered_at_utc) VALUES (?, ?, ?, 'A', 1, ?, 'waiting', ?, ?, ?, UTC_TIMESTAMP(3))",
      ["op-ticket-" + suffix, ids.encounter, date, "A-001-" + suffix.slice(0, 4), ids.cashierA, ids.shiftA, ids.cashierA]
    );
    await connection.execute(
      "INSERT INTO queue_call_events (queue_ticket_id, event_type, counter_label, event_idempotency_key, actor_user_id, occurred_at_utc) VALUES (?, 'call', 'Loket A', ?, ?, UTC_TIMESTAMP(3))",
      [ids.ticket, "op-call-" + suffix, ids.cashierA]
    );
    await connection.execute(
      "UPDATE queue_call_guards SET active_queue_ticket_id = ?, version = version + 1, updated_at_utc = UTC_TIMESTAMP(3) WHERE prefix = 'A'",
      [ids.ticket]
    );
    await connection.execute(
      "UPDATE queue_tickets SET current_cashier_user_id = ?, current_shift_id = ?, version = version + 1 WHERE queue_ticket_id = ?",
      [ids.cashierB, ids.shiftB, ids.ticket]
    );
    await connection.execute(
      "INSERT INTO queue_transfer_events (queue_ticket_id, from_cashier_user_id, from_shift_id, to_cashier_user_id, to_shift_id, reason, actor_user_id, occurred_at_utc) VALUES (?, ?, ?, ?, ?, 'Pelimpahan smoke test', ?, UTC_TIMESTAMP(3))",
      [ids.ticket, ids.cashierA, ids.shiftA, ids.cashierB, ids.shiftB, ids.admin]
    );

    ids.file = "op-file-" + suffix;
    await connection.execute(
      "INSERT INTO stored_files (stored_file_id, object_key, original_name, mime_type, size_bytes, sha256, uploaded_by_user_id, uploaded_at_utc) VALUES (?, ?, 'evidence.txt', 'text/plain', 8, ?, ?, UTC_TIMESTAMP(3))",
      [ids.file, "smoke/" + suffix + "/evidence.txt", "a".repeat(64), ids.admin]
    );
    ids.supplier = await insert(
      "INSERT INTO suppliers (public_id, name, created_at_utc, updated_at_utc) VALUES (?, 'Synthetic Supplier', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      ["op-supplier-" + suffix]
    );
    ids.medicine = await insert(
      "INSERT INTO medicines (public_id, name, canonical_unit, selling_price, minimum_stock, created_at_utc, created_by_user_id, updated_at_utc, updated_by_user_id) VALUES (?, 'Synthetic Tablet', 'tablet', 1000, 1, UTC_TIMESTAMP(3), ?, UTC_TIMESTAMP(3), ?)",
      ["op-medicine-" + suffix, ids.admin, ids.admin]
    );
    ids.invoice = await insert(
      "INSERT INTO supplier_invoices (public_id, supplier_id, supplier_invoice_number, invoice_date, gross_amount, status, created_by_user_id, created_at_utc, updated_at_utc) VALUES (?, ?, ?, ?, 10000, 'open', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      ["op-supplier-invoice-" + suffix, ids.supplier, "SI-" + suffix, date, ids.admin]
    );
    ids.invoiceLine = await insert(
      "INSERT INTO supplier_invoice_lines (supplier_invoice_id, medicine_id, line_number, ordered_quantity, received_quantity, unit_cost, line_total, created_at_utc) VALUES (?, ?, 1, 10, 10, 500, 5000, UTC_TIMESTAMP(3))",
      [ids.invoice, ids.medicine]
    );
    ids.receipt = await insert(
      "INSERT INTO purchase_receipts (public_id, supplier_invoice_id, received_at_utc, business_date, receipt_reference, received_by_user_id, created_at_utc) VALUES (?, ?, UTC_TIMESTAMP(3), ?, ?, ?, UTC_TIMESTAMP(3))",
      ["op-receipt-" + suffix, ids.invoice, date, "GR-" + suffix, ids.admin]
    );
    ids.receiptLine = await insert(
      "INSERT INTO purchase_receipt_lines (purchase_receipt_id, supplier_invoice_line_id, medicine_id, received_quantity, unit_cost_snapshot, batch_number, expiry_date, expiry_verified, origin_verified, created_at_utc) VALUES (?, ?, ?, 10, 500, ?, DATE_ADD(CURDATE(), INTERVAL 365 DAY), 1, 1, UTC_TIMESTAMP(3))",
      [ids.receipt, ids.invoiceLine, ids.medicine, "BATCH-" + suffix]
    );
    ids.batch = await insert(
      "INSERT INTO inventory_batches (medicine_id, source_receipt_line_id, batch_number, expiry_date, expiry_verified, origin_verified, received_at_utc, original_quantity, remaining_quantity, unit_cost_hpp, disposition) VALUES (?, ?, ?, DATE_ADD(CURDATE(), INTERVAL 365 DAY), 1, 1, UTC_TIMESTAMP(3), 10, 10, 500, 'sellable')",
      [ids.medicine, ids.receiptLine, "BATCH-" + suffix]
    );
    ids.receiptMovement = await insert(
      "INSERT INTO inventory_movements (medicine_id, batch_id, movement_type, direction, quantity, source_type, source_id, actor_user_id, occurred_at_utc, idempotency_key) VALUES (?, ?, 'purchase_receipt', 'in', 10, 'purchase_receipt', ?, ?, UTC_TIMESTAMP(3), ?)",
      [ids.medicine, ids.batch, ids.receipt, ids.admin, "op-stock-in-" + suffix]
    );
    await connection.execute(
      "INSERT INTO medicine_stock_projections (medicine_id, physical_quantity, sellable_quantity, unknown_hpp_quantity, weighted_hpp, profit_calculation_status, projected_at_utc) VALUES (?, 10, 10, 0, 500, 'calculated', UTC_TIMESTAMP(3))",
      [ids.medicine]
    );
    ids.stocktake = await insert(
      "INSERT INTO stocktakes (public_id, stocktake_date, status, counted_by_user_id, approved_by_user_id, approved_at_utc, created_at_utc) VALUES (?, ?, 'approved', ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      ["op-stocktake-" + suffix, date, ids.admin, ids.owner]
    );
    await connection.execute(
      "INSERT INTO stocktake_lines (stocktake_id, medicine_id, batch_id, system_quantity, counted_quantity, variance_quantity, created_at_utc) VALUES (?, ?, ?, 10, 10, 0, UTC_TIMESTAMP(3))",
      [ids.stocktake, ids.medicine, ids.batch]
    );

    ids.salesInvoice = await insert(
      "INSERT INTO sales_invoices (public_id, encounter_id, patient_id, cashier_user_id, shift_id, business_date, gross_amount, discount_amount, net_amount, status, issued_at_utc, created_at_utc) VALUES (?, ?, ?, ?, ?, ?, 2000, 0, 2000, 'paid', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      ["op-sales-" + suffix, ids.encounter, ids.patient, ids.cashierA, ids.shiftA, date]
    );
    ids.salesLine = await insert(
      "INSERT INTO sales_invoice_lines (sales_invoice_id, line_number, line_type, medicine_id, item_name_snapshot, unit_snapshot, quantity, gross_unit_price, gross_amount, line_discount, net_charge, hpp_snapshot, profit_calculation_status, created_at_utc) VALUES (?, 1, 'medicine', ?, 'Synthetic Tablet', 'tablet', 2, 1000, 2000, 0, 2000, 500, 'calculated', UTC_TIMESTAMP(3))",
      [ids.salesInvoice, ids.medicine]
    );
    await connection.execute(
      "INSERT INTO inventory_movements (medicine_id, batch_id, movement_type, direction, quantity, source_type, source_id, actor_user_id, occurred_at_utc, idempotency_key) VALUES (?, ?, 'sale', 'out', 2, 'sale', ?, ?, UTC_TIMESTAMP(3), ?)",
      [ids.medicine, ids.batch, ids.salesInvoice, ids.cashierA, "op-sale-move-" + suffix]
    );
    await connection.execute(
      "INSERT INTO sales_batch_allocations (sales_invoice_line_id, batch_id, medicine_id, quantity, hpp_unit_snapshot, hpp_total_snapshot, created_at_utc) VALUES (?, ?, ?, 2, 500, 1000, UTC_TIMESTAMP(3))",
      [ids.salesLine, ids.batch, ids.medicine]
    );
    await connection.execute(
      "INSERT INTO invoice_payments (sales_invoice_id, payment_method, amount, review_status, settlement_status, income_recognized_at_utc, paid_at_utc, recorded_by_user_id, idempotency_key) VALUES (?, 'cash', 2000, 'not_required', 'settled', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), ?, ?)",
      [ids.salesInvoice, ids.cashierA, "op-pay-" + suffix]
    );
    ids.returnQuota = await insert(
      "INSERT INTO return_quota_subjects (sales_invoice_line_id, component_key, batch_id, medicine_id, maximum_quantity, reserved_quantity, approved_quantity) VALUES (?, ?, ?, ?, 2, 1, 1)",
      [ids.salesLine, "batch-" + ids.batch, ids.batch, ids.medicine]
    );
    ids.salesReturn = await insert(
      "INSERT INTO sales_returns (public_id, sales_invoice_id, status, requested_by_user_id, requested_at_utc, admin_reviewed_by_user_id, admin_reviewed_at_utc, pimpinan_approved_by_user_id, pimpinan_approved_at_utc, reason) VALUES (?, ?, 'pimpinan_approved', ?, UTC_TIMESTAMP(3), ?, UTC_TIMESTAMP(3), ?, UTC_TIMESTAMP(3), 'Synthetic return')",
      ["op-return-" + suffix, ids.salesInvoice, ids.cashierA, ids.admin, ids.owner]
    );
    ids.returnLine = await insert(
      "INSERT INTO sales_return_lines (sales_return_id, sales_invoice_line_id, return_quota_subject_id, quantity, original_net_charge_snapshot, refund_amount, stock_disposition, created_at_utc) VALUES (?, ?, ?, 1, 2000, 1000, 'quarantine', UTC_TIMESTAMP(3))",
      [ids.salesReturn, ids.salesLine, ids.returnQuota]
    );
    await connection.execute(
      "INSERT INTO sales_return_events (sales_return_id, event_type, old_status, new_status, actor_user_id, reason, occurred_at_utc) VALUES (?, 'pimpinan_approved', 'admin_reviewed', 'pimpinan_approved', ?, 'Approved in smoke test', UTC_TIMESTAMP(3))",
      [ids.salesReturn, ids.owner]
    );
    ids.refund = await insert(
      "INSERT INTO refund_obligations (sales_return_id, approved_amount, outstanding_amount, status, approved_by_user_id, approved_at_utc, created_at_utc) VALUES (?, 1000, 1000, 'approved', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [ids.salesReturn, ids.owner]
    );
    await connection.execute(
      "INSERT INTO refund_payments (refund_obligation_id, amount, transfer_status, evidence_file_id, transferred_by_user_id, transferred_at_utc, recorded_at_utc, idempotency_key) VALUES (?, 1000, 'transferred', ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), ?)",
      [ids.refund, ids.file, ids.owner, "op-refund-" + suffix]
    );

    await connection.execute(
      "INSERT INTO shift_reconciliations (shift_id, revision_no, expected_cash, counted_cash, variance_amount, variance_reason, status, verified_by_user_id, verified_at_utc, created_at_utc) VALUES (?, 1, 100000, 100000, 0, NULL, 'verified', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [ids.shiftA, ids.admin]
    );
    ids.cashAccount = await insert(
      "INSERT INTO cash_accounts (account_code, account_type, account_name, owner_user_id, created_at_utc) VALUES (?, 'cash_drawer', 'Synthetic drawer', ?, UTC_TIMESTAMP(3))",
      ["op-cash-" + suffix, ids.cashierA]
    );
    await connection.execute(
      "INSERT INTO cash_ledger_entries (cash_account_id, shift_id, direction, amount, source_type, source_id, actor_user_id, occurred_at_utc, idempotency_key) VALUES (?, ?, 'in', 2000, 'sale', ?, ?, UTC_TIMESTAMP(3), ?)",
      [ids.cashAccount, ids.shiftA, ids.salesInvoice, ids.cashierA, "op-cash-entry-" + suffix]
    );
    ids.bankAccount = await insert(
      "INSERT INTO bank_accounts (account_code, account_name, bank_name, created_at_utc) VALUES (?, 'Synthetic bank', 'Synthetic Bank', UTC_TIMESTAMP(3))",
      ["op-bank-" + suffix]
    );
    await connection.execute(
      "INSERT INTO bank_ledger_entries (bank_account_id, direction, amount, source_type, source_id, actor_user_id, occurred_at_utc, evidence_file_id, idempotency_key) VALUES (?, 'out', 1000, 'refund', ?, ?, UTC_TIMESTAMP(3), ?, ?)",
      [ids.bankAccount, ids.refund, ids.owner, ids.file, "op-bank-entry-" + suffix]
    );

    ids.expense = await insert(
      "INSERT INTO expenses (public_id, business_date, category, description, amount, evidence_file_id, status, created_by_user_id, approved_by_user_id, approved_at_utc, created_at_utc) VALUES (?, ?, 'supplies', 'Synthetic approved expense', 500, ?, 'approved', ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      ["op-expense-" + suffix, date, ids.file, ids.admin, ids.owner]
    );
    await connection.execute(
      "INSERT INTO expense_events (expense_id, event_type, actor_user_id, reason, occurred_at_utc) VALUES (?, 'approved', ?, 'Approved in smoke test', UTC_TIMESTAMP(3))",
      [ids.expense, ids.owner]
    );

    ids.supplierReturn = await insert(
      "INSERT INTO supplier_returns (public_id, supplier_invoice_id, status, requested_by_user_id, requested_at_utc, approved_by_user_id, approved_at_utc, dispatched_by_user_id, dispatched_at_utc, dispatch_evidence_file_id, settlement_status, created_at_utc) VALUES (?, ?, 'dispatched', ?, UTC_TIMESTAMP(3), ?, UTC_TIMESTAMP(3), ?, UTC_TIMESTAMP(3), ?, 'pending', UTC_TIMESTAMP(3))",
      ["op-supplier-return-" + suffix, ids.invoice, ids.admin, ids.owner, ids.admin, ids.file]
    );
    await connection.execute(
      "INSERT INTO supplier_return_lines (supplier_return_id, supplier_invoice_line_id, batch_id, medicine_id, quantity, created_at_utc) VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP(3))",
      [ids.supplierReturn, ids.invoiceLine, ids.batch, ids.medicine]
    );
    await connection.execute(
      "INSERT INTO inventory_movements (medicine_id, batch_id, movement_type, direction, quantity, source_type, source_id, actor_user_id, occurred_at_utc, idempotency_key) VALUES (?, ?, 'supplier_return', 'out', 1, 'supplier_return', ?, ?, UTC_TIMESTAMP(3), ?)",
      [ids.medicine, ids.batch, ids.supplierReturn, ids.admin, "op-supplier-return-move-" + suffix]
    );
    await connection.execute(
      "INSERT INTO supplier_credit_notes (supplier_return_id, supplier_invoice_id, credit_amount, settlement_type, status, evidence_file_id, recorded_by_user_id, created_at_utc) VALUES (?, ?, 500, 'receivable', 'pending', ?, ?, UTC_TIMESTAMP(3))",
      [ids.supplierReturn, ids.invoice, ids.file, ids.admin]
    );
    ids.supplierPayment = await insert(
      "INSERT INTO supplier_payments (public_id, supplier_id, payment_date, amount, payment_method, evidence_file_id, external_reference, recorded_by_user_id, created_at_utc, idempotency_key) VALUES (?, ?, ?, 1000, 'transfer', ?, ?, ?, UTC_TIMESTAMP(3), ?)",
      ["op-supplier-payment-" + suffix, ids.supplier, date, ids.file, "SUP-" + suffix, ids.admin, "op-supplier-pay-" + suffix]
    );
    await connection.execute(
      "INSERT INTO supplier_payment_allocations (supplier_payment_id, supplier_invoice_id, allocated_amount, created_at_utc) VALUES (?, ?, 1000, UTC_TIMESTAMP(3))",
      [ids.supplierPayment, ids.invoice]
    );
    await connection.execute(
      "INSERT INTO inventory_quarantine_events (batch_id, event_type, quantity, reason, source_return_line_id, inspected_by_user_id, inspected_at_utc, release_approved_by_user_id, release_approved_at_utc, released_by_user_id, released_at_utc, evidence_file_id, actor_user_id, occurred_at_utc) VALUES (?, 'patient_return', 1, 'Synthetic quarantine inspection', ?, ?, UTC_TIMESTAMP(3), ?, UTC_TIMESTAMP(3), ?, UTC_TIMESTAMP(3), ?, ?, UTC_TIMESTAMP(3))",
      [ids.batch, ids.returnLine, ids.admin, ids.owner, ids.admin, ids.file, ids.owner]
    );

    await connection.execute(
      "INSERT INTO inventory_movements (medicine_id, batch_id, movement_type, direction, quantity, source_type, source_id, actor_user_id, occurred_at_utc, idempotency_key) VALUES (?, ?, 'patient_return_release', 'in', 1, 'patient_return', ?, ?, UTC_TIMESTAMP(3), ?)",
      [ids.medicine, ids.batch, ids.returnLine, ids.admin, "op-return-release-" + suffix]
    );
    await connection.execute("UPDATE inventory_batches SET remaining_quantity = 7, version = version + 1 WHERE batch_id = ?", [ids.batch]);
    await connection.execute("UPDATE medicine_stock_projections SET physical_quantity = 7, sellable_quantity = 7, projected_at_utc = UTC_TIMESTAMP(3), version = version + 1 WHERE medicine_id = ?", [ids.medicine]);
    await connection.execute(
      "INSERT INTO clinic_settings (setting_key, setting_value, value_type, editable_by_admin, updated_at_utc, updated_by_user_id) VALUES ('clinic_name', 'Klinik Assalaam Palembang', 'string', 0, UTC_TIMESTAMP(3), ?)",
      [ids.owner]
    );
    await connection.execute(
      "INSERT INTO display_configs (config_key, display_mode, running_text, updated_at_utc, updated_by_user_id) VALUES ('queue-main', 'combined', 'Synthetic queue text', UTC_TIMESTAMP(3), ?)",
      [ids.admin]
    );
    await connection.execute(
      "INSERT INTO queue_audio_assets (clip_id, clip_type, object_key, mime_type, size_bytes, sha256, updated_at_utc, updated_by_user_id) VALUES (?, 'voice', ?, 'audio/mpeg', 1024, ?, UTC_TIMESTAMP(3), ?)",
      ["op-audio-" + suffix, "smoke/" + suffix + "/queue.mp3", "b".repeat(64), ids.admin]
    );
    ids.tariff = await insert(
      "INSERT INTO tariffs (public_id, name, service_type, price, created_at_utc, updated_at_utc) VALUES (?, 'Synthetic service', 'service', 5000, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      ["op-tariff-" + suffix]
    );
    ids.package = await insert(
      "INSERT INTO service_packages (public_id, name, active, created_at_utc, created_by_user_id, updated_at_utc, updated_by_user_id) VALUES (?, 'Synthetic package', 1, UTC_TIMESTAMP(3), ?, UTC_TIMESTAMP(3), ?)",
      ["op-package-" + suffix, ids.admin, ids.admin]
    );
    await connection.execute(
      "INSERT INTO package_components (package_id, component_type, medicine_id, quantity, sort_order, created_at_utc) VALUES (?, 'medicine', ?, 1, 1, UTC_TIMESTAMP(3))",
      [ids.package, ids.medicine]
    );
    ids.cancellation = await insert(
      "INSERT INTO invoice_cancellation_requests (public_id, sales_invoice_id, status, requested_by_user_id, requested_at_utc, reason) VALUES (?, ?, 'requested', ?, UTC_TIMESTAMP(3), 'Synthetic cancellation request')",
      ["op-cancel-" + suffix, ids.salesInvoice, ids.cashierA]
    );
    await connection.execute(
      "INSERT INTO invoice_cancellation_events (cancellation_request_id, event_type, old_status, new_status, actor_user_id, reason, occurred_at_utc) VALUES (?, 'requested', NULL, 'requested', ?, 'Created in smoke test', UTC_TIMESTAMP(3))",
      [ids.cancellation, ids.cashierA]
    );

    ids.lossMovement = await insert(
      "INSERT INTO inventory_movements (medicine_id, batch_id, movement_type, direction, quantity, source_type, source_id, actor_user_id, reason, occurred_at_utc, idempotency_key) VALUES (?, ?, 'loss', 'out', 1, 'loss_event', ?, ?, 'Synthetic damaged item', UTC_TIMESTAMP(3), ?)",
      [ids.medicine, ids.batch, suffix, ids.admin, "op-loss-move-" + suffix]
    );
    await connection.execute(
      "INSERT INTO loss_events (batch_id, medicine_id, loss_type, quantity, hpp_snapshot, inventory_movement_id, approved_by_user_id, approved_at_utc, evidence_file_id, reason, created_at_utc) VALUES (?, ?, 'damaged', 1, 500, ?, ?, UTC_TIMESTAMP(3), ?, 'Synthetic approved loss', UTC_TIMESTAMP(3))",
      [ids.batch, ids.medicine, ids.lossMovement, ids.owner, ids.file]
    );

    ids.period = await insert(
      "INSERT INTO accounting_periods (period_start, period_end, status) VALUES (?, ?, 'open')",
      [monthStart, monthEnd]
    );
    ids.journal = await insert(
      "INSERT INTO journal_entries (public_id, accounting_period_id, business_date, source_type, source_id, status, description, created_by_user_id, posted_by_user_id, posted_at_utc, created_at_utc) VALUES (?, ?, ?, 'smoke_sale', ?, 'posted', 'Synthetic balanced journal', ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      ["op-journal-" + suffix, ids.period, date, suffix, ids.admin, ids.owner]
    );
    await connection.execute(
      "INSERT INTO journal_lines (journal_entry_id, line_number, account_code, debit_amount, credit_amount) VALUES (?, 1, 'CASH', 2000, 0), (?, 2, 'REVENUE', 0, 2000)",
      [ids.journal, ids.journal]
    );
    await connection.execute(
      "INSERT INTO backup_jobs (public_id, status, storage_object_key, checksum_sha256, size_bytes, requested_by_user_id, started_at_utc, completed_at_utc, verified_at_utc, created_at_utc) VALUES (?, 'completed', ?, ?, 4096, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      ["op-backup-" + suffix, "smoke/" + suffix + "/backup.sql.gz", "c".repeat(64), ids.owner]
    );
    await connection.execute(
      "INSERT INTO export_jobs (public_id, export_type, date_from, date_to, status, file_id, requested_by_user_id, created_at_utc, completed_at_utc) VALUES (?, 'finance', ?, ?, 'completed', ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      ["op-export-" + suffix, monthStart, monthEnd, ids.file, ids.owner]
    );

    // Exercise the actual SQL repository methods against TiDB in this rollback-only transaction.
    const repository = createTidbInventoryRepository();
    const checkoutContext = await repository.lockCheckoutContext(connection, ids.encounter, ids.shiftA);
    if (!checkoutContext) throw new Error("Repository checkout context did not lock the synthetic encounter and shift.");
    const snapshot = await repository.buildAuthoritativeCheckoutSnapshot(connection, {
      requestedItems: [
        { medicineId: String(ids.medicine), quantity: "2" },
        { tariffId: String(ids.tariff), quantity: "1", discount: "500" }
      ]
    });
    if (snapshot.invoice.grossAmount !== "7000" || snapshot.invoice.discountAmount !== "500" || snapshot.invoice.total !== "6500") {
      throw new Error("Repository checkout price and per-service discount snapshot is incorrect.");
    }
    const checkoutInvoiceId = await repository.createInvoiceDraft(connection, {
      encounterId: ids.encounter, patientId: ids.patient, cashierUserId: ids.cashierA,
      shiftId: ids.shiftA, businessDate: date, invoiceSnapshot: snapshot.invoice
    });
    const medicine = await repository.lockMedicine(connection, ids.medicine);
    const eligibleBatches = await repository.lockEligibleBatches(connection, ids.medicine);
    if (!eligibleBatches.length) throw new Error("FEFO repository returned no eligible batch.");
    let required = 2n;
    const allocations = [];
    for (const batch of eligibleBatches) {
      if (required === 0n) break;
      const available = BigInt(batch.remainingQty);
      const take = available < required ? available : required;
      if (take === 0n) continue;
      const changed = await repository.decrementBatchBalance(connection, {
        batchId: batch.batchId, quantity: take.toString(), expectedVersion: batch.version
      });
      if (changed !== 1) throw new Error("FEFO batch optimistic update failed.");
      await repository.appendInventoryMovement(connection, {
        movementType: "sale_issue", direction: "out", medicineId: ids.medicine,
        batchId: batch.batchId, quantity: take.toString(), sourceType: "invoice",
        sourceId: checkoutInvoiceId, actorUserId: ids.cashierA, reason: "Repository smoke checkout"
      });
      allocations.push({ medicineId: ids.medicine, batchId: batch.batchId, quantity: take.toString() });
      required -= take;
    }
    if (required !== 0n) throw new Error("FEFO allocation did not satisfy the requested quantity.");
    await repository.updateMedicineStockOnly(connection, {
      medicineId: ids.medicine, stockQty: (BigInt(medicine.stockQty) - 2n).toString(),
      expectedVersion: medicine.version
    });
    await repository.insertInvoiceLines(connection, checkoutInvoiceId, snapshot.lines);
    await repository.insertSaleBatchAllocations(connection, checkoutInvoiceId, allocations);
    await repository.postInvoice(connection, checkoutInvoiceId, { total: snapshot.invoice.total });
    await repository.createReturnQuotas(connection, checkoutInvoiceId, snapshot.lines);
    await repository.markEncounterCompleted(connection, ids.encounter, checkoutInvoiceId);

    const [quotaRows] = await connection.execute(
      "SELECT return_quota_subject_id AS quotaId FROM return_quota_subjects q JOIN sales_invoice_lines l ON l.sales_invoice_line_id = q.sales_invoice_line_id WHERE l.sales_invoice_id = ? AND q.medicine_id = ?",
      [checkoutInvoiceId, ids.medicine]
    );
    if (!quotaRows[0]) throw new Error("Repository did not create medicine return quota.");
    const quota = await repository.lockReturnQuota(connection, quotaRows[0].quotaId);
    const refundAmount = (BigInt(quota.netCharge) / BigInt(quota.maximumQuantity)).toString();
    await repository.reserveReturnQuota(connection, { quotaId: quota.quotaId, quantity: "1" });
    const returnId = await repository.createSalesReturn(connection, {
      invoiceId: checkoutInvoiceId, requestedByUserId: ids.cashierA, reason: "Repository smoke return"
    });
    const returnLineId = await repository.createSalesReturnLine(connection, {
      returnId, invoiceLineId: quota.invoiceLineId, quotaId: quota.quotaId,
      quantity: "1", originalNetCharge: quota.netCharge, refundAmount, stockDisposition: "quarantine"
    });
    await repository.appendSalesReturnEvent(connection, {
      returnId, eventType: "requested", oldStatus: null, newStatus: "requested",
      actorUserId: ids.cashierA, reason: "Repository smoke return"
    });
    await repository.reviewSalesReturn(connection, {
      salesReturnId: returnId, reviewerUserId: ids.admin, status: "admin_reviewed"
    });
    await repository.approveSalesReturn(connection, {
      salesReturnId: returnId, approverUserId: ids.owner
    });
    await repository.approveReturnQuota(connection, { quotaId: quota.quotaId, quantity: "1" });
    const returnedBatchId = await repository.createPatientReturnQuarantine(connection, {
      returnLineId, medicineId: ids.medicine, sourceBatchId: allocations[0].batchId,
      quantity: "1", actorUserId: ids.owner, reason: "Repository smoke quarantine"
    });
    const inspectionId = await repository.inspectQuarantineBatch(connection, {
      batchId: returnedBatchId, decision: "release", reason: "Synthetic physical inspection",
      evidenceFileId: ids.file, actorUserId: ids.admin
    });
    const inspection = await repository.lockLatestQuarantineInspection(connection, returnedBatchId);
    if (!inspection || String(inspection.eventId) !== String(inspectionId)) throw new Error("Quarantine inspection was not visible.");
    await repository.approveQuarantineRelease(connection, {
      eventId: inspectionId, approverUserId: ids.owner, reason: "Synthetic release approval"
    });
    await repository.releaseQuarantineBatch(connection, {
      batchId: returnedBatchId, actorUserId: ids.admin
    });
    const refundObligationId = await repository.createRefundObligation(connection, {
      salesReturnId: returnId, amount: refundAmount, approvedByUserId: ids.owner
    });
    await repository.appendRefundPayout(connection, {
      obligationId: refundObligationId, amount: refundAmount,
      paidByUserId: ids.owner, eventAtUtc: Date.now(),
      idempotencyKey: "op-refund-repository-" + suffix
    });
    await repository.markRefundPaid(connection, refundObligationId, "synthetic-payout");

    const paymentSource = await repository.lockPaymentSource(connection, "invoice", checkoutInvoiceId);
    if (!paymentSource || paymentSource.outstandingAmount !== "6500") throw new Error("Invoice payment outstanding calculation failed.");
    const paymentId = await repository.appendPaymentEvent(connection, {
      sourceId: checkoutInvoiceId, paymentMethod: "qris", amount: "6500",
      paymentStatus: "settled", settlementReference: "SMOKE-" + suffix,
      eventAtUtc: Date.now(), recordedByUserId: ids.cashierA,
      idempotencyKey: "op-payment-repository-" + suffix
    });
    const pendingPayment = await repository.lockPaymentEvent(connection, paymentId);
    if (!pendingPayment || pendingPayment.reviewStatus !== "pending") throw new Error("Non-cash payment did not remain pending.");
    await repository.approvePaymentEvent(connection, { paymentId, reviewerUserId: ids.owner });

    const expenseId = await repository.createExpense(connection, {
      businessDate: date, category: "supplies", description: "Repository smoke expense",
      amount: "500", evidenceFileId: ids.file, createdByUserId: ids.admin
    });
    await repository.appendExpenseEvent(connection, {
      expenseId, eventType: "requested", actorUserId: ids.admin, reason: "Smoke expense"
    });
    const expense = await repository.lockExpense(connection, expenseId);
    if (!expense || expense.status !== "requested") throw new Error("Expense request was not stored.");
    await repository.approveExpense(connection, { expenseId, approverUserId: ids.owner });
    await repository.appendExpenseEvent(connection, {
      expenseId, eventType: "approved", actorUserId: ids.owner, reason: "Smoke approval"
    });

    const supplierPayable = await repository.lockSupplierPayable(connection, ids.invoice);
    if (!supplierPayable || BigInt(supplierPayable.outstandingAmount) <= 0n) throw new Error("Supplier payable calculation failed.");
    const supplierPaymentId = await repository.appendSupplierPayment(connection, {
      payableId: ids.invoice, businessDate: date, amount: "500",
      paymentMethod: "transfer", evidenceFileId: ids.file,
      settlementReference: "SMOKE-SUP-" + suffix, recordedByUserId: ids.admin,
      idempotencyKey: "op-supplier-repo-" + suffix
    });
    await repository.applySupplierPaymentAllocation(connection, {
      paymentId: supplierPaymentId, payableId: ids.invoice, amount: "500"
    });

    const journalId = await repository.createJournal(connection, {
      businessDate: date, sourceType: "repository_smoke", sourceId: suffix,
      description: "Repository smoke journal", postedByUserId: ids.owner
    });
    await repository.insertJournalLines(connection, journalId, [
      { accountId: "CASH", side: "debit", amount: "500" },
      { accountId: "REVENUE", side: "credit", amount: "500" }
    ]);

    const [batchRows] = await connection.execute(
      "SELECT batch_id AS batchId, remaining_quantity AS remainingQuantity FROM inventory_batches WHERE remaining_quantity > 0 ORDER BY batch_id"
    );
    const stocktakeLines = batchRows.map((row, index) => ({
      batchId: String(row.batchId),
      countedQuantity: (BigInt(String(row.remainingQuantity)) + (index === 0 ? 1n : 0n)).toString(),
      reason: index === 0 ? "Synthetic count variance" : ""
    }));
    const stocktakeId = await repository.createStocktake(connection, {
      stocktakeDate: "2026-12-01", lines: stocktakeLines, countedByUserId: ids.admin
    });
    const stocktake = await repository.lockStocktake(connection, stocktakeId);
    for (const line of stocktake.lines) {
      if (BigInt(line.varianceQuantity) !== 0n) await repository.applyStocktakeVariance(connection, {
        stocktakeId, line, actorUserId: ids.owner
      });
    }
    await repository.approveStocktake(connection, {
      stocktakeId, approverUserId: ids.owner, reason: "Synthetic stocktake approval"
    });

    const shift = await repository.lockShiftForClose(connection, ids.shiftB);
    const reconciliationId = await repository.closeShift(connection, {
      shiftId: ids.shiftB, expectedCash: shift.expectedCash, countedCash: shift.expectedCash,
      varianceAmount: "0", varianceReason: null, closedByUserId: ids.cashierB
    });
    const shiftToVerify = await repository.lockShiftForVerification(connection, ids.shiftB);
    if (!shiftToVerify || shiftToVerify.status !== "closed_pending_verification") throw new Error("Shift did not enter verification state.");
    await repository.verifyShift(connection, { shiftId: ids.shiftB, verifierUserId: ids.admin });
    if (!reconciliationId) throw new Error("Shift reconciliation was not created.");

    const [counts] = await connection.query(
      "SELECT (SELECT COUNT(*) FROM queue_transfer_events WHERE queue_ticket_id = ?) AS transfers, " +
      "(SELECT COUNT(*) FROM inventory_movements WHERE batch_id = ?) AS movements, " +
      "(SELECT COUNT(*) FROM sales_return_lines WHERE sales_return_id = ?) AS returns, " +
      "(SELECT COUNT(*) FROM supplier_payment_allocations WHERE supplier_payment_id = ?) AS supplier_allocations",
      [ids.ticket, ids.batch, ids.salesReturn, ids.supplierPayment]
    );
    if (Number(counts[0].transfers) !== 1 || Number(counts[0].movements) !== 5 ||
        Number(counts[0].returns) !== 1 || Number(counts[0].supplier_allocations) !== 1) {
      throw new Error("Operational synthetic transaction did not persist all expected domain records.");
    }

    return {
      ok: true,
      synthetic: true,
      tablesExercised: 60,
      repositorySmoke: true,
      checks: ["patient_encounter_queue_transfer", "queue_call_guard", "purchase_receipt_and_batch_hpp", "fefo_checkout_and_service_discount", "return_quota_and_pimpinan_approval", "quarantine_inspection_release", "separate_refund_transfer", "noncash_payment_review", "expense_approval", "supplier_partial_payment", "balanced_journal", "monthly_stocktake_optimistic_version", "shift_cash_reconciliation", "backup_export", "rollback"]
    };
  } catch (error) {
    failure = error;
  } finally {
    if (started) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        const cleanup = new Error("Operational TiDB smoke-test rollback failed.");
        cleanup.code = "TIDB_OPERATIONAL_SMOKE_CLEANUP_FAILED";
        cleanup.originalErrorCode = failure && failure.code ? failure.code : null;
        cleanup.rollbackErrorCode = rollbackError && rollbackError.code ? rollbackError.code : "ROLLBACK_FAILED";
        throw cleanup;
      }
    }
  }
  if (failure) throw failure;
}

module.exports = { runOperationalSmokeTest };
