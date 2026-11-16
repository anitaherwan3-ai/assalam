# TiDB Preview Foundation Release Candidate — Pass 46

**Release branch:** `migration/tidb-foundation`  
**Target:** Vercel preview project `assalam-mysql-preview` + TiDB Cloud database `assalam_db`  
**Production/main:** untouched  
**Operational Firebase data and protected accounts:** untouched

## What this release candidate does

1. Runs the complete Node test suite before database changes.
2. Applies versioned migrations `001_identity_foundation`, `002_audit_idempotency_outbox`, and `003_catalog_masters` only when the exact Preview branch, database, enable flag and confirmation string all match.
3. Verifies all nine expected application tables and records migration versions.
4. Runs a synthetic TiDB smoke test inside one transaction and always rolls the fixture transaction back. It checks FK enforcement, composite role ownership, duplicate Firebase UID rejection, RESTRICT delete behavior, audit/idempotency/outbox inserts, and catalog inserts.
5. Exposes a read-only schema status endpoint.
6. Provides Firebase account-status/revocation checks and a separately gated preview-owner bootstrap.
7. Adds transactional catalog APIs for tariffs and suppliers, plus a reversible browser API adapter. Existing application modules still use Firebase; no data cutover or dual-write is enabled.

## Deployment correction

An earlier automatic preview build failed with `STATIC_BUILD_NO_OUT_DIR` because Vercel expected a `public` directory while this repository serves `index.html` from the project root. The Vercel preview project's output directory has now been set to `.`. That failed build logged that the migration hook was skipped; it did not execute DDL.

## Exact migration gates

- `VERCEL_ENV=preview`
- `VERCEL_GIT_COMMIT_REF=migration/tidb-foundation`
- `TIDB_DATABASE=assalam_db`
- `TIDB_MIGRATIONS_ENABLED=true`
- `TIDB_MIGRATION_BUILD_CONFIRM=ASSALAM_FOUNDATION_V1`

The preview owner bootstrap has a separate flag and exact email allowlist. It creates only a new TiDB preview identity after that account logs into the separate `assalam-preview-test` Firebase project. It does not change the Firebase Auth user, Firestore profile, or any production identity.

## Acceptance evidence still required

- GitHub Actions test result for this exact release commit.
- Vercel build result showing tests passed, all three migrations applied/verified, and synthetic smoke test passed with rollback.
- `GET /api/db-health` and `GET /api/db-schema-status` return healthy results.
- Preview Pimpinan login then produces an authenticated TiDB session.

No production cutover, protected-account mapping, real patient/stock/financial data import, or main-branch merge is part of this release.
