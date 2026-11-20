"use strict";

const { getPool } = require("../lib/tidb");

const expected = [
  "users", "role_assignments", "active_role_slots", "firebase_identities",
  "audit_events", "idempotency_requests", "outbox_jobs", "tariffs", "suppliers",
  "user", "session", "account", "verification", "rateLimit",
  "cashier_shifts", "active_shift_slots", "patients", "patient_encounters", "queue_counters",
  "cashier_queue_assignments", "queue_tickets", "queue_call_guards", "queue_call_events",
  "queue_transfer_events",
  "medicines", "supplier_invoices", "supplier_invoice_lines", "purchase_receipts", "purchase_receipt_lines",
  "inventory_batches", "inventory_movements", "medicine_stock_projections", "stocktakes", "stocktake_lines",
  "sales_invoices", "sales_invoice_lines", "sales_batch_allocations", "invoice_payments", "return_quota_subjects",
  "sales_returns", "sales_return_lines", "sales_return_events", "refund_obligations", "refund_payments",
  "stored_files", "shift_reconciliations", "cash_accounts", "cash_ledger_entries", "bank_accounts", "bank_ledger_entries",
  "expenses", "expense_events", "supplier_returns", "supplier_return_lines", "supplier_credit_notes",
  "supplier_payments", "supplier_payment_allocations", "inventory_quarantine_events",
  "clinic_settings", "display_configs", "queue_audio_assets", "service_packages", "package_components",
  "invoice_cancellation_requests", "invoice_cancellation_events", "loss_events", "accounting_periods",
  "journal_entries", "journal_lines", "backup_jobs", "export_jobs"
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
    const [statusColumns] = await getPool().execute(
      "SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, CHARACTER_MAXIMUM_LENGTH AS max_length FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND ((TABLE_NAME = ? AND COLUMN_NAME = ?) OR (TABLE_NAME = ? AND COLUMN_NAME = ?))",
      ["cashier_shifts", "status", "shift_reconciliations", "status"]
    );
    const [packagePriceColumns] = await getPool().execute(
      "SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND ((TABLE_NAME = ? AND COLUMN_NAME = ?) OR (TABLE_NAME = ? AND COLUMN_NAME = ?) OR (TABLE_NAME = ? AND COLUMN_NAME = ?))",
      ["service_packages", "package_price", "package_components", "component_price_snapshot", "package_components", "component_name_snapshot"]
    );
    const requiredPackagePriceColumns = ["service_packages.package_price", "package_components.component_price_snapshot", "package_components.component_name_snapshot"];
    const foundPackagePriceColumns = new Set(packagePriceColumns.map(row => row.table_name + "." + row.column_name));
    const missingPackagePriceColumns = requiredPackagePriceColumns.filter(name => !foundPackagePriceColumns.has(name));
    const shortStatusColumns = statusColumns.filter(row => Number(row.max_length) < 32).map(row => ({ table: row.table_name, column: row.column_name, maxLength: Number(row.max_length) }));
    const statusColumnsMissing = ["cashier_shifts", "shift_reconciliations"].filter(name => !statusColumns.some(row => row.table_name === name && row.column_name === "status"));
    return res.status(missing.length || shortStatusColumns.length || statusColumnsMissing.length ? 503 : 200).json({
      ok: missing.length === 0 && shortStatusColumns.length === 0 && statusColumnsMissing.length === 0 && missingPackagePriceColumns.length === 0,
      service: "assalam-tidb-schema",
      versions: versions.map(row => row.version),
      tables: found,
      missing,
      statusColumns: statusColumns.map(row => ({ table: row.table_name, column: row.column_name, maxLength: Number(row.max_length) })),
      shortStatusColumns,
      statusColumnsMissing,
      requiredPackagePriceColumns,
      missingPackagePriceColumns
    });
  } catch (error) {
    console.error("[DB-SCHEMA-STATUS] Schema status unavailable", {
      code: error && error.code ? error.code : "UNKNOWN"
    });
    return res.status(503).json({ ok: false, code: "SCHEMA_STATUS_UNAVAILABLE" });
  }
};
