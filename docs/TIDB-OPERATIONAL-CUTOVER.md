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
