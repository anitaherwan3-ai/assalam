# Supplemental FK Type and Source-Definition Reconciliation — Pass 29

**Date:** 2026-11-16  
**Branch:** `migration/tidb-foundation`  
**Status:** STATIC SOURCE RECONCILIATION — NOT DDL / NOT TI DB RUNTIME VALIDATION

## 1. Purpose

Pass 28 initially extracted exact type strings from the Pass 4 normalized dictionary. This pass inspects the proposal's explicit supplemental definitions to avoid treating Pass 4's intentionally incomplete supplemental-table coverage as proof that a type is unknown. It also checks whether the remaining unresolved candidates are actually specified elsewhere.

## 2. Type coverage correction

The Pass 28 CSV now contains type strings for **256 of 258** child/parent column references:
- 244 references extracted from Pass 4.
- 12 references supplemented from explicit proposal definitions:
  - `active_email_claims`: `user_id VARCHAR(64)`, `email_id BIGINT UNSIGNED` (proposal §2.7).
  - `active_role_slots`: `user_id VARCHAR(64)`, `role_assignment_id BIGINT UNSIGNED` (proposal §2.7).
  - `stocktake_lines`: `stocktake_id`, `medicine_id`, `batch_id BIGINT UNSIGNED` (proposal §5.10).
  - `sales_return_events`: `sales_return_id BIGINT UNSIGNED`, `actor_user_id VARCHAR(64)` (proposal §2.7).

This is a correction to the type-extraction coverage, not an increase in FK readiness. The matrix statuses remain 101 UNRESOLVED, 10 OWNERSHIP_BLOCKED, and 5 POLYMORPHIC_POLICY_BLOCKED. No row becomes approved merely because its type is now known.

## 3. The two remaining unresolved references

1. **F18 — `queue_prefix_guards.prefix`:** proposal §11.3 says `prefix PRIMARY KEY` and specifies fixed A/B rows, but does not declare the SQL type, length, charset or collation. Do not guess `VARCHAR(4)` merely because other queue prefix fields use that type.
2. **F76 — return quota identity:** Pass 3 defines child tuple `(return_quota_subject_id, invoice_line_id, invoice_component_id)` and parent “matching identity tuple”, without defining exact parent columns or key. Proposal §6.8 defines all three child fields; §6.9 defines `return_quota_subject_id BIGINT UNSIGNED PRIMARY KEY`, `invoice_line_id BIGINT UNSIGNED NOT NULL`, and nullable `invoice_component_id BIGINT UNSIGNED`. Proposal §2.8 also says `sales_return_lines.return_quota_subject_id` is mandatory and references the component-aware quota subject. This suggests the scalar FK should be `sales_return_lines.return_quota_subject_id → return_quota_subjects.return_quota_subject_id`, while invoice-line/component ownership is handled separately. However, that would revise the Pass 3 candidate tuple and must be recorded as a canonical manifest correction before DDL; this pass does not silently rewrite it.

## 4. Remaining physical gaps

Even for the 256 typed references, exact charset/collation, explicit null/default, actual parent PK/UNIQUE definition, actual child index, per-FK ON DELETE/UPDATE, and TiDB positive/negative behavior remain unverified. The supplemental table definitions also need a unified final physical dictionary rather than scattered prose.

## 5. Required next work

1. Reconcile F76 across Pass 3, Pass 7, Pass 28 and proposal §§2.8, 6.8–6.9; define one canonical typed FK plus the separate same-parent ownership constraint.
2. Define exact `queue_prefix_guards.prefix` physical type and complete table definition, or exclude F18 if the guard table is deferred from v1.
3. Build a canonical supplemental-table dictionary for `active_email_claims`, `active_role_slots`, `sales_return_events`, `queue_prefix_guards`, and any other v1-required integrity table; no incomplete support table may enter DDL.
4. Reconcile the final child-index and parent-key inventory against all 116 rows.
5. Only then prepare isolated TiDB tests.

## 6. Safety and verdict

No DDL or TiDB mutation, Firebase/Auth access or mutation, protected-account change, import, deployment, main merge or PR13 merge occurred.

**Verdict:** Pass 29 raises static type coverage to 256/258, but F76 and F18 remain unresolved, and all 116 candidates remain unapproved. Schema v1 is still **BLOCKED**.
