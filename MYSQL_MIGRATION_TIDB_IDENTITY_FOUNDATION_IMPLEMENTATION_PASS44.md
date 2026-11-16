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
8. Node's built-in test runner covers signed token acceptance, wrong audience, expired token, invalid signature, transaction commit/rollback, FK enforcement and migration FK invariants. A GitHub Actions workflow runs `npm test` on this migration branch.

## Preview configuration

A branch-scoped Preview environment variable was added:
- `FIREBASE_PROJECT_ID=assalam-preview-test`

It is not active in an already-built deployment until a later deployment consumes the environment update. No Firebase operational project is configured for this backend.

The migration runner remains disabled because `TIDB_MIGRATIONS_ENABLED` and `ASSALAM_MIGRATION_TOKEN` have not been set. It therefore cannot mutate the database by an ordinary request. No DDL has been executed.

## Important security limits

- Firebase token verification checks the Google signature and standard Firebase issuer/audience/time claims. It does not perform a Firebase Admin SDK revocation lookup; immediate token revocation is not yet implemented.
- A UID must be provisioned explicitly into `firebase_identities`, with a matching active user and role slot, before the session endpoint returns an actor. No email-only or guessed UID bootstrap exists.
- The current UI login and Firebase/Firestore synchronization remain unchanged. This is a backend foundation, not a cutover.
- The operational five-account allowlist remains untouched. The preview Firebase project is `assalam-preview-test`, separate from operational `assalam-db`.
- The identity schema is a deliberately narrow first migration, not approval of the full application schema. Owner decisions D01–D20 and FK/DDL runtime evidence still gate dependent domains.

## Verification status

Automated test source and CI workflow have been added. The first CI pass verified the token and identity-migration tests (7 passed) but exposed a test-isolation issue: importing the transaction helper eagerly loaded the production MySQL driver. The helper now loads the driver only when a real pool transaction is requested, so its mock-connection tests run without a database package or live DB. The corrected CI run is pending. No live TiDB migration was run. The preview deployment has not yet been verified against this final commit. No application module has been switched from Firebase to TiDB.
