# MySQL Migration — Exhaustive Firebase Backend Method & Collection Inventory

Status: read-only inspection of the legacy backend. No Firebase data was changed, no SQL DDL was executed, and no production code was modified.

## 1. Source baseline

- Repository: `anitaherwan3-ai/assalam`
- Branch inspected: `main` (read only)
- File: `js/firebase-backend.js`
- SHA: `3a613d96564f120b8141966f9ecbae21471c4e65`
- Size: 1,436 lines

This document catalogs the methods, reads, writes, listeners and legacy sync behavior visible in this file. It complements the UI callsite and permission crosswalk.

## 2. Backend method inventory

### Initialization, identity and session
- `constructor(store)`: initializes state, listeners, sync queue and Firebase dependencies.
- `updateBadge(status,text)`: UI-only sync indicator.
- `init()`: initializes Firebase app/auth/db, subscribes to auth changes, resolves profile and starts/stops realtime sync.
- `ownerIdentity(email)`: maps fixed owner emails to internal Pimpinan IDs.
- `ensureOwnerProfile(user)`: verifies/creates owner profile with UID/email/role/active consistency.
- `verifyAuthProfile(user)`: validates owner or active staff profile and role.
- `provisionDefaultStaffProfiles(localUsers)`: Pimpinan-only provisioning of predefined staff identities; does not replace a stable identity with conflicting profile details.
- `login(email,password)`: Firebase email/password sign-in.
- `resetPassword(email)`: sends Firebase password reset only for allowlisted clinic accounts.
- `stopSync()`: unsubscribes listeners and clears debounce state.
- `setupRealtimeListeners()`: subscribes to settings, queue-audio metadata and role-filtered operational collections.
- `pushData(state)`: debounces client state push.
- `performPush(state)`: serializes writes, filters by role, builds collection batches and commits.
- `saveConfig(cfg)`: stores Firebase client config in local store state.
- `disconnect()`: signs out, removes listeners and resets local Firebase connection state.

### Patient, invoice, cancellation, return and queue commands
- `submitCancelRequest(trxId, alasan)`: Kasir submits a pending cancellation request.
- `processCancelRequest(trxId, decision, reason)`: Admin/Pimpinan rejects or approves cancellation; approval restores original medicine/batch stock and marks invoice cancelled.
- `returQuotaId(trxId,itemIndex)`: deterministic per-invoice-item quota ID.
- `submitReturJual(returInput)`: Kasir/Pimpinan submits sales-return request, validates original invoice/item/value and reserves quota.
- `migrateReturKuota()`: Pimpinan-only backfill of missing per-item return quota records from existing invoices/returns.
- `approveReturJual(returId)`: Admin moves request to Pimpinan review stage.
- `finalizeReturJual(returId)`: Pimpinan finalizes return, verifies original invoice and batch deductions, restores medicine/batch stock and records refund obligation.
- `rejectReturJual(returId,reason)`: Admin/Pimpinan rejects at their respective workflow stage and releases quota.
- `payReturJual(returId,method,reference)`: Pimpinan-only payout record, Tunai/Transfer, transfer reference required, duplicate payout blocked.
- `registerPatientWithQueueNumber(patient)`: Kasir/Pimpinan creates patient with server-checked queue candidate; current main baseline allocates A-series only.
- `commitCashierTransaction(trx,patientId,stockChanges)`: Kasir-only atomic invoice, stock/batch decrement, patient completion and return-quota initialization.

### Queue audio and display
- `getQueueAudioClips()`: reads configured queue-audio documents.
- `saveQueueAudioClip(audio)`: Admin/Pimpinan validates clip ID, MP3 data URL and 600 KB limit, then writes config document.
- `deleteQueueAudioClip(clipId)`: Admin/Pimpinan deletes allowed clip ID.
- `saveDisplaySettings(settings)`: Admin/Pimpinan writes only YouTube ID, enable flag and running text.

## 3. Firestore collection and document path inventory

| Path | Read/write purpose | Notes for MySQL |
|---|---|---|
| `k_users/{id}` | Owner profile validation, staff profile validation and provisioning | Stable user ID, mutable email mapping, active role assignment and immutable audit. Not part of general collection listener. |
| `klinik_config/settings` | Clinic settings, sequence state, display settings | Separate protected settings domains; immutable clinic name; server-managed queue sequence; never trust arbitrary full-object replacement. |
| `klinik_config/queueAudioClip_{clipId}` | Audio bytes and metadata; query by `type=queue_audio_clip` | Object storage for bytes; SQL metadata and version. |
| `k_pasien/{id}` | Patient registration, queue, lifecycle, calling and completion | Separate patient/encounter/queue entities; display projection must be minimized. |
| `k_trx/{id}` | Immutable invoice and cancellation status | Checkout/cancel command; invoice line snapshots immutable. |
| `k_batalTrx/{trxId}` | One cancellation request per invoice | State machine, unique invoice constraint and serialized against returns. |
| `k_returJual/{id}` | Return request, staged approvals and payout metadata | Return workflow + refund obligation + payout ledger. |
| `k_returKuota/{trxId__itemIndex}` | Reserved/used return quantity per invoice item | Lock and enforce sold qty minus pending/approved return qty. |
| `k_obat/{id}` | Medicine master and aggregate stock | Master record separated from stock ledger. |
| `k_batch/{id}` | Batch expiry, quantity and remaining stock | Batch ledger, FEFO, expiry checks and row locks. |
| `k_{collection}` | Generic operational listener/push for ClinicStore collection names | Current collection names are `obat,tarif,paket,pasien,trx,petty,beli,biaya,loss,shift,batch,log,users,returJual,returBeli,batalTrx`; `users` is excluded from generic listener and writes. |
| `k_log/{id}` | Append activity log | Append-only audit; no 1,000-entry server cap. |

## 4. Exact role-based listener scope

- All signed-in roles receive settings and queue-audio metadata listeners.
- Kasir realtime listener collection allowlist: `obat,tarif,paket,batch,pasien,trx,shift,petty,returJual,batalTrx`.
- Admin and Pimpinan use all ClinicStore collections except `users`; staff profiles are resolved individually and are not loaded through the general listener.
- Unknown/unverified role gets no operational collection listeners.
- Display TV is a separate page and subscribes to settings, audio clip documents and the entire patient collection using the shared Firebase Auth session.

MySQL should replace broad collection subscriptions with role-scoped read models and explicit paginated endpoints. A staff member should not receive data merely because it is present in a broad local cache.

## 5. Critical backend invariants and gaps

1. **Generic full-state push is not a domain API.** It serializes local state and uses merge writes. It can preserve stale or partial records and does not model deletes. Do not port it as generic MySQL CRUD.
2. **No deletion/tombstone propagation in generic sync.** Realtime listener merges remote docs into local Map but does not remove local records missing remotely; if remote snapshot is empty, the merge block is skipped. Physical deletion is not reliably propagated. New API needs explicit soft-delete/reversal events and versioned sync.
3. **Client timestamps control conflict ordering.** Most `_t` values use `Date.now()`; devices can have skewed clocks. Use server timestamps and monotonic row versions.
4. **Checkout trusts client-provided transaction and stock changes.** It checks stock quantities, but receives client `trx` and `stockChanges`; server must derive price, HPP, package expansion, FEFO and batch allocations itself.
5. **Checkout patient existence is not enforced strongly enough.** Current transaction only marks patient done if the patient document exists; it does not throw solely because it is missing. MySQL checkout must require a valid active encounter and open shift belonging to authenticated cashier.
6. **Checkout stock validation is incomplete as a business policy.** Backend checks aggregate and batch remaining quantity, but MySQL must additionally enforce batch belongs to medicine, non-expired batch, FEFO allocation, exact sum of batch deductions, and no negative stock.
7. **Queue allocation is A-only in main baseline.** It scans today's A-series patients and local sequence, then probes deterministic candidate IDs. A/B queue support appears in unmerged PR13 only; do not silently treat it as shipped main behavior.
8. **Cancellation/return conflict checks include queries outside Firestore transactions.** Cancellation code reads return query before or alongside transaction; MySQL must lock invoice and its return/cancel state in one transaction so concurrent return and cancellation cannot both pass.
9. **Return quota is a critical guard.** Keep per-invoice-item uniqueness, lock, reservation, release on rejection, restore only at final Pimpinan approval and payout separately.
10. **Quota migration is a maintenance command.** `migrateReturKuota()` is Pimpinan-only and creates missing guard docs based on legacy invoice/return data. It does not alter original invoice/stock/return docs. New migration needs dry-run, reconciliation report and idempotent staging.
11. **General listeners can load entire operational collections.** MySQL should use pagination, role-scoped endpoints and narrow fields; never send all patient PII to a display or staff device unnecessarily.
12. **Batch commits are split by collection.** The legacy push may successfully commit one collection and fail another. It is not a global transaction. MySQL commands must define atomic domain boundaries rather than emulate cross-collection partial commits.
13. **Settings document mixes concerns.** Clinic config, queue sequence and display settings share one document. Split into typed settings domains and protect immutable fields.
14. **Audio data is stored as base64 config documents.** Move binary data to object storage and persist only metadata, object key and version in SQL.
15. **No explicit server audit on all legacy writes.** New API must record actor, role, action, entity, before/after, server time, request ID and idempotency key for sensitive actions.

## 6. Recommended MySQL command surface (candidate, not implemented)

- Auth/profile: `GET /me`, owner-only staff provision/update/deactivate/email-change commands.
- Patients: register, update allowed demographic fields, cancel visit, reactivate, archive, call, complete, handoff.
- Queue: allocate next number by business date/prefix, call-next, repeat-call, set display mode.
- Checkout: create invoice + payment + patient completion + batch movements + return quota in one transaction.
- Cancellation: submit request, review/approve/reject; approval and inventory reversal atomic.
- Sales return: submit, Admin forward/reject, Pimpinan final approve/reject, separate refund payout.
- Inventory: purchase receipt, dispense, supplier return, loss, adjustment, reversal, batch expiry and stock-card query.
- Finance: shift open/close/verify, petty-cash entry/reversal, expense submit/approve/reject/reversal, supplier payable/payment, financial reports.
- Settings: clinic settings, display settings, queue audio metadata.
- Audit/export/backup: role-scoped report generation, export job, backup job, restore dry-run and restore promotion.
- Notifications: outbox event and provider delivery status; manual WhatsApp deep links are not represented as delivered messages.

## 7. Final backend completeness checklist

- [x] Authentication and profile methods.
- [x] Owner/staff provisioning and password reset.
- [x] Realtime listener scopes and collection merge logic.
- [x] Patient queue registration.
- [x] Checkout and stock/batch transaction.
- [x] Cancellation request and approval.
- [x] Sales-return quota, approval, rejection, finalization and payout.
- [x] Queue audio and display settings.
- [x] Generic push, config save and disconnect.
- [x] Collection and document path inventory.
- [ ] Compare every field written by app/store and old payload versions against source data snapshots.
- [ ] Verify all Firestore Rules paths/field allowlists against this method inventory one last time.
- [ ] Resolve owner policy decisions and only then draft schema/DDL.

No DDL, production deployment, Firebase mutation or real-data migration was performed.
