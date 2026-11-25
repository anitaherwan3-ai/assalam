# Tahap 1 — Audit Pembelian dan Persediaan TiDB
Tanggal: 2026-11-25
Repository: anitaherwan3-ai/assalam
Branch: fix/tidb-localstorage-cache-only-2026-11-25

## Status
Audit source-code selesai untuk alur Pembelian, penerimaan barang, faktur supplier, pembayaran supplier, batch, dan kedaluwarsa. Ini audit statis terhadap branch; belum ada pengujian runtime, koneksi database, atau perubahan data TiDB. Tidak ada merge atau deployment.

## Temuan kritis yang terkonfirmasi

### 1. Form pembelian tidak cocok dengan kontrak endpoint penerimaan
UI `js/app.js: actionAddBeli()` memanggil `POST /api/inventory` dengan:
- `supplierName`, `invoiceNumber`, `medicineId`, `quantity`, `totalBilled`, `batchNumber`, `expiryDate`.

Namun `api/inventory.js` hanya meneruskan `action: receive_purchase` ke `commands.receivePurchase()`. Perintah tersebut memerlukan:
- `purchaseLineId`, `receivedQty`, `receiptReference`, `purchaseValue`, dan objek `batch` lengkap.
- Baris faktur supplier harus sudah ada di `supplier_invoice_lines`.

Tidak ditemukan perintah/API untuk membuat `supplier_invoices` beserta `supplier_invoice_lines`. Maka payload UI saat ini tidak dapat menjalankan alur penerimaan yang dimaksud.

### 2. Identitas obat salah format untuk kontrak penerimaan
UI mengambil `publicId` obat dari katalog, sementara repository penerimaan mengunci obat memakai `medicine_id` internal numerik. Kontrak perlu menyepakati public ID pada batas API lalu me-resolve ke ID internal di server; jangan kirim ID internal mentah ke browser sebagai identitas permanen.

### 3. Penerimaan stok masih diikuti mutasi lokal
Setelah API dipanggil, `actionAddBeli()` tetap menjalankan `store.recordPurchase()`. Fungsi tersebut menambah stok, menghitung HPP, membuat batch, dan faktur pada browser. Di mode TiDB, state lokal tidak boleh menjadi sumber transaksi atau memproyeksikan penerimaan yang belum direkonsiliasi dari server. UI harus menunggu sukses server lalu membaca ulang read model.

### 4. Read model pembelian dan batch belum tersedia di layar
- `GET /api/inventory` hanya mengembalikan obat aktif dan proyeksi stok; tidak mengembalikan batch per lot, ED, saldo batch, atau kartu pergerakan.
- `GET /api/finance` hanya mengembalikan expenses dan shifts; tidak mengembalikan faktur supplier, detail baris, penerimaan, alokasi pembayaran, sisa utang, atau retur supplier.
- `syncOperationalDataFromTiDB()` tidak mengisi `store.state.beli`, `batch`, atau `returBeli`.
- Tab Pembelian dan Kedaluwarsa masih merender data dari store browser.

### 5. Pembayaran supplier belum aman untuk digunakan dari daftar lokal
`store.lunasiBeli()` mengirim `sourceId` dari ID pembelian lokal, nilai seluruh faktur, dan `evidenceFileId: "evidence-direct-settlement"`. Perintah server mencari payable TiDB dan mensyaratkan bukti pembayaran nyata. Setelah API sukses, fungsi juga menandai faktur lokal lunas tanpa readback. Ini tidak cocok dengan pembayaran bertahap yang telah ditetapkan.

### 6. Kebijakan penerimaan saat ini dibatasi satu kali
Repository mengembalikan `getPurchaseReceiptPolicy() = single_receipt`. Kebijakan penerimaan bertahap belum diaktifkan. Ini harus dipertahankan sebagai batas eksplisit sampai aturan penerimaan parsial diputuskan; jangan menganggap pembayaran parsial berarti penerimaan barang parsial.

### 7. Pembuangan batch kedaluwarsa masih browser-only
`actionBuangAllExpired()` mengubah saldo batch, stok obat, dan kerugian hanya di state lokal. Endpoint inventory belum memetakan aksi pembuangan expired generik yang dipakai UI. Tindakan ini harus diblokir di mode TiDB sampai tersedia command transaksional yang menulis movement, mengurangi batch/proyeksi stok, dan mencatat audit.

## Peta UI → API → domain → tabel (kondisi saat audit)

| Aksi UI | API saat ini | Domain/repository | Status |
|---|---|---|---|
| Simpan faktur + item pembelian | UI memanggil `receive_purchase` | Hanya menerima baris faktur yang sudah ada | Tidak tersambung; create invoice belum ada |
| Terima barang + buat batch | `POST /api/inventory` | `receivePurchase`, `createPurchaseReceipt`, `createBatch`, `inventory_movements`, `medicine_stock_projections` | Kontrak UI/API tidak cocok |
| Lihat riwayat faktur | Tidak ada read endpoint faktur | Tabel invoice tersedia di repository flow | Belum dihidrasikan |
| Lihat batch dan ED | GET inventory hanya proyeksi total obat | `inventory_batches` ada | Belum dihidrasikan |
| Lunasi faktur | `POST /api/finance record_supplier_payment` | `recordSupplierPayment`, payable + payment allocation | ID sumber dan bukti dari UI tidak valid; readback tidak ada |
| Retur ke supplier | API/domain request/approve/dispatch tersedia | Supplier return tables dan batch movements | UI masih memanggil store lokal |
| Buang batch expired | Tidak ada action yang terhubung dari UI | Tidak ditemukan command expired-disposal generik | Browser-only; harus diblokir di mode TiDB |

## Urutan empat tahap kerja

1. **Tahap 1 — Audit kontrak dan peta alur (dokumen ini):** pastikan ketidakcocokan UI/API/domain/tabel diketahui sebelum mengubah kode.
2. **Tahap 2 — Lengkapi backend pembelian:** command pembuatan faktur supplier + baris faktur, validasi supplier/obat, read model faktur/penerimaan/batch/retur, dan pembayaran parsial dengan alokasi serta sisa utang. Semua mutasi memakai transaksi, idempotency, role check, optimistic locking, dan audit.
3. **Tahap 3 — Sambungkan UI pembelian dan persediaan:** gunakan public IDs pada browser; hapus mutasi stok/faktur lokal setelah API; hydrate dan replace cache dari read model server; sambungkan retur supplier; blokir sementara pembuangan expired dan aksi lain yang belum punya endpoint.
4. **Tahap 4 — Verifikasi non-produksi:** syntax check, unit/integration tests, skenario duplikasi, gagal jaringan, refresh, multi-device, pembayaran parsial, penerimaan, FEFO, retur, dan rekonsiliasi stok/HPP. Hanya setelah lulus siapkan review cutover terpisah.

## Aturan keselamatan
- Jangan aktifkan Firebase sebagai fallback.
- Jangan ubah hostname gate produksi atau lakukan cutover pada tahap ini.
- Jangan menjalankan SQL mutasi terhadap database produksi.
- Jangan mengaktifkan penerimaan parsial tanpa keputusan kebijakan yang eksplisit.
- Jangan menganggap tombol sukses jika server belum mengonfirmasi dan readback belum cocok.
