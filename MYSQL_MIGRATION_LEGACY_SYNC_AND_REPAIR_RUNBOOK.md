# LEGACY FIREBASE ↔ TiDB SYNCHRONIZATION & DATA REPAIR RUNBOOK

Tanggal: 2026-11-15  
Branch: `migration/tidb-foundation`  
Status: **DESIGN + STATIC SOURCE AUDIT ONLY — NO LIVE DATABASE ACCESS OR MUTATION**

## 1. Tujuan

Menyiapkan proses untuk:
1. Membandingkan Firebase/Firestore lama dengan target TiDB secara lengkap.
2. Menemukan data hilang, ganda, tidak cocok, referensi yatim, saldo tidak konsisten, dan perbedaan hasil perhitungan.
3. Menentukan sumber kebenaran per domain dan per jenis data.
4. Memperbaiki data legacy hanya setelah bukti, backup, persetujuan, dan dry-run tersedia.
5. Menjalankan migrasi tanpa mengubah perilaku aplikasi produksi secara mendadak.

Dokumen ini tidak berarti sinkronisasi atau perbaikan produksi telah dilakukan. Audit sebelumnya bersifat statis; tidak ada dokumen pasien, transaksi, stok, batch, atau saldo produksi yang dibaca.

## 2. Keputusan arsitektur: jangan melakukan dual-write bebas

**Jangan menjalankan sinkronisasi dua arah langsung (Firebase ⇄ TiDB) dengan generic full-state push.**

Audit source menemukan bahwa backend lama:
- Melakukan merge push per koleksi, bukan satu transaksi lintas koleksi.
- Tidak memiliki propagasi delete/tombstone yang andal.
- Mengandalkan timestamp `_t` dari perangkat untuk urutan konflik.
- Dapat mempertahankan record lokal yang sudah tidak ada di remote.
- Dapat sukses menulis satu koleksi lalu gagal pada koleksi lain.
- Mengirim state dari browser, bukan command bisnis yang sepenuhnya dihitung server.

Karena itu, dual-write tanpa protokol khusus berisiko menghasilkan stok ganda/berbeda, transaksi parsial, retur ganda, saldo keuangan salah, dan konflik data antar perangkat.

### Tahapan sinkronisasi yang aman

| Fase | Arah | Tujuan | Status |
|---|---|---|---|
| S0 | Firebase → audit snapshot | Ekstrak salinan baca-saja + hash + metadata | Belum dijalankan |
| S1 | Snapshot → staging/karantina | Normalisasi, mapping, validasi, rekonsiliasi | Belum dijalankan |
| S2 | Staging → TiDB preview | Muat data sintetis terlebih dahulu; kemudian data non-produksi yang disetujui | DDL/runtime gate belum lolos |
| S3 | Firebase tetap utama; TiDB shadow-read | Bandingkan hasil query dan laporan tanpa memengaruhi operasi | Belum dijalankan |
| S4 | Controlled cutover | Hentikan write sementara, final snapshot, delta replay, rekonsiliasi, owner sign-off | Belum dijalankan |
| S5 | TiDB menjadi primary | Satu writer melalui API; Firebase read-only/arsip sesuai rencana | Belum dijalankan |

Tidak ada live dual-write selama fase S0–S3. Bila kelak dibutuhkan transisi sementara, gunakan transactional outbox/change log dengan sequence, idempotency, replay cursor dan reconciliation; bukan push seluruh state dari browser.

## 3. Sumber kebenaran sementara

Sampai cutover disetujui:
- Firebase/Firestore produksi tetap sumber data operasional yang sedang dipakai aplikasi.
- Data lokal `localStorage.klinik_data` adalah cache/offline state, bukan database otoritatif terpisah.
- TiDB preview hanya untuk skema dan data sintetis; tidak boleh dianggap sudah mencerminkan produksi.
- Laporan UI/CSV/print bukan sumber ledger. Hitung ulang dari dokumen dan peristiwa dasar.
- Master Pimpinan `praktekrose@gmail.com` dan `nursalim42@gmail.com` wajib dilindungi dari reset, import, restore, merge, deduplikasi dan koreksi otomatis.

Setelah cutover, TiDB menjadi satu-satunya writer melalui API terautentikasi. Jangan mengizinkan dua database menerima command transaksi yang sama secara independen.

## 4. Source-to-target domain register

| Domain | Sumber legacy | Target kandidat | Kunci rekonsiliasi | Pemeriksaan wajib |
|---|---|---|---|---|
| Identitas | `k_users/{id}`, Firebase Auth | users, active_email_claims, role assignments, email history | UID + source path + stable user ID | email/UID/role/active, owner protection, duplicate claim |
| Pengaturan | `klinik_config/settings` | clinic_settings, display_configs, queue counters | document path + setting key | fixed clinic identity, preserve unknown keys, no default overwrite |
| Pasien | `k_pasien/{id}` | patients + encounters + queue tickets/events | source collection + document ID | orphan encounter, patient snapshot, Batal Berobat vs archive |
| Penjualan | `k_trx/{id}` | sales invoice + lines + components + payments | invoice source ID + item index | totals, discount, tender, snapshots, cancelled state |
| Stok obat | `k_obat/{id}` | medicines + stock projection | medicine source ID | aggregate vs batch sum, HPP and unit |
| Batch | `k_batch/{id}` | inventory_batches + movements | batch source ID | medicine parent, ED, initial/remaining quantity, opening provenance |
| Pembelian | `k_beli/{id}` | supplier invoice/lines/payments | purchase source ID | qty/total/HPP/paid boolean; do not invent partial payments |
| Retur pembelian | `k_returBeli/{id}` | supplier return/lines/credit note | return source ID + original purchase | exact batch, duplicate stock decrement, credit recognition |
| Retur penjualan | `k_returJual/{id}`, `k_returKuota` | return request/lines/events/quota/refund | return ID + invoice + item/component | quota, approval stage, stock restore, payout evidence |
| Pembatalan | `k_batalTrx/{id}` | cancellation request/events | invoice ID + request ID | conflict with return, stock reversal exactly once |
| Shift | `k_shift/{id}` | cashier shifts/reconciliations | shift ID + cashier identity | modal, cash sales, petty, close, verification |
| Kas kecil | `k_petty/{id}` | petty cash + cash ledger | source ID | shift relation, reversal, expense double count |
| Biaya | `k_biaya/{id}` | expenses/events/ledger | source ID | status, approval evidence, amount |
| Kerugian | `k_loss/{id}` | loss events + inventory movements | source ID + batch | qty/value and stock movement exactly once |
| Audit | `k_log/{id}` | audit_events | source ID + raw timestamp | preserve available logs; never fabricate truncated history |
| Audio/display | queue audio docs + settings | object storage + metadata + display config | document path + content hash | checksum, MIME, size, version and privacy |

This is a mapping baseline, not proof that every historical document contains all listed fields. Preserve unknown fields in a restricted raw staging payload until mapped or explicitly quarantined.

## 5. Canonical source identity and snapshot protocol

Every extracted document must carry:
- source_system (e.g. firebase_firestore)
- source_collection
- source_document_id
- source_document_path
- source_hash_sha256 over canonical raw bytes/representation
- source_update_time if supplied by provider
- legacy business timestamp raw value and observed type
- extraction_batch_id and extraction timestamp
- parser_version and mapping_version
- target entity/type/id once assigned
- disposition: pending, mapped, quarantined, ignored_with_reason, approved

Unique identity is `(source_system, source_collection, source_document_id)`; never assume a document ID is globally unique across collections.

Snapshot rules:
1. Read-only service identity; minimum necessary permissions.
2. Export metadata and document content without writing back.
3. Preserve raw bytes/JSON unchanged and encrypt at rest.
4. Hash each document and each export manifest.
5. Record collection counts, total bytes, extraction errors and cursor completion.
6. Verify export completeness with counts and a second manifest check.
7. Never expose patient data in GitHub, logs, issue comments, screenshots or chat.
8. Store real-data snapshots only in approved private encrypted storage, never in repository or test fixtures.

## 6. Reconciliation layers

### 6.1 Structural reconciliation
- Source document count per collection vs extracted count.
- Duplicate source IDs within same collection; same ID across different collections is not a duplicate.
- Missing required keys, unexpected types, null/empty distinctions.
- Unknown fields and overlength values.
- Malformed JSON/array/object payloads.
- Missing or invalid timestamps.
- Duplicate active email claims and duplicate business keys.

### 6.2 Referential reconciliation
- Every encounter patient reference resolves or is explicitly quarantined.
- Every invoice patient/encounter/cashier/shift tuple is consistent.
- Every invoice medicine/component resolves to the correct medicine snapshot.
- Every batch belongs to the same medicine as the invoice deduction, loss or return.
- Every supplier return points to the original purchase line and exact batch where known.
- Every return line points to an eligible invoice line/component and valid quota.
- Cancellation and return cannot both reverse the same invoice stock.
- Actor references resolve to a known user or an explicit unknown/system/import actor classification.
- Do not fabricate missing links to make constraints pass.

### 6.3 Inventory reconciliation
Per medicine:
- legacy aggregate stock
- sum of batch remaining quantities
- sum of opening receipts + purchases − sales − supplier returns − losses + approved patient returns ± adjustments
- target reconstructed balance
- variance and confidence/evidence

Per batch:
- initial quantity
- purchase/receipt quantity
- sale deductions
- approved patient-return restoration
- supplier-return deductions
- losses/adjustments
- computed remaining quantity vs stored `sisa`

Never repair a mismatch by simply setting `obat.stok = SUM(batch.sisa)` or changing a batch balance. First identify the missing/duplicate movement and its evidence. If the cause cannot be established, quarantine and request owner review; do not invent a movement.

### 6.4 Financial reconciliation
Recompute independently:
- gross sales from non-cancelled invoice snapshots
- approved return value using original item and discount allocation
- net revenue
- HPP from immutable invoice snapshots less eligible returned HPP
- approved expenses
- petty cash and its accounting classification
- inventory losses
- supplier payable, accepted credit and allocated payments
- refund obligations vs actual refund payouts
- opening shift float, cash sales, cash refunds, petty cash, adjustments and closing cash
- non-cash receipts by settlement evidence

Do not equate `lunas=true` to a known payment amount/date if the old record only proves a boolean. Do not create partial payments retroactively without documentary evidence. Do not count opening modal as omzet. Do not count refund approval as cash payout.

### 6.5 Event and lifecycle reconciliation
- Compare submitted, reviewed, forwarded, approved, rejected and paid stages separately.
- A final return approval is not proof that a refund was paid.
- A return approval is not proof of which batch was restored if restore details are missing.
- A cancellation status is not proof stock was restored exactly once.
- Missing legacy logs are reported as unavailable; do not fabricate actors/timestamps.
- Distinguish Batal Berobat, soft archive and hard-delete markers.

## 7. Difference classification and repair eligibility

| Class | Meaning | Action |
|---|---|---|
| MATCH | Same semantic value and source evidence | No change |
| FORMAT_ONLY | Different representation, same value | Transform in staging; retain raw |
| DERIVED_MISMATCH | Cached/report total differs from recomputation | Recompute target projection; do not overwrite source ledger |
| MISSING_REFERENCE | Parent/child missing or ambiguous | Quarantine; manual resolution |
| DUPLICATE | Duplicate business event or conflicting source identity | Freeze automatic action; investigate references and idempotency |
| BALANCE_VARIANCE | Stock/cash/payable/refund mismatch | Trace ledger events; no blind balance patch |
| TIMESTAMP_AMBIGUOUS | Cannot prove timezone/format | Preserve raw; quarantine from time-dependent reports |
| UNKNOWN_FIELD | Source field has no approved mapping | Preserve in raw staging; block destructive transformation |
| POLICY_CONFLICT | Historical action conflicts with target policy | Preserve historical fact; map legacy exception and obtain owner decision |
| CONFIRMED_CORRUPTION | Evidence proves record is wrong | Eligible for reviewed correction plan only |

A row is not confirmed corrupt merely because it differs from a projection or new schema. Do not use newest timestamp as universal winner.

## 8. Legacy database repair workflow — mandatory controls

**No direct UPDATE/DELETE/overwrite against production during discovery.**

For every proposed repair:
1. Capture the exact source document path, original raw JSON, source hash and extraction batch.
2. Record the suspected error, evidence, business impact and related invoice/batch/shift/user references.
3. Determine the authoritative event/ledger that proves the correct value.
4. Prepare a before/after patch in a separate review file; include reason code, operator, approver and rollback payload.
5. Run the patch against a cloned/synthetic fixture first.
6. Dry-run the complete affected domain and show expected stock, batch, omzet, HPP, refund, payable and shift-cash deltas.
7. Require independent review and explicit owner approval for financial/inventory/identity corrections.
8. Apply only the smallest atomic patch through an audited, idempotent administrative command; never generic full-document replacement.
9. Read back the exact changed record and related records; verify hash/version and invariants.
10. Write an immutable repair event with before/after hashes, actor, approver, reason, command ID and timestamp.
11. Run post-repair reconciliation and compare expected vs actual deltas.
12. If any check fails, stop the batch and execute the reviewed rollback; do not continue to the next record.

Bulk repair requires a bounded batch, resumable cursor, idempotency key, per-record result, error quarantine and stop-on-threshold. No auto-repair of master owner identities, invoice snapshots, financial ledger, stock movements, batch provenance, returns or cancellations.

## 9. Concurrency and change capture

If legacy writes continue during extraction:
- Use provider-supported consistent export/snapshot semantics where available.
- Record extraction watermark and source update times; do not rely only on client `_t`.
- Re-read changed documents after the snapshot watermark and reconcile deltas by source hash/version.
- Because the old generic sync has no reliable tombstones and timestamps may be skewed, do not infer deletion from absence in a partial listener/export.
- At final cutover, schedule a controlled write freeze; capture final full snapshot + delta, drain pending writes, verify all collection cursors and reconcile before changing app routing.
- Keep Firebase backup/read-only fallback until explicit post-cutover acceptance and retention sign-off.

## 10. Required synthetic tests before any real migration

1. Same document ID in different collections maps to different target identities.
2. Duplicate ID within same collection is detected and quarantined.
3. Unknown fields survive raw staging and are not discarded.
4. Missing parent references quarantine without fabricated parent.
5. Batch medicine mismatch rejected.
6. Duplicate checkout replay does not deduct stock twice.
7. Concurrent checkouts cannot oversell a batch.
8. Return and cancellation race cannot both reverse same invoice.
9. Rejected return releases quota exactly once.
10. Approved return restores only original eligible batch quantity once.
11. Approval without payout leaves refund obligation unpaid.
12. Duplicate payout replay does not create second cash/bank outflow.
13. Supplier return cannot exceed original batch remainder.
14. Purchase `lunas` boolean does not invent partial payment rows.
15. Ambiguous legacy timestamps retain raw value and are excluded from date-sensitive automation until reviewed.
16. Shift cash reconciliation distinguishes opening float, cash sales, cash refund and petty cash.
17. Owner accounts survive import, reset, restore and duplicate cleanup.
18. Partial export/cursor failure blocks migration promotion.
19. Replay of same migration batch is idempotent.
20. Rollback restores exact before-state and audit evidence remains.

## 11. Promotion gates

No real data migration or legacy correction until all are true:
- [ ] Approved encrypted backup and tested restore of the legacy source.
- [ ] Complete source field union and per-collection counts/hash manifest.
- [ ] Source-to-target crosswalk approved, unknown fields accounted for.
- [ ] Schema v1 frozen after all D01–D20 business decisions and TiDB compatibility tests.
- [ ] Identity/Cloud Functions provenance and owner mapping verified.
- [ ] Orphan/duplicate/timestamp ambiguity report reviewed.
- [ ] Stock/batch and financial reconciliation has zero unexplained variance, or every exception is quarantined and owner-accepted.
- [ ] All synthetic transaction, rollback, concurrency, permissions and replay tests pass.
- [ ] Read-only shadow reports match expected business results.
- [ ] Final cutover freeze, delta replay, rollback and fallback plan rehearsed.
- [ ] Explicit owner sign-off for migration and any source database repair.

## 12. Current verified status

- Static source audit: confirms unsafe properties of legacy generic sync described above.
- Source data snapshot: **not obtained**.
- Live Firebase document counts/hashes: **not obtained**.
- Legacy production database repair: **not performed**.
- TiDB production data load: **not performed**.
- Continuous bidirectional sync: **not implemented and not recommended**.
- TiDB schema DDL/runtime validation: **not complete**.
- Production cutover: **not authorized**.

## 13. Related documents

- `MYSQL_MIGRATION_LEGACY_DATA_COMPATIBILITY_AUDIT.md`
- `MYSQL_MIGRATION_BACKEND_METHOD_COLLECTION_CATALOG.md`
- `MYSQL_MIGRATION_FINANCIAL_INVENTORY_RECONCILIATION_AUDIT.md`
- `MYSQL_MIGRATION_RELATIONAL_INTEGRITY_ORPHAN_AUDIT.md`
- `MYSQL_MIGRATION_SCHEMA_CONTRADICTION_SOURCE_IDENTITY_CLOSURE_AUDIT.md`
- `MYSQL_MIGRATION_COLUMN_DICTIONARY_V0_1.md`
- `MYSQL_MIGRATION_MASTER_BLUEPRINT.md`
