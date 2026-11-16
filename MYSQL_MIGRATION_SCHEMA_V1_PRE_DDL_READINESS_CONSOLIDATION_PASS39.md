# Schema v1 Pre-DDL Readiness Consolidation — Pass 39

**Date:** 2026-11-16  
**Branch:** `migration/tidb-foundation`  
**Status:** AUDIT CONSOLIDATION — NOT SCHEMA APPROVAL

## 1. Consolidated evidence through Pass 38

| Gate | Current evidence | Remaining blocker |
|---|---|---|
| FK inventory | 104 numbered source rows expanded to 116 unique candidate tuples | Candidate count is not approved constraint count |
| Type strings | 256/256 child/parent column references populated after F76 normalization | Exact charset/collation, signedness and TiDB compatibility still need metadata/runtime proof |
| Child index | 41 proposal index-prefix matches; 72 no matching table-section index; 3 supplemental table sections lack index section | TiDB can auto-create child indexes, but actual generated indexes must be verified; explicit query indexes need EXPLAIN |
| Parent keys | 101 explicit PK, 2 explicit UNIQUE, 2 single-column PKs covering UNIQUE labels | 5 addendum composite keys not integrated, 5 catalogue-only composite keys not integrated, 1 parent table lacks dedicated table section |
| F70 | Child/parent tuple and composite UNIQUE aligned as (invoice_id, invoice_line_id) | Runtime enforcement not tested |
| F76 | Scalar FK to return_quota_subjects PK | Same-subject invoice-line/component invariant must be implemented and tested in server transaction |
| Nullability | Child FK nullability mapped: 75 single NOT NULL, 28 single nullable, 7 composite all NOT NULL, 5 optional-first-column composites, 1 unspecified single | The unspecified role_assignments.user_id nullability must be resolved; optional-composite conditional semantics must be enforced |
| FK actions | Global RESTRICT default recorded | 115 candidates lack explicit per-FK actions; F13 patient deletion policy remains open |
| Polymorphism | Five F63/F65 alternatives identified | Exactly-one target validation and negative tests required |
| TiDB feature | Official docs: FK supported from v6.6, GA from v8.5; child index auto-create; parent index required | Actual assalamklinik cluster version and foreign_key_checks setting not yet queried |
| Runtime tests | None claimed | Positive/negative FK, NULL, action, rollback, concurrency, locking and EXPLAIN tests still required |
| Owner policy | D01, D05–D20 tracked in Pass 26 | Clinic/accounting/clinical/retention/queue/auth decisions remain open |
| Source gates | Source audits documented through Pass 25 | Deployed auth/rules verification, split receipt evidence and exact source fixtures remain open |

## 2. Material physical-key work still required

The parent key matrix identifies:
- 5 composite UNIQUE requirements explicitly stated in addenda but not integrated into their table definitions.
- 5 additional composite UNIQUE requirements present in the FK catalogue but not integrated into parent table definitions.
- 1 supplemental parent table (`queue_prefix_guards`) without a dedicated complete table section.
- F70 is corrected; no remaining F70 key-order mismatch is recorded.

The final canonical table definitions must integrate the exact ordered parent keys before any FK DDL is generated.

## 3. TiDB preview gate — next executable step

Before any DDL, obtain a read-only baseline from the actual preview cluster:
```sql
SELECT VERSION() AS tidb_version,
       @@foreign_key_checks AS session_fk_checks,
       @@global.foreign_key_checks AS global_fk_checks,
       @@sql_mode AS sql_mode,
       @@character_set_server AS server_charset,
       @@collation_server AS server_collation;
```

Then, in a disposable schema only, run the Pass 38 compatibility probe for parent-index requirements, child-index auto-creation, exact type/collation matching, FK action behavior, NULL semantics, rollback, concurrency and metadata verification.

Do not create the application schema v1 until:
1. The read-only baseline confirms a supported TiDB version and FK checks are enabled.
2. All parent ordered PK/UNIQUE keys are integrated.
3. F13 and D01/D05–D20 owner policies are resolved or explicitly excluded/quarantined from v1.
4. The full canonical schema and test plan are reviewed.
5. The disposable compatibility probe passes.

## 4. Explicitly prohibited at this stage

- No application DDL or schema migration in `assalam_db`.
- No import or transformation of Firebase operational data.
- No Firebase/Auth mutation or protected-account changes.
- No production deployment, merge to `main`, or PR13 merge.
- No deletion or overwrite of any account or historical clinic data.

## 5. Verdict

The FK inventory and multiple documentation contradictions are now reconciled, but the schema is **not clear for DDL**. The immediate next step is a read-only TiDB version/settings baseline, followed by isolated compatibility tests—not application schema creation.

**Status: BLOCKED / SAFE TO CONTINUE READ-ONLY AUDIT.**
