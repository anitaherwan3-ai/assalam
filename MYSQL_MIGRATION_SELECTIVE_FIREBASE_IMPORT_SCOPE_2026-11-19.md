# Klinik Assalaam — Selective Firebase Import Scope

Date: 2026-11-19
Branch: migration/tidb-foundation

## Decision
The owner confirms the application has never been used for production. Do not bulk-migrate Firebase demo/operational history. Build the TiDB database as the new operational source and import only explicitly selected master/configuration data.

## Import allowlist
1. `k_obat` → `medicines`: medicine identity/name, canonical unit after validation, selling price, minimum-stock setting, active flag, and source document ID crosswalk. Do not import demo stock quantities or batch balances as opening stock.
2. `k_tarif` → `tariffs`: service/treatment master, service type, price, active flag, source document ID crosswalk.
3. `k_paket` → package master and package-component tables: only if the current source documents contain complete, valid component references; otherwise recreate packages in the new app rather than import incomplete data.
4. `klinik_config/settings` → approved non-secret clinic/display settings only. Exclude credentials, tokens, legacy Firebase configuration, and stale queue counters.
5. Five staff identities and roles are provisioned from the owner-confirmed roster in the new authentication system. Do not copy Firebase password hashes or infer identities from profile IDs.

## Explicit exclusions
Do not import demo patients/visits, transactions, cash/petty cash, purchases, expenses, losses, shifts, stock batches, stock movement history, logs, return/cancellation/refund workflows, quota reservations, Firebase auth records, or audio clip binary payloads. Collections excluded include `k_pasien`, `k_trx`, `k_petty`, `k_beli`, `k_biaya`, `k_loss`, `k_shift`, `k_batch`, `k_log`, `k_users`, `k_returJual`, `k_returBeli`, `k_batalTrx`, and `k_returKuota`.

## Opening inventory
Opening stock must be entered/reconciled as a new physical stocktake in TiDB, with medicine, batch number, expiry, quantity and HPP evidence. Do not treat demo batch values as real opening inventory.

## Import safety
- Export only the allowlisted collections/documents, read-only.
- Preserve source document IDs in a source crosswalk.
- Normalize and validate units, prices, active flags and required names.
- Produce dry-run counts, invalid-row report and duplicate report before inserts.
- Import masters idempotently; never overwrite a manually reviewed TiDB master row silently.
- Keep raw source payloads out of logs and reports; do not export personal patient/transaction data.
- Import only to TiDB Preview after migration schema, auth actor and audit writer are operational.
- Production import/cutover requires backup, validation and explicit final readiness review.

## Current execution status
This file records the approved scope. No Firebase export or import was executed by this change.
