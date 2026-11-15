# DECISION & REQUIREMENT TRACEABILITY CLOSURE — PASS 10
Tanggal: 2026-11-15  
Branch: `migration/tidb-foundation`  
Status: **STATIC DESIGN CLOSURE — NOT DDL / NOT OWNER SIGN-OFF**

## 1. Tujuan dan batas

Pass 10 menghubungkan kebutuhan operasional yang telah dinyatakan, bukti sumber/dokumen, model data kandidat, invariant, serta bukti penerimaan yang masih diperlukan. Tujuannya menutup keputusan teknis yang dapat diselesaikan oleh engineering tanpa membebani pemilik dengan detail implementasi, sekaligus mempertahankan keputusan kebijakan yang memang belum boleh ditebak.

Tidak ada DDL, perubahan data TiDB, pembacaan atau perubahan Firebase/Auth, perubahan lima akun terlindungi, deployment, perubahan `main`, merge PR13, atau cleanup data pada pass ini.

Sumber utama: Master Blueprint; Schema Proposal dan Review; Pass 4 dictionary (56 tabel/566 kolom); Pass 5 null/default matrix; Pass 7 FK expansion (104 numbered rows / 116 literal tuple candidates); Pass 8 scope control; Pass 9 ownership-chain matrix; legacy field crosswalk and source audits.

## 2. Aturan keputusan

Setiap isu masuk tepat ke salah satu jalur:

- **CONFIRMED REQUIREMENT** — perilaku/ketentuan sudah dinyatakan eksplisit; implementasi wajib mempertahankannya.
- **ENGINEERING CLOSURE** — detail teknis yang dapat dipilih berdasarkan bukti sumber, konsistensi, dan desain paling sederhana; tidak perlu meminta pemilik memilih nama tabel, index, tipe FK atau strategi lock.
- **OWNER POLICY GATE** — menyangkut kebijakan klinik, akuntansi, klinis, otorisasi, atau retensi yang belum dinyatakan. Tidak boleh diputuskan diam-diam.
- **SOURCE VERIFICATION GATE** — harus dibuktikan dari kode/struktur sumber atau data sintetis sebelum diputuskan.
- **DEFERRED** — bukan kebutuhan rilis pertama; tidak menghalangi model inti kecuali bukti workflow membuktikan sebaliknya.

Tidak ada nilai NULL, DEFAULT, enum, relasi, atau data historis yang boleh ditebak hanya untuk membuat DDL berhasil.

## 3. Requirement-to-domain traceability

| Workflow yang harus dipertahankan | Domain/model kandidat | Invariant wajib | Bukti penerimaan sebelum rilis |
|---|---|---|---|
| Login dan hak akses Pimpinan/Admin/Kasir Pagi/Kasir Sore | users, user_emails, role_assignments | Role ditentukan server; UID internal stabil saat email berubah; lima akun owner-protected tidak boleh dihapus/didemote/ditimpa | Token valid/tidak valid; role escalation ditolak; email change verified; kelima identity mapping diverifikasi read-only |
| Registrasi pasien dan kunjungan | patients, patient_encounters | Kunjungan baru terkait pasien; cashier dan shift konsisten; data legacy orphan tidak dipalsukan | Create/cancel visit; orphan fixture dikarantina; mismatch patient/cashier/shift ditolak |
| Antrean A/B dan display | queue_counters, queue_tickets, cashier_queue_assignments, display_configs, queue_call_events | Nomor unik per tanggal/prefix; alokasi atomik; tampilan TV hanya projection aman; switching A/B sesuai instruksi | Dua kasir bersamaan; first-use counter race; A/B terpisah dan switching; display refresh lintas perangkat |
| Buka/tutup shift | cashier_shifts, active_shift_slots, shift_reconciliations | Maksimal satu shift aktif per kasir; slot menunjuk shift milik kasir yang sama; close/recovery atomik | Duplicate open ditolak; retry idempotent; close/reopen lifecycle; concurrent recovery |
| POS dan pembayaran | sales_invoices, sales_invoice_lines, invoice_payments, cash/bank ledgers | Harga/qty/diskon/total dihitung server; invoice, encounter, cashier, shift konsisten; pembayaran tidak menggandakan uang | Checkout positif/negatif; retry key sama; concurrency; rekonsiliasi invoice/payment/cash |
| Obat, batch, FEFO dan HPP | medicines, inventory_batches, inventory_movements, invoice_batch_allocations | Saldo per batch dan obat konsisten; alokasi sale menunjuk movement pengurangan yang tepat; tidak menciptakan batch historis | Last-stock race; FEFO; batch mismatch; ledger vs projection; HPP/stock reconciliation |
| Pembelian dan penerimaan supplier | suppliers, supplier_invoices, supplier_invoice_lines, inventory_batches | Supplier dan invoice konsisten; receipt/batch lineage terbukti; partial receipt hanya dimodelkan bila workflow sumber memerlukannya | Same-supplier mismatch ditolak; split/partial receipt source verification; receipt-to-batch reconciliation |
| Retur obat/jasa dan refund pasien | sales_returns, sales_return_lines, return_quota_subjects, refund_obligations, refund_payments | Tidak melebihi qty terjual; quota item/komponen tepat; Admin review dan Pimpinan final sesuai kebijakan; payout terpisah; stok hanya pulih setelah disposition valid | Duplicate/concurrent over-return; wrong component; service return no stock movement; refund payout exactly once |
| Pembatalan invoice/kunjungan | invoice_cancellation_requests/events, sales invoice and ledgers | Pembatalan tidak menghapus histori; reversal eksplisit; tidak bentrok dengan retur/refund | Cancel vs return race; repeat cancellation; receipt/status and financial reconciliation |
| Pengeluaran, kas kecil, kerugian | expenses, expense_events, petty_cash_entries, loss_events | Kas bukan omzet; modal awal shift bukan omzet; uang tidak dihitung dua kali | Cash reconciliation; category mapping; approval audit; report reconciliation |
| Retur supplier, kredit dan pembayaran | supplier_returns, supplier_return_lines, supplier_credit_notes, supplier_payments/allocations | Return/credit/payment milik supplier dan invoice yang sama; tidak melebihi saldo/kuota | Cross-supplier mismatch; concurrent allocation; credit recognition and payment reconciliation |
| Audit, ekspor dan backup | audit_events plus hanya job/storage tables yang terbukti perlu | Actor/time/action/source dapat ditelusuri; data sensitif direduksi; restore dapat diverifikasi | Tamper/permission tests; restore drill; export authorization; retention policy |

Traceability ini mengikat perilaku bisnis yang sudah disepakati. Nama tabel adalah kandidat model, bukan instruksi untuk menambah tabel pendukung tanpa bukti.

## 4. Keputusan yang sudah dapat ditutup tanpa owner follow-up

| Area | Engineering closure | Batas |
|---|---|---|
| Encounter baru | Wajib mempunyai patient dan shift/kasir yang konsisten untuk workflow kasir normal. | Record lama yang tidak memenuhi syarat dikarantina; jangan mengubahnya menjadi pasien/shift palsu. |
| Invoice ownership | Encounter menjadi sumber relasi kunjungan; jika invoice menyimpan patient_id sebagai snapshot/lookup, nilainya wajib cocok dengan patient encounter ketika keduanya ada. | Record legacy yang tidak punya encounter valid tidak dipaksakan masuk transaksi normal. |
| Partial-null tuple | Composite FK tidak dianggap menolak kombinasi NULL parsial. Tetapkan NOT NULL untuk alur baru atau validasi atomik di API; uji CHECK hanya sebagai lapisan tambahan bila kompatibel. | Nullability legacy tetap ditentukan profiling, bukan asumsi. |
| Batch movement | Movement dengan batch harus menunjuk batch milik medicine yang sama. Batchless hanya boleh untuk jenis movement yang dibuktikan sah (mis. opening/adjustment tertentu); jangan mengizinkan semua tipe. | Daftar tipe batchless perlu dipetakan dari sumber sebelum dibekukan. |
| Sale allocation | Allocation harus menunjuk movement pengurangan stok yang tepat dan konsisten pada medicine/batch/invoice line. | Jika sumber tidak menyimpan relasi event langsung, gunakan invariant command dan rekonsiliasi yang teruji; jangan membuat event registry generik tanpa kebutuhan. |
| Return quota | Gunakan `return_quota_subjects` yang sudah ada sebagai identitas subject; line jasa mengacu invoice line, komponen obat paket mengacu invoice component. Hindari registry kedua. | Pastikan target component memang milik invoice line terkait; transaksi quota harus atomik. |
| Supplier ownership | Return line, invoice line, batch, credit note dan payment allocation wajib berada pada invoice/supplier yang sama. | Split receipt ditentukan lewat source verification, bukan asumsi. |
| Money precision | Nilai rupiah disimpan integer signed; runtime Node memakai BigInt/string-safe handling, tidak mengonversi BIGINT arbitrer ke Number. | Batas maksimum nominal dan format API perlu diuji/didokumentasikan. |
| Historical identity | Legacy ID harus scoped dengan source system + collection + document ID; jangan mengasumsikan ID global unik lintas koleksi. | Registry mapping terpisah hanya dibuat bila crosswalk/idempotency membutuhkannya; bukan otomatis tabel generik. |
| FK acceptance | FK hanya siap bila tipe lengkap cocok, parent PK/UNIQUE ordered tuple tersedia, child index cocok, nullability/action jelas, ownership benar dan positive/negative tests lulus. | 116 kandidat tuple Pass 7 bukan 116 FK yang telah disetujui. |
| Transaction safety | Lock row domain yang sudah diketahui dan gunakan unique constraint/idempotency sebagai pagar; retry bounded untuk deadlock/write conflict. | Tidak mengandalkan gap lock atau urutan auto-increment. |
| Audit | Pertahankan audit append-only dan redaksi PII; event domain terpisah hanya untuk lifecycle yang memang perlu query/rekonstruksi mandiri. | Jangan membuat tabel event generik untuk setiap entitas. |

## 5. Owner policy gates yang masih nyata

Daftar berikut bukan pertanyaan implementasi. Ini keputusan kebijakan yang tidak ditemukan secara eksplisit atau belum cukup rinci pada instruksi yang ada.

| ID | Kebijakan | Yang sudah diketahui | Yang masih harus ditetapkan sebelum workflow terkait diaktifkan |
|---|---|---|---|
| D01 | Unit dan pecahan kuantitas obat | Stok harus akurat per satuan operasional seperti strip. | Unit kanonik per obat; apakah pecahan tablet/strip diperbolehkan; aturan pembulatan. |
| D05 | Disposisi obat retur | Retur tidak boleh menggelembungkan stok; nilai harus sesuai harga yang dibayar. | Siapa memeriksa kondisi layak jual dan kapan barang masuk karantina. |
| D06 | Alokasi diskon paket saat retur | Retur mendukung komponen obat maupun jasa dan tidak boleh over-return. | Formula proporsional dan pembulatan refund per komponen. |
| D07 | Kelayakan retur jasa/biaya | Pengembalian jasa/biaya harus didukung; tidak membuat movement stok. | Batas waktu, partial service return dan kondisi layanan yang memenuhi syarat. |
| D08 | Persetujuan pengeluaran sendiri | Expense memerlukan approval dan audit. | Ambang nominal dan aturan pemisahan pembuat/pemberi persetujuan. |
| D09 | Klasifikasi kas kecil | Kas terpisah dari omzet dan modal awal shift. | Kategori uang muka, reimbursement, dan kapan biaya diakui agar tidak double count. |
| D10 | Pengakuan kredit supplier | Kredit harus terkait retur dan tidak mengubah histori pembelian diam-diam. | Titik pengakuan akuntansi: saat permintaan, persetujuan, atau credit note diterima. |
| D11 | Alokasi pembayaran supplier historis | Pembayaran parsial harus dapat dialokasikan; boolean paid lama tidak boleh ditebak alokasinya. | Persetujuan rekonsiliasi alokasi historis yang tidak memiliki bukti rinci. |
| D12 | Verifikator tutup shift | Tutup shift role-controlled dan tercatat. | Apakah Admin, Pimpinan, atau keduanya dapat memverifikasi tiap jenis shift/pengecualian. |
| D13 | Payout refund | Persetujuan final Pimpinan dan payout terpisah; bukti “uang kembali” wajib. | Metode payout yang diterima dan bukti referensi minimum. |
| D14 | Pengakuan pendapatan non-tunai | Omzet, uang kas di tangan dan settlement harus terpisah. | Timestamp pengakuan untuk instrumen pending/gagal/settled. |
| D15 | Saldo awal stok/HPP | Tidak boleh menciptakan saldo awal atau HPP tanpa bukti. | Bukti saldo awal yang disahkan dan metode valuasi pembukaan. |
| D17 | Timestamp legacy ambigu | Nilai asli harus dipertahankan; normalisasi hanya jika jelas. | Aturan per sumber untuk local time, malformed timestamp dan offset yang hilang. |
| D18 | Retensi/arsip pasien | Kunjungan tanpa tindakan lebih tepat berstatus “Batal Berobat” daripada dihapus/diarsipkan sebagai kunjungan biasa. | Durasi retensi, legal hold dan cakupan pencarian historis. |
| D19 | Retensi audit | Audit tidak boleh dipotong hanya karena UI membatasi jumlah baris. | Masa retensi formal, ekspor dan legal hold. |

D02/D03 (pasien/kunjungan dan invoice legacy tanpa pasien/encounter) ditangani secara engineering dengan quarantine dan no-fabrication; pemilik hanya perlu menyetujui pengecualian data konkret bila kelak ada record yang harus dipulihkan. D04 (penjualan historis tanpa batch) juga quarantine/manual reconciliation; tidak boleh membuat batch palsu. D16 (queue A/B) memiliki arahan yang cukup: tampilan terpisah dengan switching dan kasir boleh memilih mode; adopsi PR13 tetap menunggu review terpisah.

## 6. Source verification gates — jangan minta owner menebak

1. **Unit obat dan fractional quantity:** periksa source master obat, input transaksi, stok batch, retur, pembelian dan perhitungan HPP. Laporkan unit nyata per obat dan semua jalur yang menerima pecahan.
2. **Split/partial supplier receipt:** periksa purchase UI, penyimpanan batch, edit receipt, import/seed, dan contoh fixture. Jika satu baris invoice memang dapat menghasilkan beberapa batch/delivery/expiry, relasi allocation line-to-batch dibutuhkan; jika tidak, jangan menambah tabel allocation.
3. **Batchless movements:** inventaris seluruh movement type dari source code dan test fixture. Setiap jenis harus diberi aturan batch wajib/opsional beserta alasan.
4. **Invoice patient snapshot:** periksa apakah patient_id pada invoice merupakan snapshot, lookup cache, atau relasi yang ditulis terpisah. Jangan menghapus kolom sebelum semantics dibuktikan.
5. **Queue lifecycle:** periksa reissue/reset nomor, first-use counter, assignment overlap dan PR13. Jangan membuat guard/event table sebelum algoritma minimal terbukti tidak aman.
6. **Authentication authority:** pulihkan sumber Cloud Functions/bootstrap dan verifikasi UID lima akun secara read-only sebelum desain cutover identity; jangan mengubah Firebase/Auth.
7. **Legacy ID dan timestamp:** buat profil berdasarkan source collection/path dan bentuk timestamp asli. Simpan raw source evidence/hash untuk setiap record yang dimigrasikan; ambiguous rows quarantine.
8. **Outbox provider field:** validasi terhadap source extraction. Jangan menjadikan raw integer itu enum/provider sebelum bukti ditemukan.

## 7. Scope freeze proposal: core vs conditional

### Core workflow model — lanjutkan perincian
Identity/roles, clinic settings, patient/encounter, queue, shifts, cash/bank, medicines/tariffs/packages, suppliers/purchases, inventory batches/movements, invoices/lines/payments, returns/quota/refund, cancellation, expenses/loss/petty cash, audit and idempotency.

Core berarti kebutuhan workflow, bukan berarti setiap definisi tabel/kolom sudah siap DDL. Semua tetap melewati exact FK/nullability/type/index and TiDB tests.

### Conditional — jangan masuk v1 tanpa bukti
- `active_email_claims` dan `active_role_slots`: dipertahankan hanya jika uniqueness satu email/role aktif tidak dapat ditegakkan secara aman dengan model inti dan transaksi TiDB yang diuji.
- `sales_return_events`: dipertahankan jika event history khusus retur diperlukan untuk lifecycle/query selain audit umum; jika audit_events cukup dan dapat direkonstruksi, jangan gandakan.
- `sales_return_quota_events`: belum ada definisi fisik lengkap; tambahkan hanya jika reserve/release/consume tidak bisa dibuktikan exactly-once dengan quota row version + transaksi + audit yang memadai.
- Queue prefix guard/event tables: hanya jika source/workload test membuktikan counter/assignment tidak dapat dijaga dengan row counter/assignment lock dan unique key sederhana.
- `supplier_invoice_line_batch_allocations`: hanya jika satu receipt line dapat menghasilkan beberapa batch/lot/delivery.
- `outbox_jobs`: hanya bila ada side effect asynchronous yang wajib dijamin setelah commit dan tidak dapat ditangani oleh integrasi sinkron yang ada.
- File/export/backup job tables: hanya untuk workflow aktif rilis pertama; selain itu deferred.
- `patient_handoffs`: tetap di luar v1 sampai kebutuhan PR13 dan source behavior disetujui.
- `migration_source_records`: gunakan hanya bila crosswalk membuktikan legacy_id per tabel tidak cukup dan perlu source-scoped idempotency mapping; jangan membuat generic registry untuk semua objek tanpa bukti.

## 8. Gate DDL dan urutan kerja berikutnya

DDL v1 tetap **BLOCKED**. Urutan yang diperbolehkan:

1. Lengkapi source verification gates §6 dengan bukti kode/fixture dan catat source path/hash.
2. Putuskan owner policy yang relevan untuk workflow yang akan masuk rilis pertama; kebijakan yang belum diputuskan boleh dikecualikan dari rilis pertama, bukan diberi default tebakan.
3. Bekukan source-to-column crosswalk dan exact physical dictionary. Koreksi anomali duplicate-looking `expiry_date` / raw `expiry date` pada supplier invoice line dan kolom `provider` sebelum freeze.
4. Hasilkan expanded FK validation matrix per tuple dari 116 candidate tuples, dengan type vector, nullability, parent unique ordered key, child index, action, ownership invariant dan positive/negative test ID.
5. Uji kompatibilitas TiDB di schema sandbox bernama unik: FK/composite FK, CHECK (bila digunakan), unique, NULL tuple behavior, transaction isolation/locking, concurrent quota/stock/queue/shift, deadlock retry, timezone, BIGINT handling dan pool reconnect.
6. Review schema v1 yang sudah minimal; buat DDL hanya setelah semua P0 ditutup atau secara eksplisit dikeluarkan dari scope rilis pertama.
7. Uji aplikasi melalui API dan E2E synthetic fixtures; jangan sentuh Firebase atau produksi sebelum cutover gate terpisah.

## 9. Kriteria lulus Pass 10

- Kebutuhan operasional utama mempunyai domain, invariant dan acceptance proof yang jelas.
- Keputusan engineering tidak dibebankan ke owner.
- Kebijakan yang belum jelas tetap ditandai owner gate, bukan dipaksakan menjadi default.
- Conditional tables tidak otomatis masuk v1.
- Tidak ada DDL atau runtime TiDB claim yang dibuat dari audit statis.
- Lima akun terlindungi, Firebase sebagai rollback, branch terisolasi dan larangan merge/deploy tetap berlaku.

**Hasil Pass 10:** traceability dan pemisahan keputusan disusun; ini memperjelas pekerjaan selanjutnya tetapi tidak menyatakan schema siap dibekukan. Tidak ada database, Firebase/Auth, akun, deployment, production, main branch atau PR13 yang diubah.
