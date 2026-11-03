# Migrasi Firebase Authentication Assalam

## Prinsip keselamatan
- Arsip `assalam-main-development.zip` adalah baseline hasil uji sebelumnya dan tidak diubah.
- Migrasi hanya menyentuh identitas login/profil `k_users` serta konfigurasi autentikasi.
- Koleksi pasien, transaksi, obat, batch, stok, pembelian, retur, shift, dan keuangan tidak dihapus oleh skrip bootstrap.
- Akun master dengan username tetap `praktekrose` dilindungi dari penghapusan, penonaktifan, dan penurunan role.
- Password tidak lagi disimpan di Firestore; pengelolaan akun dilakukan melalui Cloud Functions.

## Persiapan sebelum deployment
1. Pastikan email Pimpinan adalah alamat nyata yang dapat menerima email. Alamat contoh `@assalamklinik.id` tidak boleh dipakai sebelum domain/email tersebut benar-benar dimiliki dan dikonfigurasi.
2. Di Firebase Console untuk project `assalam-db`, aktifkan Authentication > Sign-in method > Email/Password.
3. Pastikan Firestore sudah memiliki backup/export yang dapat dipulihkan sebelum migrasi produksi.
4. Pasang Firebase CLI dan Node.js 20.
5. Jalankan `npm install` di folder `functions`.

## Bootstrap akun master
Lakukan dari komputer administrator tepercaya yang sudah memiliki Application Default Credentials untuk project `assalam-db`:

```bash
gcloud auth application-default login
```

Set `OWNER_EMAIL` ke email Pimpinan yang nyata dan `OWNER_PASSWORD` ke password baru yang kuat, lalu jalankan:

```bash
node scripts/bootstrap-owner.cjs
```

Skrip akan membuat/memperbarui akun Authentication Pimpinan, memasang custom claims, menghubungkan UID ke `k_users/praktekrose`, dan menghapus hanya field password teks biasa dari dokumen `k_users`. Skrip tidak menghapus koleksi operasional.

## Deploy rules dan Cloud Functions

```bash
firebase use assalam-db
firebase deploy --only firestore:rules,functions
```

Rules yang baru menolak akses anonim. Jangan deploy rules baru sebelum akun master berhasil dibuat dan bootstrap selesai, agar tidak mengunci akses Pimpinan.

## Dua akun Pimpinan yang direncanakan

Setelah akun master berhasil di-bootstrap dan login pertama berhasil, buat Pimpinan kedua dari menu **Pengguna** di aplikasi (jangan membuat akun ini sebelum master dapat login):

- Pimpinan utama: email `praktekrose@gmail.com`, username/ID tetap `praktekrose`.
- Pimpinan kedua: email `nursalim42@gmail.com`, username/ID tetap `pimpinan2`, role `pimpinan`.

Pada menu Pengguna, isi nama tampilan Pimpinan kedua sesuai nama yang akan digunakan, masukkan email tersebut, buat password sementara minimal 8 karakter langsung di perangkat administrator, lalu pilih role **Pimpinan / Dokter Penanggung Jawab**. Password tidak perlu dan jangan dikirim melalui chat. Pembuatan akun melalui Cloud Function akan membuat Firebase Authentication, custom claims `role=pimpinan`, serta profil `k_users/pimpinan2`; tidak menyentuh koleksi pasien, transaksi, stok, batch, atau keuangan.

Kedua akun memiliki UID Firebase berbeda dan hak akses Pimpinan. Mengubah email akun kedua di kemudian hari tidak mengubah UID atau username audit `pimpinan2`. Akun master `praktekrose` tetap dilindungi dari penghapusan, penonaktifan, dan penurunan role.

## Migrasi pengguna lama
- Dokumen pengguna lama tetap dipertahankan dengan username/ID yang sama.
- Pimpinan membuka menu Pengguna, mengisi username lama yang belum memiliki UID, email nyata milik pengguna, dan password sementara.
- Fungsi `createClinicUser` akan menghubungkan akun Authentication baru ke dokumen pengguna lama; tidak membuat duplikat ID.
- Setelah berhasil, email dapat diubah dari menu Edit. Firebase UID dan username/ID audit tetap stabil.
- Password sementara disampaikan secara aman kepada pengguna; pengguna kemudian dapat menggantinya. Jangan mengirim password melalui chat grup.

## Pengujian wajib sebelum produksi
1. Login Pimpinan dengan email/password dan verifikasi role.
2. Login akun admin dan kasir; pastikan hak akses berbeda sesuai role.
3. Ubah email satu akun uji, login kembali dengan email baru, dan pastikan UID serta riwayat transaksi tetap sama.
4. Nonaktifkan akun uji; pastikan login ditolak.
5. Uji reset password ke inbox nyata.
6. Uji dua perangkat untuk stok, batch, transaksi, dan perubahan profil.
7. Jalankan seluruh tes regresi yang sudah ada.

## Batasan yang diketahui
- Email akun kerja pada domain fiktif tidak dapat menerima tautan reset password. Gunakan email yang benar-benar dikuasai klinik atau siapkan domain dan mailbox terlebih dahulu.
- Live Firebase dan multi-device belum dinyatakan lulus sampai diuji terhadap project Firebase yang sebenarnya.
