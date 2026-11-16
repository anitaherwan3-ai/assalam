# Financial Calculations, Exports & Manual Backup — Source Audit (Pass 54)

**Branch:** `migration/tidb-foundation`  
**Review method:** repository source inspection only  
**Files inspected:** `js/app.js`, `js/export-helper.js`, `js/store.js`, `js/firebase-backend.js`  
**Status:** source findings and migration requirements; not financial-data reconciliation  
**Safety:** no live Firebase records read, no restore/export of clinic data, no Firebase/production mutation

## 1. Confirmed financial calculation behavior

### Revenue, returns and cost of goods sold

The existing `calculateFinancials()` function:

1. Starts with active, non-cancelled invoices in the selected date/method/cashier filter.
2. Uses invoice `total` as the final charged amount after discount; it does not subtract discount again.
3. Subtracts approved return value once, using approval timestamp in Asia/Jakarta (falling back to legacy return date).
4. Separates return value into medicine/package and service/fee components. Service return does not reduce medicine HPP.
5. Reduces COGS by the return's stored `hpp × qty` for medicine/package returns.
6. Separately records refund paid on its actual payout date; pending refund obligations are not treated as paid cash.
7. Includes approved legacy returns without modern refund metadata in revenue reduction and displays them separately for reconciliation.

This is the compatibility baseline to preserve in the target. TiDB must store sale-time price, discount, quantity, package components and HPP snapshots and derive returns from the original invoice. New reports must not re-price historical sales from the current master catalog.

### Operating costs and cash

| Existing calculation | Current source rule | Migration treatment |
|---|---|---|
| Operating profit | Net revenue − COGS − loss − approved expenses − petty cash | Keep components visible; finalize D09 classification before finance schema freeze |
| Cash drawer at shift close | Opening float + cash invoices − petty cash for that shift | Preserve opening float as custody, not revenue; add explicit cash movement allocation |
| Total cash-in-hand projection | Sum of opening floats + cash invoices − cash refunds paid − petty cash | Reconcile against physical cash accounts; do not treat repeated opening floats as income |
| Cash-flow total receipts | All active invoice totals, including non-cash methods | Replace with payment/settlement events; a QRIS/transfer invoice is not automatically a settled bank receipt |
| Supplier cash outflow | Full purchase total when `lunas=true`, dated by `tglBayar` or purchase date | Replace with actual payment events and allocations; do not fabricate partial payments |
| Expense cash outflow | All approved expenses in the period | Separate approval from actual disbursement/payment date |
| Return cash outflow | Refunds with `pengembalian.status='dibayar'`, by actual paid date | Preserve approval-versus-payout distinction and link payout to cash/bank account |

### Important open accounting gates

- **D09:** petty-cash categories, advances/reimbursements and when an outflow becomes an expense. Current P&L treats all petty cash as expense.
- **D12/D13:** who verifies shifts, and the approved cash/bank source plus evidence for refund payout.
- **D14:** recognition/settlement date for QRIS, transfer and other non-cash methods.
- **D11:** supplier payment model. Existing `lunas` is only a boolean/date and contains no amount, payment method, reference or allocations.
- Shift cash formula currently excludes cash refund payouts and supplier/operating payments from the cashier drawer calculation. The new cash ledger must explicitly assign each movement to a cashier drawer, management cash account or bank account; otherwise shift differences cannot be reliably reconciled.
- Current calculations use JavaScript `Number()` for Rupiah and quantities. TiDB services and API transport must use integer Rupiah with BigInt/string-safe arithmetic and explicit quantity precision.

## 2. Date and filtering behavior

- `reportDateFromTimestamp()` correctly formats return approval/payment timestamps using `Asia/Jakarta`.
- Many other reports filter by `tgl` string. The legacy purchase and batch/expiry utilities contain separate UTC-date logic; those paths need a single business-date rule in the target.
- The manual export's Log Aktivitas branch does not apply the selected date range.
- Current export of transaction rows reads all invoices in range, including cancelled invoices, and does not include a cancellation status column. The export must either identify cancelled/reversed notes explicitly or expose a separate voided-invoice report.
- Stock and expiry exports describe current master/batch balances; they are not historical stock snapshots for the selected period.

## 3. CSV/PDF export surface

The Settings/Export UI exposes CSV and PDF reports for:
- transactions;
- package masters;
- patient visits;
- supplier purchases;
- expenses;
- petty cash;
- current medicine stock;
- current batch/expiry state;
- activity log.

Source findings:
- Patient export includes patient name and phone number. MySQL export endpoints must enforce role/resource access and minimize PII.
- Export is performed from the browser's current `store.state`; there is no server-side snapshot identifier, completeness marker, audit record, checksum or permission check inside `ExportHelper`.
- CSV uses quoted cells and UTF-8 BOM. PDF is client-generated from the same browser state.
- Report filtering is not consistent across report types (notably logs/current stock/current expiry).

Target requirements:
1. Server-side export command derives role and allowed report columns; hidden tabs are not an authorization boundary.
2. Record export actor, report, period, filters, row count, generated timestamp and artifact checksum.
3. Label current-state exports separately from period ledger reports.
4. Include reversal/cancellation status and net values without deleting original audit rows.
5. Patient PII is excluded unless the actor has explicit access and a business need.
6. Use immutable server-side snapshot or a transactionally consistent report query; do not trust a possibly stale browser cache.

## 4. Manual JSON backup and restore — critical distinction

The current `ExportHelper.downloadBackup()` serializes the entire browser `store.state` object to JSON, including all loaded clinic collections and settings. It is not a server/database backup and it is not a Firestore collection export guaranteed to be complete.

The current `restoreBackup(file)` behavior:
- reads a browser-selected JSON file;
- checks only that `data.obat` and `data.users` are truthy;
- asks for confirmation;
- replaces the entire in-memory `store.state` with the file data;
- calls `store.saveLocal(true)`, which writes LocalStorage and triggers the normal Firebase push path.

Risks for migration:
- no backup schema/version, project identity, checksum, signature or completeness validation;
- no dry-run preview, conflict report or row-level reconciliation;
- older/incomplete JSON can replace newer local state;
- restore invokes the normal Firebase synchronization path and can write permitted collections back to Firebase;
- it does not provide a safe mechanism to preserve protected accounts, verify UID bindings or prove that the file matches the intended Firebase project;
- browser cache may be stale or partially synchronized at the time the file is downloaded.

**Operational rule:** do not use this browser JSON restore as the Firebase→TiDB migration tool, as a TiDB restore procedure, or as proof of a complete backup. Keep it as a legacy manual convenience only. Do not disable or rewrite the existing production restore flow in this audit; a separate backup/restore package needs its own regression and rollback plan.

## 5. Required TiDB reporting/backup design

- Append-only cash/bank ledger with source event, payment method, settlement date, business date, actor, account/drawer and reversal reference.
- Separate invoice/payment, supplier payable/payment allocation, expense approval/disbursement, return/refund obligation/payout and shift close/verification events.
- A period reconciliation report that explains each line back to source invoice/ledger IDs.
- Versioned database backup with encryption, checksum, retention, access audit, isolated restore drill and protected identity safeguards.
- Import archive stores raw source JSON/Firestore document IDs separately from normalized records; transform only after checksums and source counts are captured.
- Dry-run import emits duplicate, orphan, malformed timestamp, missing batch lineage, financial total and row-count discrepancy reports before any production write.
- Restore must be previewable and non-destructive by default; never overwrite protected accounts or append-only finance/inventory history.

## 6. Disposition

- Existing financial formulas are source-characterized, not reconciled against live clinic ledgers.
- Current CSV/PDF exports are browser-state reports, not authoritative financial statements.
- Browser JSON restore is destructive to local state and triggers Firebase sync; it is not a safe data migration path.
- Continue to keep Firebase as production source of truth. No production financial policy, patient data, Firebase/Auth records or database rows were changed by this audit.
