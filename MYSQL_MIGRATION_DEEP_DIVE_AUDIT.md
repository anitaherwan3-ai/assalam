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
