# MYSQL MIGRATION — SCREEN-BY-SCREEN APPLICATION UI AND WORKFLOW SPECIFICATION

Date: 2026-11-15
Source baseline: GitHub branch `main` (read-only)
Target work branch: `migration/tidb-foundation`
Purpose: make the MySQL migration blueprint traceable to the actual visible application, its tabs, forms, buttons, tables, user roles, and resulting business actions.

## 0. Source baseline and interpretation

Inspected source fingerprints:
- `index.html`: `7f9fbbb202c0fd346eb40b3e93d01c9427bdfad2` (176 lines)
- `js/app.js`: `f74c4710161ddd2af230e51c18b1f107d6c52c82` (4,872 lines)
- `js/store.js`: `99e74acf8caec9c70d82be1d5f6efc5bfa6bc4fb` (552 lines)
- `js/firebase-backend.js`: `3a613d96564f120b8141966f9ecbae21471c4e65` (1,436 lines)
- `display.html`: `798e11e37cef1498bbc361b4c76474a85a71a9ca` (1,250 lines)

This is a source/UI inventory, not a live-browser acceptance test. It documents what the checked-in source renders and calls. A visible menu does not by itself prove that every operation is safe or authorized in the cloud. The target design must preserve the user-facing workflow while moving authorization and invariants to the server.

### Important UI distinction

The checked-in `main` role navigation is:
- Kasir: Shift, Pasien, Transaksi, Riwayat Transaksi, Kas Kecil.
- Admin: Obat & Tarif, Paket Pelayanan, Pembelian, Kedaluwarsa, Biaya, Stok Opname, Kartu Stok, Riwayat Transaksi, Verifikasi, Display TV, Ekspor.
- Pimpinan: Dashboard, Data Pasien, Stok Obat, Kartu Stok, Laba Rugi, Arus Kas, Utang, Approval, Pengawasan Retur, Paket Pelayanan, Display TV, Ekspor, Log Aktivitas, Pengguna, Pengaturan.

Kasir2 is not a separate role string in the inspected navigation; it is a cashier profile with a distinct stable user ID/assignment. PR13 adds A/B queue/handoff changes but is open and unmerged. Do not silently treat PR13 UI as current main behavior.

## 1. Shared application shell

### Visible elements (index.html)
- Header clinic brand/logo and fixed title display.
- Header button to open the TV queue display.
- Sync status badge.
- Signed-in user name and role.
- Logout button.
- Dynamic role navigation bar and main content area.
- Login modal: email, password, sign-in and password reset.
- Shared alert, confirmation, form, receipt, medicine-label and shift-close modals.
- Receipt modal supports print, WhatsApp composer action, and medicine-label action.
- Separate TV display window can be opened from the app.

### Target behavior
- Login/session status and role are server-verified; UI role filtering is only presentation.
- Header sync status distinguishes connected, offline, pending, failed and last successful sync. Never show “synced” merely because local state saved.
- Logout must safely handle unsaved/pending operations. PR13 logout guard/handoff is not part of main until separately adopted.
- Keep printable receipt and label layouts; API response should return immutable snapshots, not rebuild historical documents from current master prices.
- WhatsApp currently opens a prefilled `wa.me` composer; user still presses Send. Do not represent this as an automatic message delivery.

## 2. Role navigation matrix (current main)

| Visible tab | Kasir | Admin | Pimpinan | Primary screen purpose |
|---|---:|---:|---:|---|
| Shift | Yes | No | No | Open/close own cashier shift |
| Pasien | Yes | No | No | Register and manage daily queue |
| Transaksi | Yes | No | No | POS checkout |
| Kas Kecil | Yes | No | No | Record shift petty cash |
| Obat & Tarif | No | Yes | No | Medicine and service master |
| Paket Pelayanan | No | Yes | Yes | Package builder and catalog |
| Pembelian | No | Yes | No | Supplier invoice, batch and payable |
| Kedaluwarsa | No | Yes | No | FEFO and expired batch oversight |
| Biaya | No | Yes | No | Operational expense entry |
| Stok Opname | No | Yes | No | Loss/damage/stock variance |
| Kartu Stok | No | Yes | Yes | Medicine movement history |
| Riwayat Transaksi | Yes | Yes | No | Sales, cancellation and returns |
| Verifikasi | No | Yes | No | Shift deposit verification |
| Display TV | No | Yes | Yes | TV video, running text and audio assets |
| Ekspor | No | Yes | Yes | CSV/PDF reports |
| Dashboard | No | No | Yes | KPI and management alerts |
| Data Pasien | No | No | Yes | Read-only patient list and archive |
| Stok Obat | No | No | Yes | Read-only aggregate and batch status |
| Laba Rugi | No | No | Yes | Profit/loss report |
| Arus Kas | No | No | Yes | Cash receipts and outflows |
| Utang | No | No | Yes | Supplier invoice balances |
| Approval | No | No | Yes | Expense approvals |
| Pengawasan Retur | No | No | Yes | Final return decision and refund payout |
| Log Aktivitas | No | No | Yes | Audit activity search |
| Pengguna | No | No | Yes | Staff profiles and access |
| Pengaturan | No | No | Yes | Clinic, UI, thresholds, cloud and backup settings |

Note: current UI exposes only the above tabs in `ROLE_TABS`. A route/API may still need to exist for a workflow initiated elsewhere. Do not invent additional visible menus during migration.

## 3. Screen-by-screen specification

Each screen below records visible interaction, business effect, target command/API, authorization and important invariants. Endpoint names are proposed target names, not existing deployed endpoints.

### 3.1 Login and password reset

Visible: email and password fields, Masuk, Lupa password, header identity/role.

Read/write:
- Auth provider verifies credentials.
- Backend resolves stable user ID, active status, role, cashier assignment and permissions.
- Password reset initiates provider workflow; never store passwords in TiDB.

Proposed API:
- `POST /api/auth/session` (if using backend session) or verified Firebase ID token exchange.
- `POST /api/auth/password-reset` (delegates to auth provider).
- `GET /api/me`.

Rules:
- Never trust role/email/user ID sent in request body.
- Disabled staff cannot continue by relying on cached local profile.
- Stable user ID survives future email change; email is a mutable login attribute.
- Preserve both Pimpinan identities and master Pimpinan account during provisioning, restore and migration.

### 3.2 Shift (Kasir)

Visible:
- Open shift form: opening cash/modal.
- Close shift form: physical cash count.
- Shift history table: date, open/close times, opening modal, system cash, physical cash, difference, verification status.
- Slip print, WhatsApp recap/re-send and copy report text.

Business effect:
- Opening creates one active shift for the cashier.
- Closing calculates system cash and stores physical count and difference.
- Admin later verifies the closed shift.
- Opening modal is part of cash-on-hand reconciliation, not omzet.

Proposed API:
- `POST /api/shifts/open`
- `POST /api/shifts/{id}/close`
- `POST /api/shifts/{id}/verify`
- `GET /api/shifts?from=&to=&cashierId=`
- `GET /api/shifts/{id}/receipt`

Server invariants:
- One open shift per cashier, enforced by database constraint/locking.
- Checkout, petty cash and shift close serialize against the same shift.
- Expected cash is calculated from immutable cash ledger entries, not client calculation.
- Physical count is an input; system amount and difference are server-derived.
- Verification stores verifier ID, role, timestamp and optional note.
- Closed/verified shifts cannot be edited destructively; corrections use audited adjustment.
- WhatsApp action opens composer only unless a future delivery provider is explicitly implemented.

### 3.3 Pasien and queue (Kasir)

Visible:
- Search existing/old patient by name or phone.
- New patient: name, phone, service, register queue button.
- Today's queue table: queue number, time, name, phone, service, status, actions.
- Statuses include waiting, called, done/paid and Batal Berobat.
- Actions include call, edit, Batal Berobat, restore where applicable.
- Open TV display button.
- Export patient PDF by shift.

Proposed API:
- `GET /api/patients/search?q=&page=`
- `POST /api/visits/register` (patient match/create + encounter + queue allocation)
- `PATCH /api/visits/{id}` (limited editable fields)
- `POST /api/visits/{id}/call`
- `POST /api/visits/{id}/cancel-visit`
- `POST /api/visits/{id}/restore` (only if allowed by lifecycle)
- `GET /api/queues/today?prefix=&status=`
- `GET /api/reports/patients/shift.pdf`

Invariants:
- Queue number assigned server-side, unique by clinic/date/prefix.
- Patient identity and visit/encounter must be separate; repeat visit must not overwrite old patient identity.
- Kasir/shift/queue prefix derived from authenticated profile assignment.
- Batal Berobat is not the same as invoice cancellation or patient archive.
- A visit cannot be marked complete without the intended checkout/business rule.
- Search response minimizes PII; no broad patient collection download.
- Queue call state and display event must sync across devices, with idempotent call event IDs.
- PR13 A/B/handoff behavior stays pending adoption; design must support configurable queue assignment without hard-coding email.

### 3.4 Transaksi (POS / Kasir)

Visible:
- Patient selector (waiting patients should not appear as eligible checkout target).
- Search/filter chips for Semua, Jasa, Obat, Paket.
- Service selector and add button.
- Medicine selector, quantity and add button.
- Package selector and add button.
- Cart lines, quantity adjustment, remove, clear.
- Payment methods: Tunai, QRIS, Transfer, Debit/Kredit.
- Cash received presets and calculated change.
- Pay/checkout button; transaction history preview and receipt.

Proposed API:
- `GET /api/pos/catalog?q=&type=`
- `GET /api/pos/eligible-visits`
- `POST /api/transactions/checkout`
- `GET /api/transactions/{id}/receipt`

Checkout payload may include selected visit, cart item IDs/types/quantities, payment method and amount tendered. It must NOT be trusted for prices, discounts, HPP, stock balance, batch deduction, cashier ID, shift ID, totals or patient completion.

Server transaction must:
1. Verify active cashier and active shift.
2. Lock visit, medicine, package, batch and queue/quota rows as needed.
3. Re-read authoritative master prices and package components.
4. Derive FEFO eligible batches using WIB business date and expiry rule.
5. Verify stock and batch allocation exactly.
6. Recompute discounts and exact rupiah amounts.
7. Validate payment method and amount tendered; compute change.
8. Generate unique invoice ID/number under concurrency.
9. Create immutable invoice header and item/component/batch snapshots.
10. Create inventory movement and cash/bank ledger rows.
11. Mark visit done according to approved workflow.
12. Create return quota rows for every invoice line.
13. Write audit event and idempotency result.
All changes commit or roll back together.

Historical invoice UI must show the exact sold name, quantity, price, discount allocation, HPP snapshot, batch deductions and payment at the time of sale.

### 3.5 Riwayat Transaksi

Visible:
- Shared date/payment/cashier filters.
- All sales table: date, invoice number, patient, cashier, payment method, total, invoice status and actions.
- View/print receipt.
- Print medicine label when invoice contains medicine.
- Cashier may request return or invoice cancellation for eligible invoice.
- Admin sees cancellation requests and can approve/reject.
- Return history table with item, qty, amount, reason, cashier, return status, decision and refund status.

Proposed API:
- `GET /api/transactions?from=&to=&method=&cashierId=&page=`
- `GET /api/cancellations?status=`
- `POST /api/transactions/{id}/cancellation-requests`
- `POST /api/cancellations/{id}/decision`
- `GET /api/returns?status=&from=&to=`
- `POST /api/returns`
- `POST /api/returns/{id}/admin-review`
- `POST /api/returns/{id}/final-decision`
- `POST /api/returns/{id}/refund-payment`

Rules:
- Cashier sees only allowed transaction scope, Admin/Pimpinan scope per policy.
- A cancelled invoice cannot accept new returns.
- Return and cancellation must lock the same invoice and quota records.
- No over-return; previous pending/approved quantities reserve the available return quantity; rejected proposals release quota.
- Medicine/package return restores exact original batch allocation only at final Pimpinan approval.
- Service return changes financial amount but never medicine stock.
- Refund payment is separate from return approval; payment method/reference and payer/time are recorded; duplicate payout rejected.
- Existing legacy approved returns without refund records are flagged for reconciliation, not silently treated as paid.
- Nota/receipt must clearly show cancellation/return status and amount returned.

### 3.6 Kas Kecil (Kasir)

Visible:
- Date range filters.
- Add petty cash: description and amount.
- List: date, cashier, description, amount, edit/delete actions in current UI.

Proposed API:
- `GET /api/cash-entries?type=petty&shiftId=&from=&to=`
- `POST /api/shifts/{id}/petty-cash`
- `POST /api/cash-entries/{id}/reversal`

Target change:
- Preserve simple user workflow but replace destructive edit/delete with reversal + replacement.
- Require active shift for cashier petty cash.
- Store actor, shift, reason, timestamp, original reference and ledger effect.
- Cash-on-hand reconciliation includes approved cash petty entries; financial expense recognition is a separate classification decision to avoid double-counting.

### 3.7 Obat & Tarif (Admin)

Visible:
- Medicine master form: name, unit, HPP, selling price, minimum stock.
- Medicine table: name, unit, HPP, selling price, current stock, edit/delete.
- Service tariff form: name, type/category, price.
- Service tariff table with edit/delete.

Proposed API:
- `GET/POST/PATCH /api/medicines`
- `GET/POST/PATCH /api/service-tariffs`
- `POST /api/inventory/adjustments` (separate from editing medicine metadata)

Invariants:
- Medicine master metadata edit cannot directly overwrite stock or HPP without a reasoned adjustment command.
- HPP is computed from receiving/return/cost policy and must be historically snapshotted on invoice line.
- Deleting master with historical references should deactivate/archive, not cascade-delete sales history.
- Validate nonnegative integer rupiah and quantity units.
- Keep the UI's separation between medicine and service tariffs.

### 3.8 Paket Pelayanan (Admin and Pimpinan)

Visible:
- Create/edit package name, description, package price.
- Add component selector with type (service or medicine), item and quantity.
- Staged component list, remove component, summary of normal price vs package price/savings.
- Package list with component items, normal total, package price, savings, edit/delete.

Proposed API:
- `GET/POST/PATCH /api/service-packages`
- `POST /api/service-packages/{id}/deactivate`

Invariants:
- Package version and components are immutable snapshots on invoice.
- Medicine components create FEFO batch deductions; service components do not.
- Define and test nested package policy; do not assume recursion is supported.
- Package HPP is derived from medicine component HPP and approved service-cost policy, then snapshotted.
- Editing package does not alter historical receipts, HPP or return calculation.

### 3.9 Pembelian (Admin)

Visible:
- Purchase form: supplier, invoice number, medicine, quantity, total purchase value, batch number, expiry date, due date, paid/unpaid selector.
- Purchase invoice history: date, supplier, invoice, medicine, qty, payable, due date, payment status, settle and supplier-return actions.
- Supplier return history: date, supplier, invoice, medicine, qty, credit value, reason.

Proposed API:
- `GET/POST /api/purchases`
- `POST /api/purchases/{id}/receive`
- `POST /api/purchases/{id}/payments`
- `POST /api/purchases/{id}/supplier-returns`
- `GET /api/supplier-credits`

Invariants:
- Receiving invoice creates a batch and inventory movement atomically.
- Weighted-average HPP formula and rounding must be specified and regression-tested.
- Purchase original qty/value must be immutable; returns and payments are separate rows.
- Supplier return identifies exact originating batch and rejects excess quantity; never silently caps.
- Paid invoice return creates supplier credit/receivable; unpaid invoice return reduces payable through explicit credit.
- Partial payments, payment methods, transfer references and credit application require an explicit policy; old boolean `lunas` is insufficient.
- Duplicate supplier invoice handling must be defined (supplier + invoice number uniqueness policy).

### 3.10 Kedaluwarsa (Admin)

Visible:
- Active batches sorted by expiry.
- Medicine, batch number, expiry date, remaining physical stock and status.
- Warning horizon from settings (default 60 days in source).
- “Buang Semua Batch yang Kedaluwarsa” action creates loss records and decreases medicine/batch stock.

Proposed API:
- `GET /api/inventory/expiry?asOf=`
- `POST /api/inventory/expired-disposals`

Invariants:
- Use Asia/Jakarta clinic business date, not UTC date.
- Server validates batch is expired and remaining qty is still available at commit.
- Bulk disposal is previewed, counted, confirmed and atomic or safely resumable.
- Each disposal creates stock movement, loss record and financial effect once.
- Expiry warning threshold is configurable but does not change actual expiry eligibility.

### 3.11 Biaya (Admin)

Visible:
- Expense category selector: doctor honor, staff salary, utilities, internet, rent, equipment/maintenance, cleaning/security, other.
- Description, unit amount, quantity.
- Expense list with total and status (approved/pending/rejected), edit/delete.
- Threshold shown; current default Rp1,000,000; amount >= threshold becomes pending.

Proposed API:
- `GET/POST /api/expenses`
- `POST /api/expenses/{id}/approval`
- `POST /api/expenses/{id}/reversal`

Invariants:
- Server calculates total and approval threshold.
- Admin creates; Pimpinan approves/rejects based on final policy.
- Record approver, role, timestamp, reason.
- Approved expense is not physically edited/deleted; reversal + replacement.
- If editing pending amount crosses threshold, approval state is recalculated with audit.
- Clarify whether low-value expenses are auto-approved and by whom.

### 3.12 Stok Opname (Admin)

Visible:
- Select active batch, quantity, loss reason (damaged, stock variance, expired, other).
- Add loss action.
- Loss history with medicine, qty, cause, value and cancel action.

Proposed API:
- `GET /api/inventory/batches?available=true`
- `POST /api/inventory/losses`
- `POST /api/inventory/losses/{id}/reversal`

Invariants:
- Quantity must not exceed selected batch remaining.
- Server derives medicine and batch owner; client cannot choose mismatched medicine.
- Loss value uses defined HPP snapshot.
- Cancel action becomes audited reversal, not delete/stock increase without trace.
- Aggregate stock must equal sum of batch balances under a controlled reconciliation rule.

### 3.13 Kartu Stok (Admin and Pimpinan)

Visible:
- Medicine selector.
- Export CSV.
- Movement ledger table showing chronology and balances (source reconstructs from multiple arrays).

Proposed API:
- `GET /api/inventory/medicines/{id}/ledger?from=&to=&page=`
- `GET /api/inventory/medicines/{id}/ledger.csv`

Invariants:
- Ledger is authoritative append-only movement record, not reconstructed by guessing from current state.
- Each movement references source command, invoice/purchase/loss/return/adjustment, batch and actor.
- Opening balance is explicit migration snapshot with provenance.
- Running balance deterministic; reversed entries remain visible.
- Aggregate stock and sum of batch stock reconciled; discrepancy is an alert, not silently hidden.

### 3.14 Verifikasi (Admin)

Visible:
- Pending closed shifts with cashier, shift times, system cash, physical cash, difference.
- Verify & Terima action.
- Verified shift history with verifier, WhatsApp action.

Proposed API:
- `GET /api/shifts?status=closed-unverified`
- `POST /api/shifts/{id}/verification`

Invariants:
- Only authorized Admin may verify under current UI.
- Verifier identity/time are server-derived.
- No double verification or post-verification edit.
- Reconciliation report includes opening modal, cash sales, cash refunds, petty cash and other approved cash entries distinctly.
- Difference is physical minus expected, with sign and rounding fixed.

### 3.15 Riwayat Retur / Pengawasan Retur (Admin/Pimpinan)

Visible in Riwayat:
- Admin sees pending return proposals, verifies/forwards or rejects.
- Pimpinan sees final approval and refund status.
Visible in Pengawasan Retur:
- KPIs: awaiting final approval, awaiting refund, paid.
- Full return list, status, Admin review detail, refund method/reference/payer/time.
- Pimpinan final approve/reject and records refund payment.
- Legacy approved returns without refund are highlighted for reconciliation.
- One-time quota migration action is available to Pimpinan.

Proposed API:
- `GET /api/returns`
- `POST /api/returns/{id}/admin-review`
- `POST /api/returns/{id}/final-decision`
- `POST /api/returns/{id}/refund-payment`
- `POST /api/return-quotas/reconcile-legacy` (dry-run then explicit commit)

Invariants:
- Admin verifies but cannot perform final stock restoration or refund payment.
- Pimpinan final approval is separate from payout.
- Payment requires method; transfer requires reference; prevent duplicate payout.
- Return quantity/amount calculated from immutable invoice line and proportional discount allocation.
- Both medicine and service returns supported; package component policy is explicit.
- Reconcile legacy quota without rewriting invoices, stock or historic return records.

### 3.16 Dashboard (Pimpinan)

Visible:
- KPI cards and management warnings.
- Return-period detail.
- Daily revenue trend, payment method share, financial structure charts.
- Financial basis/explanation panel.

Proposed API:
- `GET /api/reports/dashboard?from=&to=`

Invariants:
- Dashboard uses same canonical calculation service as Laba Rugi and Arus Kas.
- Distinguish gross revenue, approved returns, net revenue, HPP, loss, operating expense, petty cash, profit and cash-on-hand.
- Modal awal shift is not omzet.
- Show data timestamp and reconciliation warnings.
- Date/time uses Asia/Jakarta; cancelled invoices and returns follow approved recognition policy.

### 3.17 Data Pasien (Pimpinan)

Visible:
- Patient active/archive toggle.
- Table: date, time, queue, name, phone, service, status, cashier, action.
- Pimpinan can archive eligible unfinished patient and restore archived patient.
- Page describes read-only except archive/restore.

Proposed API:
- `GET /api/patients?status=active|archived&page=`
- `POST /api/patients/{id}/archive`
- `POST /api/patients/{id}/restore`

Invariants:
- Archive is soft delete with actor/time/reason, not physical deletion.
- Preserve encounters, invoice and queue audit references.
- Restrict patient PII to role-authorized endpoints.
- Do not confuse Batal Berobat with archive.

### 3.18 Stok Obat (Pimpinan)

Visible:
- Count of medicine types and low-stock types.
- Table with unit, stock, minimum, condition and active batch/expiry summary.
- Read-only.

Proposed API:
- `GET /api/reports/inventory/summary`

Invariants:
- Same stock calculation as Admin stock card and checkout.
- Aggregate stock is reconciled with batch balance.
- Include low stock, expired/near-expiry status; no stock mutation from this screen.

### 3.19 Laba Rugi (Pimpinan)

Visible:
- Comprehensive profit/loss table.
- Uses financial calculation and date filter.

Proposed API:
- `GET /api/reports/profit-loss?from=&to=`

Invariants:
- Central calculation service; no separate formula in frontend.
- Define gross/net revenue, return recognition date, HPP, package HPP, loss, expenses, petty cash treatment, supplier credit, tax if applicable.
- Purchases are inventory/AP events, not automatically operating expense on purchase date.
- Refund obligation and actual payout are separate events.
- Reconcile to transaction-level drilldown.

### 3.20 Arus Kas (Pimpinan)

Visible:
- Cash inflow table and outflow table for selected period.

Proposed API:
- `GET /api/reports/cash-flow?from=&to=&account=`

Invariants:
- Cash, bank, QRIS, card and transfer settlement separated.
- Non-cash sales are not cash-in until settlement policy says so.
- Cash refund payout is cash outflow on payout date; return revenue adjustment is recognized per policy.
- Opening cash and shift closing are not sales.
- Supplier payment and operating expense cannot be double-counted.

### 3.21 Utang Supplier (Pimpinan)

Visible:
- Supplier, invoice, payable amount, due date, days remaining/overdue.
- Mark paid action in current source.

Proposed API:
- `GET /api/payables?status=open&dueBefore=`
- `POST /api/payables/{id}/payments`

Invariants:
- Payment record and payable reduction atomic.
- Partial payment policy supported or explicitly rejected.
- Supplier return credit applied once.
- Paid invoice remains historically visible; do not delete.
- Aging based on WIB business date.

### 3.22 Approval (Pimpinan)

Visible:
- Pending expenses table: date, category, description, amount.
- Approve or reject action.

Proposed API:
- `GET /api/expenses?status=pending`
- `POST /api/expenses/{id}/approval`

Invariants:
- Only Pimpinan can approve high-value expense.
- Capture decision, approver, time and reason.
- Approval cannot be repeated or changed without explicit reversal/reopen command.
- Frontend must not be sole role gate.

### 3.23 Display TV (Admin/Pimpinan)

Visible:
- Video URL/YouTube ID field, enable checkbox, preview.
- Running text field and preview.
- MP3 groups: notification, prefix/suffix, letters A-Z, digits 0-9, counter umum/gigi.
- Per clip: upload, save, listen, delete; max 600 KB.
- Test entire announcement sequence.
- Save/sync display settings.

Proposed API:
- `GET /api/display/settings`
- `PATCH /api/display/settings`
- `GET /api/display/audio-assets`
- `POST /api/display/audio-assets/upload` (signed upload or streaming)
- `POST /api/display/audio-assets/{id}/activate`
- `POST /api/display/audio-assets/{id}/delete`
- `GET /api/display/queue` (TV-specific projection)

Invariants:
- Audio file binary stored in object storage; TiDB stores metadata, object key, size, checksum, MIME, version, actor and lifecycle.
- Validate actual file signature, not just extension/MIME.
- Audio clip and notification chime remain separate configurable assets.
- Digit-by-digit speaking retained.
- TV API returns only queue number, patient display name if needed, service/destination and call state; no phone or unrelated clinical fields.
- TV device/session is read-only and narrowly scoped.
- A/B queue selector/switching is not current-main guaranteed behavior; PR13 remains unmerged reference until accepted and regression-tested.

### 3.24 Ekspor (Admin/Pimpinan)

Visible:
- Report list with CSV (Excel) and PDF actions.
- Existing export helper covers transaction, patient, purchase, expenses, petty cash, stock, expiry, activity log, packages and stock card.

Proposed API:
- `GET /api/exports/{reportKey}?format=csv|pdf&from=&to=`
- Asynchronous job endpoints for large reports: `POST /api/exports`, `GET /api/exports/{jobId}`.

Invariants:
- Role/field-level authorization per report.
- CSV formula injection protection.
- Patient phone/name minimized or masked unless necessary.
- Exports reflect canonical server state, not stale local browser arrays.
- Correct return/cancellation treatment and WIB date boundaries.
- Export event logged; file links expire and are access-controlled.
- Reconcile existing stock-card export defects before claiming parity.

### 3.25 Log Aktivitas (Pimpinan)

Visible:
- Search by user, action or data.
- Table with time, user, action, module/data and detail.

Proposed API:
- `GET /api/audit-events?from=&to=&actor=&action=&q=&page=`

Invariants:
- Server-generated, append-only, tamper-resistant.
- Include actor ID, role snapshot, action, resource, before/after diff, timestamp, request ID, origin/device and reason where relevant.
- Never truncate authoritative audit at the local 1,000-row cap.
- Sensitive values (password, tokens, full card details) never recorded.

### 3.26 Pengguna (Pimpinan)

Visible:
- Staff account/profile table with legacy name, username, role, WhatsApp and active status.
- Provision/update staff profile button.
- Owner WhatsApp setting.
- Legacy add/edit/delete controls may exist in code.

Proposed API:
- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/{id}`
- `POST /api/users/{id}/disable`
- `POST /api/users/{id}/email-change`
- `POST /api/users/{id}/password-reset` (provider delegated)

Invariants:
- Stable user ID separate from email/username.
- Pimpinan cannot accidentally delete master Pimpinan identities; deactivation requires protected recovery policy.
- Role changes require explicit audit and perhaps re-authentication.
- Email change verifies new email and invalidates old identity/session.
- Admin/Kasir permissions never derived from localStorage.
- Cloud Functions source/deployed version gap must be closed before auth cutover.

### 3.27 Pengaturan (Pimpinan)

Visible:
- Clinic identity: fixed clinic name, logo text/image, address, phone, owner WhatsApp, receipt footer.
- UI theme/color/font/table page size.
- Expense approval threshold, supplier due warning days, expiry warning days.
- Firebase config connect/disconnect controls.
- JSON backup download and JSON restore upload.

Proposed API:
- `GET /api/settings`
- `PATCH /api/settings/clinic-profile`
- `PATCH /api/settings/ui`
- `PATCH /api/settings/business-policies`
- `POST /api/backups`
- `GET /api/backups/{id}/download`
- `POST /api/restores/validate`
- `POST /api/restores/{id}/execute` (two-person or explicit owner approval for production)

Invariants:
- Clinic display name remains fixed: Klinik Assalaam Palembang.
- Business settings carry version, effective date, editor and audit.
- Approval threshold changes do not retroactively alter already decided expenses.
- Firebase connect/disconnect controls are migration-era legacy UI; do not expose them as MySQL settings.
- Backup includes schema version, checksum, encrypted storage, retention, offsite copy and restore drills.
- Restore starts with dry-run, diff/preview, validation, idempotency, explicit approval and rollback plan.
- Never overwrite/delete master Pimpinan or merge demo seed rows into production data.
- Do not use browser JSON export as the only authoritative backup.

## 4. Display TV page (separate screen, display.html)

Visible layout:
- Clinic logo/name/address header.
- Clock and date.
- Enable TV audio button and local video file selection/fullscreen controls.
- Main current-called queue number, patient name and destination/poli.
- Waiting count and waiting queue list.
- Video/health tips panel.
- Running text ticker.
- Audio announcement flow with MP3 clips and SpeechSynthesis fallback.

Target endpoints:
- `GET /api/display/session` (device-scoped read token)
- `GET /api/display/queue` (minimal projection)
- `GET /api/display/settings`
- `GET /api/display/audio-assets`
- `POST /api/display/events/ack` (optional idempotent playback acknowledgment; not a clinical write)

TV security:
- No staff login credentials embedded in TV page.
- Use short-lived, device-scoped, read-only token or safe public projection with rate limiting.
- Do not send patient phone, medical history, financial data, cashier identity beyond what is displayed.
- Queue event replay must avoid announcing the same call repeatedly after reload/reconnect.
- Local video file chosen by operator is not uploaded to server unless explicitly designed.

## 5. Proposed endpoint-to-visible-menu index

| UI screen | Main read API | Main write command(s) |
|---|---|---|
| Login | `/api/me` | auth session/reset |
| Shift | `/api/shifts` | open, close, verify |
| Pasien | `/api/patients`, `/api/queues/today` | register, edit, call, cancel-visit, restore |
| Transaksi | `/api/pos/catalog`, `/api/pos/eligible-visits` | checkout |
| Kas Kecil | `/api/cash-entries` | petty entry, reversal |
| Obat & Tarif | `/api/medicines`, `/api/service-tariffs` | create/update/deactivate, stock adjustment |
| Paket Pelayanan | `/api/service-packages` | create/update/deactivate |
| Pembelian | `/api/purchases` | receive, payment, supplier return |
| Kedaluwarsa | `/api/inventory/expiry` | expired disposal |
| Biaya | `/api/expenses` | create, edit pending, reverse |
| Stok Opname | `/api/inventory/losses` | loss, reversal |
| Kartu Stok | `/api/inventory/medicines/{id}/ledger` | CSV export |
| Riwayat Transaksi | `/api/transactions`, `/api/returns`, `/api/cancellations` | return/cancellation workflow |
| Verifikasi | `/api/shifts?status=closed-unverified` | shift verification |
| Dashboard | `/api/reports/dashboard` | none |
| Data Pasien | `/api/patients` | archive, restore |
| Stok Obat | `/api/reports/inventory/summary` | none |
| Laba Rugi | `/api/reports/profit-loss` | none |
| Arus Kas | `/api/reports/cash-flow` | none |
| Utang | `/api/payables` | payment |
| Approval | `/api/expenses?status=pending` | approve/reject |
| Pengawasan Retur | `/api/returns` | final decision, refund payment, legacy quota reconciliation |
| Display TV | `/api/display/settings`, `/api/display/audio-assets` | settings/audio asset lifecycle |
| Ekspor | `/api/exports` | create export job |
| Log Aktivitas | `/api/audit-events` | none (append-only events created by commands) |
| Pengguna | `/api/users` | provision, update, disable, email change |
| Pengaturan | `/api/settings`, `/api/backups` | settings update, backup/restore workflow |
| TV separate | `/api/display/queue`, settings, audio | optional playback ack |

All endpoint names are proposed contracts. They must be refined against full source and permission review before implementation.

## 6. Screen-level regression acceptance checklist

### Common shell and roles
- [ ] Correct role tabs appear for Pimpinan, Admin, Kasir1 and Kasir2.
- [ ] Direct API request cannot bypass hidden menu.
- [ ] User name/role header reflects server profile.
- [ ] Logout and session expiry do not leave privileged cached screen usable.
- [ ] Offline state clearly distinguishes unsaved/pending/synced changes.

### Kasir journey
- [ ] Open shift, one active shift only.
- [ ] Register new patient and find existing patient.
- [ ] Concurrent queue registrations never duplicate queue numbers.
- [ ] Call queue; TV updates once; reconnect does not replay stale call.
- [ ] Batal Berobat and restore follow allowed lifecycle.
- [ ] POS hides ineligible waiting patients.
- [ ] Service, medicine, package checkout all work.
- [ ] FEFO batch deduction exact; stock aggregate equals batch sum.
- [ ] Cash, QRIS, transfer, card payment and change are correct.
- [ ] Receipt and medicine labels preserve historical snapshots.
- [ ] Cashier return proposal cannot overrun quota or duplicate selected quantity.
- [ ] Cashier cancellation request does not restore stock prematurely.
- [ ] Petty cash appears in shift cash reconciliation and correction is reversible.
- [ ] Shift close cannot race with checkout/petty cash.

### Admin journey
- [ ] Medicine/service master changes do not rewrite old invoices.
- [ ] Package builder preserves components and price snapshots.
- [ ] Purchase creates exact batch and correct weighted HPP.
- [ ] Supplier return rejects excess and references exact batch.
- [ ] Expiry warning uses WIB and disposal creates loss once.
- [ ] Expense approval threshold enforced by server.
- [ ] Loss/opname decreases correct batch and stock; reversal restores once.
- [ ] Shift verification captures Admin and timestamp.
- [ ] Admin can review/forward patient return but cannot final approve/pay.
- [ ] Display settings and MP3 assets sync without overwriting unrelated settings.
- [ ] CSV/PDF exports respect Admin data scope and date filters.

### Pimpinan journey
- [ ] Dashboard, Laba Rugi and Arus Kas reconcile to same canonical ledgers.
- [ ] Data Pasien active/archive and restore work; no hard deletion.
- [ ] Stok Obat summary matches Kartu Stok and batch balances.
- [ ] Supplier payable aging, credits and payments reconcile.
- [ ] Expense approval records decision/actor/time.
- [ ] Return final approval restores inventory once; payout is separate and duplicate-proof.
- [ ] Legacy returns flagged for reconciliation.
- [ ] Log search works beyond 1,000 events and cannot be altered by staff.
- [ ] User email change preserves stable identity and audit.
- [ ] Fixed clinic name cannot be changed.
- [ ] Backup/restore dry-run protects master Pimpinan and live operational data.

### TV journey
- [ ] TV only receives the minimal permitted queue fields.
- [ ] Current call, waiting list and count match app.
- [ ] Audio enable gesture works in target browser.
- [ ] Chime remains distinct from spoken announcement clips.
- [ ] Number digits are spoken individually.
- [ ] Missing MP3 falls back to Indonesian TTS.
- [ ] Audio clip upload, preview, save, delete and rollback work.
- [ ] Video/health tips/running text layout remains responsive.
- [ ] A/B switching and handoff only tested if PR13 is separately approved and adopted.

## 7. UI parity gaps and design warnings

1. Current app mixes local ClinicStore mutations, UI role checks and Firestore Rules. MySQL must not translate this into generic state CRUD.
2. Some current screens expose edit/delete buttons for financial and inventory records. Keep familiar screen flows where possible, but implement corrections as reversal commands and display a clear correction history.
3. Current Pimpinan patient list exposes phone numbers; target should enforce a deliberate PII policy.
4. Current Display TV source includes legacy default clinic text in HTML; the actual clinic identity is fixed elsewhere. Ensure the displayed title/address come from validated clinic settings and default to Klinik Assalaam Palembang, not stale placeholder text.
5. Settings screen contains Firebase connection controls and local JSON backup/restore. These are legacy migration controls, not target MySQL administration screens.
6. Current exports have known limitations documented in the separate export audit; matching the button alone is not enough. Correct data semantics are required.
7. Current `main` queue behavior must be distinguished from open PR13 A/B/handoff enhancements.
8. Current supplier-return path is local-store based and lacks a dedicated backend command in the inspected method catalog; new API must be implemented and tested.
9. Current cancellation workflow checks return query outside transaction; target must use database row locks.
10. Current local return approval differs from staged cloud return workflow; use staged Admin/Pimpinan workflow as safer candidate, pending final policy decision.

## 8. UI acceptance protocol

For every screen:
1. Capture baseline screenshot or screen recording from the current production-safe app before replacing UI.
2. Record all fields, labels, buttons, table columns, filters, empty states, validation messages, confirmation dialogs and print outputs.
3. Record role-specific differences using the four actual accounts.
4. Create synthetic fixtures representing normal, boundary, legacy and invalid data.
5. Compare old and new screen side by side at desktop, tablet and phone widths.
6. Run action tests and verify both displayed result and database/ledger effect.
7. Verify cross-device sync and permission denial for unauthorized role.
8. Sign off only when data, visual workflow, authorization, audit and print/export output all pass.

No feature is considered preserved merely because its tab exists.

## 9. Safety

- No SQL DDL/schema was created or executed.
- No production source, Firebase Rules, Auth or data was changed.
- No production Vercel deployment was performed.
- No patient/operational data was exported or migrated.
- PR13 remains unmerged and is not silently included.
