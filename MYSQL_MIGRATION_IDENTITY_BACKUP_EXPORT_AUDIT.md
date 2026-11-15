# Audit Identitas, Kewenangan, Backup, dan Ekspor
Tanggal: 2026-11-15
Baseline: `main` read-only. No production change.

## 1. Identitas dan autentikasi
- Browser login memakai Firebase Authentication email/password, lalu `verifyAuthProfile()` memvalidasi profil.
- Dua identitas Pimpinan ditetapkan melalui allowlist email: `praktekrose@gmail.com` dan `nursalim42@gmail.com`, dengan username audit terpisah.
- Staff provisioning default mengacu pada Admin `assalamadmin1@gmail.com`, Kasir `assalamkasir1@gmail.com`, Kasir2 `assalamkasir2@gmail.com`; role dan email diverifikasi sebelum profil ditulis.
- Profil staf harus aktif dan role valid. Pimpinan memiliki identitas tetap; dokumen AUTH_MIGRATION menjelaskan perlindungan akun master.
- Password reset menggunakan allowlist email tertentu.
- API TiDB wajib memverifikasi Firebase ID token di server (jika Firebase Auth dipertahankan), lalu mengambil profil/role dari database server. Tidak boleh menerima role, email, actor ID, atau cashier ID sebagai otoritas dari browser.
- Penggantian email staf di masa depan harus mempertahankan immutable user ID dan audit history; proses perlu sinkronisasi Firebase Auth + profil database secara terkontrol, bukan mengubah email key tanpa verifikasi.

## 2. Sinkronisasi role pada push
- Pimpinan dapat mendorong konfigurasi umum dan koleksi operasional.
- Admin hanya mendapat subset koleksi operasional dan field display tertentu.
- Kasir memiliki subset terbatas; transaksi kasir harus melalui command khusus `commitCashierTransaction`, bukan push nota umum.
- Retur diarahkan ke command khusus submit/approve/reject/pay.
- Ini mengonfirmasi bahwa migrasi tidak boleh menggunakan generic CRUD endpoint. Tiap operasi bisnis harus punya command dan pemeriksaan role/field di server.

## 3. Master data
Kandidat master:
- Obat: nama, satuan, stok agregat, harga jual, HPP, kategori/atribut.
- Batch: obat, nomor batch, ED, qty awal/sisa, asal pembelian.
- Tarif/jasa: nama, kategori/jenis, harga, status.
- Paket: nama, harga, komponen dan qty masing-masing.
- Supplier: identitas supplier dan data kontak.
- Pengaturan klinik: nama tetap Klinik Assalaam Palembang; alamat, kontak, logo, tema, batas approval, peringatan tempo/ED, preferensi display.
Master yang mempengaruhi nota harus memiliki snapshot pada transaksi; jangan mengubah histori saat master diedit.

## 4. Backup dan restore saat ini
- `ExportHelper.downloadBackup()` mengekspor seluruh `store.state` ke JSON.
- `restoreBackup()` memeriksa keberadaan `obat` dan `users`, lalu setelah konfirmasi menimpa seluruh state lokal.
- Backup saat ini berbasis browser/local state, bukan snapshot database authoritative dan tidak membuktikan data cloud lengkap.
- Restore dapat menimpa master users lokal dan data operasional lokal; belum ada pemeriksaan schema version, checksum, preview, dry-run, selective restore, atau perlindungan eksplisit master account di fungsi restore yang diperiksa.
### Rekomendasi
- Backup server-side konsisten dari database dengan version, timestamp, checksum, encryption, retention, dan akses Pimpinan.
- Restore memerlukan dry-run, validasi foreign keys/constraints, preview jumlah record, mapping ID, backup sebelum restore, transaction/batch plan, dan audit event.
- Akun master tidak boleh dihapus/ditimpa oleh restore data operasional.
- Uji restore ke lingkungan terisolasi dan rekonsiliasi jumlah record sebelum pernah menyentuh produksi.

## 5. Ekspor CSV/PDF
- Export helper menyediakan ekspor CSV dan PDF dari dataset yang dipilih.
- PDF memakai jsPDF + autoTable; jika pustaka tidak tersedia, UI meminta pengguna memakai CSV.
- Nama file menggunakan tanggal UTC pada kode yang diperiksa; tanggal operasional Palembang sebaiknya menggunakan Asia/Jakarta.
- Ekspor laporan harus memanggil service laporan yang sama dengan angka dashboard; jangan membuat rumus ekspor terpisah.
- Batasi ekspor data pasien berdasarkan role dan kebutuhan; catat actor, waktu, jenis data, rentang tanggal, dan jumlah baris. Hindari memasukkan data sensitif yang tidak diperlukan.

## 6. Rancangan keamanan backend
- Auth middleware memverifikasi token dan status sesi.
- Resolve user profile dari DB; role tidak pernah berasal dari request body.
- Enforce clinic scope, active flag, ownership, resource-level permission, field-level permission.
- Owner/master account IDs dilindungi dari delete, disable, demote, reset, dan restore.
- Perubahan email memerlukan re-authentication/verification dan proses dua tahap; audit email lama/baru.
- Endpoint export/backup khusus dengan rate limit, audit, dan output minimal.
- Secrets hanya pada Vercel environment; jangan kirim credential DB atau service account ke browser/repo.

## 7. Entitas tambahan kandidat (belum DDL)
- `users`, `user_emails`, `role_assignments`, `user_sessions`
- `clinic_settings`, `master_change_events`
- `backup_jobs`, `backup_artifacts`, `restore_jobs`
- `export_jobs`, `audit_events`

## 8. Pekerjaan audit tersisa
- Menyelesaikan field dictionary lintas semua collection (field, type, nullability, source, status verified/derived/legacy/unknown).
- Memetakan seluruh menu → command API → permission → tabel/ledger.
- Audit lengkap semua rules dan setiap backend command/call site yang belum dipetakan.
- Buat crosswalk dan acceptance suite; tandai keputusan bisnis yang harus dipilih.
- Setelah itu, minta review rancangan schema sebelum SQL DDL. User telah memberi instruksi untuk meneruskan seluruh audit tanpa perlu meminta izin setiap langkah; itu bukan persetujuan untuk menulis/merilis ke production atau memindahkan data nyata.

## Status
Source inspection only. No schema DDL, no production code modification, no Firebase writes, no real patient data migration, no runtime acceptance tests claimed.
