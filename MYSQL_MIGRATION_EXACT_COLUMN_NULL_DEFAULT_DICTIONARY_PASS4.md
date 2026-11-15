# EXACT COLUMN / NULL / DEFAULT DICTIONARY — PASS 4

Tanggal: 2026-11-15  
Branch: `migration/tidb-foundation`  
Source proposal blob: `f934b7102d86aa6453adb646360b7eb8cd7faaf5`  
Status: **STATIC EXTRACTION / REVIEW DRAFT — NOT DDL, NOT APPROVED FOR SCHEMA FREEZE**

## 1. Tujuan dan batas

Dokumen ini menormalkan setiap kolom yang secara eksplisit dapat diekstrak dari tabel inti proposal. Kolom yang tidak memiliki deklarasi NULL/default eksplisit tetap ditandai `UNSPECIFIED`; tidak ada nilai yang ditebak. Ini bukan bukti runtime TiDB. Charset/collation, nama dan urutan index/FK, aksi FK, CHECK, generated expression, strategi PK, dan timestamp semantics per kolom tetap memerlukan keputusan/validasi terpisah.

## 2. Ringkasan cakupan ekstraksi

- Tabel dengan definisi utama yang dipindai: **56**.
- Kolom unik yang berhasil diekstrak: **566**.
- `users` dan `user_emails` diambil dari tabel kolom; definisi lainnya diekstrak dari deklarasi inline.
- Tabel integrity tambahan yang disebut hanya dalam addendum/daftar constraint (mis. `active_email_claims`, `active_role_slots`, `sales_return_events`, `sales_return_quota_events`, `queue_prefix_guards`, `supplier_invoice_line_batch_allocations`) belum dianggap lengkap karena belum memiliki definisi kolom penuh dalam bagian tabel utama.

## 3. Dictionary per tabel

### `users`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | PK immutable; stabil lintas email |
| `legacy_uid` | `VARCHAR(128)` | NULL | UNSPECIFIED | UID lama jika tersedia |
| `display_name` | `VARCHAR(120)` | NOT NULL | UNSPECIFIED | Nama tampilan |
| `phone` | `VARCHAR(32)` | NULL | UNSPECIFIED | Nomor kontak staf |
| `active` | `TINYINT(1)` | NOT NULL | 1 | Default 1 |
| `protected_owner` | `TINYINT(1)` | NOT NULL | 0 | Default 0; proteksi master di server |
| `created_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | Server time |
| `updated_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | Server time |
| `version` | `BIGINT UNSIGNED` | NOT NULL | 1 | Default 1 |

### `user_emails`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `email_id` | `BIGINT UNSIGNED` | NOT NULL | UNSPECIFIED | PK |
| `user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | FK users |
| `email_normalized` | `VARCHAR(254)` | NOT NULL | UNSPECIFIED | lowercase + trim |
| `is_primary` | `TINYINT(1)` | NOT NULL | 0 | Default 0 |
| `verified_at_utc` | `DATETIME(3)` | NULL | UNSPECIFIED | Verifikasi provider |
| `valid_from_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | Awal berlaku |
| `valid_to_utc` | `DATETIME(3)` | NULL | UNSPECIFIED | NULL = masih aktif |
| `changed_by_user_id` | `VARCHAR(64)` | NULL | UNSPECIFIED | Actor |
| `change_reason` | `VARCHAR(255)` | NULL | UNSPECIFIED | Alasan |

### `role_assignments`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `role_assignment_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | role_assignment_id BIGINT |
| `user_id` | `VARCHAR(64)` | UNSPECIFIED | UNSPECIFIED | user_id VARCHAR(64) |
| `role_code` | `VARCHAR(24)` | NOT NULL | UNSPECIFIED | role_code VARCHAR(24) NOT NULL |
| `scope_type` | `VARCHAR(24)` | NOT NULL | 'clinic' | scope_type VARCHAR(24) NOT NULL DEFAULT 'clinic' |
| `scope_id` | `VARCHAR(64)` | NULL | UNSPECIFIED | scope_id VARCHAR(64) NULL |
| `valid_from_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | valid_from_utc DATETIME(3) NOT NULL |
| `valid_to_utc` | `DATETIME(3)` | NULL | UNSPECIFIED | valid_to_utc DATETIME(3) NULL |
| `granted_by_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | granted_by_user_id VARCHAR(64) NOT NULL |
| `created_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | created_at_utc DATETIME(3) NOT NULL |

### `clinic_settings`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `setting_key` | `VARCHAR(80)` | UNSPECIFIED | UNSPECIFIED | setting_key VARCHAR(80) |
| `setting_value` | `TEXT` | NOT NULL | UNSPECIFIED | setting_value TEXT NOT NULL |
| `value_type` | `VARCHAR(20)` | NOT NULL | UNSPECIFIED | value_type VARCHAR(20) NOT NULL |
| `editable_by_admin` | `TINYINT(1)` | NOT NULL | 0 | editable_by_admin TINYINT(1) NOT NULL DEFAULT 0 |
| `version` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | version BIGINT |
| `updated_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | updated_at_utc DATETIME(3) NOT NULL |
| `updated_by_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | updated_by_user_id VARCHAR(64) NOT NULL |

### `display_configs`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `display_config_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | display_config_id BIGINT |
| `config_key` | `VARCHAR(80)` | UNSPECIFIED | UNSPECIFIED | config_key VARCHAR(80) |
| `youtube_video_id` | `VARCHAR(64)` | NULL | UNSPECIFIED | youtube_video_id VARCHAR(64) NULL |
| `youtube_enabled` | `TINYINT(1)` | NOT NULL | 0 | youtube_enabled TINYINT(1) NOT NULL DEFAULT 0 |
| `running_text` | `TEXT` | NULL | UNSPECIFIED | running_text TEXT NULL |
| `queue_mode` | `VARCHAR(16)` | NOT NULL | 'combined' | queue_mode VARCHAR(16) NOT NULL DEFAULT 'combined' |
| `updated_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | updated_at_utc DATETIME(3) NOT NULL |
| `updated_by_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | updated_by_user_id VARCHAR(64) NOT NULL |

### `queue_audio_assets`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `audio_asset_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | audio_asset_id BIGINT |
| `clip_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | clip_id VARCHAR(64) NOT NULL |
| `clip_type` | `VARCHAR(24)` | NOT NULL | UNSPECIFIED | clip_type VARCHAR(24) NOT NULL |
| `object_key` | `VARCHAR(512)` | NOT NULL | UNSPECIFIED | object_key VARCHAR(512) NOT NULL |
| `mime_type` | `VARCHAR(100)` | NOT NULL | UNSPECIFIED | mime_type VARCHAR(100) NOT NULL |
| `size_bytes` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | size_bytes BIGINT |
| `sha256` | `CHAR(64)` | NOT NULL | UNSPECIFIED | sha256 CHAR(64) NOT NULL |
| `version` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | version BIGINT |
| `active` | `TINYINT(1)` | NOT NULL | 1 | active TINYINT(1) NOT NULL DEFAULT 1 |
| `updated_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | updated_at_utc DATETIME(3) NOT NULL |
| `updated_by_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | updated_by_user_id VARCHAR(64) NOT NULL |

### `patients`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `patient_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | patient_id BIGINT |
| `public_id` | `VARCHAR(80)` | NOT NULL | UNSPECIFIED | public_id VARCHAR(80) NOT NULL |
| `legacy_id` | `VARCHAR(128)` | NULL | UNSPECIFIED | legacy_id VARCHAR(128) NULL |
| `full_name` | `VARCHAR(160)` | NOT NULL | UNSPECIFIED | full_name VARCHAR(160) NOT NULL |
| `phone` | `VARCHAR(32)` | NULL | UNSPECIFIED | phone VARCHAR(32) NULL |
| `birth_date` | `DATE` | NULL | UNSPECIFIED | birth_date DATE NULL |
| `sex_code` | `VARCHAR(16)` | NULL | UNSPECIFIED | sex_code VARCHAR(16) NULL |
| `address` | `TEXT` | NULL | UNSPECIFIED | address TEXT NULL |
| `archived_at_utc` | `DATETIME(3)` | NULL | UNSPECIFIED | archived_at_utc DATETIME(3) NULL |
| `archived_by_user_id` | `VARCHAR(64)` | NULL | UNSPECIFIED | archived_by_user_id VARCHAR(64) NULL |
| `created_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | created_at_utc DATETIME(3) NOT NULL |
| `created_by_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | created_by_user_id VARCHAR(64) NOT NULL |
| `updated_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | updated_at_utc DATETIME(3) NOT NULL |
| `version` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | version BIGINT |

### `patient_encounters`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `encounter_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | encounter_id BIGINT |
| `public_id` | `VARCHAR(80)` | NOT NULL | UNSPECIFIED | public_id VARCHAR(80) NOT NULL |
| `legacy_id` | `VARCHAR(128)` | NULL | UNSPECIFIED | legacy_id VARCHAR(128) NULL |
| `patient_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | patient_id BIGINT |
| `business_date` | `DATE` | NOT NULL | UNSPECIFIED | business_date DATE NOT NULL |
| `service_name_snapshot` | `VARCHAR(120)` | NULL | UNSPECIFIED | service_name_snapshot VARCHAR(120) NULL |
| `cashier_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | cashier_user_id VARCHAR(64) NOT NULL |
| `shift_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | shift_id BIGINT |
| `status` | `VARCHAR(24)` | NOT NULL | UNSPECIFIED | status VARCHAR(24) NOT NULL |
| `completed_at_utc` | `DATETIME(3)` | NULL | UNSPECIFIED | completed_at_utc DATETIME(3) NULL |
| `cancelled_at_utc` | `DATETIME(3)` | NULL | UNSPECIFIED | cancelled_at_utc DATETIME(3) NULL |
| `cancellation_reason` | `VARCHAR(255)` | NULL | UNSPECIFIED | cancellation_reason VARCHAR(255) NULL |
| `created_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | created_at_utc DATETIME(3) NOT NULL |
| `updated_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | updated_at_utc DATETIME(3) NOT NULL |

### `queue_counters`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `business_date` | `DATE` | NOT NULL | UNSPECIFIED | business_date DATE NOT NULL |
| `prefix` | `VARCHAR(4)` | NOT NULL | UNSPECIFIED | prefix VARCHAR(4) NOT NULL |
| `last_sequence` | `INT` | UNSPECIFIED | UNSPECIFIED | last_sequence INT |
| `updated_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | updated_at_utc DATETIME(3) NOT NULL |

### `cashier_queue_assignments`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `assignment_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | assignment_id BIGINT |
| `user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | user_id VARCHAR(64) NOT NULL |
| `prefix` | `VARCHAR(4)` | NOT NULL | UNSPECIFIED | prefix VARCHAR(4) NOT NULL |
| `valid_from` | `DATE` | NOT NULL | UNSPECIFIED | valid_from DATE NOT NULL |
| `valid_to` | `DATE` | NULL | UNSPECIFIED | valid_to DATE NULL |
| `assigned_by_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | assigned_by_user_id VARCHAR(64) NOT NULL |
| `created_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | created_at_utc DATETIME(3) NOT NULL |

### `queue_tickets`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `queue_ticket_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | queue_ticket_id BIGINT |
| `public_id` | `VARCHAR(80)` | NOT NULL | UNSPECIFIED | public_id VARCHAR(80) NOT NULL |
| `legacy_id` | `VARCHAR(128)` | NULL | UNSPECIFIED | legacy_id VARCHAR(128) NULL |
| `encounter_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | encounter_id BIGINT |
| `business_date` | `DATE` | NOT NULL | UNSPECIFIED | business_date DATE NOT NULL |
| `prefix` | `VARCHAR(4)` | NOT NULL | UNSPECIFIED | prefix VARCHAR(4) NOT NULL |
| `sequence_no` | `INT` | UNSPECIFIED | UNSPECIFIED | sequence_no INT |
| `display_number` | `VARCHAR(20)` | NOT NULL | UNSPECIFIED | display_number VARCHAR(20) NOT NULL |
| `status` | `VARCHAR(20)` | NOT NULL | UNSPECIFIED | status VARCHAR(20) NOT NULL |
| `registered_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | registered_at_utc DATETIME(3) NOT NULL |
| `registered_by_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | registered_by_user_id VARCHAR(64) NOT NULL |
| `called_at_utc` | `DATETIME(3)` | NULL | UNSPECIFIED | called_at_utc DATETIME(3) NULL |
| `completed_at_utc` | `DATETIME(3)` | NULL | UNSPECIFIED | completed_at_utc DATETIME(3) NULL |

### `queue_call_events`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `call_event_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | call_event_id BIGINT |
| `queue_ticket_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | queue_ticket_id BIGINT |
| `event_type` | `VARCHAR(16)` | NOT NULL | UNSPECIFIED | event_type VARCHAR(16) NOT NULL |
| `counter_label` | `VARCHAR(40)` | NULL | UNSPECIFIED | counter_label VARCHAR(40) NULL |
| `event_idempotency_key` | `VARCHAR(100)` | NOT NULL | UNSPECIFIED | event_idempotency_key VARCHAR(100) NOT NULL |
| `actor_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | actor_user_id VARCHAR(64) NOT NULL |
| `occurred_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | occurred_at_utc DATETIME(3) NOT NULL |

### `patient_handoffs`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `handoff_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | handoff_id BIGINT |
| `encounter_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | encounter_id BIGINT |
| `from_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | from_user_id VARCHAR(64) NOT NULL |
| `to_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | to_user_id VARCHAR(64) NOT NULL |
| `from_shift_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | from_shift_id BIGINT |
| `to_shift_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | to_shift_id BIGINT |
| `reason` | `VARCHAR(255)` | NULL | UNSPECIFIED | reason VARCHAR(255) NULL |
| `approved_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | approved_at_utc DATETIME(3) NOT NULL |
| `created_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | created_at_utc DATETIME(3) NOT NULL |

### `cashier_shifts`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `shift_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | shift_id BIGINT |
| `public_id` | `VARCHAR(80)` | NOT NULL | UNSPECIFIED | public_id VARCHAR(80) NOT NULL |
| `legacy_id` | `VARCHAR(128)` | NULL | UNSPECIFIED | legacy_id VARCHAR(128) NULL |
| `cashier_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | cashier_user_id VARCHAR(64) NOT NULL |
| `business_date` | `DATE` | NOT NULL | UNSPECIFIED | business_date DATE NOT NULL |
| `opened_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | opened_at_utc DATETIME(3) NOT NULL |
| `opening_float` | `BIGINT` | NOT NULL | 0 | opening_float BIGINT NOT NULL DEFAULT 0 |
| `status` | `VARCHAR(16)` | NOT NULL | UNSPECIFIED | status VARCHAR(16) NOT NULL |
| `closed_at_utc` | `DATETIME(3)` | NULL | UNSPECIFIED | closed_at_utc DATETIME(3) NULL |
| `closed_by_user_id` | `VARCHAR(64)` | NULL | UNSPECIFIED | closed_by_user_id VARCHAR(64) NULL |
| `created_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | created_at_utc DATETIME(3) NOT NULL |

### `active_shift_slots`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `cashier_user_id` | `VARCHAR(64)` | UNSPECIFIED | UNSPECIFIED | cashier_user_id VARCHAR(64) |
| `shift_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | shift_id BIGINT |
| `acquired_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | acquired_at_utc DATETIME(3) NOT NULL |

### `shift_reconciliations`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `reconciliation_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | reconciliation_id BIGINT |
| `shift_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | shift_id BIGINT |
| `system_cash` | `BIGINT` | NOT NULL | UNSPECIFIED | system_cash BIGINT NOT NULL |
| `counted_cash` | `BIGINT` | NOT NULL | UNSPECIFIED | counted_cash BIGINT NOT NULL |
| `variance` | `BIGINT` | NOT NULL | UNSPECIFIED | variance BIGINT NOT NULL |
| `verified_by_user_id` | `VARCHAR(64)` | NULL | UNSPECIFIED | verified_by_user_id VARCHAR(64) NULL |
| `verified_at_utc` | `DATETIME(3)` | NULL | UNSPECIFIED | verified_at_utc DATETIME(3) NULL |
| `verification_status` | `VARCHAR(16)` | NOT NULL | UNSPECIFIED | verification_status VARCHAR(16) NOT NULL |
| `snapshot_json` | `JSON` | NULL | UNSPECIFIED | snapshot_json JSON NULL |
| `created_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | created_at_utc DATETIME(3) NOT NULL |

### `cash_ledger_entries`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `cash_entry_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | cash_entry_id BIGINT |
| `business_date` | `DATE` | NOT NULL | UNSPECIFIED | business_date DATE NOT NULL |
| `shift_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | shift_id BIGINT |
| `account_code` | `VARCHAR(32)` | NOT NULL | UNSPECIFIED | account_code VARCHAR(32) NOT NULL |
| `direction` | `VARCHAR(8)` | NOT NULL | UNSPECIFIED | direction VARCHAR(8) NOT NULL |
| `amount` | `BIGINT` | NOT NULL | UNSPECIFIED | amount BIGINT NOT NULL |
| `source_type` | `VARCHAR(32)` | NOT NULL | UNSPECIFIED | source_type VARCHAR(32) NOT NULL |
| `source_id` | `VARCHAR(80)` | NOT NULL | UNSPECIFIED | source_id VARCHAR(80) NOT NULL |
| `payment_method` | `VARCHAR(24)` | NOT NULL | UNSPECIFIED | payment_method VARCHAR(24) NOT NULL |
| `occurred_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | occurred_at_utc DATETIME(3) NOT NULL |
| `actor_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | actor_user_id VARCHAR(64) NOT NULL |
| `reversal_of_entry_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | reversal_of_entry_id BIGINT |
| `idempotency_key` | `VARCHAR(100)` | NOT NULL | UNSPECIFIED | idempotency_key VARCHAR(100) NOT NULL |

### `bank_ledger_entries`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `bank_entry_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | bank_entry_id BIGINT |
| `business_date` | `DATE` | NOT NULL | UNSPECIFIED | business_date DATE NOT NULL |
| `bank_account_code` | `VARCHAR(32)` | NOT NULL | UNSPECIFIED | bank_account_code VARCHAR(32) NOT NULL |
| `direction` | `VARCHAR(8)` | NOT NULL | UNSPECIFIED | direction VARCHAR(8) NOT NULL |
| `amount` | `BIGINT` | NOT NULL | UNSPECIFIED | amount BIGINT NOT NULL |
| `source_type` | `VARCHAR(32)` | NOT NULL | UNSPECIFIED | source_type VARCHAR(32) NOT NULL |
| `source_id` | `VARCHAR(80)` | NOT NULL | UNSPECIFIED | source_id VARCHAR(80) NOT NULL |
| `reference_no` | `VARCHAR(100)` | NULL | UNSPECIFIED | reference_no VARCHAR(100) NULL |
| `occurred_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | occurred_at_utc DATETIME(3) NOT NULL |
| `actor_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | actor_user_id VARCHAR(64) NOT NULL |
| `reversal_of_entry_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | reversal_of_entry_id BIGINT |
| `idempotency_key` | `VARCHAR(100)` | NOT NULL | UNSPECIFIED | idempotency_key VARCHAR(100) NOT NULL |

### `petty_cash_entries`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `petty_cash_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | petty_cash_id BIGINT |
| `legacy_id` | `VARCHAR(128)` | NULL | UNSPECIFIED | legacy_id VARCHAR(128) NULL |
| `shift_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | shift_id BIGINT |
| `cashier_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | cashier_user_id VARCHAR(64) NOT NULL |
| `business_date` | `DATE` | NOT NULL | UNSPECIFIED | business_date DATE NOT NULL |
| `description` | `VARCHAR(255)` | NOT NULL | UNSPECIFIED | description VARCHAR(255) NOT NULL |
| `amount` | `BIGINT` | NOT NULL | UNSPECIFIED | amount BIGINT NOT NULL |
| `status` | `VARCHAR(16)` | NOT NULL | UNSPECIFIED | status VARCHAR(16) NOT NULL |
| `created_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | created_at_utc DATETIME(3) NOT NULL |
| `reversed_by_entry_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | reversed_by_entry_id BIGINT |

### `expenses`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `expense_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | expense_id BIGINT |
| `legacy_id` | `VARCHAR(128)` | NULL | UNSPECIFIED | legacy_id VARCHAR(128) NULL |
| `business_date` | `DATE` | NOT NULL | UNSPECIFIED | business_date DATE NOT NULL |
| `category` | `VARCHAR(80)` | NOT NULL | UNSPECIFIED | category VARCHAR(80) NOT NULL |
| `description` | `VARCHAR(255)` | NOT NULL | UNSPECIFIED | description VARCHAR(255) NOT NULL |
| `amount` | `BIGINT` | NOT NULL | UNSPECIFIED | amount BIGINT NOT NULL |
| `status` | `VARCHAR(16)` | NOT NULL | UNSPECIFIED | status VARCHAR(16) NOT NULL |
| `created_by_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | created_by_user_id VARCHAR(64) NOT NULL |
| `approved_by_user_id` | `VARCHAR(64)` | NULL | UNSPECIFIED | approved_by_user_id VARCHAR(64) NULL |
| `approved_at_utc` | `DATETIME(3)` | NULL | UNSPECIFIED | approved_at_utc DATETIME(3) NULL |
| `created_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | created_at_utc DATETIME(3) NOT NULL |
| `updated_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | updated_at_utc DATETIME(3) NOT NULL |
| `version` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | version BIGINT |

### `expense_events`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `expense_event_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | expense_event_id BIGINT |
| `expense_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | expense_id BIGINT |
| `event_type` | `VARCHAR(20)` | NOT NULL | UNSPECIFIED | event_type VARCHAR(20) NOT NULL |
| `old_status` | `VARCHAR(16)` | NULL | UNSPECIFIED | old_status VARCHAR(16) NULL |
| `new_status` | `VARCHAR(16)` | NOT NULL | UNSPECIFIED | new_status VARCHAR(16) NOT NULL |
| `reason` | `VARCHAR(255)` | NULL | UNSPECIFIED | reason VARCHAR(255) NULL |
| `actor_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | actor_user_id VARCHAR(64) NOT NULL |
| `occurred_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | occurred_at_utc DATETIME(3) NOT NULL |

### `loss_events`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `loss_event_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | loss_event_id BIGINT |
| `legacy_id` | `VARCHAR(128)` | NULL | UNSPECIFIED | legacy_id VARCHAR(128) NULL |
| `medicine_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | medicine_id BIGINT |
| `batch_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | batch_id BIGINT |
| `quantity` | `DECIMAL(18,3)` | NOT NULL | UNSPECIFIED | quantity DECIMAL(18,3) NOT NULL |
| `value_amount` | `BIGINT` | NOT NULL | UNSPECIFIED | value_amount BIGINT NOT NULL |
| `reason` | `VARCHAR(255)` | NOT NULL | UNSPECIFIED | reason VARCHAR(255) NOT NULL |
| `business_date` | `DATE` | NOT NULL | UNSPECIFIED | business_date DATE NOT NULL |
| `actor_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | actor_user_id VARCHAR(64) NOT NULL |
| `occurred_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | occurred_at_utc DATETIME(3) NOT NULL |
| `reversal_of_loss_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | reversal_of_loss_id BIGINT |

### `medicines`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `medicine_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | medicine_id BIGINT |
| `public_id` | `VARCHAR(80)` | NOT NULL | UNSPECIFIED | public_id VARCHAR(80) NOT NULL |
| `legacy_id` | `VARCHAR(128)` | NULL | UNSPECIFIED | legacy_id VARCHAR(128) NULL |
| `sku` | `VARCHAR(80)` | NULL | UNSPECIFIED | sku VARCHAR(80) NULL |
| `name` | `VARCHAR(180)` | NOT NULL | UNSPECIFIED | name VARCHAR(180) NOT NULL |
| `unit_name` | `VARCHAR(40)` | NOT NULL | UNSPECIFIED | unit_name VARCHAR(40) NOT NULL |
| `selling_price` | `BIGINT` | NOT NULL | UNSPECIFIED | selling_price BIGINT NOT NULL |
| `weighted_avg_cost` | `BIGINT` | NOT NULL | 0 | weighted_avg_cost BIGINT NOT NULL DEFAULT 0 |
| `stock_on_hand` | `DECIMAL(18,3)` | NOT NULL | 0 | stock_on_hand DECIMAL(18,3) NOT NULL DEFAULT 0 |
| `active` | `TINYINT(1)` | NOT NULL | 1 | active TINYINT(1) NOT NULL DEFAULT 1 |
| `min_stock` | `DECIMAL(18,3)` | NULL | UNSPECIFIED | min_stock DECIMAL(18,3) NULL |
| `created_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | created_at_utc DATETIME(3) NOT NULL |
| `updated_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | updated_at_utc DATETIME(3) NOT NULL |
| `version` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | version BIGINT |

### `tariffs`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `tariff_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | tariff_id BIGINT |
| `public_id` | `VARCHAR(80)` | UNSPECIFIED | UNSPECIFIED | public_id VARCHAR(80) |
| `legacy_id` | `VARCHAR(128)` | NULL | UNSPECIFIED | legacy_id VARCHAR(128) NULL |
| `name` | `VARCHAR(180)` | NOT NULL | UNSPECIFIED | name VARCHAR(180) NOT NULL |
| `service_type` | `VARCHAR(80)` | NOT NULL | UNSPECIFIED | service_type VARCHAR(80) NOT NULL |
| `price` | `BIGINT` | NOT NULL | UNSPECIFIED | price BIGINT NOT NULL |
| `active` | `TINYINT(1)` | NOT NULL | 1 | active TINYINT(1) NOT NULL DEFAULT 1 |
| `created_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | created_at_utc DATETIME(3) NOT NULL |
| `updated_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | updated_at_utc DATETIME(3) NOT NULL |
| `version` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | version BIGINT |

### `service_packages`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `package_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | package_id BIGINT |
| `public_id` | `VARCHAR(80)` | UNSPECIFIED | UNSPECIFIED | public_id VARCHAR(80) |
| `legacy_id` | `VARCHAR(128)` | NULL | UNSPECIFIED | legacy_id VARCHAR(128) NULL |
| `name` | `VARCHAR(180)` | NOT NULL | UNSPECIFIED | name VARCHAR(180) NOT NULL |
| `package_type` | `VARCHAR(80)` | NULL | UNSPECIFIED | package_type VARCHAR(80) NULL |
| `price` | `BIGINT` | NOT NULL | UNSPECIFIED | price BIGINT NOT NULL |
| `active` | `TINYINT(1)` | NOT NULL | 1 | active TINYINT(1) NOT NULL DEFAULT 1 |
| `created_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | created_at_utc DATETIME(3) NOT NULL |
| `updated_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | updated_at_utc DATETIME(3) NOT NULL |
| `version` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | version BIGINT |

### `package_components`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `package_component_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | package_component_id BIGINT |
| `package_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | package_id BIGINT |
| `component_type` | `VARCHAR(20)` | NOT NULL | UNSPECIFIED | component_type VARCHAR(20) NOT NULL |
| `medicine_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | medicine_id BIGINT |
| `tariff_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | tariff_id BIGINT |
| `component_name_snapshot` | `VARCHAR(180)` | NOT NULL | UNSPECIFIED | component_name_snapshot VARCHAR(180) NOT NULL |
| `unit_price_snapshot` | `BIGINT` | NOT NULL | UNSPECIFIED | unit_price_snapshot BIGINT NOT NULL |
| `quantity` | `DECIMAL(18,3)` | NOT NULL | UNSPECIFIED | quantity DECIMAL(18,3) NOT NULL |
| `sort_order` | `INT` | NOT NULL | 0. Index (package_id | sort_order INT NOT NULL DEFAULT 0. Index (package_id |

### `suppliers`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `supplier_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | supplier_id BIGINT |
| `public_id` | `VARCHAR(80)` | UNSPECIFIED | UNSPECIFIED | public_id VARCHAR(80) |
| `legacy_id` | `VARCHAR(128)` | NULL | UNSPECIFIED | legacy_id VARCHAR(128) NULL |
| `name` | `VARCHAR(180)` | NOT NULL | UNSPECIFIED | name VARCHAR(180) NOT NULL |
| `phone` | `VARCHAR(32)` | NULL | UNSPECIFIED | phone VARCHAR(32) NULL |
| `address` | `TEXT` | NULL | UNSPECIFIED | address TEXT NULL |
| `active` | `TINYINT(1)` | NOT NULL | 1 | active TINYINT(1) NOT NULL DEFAULT 1 |
| `created_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | created_at_utc DATETIME(3) NOT NULL |
| `updated_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | updated_at_utc DATETIME(3) NOT NULL |

### `supplier_invoices`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `supplier_invoice_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | supplier_invoice_id BIGINT |
| `public_id` | `VARCHAR(80)` | UNSPECIFIED | UNSPECIFIED | public_id VARCHAR(80) |
| `legacy_id` | `VARCHAR(128)` | NULL | UNSPECIFIED | legacy_id VARCHAR(128) NULL |
| `supplier_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | supplier_id BIGINT |
| `invoice_number` | `VARCHAR(100)` | NOT NULL | UNSPECIFIED | invoice_number VARCHAR(100) NOT NULL |
| `invoice_date` | `DATE` | NOT NULL | UNSPECIFIED | invoice_date DATE NOT NULL |
| `due_date` | `DATE` | NULL | UNSPECIFIED | due_date DATE NULL |
| `status` | `VARCHAR(20)` | NOT NULL | UNSPECIFIED | status VARCHAR(20) NOT NULL |
| `gross_amount` | `BIGINT` | NOT NULL | UNSPECIFIED | gross_amount BIGINT NOT NULL |
| `accepted_credit_amount` | `BIGINT` | NOT NULL | 0 | accepted_credit_amount BIGINT NOT NULL DEFAULT 0 |
| `created_by_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | created_by_user_id VARCHAR(64) NOT NULL |
| `created_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | created_at_utc DATETIME(3) NOT NULL |
| `updated_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | updated_at_utc DATETIME(3) NOT NULL |

### `supplier_invoice_lines`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `supplier_invoice_line_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | supplier_invoice_line_id BIGINT |
| `supplier_invoice_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | supplier_invoice_id BIGINT |
| `medicine_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | medicine_id BIGINT |
| `quantity_received` | `DECIMAL(18,3)` | NOT NULL | UNSPECIFIED | quantity_received DECIMAL(18,3) NOT NULL |
| `quantity_returned` | `DECIMAL(18,3)` | NOT NULL | 0 | quantity_returned DECIMAL(18,3) NOT NULL DEFAULT 0 |
| `unit_cost` | `BIGINT` | NOT NULL | UNSPECIFIED | unit_cost BIGINT NOT NULL |
| `line_total` | `BIGINT` | NOT NULL | UNSPECIFIED | line_total BIGINT NOT NULL |
| `expiry_date` | `DATE` | NULL | UNSPECIFIED | expiry_date DATE NULL |
| `batch_number` | `VARCHAR(100)` | NULL | UNSPECIFIED | batch_number VARCHAR(100) NULL |
| `expiry` | `date` | UNSPECIFIED | UNSPECIFIED | expiry date |

### `inventory_batches`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `batch_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | batch_id BIGINT |
| `public_id` | `VARCHAR(80)` | UNSPECIFIED | UNSPECIFIED | public_id VARCHAR(80) |
| `legacy_id` | `VARCHAR(128)` | NULL | UNSPECIFIED | legacy_id VARCHAR(128) NULL |
| `medicine_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | medicine_id BIGINT |
| `supplier_invoice_line_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | supplier_invoice_line_id BIGINT |
| `batch_number` | `VARCHAR(100)` | NULL | UNSPECIFIED | batch_number VARCHAR(100) NULL |
| `expiry_date` | `DATE` | NULL | UNSPECIFIED | expiry_date DATE NULL |
| `initial_quantity` | `DECIMAL(18,3)` | NOT NULL | UNSPECIFIED | initial_quantity DECIMAL(18,3) NOT NULL |
| `remaining_quantity` | `DECIMAL(18,3)` | NOT NULL | UNSPECIFIED | remaining_quantity DECIMAL(18,3) NOT NULL |
| `unit_cost` | `BIGINT` | NOT NULL | UNSPECIFIED | unit_cost BIGINT NOT NULL |
| `received_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | received_at_utc DATETIME(3) NOT NULL |
| `status` | `VARCHAR(20)` | NOT NULL | 'active'. Index (medicine_id | status VARCHAR(20) NOT NULL DEFAULT 'active'. Index (medicine_id |

### `inventory_movements`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `inventory_movement_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | inventory_movement_id BIGINT |
| `movement_key` | `VARCHAR(100)` | NOT NULL | UNSPECIFIED | movement_key VARCHAR(100) NOT NULL |
| `medicine_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | medicine_id BIGINT |
| `batch_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | batch_id BIGINT |
| `movement_type` | `VARCHAR(24)` | NOT NULL | UNSPECIFIED | movement_type VARCHAR(24) NOT NULL |
| `quantity_delta` | `DECIMAL(18,3)` | NOT NULL | UNSPECIFIED | quantity_delta DECIMAL(18,3) NOT NULL |
| `unit_cost` | `BIGINT` | NULL | UNSPECIFIED | unit_cost BIGINT NULL |
| `value_delta` | `BIGINT` | NULL | UNSPECIFIED | value_delta BIGINT NULL |
| `source_type` | `VARCHAR(32)` | NOT NULL | UNSPECIFIED | source_type VARCHAR(32) NOT NULL |
| `source_id` | `VARCHAR(80)` | NOT NULL | UNSPECIFIED | source_id VARCHAR(80) NOT NULL |
| `source_line_id` | `VARCHAR(80)` | NULL | UNSPECIFIED | source_line_id VARCHAR(80) NULL |
| `business_date` | `DATE` | NOT NULL | UNSPECIFIED | business_date DATE NOT NULL |
| `actor_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | actor_user_id VARCHAR(64) NOT NULL |
| `occurred_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | occurred_at_utc DATETIME(3) NOT NULL |
| `reversal_of_movement_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | reversal_of_movement_id BIGINT |

### `stocktakes`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `stocktake_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | stocktake_id BIGINT |
| `business_date` | `DATE` | NOT NULL | UNSPECIFIED | business_date DATE NOT NULL |
| `status` | `VARCHAR(20)` | NOT NULL | UNSPECIFIED | status VARCHAR(20) NOT NULL |
| `created_by_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | created_by_user_id VARCHAR(64) NOT NULL |
| `approved_by_user_id` | `VARCHAR(64)` | NULL | UNSPECIFIED | approved_by_user_id VARCHAR(64) NULL |
| `created_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | created_at_utc DATETIME(3) NOT NULL |
| `approved_at_utc` | `DATETIME(3)` | NULL | UNSPECIFIED | approved_at_utc DATETIME(3) NULL |
| `stocktake_line_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | stocktake_line_id BIGINT |
| `medicine_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | medicine_id BIGINT |
| `batch_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | batch_id BIGINT |
| `system_quantity` | `DECIMAL(18,3)` | NOT NULL | UNSPECIFIED | system_quantity DECIMAL(18,3) NOT NULL |
| `counted_quantity` | `DECIMAL(18,3)` | NOT NULL | UNSPECIFIED | counted_quantity DECIMAL(18,3) NOT NULL |
| `variance_quantity` | `DECIMAL(18,3)` | NOT NULL | UNSPECIFIED | variance_quantity DECIMAL(18,3) NOT NULL |
| `reason` | `VARCHAR(255)` | NULL | UNSPECIFIED | reason VARCHAR(255) NULL |

### `sales_invoices`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `invoice_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | invoice_id BIGINT |
| `public_id` | `VARCHAR(80)` | NOT NULL | UNSPECIFIED | public_id VARCHAR(80) NOT NULL |
| `legacy_id` | `VARCHAR(128)` | NULL | UNSPECIFIED | legacy_id VARCHAR(128) NULL |
| `invoice_number` | `VARCHAR(80)` | NOT NULL | UNSPECIFIED | invoice_number VARCHAR(80) NOT NULL |
| `encounter_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | encounter_id BIGINT |
| `patient_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | patient_id BIGINT |
| `cashier_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | cashier_user_id VARCHAR(64) NOT NULL |
| `shift_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | shift_id BIGINT |
| `business_date` | `DATE` | NOT NULL | UNSPECIFIED | business_date DATE NOT NULL |
| `invoice_status` | `VARCHAR(20)` | NOT NULL | UNSPECIFIED | invoice_status VARCHAR(20) NOT NULL |
| `gross_amount` | `BIGINT` | NOT NULL | UNSPECIFIED | gross_amount BIGINT NOT NULL |
| `discount_amount` | `BIGINT` | NOT NULL | 0 | discount_amount BIGINT NOT NULL DEFAULT 0 |
| `net_amount` | `BIGINT` | NOT NULL | UNSPECIFIED | net_amount BIGINT NOT NULL |
| `payment_status` | `VARCHAR(20)` | NOT NULL | UNSPECIFIED | payment_status VARCHAR(20) NOT NULL |
| `created_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | created_at_utc DATETIME(3) NOT NULL |
| `cancelled_at_utc` | `DATETIME(3)` | NULL | UNSPECIFIED | cancelled_at_utc DATETIME(3) NULL |
| `cancelled_by_user_id` | `VARCHAR(64)` | NULL | UNSPECIFIED | cancelled_by_user_id VARCHAR(64) NULL |

### `sales_invoice_lines`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `invoice_line_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | invoice_line_id BIGINT |
| `invoice_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | invoice_id BIGINT |
| `line_no` | `INT` | UNSPECIFIED | UNSPECIFIED | line_no INT |
| `line_type` | `VARCHAR(20)` | NOT NULL | UNSPECIFIED | line_type VARCHAR(20) NOT NULL |
| `medicine_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | medicine_id BIGINT |
| `tariff_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | tariff_id BIGINT |
| `package_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | package_id BIGINT |
| `item_name_snapshot` | `VARCHAR(180)` | NOT NULL | UNSPECIFIED | item_name_snapshot VARCHAR(180) NOT NULL |
| `item_type_snapshot` | `VARCHAR(80)` | NOT NULL | UNSPECIFIED | item_type_snapshot VARCHAR(80) NOT NULL |
| `unit_price` | `BIGINT` | NOT NULL | UNSPECIFIED | unit_price BIGINT NOT NULL |
| `quantity` | `DECIMAL(18,3)` | NOT NULL | UNSPECIFIED | quantity DECIMAL(18,3) NOT NULL |
| `gross_amount` | `BIGINT` | NOT NULL | UNSPECIFIED | gross_amount BIGINT NOT NULL |
| `discount_amount` | `BIGINT` | NOT NULL | 0 | discount_amount BIGINT NOT NULL DEFAULT 0 |
| `net_amount` | `BIGINT` | NOT NULL | UNSPECIFIED | net_amount BIGINT NOT NULL |
| `unit_cost_snapshot` | `BIGINT` | NOT NULL | 0 | unit_cost_snapshot BIGINT NOT NULL DEFAULT 0 |
| `line_cost_snapshot` | `BIGINT` | NOT NULL | 0 | line_cost_snapshot BIGINT NOT NULL DEFAULT 0 |
| `returned_quantity` | `DECIMAL(18,3)` | NOT NULL | 0. Unique (invoice_id | returned_quantity DECIMAL(18,3) NOT NULL DEFAULT 0. Unique (invoice_id |

### `sales_invoice_line_components`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `invoice_component_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | invoice_component_id BIGINT |
| `invoice_line_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | invoice_line_id BIGINT |
| `component_no` | `INT` | UNSPECIFIED | UNSPECIFIED | component_no INT |
| `component_type` | `VARCHAR(20)` | NOT NULL | UNSPECIFIED | component_type VARCHAR(20) NOT NULL |
| `medicine_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | medicine_id BIGINT |
| `tariff_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | tariff_id BIGINT |
| `component_name_snapshot` | `VARCHAR(180)` | NOT NULL | UNSPECIFIED | component_name_snapshot VARCHAR(180) NOT NULL |
| `unit_price_snapshot` | `BIGINT` | NOT NULL | UNSPECIFIED | unit_price_snapshot BIGINT NOT NULL |
| `quantity_per_parent` | `DECIMAL(18,3)` | NOT NULL | UNSPECIFIED | quantity_per_parent DECIMAL(18,3) NOT NULL |
| `unit_cost_snapshot` | `BIGINT` | NOT NULL | 0. Unique (invoice_line_id | unit_cost_snapshot BIGINT NOT NULL DEFAULT 0. Unique (invoice_line_id |

### `invoice_batch_allocations`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `allocation_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | allocation_id BIGINT |
| `invoice_line_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | invoice_line_id BIGINT |
| `invoice_component_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | invoice_component_id BIGINT |
| `batch_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | batch_id BIGINT |
| `quantity` | `DECIMAL(18,3)` | NOT NULL | UNSPECIFIED | quantity DECIMAL(18,3) NOT NULL |
| `unit_cost_snapshot` | `BIGINT` | NOT NULL | UNSPECIFIED | unit_cost_snapshot BIGINT NOT NULL |
| `movement_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | movement_id BIGINT |

### `invoice_discount_allocations`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `discount_allocation_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | discount_allocation_id BIGINT |
| `invoice_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | invoice_id BIGINT |
| `invoice_line_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | invoice_line_id BIGINT |
| `discount_amount` | `BIGINT` | NOT NULL | UNSPECIFIED | discount_amount BIGINT NOT NULL |
| `rounding_remainder_rank` | `INT` | NOT NULL | UNSPECIFIED | rounding_remainder_rank INT NOT NULL |

### `invoice_payments`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `invoice_payment_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | invoice_payment_id BIGINT |
| `invoice_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | invoice_id BIGINT |
| `payment_method` | `VARCHAR(24)` | NOT NULL | UNSPECIFIED | payment_method VARCHAR(24) NOT NULL |
| `amount_received` | `BIGINT` | NOT NULL | UNSPECIFIED | amount_received BIGINT NOT NULL |
| `amount_applied` | `BIGINT` | NOT NULL | UNSPECIFIED | amount_applied BIGINT NOT NULL |
| `change_amount` | `BIGINT` | NOT NULL | 0 | change_amount BIGINT NOT NULL DEFAULT 0 |
| `reference_no` | `VARCHAR(100)` | NULL | UNSPECIFIED | reference_no VARCHAR(100) NULL |
| `paid_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | paid_at_utc DATETIME(3) NOT NULL |
| `actor_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | actor_user_id VARCHAR(64) NOT NULL |
| `idempotency_key` | `VARCHAR(100)` | NOT NULL | UNSPECIFIED | idempotency_key VARCHAR(100) NOT NULL |

### `sales_returns`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `sales_return_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | sales_return_id BIGINT |
| `public_id` | `VARCHAR(80)` | UNSPECIFIED | UNSPECIFIED | public_id VARCHAR(80) |
| `legacy_id` | `VARCHAR(128)` | NULL | UNSPECIFIED | legacy_id VARCHAR(128) NULL |
| `invoice_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | invoice_id BIGINT |
| `requested_by_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | requested_by_user_id VARCHAR(64) NOT NULL |
| `business_date` | `DATE` | NOT NULL | UNSPECIFIED | business_date DATE NOT NULL |
| `status` | `VARCHAR(24)` | NOT NULL | UNSPECIFIED | status VARCHAR(24) NOT NULL |
| `reason` | `VARCHAR(255)` | NOT NULL | UNSPECIFIED | reason VARCHAR(255) NOT NULL |
| `submitted_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | submitted_at_utc DATETIME(3) NOT NULL |
| `admin_reviewed_by_user_id` | `VARCHAR(64)` | NULL | UNSPECIFIED | admin_reviewed_by_user_id VARCHAR(64) NULL |
| `admin_reviewed_at_utc` | `DATETIME(3)` | NULL | UNSPECIFIED | admin_reviewed_at_utc DATETIME(3) NULL |
| `final_decided_by_user_id` | `VARCHAR(64)` | NULL | UNSPECIFIED | final_decided_by_user_id VARCHAR(64) NULL |
| `final_decided_at_utc` | `DATETIME(3)` | NULL | UNSPECIFIED | final_decided_at_utc DATETIME(3) NULL |

### `sales_return_lines`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `sales_return_line_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | sales_return_line_id BIGINT |
| `sales_return_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | sales_return_id BIGINT |
| `return_quota_subject_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | return_quota_subject_id BIGINT |
| `invoice_line_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | invoice_line_id BIGINT |
| `invoice_component_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | invoice_component_id BIGINT |
| `quantity` | `DECIMAL(18,3)` | NOT NULL | UNSPECIFIED | quantity DECIMAL(18,3) NOT NULL |
| `refund_amount` | `BIGINT` | NOT NULL | UNSPECIFIED | refund_amount BIGINT NOT NULL |
| `returned_cost_amount` | `BIGINT` | NOT NULL | UNSPECIFIED | returned_cost_amount BIGINT NOT NULL |
| `restock_disposition` | `VARCHAR(20)` | NOT NULL | UNSPECIFIED | restock_disposition VARCHAR(20) NOT NULL |
| `reason` | `VARCHAR(255)` | NULL | UNSPECIFIED | reason VARCHAR(255) NULL |

### `return_quota_subjects`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `return_quota_subject_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | return_quota_subject_id BIGINT |
| `quota_key` | `VARCHAR(180)` | NOT NULL | UNSPECIFIED | quota_key VARCHAR(180) NOT NULL |
| `invoice_line_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | invoice_line_id BIGINT |
| `invoice_component_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | invoice_component_id BIGINT |
| `subject_type` | `VARCHAR(20)` | NOT NULL | UNSPECIFIED | subject_type VARCHAR(20) NOT NULL |
| `sold_quantity` | `DECIMAL(18,3)` | NOT NULL | UNSPECIFIED | sold_quantity DECIMAL(18,3) NOT NULL |
| `reserved_quantity` | `DECIMAL(18,3)` | NOT NULL | 0 | reserved_quantity DECIMAL(18,3) NOT NULL DEFAULT 0 |
| `approved_quantity` | `DECIMAL(18,3)` | NOT NULL | 0 | approved_quantity DECIMAL(18,3) NOT NULL DEFAULT 0 |
| `updated_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | updated_at_utc DATETIME(3) NOT NULL |
| `version` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | version BIGINT |

### `refund_obligations`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `refund_obligation_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | refund_obligation_id BIGINT |
| `sales_return_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | sales_return_id BIGINT |
| `amount_due` | `BIGINT` | NOT NULL | UNSPECIFIED | amount_due BIGINT NOT NULL |
| `amount_paid` | `BIGINT` | NOT NULL | 0 | amount_paid BIGINT NOT NULL DEFAULT 0 |
| `status` | `VARCHAR(16)` | NOT NULL | UNSPECIFIED | status VARCHAR(16) NOT NULL |
| `approved_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | approved_at_utc DATETIME(3) NOT NULL |
| `approved_by_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | approved_by_user_id VARCHAR(64) NOT NULL |

### `refund_payments`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `refund_payment_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | refund_payment_id BIGINT |
| `refund_obligation_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | refund_obligation_id BIGINT |
| `payment_method` | `VARCHAR(24)` | NOT NULL | UNSPECIFIED | payment_method VARCHAR(24) NOT NULL |
| `amount` | `BIGINT` | NOT NULL | UNSPECIFIED | amount BIGINT NOT NULL |
| `reference_no` | `VARCHAR(100)` | NULL | UNSPECIFIED | reference_no VARCHAR(100) NULL |
| `paid_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | paid_at_utc DATETIME(3) NOT NULL |
| `paid_by_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | paid_by_user_id VARCHAR(64) NOT NULL |
| `idempotency_key` | `VARCHAR(100)` | NOT NULL | UNSPECIFIED | idempotency_key VARCHAR(100) NOT NULL |

### `invoice_cancellation_requests`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `cancellation_request_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | cancellation_request_id BIGINT |
| `invoice_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | invoice_id BIGINT |
| `requested_by_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | requested_by_user_id VARCHAR(64) NOT NULL |
| `reason` | `VARCHAR(255)` | NOT NULL | UNSPECIFIED | reason VARCHAR(255) NOT NULL |
| `status` | `VARCHAR(16)` | NOT NULL | UNSPECIFIED | status VARCHAR(16) NOT NULL |
| `requested_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | requested_at_utc DATETIME(3) NOT NULL |
| `decided_by_user_id` | `VARCHAR(64)` | NULL | UNSPECIFIED | decided_by_user_id VARCHAR(64) NULL |
| `decided_at_utc` | `DATETIME(3)` | NULL | UNSPECIFIED | decided_at_utc DATETIME(3) NULL |
| `rejection_reason` | `VARCHAR(255)` | NULL | UNSPECIFIED | rejection_reason VARCHAR(255) NULL |
| `legacy_id` | `VARCHAR(128)` | NULL | UNSPECIFIED | legacy_id VARCHAR(128) NULL |

### `invoice_cancellation_events`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `cancellation_event_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | cancellation_event_id BIGINT |
| `cancellation_request_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | cancellation_request_id BIGINT |
| `event_type` | `VARCHAR(20)` | NOT NULL | UNSPECIFIED | event_type VARCHAR(20) NOT NULL |
| `actor_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | actor_user_id VARCHAR(64) NOT NULL |
| `reason` | `VARCHAR(255)` | NULL | UNSPECIFIED | reason VARCHAR(255) NULL |
| `occurred_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | occurred_at_utc DATETIME(3) NOT NULL |

### `supplier_returns`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `supplier_return_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | supplier_return_id BIGINT |
| `public_id` | `VARCHAR(80)` | UNSPECIFIED | UNSPECIFIED | public_id VARCHAR(80) |
| `legacy_id` | `VARCHAR(128)` | NULL | UNSPECIFIED | legacy_id VARCHAR(128) NULL |
| `supplier_invoice_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | supplier_invoice_id BIGINT |
| `status` | `VARCHAR(20)` | NOT NULL | UNSPECIFIED | status VARCHAR(20) NOT NULL |
| `reason` | `VARCHAR(255)` | NOT NULL | UNSPECIFIED | reason VARCHAR(255) NOT NULL |
| `requested_by_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | requested_by_user_id VARCHAR(64) NOT NULL |
| `approved_by_user_id` | `VARCHAR(64)` | NULL | UNSPECIFIED | approved_by_user_id VARCHAR(64) NULL |
| `requested_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | requested_at_utc DATETIME(3) NOT NULL |
| `approved_at_utc` | `DATETIME(3)` | NULL | UNSPECIFIED | approved_at_utc DATETIME(3) NULL |

### `supplier_return_lines`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `supplier_return_line_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | supplier_return_line_id BIGINT |
| `supplier_return_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | supplier_return_id BIGINT |
| `supplier_invoice_line_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | supplier_invoice_line_id BIGINT |
| `batch_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | batch_id BIGINT |
| `quantity` | `DECIMAL(18,3)` | NOT NULL | UNSPECIFIED | quantity DECIMAL(18,3) NOT NULL |
| `unit_cost_snapshot` | `BIGINT` | NOT NULL | UNSPECIFIED | unit_cost_snapshot BIGINT NOT NULL |
| `credit_amount` | `BIGINT` | NOT NULL | UNSPECIFIED | credit_amount BIGINT NOT NULL |

### `supplier_credit_notes`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `supplier_credit_note_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | supplier_credit_note_id BIGINT |
| `supplier_return_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | supplier_return_id BIGINT |
| `supplier_invoice_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | supplier_invoice_id BIGINT |
| `credit_amount` | `BIGINT` | NOT NULL | UNSPECIFIED | credit_amount BIGINT NOT NULL |
| `status` | `VARCHAR(16)` | NOT NULL | UNSPECIFIED | status VARCHAR(16) NOT NULL |
| `issued_at_utc` | `DATETIME(3)` | NULL | UNSPECIFIED | issued_at_utc DATETIME(3) NULL |
| `accepted_at_utc` | `DATETIME(3)` | NULL | UNSPECIFIED | accepted_at_utc DATETIME(3) NULL |
| `reference_no` | `VARCHAR(100)` | NULL | UNSPECIFIED | reference_no VARCHAR(100) NULL |

### `supplier_payments`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `supplier_payment_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | supplier_payment_id BIGINT |
| `supplier_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | supplier_id BIGINT |
| `payment_date` | `DATE` | NOT NULL | UNSPECIFIED | payment_date DATE NOT NULL |
| `payment_method` | `VARCHAR(24)` | NOT NULL | UNSPECIFIED | payment_method VARCHAR(24) NOT NULL |
| `amount` | `BIGINT` | NOT NULL | UNSPECIFIED | amount BIGINT NOT NULL |
| `reference_no` | `VARCHAR(100)` | NULL | UNSPECIFIED | reference_no VARCHAR(100) NULL |
| `paid_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | paid_at_utc DATETIME(3) NOT NULL |
| `paid_by_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | paid_by_user_id VARCHAR(64) NOT NULL |
| `idempotency_key` | `VARCHAR(100)` | NOT NULL | UNSPECIFIED | idempotency_key VARCHAR(100) NOT NULL |
| `status` | `VARCHAR(16)` | NOT NULL | UNSPECIFIED | status VARCHAR(16) NOT NULL |

### `supplier_payment_allocations`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `allocation_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | allocation_id BIGINT |
| `supplier_payment_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | supplier_payment_id BIGINT |
| `supplier_invoice_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | supplier_invoice_id BIGINT |
| `amount_allocated` | `BIGINT` | NOT NULL | UNSPECIFIED | amount_allocated BIGINT NOT NULL |

### `audit_events`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `audit_event_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | audit_event_id BIGINT |
| `event_uuid` | `CHAR(36)` | NOT NULL | UNSPECIFIED | event_uuid CHAR(36) NOT NULL |
| `actor_user_id` | `VARCHAR(64)` | NULL | UNSPECIFIED | actor_user_id VARCHAR(64) NULL |
| `actor_role_snapshot` | `VARCHAR(24)` | NULL | UNSPECIFIED | actor_role_snapshot VARCHAR(24) NULL |
| `action_code` | `VARCHAR(80)` | NOT NULL | UNSPECIFIED | action_code VARCHAR(80) NOT NULL |
| `entity_type` | `VARCHAR(60)` | NOT NULL | UNSPECIFIED | entity_type VARCHAR(60) NOT NULL |
| `entity_id` | `VARCHAR(100)` | NOT NULL | UNSPECIFIED | entity_id VARCHAR(100) NOT NULL |
| `before_json` | `JSON` | NULL | UNSPECIFIED | before_json JSON NULL |
| `after_json` | `JSON` | NULL | UNSPECIFIED | after_json JSON NULL |
| `reason` | `VARCHAR(255)` | NULL | UNSPECIFIED | reason VARCHAR(255) NULL |
| `request_id` | `VARCHAR(100)` | NOT NULL | UNSPECIFIED | request_id VARCHAR(100) NOT NULL |
| `occurred_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | occurred_at_utc DATETIME(3) NOT NULL |
| `source_ip_hash` | `VARCHAR(128)` | NULL | UNSPECIFIED | source_ip_hash VARCHAR(128) NULL |

### `idempotency_requests`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `idempotency_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | idempotency_id BIGINT |
| `actor_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | actor_user_id VARCHAR(64) NOT NULL |
| `command_name` | `VARCHAR(100)` | NOT NULL | UNSPECIFIED | command_name VARCHAR(100) NOT NULL |
| `idempotency_key` | `VARCHAR(100)` | NOT NULL | UNSPECIFIED | idempotency_key VARCHAR(100) NOT NULL |
| `request_hash` | `CHAR(64)` | NOT NULL | UNSPECIFIED | request_hash CHAR(64) NOT NULL |
| `status` | `VARCHAR(16)` | NOT NULL | UNSPECIFIED | status VARCHAR(16) NOT NULL |
| `response_code` | `SMALLINT` | NULL | UNSPECIFIED | response_code SMALLINT NULL |
| `response_json` | `JSON` | NULL | UNSPECIFIED | response_json JSON NULL |
| `entity_type` | `VARCHAR(60)` | NULL | UNSPECIFIED | entity_type VARCHAR(60) NULL |
| `entity_id` | `VARCHAR(100)` | NULL | UNSPECIFIED | entity_id VARCHAR(100) NULL |
| `created_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | created_at_utc DATETIME(3) NOT NULL |
| `expires_at_utc` | `DATETIME(3)` | NULL | UNSPECIFIED | expires_at_utc DATETIME(3) NULL |

### `outbox_jobs`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `outbox_job_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | outbox_job_id BIGINT |
| `job_type` | `VARCHAR(60)` | NOT NULL | UNSPECIFIED | job_type VARCHAR(60) NOT NULL |
| `aggregate_type` | `VARCHAR(60)` | NOT NULL | UNSPECIFIED | aggregate_type VARCHAR(60) NOT NULL |
| `aggregate_id` | `VARCHAR(100)` | NOT NULL | UNSPECIFIED | aggregate_id VARCHAR(100) NOT NULL |
| `payload_json` | `JSON` | NOT NULL | UNSPECIFIED | payload_json JSON NOT NULL |
| `status` | `VARCHAR(16)` | NOT NULL | UNSPECIFIED | status VARCHAR(16) NOT NULL |
| `attempts` | `INT` | UNSPECIFIED | UNSPECIFIED | attempts INT |
| `available_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | available_at_utc DATETIME(3) NOT NULL |
| `locked_at_utc` | `DATETIME(3)` | NULL | UNSPECIFIED | locked_at_utc DATETIME(3) NULL |
| `completed_at_utc` | `DATETIME(3)` | NULL | UNSPECIFIED | completed_at_utc DATETIME(3) NULL |
| `last_error_code` | `VARCHAR(80)` | NULL | UNSPECIFIED | last_error_code VARCHAR(80) NULL |
| `created_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | created_at_utc DATETIME(3) NOT NULL |
| `provider` | `int` | UNSPECIFIED | UNSPECIFIED | provider int |

### `stored_files`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `stored_file_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | stored_file_id BIGINT |
| `file_type` | `VARCHAR(32)` | NOT NULL | UNSPECIFIED | file_type VARCHAR(32) NOT NULL |
| `object_key` | `VARCHAR(512)` | NOT NULL | UNSPECIFIED | object_key VARCHAR(512) NOT NULL |
| `original_name` | `VARCHAR(255)` | NULL | UNSPECIFIED | original_name VARCHAR(255) NULL |
| `mime_type` | `VARCHAR(100)` | NOT NULL | UNSPECIFIED | mime_type VARCHAR(100) NOT NULL |
| `size_bytes` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | size_bytes BIGINT |
| `sha256` | `CHAR(64)` | NOT NULL | UNSPECIFIED | sha256 CHAR(64) NOT NULL |
| `access_scope` | `VARCHAR(24)` | NOT NULL | UNSPECIFIED | access_scope VARCHAR(24) NOT NULL |
| `created_by_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | created_by_user_id VARCHAR(64) NOT NULL |
| `created_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | created_at_utc DATETIME(3) NOT NULL |
| `deleted_at_utc` | `DATETIME(3)` | NULL | UNSPECIFIED | deleted_at_utc DATETIME(3) NULL |

### `backup_jobs`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `backup_job_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | backup_job_id BIGINT |
| `backup_type` | `VARCHAR(24)` | NOT NULL | UNSPECIFIED | backup_type VARCHAR(24) NOT NULL |
| `status` | `VARCHAR(20)` | NOT NULL | UNSPECIFIED | status VARCHAR(20) NOT NULL |
| `started_at_utc` | `DATETIME(3)` | NULL | UNSPECIFIED | started_at_utc DATETIME(3) NULL |
| `completed_at_utc` | `DATETIME(3)` | NULL | UNSPECIFIED | completed_at_utc DATETIME(3) NULL |
| `object_key` | `VARCHAR(512)` | NULL | UNSPECIFIED | object_key VARCHAR(512) NULL |
| `checksum_sha256` | `CHAR(64)` | NULL | UNSPECIFIED | checksum_sha256 CHAR(64) NULL |
| `size_bytes` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | size_bytes BIGINT |
| `initiated_by_user_id` | `VARCHAR(64)` | NULL | UNSPECIFIED | initiated_by_user_id VARCHAR(64) NULL |
| `verified_restore_at_utc` | `DATETIME(3)` | NULL | UNSPECIFIED | verified_restore_at_utc DATETIME(3) NULL |
| `notes` | `VARCHAR(255)` | NULL | UNSPECIFIED | notes VARCHAR(255) NULL |

### `export_jobs`

| Kolom | Tipe yang tertulis | NULL | DEFAULT | Catatan sumber |
|---|---|---|---|---|
| `export_job_id` | `BIGINT` | UNSPECIFIED | UNSPECIFIED | export_job_id BIGINT |
| `report_type` | `VARCHAR(60)` | NOT NULL | UNSPECIFIED | report_type VARCHAR(60) NOT NULL |
| `filter_json` | `JSON` | NOT NULL | UNSPECIFIED | filter_json JSON NOT NULL |
| `status` | `VARCHAR(20)` | NOT NULL | UNSPECIFIED | status VARCHAR(20) NOT NULL |
| `requested_by_user_id` | `VARCHAR(64)` | NOT NULL | UNSPECIFIED | requested_by_user_id VARCHAR(64) NOT NULL |
| `object_key` | `VARCHAR(512)` | NULL | UNSPECIFIED | object_key VARCHAR(512) NULL |
| `expires_at_utc` | `DATETIME(3)` | NULL | UNSPECIFIED | expires_at_utc DATETIME(3) NULL |
| `created_at_utc` | `DATETIME(3)` | NOT NULL | UNSPECIFIED | created_at_utc DATETIME(3) NOT NULL |
| `completed_at_utc` | `DATETIME(3)` | NULL | UNSPECIFIED | completed_at_utc DATETIME(3) NULL |

## 4. Normalisasi tipe lintas tabel — status

- User/actor identity: proposal menetapkan `VARCHAR(64)`; wajib konsisten pada seluruh kolom user/actor FK. `audit_events.event_uuid CHAR(36)` adalah event UUID, bukan user ID.
- Internal identifiers: umumnya `BIGINT UNSIGNED`; pastikan pasangan FK identik signedness, width, dan parent key.
- Money: `BIGINT` signed sebagai kandidat rupiah bulat; batas maksimum belum ditetapkan. Jangan konversi ke FLOAT/DOUBLE.
- Quantity: `DECIMAL(18,3)` kandidat; keputusan unit dasar obat dan pecahan belum ditutup.
- File sizes: `BIGINT UNSIGNED` pada queue audio, stored files, backup jobs.
- Timestamps: mayoritas `DATETIME(3)` dengan nama `_utc`; setiap kolom masih perlu definisi sumber waktu, writer, dan konversi Asia/Jakarta.

## 5. Kolom yang belum memiliki NULL/default final

Untuk setiap field bertanda `UNSPECIFIED`, schema freeze ditahan sampai diputuskan apakah nullability/default eksplisit atau wajib disediakan server. Ini terutama penting pada inline declarations yang hanya menyebut `NOT NULL` tanpa DEFAULT, serta field tanpa kata NULL/NOT NULL. Tidak boleh mengandalkan perilaku implicit default MySQL/TiDB.

## 6. Blocker fisik dan integritas yang harus ditutup

1. Tambahkan definisi penuh tabel integrity yang masih berupa kandidat, termasuk semua kolom, PK, UNIQUE, FK, nullability, default, actor provenance, dan timestamp.
2. Tetapkan charset/collation eksplisit untuk semua `VARCHAR`/`CHAR`; khususnya `user_id`, `email_normalized`, public/legacy IDs, dan case sensitivity.
3. Tetapkan nama dan urutan kolom setiap PK/UNIQUE/index/FK; index child harus prefix-compatible dengan urutan FK.
4. Tetapkan `ON DELETE`/`ON UPDATE` per FK. Default RESTRICT adalah prinsip, bukan pengganti deklarasi final.
5. Tetapkan aturan nullable composite tuples: seluruh tuple wajib lengkap atau relasi opsional tidak dipasang; jangan mengandalkan FK dengan komponen NULL untuk membuktikan ownership.
6. Tetapkan semua CHECK atau validasi service pengganti; uji dukungan CHECK di versi TiDB aktual.
7. Tetapkan alokasi PK dan retry semantics; jangan mengasumsikan AUTO_INCREMENT berurutan tanpa test.
8. Tutup policy gate domain: unit obat/fraction, encounter patient/shift required, refund/service, stock disposition, supplier split receipt, reversal cardinality, expense approval, reconciliation revisions, queue policy, audit retention, actor provenance.

## 7. Keputusan yang sengaja TIDAK dibuat

- Tidak mengisi NULL/default yang tidak dinyatakan sumber.
- Tidak menambahkan unique supplier invoice line ke inventory batch.
- Tidak menganggap legacy_id unik global.
- Tidak menganggap 104 relasi FK kandidat sebagai constraint yang sudah ada atau lulus test.
- Tidak membekukan DECIMAL(18,3) sebagai unit kuantitas final.
- Tidak menulis DDL atau menjalankan perubahan database.

## 8. Gate sebelum DDL

Pass 4 ini hanya inventory deklarasi fisik yang dapat dibuktikan dari proposal saat ini. Sebelum DDL: review seluruh `UNSPECIFIED`, lengkapkan tabel integrity tambahan, cocokkan seluruh 104 kandidat FK terhadap parent key yang benar-benar didefinisikan, lakukan test positif/negatif TiDB pada preview dengan data sintetis, dan dapatkan persetujuan owner untuk policy gate. Sampai itu selesai, Firebase tetap tidak disentuh dan produksi tetap berjalan pada sistem lama.


## 9. Temuan penting: konflik tipe integer dengan konvensi umum

Konvensi bagian 1 proposal menyebut internal PK `BIGINT UNSIGNED AUTO_INCREMENT`, tetapi banyak deklarasi tabel inline hanya menulis `BIGINT` tanpa `UNSIGNED`; beberapa counter juga menulis `INT` tanpa signedness. Kamus ini mempertahankan teks deklarasi sumber dan **tidak** menganggap konvensi umum otomatis mengubah deklarasi kolom. Ini adalah mismatch yang harus diselesaikan sebelum DDL.

Jumlah baris kolom yang secara eksplisit tertulis sebagai `BIGINT`, `INT`, atau `SMALLINT` tanpa `UNSIGNED` dalam hasil ekstraksi: **186**. Daftar ini bukan otomatis salah—sebagian nominal uang memang sengaja signed—tetapi setiap ID/FK, version/counter, amount/money, reversal pointer dan ukuran harus diklasifikasikan satu per satu. Semua pasangan FK wajib identik signedness dan lebar dengan parent.

Tindakan wajib:
1. Tandai seluruh identifier internal (`*_id`) sebagai kandidat `BIGINT UNSIGNED` hanya setelah dibandingkan dengan parent/child dan konvensi canonical; jangan menerapkannya ke kolom uang bertanda.
2. Tentukan signedness eksplisit untuk semua integer tanpa mengandalkan implicit type.
3. Pastikan `version`, counters, sequence numbers, attempts dan size metadata memiliki rentang dan signedness yang disengaja.
4. Jalankan static scan otomatis untuk setiap FK candidate agar child/parent tipe, signedness dan panjang identik.

Temuan ini memperkuat status **NOT READY FOR DDL**. Tidak ada type coercion yang dilakukan pada dokumen sumber.
