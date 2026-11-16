# TiDB Identity Foundation Implementation — Pass 44

**Branch:** `migration/tidb-foundation`  
**Scope:** Preview-only Firebase ID-token verification, TiDB UID/role resolution and guarded identity DDL  
**Operational data:** Not read, inserted, updated or deleted  
**Firebase identities:** Not changed  
**Deployment:** No manual deployment triggered

## Implemented

1. `lib/firebase-token.js` validates Firebase ID-token RS256 signatures against Google's Secure Token signing certificates and checks issuer, audience, subject, expiry, issue time and auth time.
2. `lib/require-auth.js` resolves authorization only by the immutable Firebase UID mapping in TiDB and the server-owned active role slot. Browser-supplied email, role, user ID or profile is not authorization evidence.
3. `api/auth/session.js` exposes a no-store, read-only authenticated session probe.
4. `lib/migrations/001_identity_foundation.js` defines `users`, `role_assignments`, `active_role_slots`, and `firebase_identities`. Foreign keys use RESTRICT; active role ownership is a composite FK.
5. `lib/migrations/002_audit_idempotency_outbox.js` defines append-oriented `audit_events`, command `idempotency_requests`, and `outbox_jobs`. It does not apply retention or financial policy.
6. `api/db-migrate.js` is a POST-only, exact-preview-branch, exact-database, feature-flagged migration runner. It requires a 32-character-or-longer secret header and a literal confirmation phrase. It verifies the expected tables after each migration and never seeds user, role or UID records.
7. `lib/with-transaction.js` enforces UTC session time, checks session FK enforcement, and guarantees commit/rollback/release behavior.
8. `lib/idempotency.js` provides canonical request hashing, duplicate-key claim/replay and mismatch rejection. `lib/audit.js` writes append-oriented audit events and blocks credential-like fields from snapshots.
9. `lib/migration-runner.js` applies migrations in order, verifies each expected table set and records applied versions. The Vercel build hook is inert by default and requires the exact preview branch, database, enable flag and confirmation string before it can execute DDL. `/api/db-schema-status` provides a read-only schema verification endpoint.
10. `api/auth/bootstrap-preview-owner.js` can create only the explicitly allowlisted preview Pimpinan identity after Firebase token verification. It is disabled unless a separate Preview-only flag is enabled; it never touches the operational Firebase project or protected production account records.
12. Node's built-in test runner covers signed token acceptance, wrong audience, expired token, invalid signature, transaction commit/rollback, FK enforcement, migration idempotency, request replay, audit snapshot protection and preview-owner bootstrap boundaries. GitHub Actions runs the tests and the guarded build step.

## Preview configuration

A branch-scoped Preview environment variable was added:
- `FIREBASE_PROJECT_ID=assalam-preview-test`

It is not active in an already-built deployment until a later deployment consumes the environment update. No Firebase operational project is configured for this backend.

The migration runner remains disabled because `TIDB_MIGRATIONS_ENABLED` and `TIDB_MIGRATION_BUILD_CONFIRM` have not been set. The separate POST route also remains fail-closed without its secret token. No DDL has been executed.

## Important security limits

- Firebase token verification checks the Google signature and standard Firebase issuer/audience/time claims. It does not perform a Firebase Admin SDK revocation lookup; immediate token revocation is not yet implemented.
- Staff UIDs must be provisioned explicitly into `firebase_identities`, with a matching active user and role slot, before the session endpoint returns an actor. A narrowly allowlisted preview-only owner bootstrap is implemented but remains disabled until the schema is applied and its dedicated flag is enabled.
- The current UI login and Firebase/Firestore synchronization remain unchanged. This is a backend foundation, not a cutover.
- The operational five-account allowlist remains untouched. The preview Firebase project is `assalam-preview-test`, separate from operational `assalam-db`.
- The identity schema is a deliberately narrow first migration, not approval of the full application schema. Owner decisions D01–D20 and FK/DDL runtime evidence still gate dependent domains.

## Verification status

Automated test source and CI workflow have been added. The corrected CI run passed all 12 tests on commit `9d87fef`. Additional tests for migration-runner idempotency, audit writes, idempotency replay and preview-owner bootstrap have since been added; their CI run is pending. The live TiDB migration remains gated for the final preview build. The preview deployment has not yet been verified against this final commit. No application module has been switched from Firebase to TiDB.
