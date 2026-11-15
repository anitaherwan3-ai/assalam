# NULLABILITY AND DEFAULT COMPLETENESS MATRIX — PASS 5

Tanggal: 2026-11-15  
Branch: `migration/tidb-foundation`  
Source: `MYSQL_MIGRATION_EXACT_COLUMN_NULL_DEFAULT_DICTIONARY_PASS4.md`  
Status: **STATIC GAP ANALYSIS — NOT DDL / NOT SCHEMA APPROVAL**

## 1. Ringkasan

- Tabel yang diperiksa: **56**.
- Kolom yang diekstrak: **566**.
- Kolom tanpa deklarasi NULL/NOT NULL eksplisit: **65**.
- Kolom tanpa DEFAULT eksplisit: **535**.
- Kolom dengan nullability eksplisit: **501**.
- Kolom dengan default eksplisit: **31**.

`UNSPECIFIED` berarti proposal belum menetapkan atribut itu. Itu bukan berarti nullable, NOT NULL, atau otomatis boleh mengandalkan default engine. Kolom uang yang NOT NULL tanpa DEFAULT harus diisi oleh command server; jangan membuat default nol hanya untuk memudahkan insert.

## 2. Matriks per tabel

| Tabel | Kolom | NULL belum ditentukan | DEFAULT belum ditentukan | NULL eksplisit | DEFAULT eksplisit |
|---|---:|---:|---:|---:|---:|
| `users` | 9 | 0 | 6 | 9 | 3 |
| `user_emails` | 9 | 0 | 8 | 9 | 1 |
| `role_assignments` | 9 | 2 | 8 | 7 | 1 |
| `clinic_settings` | 7 | 1 | 6 | 6 | 1 |
| `display_configs` | 8 | 2 | 6 | 6 | 2 |
| `queue_audio_assets` | 11 | 1 | 10 | 10 | 1 |
| `patients` | 14 | 1 | 14 | 13 | 0 |
| `patient_encounters` | 14 | 1 | 14 | 13 | 0 |
| `queue_counters` | 4 | 0 | 4 | 4 | 0 |
| `cashier_queue_assignments` | 7 | 1 | 7 | 6 | 0 |
| `queue_tickets` | 13 | 1 | 13 | 12 | 0 |
| `queue_call_events` | 7 | 1 | 7 | 6 | 0 |
| `patient_handoffs` | 9 | 1 | 9 | 8 | 0 |
| `cashier_shifts` | 11 | 1 | 10 | 10 | 1 |
| `active_shift_slots` | 3 | 1 | 3 | 2 | 0 |
| `shift_reconciliations` | 10 | 1 | 10 | 9 | 0 |
| `cash_ledger_entries` | 13 | 1 | 13 | 12 | 0 |
| `bank_ledger_entries` | 12 | 1 | 12 | 11 | 0 |
| `petty_cash_entries` | 10 | 1 | 10 | 9 | 0 |
| `expenses` | 13 | 1 | 13 | 12 | 0 |
| `expense_events` | 8 | 1 | 8 | 7 | 0 |
| `loss_events` | 11 | 1 | 11 | 10 | 0 |
| `medicines` | 14 | 1 | 11 | 13 | 3 |
| `tariffs` | 10 | 2 | 9 | 8 | 1 |
| `service_packages` | 10 | 2 | 9 | 8 | 1 |
| `package_components` | 9 | 1 | 8 | 8 | 1 |
| `suppliers` | 9 | 2 | 8 | 7 | 1 |
| `supplier_invoices` | 13 | 2 | 12 | 11 | 1 |
| `supplier_invoice_lines` | 10 | 2 | 9 | 8 | 1 |
| `inventory_batches` | 12 | 2 | 11 | 10 | 1 |
| `inventory_movements` | 15 | 1 | 15 | 14 | 0 |
| `stocktakes` | 14 | 2 | 14 | 12 | 0 |
| `sales_invoices` | 17 | 1 | 16 | 16 | 1 |
| `sales_invoice_lines` | 17 | 1 | 13 | 16 | 4 |
| `sales_invoice_line_components` | 10 | 1 | 9 | 9 | 1 |
| `invoice_batch_allocations` | 7 | 1 | 7 | 6 | 0 |
| `invoice_discount_allocations` | 5 | 1 | 5 | 4 | 0 |
| `invoice_payments` | 10 | 1 | 9 | 9 | 1 |
| `sales_returns` | 13 | 2 | 13 | 11 | 0 |
| `sales_return_lines` | 10 | 1 | 10 | 9 | 0 |
| `return_quota_subjects` | 10 | 1 | 8 | 9 | 2 |
| `refund_obligations` | 7 | 1 | 6 | 6 | 1 |
| `refund_payments` | 8 | 1 | 8 | 7 | 0 |
| `invoice_cancellation_requests` | 10 | 1 | 10 | 9 | 0 |
| `invoice_cancellation_events` | 6 | 1 | 6 | 5 | 0 |
| `supplier_returns` | 10 | 2 | 10 | 8 | 0 |
| `supplier_return_lines` | 7 | 1 | 7 | 6 | 0 |
| `supplier_credit_notes` | 8 | 1 | 8 | 7 | 0 |
| `supplier_payments` | 10 | 1 | 10 | 9 | 0 |
| `supplier_payment_allocations` | 4 | 1 | 4 | 3 | 0 |
| `audit_events` | 13 | 1 | 13 | 12 | 0 |
| `idempotency_requests` | 12 | 1 | 12 | 11 | 0 |
| `outbox_jobs` | 13 | 2 | 12 | 11 | 1 |
| `stored_files` | 11 | 1 | 11 | 10 | 0 |
| `backup_jobs` | 11 | 1 | 11 | 10 | 0 |
| `export_jobs` | 9 | 1 | 9 | 8 | 0 |

## 3. Cara menutup gap

1. Untuk setiap kolom FK, tetapkan nullability berdasarkan lifecycle bisnis, bukan semata karena parent relation optional di data lama.
2. Untuk semua kolom PK, wajib NOT NULL; deklarasi PK perlu dinyatakan konsisten di DDL final.
3. Untuk event/ledger/audit, hindari default yang menyembunyikan actor, amount, timestamp, atau source identity yang hilang.
4. Untuk projection/version/counters, default hanya boleh dipakai bila ada aturan inisialisasi dan concurrency yang jelas.
5. Untuk kolom opsional, tentukan apakah NULL bermakna “tidak ada”, “belum diketahui”, “tidak berlaku”, atau data historis yang hilang; jangan gabungkan arti tersebut.
6. Untuk nilai keuangan, kuantitas, harga, HPP, dan saldo, tentukan apakah default nol sah secara bisnis. Default nol tidak boleh menutupi field yang seharusnya diwajibkan oleh transaksi.
7. Untuk string, tetapkan apakah empty string diperbolehkan atau harus NULL; validasi di API.
8. Semua keputusan harus disinkronkan ke proposal, FK manifest, API validation, fixture positif/negatif, dan report reconciliation.

## 4. Area prioritas tinggi untuk keputusan

- `patient_encounters.patient_id` dan `shift_id`: proposal saat ini menulis NULL, tetapi encounter operasional baru seharusnya punya pasien dan shift terbuka; karantina historis lebih aman daripada melonggarkan data baru.
- `sales_invoices.patient_id`: nullable saat ini, tetapi invoice harus konsisten dengan encounter/patient ownership; putuskan master FK vs snapshot.
- `inventory_movements.batch_id` dan `stocktake_lines.batch_id`: nullable secara sengaja untuk opening/adjustment, tetapi pair semantics dengan medicine wajib dibuktikan.
- Actor fields nullable pada audit/reviewer/approval harus dibedakan dengan `actor_kind` human/system/import/unknown.
- `supplier_invoice_lines.expiry_date` dan `batch_number` opsional; receipt allocation harus mendukung beberapa batch/lots bila workflow mengizinkan split delivery.
- `backup_jobs` nullable timestamps/actor/size hanya boleh merepresentasikan job yang belum mulai / scheduled principal, bukan record selesai yang tidak lengkap.

## 5. Batas hasil

Matriks ini hanya menghitung kelengkapan deklarasi pada proposal. Ia tidak memutuskan nullability/default yang hilang, tidak menguji data historis, tidak membuktikan FK, dan tidak menguji TiDB. DDL tetap dilarang sampai seluruh gap penting ditutup, D01–D20 disetujui atau dikecualikan secara eksplisit, dan fixture test positif/negatif disiapkan.
