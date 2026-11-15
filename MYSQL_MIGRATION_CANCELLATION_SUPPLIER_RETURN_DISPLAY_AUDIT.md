# MySQL Migration — Cancellation, Supplier Return and Display Asset Callsite Audit

Date: 2026-11-15
Source: main (read-only)
Scope: app UI, ClinicStore and Firebase backend callsite cross-check.

## Source fingerprints

- `js/app.js`: `f74c4710161ddd2af230e51c18b1f107d6c52c82`
- `js/store.js`: `99e74acf8caec9c70d82be1d5f6efc5bfa6bc4fb`
- `js/firebase-backend.js`: `3a613d96564f120b8141966f9ecbae21471c4e65`

## 1. Invoice cancellation request and approval

Observed request document is stored at `k_batalTrx/{trxId}` (document ID equals invoice ID). Fields created by `submitCancelRequest`:
- `id`, `trxId`, `status='menunggu'`, `kasir`, `alasan`, `tgl`, `_t`
- Snapshot display fields `noNota`, `namaPasien`
- On re-request after prior rejection, reset `alasanPenolakan`, `diverifikasiOleh`, `diverifikasiPada` to null.

On processing:
- Reject: `status='ditolak'`, `alasanPenolakan`, `diverifikasiOleh`, `diverifikasiPada`, `_t`.
- Approve: `status='disetujui'`, `diverifikasiOleh`, `diverifikasiPada`, `_t`; invoice gains `status='dibatalkan'`, `dibatalkanPada`, `dibatalkanOleh`; patient `done=false` if patient doc exists.
- Approval restores medicine aggregate stock and exact batch quantities from invoice `batchDeductions`; it refuses missing/mismatched batch allocations. Package component medicine allocations are expanded.
- UI allows Kasir request and Admin/Pimpinan processing; backend permits Admin/Pimpinan. A new request can be made after a rejected request.

Critical race/design findings:
- The return query is fetched outside the Firestore transaction because compat Transaction.get does not accept Query. The code relies on Rules to block new return creation while cancellation is pending. SQL must instead lock invoice plus return/quota rows in one transaction and enforce mutual exclusion.
- Missing patient does not prevent invoice cancellation; only patient status reset is skipped. Define a historical orphan policy and ensure invoice/stock reversal remains complete.
- Cancellation requires original batch allocation snapshots. Legacy invoice without valid deductions is intentionally blocked to avoid aggregate/batch divergence. Such rows need manual reconciliation, not fabricated batch allocation.
- Reversal must be exactly once; repeated decision, duplicate command and cancellation/return races must be rejected.
- Financial ledgers must reverse revenue, HPP, cash/bank and patient receivable/refund effects consistently; stock restoration alone is insufficient.

## 2. Supplier purchase return

Local `processReturBeli({beliId,qtyRetur,alasan})` selects the first batch whose `beli` equals purchase ID, then silently caps requested quantity using purchase qty, batch remaining and aggregate medicine stock. It updates:
- purchase: `qty`, `total` only if not paid, `hargaBeliSatuan`, `qtyAwal`, `totalAwal`, `_t`
- batch: `sisa`, `_t`
- medicine: `stok`, weighted HPP estimate, `_t`
- return history: `id,tgl,beliId,supplier,faktur,namaObat,qty,nilai,alasan,_t`.

UI uses this local mutation and generic sync; no dedicated Firebase supplier-return command was found in the inspected backend method catalog. Target must implement a server-side command, identify exact source batch (not first-match assumption), reject rather than silently cap invalid quantities, create supplier credit/return and payment allocation records, and post inventory/HPP movements atomically. Historical purchase `qty` is mutated today; preserve original quantity/value snapshots in the target.

## 3. Queue audio and Display TV settings

- Queue audio docs: `klinik_config/queueAudioClip_{clipId}`; fields `type='queue_audio_clip'`, `clipId`, `audioData` (base64), `sizeBytes`, `fileName`, `mimeType`, `updatedAt`, `updatedBy`.
- Allowed clip IDs: `notification`, `prefix`, `suffix`, `letter_A-Z`, `digit_0-9`, `counter_umum`, `counter_gigi`.
- Only Admin/Pimpinan can save/delete; MP3 data capped at 600 KiB; delete currently removes the document.
- UI can preview pending selected audio before save; save success is cloud-side. Audio playback and chime are separate concepts.
- Display settings are stored as `klinik_config/settings.set` fields `youtubeVideoId`, `enableYoutubeDisplay`, `runningTextDisplay`; backend deliberately merges only those fields so other config is not overwritten.
- Current config/listener includes display settings and queue audio metadata. Audio payload is fetched separately.

Target design:
- Keep audio binary outside TiDB in private object storage; SQL stores object key, checksum, MIME, size, version, active/deleted metadata, actor/time.
- Use soft-delete/versioning or explicit audited delete for audio assets.
- Validate YouTube ID and running-text length/content server-side.
- Display TV should receive only a purpose-built queue projection and approved display settings; never broad patient documents or phone/clinical data.
- Keep queue announcement voice clips customizable separately from notification chime. Digit-by-digit spoken queue remains an acceptance requirement.
- A/B switching from PR13 remains reference-only until its PR is separately adopted and tested.

## 4. Additional target acceptance tests

- Cancellation and return cannot both succeed for one invoice under concurrency.
- Cancellation approval restores each medicine and batch exactly once, including package components.
- Cancellation request after rejection can be re-submitted with fresh audit history and cleared rejection metadata.
- Missing patient does not leave invoice, stock and queue state inconsistent.
- Legacy invoice with missing batch allocation is quarantined for manual reconciliation.
- Supplier return cannot exceed the exact originating batch or purchase remaining quantity; invalid overage returns a clear error.
- Supplier return creates a credit note and correctly handles paid/unpaid supplier balance without rewriting original invoice history.
- Audio file type, size, clip ID and checksum are verified; unauthorized roles cannot upload/delete.
- Display settings update does not overwrite unrelated clinic settings.
- TV projection cannot access patient phone or unrestricted patient documents.
- Audio asset version rollback and delete are audited; notification chime and spoken clips remain independently configurable.

## 5. Safety status

Static source review only. No Rules or Firebase data changed. No SQL DDL, production code or production deployment. No live patient data was accessed or migrated.
