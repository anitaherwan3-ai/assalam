# TiDB Operational Integration Audit — 2026-11-25

Repository: `anitaherwan3-ai/assalam`  
Branch: `fix/tidb-queue-shift-guard-2026-11-24`  
Scope: source-level audit of browser UI callsites, TiDB browser adapter, API routes, domain commands, and repositories. This is not a production runtime certification.

## Executive result

The repository has a functioning TiDB foundation and multiple domain APIs, but the application is **not yet fully TiDB-backed**. The current feature switch is Preview-only. The production `index.html` still conditionally loads `js/firebase-config.js` and `js/firebase-backend.js` on `klinikassalaam.vercel.app`. Do not remove those scripts or change the production source of truth until the remaining Preview paths and rollback evidence are complete.

`js/store.js` still initializes operational collections from `localStorage.klinik_data`, inserts local seed masters when collections are empty, and persists the entire in-memory state back to localStorage. In TiDB Preview, some API reads replace selected arrays, but this is a compatibility/cache layer, not a fully migrated repository.

## Module-to-endpoint crosswalk

| Module / data | Browser integration observed | Backend/API coverage | Audit result |
|---|---|---|---|
| Better Auth session | Sign-in, session restore, sign-out through `/api/auth` | Better Auth catch-all and session route | Existing login flow is not in scope for rebuild; retain regression tests |
| User / role management | `listUsers/createUser/updateUser/disableUser` | `GET/POST/PATCH/DELETE /api/admin/users` | TiDB-backed UI exists; test all five fixed accounts and role changes |
| Medicine master | TiDB create + list/hydration | `GET/POST /api/inventory` (medicine create) | Partial: edit/deactivate and stock correction remain local/unsupported |
| Tariff master | TiDB list/create/update/deactivate | `/api/catalog/tariffs` | Covered by catalog adapter |
| Supplier master | TiDB list/create/update/deactivate | `/api/catalog/suppliers` | Covered by catalog adapter |
| Service packages/components | UI still reads local package state; no package method in browser adapter | No package route exposed in current API tree | Not migrated |
| Patient / queue registration | TiDB `registerEncounter` | `POST /api/queue` action `register` | Corrected in this branch to read back the authoritative queue instead of appending a local patient |
| Queue call / transfer / display state | Adapter exposes `callQueue` and `transferQueue`; app callsite inventory shows no use of either method | `POST /api/queue` actions `call`, `transfer` exist | UI not wired; current local call/display path must not be treated as TiDB-authoritative |
| Patient cancel/reactivate/archive/edit | Legacy local state handlers | No patient lifecycle route found | Not migrated |
| Checkout / sales invoice | App calls TiDB checkout | `POST /api/sales` action `checkout`; server builds price/stock snapshot | Core command exists; invoice read model currently omits line details |
| Sales cancellation / return / refund | App calls cancel, return request, staged review, approve and refund methods | `POST /api/sales` state-machine actions | Commands exist; read model still does not expose return line details |
| Purchase invoice creation | UI sends supplier/name/invoice/medicine/quantity/total to `receive_purchase` | Domain command requires an existing `purchaseLineId` and received quantity | Contract mismatch; there is no create-invoice action in current inventory route |
| Purchase receipt / batch | UI calls `receivePurchase` | `POST /api/inventory` action `receive_purchase` | Cannot be completed from current UI form until invoice/line creation and lookup are added |
| Batch / expiry / FEFO | Local UI still depends on `store.state.batch` | Inventory GET currently returns medicine projections, not batch read models | Not migrated; local seed batches are unsafe as operational truth |
| Stocktake / quarantine / supplier return | API/domain commands exist | Inventory route exposes stocktake, quarantine and supplier-return actions | Backend foundation exists; browser callsites/read models need wiring |
| Expenses | TiDB create and approval methods are called | Finance route exposes create/approve | Partially connected; backend GET supplies expense list |
| Cashier shifts | TiDB open/close/verify methods are called | Finance route exposes open/close/verify | Connected at command level; read-after-write checks exist |
| Petty cash | Add/edit/delete mutate local store only | No petty-cash endpoint/action found | Not migrated; financial records must not be treated as persisted in TiDB |
| Payments / supplier payments / refunds | Adapter has methods; callsite audit did not find UI use for payment posting | Finance route exposes record/approve payment, supplier payment, refund transfer | Backend commands exist; UI wiring/read models incomplete |
| Loss / stock adjustment | Local store mutation remains in UI | No matching UI command path confirmed | Not migrated; require immutable inventory movement/reversal |
| Activity / audit display | `store.logActivity` writes local log array | Domain commands write server audit events for covered operations | Split source; local UI log is not a complete TiDB audit view |
| Clinic settings / display/audio | Local settings and display/audio state still present | No complete TiDB settings/media read/write path confirmed | Not migrated |

## Confirmed implementation defects

1. **Queue registration wrote to TiDB and then also appended the patient locally.** The branch now waits for `syncOperationalDataFromTiDB()` after a TiDB registration and skips the local patient push, local queue sequence update, and local activity-log write on that path. The sync function returns a boolean indicating whether the authoritative queue read succeeded.
2. **Purchase UI and backend contracts do not match.** The browser form attempts to create a purchase invoice by calling `receive_purchase`, but the domain command only receives goods against an already-existing supplier invoice line. The UI also calls `getMedicines()`, which is not exposed by `tidb-catalog-ui.js`. Do not workaround this by writing the purchase to localStorage after a TiDB error.
3. **Petty cash is local-only.** The current UI directly mutates `store.state.petty`; no TiDB route exists in the current API set.
4. **Queue call/transfer methods exist in the adapter and backend, but are not called by the app UI.**
5. **Inventory and sales read models are incomplete for the current UI.** Inventory GET returns medicine stock projections only; sales GET returns invoice headers/cancellations/returns without invoice line details. Batch/expiry and return detail screens cannot be declared migrated.
6. **Production is still Firebase-wired.** The production-host conditional script loader remains in `index.html`; the TiDB toggle is named and implemented as Preview-only. This is an explicit cutover gate, not a reason to switch production prematurely.

## Work completed in this pass

- Inspected the active feature branch and latest workflow run.
- Confirmed latest pre-fix CI run: 229 tests passed, 0 failed (commit `ead1f56e6083c76ed0f4d68032808d03e4cc831d`).
- Corrected TiDB queue registration to refresh the queue from the backend after commit and avoid treating the local snapshot as the authoritative write.
- Added a regression test for that read-after-write behavior.

## Remaining engineering order

1. Complete purchase invoice + invoice-line creation, then link receipt, batch, payment allocation and supplier return read models.
2. Add petty-cash and other missing finance commands/read models using immutable ledger/reversal semantics.
3. Wire queue call, transfer, patient lifecycle and display state to TiDB.
4. Add inventory batch/expiry/stocktake/quarantine and package read/write models to the UI.
5. Add invoice line detail, payment method/status and return detail projections to sales/finance UI.
6. Replace local audit/settings/report sources with role-scoped TiDB reads.
7. Only after all Preview parity tests pass, prepare a separately approved production cutover and Firebase removal.

## Safety boundaries

- No production database writes were performed.
- No Firebase data was changed or imported.
- No `main` merge or production deployment was performed.
- The cutover gate file remains unchanged and must not be marked passed without evidence.
