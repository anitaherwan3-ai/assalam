# TiDB Migration and Catalog Foundation — Pass 45

**Branch:** `migration/tidb-foundation`  
**Current scope:** Identity, audit/idempotency, transactional foundation, catalog masters and reversible browser adapter  
**Deployment:** No deployment triggered  
**Database DDL:** Not yet executed  
**Operational Firebase and protected accounts:** Untouched

## Implemented on the preview branch

- Firebase ID-token signature and claim verification against the isolated preview Firebase project.
- Server-side Firebase UID mapping and TiDB role resolution; browser-supplied role/email/profile is never used as authorization.
- A no-store session endpoint.
- Three versioned migration sets:
  - `001_identity_foundation`: users, role assignments, active role slots, Firebase UID mappings.
  - `002_audit_idempotency_outbox`: audit events, idempotency records and outbox jobs.
  - `003_catalog_masters`: tariffs and suppliers.
- A TiDB transaction wrapper that sets UTC, verifies foreign-key enforcement, and commits/rolls back/release safely.
- Canonical request hashing and idempotent replay/reuse rejection.
- Audit event writer that blocks credential-like snapshot fields, caps snapshot size, and accepts only a hashed source IP.
- Authenticated catalog APIs:
  - Tariffs: read, create, version-checked update, soft deactivation.
  - Suppliers: read and create.
  - Writes require an idempotency key, use a DB transaction and append an audit event.
- Big integer driver settings and Rupiah price validation use integer `BIGINT` values transported as decimal strings.
- Browser TiDB API adapter is loaded after Firebase initialization. Existing Firebase app behavior remains active; no module has been switched to TiDB.
- Preview-only owner bootstrap is limited to the Firebase project `assalam-preview-test`, the exact preview branch/database and a configured owner email. It requires a recently authenticated Firebase token, creates only a TiDB preview identity, and never mutates Firebase Auth/Firestore.

## Guarded first deployment plan

The Vercel build hook is inert unless all are true:
- `VERCEL_ENV=preview`
- `VERCEL_GIT_COMMIT_REF=migration/tidb-foundation`
- `TIDB_DATABASE=assalam_db`
- `TIDB_MIGRATIONS_ENABLED=true`
- `TIDB_MIGRATION_BUILD_CONFIRM=ASSALAM_FOUNDATION_V1`

When deliberately enabled for the single final preview deployment, the build hook applies migrations in order, verifies every expected table and records schema versions. It inserts no user, role, UID, patient, transaction, stock or other operational records. A read-only `/api/db-schema-status` endpoint verifies the resulting schema.

The owner bootstrap is separately disabled until `TIDB_PREVIEW_OWNER_BOOTSTRAP_ENABLED=true` and `TIDB_PREVIEW_OWNER_EMAIL` are configured on the same preview branch. Its request is triggered only after the allowlisted Pimpinan logs in through the preview Firebase project.

## Verification and remaining limits

- Earlier CI run on commit `9d87fef`: 12/12 tests passed.
- New tests have since been added for migration runner, catalog validation, audit/idempotency replay, auth role guard and preview-owner bootstrap. Their next CI run is pending.
- No live TiDB DDL or synthetic database fixture has run yet.
- Firebase token signature/claims are checked, but Firebase Admin revocation/disabled-account lookup is not yet implemented. No domain write endpoints beyond tariff/supplier catalog are exposed.
- Patient/encounter/queue, shift/finance, medicine/batch/inventory, POS, return/cancellation and reports remain on Firebase until their schema, policy gates and end-to-end tests are completed.
- Owner decisions D01–D20 remain gates for the dependent modules. No guessed patient identity, stock batch, financial policy or refund disposition will be seeded.
- The five protected operational accounts remain unchanged. Preview Pimpinan bootstrap is a separate TiDB preview identity and does not change the operational Firebase accounts.
