# TiDB FK Matrix Harness Gap Audit — Pass 41

**Branch:** `migration/tidb-foundation`  
**Scope:** Static source review and official TiDB documentation cross-check only  
**Database mutation:** None  
**Application schema DDL:** None  
**Endpoint execution/deployment:** Not performed  
**Firebase/Auth/accounts:** Not accessed or changed

## 1. Evidence baseline

The owner supplied a TiDB SQL Editor result showing:

- TiDB Serverless `8.5.3`
- Session and global `foreign_key_checks = 1`
- Server character set `utf8mb4`
- Server collation `utf8mb4_bin`
- Strict SQL mode, including `STRICT_TRANS_TABLES` and zero-date restrictions

This clears the minimum version and observed FK-check configuration gates only. It does not prove the application's 116 candidate relationships can be created or enforced.

Official TiDB documentation confirms that FK constraints are GA from v8.5.0; parent and child FK columns must match in data type, size/precision/length, character set, and collation; the parent must have a supporting index whose leading columns match the FK column order; TiDB can automatically create the child-side index; and FK metadata is available through `INFORMATION_SCHEMA.KEY_COLUMN_USAGE`, `TABLE_CONSTRAINTS`, and `REFERENTIAL_CONSTRAINTS`. Sources: [TiDB FOREIGN KEY Constraints](https://docs.pingcap.com/tidb/stable/foreign-key/) and [TiDB Cloud FOREIGN KEY Constraints](https://docs.pingcap.com/tidbcloud/foreign-key/).

## 2. Source files reviewed

- `api/db-compatibility.js` — synthetic compatibility endpoint
- `api/db-health.js` — connection-only health endpoint
- `lib/tidb.js` — pooled TiDB connection configuration
- `package.json` — Node.js and mysql2 dependency declarations

The existing compatibility endpoint is gated by `VERCEL_ENV=preview`, the exact migration branch name, and a constant-time comparison against `COMPATIBILITY_TEST_TOKEN`. It creates random-named synthetic tables and attempts cleanup. It is not an application-schema test and has not been executed against TiDB.

## 3. Confirmed gaps in the existing compatibility endpoint

The current endpoint does not yet establish the following:

1. Session and global `foreign_key_checks` are both enabled at test execution time. The owner's earlier SQL Editor observation is not a runtime assertion by this endpoint.
2. A composite FK is accepted only when the parent has a matching leading index in the exact FK column order.
3. A parent with no supporting index is rejected.
4. The child-side index is automatically created when omitted, and its exact column order can be observed in `INFORMATION_SCHEMA.STATISTICS`.
5. Integer signedness mismatch, decimal precision/scale mismatch, and string charset/collation mismatch are rejected. String length mismatch must be tested against the current TiDB release rather than inferred from a different engine/version.
6. Composite FK nullable-component behavior is observed directly, including a partially NULL child key and a fully non-NULL orphan.
7. `ON UPDATE RESTRICT` is enforced; the current endpoint checks `ON DELETE RESTRICT` only.
8. FK metadata is verified by constraint name, ordinal position, referenced table/column, and referential actions.
9. Cleanup is represented by a single authoritative status. The current endpoint retries drops in `finally` but suppresses those errors, so a successful retry cannot be reflected in the earlier response status (and a failed retry is not separately observable).

## 4. Safety findings and guard changes required before execution

The route currently accepts any configured `TIDB_DATABASE` as long as the Vercel environment and branch match. The branch/environment guard is useful but does not independently prove that the configured database is the intended preview database.

Before any DDL execution, require all of the following:

- `VERCEL_ENV=preview`
- `VERCEL_GIT_COMMIT_REF=migration/tidb-foundation`
- `TIDB_DATABASE=assalam_db` (exact allowlist for the current preview target)
- An explicit enable switch such as `COMPATIBILITY_TEST_ENABLED=true`
- A non-empty `COMPATIBILITY_TEST_TOKEN` with constant-time comparison
- No request-controlled database, schema, table name, or SQL
- Random synthetic table names and an explicit cleanup result
- No disabling of `foreign_key_checks`

The endpoint must remain preview-only. Do not configure these controls on production. A dedicated disposable schema would provide stronger isolation, but its availability and privileges have not been established; until then, random synthetic tables in the allowlisted preview database remain a residual risk and must be disclosed.

## 5. Pass 42 implementation/test matrix

The next source-only package should add isolated synthetic cases for:

| Test | Expected observation |
|---|---|
| FK runtime settings | Session/global checks both enabled; otherwise abort before DDL |
| Composite parent index, correct order | FK creation succeeds |
| Composite parent index, reversed order | FK creation fails when no matching leading index exists |
| Missing parent index | FK creation fails |
| Child index omitted | TiDB creates a supporting child index; metadata confirms exact leading columns |
| Integer signedness mismatch | FK creation rejected |
| DECIMAL precision/scale mismatch | FK creation rejected |
| String charset/collation mismatch | FK creation rejected |
| String length mismatch | Record actual TiDB 8.5.3 behavior; do not pre-assume |
| Composite child FK with a NULL component | Record actual behavior; verify against TiDB semantics |
| Fully non-NULL orphan | Insert rejected |
| ON DELETE / ON UPDATE RESTRICT | Both parent mutations rejected when referenced |
| FK metadata | `KEY_COLUMN_USAGE`, `TABLE_CONSTRAINTS`, `REFERENTIAL_CONSTRAINTS`, and `STATISTICS` agree |
| Cleanup | Every created synthetic object is accounted for and cleanup failure is a hard stop |

Each negative test must distinguish the expected database rejection from an unexpected test assertion error. A test passes only when the expected behavior and metadata are observed.

## 6. Decision

**Pass 41 result: STATIC REVIEW COMPLETE; RUNTIME FK MATRIX NOT YET VERIFIED.**

The TiDB version is suitable for FK testing, but the existing endpoint is not yet sufficient to certify FK readiness. Do not create application tables, apply schema-v1 DDL, import data, or promote this branch. Continue with Pass 42 source hardening and test-matrix implementation, then perform a single controlled preview deployment only after the complete source package and cleanup path have been reviewed.

