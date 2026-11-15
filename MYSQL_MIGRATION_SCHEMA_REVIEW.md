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

