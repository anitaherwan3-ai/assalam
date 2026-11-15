# FOREIGN KEY / INDEX RECONCILIATION — PASS 2
Date: 2026-11-15
Branch: `migration/tidb-foundation`
Status: **STATIC RECONCILIATION ONLY — NOT DDL, NOT TiDB RUNTIME PROOF**

## 1. Scope and evidence

Compared the current `MYSQL_MIGRATION_SCHEMA_PROPOSAL.md` table definitions (sections 1–9 and 13), `MYSQL_MIGRATION_CANONICAL_FK_INDEX_CATALOGUE.md`, the data-type/nullability audit, the contradiction/source-identity audit, the key/concurrency audit, and the decision-closure draft.

This is a proposal-level reconciliation. Most table definitions are compact prose, not executable CREATE TABLE statements. Therefore exact physical FK type compatibility, generated index coverage, collation equality, engine support, and actual TiDB enforcement cannot be certified from these files. No live database metadata was read and no SQL was run.

## 2. Executive result

**Schema v1 remains BLOCKED.** The catalogue and proposal do not yet reconcile to a complete, exact, executable FK/index manifest. The following are confirmed design gaps in the documents:

1. The proposal's top-level convention still says `CHAR(36) or VARCHAR(64)` for user identity while the technical addendum selects `VARCHAR(64)`. The addendum must govern, and every actor FK must be explicitly enumerated as `VARCHAR(64)` with identical charset/collation.
2. The proposal's relationship table is domain-level only; it is not a physical FK list. Numerous composite parent keys and child indexes are described in later amendments but are not integrated into the individual table definitions.
3. Encounter-to-patient and encounter-to-shift/cashier semantics remain internally inconsistent: `patient_encounters.patient_id` and `shift_id` are nullable, although new encounters are expected to have a patient and valid cashier-owned open shift. A nullable composite FK cannot prove a partially populated ownership tuple.
4. Invoice-to-encounter/patient/shift/cashier same-parent integrity is not represented by a complete set of composite keys and child FKs.
5. Invoice component, batch allocation, return quota, supplier return, supplier credit and supplier payment same-parent constraints remain partly prose-only.
6. Queue guard and counter concurrency structures are specified in later amendments but `queue_prefix_guards` and assignment event structures are not integrated into the main table catalogue.
7. The one-batch-per-receipt-line UNIQUE rule remains in the main proposal even though split/partial receipt behavior is unresolved. It must not be frozen.
8. Several reversal references and polymorphic source references lack exact uniqueness/idempotency rules or typed source validation.
9. Candidate child indexes are missing or insufficiently explicit for several composite FKs and common reverse lookups.
10. The proposal still uses a `size_bytes INT UNSIGNED` for queue audio while stored files use `BIGINT UNSIGNED`; standardize to BIGINT UNSIGNED unless a validated hard cap is deliberately approved.

## 3. Column-level FK inventory: status by domain

The table below enumerates every relationship surfaced in the proposal/catalogue. “Candidate” means a relationship is identifiable; it does NOT mean the SQL FK/index has been fully specified or runtime-tested.

| Domain / child | FK columns → parent | Required child index / parent key | Reconciliation result |
|---|---|---|---|
| user_emails | user_id → users.user_id | (user_id,valid_to_utc); users PK | Candidate; user_id must be VARCHAR(64) |
| user_emails | changed_by_user_id → users.user_id | (changed_by_user_id) | Actor NULL/system semantics unresolved |
| active_email_claims | user_id → users.user_id | UNIQUE(user_id) | Candidate |
| active_email_claims | (email_id,user_id) → user_emails(email_id,user_id) | UNIQUE(email_id,user_id) parent; matching child tuple | Parent key described; exact child index/FK DDL absent |
| role_assignments | user_id, granted_by_user_id → users | (user_id,valid_to_utc), (granted_by_user_id) | Candidate; granted_by NOT NULL conflicts with explicit system/import actor model unless service principal is represented |
| active_role_slots | user_id → users; (role_assignment_id,user_id) → role_assignments | PK(user_id); composite child index; UNIQUE(role_assignment_id,user_id) | Composite relationship described; exact FK list absent |
| clinic_settings / display_configs / queue_audio_assets | updated_by_user_id → users | one index per actor FK | Candidate; system-seed actor policy unresolved |
| patient_encounters | patient_id → patients | (patient_id,business_date) | BLOCKED: nullable patient conflicts with required new-visit policy; legacy nulls need quarantine/exception |
| patient_encounters | cashier_user_id → users | (cashier_user_id,business_date) | Candidate |
| patient_encounters | (shift_id,cashier_user_id) → cashier_shifts | UNIQUE(shift_id,cashier_user_id); same-order child index | BLOCKED: shift_id nullable while cashier_user_id NOT NULL; define all-null/all-present or historical exception |
| cashier_queue_assignments | user_id, assigned_by_user_id → users | (user_id,valid_from,valid_to), (assigned_by_user_id) | Candidate; no DB FK can prevent interval overlap |
| cashier_queue_assignments | prefix → queue_prefix_guards | prefix guard PK | BLOCKED: guard table absent from base proposal; add explicit table and assignment event ledger |
| queue_tickets | encounter_id → patient_encounters | (encounter_id); optional UNIQUE only if one ticket ever | BLOCKED: current-ticket/reissue cardinality not frozen |
| queue_tickets | registered_by_user_id → users | (registered_by_user_id) | Candidate |
| queue_call_events | queue_ticket_id → queue_tickets; actor_user_id → users | (queue_ticket_id,occurred_at_utc), (actor_user_id) | Candidate; system actor provenance unresolved |
| cashier_shifts | cashier_user_id, closed_by_user_id → users | (cashier_user_id,business_date,status), (closed_by_user_id) | Candidate; closed_by nullable until close |
| active_shift_slots | cashier_user_id → users; (shift_id,cashier_user_id) → cashier_shifts | PK(cashier_user_id), UNIQUE(shift_id,cashier_user_id) parent | Composite parent key described; lifecycle release evidence/version still unresolved |
| shift_reconciliations | shift_id → cashier_shifts; verified_by_user_id → users | UNIQUE(shift_id), (verified_by_user_id) | BLOCKED: UNIQUE(shift_id) conflicts with retained correction/version history unless immutable version model added |
| cash_ledger_entries | shift_id → cashier_shifts; actor_user_id → users; reversal_of_entry_id → self | (shift_id,occurred_at_utc), (actor_user_id,occurred_at_utc), (reversal_of_entry_id) | Shift null scope and reversal cardinality unresolved; source_type/source_id needs durable uniqueness |
| bank_ledger_entries | actor_user_id → users; reversal_of_entry_id → self | (actor_user_id,occurred_at_utc), (reversal_of_entry_id) | Reversal cardinality unresolved |
| petty_cash_entries | cashier_user_id → users; (shift_id,cashier_user_id) → cashier_shifts | (cashier_user_id,business_date), composite child index | Composite parent key described; exact tuple and reversal relation missing |
| expenses / expense_events | created_by/approved_by/actor_user_id → users; expense_id → expenses | actor indexes; (expense_id,occurred_at_utc) | Candidate; creator/approver separation policy D08 open |
| loss_events | medicine_id → medicines; (batch_id,medicine_id) → inventory_batches; reversal_of_loss_id → self | (medicine_id,occurred_at_utc), (batch_id,medicine_id), reversal index | BLOCKED: composite parent UNIQUE and reversal cardinality not fully integrated |
| package_components | package_id → service_packages; medicine_id/tariff_id → masters | (package_id,sort_order), one index per optional target | Exactly-one target by component_type remains API/CHECK gate |
| supplier_invoices | supplier_id → suppliers; created_by_user_id → users | (supplier_id,invoice_date), actor index | Candidate |
| supplier_invoice_lines | supplier_invoice_id → supplier_invoices; medicine_id → medicines | (supplier_invoice_id,medicine_id), (medicine_id) | Candidate; composite supplier+invoice ownership key needed downstream |
| inventory_batches | medicine_id → medicines; supplier_invoice_line_id → supplier_invoice_lines | (medicine_id,expiry_date,remaining_quantity); receipt-line key | BLOCKED: unique one-batch-per-line not approved; add allocation bridge if split/partial receipt possible |
| inventory_batches | (supplier_invoice_line_id,medicine_id) → supplier_invoice_lines | UNIQUE(supplier_invoice_line_id,medicine_id) parent; matching child index | BLOCKED until split receipt design and nullable tuple semantics resolved |
| inventory_movements | medicine_id → medicines; batch_id → inventory_batches; (batch_id,medicine_id) composite; actor_user_id → users; reversal_of_movement_id → self | (medicine_id,occurred_at_utc), (batch_id,medicine_id,occurred_at_utc), actor/reversal indexes | BLOCKED: batch optional but medicine required; all-null/all-present pair and batch-medicine match must be enforced |
| stocktakes | created_by_user_id / approved_by_user_id → users | separate actor indexes | Candidate |
| stocktake_lines | stocktake_id → stocktakes; medicine_id → medicines; (batch_id,medicine_id) → inventory_batches | (stocktake_id), (medicine_id), composite child index | BLOCKED: nullable batch tuple semantics and composite parent key need integration |
| sales_invoices | encounter_id → patient_encounters; patient_id → patients; cashier_user_id → users; (shift_id,cashier_user_id) → cashier_shifts; cancelled_by_user_id → users | (encounter_id), (patient_id,business_date), (cashier_user_id,business_date), composite child index | BLOCKED: same encounter/patient and shift/cashier identity not physically tied together |
| sales_invoice_lines | invoice_id → sales_invoices; medicine_id/tariff_id/package_id → masters | UNIQUE(invoice_id,line_no), UNIQUE(invoice_line_id,invoice_id) parent, target indexes | BLOCKED: parent composite key missing from table definition; target cardinality requires command/CHECK |
| sales_invoice_line_components | invoice_line_id → sales_invoice_lines; medicine_id/tariff_id → masters | UNIQUE(invoice_line_id,component_no), UNIQUE(invoice_component_id,invoice_line_id) parent | BLOCKED: component-to-line composite key not integrated |
| invoice_batch_allocations | invoice_line_id / invoice_component_id → invoice line/component; batch_id → inventory_batches; movement_id → inventory_movements | child indexes for every FK; composite parent keys | BLOCKED: nullable line/component alternatives, component-line match and batch medicine match not enforceable from current independent refs |
| invoice_discount_allocations | invoice_id / invoice_line_id → invoice and line | UNIQUE(invoice_id,invoice_line_id); parent UNIQUE(invoice_line_id,invoice_id) | BLOCKED: same-invoice ownership composite absent from table definitions |
| invoice_payments | invoice_id → sales_invoices; actor_user_id → users | (invoice_id), (actor_user_id) | Candidate; split tender/partial payment policy unresolved |
| sales_returns | invoice_id → sales_invoices; requested/admin/final actor IDs → users | (invoice_id,status), separate actor indexes | Candidate; actor nullability/state matrix not frozen |
| sales_return_lines | sales_return_id → sales_returns; quota subject/line/component → quota subject and invoice structures | (sales_return_id), quota/line/component indexes and composite parent keys | BLOCKED: multiple independent IDs can disagree; exact composite chain required |
| return_quota_subjects | invoice_line_id → sales_invoice_lines; invoice_component_id → components | typed unique parent key and component-line composite | BLOCKED: nullable component and derived quota_key require tested uniqueness/null semantics |
| sales_return_events | sales_return_id → sales_returns; actor_user_id → users | (sales_return_id,occurred_at_utc), actor index | Candidate; add to all canonical FK/index docs |
| sales_return_quota_events | quota subject, return line, actor/event provenance | indexes by subject/return line/event idempotency | BLOCKED: proposed in decision draft but absent from base table definitions and catalogue |
| refund_obligations | sales_return_id → sales_returns; approved_by_user_id → users | UNIQUE(sales_return_id), actor index | Candidate; amount_paid must be projection of refund_payments |
| refund_payments | refund_obligation_id → refund_obligations; paid_by_user_id → users | (refund_obligation_id,paid_at_utc), actor index | Candidate; lock/idempotency must prevent overpayment |
| invoice_cancellation_requests | invoice_id → sales_invoices; requested/decided actors → users | (invoice_id,status), actor indexes | Candidate |
| invoice_cancellation_events | cancellation_request_id → requests; actor_user_id → users | (cancellation_request_id,occurred_at_utc), actor index | Candidate |
| supplier_returns | supplier_invoice_id → supplier_invoices; requested/approved actors → users | (supplier_invoice_id,status), actor indexes | Candidate |
| supplier_return_lines | supplier_return_id → supplier_returns; supplier_invoice_line_id → supplier_invoice_lines; batch_id → inventory_batches | indexes for each FK and composite ownership tuples | BLOCKED: must prove return→invoice, receipt line→invoice+medicine, batch→same medicine/receipt line |
| supplier_credit_notes | supplier_return_id → supplier_returns; supplier_invoice_id → supplier_invoices | UNIQUE(supplier_return_id), (supplier_invoice_id) | BLOCKED: credit note invoice must equal return invoice; composite parent key required |
| supplier_payments | supplier_id → suppliers; paid_by_user_id → users | (supplier_id,payment_date), actor index; UNIQUE(payment_id,supplier_id) parent | Candidate; composite parent key absent in base table definition |
| supplier_payment_allocations | supplier_payment_id → supplier_payments; supplier_invoice_id → supplier_invoices | UNIQUE(payment_id,invoice_id), composite same-supplier FKs | BLOCKED: no same-supplier guarantee; add parent composite keys and two composite child FKs |
| audit_events | actor_user_id → users | (actor_user_id,occurred_at_utc) | BLOCKED: nullable actor needs actor_kind/provenance; no fake user or silent NULL |
| idempotency_requests | actor_user_id → users | UNIQUE(actor,command,key) | Candidate; system commands need explicit principal strategy |
| stored_files | created_by_user_id → users | (created_by_user_id,created_at_utc) | Candidate |
| backup_jobs | initiated_by_user_id → users | (initiated_by_user_id) | Candidate; NULL only for explicit scheduled system actor |
| export_jobs | requested_by_user_id → users | (requested_by_user_id,created_at_utc) | Candidate |
| outbox_jobs | aggregate_type/aggregate_id | typed source registry or validated polymorphic resolver | Intentionally polymorphic; no ordinary FK, reconciliation resolver required |

## 4. Parent composite key checklist

These parent keys must be present exactly and in the same column order as child FKs:

- user_emails(email_id,user_id)
- role_assignments(role_assignment_id,user_id)
- cashier_shifts(shift_id,cashier_user_id)
- patient_encounters(encounter_id,patient_id) where invoice patient equality is represented relationally
- patient_encounters(encounter_id,shift_id,cashier_user_id) or a documented alternative proving invoice/encounter shift and cashier agreement
- supplier_invoice_lines(supplier_invoice_line_id,medicine_id)
- inventory_batches(batch_id,medicine_id)
- sales_invoice_lines(invoice_line_id,invoice_id)
- sales_invoice_line_components(invoice_component_id,invoice_line_id)
- return_quota_subjects(return_quota_subject_id,invoice_line_id,invoice_component_id) only if nullable component semantics are safely represented; otherwise split typed subject tables or a non-null subject discriminator/key
- supplier_payments(supplier_payment_id,supplier_id)
- supplier_invoices(supplier_invoice_id,supplier_id)
- supplier_returns(supplier_return_id,supplier_invoice_id)

Every parent tuple must have a matching child index beginning with the same ordered FK columns. Avoid inventing nullable composite uniqueness behavior; prove it against the actual TiDB version or redesign to non-null typed keys.

## 5. Missing or insufficient child indexes to add to the exact manifest

At minimum verify/add these ordered indexes, in addition to the per-domain indexes above:

- patient_encounters(shift_id,cashier_user_id)
- sales_invoices(shift_id,cashier_user_id)
- petty_cash_entries(shift_id,cashier_user_id)
- active_shift_slots(shift_id,cashier_user_id)
- inventory_movements(batch_id,medicine_id,occurred_at_utc)
- loss_events(batch_id,medicine_id)
- stocktake_lines(batch_id,medicine_id)
- invoice_batch_allocations(batch_id,medicine_id) where the composite batch/medicine relationship is stored; otherwise add medicine_id and derive through a typed allocation record
- invoice_discount_allocations(invoice_id,invoice_line_id)
- sales_return_lines(return_quota_subject_id,invoice_line_id,invoice_component_id) if tuple modeled directly
- supplier_return_lines(supplier_return_id,supplier_invoice_line_id,batch_id)
- supplier_payment_allocations(supplier_payment_id,supplier_id) and (supplier_invoice_id,supplier_id)
- sales_return_events(sales_return_id,occurred_at_utc)
- sales_return_quota_events(return_quota_subject_id,occurred_at_utc), plus unique idempotency/event association indexes
- self-FK indexes for cash, bank and inventory movement reversal columns.

These are candidates, not blindly mandatory indexes: the final DDL must align exact FK leading columns, query patterns and TiDB EXPLAIN plans.

## 6. Specific corrections required before schema v1 freeze

### FK-2-01 — Canonical user key
Update section 1 convention to state only `VARCHAR(64)`. Every user/actor FK must match its charset/collation. Add an automated source scan to ensure no `CHAR(36)` user FK remains.

### FK-2-02 — Encounter lifecycle
For new encounters require patient and open shift/cashier ownership. Choose either NOT NULL patient_id + NOT NULL shift_id with composite FK, or a separate explicit legacy exception/quarantine relation. Do not allow half-null (shift_id,cashier_user_id) tuples.

### FK-2-03 — Invoice ownership chain
Add composite parent keys and child FKs proving invoice.encounter_id + patient_id + shift_id + cashier_user_id all agree with the encounter and shift. If patient_id is only an immutable invoice snapshot, name it as snapshot and document reconciliation instead of pretending it is a master FK.

### FK-2-04 — Batch receipt model
Do not retain UNIQUE(inventory_batches.supplier_invoice_line_id) as frozen v1 design until owner/source workflow confirms one batch per receipt line. If split delivery/lot/expiry is possible or uncertain, add supplier_invoice_line_batch_allocations in v1; batch must still point to one receipt allocation with exact medicine and source invoice.

### FK-2-05 — Allocation target cardinality
Invoice batch allocation must reference exactly one of direct invoice line or package component. Component must belong to the line; batch medicine must match the medicine on the selected line/component; movement must be a sale deduction for that same batch and quantity. Encode with typed allocation subtype or composite FKs plus server negative tests; don't rely on independent FKs.

### FK-2-06 — Return quota typed identity
Do not rely on nullable component_id + string quota_key alone as relational proof. Consider separate line-level and component-level quota subject tables or a non-null typed subject key with composite parent relationships. Return line must reference exactly one quota subject and prove its line/component identity. Quota reserve/release/consume/reversal events need their own append-only table and idempotent unique keys.

### FK-2-07 — Supplier ownership chain
Add supplier_id to payment allocation relationship via composite FKs. Supplier return line must prove same invoice, receipt line, medicine and batch. Credit note must prove its invoice is the return's invoice.

### FK-2-08 — Actor provenance
Use explicit actor_kind and service principal semantics for system/import/unknown legacy actors. Human actor FKs are RESTRICT. Never use arbitrary NULL to mean system or missing data.

### FK-2-09 — Queue physical structures
Add queue_prefix_guards and append-only assignment events to the main table list and FK/index catalogue. Queue counter initialization must be race-safe. Do not add UNIQUE(encounter_id) until ticket reissue policy is tested.

### FK-2-10 — Reversal cardinality and source idempotency
For each reversal_of_* field decide one full reversal vs multiple partial reversals. Add unique source-event keys or typed source registry where replay could duplicate cash, stock or bank effects. Polymorphic fields remain service-enforced and require orphan reconciliation.

### FK-2-11 — Reconciliation versioning
Replace shift_reconciliations UNIQUE(shift_id) with immutable reconciliation_versions/events or define one current row plus append-only revisions. Never overwrite verified evidence.

### FK-2-12 — Audio size type
Standardize queue_audio_assets.size_bytes and stored_files.size_bytes to BIGINT UNSIGNED, with API/storage hard limits checked before insert.

## 7. SQL/TiDB test cases to add (not executed)

- FK child/parent type mismatch: signedness, width, varchar length, charset/collation.
- Each composite FK: valid tuple, wrong-parent tuple, partial-NULL tuple.
- FK RESTRICT delete and immutable key update behavior.
- Every nullable unique parent and child key with multiple NULLs and duplicate non-NULLs.
- Batch receipt split: one invoice line → two batches with different expiry/lot.
- Invoice direct medicine allocation vs package component allocation, including wrong component parent.
- Return quota line vs package component and mismatched subject/line rejection.
- Supplier payment allocation to another supplier and supplier return batch from another invoice.
- Queue prefix overlapping assignment race and simultaneous first counter creation.
- Duplicate/replayed reversal and source event; ensure one financial/stock effect only.
- Reconciliation correction creates new immutable version.
- Verify all FK child indexes with metadata queries and EXPLAIN on realistic synthetic data.

## 8. Release status

- Static proposal/catalogue cross-check completed for the currently documented tables.
- Exact physical FK/type/index manifest: **NOT COMPLETE** because definitions are prose and exact charset/collation/defaults/ON DELETE/UPDATE are absent.
- Historical orphan/duplicate scan: NOT RUN; no production or dummy operational records were queried.
- TiDB FK/index/nullable-unique/transaction runtime tests: NOT RUN.
- DDL generation/application: NOT AUTHORIZED.
- Firebase/Auth snapshot or cleanup: NOT performed.
- Production Vercel/Firebase/main/PR #13: unchanged.

Next safe task: convert the proposal to a normalized column dictionary and exact FK manifest (one record per FK column tuple), resolve split supplier receipt and owner policy gates, then run the controlled TiDB compatibility spike only after the preview package is complete and deployment quota permits.


## 10. Correction from pass 3

The current proposal has been corrected: user_id is VARCHAR(64). The CHAR(36) occurrence in audit_events is event_uuid, not a user identifier. The pass-2 statement describing a remaining CHAR(36) user-key convention is stale and superseded by [MYSQL_MIGRATION_NORMALIZED_COLUMN_DICTIONARY_FK_MANIFEST_PASS3.md](./MYSQL_MIGRATION_NORMALIZED_COLUMN_DICTIONARY_FK_MANIFEST_PASS3.md). Likewise, size_bytes is now BIGINT UNSIGNED and one-batch-per-receipt-line uniqueness is explicitly not approved. The original pass-2 report is retained as historical audit evidence, not current canonical state.
