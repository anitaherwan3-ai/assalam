# TiDB preview execution report — Pass 63

Date: 2026-11-17  
Branch: `migration/tidb-foundation`  
Preview deployment: `dpl_AsYyMbSmgCmKgwaFScKLecC7Sb19`  
Preview URL: https://assalam-mysql-preview-kv4q4mrjg-assalam-clinik.vercel.app  
Commit tested: `36ab3e9be696f261b441766b811bc03ef9a72b88`

## Results

<badge>PASS</badge> CI run `43956997316`: 148 tests passed, 0 failed.

<badge>PASS</badge> Preview DDL: migrations `001` through `009` are registered and verified as current. The build log reports all nine versions in `alreadyApplied` and `current`; no migration remains pending.

<badge>PASS</badge> Live Better Auth schema check: `auth check schema --config ./lib/auth.config.mjs` reported “Schema check passed against the live database.”

<badge>PASS</badge> Foundation smoke transaction: FK checks, composite ownership FK, unique Firebase UID, audit, idempotency, outbox, catalog rows, Better Auth user/session/account/verification/rate-limit rows and delete-restrict behavior passed. Synthetic rows were rolled back.

<badge>PASS</badge> Operational smoke transaction: 60 tables exercised across patient/encounter, cashier shifts, A/B queue transfer, purchase receipt, batch/movement, stocktake, sale and batch allocation, payment, return quota, Pimpinan refund approval, expense approval, supplier return/credit/partial payment, quarantine inspection/release, cash/bank ledgers, journal rows, backup and export. The test returned `ok: true` and rolled back the synthetic transaction.

The preview build completed READY. The live database therefore contains the schema, but no synthetic smoke-test business rows were committed.

## Backend progress

Implemented on the migration branch:
- Better Auth session-to-clinic-user resolver. It denies access if the Better Auth user has no active server-owned clinic role assignment.
- A/B queue repository using TiDB transactions, row locks, idempotency and lane-specific call guards.
- Queue API slice for authenticated list/register/call/transfer actions.
- Transfer requires a reason, validates the target cashier's active shift, preserves before/after owner identities and writes a transfer event.
- Kasir access is limited to tickets currently owned by that cashier; Admin can assist; Pimpinan can manage both lanes.

Not yet production-complete:
- No Pimpinan-only Better Auth invitation/provisioning UI or primary-owner recovery workflow.
- Existing app screens and Firebase-backed endpoints have not been switched to the new TiDB APIs.
- No authenticated browser-to-API queue journey was run because the new Better Auth user/role provisioning flow is not yet complete.
- The operational repository is currently a first vertical slice; purchasing, inventory, sales/returns, finance and shift-close repositories/APIs still need implementation and concurrency tests.
- No two-connection stress test, backup/restore rehearsal or production opening stocktake has been completed.

## Safety and deployment controls

- The successful preview deployment is isolated from production.
- Preview project automatic deployments are paused again after the one required build to avoid spending deployment quota on intermediate commits.
- `TIDB_MIGRATIONS_ENABLED` is reset to `false`; `TIDB_MIGRATION_BUILD_CONFIRM` is reset to `DISABLED_AFTER_PASS62`.
- Better Auth preview URL, trusted origin and secret are scoped to the migration preview only.
- No Firebase export/import, old dummy data migration, production DDL, production database switch or Firebase Auth removal occurred.

## Repository / production recovery disclosure

Two test-only files were briefly committed to `main` because the branch argument was omitted on two file-creation calls. The main ref was immediately restored to its previous commit `2c26a769a95a84c06974e249d318498fde8eb7d1`. Those two commits contained only test files and no application/runtime changes. Their production deployments were briefly created; the prior known-good production deployment `dpl_FciVm7Jo47GawWu4W7Z2CX2ca9jA` was then promoted back to production. The current main branch head and production target are restored to that pre-incident application version. No production application code change remains from those test commits.

## Verdict

Items 1–4 have reached a successful first preview gate: canonical dictionary, Better Auth/TiDB schema, operational DDL, live schema validation and rollback-only transaction smoke tests.

Item 5 is underway, not complete: queue repository/API is the first slice. Continue the remaining domain repositories and endpoints on this branch only. Production cutover remains blocked pending the remaining gates and explicit owner approval.
