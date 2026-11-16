# FK FIELD-LEVEL EXPANSION & CARDINALITY CORRECTION — PASS 7

Date: 2026-11-15  
Branch: `migration/tidb-foundation`  
Status: **STATIC DOCUMENT RECONCILIATION ONLY — NOT DDL / NOT TiDB RUNTIME VALIDATION**

## 1. Material correction to Pass 6

Pass 6's statement that the Pass 3 manifest contains 99 entries (F01–F99) is incorrect. A fresh line-by-line read of the current Pass 3 file finds **104 numbered rows, F01–F104**. The earlier 99-row extraction was truncated before F100–F104. Consequently, Pass 6's assertion that the count discrepancy was merely grouped rows is incomplete and its 99-row inventory must not be used as a source of truth.

The earlier prose count of 104 candidate relationships happens to equal the number of numbered rows, but that does **not** establish that it equals the number of individual FK tuples: ten rows group actor or polymorphic relationships. Expanding those groups adds 12 additional tuple candidates, giving **116 candidate FK tuples** on a literal expansion basis. This is a candidate count, not an approved/enforceable SQL constraint count. F63/F65 are nullable polymorphic alternatives and F76's former undefined composite candidate is normalized in Pass 30 to a scalar FK on the mandatory return_quota_subject_id. The service must still verify invoice_line_id and nullable invoice_component_id against the referenced subject in the same transaction; the nullable component is not used as proof of ownership.

## 2. Reproducible cardinality

| Measure | Count | Meaning |
|---|---:|---|
| Numbered manifest rows | 104 | F01 through F104, inclusive |
| Rows with grouped child-side references | 10 | F12, F23, F35, F54, F60, F63, F65, F74, F86, F90 |
| Additional tuples created by expanding grouped rows | 12 | Relative to treating each numbered row as one |
| Literal expanded candidate tuples | 116 | 104 + 12; includes polymorphic alternatives |
| Approved physical FK constraints | 0 | None has been generated or applied |

Expansion detail:

| Source row | Expanded child → parent tuple candidates |
|---|---|
| F12a | patients.created_by_user_id → users.user_id |
| F12b | patients.archived_by_user_id → users.user_id |
| F23a | cashier_shifts.cashier_user_id → users.user_id |
| F23b | cashier_shifts.closed_by_user_id → users.user_id |
| F35a | expenses.created_by_user_id → users.user_id |
| F35b | expenses.approved_by_user_id → users.user_id |
| F54a | stocktakes.created_by_user_id → users.user_id |
| F54b | stocktakes.approved_by_user_id → users.user_id |
| F60a | sales_invoices.cashier_user_id → users.user_id |
| F60b | sales_invoices.cancelled_by_user_id → users.user_id |
| F63a | sales_invoice_lines.medicine_id → medicines.medicine_id |
| F63b | sales_invoice_lines.tariff_id → tariffs.tariff_id |
| F63c | sales_invoice_lines.package_id → service_packages.package_id |
| F65a | sales_invoice_line_components.medicine_id → medicines.medicine_id |
| F65b | sales_invoice_line_components.tariff_id → tariffs.tariff_id |
| F74a | sales_returns.requested_by_user_id → users.user_id |
| F74b | sales_returns.admin_reviewed_by_user_id → users.user_id |
| F74c | sales_returns.final_decided_by_user_id → users.user_id |
| F86a | invoice_cancellation_requests.requested_by_user_id → users.user_id |
| F86b | invoice_cancellation_requests.decided_by_user_id → users.user_id |
| F90a | supplier_returns.requested_by_user_id → users.user_id |
| F90b | supplier_returns.approved_by_user_id → users.user_id |

The remaining 94 numbered rows each contribute one literal tuple candidate and retain their exact child/parent tuple from Pass 3. The complete canonical source remains [Pass 3 FK manifest](./MYSQL_MIGRATION_NORMALIZED_COLUMN_DICTIONARY_FK_MANIFEST_PASS3.md), rows F01–F104. This report does not silently reinterpret abbreviated targets or composite tuples.

## 3. Type and tuple comparison status

The previous Pass 6 figures (86 matches / 11 absent / 2 not comparable) were produced by a first-tuple-only extraction from a truncated view. They are **withdrawn as a complete-manifest metric**. They must not be cited as a pass rate.

The ten grouped rows expand to 22 tuples (rather than ten), i.e. 12 additional tuples over the 104-row count. Current verified statements from the static documents:

- Canonical user/actor key is `VARCHAR(64)`; the parent `users.user_id` and every human actor FK must match exact length, charset and collation.
- Canonical internal entity keys are generally `BIGINT UNSIGNED`; each child must match the exact parent declaration.
- `audit_events.event_uuid CHAR(36)` is an event UUID, not a user key.
- Composite FK tuples require identical arity and ordered column lists, plus an actual parent PK/UNIQUE key in that same order.
- Polymorphic F63/F65 alternatives cannot be treated as unconditional required FKs. They need explicit exactly-one target semantics and verified CHECK/service enforcement.
- The original F76 target was written as “matching identity tuple” without a concrete key. Pass 30 reconciles it to the proposal's explicit scalar return_quota_subject_id PK reference; same-parent invoice-line/component consistency remains a service invariant and test gate.

**Not yet verified:** a complete 116-row physical-type comparison including precision, signedness, character set/collation, nullability, defaults, actual parent UNIQUE/PK metadata, child-index order, and ON DELETE/UPDATE. No type-match percentage is reported in this pass.

## 4. Supplemental/integrity-table inventory

These are mentioned or required by the FK design but must be checked against full physical definitions before DDL:

| Table | Evidence currently present | Remaining gate |
|---|---|---|
| active_email_claims | Proposal §2.7 gives all three columns and key/relationship rules | Exact charset/collation, NULL/default and child index/action declarations |
| active_role_slots | Proposal §2.7 gives user_id, role_assignment_id, activated_at_utc and composite ownership | Exact physical attributes and index/action inventory |
| queue_prefix_guards | Proposal addendum §11.3 specifies prefix PK, version, updated_at_utc and fixed A/B rows | Exact types, null/default, update/index and concurrency runtime test |
| sales_return_events | Proposal §2.7 gives columns, types, append-only and event semantics | Exact NULL/default, actor provenance and FK/index/action declarations |
| stocktake_lines | Base table dictionary lists it; full field definitions need confirmation in Pass 4 | Complete column/key/null/default/index/FK audit |
| return_quota_subjects | Base dictionary lists line/component and quota fields | Redesign typed non-null subject identity; define exact PK/UNIQUE and relationship tuples |
| sales_return_quota_events | Proposal addendum §11.4 requires append-only reserve/release/approve/consume/reversal ledger | No complete physical table definition: PK, columns, null/default, indexes, FKs, actor provenance all BLOCKER |
| queue assignment event table | Queue addendum requires assignment event in same transaction | Exact table name and physical definition not established: BLOCKER |
| supplier_invoice_line_batch_allocations | Proposal §2.8 says use this if split/partial receipts are allowed | Receipt policy decision and complete table definition; do not impose one-batch-per-line uniqueness |
| Other guard/quota/event support tables | Mentioned in addenda/candidate rules | Must not be inferred into DDL without an exact source definition |

The existence of a table name in a relationship row is not proof that its complete schema has been specified.

## 5. Ownership-chain blockers that remain

1. **Shift ownership:** preserve composite `(shift_id,cashier_user_id)` ownership for encounter, invoice, petty cash and active slot. Confirm parent UNIQUE and exact child indexes.
2. **Encounter/invoice ownership:** invoice's encounter, patient, shift and cashier must agree with the encounter and cashier shift. A single FK to encounter plus separate FKs does not prove all values belong together. Patient nullability/snapshot policy blocks final tuple choice.
3. **Inventory:** `(batch_id,medicine_id)` must identify one batch; nullable pair semantics must be all-null/all-present. Receipt-line identity must support multiple partial deliveries/lots if the real workflow allows them.
4. **Invoice allocations:** batch and stock movement must match the invoice line/component's medicine, invoice and sale-deduction identity. Current independent FKs do not prove this.
5. **Return quota:** each return line must reference one non-null typed quota subject. The subject must prove its invoice line and optional package component belong together. Do not accept conflicting IDs or a nullable discriminator as proof.
6. **Supplier chain:** return, invoice line, batch, credit note and payment allocation must share the same supplier and originating invoice.
7. **Actor provenance:** distinguish human, system, import and unknown legacy actors. A nullable user FK alone cannot identify system/import activity.
8. **Reversals/idempotency:** each reversal must be unique or otherwise bounded by a documented cardinality rule; retries must not duplicate money or stock effects.

## 6. Exact next validation package

Before DDL, produce a machine-checkable expanded table with one row per candidate tuple and these columns:

`candidate_id, source_FK_ID, child_table, child_columns_ordered, parent_table, parent_columns_ordered, arity, child_type_vector, parent_type_vector, charset_collation, child_nullability, parent_key_kind, parent_key_columns_ordered, child_index_columns_ordered, on_delete, on_update, ownership_invariant, enforcement_method, positive_test_id, negative_test_id, status`.

Allowed statuses: `MATCH_CANDIDATE`, `TYPE_MISMATCH`, `MISSING_CHILD_COLUMN`, `MISSING_PARENT_COLUMN`, `MISSING_PARENT_UNIQUE`, `MISSING_CHILD_INDEX`, `NULL_TUPLE_BLOCKED`, `POLYMORPHIC_POLICY_BLOCKED`, `OWNERSHIP_BLOCKED`, `ACTION_UNSPECIFIED`, `UNRESOLVED`.

Do not mark a tuple ready because only its scalar types match. A tuple can be released only after all physical and semantic columns above are evidenced and positive/negative TiDB tests pass on the isolated preview cluster.

## 7. Safety boundary and outcome

- No DDL was generated or applied.
- No TiDB table/data was changed.
- No Firebase/Auth data or any of the five protected accounts was read-mutated, disabled, deleted or replaced.
- No production deployment, main-branch change or PR13 merge occurred.
- Firebase remains the operational rollback source until the MySQL/TiDB cutover is explicitly accepted.

**Pass 7 outcome:** the manifest cardinality is corrected to 104 numbered rows and 116 literal tuple candidates after expanding grouped rows. The full physical FK validation remains open; schema v1 is still **BLOCKED**.
