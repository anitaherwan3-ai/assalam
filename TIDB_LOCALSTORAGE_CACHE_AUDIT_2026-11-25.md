# TiDB Local Cache and Operational Persistence Audit
Date: 2026-11-25
Repository: anitaherwan3-ai/assalam
Working branch: fix/tidb-localstorage-cache-only-2026-11-25
Audit base: 1a08bdbedfd765600ea3fc3cf60d87bdc237f373

## Scope and safety
Read-only source audit after the localStorage cache-only changes. No production deployment, database mutation, merge, or pull request was performed. This report distinguishes API-backed writes from browser-only state changes; an API existing on the server does not prove the UI calls it.

## Confirmed cache-only behavior in the working branch
- In TiDB Preview mode, `ClinicStore.loadLocal()` reads `klinik_ui_preferences`; if absent, it reads only `set` from legacy `klinik_data`.
- Operational collections are initialized empty in TiDB mode; legacy demo seed data is not injected.
- `ClinicStore._flushSave()` writes only `klinik_ui_preferences` in TiDB mode. It does not write operational state to `klinik_data`.
- Firebase push is suppressed while TiDB mode is active.
- This is not yet a production cutover: `js/tidb-api.js` sets the bootstrap flag only when the hostname contains `assalam-mysql-preview` or `klinik-assalaam`. The known production host `klinikassalaam.vercel.app` does not match either substring. Do not change this gate until production API coverage and authentication are verified.

## Important distinction
Cache-only persistence prevents operational data from being stored in browser localStorage, but it does not automatically make every screen/API-backed. A number of existing UI actions still mutate `store.state` and call `saveLocal()` without a matching TiDB write. In TiDB Preview these changes may appear temporarily in the current page and disappear after reload. Those actions must be connected to server commands or disabled with a clear error before the clinic relies on them.

## Module audit

| Module / action | Existing TiDB API coverage | Current UI behavior / gap | Priority |
|---|---|---|---|
| Login/session | Better Auth session/sign-in endpoints | Existing adapter; do not rebuild without a regression | Maintain |
| Medicine read | `GET /api/inventory` | Read model supplies medicine and stock projections | High |
| Medicine create | `POST /api/inventory create_medicine` | UI calls API in Preview | High |
| Medicine edit/deactivate | No matching inventory action exposed | `editObat` and `delObat` mutate browser state only | Critical |
| Tariff CRUD | `/api/catalog/tariffs` GET/POST/PATCH/DELETE | Preview UI calls `assalamTiDBCatalog`; reloads catalog after write | Covered; verify tests |
| Supplier CRUD | `/api/catalog/suppliers` GET/POST/PATCH/DELETE | Adapter and catalog UI wrapper exist; verify all visible supplier screens use it | High |
| Purchase receipt / stock batch | `POST /api/inventory receive_purchase` | Legacy `store.recordPurchase()` still adjusts medicine/batch/purchase state locally; verify the purchase screen calls receivePurchase rather than this legacy method | Critical |
| Stocktake | `stocktake_create`, `stocktake_approve` | Domain command and repository paths exist; verify UI wiring and readback | High |
| Quarantine / disposition | Inventory actions exist for inspect, release approval, disposition approval, disposal, release | Verify all workflow steps, permissions, and readback | High |
| Queue register/call/transfer/lane | `/api/queue` actions exist | Registration and lane actions have API paths; `store.callPatient()` still has a local-only mutation path; verify the active call UI uses API call action | Critical |
| Patient profile edit/archive/restore/cancel-berobat | No corresponding patient maintenance action in current queue API | UI functions mutate patient cache only | Critical |
| Sales checkout | `POST /api/sales checkout` | API is called; UI then updates local cache. Must reconcile/read back invoice lines, payments and stock state | Critical |
| Sales readback | `GET /api/sales` returns invoice headers, returns and cancellation requests | It does not return invoice lines or payment rows/method/status; current sync fabricates `items: []`, `metode: Tunai`, `bayar: total` for unseen invoices. This is unsafe for accurate receipts, returns and payment reporting | Critical |
| Sales returns/refunds/cancellation | API actions exist | Return request calls API; verify admin/pimpinan review and refund flows use API and then refresh from server. Cancellation request is API-backed in Preview | Critical |
| Supplier payment | `POST /api/finance record_supplier_payment` | `store.lunasiBeli()` calls API but then mutates local purchase record; legacy `recordPurchase()` still creates purchases locally. Verify payment allocation, partial payments and invoice readback | Critical |
| Expenses | `create_expense`, `approve_expense` exist | Create UI calls API; edit/delete and `actionApproveBiaya()` mutate browser state only. GET finance returns expenses but not their full approval event trail | Critical |
| Shifts | `open_shift`, `close_shift`, `verify_shift` exist | UI calls API in Preview; local cache updated after success. Verify role/2-admin verification and prevent duplicate local rows after refresh | High |
| Petty cash | No matching API action found in finance API | Add/edit/delete are browser-only | Critical |
| Loss / expired stock disposal | No generic loss action found in current inventory API; quarantine disposal is separate | Expired disposal and manual loss mutate local stock/batch/loss arrays | Critical |
| Generic audit log | Domain commands persist domain-specific events for several workflows | `ClinicStore.logActivity()` only prepends to local state; no general audit-log API/readback found | High |
| Clinic/display settings | Display settings may use separate backend adapter; general settings and logo are local | Confirm which settings are device-local preferences versus clinic-wide shared settings; do not treat all as operational data | Medium |

## Read-model gaps
- `syncOperationalDataFromTiDB()` currently loads medicines, queue tickets, sales headers, expenses and shifts only.
- It does not hydrate purchase invoices/partial payments, batch-level stock, petty cash, losses, patient maintenance fields, complete return detail, invoice lines, payment settlement/review status, or a durable audit log.
- The current sales-header mapping supplies placeholder values for missing line/payment detail. Replace it with a complete server read model; never infer cash payment or completed settlement from a posted invoice.
- The sync function merges only non-empty response arrays, so an authoritative empty result cannot clear stale cache rows. Prefer replacing each server-owned collection from a complete successful response, with explicit error handling.

## Production gate
- Keep production cutover disabled.
- Do not broaden hostname detection or enable the Preview bootstrap on production as a shortcut.
- Before production activation, use an explicit environment/deployment mode and prove Better Auth session, endpoint coverage, migrations/schema, role checks, idempotency, transaction rollback, and server readback on the production-like deployment.

## Work plan (ordered)
1. Build a definitive UI action → API action → domain command → repository method → TiDB table map; identify every visible button/action still browser-only.
2. Complete server read models first: invoice lines and payments; supplier invoices, receipts, batches and allocations; patient/queue detail; returns/refunds; petty cash; losses; audit events.
3. Connect or safely disable unsupported write actions: medicine edit/deactivate; purchase receipt; patient edit/archive/restore/status; queue call; petty cash; expenses edit/approve/delete; expired stock/loss; purchase partial payment; return review/approval; general audit events.
4. Refactor UI state updates to happen only after successful API response, then refresh/replace the affected cache from TiDB. On API failure, leave the cache unchanged and show a clear error.
5. Add idempotency, role/ownership checks, optimistic version checks, and transaction-bound audit events for each write command.
6. Add regression tests for refresh persistence, offline/API failure behavior, duplicate submissions, concurrent updates, partial supplier payments, pending non-cash income, returns/quarantine, shift verification and stock reconciliation.
7. Run the non-deploying CI test workflow and review results; do not trigger Vercel deployments for routine audit changes.
8. Only after all gates pass, prepare a separate production cutover review. Production activation/merge/deploy requires explicit confirmation.

## Follow-up implementation on the same working branch
After the initial audit, the branch received these additional source changes:
- `api/sales.js` GET now returns persisted invoice lines (including item snapshots, medicine/tariff public IDs and sale-time HPP) and invoice payment rows (method, amount, review status, settlement status and income-recognition timestamp) for the latest 200 invoices.
- `js/app.js` now hydrates sales history from those server fields rather than fabricating empty item lists and defaulting every invoice to cash. Unrecognized non-cash income is excluded from active financial totals until the full invoice amount is recognized. This is conservative for partial approvals and still needs a precise partial-recognition accounting treatment before launch.
- `js/app.js` no longer performs local batch deduction or local stock rollback in TiDB Preview checkout mode. The server checkout transaction is the sole stock authority; local batch prevalidation is bypassed in TiDB mode because batches are not yet hydrated into the browser. After checkout, the app refreshes server-owned operational state.
- `js/store.js` now routes the patient-call action through `POST /api/queue` in TiDB Preview, and only changes local call state/broadcasts after the server confirms the call event.
- `lib/repositories/tidb-queue-repository.js` and the UI sync now preserve the queue ticket ID separately from the encounter ID and patient ID. This fixes a reload path where checkout could otherwise send a queue-ticket ID as the encounter ID, and a call path that could send the encounter ID as the ticket ID.
- Queue status mapping now recognizes the backend status `called` as the active call (the previous UI checked only `calling`).
- TiDB checkout now leaves batch FEFO deduction to the server transaction; it no longer requires an unhydrated browser batch list or locally deducts/rolls back stock before the server commits.
- Receipt lookup retains the internal TiDB invoice ID, and item display uses net line price from the server read model.

## Remaining high-priority blockers after this pass
- No batch-list/read endpoint is wired to the browser; the UI currently relies on server-side FEFO checkout rather than a local batch cache. Stock cards/lot detail and expiry workflows still need a full TiDB read model.
- Sales returns and their line-level details are not yet fully hydrated into the UI; return approval/refund paths need a read-after-write reconciliation.
- Patient master maintenance (edit/archive/restore/cancel-berobat), petty cash, medicine edit/deactivate, package CRUD, purchase-order creation, loss/expired disposal, and expense edit/delete still have browser-only mutation paths or no corresponding TiDB command.
- Purchase/supplier invoice read models and payment allocations remain incomplete for the UI.
- Cancellation request/decision code still performs direct SQL updates in `api/sales.js` outside the domain-command transaction/audit pattern and needs to be moved into an audited idempotent command.
- The TiDB queue-call route is now called by the app, but transfer/handoff UI wiring still needs verification and the queue read model needs stronger patient/encounter fields.
- The audit log displayed by the app is not yet a complete server-backed audit event read model.
- Partial payment recognition must be represented as recognized amount, not as a binary fully-recognized invoice, before finance reporting is production-safe.

## Verification status
- Source inspection only. Automated tests and JavaScript syntax checks have not been run in this environment.
- No live TiDB data was changed or queried.
- No PR was opened; no merge or deployment was performed.
