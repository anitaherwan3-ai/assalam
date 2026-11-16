# TiDB Preview Baseline Verification — Pass 40

**Date:** 2026-11-16  
**Branch:** `migration/tidb-foundation`  
**Evidence source:** User-provided read-only SQL Editor output from cluster `assalamklinik`  
**Status:** BASELINE CONFIRMED — NO DDL EXECUTED IN THIS PASS

## 1. Captured result

| Variable | Observed value | Assessment |
|---|---|---|
| `VERSION()` | `8.0.11-TiDB-v8.5.3-serverless` | TiDB v8.5.3; FK GA version threshold met |
| `@@foreign_key_checks` | `1` | Session FK checks enabled |
| `@@global.foreign_key_checks` | `1` | Global FK checks enabled |
| `@@sql_mode` | `ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION` | Strict insert behavior and zero-date restrictions must be reflected in tests |
| `@@character_set_server` | `utf8mb4` | Server default charset captured |
| `@@collation_server` | `utf8mb4_bin` | Server default collation captured; exact child/parent column collation must still match |

## 2. Gate outcome

- TiDB version gate: **PASS** (v8.5.3).
- Session FK enforcement setting: **PASS** (`1`).
- Global FK enforcement setting: **PASS** (`1`).
- Server charset/collation baseline: **CAPTURED** (`utf8mb4` / `utf8mb4_bin`).
- SQL mode baseline: **CAPTURED**; zero-date and strict-mode cases must be included in compatibility tests.

This confirms the server-level baseline only. It does not prove that every candidate column pair has matching signedness, length, precision, charset or collation, nor that parent keys, child indexes, ownership and FK actions are correct.

## 3. Existing preview diagnostic route review

Static review of `api/db-compatibility.js` confirms:
- It fails closed unless `VERCEL_ENV=preview` and `VERCEL_GIT_COMMIT_REF=migration/tidb-foundation`.
- It requires a separately configured `COMPATIBILITY_TEST_TOKEN` and uses constant-time token comparison.
- It creates synthetic tables with random names, performs a limited FK/UNIQUE/BIGINT/DECIMAL/rollback/concurrency/row-lock/time-zone suite, and attempts cleanup on success and error.
- It returns only compatibility-test details, not database credentials.
- It does not yet test the full Pass 38 matrix: exact composite parent-index order, missing-parent-index rejection, child-index auto-creation metadata, signedness/length/charset/collation mismatches, NULL composite FK semantics, FK ON UPDATE behavior, foreign_key_checks disabled guard, and FK metadata assertions.
- Its random test tables are created in the configured preview database `assalam_db`, not a separately created disposable database/schema. It must remain preview-only and must not be run against production. Before any execution, verify that the deployed route is the intended migration-branch preview and confirm token configuration. Do not infer that the endpoint has run simply because it exists in source.

## 4. Next work package

1. Extend the synthetic test suite to cover the missing Pass 38 checks.
2. Make the endpoint require an explicit test-database/schema allowlist and a second explicit run acknowledgement; retain branch/environment/token fail-closed guards.
3. Add metadata assertions using `SHOW CREATE TABLE`, `INFORMATION_SCHEMA.KEY_COLUMN_USAGE`, `TABLE_CONSTRAINTS`, `REFERENTIAL_CONSTRAINTS`, and `STATISTICS`.
4. Ensure cleanup is verified independently; if any test table cannot be dropped, stop and report the exact generated object names without retrying destructive cleanup blindly.
5. Run only on an isolated preview database/schema with synthetic data. Capture full result JSON and verify no test objects remain.
6. Only after the compatibility suite passes, proceed to full schema-v1 DDL review. Do not treat a generic FK smoke test as proof that the 116 application relationships are ready.

## 5. Safety record

This pass records the user-provided read-only baseline and static source review only. No SQL DDL/DML, TiDB mutation, Firebase/Auth access or mutation, protected-account change, import, deployment, merge to `main`, or PR13 merge occurred.

**Verdict: VERSION / FK-CHECKS BASELINE PASSED. FULL COMPATIBILITY AND SCHEMA V1 REMAIN BLOCKED.**
