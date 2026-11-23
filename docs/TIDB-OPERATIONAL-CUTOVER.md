# Klinik Assalaam — TiDB Operational Cutover

This document tracks the seven migration workstreams. The production branch and Firebase-backed production behavior must remain unchanged until every gate below passes.

## Safety boundary

- Work on `migration/tidb-operational-cutover`; do not commit migration work directly to `main`.
- Do not write, import, delete, or alter production TiDB/Firebase data from this code task.
- Keep the current production service available until preview parity, reconciliation, backup/restore, and rollback are proven.
- Never import legacy stock or HPP as opening balances. The legacy Firebase records are development/demo masters only.
- Allowed medicine units are `tablet`, `kapsul`, `botol`, and `pcs`; reject/normalize legacy `strip` only through an explicitly reviewed migration rule.

## Seven workstreams

| # | Workstream | Required completion evidence | Current state |
|---|---|---|---|
| 1 | Feature, Firebase collection, and role/access audit | Collection-to-table map; every runtime Firebase read/write identified; role matrix for Pimpinan/Admin/Kasir | Source audit identified operational Firebase call sites in patient registration, checkout/stock, and sales return. |
| 2 | TiDB domain policy and schema | Approved table/field/index/FK dictionary; policy gates for queue prefixes, payments, refunds, returns, shifts, and audit | Existing TiDB schema/domain modules require route-to-UI parity checks; policy-pending errors must not be bypassed. |
| 3 | Medicine, batch, purchasing, and stock | TiDB medicine/catalog reads; purchase receipts; FEFO; quarantine; supplier returns; stocktake; reconciliation | Medicine master list now hydrates the Preview POS/master screen from `GET /api/inventory`; add-medicine writes through the audited TiDB command. Edit/deactivate, purchase-invoice creation/listing, batch UI and stock history still need UI/API work. |
| 4 | Patient, encounter, registration, and queue | TiDB patient/encounter/queue reads and writes; A/B lanes; shift ownership; transfer reason; TV display | API/repository exists and adapter exposes it. App registration/call/transfer still needs migration; no TiDB shift-open/read workflow is present, so queue registration cannot safely be wired to a valid owned shift yet. |
| 5 | Cashier, sales, returns, shifts, and finance | Server-authoritative checkout; return approvals; payment review; refund approval; shift close/verification; audit events | `POST /api/sales` and `POST /api/finance` exist; adapter now exposes command methods. Existing UI still calls Firebase/local state and must be migrated with payload mapping. |
| 6 | Legacy master-data migration | Read-only source profile; validated mapping for medicine/tariff/package/component; duplicate and orphan report; approved import manifest | Dry-run only; do not import operational balances or historical transactions. Package/component references and `klinik_config` document types need validation before any import. |
| 7 | Full regression, reconciliation, and cutover | Role/device tests; transaction and concurrency tests; queue A/B tests; return/refund approval tests; backup restore; rollback rehearsal; explicit final cutover approval | Not ready. No production cutover is authorized by this branch. |

## Adapter work in this branch

`js/tidb-api.js` now explicitly allowlists and wraps the existing operational endpoints:

- `GET /api/inventory` and `POST /api/inventory`
- `POST /api/sales`
- `POST /api/finance`
- `GET /api/queue`, `POST /api/queue`, and `GET /api/queue?display=1`

All mutation wrappers carry an idempotency key; requests remain same-origin and no-store. A Node test verifies the route allowlist, methods, request headers, and rejection of unlisted endpoints.

The Preview medicine master read/create flow is now connected, but only this narrow slice is live in the UI. Existing medicine edit/deactivate controls are blocked in TiDB Preview rather than writing to local storage. Stock receipt/history, service-package catalog API/UI and package checkout expansion, patient, queue, shift, checkout, returns, and finance workflows remain incomplete at the UI/data-source boundary. This is adapter and partial UI groundwork, not proof that the application is fully TiDB-backed. Do not mark the cutover ready until every operational screen stops using Firebase/localStorage for operational reads and writes and the full test matrix passes.

## Verified blockers found during the next implementation pass

### Queue and cashier shift custody

- Migration `005_patient_shift_queue_v1` creates `cashier_shifts`, `active_shift_slots`, and `cashier_queue_assignments`, but it does not seed cashier-to-lane assignments and there is no shift-open command in `lib/clinic-domain-commands.js` or shift-open method in the repositories.
- The existing queue registration command requires an already-open shift owned by the acting user. It then requires an effective `cashier_queue_assignments` row for the selected A/B prefix. The database foreign keys correctly bind each encounter and queue ticket to the shift owner.
- Therefore, exposing queue registration before a reviewed shift-open flow and assignment setup would leave the UI unable to register safely or tempt callers to bypass ownership checks. Do not synthesize shift IDs or silently create lane assignments during patient registration.
- Existing close/verify shift commands and repository methods are present, but they do not substitute for opening a shift. The opening-float source, allowed opener roles, one-active-shift invariant, cashier-to-lane assignment lifecycle, and UI handoff must be covered by tests before enabling the workflow.

### Service package checkout and catalog

- Migration `009_operational_controls_v1` creates the base `service_packages` and `package_components` tables; migration `016_service_package_price_snapshots` adds the package price and component snapshots. The base schema is therefore present in the migration sequence.
- The remaining blocker is functional: there is no package catalog API/UI integration and the authoritative checkout snapshot accepts medicine or tariff references only; it does not expand package components. Package checkout must remain disabled until component quantity rules, price authority, immutable snapshots, return quotas, and tests are implemented.

### Next safe implementation gates

1. Define and test the shift-open contract against the already-created shift tables, including active-slot locking, opening cash, shift code, and audit/idempotency.
2. Add an explicit, authorized cashier A/B assignment workflow (or a reviewed one-time seed) before queue registration is enabled.
3. Add package catalog API/UI and server-side package expansion in checkout, using the existing base tables from migration 009 and snapshot columns from migration 016.
4. Only then wire patient registration, queue calls/transfers, package checkout, and their UI state to TiDB. Keep production and the main branch unchanged until the full Preview test matrix passes.

## Full operational source-of-truth audit (2026-11-22)

### Existing server command coverage (code exists; UI wiring is not implied)

- Patient/queue: `registerEncounter`, `appendQueueCallEvent`, and `transferQueue` exist. Registration requires an active shift owned by the actor and an existing A/B lane assignment. There is no open-shift command or repository method.
- Inventory: server commands exist for medicine creation, purchase receipt, supplier-return request/approval/dispatch, stocktake creation/approval, quarantine inspection/release/disposition. The current Preview UI integration is limited to medicine listing and create; medicine edit/deactivate and the other inventory screens are not wired.
- Sales/returns: server commands exist for checkout, return request, Admin review, Pimpinan approval, and refund approval. The authoritative checkout snapshot currently accepts only medicine or tariff references; it does not expand package items. The browser UI remains on legacy state paths until payload mapping and TiDB IDs are implemented and tested.
- Finance: server commands exist for payment record/review, supplier payments, shift close/verify, refund transfer, expenses, and journal posting. There is no end-to-end evidence that the corresponding UI reads/writes are connected to these commands.
- Queue display: a public read-only display route exists. The operational queue UI and patient registration still need integration and browser verification.

### Critical source-of-truth risk

- `js/store.js` initializes operational collections from localStorage and fallback dummy master data. Its save path writes `klinik_data` and may call `window.firebaseBackend.pushData` when that global exists.
- Therefore the Preview must not be described as fully TiDB-backed while any operational screen can mutate local collections or while production Firebase push paths remain reachable. The Firebase integration must be removed from the production runtime only after every affected UI workflow has a tested TiDB replacement; do not simply disable persistence globally because that would silently lose unfinished workflows.
- The initial local medicine fixtures still include the legacy unit `strip`; the Preview medicine master form now constrains new records to tablet/kapsul/botol/pcs, but existing local fixture state is not a TiDB source and must not be imported as-is.

### Migration ordering and clean-schema verification

- The migration runner applies migrations in order and verifies each migration's `expectedTables` immediately after its statements.
- Migration 009 creates `service_packages` and `package_components`; migration 016 then adds snapshot columns. Add a regression test that locks this ordering and confirms both expected table sets before changing migration definitions.
- The preview migration script is deliberately guarded by Vercel environment, exact branch, database name, explicit enable flag, and a confirmation token. Do not weaken that guard to make an arbitrary branch deploy run schema writes.

### Explicit gates before production cutover

1. Add an audited open-shift command and API after confirming the opening-float and shift-code rules; enforce one active slot per cashier and idempotency under row lock.
2. Add an authorized A/B lane assignment lifecycle tied to the five approved accounts; do not guess user IDs or infer lane from role alone.
3. Implement package catalog CRUD and server-side package expansion in checkout using the existing 009/016 schema; add regression tests for component quantities, snapshots, returns, and package-level discounts policy.
4. Wire every operational UI read and mutation to its corresponding TiDB route, with stable TiDB/public IDs and server-authoritative totals. Cover patients, queue, shifts, purchasing/receipts, batch stock/FEFO, quarantine, stocktake, sales, returns/refunds, supplier obligations/returns, expenses, cash ledger, and reports.
5. Remove Firebase SDK/config/push runtime paths from production only after a repository-wide call-site audit proves no active operational workflow depends on them. Keep Firebase dummy import tooling separate and read-only.
6. Run the complete Node test suite, migration smoke tests on an empty Preview schema, API authorization/idempotency/transaction tests, and browser regression tests for all five accounts. Then verify Preview runtime and obtain explicit production cutover approval.

### Current verification state

- Changes are isolated to `migration/tidb-operational-cutover`; `main` and production database are unchanged.
- No test suite, migration application, Preview browser test, or production deployment has been run in this work session. GitHub status checks returned no status entries; that is not evidence of passing tests.
- This audit intentionally records unimplemented gates rather than claiming the app is fully connected.


## Additional implementation pass (2026-11-23)

### Purchase receipt batch lineage correction

- The command validated an authoritative purchase line and receipt quantity, but the repository batch writer also requires `sourcePurchaseLineId`, `medicineId`, and receipt quantities. The command previously forwarded only the validated batch payload and receipt ID, so a real purchase receipt could fail at batch insertion.
- The command now explicitly supplies the locked/validated purchase line ID and medicine ID, and sets batch received/remaining quantity from the authoritative receipt quantity (not a client-supplied batch quantity).
- The command harness now asserts this lineage and quantity contract. This is a source-level regression test addition; it has not yet been executed in CI/runtime.

### Preview migration gate mismatch

- `scripts/apply-preview-migrations.js` currently runs migrations only when `VERCEL_GIT_COMMIT_REF === "migration/tidb-foundation"`, while this operational work is on `migration/tidb-operational-cutover`.
- Therefore a Preview deployment from this branch will skip the migration step even if the TiDB migration enable flag is true. Do not weaken or broaden the guard until the intended Preview branch and exact deployment environment have been confirmed; otherwise an unintended deployment could execute schema writes.
- This needs an explicit, controlled Preview deployment plan and environment check before runtime migration verification.

### Current work added

- Corrected the package schema audit: base package tables are created in migration 009, and migration 016 adds snapshots.
- Added migration-order regression coverage for those package tables.
- Corrected purchase receipt batch lineage and added command-harness assertions.
- Historical snapshot at the time of the preceding note: CI results were not yet available. See the dated implementation update below for the newer verified run results.


## Implementation update — ordered work 1–5 (2026-11-23)

### 1. CI/runtime alignment
- Updated the package Node engine requirement and both TiDB GitHub workflows to Node.js 22.12.0. This resolves the earlier mismatch where Better Auth dependencies required Node 22 but CI ran Node 20.
- CI on commit `70b4a4cf6038ea1437ad5b614baacc974ca9b5ad` completed with 223 tests passing and zero failures.
- Additional tests were added after that run for operational Preview auth, shift opening, lane assignment, and patient/queue UI. Their latest CI run must be checked before treating them as passed.

### 2. Preview migration and auth branch gates
- Added a shared allowlist for the two exact TiDB Preview branches: `migration/tidb-foundation` and `migration/tidb-operational-cutover`. Preview owner status and protected-owner bootstrap now recognize the operational branch.
- The migration runner accepts the operational branch only when `TIDB_MIGRATION_EXECUTION_CONTEXT=github-actions`; the dedicated migration workflow sets this context and checks out the operational branch.
- The migration workflow now validates migrations 001–016, Node.js 22.12.0, the `tidb-preview` GitHub environment, required secrets, database name, and an exact trigger commit title.
- The trigger file currently contains `PREPARED_ONLY_AWAITING_EXPLICIT_PREVIEW_SCHEMA_APPROVAL`, not the approval token. The migration job therefore cannot apply schema yet. This is intentional: no TiDB schema writes were performed in this implementation pass.

### 3. Preview authentication UI
- The login modal now exposes the Pimpinan bootstrap/recovery action on a recognized TiDB Preview hostname. It remains hidden on the production hostname `klinikassalaam.vercel.app`.
- The owner status and bootstrap APIs are guarded to the allowlisted Preview branches, Preview environment, database `assalam_db`, configured owner email, origin, and one-time secret.
- The approved five-account roster remains: Pimpinan `praktekrose@gmail.com` and `nursalim42@gmail.com`; Kasir 1 `assalamkasir1@gmail.com`; Kasir 2 `assalamkasir2@gmail.com`; Admin `assalamadmin1@gmail.com`.
- The initial roster remains protected from identity/role changes; password updates are handled through the Pimpinan account-management API. No passwords or credentials were written during this pass.

### 4. Queue and shift integration
- Added an audited, idempotent shift-open command and `GET/POST /api/shifts`.
- Shift code is server-derived: Kasir 1 = `morning`, Kasir 2 = `afternoon`, Admin = `admin`. The opening float is a non-negative Rupiah integer and initializes expected cash. A unique active-shift slot prevents multiple active shifts for the same cashier.
- Added Pimpinan-only A/B lane assignment. The server enforces Kasir 1 → A and Kasir 2 → B; other Kasir accounts are not silently assigned a lane.
- TiDB Preview UI now has shift opening/listing, patient registration into the assigned queue, queue list, call/recall, and reason-required transfer to another active cashier shift.
- Queue registration still requires a valid open shift and effective A/B assignment. The UI does not bypass those backend checks.

### 5. Source-of-truth audit and remaining work
- Preview UI paths now include TiDB shift, patient/queue, user management, and medicine master slices.
- The app still contains legacy Firebase and localStorage operational paths. They must not be removed or treated as production-safe until purchasing, package catalog/checkout, sales, returns/refunds, finance, stock history, quarantine, stocktake, and reports have their own TiDB read/write UI paths and regression coverage.
- `api/sales.js` and `api/finance.js` currently expose mutation commands but no complete list/read endpoints; purchasing invoice creation/list UI and package checkout expansion also remain incomplete.
- No production branch merge, production deployment, production DB write, or Firebase import occurred.


### Operational source-of-truth safety gate
- In TiDB Preview, only the already integrated tabs (Shift, Pasien/Antrean, Obat & Tarif, Pengguna) are allowed to render their current operational UI.
- Other operational tabs now show an explicit not-yet-integrated notice instead of rendering localStorage/Firebase workflows. This is a temporary safety gate, not completion of those modules.
- The patient/queue UI uses TiDB endpoints for registration, call/recall and reason-required transfer. The shift UI uses TiDB for open, close and verification.
- Cashier shift verification now requires two distinct Admin users; an Admin shift requires one Pimpinan approval. Migration 017 creates an immutable verifier event table with unique (shift, verifier) enforcement.
- The operational rollback-only smoke test now exercises the two-Admin approval sequence. It has not yet been run against TiDB because the Preview migration trigger remains inactive.


### Preview migration execution attempt — blocked safely (2026-11-23)
- The explicit Preview migration workflow was invoked for migrations 001–017 after the ordered work request.
- It stopped at the first validation step because the GitHub Environment `tidb-preview` did not provide `TIDB_HOST`, `TIDB_PORT`, `TIDB_USER`, `TIDB_PASSWORD`, `BETTER_AUTH_URL`, and `BETTER_AUTH_SECRET`.
- The TiDB connection preflight, migration runner, and smoke tests were skipped. No database connection was opened and no schema/data writes occurred.
- The trigger marker was returned to its inactive prepared state to prevent an accidental repeat. After Vercel team access is approved and the required GitHub Environment secrets are configured, rerun the controlled migration workflow.
- The Vercel project-domain inspection also requires approval for team `salims-projects-b5dee623`; the single-use consent link was provided in chat.
