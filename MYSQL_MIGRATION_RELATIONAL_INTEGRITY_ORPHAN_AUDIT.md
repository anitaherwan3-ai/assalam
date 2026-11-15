# MYSQL MIGRATION — RELATIONAL INTEGRITY, ORPHAN DATA AND LIFECYCLE AUDIT

Date: 2026-11-15
Source baseline: main (read-only)
Target branch: migration/tidb-foundation
Status: static source audit and proposed reconciliation rules; no production data inspected or modified.

## 1. Purpose and scope

This audit maps cross-record relationships, lifecycle transitions, deletion and restoration behavior, immutable historical snapshots, and checks required before importing legacy data into TiDB.

It does not claim that production contains orphan records. No live Firebase export or production query was performed. “Potential orphan” means a relationship the code permits or one that must be tested in an approved staging copy.

Source fingerprints:
- js/store.js: 99e74acf8caec9c70d82be1d5f6efc5bfa6bc4fb (552 lines)
- js/firebase-backend.js: 3a613d96564f120b8141966f9ecbae21471c4e65 (1,435 lines)
- js/app.js: f74c4710161ddd2af230e51c18b1f107d6c52c82 (4,872 lines)
- firestore.rules: d02b6d02c13bc85f867b668085edb85c54726779 (416 lines)

Related: MYSQL_MIGRATION_MASTER_BLUEPRINT.md; MYSQL_MIGRATION_SCREEN_BY_SCREEN_UI_SPECIFICATION.md; MYSQL_MIGRATION_ROOT_CAUSE_AUDIT.md; MYSQL_MIGRATION_INVOICE_AND_INVENTORY_AUDIT.md; MYSQL_MIGRATION_FINANCIAL_RECONCILIATION_AUDIT.md; MYSQL_MIGRATION_CANCELLATION_SUPPLIER_RETURN_DISPLAY_AUDIT.md.

## 2. Critical architecture interpretation

The checked-in source has three behavior layers:
1. UI/controller in js/app.js determines what appears and what a button attempts.
2. Local ClinicStore arrays and methods in js/store.js maintain browser state and some business calculations.
3. Firebase adapter and Firestore Rules in js/firebase-backend.js and firestore.rules govern cloud persistence and authorization.

A relationship valid in local state may not have been persisted remotely. Firestore listeners merge cloud data into local state. Local fallback/default seeding may create records that are not authoritative. Migration must use an approved, verified source snapshot, not blindly import browser localStorage.

## 3. Relationship catalogue

### 3.1 Identity and ownership

| Record | Reference | Parent / meaning | Target treatment |
|---|---|---|---|
| User profile | legacy u, email document key | Auth identity | Map to immutable user ID; email remains mutable |
| Shift | kasir / cashier profile | User | Required for new cashier shift; quarantine unresolved legacy actor |
| Patient visit | kasir, sh | User and shift | Preserve historical actor snapshots |
| Transaction | kasir, sh, pid | User, shift, patient/visit | Resolve or record a legacy exception |
| Audit event | u, actor email/ID | User | Preserve actor snapshot after account disable |
| Return/cancellation | cashier and decision actor | Multiple users | Stable actor IDs plus role/name snapshots |

Do not delete historical shifts, invoices or audit records when a staff account is disabled or email changes. User deletion should become deactivation.

### 3.2 Patient, visit, queue and invoice

Current patient/visit fields include id, no, tgl, jam, nama, hp, layanan, kasir, sh, done, calling, status and _t, with additional lifecycle fields. Transaction header includes id, no, tgl, jam, pid, nama, hp, kasir, sh, items, total, metode, bayar, kembalian and _t, plus cancellation status fields.

Relationships:
- Patient/visit sh -> shift.
- Patient/visit kasir -> cashier profile.
- Transaction pid -> patient/visit.
- Transaction sh -> shift.
- Transaction kasir -> user.
- Queue ticket/call event -> visit.

Important distinctions:
- Current patient array rows represent daily arrivals/visits; do not confuse them with a permanent patient master.
- Invoice patient name and phone are historical snapshots; preserve them even if patient profile changes.
- Missing patient must not silently delete a financial invoice. Define an orphan-visit policy.
- Patient archive (deletedAt/deletedBy) is soft deletion for eligible unfinished records; it must not cascade to invoice, visit or queue history.
- Batal Berobat (status, batalBerobatPada, batalBerobatOleh) is a visit lifecycle state, not patient archive and not invoice cancellation.
- Restore from Batal Berobat is currently limited to same-day unfinished visits.
- Queue number is scoped by business date and prefix, not a stable patient identifier.

### 3.3 Invoice, lines, package, return and cancellation

Relationships:
- Invoice header -> immutable invoice lines.
- Medicine line -> medicine master ID and batchDeductions batch IDs.
- Package line -> package/component snapshots; medicine components -> medicine IDs and their own batch deductions.
- Sales return -> invoice ID, original item index, quota ID and original batch allocations.
- Cancellation request -> invoice ID.
- Return quota -> invoice and invoice-line identity.

Required invariants:
1. Invoice line identity must be stable. Array position alone is fragile if items are reordered; target assigns immutable line IDs and preserves legacy item-index mapping.
2. Every medicine component retains a medicine snapshot. If its current master is missing, preserve snapshot and flag exception; do not drop the line.
3. Every batch deduction must reference a batch belonging to the same medicine.
4. Sum of batch deductions must equal sold quantity multiplied by package component quantity.
5. Cumulative pending plus approved return quantity cannot exceed sold quantity. Rejected proposals release quota.
6. Return amount is recalculated from original invoice snapshot and proportional discount allocation; never trust client amount.
7. Return batch restoration uses original batch deductions less previously approved quantities.
8. Service return has no stock restoration. Package component-return policy must be explicit.
9. A cancelled invoice cannot coexist with an active or approved return. Lock invoice, return and quota rows during transitions.
10. Invoice snapshots survive edits to current medicine price, tariff, package definition, patient name or cashier profile.

### 3.4 Medicine, batch, purchase, loss and stock movement

| Record | Reference | Relationship / invariant |
|---|---|---|
| Medicine | medicine ID | Aggregate stock and HPP |
| Batch | oid | Must reference medicine; beli points to purchase or opening balance |
| Purchase | oid, batchId | Must reference medicine and received batch |
| Invoice medicine line | oid, batchDeductions[].bid | Batch must belong to medicine |
| Stock loss | oid, bid where present | Correct medicine and batch |
| Supplier return | beliId | Purchase and exact originating batch |
| Sales return | batchRestores[].bid, oid | Exact original sold batch |
| Target inventory movement | source command and batch | Append-only, exactly-once posting |

Required invariant: medicine aggregate stock equals sum of batch remaining balances, except explicitly documented opening-balance or reconciliation adjustments. Never overwrite either side silently to “fix” a mismatch.

Known source risks:
- Initial seed batches use beli='init'; this is not a real purchase FK. Map to an explicit opening-balance source.
- ClinicStore.loadLocal repopulates some master arrays when empty, including medicine, batch, tariff, users and package defaults. Do not port this seeding behavior to production MySQL.
- Local FEFO date handling uses UTC conversion in places; target business date is Asia/Jakarta.
- Local supplier return selects first batch for purchase and silently caps quantity with Math.min; target must select exact batch and reject over-return.
- Some legacy invoices may lack batchDeductions. Do not invent the source batch.
- Aggregate stock and batch sums may disagree due to legacy local/cloud merge; preserve source snapshot and reconcile with explicit adjustment.

### 3.5 Finance and cash relationships

| Record | Relationship |
|---|---|
| Cashier transaction | Invoice -> shift -> cashier; payment method and tendered amount |
| Shift | Cashier; opening modal; cash sales; petty cash; close count; verification |
| Petty cash | Shift and cashier |
| Expense | Category, submitter, approver, decision |
| Purchase | Supplier, invoice, payable, due date |
| Purchase payment | Purchase/payable, amount, method, account and reference |
| Supplier credit | Supplier return -> payable reduction or supplier receivable |
| Sales return | Invoice line -> refund obligation |
| Refund payout | Approved return -> cash/bank payment |
| Loss | Medicine/batch -> HPP loss |
| Financial ledger | Source command -> account entries and actor |

Do not overload a single total or ledger:
- Revenue recognition differs from cash received.
- Return approval reduces revenue/creates refund obligation; payout reduces cash/bank later.
- QRIS/transfer/card sales are not automatically cash-drawer inflow.
- Opening shift modal is cash-on-hand, not omzet.
- Petty cash is cash outflow; P&L classification must avoid double counting.
- Purchase receipt increases inventory and payable; supplier payment later reduces cash and payable, not a second operating expense.
- Supplier credit reduces payable or creates receivable; it is not sales revenue.
- Loss affects inventory and profit; do not count loss and HPP twice.
- Use unique source posting keys to prevent duplicate ledger entries.

## 4. Lifecycle and deletion audit

### 4.1 Patient/visit
Registration creates visit and queue allocation. Call changes queue state. Batal Berobat changes visit state, not patient identity. Restore is currently same-day and unfinished only. Pimpinan archive is soft delete for eligible unfinished visits. Preserve all event history and never cascade to invoices.

### 4.2 Invoice
Checkout creates invoice, line snapshots, inventory movements, payment postings and return quota. Cancellation request does not restore stock. Approval changes invoice to cancelled and restores original stock/batches atomically. Target cancellation reversal must be exactly once. Never physically delete posted invoice.

### 4.3 Sales return
Cashier proposes; proposal reserves quota. Admin reviews/forwards or rejects. Pimpinan finalizes; stock restores and refund obligation is created. Pimpinan separately pays refund. Target state transitions must be constrained; payout cannot precede final approval and cannot duplicate. Local ClinicStore approval currently allows Admin or Pimpinan and restores stock immediately, while cloud workflow is staged. Prefer staged cloud workflow as safer candidate, subject to owner policy approval.

### 4.4 Purchase and supplier return
Purchase receipt creates batch and updates aggregate stock/HPP. Supplier return consumes exact batch and creates supplier credit. Local implementation may adjust unpaid purchase totals; target keeps original invoice immutable and records credit separately. Purchase payment history must not be reduced to a boolean lunas flag.

### 4.5 Cash, expenses and loss
Local petty cash supports edit/delete; target uses reversal and replacement. Approved expense should not be physically deleted. Loss cancellation should create stock reversal, not remove original event. Shift close and verification are immutable snapshots with audited corrections.

### 4.6 Users and master data
Disable users instead of deleting. Deactivate medicine, tariff and package records referenced by historical transactions. Never cascade-delete invoice snapshots. Master Pimpinan identities must survive reset, restore, migration and seed operations.

## 5. Candidate foreign-key map (proposal only; no DDL)

| Parent candidate | Child candidate | Key | Delete/update policy |
|---|---|---|---|
| users | shifts | cashier_user_id | Restrict delete; disable user |
| users | visits | cashier_user_id | Restrict; actor snapshot |
| shifts | visits | shift_id | Restrict delete |
| patients | visits | patient_id | Restrict; snapshot |
| visits | queue_tickets | visit_id | Restrict delete |
| visits | transactions | visit_id | Nullable only for approved legacy exception |
| users | transactions | cashier_user_id | Restrict delete |
| shifts | transactions | shift_id | Restrict delete |
| transactions | transaction_items | transaction_id | Restrict; immutable |
| medicines | transaction_items | medicine_id | Nullable only for legacy snapshot exception |
| packages | package_versions | package_id | Restrict/deactivate |
| transaction_items | item_batch_deductions | transaction_item_id | Restrict delete |
| batches | item_batch_deductions | batch_id | Restrict delete |
| medicines | batches | medicine_id | Restrict delete |
| purchases | batches | purchase_id | Nullable only for opening balance |
| purchases | purchase_payments | purchase_id | Restrict delete |
| purchases | supplier_returns | purchase_id | Restrict delete |
| batches | supplier_return_items | batch_id | Restrict delete |
| transactions | return_requests | transaction_id | Restrict delete |
| transaction_items | return_requests | transaction_item_id | Restrict delete |
| return_requests | return_decisions | return_id | Restrict delete |
| return_requests | refund_payments | return_id | Restrict delete |
| batches | return_batch_restores | batch_id | Restrict delete |
| shifts | petty_cash_entries | shift_id | Restrict delete |
| users | expenses | created_by | Restrict delete |
| expenses | expense_decisions | expense_id | Restrict delete |
| batches | inventory_movements | batch_id | Nullable for non-batch movement |
| users | audit_events | actor_user_id | Set null only if actor snapshot retained |
| source command | ledger_entries | source_type/source_id | Restrict delete; unique posting key |

Introduce FK constraints only after legacy profiling and exception handling. For historical snapshots with missing current master, use nullable FK plus explicit legacy exception code and immutable snapshot fields; do not fabricate parent rows.

## 6. Orphan and integrity checks required before import

These are logical checks to run against an approved read-only staging export, not executed queries.

### Identity
- Every active cashier shift resolves to user or documented legacy identity.
- Every cashier-created patient/transaction resolves to user or preserved actor snapshot.
- Detect normalized email collisions.
- Both Pimpinan identities map to protected stable user IDs.
- Historical references to disabled/missing users remain intact.

### Patient and visit
- Transaction pid resolves to patient/visit or explicit legacy-missing-patient exception.
- Patient sh resolves to shift when non-null.
- Patient kasir resolves to user/legacy actor.
- Duplicate queue number within clinic/date/prefix is reported.
- Duplicate patient IDs and visit IDs are tested separately.
- Archived and Batal Berobat visits are excluded from active queue.
- Invoice with missing patient is retained.

### Transaction and return
- Every return references invoice or is quarantined.
- Every item index maps to original line; freeze legacy mapping before normalization.
- Pending plus approved return qty never exceeds sold qty.
- Every batch restore matches original sale's batch and medicine.
- No invoice has both approved cancellation and approved return.
- No duplicate cancellation request or refund payout.
- Cancelled invoice has exactly one stock reversal per original deduction.
- Approved return has exactly one stock restoration per allocation.
- Paid refund references approved return and valid cash/bank payment.

### Inventory and purchases
- Every batch oid resolves to medicine.
- Every non-opening batch purchase reference resolves to purchase.
- Purchase batchId resolves to batch created by purchase.
- Batch beli and purchase batchId are reciprocal where expected.
- Every invoice batch deduction matches medicine line/component.
- Every loss batch matches loss medicine.
- Every supplier return references purchase, medicine and exact batch.
- Batch sisa is nonnegative and within accepted quantity after explicit adjustments.
- Sum of batch sisa matches medicine aggregate stock or has reviewed adjustment.
- FEFO is deterministic for equal expiry dates.
- Expired batch is not eligible for sale according to WIB business date.

### Finance
- Every paid transaction has correct payment posting(s).
- Cash tendered, change and recognized revenue are not conflated.
- Every shift close reconciles to ledger.
- Petty cash entries reference shift and actor.
- Every approved expense has approval/auto-approval decision record.
- Purchase payable equals original invoice less approved supplier credits and payments.
- Every supplier payment and refund payout has unique payment/idempotency key.
- Refund obligation is not counted as cash paid before payout.
- Every source command has no duplicate ledger posting.
- Recompute P&L/cash flow and compare with historical report samples.

## 7. Migration staging and exception policy

### Stage A — read-only source profiling
After privacy/security approval, export to isolated staging only. Capture source document ID, collection, raw JSON, timestamps, export timestamp and checksum. Preserve original export. Profile counts, nulls, duplicates, malformed dates, type variations and relationships. Separate production, preview/test and demo seed records.

### Stage B — identity and key mapping
Create stable target IDs and source mapping (source system, collection, source ID). Normalize emails but preserve originals. Map beli='init' to opening balance source. Map legacy cashier IDs kasir/kasir2 to stable user IDs, not mutable email. Preserve original invoice item index while assigning line IDs. Preserve source statuses during initial import.

### Stage C — exception quarantine
Never silently drop, guess or auto-repair:
- Missing patient/visit or cashier profile.
- Missing batch deduction on medicine sale.
- Batch references wrong medicine.
- Negative stock or batch balance.
- Duplicate queue/invoice number.
- Return qty/amount exceeding source invoice.
- Cancellation/return conflict.
- Purchase without batch or ambiguous supplier-return batch.
- Financial totals that do not reconcile.
Each exception requires source ID, reason, severity, proposed resolution, reviewer, approval and audit.

### Stage D — deterministic import
Import parent tables before child tables and ledgers. Use idempotent source mapping; rerun must not duplicate. Record import batch, counts, checksums and rejected-row report. Preserve original timestamps and imported_at. Do not use client _t as sole conflict clock. Store business date/timezone Asia/Jakarta.

### Stage E — reconciliation and sign-off
Compare source and target counts per collection/table; totals and quantities by medicine, batch, invoice, shift, supplier and day. Sample receipts, returns, cancellations, purchases, shift slips, exports and patient reports. Verify role access with synthetic accounts. Firebase remains source of truth until owner-approved cutover and rollback plan.

## 8. Synthetic test fixtures and high-risk cases

1. One patient, two visits and two invoices; edit patient name later; old receipts unchanged.
2. Archive unfinished patient; no cascade to visit or invoice.
3. Batal Berobat then same-day restore; queue history retained.
4. Invoice medicine across two FEFO batches; partial return twice; exact batches restored.
5. Package with medicine and service; test component return policy.
6. Cancellation races with return proposal; exactly one wins.
7. Cancellation approval retried; stock restores once.
8. Refund payment retried; cash/bank ledger posts once.
9. Supplier return invoice with multiple batches; exact batch and over-return rejection.
10. Opening balance batch with beli='init'; no fake supplier payable.
11. Partial purchase payments plus supplier credit; payable correct.
12. Medicine stock differs from batch sum; migration quarantines discrepancy.
13. User email changes; old invoices/audit resolve to stable user ID.
14. Disabled cashier with historical shift; history remains visible to authorized management.
15. Missing patient on legacy invoice; invoice and finance intact with exception.
16. Concurrent queue registration; unique sequence.
17. Backup restore; master Pimpinan survives and source mapping not duplicated.
18. Repeat import; second run creates no duplicates.

## 9. Severity classification

| Severity | Example | Handling |
|---|---|---|
| Critical | Duplicate refund/stock restore, cancellation-return conflict, master owner lost | Block import/cutover |
| High | Missing batch deduction, wrong batch relation, stock or payable mismatch | Quarantine and manual resolution |
| Medium | Missing optional patient link, inactive actor, incomplete metadata | Preserve snapshot and log exception |
| Low | Old display label, obsolete UI setting | Preserve source value; map only with approval |

## 10. Decisions before schema freeze

1. Does each registration create permanent patient master plus visit, or are legacy patient rows visit-only until deduplicated?
2. Policy for legacy invoices with missing patient.
3. Policy for legacy invoices without batch allocation.
4. Can package returns be component-level or only whole-package?
5. How to handle medicine return already dispensed/consumed and physical restock.
6. Can shift close occur with pending offline operations or refund requests?
7. Can user be deactivated with active shift/session?
8. Can any medicine/tariff/package be hard-deleted? Recommendation: no.
9. Can supplier return reference multiple batches from one invoice? Recommendation: explicit per-batch allocations.
10. Accounting policy for supplier credit, petty cash classification and settlement.

## 11. What this audit establishes and does not establish

Established by source inspection:
- Local arrays cross-reference patient, shift, invoice, medicine, batch, purchase, return and activity records.
- Opening batches use special beli='init' marker.
- Return proposal references invoice line index and original batch allocations.
- Local and cloud return approval differ.
- Patient archive and Batal Berobat are separate lifecycle actions.
- Supplier-return local code selects batch by purchase and caps requested quantity.
- Cancellation/return conflicts and stock restoration require stronger database serialization.
- Backup/restore and default seeding require safeguards.

Not established:
- That production contains any particular orphan.
- That every Firestore document matches local object shape.
- That deployed Cloud Functions or Rules match repository source.
- That production data is complete, consistent or exportable.
- That target schema is approved or implemented.

## 12. Safety record

- No production Firebase reads/writes.
- No real patient data accessed or exported.
- No MySQL/TiDB DDL executed.
- No production code or Vercel deployment changed.
- All recommendations remain design/test plan pending owner policy decisions.
