# Physical FK Tuple Matrix — Pass 28

**Date:** 2026-11-16  
**Branch:** `migration/tidb-foundation`  
**Status:** MACHINE-CHECKABLE STATIC INVENTORY — NOT DDL / NOT TI DB RUNTIME VALIDATION

## 1. Scope and method

This pass expands the canonical Pass 3 F01–F104 manifest using the ten explicit grouped expansions in Pass 7. Each expanded candidate receives a stable ID (for example F12a/F12b). No relationship or column name is invented. F76 remains explicitly unresolved because its parent tuple is described only as a “matching identity tuple”.

The companion CSV `MYSQL_MIGRATION_PHYSICAL_FK_TUPLE_MATRIX_PASS28.csv` contains one row per candidate and all requested audit fields. Unknown physical facts are explicitly marked `UNVERIFIED` or `UNRESOLVED`; this is intentional and safer than deriving DDL from incomplete prose.

## 2. Reproducible cardinality

- Pass 3 source rows: **104** (F01–F104).
- Pass 7 grouped rows expanded: **10**.
- Expanded candidates: **116**.
- Candidate ID uniqueness: **PASS**.
- Approved/applied physical FK constraints: **0**.

## 3. Current conservative status counts

| Status | Rows | Meaning |
|---|---:|---|
| `UNRESOLVED` | 110 | Candidate is not approved; see CSV reason field |
| `POLYMORPHIC_POLICY_BLOCKED` | 5 | Candidate is not approved; see CSV reason field |
| `OWNERSHIP_BLOCKED` | 1 | Candidate is not approved; see CSV reason field |

No row is marked `MATCH_CANDIDATE`: the proposal and catalogue provide candidate index/key descriptions, but do not prove the complete final DDL, exact collation, null tuple semantics, explicit per-FK actions, or TiDB positive/negative runtime evidence. A false green status would be misleading.

## 4. Structural blockers retained

- F63a–F63c and F65a–F65b are polymorphic target alternatives; require exactly-one target enforcement.
- F76 remains blocked because the quota-subject composite identity tuple is undefined.
- Composite ownership rows remain blocked until ordered parent UNIQUE keys, child indexes and all-null/all-present rules are proven.
- F18 depends on supplemental `queue_prefix_guards`, which lacks a complete base-table definition in Pass 4.
- Actor FKs need explicit human/system/import/unknown provenance.
- Self-reversal FKs need one-time reversal and idempotency semantics.
- The proposal-level RESTRICT default is recorded as a design default only; per-constraint TiDB behavior has not been tested.

## 5. What this pass does not claim

This matrix is a static audit inventory, not proof that all columns, indexes or keys exist physically. Pass 4 covers 56 base tables / 566 extracted columns, while several integrity tables are supplemental or incompletely defined. Type vectors are populated only when an exact type can be extracted from Pass 4; missing values remain unresolved. Charset/collation and nullability are not inferred.

## 6. Exit criteria before DDL

1. Resolve every blank/unverified type and confirm signedness, precision/scale, length, charset and collation from a canonical final column dictionary.
2. Verify every parent PK/UNIQUE tuple in exact order and every child index in exact leading order.
3. Specify null tuple rules and same-parent ownership constraints.
4. Specify explicit ON DELETE/ON UPDATE per FK and system actor strategy.
5. Add complete definitions for any supplemental table actually required by v1; exclude conditional tables without owner/source approval.
6. Execute isolated TiDB positive and negative FK tests, including rollback and concurrent transactions.
7. Reconcile all rows against actual TiDB metadata after schema application; until then no physical constraint is declared applied.

## 7. Safety

No DDL, TiDB data/schema mutation, Firebase/Auth access or mutation, protected-account change, import, deployment, main merge or PR13 merge was performed.

**Verdict:** the 116-candidate inventory is now row-addressable and machine-checkable, but schema v1 remains **BLOCKED**. This pass is not authorization to generate or apply DDL.
