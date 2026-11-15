# MYSQL/TiDB RELATIONAL SCHEMA PROPOSAL — Klinik Assalaam Palembang
Tanggal: 2026-11-15
Status: REVIEW DRAFT ONLY — NOT DDL

## 0. Tujuan, batas, dan keputusan keselamatan

Dokumen ini mengusulkan model relasional untuk menggantikan penyimpanan operasional Firebase/Firestore secara bertahap. Ini bukan SQL migration script dan tidak boleh dijalankan langsung.

- Target database: TiDB Cloud, kompatibilitas MySQL.
- Aplikasi produksi dan Firebase tetap menjadi sistem aktif sampai cutover terpisah disetujui.
- Branch kerja: `migration/tidb-foundation`; project Vercel terisolasi `assalam-mysql-preview`.
- Tidak ada DDL, import data nyata, perubahan Firebase, perubahan production Vercel, atau merge PR #13 pada tahap ini.
- Gunakan data sintetis saja di preview.
- API server adalah satu-satunya writer. Browser tidak boleh mengirim/mengatur role, user ID kasir, stok akhir, HPP final, total final, status persetujuan, atau nominal refund final.
- Firebase Authentication dapat dipertahankan sementara sebagai identity provider; API wajib memverifikasi ID token di server dan menyelesaikan user/role dari database. Cutover autentikasi menunggu audit Cloud Functions yang sumber otoritatifnya belum ditemukan di repo.
- Lima akun yang ditetapkan owner wajib dilindungi dari penghapusan, disablement, demotion, dan overwrite seed/restore: `assalamkasir1@gmail.com`, `assalamkasir2@gmail.com`, `assalamadmin@gmail.com`, `praktekrose@gmail.com`, dan `nursalim422@gmail.com`. Verifikasi UID/provider identity sebelum perubahan.
- Nama klinik dikunci: **Klinik Assalaam Palembang**.

Dokumen sumber yang menjadi dasar: Master Blueprint, inventory/deep-dive, write-path/permission crosswalk, root-cause audit, purchase/finance/shift, invoice/inventory, cancellation/return, relational integrity, financial reconciliation, screen UI specification, dan screen-role E2E test plan.

## 1. Konvensi SQL yang diusulkan

| Concern | Konvensi proposal | Catatan validasi |
|---|---|---|
| Engine | InnoDB/TiDB transactional tables | Verifikasi isolation, locking dan FK di cluster Starter |
| Character set | utf8mb4 | Pastikan collation case/accent behavior sesuai kebutuhan |
| Internal PK | BIGINT UNSIGNED AUTO_INCREMENT untuk row internal | Uji distribusi/compatibility TiDB; jangan mengasumsikan MySQL auto-increment berurutan |
| Legacy/public ID | VARCHAR(80) atau VARCHAR(128), unik per domain | Pertahankan Firestore document ID agar idempotent; jangan pakai nama sebagai key |
| User identity | CHAR(36) atau VARCHAR(64) immutable user_id | Tidak berubah ketika email diganti |
| Money | BIGINT signed, satuan rupiah bulat | Validasi batas maksimum; jangan FLOAT/DOUBLE |
| Quantity | DECIMAL(18,3) kandidat | Putuskan unit obat; jika semua harus integer, validasi server dan gunakan BIGINT |
| Rate/percentage | DECIMAL(9,4) | Aturan diskon/rounding harus satu implementasi server |
| Business date | DATE dalam Asia/Jakarta | Simpan eksplisit; jangan turunkan dari UTC date tanpa zona |
| Timestamp | DATETIME(3) UTC | Server-authoritative; UI konversi Asia/Jakarta |
| Text | VARCHAR untuk bounded values; TEXT untuk notes | Tetapkan batas input API |
| Soft delete | deleted_at_utc + deleted_by_user_id bila benar-benar dibutuhkan | Transaksi keuangan/inventory tidak dihapus; gunakan reversal |
| Audit | append-only; no UPDATE/DELETE oleh aplikasi biasa | Retensi dan akses ditentukan kebijakan |
| Concurrency | SELECT ... FOR UPDATE + unique constraints + idempotency | Uji perilaku nyata pada TiDB |
| FK | ON DELETE RESTRICT default | Jangan cascade hapus catatan keuangan/medis |
| JSON | hanya untuk snapshot payload non-relational yang memang perlu | Data inti, nilai, status, relasi dan ledger tetap kolom/tabel |

### 1.1 Kolom umum (bukan otomatis ditambahkan ke semua tabel)

- `created_at_utc DATETIME(3) NOT NULL`
- `created_by_user_id VARCHAR(64) NULL`
- `updated_at_utc DATETIME(3) NULL`
- `updated_by_user_id VARCHAR(64) NULL`
- `version BIGINT UNSIGNED NOT NULL DEFAULT 1` untuk optimistic concurrency pada resource yang diedit.
- `legacy_id VARCHAR(128) NULL` + unique scoped index pada tabel hasil migrasi jika sumber ID perlu dipertahankan.
- Hindari menambah kolom umum secara membabi buta pada ledger append-only; actor/time/action disimpan sesuai semantik event.

### 1.2 Kunci dan constraint lintas sistem

- Semua endpoint write menerima `Idempotency-Key`; server menyimpan hasil command.
- Semua perubahan inventory menghasilkan movement; saldo batch/obat adalah projection yang harus dapat direkonsiliasi.
- Semua perubahan uang menghasilkan cash/bank/payable/refund ledger sesuai jenisnya; jangan gabungkan omzet dengan kas.
- Semua approval/rejection mencatat actor, role snapshot, waktu server, alasan dan state sebelumnya.
- Jangan memakai MySQL partial unique index sebagai asumsi. Untuk satu shift terbuka per kasir gunakan tabel lock/slot aktif atau transaksi serialisasi yang diuji pada TiDB.
- Jangan mengandalkan CHECK constraint sebelum diuji pada versi TiDB yang dipakai; semua validasi bisnis tetap di API.

## 2. Domain identity, authorization dan konfigurasi

### 2.1 `users`
| Column | Type | Null | Keterangan |
|---|---|---:|---|
| user_id | VARCHAR(64) | NO | PK immutable; stabil lintas email |
| legacy_uid | VARCHAR(128) | YES | UID lama jika tersedia |
| display_name | VARCHAR(120) | NO | Nama tampilan |
| phone | VARCHAR(32) | YES | Nomor kontak staf |
| active | TINYINT(1) | NO | Default 1 |
| protected_owner | TINYINT(1) | NO | Default 0; proteksi master di server |
| created_at_utc | DATETIME(3) | NO | Server time |
| updated_at_utc | DATETIME(3) | NO | Server time |
| version | BIGINT UNSIGNED | NO | Default 1 |

PK: user_id. Index: (active), (protected_owner). FK referensi actor memakai RESTRICT. Tidak menyimpan password bila Firebase Auth masih dipakai. Proteksi owner juga harus ada di service layer, bukan hanya flag tabel.

### 2.2 `user_emails`
| Column | Type | Null | Keterangan |
|---|---|---:|---|
| email_id | BIGINT UNSIGNED | NO | PK |
| user_id | VARCHAR(64) | NO | FK users |
| email_normalized | VARCHAR(254) | NO | lowercase + trim |
| is_primary | TINYINT(1) | NO | Default 0 |
| verified_at_utc | DATETIME(3) | YES | Verifikasi provider |
| valid_from_utc | DATETIME(3) | NO | Awal berlaku |
| valid_to_utc | DATETIME(3) | YES | NULL = masih aktif |
| changed_by_user_id | VARCHAR(64) | YES | Actor |
| change_reason | VARCHAR(255) | YES | Alasan |

Index histori: (email_normalized), (user_id, valid_to_utc). Jangan pasang unique global pada email historis. Klaim email aktif ditegakkan melalui active_email_claims(email_normalized PK, user_id UNIQUE, email_id UNIQUE). Perubahan email menutup histori lama dan mengganti klaim aktif secara atomik; user_id tetap immutable dan email baru wajib diverifikasi.

### 2.3 `role_assignments`
role_assignment_id BIGINT UNSIGNED PK; user_id VARCHAR(64) FK; UNIQUE (role_assignment_id,user_id); role_code VARCHAR(24) NOT NULL (pimpinan/admin/kasir); scope_type VARCHAR(24) NOT NULL DEFAULT 'clinic'; scope_id VARCHAR(64) NULL; valid_from_utc DATETIME(3) NOT NULL; valid_to_utc DATETIME(3) NULL; granted_by_user_id VARCHAR(64) NOT NULL; created_at_utc DATETIME(3) NOT NULL. Index (user_id, valid_to_utc), (role_code, valid_to_utc). Tambahkan active_role_slots(user_id PK, role_assignment_id UNIQUE) sebagai penegak satu role aktif, kecuali keputusan owner mengubah kebijakan single-role. Aktivasi/perubahan role mengunci slot dan menulis histori dalam satu transaksi. Role selalu diputuskan server-side.

### 2.4 `clinic_settings`
setting_key VARCHAR(80) PK; setting_value TEXT NOT NULL; value_type VARCHAR(20) NOT NULL; editable_by_admin TINYINT(1) NOT NULL DEFAULT 0; version BIGINT UNSIGNED NOT NULL; updated_at_utc DATETIME(3) NOT NULL; updated_by_user_id VARCHAR(64) NOT NULL. Fixed clinic name disimpan sebagai protected constant/config yang tidak bisa diubah lewat endpoint settings. Setting sensitif tidak boleh dibaca Display TV.

### 2.5 `display_configs`
display_config_id BIGINT UNSIGNED PK; config_key VARCHAR(80) UNIQUE; youtube_video_id VARCHAR(64) NULL; youtube_enabled TINYINT(1) NOT NULL DEFAULT 0; running_text TEXT NULL; queue_mode VARCHAR(16) NOT NULL DEFAULT 'combined'; updated_at_utc DATETIME(3) NOT NULL; updated_by_user_id VARCHAR(64) NOT NULL. queue_mode values candidate: A, B, combined, switch. A/B/switch only enabled after PR13 decision. TV endpoint returns sanitized projection only.

### 2.6 `queue_audio_assets`
audio_asset_id BIGINT UNSIGNED PK; clip_id VARCHAR(64) NOT NULL UNIQUE; clip_type VARCHAR(24) NOT NULL; object_key VARCHAR(512) NOT NULL; mime_type VARCHAR(100) NOT NULL; size_bytes INT UNSIGNED NOT NULL; sha256 CHAR(64) NOT NULL; version BIGINT UNSIGNED NOT NULL; active TINYINT(1) NOT NULL DEFAULT 1; updated_at_utc DATETIME(3) NOT NULL; updated_by_user_id VARCHAR(64) NOT NULL. Audio binary stored in private object storage, not SQL/base64. Validate allowed clip IDs, MP3 type, size limit, checksum, access and cache behavior.



### 2.7 Explicit integrity tables and invariants (schema v1 candidates)

- `active_email_claims`: `email_normalized VARCHAR(254) PRIMARY KEY`, `user_id VARCHAR(64) NOT NULL UNIQUE`, `email_id BIGINT UNSIGNED NOT NULL UNIQUE`. FK `user_id` → users and composite (`email_id`,`user_id`) → `user_emails(email_id,user_id)`; add UNIQUE (`email_id`,`user_id`) to user_emails. Only verified active email may be claimed. Email replacement closes the old history row and changes this claim in one transaction.
- `active_role_slots`: `user_id VARCHAR(64) PRIMARY KEY`, `role_assignment_id BIGINT UNSIGNED NOT NULL UNIQUE`, `activated_at_utc DATETIME(3) NOT NULL`. FK (`role_assignment_id`,`user_id`) → `role_assignments(role_assignment_id,user_id)` ensures the assignment belongs to the same user; role changes lock this slot and preserve role_assignments history.
- `sales_return_events`: `sales_return_event_id BIGINT UNSIGNED PRIMARY KEY`, `sales_return_id BIGINT UNSIGNED NOT NULL`, `event_type VARCHAR(24) NOT NULL`, `old_status VARCHAR(24) NULL`, `new_status VARCHAR(24) NOT NULL`, `actor_user_id VARCHAR(64) NOT NULL`, `reason VARCHAR(255) NULL`, `occurred_at_utc DATETIME(3) NOT NULL`. Append-only; index (`sales_return_id`,`occurred_at_utc`). Every submit/review/forward/approve/reject/finalize transition writes an event in the same transaction as the current status.
- `active_shift_slots` must use composite FK (`shift_id`,`cashier_user_id`) to `cashier_shifts(shift_id,cashier_user_id)`; parent needs UNIQUE (`shift_id`,`cashier_user_id`). A single-column FK to each field is insufficient to prove ownership consistency.



### 2.8 Composite-key requirements

For integrity constraints described above, add these parent keys before child FKs: `user_emails UNIQUE(email_id,user_id)`; `role_assignments UNIQUE(role_assignment_id,user_id)`; `cashier_shifts UNIQUE(shift_id,cashier_user_id)`. `inventory_batches.supplier_invoice_line_id` is UNIQUE for one-batch-per-receipt-line v1 (nullable for non-purchase opening batches). `sales_return_lines.return_quota_subject_id` is mandatory and references the component-aware quota subject, preventing a return line from bypassing its reserved quota.

## 3. Domain patient, encounter dan queue

### 3.1 `patients`
patient_id BIGINT UNSIGNED PK; public_id VARCHAR(80) NOT NULL UNIQUE; legacy_id VARCHAR(128) NULL; full_name VARCHAR(160) NOT NULL; phone VARCHAR(32) NULL; birth_date DATE NULL; sex_code VARCHAR(16) NULL; address TEXT NULL; archived_at_utc DATETIME(3) NULL; archived_by_user_id VARCHAR(64) NULL; created_at_utc DATETIME(3) NOT NULL; created_by_user_id VARCHAR(64) NOT NULL; updated_at_utc DATETIME(3) NOT NULL; version BIGINT UNSIGNED NOT NULL. PII restricted. Sex/date/address fields are candidates only if source and clinic policy confirm; do not invent values during migration.

### 3.2 `patient_encounters`
encounter_id BIGINT UNSIGNED PK; public_id VARCHAR(80) NOT NULL UNIQUE; legacy_id VARCHAR(128) NULL; patient_id BIGINT UNSIGNED NULL; business_date DATE NOT NULL; service_name_snapshot VARCHAR(120) NULL; cashier_user_id VARCHAR(64) NOT NULL; shift_id BIGINT UNSIGNED NULL; status VARCHAR(24) NOT NULL; completed_at_utc DATETIME(3) NULL; cancelled_at_utc DATETIME(3) NULL; cancellation_reason VARCHAR(255) NULL; created_at_utc DATETIME(3) NOT NULL; updated_at_utc DATETIME(3) NOT NULL. FK patient RESTRICT/SET NULL policy must be decided; FK actor and shift RESTRICT. Index (business_date,status), (patient_id,business_date), (cashier_user_id,business_date). Distinguish Batal Berobat from archive and invoice cancellation. Checkout must reject missing patient if required by final clinic policy; legacy orphan invoices quarantined.

### 3.3 `queue_counters`
business_date DATE NOT NULL; prefix VARCHAR(4) NOT NULL; last_sequence INT UNSIGNED NOT NULL; updated_at_utc DATETIME(3) NOT NULL. Composite PK (business_date,prefix). Allocate inside transaction with row lock; sequence formatted A-001 etc. Must handle concurrency and rollover.

### 3.4 `cashier_queue_assignments`
assignment_id BIGINT UNSIGNED PK; user_id VARCHAR(64) NOT NULL; prefix VARCHAR(4) NOT NULL; valid_from DATE NOT NULL; valid_to DATE NULL; assigned_by_user_id VARCHAR(64) NOT NULL; created_at_utc DATETIME(3) NOT NULL. Index (user_id,valid_to), (prefix,valid_to). Defaults: stable cashier ID kasir → A; kasir2 → B. Only Pimpinan changes mapping. Perubahan assignment wajib mengunci user dan prefix terkait, menolak rentang validitas yang tumpang tindih, serta mencatat event. If PR13 is not accepted, main baseline remains A-only until approved.

### 3.5 `queue_tickets`
queue_ticket_id BIGINT UNSIGNED PK; public_id VARCHAR(80) NOT NULL UNIQUE; legacy_id VARCHAR(128) NULL; encounter_id BIGINT UNSIGNED NOT NULL; business_date DATE NOT NULL; prefix VARCHAR(4) NOT NULL; sequence_no INT UNSIGNED NOT NULL; display_number VARCHAR(20) NOT NULL; status VARCHAR(20) NOT NULL; registered_at_utc DATETIME(3) NOT NULL; registered_by_user_id VARCHAR(64) NOT NULL; called_at_utc DATETIME(3) NULL; completed_at_utc DATETIME(3) NULL. Unique (business_date,prefix,sequence_no); unique encounter_id if one ticket per encounter is confirmed. Index (business_date,status,prefix,sequence_no). Queue ticket lifecycle separate from patient and encounter.

### 3.6 `queue_call_events`
call_event_id BIGINT UNSIGNED PK; queue_ticket_id BIGINT UNSIGNED NOT NULL; event_type VARCHAR(16) NOT NULL (call/recall/cancel); counter_label VARCHAR(40) NULL; event_idempotency_key VARCHAR(100) NOT NULL UNIQUE; actor_user_id VARCHAR(64) NOT NULL; occurred_at_utc DATETIME(3) NOT NULL. Index (queue_ticket_id,occurred_at_utc). Immutable event log; TV deduplicates event ID.

### 3.7 `patient_handoffs` (OPTIONAL — PR13 GATE)
handoff_id BIGINT UNSIGNED PK; encounter_id BIGINT UNSIGNED NOT NULL; from_user_id VARCHAR(64) NOT NULL; to_user_id VARCHAR(64) NOT NULL; from_shift_id BIGINT UNSIGNED NOT NULL; to_shift_id BIGINT UNSIGNED NOT NULL; reason VARCHAR(255) NULL; approved_at_utc DATETIME(3) NOT NULL; created_at_utc DATETIME(3) NOT NULL. Add only if PR13 handoff behavior is separately approved. Transaction locks encounter and target shift and revalidates target shift open.

## 4. Domain shift, drawer dan finance

### 4.1 `cashier_shifts`
shift_id BIGINT UNSIGNED PK; public_id VARCHAR(80) NOT NULL UNIQUE; legacy_id VARCHAR(128) NULL; cashier_user_id VARCHAR(64) NOT NULL; business_date DATE NOT NULL; opened_at_utc DATETIME(3) NOT NULL; opening_float BIGINT NOT NULL DEFAULT 0; status VARCHAR(16) NOT NULL; closed_at_utc DATETIME(3) NULL; closed_by_user_id VARCHAR(64) NULL; created_at_utc DATETIME(3) NOT NULL. Index (cashier_user_id,business_date,status), (business_date,status). Satu shift aktif per kasir ditegakkan lewat active_shift_slots atau lock row; bukan partial unique index.

### 4.2 `active_shift_slots`
cashier_user_id VARCHAR(64) PK; shift_id BIGINT UNSIGNED NOT NULL UNIQUE; acquired_at_utc DATETIME(3) NOT NULL. Dibuat/dihapus dalam transaksi buka/tutup shift. FK ke user dan shift RESTRICT. Tambahkan unique key pada cashier_shifts(shift_id,cashier_user_id) dan composite FK active_shift_slots(shift_id,cashier_user_id) agar shift yang dikunci pasti milik kasir yang sama. Mekanisme ini mencegah dua shift terbuka; uji crash/retry dan konsistensi status shift.

### 4.3 `shift_reconciliations`
reconciliation_id BIGINT UNSIGNED PK; shift_id BIGINT UNSIGNED NOT NULL UNIQUE; system_cash BIGINT NOT NULL; counted_cash BIGINT NOT NULL; variance BIGINT NOT NULL; verified_by_user_id VARCHAR(64) NULL; verified_at_utc DATETIME(3) NULL; verification_status VARCHAR(16) NOT NULL; snapshot_json JSON NULL; created_at_utc DATETIME(3) NOT NULL. Store snapshot of formula inputs and version; Admin/Pimpinan verifier according to approved policy. Variance = counted - system. No overwrite after verified; correction event instead.

### 4.4 `cash_ledger_entries`
cash_entry_id BIGINT UNSIGNED PK; business_date DATE NOT NULL; shift_id BIGINT UNSIGNED NULL; account_code VARCHAR(32) NOT NULL; direction VARCHAR(8) NOT NULL; amount BIGINT NOT NULL; source_type VARCHAR(32) NOT NULL; source_id VARCHAR(80) NOT NULL; payment_method VARCHAR(24) NOT NULL; occurred_at_utc DATETIME(3) NOT NULL; actor_user_id VARCHAR(64) NOT NULL; reversal_of_entry_id BIGINT UNSIGNED NULL; idempotency_key VARCHAR(100) NOT NULL UNIQUE. Index (business_date,account_code), (shift_id,occurred_at_utc), (source_type,source_id). Amount positive; direction controls sign. Cash drawer receipts/refunds/petty/adjustments only; bank/QRIS separated by account. No physical delete; reverse with linked entry.

### 4.5 `bank_ledger_entries`
bank_entry_id BIGINT UNSIGNED PK; business_date DATE NOT NULL; bank_account_code VARCHAR(32) NOT NULL; direction VARCHAR(8) NOT NULL; amount BIGINT NOT NULL; source_type VARCHAR(32) NOT NULL; source_id VARCHAR(80) NOT NULL; reference_no VARCHAR(100) NULL; occurred_at_utc DATETIME(3) NOT NULL; actor_user_id VARCHAR(64) NOT NULL; reversal_of_entry_id BIGINT UNSIGNED NULL; idempotency_key VARCHAR(100) NOT NULL UNIQUE. Index (business_date,bank_account_code), (source_type,source_id). Bank transfers are not cash drawer movements.

### 4.6 `petty_cash_entries`
petty_cash_id BIGINT UNSIGNED PK; legacy_id VARCHAR(128) NULL; shift_id BIGINT UNSIGNED NOT NULL; cashier_user_id VARCHAR(64) NOT NULL; business_date DATE NOT NULL; description VARCHAR(255) NOT NULL; amount BIGINT NOT NULL; status VARCHAR(16) NOT NULL; created_at_utc DATETIME(3) NOT NULL; reversed_by_entry_id BIGINT UNSIGNED NULL. Index (shift_id,business_date), (cashier_user_id,business_date). Create corresponding cash ledger entry atomically. Editing/deleting old records after posting becomes reversal + replacement. Decide whether petty categories are expenses or advances/transfers to avoid double count.

### 4.7 `expenses`
expense_id BIGINT UNSIGNED PK; legacy_id VARCHAR(128) NULL; business_date DATE NOT NULL; category VARCHAR(80) NOT NULL; description VARCHAR(255) NOT NULL; amount BIGINT NOT NULL; status VARCHAR(16) NOT NULL; created_by_user_id VARCHAR(64) NOT NULL; approved_by_user_id VARCHAR(64) NULL; approved_at_utc DATETIME(3) NULL; created_at_utc DATETIME(3) NOT NULL; updated_at_utc DATETIME(3) NOT NULL; version BIGINT UNSIGNED NOT NULL. Index (business_date,status), (category,business_date). Approval threshold comes from server settings; approval event history separate. Policy required for Admin self-approval.

### 4.8 `expense_events`
expense_event_id BIGINT UNSIGNED PK; expense_id BIGINT UNSIGNED NOT NULL; event_type VARCHAR(20) NOT NULL; old_status VARCHAR(16) NULL; new_status VARCHAR(16) NOT NULL; reason VARCHAR(255) NULL; actor_user_id VARCHAR(64) NOT NULL; occurred_at_utc DATETIME(3) NOT NULL. Index (expense_id,occurred_at_utc). Immutable approval/rejection/reversal trail.

### 4.9 `loss_events`
loss_event_id BIGINT UNSIGNED PK; legacy_id VARCHAR(128) NULL; medicine_id BIGINT UNSIGNED NOT NULL; batch_id BIGINT UNSIGNED NOT NULL; quantity DECIMAL(18,3) NOT NULL; value_amount BIGINT NOT NULL; reason VARCHAR(255) NOT NULL; business_date DATE NOT NULL; actor_user_id VARCHAR(64) NOT NULL; occurred_at_utc DATETIME(3) NOT NULL; reversal_of_loss_id BIGINT UNSIGNED NULL. Loss writes inventory movement atomically; no hard delete.

## 5. Domain master obat, tarif, paket, supplier dan inventory

### 5.1 `medicines`
medicine_id BIGINT UNSIGNED PK; public_id VARCHAR(80) NOT NULL UNIQUE; legacy_id VARCHAR(128) NULL; sku VARCHAR(80) NULL; name VARCHAR(180) NOT NULL; unit_name VARCHAR(40) NOT NULL; selling_price BIGINT NOT NULL; weighted_avg_cost BIGINT NOT NULL DEFAULT 0; stock_on_hand DECIMAL(18,3) NOT NULL DEFAULT 0; active TINYINT(1) NOT NULL DEFAULT 1; min_stock DECIMAL(18,3) NULL; created_at_utc DATETIME(3) NOT NULL; updated_at_utc DATETIME(3) NOT NULL; version BIGINT UNSIGNED NOT NULL. Index (name), (active). Stock and HPP are projections, reconciled against batches and movements. Price/HPP must be server-controlled.

### 5.2 `tariffs`
tariff_id BIGINT UNSIGNED PK; public_id VARCHAR(80) UNIQUE; legacy_id VARCHAR(128) NULL; name VARCHAR(180) NOT NULL; service_type VARCHAR(80) NOT NULL; price BIGINT NOT NULL; active TINYINT(1) NOT NULL DEFAULT 1; created_at_utc DATETIME(3) NOT NULL; updated_at_utc DATETIME(3) NOT NULL; version BIGINT UNSIGNED NOT NULL. Historical invoice line stores immutable tariff name/type/price snapshot.

### 5.3 `service_packages`
package_id BIGINT UNSIGNED PK; public_id VARCHAR(80) UNIQUE; legacy_id VARCHAR(128) NULL; name VARCHAR(180) NOT NULL; package_type VARCHAR(80) NULL; price BIGINT NOT NULL; active TINYINT(1) NOT NULL DEFAULT 1; created_at_utc DATETIME(3) NOT NULL; updated_at_utc DATETIME(3) NOT NULL; version BIGINT UNSIGNED NOT NULL.

### 5.4 `package_components`
package_component_id BIGINT UNSIGNED PK; package_id BIGINT UNSIGNED NOT NULL; component_type VARCHAR(20) NOT NULL; medicine_id BIGINT UNSIGNED NULL; tariff_id BIGINT UNSIGNED NULL; component_name_snapshot VARCHAR(180) NOT NULL; unit_price_snapshot BIGINT NOT NULL; quantity DECIMAL(18,3) NOT NULL; sort_order INT NOT NULL DEFAULT 0. Index (package_id,sort_order). Validate exactly one target reference according to component_type. Package nested package behavior remains unknown; block nested packages until source proves and policy approves.

### 5.5 `suppliers`
supplier_id BIGINT UNSIGNED PK; public_id VARCHAR(80) UNIQUE; legacy_id VARCHAR(128) NULL; name VARCHAR(180) NOT NULL; phone VARCHAR(32) NULL; address TEXT NULL; active TINYINT(1) NOT NULL DEFAULT 1; created_at_utc DATETIME(3) NOT NULL; updated_at_utc DATETIME(3) NOT NULL.

### 5.6 `supplier_invoices`
supplier_invoice_id BIGINT UNSIGNED PK; public_id VARCHAR(80) UNIQUE; legacy_id VARCHAR(128) NULL; supplier_id BIGINT UNSIGNED NOT NULL; invoice_number VARCHAR(100) NOT NULL; invoice_date DATE NOT NULL; due_date DATE NULL; status VARCHAR(20) NOT NULL; gross_amount BIGINT NOT NULL; accepted_credit_amount BIGINT NOT NULL DEFAULT 0; created_by_user_id VARCHAR(64) NOT NULL; created_at_utc DATETIME(3) NOT NULL; updated_at_utc DATETIME(3) NOT NULL. Index (supplier_id,invoice_date), (status,due_date). Unique supplier+invoice number only if business confirms no duplicate supplier invoice numbers.

### 5.7 `supplier_invoice_lines`
supplier_invoice_line_id BIGINT UNSIGNED PK; supplier_invoice_id BIGINT UNSIGNED NOT NULL; medicine_id BIGINT UNSIGNED NOT NULL; quantity_received DECIMAL(18,3) NOT NULL; quantity_returned DECIMAL(18,3) NOT NULL DEFAULT 0; unit_cost BIGINT NOT NULL; line_total BIGINT NOT NULL; expiry_date DATE NULL; batch_number VARCHAR(100) NULL. Index (supplier_invoice_id), (medicine_id). Do not store batch_id on this line: the sole one-to-one link is inventory_batches.supplier_invoice_line_id, which must have a UNIQUE constraint for the one-to-one v1 policy. One receipt line → one batch is the v1 candidate; if split receipt is confirmed, replace with supplier_invoice_line_batch_allocations before DDL freeze.

### 5.8 `inventory_batches`
batch_id BIGINT UNSIGNED PK; public_id VARCHAR(80) UNIQUE; legacy_id VARCHAR(128) NULL; medicine_id BIGINT UNSIGNED NOT NULL; supplier_invoice_line_id BIGINT UNSIGNED NULL; batch_number VARCHAR(100) NULL; expiry_date DATE NULL; initial_quantity DECIMAL(18,3) NOT NULL; remaining_quantity DECIMAL(18,3) NOT NULL; unit_cost BIGINT NOT NULL; received_at_utc DATETIME(3) NOT NULL; status VARCHAR(20) NOT NULL DEFAULT 'active'. Index (medicine_id,expiry_date,remaining_quantity), UNIQUE (supplier_invoice_line_id). Preserve seed/opening stock provenance; NULL is permitted for opening/adjustment batches without a supplier receipt line. Never silently assign a missing historical batch.

### 5.9 `inventory_movements`
inventory_movement_id BIGINT UNSIGNED PK; movement_key VARCHAR(100) NOT NULL UNIQUE; medicine_id BIGINT UNSIGNED NOT NULL; batch_id BIGINT UNSIGNED NULL; movement_type VARCHAR(24) NOT NULL; quantity_delta DECIMAL(18,3) NOT NULL; unit_cost BIGINT NULL; value_delta BIGINT NULL; source_type VARCHAR(32) NOT NULL; source_id VARCHAR(80) NOT NULL; source_line_id VARCHAR(80) NULL; business_date DATE NOT NULL; actor_user_id VARCHAR(64) NOT NULL; occurred_at_utc DATETIME(3) NOT NULL; reversal_of_movement_id BIGINT UNSIGNED NULL. Index (medicine_id,occurred_at_utc), (batch_id,occurred_at_utc), (source_type,source_id). Append-only. Allowed movement types: opening, purchase_receive, sale, patient_return, supplier_return, loss, stocktake, adjustment, cancellation_restore. Movement sign and quantity precision validated in domain service.

### 5.10 `stocktakes` and `stocktake_lines`
stocktakes: stocktake_id BIGINT UNSIGNED PK; business_date DATE NOT NULL; status VARCHAR(20) NOT NULL; created_by_user_id VARCHAR(64) NOT NULL; approved_by_user_id VARCHAR(64) NULL; created_at_utc DATETIME(3) NOT NULL; approved_at_utc DATETIME(3) NULL.
stocktake_lines: stocktake_line_id BIGINT UNSIGNED PK; stocktake_id BIGINT UNSIGNED NOT NULL; medicine_id BIGINT UNSIGNED NOT NULL; batch_id BIGINT UNSIGNED NULL; system_quantity DECIMAL(18,3) NOT NULL; counted_quantity DECIMAL(18,3) NOT NULL; variance_quantity DECIMAL(18,3) NOT NULL; reason VARCHAR(255) NULL. Approval writes inventory movement, not direct balance overwrite.

## 6. Domain sales, invoice snapshots, returns dan cancellations

### 6.1 `sales_invoices`
invoice_id BIGINT UNSIGNED PK; public_id VARCHAR(80) NOT NULL UNIQUE; legacy_id VARCHAR(128) NULL; invoice_number VARCHAR(80) NOT NULL; encounter_id BIGINT UNSIGNED NOT NULL; patient_id BIGINT UNSIGNED NULL; cashier_user_id VARCHAR(64) NOT NULL; shift_id BIGINT UNSIGNED NOT NULL; business_date DATE NOT NULL; invoice_status VARCHAR(20) NOT NULL; gross_amount BIGINT NOT NULL; discount_amount BIGINT NOT NULL DEFAULT 0; net_amount BIGINT NOT NULL; payment_status VARCHAR(20) NOT NULL; created_at_utc DATETIME(3) NOT NULL; cancelled_at_utc DATETIME(3) NULL; cancelled_by_user_id VARCHAR(64) NULL. Index (business_date,invoice_status), (patient_id,business_date), (cashier_user_id,business_date), (shift_id,created_at_utc). Invoice number unique scope/date must be finalized. Patient and encounter snapshots retained even if master is archived.

### 6.2 `sales_invoice_lines`
invoice_line_id BIGINT UNSIGNED PK; invoice_id BIGINT UNSIGNED NOT NULL; line_no INT UNSIGNED NOT NULL; line_type VARCHAR(20) NOT NULL; medicine_id BIGINT UNSIGNED NULL; tariff_id BIGINT UNSIGNED NULL; package_id BIGINT UNSIGNED NULL; item_name_snapshot VARCHAR(180) NOT NULL; item_type_snapshot VARCHAR(80) NOT NULL; unit_price BIGINT NOT NULL; quantity DECIMAL(18,3) NOT NULL; gross_amount BIGINT NOT NULL; discount_amount BIGINT NOT NULL DEFAULT 0; net_amount BIGINT NOT NULL; unit_cost_snapshot BIGINT NOT NULL DEFAULT 0; line_cost_snapshot BIGINT NOT NULL DEFAULT 0; returned_quantity DECIMAL(18,3) NOT NULL DEFAULT 0. Unique (invoice_id,line_no); index (medicine_id). Exactly one master reference by line_type; preserve all display/receipt fields required by old app after source verification.

### 6.3 `sales_invoice_line_components`
invoice_component_id BIGINT UNSIGNED PK; invoice_line_id BIGINT UNSIGNED NOT NULL; component_no INT UNSIGNED NOT NULL; component_type VARCHAR(20) NOT NULL; medicine_id BIGINT UNSIGNED NULL; tariff_id BIGINT UNSIGNED NULL; component_name_snapshot VARCHAR(180) NOT NULL; unit_price_snapshot BIGINT NOT NULL; quantity_per_parent DECIMAL(18,3) NOT NULL; unit_cost_snapshot BIGINT NOT NULL DEFAULT 0. Unique (invoice_line_id,component_no). Immutable package composition snapshot; component medicine quantities are package quantity × component quantity.

### 6.4 `invoice_batch_allocations`
allocation_id BIGINT UNSIGNED PK; invoice_line_id BIGINT UNSIGNED NOT NULL; invoice_component_id BIGINT UNSIGNED NULL; batch_id BIGINT UNSIGNED NOT NULL; quantity DECIMAL(18,3) NOT NULL; unit_cost_snapshot BIGINT NOT NULL; movement_id BIGINT UNSIGNED NOT NULL UNIQUE. Index (batch_id), (invoice_line_id). One row per actual batch deduction; source of exact stock restoration. Server derives FEFO and locks batches.

### 6.5 `invoice_discount_allocations`
discount_allocation_id BIGINT UNSIGNED PK; invoice_id BIGINT UNSIGNED NOT NULL; invoice_line_id BIGINT UNSIGNED NOT NULL; discount_amount BIGINT NOT NULL; rounding_remainder_rank INT NOT NULL; UNIQUE(invoice_id,invoice_line_id). Persist exact discount distribution so partial returns use same original largest-remainder allocation.

### 6.6 `invoice_payments`
invoice_payment_id BIGINT UNSIGNED PK; invoice_id BIGINT UNSIGNED NOT NULL; payment_method VARCHAR(24) NOT NULL; amount_received BIGINT NOT NULL; amount_applied BIGINT NOT NULL; change_amount BIGINT NOT NULL DEFAULT 0; reference_no VARCHAR(100) NULL; paid_at_utc DATETIME(3) NOT NULL; actor_user_id VARCHAR(64) NOT NULL; idempotency_key VARCHAR(100) NOT NULL UNIQUE. Support cash, transfer, QRIS or other approved methods; exact enum and split-tender behavior need source confirmation. Cash/bank ledger rows created atomically.

### 6.7 `sales_returns`
sales_return_id BIGINT UNSIGNED PK; public_id VARCHAR(80) UNIQUE; legacy_id VARCHAR(128) NULL; invoice_id BIGINT UNSIGNED NOT NULL; requested_by_user_id VARCHAR(64) NOT NULL; business_date DATE NOT NULL; status VARCHAR(24) NOT NULL; reason VARCHAR(255) NOT NULL; submitted_at_utc DATETIME(3) NOT NULL; admin_reviewed_by_user_id VARCHAR(64) NULL; admin_reviewed_at_utc DATETIME(3) NULL; final_decided_by_user_id VARCHAR(64) NULL; final_decided_at_utc DATETIME(3) NULL. Index (invoice_id,status), (business_date,status). Stages: submitted → admin_reviewed/forwarded → approved or rejected. No stock change at Admin review.

### 6.8 `sales_return_lines`
sales_return_line_id BIGINT UNSIGNED PK; sales_return_id BIGINT UNSIGNED NOT NULL; return_quota_subject_id BIGINT UNSIGNED NOT NULL; invoice_line_id BIGINT UNSIGNED NOT NULL; invoice_component_id BIGINT UNSIGNED NULL; quantity DECIMAL(18,3) NOT NULL; refund_amount BIGINT NOT NULL; returned_cost_amount BIGINT NOT NULL; restock_disposition VARCHAR(20) NOT NULL; reason VARCHAR(255) NULL. Index (invoice_line_id). Refund derived server-side from immutable invoice and discount allocation; service line has no inventory restore. Returned goods may be restockable or quarantined; policy required.

### 6.9 `return_quota_subjects`
return_quota_subject_id BIGINT UNSIGNED PK; quota_key VARCHAR(180) NOT NULL UNIQUE; invoice_line_id BIGINT UNSIGNED NOT NULL; invoice_component_id BIGINT UNSIGNED NULL; subject_type VARCHAR(20) NOT NULL; sold_quantity DECIMAL(18,3) NOT NULL; reserved_quantity DECIMAL(18,3) NOT NULL DEFAULT 0; approved_quantity DECIMAL(18,3) NOT NULL DEFAULT 0; updated_at_utc DATETIME(3) NOT NULL; version BIGINT UNSIGNED NOT NULL. One subject represents one returnable unit: service/non-package line uses the line; medicine component in a package uses the component. quota_key is deterministic (for example line:<line_id> or component:<component_id>). Lock all relevant subject rows in a stable order for submit/finalize/cancel. Enforce active reservations + approved quantity ≤ sold quantity in the domain transaction.

### 6.10 `refund_obligations`
refund_obligation_id BIGINT UNSIGNED PK; sales_return_id BIGINT UNSIGNED NOT NULL UNIQUE; amount_due BIGINT NOT NULL; amount_paid BIGINT NOT NULL DEFAULT 0; status VARCHAR(16) NOT NULL; approved_at_utc DATETIME(3) NOT NULL; approved_by_user_id VARCHAR(64) NOT NULL. Refund liability created on Pimpinan final approval, not on cashier proposal.

### 6.11 `refund_payments`
refund_payment_id BIGINT UNSIGNED PK; refund_obligation_id BIGINT UNSIGNED NOT NULL; payment_method VARCHAR(24) NOT NULL; amount BIGINT NOT NULL; reference_no VARCHAR(100) NULL; paid_at_utc DATETIME(3) NOT NULL; paid_by_user_id VARCHAR(64) NOT NULL; idempotency_key VARCHAR(100) NOT NULL UNIQUE. Index (refund_obligation_id,paid_at_utc). Partial payouts policy; cash/bank ledger atomic. Transfer reference required for transfer. Prevent paid amount > obligation and duplicate payout.

### 6.12 `invoice_cancellation_requests`
cancellation_request_id BIGINT UNSIGNED PK; invoice_id BIGINT UNSIGNED NOT NULL; requested_by_user_id VARCHAR(64) NOT NULL; reason VARCHAR(255) NOT NULL; status VARCHAR(16) NOT NULL; requested_at_utc DATETIME(3) NOT NULL; decided_by_user_id VARCHAR(64) NULL; decided_at_utc DATETIME(3) NULL; rejection_reason VARCHAR(255) NULL; legacy_id VARCHAR(128) NULL. Index (invoice_id,status). Keep request history; do not hard-delete.

### 6.13 `invoice_cancellation_events`
cancellation_event_id BIGINT UNSIGNED PK; cancellation_request_id BIGINT UNSIGNED NOT NULL; event_type VARCHAR(20) NOT NULL; actor_user_id VARCHAR(64) NOT NULL; reason VARCHAR(255) NULL; occurred_at_utc DATETIME(3) NOT NULL. Approval locks invoice + quota + batches, checks return conflict, writes reversal movements/ledger and marks invoice cancelled exactly once.

## 7. Domain supplier credit, payable and payments

### 7.1 `supplier_returns`
supplier_return_id BIGINT UNSIGNED PK; public_id VARCHAR(80) UNIQUE; legacy_id VARCHAR(128) NULL; supplier_invoice_id BIGINT UNSIGNED NOT NULL; status VARCHAR(20) NOT NULL; reason VARCHAR(255) NOT NULL; requested_by_user_id VARCHAR(64) NOT NULL; approved_by_user_id VARCHAR(64) NULL; requested_at_utc DATETIME(3) NOT NULL; approved_at_utc DATETIME(3) NULL. Index (supplier_invoice_id,status).

### 7.2 `supplier_return_lines`
supplier_return_line_id BIGINT UNSIGNED PK; supplier_return_id BIGINT UNSIGNED NOT NULL; supplier_invoice_line_id BIGINT UNSIGNED NOT NULL; batch_id BIGINT UNSIGNED NOT NULL; quantity DECIMAL(18,3) NOT NULL; unit_cost_snapshot BIGINT NOT NULL; credit_amount BIGINT NOT NULL. Validate quantity against original received quantity, previous returns, and current batch balance under locks. Reject over-limit; never silently Math.min-cap.

### 7.3 `supplier_credit_notes`
supplier_credit_note_id BIGINT UNSIGNED PK; supplier_return_id BIGINT UNSIGNED NOT NULL UNIQUE; supplier_invoice_id BIGINT UNSIGNED NOT NULL; credit_amount BIGINT NOT NULL; status VARCHAR(16) NOT NULL; issued_at_utc DATETIME(3) NULL; accepted_at_utc DATETIME(3) NULL; reference_no VARCHAR(100) NULL. Credit recognition timing and supplier confirmation workflow need owner policy.

### 7.4 `supplier_payments`
supplier_payment_id BIGINT UNSIGNED PK; supplier_id BIGINT UNSIGNED NOT NULL; payment_date DATE NOT NULL; payment_method VARCHAR(24) NOT NULL; amount BIGINT NOT NULL; reference_no VARCHAR(100) NULL; paid_at_utc DATETIME(3) NOT NULL; paid_by_user_id VARCHAR(64) NOT NULL; idempotency_key VARCHAR(100) NOT NULL UNIQUE; status VARCHAR(16) NOT NULL. Index (supplier_id,payment_date).

### 7.5 `supplier_payment_allocations`
allocation_id BIGINT UNSIGNED PK; supplier_payment_id BIGINT UNSIGNED NOT NULL; supplier_invoice_id BIGINT UNSIGNED NOT NULL; amount_allocated BIGINT NOT NULL. Unique (supplier_payment_id,supplier_invoice_id). Validate allocations <= payment and payable balance. Partial payments are target capability; source legacy only has paid boolean, so historical allocations cannot be invented.

## 8. Domain audit, idempotency, outbox, files dan backups

### 8.1 `audit_events`
audit_event_id BIGINT UNSIGNED PK; event_uuid CHAR(36) NOT NULL UNIQUE; actor_user_id VARCHAR(64) NULL; actor_role_snapshot VARCHAR(24) NULL; action_code VARCHAR(80) NOT NULL; entity_type VARCHAR(60) NOT NULL; entity_id VARCHAR(100) NOT NULL; before_json JSON NULL; after_json JSON NULL; reason VARCHAR(255) NULL; request_id VARCHAR(100) NOT NULL; occurred_at_utc DATETIME(3) NOT NULL; source_ip_hash VARCHAR(128) NULL. Index (entity_type,entity_id,occurred_at_utc), (actor_user_id,occurred_at_utc), (occurred_at_utc). Never store password/token/secrets; redact patient PII from diffs unless strictly required. Application DB role cannot update/delete.

### 8.2 `idempotency_requests`
idempotency_id BIGINT UNSIGNED PK; actor_user_id VARCHAR(64) NOT NULL; command_name VARCHAR(100) NOT NULL; idempotency_key VARCHAR(100) NOT NULL; request_hash CHAR(64) NOT NULL; status VARCHAR(16) NOT NULL; response_code SMALLINT NULL; response_json JSON NULL; entity_type VARCHAR(60) NULL; entity_id VARCHAR(100) NULL; created_at_utc DATETIME(3) NOT NULL; expires_at_utc DATETIME(3) NULL. Unique (actor_user_id,command_name,idempotency_key). Same key with different request hash must reject. Retention long enough for retry and audit needs.

### 8.3 `outbox_jobs`
outbox_job_id BIGINT UNSIGNED PK; job_type VARCHAR(60) NOT NULL; aggregate_type VARCHAR(60) NOT NULL; aggregate_id VARCHAR(100) NOT NULL; payload_json JSON NOT NULL; status VARCHAR(16) NOT NULL; attempts INT UNSIGNED NOT NULL DEFAULT 0; available_at_utc DATETIME(3) NOT NULL; locked_at_utc DATETIME(3) NULL; completed_at_utc DATETIME(3) NULL; last_error_code VARCHAR(80) NULL; created_at_utc DATETIME(3) NOT NULL. Index (status,available_at_utc). Use for WhatsApp notification preparation, exports and display invalidation; WhatsApp remains user-send composer unless explicit provider integration is approved.

### 8.4 `stored_files`
stored_file_id BIGINT UNSIGNED PK; file_type VARCHAR(32) NOT NULL; object_key VARCHAR(512) NOT NULL UNIQUE; original_name VARCHAR(255) NULL; mime_type VARCHAR(100) NOT NULL; size_bytes BIGINT UNSIGNED NOT NULL; sha256 CHAR(64) NOT NULL; access_scope VARCHAR(24) NOT NULL; created_by_user_id VARCHAR(64) NOT NULL; created_at_utc DATETIME(3) NOT NULL; deleted_at_utc DATETIME(3) NULL. Private object storage; signed short-lived URLs; patient exports require access audit and expiry.

### 8.5 `backup_jobs`
backup_job_id BIGINT UNSIGNED PK; backup_type VARCHAR(24) NOT NULL; status VARCHAR(20) NOT NULL; started_at_utc DATETIME(3) NULL; completed_at_utc DATETIME(3) NULL; object_key VARCHAR(512) NULL; checksum_sha256 CHAR(64) NULL; size_bytes BIGINT UNSIGNED NULL; initiated_by_user_id VARCHAR(64) NULL; verified_restore_at_utc DATETIME(3) NULL; notes VARCHAR(255) NULL. Backup artifact storage/encryption/retention is not replaced by SQL metadata. Restore dry-run, owner approval and protected-user invariants mandatory.

### 8.6 `export_jobs`
export_job_id BIGINT UNSIGNED PK; report_type VARCHAR(60) NOT NULL; filter_json JSON NOT NULL; status VARCHAR(20) NOT NULL; requested_by_user_id VARCHAR(64) NOT NULL; object_key VARCHAR(512) NULL; expires_at_utc DATETIME(3) NULL; created_at_utc DATETIME(3) NOT NULL; completed_at_utc DATETIME(3) NULL. Enforce role scope, data minimization, CSV formula-injection protection and file expiry.

## 9. Relationships and delete policy

| Parent | Child | Cardinality | Delete/update policy |
|---|---|---|---|
| users | user_emails / role_assignments | 1:N | RESTRICT; close validity instead |
| users | shifts / invoices / audit events | 1:N | RESTRICT; deactivate user |
| patients | encounters | 1:N | RESTRICT; archive patient |
| encounters | queue_tickets / invoices | 1:N | RESTRICT; status transition |
| queue_tickets | queue_call_events | 1:N | RESTRICT; append events |
| shifts | invoices / petty cash / reconciliation | 1:N / 1:1 | RESTRICT |
| medicines | batches / invoice lines / movements | 1:N | RESTRICT; deactivate master |
| batches | movements / allocations | 1:N | RESTRICT |
| suppliers | supplier invoices | 1:N | RESTRICT |
| supplier invoices | lines / payments / returns | 1:N | RESTRICT |
| invoices | lines / payments / returns / cancellation requests | 1:N | RESTRICT |
| invoice lines | components / allocations / return quota subjects / return lines | 1:N | RESTRICT |
| returns | return lines / refund obligation | 1:N / 1:1 | RESTRICT |
| refund obligation | refund payments | 1:N | RESTRICT |
| expenses | expense events | 1:N | RESTRICT |
| stocktakes | stocktake lines | 1:N | RESTRICT |

Physical DELETE reserved for unreferenced drafts and temporary artifacts under policy. Financial, stock, identity, invoice and audit history uses status/reversal/archive, not cascade delete.

## 10. Command transaction boundaries

| Command | Rows/records locked | Atomic writes |
|---|---|---|
| Register patient + queue | queue counter, cashier shift, patient/encounter | patient if new, encounter, ticket, sequence increment, audit |
| Open shift | active shift slot, user | shift, active slot, audit |
| Close shift | shift, cash ledger rows | immutable reconciliation snapshot, shift state, audit, outbox |
| Checkout | encounter, shift, invoice idempotency, medicine balances, FEFO batches, return quota if needed | invoice/header/lines/components/discounts/payments, inventory movements and balances, encounter done, cash/bank ledger, audit |
| Purchase receive | supplier invoice, medicine, weighted-average balance | invoice/lines, batches, movements, stock/HPP projection, payable, audit |
| Supplier return | invoice line, batch, return remainder, payable | return + lines, negative movements, credit note/credit balance, audit |
| Submit return | invoice, invoice lines, component-aware quota subject rows | return + lines, reserved quota, append-only return event, audit |
| Admin review return | return | review event/status only; append-only sales_return_events + audit; no stock or cash movement |
| Finalize return | return, invoice, component-aware quota subjects, batch allocations | approved status, quota, append-only sales_return_events, stock movement/restock/quarantine, refund obligation, revenue/COGS projection, audit |
| Pay refund | refund obligation, idempotency | refund payment, cash/bank ledger, obligation balance, audit |
| Approve cancellation | invoice, cancellation request, return quotas, batches | cancel event/status, inventory reversals, cash/revenue reversals as policy, encounter state, audit |
| Expense approval | expense, approval policy | event/status, expense ledger, audit |
| Stocktake approval | stocktake, batch/medicine rows | adjustment movements, balance projection, audit |

All commands rollback fully on failure. External messages/files are outbox jobs after commit; no network call inside SQL transaction.

## 11. Reporting definitions and reconciliation controls

1. **Omzet kotor** = sum active invoice line gross amounts less invoice discounts, before returns according to report label.
2. **Omzet bersih** = omzet kotor minus final approved returns; cancelled invoices excluded exactly once.
3. **HPP penjualan** = immutable sold cost snapshot minus cost of inventory actually restored on approved goods returns; service HPP per policy.
4. **Laba kotor** = omzet bersih - HPP.
5. **Laba operasional** = laba kotor - approved operating expenses - recognized loss/other costs per policy. Petty cash cannot be counted twice.
6. **Refund obligation** recognized at final approval; **refund cash paid** recognized only when actually paid.
7. **Kas laci** = opening float + cash receipts - cash petty payouts - cash refund payouts +/- cash adjustments. Opening float is never omzet.
8. **Bank balance movement** separated from cash drawer; transfers between own accounts are not revenue/expense.
9. **Accounts payable** = received supplier invoices + debit adjustments - accepted supplier credits - allocated supplier payments.
10. **Stock batch balance** = opening + purchases + approved customer returns + cancellation restores + positive adjustments - sales - supplier returns - loss - negative adjustments.
11. **Medicine aggregate stock** = sum batch balances, with explicit policy for unbatched/opening stock and quarantined stock.
12. **Stock card** reads inventory_movements, never reconstructs history from current arrays.
13. Reports use Asia/Jakarta business date boundaries and same query/service definitions across UI, CSV and PDF.

Automated reconciliation jobs should flag, not silently repair: batch sum vs medicine balance; invoice line qty vs batch allocations; approved return qty vs quota; refund payments vs obligation; shift expected cash vs cash ledger; supplier payable vs invoices/credits/payments; stock ledger vs balance; report totals vs source ledger.

## 12. Firebase field-to-table mapping (initial)

| Legacy source | Candidate target | Migration rule |
|---|---|---|
| k_users | users, user_emails, role_assignments | Stable UID map; retain owner allowlist; unresolved identity quarantine |
| k_obat | medicines | Preserve legacy ID; compare stock to batch sum; no blind overwrite |
| k_tarif | tariffs | Preserve active/name/type/price snapshots |
| k_paket | service_packages, package_components | Expand components; unknown/nested components quarantine |
| k_pasien | patients, patient_encounters, queue_tickets | Separate person vs visit; deduplicate only by reviewed deterministic rule |
| k_trx | sales_invoices, lines, components, allocations, payments | Preserve immutable snapshots; missing batch deduction quarantine |
| k_batch | inventory_batches, inventory_movements | Preserve batch IDs and opening provenance |
| k_beli | supplier_invoices, lines | Legacy paid boolean maps to status only; do not fabricate payment allocations |
| k_returBeli | supplier_returns, lines, credit notes | Map exact purchase/batch; missing batch quarantine |
| k_returJual | sales_returns, lines, refund obligations/payments | Map status/actor/timestamps; never infer payout from approved return |
| k_returKuota | return_quota_subjects | Reconcile legacy item-index quotas to stable invoice-line/component subjects; unresolved mapping is quarantined |
| k_batalTrx | cancellation requests/events | Preserve decisions; reconcile invoice cancellation state |
| k_shift | cashier_shifts, shift_reconciliations | Derive business date from source semantics; preserve modal and close figures |
| k_petty | petty_cash_entries, cash ledger | Keep shift link; classify accounting treatment after policy decision |
| k_biaya | expenses, expense_events | Preserve status; approver actor may be unknown and must remain unknown |
| k_loss | loss_events, inventory movements | Exact batch required; orphan loss quarantine |
| k_log | audit_events | Preserve original event time/actor; no synthetic actor |
| klinik_config/settings | clinic_settings, display_configs, queue_counters | Separate settings from sequence; review defaults and placeholder values |
| queueAudioClip docs | queue_audio_assets + private object storage | Decode only after size/type/checksum validation; no public bucket |
| localStorage cache | not imported as authoritative | Compare only as supporting diagnostic; never overwrite cloud records |

ETL must be deterministic and idempotent. Keep source document path + source ID + source hash + migration batch ID in a migration mapping/staging area. Rejected rows go to quarantine with machine-readable reason and manual resolution. No silent defaulting of missing amounts, actors, patients, batch allocations or dates.

## 13. Proposed indexes and query patterns

This list is provisional; validate with EXPLAIN and realistic synthetic volume after schema approval:
- patients: (full_name), (phone); PII access remains controlled.
- encounters: (business_date,status), (cashier_user_id,business_date), (patient_id,business_date).
- queue tickets: UNIQUE (business_date,prefix,sequence_no); (business_date,status,prefix,sequence_no).
- shifts: (cashier_user_id,business_date,status); active slot PK by cashier.
- invoices: (business_date,invoice_status), (patient_id,business_date), (shift_id,created_at_utc), legacy_id is non-unique; canonical source identity is source-scoped.
- invoice lines: UNIQUE (invoice_id,line_no); (medicine_id).
- inventory batches: (medicine_id,expiry_date,remaining_quantity).
- inventory movements: (medicine_id,occurred_at_utc), (batch_id,occurred_at_utc), (source_type,source_id).
- returns: (invoice_id,status), return_quota_subjects UNIQUE quota_key; quota subject granular per invoice line atau komponen paket. Kunci seluruh quota subject terkait saat reservasi, persetujuan final, dan pembatalan.
- refund: UNIQUE sales_return_id; (refund_obligation_id,paid_at_utc).
- supplier AP: (supplier_id,invoice_date), (status,due_date).
- audit: (entity_type,entity_id,occurred_at_utc), (actor_user_id,occurred_at_utc).
- jobs: (status,available_at_utc).
Avoid indexes on every field; use measured workload and keep index write overhead low.

## 14. TiDB compatibility and implementation validation

Before approving DDL, run an isolated compatibility spike on the actual TiDB cluster:
- Confirm supported MySQL version, SQL modes, charset/collation and timezone behavior.
- Test FK enforcement and ON DELETE behavior.
- Test unique constraints and nullable unique columns.
- Test transactions, SELECT FOR UPDATE, deadlock/retry handling, isolation and concurrent last-stock sales.
- Test generated columns only if needed; avoid assuming partial indexes.
- Test JSON support and query plan if JSON snapshots used.
- Test DECIMAL arithmetic, rounding and BIGINT range.
- Test online DDL and rollback/backup behavior.
- Run EXPLAIN for queue registration, POS FEFO allocation, daily reports, patient search, stock card and audit queries.
- Verify TLS, least-privilege DB credentials, secret rotation, connection pooling and Vercel runtime limits.
- Database migrations run only from controlled CI/manual approval, never on app startup.
- Separate read/write credentials if practical; application DB user must not have DROP/ALTER privileges in runtime.

## 15. Decisions required before schema freeze

| ID | Decision | Recommended safe default | Owner confirmation needed |
|---|---|---|---|
| D01 | Quantity precision / units | DECIMAL(18,3) internally; validate permitted fractions | Yes |
| D02 | Patient master vs encounter | Separate patient and each visit | Confirm legacy semantics |
| D03 | Missing patient invoice | Quarantine or explicit legacy placeholder, never invent patient | Yes |
| D04 | Missing batch deduction | Quarantine/manual reconciliation; no fabricated batch | Yes |
| D05 | Returnable medicine disposition | Restore only verified resalable units; else quarantine | Yes |
| D06 | Package return allocation | Proportional snapshot with line/component-level cost/refund | Yes |
| D07 | Service return eligibility | Allow policy-based fee return, no stock movement | Yes |
| D08 | Expense self-approval | Creator cannot approve own expense above threshold | Yes |
| D09 | Petty cash classification | Cash movement separate; classify expense/advance per category | Yes |
| D10 | Supplier credit recognition date | On accepted credit note, not merely request | Yes |
| D11 | Supplier partial payments | Support allocation table; historical paid flag not fabricated | Yes |
| D12 | Shift verifier | Admin/Pimpinan per explicit rule | Yes |
| D13 | Refund payout | Pimpinan final approval and separate payout; transfer ref required | Confirm methods |
| D14 | Non-cash revenue date | Recognize at successful checkout/payment, settle separately | Yes |
| D15 | Opening stock/HPP | Opening balance as audited opening movement with evidence | Yes |
| D16 | Queue A/B and handoff | PR13 separately reviewed; preserve stable cashier assignment | Yes |
| D17 | Legacy timestamps | Store original value and normalized UTC where reliable; quarantine ambiguity | Yes |
| D18 | Archive/retention | Archive patient/master; immutable financial/stock history | Yes |
| D19 | Audit retention | Policy/legal review; never local 1,000-row cap | Yes |
| D20 | Auth provider | Keep Firebase Auth temporarily pending Functions provenance | Security approval |

## 16. Build sequence after approval

1. Resolve decision register and complete source-field union/type profiling.
2. Validate TiDB feature compatibility and security configuration.
3. Approve schema v1; create versioned migration files on isolated branch.
4. Apply DDL only to isolated preview database with synthetic fixture data.
5. Implement identity/session and read-only API first.
6. Implement patients/queue/shifts, then inventory/purchases, then POS, then returns/cancellation, then finance/reports, then Display/export/backup.
7. Execute unit, integration, concurrency, authorization, UI E2E and backup/restore tests; capture evidence.
8. Compare old Firebase and new TiDB outputs on synthetic fixtures and approved controlled test cases.
9. Only after explicit separate approval plan protected export, dry-run migration, reconciliation, cutover, rollback and post-cutover monitoring.

## 17. Status and exclusions

- Schema proposal only; not an approved final ERD.
- No SQL statements to execute are included.
- No database tables have been created by this document.
- No real patient/operational data has been read, copied or migrated.
- No production Firebase, production Vercel or PR #13 change.
- All acceptance tests remain pending execution unless separately evidenced.
- Source field dictionary is incomplete for historical documents until a protected full key/type profiling pass is performed.
- API route names, role scopes, finance policy, return policy, quantity precision, legacy mappings and TiDB-specific DDL must be reviewed before implementation.

## 18. Related audit documents

- [Master Blueprint](./MYSQL_MIGRATION_MASTER_BLUEPRINT.md)
- [Inventory](./MYSQL_MIGRATION_INVENTORY.md)
- [Deep dive](./MYSQL_MIGRATION_DEEP_DIVE_AUDIT.md)
- [Permission matrix and tests](./MYSQL_PERMISSION_MATRIX_AND_TESTS.md)
- [Root-cause/write path audit](./MYSQL_MIGRATION_ROOT_CAUSE_AUDIT.md)
- [Financial/inventory reconciliation](./MYSQL_MIGRATION_FINANCIAL_INVENTORY_RECONCILIATION_AUDIT.md)
- [Relational integrity/orphan audit](./MYSQL_MIGRATION_RELATIONAL_INTEGRITY_ORPHAN_AUDIT.md)
- [Screen role E2E test plan](./MYSQL_MIGRATION_SCREEN_ROLE_END_TO_END_TEST_PLAN.md)

---

## 19. Schema review amendment — 2026-11-15

The independent schema review is recorded in `MYSQL_MIGRATION_SCHEMA_REVIEW.md`. Its findings supersede conflicting draft details above before any DDL is generated.

Mandatory corrections for schema v1:
1. Remove the reverse `supplier_invoice_lines.batch_id` reference; use `inventory_batches.supplier_invoice_line_id` as the single one-to-one direction, or a dedicated allocation table if receipt-line splitting is required.
2. Replace global unique email history with active email claims plus historical `user_emails`.
3. Replace line-only `return_quotas` with component-aware `return_quota_subjects` and deterministic unique quota keys.
4. Enforce one active role with an explicit active slot/authoritative role field; ordinary indexes are insufficient.
5. Add composite cashier/shift integrity to `active_shift_slots`.
6. Add append-only `sales_return_events` for every return state transition.
7. Enforce invoice line target cardinality in server commands; add CHECK only after TiDB version testing.
8. Treat encounter as the source visit relation; invoice patient snapshot must agree when both exist.
9. Configure mysql2 BIGINT handling explicitly to avoid JavaScript precision loss.
10. Confirm batch splitting policy before choosing one-batch-per-purchase-line.

No DDL or application tables have been created by this amendment.


## 20. Consistency resolution — 2026-11-15

This section is the canonical interpretation where older draft paragraphs conflict with the schema review:

- Email history is non-unique; only active claims are globally unique in `active_email_claims`.
- One active role is enforced through `active_role_slots` (unless an explicit owner decision changes the single-role policy).
- Return limits are component-aware through `return_quota_subjects`; do not create or query a line-only unique quota.
- Active shift ownership is enforced by the composite (shift_id, cashier_user_id) relationship.
- Return state changes always append `sales_return_events`; status columns are current-state projections, not the full history.
- Cashier queue assignment overlap is prevented by a serialized domain command, not by an ordinary index.
- Supplier invoice line ↔ inventory batch is one-directional for the one-batch case; use an allocation bridge if split receipts are allowed.
- The detailed review in `MYSQL_MIGRATION_SCHEMA_REVIEW.md` supersedes every older conflicting draft paragraph. Any unresolved owner decision remains a release blocker and must not be silently defaulted.

The earlier sections are retained as audit history; this consistency section and section 19 govern schema v1 generation. No DDL is authorized by this document.


## 21. Legacy-draft conflict closure — 2026-11-15

The following older draft definitions are superseded and must not be copied into DDL:
- `supplier_invoice_lines.batch_id` is removed; the batch stores the receipt-line reference in `inventory_batches.supplier_invoice_line_id`.
- The old `return_quotas` table with unique `invoice_line_id` is removed; use `return_quota_subjects`.
- Active email and active role invariants are represented by explicit slot/claim tables in section 2.7.
- Return status history is represented by append-only `sales_return_events` in section 2.7.

This amendment is a design-document correction only. It does not authorize DDL and does not claim TiDB compatibility tests have passed.


## 22. Foreign-key closure notes — 2026-11-15

Schema v1 DDL must include composite parent keys and matching child FK types exactly as specified in sections 2.7–2.8. The one-to-one receipt-line/batch link requires a unique nullable batch-side FK. Every sales return line must reference exactly one quota subject; API validation must also confirm that its invoice_line_id and optional invoice_component_id match that subject. Legacy quota records map to quota subjects only after deterministic line/component mapping; otherwise quarantine. These are design requirements, not evidence that TiDB has accepted the DDL.



## 23. FK/index closure audit amendment — 2026-11-15

See [MYSQL_MIGRATION_FOREIGN_KEY_INDEX_CLOSURE_AUDIT.md](./MYSQL_MIGRATION_FOREIGN_KEY_INDEX_CLOSURE_AUDIT.md). This audit found that section 9 is only a domain-level relationship summary, not a complete column-level FK specification. Before DDL v1, the schema must gain a canonical catalogue containing every child FK column tuple, exact parent candidate/unique key, matching types and nullability, child supporting index, ON DELETE/UPDATE policy, and same-parent invariant.

Mandatory closure items include:
- Composite cashier/shift ownership for encounters, invoices, active shift slots and petty cash where both identities are stored.
- Composite medicine/batch and purchase-line/batch integrity for movements, losses, stocktakes, invoice allocations and supplier returns.
- Composite invoice/line/component/quota subject integrity for discount allocations and customer returns.
- Supplier identity consistency across supplier payments, invoice allocations and supplier credit notes.
- Explicit actor FKs and self-FKs for reversal records, plus clarification of `petty_cash_entries.reversed_by_entry_id`.
- Supporting child indexes for every FK and reverse lookup; indexes must be measured with EXPLAIN.
- Add `sales_return_events` to the relationship and index catalogues.
- Document polymorphic references as intentionally non-FK and provide typed source validation/reconciliation.

This amendment does not authorize DDL. It records blockers discovered by static review; TiDB FK/index behavior remains untested.


## 24. Key/type/concurrency closure amendment — 2026-11-15

See [MYSQL_MIGRATION_KEY_TYPE_CONCURRENCY_CLOSURE_AUDIT.md](./MYSQL_MIGRATION_KEY_TYPE_CONCURRENCY_CLOSURE_AUDIT.md). Additional blockers:
- Add a stable queue-prefix guard row; locking a cashier alone cannot prevent two different cashiers from claiming overlapping dates for the same prefix.
- Specify a first-use-safe queue counter initialization/increment algorithm; a missing counter row is not safely serialized by assuming a gap lock.
- Enumerate composite parent unique keys and matching same-parent FKs for invoice lines/components, medicine/batch, supplier payment/invoice and shift/cashier.
- Model return quota reservation/release as an idempotent, auditable association/event; aggregate counters alone do not prove exactly-once release.
- Define actor NULL/system semantics, email collation/normalization, role scope and ticket cancellation/reissue behavior.
- Confirm whether supplier receipt lines can split across expiry/lot/partial deliveries before selecting one-batch-per-line.

These are design gates only. No TiDB runtime compatibility is claimed and no DDL is authorized.


## 25. Data type, nullability and orphan/duplicate closure — 2026-11-15

See [MYSQL_MIGRATION_DATA_TYPE_NULLABILITY_ORPHAN_DUPLICATE_CLOSURE_AUDIT.md](./MYSQL_MIGRATION_DATA_TYPE_NULLABILITY_ORPHAN_DUPLICATE_CLOSURE_AUDIT.md) and [MYSQL_MIGRATION_CANONICAL_FK_INDEX_CATALOGUE.md](./MYSQL_MIGRATION_CANONICAL_FK_INDEX_CATALOGUE.md). The type/nullability pass records that a complete physical column manifest is still missing; user ID representation, quantity base units/scale, legacy ID source scoping, collations, lifecycle nullability, timestamp provenance and several composite same-parent invariants are not frozen. The FK catalogue is a candidate review matrix, not approved DDL. Orphan/duplicate checks are specified but have not been run against historical clinic data.

DDL remains blocked pending owner policy decisions, exact source-field profiling, full column/FK type manifest, and actual TiDB compatibility testing.

## 26. Contradiction and source-identity closure — 2026-11-15

See [MYSQL_MIGRATION_SCHEMA_CONTRADICTION_SOURCE_IDENTITY_CLOSURE_AUDIT.md](./MYSQL_MIGRATION_SCHEMA_CONTRADICTION_SOURCE_IDENTITY_CLOSURE_AUDIT.md). The detailed cross-check identified unresolved source-scoped legacy IDs, same-parent FK gaps in encounters/invoices/stock allocations/returns/supplier finance, queue first-use/overlap races, polymorphic ledger references, mutable projection controls, timestamp provenance and reconciliation versioning. A candidate `migration_source_records` mapping table is proposed to preserve source collection/path identity and idempotency. This is design review only; it is not DDL.

The proposal remains blocked until these corrections, owner decisions, full source-field profiling and TiDB compatibility tests are completed.


## 11. Technical amendment addendum — 2026-11-15 (supersedes conflicting draft wording)

This addendum applies the technical design candidates in [MYSQL_MIGRATION_SCHEMA_V1_DECISION_CLOSURE_DRAFT.md](./MYSQL_MIGRATION_SCHEMA_V1_DECISION_CLOSURE_DRAFT.md). It is still a review proposal, not approved DDL. If earlier sections conflict, use this addendum as the current candidate design; do not silently generate SQL until the exact FK/type/index manifest and owner policy gates are closed.

### 11.1 Canonical identity and actor provenance
- Freeze candidate internal `user_id` as `VARCHAR(64)` everywhere, including every actor/user FK. It is immutable and never derived from email.
- Keep provider identities (Firebase UID, future provider subject) in a separate provider-identity mapping with unique (provider, provider_subject); never use email as FK.
- This schema is single-clinic. `active_role_slots` is one active role per user in Klinik Assalaam Palembang; reject unsupported scope values in the API. Multi-clinic tenancy requires a later versioned redesign.
- Event/audit actor provenance must distinguish human, system, import and unknown legacy actors. Human actors reference `users.user_id`; system/import use explicit service principals; unknown historical actors remain unknown. Do not invent a staff identity to satisfy a FK.
- Protect the five owner-confirmed accounts exactly: `assalamkasir1@gmail.com`, `assalamkasir2@gmail.com`, `assalamadmin@gmail.com`, `praktekrose@gmail.com`, `nursalim422@gmail.com`. Verify provider UID + email + user mapping + role before identity changes. This is a protection rule, not proof of current provisioning.

### 11.2 Legacy identity and dummy data handling
- A bare `legacy_id` is not globally unique across source collections. Canonical source identity is `(source_system, source_collection, source_document_id)` in `migration_source_records`; target-domain `legacy_id` is non-unique unless a source-specific uniqueness proof exists.
- Owner confirmed that all old Firebase operational records are development dummy data. Do not import them as genuine clinic/patient/financial history. Use them only for structural audit or controlled regression fixtures; use new deterministic synthetic fixtures for TiDB tests.
- Snapshot/cleanup remains a separate pre-release activity: private encrypted snapshot, verified restore, read-only five-account identity check, path-level deletion dry-run, explicit final approval, then selective deletion of approved dummy operational documents. No cleanup or Auth bulk deletion is authorized now.

### 11.3 Queue concurrency
- Add `queue_prefix_guards(prefix PRIMARY KEY, version, updated_at_utc)` with fixed guard rows for A and B. Assignment commands lock affected user and prefix guards in deterministic order, reject overlapping validity ranges, and append an assignment event in the same transaction.
- First queue-counter initialization must be race-safe (serialized daily initialization or insert-if-absent + duplicate retry + locking read). Do not depend on locking a missing row.
- Ticket allocation, counter update, encounter association, idempotency and audit are one transaction. Cancelled numbers remain consumed. Reissue creates a new ticket linked to the prior ticket; it never recycles a number.
- A/B remain separate queues; cashier selection/display switching is a UI/config concern. PR #13 remains unmerged and must pass separate regression review before any code adoption.

### 11.4 Return quota, ledger and idempotency
- Add append-only `sales_return_quota_events` to record reserve/release/approve/consume/reversal effects by quota subject and return line, including quantity delta, actor provenance, timestamp and idempotency identity. Aggregate quota counters are projections rebuildable from these events.
- Every return line must reference exactly one quota subject; component-aware composite constraints must prove the subject, invoice line and optional package component are the same source.
- Financial/inventory/queue commands require durable domain event IDs. Do not expire idempotency protection while a replay could create duplicate stock or money effects.
- Stock, batch, supplier-credit, refund-paid and shift-cash balances are projections owned by server commands and rebuilt/reconciled from append-only events; browser-provided balances are never accepted.

### 11.5 Composite integrity and FK manifest
Use composite parent UNIQUE keys and matching composite FKs whenever ownership must be consistent across multiple columns. Required pairs include cashier+shift, encounter+patient, receipt-line+medicine, batch+medicine, invoice-line+invoice, component+invoice-line, quota-subject+line+component, payment+supplier, supplier invoice+supplier, supplier return+invoice and credit note+return/invoice. Add child indexes with exact FK column order. Reject partially NULL composite tuples.

The next schema pass must create a complete per-FK manifest with exact child/parent types, signedness, length/precision, charset/collation, nullability/default, parent PK/UNIQUE, child index, ON DELETE/UPDATE, same-parent invariant, and test IDs. Any missing FK or child index blocks DDL.

### 11.6 Remaining policy blockers
Do not freeze physical schema until D01–D20 decisions in the schema review are resolved or explicitly quarantined from v1. Split/partial supplier receipt behavior remains a specific blocker: if one purchase line may create multiple deliveries/lots/expiry batches, use `supplier_invoice_line_batch_allocations` from v1 instead of enforcing one batch per line. Invoice-number scope and encounter ticket reissue lifecycle also require source/workflow verification.

### 11.7 Current status
No TiDB application DDL has been generated or applied. No compatibility runtime result is claimed. No real data import, Firebase mutation, Auth mutation, production deployment or PR #13 merge occurred.


## 27. FK/index reconciliation pass 2 — 2026-11-15

See [MYSQL_MIGRATION_FOREIGN_KEY_INDEX_RECONCILIATION_PASS2.md](./MYSQL_MIGRATION_FOREIGN_KEY_INDEX_RECONCILIATION_PASS2.md). The pass cross-checked the proposal's documented table definitions against the canonical FK/index candidate catalogue and prior type, nullability, source-identity and concurrency audits. It confirms that schema v1 remains blocked: the physical per-FK manifest is incomplete; encounter/patient/shift and invoice ownership chains are not fully constrained; invoice-component/batch/return-quota/supplier-finance same-parent relationships remain partly prose-only; queue guard/event tables are not integrated into the base table list; reversal/source idempotency and reconciliation versioning need exact rules; and the one-batch-per-receipt-line uniqueness is not approved while split/partial receipt behavior is unresolved.

The reconciliation also requires one canonical user ID type (`VARCHAR(64)`), complete actor provenance, ordered child indexes for every composite FK, explicit nullable tuple semantics, and `BIGINT UNSIGNED` for shared file-size metadata. The report enumerates candidate relationships by domain and exact correction gates. This is static document review only: no live metadata, orphan query, TiDB runtime test, DDL, data import, or deployment was performed. Do not generate or apply schema DDL until the exact normalized column/FK manifest and owner policy gates are closed.
