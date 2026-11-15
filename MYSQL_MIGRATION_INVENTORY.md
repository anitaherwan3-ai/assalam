# Inventarisasi Migrasi MySQL — Klinik Assalaam Palembang

Tanggal pemeriksaan: 15 November 2026  
Sumber inventaris: cabang `main` repository `anitaherwan3-ai/assalam`, dibaca saja.  
Status: dokumen inventaris awal-terperinci; **belum merupakan persetujuan skema database**.

## 1. Batas pemeriksaan dan keselamatan

- Pemeriksaan dilakukan pada `main` secara read-only.
- Tidak ada file aplikasi `main` yang diubah.
- Tidak ada perubahan pada Firebase produksi, data pasien, atau operasional.
- Tidak ada tabel MySQL/TiDB yang dibuat dan belum ada data operasional yang dipindahkan.
- Cabang kerja migrasi tetap `migration/tidb-foundation`; proyek Vercel terpisah `assalam-mysql-preview`.
- PR13 tetap tidak digabungkan.
- Data uji untuk tahap selanjutnya harus sintetis; jangan gunakan data pasien nyata sebelum aspek keamanan, backup, akses, dan persetujuan diselesaikan.

## 2. Struktur repository yang ditemukan

| Path | Peran |
|---|---|
| `index.html` | Shell aplikasi, modal login, modal form/konfirmasi/nota/etiket, pemuatan SDK dan modul |
| `css/style.css` | Styling dan layout responsif |
| `js/app.js` | Navigasi berbasis role, halaman, formulir, transaksi, laporan, display admin |
| `js/store.js` | State lokal, default data, operasi stok/batch, pembelian, retur lokal |
| `js/firebase-backend.js` | Firebase Auth, Firestore realtime listeners, transaksi server-side, role gates |
| `js/firebase-config.js` | Konfigurasi Firebase khusus Preview |
| `js/helpers.js` | Modal, tabel, format, broadcast display, WhatsApp |
| `js/export-helper.js` | CSV/PDF/backup JSON dan ekspor modul |
| `display.html` | Layar TV antrean, suara, chime, video/edukasi, jam, fullscreen |
| `firestore.rules` | Kebijakan akses dan validasi Firestore |
| `README.md`, `AUTH_MIGRATION.md` | Dokumentasi proyek dan migrasi autentikasi |
| `firebase.json`, `server.ps1`, `Jalankan_Klinik.bat` | Konfigurasi dan utilitas lokal |

## 3. Role dan menu yang terdaftar di kode

### Kasir
- Shift
- Pasien
- Transaksi
- Riwayat Transaksi
- Kas Kecil

### Admin
- Obat & Tarif
- Paket Pelayanan
- Pembelian
- Kedaluwarsa
- Biaya
- Stok Opname
- Kartu Stok
- Riwayat Transaksi
- Verifikasi
- Display TV
- Ekspor

### Pimpinan
- Dashboard
- Data Pasien
- Stok Obat
- Kartu Stok
- Laba Rugi
- Arus Kas
- Utang
- Approval
- Pengawasan Retur
- Paket Pelayanan
- Display TV
- Ekspor
- Log Aktivitas
- Pengguna
- Pengaturan

Catatan: pembatasan role juga diterapkan pada operasi backend dan Firestore Rules, bukan hanya penyembunyian menu. Hak akses final MySQL wajib dirancang ulang di server dan tidak boleh mempercayai role dari browser.

## 4. Inventaris data dan kandidat entitas relasional

Store mendaftarkan 16 koleksi utama berikut. Daftar kolom di bawah adalah atribut yang terlihat dalam pemakaian kode; ini bukan klaim bahwa setiap baris selalu memiliki semua kolom.

| Koleksi saat ini | Data/atribut yang terlihat | Hubungan / catatan migrasi |
|---|---|---|
| `users` | `u`, `id`, `email`, `uid`, `nama`, `role`, `active`, `hp`, timestamp | Akun/profil staf. Identitas login perlu dipisahkan dari profil dan role. Jangan pernah menghapus master Pimpinan. |
| `pasien` | `id`, `no`, `tgl`, `jam`, `nama`, `hp`, `layanan`, `kasir`, `sh`, `done`, `calling`, `status`, `deletedAt`, `deletedBy`, `batalBerobatPada`, `batalBerobatOleh`, `_t` | Satu pasien dapat memiliki kunjungan berulang. Nomor antrean dan kunjungan harus punya identitas/tanggal yang aman dari benturan. |
| `shift` | `id`, `kasir`, `tgl`, `jamBuka`, `jamTutup`, `modal`, status buka/tutup, `verif`, metadata verifikasi | Shift memiliki transaksi dan petty cash. Modal awal adalah saldo kas awal, bukan omzet. |
| `trx` | `id`, `no`, `tgl`, `jam`, `pid`, `nama`, `kasir`, `sh`, `items[]`, `total`, `bayar`, `kembali`, `metode`, status, timestamp | Header nota + baris nota. Item menyimpan snapshot harga/HPP, qty, jenis, dan detail komponen paket serta alokasi batch. Normalisasi ke header/detail diperlukan, tetapi snapshot historis harus dipertahankan. |
| `obat` | `id`, `nama`, `satuan`, `hpp`, `jual`, `stok`, `min`, `_t` | Master obat. Saldo stok harus konsisten dengan ledger/mutasi batch. |
| `batch` | `id`, `oid`, `no`, `ed`, `qty`, `sisa`, `beli`, `_t` | Batch obat terkait master obat dan pembelian. FEFO berdasarkan tanggal ED. |
| `tarif` | `id`, `nama`, `jenis`, `harga` | Master jasa/tindakan/pelayanan. |
| `paket` | `id`, `nama`, `deskripsi`, `harga`, `items[]` | Paket berisi komponen tarif dan/atau obat dengan qty dan snapshot harga. Perlu tabel paket + komponen paket. |
| `beli` | `id`, `tgl`, `supplier`, `faktur`, `oid`, `qty`, `total`, `tempo`, `lunas`, `tglBayar`, `qtyAwal`, `totalAwal`, `hargaBeliSatuan`, `batchId`, `_t` | Faktur pembelian, pemasok, utang, batch penerimaan, pelunasan dan retur pembelian. |
| `returBeli` | `id`, `tgl`, `beliId`, `supplier`, `faktur`, `namaObat`, `qty`, `nilai`, `alasan`, `_t` | Retur ke supplier; mengurangi stok/batch dan nilai faktur/utang sesuai status lunas. |
| `biaya` | `id`, `tgl`, kategori, keterangan, `jml`, `status`, pemohon/verifikator/timestamp | Beban operasional dengan approval berdasarkan batas nominal. |
| `loss` | `id`, `tgl`, `oid`/`obatId`, `qty`, `nilai`, `ket`/`keterangan` | Kerugian obat rusak/kedaluwarsa dan penyesuaian stok opname. |
| `petty` | `id`, `tgl`, `sh`, `jml`, keterangan/pemakai | Kas kecil terhubung ke shift; mempengaruhi kas di tangan dan perhitungan laba sesuai implementasi saat ini. |
| `returJual` | `id`, `trxId`, `itemIndex`, `quotaId`, `priorQty`, `qty`, `harga`, `total`, `hpp`, `jenis`, `oid`, `batchRestores[]`, `status`, alasan, pengaju, verifikator, `diverifikasiPada`, `pengembalian`, timestamp | Retur pasien. Workflow terpisah: pengajuan, pemeriksaan Admin, finalisasi Pimpinan sesuai backend, pembayaran refund. Harus mencegah qty kumulatif melebihi qty nota. |
| `batalTrx` | `id`/ `trxId`, alasan, status, pemohon, waktu, verifikator, alasan penolakan | Pengajuan pembatalan nota; persetujuan harus mengembalikan stok/batch dan mengubah status pasien/nota secara atomik. |
| `log` | `id`, `_t`, `tgl`, `jam`, `u`, `aksi`, `kol`, `rinci`, `_pendingSync` | Audit trail. Log staf append-only; perlu identitas aktor, waktu server, dan pembatasan perubahan/penghapusan. |

### Data khusus di luar 16 koleksi
- `klinik_config/settings`: konfigurasi klinik, tampilan, batas approval, preferensi, dan pengaturan antrean.
- `klinik_config/queueAudioClip_*`: metadata dan data audio MP3 untuk potongan suara antrean.
- `k_returKuota/{trxId}__{itemIndex}`: kuota retur kumulatif per baris nota, dengan `qtyTerpakai` dan identitas nota/item.
- Browser LocalStorage key `klinik_data`: cache/state offline saat ini. Bukan sumber kebenaran yang aman untuk sistem multi-user baru.

## 5. Alur operasional yang wajib dipertahankan

### A. Login dan identitas
- Firebase Authentication email/password.
- Profil staf tersimpan di `k_users`, dipetakan berdasarkan email, memiliki UID, role dan status aktif.
- Pimpinan melakukan provisioning akun staf; pengguna tidak boleh mengubah role sendiri.
- Backend baru harus memverifikasi token di server (atau menggunakan penyedia autentikasi yang disepakati), memetakan user aktif, dan memeriksa izin pada setiap endpoint.

### B. Pasien dan antrean
- Pendaftaran pasien menyimpan identitas kunjungan, layanan, kasir, shift, nomor, tanggal/jam, status, flag panggilan dan selesai.
- Pencarian pasien lama menggunakan nama/nomor HP.
- Edit nama/HP dibatasi sebelum pasien selesai.
- Ada status Batal Berobat dan pemulihan, berbeda dari arsip/hapus.
- Arsip pasien oleh Pimpinan tetap dapat dipulihkan.
- Panggilan TV memperbarui `calling` dan timestamp; satu panggilan aktif lain pada tanggal operasional dapat dinonaktifkan.
- **Temuan penting:** generator nomor di backend `main` yang diperiksa masih memindai nomor dengan pola `A-###` dan menghasilkan prefix A. Belum ditemukan implementasi yang meyakinkan untuk nomor B atau mode display A/B terpisah pada cabang ini. Kebutuhan A/B yang sudah disepakati harus masuk backlog migrasi dan diuji, tidak boleh dianggap sudah tercakup.

### C. Shift
- Buka shift dengan modal awal.
- Transaksi kasir terhubung ke shift.
- Tutup shift menghasilkan rekap tunai/non-tunai, kas kecil, saldo, dan ringkasan WhatsApp ke Pimpinan.
- Shift tutup menunggu verifikasi Admin/Pimpinan.
- Cetak slip dan kirim ulang ringkasan WhatsApp tersedia.
- Modal awal shift tidak boleh masuk omzet; kas di tangan dihitung terpisah.

### D. Transaksi/POS
- POS mendukung pencarian dan kategori, obat, tarif, paket, kuantitas, kalkulator tunai, pilihan metode pembayaran, bayar/kembalian.
- Metode yang terlihat di laporan: Tunai, QRIS, Transfer, Debit/Kredit.
- Paket dapat berisi jasa dan obat.
- Pembayaran memvalidasi stok, memilih batch FEFO, menyimpan nota, mengurangi stok dan batch, menandai pasien selesai, serta menyiapkan kuota retur dalam satu transaksi Firestore atomik.
- Nota mendukung cetak thermal, kirim WhatsApp bila diaktifkan, dan cetak etiket obat.
- Snapshot harga/HPP/baris harus immutable setelah nota dibuat, selain metadata sinkronisasi atau status pembatalan yang sah.

### E. Inventori dan pembelian
- Master obat, tarif, paket.
- Pembelian dengan supplier, nomor faktur, qty, total, jatuh tempo, status lunas, batchNo dan ED.
- HPP bergerak rata-rata tertimbang pada pembelian.
- Batch FEFO dipakai saat penjualan.
- Menu kedaluwarsa, pembuangan obat expired, stok opname/kerugian, kartu stok, ekspor kartu stok.
- Retur pembelian ke supplier harus mengurangi batch faktur yang tepat, stok obat, dan saldo faktur/utang; faktur lunas mempertahankan historinya.
- Ledger mutasi stok permanen direkomendasikan sebagai sumber audit, bukan hanya menghitung ulang dari array transaksi.

### F. Retur pasien
- Pengajuan mengacu pada nota asli dan indeks item.
- Obat/jasa dapat diretur; paket mengembalikan komponen obat berdasarkan batch deduction asli.
- Nominal dihitung server-side dari baris nota asli dan diskon nota dialokasikan proporsional dengan largest remainder.
- Kuota kumulatif per item mencegah retur melebihi jumlah yang dibeli.
- Pengajuan yang belum ditolak menahan retur/pembatalan yang bertabrakan.
- Backend mempunyai tahapan Admin dan Pimpinan (status menunggu, menunggu_pimpinan, disetujui/ditolak); stok baru dipulihkan ketika finalisasi yang sah dilakukan.
- Pembayaran refund dicatat terpisah (Tunai/Transfer); referensi wajib untuk transfer; pembayaran hanya satu kali.
- Refund tunai mempengaruhi kas tunai; laporan omzet menggunakan tanggal approval, arus kas menggunakan tanggal pembayaran aktual.
- Nota/riwayat menampilkan status dan nominal retur/pembatalan.
- Perlu uji khusus retur jasa, item obat, paket campuran, retur sebagian berulang, retur ditolak, dan refund.

### G. Pembatalan nota
- Kasir mengajukan pembatalan dengan alasan.
- Admin/Pimpinan memutuskan.
- Persetujuan membatalkan nota, mengembalikan stok dan batch asli, dan memperbarui status pasien sesuai aturan.
- Tidak boleh terjadi bersamaan dengan retur aktif.
- Harus satu transaksi database yang atomic dan idempotent.

### H. Keuangan dan laporan
- Dashboard: transaksi bruto, retur, omzet bersih, nota, rata-rata nota, laba bersih operasional, peringatan stok/ED/utang/approval.
- Laba rugi: pendapatan setelah retur, HPP obat, kerugian obat, biaya operasional, petty cash, laba bersih operasional.
- Arus kas: transaksi Tunai/non-tunai, pembayaran pembelian, petty cash, modal shift, refund dan saldo.
- Utang: faktur belum lunas dan jatuh tempo.
- Filter periode, metode pembayaran, kasir.
- Omzet bersih = nota aktif setelah diskon (total nota sudah neto) dikurangi retur disetujui. Modal awal shift tidak dihitung sebagai omzet.
- HPP retur obat dikurangi dari HPP penjualan; retur jasa tidak mengembalikan stok.
- Refund yang dibayar dan refund yang masih menunggu harus dipisahkan.

### I. Pengguna, konfigurasi, audit
- Pimpinan dapat provision/edit/nonaktifkan staf melalui Firebase Auth + profil.
- Nama klinik dikunci: Klinik Assalaam Palembang.
- Alamat, telepon, logo, footer nota, WA owner, tema, warna, ukuran font, jumlah baris, batas approval, peringatan ED/tempo dan fitur WhatsApp dapat diatur.
- Backup dan restore JSON tersedia.
- Audit log menyimpan aktor, waktu, aksi, kategori dan rincian.
- Untuk sistem baru, backup/restore harus punya kontrol akses, validasi format, audit, dan proteksi terhadap overwrite yang tidak disengaja.

### J. Display TV
- Display terpisah dari aplikasi kasir.
- Panggilan pasien, nomor antrean, poli/konter, jam dan tanggal.
- Chime dua nada terpisah dari rekaman suara.
- Potongan MP3 yang dapat dikustomisasi: notification, prefix, suffix, letter A-Z, digit 0-9, counter umum/gigi; fallback Text-to-Speech Indonesia.
- Video YouTube, video lokal, fallback tips kesehatan, running text, fullscreen.
- Perubahan konfigurasi/klip disinkronkan dari cloud.
- Kebutuhan lanjutan yang harus dimasukkan: pilihan mode antrean A/B (terpisah dan switching) dan izin Kasir untuk memilih tampilan; nomor diumumkan per digit (contoh A-001: “A, kosong, kosong, satu”). MP3 tetap pekerjaan tertunda yang perlu diuji terpisah.

## 6. Matriks akses awal (harus diverifikasi ulang terhadap semua backend methods)

| Area | Kasir | Admin | Pimpinan |
|---|---|---|---|
| Pasien | daftar/daftar baru, edit terbatas, panggil, batal berobat | baca dan koreksi status terbatas | baca, arsip/pulihkan, pengawasan |
| Shift | buka/tutup shift sendiri | verifikasi | verifikasi/pengawasan |
| Transaksi | buat nota dalam shift aktif | baca riwayat | baca/pengawasan |
| Master obat/tarif/paket | baca untuk POS | kelola | kelola/pengawasan |
| Pembelian/batch/stok opname | tidak ada menu | kelola | pengawasan |
| Retur jual | ajukan | verifikasi awal | finalisasi, tolak sesuai tahap, catat refund |
| Pembatalan nota | ajukan | putuskan | putuskan |
| Biaya | tidak ada menu biaya | kelola/pengajuan | approval sesuai batas |
| Kas kecil | catat shift | tidak ada menu | laporan/pengawasan |
| Pengguna/pengaturan | tidak | sebagian pengaturan display | kelola |
| Log | tidak | baca | baca/kelola sesuai aturan |

Tabel ini ringkasan kerja, bukan spesifikasi izin final. Firestore Rules saat ini memuat aturan per-field yang lebih rinci, terutama untuk `k_pasien`, `k_trx`, `k_shift`, `k_petty`, `k_obat`, `k_batch`, `k_returKuota`, `k_returJual`, `k_batalTrx`, `k_users`, `k_log` dan `klinik_config`. Setiap aturan harus dipetakan ke kebijakan server MySQL.

## 7. Risiko teknis yang tidak boleh hilang saat migrasi

1. **Offline/local state:** LocalStorage sekarang menjadi cache yang dapat diedit browser. Sistem baru perlu strategi cache yang jelas, tetapi server harus sumber kebenaran.
2. **Atomicity:** pembayaran, alokasi stok/batch, penyelesaian pasien, kuota retur, pembatalan dan finalisasi retur harus berada dalam transaksi SQL.
3. **Concurrency:** dua kasir/perangkat dapat menjual stok atau mendaftar nomor antrean bersamaan. Gunakan row locking/conditional updates dan unique constraints; uji race conditions.
4. **Idempotency:** request pembayaran, retur, pembatalan dan refund yang terkirim ulang tidak boleh menggandakan efek.
5. **Stock ledger:** semua masuk/keluar/retur/expired/opname harus tercatat dengan referensi sumber, actor, waktu, qty dan saldo yang dapat direkonsiliasi.
6. **Timestamp:** `_t` dari browser tidak boleh menjadi satu-satunya penentu urutan. Gunakan waktu server dan versioning/optimistic concurrency.
7. **Financial snapshots:** harga jual/HPP/diskon pada nota lama tidak boleh berubah ketika master harga diperbarui.
8. **Retur diskon:** pertahankan algoritma proporsional largest remainder agar total refund per item tepat dan jumlah keseluruhan tidak melebihi nota.
9. **Timezone:** tanggal operasional klinik adalah Asia/Jakarta. Simpan timestamp UTC/server dan tanggal bisnis WIB secara eksplisit.
10. **Sensitive data:** data pasien adalah data kesehatan/pribadi. Perlu minimisasi akses, enkripsi transport/storage, backup terenkripsi, audit akses, retensi dan pemulihan.
11. **Large media:** MP3/base64 dan logo saat ini disimpan di dokumen konfigurasi. Pertimbangkan object storage terpisah, bukan kolom SQL besar.
12. **Auth:** jangan menyimpan password aplikasi di database sendiri. Verifikasi token/session server-side; role/active diperiksa ulang di server.
13. **Schema migration:** gunakan migration versioning, constraints, foreign keys, indexes, seed terpisah dari data operasional.
14. **Backup/restore:** uji restore ke database baru sebelum cutover.

## 8. Kesenjangan dan hal yang belum dapat dinyatakan lulus

- Nomor antrean A/B dan pilihan display A/B belum terbukti lengkap pada `main`; kode generator yang diperiksa masih A.
- Tidak ada uji runtime/regresi yang dijalankan dalam inventarisasi read-only ini. Pemeriksaan kode bukan bukti bahwa semua fitur berjalan.
- Seluruh field aktual data historis belum dapat dipastikan hanya dari kode; perlu skema contoh yang sudah disanitasi atau inventaris koleksi tanpa data pribadi.
- Beberapa aturan izin kompleks berada di Firestore Rules; pemetaan per operasi/per-field harus dituntaskan sebelum API baru.
- Riwayat fitur dari PR yang belum digabung tidak otomatis ada pada `main`; PR13 tetap referensi terpisah dan tidak digabungkan.
- Butuh pemeriksaan lanjutan untuk detail semua cabang fungsi UI, seluruh payload transaksi, serta kompatibilitas ekspor/backup.

## 9. Rancangan arsitektur yang disarankan untuk dibahas (belum diimplementasikan)

- Vercel API sebagai backend; TiDB Cloud `assalam_db` sebagai sumber kebenaran data operasional.
- Auth sementara dapat tetap memakai Firebase Authentication jika token diverifikasi server-side, sehingga migrasi database tidak sekaligus memaksa migrasi identitas. Keputusan final setelah audit endpoint dan threat model.
- Kelompok tabel kandidat: `users`, `roles/permissions`, `patients`, `visits/queues`, `shifts`, `transactions`, `transaction_items`, `transaction_item_components`, `medicines`, `medicine_batches`, `stock_movements`, `tariffs`, `packages`, `package_items`, `suppliers`, `purchases`, `purchase_items`, `purchase_returns`, `sales_returns`, `return_items`, `cancellation_requests`, `expenses`, `petty_cash_entries`, `stock_losses`, `approvals`, `refund_payments`, `audit_logs`, `clinic_settings`, `queue_settings`.
- Simpan nota dan komponen item sebagai snapshot historis; normalisasi detail untuk relasi dan laporan.
- Simpan audio/video asset di storage, sedangkan SQL menyimpan metadata dan object key.
- Gunakan transaction boundaries dan idempotency keys di API untuk semua operasi finansial/inventori.
- Jalankan shadow-read dan pengujian data sintetis dahulu; cutover hanya setelah rekonsiliasi dan persetujuan eksplisit.

## 10. Checklist sebelum skema database disetujui

- [ ] Cocokkan inventaris dengan pemilik klinik: tidak ada modul yang tertinggal.
- [ ] Lengkapi definisi nomor antrean A/B dan alur switching TV.
- [ ] Selesaikan matriks izin per operasi untuk ketiga role.
- [ ] Definisikan model kunjungan pasien vs master pasien.
- [ ] Definisikan transaksi dan komponen paket historis.
- [ ] Definisikan ledger stok dan rekonsiliasi stok/batch.
- [ ] Definisikan workflow retur, kuota, approval, refund dan pembatalan.
- [ ] Definisikan perhitungan laporan dan tanggal pembukuan.
- [ ] Definisikan audit, backup, restore, retensi dan keamanan data.
- [ ] Jalankan test plan otomatis/manual pada data sintetis.
- [ ] Dapatkan persetujuan eksplisit sebelum membuat schema final atau migrasi data.

---
Dokumen ini sengaja mencatat ketidakpastian sebagai gap, bukan menebak. Perubahan aplikasi dan pembuatan schema menunggu validasi inventaris.
