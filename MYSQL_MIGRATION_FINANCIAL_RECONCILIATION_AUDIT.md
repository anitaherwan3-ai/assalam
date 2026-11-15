# Audit Rekonsiliasi Omzet, Laba, Kas, Retur, dan Laporan
Tanggal pemeriksaan: 2026-11-15
Baseline: `main` (read-only), terutama `js/app.js`.
Sifat: audit statis kode sumber, bukan hasil uji runtime.

## 1. Rumus yang saat ini digunakan
Fungsi utama: `calculateFinancials()`.

- `grossRevenue`: jumlah `trx.total` dari transaksi aktif sesuai filter.
- `returnValue`: jumlah retur berstatus `disetujui` (atau status kosong untuk kompatibilitas lama), dengan nota asal yang tidak dibatalkan.
- `rev = grossRevenue - returnValue`: omzet bersih setelah retur.
- `hpp`: jumlah HPP baris Obat/Paket dikalikan qty, dikurangi HPP retur untuk kategori Obat/Paket.
- `loss`: jumlah nilai kerugian stok dalam rentang tanggal.
- `op`: biaya berstatus approved dalam rentang tanggal.
- `pc`: jumlah kas kecil dalam rentang tanggal.
- `laba = rev - hpp - loss - op - pc`.
- `totalModalAwalShift`: jumlah modal awal shift dalam rentang tanggal.
- `totalKasDiTangan = modal awal + transaksi tunai - retur tunai yang sudah dibayar - kas kecil`.

Modal awal shift dipisahkan dari omzet. Ini adalah aturan penting yang wajib dipertahankan.

## 2. Tanggal pengakuan retur
Kode memisahkan:
- Pengurang pendapatan: tanggal persetujuan retur (`diverifikasiPada`, fallback `tgl`).
- Arus kas keluar: tanggal uang benar-benar dibayar (`pengembalian.dibayarPada`).
- Retur yang sudah disetujui tetapi refund belum dibayar tetap menjadi kewajiban pengembalian (`refundPending`).

Ini pemisahan konsep yang benar untuk dipertahankan. Namun laporan harus menampilkan secara terpisah omzet bersih, kewajiban refund, dan refund yang sudah dibayar.

## 3. Filter laporan dan potensi ketidakkonsistenan
- Transaksi difilter melalui `getActiveFilteredTrx()`; retur difilter berdasarkan metode dan kasir nota asal, tetapi tanggal retur memakai tanggal persetujuan. Ini berarti satu laporan periode dapat mengandung penjualan periode sebelumnya yang diretur pada periode berjalan hanya jika helper filter transaksi dan retur memang menyertakannya; perlu uji lintas periode.
- `paidReturnsInPeriod` memakai tanggal pembayaran dan metode refund, sedangkan filter kasir tetap diturunkan dari kasir nota asal.
- `returnServices = returnValue - returnGoods`; klasifikasi jenis retur yang tidak termasuk Obat/Paket otomatis masuk kategori jasa. Jenis legacy/unknown harus diaudit, jangan diasumsikan jasa.
- `legacyReturnValue` mencakup retur tanpa objek pengembalian; kompatibilitas data lama perlu migrasi dan rekonsiliasi khusus.
- `returnHpp` menggunakan `hpp × qty` dari catatan retur. Untuk paket dengan banyak komponen obat, perlu dipastikan `hpp` pada retur merupakan HPP total per unit paket, bukan HPP salah satu komponen.
- `totalKasDiTangan` menghitung seluruh transaksi tunai terfilter, bukan saldo kas per laci/shift individual. Untuk laporan lintas shift/kasir, perlu rekonsiliasi per shift lalu agregasi, bukan menganggap seluruhnya satu laci.
- `totalKasDiTangan` mengurangi retur tunai yang dibayar pada periode dan kas kecil pada periode. Jika tanggal modal shift, transaksi, petty, dan refund tidak konsisten, angka periode bukan saldo kas aktual akhir tanpa saldo awal/akhir ledger.

## 4. Risiko akuntansi penting
1. Biaya approved dan petty cash adalah dua kelompok terpisah. Jangan sampai satu pengeluaran dicatat di keduanya sehingga laba/kas terpotong dua kali.
2. Kerugian stok dan HPP harus dibedakan. Jika barang rusak/hilang sudah mengurangi persediaan dan dicatat sebagai loss, jangan kurangi HPP penjualan lagi untuk barang yang sama.
3. Retur barang mengurangi pendapatan dan memulihkan persediaan; retur jasa mengurangi pendapatan tanpa memulihkan stok.
4. Refund yang disetujui tetapi belum dibayar adalah kewajiban, bukan arus kas keluar.
5. Retur terhadap nota yang dibatalkan tidak boleh mengurangi omzet lagi; harus ada konflik/larangan antara pembatalan nota dan retur aktif.
6. Pengeluaran kas kecil harus memiliki shift dan actor, dengan reversal bukan penghapusan diam-diam.
7. Pembelian persediaan bukan otomatis beban laba rugi saat dibayar; nilai pembelian masuk persediaan/HPP saat barang terjual atau penyesuaian persediaan, sementara pembayaran mengurangi kas/utang.
8. Pembayaran utang supplier bukan beban kedua; itu penyelesaian kewajiban pembelian.
9. Omzet dan laba tidak boleh dicampur dengan uang masuk/keluar atau saldo kas.

## 5. Rekomendasi model ledger untuk database baru (belum DDL)
Pisahkan setidaknya:
- Sales/revenue ledger: invoice line, retur disetujui, pembatalan.
- Inventory ledger: penerimaan pembelian, FEFO issue, retur pasien, retur supplier, loss, opname, adjustment.
- Cash ledger: modal shift, penerimaan tunai, petty cash, refund tunai, setoran/penarikan dan koreksi.
- Bank/payment ledger: QRIS/transfer/debit settlement dan biaya settlement bila ada.
- Accounts payable: invoice supplier, credit note, pembayaran dan alokasi.
- Expense ledger: biaya operasional beserta approval dan reversal.
- Cost ledger: HPP snapshot penjualan, HPP retur, nilai loss, dan metode costing.

Setiap ledger entry mempunyai sumber dokumen, tanggal bisnis WIB, timestamp server, actor, nominal signed, currency, status posting/reversal, dan idempotency reference.

## 6. Persyaratan rekonsiliasi
Sebelum migrasi:
- Total omzet per nota harus sama dengan jumlah baris nota setelah aturan diskon yang berlaku.
- Omzet bersih = omzet nota aktif - retur yang diakui - pembatalan sesuai kebijakan (hindari double count).
- HPP laporan harus sama dengan snapshot HPP invoice lines dikurangi HPP persediaan yang benar-benar kembali.
- Saldo stok agregat harus sama dengan jumlah batch layak + batch tidak layak yang masih tersimpan, sesuai kebijakan stok.
- Kas per shift harus sama dengan modal + transaksi tunai - petty - refund tunai + adjustment.
- Kas/bank tidak boleh menganggap transaksi non-tunai sebagai uang di laci.
- Utang supplier = tagihan + debit adjustment - credit note - pembayaran teralokasi.
- Laba = omzet bersih - HPP - biaya operasional - loss - beban lain yang diakui; kas kecil hanya dikurangkan sebagai beban jika memang merupakan pengeluaran beban, bukan perpindahan kas atau uang muka.
- Seluruh hasil dihitung per hari WIB dan dibandingkan dengan laporan aplikasi lama untuk rentang data sintetis yang diketahui.

## 7. Keputusan kebijakan yang masih terbuka
- Apakah kas kecil seluruhnya merupakan beban, atau ada kategori uang muka/transfer antar kas?
- Pengakuan retur supplier pada tanggal pengiriman atau tanggal credit note diterima.
- Perlakuan retur lama tanpa data refund.
- Definisi HPP paket: snapshot komponen pada saat transaksi atau nilai paket yang disimpan.
- Pengakuan omzet pada tanggal transaksi atau tanggal penyelesaian pembayaran untuk metode non-tunai.
- Penanganan biaya approved yang dikoreksi setelah periode tutup.

## 8. Langkah audit berikutnya
Audit lanjutan: pasien/antrean dan status lifecycle, konfigurasi master, user provisioning, display TV/audio, sinkronisasi listeners, offline/push, ekspor/backup dan seluruh data legacy. Sesudah itu susun crosswalk koleksi → tabel → field dan checklist acceptance test final. Tidak membuat DDL sampai seluruh sumber dan keputusan bisnis selesai.

## Status
Tidak ada kode aplikasi yang diubah. Tidak ada data pasien atau operasional yang dipindahkan. Tidak ada SQL DDL dibuat. Belum ada klaim uji runtime lulus.
