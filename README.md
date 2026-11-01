# Sistem Manajemen & Keuangan Klinik (SI-Klinik)

Aplikasi manajemen operasional dan keuangan klinik lengkap berbasis web modern yang ringan, cepat, dan aman. Aplikasi ini berjalan langsung di browser (*client-first*) dan dapat dihubungkan ke backend cloud **Google Firebase Firestore (100% Gratis)** untuk sinkronisasi *multi-device* (kasir, apoteker, dan pimpinan) secara *real-time*.

---

## 🚀 Fitur Unggulan

1. **Layar Display TV Antrean (Dual-Screen HDMI):**
   - Layar khusus TV ruang tunggu (`display.html`) yang terpisah dari monitor kerja petugas.
   - Panggilan antrean otomatis: Bel ding-dong + Suara Text-to-Speech Bahasa Indonesia (*"Nomor antrean A-0-1-2 silakan menuju Poli Umum"*).
   - Sinkronisasi instan *real-time* via `BroadcastChannel` (bekerja tanpa internet).
   - Running text pesan pengumuman/edukasi klinik yang dapat disesuaikan.

2. **Shift Kasir & Tutup Kasir Otomatis ke WA Owner:**
   - Pencatatan modal awal uang laci kasir sebelum transaksi dimulai.
   - Perhitungan uang sistem otomatis (Modal + Penjualan Tunai - Kas Kecil).
   - Perbandingan uang fisik laci vs sistem dengan pencatatan status selisih kas (*Balance*, *Lebih*, atau *Kurang*).
   - **📲 Rekap Tutup Shift Otomatis ke WhatsApp Owner:** Setiap kasir menutup shift, sistem secara otomatis mengirimkan laporan rekap shift lengkap (modal, omset tunai & non-tunai, pengeluaran kas kecil, uang fisik, selisih kas, dan rincian layanan) langsung ke nomor WhatsApp Owner yang diatur pada akun Pimpinan.
   - Verifikasi serah terima setoran oleh Admin dengan tombol kirim ulang ke WA Owner.

3. **Paket Pelayanan (Bundling Layanan Medis & Obat):**
   - Pembuatan paket layanan bundling yang menggabungkan beberapa jasa medis (konsultasi dokter, tindakan jahit, cek lab) dan obat/resep sekaligus dengan satu tarif paket hemat.
   - Tampil di Kasir POS sebagai menu cepat (*Touch POS*) atau pilihan dropdown dengan badge khusus 🎁.
   - **Pemotongan Stok FEFO Otomatis:** Saat paket dibayar di kasir, seluruh obat di dalam paket otomatis terpotong dari stok fisik dan batch obat dengan tanggal kedaluwarsa terdekat (FEFO).

4. **Cetak Label & Etiket Obat Farmasi:**
   - Cetak label etiket obat pasien langsung dari kasir POS, modal nota struk, maupun menu Riwayat Transaksi.
   - **Etiket Putih:** Khusus Obat Dalam (diminum/oral) dengan informasi dosis/signa, waktu konsumsi, dan instruksi.
   - **Etiket Biru:** Khusus Obat Luar (salep, tetes mata/telinga, obat kumur) dengan peringatan tegas *"OBAT LUAR - TIDAK BOLEH DITELAN"*.
   - **Template Dosis Cepat:** 1 klik untuk dosis populer (*3x1 Sesudah Makan, 3x1 Habiskan, 2x1, 1x1 Malam, Oles Tipis, Tetes 3x*).
   - Format cetak stiker/label thermal standar roll (*page-break* per label).

5. **Antrean & Registrasi Pasien:**
   - Nomor antrean otomatis harian (A001, A002, dst.).
   - Tombol **"📢 Panggil ke TV"** untuk memanggil pasien langsung ke layar ruang tunggu.
   - Pelacakan status periksa & pembayaran pasien.

6. **Kasir POS & Struk Digital WhatsApp:**
   - Penambahan jasa konsultasi, tindakan medis, paket layanan, dan resep obat.
   - **Tombol Cepat Pecahan Uang (Cash Presets):** 1 klik tombol `Uang Pas`, `20.000`, `50.000`, `100.000`, `200.000`, `500.000`.
   - **Pintasan Keyboard (Shortcuts):** `F2` (Cari Obat/Paket), `F4` (Bayar Tunai), `Esc` (Tutup Popup).
   - **Kirim Struk via WhatsApp Pasien (Paperless):** Terhubung langsung ke WhatsApp pasien (bisa diaktifkan/dinonaktifkan oleh Pimpinan di Pengaturan).
   - **Cetak Label Obat Terintegrasi:** Tombol langsung di popup struk pembayaran.
   - Cetak struk/nota thermal ukuran 58mm/80mm atau printer biasa.

7. **Farmasi, Logistik & Fitur Retur:**
   - Pembelian faktur supplier dengan **HPP Rata-Rata Tertimbang (Weighted Moving Average)**.
   - Pencatatan nomor batch, tanggal kedaluwarsa (ED), dan jatuh tempo utang.
   - **Retur Penjualan Pasien:** Mengembalikan obat yang salah beli, stok & batch pulih otomatis.
   - **Retur Pembelian Supplier:** Pengembalian obat rusak/mendekati ED ke PBF dengan penyesuaian tagihan.

8. **Laporan Keuangan & Grafik Visual Interaktif:**
   - **Grafik Interaktif (Chart.js):** Tren omset harian, porsi metode pembayaran (QRIS vs Tunai), dan ringkasan finansial visual.
   - **Laporan Laba Rugi Komprehensif:** Pemisahan pendapatan jasa, tindakan, paket pelayanan, penjualan obat, HPP, kerugian, diskon, dan beban operasional.
   - **Laporan Arus Kas:** Pemantauan arus kas masuk (tunai & non-tunai) vs arus kas keluar.
   - **Utang Supplier:** Jadwal jatuh tempo faktur PBF dengan hitungan sisa hari.

9. **Audit & Ekspor Data:**
   - Log aktivitas pengguna (audit trail) untuk mencegah manipulasi.
   - **Ekspor CSV (Excel):** Format UTF-8 BOM untuk Microsoft Excel termasuk Master Paket Pelayanan.
   - **Ekspor Dokumen PDF:** Cetak laporan rapi via jsPDF + autoTable.
   - Cadangan & Pemulihan data lengkap (JSON).

---

## 🔑 Akun Uji Coba

Buka file `index.html` pada browser Anda dan gunakan salah satu akun berikut:

| Peran (Role) | Username | Password | Hak Akses Utama |
| :--- | :--- | :--- | :--- |
| **Kasir** | `kasir` | `kasir123` | Buka/Tutup Shift, Antrean Pasien, Transaksi POS, Cetak Struk, Kas Kecil |
| **Admin** | `admin` | `admin123` | Master Obat & Tarif, Pembelian Supplier, Kedaluwarsa, Biaya, Stok Opname, Verifikasi Setoran, Ekspor |
| **Pimpinan** | `pimpinan` | `pimpinan123` | Dashboard KPI, Laba Rugi, Arus Kas, Utang, Approval Biaya, Manajemen Pengguna, Pengaturan & Cloud |

---

## ☁️ Cara Menghubungkan Backend Cloud Firebase (100% Gratis)

Aplikasi ini sudah siap pakai secara lokal (tersimpan di browser). Jika ingin digunakan di beberapa komputer/gadget sekaligus secara bersamaan:

1. Buka [Google Firebase Console](https://console.firebase.google.com/) dan login dengan akun Google Anda.
2. Klik **Add project** (buat project baru, misal: `klinik-sehat-demo`).
3. Masuk ke menu **Build** > **Firestore Database**, klik **Create database** (pilih lokasi terdekat seperti `asia-southeast2 / Jakarta`, pilih **Start in test mode**).
4. Masuk ke **Project Settings** (ikon gerigi di kiri atas), pada bagian *Your apps*, klik ikon Web `</>`.
5. Salin objek konfigurasinya:
   ```javascript
   apiKey: "AIzaSy...",
   authDomain: "klinik-xxxx.firebaseapp.com",
   projectId: "klinik-xxxx",
   appId: "1:xxxx:web:xxxx"
   ```
6. Buka aplikasi klinik, login sebagai **Pimpinan**, masuk ke menu **Pengaturan** > **Sinkronisasi Cloud (Firebase)**, tempelkan nilai tersebut lalu klik **Simpan & Hubungkan**.
7. Status di header akan berubah menjadi **🟢 Cloud: Firebase Tersambung**. Seluruh komputer kasir, apotek, dan pimpinan sekarang tersinkronisasi otomatis!

---

## 📂 Struktur Berkas

```
klinik-keuangan/
├── index.html              # Antarmuka utama dan portal staf (kasir/admin/pimpinan)
├── display.html            # Layar display antrean khusus TV ruang tunggu (HDMI)
├── README.md               # Dokumentasi dan panduan penggunaan
├── css/
│   └── style.css           # Desain modern, responsif, dark mode & CSS print thermal
└── js/
    ├── helpers.js          # Sanitasi XSS, format Rupiah, tabel dinamis, sistem modal
    ├── store.js            # State store, HPP moving average, FEFO batch, audit log
    ├── firebase-backend.js # Konektor Firestore free tier dengan fallback local-first
    ├── export-helper.js    # Ekspor CSV Excel (\uFEFF), PDF (jsPDF), dan JSON backup
    └── app.js              # Alur kerja bisnis, navigasi role, kasir POS & kalkulator
```
