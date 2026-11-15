# KEY TYPE, NULLABILITY AND CONCURRENCY CLOSURE AUDIT
Date: 2026-11-15
Branch: migration/tidb-foundation
Status: static design review; no DDL, no TiDB runtime tests.

## 1. Scope
Second pass over `MYSQL_MIGRATION_SCHEMA_PROPOSAL.md` after FK/index closure audit. Reviewed candidate PK/unique keys, ID types, nullable relationships, same-parent composite key requirements and race prevention mechanisms. Cross-checked the schema review and application concurrency test matrix.

## 2. Findings

### KEY-01 — queue assignment overlap has no concrete guard row (BLOCKER)
The proposal says assignment changes lock the user and prefix and reject overlapping validity ranges. A user row can serialize changes for the same user, but there is no stable parent/guard row for a prefix. Two different users can concurrently claim the same prefix and overlapping dates without contending on the same row. Add a `queue_prefix_guards(prefix PK, version, updated_at_utc)` (or equivalent fixed guard records for A/B) and lock both user and prefix guard in deterministic order. Then query overlap and write assignment + append-only assignment event in one transaction. A normal index cannot prevent interval overlap.

### KEY-02 — queue counter first-use race needs an explicit initialization algorithm (HIGH)
`queue_counters` has composite PK (business_date,prefix), but SELECT FOR UPDATE cannot lock a row that does not yet exist reliably across the first concurrent registration. Define one of:
- pre-create A/B counter rows for each business date in a serialized day-initialization command; or
- atomic INSERT ... ON DUPLICATE KEY UPDATE counter=counter+1 with a verified TiDB RETURNING/affected-row strategy; or
- insert-if-absent followed by a locking read, with duplicate-key retry tested.
Do not assume a missing-row/gap lock serializes the first ticket. Keep allocation idempotent and ticket insert + counter increment in one transaction.

### KEY-03 — unique composite parent keys still need to be made explicit (HIGH)
The proposal now names several parent keys, but the FK catalogue must add exact definitions where required:
- sales_invoice_lines UNIQUE(invoice_line_id,invoice_id) for invoice-scoped discount allocation and child ownership checks.
- sales_invoice_line_components UNIQUE(invoice_component_id,invoice_line_id) for component-to-line consistency.
- inventory_batches UNIQUE(batch_id,medicine_id) for medicine/batch consistency.
- supplier_invoice_lines UNIQUE(supplier_invoice_line_id,medicine_id) for receipt-line/batch/return consistency.
- supplier_payments UNIQUE(supplier_payment_id,supplier_id) and supplier_invoices UNIQUE(supplier_invoice_id,supplier_id) for same-supplier allocation checks.
- supplier_returns UNIQUE(supplier_return_id,supplier_invoice_id) for credit-note invoice consistency.
- cashier_shifts UNIQUE(shift_id,cashier_user_id) for all shift ownership composites.
- role_assignments UNIQUE(role_assignment_id,user_id) and user_emails UNIQUE(email_id,user_id), already identified.
These are candidate redundant unique keys on top of PKs, but are needed as referenced composite parent keys. Confirm TiDB accepts each FK shape in the actual compatibility spike.

### KEY-04 — nullable unique columns require explicit lifecycle semantics (MEDIUM)
Nullable unique keys are proposed for `inventory_batches.supplier_invoice_line_id` and legacy IDs. Multiple NULL values are expected for opening batches and records without legacy IDs. Confirm actual TiDB behavior in the preview cluster. For receipt lines, one non-NULL line may map to at most one batch. For legacy_id, scope uniqueness by source collection/system if IDs are not globally unique; do not use one global legacy_id unique across unrelated domains unless uniqueness is guaranteed.

### KEY-05 — queue ticket uniqueness and cancelled/reissued tickets need policy (MEDIUM)
UNIQUE(business_date,prefix,sequence_no) is appropriate for no duplicate display number. If a cancelled ticket can be reissued for the same encounter, a unique encounter_id would prevent a replacement; if multiple tickets per encounter are permitted, API needs a current-ticket slot/guard. Decide whether cancelled sequence numbers remain consumed (recommended) and whether a replacement creates a new ticket linked to the prior ticket rather than reusing the sequence.

### KEY-06 — actor and nullable relationship policy must be explicit (HIGH)
Nullable actor columns such as closed_by_user_id, verified_by_user_id, approved_by_user_id, decided_by_user_id and system audit actor need exact semantics:
- NULL means event genuinely has no human actor (system task/legacy unknown), not "we failed to capture it".
- Unknown legacy actor should remain unknown and be marked as such, not mapped to a fabricated user.
- System actors should use a dedicated actor_kind/system identity model or explicit actor_type, not an arbitrary fake staff account.
- Do not ON DELETE SET NULL for a known human actor; user rows are retained/deactivated and FK should RESTRICT.

### KEY-07 — polymorphic references are intentionally unenforceable by ordinary FKs (HIGH)
Fields such as inventory_movements.source_type/source_id, cash/bank ledger source_type/source_id, audit entity_type/entity_id, outbox aggregate_type/aggregate_id and stored file references cannot point to multiple table types with one FK. Define a typed source registry or per-domain nullable FKs/bridge tables where integrity is material. Otherwise every command must validate source existence, and reconciliation must detect orphan polymorphic references.

### KEY-08 — idempotency retention can conflict with retry guarantees (MEDIUM)
`idempotency_requests.expires_at_utc` is optional. Define minimum retention by command risk; invoice, return, refund, supplier payment and reversal keys should remain unique for at least the full audit/financial retention period or be protected by permanent domain-level unique command IDs. Never purge an idempotency row while a replay could still create a duplicate financial or stock effect.

### KEY-09 — return reservation state is not fully represented by counters alone (HIGH)
`reserved_quantity` and `approved_quantity` are aggregate counters. The design also needs an explicit reservation-to-return-line association and a deterministic release event/state for rejected/withdrawn requests. Ensure each return line is linked to exactly one quota subject and the reservation is released exactly once on rejection/cancellation; retries cannot decrement twice. The append-only sales_return_events records state transitions but must also record quota reservation/release effect or reference a separate quota event ledger.

### KEY-10 — active email claim key collation and normalization (MEDIUM)
`email_normalized` must be canonicalized by server (trim + lowercase with a specified Unicode policy) and compared deterministically. Choose explicit collation/charset and test case/diacritic behavior. Do not depend on database default collation to normalize identity.

### KEY-11 — active role slot needs scope semantics (MEDIUM)
The current slot is keyed only by user_id, while role_assignments includes scope_type/scope_id. If a user may have roles in multiple clinics or scopes, user_id PK enforces one role globally and conflicts with scope model. If clinic-only single-role is intended, constrain scope_type='clinic' and scope_id to the fixed clinic and document it; if multiple scopes are intended, key slot by (user_id,scope_type,scope_id). The clinic's current single-clinic roles suggest one clinic slot may be sufficient, but this is a schema policy decision.

### KEY-12 — one-to-one batch receipt link is a business assumption, not only a key design (HIGH)
UNIQUE(inventory_batches.supplier_invoice_line_id) enforces at most one batch per line. It does not prove one batch per line is operationally true. Confirm split receipts, separate expiry batches, supplier partial deliveries and multiple lot numbers. If any are possible, create supplier_invoice_line_batch_allocations now; don't force separate invoice lines to mimic actual receipt batches.

## 3. Additional index requirements
- Add queue_prefix_guards PK (prefix); queue assignment lookup/overlap index (prefix,valid_from,valid_to) and (user_id,valid_from,valid_to).
- Add queue_counters initialization path and index is already supplied by PK.
- Add indexes for all composite FK child tuples from the prior FK closure audit.
- Add `sales_return_quota_events(return_quota_subject_id,occurred_at_utc)` if quota reservation/release history is a separate append-only ledger.
- Add unique idempotency identifiers at domain boundary for queue ticket, invoice, return submission, payout and reversal even if generic idempotency rows are retained.
- Keep the existing FEFO index candidate (medicine_id,expiry_date,remaining_quantity) and confirm EXPLAIN after filtering active/eligible status; consider received_at_utc and batch_id deterministic tie-break fields in query order.
- Add invoice payment and cash/bank source lookup indexes only after workload EXPLAIN; do not index every low-selectivity status column blindly.

## 4. Updated release blockers
1. Canonical column-level FK/index matrix is still required.
2. Queue prefix assignment guard row and first-counter initialization algorithm must be specified.
3. All composite parent unique keys and same-parent FKs must be enumerated.
4. Return quota reservation/release must be auditable and idempotent.
5. Actor null/system semantics, email collation and role scope must be fixed.
6. Batch split/partial receipt behavior must be confirmed before schema freeze.
7. Actual TiDB FK, unique-null, locking and concurrency compatibility must be tested before DDL.

## 5. Status
- Static second-pass review: COMPLETE for proposal text.
- Runtime TiDB tests: NOT RUN.
- Schema DDL: NOT CREATED.
- Production/Firebase/main/PR13: UNCHANGED.
