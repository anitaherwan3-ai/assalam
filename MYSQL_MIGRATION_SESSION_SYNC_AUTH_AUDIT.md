# SESSION, SYNC AND AUTHENTICATION PROVENANCE AUDIT
Date: 2026-11-15
Source baseline: main
Fingerprints: app.js f74c4710161ddd2af230e51c18b1f107d6c52c82; store.js 99e74acf8caec9c70d82be1d5f6efc5bfa6bc4fb; firebase-backend.js 3a613d96564f120b8141966f9ecbae21471c4e65.
Scope: static source review only; no Firebase writes/deployments, runtime tests, SQL DDL or production changes.

## Findings

### Authentication provenance blocker
- Browser login uses Firebase email/password, then resolves owner identity from a hard-coded email allowlist or staff profile from k_users/{email}.
- README and AUTH_MIGRATION.md describe Cloud Functions/Admin SDK provisioning, a functions directory, scripts/bootstrap-owner.cjs and function activateInitialPimpinan.
- The inspected main repository tree did not expose a tracked functions/ directory or bootstrap script; repository code search did not locate the named function. This does not prove no deployed function exists. Its source/deployment provenance is unknown.
- AUTH_MIGRATION.md also describes a tablet-only Firestore Rules bootstrap. These are distinct provisioning mechanisms and must not be treated as interchangeable.
- Before auth cutover, locate authoritative Functions source and inventory deployed function names, regions, triggers, runtime, service accounts, secrets/IAM, custom claims, source commit and deployment timestamps. Do not deploy/delete functions during this audit.

### Local state and generic sync
- ClinicStore.saveLocal() writes the entire state to localStorage and normally schedules Firebase pushData().
- Many UI handlers mutate local objects before saveLocal(); logActivity() itself schedules a push.
- Realtime listeners merge by ID and client _t. They do not propagate absent documents as deletes; empty remote snapshots do not clear local arrays. Client clock skew can affect conflict ordering.
- performPush() is debounced, serialized, and batches up to 400 writes per collection, but collections commit separately: the full business operation is not atomic.
- Pimpinan/Admin may push broad collections; Kasir has a narrower write allowlist and patient patch logic. MySQL must not expose a generic pushState/CRUD endpoint.
- Target design: explicit business commands, server timestamps, row versions, idempotency keys, durable outbox, tombstones/reversals and paginated read models.

### Checkout and patient registration
- registerPatientWithQueueNumber() reads today's queue, calculates highest A number, then allocates a deterministic candidate document ID inside a Firestore transaction. Current main is A-only; A/B changes remain in open PR13.
- commitCashierTransaction() checks duplicate invoice ID and stock/batch availability, then decrements stock and writes invoice/return quotas atomically in Firestore.
- Critical gap: checkout marks patient done only if patient document exists; a missing patient does not stop invoice creation.
- Backend accepts client-provided invoice and stockChanges. It does not fully prove stockChanges match invoice/package lines or derive every price, HPP, discount, FEFO, payment and shift condition from trusted server state.
- MySQL checkout must reject missing/ineligible patient, validate cashier's open shift, derive price/HPP/discount/FEFO server-side, lock stock and batches, and atomically commit invoice, patient state, inventory movements, return quotas, cash/bank ledger and audit.

### Shift lifecycle
- actionBukaShift() creates a shift locally and relies on generic push; there is no dedicated openShift command.
- UI getCurrentShift() selects the first open shift for a cashier; uniqueness is not enforced in UI.
- Close shift computes expected cash client-side as opening modal + cash sales - petty cash, then stores system cash, physical cash, variance and closed status locally before generic push.
- Admin verification is also a local mutation/generic push.
- Target API needs openShift, closeShift, verifyShift and correction commands; enforce one open shift per cashier, derive expected cash from ledger, lock during close, freeze closed shift except audited correction/reversal.

### Logout and pending writes
- doLogout() logs logout, clears currentUser, then calls performPush(state) before Firebase sign-out. Backend authorization uses currentProfile, which may still exist until sign-out.
- Logout has both a debounced push triggered by logActivity() and an explicit push. A promise queue serializes backend pushes, but there is no durable outbox guarantee if browser closes or network drops.
- New app should flush acknowledged commands, not upload whole state; report pending commands clearly before sign-out.

### Default configuration
- DEFAULT_SETTINGS includes sample phone/WhatsApp values and running text mentioning “Klinik Sehat Pratama”. Store pins clinic name to “Klinik Assalaam Palembang”, but other sample defaults may be stale.
- Do not migrate placeholder contact values as verified facts. Separate immutable clinic identity from editable settings and preserve unknown raw values in staging.

## Required command inventory
Session/profile; patient registration/contact/cancel/restore/call; shift open/close/verify/correction; cashier checkout; invoice cancellation; staged return submit/review/final approval/payment; petty cash create/reversal; purchase/supplier return/stock adjustment/loss/opname; expense create/approve/reject/reversal; user provisioning/email/role/activation; display/audio; export/backup/restore.

## Required tests
- Missing patient and closed/other cashier shift block checkout.
- Tampered client prices, HPP, totals, discounts and stock allocations are rejected.
- Concurrent last-unit checkout cannot oversell.
- Concurrent shift open yields exactly one open shift.
- Close-vs-checkout race has a consistent serial result.
- Duplicate command is idempotent.
- Browser close/network loss does not lose accepted commands.
- Two owner accounts remain protected through staff management, seed and restore.
- Functions source and deployed configuration are reproducible before auth cutover.
- A/B queue and TV display preserve legacy A tickets and privacy restrictions.

## Safety
Static source review only. No Firebase data/rules/functions changed, no SQL DDL, no real-data migration, and no production deployment.
