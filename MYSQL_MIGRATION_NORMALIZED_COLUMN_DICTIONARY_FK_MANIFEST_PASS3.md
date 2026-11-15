# NORMALIZED COLUMN DICTIONARY & FK MANIFEST — PASS 3
Date: 2026-11-15
Branch: `migration/tidb-foundation`
Status: **DOCUMENT NORMALIZATION / STATIC REVIEW ONLY. NOT EXECUTABLE DDL.**

## 1. Purpose and interpretation

This file converts the prose schema proposal into a normalized physical-design baseline: common scalar type families, declared entity keys, relationship tuples, required child indexes, nullability risks, and unresolved enforcement gates. It is a review manifest, not an assertion that TiDB has enforced these constraints.

Source of truth reviewed: `MYSQL_MIGRATION_SCHEMA_PROPOSAL.md` on this branch, sections 1–16 and technical addenda; FK catalogue; type/nullability and concurrency audits; FK reconciliation pass 2.

**Important correction to pass 2:** the current proposal no longer defines user identity as CHAR(36). Its user key is VARCHAR(64). The remaining `CHAR(36)` is `audit_events.event_uuid`, a UUID event identifier, not a user ID. This is valid as a separate identifier and must not be treated as a user-key mismatch. The earlier pass-2 wording suggesting a remaining CHAR(36) user-key convention is stale; this pass supersedes that sentence.

## 2. Canonical physical type dictionary

| Logical family | Canonical physical type | Required consistency / checks |
|---|---|---|
| Internal entity PK | BIGINT UNSIGNED | Same type for every FK to that PK; do not mix signed BIGINT |
| Human/service user key | VARCHAR(64) | Same length, character set and collation in users, all actor columns and composite keys |
| Legacy source identifier | VARCHAR(128) NULL | Not globally unique; uniqueness is source-scoped in migration mapping |
| Public identifier | VARCHAR(80) | Unique per target table where declared; never a substitute for internal FK |
| Bounded names/codes | VARCHAR(n) | Choose one exact length per logical field; define case sensitivity and normalization |
| Money (IDR whole rupiah) | BIGINT signed | Never FLOAT/DOUBLE; enforce nonnegative/negative semantics in domain command |
| Quantity | DECIMAL(18,3) candidate | Confirm medicine base units and fractional policy before freeze |
| Percentage/rate | DECIMAL(9,4) | One server-side rounding rule |
| Date | DATE | Business date explicitly Asia/Jakarta |
| Timestamp | DATETIME(3) | Store UTC; convert at API/UI boundary |
| Boolean | TINYINT(1) | CHECK/service validation; define allowed 0/1 |
| JSON snapshot | JSON | Non-relational snapshot only; never replace FK or core ledger columns |
| SHA-256 | CHAR(64) | Lowercase hex validation |
| UUID event ID | CHAR(36) | Only UUID identifiers such as audit_events.event_uuid; not user identity |
| File size | BIGINT UNSIGNED | Consistent across queue_audio_assets, stored_files and backup metadata |
| Status/type | VARCHAR(n) | Exact allowed values and transitions defined in domain service and tests |

Global SQL choices still requiring TiDB verification: InnoDB-compatible transactional behavior, utf8mb4 collation, SQL mode, FK enforcement, DATETIME(3), DECIMAL, JSON, unsigned key compatibility, and lock/isolation behavior.

## 3. Table and primary-key dictionary

Every row below is a table declared in the current proposal. Unless noted, its internal primary key is BIGINT UNSIGNED.

| Table | Primary key | Key / column notes |
|---|---|---|
| users | user_id VARCHAR(64) | Stable immutable identity; five protected account mappings must be retained outside cleanup/migration fixtures |
| user_emails | email_id BIGINT UNSIGNED | user_id VARCHAR(64); UNIQUE(email_id,user_id) required for composite claim FK |
| active_email_claims | email_normalized VARCHAR(254) | user_id VARCHAR(64) UNIQUE; email_id BIGINT UNSIGNED UNIQUE |
| role_assignments | role_assignment_id BIGINT UNSIGNED | user_id and granted_by_user_id VARCHAR(64); UNIQUE(role_assignment_id,user_id) |
| active_role_slots | user_id VARCHAR(64) | role_assignment_id BIGINT UNSIGNED UNIQUE; composite FK to role_assignments |
| clinic_settings | setting_key VARCHAR(80) | updated_by_user_id VARCHAR(64); clinic name protected constant |
| display_configs | display_config_id BIGINT UNSIGNED | updated_by_user_id VARCHAR(64); queue_mode VARCHAR(16) |
| queue_audio_assets | audio_asset_id BIGINT UNSIGNED | size_bytes BIGINT UNSIGNED; updated_by_user_id VARCHAR(64) |
| patients | patient_id BIGINT UNSIGNED | public_id VARCHAR(80) UNIQUE; legacy_id VARCHAR(128) non-unique |
| patient_encounters | encounter_id BIGINT UNSIGNED | patient_id and shift_id currently nullable; cashier_user_id VARCHAR(64) |
| queue_counters | (business_date DATE,prefix VARCHAR(4)) | Composite PK; last_sequence INT UNSIGNED |
| cashier_queue_assignments | assignment_id BIGINT UNSIGNED | user_id/assigned_by_user_id VARCHAR(64); prefix VARCHAR(4); date validity |
| queue_tickets | queue_ticket_id BIGINT UNSIGNED | encounter_id BIGINT UNSIGNED; sequence_no INT UNSIGNED; unique (business_date,prefix,sequence_no) |
| queue_call_events | call_event_id BIGINT UNSIGNED | queue_ticket_id BIGINT UNSIGNED; actor_user_id VARCHAR(64); event_idempotency_key UNIQUE |
| patient_handoffs | handoff_id BIGINT UNSIGNED | Optional PR13 gate; from/to user keys VARCHAR(64), from/to shift BIGINT UNSIGNED |
| cashier_shifts | shift_id BIGINT UNSIGNED | cashier_user_id VARCHAR(64); opening_float BIGINT signed |
| active_shift_slots | cashier_user_id VARCHAR(64) | shift_id BIGINT UNSIGNED UNIQUE; composite FK to shift/cashier |
| shift_reconciliations | reconciliation_id BIGINT UNSIGNED | shift_id currently UNIQUE; version/history conflict requires redesign |
| cash_ledger_entries | cash_entry_id BIGINT UNSIGNED | shift_id nullable; amount BIGINT; reversal_of_entry_id BIGINT UNSIGNED nullable |
| bank_ledger_entries | bank_entry_id BIGINT UNSIGNED | amount BIGINT; reversal_of_entry_id BIGINT UNSIGNED nullable |
| petty_cash_entries | petty_cash_id BIGINT UNSIGNED | shift_id and cashier_user_id; reversed_by_entry_id nullable BIGINT |
| expenses | expense_id BIGINT UNSIGNED | created_by/approved_by VARCHAR(64); approval event history separate |
| expense_events | expense_event_id BIGINT UNSIGNED | expense_id BIGINT; actor_user_id VARCHAR(64) |
| loss_events | loss_event_id BIGINT UNSIGNED | medicine_id/batch_id BIGINT; quantity DECIMAL(18,3) |
| medicines | medicine_id BIGINT UNSIGNED | stock_on_hand DECIMAL(18,3); weighted_avg_cost and prices BIGINT |
| tariffs | tariff_id BIGINT UNSIGNED | price BIGINT |
| service_packages | package_id BIGINT UNSIGNED | price BIGINT |
| package_components | package_component_id BIGINT UNSIGNED | package_id, medicine_id?, tariff_id? BIGINT; exactly-one target rule |
| suppliers | supplier_id BIGINT UNSIGNED | public_id unique |
| supplier_invoices | supplier_invoice_id BIGINT UNSIGNED | supplier_id BIGINT; amounts BIGINT |
| supplier_invoice_lines | supplier_invoice_line_id BIGINT UNSIGNED | supplier_invoice_id, medicine_id BIGINT; quantity DECIMAL(18,3) |
| inventory_batches | batch_id BIGINT UNSIGNED | medicine_id BIGINT; supplier_invoice_line_id nullable BIGINT; quantity DECIMAL(18,3) |
| inventory_movements | inventory_movement_id BIGINT UNSIGNED | medicine_id, batch_id?, reversal_of_movement_id? BIGINT; quantity DECIMAL(18,3) |
| stocktakes | stocktake_id BIGINT UNSIGNED | actor user keys VARCHAR(64) |
| stocktake_lines | stocktake_line_id BIGINT UNSIGNED | stocktake_id, medicine_id, batch_id? BIGINT; quantities DECIMAL(18,3) |
| sales_invoices | invoice_id BIGINT UNSIGNED | encounter_id, patient_id?, shift_id BIGINT; cashier_user_id VARCHAR(64) |
| sales_invoice_lines | invoice_line_id BIGINT UNSIGNED | invoice_id BIGINT; medicine_id?/tariff_id?/package_id? BIGINT |
| sales_invoice_line_components | invoice_component_id BIGINT UNSIGNED | invoice_line_id BIGINT; medicine_id?/tariff_id? BIGINT |
| invoice_batch_allocations | allocation_id BIGINT UNSIGNED | invoice_line_id, invoice_component_id?, batch_id, movement_id BIGINT |
| invoice_discount_allocations | discount_allocation_id BIGINT UNSIGNED | invoice_id, invoice_line_id BIGINT; amount BIGINT |
| invoice_payments | invoice_payment_id BIGINT UNSIGNED | invoice_id BIGINT; actor_user_id VARCHAR(64); amounts BIGINT |
| sales_returns | sales_return_id BIGINT UNSIGNED | invoice_id BIGINT; actor IDs VARCHAR(64) |
| sales_return_lines | sales_return_line_id BIGINT UNSIGNED | return/quota/line/component IDs BIGINT; quantity DECIMAL(18,3); refund BIGINT |
| return_quota_subjects | return_quota_subject_id BIGINT UNSIGNED | invoice_line_id BIGINT; invoice_component_id nullable BIGINT; quota quantities DECIMAL(18,3) |
| sales_return_events | sales_return_event_id BIGINT UNSIGNED | sales_return_id BIGINT; actor_user_id VARCHAR(64) |
| sales_return_quota_events | Not integrated in base proposal | Required candidate append-only quota reserve/release/consume ledger; define PK and FK before DDL |
| refund_obligations | refund_obligation_id BIGINT UNSIGNED | sales_return_id unique; amount_due/paid BIGINT |
| refund_payments | refund_payment_id BIGINT UNSIGNED | refund_obligation_id BIGINT; paid_by_user_id VARCHAR(64); amount BIGINT |
| invoice_cancellation_requests | cancellation_request_id BIGINT UNSIGNED | invoice_id BIGINT; requested/decided user keys VARCHAR(64) |
| invoice_cancellation_events | cancellation_event_id BIGINT UNSIGNED | cancellation_request_id BIGINT; actor_user_id VARCHAR(64) |
| supplier_returns | supplier_return_id BIGINT UNSIGNED | supplier_invoice_id BIGINT; actor user keys VARCHAR(64) |
| supplier_return_lines | supplier_return_line_id BIGINT UNSIGNED | supplier_return_id, supplier_invoice_line_id, batch_id BIGINT |
| supplier_credit_notes | supplier_credit_note_id BIGINT UNSIGNED | supplier_return_id unique; supplier_invoice_id BIGINT |
| supplier_payments | supplier_payment_id BIGINT UNSIGNED | supplier_id BIGINT; paid_by_user_id VARCHAR(64); amount BIGINT |
| supplier_payment_allocations | allocation_id BIGINT UNSIGNED | supplier_payment_id, supplier_invoice_id BIGINT; amount_allocated BIGINT |
| audit_events | audit_event_id BIGINT UNSIGNED | event_uuid CHAR(36); actor_user_id nullable VARCHAR(64) |
| idempotency_requests | idempotency_id BIGINT UNSIGNED | actor_user_id VARCHAR(64); request_hash CHAR(64) |
| outbox_jobs | outbox_job_id BIGINT UNSIGNED | aggregate_id VARCHAR(100), intentionally polymorphic |
| stored_files | stored_file_id BIGINT UNSIGNED | size_bytes BIGINT UNSIGNED; created_by_user_id VARCHAR(64) |
| backup_jobs | backup_job_id BIGINT UNSIGNED | size_bytes BIGINT UNSIGNED nullable; initiated_by_user_id VARCHAR(64) nullable |
| export_jobs | export_job_id BIGINT UNSIGNED | requested_by_user_id VARCHAR(64) |

This is a type-family normalization from documented fields. It is not yet a complete per-column null/default/collation dictionary; the missing exact attributes are listed in section 7 and remain a release blocker.

## 4. FK manifest — exact relationship tuples to carry into DDL

For every relationship, the child tuple and parent tuple must have identical column count, order, physical type, signedness, charset and collation. All FK delete/update actions default to RESTRICT; lifecycle changes use archive/status/reversal. Child indexes must begin with the exact FK tuple in the same order unless an existing PK/unique index already covers it.

| ID | Child tuple | Parent tuple | Required parent key | Child index | Status |
|---|---|---|---|---|---|
| F01 | user_emails(user_id) | users(user_id) | PK | (user_id,valid_to_utc) | Candidate |
| F02 | user_emails(changed_by_user_id) | users(user_id) | PK | (changed_by_user_id) | Nullable actor semantics |
| F03 | active_email_claims(user_id) | users(user_id) | PK | UNIQUE(user_id) | Candidate |
| F04 | active_email_claims(email_id,user_id) | user_emails(email_id,user_id) | UNIQUE(email_id,user_id) | (email_id,user_id) | Candidate; verified-current email invariant is service transaction |
| F05 | role_assignments(user_id) | users(user_id) | PK | (user_id,valid_to_utc) | Candidate |
| F06 | role_assignments(granted_by_user_id) | users(user_id) | PK | (granted_by_user_id) | System actor strategy open |
| F07 | active_role_slots(user_id) | users(user_id) | PK | PK | Candidate |
| F08 | active_role_slots(role_assignment_id,user_id) | role_assignments(role_assignment_id,user_id) | UNIQUE(role_assignment_id,user_id) | (role_assignment_id,user_id) | Candidate |
| F09 | clinic_settings(updated_by_user_id) | users(user_id) | PK | (updated_by_user_id) | System seed actor semantics |
| F10 | display_configs(updated_by_user_id) | users(user_id) | PK | (updated_by_user_id) | Candidate |
| F11 | queue_audio_assets(updated_by_user_id) | users(user_id) | PK | (updated_by_user_id) | Candidate |
| F12 | patients(created_by_user_id), patients(archived_by_user_id) | users(user_id) | PK | separate actor indexes | archived actor nullable |
| F13 | patient_encounters(patient_id) | patients(patient_id) | PK | (patient_id,business_date) | NULL policy unresolved |
| F14 | patient_encounters(cashier_user_id) | users(user_id) | PK | (cashier_user_id,business_date) | Candidate |
| F15 | patient_encounters(shift_id,cashier_user_id) | cashier_shifts(shift_id,cashier_user_id) | UNIQUE(shift_id,cashier_user_id) | (shift_id,cashier_user_id) | BLOCK: shift_id nullable, all-null/all-present rule absent |
| F16 | cashier_queue_assignments(user_id) | users(user_id) | PK | (user_id,valid_from,valid_to) | Candidate |
| F17 | cashier_queue_assignments(assigned_by_user_id) | users(user_id) | PK | (assigned_by_user_id) | Candidate |
| F18 | cashier_queue_assignments(prefix) | queue_prefix_guards(prefix) | PK | (prefix) | BLOCK: guard table absent from base proposal |
| F19 | queue_tickets(encounter_id) | patient_encounters(encounter_id) | PK | (encounter_id) | Candidate; reissue cardinality open |
| F20 | queue_tickets(registered_by_user_id) | users(user_id) | PK | (registered_by_user_id) | Candidate |
| F21 | queue_call_events(queue_ticket_id) | queue_tickets(queue_ticket_id) | PK | (queue_ticket_id,occurred_at_utc) | Candidate |
| F22 | queue_call_events(actor_user_id) | users(user_id) | PK | (actor_user_id) | System actor semantics |
| F23 | cashier_shifts(cashier_user_id), cashier_shifts(closed_by_user_id) | users(user_id) | PK | separate actor indexes | closed_by nullable |
| F24 | active_shift_slots(cashier_user_id) | users(user_id) | PK | PK | Candidate |
| F25 | active_shift_slots(shift_id,cashier_user_id) | cashier_shifts(shift_id,cashier_user_id) | UNIQUE(shift_id,cashier_user_id) | (shift_id,cashier_user_id) | Candidate |
| F26 | shift_reconciliations(shift_id) | cashier_shifts(shift_id) | PK | UNIQUE(shift_id) | BLOCK: one immutable version vs revisions unresolved |
| F27 | shift_reconciliations(verified_by_user_id) | users(user_id) | PK | (verified_by_user_id) | Nullable verifier |
| F28 | cash_ledger_entries(shift_id) | cashier_shifts(shift_id) | PK | (shift_id,occurred_at_utc) | Nullable scope |
| F29 | cash_ledger_entries(actor_user_id) | users(user_id) | PK | (actor_user_id,occurred_at_utc) | Candidate |
| F30 | cash_ledger_entries(reversal_of_entry_id) | cash_ledger_entries(cash_entry_id) | PK | (reversal_of_entry_id) | Reversal cardinality/idempotency open |
| F31 | bank_ledger_entries(actor_user_id) | users(user_id) | PK | (actor_user_id,occurred_at_utc) | Candidate |
| F32 | bank_ledger_entries(reversal_of_entry_id) | bank_ledger_entries(bank_entry_id) | PK | (reversal_of_entry_id) | Reversal cardinality open |
| F33 | petty_cash_entries(shift_id,cashier_user_id) | cashier_shifts(shift_id,cashier_user_id) | UNIQUE(shift_id,cashier_user_id) | (shift_id,cashier_user_id) | Candidate; parent key needed |
| F34 | petty_cash_entries(cashier_user_id) | users(user_id) | PK | (cashier_user_id,business_date) | Candidate |
| F35 | expenses(created_by_user_id), expenses(approved_by_user_id) | users(user_id) | PK | separate actor indexes | self-approval policy open |
| F36 | expense_events(expense_id) | expenses(expense_id) | PK | (expense_id,occurred_at_utc) | Candidate |
| F37 | expense_events(actor_user_id) | users(user_id) | PK | (actor_user_id) | Candidate |
| F38 | loss_events(medicine_id) | medicines(medicine_id) | PK | (medicine_id,occurred_at_utc) | Candidate |
| F39 | loss_events(batch_id,medicine_id) | inventory_batches(batch_id,medicine_id) | UNIQUE(batch_id,medicine_id) | (batch_id,medicine_id) | Composite parent key missing |
| F40 | loss_events(reversal_of_loss_id) | loss_events(loss_event_id) | PK | (reversal_of_loss_id) | Reversal cardinality open |
| F41 | package_components(package_id) | service_packages(package_id) | PK | (package_id,sort_order) | Candidate |
| F42 | package_components(medicine_id) | medicines(medicine_id) | PK | (medicine_id) | Nullable; target type constraint needed |
| F43 | package_components(tariff_id) | tariffs(tariff_id) | PK | (tariff_id) | Nullable; exactly-one target rule needed |
| F44 | supplier_invoices(supplier_id) | suppliers(supplier_id) | PK | (supplier_id,invoice_date) | Candidate |
| F45 | supplier_invoices(created_by_user_id) | users(user_id) | PK | (created_by_user_id) | Candidate |
| F46 | supplier_invoice_lines(supplier_invoice_id) | supplier_invoices(supplier_invoice_id) | PK | (supplier_invoice_id) | Candidate |
| F47 | supplier_invoice_lines(medicine_id) | medicines(medicine_id) | PK | (medicine_id) | Candidate |
| F48 | inventory_batches(medicine_id) | medicines(medicine_id) | PK | (medicine_id,expiry_date,remaining_quantity) | Candidate |
| F49 | inventory_batches(supplier_invoice_line_id,medicine_id) | supplier_invoice_lines(supplier_invoice_line_id,medicine_id) | UNIQUE(supplier_invoice_line_id,medicine_id) | same tuple | BLOCK: nullable tuple and split receipt bridge unresolved |
| F50 | inventory_movements(medicine_id) | medicines(medicine_id) | PK | (medicine_id,occurred_at_utc) | Candidate |
| F51 | inventory_movements(batch_id,medicine_id) | inventory_batches(batch_id,medicine_id) | UNIQUE(batch_id,medicine_id) | (batch_id,medicine_id,occurred_at_utc) | BLOCK: batch_id nullable; use explicit typed nullable-pair rule |
| F52 | inventory_movements(actor_user_id) | users(user_id) | PK | (actor_user_id,occurred_at_utc) | Candidate |
| F53 | inventory_movements(reversal_of_movement_id) | inventory_movements(inventory_movement_id) | PK | (reversal_of_movement_id) | Reversal cardinality open |
| F54 | stocktakes(created_by_user_id), stocktakes(approved_by_user_id) | users(user_id) | PK | separate actor indexes | approver nullable |
| F55 | stocktake_lines(stocktake_id) | stocktakes(stocktake_id) | PK | (stocktake_id) | Candidate |
| F56 | stocktake_lines(medicine_id) | medicines(medicine_id) | PK | (medicine_id) | Candidate |
| F57 | stocktake_lines(batch_id,medicine_id) | inventory_batches(batch_id,medicine_id) | UNIQUE(batch_id,medicine_id) | (batch_id,medicine_id) | BLOCK: nullable pair rule |
| F58 | sales_invoices(encounter_id) | patient_encounters(encounter_id) | PK | (encounter_id) | Same encounter/patient/shift chain not proven |
| F59 | sales_invoices(patient_id) | patients(patient_id) | PK | (patient_id,business_date) | Nullable snapshot/master policy open |
| F60 | sales_invoices(cashier_user_id), sales_invoices(cancelled_by_user_id) | users(user_id) | PK | separate actor indexes | cancelled_by nullable |
| F61 | sales_invoices(shift_id,cashier_user_id) | cashier_shifts(shift_id,cashier_user_id) | UNIQUE(shift_id,cashier_user_id) | (shift_id,cashier_user_id) | Parent/child composite keys not yet in proposal table |
| F62 | sales_invoice_lines(invoice_id) | sales_invoices(invoice_id) | PK | UNIQUE(invoice_id,line_no) | Candidate |
| F63 | sales_invoice_lines(medicine_id), (tariff_id), (package_id) | corresponding master PKs | PK | one index per optional target | Exactly-one target check/service gate |
| F64 | sales_invoice_line_components(invoice_line_id) | sales_invoice_lines(invoice_line_id) | PK | UNIQUE(invoice_line_id,component_no) | Candidate |
| F65 | sales_invoice_line_components(medicine_id), (tariff_id) | corresponding master PKs | PK | one index per optional target | Exactly-one target gate |
| F66 | invoice_batch_allocations(invoice_line_id) | sales_invoice_lines(invoice_line_id) | PK | (invoice_line_id) | Candidate |
| F67 | invoice_batch_allocations(invoice_component_id) | sales_invoice_line_components(invoice_component_id) | PK | (invoice_component_id) | Nullable; component must belong to line |
| F68 | invoice_batch_allocations(batch_id) | inventory_batches(batch_id) | PK | (batch_id) | Candidate; same medicine not proven |
| F69 | invoice_batch_allocations(movement_id) | inventory_movements(inventory_movement_id) | PK | UNIQUE(movement_id) | Movement must be matching sale deduction |
| F70 | invoice_discount_allocations(invoice_id,invoice_line_id) | sales_invoice_lines(invoice_id,invoice_line_id) | UNIQUE(invoice_id,line_no) is NOT same tuple; add UNIQUE(invoice_line_id,invoice_id) | (invoice_id,invoice_line_id) | BLOCK: exact parent composite key missing |
| F71 | invoice_payments(invoice_id) | sales_invoices(invoice_id) | PK | (invoice_id) | Candidate |
| F72 | invoice_payments(actor_user_id) | users(user_id) | PK | (actor_user_id) | Candidate |
| F73 | sales_returns(invoice_id) | sales_invoices(invoice_id) | PK | (invoice_id,status) | Candidate |
| F74 | sales_returns(requested_by_user_id), admin_reviewed_by_user_id, final_decided_by_user_id | users(user_id) | PK | separate actor indexes | Nullable reviewers |
| F75 | sales_return_lines(sales_return_id) | sales_returns(sales_return_id) | PK | (sales_return_id) | Candidate |
| F76 | sales_return_lines(return_quota_subject_id,invoice_line_id,invoice_component_id) | return_quota_subjects(…matching identity tuple…) | exact non-null typed key required | matching tuple | BLOCK: nullable component and multiple IDs can disagree |
| F77 | return_quota_subjects(invoice_line_id) | sales_invoice_lines(invoice_line_id) | PK | (invoice_line_id) | Candidate |
| F78 | return_quota_subjects(invoice_component_id,invoice_line_id) | sales_invoice_line_components(invoice_component_id,invoice_line_id) | UNIQUE(invoice_component_id,invoice_line_id) | same tuple | BLOCK: component must belong to line |
| F79 | sales_return_events(sales_return_id) | sales_returns(sales_return_id) | PK | (sales_return_id,occurred_at_utc) | Candidate |
| F80 | sales_return_events(actor_user_id) | users(user_id) | PK | (actor_user_id) | Candidate |
| F81 | refund_obligations(sales_return_id) | sales_returns(sales_return_id) | UNIQUE(sales_return_id) | UNIQUE(sales_return_id) | Candidate |
| F82 | refund_obligations(approved_by_user_id) | users(user_id) | PK | (approved_by_user_id) | Candidate |
| F83 | refund_payments(refund_obligation_id) | refund_obligations(refund_obligation_id) | PK | (refund_obligation_id,paid_at_utc) | Candidate |
| F84 | refund_payments(paid_by_user_id) | users(user_id) | PK | (paid_by_user_id) | Candidate |
| F85 | invoice_cancellation_requests(invoice_id) | sales_invoices(invoice_id) | PK | (invoice_id,status) | Candidate |
| F86 | invoice_cancellation_requests(requested_by_user_id), decided_by_user_id | users(user_id) | PK | separate actor indexes | decided actor nullable |
| F87 | invoice_cancellation_events(cancellation_request_id) | invoice_cancellation_requests(cancellation_request_id) | PK | (cancellation_request_id,occurred_at_utc) | Candidate |
| F88 | invoice_cancellation_events(actor_user_id) | users(user_id) | PK | (actor_user_id) | Candidate |
| F89 | supplier_returns(supplier_invoice_id) | supplier_invoices(supplier_invoice_id) | PK | (supplier_invoice_id,status) | Candidate |
| F90 | supplier_returns(requested_by_user_id), approved_by_user_id | users(user_id) | PK | separate actor indexes | approved actor nullable |
| F91 | supplier_return_lines(supplier_return_id) | supplier_returns(supplier_return_id) | PK | (supplier_return_id) | Candidate |
| F92 | supplier_return_lines(supplier_invoice_line_id) | supplier_invoice_lines(supplier_invoice_line_id) | PK | (supplier_invoice_line_id) | Same invoice relationship not proven |
| F93 | supplier_return_lines(batch_id) | inventory_batches(batch_id) | PK | (batch_id) | Same medicine/receipt line not proven |
| F94 | supplier_credit_notes(supplier_return_id) | supplier_returns(supplier_return_id) | UNIQUE(supplier_return_id) | UNIQUE(supplier_return_id) | Candidate |
| F95 | supplier_credit_notes(supplier_invoice_id) | supplier_invoices(supplier_invoice_id) | PK | (supplier_invoice_id) | Must equal return's invoice; composite key needed |
| F96 | supplier_payments(supplier_id) | suppliers(supplier_id) | PK | (supplier_id,payment_date) | Candidate |
| F97 | supplier_payments(paid_by_user_id) | users(user_id) | PK | (paid_by_user_id) | Candidate |
| F98 | supplier_payment_allocations(supplier_payment_id) | supplier_payments(supplier_payment_id) | PK | (supplier_payment_id,supplier_invoice_id) | Same supplier not proven |
| F99 | supplier_payment_allocations(supplier_invoice_id) | supplier_invoices(supplier_invoice_id) | PK | (supplier_invoice_id,supplier_payment_id) | Same supplier not proven |
| F100 | audit_events(actor_user_id) | users(user_id) | PK | (actor_user_id,occurred_at_utc) | Nullable actor; actor_kind/provenance missing |
| F101 | idempotency_requests(actor_user_id) | users(user_id) | PK | UNIQUE(actor_user_id,command_name,idempotency_key) | System principal policy |
| F102 | stored_files(created_by_user_id) | users(user_id) | PK | (created_by_user_id,created_at_utc) | Candidate |
| F103 | backup_jobs(initiated_by_user_id) | users(user_id) | PK | (initiated_by_user_id) | Nullable only for explicit scheduled principal |
| F104 | export_jobs(requested_by_user_id) | users(user_id) | PK | (requested_by_user_id,created_at_utc) | Candidate |

**Important:** F70–F78 and F91–F99 are intentionally flagged because single-column FKs alone do not prove same-parent ownership. Some proposed parent tuple names are design requirements, not existing declared constraints. DDL must add those parent UNIQUE tuples before adding child composite FKs. Do not copy this table blindly into SQL until the missing tuple definitions are normalized.

## 5. Composite parent keys required before child FKs

At minimum, decide and define exact UNIQUE keys:

1. user_emails(email_id,user_id)
2. role_assignments(role_assignment_id,user_id)
3. cashier_shifts(shift_id,cashier_user_id)
4. patient_encounters(encounter_id,patient_id) and, if used, (encounter_id,shift_id,cashier_user_id)
5. supplier_invoice_lines(supplier_invoice_line_id,medicine_id) and likely (supplier_invoice_line_id,supplier_invoice_id,medicine_id)
6. inventory_batches(batch_id,medicine_id) and receipt-allocation identity
7. sales_invoice_lines(invoice_line_id,invoice_id)
8. sales_invoice_line_components(invoice_component_id,invoice_line_id)
9. sales_invoices(invoice_id,encounter_id,patient_id,shift_id,cashier_user_id) only if exact ownership tuple is chosen and patient nullability removed
10. return_quota_subjects must use a non-null typed subject identity; avoid nullable composite component as sole discriminator
11. supplier_invoices(supplier_invoice_id,supplier_id)
12. supplier_returns(supplier_return_id,supplier_invoice_id)
13. supplier_payments(supplier_payment_id,supplier_id)

Composite FKs must use identical column order. Child index starts with those exact columns. Any tuple containing nullable fields requires explicit all-null/all-present semantics and actual TiDB tests.

## 6. Confirmed blockers and proposed safe resolution

### B01 — New encounter nullability
Current proposal allows patient_encounters.patient_id and shift_id NULL. New operational visit should require patient_id and an open shift; historical exceptions should live in a quarantine/legacy relation, not weaken new rows. Proposed v1: patient_id NOT NULL, shift_id NOT NULL, cashier_user_id NOT NULL; composite FK (shift_id,cashier_user_id). Owner must confirm whether every registration always requires a patient record.

### B02 — Invoice identity chain
sales_invoices has encounter_id, patient_id nullable, cashier_user_id, shift_id. It must prove the invoice belongs to the same encounter, patient, cashier and shift. Preferred: patient_encounters has required patient_id and shift_id; define UNIQUE(encounter_id,patient_id,shift_id,cashier_user_id), then invoice carries the same four columns and composite FK. If invoice.patient_id is only a snapshot, rename/document it as snapshot and do not claim it is a master FK.

### B03 — Shift reconciliation versioning
shift_reconciliations UNIQUE(shift_id) conflicts with immutable correction history. Preferred: reconciliation_id + shift_id + revision_no, UNIQUE(shift_id,revision_no), append-only events, and a current pointer/slot per shift. No overwriting a verified reconciliation.

### B04 — Split supplier receipt / lots
Do not add UNIQUE(inventory_batches.supplier_invoice_line_id). If one invoice line can be received in separate shipments or split lots/expiry dates, create supplier_invoice_line_batch_allocations with quantity, receipt event, batch_id and idempotency key. If the clinic confirms exactly one batch per invoice line, a unique relationship can be considered after evidence. Current status: unresolved; no constraint frozen.

### B05 — Nullable batch/medicine tuples
For inventory_movements and stocktake_lines, batch_id is nullable while medicine_id is required. A composite FK with NULL batch may be skipped by SQL FK semantics. Keep medicine_id FK separately; add batch FK through a typed nullable relation or ensure batch_id and medicine_id pair is either both populated and matches or batch is absent. Enforce pair rule in service and test CHECK support in TiDB; do not assume partial tuple enforcement.

### B06 — Package component target
package_components and invoice components have nullable medicine_id/tariff_id. Add exact-one-target constraint by component_type; nested packages blocked. FK child indexes for both nullable target columns.

### B07 — Return quota
sales_return_lines currently repeats quota_subject_id, invoice_line_id and optional invoice_component_id. They can disagree. Prefer return line references only return_quota_subject_id; derive line/component through subject, or add a composite FK to a typed non-null subject key. Define append-only sales_return_quota_events with reserve/release/consume/reversal, actor provenance and unique idempotency key. No quota consumption solely by mutable counters without event evidence.

### B08 — Supplier return and payment same supplier
Add composite supplier_id to child allocation or use a validated bridge so payment allocation cannot cross suppliers. Supplier return line must prove return.invoice = receipt_line.invoice and batch belongs to that receipt line and medicine. Supplier credit note must prove its invoice equals return invoice.

### B09 — Actor provenance
Actor fields cannot use NULL to ambiguously mean system, import or unknown. Define actor_kind (human/system/import/unknown), actor_user_id nullable only for non-human kinds, service principal registry or stable system identity, and actor provenance constraints. Keep human actor FK RESTRICT. Apply to audit, outbox, idempotency, queue events, imports and seeded settings.

### B10 — Queue assignment/counters
Add queue_prefix_guards(prefix PK, version/lock metadata) and append-only assignment events to main table list. Assignment range overlap prevention is transaction/service-level with guard locks. First queue_counters row creation must be race-safe (insert-if-absent with duplicate retry/lock) before increment. Ticket reissue policy remains unresolved; do not add UNIQUE(encounter_id) without decision.

### B11 — Reversal/idempotency
For each reversal pointer decide full single reversal vs multiple partial reversals. If one reversal only, add UNIQUE(reversal_of_id) where semantics permit; if partial, use a reversal allocation/event table with total reversed quantity/amount locked. Every source effect must have a unique source event key. Self-FK alone does not stop double reversal.

### B12 — Source-scoped legacy identity
Keep target legacy_id non-unique. Migration mapping identity is (source_system,source_collection,source_document_id), plus source hash and migration batch. Do not infer global uniqueness across Firebase collections.

### B13 — Audit actor and UUID
audit_events.event_uuid CHAR(36) is event identity; it is not a user FK. actor_user_id VARCHAR(64) nullable must be paired with actor_kind/provenance. Retain event_uuid unique.

## 7. Missing exact physical attributes before DDL

For every column in every table, still need:
- exact NULL/NOT NULL (including composite FK nullable tuple rules);
- DEFAULT expression and whether server/application may omit it;
- exact character set/collation for all VARCHAR/CHAR, especially user_id and email_normalized;
- PK/UNIQUE/index names and exact ordered column lists;
- FK constraint name, ON DELETE and ON UPDATE actions;
- CHECK constraints and confirmed TiDB support, otherwise service validation;
- generated/default behavior, auto-increment strategy and key allocation;
- timestamp ownership and conversion rules;
- comments/data classification for PII and restricted data.

Do not declare the physical dictionary complete until these attributes are present for every column.

## 8. TiDB negative/positive test matrix to implement in isolated preview

1. Valid FK insert and orphan child rejection for each FK.
2. Composite FK with correct tuple; wrong parent; reversed column order; partial NULL.
3. Type mismatch: signed vs unsigned, BIGINT vs INT, VARCHAR length, CHAR vs VARCHAR, charset and collation.
4. RESTRICT delete and referenced-key update.
5. Nullable UNIQUE with repeated NULL and duplicate non-NULL.
6. User email active claim atomic swap, failed verification, duplicate claim race.
7. Active role slot single-user race and role history retention.
8. Shift open simultaneous requests, duplicate retry, stale active slot, close/reopen.
9. Queue first counter initialization race, A/B independent sequences, assignment overlap race and TV switching.
10. Concurrent FEFO checkout for last available batch; rollback if any line fails.
11. Batch split across receipt deliveries/lots; multiple batches per invoice line.
12. Invoice direct medicine vs package component allocations, mismatched component parent and mismatched batch medicine.
13. Return quota reservation race, duplicate submission, release on rejection, consume on final approval, cancellation conflict.
14. Refund partial payout and duplicate payout; reject amount paid greater than obligation.
15. Supplier return from wrong invoice/batch and payment allocation to another supplier.
16. Reversal duplicate/replay and partial/full reversal boundary.
17. Reconciliation correction produces immutable new revision.
18. Idempotent retry with same key/same hash; same key/different hash rejection.
19. EXPLAIN for encounter, queue, POS FEFO, daily reports, patient search, stock card, audit and payable queries.

## 9. Release status

- Table/PK type-family dictionary: **normalized from current proposal**.
- Exact per-column NULL/default/collation dictionary: **incomplete**.
- FK tuple inventory: **enumerated as 104 candidate relationships**, with blocked and nullable relationships flagged.
- Composite parent key list: **defined as requirements, not all present in table definitions**.
- Child index ordering: **candidate list recorded; must verify against exact FK tuple and EXPLAIN**.
- TiDB runtime compatibility: **not run in this pass**.
- DDL: **not created or applied**.
- Firebase/Auth snapshot or cleanup: **not performed**.
- Production Vercel/Firebase/main/PR13: **unchanged**.

Next step: turn this manifest into an exact column-by-column null/default/collation dictionary and reconcile the base proposal's individual table definitions with the 104 FK candidates. Then prepare the isolated TiDB compatibility test package. Do not apply schema DDL until owner policy gates and static manifest are approved.
