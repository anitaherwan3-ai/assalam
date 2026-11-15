# MYSQL/TiDB COLUMN DICTIONARY v0.1 — Klinik Assalaam Palembang

Tanggal: 2026-11-15  
Branch: `migration/tidb-foundation`  
Status: **EXTRACTED BASELINE — NOT APPROVED FOR DDL**

## 1. Tujuan dan batas

Dokumen ini mengekstrak definisi kolom kandidat dari domain schema proposal menjadi satu inventaris kolom terpusat. Tujuannya agar setiap tabel dan field dapat diperiksa silang terhadap koleksi Firebase, source callsite, relasi, role, aturan transaksi dan kebutuhan laporan.

**Status ini bukan schema freeze.** Definisi di bawah mempertahankan nama, tipe dan nullability yang tertulis dalam proposal pada saat ekstraksi. Jika proposal tidak menyebut default, index, FK, collation, precision policy, domain status atau sumber field, hal tersebut tidak boleh ditebak.

- Tidak ada DDL dijalankan.
- Tidak ada data Firebase/operasional dibaca, diekspor atau diimpor.
- Tidak ada perubahan pada `main`, production Vercel, Firebase production atau PR13.
- Hanya branch `migration/tidb-foundation` dan data sintetis yang diizinkan.
- Proposal dan audit penutupan yang lebih baru mengalahkan definisi lama yang bertentangan.
- Kolom `legacy_id` belum boleh dianggap unik global; identitas sumber harus dipetakan dengan source system + collection + document path/id.
- Semua tipe, FK, index, nullability, enum/status, collation dan batas angka masih menunggu penutupan audit/keputusan.

## 2. Cara membaca

- **PK / UNIQUE / INDEX** hanya ditandai jika eksplisit di proposal atau amendment yang berlaku.
- **NO/YES** mengikuti nullability yang tertulis; bila tidak dinyatakan, tandai **UNSPECIFIED**.
- `BIGINT` untuk uang adalah kandidat rupiah bulat; jangan ubah ke JavaScript Number tanpa perlindungan presisi.
- `DECIMAL(18,3)` kuantitas adalah kandidat, belum disetujui sebelum keputusan D01.
- `DATETIME(3)` dimaksudkan UTC, tetapi session timezone dan konversi harus dibuktikan pada TiDB.
- Status, code, role, direction, type, scope dan enum belum dianggap final kecuali disebut sebagai invariant eksplisit.
- Tabel opsional/PR13 gate tidak masuk DDL sampai keputusan terpisah.

## 3. Inventaris definisi kolom per domain

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
patient_id BIGINT UNSIGNED PK; public_id VARCHAR(80) NOT NULL UNIQUE; legacy_id VARCHAR(128) NULL UNIQUE; full_name VARCHAR(160) NOT NULL; phone VARCHAR(32) NULL; birth_date DATE NULL; sex_code VARCHAR(16) NULL; address TEXT NULL; archived_at_utc DATETIME(3) NULL; archived_by_user_id VARCHAR(64) NULL; created_at_utc DATETIME(3) NOT NULL; created_by_user_id VARCHAR(64) NOT NULL; updated_at_utc DATETIME(3) NOT NULL; version BIGINT UNSIGNED NOT NULL. PII restricted. Sex/date/address fields are candidates only if source and clinic policy confirm; do not invent values during migration.

### 3.2 `patient_encounters`
encounter_id BIGINT UNSIGNED PK; public_id VARCHAR(80) NOT NULL UNIQUE; legacy_id VARCHAR(128) NULL UNIQUE; patient_id BIGINT UNSIGNED NULL; business_date DATE NOT NULL; service_name_snapshot VARCHAR(120) NULL; cashier_user_id VARCHAR(64) NOT NULL; shift_id BIGINT UNSIGNED NULL; status VARCHAR(24) NOT NULL; completed_at_utc DATETIME(3) NULL; cancelled_at_utc DATETIME(3) NULL; cancellation_reason VARCHAR(255) NULL; created_at_utc DATETIME(3) NOT NULL; updated_at_utc DATETIME(3) NOT NULL. FK patient RESTRICT/SET NULL policy must be decided; FK actor and shift RESTRICT. Index (business_date,status), (patient_id,business_date), (cashier_user_id,business_date). Distinguish Batal Berobat from archive and invoice cancellation. Checkout must reject missing patient if required by final clinic policy; legacy orphan invoices quarantined.

### 3.3 `queue_counters`
business_date DATE NOT NULL; prefix VARCHAR(4) NOT NULL; last_sequence INT UNSIGNED NOT NULL; updated_at_utc DATETIME(3) NOT NULL. Composite PK (business_date,prefix). Allocate inside transaction with row lock; sequence formatted A-001 etc. Must handle concurrency and rollover.

### 3.4 `cashier_queue_assignments`
assignment_id BIGINT UNSIGNED PK; user_id VARCHAR(64) NOT NULL; prefix VARCHAR(4) NOT NULL; valid_from DATE NOT NULL; valid_to DATE NULL; assigned_by_user_id VARCHAR(64) NOT NULL; created_at_utc DATETIME(3) NOT NULL. Index (user_id,valid_to), (prefix,valid_to). Defaults: stable cashier ID kasir → A; kasir2 → B. Only Pimpinan changes mapping. Perubahan assignment wajib mengunci user dan prefix terkait, menolak rentang validitas yang tumpang tindih, serta mencatat event. If PR13 is not accepted, main baseline remains A-only until approved.

### 3.5 `queue_tickets`
queue_ticket_id BIGINT UNSIGNED PK; public_id VARCHAR(80) NOT NULL UNIQUE; legacy_id VARCHAR(128) NULL UNIQUE; encounter_id BIGINT UNSIGNED NOT NULL; business_date DATE NOT NULL; prefix VARCHAR(4) NOT NULL; sequence_no INT UNSIGNED NOT NULL; display_number VARCHAR(20) NOT NULL; status VARCHAR(20) NOT NULL; registered_at_utc DATETIME(3) NOT NULL; registered_by_user_id VARCHAR(64) NOT NULL; called_at_utc DATETIME(3) NULL; completed_at_utc DATETIME(3) NULL. Unique (business_date,prefix,sequence_no); unique encounter_id if one ticket per encounter is confirmed. Index (business_date,status,prefix,sequence_no). Queue ticket lifecycle separate from patient and encounter.

### 3.6 `queue_call_events`
call_event_id BIGINT UNSIGNED PK; queue_ticket_id BIGINT UNSIGNED NOT NULL; event_type VARCHAR(16) NOT NULL (call/recall/cancel); counter_label VARCHAR(40) NULL; event_idempotency_key VARCHAR(100) NOT NULL UNIQUE; actor_user_id VARCHAR(64) NOT NULL; occurred_at_utc DATETIME(3) NOT NULL. Index (queue_ticket_id,occurred_at_utc). Immutable event log; TV deduplicates event ID.

### 3.7 `patient_handoffs` (OPTIONAL — PR13 GATE)
handoff_id BIGINT UNSIGNED PK; encounter_id BIGINT UNSIGNED NOT NULL; from_user_id VARCHAR(64) NOT NULL; to_user_id VARCHAR(64) NOT NULL; from_shift_id BIGINT UNSIGNED NOT NULL; to_shift_id BIGINT UNSIGNED NOT NULL; reason VARCHAR(255) NULL; approved_at_utc DATETIME(3) NOT NULL; created_at_utc DATETIME(3) NOT NULL. Add only if PR13 handoff behavior is separately approved. Transaction locks encounter and target shift and revalidates target shift open.

## 4. Domain shift, drawer dan finance

### 4.1 `cashier_shifts`
shift_id BIGINT UNSIGNED PK; public_id VARCHAR(80) NOT NULL UNIQUE; legacy_id VARCHAR(128) NULL UNIQUE; cashier_user_id VARCHAR(64) NOT NULL; business_date DATE NOT NULL; opened_at_utc DATETIME(3) NOT NULL; opening_float BIGINT NOT NULL DEFAULT 0; status VARCHAR(16) NOT NULL; closed_at_utc DATETIME(3) NULL; closed_by_user_id VARCHAR(64) NULL; created_at_utc DATETIME(3) NOT NULL. Index (cashier_user_id,business_date,status), (business_date,status). Satu shift aktif per kasir ditegakkan lewat active_shift_slots atau lock row; bukan partial unique index.

### 4.2 `active_shift_slots`
cashier_user_id VARCHAR(64) PK; shift_id BIGINT UNSIGNED NOT NULL UNIQUE; acquired_at_utc DATETIME(3) NOT NULL. Dibuat/dihapus dalam transaksi buka/tutup shift. FK ke user dan shift RESTRICT. Tambahkan unique key pada cashier_shifts(shift_id,cashier_user_id) dan composite FK active_shift_slots(shift_id,cashier_user_id) agar shift yang dikunci pasti milik kasir yang sama. Mekanisme ini mencegah dua shift terbuka; uji crash/retry dan konsistensi status shift.

### 4.3 `shift_reconciliations`
reconciliation_id BIGINT UNSIGNED PK; shift_id BIGINT UNSIGNED NOT NULL UNIQUE; system_cash BIGINT NOT NULL; counted_cash BIGINT NOT NULL; variance BIGINT NOT NULL; verified_by_user_id VARCHAR(64) NULL; verified_at_utc DATETIME(3) NULL; verification_status VARCHAR(16) NOT NULL; snapshot_json JSON NULL; created_at_utc DATETIME(3) NOT NULL. Store snapshot of formula inputs and version; Admin/Pimpinan verifier according to approved policy. Variance = counted - system. No overwrite after verified; correction event instead.

### 4.4 `cash_ledger_entries`
cash_entry_id BIGINT UNSIGNED PK; business_date DATE NOT NULL; shift_id BIGINT UNSIGNED NULL; account_code VARCHAR(32) NOT NULL; direction VARCHAR(8) NOT NULL; amount BIGINT NOT NULL; source_type VARCHAR(32) NOT NULL; source_id VARCHAR(80) NOT NULL; payment_method VARCHAR(24) NOT NULL; occurred_at_utc DATETIME(3) NOT NULL; actor_user_id VARCHAR(64) NOT NULL; reversal_of_entry_id BIGINT UNSIGNED NULL; idempotency_key VARCHAR(100) NOT NULL UNIQUE. Index (business_date,account_code), (shift_id,occurred_at_utc), (source_type,source_id). Amount positive; direction controls sign. Cash drawer receipts/refunds/petty/adjustments only; bank/QRIS separated by account. No physical delete; reverse with linked entry.

### 4.5 `bank_ledger_entries`
bank_entry_id BIGINT UNSIGNED PK; business_date DATE NOT NULL; bank_account_code VARCHAR(32) NOT NULL; direction VARCHAR(8) NOT NULL; amount BIGINT NOT NULL; source_type VARCHAR(32) NOT NULL; source_id VARCHAR(80) NOT NULL; reference_no VARCHAR(100) NULL; occurred_at_utc DATETIME(3) NOT NULL; actor_user_id VARCHAR(64) NOT NULL; reversal_of_entry_id BIGINT UNSIGNED NULL; idempotency_key VARCHAR(100) NOT NULL UNIQUE. Index (business_date,bank_account_code), (source_type,source_id). Bank transfers are not cash drawer movements.

### 4.6 `petty_cash_entries`
petty_cash_id BIGINT UNSIGNED PK; legacy_id VARCHAR(128) NULL UNIQUE; shift_id BIGINT UNSIGNED NOT NULL; cashier_user_id VARCHAR(64) NOT NULL; business_date DATE NOT NULL; description VARCHAR(255) NOT NULL; amount BIGINT NOT NULL; status VARCHAR(16) NOT NULL; created_at_utc DATETIME(3) NOT NULL; reversed_by_entry_id BIGINT UNSIGNED NULL. Index (shift_id,business_date), (cashier_user_id,business_date). Create corresponding cash ledger entry atomically. Editing/deleting old records after posting becomes reversal + replacement. Decide whether petty categories are expenses or advances/transfers to avoid double count.

### 4.7 `expenses`
expense_id BIGINT UNSIGNED PK; legacy_id VARCHAR(128) NULL UNIQUE; business_date DATE NOT NULL; category VARCHAR(80) NOT NULL; description VARCHAR(255) NOT NULL; amount BIGINT NOT NULL; status VARCHAR(16) NOT NULL; created_by_user_id VARCHAR(64) NOT NULL; approved_by_user_id VARCHAR(64) NULL; approved_at_utc DATETIME(3) NULL; created_at_utc DATETIME(3) NOT NULL; updated_at_utc DATETIME(3) NOT NULL; version BIGINT UNSIGNED NOT NULL. Index (business_date,status), (category,business_date). Approval threshold comes from server settings; approval event history separate. Policy required for Admin self-approval.

### 4.8 `expense_events`
expense_event_id BIGINT UNSIGNED PK; expense_id BIGINT UNSIGNED NOT NULL; event_type VARCHAR(20) NOT NULL; old_status VARCHAR(16) NULL; new_status VARCHAR(16) NOT NULL; reason VARCHAR(255) NULL; actor_user_id VARCHAR(64) NOT NULL; occurred_at_utc DATETIME(3) NOT NULL. Index (expense_id,occurred_at_utc). Immutable approval/rejection/reversal trail.

### 4.9 `loss_events`
loss_event_id BIGINT UNSIGNED PK; legacy_id VARCHAR(128) NULL UNIQUE; medicine_id BIGINT UNSIGNED NOT NULL; batch_id BIGINT UNSIGNED NOT NULL; quantity DECIMAL(18,3) NOT NULL; value_amount BIGINT NOT NULL; reason VARCHAR(255) NOT NULL; business_date DATE NOT NULL; actor_user_id VARCHAR(64) NOT NULL; occurred_at_utc DATETIME(3) NOT NULL; reversal_of_loss_id BIGINT UNSIGNED NULL. Loss writes inventory movement atomically; no hard delete.

## 5. Domain master obat, tarif, paket, supplier dan inventory

### 5.1 `medicines`
medicine_id BIGINT UNSIGNED PK; public_id VARCHAR(80) NOT NULL UNIQUE; legacy_id VARCHAR(128) NULL UNIQUE; sku VARCHAR(80) NULL; name VARCHAR(180) NOT NULL; unit_name VARCHAR(40) NOT NULL; selling_price BIGINT NOT NULL; weighted_avg_cost BIGINT NOT NULL DEFAULT 0; stock_on_hand DECIMAL(18,3) NOT NULL DEFAULT 0; active TINYINT(1) NOT NULL DEFAULT 1; min_stock DECIMAL(18,3) NULL; created_at_utc DATETIME(3) NOT NULL; updated_at_utc DATETIME(3) NOT NULL; version BIGINT UNSIGNED NOT NULL. Index (name), (active). Stock and HPP are projections, reconciled against batches and movements. Price/HPP must be server-controlled.

### 5.2 `tariffs`
tariff_id BIGINT UNSIGNED PK; public_id VARCHAR(80) UNIQUE; legacy_id VARCHAR(128) NULL UNIQUE; name VARCHAR(180) NOT NULL; service_type VARCHAR(80) NOT NULL; price BIGINT NOT NULL; active TINYINT(1) NOT NULL DEFAULT 1; created_at_utc DATETIME(3) NOT NULL; updated_at_utc DATETIME(3) NOT NULL; version BIGINT UNSIGNED NOT NULL. Historical invoice line stores immutable tariff name/type/price snapshot.

### 5.3 `service_packages`
package_id BIGINT UNSIGNED PK; public_id VARCHAR(80) UNIQUE; legacy_id VARCHAR(128) NULL UNIQUE; name VARCHAR(180) NOT NULL; package_type VARCHAR(80) NULL; price BIGINT NOT NULL; active TINYINT(1) NOT NULL DEFAULT 1; created_at_utc DATETIME(3) NOT NULL; updated_at_utc DATETIME(3) NOT NULL; version BIGINT UNSIGNED NOT NULL.

### 5.4 `package_components`
package_component_id BIGINT UNSIGNED PK; package_id BIGINT UNSIGNED NOT NULL; component_type VARCHAR(20) NOT NULL; medicine_id BIGINT UNSIGNED NULL; tariff_id BIGINT UNSIGNED NULL; component_name_snapshot VARCHAR(180) NOT NULL; unit_price_snapshot BIGINT NOT NULL; quantity DECIMAL(18,3) NOT NULL; sort_order INT NOT NULL DEFAULT 0. Index (package_id,sort_order). Validate exactly one target reference according to component_type. Package nested package behavior remains unknown; block nested packages until source proves and policy approves.

### 5.5 `suppliers`
supplier_id BIGINT UNSIGNED PK; public_id VARCHAR(80) UNIQUE; legacy_id VARCHAR(128) NULL UNIQUE; name VARCHAR(180) NOT NULL; phone VARCHAR(32) NULL; address TEXT NULL; active TINYINT(1) NOT NULL DEFAULT 1; created_at_utc DATETIME(3) NOT NULL; updated_at_utc DATETIME(3) NOT NULL.

### 5.6 `supplier_invoices`
supplier_invoice_id BIGINT UNSIGNED PK; public_id VARCHAR(80) UNIQUE; legacy_id VARCHAR(128) NULL UNIQUE; supplier_id BIGINT UNSIGNED NOT NULL; invoice_number VARCHAR(100) NOT NULL; invoice_date DATE NOT NULL; due_date DATE NULL; status VARCHAR(20) NOT NULL; gross_amount BIGINT NOT NULL; accepted_credit_amount BIGINT NOT NULL DEFAULT 0; created_by_user_id VARCHAR(64) NOT NULL; created_at_utc DATETIME(3) NOT NULL; updated_at_utc DATETIME(3) NOT NULL. Index (supplier_id,invoice_date), (status,due_date). Unique supplier+invoice number only if business confirms no duplicate supplier invoice numbers.

### 5.7 `supplier_invoice_lines`
supplier_invoice_line_id BIGINT UNSIGNED PK; supplier_invoice_id BIGINT UNSIGNED NOT NULL; medicine_id BIGINT UNSIGNED NOT NULL; quantity_received DECIMAL(18,3) NOT NULL; quantity_returned DECIMAL(18,3) NOT NULL DEFAULT 0; unit_cost BIGINT NOT NULL; line_total BIGINT NOT NULL; expiry_date DATE NULL; batch_number VARCHAR(100) NULL. Index (supplier_invoice_id), (medicine_id). Do not store batch_id on this line: the sole one-to-one link is inventory_batches.supplier_invoice_line_id, which must have a UNIQUE constraint for the one-to-one v1 policy. One receipt line → one batch is the v1 candidate; if split receipt is confirmed, replace with supplier_invoice_line_batch_allocations before DDL freeze.

### 5.8 `inventory_batches`
batch_id BIGINT UNSIGNED PK; public_id VARCHAR(80) UNIQUE; legacy_id VARCHAR(128) NULL UNIQUE; medicine_id BIGINT UNSIGNED NOT NULL; supplier_invoice_line_id BIGINT UNSIGNED NULL; batch_number VARCHAR(100) NULL; expiry_date DATE NULL; initial_quantity DECIMAL(18,3) NOT NULL; remaining_quantity DECIMAL(18,3) NOT NULL; unit_cost BIGINT NOT NULL; received_at_utc DATETIME(3) NOT NULL; status VARCHAR(20) NOT NULL DEFAULT 'active'. Index (medicine_id,expiry_date,remaining_quantity), UNIQUE (supplier_invoice_line_id). Preserve seed/opening stock provenance; NULL is permitted for opening/adjustment batches without a supplier receipt line. Never silently assign a missing historical batch.

### 5.9 `inventory_movements`
inventory_movement_id BIGINT UNSIGNED PK; movement_key VARCHAR(100) NOT NULL UNIQUE; medicine_id BIGINT UNSIGNED NOT NULL; batch_id BIGINT UNSIGNED NULL; movement_type VARCHAR(24) NOT NULL; quantity_delta DECIMAL(18,3) NOT NULL; unit_cost BIGINT NULL; value_delta BIGINT NULL; source_type VARCHAR(32) NOT NULL; source_id VARCHAR(80) NOT NULL; source_line_id VARCHAR(80) NULL; business_date DATE NOT NULL; actor_user_id VARCHAR(64) NOT NULL; occurred_at_utc DATETIME(3) NOT NULL; reversal_of_movement_id BIGINT UNSIGNED NULL. Index (medicine_id,occurred_at_utc), (batch_id,occurred_at_utc), (source_type,source_id). Append-only. Allowed movement types: opening, purchase_receive, sale, patient_return, supplier_return, loss, stocktake, adjustment, cancellation_restore. Movement sign and quantity precision validated in domain service.

### 5.10 `stocktakes` and `stocktake_lines`
stocktakes: stocktake_id BIGINT UNSIGNED PK; business_date DATE NOT NULL; status VARCHAR(20) NOT NULL; created_by_user_id VARCHAR(64) NOT NULL; approved_by_user_id VARCHAR(64) NULL; created_at_utc DATETIME(3) NOT NULL; approved_at_utc DATETIME(3) NULL.
stocktake_lines: stocktake_line_id BIGINT UNSIGNED PK; stocktake_id BIGINT UNSIGNED NOT NULL; medicine_id BIGINT UNSIGNED NOT NULL; batch_id BIGINT UNSIGNED NULL; system_quantity DECIMAL(18,3) NOT NULL; counted_quantity DECIMAL(18,3) NOT NULL; variance_quantity DECIMAL(18,3) NOT NULL; reason VARCHAR(255) NULL. Approval writes inventory movement, not direct balance overwrite.

## 6. Domain sales, invoice snapshots, returns dan cancellations

### 6.1 `sales_invoices`
invoice_id BIGINT UNSIGNED PK; public_id VARCHAR(80) NOT NULL UNIQUE; legacy_id VARCHAR(128) NULL UNIQUE; invoice_number VARCHAR(80) NOT NULL; encounter_id BIGINT UNSIGNED NOT NULL; patient_id BIGINT UNSIGNED NULL; cashier_user_id VARCHAR(64) NOT NULL; shift_id BIGINT UNSIGNED NOT NULL; business_date DATE NOT NULL; invoice_status VARCHAR(20) NOT NULL; gross_amount BIGINT NOT NULL; discount_amount BIGINT NOT NULL DEFAULT 0; net_amount BIGINT NOT NULL; payment_status VARCHAR(20) NOT NULL; created_at_utc DATETIME(3) NOT NULL; cancelled_at_utc DATETIME(3) NULL; cancelled_by_user_id VARCHAR(64) NULL. Index (business_date,invoice_status), (patient_id,business_date), (cashier_user_id,business_date), (shift_id,created_at_utc). Invoice number unique scope/date must be finalized. Patient and encounter snapshots retained even if master is archived.

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
sales_return_id BIGINT UNSIGNED PK; public_id VARCHAR(80) UNIQUE; legacy_id VARCHAR(128) NULL UNIQUE; invoice_id BIGINT UNSIGNED NOT NULL; requested_by_user_id VARCHAR(64) NOT NULL; business_date DATE NOT NULL; status VARCHAR(24) NOT NULL; reason VARCHAR(255) NOT NULL; submitted_at_utc DATETIME(3) NOT NULL; admin_reviewed_by_user_id VARCHAR(64) NULL; admin_reviewed_at_utc DATETIME(3) NULL; final_decided_by_user_id VARCHAR(64) NULL; final_decided_at_utc DATETIME(3) NULL. Index (invoice_id,status), (business_date,status). Stages: submitted → admin_reviewed/forwarded → approved or rejected. No stock change at Admin review.

### 6.8 `sales_return_lines`
sales_return_line_id BIGINT UNSIGNED PK; sales_return_id BIGINT UNSIGNED NOT NULL; return_quota_subject_id BIGINT UNSIGNED NOT NULL; invoice_line_id BIGINT UNSIGNED NOT NULL; invoice_component_id BIGINT UNSIGNED NULL; quantity DECIMAL(18,3) NOT NULL; refund_amount BIGINT NOT NULL; returned_cost_amount BIGINT NOT NULL; restock_disposition VARCHAR(20) NOT NULL; reason VARCHAR(255) NULL. Index (invoice_line_id). Refund derived server-side from immutable invoice and discount allocation; service line has no inventory restore. Returned goods may be restockable or quarantined; policy required.

### 6.9 `return_quota_subjects`
return_quota_subject_id BIGINT UNSIGNED PK; quota_key VARCHAR(180) NOT NULL UNIQUE; invoice_line_id BIGINT UNSIGNED NOT NULL; invoice_component_id BIGINT UNSIGNED NULL; subject_type VARCHAR(20) NOT NULL; sold_quantity DECIMAL(18,3) NOT NULL; reserved_quantity DECIMAL(18,3) NOT NULL DEFAULT 0; approved_quantity DECIMAL(18,3) NOT NULL DEFAULT 0; updated_at_utc DATETIME(3) NOT NULL; version BIGINT UNSIGNED NOT NULL. One subject represents one returnable unit: service/non-package line uses the line; medicine component in a package uses the component. quota_key is deterministic (for example line:<line_id> or component:<component_id>). Lock all relevant subject rows in a stable order for submit/finalize/cancel. Enforce active reservations + approved quantity ≤ sold quantity in the domain transaction.

### 6.10 `refund_obligations`
refund_obligation_id BIGINT UNSIGNED PK; sales_return_id BIGINT UNSIGNED NOT NULL UNIQUE; amount_due BIGINT NOT NULL; amount_paid BIGINT NOT NULL DEFAULT 0; status VARCHAR(16) NOT NULL; approved_at_utc DATETIME(3) NOT NULL; approved_by_user_id VARCHAR(64) NOT NULL. Refund liability created on Pimpinan final approval, not on cashier proposal.

### 6.11 `refund_payments`
refund_payment_id BIGINT UNSIGNED PK; refund_obligation_id BIGINT UNSIGNED NOT NULL; payment_method VARCHAR(24) NOT NULL; amount BIGINT NOT NULL; reference_no VARCHAR(100) NULL; paid_at_utc DATETIME(3) NOT NULL; paid_by_user_id VARCHAR(64) NOT NULL; idempotency_key VARCHAR(100) NOT NULL UNIQUE. Index (refund_obligation_id,paid_at_utc). Partial payouts policy; cash/bank ledger atomic. Transfer reference required for transfer. Prevent paid amount > obligation and duplicate payout.

### 6.12 `invoice_cancellation_requests`
cancellation_request_id BIGINT UNSIGNED PK; invoice_id BIGINT UNSIGNED NOT NULL; requested_by_user_id VARCHAR(64) NOT NULL; reason VARCHAR(255) NOT NULL; status VARCHAR(16) NOT NULL; requested_at_utc DATETIME(3) NOT NULL; decided_by_user_id VARCHAR(64) NULL; decided_at_utc DATETIME(3) NULL; rejection_reason VARCHAR(255) NULL; legacy_id VARCHAR(128) NULL UNIQUE. Index (invoice_id,status). Keep request history; do not hard-delete.

### 6.13 `invoice_cancellation_events`
cancellation_event_id BIGINT UNSIGNED PK; cancellation_request_id BIGINT UNSIGNED NOT NULL; event_type VARCHAR(20) NOT NULL; actor_user_id VARCHAR(64) NOT NULL; reason VARCHAR(255) NULL; occurred_at_utc DATETIME(3) NOT NULL. Approval locks invoice + quota + batches, checks return conflict, writes reversal movements/ledger and marks invoice cancelled exactly once.

## 7. Domain supplier credit, payable and payments

### 7.1 `supplier_returns`
supplier_return_id BIGINT UNSIGNED PK; public_id VARCHAR(80) UNIQUE; legacy_id VARCHAR(128) NULL UNIQUE; supplier_invoice_id BIGINT UNSIGNED NOT NULL; status VARCHAR(20) NOT NULL; reason VARCHAR(255) NOT NULL; requested_by_user_id VARCHAR(64) NOT NULL; approved_by_user_id VARCHAR(64) NULL; requested_at_utc DATETIME(3) NOT NULL; approved_at_utc DATETIME(3) NULL. Index (supplier_invoice_id,status).

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


## 4. Temuan lintas tabel — blocker sebelum DDL

| ID | Pemeriksaan | Status / tindakan |
|---|---|---|
| CD-01 | Exact signedness, width, charset dan collation seluruh FK child-parent | **BLOCKER** — belum ada manifest fisik per pasangan FK |
| CD-02 | Seluruh nullable/default dan lifecycle transition | **BLOCKER** — beberapa kolom belum memiliki keputusan nullability/default |
| CD-03 | Source-scoped legacy identity | **BLOCKER** — jangan gunakan `legacy_id UNIQUE` secara global; gunakan source identity map |
| CD-04 | Complete source-to-target field coverage | **BLOCKER** — field union historis belum diekstrak dari seluruh dokumen |
| CD-05 | Target fields without source/business justification | **BLOCKER** — perlu klasifikasi system-generated, derived, policy atau snapshot |
| CD-06 | Quantity base unit and fractional rules | **BLOCKER / D01** — DECIMAL(18,3) hanya kandidat |
| CD-07 | Money bounds, BIGINT signedness and serialization | **BLOCKER** — tentukan batas domain dan BigInt contract |
| CD-08 | Timestamp raw provenance and UTC normalization | **BLOCKER / D17** — jangan menimpa raw legacy timestamp |
| CD-09 | Status/code dictionaries and transition graph | **BLOCKER** — buat kamus domain berversi |
| CD-10 | All FK tuples, same-parent constraints, delete/update rules | **BLOCKER** — rujuk canonical FK/index catalogue; belum DDL-ready |
| CD-11 | Child index coverage and query-plan evidence | **BLOCKER** — harus diverifikasi terhadap TiDB |
| CD-12 | One purchase line to one batch vs split receipts | **BLOCKER / D10-D11-related** — perlu validasi proses penerimaan aktual |
| CD-13 | Composite ownership: cashier/shift, invoice/line/component/batch/supplier | **BLOCKER** — constraint dan service validation harus konsisten |
| CD-14 | Projection columns and single-writer/rebuild rules | **BLOCKER** — stok, kuota retur, refund paid, payable dan reconciliation harus punya source of truth |
| CD-15 | Optional PR13 tables and A/B queue behavior | **GATED** — jangan aktifkan sebelum keputusan PR13 |
| CD-16 | System actor vs nullable actor semantics | **BLOCKER** — tentukan actor_kind dan identitas system/import |
| CD-17 | Retention, audit immutability, backup/export access | **BLOCKER** — policy dan authorization belum final |

## 5. Kolom yang secara khusus tidak boleh dibekukan dari proposal lama

1. `legacy_id`: unique global tidak aman untuk Firestore ID yang scope-nya per collection. Gunakan tabel mapping sumber yang menyimpan source_system, source_collection, source_document_id/path, source hash, migration batch, target table/id dan disposition.
2. `supplier_invoice_lines.batch_id`: **dihapus**; arah relasi yang berlaku adalah `inventory_batches.supplier_invoice_line_id`, atau allocation bridge bila split receipt.
3. `return_quotas`: **dihapus**; gunakan `return_quota_subjects` yang component-aware.
4. `user_emails.email_normalized UNIQUE`: **dihapus** untuk histori; klaim email aktif hanya pada `active_email_claims`.
5. Satu role aktif: gunakan `active_role_slots` atau satu sumber kebenaran lain yang disetujui, bukan index biasa.
6. Shift aktif: composite ownership `(shift_id,cashier_user_id)` wajib; dua FK terpisah tidak cukup.
7. Retur: semua transisi harus append ke `sales_return_events`; approval final, restore stok dan payout adalah aksi terpisah.
8. Invoice patient: encounter adalah sumber kunjungan; snapshot patient pada invoice harus cocok bila keduanya terisi.
9. Refund: `amount_paid` adalah projection dari append-only refund payment records, bukan angka bebas yang bisa diedit.
10. Stock/HPP/kuota/payable: saldo yang diduplikasi adalah projection; tetapkan ledger sumber, version, writer, rebuild dan reconciliation.

## 6. Status kelengkapan dan gerbang berikutnya

| Area | Hasil saat ini |
|---|---|
| Tabel domain proposal | Diekstrak dari proposal bagian 2–8 |
| Nama kolom dan tipe kandidat | Terekam sebagaimana tertulis di proposal |
| Nullability eksplisit | Sebagian; yang tidak eksplisit tetap perlu spesifikasi |
| PK/unique/index | Hanya yang tertulis eksplisit; belum lengkap |
| FK exact type dan delete rule | Belum lengkap; rujuk audit FK |
| Source field union | Belum lengkap; perlu ekstraksi seluruh source key dan conditional fields |
| Source → target coverage | Belum selesai |
| Target → source/business rule | Belum selesai |
| TiDB DDL/runtime | Belum diuji untuk schema v1 |
| DDL aplikasi | **Tidak dibuat dan tidak diizinkan** |

Langkah lanjutan: buat crosswalk dua arah untuk setiap source collection/field dan setiap target table/column; klasifikasikan `DIRECT`, `TRANSFORMED`, `SNAPSHOT`, `DERIVED`, `SYSTEM-GENERATED`, `POLICY-DEFINED`, atau `QUARANTINE`. Setelah itu lengkapi tipe fisik dan nullability, baru lakukan review ulang.

## 7. Sumber otoritatif

- `MYSQL_MIGRATION_SCHEMA_PROPOSAL.md` — definisi domain kandidat dan amendemen konsistensi.
- `MYSQL_MIGRATION_SCHEMA_REVIEW.md` — temuan A1–A10 dan koreksi schema.
- `MYSQL_MIGRATION_CANONICAL_FK_INDEX_CATALOGUE.md` — candidate FK/unique/index matrix.
- `MYSQL_MIGRATION_DATA_TYPE_NULLABILITY_ORPHAN_DUPLICATE_CLOSURE_AUDIT.md` — tipe, nullability, orphan dan duplicate blockers.
- `MYSQL_MIGRATION_SCHEMA_CONTRADICTION_SOURCE_IDENTITY_CLOSURE_AUDIT.md` — konflik dan source identity.
- `MYSQL_MIGRATION_LEGACY_DATA_COMPATIBILITY_AUDIT.md` — field legacy yang sudah teramati dan batas ekstraksinya.
- `MYSQL_MIGRATION_BACKEND_METHOD_COLLECTION_CATALOG.md` — collection, method, read/write dan role scope.

**Kesimpulan:** dictionary v0.1 ini adalah baseline ekstraksi, bukan daftar kolom final. Tidak ada izin untuk membuat atau menjalankan DDL sampai semua blocker ditutup dan uji kompatibilitas TiDB aktual berhasil.
