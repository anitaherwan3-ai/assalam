# TiDB Preview Guard Hardening — Pass 42A

**Branch:** `migration/tidb-foundation`  
**Scope:** Source-only hardening of the synthetic compatibility endpoint  
**Database mutation:** None  
**Deployment/endpoint execution:** Not performed  
**Application schema DDL:** None  
**Firebase/Auth/accounts:** Not accessed or changed

## Changes applied

Updated `api/db-compatibility.js` with these fail-closed controls:

1. Retained the existing exact Vercel preview environment and migration branch checks.
2. Added a server-side `COMPATIBILITY_TEST_ENABLED=true` requirement.
3. Added an exact `TIDB_DATABASE=assalam_db` allowlist requirement. Requests cannot select a database or table name.
4. Retained the non-empty `COMPATIBILITY_TEST_TOKEN` requirement and constant-time token comparison.
5. Added a required explicit form confirmation (`confirm=yes`) before test execution.
6. Expanded runtime metadata to read both session and global `foreign_key_checks`.
7. Added a pre-DDL fail-closed check: if either FK-check value is not enabled, the route returns before creating any synthetic test table.
8. Removed duplicate, silently suppressed table drops from `finally`. The normal and error paths remain responsible for attempting cleanup and reporting its outcome; `finally` now closes connections only.

## Static verification performed

The updated file was fetched again from the migration branch and checked for the presence of the explicit enable switch, database allowlist, user confirmation, both FK-check metadata fields, and the pre-DDL guard. The finalizer was inspected to confirm it only closes connections and no longer performs silent duplicate table drops.

The update has **not** been deployed, executed, or syntax-checked in a Node runtime in this pass. Therefore this is not a runtime pass and does not establish that the endpoint can execute successfully.

## Required preview configuration before any future execution

The preview environment must have the intended database credentials and all of the following exact controls configured:

- `VERCEL_ENV=preview` (platform-provided)
- `VERCEL_GIT_COMMIT_REF=migration/tidb-foundation` (platform-provided)
- `TIDB_DATABASE=assalam_db`
- `COMPATIBILITY_TEST_ENABLED=true`
- `COMPATIBILITY_TEST_TOKEN` set to a strong secret

Do not configure the enable switch or test token in production. Do not deploy solely to test this guard patch; first finish the complete FK matrix suite, inspect the full diff, run static syntax checks, and verify the preview environment target. A dedicated disposable schema would be safer than sharing the preview database, but availability and privileges remain unverified.

## Remaining work

The Pass 41 FK matrix is still outstanding: composite index ordering, missing parent index rejection, child index auto-creation metadata, type/precision/charset/collation mismatch behavior, composite nullable FK behavior, ON UPDATE RESTRICT, and FK metadata assertions. Those tests must be added and reviewed before any endpoint execution.

**Decision:** Pass 42A source hardening applied and statically re-fetched; runtime verification pending. No application DDL or data migration is authorized.
