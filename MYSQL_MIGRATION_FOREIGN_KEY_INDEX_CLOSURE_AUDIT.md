# FOREIGN KEY, INDEX AND RELATIONAL CLOSURE AUDIT
Date: 2026-11-15
Branch: migration/tidb-foundation
Status: static design audit; schema remains review-only; NO DDL executed.

## 1. Scope and method
Reviewed the complete 515-line `MYSQL_MIGRATION_SCHEMA_PROPOSAL.md`, all table definitions in sections 2–8, relationship summary and index/query list, together with `MYSQL_MIGRATION_SCHEMA_REVIEW.md`, relational integrity/orphan audit and financial/inventory reconciliation audit. Cross-checked table-level identifiers, declared unique/index candidates, relationship claims, transaction boundaries and owner decision blockers.

This is a document-level structural review. It is not a TiDB parser/DDL validation, live database query, migration dry run or proof of runtime enforcement. The proposal is still not sufficiently explicit to generate safe DDL.

## 2. Executive result
The domain coverage is broad and the major previously identified corrections A1–A10 are present. However, the relationship section is a high-level parent/child summary, not a complete column-level FK catalogue. Most table definitions list columns and selected indexes but do not declare exact FK column pairs, referenced keys, ON UPDATE/DELETE actions or the required child indexes.

**Finding FK-01 (BLOCKER):** do not freeze or generate schema v1 DDL from this proposal until a canonical FK matrix exists for every relationship, including composite same-parent consistency.

**Finding IX-01 (HIGH):** index/query list is provisional and omits several child-FK and operational lookup indexes. Every FK must have a deliberate child-side index with the FK columns as the leading columns (or a suitable existing composite index); TiDB may create/require supporting indexes differently by version, so explicit design and actual cluster verification are required.

**Finding CP-01 (HIGH):** cross-parent consistency rules cannot be guaranteed by ordinary independent FKs. Several child rows need composite FKs to prove that related IDs belong to the same invoice, encounter, cashier, medicine, supplier or return quota subject.

**Finding DEL-01 (HIGH):** RESTRICT is the stated default, but the proposal does not yet specify exact ON UPDATE/DELETE action for every FK. No financial, inventory, identity or audit record should cascade-delete. Parent keys should be immutable; corrections use reversal/status transitions.

**Finding ID-01 (HIGH):** polymorphic source references (source_type/source_id, entity_type/entity_id, aggregate_type/aggregate_id) cannot be ordinary FKs. They need a documented typed-reference registry or explicit source-specific link tables plus service-level existence checks and reconciliation.

## 3. Required canonical FK matrix
The following is the minimum candidate mapping. Exact constraints, nullability and composite unique parent keys must be specified in a separate matrix before DDL. All listed actor references should point to users.user_id unless explicitly nullable. Parent and child types, signedness, length, charset and collation must match exactly.

### Identity and settings
- user_emails.user_id → users.user_id; user_emails.changed_by_user_id → users.user_id (nullable).
- active_email_claims.user_id → users.user_id; (email_id,user_id) → user_emails(email_id,user_id).
- role_assignments.user_id and granted_by_user_id → users.user_id.
- active_role_slots.user_id → users.user_id; (role_assignment_id,user_id) → role_assignments(role_assignment_id,user_id).
- display_configs.updated_by_user_id and queue_audio_assets.updated_by_user_id → users.user_id.
- Ensure the active email claim cannot point to a historical email row belonging to a different user; ensure only verified email can be claimed in the command transaction.

### Patients, encounters and queue
- patients.created_by_user_id and archived_by_user_id → users.user_id (archived actor nullable).
- patient_encounters.patient_id → patients.patient_id (nullable); cashier_user_id → users.user_id; shift_id → cashier_shifts.shift_id (nullable). If shift ownership is required, add UNIQUE cashier_shifts(shift_id,cashier_user_id) and composite FK (shift_id,cashier_user_id), not independent FKs alone.
- cashier_queue_assignments.user_id and assigned_by_user_id → users.user_id.
- queue_tickets.encounter_id → patient_encounters.encounter_id; registered_by_user_id → users.user_id. Enforce unique encounter_id only if one ticket per encounter is confirmed.
- queue_call_events.queue_ticket_id → queue_tickets.queue_ticket_id; actor_user_id → users.user_id.
- Optional patient_handoffs: encounter_id → encounters; from/to user IDs → users; from/to shift IDs → cashier_shifts. Composite cashier/shift ownership must be checked for each side. This remains PR13-gated and is not part of baseline until separately approved.

### Shifts and finance
- cashier_shifts.cashier_user_id, closed_by_user_id → users.user_id (closed actor nullable).
- active_shift_slots.cashier_user_id → users.user_id and composite (shift_id,cashier_user_id) → cashier_shifts(shift_id,cashier_user_id). Parent must have UNIQUE(shift_id,cashier_user_id). This prevents a cashier slot from pointing to another cashier's shift.
- shift_reconciliations.shift_id → cashier_shifts.shift_id; verified_by_user_id → users.user_id (nullable).
- cash_ledger_entries.shift_id → cashier_shifts.shift_id (nullable); actor_user_id → users.user_id; reversal_of_entry_id → cash_ledger_entries.cash_entry_id (nullable, self-FK).
- bank_ledger_entries.actor_user_id → users.user_id; reversal_of_entry_id → bank_ledger_entries.bank_entry_id (nullable, self-FK).
- petty_cash_entries.shift_id → cashier_shifts.shift_id; cashier_user_id → users.user_id; reversed_by_entry_id must reference a clearly defined reversal entity (current name is ambiguous: it appears to reference cash ledger, not petty cash). Add composite shift/cashier ownership if both are stored.
- expenses.created_by_user_id and approved_by_user_id → users.user_id; expense_events.expense_id → expenses.expense_id and actor_user_id → users.user_id.
- loss_events.medicine_id → medicines.medicine_id; batch_id → inventory_batches.batch_id; reversal_of_loss_id → loss_events.loss_event_id. Add a composite medicine/batch parent key and FK if the loss medicine must equal the batch medicine.

### Master, supplier and inventory
- package_components.package_id → service_packages.package_id; medicine_id → medicines.medicine_id (nullable); tariff_id → tariffs.tariff_id (nullable). Enforce exactly one target according to component_type in API; optionally add tested CHECK. Add unique(package_id,sort_order) only if sort_order is guaranteed unique; otherwise use component sequence key.
- supplier_invoices.supplier_id → suppliers.supplier_id; created_by_user_id → users.user_id.
- supplier_invoice_lines.supplier_invoice_id → supplier_invoices.supplier_invoice_id; medicine_id → medicines.medicine_id.
- inventory_batches.medicine_id → medicines.medicine_id; supplier_invoice_line_id → supplier_invoice_lines.supplier_invoice_line_id (nullable, unique for one-to-one v1). For purchase batches, enforce that batch medicine equals receipt-line medicine via composite parent key UNIQUE(supplier_invoice_line_id,medicine_id) and matching composite FK; simple FKs permit mismatched medicine IDs.
- inventory_movements.medicine_id → medicines.medicine_id; batch_id → inventory_batches.batch_id (nullable); actor_user_id → users.user_id; reversal_of_movement_id → inventory_movements.inventory_movement_id. Add composite (batch_id,medicine_id) → inventory_batches(batch_id,medicine_id) to prevent movement for medicine A against medicine B's batch.
- stocktakes.created_by_user_id and approved_by_user_id → users.user_id; stocktake_lines.stocktake_id → stocktakes.stocktake_id; medicine_id → medicines.medicine_id; batch_id → inventory_batches.batch_id (nullable). Add same-batch/medicine composite consistency where batch_id is present.

### Sales, returns and cancellations
- sales_invoices.encounter_id → patient_encounters.encounter_id; patient_id → patients.patient_id (nullable snapshot link); cashier_user_id → users.user_id; shift_id → cashier_shifts.shift_id; cancelled_by_user_id → users.user_id (nullable). Add composite (shift_id,cashier_user_id) → cashier_shifts(shift_id,cashier_user_id). API must assert invoice.patient_id matches encounter.patient_id when both exist.
- sales_invoice_lines.invoice_id → sales_invoices.invoice_id; medicine_id/tariff_id/package_id → their respective masters (nullable). Add UNIQUE(invoice_line_id,invoice_id) parent key for child composite checks; UNIQUE(invoice_id,line_no) already candidate.
- sales_invoice_line_components.invoice_line_id → sales_invoice_lines.invoice_line_id; medicine_id/tariff_id → masters. Add exactly-one-target validation and stable component identity.
- invoice_batch_allocations.invoice_line_id → sales_invoice_lines.invoice_line_id; invoice_component_id → sales_invoice_line_components.invoice_component_id (nullable); batch_id → inventory_batches.batch_id; movement_id → inventory_movements.inventory_movement_id (unique). Add composite checks proving component belongs to line and batch medicine matches the line/component medicine.
- invoice_discount_allocations.invoice_id → sales_invoices.invoice_id; invoice_line_id → sales_invoice_lines.invoice_line_id. Add composite (invoice_line_id,invoice_id) FK so discount cannot be allocated to a line on a different invoice.
- invoice_payments.invoice_id → sales_invoices.invoice_id; actor_user_id → users.user_id.
- sales_returns.invoice_id → sales_invoices.invoice_id; requested_by/admin_reviewed_by/final_decided_by → users.user_id (review/final actors nullable).
- return_quota_subjects.invoice_line_id → sales_invoice_lines.invoice_line_id; invoice_component_id → sales_invoice_line_components.invoice_component_id (nullable). Add composite FK proving the component belongs to that exact invoice line; ensure quota_key deterministic and unique. Need a rule that service line quota has NULL component and component quota has a non-NULL component.
- sales_return_lines.sales_return_id → sales_returns.sales_return_id; return_quota_subject_id → return_quota_subjects.return_quota_subject_id; invoice_line_id → sales_invoice_lines.invoice_line_id; invoice_component_id → sales_invoice_line_components.invoice_component_id (nullable). Critical: add composite FKs or server transaction validation proving quota subject, invoice line and optional component are the same exact subject. Existing section 22 says API validates this; retain DB-level composite protection where feasible.
- sales_return_events.sales_return_id → sales_returns.sales_return_id; actor_user_id → users.user_id. The table is specified in section 2.7 but missing from section 9 relationship summary and needs explicit child indexes and append-only grants.
- refund_obligations.sales_return_id → sales_returns.sales_return_id (unique); approved_by_user_id → users.user_id.
- refund_payments.refund_obligation_id → refund_obligations.refund_obligation_id; paid_by_user_id → users.user_id.
- invoice_cancellation_requests.invoice_id → sales_invoices.invoice_id; requested_by/decided_by → users.user_id (decision actor nullable).
- invoice_cancellation_events.cancellation_request_id → invoice_cancellation_requests.cancellation_request_id; actor_user_id → users.user_id. If event rows need invoice lookup, add invoice_id or composite request/invoice key rather than polymorphic inference.

### Supplier returns and payments
- supplier_returns.supplier_invoice_id → supplier_invoices.supplier_invoice_id; requested_by/approved_by → users.user_id (approver nullable).
- supplier_return_lines.supplier_return_id → supplier_returns.supplier_return_id; supplier_invoice_line_id → supplier_invoice_lines.supplier_invoice_line_id; batch_id → inventory_batches.batch_id. Add composite constraints proving the batch belongs to the same medicine/receipt line and invoice; otherwise a supplier return can target a batch from another purchase.
- supplier_credit_notes.supplier_return_id → supplier_returns.supplier_return_id (unique); supplier_invoice_id → supplier_invoices.supplier_invoice_id. Add composite consistency so credit note invoice equals supplier return invoice.
- supplier_payments.supplier_id → suppliers.supplier_id; paid_by_user_id → users.user_id.
- supplier_payment_allocations.supplier_payment_id → supplier_payments.supplier_payment_id; supplier_invoice_id → supplier_invoices.supplier_invoice_id. Add supplier_id propagation/composite keys to ensure payment and invoice belong to the same supplier. Unique(supplier_payment_id,supplier_invoice_id) is appropriate if only one allocation per invoice per payment.

### Audit, jobs and files
- audit_events.actor_user_id → users.user_id (nullable for system actor; system actor identity must be explicit in event schema if null).
- idempotency_requests.actor_user_id → users.user_id; unique(actor_user_id,command_name,idempotency_key).
- outbox_jobs has polymorphic aggregate_type/aggregate_id; document explicitly that it has no ordinary FK and requires typed source validation + dead-letter/reconciliation checks.
- stored_files.created_by_user_id → users.user_id.
- backup_jobs.initiated_by_user_id → users.user_id (nullable for scheduled system job).
- export_jobs.requested_by_user_id → users.user_id.

## 4. Index closure checks
Minimum indexes/unique keys to add or explicitly confirm:
1. Every child FK: index beginning with the full FK column tuple; composite FK index order must match the FK columns.
2. Composite parent unique keys required for identity, role, shift, invoice-line/invoice, batch/medicine, supplier payment/supplier and quota/component consistency.
3. `patient_encounters(shift_id,cashier_user_id)` and `sales_invoices(shift_id,cashier_user_id)` parent matching keys require equivalent unique key on shifts; don't duplicate unique keys unless needed.
4. `queue_call_events(queue_ticket_id,occurred_at_utc)` and `sales_return_events(sales_return_id,occurred_at_utc)` for event history.
5. `sales_return_lines(return_quota_subject_id)`, plus invoice-line and return-header indexes. Current index only names invoice_line_id.
6. `return_quota_subjects(invoice_line_id,invoice_component_id)`; unique quota_key alone does not speed all line/component quota lookups.
7. `refund_payments(refund_obligation_id,paid_at_utc)` already proposed; also unique idempotency key.
8. `supplier_return_lines(supplier_return_id)`, `(supplier_invoice_line_id)`, `(batch_id)` as applicable to reverse lookups and FK support.
9. `supplier_payment_allocations(supplier_payment_id)` and `(supplier_invoice_id)`; unique pair begins with payment_id but not invoice_id.
10. `invoice_batch_allocations(invoice_line_id)`, `(invoice_component_id)`, `(batch_id)`, `(movement_id)`; unique movement_id alone does not support all parent-side reverse lookups.
11. `invoice_discount_allocations(invoice_line_id,invoice_id)` for composite FK/reverse lookup; unique(invoice_id,invoice_line_id) starts with invoice_id only.
12. `inventory_movements(batch_id,medicine_id,occurred_at_utc)` or suitable matching index for composite batch/medicine FK and stock-card access.
13. `loss_events(batch_id,medicine_id)` and `stocktake_lines(batch_id,medicine_id)` for composite consistency.
14. `cash_ledger_entries(reversal_of_entry_id)`, `bank_ledger_entries(reversal_of_entry_id)`, `inventory_movements(reversal_of_movement_id)`, and `loss_events(reversal_of_loss_id)` for self-FKs.
15. `cashier_queue_assignments(user_id,valid_from,valid_to)` and `(prefix,valid_from,valid_to)` for serialized overlap checks; indexes do not themselves prevent interval overlap.
16. `cashier_shifts(cashier_user_id,status)` or the active slot PK is the authoritative open-shift lookup; do not add redundant indexes without EXPLAIN evidence.
17. `idempotency_requests(actor_user_id,command_name,idempotency_key)` already unique; assess expiry cleanup index separately, without deleting audit-relevant records prematurely.
18. `outbox_jobs(status,available_at_utc)` already proposed; add bounded retry/lease indexes only if query plan requires them.
19. Search indexes for patient name/phone need privacy review and EXPLAIN; prefix/full-text behavior and collation must be tested against expected search semantics.
20. Normalized email comparison must be deterministic: use normalized lowercase value and a deliberate binary/case-sensitive collation or equivalent, so database collation does not unexpectedly merge addresses.

## 5. Delete/update policy closure
- Default parent deletion: ON DELETE RESTRICT. Prefer no ON UPDATE CASCADE; immutable surrogate IDs are not updated.
- User deactivation/suspension, patient archive, master deactivation, shift closure and invoice cancellation are state transitions, not deletes.
- Ledger, movements, audit, return/cancellation events, payments, quota reservation history and idempotency outcomes must be append-only or have tightly scoped retention policy.
- A reservation release must be an event/transactional counter update with audit; do not physically delete a return request if it has influenced a quota.
- Draft-only deletion is permitted only before any child, ledger, external message or idempotency side effect exists.
- Define whether SET NULL is allowed for nullable actor links. For audit attribution, do not null an actor on user deletion; protected user rows are retained.
- Polymorphic links cannot be made safe by a vague RESTRICT statement; add source-specific FK strategy or documented service reconciliation.

## 6. High-priority schema design clarifications
1. Use stable explicit business keys for every child relationship; do not rely on FK to a non-unique column.
2. Add composite parent keys to prove same-parent consistency, not just existence of each referenced row.
3. Confirm the one-batch-per-receipt-line policy. If split receipts can happen, use allocation bridge now rather than retrofitting.
4. Define stock batch movement relationship and batch/medicine consistency at DB level.
5. Define invoice/encounter/patient and cashier/shift consistency.
6. Define return quota subject/line/component consistency at DB level and event history.
7. Define supplier payment allocation/supplier and supplier return/batch/invoice consistency.
8. Define reversal row semantics and self-FKs; clarify petty_cash_entries.reversed_by_entry_id target.
9. Add complete FK/index matrix with column names, types, nullability, unique parent key, child supporting index, delete/update action and business invariant.
10. Add sales_return_events to relationship map and table index catalogue.

## 7. Release status
- Table/domain coverage: reviewed statically.
- Exact FK matrix: NOT COMPLETE; blocker.
- Child FK index closure: NOT COMPLETE; blocker.
- Composite same-parent invariants: several candidates identified; not all specified in proposal.
- TiDB actual FK/index compatibility: NOT TESTED.
- DDL: NOT CREATED.
- Production/Firebase/main/PR13: UNCHANGED.

## 8. Next work package
Create a canonical column-level FK/index catalogue and reconcile it into schema proposal. Then run a second pass over exact column type/nullability compatibility, duplicate/ambiguous relationships and business-level orphan conditions. No DDL until those reviews and the TiDB compatibility spike are complete.
