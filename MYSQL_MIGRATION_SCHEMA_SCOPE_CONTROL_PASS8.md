# SCHEMA SCOPE CONTROL & ANTI-OVERFITTING REVIEW — PASS 8

Date: 2026-11-15  
Branch: `migration/tidb-foundation`  
Status: **DESIGN REVIEW ONLY — NO DDL / NO DATABASE MUTATION**

## 1. Purpose

This pass directly addresses the risk of overfitting/overengineering the schema. The target is not to model every imaginable future scenario. Schema v1 should support verified Klinik Assalaam workflows, preserve financial and inventory correctness, enforce essential ownership, and leave speculative capabilities outside the first release.

A design element is promoted to v1 only when supported by at least one of:
1. verified current application/source behavior;
2. explicit owner-confirmed business requirement;
3. a concrete integrity or concurrency defect that cannot safely be handled by a simpler existing constraint/transaction.

A hypothetical edge case by itself is not sufficient reason to add a table, discriminator, event stream, generic framework, or abstraction.

## 2. Scope rules to prevent overfitting

| Rule | Required practice | What is prohibited |
|---|---|---|
| Evidence first | Link each v1 table/column/constraint to source field, current workflow, owner requirement or necessary integrity invariant | Adding columns because they might be useful someday |
| Simplest adequate model | Prefer ordinary FK, UNIQUE, CHECK, and one transaction where sufficient | Generic registries or polymorphic frameworks without a demonstrated need |
| Keep history proportional | Preserve audit and financial events that support accountability/reconciliation | Duplicating every mutable field into multiple event tables without a consumer/use case |
| Do not prematurely generalize | Model one clinic, two queues A/B, and the confirmed roles | Multi-tenant, arbitrary queue counts, plugin role systems, or configurable workflows in v1 |
| Conditional table gate | Add support table only when workflow needs multiple rows/ownership or concurrency that cannot be safely represented otherwise | Creating a table solely because it appeared in an earlier speculative proposal |
| Explicit uncertainty | Mark unresolved fields/policies UNSPECIFIED or DEFERRED | Guessing NULL/default, inventing actor IDs, or fabricating source behavior |
| No premature optimization | Add indexes for PK/FK and evidenced query patterns; validate EXPLAIN later | Indexing every conceivable filter/sort combination |
| No premature runtime abstraction | Keep domain commands explicit and transactional | Generic event-sourcing/CQRS architecture unless required by demonstrated behavior |

## 3. Evidence classification for current candidates

### A. Core v1 — retain and finish exact definitions

These directly support required clinic workflows and financial/inventory integrity:

- users, user_emails, role_assignments, clinic_settings, display_configs;
- patients, patient_encounters, queue_counters, cashier_queue_assignments, queue_tickets, queue_call_events;
- cashier_shifts, active_shift_slots, shift_reconciliations, cash_ledger_entries, petty_cash_entries, expenses;
- medicines, tariffs, service_packages, package_components, suppliers, supplier_invoices, supplier_invoice_lines, inventory_batches, inventory_movements;
- sales_invoices, sales_invoice_lines, invoice_payments, sales_returns, sales_return_lines, refund_obligations, refund_payments, cancellation request/event records;
- supplier_returns, supplier_return_lines, supplier_credit_notes, supplier_payments, supplier_payment_allocations;
- audit_events and idempotency_requests.

This is a candidate retention list, not a claim that every field/constraint is finalized. A table remains subject to source mapping and workflow verification.

### B. Conditional — keep out of frozen v1 until necessity is demonstrated

| Candidate | Minimum evidence required before inclusion |
|---|---|
| active_email_claims | Demonstrate concurrent email replacement/claim race that cannot be safely prevented by a UNIQUE constraint plus transaction on user_emails |
| active_role_slots | Demonstrate need for a separate current-role slot beyond unique active assignment invariant; otherwise a simpler unique strategy may suffice |
| queue_prefix_guards | Retain only if tested concurrent A/B assignment/allocation needs explicit guard rows; otherwise use the simplest proven row-lock/counter approach |
| sales_return_events | Retain if each review/approval transition must be independently auditable; otherwise audit_events may cover the same required accountability without duplicate event storage |
| sales_return_quota_events | Retain only if reservation/release/consume/reversal history is a real requirement or necessary to make concurrent returns safe; otherwise transactional quota counters with audit/idempotency may suffice |
| supplier_invoice_line_batch_allocations | Required only if one invoice line can produce multiple partial deliveries/lots; verify actual purchasing workflow before adding |
| outbox_jobs | Include only if reliable asynchronous external side effects are in v1 (e.g. file/export/notification delivery); do not add merely as architectural fashion |
| stored_files, backup_jobs, export_jobs | Include when these capabilities are implemented in the migration release; otherwise defer to the feature release that owns them |
| stocktake_lines | Keep if stocktake workflow is part of v1 acceptance; otherwise do not invent a full stocktake subsystem from a table mention alone |
| patient_handoffs | Already marked optional/PR13-gated; exclude until PR13 workflow is approved and regression-tested |

The word “conditional” does not mean the feature is rejected. It means it must not silently become a v1 blocker without evidence and owner scope confirmation.

## 4. Specific source-dictionary issues found during review

These are concrete documentation/design issues, not reasons to invent additional abstractions:

1. **Encounter patient nullability:** Pass 4 records patient_encounters.patient_id as nullable while the business workflow expects a patient for a normal new visit. Define a narrowly scoped legacy/quarantine policy or make new encounters require patient identity; do not weaken every new encounter to accommodate hypothetical legacy rows.
2. **Encounter shift pair:** shift_id is nullable while cashier_user_id is NOT NULL. A composite FK alone does not prevent a partially populated pair in every engine path. Decide whether unshifted encounters are legitimate; if not, make shift_id required for new cashier-created encounters. If legacy exceptions exist, quarantine them explicitly.
3. **Invoice shift identity:** sales_invoices.shift_id and cashier_user_id are NOT NULL. Composite ownership to cashier_shifts is a high-value invariant and should be retained.
4. **Package component target:** medicine_id and tariff_id are both nullable. The component_type and exactly-one target rule must be aligned; do not add more target columns for unrequested service types.
5. **Supplier receipt split:** supplier_invoice_lines currently has medicine, quantity and optional batch/expiry data; inventory_batches references the invoice line but does not prove a one-to-one relationship. Do not impose UNIQUE(invoice_line_id) until owner/source confirms whether partial receipts or multiple lots are allowed.
6. **Supplier line dictionary anomaly:** Pass 4 includes both expiry_date and a separate raw `expiry date` entry, with malformed extraction around the final line. Resolve from the canonical proposal/source before DDL; do not carry both fields forward as if both were confirmed.
7. **Batch movement:** inventory_movements.batch_id is nullable while medicine_id is required. This may be valid for aggregate/non-batch movements. Preserve the possibility only if actual movement types require it; add a type-dependent rule only after enumerating those movement types.
8. **Return quota:** current quota table already has a stable surrogate return_quota_subject_id and non-null invoice_line_id, with nullable invoice_component_id. Do not add another subject registry or generic target table. First define the exact line-vs-component identity rule and matching composite key.
9. **Outbox provider:** Pass 4 records provider as raw `int` with unspecified null/default. Verify whether it is a real field or extraction artefact before schema freeze.
10. **Audit actor:** nullable actor_user_id is not sufficient to distinguish human/system/import/unknown. Add only the smallest explicit actor provenance fields needed by verified audit and migration flows; do not invent user records for system actors.

## 5. Priority ordering — protect correctness without scope creep

### P0 — must resolve before DDL
- Exact physical type and ordered tuple for every FK.
- Parent PK/UNIQUE and child index coverage.
- Encounter/shift and invoice/cashier/shift ownership.
- Medicine/batch/movement/allocation ownership.
- Return quota identity and over-return concurrency.
- Supplier return/credit/payment same-supplier ownership.
- Actor provenance for audit and required commands.
- NULL/default ambiguities that affect these constraints.

### P1 — include only if part of first operational release
- Stocktake workflow and its approval/variance handling.
- Full cancellation/return event history beyond the core audit log.
- Durable outbox and file/export/backup job orchestration.
- Partial supplier delivery allocation table, if confirmed by workflow.

### P2 — explicitly defer
- Multi-clinic tenancy.
- Arbitrary configurable queue topology.
- Generic polymorphic foreign-key framework.
- Generic workflow/state-machine engine.
- Event sourcing for every domain entity.
- Analytics warehouse, advanced search index, and speculative integrations.

## 6. Acceptance test principle

Tests should be derived from actual invariants and clinic scenarios, not from a combinatorial explosion of hypothetical inputs.

Minimum examples:
- two cashiers cannot own the same active shift slot;
- invoice cashier and shift must match;
- medicine sold from a batch cannot decrement a different medicine's batch;
- one return cannot exceed sold quantity after concurrent submissions;
- supplier return line must belong to the same supplier invoice and batch medicine;
- retrying the same payment/stock command cannot duplicate its effect;
- normal queue A and B allocation remains independent and sequential.

For each invariant, use one valid positive case and one or more targeted negative cases. Add boundary tests only where precision, rounding, date or concurrency semantics require them.

## 7. Decision protocol

For every conditional candidate, record one of:
- `IN_V1_EVIDENCED`
- `DEFERRED_NOT_REQUIRED_FOR_V1`
- `OWNER_DECISION_REQUIRED`
- `SOURCE_VERIFICATION_REQUIRED`

Do not turn an unresolved item into a guessed default. The owner should only be asked to decide business behavior that cannot be recovered from source code or existing explicit instructions. Technical implementation details remain engineering decisions.

## 8. Safety and result

This pass changes documentation only. No DDL, TiDB schema/data, Firebase/Auth, protected account, deployment, main branch or PR13 was changed.

**Outcome:** retain the minimum relational model required for the confirmed clinic workflows; treat speculative support tables as conditional; prioritize real ownership, money, stock, return and concurrency invariants. This is the guardrail against overfitting while preserving correctness.
