# IDENTITY & AUTHORITY SOURCE AUDIT
Date: 2026-11-15
Scope: static review of branch `migration/tidb-foundation`; no Firebase writes, rules/functions deployments, TiDB DDL, production deployment, or real-data access.

## 1. Files and source coverage
Reviewed:
- `firebase.json`: declares Firebase Functions source directory `functions` and Firestore rules file.
- `js/firebase-backend.js`: browser Firebase initialization, login, profile resolution, staff profile provisioning, sync authorization and business write methods.
- `js/app.js`: login/session application, logout and staff provisioning UI.
- `firestore.rules`: owner/staff identity and collection permissions.
- `AUTH_MIGRATION.md`: documented bootstrap and Cloud Function activation procedures.
- `MYSQL_MIGRATION_SESSION_SYNC_AUTH_AUDIT.md`: prior provenance and session audit.

Repository directory inspection on this branch found no tracked `functions/` directory, no `functions/package.json`, and no tracked `scripts/` directory. Thus the code for the documented `activateInitialPimpinan` Cloud Function and `scripts/bootstrap-owner.cjs` could not be verified in this branch. This is a source-provenance gap, not proof that no deployed function exists. The deployment's live source, region, service account, triggers, IAM, secrets and commit remain unverified.

The preview branch's root `package.json` contains only `mysql2`; it is not the Firebase Functions package manifest. No `firebase-admin`, token-verification middleware, or server-side identity endpoint was found in the preview API directory. Current preview API consists of database health and compatibility diagnostics only.

## 2. Current Firebase identity path (observed)
1. Browser signs in with Firebase email/password through `signInWithEmailAndPassword`.
2. `onAuthStateChanged` calls `verifyAuthProfile(user)`.
3. Two owner emails are hard-coded in browser code and mapped to stable usernames:
   - `praktekrose@gmail.com` -> `praktekrose`
   - `nursalim42@gmail.com` -> `pimpinan2`
4. Owner profile resolution reads/writes `k_users/{username}`; it checks an existing UID mismatch, email mismatch, non-pimpinan role and explicit inactive state before merging the owner profile.
5. Staff profile resolution reads `k_users/{lowercase-email}`; it checks matching email, `active === true`, and role in `admin|kasir`. It currently does not compare a stored profile UID with the authenticated Firebase UID.
6. The app then builds its client session from the Firestore profile. UI role checks use that profile. These UI checks are not a replacement for Firestore Rules or future API authorization.

## 3. Authorization rules observed
- Firestore Rules identify the two owners by `request.auth.token.email` allowlist.
- Staff identity is resolved from a profile document whose ID is the authenticated email; profile must be active and role admin/kasir.
- Owners can read all user profiles. Staff can read only their email-keyed profile.
- Owner provisioning writes are restricted to the matching owner document and authenticated UID/email; staff profile provisioning is restricted to the three configured staff email documents.
- Staff profile deletion is restricted to owners and the three configured staff documents.
- Other collection rules use owner/admin/cashier role helpers. The complete per-collection matrix remains in `MYSQL_PERMISSION_MATRIX_AND_TESTS.md` and the Firestore rules audit.

## 4. Important security and correctness findings
### AUTH-01 — authoritative Functions source unavailable (BLOCKER)
Documentation refers to `activateInitialPimpinan` and `scripts/bootstrap-owner.cjs`, while this branch has no tracked Functions or scripts directory. Do not treat the documented function as verified or deployable until the authoritative source and deployed configuration are recovered.

### AUTH-02 — staff UID binding is not checked in browser profile resolution (HIGH)
`verifyAuthProfile` validates email, active flag and role, but not `profile.uid === user.uid`. Rules currently key staff profile by email. Target identity records must bind immutable Firebase UID (or another verified external subject) to the internal user ID and reject subject mismatch. Before changing current Firebase code, assess existing staff documents and rules in a separate controlled review.

### AUTH-03 — verified-email state is not explicitly checked in browser login (HIGH)
The reviewed login/profile path checks the email string but does not explicitly require Firebase `emailVerified === true`. The current Firestore Rules allowlist also checks email claim but not an explicit verified-email claim. Decide and enforce a verified-email policy in the trusted server boundary; do not silently lock out existing accounts during migration.

### AUTH-04 — browser is not an authorization boundary (HIGH)
Hard-coded email mapping and UI role checks can improve navigation but cannot authorize database operations. The future Vercel API must verify a signed Firebase ID token using a trusted verifier, then load active role and status from server-controlled TiDB records. Never accept client-supplied `role`, `u`, `clinic`, email, owner flag, price, HPP or permissions as authority.

### AUTH-05 — staff profile provisioning does not provision Firebase Auth users (MEDIUM)
The app explicitly expects staff Auth accounts to be created manually in Firebase Console first. The button writes Firestore profile records only. This is consistent with the UI description but must not be mistaken for full account creation or password management.

### AUTH-06 — owner profile is protected by multiple mechanisms but provisioning provenance is incomplete (HIGH)
The two owner emails are allowlisted in browser code and Firestore Rules, and the owner profile path refuses an existing different UID. However, the separate Cloud Function/Admin SDK safeguards described in documentation cannot be verified from tracked source. Preserve `praktekrose` and its external Auth UID; never let ordinary staff CRUD, seed, import, restore or cleanup deactivate, delete, reassign or demote it.

### AUTH-07 — identity email and username have different lifecycle requirements
Owner profiles use stable username document IDs; staff profiles use email document IDs. Target schema must not use email as the durable primary key. Use immutable internal user ID plus external identity subject; active email claims are unique only while active, and email history is retained separately. Email change must require re-authentication/verification, reserve the new address atomically, retain the same internal user ID, record old/new values in append-only audit history, and revoke or refresh sessions safely.

### AUTH-08 — logout/pending sync behavior needs explicit command semantics
Current logout logs activity and performs a broad state push before Firebase sign-out. Future API must not expose generic state upload. It must acknowledge individual idempotent commands, report pending writes, and define session revocation/logout behavior.

## 5. Required target identity model
- `users`: immutable internal user ID, display name, active/suspended state, timestamps.
- `external_identities`: provider, immutable provider subject/UID, internal user ID, verified status and lifecycle; unique(provider, subject).
- `active_email_claims`: normalized email unique while active; links to internal user ID.
- `email_history`: append-only old/new address, verification event, actor, timestamp and reason.
- `active_role_slots`: one active role per user in this clinic; no duplicate active role slot.
- `user_sessions` or a verified token strategy: session/version/revocation support; do not trust browser local storage.
- `audit_events`: append-only identity, role, activation, suspension, email and session events.
- Fixed clinic tenant identifier; never infer clinic from client input.

## 6. Role and account invariants
- Owner 1: `praktekrose`, Pimpinan utama, protected root owner.
- Owner 2: `pimpinan2`, Pimpinan.
- Admin: `admin-gudang`, Admin.
- Cashier 1: `kasir`, Kasir, queue A.
- Cashier 2: `kasir2`, Kasir, queue B.
- Exactly one active role slot per account in this clinic unless a future explicit multi-role policy is approved.
- Only Pimpinan can provision, activate, suspend or change staff role; high-impact owner changes require an explicit owner-only recovery procedure.
- No staff action can mutate either owner identity.
- A user email change must not change internal user ID, historic transaction actor IDs, cashier/shift ownership or audit attribution.
- Do not migrate passwords or store password hashes in the clinic database. Keep Firebase Authentication as the interim credential provider until a separately reviewed cutover is approved.

## 7. Future API authorization sequence
1. Accept bearer Firebase ID token only over HTTPS.
2. Verify signature, issuer, audience/project ID, expiry and revocation policy with trusted server-side Firebase Admin SDK or equivalent verifier.
3. Resolve immutable provider subject/UID to internal user ID.
4. Confirm identity is active, email policy is satisfied, clinic membership is active and role slot is active.
5. Build server-side request context; ignore client-supplied role and identity claims for authorization.
6. Apply endpoint-level permission and object ownership checks.
7. Execute a named business command in a transaction with idempotency key, row-level guards and append-only audit event.
8. Return minimal response; never expose secrets, token contents or raw SQL errors.

## 8. Mandatory tests before identity cutover
- Existing master UID remains unchanged and cannot be deleted, suspended, reassigned or demoted by Admin/Kasir, seed, import, restore or cleanup.
- Owner 2 and each staff identity map to exactly one internal user.
- Wrong provider subject/UID cannot use another person's profile.
- Unverified email behavior is explicit and tested.
- Suspended account and revoked token are rejected server-side.
- Role change takes effect according to documented token/session refresh policy.
- Duplicate active email claim is rejected atomically; email change rollback leaves old claim intact.
- Staff provisioning cannot silently overwrite a conflicting UID, role or email.
- All endpoints tested for Pimpinan, Admin, Kasir 1, Kasir 2, anonymous, suspended and wrong-clinic callers.
- Cross-cashier access and cross-shift access denied even if IDs are guessed.
- Replay/idempotency and audit actor identity verified.

## 9. Current disposition
- Static source inspection: COMPLETE for the listed tracked files.
- Deployed Cloud Functions/Admin SDK provenance: NOT VERIFIED.
- Firebase runtime identity tests: NOT RUN.
- TiDB identity tables or DDL: NOT CREATED.
- New API auth middleware: NOT IMPLEMENTED.
- Production Firebase/Vercel and `main`: UNCHANGED.
- Migration gate: BLOCKED until authoritative Functions source/deployment provenance and owner identity mapping are verified.
