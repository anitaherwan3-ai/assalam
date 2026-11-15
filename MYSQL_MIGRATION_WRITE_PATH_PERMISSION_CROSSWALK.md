# MySQL Migration — Firebase Write-Path & Permission Crosswalk

Status: source audit / design evidence only. No schema DDL, Firebase writes, production changes, or real-data migration were performed.

## Source baseline inspected

Read-only source branch: `main`.
- `js/firebase-backend.js` blob SHA: `3a613d96564f120b8141966f9ecbae21471c4e65` (1,436 lines)
- `firestore.rules` blob SHA: `d02b6d02c13bc85f867b668085edb85c54726779` (416 lines)
- `js/app.js` blob SHA: `f74c4710161ddd2af230e51c18b1f107d6c52c82` (4,873 lines)

This document describes observed behavior in that baseline. It is not an endorsement that every legacy rule is ideal. MySQL authorization must be implemented server-side and tested independently.

## 1. Authentication and identity

Observed:
- Firebase Authentication email is the staff identity key used by Firestore Rules.
- Owner allowlist is `praktekrose@gmail.com` and `nursalim42@gmail.com`.
- Owner profile document IDs are `praktekrose` and `pimpinan2`.
- Staff profile document ID must equal the authenticated email; profile email must match; `active === true`; role must be `admin` or `kasir`.
- Owner provisioning is restricted to fixed staff email document IDs in the current rules: `assalamadmin1@gmail.com`, `assalamkasir1@gmail.com`, `assalamkasir2@gmail.com`.
- Backend functions `ensureOwnerProfile`, `verifyAuthProfile`, `provisionDefaultStaffProfiles`, `login`, `resetPassword` are present.
- The current role is resolved into `currentProfile`; UI and backend methods check it, but a future MySQL API must independently verify a trusted auth token and load the active user/role from the server.

Migration requirement:
- Keep stable internal user IDs; email is a mutable login attribute, not the primary relational key.
- Never accept role, cashier identity, owner identity, or active state from request JSON.
- Email changes require re-authentication/verification and an audit event.
- Protect the master Pimpinan identity from seed, reset, deletion, and restore operations.

## 2. Resource and action crosswalk

| Resource / action | Observed Firebase permission | Required MySQL command boundary |
|---|---|---|
| `klinik_config/settings` | Signed-in read. Pimpinan may write full config. Admin may only patch YouTube ID, enable flag, running text. | `GET /settings`; Pimpinan-only general settings command; Admin-only display-settings command with strict allowlist. |
| Queue audio clips | Admin/Pimpinan create/update/delete; MP3 data and size/type constrained by Rules. | Admin/Pimpinan metadata command; audio bytes belong in object storage, not SQL rows. Validate MIME, size, checksum and storage key server-side. |
| `k_users` | Pimpinan reads all; staff reads own. Pimpinan provisions/updates allowlisted owner/staff profiles. Staff cannot change own profile. | Pimpinan-only staff management; stable user ID; append-only identity/role audit; prevent master-owner removal. |
| `k_log` | Admin/Pimpinan read. Signed-in users create own log; staff update only timestamp on own log; Pimpinan may update/delete. | Append-only audit API. No staff update/delete. Avoid 1,000-row local log cap as server retention policy. |
| `k_pasien` | Signed-in read. Kasir/Pimpinan create. Kasir/Pimpinan may update constrained fields: done, name/phone, calling, Batal Berobat and restore. Admin/Pimpinan can reset done=false. Only Pimpinan delete. | Separate patient, encounter and queue-ticket commands. Role- and state-checked patch endpoints; no generic update/delete. Queue number allocation must be atomic and unique. |
| `k_trx` | Signed-in read. Kasir creates own nota only with patient completion in same atomic write; Pimpinan can create. Historical nota only timestamp updates; Admin/Pimpinan cancellation transition only with pending cancellation request. Pimpinan delete. | Checkout command derives prices, discounts, HPP, batch deductions and stock on server; atomic invoice + patient + inventory ledger + return quota + audit. Invoice immutable thereafter. |
| `k_batalTrx` | Kasir creates own pending request; Admin/Pimpinan approve/reject; Kasir can resubmit rejected request; Pimpinan delete. | Cancellation request, review and finalization commands. Approval must lock invoice and stock rows, prevent active returns, reverse inventory once, and write immutable audit/reversal. |
| `k_shift` | Kasir opens own shift; closes own shift; Admin verifies closed shift; Pimpinan can manage. | Open/close/verify commands with state transition checks, one-open-shift constraint, server-derived system cash and immutable close snapshot. |
| `k_petty` | Kasir creates/edits/deletes own petty cash; Pimpinan unrestricted. | Prefer append-only cash ledger and reversal entries. If legacy edit/delete retained, require ownership, open-shift state and audited reason. |
| `k_obat` | Signed-in read. Admin/Pimpinan create/delete; Kasir may only decrease stock; Admin/Pimpinan may update all fields. | Master medicine command for Admin/Pimpinan; all stock mutations through inventory movement commands, never arbitrary stock patch. |
| `k_batch` | Signed-in read. Admin/Pimpinan create/delete; Kasir may only decrease batch remaining quantity. | Batch receipt/adjustment/dispense/return commands. Server derives FEFO and locks batch + aggregate stock rows. |
| `k_tarif`, `k_paket` | Signed-in read; Admin/Pimpinan write. | Admin/Pimpinan master-data commands; preserve historical invoice snapshots. |
| `k_beli`, `k_biaya`, `k_loss`, `k_returBeli` | Admin/Pimpinan read/write. | Dedicated purchase, supplier-return, expense, loss and payment commands; do not expose generic CRUD for financial records. |
| `k_returKuota` | Signed-in read. Pimpinan may create/update. Kasir creates initial zero quota atomically with checkout and increments used qty only alongside pending return request. Admin may release quota only when rejecting. | Lock per-invoice-item return quota; derive remaining qty from immutable invoice and prior approved/pending return state. Enforce unique request/idempotency key. |
| `k_returJual` | Kasir/Pimpinan create pending request. Admin forwards or rejects. Only Pimpinan makes final approve/reject and records refund payment. Kasir can only touch timestamp on own pending request. | Preserve staged workflow: submit -> Admin review -> Pimpinan final decision -> Pimpinan payout. Inventory restoration and refund obligation must be atomic at final approval; payout is a separate idempotent command. |

## 3. Important observed backend command paths

### Checkout and stock
- `commitCashierTransaction(trx, patientId, stockChanges)` uses a Firestore transaction and is idempotent by invoice ID.
- It reads invoice, patient, medicine and batch documents before writes; checks available aggregate and batch stock; reduces stock and batch balances; marks patient done; writes invoice; creates a return-quota document for each invoice item.
- Critical weakness for migration: the method receives `trx` and `stockChanges` from the client. Firestore Rules constrain some writes but do not make all client-provided price/HPP/allocation fields trustworthy.
- MySQL server must recompute cart lines, package expansion, discount allocation, unit prices, HPP snapshots, FEFO deductions and totals from authoritative rows. Client payload is intent only.

### Patient queue
- `registerPatientWithQueueNumber(patient)` reads today's local/cached patients, computes an existing maximum A number and probes candidate document IDs in a Firestore transaction.
- This is collision-aware but depends on a scan/probe approach and client-side date/cache context.
- MySQL should use a sequence row keyed by business date + queue prefix, transaction/row lock, unique constraint, and Asia/Jakarta business date. Queue A/B mode and TV display are presentation settings, not authority for sequence uniqueness.

### Cancellation
- `submitCancelRequest` checks the cloud invoice, existing request and active return requests before creating pending cancellation.
- `processCancelRequest` rejects invalid states; on approval it validates original batch deductions, restores aggregate and batch stock, and resets patient done state.
- MySQL must serialize cancellation against return submission/finalization and checkout. No invoice can be cancelled after a non-rejected return request exists; no return can be submitted against a cancelled invoice.

### Sales return
- `submitReturJual` validates invoice, item index, quota, original item name/price/type, quantity and batch allocation; reserves quantity in quota while creating pending return.
- Admin `approveReturJual` forwards pending request to `menunggu_pimpinan` without restoring stock.
- Pimpinan `finalizeReturJual` revalidates invoice snapshots, quantity, amount, item type and original batch deductions, then restores stock/batches and establishes refund pending.
- `rejectReturJual` releases reserved quota; `payReturJual` is Pimpinan-only, supports Tunai/Transfer, requires transfer reference, and prevents duplicate payout by state.
- Critical concurrency invariant: two simultaneous returns for the same invoice item must not exceed sold quantity. The database command must lock quota/invoice-item state and use integer rupiah arithmetic.

### General sync
- `performPush(state)` debounces local state and batches writes by collection. It filters writable collections by role; cashier only syncs own shift/petty/log and patient patches; Admin excludes patient, invoice and petty; return and cancellation records are excluded from generic push.
- Patient sync reads remote record and applies a restricted field patch based on `_t`. Medicine/batch sync attempts to preserve remote stock if remote timestamp is newer.
- This is a legacy multi-device cache synchronization strategy, not a suitable authoritative MySQL write architecture. Do not port generic full-state push to MySQL. Use command APIs, server versions, conflict detection and read models instead.

## 4. Rule gaps / implementation risks

1. Some Rules allow broad Admin/Pimpinan writes for purchase, expenses, loss and supplier returns; UI may add checks but the database policy itself does not express all business invariants.
2. Firestore Rules protect fields and roles, but they do not replace complete business validation (e.g. client-derived HPP, pricing, FEFO and accounting).
3. `_t` is often client-generated. MySQL must use server timestamps and monotonic row versions; never use client clock as conflict authority.
4. Local cache merges by `_t` can overwrite independent changes and can be skewed by device clocks. Use explicit version checks and domain events.
5. Queue audio base64 is stored in config docs; move to object storage and store metadata in SQL.
6. Current staff provisioning uses fixed email document IDs. New identity model must allow Pimpinan to change staff email safely without changing stable IDs.
7. Pimpinan unrestricted delete in several collections is a legacy permission, not a recommended default. Financial/inventory corrections should use reversal entries, not physical deletion.
8. The current rules permit cashier petty-cash update/delete for own records. Decide whether to retain only while shift open or replace with audited reversals.
9. `k_batalTrx` and `k_returKuota` are operationally significant control collections; neither can be omitted in migration merely because they are not prominent menus.
10. Keep patient-identifying data out of test fixtures and logs. Use synthetic records until privacy/security controls and migration approval are complete.

## 5. Required MySQL API acceptance tests

### Authentication / role
- Unknown user, inactive user, wrong email/profile match and forged role in payload are denied.
- Staff cannot read or alter another user's private profile.
- Both Pimpinan accounts retain access; master Pimpinan cannot be deleted/deactivated by ordinary staff-management, seed, reset or restore.
- Email change preserves stable user ID and writes audit history.

### Patient / queue
- Kasir can register patient and allocate unique A/B number under concurrent requests.
- Two devices requesting same date/prefix never receive same queue number.
- Kasir cannot change patient ID, queue number, registration date, encounter owner or arbitrary clinical fields through a patch.
- Batal Berobat can only apply before service; restore only from that state.
- Admin/Pimpinan reset done only through explicit command and audit.

### Checkout / stock
- Kasir cannot sell under another cashier ID or another shift.
- Server ignores forged price, discount, HPP, total, batch allocation and stockChanges.
- Concurrent checkout cannot oversell aggregate or batch stock.
- FEFO excludes expired/empty batches and records exact batch movement.
- Duplicate idempotency key cannot create a second invoice or deduct stock twice.
- Patient done, invoice, stock, batch, quota and audit either all commit or all roll back.

### Returns / cancellation
- Return qty cannot exceed remaining eligible qty across pending and approved returns.
- Duplicate/parallel return submissions are serialized.
- Admin approval alone does not restore stock or pay refund.
- Pimpinan final approval restores correct batch/aggregate stock once and creates refund obligation once.
- Refund payout only Pimpinan; transfer requires reference; repeat payout is denied.
- Cancel request and return request cannot both win for same invoice.
- Cancellation restores stock once and preserves original invoice as immutable historical record.
- Service-only return and package return are tested separately from medicine/batch return.

### Shift / finance
- One open shift per cashier; another cashier cannot close it.
- Expected cash is calculated server-side; opening modal is excluded from omzet and separately included in cash-on-hand.
- Admin verifies a closed shift but cannot alter its counted cash or cashier.
- Post-close correction is a reversal/adjustment with actor, reason and audit.
- Expense approval threshold and approver identity are enforced server-side.
- Petty cash, expenses, loss, supplier payable, revenue, HPP, refunds and cash movements reconcile without double counting.

### Sync / recovery / audit
- Stale device writes fail with a version conflict rather than overwrite newer records.
- Every sensitive command has idempotency key, actor, role, request ID, server timestamp and before/after audit.
- Backup restore has dry-run, schema version, checksum, preview, selective restore and master-user protection.
- Export permissions and patient PII minimization are tested by role.

## 6. Decisions still required before schema/DDL approval

- Retain Firebase Authentication as temporary identity provider with server-side ID-token verification, or migrate to another auth system.
- Whether Admin can edit patient completion status or only Pimpinan.
- Whether Kasir petty cash can be edited/deleted while shift open; recommended default is reversal-only.
- Whether Pimpinan can physically delete any operational records; recommended default is soft-delete/reversal only.
- Final queue prefix ownership, A/B sequencing and date rollover rules.
- Full list of payment methods and whether non-cash revenue is recognized at transaction time or settlement time.
- Supplier credit recognition date and support for partial supplier payments.
- Legacy returns with missing quota/batch snapshots and how they will be reconciled.
- Expense approval threshold and permitted override policy.
- Post-close correction workflow and who may authorize it.

## 7. Next audit work

- Finish exact field provenance and app callsites for cancellation, shift, expense approval, master data, exports, staff management and display.
- Review PR13 separately as an unmerged optional delta; do not merge automatically.
- Reconcile all findings into the Master Blueprint.
- Only after the source inventory and owner policy decisions are complete should normalized schema/DDL be drafted.
