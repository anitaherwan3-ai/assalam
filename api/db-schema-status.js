"use strict";

const { getPool } = require("../lib/tidb");

const expected = [
  "users", "role_assignments", "active_role_slots", "firebase_identities",
  "audit_events", "idempotency_requests", "outbox_jobs", "tariffs", "suppliers",
  "user", "session", "account", "verification",
  "cashier_shifts", "active_shift_slots", "patients", "patient_encounters", "queue_counters",
  "cashier_queue_assignments", "queue_tickets", "queue_call_guards", "queue_call_events",
  "queue_transfer_events", "queue_display_configs",
  "medicines", "supplier_invoices", "supplier_invoice_lines", "purchase_receipts", "purchase_receipt_lines",
  "inventory_batches", "inventory_movements", "medicine_stock_projections", "stocktakes", "stocktake_lines",
  "sales_invoices", "sales_invoice_lines", "sales_batch_allocations", "invoice_payments", "return_quota_subjects",
  "sales_returns", "sales_return_lines", "sales_return_events", "refund_obligations", "refund_payments",
  "stored_files", "shift_reconciliations", "cash_accounts", "cash_ledger_entries", "bank_accounts", "bank_ledger_entries",
  "expenses", "expense_events", "supplier_returns", "supplier_return_lines", "supplier_credit_notes",
  "supplier_payments", "supplier_payment_allocations", "inventory_quarantine_events"
];

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
  }
  try {
    const [versions] = await getPool().execute(
      "SELECT version, applied_at_utc FROM schema_migrations ORDER BY version"
    );
    const placeholders = expected.map(() => "?").join(", ");
    const [tables] = await getPool().execute(
      "SELECT TABLE_NAME AS table_name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (" + placeholders + ")",
      expected
    );
    const found = tables.map(row => row.table_name).sort();
    const missing = expected.filter(name => !found.includes(name));
    return res.status(missing.length ? 503 : 200).json({
      ok: missing.length === 0,
      service: "assalam-tidb-schema",
      versions: versions.map(row => row.version),
      tables: found,
      missing
    });
  } catch (error) {
    console.error("[DB-SCHEMA-STATUS] Schema status unavailable", {
      code: error && error.code ? error.code : "UNKNOWN"
    });
    return res.status(503).json({ ok: false, code: "SCHEMA_STATUS_UNAVAILABLE" });
  }
};
