# Klinik Assalaam — Database Migration Timeline

Updated: 2026-11-19
Working branch: migration/tidb-foundation
Repository: anitaherwan3-ai/assalam

## Current state
This is a migration workstream on an isolated branch, not a production cutover. The branch currently contains the TiDB migration foundation and operational domain implementation. No claim is made here that the branch has been merged into main or that TiDB schema/data migration has completed.

## Completed work (code, audit, or decisions)
1. Migration decision: move the long-term primary database from Firebase/Firestore to MySQL-compatible TiDB while preserving Firebase until the replacement is proven.
2. Repository/preview foundation: isolated branch and Vercel preview project created; prior /api/db-health check returned a successful TiDB connection.
3. Schema design and audit passes: identity, audit/idempotency/outbox, catalog, patient/shift/queue, inventory/purchasing, sales/returns/refunds, finance and operational controls represented in migrations 001–013.
4. Better Auth foundation: email/password provider, session handling, cookie-based browser adapter, session endpoint, actor resolution and core schema migration 004 are present in code.
5. Domain implementation: patient/shift/queue, inventory/batch, purchasing, sales/returns/refunds, finance, audit and related repository/API modules are present on the branch.
6. Firebase evidence tooling: export profiler, relationship profiler and UID reconciliation profiler were created as read-only tools. The owner later confirmed the authoritative five-account roster, so UID matching is not a prerequisite for the new authentication flow.
7. Owner policy decisions: separate queue A/B and handoff; admin support; Pimpinan full authority; audit logging; returned medicines quarantined pending approval; refunds require Pimpinan approval; non-cash receipts remain pending review; operational and financial controls captured in the migration design.
8. On 2026-11-19, owner-confirmed bootstrap roster was encoded in lib/clinic-auth-roster.js and unit tests added.\n9. Better Auth Admin plugin was enabled for provider-level admin authority (intended only for clinic Pimpinan); additive migration 014 adds the plugin's user/session fields. CI is running; the schema change is not yet applied to TiDB.\n10. Owner-approved selective Firebase import scope is documented in MYSQL_MIGRATION_SELECTIVE_FIREBASE_IMPORT_SCOPE_2026-11-19.md. Only medicine/tariff/package masters and approved non-secret settings are candidates; demo operational history is excluded.

## Not yet completed / gates
1. Finish controlled account activation and Better Auth provisioning for the five approved identities; verify the two Pimpinan provider roles are privileged and the other three are not.
2. Complete Pimpinan-only account administration end-to-end: create, update identity/clinic role, disable (soft-delete), password reset, revoke sessions, audit every mutation; protect all five fixed identities from unintended changes.
3. Resolve initial credential activation securely. The requested qwerty123 is shorter than the current 12-character minimum; do not weaken password policy or store plaintext passwords. Use per-user one-time activation/reset.
4. Add and validate invite/activation state and ensure migration 014 is correctly represented in schema manifest, migration runner and pinned Better Auth 1.7.25 schema check.
5. Finish endpoint and UI integration for user administration; enforce Pimpinan on server, not only in the UI.
6. Run the full local/GitHub test suite and fix regressions; validate Better Auth schema compatibility against pinned 1.7.25.
7. Confirm preview environment variables, deployment quota, and gated preview migration conditions. Do not deploy merely to test code.
8. Apply migrations to TiDB preview only after explicit gate and complete smoke-test review.
9. Export only allowlisted medicine/tariff/package masters and approved settings; validate, dry-run, import idempotently and reconcile. Do not export demo patient, transaction, finance or batch history.
10. Test cross-device sessions and workflows, roles, queue, inventory/batches/FEFO, checkout, returns/refunds, finance, shift close, audit and concurrency.
11. Run cutover readiness checks, backup/rollback rehearsal, then obtain a deliberate production cutover approval.
12. Keep Firebase and existing operational data intact until post-cutover verification and agreed retention period are complete.

## PR / Pass tracking note
The repository branch has a large commit history relative to main; a branch commit count is not the same as a set of reviewed/merged pull requests. No PR number or merge status is asserted in this timeline. The numbered Pass documents are audit/work packages, not necessarily GitHub PRs. Verify GitHub PR records separately before calling any work a merged PR.

## Safety invariants
- Never merge to main or change production as part of this work.
- Never run database DDL/import without the preview migration gates.
- Never delete operational records to simulate user deletion; disable accounts and preserve audit references.
- Never hardcode initial passwords, invite tokens, or secrets.
- Keep Firebase available until TiDB replacement passes acceptance and rollback checks.
