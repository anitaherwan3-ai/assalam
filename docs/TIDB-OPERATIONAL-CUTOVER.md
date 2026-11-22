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

The Preview medicine master read/create flow is now connected, but only this narrow slice is live in the UI. Existing medicine edit/deactivate controls are blocked in TiDB Preview rather than writing to local storage. Stock receipt/history, service packages (no package master/component tables or catalog API are present in the current migration set), patient, queue, shift, checkout, returns, and finance workflows remain incomplete at the UI/data-source boundary. This is adapter and partial UI groundwork, not proof that the application is fully TiDB-backed. Do not mark the cutover ready until every operational screen stops using Firebase/localStorage for operational reads and writes and the full test matrix passes.

## Verified blockers found during the next implementation pass

### Queue and cashier shift custody

- Migration `005_patient_shift_queue_v1` creates `cashier_shifts`, `active_shift_slots`, and `cashier_queue_assignments`, but it does not seed cashier-to-lane assignments and there is no shift-open command in `lib/clinic-domain-commands.js` or shift-open method in the repositories.
- The existing queue registration command requires an already-open shift owned by the acting user. It then requires an effective `cashier_queue_assignments` row for the selected A/B prefix. The database foreign keys correctly bind each encounter and queue ticket to the shift owner.
- Therefore, exposing queue registration before a reviewed shift-open flow and assignment setup would leave the UI unable to register safely or tempt callers to bypass ownership checks. Do not synthesize shift IDs or silently create lane assignments during patient registration.
- Existing close/verify shift commands and repository methods are present, but they do not substitute for opening a shift. The opening-float source, allowed opener roles, one-active-shift invariant, cashier-to-lane assignment lifecycle, and UI handoff must be covered by tests before enabling the workflow.

### Service package schema

- The migration inventory currently contains migrations 001–016. No migration creates `service_packages` or `package_components`.
- Migration `016_service_package_price_snapshots` only alters those two tables, so it cannot bootstrap a clean database by itself. Package catalog APIs/UI must remain disabled until the base DDL, constraints, component quantity rules, package price authority, and migration ordering are supplied and tested.

### Next safe implementation gates

1. Define and test the shift-open contract against the already-created shift tables, including active-slot locking, opening cash, shift code, and audit/idempotency.
2. Add an explicit, authorized cashier A/B assignment workflow (or a reviewed one-time seed) before queue registration is enabled.
3. Add the missing service-package base migration before applying migration 016 on a clean TiDB database.
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

### Migration ordering issue: package tables

- The migration runner applies the supplied migrations in order and verifies each migration's `expectedTables` immediately after its statements.
- Migration 016 alters `service_packages` and `package_components`, but no earlier migration creates either table. A later migration cannot repair this ordering because 016 will fail first on a clean database.
- Do not create guessed package tables: checkout currently does not support package expansion, and the intended component constraints, package snapshot semantics, and quantity/unit treatment need to match the application policy. Add the base DDL before 016 only after the package domain contract and repository queries are specified.

### Explicit gates before production cutover

1. Add an audited open-shift command and API after confirming the opening-float and shift-code rules; enforce one active slot per cashier and idempotency under row lock.
2. Add an authorized A/B lane assignment lifecycle tied to the five approved accounts; do not guess user IDs or infer lane from role alone.
3. Implement the package base migration before 016, package catalog CRUD, and server-side package expansion in checkout; add regression tests for component quantities, snapshots, returns, and package-level discounts policy.
4. Wire every operational UI read and mutation to its corresponding TiDB route, with stable TiDB/public IDs and server-authoritative totals. Cover patients, queue, shifts, purchasing/receipts, batch stock/FEFO, quarantine, stocktake, sales, returns/refunds, supplier obligations/returns, expenses, cash ledger, and reports.
5. Remove Firebase SDK/config/push runtime paths from production only after a repository-wide call-site audit proves no active operational workflow depends on them. Keep Firebase dummy import tooling separate and read-only.
6. Run the complete Node test suite, migration smoke tests on an empty Preview schema, API authorization/idempotency/transaction tests, and browser regression tests for all five accounts. Then verify Preview runtime and obtain explicit production cutover approval.

### Current verification state

- Changes are isolated to `migration/tidb-operational-cutover`; `main` and production database are unchanged.
- No test suite, migration application, Preview browser test, or production deployment has been run in this work session. GitHub status checks returned no status entries; that is not evidence of passing tests.
- This audit intentionally records unimplemented gates rather than claiming the app is fully connected.
