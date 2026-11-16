# FK Candidate Canonicalization and Supplemental Guard Definition — Pass 30

**Date:** 2026-11-16  
**Branch:** `migration/tidb-foundation`  
**Status:** STATIC DESIGN RECONCILIATION — CANDIDATE ONLY, NOT DDL / NOT TI DB RUNTIME VALIDATION

## 1. F76 quota-subject relationship canonicalization

Pass 3 originally described F76 as a three-column child tuple `(return_quota_subject_id, invoice_line_id, invoice_component_id)` referencing an undefined “matching identity tuple”. This was not a usable physical FK definition. The current proposal provides stronger, explicit evidence:
- `sales_return_lines.return_quota_subject_id BIGINT UNSIGNED NOT NULL` (proposal §6.8).
- `return_quota_subjects.return_quota_subject_id BIGINT UNSIGNED PRIMARY KEY` (proposal §6.9).
- Proposal §2.8 states the subject ID is mandatory and references the component-aware quota subject.

Canonical candidate: `sales_return_lines.return_quota_subject_id → return_quota_subjects.return_quota_subject_id` (scalar FK, arity 1).

The same-parent ownership invariant remains mandatory: within the same server transaction, lock/read the quota subject and verify that `sales_return_lines.invoice_line_id` and nullable `invoice_component_id` exactly match the subject. A composite FK containing nullable `invoice_component_id` cannot by itself prove ownership because a NULL component can bypass composite matching. The scalar FK plus server-side invariant must have positive and negative tests before release.

## 2. Queue prefix guard physical candidate

The proposal's queue tables already use `prefix VARCHAR(4)` in `queue_counters`, `cashier_queue_assignments`, and `queue_tickets`. Pass 30 therefore normalizes `queue_prefix_guards.prefix` to candidate `VARCHAR(4) PRIMARY KEY`, matching those existing queue-prefix declarations. Candidate complete minimum definition:
- `prefix VARCHAR(4) PRIMARY KEY`
- `version BIGINT UNSIGNED NOT NULL DEFAULT 1`
- `updated_at_utc DATETIME(3) NOT NULL`
- Seed rows: `A`, `B`

This is an engineering consistency choice from the existing declared queue prefix type, not an observed deployed table. Charset/collation must be explicitly unified with all other prefix columns. Queue guard locking, concurrent assignment updates, and first-use counter initialization still require TiDB runtime tests.

## 3. Matrix corrections

The Pass 28 CSV is updated:
- F76 is now the scalar quota-subject FK, with ownership validation separately documented.
- F18 parent type is populated as candidate `VARCHAR(4)`.
- Exact type strings are now present for **258/258** candidate child/parent column references.
- Status counts remain **101 UNRESOLVED, 10 OWNERSHIP_BLOCKED, 5 POLYMORPHIC_POLICY_BLOCKED**. Type completion does not close index, key, NULL, charset/collation, action, ownership or runtime gates.

## 4. Remaining exit gates

1. Verify exact charset/collation for every textual FK key.
2. Reconcile parent PK/UNIQUE and child index order against final table definitions.
3. Define nullable composite tuple behavior and ownership checks for shift, batch, invoice, return, supplier and payment chains.
4. Define explicit ON DELETE/ON UPDATE per FK.
5. Implement and test F76's server-side same-subject ownership validation.
6. Run TiDB positive/negative FK tests, transaction rollback, concurrency and lock-order tests in isolated preview.
7. Reconcile actual TiDB metadata after DDL; do not claim constraints applied before that.

## 5. Safety and verdict

No DDL, TiDB schema/data mutation, Firebase/Auth access or mutation, protected-account change, import, deployment, main merge or PR13 merge occurred.

**Verdict:** the candidate manifest is now internally more precise (258/258 type strings populated), but all 116 candidate rows remain unapproved. Schema v1 remains **BLOCKED** pending physical key/index/null/action and runtime proof.
