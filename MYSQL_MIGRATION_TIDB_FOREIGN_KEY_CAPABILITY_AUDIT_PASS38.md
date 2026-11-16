# TiDB Foreign-Key Capability and Runtime Gate — Pass 38

**Date:** 2026-11-16  
**Branch:** `migration/tidb-foundation`  
**Status:** OFFICIAL-DOCUMENTATION REVIEW — PREVIEW VERSION STILL UNVERIFIED

## 1. Official TiDB findings

Reviewed the current official TiDB documentation:
- https://docs.pingcap.com/tidb/stable/foreign-key/
- https://docs.pingcap.com/tidbcloud/foreign-key/
- https://docs.pingcap.com/tidb/stable/constraints/

Documented behavior:
1. TiDB supports effective foreign-key constraints starting from v6.6.0; the feature is generally available starting from v8.5.0. The exact version of the clinic's `assalamklinik` cluster has not yet been verified.
2. Child and parent FK columns must have matching data type, size, precision, length, character set and collation.
3. The referenced parent columns need a matching index with the same column order. Missing parent index causes FK creation failure.
4. If the child table lacks a corresponding FK index, TiDB automatically creates a child index with the same name as the FK. Therefore, the 72 missing explicit child-index declarations in Pass 37 are not automatically 72 FK-creation blockers; they remain design/performance and metadata-verification items.
5. If ON DELETE/ON UPDATE is omitted, TiDB defaults to NO ACTION, which behaves like RESTRICT. The final DDL should still state explicit actions per constraint.
6. FK checks are controlled by `foreign_key_checks`, ON by default. The preview session/global setting must be verified before testing and must not be disabled in normal application operations.
7. In pessimistic transactions, child insert/update FK checks lock the referenced parent row similarly to `SELECT ... FOR UPDATE`. High write concurrency against the same parent may cause lock conflicts.
8. TiDB documentation recommends testing FK performance. The feature has restrictions, including no FK on BLOB/TEXT, partitioned tables or virtual generated columns.
9. FK metadata can be inspected through `SHOW CREATE TABLE`, `INFORMATION_SCHEMA.KEY_COLUMN_USAGE`, `TABLE_CONSTRAINTS` and `REFERENTIAL_CONSTRAINTS`.

## 2. Consequence for Pass 37

Pass 37's 41 proposal index-prefix matches, 72 table-section misses and 3 incomplete table sections remain valid as a static index-definition audit. However:
- A missing explicit child index may be supplied automatically by TiDB when the FK is created.
- The parent index/key is not automatically waived; the referenced ordered parent index must exist.
- The final acceptance check must inspect actual child indexes after FK creation, including any auto-created index names and ordered columns.
- Explicit child indexes should be added when they support query workload or avoid unwanted engine-generated indexes, not indiscriminately.

## 3. Required preview compatibility probe

Before any schema DDL, obtain the actual cluster version and test on an isolated disposable schema:
- `SELECT VERSION()`, `SELECT @@foreign_key_checks`, `SELECT @@global.foreign_key_checks`.
- Create parent with ordered PK/UNIQUE and child without a supporting index; create FK and inspect whether TiDB auto-creates the child index.
- Repeat with missing parent index and confirm the expected rejection.
- Test composite FK exact order and mismatched order.
- Test signedness, VARCHAR length, charset and collation mismatches.
- Test default NO ACTION vs explicit RESTRICT and verify delete/update rejection.
- Test NULL-containing composite child rows and confirm intended optional relationship behavior.
- Test invalid child insert, missing parent insert, parent delete/update, transaction rollback and concurrent child inserts referencing the same parent.
- Inspect `SHOW CREATE TABLE` and all relevant INFORMATION_SCHEMA views; assert the FK is effective and not marked invalid.
- Capture EXPLAIN for representative FK checks and key clinic commands.

The probe must use synthetic data in a disposable preview schema. It must not touch production or Firebase.

## 4. Safety and verdict

This pass is documentation-only. No live cluster query, DDL, TiDB schema/data mutation, Firebase/Auth access or mutation, protected-account change, import, deployment, main merge or PR13 merge occurred.

**Verdict:** official documentation clarifies auto-created child indexes and FK version gates, but the actual cluster version, session settings and runtime behavior remain unverified. Schema v1 remains **BLOCKED**.
