# Repository and workflow verification — Pass 67

Date: 2026-11-17  
Branch: `migration/tidb-foundation`  
Latest code commit: `4ca2833fa3eb77fe44655440390199cbe4c5ffce`

## Completed code on the migration branch

The SQL repository implementation is present in `lib/repositories/tidb-inventory-repository.js` and is wired to:
- `api/inventory.js`
- `api/sales.js`
- `api/finance.js`

The repository covers medicine masters, purchase receipts, batches, inventory movements, weighted HPP and unknown-HPP handling, FEFO allocation, sales invoices and snapshots, return quotas, return approval, quarantine, refund obligations/payouts, supplier credits/payments, stocktakes, journals, expenses, cash/bank ledger entries and shift reconciliation.

The domain command layer in `lib/clinic-domain-commands.js` enforces server-side actor roles, transactional idempotency and audit events for these workflows.

## Safety correction

Pass 67 changed the batch model so a missing `originVerified` value is treated as **unverified**, not trusted by default. The repository downgrades a batch to `quarantined` unless both origin and expiry are verified. This enforces the owner's rule that unknown batch origin or expiry cannot enter sellable stock.

Added regression coverage:
- Missing origin verification defaults to false.
- A batch with a valid expiry but unverified origin is persisted as quarantined.
- Existing tests cover integer medicine units, HPP null/uncalculated, FEFO, optimistic batch version checks, stocktake, quarantine release/disposal, return quotas, partial supplier payments, Pimpinan review, expense approval, refund payout and shift verification.

## CI

Latest workflow run: https://github.com/anitaherwan3-ai/assalam/actions/runs/43969917811  
Commit: `4ca2833fa3eb77fe44655440390199cbe4c5ffce`  
Result: success.

## Preview execution attempt and blocker

A single controlled preview deployment was requested for commit `0cfb91d674285b4710fb2a92fb1bab24ea402216`, with migrations `001`–`013`, Better Auth live schema check and rollback-only synthetic smoke tests enabled.

Vercel rejected deployment creation with HTTP 402: `api-deployments-free-per-day`, stating that the free API deployment limit had been exceeded and to retry after 24 hours. No deployment was created, and no migration command ran as a result of this attempt.

Immediately after the rejection:
- `TIDB_MIGRATIONS_ENABLED` was reset to `false`.
- `TIDB_MIGRATION_BUILD_CONFIRM` was reset to `DISABLED_AFTER_PASS66`.
- No production deployment or database operation was requested.
- The prior preview deployment remains the last known deployed version; the latest Pass 67 code and migrations 010–013 have **not** been verified against live TiDB in this attempt.

## Remaining live gate

Once Vercel's quota window resets, create one preview deployment from the latest green commit, run migrations `001`–`013` (already-applied versions should be detected safely), execute the foundation and operational rollback-only smoke tests, run Better Auth schema check, and capture the build result. Do not run production DDL, import Firebase data, or cut over production without a separate explicit approval.
