# Audit Lifecycle Pasien, Antrean, Display TV, dan Audio
Tanggal: 2026-11-15
Baseline: `main` (read-only).
Sumber: `js/firebase-backend.js`, `display.html`, dan inventory UI `js/app.js`.

## 1. Registrasi pasien dan nomor antrean
- Backend `registerPatientWithQueueNumber()` hanya menerima sesi/profile aktif dengan role kasir atau pimpinan dan memerlukan koneksi Firestore.
- Tanggal antrean harus berbentuk YYYY-MM-DD.
- Backend membaca seluruh pasien pada tanggal tersebut dari server, mencari nomor A terbesar, lalu juga membandingkan cache lokal dan `state.seq`.
- Nomor yang ditetapkan kemudian dibuat di dalam Firestore transaction dengan ID pasien deterministik sebagai kandidat pengunci.
- Implementasi yang diperiksa mencari pola nomor A; pembagian prefix A/B yang ditambahkan di PR13 perlu ditelaah terpisah karena belum menjadi baseline main.
- Untuk MySQL, alokasi antrean harus dilakukan di transaksi server dengan counter per tanggal + prefix, unique constraint, dan retry konflik. Jangan memakai jumlah array/cache sebagai sequence.

## 2. Lifecycle pasien
Sistem memiliki pasien dan antrean yang statusnya berubah sepanjang proses: registrasi, menunggu, dipanggil, selesai transaksi/layanan, batal berobat, atau status nonaktif/terhapus. Checkout mewajibkan pasien hari ini, sudah dipanggil, belum selesai, dan tidak dibatalkan/dihapus.
- Model baru perlu memisahkan identitas pasien dari kunjungan/encounter harian dan antrean.
- Nomor antrean melekat pada kunjungan, bukan identitas pasien permanen.
- Panggilan ulang harus menjadi event tersendiri, bukan sekadar mengganti status; simpan siapa, kapan, nomor panggilan, dan tujuan layanan.
- Pembatalan kunjungan harus mempertahankan riwayat dan alasan, tidak menghapus identitas pasien.
- Detail transisi lifecycle dan seluruh hak peran masih perlu diekstrak lengkap sebelum schema final.

## 3. Sinkronisasi data lintas perangkat
- Firebase backend memasang listener per collection `k_<collection>`.
- Listener menggabungkan snapshot cloud dengan data lokal menggunakan Map berdasarkan ID.
- Konflik diselesaikan dengan membandingkan timestamp `_t`; item lokal/remote terbaru menang.
- Listener menghindari snapshot yang masih memiliki pending writes.
- Push menggunakan debounce sekitar 600 ms dan menjalankan `performPush(state)`.
### Risiko penting
- Last-write-wins pada satu objek besar dapat menghilangkan perubahan field independen atau perubahan yang terjadi hampir bersamaan.
- Jam perangkat klien dapat berbeda; `Date.now()` bukan urutan otoritatif server.
- Snapshot collection penuh dan merge lokal membuat konflik delete/tombstone dan dokumen yang hilang perlu diuji.
- MySQL harus memakai server timestamps, version column/optimistic concurrency, command-specific transactions, soft delete/tombstone, dan audit event. Sinkronisasi sebaiknya mengirim perubahan per command/event, bukan overwrite seluruh state.
- Kegagalan push dan reconnect perlu antrean outbox idempotent, retry terukur, dan indikator status yang jelas.

## 4. Display TV dan konfigurasi
- `display.html` membaca cache `klinik_data` dari localStorage, kemudian menggabungkan pengaturan cloud dan pasien cloud bila tersedia.
- Display memfilter pasien hari ini menurut zona waktu Asia/Jakarta dan mengurutkan dengan `registeredAt`, lalu jam sebagai fallback.
- Nama/alamat/logo, running text, video YouTube/fallback, pasien menunggu, dan panggilan aktif ditampilkan.
- Display adalah klien terpisah; database baru perlu read-only display endpoint/token terbatas agar layar TV tidak menerima hak tulis operasional atau profil pengguna.

## 5. Panggilan suara dan MP3
- Display menggunakan chime Web Audio API terpisah dari suara pengumuman.
- Suara pengumuman mencoba MP3 per klip; jika gagal atau tidak ada, fallback ke SpeechSynthesis bahasa Indonesia.
- Pengenal panggilan terakhir menggunakan gabungan ID pasien dan `_t` agar panggilan ulang dapat berbunyi tetapi snapshot duplikat tidak menggandakan pengumuman.
- Backend menyimpan MP3 sebagai base64 di dokumen `klinik_config`, membatasi tipe MP3 dan ukuran 600 KiB; metadata clip dilisten secara terpisah.
- Clip ID yang diterima dibatasi: notification, prefix, suffix, huruf, digit, counter umum, counter gigi.
### Rekomendasi
Pindahkan file audio ke object storage; SQL hanya menyimpan clip ID, object key, MIME, ukuran, checksum, versi, nama file, uploader, dan waktu. Pisahkan hak Admin/Pimpinan untuk mengelola audio dari hak display untuk membaca. Chime tetap dapat dikustomisasi terpisah dari rekaman suara.

## 6. Kebutuhan khusus antrean A/B
- Database perlu prefix/jenis antrean sebagai bagian unique key bersama tanggal dan sequence.
- Simpan mapping kasir → prefix sebagai konfigurasi server, bukan hardcode browser.
- Mode display A/B terpisah atau gabungan/switching harus menjadi preferensi display yang tersinkron; hak Kasir memilih mode tidak boleh memberinya hak mengubah antrean pasien.
- PR13 memuat perubahan A/B dan logout guard tetapi tetap belum di-merge; perlakukan sebagai perubahan opsional yang harus di-review dan dites tersendiri.
- Pengumuman nomor harus membaca digit satu per satu sesuai kebutuhan operasional; MP3 per digit dapat disusun, fallback tetap tersedia.

## 7. Entitas relasional kandidat (belum DDL)
- `patients`, `patient_encounters`, `queue_tickets`, `queue_calls`
- `queue_counters`, `cashier_queue_assignments`, `display_config`
- `queue_audio_assets` (metadata saja), object storage untuk bytes
- `device_sessions`, `sync_outbox`, `sync_cursors`, `audit_events`

## 8. Acceptance tests wajib
1. Dua perangkat mendaftarkan antrean bersamaan; nomor tidak boleh duplikat untuk tanggal/prefix.
2. Prefix A dan B berjalan independen dan urut sesuai kebijakan.
3. Pasien batal berobat tidak muncul pada daftar menunggu, tetapi histori tetap ada.
4. Pasien dipanggil ulang; TV mengumumkan tepat sekali per event panggilan.
5. Snapshot duplikat tidak mengulang suara; panggilan baru pasien yang sama tetap berbunyi.
6. Perangkat offline/reconnect tidak menimpa perubahan server yang lebih baru.
7. Dua kasir mengubah data berbeda secara bersamaan tanpa kehilangan field independen.
8. Display hanya bisa membaca data minimum; tidak dapat mengubah pasien, stok, nota atau pengaturan.
9. Audio MP3 invalid/terlalu besar ditolak; kegagalan playback menggunakan fallback; chime dan suara dapat diatur terpisah.
10. Tanggal operasional dan pergantian hari menggunakan Asia/Jakarta secara konsisten.

## Status dan batas
Audit statis, bukan uji runtime. Tidak ada perubahan kode produksi, Firebase write, data migration, atau schema DDL.
