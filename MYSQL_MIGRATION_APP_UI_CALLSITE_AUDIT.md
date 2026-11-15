# MySQL Migration — App UI Callsite & Business Command Audit

Status: read-only source audit. No application source code was modified. No SQL DDL, production changes, Firebase writes or real-data migration were performed.

## Source baseline

Repository: `anitaherwan3-ai/assalam`, branch `main` (read only).
- `js/app.js` SHA: `f74c4710161ddd2af230e51c18b1f107d6c52c82`, 4,873 lines.
- `js/store.js` SHA: `99e74acf8caec9c70d82be1d5f6efc5bfa6bc4fb` (prior inventory).
- Permission and backend command details are in `MYSQL_MIGRATION_WRITE_PATH_PERMISSION_CROSSWALK.md`.

Important distinction: this audit records UI behavior and local mutations. A UI role check is not an authorization boundary. The MySQL API must enforce identity, role, ownership, allowed fields, state transitions and invariants server-side.

## 1. Patient registration and lifecycle

### Registration
- `actionAddPasien()` requires a connected Firebase backend; offline queue registration is blocked to avoid duplicate queue numbers.
- It refreshes the business date using clinic WIB date, reads current shift, constructs patient with name, phone, service, cashier/shift, timestamps and initial status, then delegates queue number allocation to backend.
- MySQL equivalent: `POST /patients/register` command; derive cashier/shift from authenticated profile, validate open shift, allocate prefix/date sequence under lock, create patient + encounter + queue ticket + audit atomically.
- Do not trust client-supplied date, cashier ID, shift ID or queue number.

### Batal Berobat, restore and archive
- `actionBatalBerobat`: UI allows Kasir only; local state changes to `status=batal_berobat`, records time/user, clears calling and saves.
- `actionPulihkanBatalBerobat`: UI allows Kasir only; only same-day, not-done cancelled patient is restored to `aktif`.
- `delPasien`: UI allows Pimpinan only; archives via status `dihapus`, `deletedAt`, `deletedBy`, not physical deletion.
- MySQL commands: `POST /patients/:id/cancel-visit`, `POST /patients/:id/reactivate`, `POST /patients/:id/archive`. Server validates owner/role, patient state, date and encounter state. Keep history; do not hard-delete patient records.
- PR13 changes patient status/ownership handling and must remain separate until tested.

## 2. Shift and cash drawer

- `actionBukaShift()` locally creates shift with `id,tgl,jam,kasir,nama,modal,status='buka',_t`.
- `actionTutupShift()` calculates `sistem=calcShiftCash(shift)`, stores `status='tutup',jamT,sistem,fisik,selisih,verif=false,_t`, then sends WhatsApp recap.
- `actionVerifShift()` locally sets `verif=true`, `oleh=currentUser.nama`, `_t`.
- UI helper `calcShiftCash` includes opening modal + cash transactions - petty cash. This is cash drawer reconciliation, not omzet. Financial reporting must preserve the separate omzet/cash-on-hand calculation already documented.
- Required commands: open shift (one open shift per cashier), close shift (server-derived expected cash and immutable close snapshot), verify shift (Admin-only, one-time state transition).
- Critical: client must not submit trusted `sistem`, cashier identity, or verified-by identity. Server derives expected cash and authenticated actor. Close and verify must be idempotent and audit-logged.
- WhatsApp recap is an external side effect. Use an outbox/job after committed close; do not make shift closure depend on successful WhatsApp delivery.

## 3. Petty cash

- `actionAddPetty()` creates `id,tgl,ket,jml,kasir,sh,_t`.
- `editPetty()` changes description/amount; `delPetty()` physically removes the local record. UI displays controls to owner and the owning Kasir.
- Legacy Rules permit some owner/Kasir operations, but MySQL should not physically delete a cash movement. Recommended: append-only `cash_entries` plus `cash_reversals`; edit is a reversal + replacement, requiring open shift or elevated approval.
- Server derives cashier/shift from session and validates shift is open. Validate positive integer rupiah amounts and non-empty reason.

## 4. Medicine, tariff and package master data

- Medicine add creates `nama,satuan,hpp,jual,stok=0,min`; edit allows direct changes to name, unit, HPP, sale price, stock and minimum; delete removes local master row.
- Tariff add/edit/delete manages `nama,jenis,harga`.
- Package add/edit stores `nama,deskripsi,harga,items[]`; package items are copied as snapshots into the package master.
- MySQL recommendation:
  - Master medicine changes are Admin/Pimpinan commands with validation and audit.
  - Stock must not be freely edited in the same generic medicine update. Any stock correction must create an inventory adjustment movement with batch allocation/reason and reconcile aggregate stock.
  - Preserve historical invoice item and package component snapshots even if the master tariff/package changes later.
  - Referenced medicine/tariff/package records should be deactivated/soft-deleted rather than physically removed.
  - Package component structure must be normalized for current definitions while invoice snapshots remain immutable.
- Test package component edits against old invoices and returns; never recalculate historical invoice prices/HPP from current package master.

## 5. Purchases and supplier returns

- `actionAddBeli()` requires supplier, medicine, positive qty, positive total and expiry date; passes supplier, invoice, medicine, qty, total, due date, batch number, expiry and paid flag to `store.recordPurchase()`.
- Purchase creates batch and updates weighted-average HPP/aggregate stock as documented in purchase audit.
- `openModalReturBeli()` delegates to `store.processReturBeli()`; success changes stock/batch/HPP and unpaid supplier invoice totals in legacy local flow.
- `delBeli()` deliberately prevents deleting purchase invoices and directs user to supplier return.
- MySQL commands: purchase receipt, supplier return, supplier payment/settlement. Validate supplier invoice uniqueness policy, batch, expiry, quantity, price, and stock ledger atomically.
- Reject over-return instead of silently capping quantity. Record supplier credit note separately from actual payment; never rewrite paid invoice cash history.

## 6. Expenses, loss and stock opname

### Operating expenses
- `actionAddBiaya()` computes total = unit amount × quantity; threshold defaults to Rp1,000,000; amount >= threshold becomes pending, lower amount becomes approved immediately.
- `editBiaya()` changes description and amount and recalculates status against current threshold; `delBiaya()` physically removes.
- `actionApproveBiaya()` changes status to approved/rejected in local store. The function itself has no explicit role check; UI tab visibility and Firestore Rules are not sufficient for MySQL security.
- Server must derive threshold from protected clinic policy, enforce who may create/edit/approve, capture approver ID/time/reason, prevent requester self-approval if that is chosen policy, and use reversal rather than delete after approval.

### Inventory loss
- `actionAddLoss()` selects batch, checks positive quantity <= batch remaining, computes value from current medicine HPP, decreases batch and aggregate stock, and writes loss row.
- `delLoss()` physically removes loss and restores batch/aggregate stock.
- MySQL command must lock batch and medicine, calculate HPP from server snapshot, record immutable stock movement and loss valuation atomically. Correction should create a reversal movement, not delete original loss. Prevent restoring a batch that has subsequently been consumed or otherwise changed without a valid ledger reversal.

## 7. Return and cancellation UI

- Cashier submits cancellation request; Admin/Pimpinan processes request; backend performs stock restoration only on approval.
- Sales return UI computes remaining item quantity from prior non-rejected returns, excludes full-returned items, then locally stages proposal and calls backend `submitReturJual`.
- Admin forwards return to Pimpinan; Pimpinan makes final decision; Pimpinan separately records refund payout. Transfer requires reference.
- UI guards are not enough: API must recheck remaining quantity, invoice status, prior requests, item index/type, original charged value, discount allocation, batch restoration and idempotency inside a database transaction.
- Legacy local `store.processReturJual` differs from staged cloud flow. MySQL should implement the staged workflow already identified in the write-path crosswalk, subject to final clinic policy.
- Historical return records without modern refund metadata must be marked for reconciliation, not silently assumed paid or unpaid.

## 8. User management and clinic settings

- Staff provisioning calls backend `provisionDefaultStaffProfiles`; fixed email identities are Admin `assalamadmin1@gmail.com`, Kasir1 `assalamkasir1@gmail.com`, Kasir2 `assalamkasir2@gmail.com`. Local add/edit/delete user actions are disabled to preserve old records.
- Stable user identity should be separate from email. Keep both Pimpinan accounts and master owner protected.
- Clinic name is hard-coded/read-only as `Klinik Assalaam Palembang`. Address, telephone, logo, footer, theme, colors, rows/page, approval threshold, expiry/warning periods, WhatsApp options are editable.
- `actionSaveSettings()` writes the local settings object; server must use allowlisted fields by role, validate numeric ranges, and keep clinic name immutable.
- Logo upload currently converts image to base64 data URL at 160px max dimension and saves into settings. MySQL design should store object-storage key + metadata, not base64 in a config row.
- Firebase config save/disconnect is legacy infrastructure administration; must not be exposed as normal MySQL clinic settings. In migration, backend credentials belong only in server environment, never user-editable client state.

## 9. Display TV and queue audio

- Display settings include YouTube video ID, enable flag and running text; `actionSaveDisplayTV()` allows Admin/Pimpinan and calls backend save.
- Audio clips include notification, prefix/suffix, letters A-Z, digits 0-9 and counter destinations. UI validates MP3 extension/type and max 600 KB, converts to base64 and calls backend save/delete.
- Audio preview uses uploaded clips or browser SpeechSynthesis fallback; chime and spoken phrase are separate. Queue digits are intended to be spoken individually.
- MySQL stores display settings and audio metadata only. Audio bytes belong in object storage with content type, size, checksum and immutable version. Upload/delete must be Admin/Pimpinan-authorized and audited.
- Preserve A/B selector and sync across devices. Test display reload, reconnect, mode switch, duplicate announcements, last-called state, fallback TTS and separate notification chime.

## 10. Export, backup and audit trail

- Export UI offers CSV/PDF reports for transactions, package master, patients, purchases, expenses, petty cash, stock, expiry/batches and activity log.
- Audit log view searches user/action/module/detail; local store caps log array at 1,000 items, but server audit retention must be policy-based and not inherit this cap.
- Backup/restore behavior is documented in the identity/backup audit: current browser JSON backup/restore is not an authoritative server backup.
- MySQL requires role-based report endpoints, patient PII minimization, export audit events, server-side backup schedule, encryption, checksum, retention and tested restore. Restore must support dry-run/preview/schema version and never overwrite/delete master Pimpinan identity.

## 11. UI callsite issues to resolve in MySQL (do not copy as-is)

1. Several UI functions mutate `store.state` directly before sync. This is a legacy offline-first pattern; MySQL API must return authoritative result and client should apply only server-confirmed state.
2. Some functions such as `actionVerifShift` and `actionApproveBiaya` do not explicitly check role inside the function. Every MySQL endpoint must enforce role and state transition independently.
3. Medicine edit includes a direct stock field while batch quantities exist. This can desynchronize aggregate stock and batch ledger; replace with inventory adjustment command.
4. Expense and loss deletion physically remove financial/inventory records in local state. Use reversal entries and immutable audit.
5. Petty cash edit/delete similarly changes cash history; prefer reversals and shift-state checks.
6. Settings/logo/audio currently use client-side base64/local persistence. Move binary assets to object storage and store references only.
7. WhatsApp sending is an external action and must use a retryable outbox so failure cannot roll back an otherwise valid shift close.
8. The UI may show a success message after local mutation before cloud confirmation in some older paths. New client should display success only after API commit.
9. Queue allocation, return quota, cancellation and stock changes need explicit locking/idempotency; never use generic state-array synchronization.
10. Preserve immutable historical invoice, patient encounter, purchase, return and shift snapshots even when master data or staff identity changes.

## 12. Required regression suite additions

- Open/close/verify shift with two Kasir devices; concurrent open shift rejection; retry close/verify idempotency; WhatsApp outbox failure/retry.
- Cash reconciliation with modal awal, cash sale, cash refund and petty cash; confirm omzet excludes modal awal.
- Direct medicine stock edit denied; adjustment creates batch-aware movement; batch and aggregate always reconcile.
- Expense below/above threshold, edited across threshold, approve/reject, requester/approver policy, reversal after approval.
- Loss creation, concurrent dispensing, reversal and audit; no negative batch or aggregate stock.
- Purchase duplicate invoice policy, batch expiry, weighted-average HPP, partial supplier payments, supplier return over-limit rejection and paid/unpaid invoice reconciliation.
- Archive/cancel/reactivate patient lifecycle with role/ownership/date rules; preserve visit and queue history.
- Display audio upload type/size/content verification, object storage access and deletion/versioning; A/B display synchronization.
- Exports by role and sensitive columns; backup restore dry-run and master-owner protection.

## 13. Audit disposition

This completes a broad UI callsite inventory for patient lifecycle, shift, petty cash, master medicine/tariff/package, purchase, supplier return, expense, loss, shift verification, returns/cancellation, staff, settings, display/audio, export and stock card.

Remaining before schema approval:
- Cross-check every Firestore collection/path and every backend public method against the UI callsites, including any less-visible config and migration utilities.
- Complete a source-level inventory of `ExportHelper`, backup/restore and WhatsApp integrations.
- Reconcile any legacy aliases and historical payload variants.
- Obtain clinic policy decisions listed in the master blueprint/crosswalk.
- Only then draft normalized SQL schema and migration plan. Do not perform DDL or real-data migration yet.
