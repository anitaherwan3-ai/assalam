# Tahap 2 — Backend Pembelian & Persediaan (Progress)
Tanggal: 2026-11-25
Branch: `fix/tidb-localstorage-cache-only-2026-11-25`
Scope: perubahan backend yang aman dilakukan tanpa mengubah kebijakan klinik yang masih terbuka.

## Perubahan yang sudah masuk branch

### 1. Read model pembelian/persediaan — `api/inventory.js`
GET inventory kini mengembalikan selain master/proyeksi obat:
- `purchases`: header faktur, supplier, tanggal faktur/jatuh tempo, nilai bruto, status, total alokasi pembayaran, supplier credit yang sudah settled, dan sisa kewajiban.
- `purchaseLines`: obat, jumlah pesanan, jumlah diterima, harga satuan, dan total baris.
- `batches`: nomor batch, tanggal kedaluwarsa, verifikasi asal/ED, kuantitas awal/sisa, HPP, disposisi, dan versi.
- `supplierReturns`: status retur, settlement status, faktur, batch, obat, dan kuantitas.
- `supplierPayments`: tanggal, nominal pembayaran, nominal alokasi ke faktur, metode, bukti, referensi, dan pencatat.

Semua nominal/kuantitas yang dipetakan dikirim sebagai string untuk menghindari kehilangan presisi integer pada browser.

### 2. Perbaikan resolusi ID utang supplier — `lib/repositories/tidb-inventory-repository.js`
Sebelumnya `lockSupplierPayable()` menerima ID internal atau public ID, tetapi query agregat pembayaran/kredit memakai nilai input mentah. Saat pemanggil memakai public ID, agregasi dapat salah membaca saldo dan alokasi dapat memakai nilai yang bukan FK internal.

Sekarang repository:
- mengunci faktur lewat internal ID atau public ID;
- mengubahnya ke internal invoice ID kanonis;
- menghitung pembayaran dan supplier credit menggunakan internal ID;
- menyimpan allocation dan memperbarui status faktur menggunakan internal ID kanonis.

### 3. Pengujian regresi ditambahkan — `tests/tidb-inventory-repository.test.js`
Dua tes baru menguji:
- agregasi pembayaran dan kredit dengan input public ID;
- penyimpanan FK alokasi serta pembaruan status menggunakan internal invoice ID.

### 4. CI branch
Workflow `.github/workflows/tidb-foundation-tests.yml` diperluas agar branch kerja ini termasuk trigger pengujian. Setelah perubahan workflow, GitHub Actions belum melaporkan run apa pun pada branch ini (jumlah run yang terlihat: 0).

## Verifikasi yang benar-benar dilakukan
- Syntax parse dengan JavaScript V8 `new Function(source)` untuk:
  - `api/inventory.js`
  - `lib/repositories/tidb-inventory-repository.js`
  - `tests/tidb-inventory-repository.test.js`
- Ketiganya berhasil diparse tanpa syntax error.

## Belum diverifikasi
- `npm run build` berhasil pada commit `eb79844548d5619df7926607eb92ceaf94cc51d1` dengan 226/226 tes lulus. Run terbaru untuk HEAD sesudah penyesuaian file tes masih perlu dikonfirmasi.
- Tidak ada koneksi ke TiDB atau query live yang dilakukan.
- Tidak ada migrasi/DDL atau perubahan data database.
- Query read model belum diuji terhadap instance TiDB aktual.
- Belum ada PR, merge, atau deployment.

## Pekerjaan backend yang masih diperlukan sebelum Tahap 2 dapat dinyatakan selesai
1. Command transaksional untuk membuat faktur supplier dan baris faktur, dengan pemetaan public ID supplier/obat ke ID internal.
2. Keputusan eksplisit apakah satu faktur dapat berisi banyak obat dan apakah satu baris boleh diterima dalam beberapa batch/pengiriman. Kode saat ini masih mengunci `single_receipt`; jangan ubah menjadi `split_receipts` tanpa keputusan dan pengujian.
3. Command penerimaan yang dapat menerima data dari browser hanya melalui public IDs dan menyelesaikan semua penulisan dalam satu transaksi: receipt, batch, movement, proyeksi stok/HPP, status baris, payable, audit, dan idempotency.
4. Pembayaran supplier perlu validasi bahwa bukti mengacu ke `stored_files` yang benar-benar terunggah; placeholder bukti dari UI tidak boleh dianggap valid.
5. Read model perlu diuji terhadap skema TiDB aktual, termasuk status supplier credit yang belum settled dan rekonsiliasi saldo.
6. Read-after-write dan retry UI masih dikerjakan pada Tahap 3; saat ini UI belum menggunakan seluruh properti read model yang baru.

## Kebijakan yang tidak boleh diasumsikan
- D11: pembayaran supplier boleh parsial/berulang; faktur baru Lunas setelah seluruh kewajiban terpenuhi.
- D10: retur atas faktur lunas menjadi piutang/kredit supplier dan tetap Pending sampai refund/offset terbukti diterima.
- Penerimaan bertahap per baris faktur belum diputuskan di kontrak operasional yang sedang aktif; pertahankan `single_receipt` sampai ada keputusan.
- Jangan menganggap pembayaran parsial sama dengan penerimaan barang parsial.
- Jangan mengubah aturan HPP/biaya tambahan (ongkir, diskon, pajak) tanpa keputusan pemilik.

## Status
**Tahap 2 sedang berjalan, belum selesai.** CI 226/226 lulus pada commit yang memuat perubahan backend dan test regresi. HEAD terakhir menunggu konfirmasi run ulang. Perubahan hanya pada branch kerja; tidak ada perubahan main/produksi, Firebase, atau database live.


## Audit lanjutan 25-11-2026 — jalur UI Simpan Pembelian

Pemeriksaan ulang langsung pada `js/app.js`, `js/tidb-api.js`, `api/inventory.js`, `lib/clinic-domain-commands.js`, dan repository menemukan bahwa jalur pembelian dari form belum dapat berhasil secara konsisten:

1. Form `actionAddBeli()` mengirim `supplierName`, `invoiceNumber`, `medicineId`, `quantity`, `totalBilled`, `batchNumber`, dan `expiryDate` ke `receivePurchase()`.
2. Adapter meneruskan body tersebut sebagai action `receive_purchase`.
3. API meneruskan action ke `commands.receivePurchase()`, yang justru mewajibkan `purchaseLineId` dan `receivedQty`; command lalu mencari baris faktur yang sudah ada.
4. Tidak ditemukan action/command untuk membuat `supplier_invoices` dan `supplier_invoice_lines` pada endpoint inventory.
5. Sesudah panggilan TiDB, UI tetap memanggil `store.recordPurchase(purchasePayload)`. Jadi jika panggilan TiDB suatu saat lolos, UI masih menulis transaksi pembelian ke state lokal; ini bertentangan dengan aturan cache-only.

**Kesimpulan:** tombol Simpan Pembelian belum merupakan transaksi TiDB end-to-end. Temuan ini adalah blocker nyata, bukan sekadar kekurangan tampilan.

### Kontrak perbaikan yang aman

- Tambahkan alur pembuatan faktur terlebih dahulu: resolve supplier dan obat ke ID internal di server, validasi nomor faktur unik per supplier, tanggal, kuantitas, harga, dan total; buat header serta baris faktur dengan audit dan idempotency dalam transaksi.
- Setelah faktur tersimpan, penerimaan harus memakai ID baris faktur yang dikembalikan server. Jangan mengirim nama supplier atau ID lokal browser sebagai FK.
- Sampai ada command transaksi gabungan, kegagalan penerimaan setelah faktur tercatat harus ditampilkan sebagai faktur belum diterima dan dapat dipulihkan; jangan menulis transaksi lokal sebagai pengganti.
- Pada mode TiDB, jangan panggil `store.recordPurchase()`. Setelah sukses, refresh read model dari API TiDB dan render data server.
- Pertahankan kebijakan penerimaan `single_receipt` yang saat ini aktif. Jangan mengaktifkan penerimaan bertahap tanpa keputusan pemilik.
- Form saat ini hanya mengirim satu obat per penyimpanan. Dukungan banyak baris dalam satu faktur belum boleh diasumsikan.
- Jangan mengarang harga satuan ketika total tidak habis dibagi kuantitas. Validasi total dan unit cost harus memakai aturan integer yang eksplisit.
- Jangan otomatis membuat supplier dari teks bebas; gunakan master supplier aktif atau arahkan Admin membuat supplier melalui master supplier.

### Tes wajib sebelum UI diaktifkan

- Supplier/obat public ID dipetakan server-side ke internal FK yang valid.
- Nomor faktur duplikat untuk supplier yang sama ditolak.
- Qty, total, harga satuan, tanggal dan ED tidak valid ditolak tanpa perubahan parsial.
- Idempotency retry tidak membuat faktur/receipt/batch/movement ganda.
- Kegagalan receipt tidak menimbulkan stok atau batch parsial.
- Pembelian TiDB tidak menulis `klinik_data` atau state operasional localStorage.
- Setelah berhasil, tampilan pembelian, stok, batch, dan utang berasal dari GET TiDB.
