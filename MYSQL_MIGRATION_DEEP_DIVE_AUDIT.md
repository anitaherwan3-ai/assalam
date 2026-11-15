# Deep-Dive Audit — Klinik Assalaam Migration

Audit date: 2026-11-15. Source baseline: `main` read-only. PR #13 is reference-only, open and unmerged. This is source inspection, not a test report. No production code, main, Firebase data/Rules, or production Vercel project was changed. No TiDB application schema or real-data copy has been approved.

## 1. UI/workflow inventory verified in js/app.js (4,873 lines)

- Session/navigation: initApp, applyAppSettings, applyFirebaseSession, doLogin, resetLoginPassword, doLogout, setTab.
- Date/report filters: renderFilterBar, applyDatePreset, getFilteredTrx, getActiveFilteredTrx, calculateFinancials.
- Shift: viewShift, actionBukaShift, actionTutupShift, resendShiftWa, showShiftCloseModal, copyShiftWa, printShiftSlip.
- Patient: viewPasien, exportPasienShiftPDF, actionAddPasien, editPasien, actionBatalBerobat, actionPulihkanBatalBerobat, delPasien, searchPasienLama, fillPasienLama.
- POS: viewTrx, cash calculator, payment method, cart quantity, touch cards/category, add medicine/tariff/package, actionBayarTrx.
- Invoice/receipt/labels/WhatsApp: printReceipt, actionTriggerSendWA, openLabelFromNota, openModalLabelObat, renderLabelEditorAndPreview, applyQuickSigna.
- Petty cash: viewPetty, actionAddPetty, editPetty, delPetty.
- Master data: viewMaster, CRUD medicine/tariffs, package builder and viewPaketPelayanan.
- Purchasing: viewPembelian, openModalReturBeli, actionAddBeli, delBeli.
- Expiry/stocktaking/loss: viewKedaluwarsa, actionBuangAllExpired, viewOpname, actionAddLoss, delLoss.
- Expenses/approvals: viewBiaya, actionAddBiaya, editBiaya, delBiaya, viewApproval, actionApproveBiaya.
- Shift verification: viewVerifikasi, actionVerifShift.
- Transaction history/returns/cancellation: viewRiwayat, printReturJual, actionApproveReturJual, actionFinalizeReturJual, actionRejectReturJual, actionPayReturJual, openModalReturJual, actionCancelTrx, actionProcessCancelTrx.
- Dashboard/finance: viewDashboard, initDashboardCharts, viewLabaRugi, viewArusKas, viewUtang, viewPengawasanRetur, actionMigrateReturKuota.
- Export/audit/users: viewEkspor, viewLog, viewPengguna, actionProvisionStaffAccounts, actionAddUser, editUser, delUser.
- Settings/Firebase: viewPengaturan, uploadClinicLogo, deleteClinicLogo, actionSaveSettings, actionConnectFirebase, actionDisconnectFirebase.
- Display admin: viewDisplayTV, queue audio upload/save/preview/delete, call preview, YouTube/running text preview and actionSaveDisplayTV.
- Leadership views: viewKartuStok, exportKartuStok, viewPimpinanPasien, actionRestorePasien, viewPimpinanStok.

Role menus:
- Kasir: Shift, Pasien, Transaksi, Riwayat Transaksi, Kas Kecil.
- Admin: Obat & Tarif, Paket Pelayanan, Pembelian, Kedaluwarsa, Biaya, Stok Opname, Kartu Stok, Riwayat Transaksi, Verifikasi, Display TV, Ekspor.
- Pimpinan: Dashboard, Data Pasien, Stok Obat, Kartu Stok, Laba Rugi, Arus Kas, Utang, Approval, Pengawasan Retur, Paket Pelayanan, Display TV, Ekspor, Log Aktivitas, Pengguna, Pengaturan.
Menu hiding is not authorization; API must enforce role and field permissions.

## 2. Store model (js/store.js, 553 lines)

Collections: obat, tarif, paket, pasien, trx, petty, beli, biaya, loss, shift, batch, log, users, returJual, returBeli, batalTrx. Additional data: settings set, queue sequence seq, localStorage klinik_data, Firestore clinic config/audio docs, and k_returKuota documents.

Methods include loadLocal/saveLocal/subscribe/notify/get/getAll/getObat/getPaket, logActivity, deductBatchFEFO, recordPurchase, lunasiBeli, callPatient, processReturJual, approveReturJual, rejectReturJual, processReturBeli. calculateNetReturnAmount uses proportional discount allocation and largest-remainder rounding.

Migration risks: LocalStorage is part of current cache/offline behavior; explicitly design offline/conflict policy. Medicine aggregate stock and batch balances are duplicated and need a single authoritative ledger/reconciliation invariant. Demo seed defaults must never be confused with live records.

## 3. Backend operations (js/firebase-backend.js, 1,436 lines)

Auth/profile: init, ownerIdentity, ensureOwnerProfile, verifyAuthProfile, provisionDefaultStaffProfiles, login, resetPassword, disconnect.
Realtime/sync: stopSync, setupRealtimeListeners, pushData, performPush, updateBadge.
Transactions: submitCancelRequest, processCancelRequest, returQuotaId, submitReturJual, migrateReturKuota, approveReturJual, finalizeReturJual, rejectReturJual, payReturJual, registerPatientWithQueueNumber, commitCashierTransaction.
Display: getQueueAudioClips, saveQueueAudioClip, deleteQueueAudioClip, saveDisplaySettings.

Current sync relies on client _t timestamps and collection-specific merge/patch logic. New API should use server-side timestamps, version/conditional updates and explicit field allowlists. Stock, batch, POS, return quota, cancellation and refund operations need database transactions and idempotency.

## 4. Firestore Rules: permission semantics to carry into a reviewed API matrix

Identity:
- Two owner emails are hard-coded as Pimpinan identities.
- Staff requires an active profile matching the authenticated email and role admin/kasir.
- Staff can read only their own user profile; Pimpinan can read all.

High-level permissions:
| Area | Kasir | Admin | Pimpinan |
|---|---|---|---|
| Patient | Read; create; limited own patient name/HP, call, Batal Berobat/restore, transaction completion | Read; narrowly constrained correction of done state | Broad management |
| Invoice | Read; create only for own cashier and patient completed atomically; timestamp-only update | Read; controlled cancellation metadata | Management/approval |
| Cancellation | Submit own pending request; resubmit rejected request | Approve/reject pending request | Approve/reject |
| Shift | Own open/close | Verify closed shift | Manage |
| Petty cash | Own create/edit/delete under field constraints | Read | Manage |
| Medicine/batch | Read; stock decrement-only updates | Manage | Manage |
| Tariff/package | Read | Manage | Manage |
| Purchase/return purchase/expense/loss | No | Manage | Manage |
| Sales return | Submit own pending return; pending timestamp sync | First-stage verify/reject; no stock restoration | Final approve/reject; record refund payment |
| Return quota | Read; reserve/increment atomically with pending return | Release quota on rejection workflow | Manage |
| Logs | Create own; limited sync update | Read/create under rules | Read/manage |
| Config/display | Read | Display fields and validated queue audio clips | General clinic config |

Important exact constraints:
- Cashier invoice create must match authenticated cashier and existing patient; patient completion is checked atomically.
- Historical invoice item snapshots (price/HPP/qty/discount/total) are immutable to cashier sync.
- Cashier stock and batch changes are decrement-only; generic stock restoration is prohibited.
- Sales return is linked to invoice and itemIndex. Cumulative quota prevents over-return and is reserved atomically with request.
- Admin moves return from menunggu to menunggu_pimpinan or rejects; Pimpinan makes final decision. Stock restoration/refund obligation occurs only at final approval. Refund payment is separate, Pimpinan-only, Tunai/Transfer; transfer requires reference; duplicate payment blocked.
- Cancellation must not race with an active return; controlled approval restores stock/batches.
- Purchases, tariffs, packages, expenses, losses and most stock master operations are Admin/Pimpinan.
- Queue audio config docs have strict allowed IDs, fields, MIME and size limits. Admin's config writes are restricted to display-related fields/audio; Pimpinan controls general config.

This summary is not the final endpoint-level matrix; every rule condition and field whitelist must be mapped and tested before API implementation.

## 5. Display TV (display.html, 1,251 lines)

Verified: live patient queue, WIB clock/date, BroadcastChannel same-browser notifications, Firestore realtime listener for cross-device updates, separate notification chime and voice announcement, custom MP3 categories (notification, prefix, suffix, A-Z letters, 0-9 digits, general/dental counters), Indonesian speechSynthesis fallback, YouTube/playlist, direct MP4/WebM/Ogg, local video file selection, health-tip fallback, running text and clinic branding.

Preserve requirements: announce digits individually (A-001 as “A, kosong, kosong, satu”); customizable voice clips remain separate from notification chime; separate A/B queue display modes with switching and Kasir selection. MP3 feature has storage/size constraints and should likely use object storage plus metadata rather than MySQL blobs.

## 6. PR #13 reference-only delta (open, unmerged)

PR title: “Wajib selesaikan pasien sebelum logout + pelimpahan antar-shift”. It changes display.html, firestore.rules, js/app.js, js/firebase-backend.js, js/store.js.

Documented scope:
- Block Kasir logout while today's assigned patients remain unfinished.
- Offer continue service, Batal Berobat, or hand over to another cashier/shift.
- Handover preserves patient ID and queue number; changes cashier and shift; requires reason; shows handover note and logs activity. Receiving shift must be open.
- Firestore rules restrict handover to current patient owner and a valid open receiving cashier shift.
- Diff also adds per-cashier A/B queue assignment, prefix-specific queue generation, and saveQueueDisplayMode. Current main generator is A-only.
- PR checklist calls for regression tests covering patient lifecycle, queue, shifts, transactions, stock, returns and multi-device sync.

Treat these as separately identified requirements, not existing main behavior. Review and approve the full PR behavior independently; do not merge PR #13 as part of migration. If adopted, assignment history, source/target shift, reason, actor, timestamp, A/B numbering and role checks must be first-class server-side concepts.

## 7. Open decisions before schema approval

1. MySQL API as sole writer and explicit offline/conflict behavior.
2. Auth choice; if Firebase Auth is retained temporarily, backend must verify ID tokens and never trust client role.
3. Stock source of truth, ledger and reconciliation for sale/purchase/return/expiry/opname/correction.
4. Atomic POS: invoice, patient completion, stock/batch deduction, package expansion, payment and audit log commit/rollback together.
5. Return/cancellation state machine, quota reservation/release, batch restore, discount allocation, approvals and refund idempotency.
6. Financial dates: revenue return on approval date; cash outflow on actual refund date; opening shift cash is not revenue; cash-in-hand separate from net omzet/profit.
7. Per-cashier queue A/B, legacy A compatibility, display switching and digit-by-digit speech.
8. MP3/logo/video storage and authorization; avoid large blobs in relational tables by default.
9. Append-only audit log with actor/role/time/action/entity/details.
10. Patient privacy, least privilege, retention, encrypted backups and auditability before any live-data transfer.
11. Staff lifecycle including provisioning, email change, deactivation and stable internal cashier IDs.
12. Exact report/export formulas and reconciliation outputs.

## 8. Next audit sequence

Continue full PR #13 diff review; inspect index.html, helpers.js, export-helper.js, firebase-config.js, README and auth migration docs for hidden workflows; build field-level data dictionary and endpoint/role/field permission matrix; review inventory with user before schema design. No production migration or data copy without explicit approval.


## 9. Supporting modules and deployment/auth assumptions

### `index.html` (177 lines)
- Loads Firebase Web SDK compat v10.8.0 (app, Firestore, Auth, Functions), jsPDF + autoTable, and Chart.js from CDNs.
- Provides global shell, role navigation mount, login/reset-password UI, confirmation/form/alert modals, thermal receipt modal, medicine label modal, shift-close/WhatsApp modal and TV display launch.
- Script load order: helpers, store, Firebase config, Firebase backend, export helper, app.
- The new application must replace client SDK direct database access with authenticated API calls; do not expose database credentials in browser bundles.

### `helpers.js` (371 lines)
- XSS escaping and number/currency helpers: esc, rp, pct, uid.
- Dynamic tables/pagination: renderTable, changePage.
- Alert/confirm/form modal helpers.
- Queue broadcast helpers: broadcastCall, broadcastQueueUpdate, openTvDisplay.
- WhatsApp helpers: formatWaNumber, sendReceiptWA, sendShiftRecapWA.
- Shift WhatsApp recap includes cash/non-cash sales, petty cash, physical/system cash and service detail. Preserve as an operational workflow, not merely a link/button.

### `export-helper.js` (267 lines)
- getExportData selects datasets and applies export filters.
- toCSV/exportCSV, exportPDF.
- downloadBackup and restoreBackup use JSON backup/restore.
- Restore path currently checks required top-level data such as obat/users. New implementation must define backup versioning, validation, role restriction, atomic restore, duplicate protection, audit trail and recovery procedure before exposing restore to production.

### `AUTH_MIGRATION.md`
- Existing auth migration documentation protects the primary owner profile and operational data during bootstrap.
- Documents two Pimpinan identities and stable internal IDs, Firebase Auth UID/profile binding, staff account migration, email changes while retaining internal IDs, and cautions around Admin SDK credentials.
- This is a legacy Firebase-auth implementation guide, not a decision that Firebase Auth must remain forever. If retained temporarily, Vercel API must verify Firebase ID tokens server-side and map UID/email to active internal profiles. If replaced, account recovery and owner bootstrap must be designed explicitly.
- Never migrate passwords or Firebase service-account private keys into SQL or browser code.

### `README.md` and `firebase.json`
- README documents the product-client-first / local-first design and describes FEFO, weighted moving average HPP, packages, labels, queue, shift/WA, reports, audit, exports and JSON backup.
- README says package components can include consultation, procedures, lab checks and medicines; ensure service/tariff types are not narrowed to medicine-only.
- `firebase.json` configures Firestore Rules and Functions source. The migration branch's Vercel API is a separate backend path; Firebase deployment settings must not be changed as part of the read-only audit.

## 10. Additional requirements confirmed from support files

- Preserve keyboard shortcuts and cashier touch POS if present in the app flow.
- Preserve thermal 58mm/80mm and A4 print paths where applicable.
- Preserve receipt WhatsApp, patient WhatsApp, owner shift recap WhatsApp and resend flow.
- Preserve JSON backup/restore only after a safe, tested replacement is designed.
- Preserve PDF and CSV exports with appropriate filters and UTF-8 handling.
- Preserve clinic branding, logo upload, theme/font, page size, warning thresholds, fixed clinic identity, editable operational settings and owner WhatsApp contact.
- Preserve medicine label white/blue type, signa/dose shortcuts and printing from POS/receipt/history.
- Preserve TV local video fallback and health-tip slides, not only YouTube playback.

## 11. Audit completion status

This is a broader source inventory, not yet a complete relational field dictionary or test suite. Remaining work:
1. Extract exact field definitions and transitions from every store/backend write path.
2. Map each endpoint operation to actor, allowed fields, invariants and transaction boundary.
3. Review full PR #13 patch, particularly every workflow transition and its interaction with current main.
4. Create a user-reviewable permission matrix and data dictionary before proposing tables.


## 12. PR #13 deeper workflow review (branch-only, not merged)

Additional functions and constraints confirmed from the PR branch:

### UI workflow
- `getPendingPatientsForLogout` counts today's unfinished patients assigned to the currently logged-in cashier.
- `showPendingPatientsBeforeLogout` blocks logout until each pending patient is continued, marked Batal Berobat, or handed over.
- `continuePatientService` calls the existing patient and opens the transaction tab for that same patient.
- `savePatientHandoff` and `actionLimpahkanPasien` provide direct handover from the patient list.
- `finishLogout` rechecks pending patients before signing out; this prevents a stale modal decision from bypassing the check.
- `getQueuePrefixForCashier`, `getShiftQueuePrefix`, and `isShiftQueuePrefixCurrent` map stable internal cashier IDs to A/B and prevent use of a legacy shift with a mismatched prefix.
- New shift opening stores `queuePrefix`; patient registration stores both `queuePrefix` and `queueDisplayPrefix`.
- The patient list shows handover reason and source/destination cashier.
- TV mode selection exposes A and B options and persists the selected mode.

### Backend atomic operations
- `_assertPatientWorkflowAccess`: only authenticated Kasir/Pimpinan can invoke patient workflow transitions.
- `cancelPatientVisit`: reads current patient inside a Firestore transaction, checks cashier ownership and active/unserved state, then changes only Batal Berobat metadata/calling status.
- `restorePatientVisit`: restores only today's Batal Berobat patient, only if not completed; cashier must own patient.
- `handoffPatient`: transaction reads both patient and target shift before writes; checks ownership, patient active state, target shift open, different cashier, same operational date, and target A/B prefix. It preserves patient ID/number and updates cashier/shift plus handover audit fields and display prefix.
- `registerPatientWithQueueNumber`: allocates a separate sequence for A and B, uses prefix-specific candidate document IDs and handles legacy A sequence compatibility.
- `saveQueueDisplayMode`: only Kasir/Pimpinan and only A/B; persists selected mode in clinic config.

### PR #13 Rules additions
- Derives expected queue prefix from stable internal user ID (`kasir` → A; `kasir2` → B), not editable email.
- Restricts patient calling updates to active patients and owner/Pimpinan.
- Separates Batal Berobat, restore, archive, unarchive and handover into distinct allowlisted transitions.
- Handover requires source owner to match current patient owner, target cashier to differ, reason length at least five, timestamp, target shift open and same date, and target shift prefix to match recipient.
- Kasir cannot hand over another cashier's patient; Pimpinan can hand over across users.
- Queue mode config update is restricted to A/B and to authorized Kasir/Pimpinan.

### Migration design consequence
These are multiple separate state transitions and should not become a generic patient update endpoint. The API should expose distinct operations with transactional checks, and retain a handover history table (not only overwrite the current patient owner). The current PR stores latest handover metadata on the patient; a relational migration should consider an append-only handover event table so multiple handovers remain auditable.

PR #13 also has explicit regression requirements for old workflows. Its branch is not a passing test report; these functions and Rules were source-reviewed only.


## 13. Candidate field dictionary — verified source fields (not SQL DDL)

The following field names are observed in seed data, object construction, transactional writes, Rules conditions or UI reads. Optionality, nullability, SQL types, indexes and foreign keys still require the full write-path review. Nested arrays/objects must not be flattened or discarded without an explicit design.

| Entity | Verified fields / nested structures | Relationships / notes |
|---|---|---|
| `users` | `u`, `id`, `email`, `uid`, `nama`, `hp`, `role`, `active`, `updatedAt`, `updatedBy` | Stable internal user key; email/UID are auth identity attributes. Preserve owner accounts. |
| `pasien` | `id`, `no`, `tgl`, `jam`, `nama`, `hp`, `layanan`, `kasir`, `sh`, `done`, `calling`, `status`, `deletedAt`, `batalBerobatPada`, `batalBerobatOleh`, `_t` | Assigned cashier and shift; queue number/date; optional handover metadata from PR13. |
| `shift` | `id`, `kasir`, `tgl`, `jamBuka`, `jamTutup`, `modal`, `status`, `verif`, `fisik`, `sistem`, `selisih`, `jam`, `jamT`, `_t` | User/cashier; shift-linked patients, transactions and petty cash. PR13 adds `queuePrefix` on its branch. |
| `trx` | `id`, `no`, `tgl`, `jam`, `pid`, `nama`, `hp`, `kasir`, `sh`, `items[]`, `total`, `bayar`, `kembalian`, `metode`, `status`, `dibatalkanPada`, `dibatalkanOleh`, `_t` | Patient, cashier, shift. Item snapshot includes `id`, `oid`, `nama`, `t`/`jenis`, `qty`, `harga`, `hpp`, `signa`, `catatan`, `batchDeductions[]`, package `items[]), discount lines and item-specific metadata. |
| `obat` | `id`, `nama`, `satuan`, `hpp`, `jual`, `stok`, `min`, `_t` | Aggregate stock plus batches; must reconcile against batch ledger. |
| `batch` | `id`, `oid`, `no`, `ed`, `qty`, `sisa`, `beli`, `_t` | Medicine and originating purchase; FEFO deductions recorded in invoice item snapshots. |
| `tarif` | `id`, `nama`, `jenis`, `harga` | Service/tariff master; includes consultation, procedure and lab-type services. |
| `paket` | `id`, `nama`, `deskripsi`, `harga`, `items[]` | Components have `id`, `type` (tarif/obat), `oid`, `nama`, `harga`, `qty`; transaction snapshot may include per-component batch deductions. |
| `beli` | `id`, `tgl`, `supplier`, `faktur`, `oid`, `qty`, `total`, `tempo`, `lunas`, `tglBayar`, `qtyAwal`, `totalAwal`, `hargaBeliSatuan`, `batchId`, `_t` | Medicine, batch; outstanding payable is derived from unpaid invoice balance. Preserve original values for staged supplier returns. |
| `returBeli` | `id`, `tgl`, `beliId`, `supplier`, `faktur`, `namaObat`, `qty`, `nilai`, `alasan`, `_t` | Purchase invoice and medicine/batch; reduces stock and unpaid balance when applicable. |
| `biaya` | `id`, `tgl`, category/description fields, `jml`, `status`, requester/verifier and timestamps | Expense approval lifecycle; exact complete field list still to be extracted. |
| `loss` | `id`, `tgl`, `oid`/`obatId`, `qty`, `nilai`, `ket`/`keterangan` | Medicine stock loss/expiry and reason. |
| `petty` | `id`, `tgl`, `sh`, `jml`, description, cashier/user | Cashier and shift; access restricted to own records for Kasir. |
| `returJual` | `id`, `trxId`, `itemIndex`, `quotaId`, `priorQty`, `qty`, `harga`, `total`, `hpp`, `jenis`, `oid`, `batchRestores[]`, `status`, `alasan`, `alasanPenolakan`, `kasir`, `diverifikasiOleh`, `diverifikasiPada`, `diverifikasiAdminOleh`, `diverifikasiAdminPada`, `pengembalian{}`, `_t` | Original invoice and item index; nested batch restore records contain `oid`, `bid`, `qty`, `batchNo`, `ed`. Refund object contains status, nominal, method, reference, payer and paid time. |
| `returKuota` | `trxId`, `itemIndex`, `qtyTerpakai`, `lastReturId`, `lastQty`, `_t` | Composite identity from invoice ID + item index; reserved quantity prevents cumulative over-return. |
| `batalTrx` | `id`, `trxId`, `status`, `kasir`, `alasan`, `tgl`, `_t`, decision/rejection actor and time | One cancellation request per invoice ID in current backend. Must coordinate with returns. |
| `log` | `id`, `_t`, `tgl`, `jam`, `u`, `aksi`, `kol`, `rinci`, `_pendingSync` | Actor and append-only audit intent; staff logs are own-only append/sync. |
| `klinik_config/settings` | nested `set{}`, `seq{}`; display fields `youtubeVideoId`, `enableYoutubeDisplay`, `runningTextDisplay`; queue display mode exists on PR13 branch | General settings are Pimpinan-managed; Admin limited to display settings. |
| Queue audio clips | `type`, `clipId`, `audioData`, `sizeBytes`, `fileName`, `mimeType`, `updatedAt`, `updatedBy` | Validated MP3, max 600 KiB; media should be moved to object storage with metadata in SQL. |

## 14. Important source inconsistencies and migration hazards

1. **Return approval differs between local store and Cloud backend.** Local `ClinicStore.approveReturJual` allows Admin/Pimpinan to set status `disetujui` and restore batch/medicine stock immediately. Cloud backend has a two-stage workflow: Admin verifies to `menunggu_pimpinan`; Pimpinan finalizes and only then restores stock and creates refund obligation. The SQL design must follow the approved secure workflow, not copy the local shortcut. This is a source discrepancy to test and resolve.
2. **Current queue generator in main is A-only.** PR13 contains A/B prefix and per-cashier sequence changes. Queue prefix and sequence scope must be explicit, and old A numbers must remain readable.
3. **Client-side LocalStorage and Firestore cache are not authoritative transaction boundaries.** Some local store methods mutate local objects before sync; migration must avoid client-side stock, money or status writes.
4. **Legacy return records may not have complete quota/payment metadata.** Backend contains migration/reconciliation helpers. Existing historical data needs a read-only reconciliation report before any import.
5. **Aggregate medicine stock and batch balances can diverge.** Enforce invariant and ledger reconciliation in the new system.
6. **Invoice line arrays are historical snapshots.** Do not calculate historical revenue/HPP using current tariff, medicine master or current HPP.
7. **Date semantics differ by business event.** Operational date is WIB; return approval affects net revenue date while actual refund payment affects cashflow date. Store UTC instants plus explicit Asia/Jakarta business date where required.
8. **Some rules allow multiple narrow patient transitions in one update predicate.** API should model each transition as its own command and recheck state inside transaction.

## 15. Proposed state machines to validate

- Patient: `aktif` → `batal_berobat` → `aktif`; separately `aktif` → `done=true`; archive/delete is Pimpinan-only and must not erase audit history. Handover is a separate event that changes assignment while preserving patient identity and queue number.
- Shift: open → closed → verified; reopening/adjustment policy is not yet fully specified.
- Sales return: `menunggu` → Admin verified `menunggu_pimpinan` → Pimpinan `disetujui` or rejected; then refund `menunggu` → `dibayar`. Admin rejection releases reserved quota. Legacy `disetujui` states require reconciliation.
- Invoice cancellation: request `menunggu` → approved/rejected; approved path updates invoice/patient and restores batch/stock exactly once; pending cancellation blocks new return and active return blocks cancellation.
- Expense: draft/request → approval/rejection (exact state and field map remains to verify).
- Purchase payable: unpaid → partially/fully adjusted by supplier returns and payment; current code marks `lunas` and `tglBayar`, but partial-payment support is not yet confirmed.

## 16. Field dictionary status and remaining gaps

This is a candidate field dictionary based on inspected source usage, not a complete SQL schema. Still to verify:
- Exact object construction for every expense, stock loss, petty cash, shift, patient, invoice and user form.
- Exact package component shape when nested inside an invoice and how discount is applied to each component.
- Complete cancellation request decision fields and every Firestore Rules branch for all 16 collections.
- Purchase payment history, partial payment, and supplier-return accounting.
- Audit log events and retention/export behavior.
- Handover history fields from full PR #13 patch and selected queue display mode semantics.
- Whether clinic config settings currently contain fields not visible in defaults or TV page.
- Backup/restore validation and whether restore can overwrite protected master accounts.

No table DDL is approved by this document. Next step is endpoint/field permission matrix and focused tests built from these invariants.
