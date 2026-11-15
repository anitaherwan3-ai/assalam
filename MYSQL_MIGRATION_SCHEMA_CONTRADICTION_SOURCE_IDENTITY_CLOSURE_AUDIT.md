# SCHEMA CONTRADICTION & SOURCE-IDENTITY CLOSURE AUDIT
Date: 2026-11-15
Branch: migration/tidb-foundation
Status: STATIC DESIGN REVIEW — NO DDL, NO HISTORICAL DATA ACCESS

## Executive decision
Schema v1 is still not ready for DDL. This pass cross-checked the detailed table definitions (proposal sections 1–15), canonical FK candidate catalogue, legacy compatibility audit, relational integrity audit and finance/inventory rules. It found concrete conflicts and omissions that should be corrected before generating executable SQL.

## A. Concrete contradictions and corrections

| ID | Severity | Current proposal | Required correction / acceptance gate |
|---|---|---|---|
| SC-01 | BLOCKER | Many domain tables declare `legacy_id VARCHAR(128) NULL UNIQUE` (patients, encounters, tickets, shifts, petty, expense, medicine, tariff, package, supplier, supplier invoice, batch, invoice, return, supplier return). | Remove global uniqueness from each legacy_id unless proven globally unique. Introduce source identity map with UNIQUE(source_system, source_collection, source_document_id), source hash, target type/id, migration batch and disposition. Keep source IDs as ordinary values. |
| SC-02 | BLOCKER | `patients.legacy_id` and other per-table unique legacy IDs imply same ID namespace across all source collections. | Firebase document IDs are collection-scoped. Mapping key must include collection/path. Duplicate detection must report cross-collection collisions, not merge records. |
| SC-03 | BLOCKER | `patient_encounters.patient_id` nullable and `sales_invoices.patient_id` nullable; encounter/invoice patient equality is stated only informally. | New workflow patient requirement must be NOT NULL if clinic confirms; legacy unresolved links go to quarantine. If invoice patient is denormalized for query, composite FK (encounter_id,patient_id) or service invariant must prove same patient. Define explicit snapshot vs FK semantics. |
| SC-04 | BLOCKER | `patient_encounters.shift_id` nullable; cashier_user_id NOT NULL. Candidate FK catalogue does not define nullable-pair semantics. | New encounter requires valid open shift and same cashier; legacy rows without shift must be quarantined or explicit historical exception table. Composite FK cannot be partially nullable. |
| SC-05 | BLOCKER | `sales_invoices.shift_id NOT NULL`, cashier_user_id NOT NULL; encounter shift/cashier may differ unless composite relation is enforced. | Add UNIQUE(encounter_id,shift_id,cashier_user_id) or explicit command invariant; ensure invoice's encounter, shift and cashier all agree. Define whether management/legacy invoice may be shiftless. |
| SC-06 | HIGH | `queue_tickets.encounter_id` has only optional UNIQUE if one ticket/encounter confirmed. | Define one-ticket-per-encounter vs reissue model. If reissue is allowed, retain ticket history and enforce one active ticket using serialized guard/active-ticket slot, not an unsupported partial unique index. |
| SC-07 | BLOCKER | `cashier_queue_assignments` overlap prevention is procedural; prefix guard introduced in concurrency audit but not integrated as physical table definition. | Add queue_prefix_guards and append-only assignment events; lock user and prefix guard in deterministic order; unique/overlap rule tested under concurrent A/B assignment. |
| SC-08 | BLOCKER | `queue_counters` first-use row race unresolved in physical definition. | Preseed A/B counters per business date or implement atomic insert-on-duplicate increment with duplicate-key retry. No SELECT FOR UPDATE on absent row assumption. |
| SC-09 | BLOCKER | `inventory_batches.supplier_invoice_line_id UNIQUE NULL` assumes one receipt line creates exactly one batch. | Owner/source proof required. If a receipt line can split by expiry/batch, use supplier_invoice_line_batch_allocations bridge. Do not freeze one-to-one without evidence. |
| SC-10 | BLOCKER | `invoice_batch_allocations` contains invoice_line_id NOT NULL and invoice_component_id NULL, but no exact same-line component FK. | Add composite parent key on components (invoice_component_id,invoice_line_id); allocation must point either to direct medicine line or component, and batch medicine must match exact sold medicine. Define allowed NULL tuple states. |
| SC-11 | BLOCKER | `return_quota_subjects` has nullable invoice_component_id and separate invoice_line_id; `quota_key` is string-derived. | Define typed subject representation with stable unique parent tuple. Component must belong to invoice_line_id. For package medicine, component required; for service/non-package line, component must be NULL. Test nullable composite uniqueness on TiDB. |
| SC-12 | BLOCKER | `sales_return_lines` stores quota subject, invoice line and optional component independently. | Composite FK(s) must prove return line's quota subject, invoice line and component are the same subject. Reject mismatched IDs at API and in relational constraints where possible. |
| SC-13 | HIGH | `refund_obligations.amount_paid` is a mutable aggregate alongside append-only `refund_payments`. | Define amount_paid as reconciled projection only; compute/verify SUM(refund_payments) = amount_paid in transaction or remove mutable duplicate. Prevent payout over obligation under row lock + idempotency. |
| SC-14 | BLOCKER | `supplier_payment_allocations` has separate payment and invoice FKs; same-supplier rule only in prose. | Add UNIQUE(supplier_payment_id,supplier_id) and UNIQUE(supplier_invoice_id,supplier_id) parent keys and composite allocation FKs, or mandatory transaction invariant with negative tests. |
| SC-15 | BLOCKER | `supplier_return_lines` has independent supplier_return, invoice_line and batch refs. | Add composite keys linking supplier return→invoice, invoice line→invoice+medicine, batch→medicine and batch→receipt line; line must prove same supplier invoice, medicine and batch. |
| SC-16 | HIGH | `supplier_credit_notes` separately references supplier_return and supplier_invoice. | Composite FK or service invariant must prove credit note invoice equals supplier return invoice; one credit note per return remains candidate pending workflow. |
| SC-17 | HIGH | `source_type/source_id`, `aggregate_type/aggregate_id`, audit entity references are polymorphic and not ordinary FKs. | Document each permitted type and resolver. For critical ledger source uniqueness use typed source registry or source-specific unique bridge. Reconciliation must find orphan source references. |
| SC-18 | HIGH | `queue_audio_assets.size_bytes INT UNSIGNED` while stored_files uses BIGINT UNSIGNED. | Decide whether both represent bounded object sizes; use one canonical BIGINT UNSIGNED if shared upload pipeline, or document validated hard cap and reject oversize before insert. |
| SC-19 | HIGH | `invoice_number` uniqueness scope/date unresolved; supplier invoice number may duplicate by supplier. | Freeze unique scope from actual app semantics: clinic/date/series for sales; supplier_id + normalized supplier invoice number for purchases only if source/business confirms. |
| SC-20 | HIGH | Status, role, source, movement, payment, disposition and account fields are free-form VARCHAR. | Create versioned code dictionary and transition matrix; preserve unknown legacy values in quarantine, never coerce silently. |
| SC-21 | HIGH | `created_by_user_id` / actor fields have inconsistent NULL conventions; role grant actor is NOT NULL while backup actor may be NULL. | Define actor_kind (human/system/import) and nullable FK semantics. Prefer explicit system principal row for new events; preserve unknown historical actor as unknown, not fabricated user. |
| SC-22 | HIGH | BIGINT money columns have no explicit bounds or overflow rules; BIGINT values risk JS precision loss. | Freeze business max/min and enforce BigInt on server, decimal-string JSON transport, mysql2 supportBigNumbers + bigNumberStrings. Reject overflow before write. |
| SC-23 | HIGH | Several mutable balances (medicine.stock_on_hand, batch.remaining_quantity, supplier invoice accepted_credit_amount, refund amount_paid) duplicate append-only ledgers. | Mark each as projection with single writer, version/lock, deterministic rebuild query and reconciliation alert. Never accept browser-provided projection value. |
| SC-24 | HIGH | `loss_events.reversal_of_loss_id`, ledger reversal IDs and movement reversal IDs do not specify unique reversal cardinality. | Add unique reversal_of_* constraint if one reversal per source is intended; otherwise model partial reversal allocation with amount/quantity ceiling and idempotent events. |
| SC-25 | HIGH | `shift_reconciliations.shift_id UNIQUE` conflicts with correction/version history requirement if corrected reconciliation must be retained. | Decide immutable first reconciliation + reconciliation_versions/events, or one current row plus append-only revisions. Do not overwrite verified evidence. |
| SC-26 | HIGH | `active_shift_slots` delete-on-close can lose evidence of slot release and may race retry. | Record slot state/version or release event; shift close, slot release, ledger and audit must commit atomically; test replay and crash recovery. |
| SC-27 | HIGH | `invoice_discount_allocations UNIQUE(invoice_id,invoice_line_id)` but FK ownership not enforced by independent refs. | Parent unique(invoice_line_id,invoice_id) and composite child FK required. Persist deterministic rounding rank and test sum equals invoice discount. |
| SC-28 | HIGH | `invoice_payments` uses amount_received, amount_applied and change_amount but split-tender, partial payment and payment state are unresolved. | Define constraints amount_received = amount_applied + change_amount where applicable, multiple payment rows, refund/change semantics, non-cash settlement status and ledger timing. |
| SC-29 | HIGH | `cash_ledger_entries` can have nullable shift_id while actor is required; source_type/source_id is not unique as a pair. | Define which management receipts/refunds can be shiftless; add source-event idempotency unique key across account/direction/type, or typed source bridge; ensure reversal is exactly-once. |
| SC-30 | BLOCKER | Timestamp conversion relies on DATETIME(3) UTC while D17 says source timestamps may be local, UTC, epoch milliseconds or timezone-less. | Preserve raw source value + source format + source timezone confidence + normalized UTC + conversion rule/version. Ambiguous values quarantine; do not derive UTC by guessing. |

## B. Cross-cutting exact type rules to apply in the column manifest

1. Every BIGINT UNSIGNED PK must have every referencing FK exactly BIGINT UNSIGNED (not signed BIGINT).
2. Every user_id FK must use exactly VARCHAR(64), same charset/collation; email is never an FK.
3. Every FK referencing composite parent keys must match column order and type exactly.
4. Every text unique/index key needs explicit collation and TiDB index-byte compatibility proof.
5. Every nullable composite FK must define all-null or all-non-null tuple; partial NULL tuple rejected.
6. Every decimal quantity column must share approved unit/scale/rounding policy; do not mix implicit package/strip/tablet scales.
7. All monetary values are signed BIGINT rupiah integer, server BigInt only; API serializes as decimal strings.
8. DATETIME(3) fields are UTC by contract, with raw source timestamp preserved separately for migrated records.
9. TINYINT(1) is not a sufficient API boolean validator; accept only explicit true/false and store 0/1.
10. Every VARCHAR length is a provisional cap until full source union/max-length profiling; API rejects overlength, never truncates.

## C. Source identity map required for safe ETL

Candidate table `migration_source_records` (review only, not DDL):
- migration_source_record_id BIGINT UNSIGNED PK
- source_system VARCHAR(32) NOT NULL
- source_collection VARCHAR(128) NOT NULL
- source_document_id VARCHAR(128) NOT NULL
- source_document_path VARCHAR(512) NOT NULL
- source_hash CHAR(64) NOT NULL
- target_entity_type VARCHAR(64) NULL
- target_entity_id VARCHAR(100) NULL
- migration_batch_id VARCHAR(64) NOT NULL
- disposition VARCHAR(24) NOT NULL (mapped/quarantined/ignored/reviewed)
- quarantine_reason_code VARCHAR(80) NULL
- first_seen_at_utc DATETIME(3) NOT NULL
- UNIQUE(source_system,source_collection,source_document_id)
- INDEX(target_entity_type,target_entity_id), INDEX(migration_batch_id,disposition)

Rules:
- No source record silently disappears. Every source document is mapped, explicitly ignored with reason, or quarantined.
- Same source tuple + same hash is idempotent; same tuple + changed hash requires controlled re-evaluation.
- Never merge patients by name/phone automatically.
- Preserve raw source path, hash and original timestamp values.
- The map does not contain patient PII payload; sensitive payload remains in protected staging with separate access controls.

## D. Required synthetic negative tests
- Two collections with same Firestore document ID both map independently.
- Same collection/document ID replay same hash (no duplicate); changed hash (review conflict).
- Patient A invoice with encounter B rejected.
- Cashier A invoice on cashier B shift rejected.
- Invoice batch allocation references package component from another line rejected.
- Return quota subject references wrong invoice component rejected.
- Supplier payment allocated to another supplier's invoice rejected.
- Supplier return line references batch from another purchase invoice rejected.
- Credit note references another invoice rejected.
- Partial NULL composite FK rejected.
- Queue assignment A/B overlap races serialize.
- First queue counter initialization races safely.
- One approved refund cannot be paid twice by replayed idempotency key.
- Reconciliation correction preserves first verified snapshot.
- Duplicate ledger source event rejected.
- Unknown legacy status/timestamp preserved and quarantined.
- Owner user cannot be deleted, deactivated, demoted or replaced by restore.

## E. Work and limits
This is a static source/schema consistency audit only. No production Firebase reads, no real patient data, no export, no DDL, no TiDB runtime tests, no deployment. It is not evidence that any listed anomaly exists in current clinic data.
