# TiDB FK Matrix Harness Implementation — Pass 42B

**Branch:** `migration/tidb-foundation`  
**Scope:** Extend synthetic compatibility test source only  
**Database mutation:** None  
**Deployment/endpoint execution:** Not performed  
**Application schema DDL:** None  
**Firebase/Auth/accounts:** Not accessed or changed

## Source changes

Updated `api/db-compatibility.js` to extend the synthetic test suite:

1. Added a registry for every synthetic table name and a reverse-order cleanup routine. Tables are registered before CREATE so partially created objects are also included in cleanup.
2. Added an `ON UPDATE RESTRICT` enforcement check.
3. Added FK metadata verification using `INFORMATION_SCHEMA.KEY_COLUMN_USAGE`, `REFERENTIAL_CONSTRAINTS`, and `TABLE_CONSTRAINTS`.
4. Added a composite parent key test with FK column order `(a,b)`, while omitting the child index; the suite inspects `INFORMATION_SCHEMA.STATISTICS` for the child-side index.
5. Added a negative test for a reversed parent composite index `(b,a)` when the FK references `(a,b)`.
6. Added a negative test for a referenced parent column without a supporting index.
7. Added negative DDL tests for FK column signedness, DECIMAL precision/scale, string collation mismatch, and VARCHAR length mismatch.
8. Added a composite FK test with one NULL component and a fully non-NULL orphan rejection test.
9. Replaced fixed three-table cleanup with registry-driven cleanup, both on the normal path and on runtime errors. Cleanup errors remain visible and block schema-v1 readiness.

The test cases use random per-run names, bound parameters for metadata queries, and no request-supplied SQL/table/database identifiers.

## Documentation cross-check

Current official TiDB documentation states that FK parent/child columns must match data type, size/precision/length, charset and collation; parent index column order must match the FK order; missing parent indexes reject FK creation; and a child-side index is automatically created when missing. It also documents RESTRICT behavior and the metadata/locking model.

Reference: [TiDB FOREIGN KEY Constraints](https://docs.pingcap.com/tidb/stable/foreign-key/).

## Static verification

The updated source was fetched again from the migration branch. Static checks confirmed the presence of the preview branch guard, explicit enable switch, exact database allowlist, explicit user confirmation, session/global FK-check guard before DDL, registry-based cleanup, composite-index tests, mismatch test definitions, nullable composite FK tests, ON UPDATE test, metadata join, and absence of any command that disables `foreign_key_checks`.

**Not performed:** Node syntax check, Vercel build/deployment, live endpoint execution, SQL execution against TiDB, or cleanup verification against a live database. The static checks do not replace these tests.

## Open test limitations

- Expected-error classification must be confirmed against actual TiDB 8.5.3 error codes/messages. A failed pattern match should be treated as a test failure, not proof that the server accepted an incompatible FK.
- The composite NULL case records TiDB's actual behavior; it is not yet runtime evidence.
- Child-index metadata and cleanup are not yet runtime verified.
- The test endpoint still writes synthetic tables into the allowlisted preview database `assalam_db`; no dedicated disposable schema has been established.

## Decision

**Pass 42B: SOURCE MATRIX EXTENDED; RUNTIME VERIFICATION PENDING.**

Do not deploy or execute until the source receives a Node syntax check, full review, and preview environment verification. Do not create application schema tables, import data, merge to `main`, or promote to production.
