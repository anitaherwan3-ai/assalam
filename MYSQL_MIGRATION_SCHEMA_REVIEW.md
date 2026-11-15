# SCHEMA V1 REVIEW — Klinik Assalaam Palembang
Tanggal: 2026-11-15
Branch: migration/tidb-foundation
Status: REVIEW FINDINGS — NO DDL APPLIED

## Ringkasan

Proposal schema sudah mencakup domain inti aplikasi (identitas, pasien/kunjungan, antrean, shift, kas/bank, master obat, batch, pembelian, POS, retur, pembatalan, biaya, audit, backup dan ekspor). Namun proposal belum boleh dibekukan menjadi DDL v1 sebelum koreksi struktural di bawah dan compatibility spike pada cluster TiDB aktual selesai.

Tidak ada tabel aplikasi yang dibuat, tidak ada data klinik yang dibaca/diimpor, dan tidak ada perubahan Firebase atau production. Uji kompatibilitas yang direncanakan harus menggunakan tabel sintetis bernama unik dan menghapusnya setelah tes.

## A. Temuan struktural — wajib diperbaiki sebelum DDL

### A1. Relasi pembelian ↔ batch berpotensi melingkar
Saat ini `supplier_invoice_lines.batch_id` dan `inventory_batches.supplier_invoice_line_id` sama-sama menyatakan relasi yang sama dari dua arah. Ini menciptakan FK melingkar dan urutan migrasi yang rumit.
**Keputusan schema:** jadikan `inventory_batches.supplier_invoice_line_id` sebagai satu-satunya relasi receipt-line → batch untuk kasus satu batch per baris pembelian. Hapus `batch_id` dari `supplier_invoice_lines`. Bila kelak satu baris pembelian boleh menghasilkan banyak batch, relasikan melalui tabel `supplier_invoice_line_batch_allocations`, bukan FK balik.

### A2. Email aktif vs histori email
Unique global pada `user_emails.email_normalized` akan melarang alamat lama dipakai kembali walau record historis sudah ditutup.
**Keputusan schema:** pisahkan klaim email aktif ke tabel `active_email_claims(email_normalized PK, user_id UNIQUE, email_id UNIQUE)`; `user_emails` menyimpan riwayat dan index non-unique untuk histori. Perubahan email harus transaksi atomik dan mempertahankan immutable user_id. Verifikasi email tetap diwajibkan.

### A3. Kuota retur tidak cukup granular
Unique `return_quotas.invoice_line_id` tidak bisa mewakili kuota komponen obat pada paket sekaligus kuota jasa pada invoice line. `sales_return_lines` sudah mengizinkan `invoice_component_id`, tetapi quota tidak.
**Keputusan schema:** ubah menjadi `return_quota_subjects` dengan `quota_key` unik yang deterministik, `invoice_line_id`, nullable `invoice_component_id`, `subject_type`, sold/reserved/approved quantity dan version. Setiap unit yang bisa diretur punya satu subject. Return service mengacu ke line; komponen obat paket mengacu ke component. Semua quota subject dikunci saat submit/finalize/cancel.

### A4. Satu role aktif dan assignment antrean perlu invariant
Index biasa pada `role_assignments(user_id, valid_to_utc)` tidak mencegah dua role aktif. Rentang `cashier_queue_assignments.valid_from/valid_to` juga bisa tumpang tindih.
**Keputusan schema:** gunakan tabel slot aktif terpisah untuk role klinik (mis. `active_role_slots(user_id PK, role_assignment_id UNIQUE)`) atau satu baris role aktif pada `users` bila kebijakan benar-benar single-role; pilih satu sumber kebenaran. Assignment antrean diubah lewat command yang mengunci user/prefix dan menolak rentang tumpang tindih. Jangan mengandalkan partial unique index.

### A5. Relasi active shift perlu kesesuaian kasir
`active_shift_slots.cashier_user_id` dan `shift_id` masing-masing FK belum menjamin shift yang ditunjuk milik kasir yang sama.
**Keputusan schema:** tambahkan unique key `cashier_shifts(shift_id,cashier_user_id)` dan composite FK dari `active_shift_slots(shift_id,cashier_user_id)`; open/close/recovery harus satu transaksi. Slot hanya dihapus saat shift ditutup final, bukan ketika request timeout.

### A6. Histori proses retur
Status review Admin dan final Pimpinan tersimpan di kolom header, tetapi tidak ada tabel event domain khusus untuk semua transisi retur.
**Keputusan schema:** tambahkan `sales_return_events` append-only (return_id, event_type, old_status, new_status, actor, reason, occurred_at). Audit umum tetap dicatat juga. Admin review tidak boleh membuat movement stok atau pembayaran; final approval membuat kewajiban refund; payout adalah command terpisah.

### A7. Validasi tipe baris invoice
`sales_invoice_lines` memiliki medicine_id/tariff_id/package_id nullable dengan aturan "tepat satu" berdasarkan line_type. CHECK constraint tidak boleh diasumsikan tersedia/identik sebelum spike.
**Keputusan schema:** validasi tepat satu target di API domain command; jika CHECK didukung pada versi cluster, gunakan sebagai lapisan tambahan. Terapkan pola sama untuk package_components dan invoice_line_components.

### A8. FK patient dan encounter harus konsisten
`sales_invoices.encounter_id` wajib, `patient_id` nullable, sedangkan encounter.patient_id juga nullable. Ini bisa dipakai untuk data lama yang orphan, tetapi invoice.patient_id dapat berbeda dari encounter.patient_id.
**Keputusan schema:** encounter adalah sumber relasi kunjungan; invoice.patient_id hanya snapshot/lookup opsional dan harus cocok dengan encounter bila keduanya terisi. Data legacy yang tidak punya encounter valid masuk quarantine/staging, bukan membuat encounter/pasien palsu.

### A9. Ledger dan angka uang
BIGINT signed rupiah tepat untuk nilai bulat, tetapi Node/mysql2 harus menghindari konversi BIGINT besar menjadi JavaScript Number yang tidak presisi.
**Keputusan implementasi:** gunakan mysql2 `supportBigNumbers: true`, `bigNumberStrings: true`; hitung nilai rupiah di server dengan integer/BigInt; API serialize angka rupiah secara konsisten. Kolom amount harus positif dan direction menentukan tanda; reversal membuat baris baru.

### A10. Batch split dan retur supplier
Proposal menyebut satu batch per purchase line, tetapi source lama/masa depan dapat membutuhkan split penerimaan.
**Keputusan schema v1:** satu batch per receipt line hanya jika data source/operasional mengonfirmasi. Kalau tidak, gunakan tabel allocation line-to-batch sejak awal. Supplier return harus mengunci line, batch dan saldo kuota; jangan memakai Math.min untuk menurunkan qty yang diminta diam-diam.

## B. Temuan teknis dan operasional

1. **Auto-increment:** jangan bergantung pada nomor berurutan atau gapless. Gunakan public_id UUID/ULID; internal BIGINT hanya surrogate key.
2. **UTC:** DATETIME(3) tidak menyimpan zona. Setiap koneksi aplikasi menetapkan session time_zone = '+00:00'; business_date dihitung eksplisit di Asia/Jakarta. Uji NOW(3), UTC_TIMESTAMP(3), default timestamp, dan session pool reuse.
3. **Index/FK:** pastikan setiap FK punya index child yang sesuai dan tipe/unsigned/collation kolom cocok. Jalankan EXPLAIN untuk query antrean, FEFO, invoice harian, stock card dan audit.
4. **Locking:** jangan mengandalkan gap locking untuk mencegah phantom/duplikasi. Kunci row counter, active slot, quota, invoice, medicine/batch yang sudah ditemukan, dan gunakan unique constraint sebagai pagar terakhir. Retry transaksi deadlock/write conflict dengan batas percobaan dan idempotency.
5. **Isolation:** tes concurrent last-stock sale, duplicate queue allocation, duplicate open shift, simultaneous return reservation, cancellation vs return, dan duplicate refund payment menggunakan koneksi terpisah.
6. **Transaction size:** checkout/return/cancel harus mengunci dan menulis hanya row yang diperlukan, konsisten urutan lock untuk mengurangi deadlock.
7. **Soft delete:** hindari ON DELETE CASCADE untuk data pasien/keuangan/stok. Gunakan RESTRICT dan status/reversal.
8. **Sensitive data:** audit before/after harus redacted; TV hanya menerima projection queue yang disanitasi. Jangan masukkan patient PII ke audit diff, log, atau test fixtures kecuali sintetis.
9. **Runtime pool:** set timezone saat connection checkout, release connection pada semua jalur, batasi pool sesuai Vercel concurrency dan uji reconnect/idle.
10. **Privileges:** migrator dan runtime DB credentials harus dipisah. Runtime tidak boleh DROP/ALTER. Jika saat ini satu credential dipakai untuk health check, itu belum memenuhi least privilege untuk produksi.

## C. Keputusan pemilik — tidak boleh diputuskan oleh implementasi

Tetap menunggu persetujuan klinik:
- D01 unit obat dan apakah pecahan kuantitas diperbolehkan.
- D02/D03 pemetaan pasien-kunjungan dan invoice lama tanpa pasien/kunjungan.
- D04 data penjualan lama tanpa batch.
- D05 barang retur yang bisa dijual kembali vs karantina.
- D06 alokasi retur komponen paket.
- D07 aturan pengembalian biaya/jasa.
- D08 siapa yang boleh menyetujui biaya sendiri/tidak.
- D09 klasifikasi petty cash agar tidak dihitung dua kali.
- D10 pengakuan kredit supplier.
- D11 pembayaran pembelian parsial dan alokasi historis.
- D12 verifikator tutup shift.
- D13 metode dan otorisasi payout refund.
- D14 tanggal pengakuan transaksi non-tunai.
- D15 saldo awal stok dan HPP dengan bukti.
- D16 antrean A/B dan handoff PR13 (PR13 tetap tidak di-merge).
- D17 normalisasi timestamp legacy yang ambigu.
- D18 retensi/arsip data pasien.
- D19 retensi audit.
- D20 provider autentikasi dan asal Cloud Functions yang masih perlu diverifikasi.

## D. Compatibility spike TiDB — daftar bukti wajib

Tes dilakukan pada database preview aktual, bukan asumsi MySQL lokal:
- versi TiDB, sql_mode, timezone/session, charset dan collation;
- CREATE TABLE InnoDB, FK enforcement, ON DELETE RESTRICT dan index;
- unique nullable (lebih dari satu NULL), composite unique, FK type matching;
- transaksi commit/rollback dan atomicity;
- SELECT ... FOR UPDATE, update blocking, concurrent last-stock and duplicate-counter tests;
- DECIMAL(18,3), BIGINT boundaries dan round-trip driver;
- EXPLAIN/index selection;
- JSON read/write bila digunakan;
- deadlock/write-conflict behavior dan bounded retry;
- cleanup tabel uji terverifikasi.

Semua tes memakai nama tabel khusus compatibility test, fixture sintetis, dan cleanup di finally. Jika cleanup gagal, hentikan proses schema v1 sampai tabel uji diperiksa manual.

## E. Gerbang sebelum schema v1

1. Temuan A1–A10 dimasukkan ke schema proposal.
2. Compatibility spike aktual lulus atau perbedaan terdokumentasi dan desain disesuaikan.
3. Schema v1 memiliki DDL versioned dan migration checksum.
4. Tabel aplikasi hanya dibuat di preview; data uji sintetis saja.
5. Jalankan seed idempotent untuk master dummy, 2 kasir dummy, 1 shift, pasien sintetis, antrean, obat/batch, invoice, retur dan ledger.
6. Jalankan FK, unique, rollback, lock/concurrency dan reconciliation tests.
7. Jangan menyatakan aplikasi siap migrasi sebelum authorization, backup/restore, regression dan UI E2E tests lulus.



## F. Compatibility endpoint access control — 2026-11-15

A source review found that a public preview URL could otherwise allow any visitor to trigger synthetic DDL and row-lock tests against the preview database. The diagnostic endpoint has therefore been changed to require a separate `COMPATIBILITY_TEST_TOKEN` environment variable and a constant-time token comparison on POST. GET remains read-only and reveals no database credentials.

Before the compatibility endpoint is deployed:
1. Set a high-entropy random `COMPATIBILITY_TEST_TOKEN` in the isolated `assalam-mysql-preview` Preview environment only.
2. Do not reuse any database password or Firebase credential as this token.
3. Never put the token in source control, URL query parameters, screenshots, or chat.
4. Confirm the endpoint returns 503 when the token is not configured and 401 for an incorrect token; only a correct token may start the test.
5. After the test window, rotate/remove the token and verify synthetic test-table cleanup.

This is a source-level security improvement only. It has not yet been deployed or runtime-tested. It does not change the production project or database.


## G. Decision register cross-check against existing clinic instructions — 2026-11-15

This cross-check records already-stated operating preferences to avoid asking the clinic to repeat decisions. It does not silently convert incomplete preferences into a final accounting/legal policy.

| Decision | Existing instruction/evidence | What remains unresolved before DDL or workflow acceptance |
|---|---|---|
| D01 medicine unit/fraction | Existing app stock and batch flows use medicine units such as strip; quantities must reconcile exactly. | Canonical unit per medicine, whether fractional strip/tablet quantities are permitted, and rounding policy. |
| D02/D03 patient/encounter legacy | Patient and visit history must be preserved; never invent a patient/visit to satisfy a foreign key. | Exact treatment for historical invoices with missing or conflicting patient/encounter links. |
| D04 historical sales without batch | Stock/batch accuracy is a hard requirement; never fabricate a batch allocation. | Reconciliation evidence and quarantine approval for each legacy exception. |
| D05 returned medicine disposition | Return quantity and value must match what was charged; stock must not be inflated. | Who certifies unopened/resalable condition and when a returned item is quarantined. |
| D06 package component allocation | Return must support medicine and service components and prevent duplicate/over-return. | Approved proportional allocation/rounding method for package discount and refund. |
| D07 service/fee return | User explicitly requires return of medicine and service/fee where eligible; service return must not create stock movement. | Eligibility windows, partial service return rules and approval matrix. |
| D08 expense self-approval | No final policy found. | Thresholds and separation-of-duty rules. |
| D09 petty cash | Cash on hand must remain distinct from omzet and modal awal; no double-counting in reports. | Category mapping for advances, reimbursements and expense recognition. |
| D10 supplier credit | Supplier return/credit must be traceable and must not silently alter purchase history. | Exact accounting recognition event and evidence required for credit note acceptance. |
| D11 partial supplier payment | Support allocation-based accounting; do not infer historical payment allocation from a boolean paid flag. | Approval and reconciliation of legacy payment allocations. |
| D12 shift verifier | Shift closing and verification must be role-controlled and auditable. | Whether Admin, Pimpinan, or both may verify each shift type and exception. |
| D13 refund payout | Existing instruction requires approval before refund, separate payout recording, and clear “uang kembali” evidence; refund cannot be implied merely from approval. | Final authority and accepted payout methods/reference evidence. |
| D14 non-cash revenue date | Omzet, cash-in-hand and settlement are separate concepts. | Exact recognition timestamp for pending/failed/settled payment instruments. |
| D15 opening stock/HPP | Stock and HPP must reconcile; no invented opening balance. | Signed opening-stock evidence and valuation method. |
| D16 queue A/B and handoff | Existing instruction: display may switch between separate A/B views; cashier may select queue mode; PR13 remains unmerged. | Final role/override policy and full PR13 review before any adoption. |
| D17 legacy timestamps | Preserve original timestamp evidence; normalize only when unambiguous. | Per-source rules for malformed, local-time and missing offsets. |
| D18 patient archive/retention | User prefers “Batal Berobat” for cancelled/no-treatment visits rather than treating them as ordinary archive. | Retention duration, deletion/legal hold, and which records remain searchable. |
| D19 audit retention | Audit must be append-only and not truncated by a UI row limit. | Formal retention period and export/legal hold policy. |
| D20 authentication/Cloud Functions | Firebase Auth is the temporary identity provider candidate; master Pimpinan must remain protected. | Locate authoritative deployed Cloud Functions source, verify token claims and service account ownership, then approve long-term identity architecture. |

**Interpretation:** Existing preferences above can guide domain modelling and test cases, but any unresolved accounting, clinical retention, regulatory, or authorization detail remains a release blocker. No owner decision is treated as approved merely because a schema can technically represent it.

## H. Compatibility test coverage update — source review only

The preview compatibility endpoint now includes source-level checks for:
- explicit transaction rollback and commit;
- concurrent conditional last-stock decrement using two independent connections;
- row-lock blocking with `SELECT ... FOR UPDATE`;
- explicit session UTC timezone;
- FK enforcement, ON DELETE RESTRICT, composite unique behavior including multiple NULL values;
- DECIMAL(18,3), BIGINT above JavaScript's safe-integer boundary, EXPLAIN, and synthetic table cleanup;
- cleanup outcome surfaced in the error response, with `stopSchemaV1: true` when cleanup fails.

Node.js `node --check` passed for the latest endpoint source using an isolated Node 22 sandbox. Static inspection also confirms these test paths are present. **This is not a TiDB runtime test.** The endpoint remains undeployed/unexecuted; no database compatibility result is claimed. The suite still does not replace the application-level concurrency tests for queue counters, duplicate open shifts, return reservations, cancellation-vs-return, or duplicate refund payout.
