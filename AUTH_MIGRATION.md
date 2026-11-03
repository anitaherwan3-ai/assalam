# Migrasi Firebase Authentication Assalam

## Tujuan dan perlindungan data
- Arsip baseline dan data operasional yang sudah diuji tidak dihapus.
- Bootstrap master hanya membaca/menulis `k_users/praktekrose` dan custom claims akun Authentication terkait.
- Skrip tidak membuat ulang akun jika email sudah ada, tidak mengganti password akun yang sudah ada, dan tidak menyentuh pasien, transaksi, obat, batch, stok, pembelian, retur, shift, maupun keuangan.
- Jika email sudah terikat ke username lain atau profil master terikat ke UID berbeda, proses berhenti tanpa memaksa perubahan.
- Akun master `praktekrose` dilindungi dari penghapusan, penonaktifan, dan penurunan role melalui Cloud Functions.

## Menghubungkan akun master yang SUDAH dibuat manual
1. Di Firebase Console > Authentication > Users, pastikan `praktekrose@gmail.com` sudah ada.
2. Di komputer administrator tepercaya, pasang Node.js 20 dan Firebase CLI.
3. Login ke Google Cloud/Firebase dengan akun yang memiliki hak Admin SDK pada project `assalam-db`:

```bash
gcloud auth application-default login
```

4. Dari folder proyek:

```bash
cd functions
npm install
cd ..
```

5. Jalankan bootstrap. **Jangan isi `OWNER_PASSWORD` untuk akun yang sudah ada** agar password yang baru Anda buat di Firebase Console tidak diubah.

Linux/macOS:

```bash
OWNER_EMAIL=praktekrose@gmail.com node scripts/bootstrap-owner.cjs
```

Windows PowerShell:

```powershell
$env:OWNER_EMAIL = 'praktekrose@gmail.com'
node scripts/bootstrap-owner.cjs
```

Skrip akan menggunakan UID akun yang sudah ada, memasang custom claims `role=pimpinan`, `username=praktekrose`, `clinic=assalam-db`, dan menghubungkannya ke `k_users/praktekrose`. Password akun existing tetap sama.

Jika akun belum ada, set `OWNER_PASSWORD` (minimal 8 karakter) untuk membuat akun baru. Jangan menaruh password di chat atau commit ke Git.

## Deploy setelah bootstrap berhasil
Jangan deploy rules sebelum bootstrap master selesai dan hasilnya diverifikasi. Setelah itu:

```bash
firebase use assalam-db
firebase deploy --only firestore:rules,functions
```

## Pimpinan kedua
Setelah Pimpinan utama berhasil login, buat Pimpinan kedua dari menu Pengguna:
- Username tetap: `pimpinan2`
- Email: `nursalim42@gmail.com`
- Role: `pimpinan`
- Password sementara dibuat langsung oleh administrator pada perangkatnya.

Kedua akun memiliki UID berbeda. Perubahan email di kemudian hari mempertahankan UID dan username audit.

## Pemeriksaan setelah bootstrap
1. Authentication > Users: email master tetap ada dan UID tidak berubah.
2. Authentication user details: custom claims memuat `role`, `username`, dan `clinic` yang benar.
3. Firestore `k_users/praktekrose`: field `uid` sama persis dengan UID Authentication, `role=pimpinan`, `active=true`.
4. Login aplikasi menggunakan email dan password yang dibuat sebelumnya.
5. Jalankan regresi lokal dan uji dua perangkat terhadap Firebase project nyata.

## Batasan
- Bootstrap ini memerlukan kredensial Admin SDK pada komputer administrator. Jangan pernah memasukkan service-account private key ke aplikasi browser atau mengirimkannya melalui chat.
- Sinkronisasi live dan multi-device belum dinyatakan lulus sampai dites pada Firebase project nyata.

## Aktivasi Pimpinan satu tombol (tanpa Admin SDK di komputer)
Versi ini menyediakan tombol **Aktivasi Akun Pimpinan** pada layar login. Tombol hanya menerima dua email yang di-allowlist di Cloud Function:
- `praktekrose@gmail.com` -> username `praktekrose`
- `nursalim42@gmail.com` -> username `pimpinan2`

Sebelum tombol dapat dipakai, administrator proyek perlu deploy Cloud Function sekali saja. Deploy hanya function aktivasi agar tidak mengubah koleksi data atau rules yang sedang dipakai:

```bash
firebase use assalam-db
firebase deploy --only functions:activateInitialPimpinan
```

Sesudah deployment:
1. Buka aplikasi Assalam dengan koneksi internet.
2. Isi email dan password akun yang sudah dibuat di Firebase Authentication.
3. Tekan **Aktivasi Akun Pimpinan** satu kali.
4. Function memverifikasi bahwa pengguna sudah login, email cocok dengan daftar yang diizinkan, klaim lama tidak bertentangan, dan dokumen profil tidak terikat ke UID lain.
5. Jika lolos, function memasang custom claims dan menghubungkan `k_users/{username}` dengan UID Authentication yang sama. Data operasional tidak disentuh.
6. Setelah aktivasi sukses, aplikasi langsung membuka dashboard. Jika gagal, pesan kesalahan ditampilkan dan proses tidak menghapus akun Authentication.

Aktivasi bersifat idempotent untuk UID yang sama. Jangan deploy `firestore.rules` atau seluruh Functions sebagai bagian dari langkah ini. Rules saat ini perlu ditinjau dan diuji terpisah sebelum dipasang.


## Aktivasi Pimpinan dari tablet (tanpa Bash/CLI)
Versi tablet-friendly menggunakan Firebase Authentication + Firestore Security Rules untuk bootstrap dua email yang diizinkan. Tidak perlu deploy Cloud Functions untuk aktivasi awal.

1. Buka Firebase Console pada project `assalam-db` lalu pilih Firestore Database > Rules.
2. Simpan salinan rules lama terlebih dahulu.
3. Ganti rules dengan isi file `firestore.rules` dari paket ini, lalu klik Publish. Rules ini tidak memberi akses tulis profil ke pengguna lain; dua email Pimpinan hanya dapat menghubungkan UID miliknya ke dokumen profil masing-masing (`k_users/praktekrose` atau `k_users/pimpinan2`).
4. Buka aplikasi versi ini. Pada layar login, masukkan email dan password Firebase yang sudah dibuat.
5. Tekan **Aktivasi Akun Pimpinan**. Aplikasi akan memverifikasi Firebase Authentication, memeriksa konflik UID, lalu menulis profil Pimpinan milik akun itu saja.
6. Ulangi untuk akun Pimpinan kedua.

Catatan: cara ini menggunakan email Firebase yang telah diautentikasi sebagai allowlist di Firestore Rules; tidak membuat Custom Claims. Fungsi administrasi akun yang memerlukan Admin SDK tetap disiapkan untuk tahap berikutnya. Jangan gunakan rules terbuka dengan tanggal kedaluwarsa. Jangan menghapus dokumen atau koleksi operasional. Jika dokumen profil telah memiliki UID berbeda, aktivasi akan berhenti.
