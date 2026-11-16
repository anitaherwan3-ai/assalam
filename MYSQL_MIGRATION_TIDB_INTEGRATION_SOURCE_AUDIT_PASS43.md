# TiDB Integration Source-of-Truth Audit — Pass 43

**Branch:** `migration/tidb-foundation`  
**Date:** 2026-11-16  
**Scope:** Read-only source audit of the current browser application and proposed TiDB integration seam  
**Application/database mutation:** None  
**Firebase/Auth/account mutation:** None  
**Deployment:** None

## 1. Verified current runtime architecture

The preview application is still a browser-first Firebase application:

- `index.html` loads `js/helpers.js`, `js/store.js`, `js/firebase-config.js`, `js/firebase-backend.js`, `js/export-helper.js`, and `js/app.js` in that order.
- `js/store.js` constructs `window.clinicStore`; the store loads and persists the complete application state to browser `localStorage` under `klinik_data`.
- `ClinicStore.saveLocal()` calls `window.firebaseBackend.pushData(this.state)` when sync is enabled.
- `js/firebase-backend.js` initializes Firebase Auth + Firestore, validates a Firestore profile, and installs collection listeners. It remains the current authentication/session and synchronization adapter.
- `js/app.js` obtains the session from `window.firebaseBackend.login(email,password)`, applies the Firestore profile to the in-memory UI session, and renders role tabs. The application is not yet calling TiDB APIs for its domain modules.
- `package.json` currently has only `mysql2` as a dependency and does not define a test/build script or Firebase Admin token-verification dependency.
- Existing TiDB server code consists of `lib/tidb.js`, `api/db-health.js`, and the guarded synthetic-only `api/db-compatibility.js`. No application-domain API router or versioned application migration runner was found in the inspected source files.

## 2. Authentication boundary findings

The current browser login does not yet hand an ID token to a TiDB API. The current Firebase adapter verifies a Firestore profile after Firebase sign-in. The backend must not accept a browser-supplied role, user ID, email-to-role assertion, or profile object as authorization evidence.

A safe bridge therefore requires all of the following before any TiDB domain write is enabled:

1. Server-side Firebase ID-token signature, issuer, audience, expiry and revocation verification against the exact preview Firebase project.
2. A server-owned immutable Firebase UID to TiDB user mapping.
3. Server-side active role resolution from approved relational role records on every request (or a bounded, revocable session design).
4. Explicit mapping/review for every protected identity; no email-only identity migration and no inferred role for `nursalim422@gmail.com`.
5. Deny-by-default behavior when token, UID mapping, role assignment, account status, or database lookup is absent or ambiguous.

The preview Firebase config points to `assalam-preview-test`; it is deliberately separate from operational Firebase. The preview's historical email/role allowlists are not authority to mutate or seed the five protected operational identities. No UID mapping was read or changed in this pass.

## 3. Domain integration inventory

The browser store currently exposes these synchronized collection names:

`obat`, `tarif`, `paket`, `pasien`, `trx`, `petty`, `beli`, `biaya`, `loss`, `shift`, `batch`, `log`, `users`, `returJual`, `returBeli`, and `batalTrx`.

These are legacy UI/store collection names, not a safe relational schema. The approved migration boundary must be command-oriented and transactional rather than exposing a generic collection CRUD endpoint. The proposal's initial mapping includes patient/encounter/queue, shift/drawer, medicine/batch/movements, invoices/payments, returns/refunds/cancellations, supplier payable, expenses, audit, idempotency and display configuration.

## 4. Safe implementation sequence

The first application integration package should be built behind an explicit preview-only feature gate and should progress in this order:

1. Token verification + immutable identity mapping + server role authorization.
2. Read-only API and a harmless authenticated identity/health probe.
3. Patient/encounter/queue and shift command services with idempotency and row-lock tests.
4. Medicine/batch/inventory movement and purchase receipt commands.
5. Invoice checkout/payment, then return/cancellation state machines.
6. Finance/report read models and reconciliation checks.
7. Browser adapter behind a reversible feature flag; retain the Firebase adapter as rollback until acceptance.

Do not introduce a generic `/api/collections/:name` read/write endpoint. It would bypass the proposal's ownership checks, transaction boundaries, field validation, immutable snapshots, role scope and ledger invariants.

## 5. Schema and policy boundary

The schema proposal remains a review draft, not executable DDL. Its decision register still contains owner gates D01–D20. In particular, quantity precision, return disposition, package refund allocation, service-return eligibility, expense/petty-cash treatment, supplier credit/payment handling, shift verification, refund payout methods, non-cash recognition date, opening stock/HPP, queue A/B semantics, legacy timestamps, retention/audit retention and final auth-provider policy must not be silently invented.

Engineering can continue on independent foundations and test harnesses, but any table or command whose meaning depends on an unresolved gate must remain deferred or explicitly quarantined. The existing preview database is shared `assalam_db`; synthetic tests must remain strictly guarded and cleanup-verified. Do not run application DDL until the exact migration set, target isolation, rollback and TiDB runtime evidence are reviewed.

## 6. Verification status

This pass was a static source read and cross-check only.

- Confirmed: current app remains Firebase/localStorage-driven; TiDB is not yet integrated into patient, queue, inventory, transaction, shift, return or report modules.
- Confirmed: no Firebase ID token is currently forwarded from the browser login flow to a TiDB API.
- Confirmed: no application migration runner or domain API implementation exists in the inspected source.
- Not performed: Node syntax checks, automated tests, live SQL, schema DDL, endpoint writes, data import, account mutation, deployment or production change.

**Decision:** Pass 43 closes the current application integration inventory. It does not approve schema v1 or claim a working TiDB application cutover.
