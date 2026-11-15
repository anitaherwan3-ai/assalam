# CANONICAL FK / UNIQUE / INDEX CANDIDATE CATALOGUE — SCHEMA V1
Date: 2026-11-15 | Branch: migration/tidb-foundation
Status: CANDIDATE REVIEW CATALOGUE — NOT APPROVED DDL

## Rules
All FK column types, signedness, lengths and text charset/collation must exactly match the referenced PK/UNIQUE tuple. Every child FK needs an index beginning with the FK tuple. Default delete is RESTRICT; keys immutable (no ON UPDATE CASCADE). Never cascade-delete patient, identity, invoice, finance, stock, payment, return, audit or event history. NEEDS SPECIFICATION / NEEDS COMPOSITE / BLOCKED rows prevent schema freeze.

## 1. Identity and roles

| Child columns | Parent columns/key | Child index | Invariant / status |
|---|---|---|---|
| user_emails.user_id | users.user_id PK | (user_id,valid_to_utc) | Retain user; close email history. CANDIDATE |
| user_emails.changed_by_user_id | users.user_id PK | (changed_by_user_id) | Nullable only for defined system/import actor. NEEDS SPEC |
| role_assignments.user_id | users.user_id PK | (user_id,valid_to_utc) | Role history retained. CANDIDATE |
| role_assignments.granted_by_user_id | users.user_id PK | (granted_by_user_id) | System provisioning semantics. NEEDS SPEC |
| active_email_claims.user_id | users.user_id PK | UNIQUE(user_id) | Verified active claim only. CANDIDATE |
| active_email_claims.(email_id,user_id) | user_emails.(email_id,user_id) UNIQUE | same UNIQUE tuple | Proves email row belongs to user. CANDIDATE |
| active_role_slots.(role_assignment_id,user_id) | role_assignments.(role_assignment_id,user_id) UNIQUE | same UNIQUE tuple | Proves assignment belongs to user. CANDIDATE |
| active_shift_slots.cashier_user_id | users.user_id PK | PK | Slot owner exists. CANDIDATE |
| active_shift_slots.(shift_id,cashier_user_id) | cashier_shifts.(shift_id,cashier_user_id) UNIQUE | same tuple | Shift belongs to slot owner. CANDIDATE |
| clinic_settings.updated_by_user_id | users.user_id PK | (updated_by_user_id) | System seed actor unresolved. NEEDS SPEC |
| display_configs.updated_by_user_id; queue_audio_assets.updated_by_user_id | users.user_id PK | separate indexes | Actor attribution. CANDIDATE |

## 2. Patient, encounter and queue

| Child columns | Parent columns/key | Child index | Invariant / status |
|---|---|---|---|
| patient_encounters.patient_id | patients.patient_id PK | (patient_id,business_date) | Nullable only for approved legacy quarantine; new visit requires patient. NEEDS SPEC |
| patient_encounters.cashier_user_id | users.user_id PK | (cashier_user_id,business_date) | CANDIDATE |
| patient_encounters.(shift_id,cashier_user_id) | cashier_shifts.(shift_id,cashier_user_id) UNIQUE | (shift_id,cashier_user_id) | Same cashier owns shift; nullable legacy pair semantics unresolved. NEEDS COMPOSITE |
| cashier_queue_assignments.user_id / assigned_by_user_id | users.user_id PK | (user_id,valid_from,valid_to); (assigned_by_user_id) | Assignment actor and stable cashier identity. CANDIDATE |
| queue_tickets.encounter_id | patient_encounters.encounter_id PK | UNIQUE(encounter_id) if one ticket/visit | One ticket per encounter must be confirmed. NEEDS SPEC |
| queue_tickets.registered_by_user_id | users.user_id PK | (registered_by_user_id) | CANDIDATE |
| queue_call_events.queue_ticket_id | queue_tickets.queue_ticket_id PK | (queue_ticket_id,occurred_at_utc) | Append-only event. CANDIDATE |
| queue_call_events.actor_user_id | users.user_id PK | (actor_user_id) | System actor definition. NEEDS SPEC |
| patient_handoffs.* | encounter/users/shifts respective PKs | indexes per FK | PR13-only; exclude until separately approved. BLOCKED |

## 3. Shift, cash, expense and inventory loss

| Child columns | Parent columns/key | Child index | Invariant / status |
|---|---|---|---|
| cashier_shifts.cashier_user_id / closed_by_user_id | users.user_id PK | (cashier_user_id,business_date,status); (closed_by_user_id) | closed_by nullable until close. CANDIDATE |
| shift_reconciliations.shift_id | cashier_shifts.shift_id PK | UNIQUE(shift_id) | Correction/version policy required. NEEDS SPEC |
| shift_reconciliations.verified_by_user_id | users.user_id PK | (verified_by_user_id) | Nullable until verified; D12 verifier unresolved. NEEDS SPEC |
| cash_ledger_entries.shift_id / actor_user_id | cashier_shifts.shift_id; users.user_id | (shift_id,occurred_at_utc); (actor_user_id,occurred_at_utc) | Shift nullable only for management account; define scope. NEEDS SPEC |
| cash_ledger_entries.reversal_of_entry_id | cash_ledger_entries.cash_entry_id PK | (reversal_of_entry_id) | Self-FK and reversal count semantics. NEEDS SPEC |
| bank_ledger_entries.actor_user_id / reversal_of_entry_id | users.user_id; bank_ledger_entries.bank_entry_id | (actor_user_id,occurred_at_utc); (reversal_of_entry_id) | Self-FK reversal policy. NEEDS SPEC |
| petty_cash_entries.(shift_id,cashier_user_id) | cashier_shifts.(shift_id,cashier_user_id) UNIQUE | (shift_id,cashier_user_id) | Same cashier owns shift. NEEDS COMPOSITE |
| petty_cash_entries.cashier_user_id | users.user_id PK | (cashier_user_id,business_date) | CANDIDATE |
| expenses.created_by_user_id / approved_by_user_id | users.user_id PK | separate indexes | Self-approval/threshold D08 unresolved. NEEDS SPEC |
| expense_events.expense_id / actor_user_id | expenses.expense_id; users.user_id | (expense_id,occurred_at_utc); (actor_user_id,occurred_at_utc) | Append-only. CANDIDATE |
| loss_events.medicine_id | medicines.medicine_id PK | (medicine_id,occurred_at_utc) | CANDIDATE |
| loss_events.(batch_id,medicine_id) | inventory_batches.(batch_id,medicine_id) UNIQUE | (batch_id,medicine_id) | Same medicine/batch; parent unique required. NEEDS COMPOSITE |

## 4. Master, suppliers and inventory

| Child columns | Parent columns/key | Child index | Invariant / status |
|---|---|---|---|
| package_components.package_id | service_packages.package_id PK | (package_id,sort_order) | CANDIDATE |
| package_components.medicine_id / tariff_id | medicines.medicine_id / tariffs.tariff_id | separate indexes | Exactly one target by component_type; API and optional CHECK. NEEDS SPEC |
| supplier_invoices.supplier_id / created_by_user_id | suppliers.supplier_id / users.user_id | (supplier_id,invoice_date); (created_by_user_id) | CANDIDATE |
| supplier_invoice_lines.supplier_invoice_id / medicine_id | supplier_invoices.supplier_invoice_id / medicines.medicine_id | (supplier_invoice_id,medicine_id); (medicine_id) | CANDIDATE |
| inventory_batches.medicine_id | medicines.medicine_id PK | (medicine_id,expiry_date,remaining_quantity) | CANDIDATE |
| inventory_batches.supplier_invoice_line_id | supplier_invoice_lines.supplier_invoice_line_id PK | UNIQUE(supplier_invoice_line_id) | Nullable opening batch; one batch per receipt line not confirmed. NEEDS SPEC |
| inventory_batches.(supplier_invoice_line_id,medicine_id) | supplier_invoice_lines.(supplier_invoice_line_id,medicine_id) UNIQUE | same tuple | Receipt-line medicine must equal batch medicine. NEEDS COMPOSITE |
| inventory_movements.medicine_id / batch_id | medicines.medicine_id; inventory_batches.batch_id | (medicine_id,occurred_at_utc); (batch_id,medicine_id,occurred_at_utc) | Nullable batch for non-batch movement; if present same medicine. NEEDS COMPOSITE |
| inventory_movements.actor_user_id / reversal_of_movement_id | users.user_id; inventory_movements.inventory_movement_id | (actor_user_id); (reversal_of_movement_id) | System actor and one-time reversal policy. NEEDS SPEC |
| stocktakes.created_by_user_id / approved_by_user_id | users.user_id | separate indexes | Approver nullable until approved. CANDIDATE |
| stocktake_lines.stocktake_id / medicine_id | stocktakes.stocktake_id; medicines.medicine_id | (stocktake_id); (medicine_id) | CANDIDATE |
| stocktake_lines.(batch_id,medicine_id) | inventory_batches.(batch_id,medicine_id) UNIQUE | (batch_id,medicine_id) | Batch and medicine same; batch nullable for aggregate count. NEEDS COMPOSITE |

## 5. Sales, returns and cancellation

| Child columns | Parent columns/key | Child index | Invariant / status |
|---|---|---|---|
| sales_invoices.encounter_id | patient_encounters.encounter_id PK | (encounter_id) | Required. CANDIDATE |
| sales_invoices.patient_id | patients.patient_id PK | (patient_id,business_date) | Must equal encounter.patient_id when both set. NEEDS COMPOSITE |
| sales_invoices.cashier_user_id | users.user_id PK | (cashier_user_id,business_date) | CANDIDATE |
| sales_invoices.(shift_id,cashier_user_id) | cashier_shifts.(shift_id,cashier_user_id) UNIQUE | (shift_id,cashier_user_id) | Same cashier owns shift. NEEDS COMPOSITE |
| sales_invoice_lines.invoice_id | sales_invoices.invoice_id PK | UNIQUE(invoice_id,line_no) | CANDIDATE |
| sales_invoice_lines.medicine_id / tariff_id / package_id | respective master PKs | index each nullable target | Exactly one target by line_type. NEEDS SPEC |
| sales_invoice_line_components.invoice_line_id | sales_invoice_lines.invoice_line_id PK | UNIQUE(invoice_line_id,component_no) | CANDIDATE |
| sales_invoice_line_components.medicine_id / tariff_id | respective master PKs | index each nullable target | Exactly one component target. NEEDS SPEC |
| invoice_batch_allocations.invoice_line_id / invoice_component_id | sales_invoice_lines / components PK | separate indexes | Direct line vs package component nullable rules. NEEDS SPEC |
| invoice_batch_allocations.batch_id | inventory_batches.batch_id PK | (batch_id) | Must match sold medicine/component medicine. NEEDS COMPOSITE |
| invoice_batch_allocations.movement_id | inventory_movements.inventory_movement_id PK | UNIQUE(movement_id) | Must be sale deduction for same batch and qty. CANDIDATE |
| invoice_discount_allocations.invoice_id / invoice_line_id | sales_invoices / sales_invoice_lines | UNIQUE(invoice_id,invoice_line_id) | Composite key proves line belongs to invoice. NEEDS COMPOSITE |
| invoice_payments.invoice_id / actor_user_id | sales_invoices / users PK | (invoice_id); (actor_user_id) | CANDIDATE |
| sales_returns.invoice_id | sales_invoices.invoice_id PK | (invoice_id,status) | CANDIDATE |
| sales_returns.requested/admin/final actor IDs | users.user_id PK | separate indexes | State-dependent nullability and approval policy. NEEDS SPEC |
| sales_return_lines.sales_return_id | sales_returns.sales_return_id PK | (sales_return_id) | CANDIDATE |
| sales_return_lines.return_quota_subject_id / invoice_line_id / invoice_component_id | quota subject / line / component PK | separate indexes | Must all identify same invoice component/line. NEEDS COMPOSITE |
| return_quota_subjects.invoice_line_id / invoice_component_id | sales_invoice_lines / components PK | (invoice_line_id,invoice_component_id); (invoice_component_id) | Component must belong to line; nullable only for non-package line. NEEDS COMPOSITE |
| sales_return_events.sales_return_id / actor_user_id | sales_returns / users PK | (sales_return_id,occurred_at_utc); (actor_user_id) | Append-only; actor policy. CANDIDATE |
| refund_obligations.sales_return_id / approved_by_user_id | sales_returns / users PK | UNIQUE(sales_return_id); (approved_by_user_id) | One obligation after final approval. CANDIDATE |
| refund_payments.refund_obligation_id / paid_by_user_id | refund_obligations / users PK | (refund_obligation_id,paid_at_utc); (paid_by_user_id) | D13 payout authority unresolved. NEEDS SPEC |
| cancellation_requests.invoice_id / requested_by_user_id / decided_by_user_id | invoices / users PK | (invoice_id,status); separate actor indexes | CANDIDATE |
| cancellation_events.cancellation_request_id / actor_user_id | cancellation_requests / users PK | (cancellation_request_id,occurred_at_utc); (actor_user_id) | Append-only. CANDIDATE |

## 6. Supplier finance, audit and platform

| Child columns | Parent columns/key | Child index | Invariant / status |
|---|---|---|---|
| supplier_returns.supplier_invoice_id / requested_by_user_id / approved_by_user_id | supplier_invoices / users PK | (supplier_invoice_id,status); actor indexes | CANDIDATE |
| supplier_return_lines.supplier_return_id / supplier_invoice_line_id / batch_id | supplier_returns / receipt lines / batches PK | separate indexes | Must all match same invoice, medicine and exact batch. NEEDS COMPOSITE |
| supplier_credit_notes.supplier_return_id / supplier_invoice_id | supplier_returns / supplier_invoices | UNIQUE(supplier_return_id); (supplier_invoice_id) | Invoice must equal return invoice. NEEDS COMPOSITE |
| supplier_payments.supplier_id / paid_by_user_id | suppliers / users PK | (supplier_id,payment_date); (paid_by_user_id) | CANDIDATE |
| supplier_payment_allocations.supplier_payment_id / supplier_invoice_id | payments / supplier invoices PK | UNIQUE(payment_id,invoice_id); (invoice_id) | Must be same supplier. NEEDS COMPOSITE |
| audit_events.actor_user_id | users.user_id PK | (actor_user_id,occurred_at_utc) | Nullable only for explicit system actor; human actor never deleted. NEEDS SPEC |
| idempotency_requests.actor_user_id | users.user_id PK | UNIQUE(actor,command,key) | CANDIDATE |
| outbox_jobs.aggregate_type/aggregate_id | typed registry or source-specific links | (aggregate_type,aggregate_id) | Polymorphic; service validation + reconciliation. NEEDS SPEC |
| stored_files.created_by_user_id | users.user_id PK | (created_by_user_id,created_at_utc) | CANDIDATE |
| backup_jobs.initiated_by_user_id | users.user_id PK | (initiated_by_user_id) | Nullable for scheduled system task; define system actor. NEEDS SPEC |
| export_jobs.requested_by_user_id | users.user_id PK | (requested_by_user_id,created_at_utc) | CANDIDATE |

## 7. Parent keys and missing child indexes to add/verify
- Parent UNIQUE: user_emails(email_id,user_id); role_assignments(role_assignment_id,user_id); cashier_shifts(shift_id,cashier_user_id); supplier_invoice_lines(supplier_invoice_line_id,medicine_id); inventory_batches(batch_id,medicine_id); sales_invoice_lines(invoice_line_id,invoice_id); sales_invoice_line_components(invoice_component_id,invoice_line_id); supplier_payments(supplier_payment_id,supplier_id); supplier_invoices(supplier_invoice_id,supplier_id); and a quota subject composite key that handles nullable component semantics correctly.
- Child indexes: patient_encounters(shift_id,cashier_user_id); sales_invoices(shift_id,cashier_user_id); petty_cash_entries(shift_id,cashier_user_id); inventory_movements(batch_id,medicine_id,occurred_at_utc); loss_events(batch_id,medicine_id); stocktake_lines(batch_id,medicine_id); invoice_batch_allocations(batch_id); invoice_discount_allocations(invoice_id,invoice_line_id) plus line-leading lookup; supplier_return_lines(supplier_invoice_line_id) and (batch_id); supplier_payment_allocations(supplier_invoice_id); sales_return_lines(return_quota_subject_id) and (invoice_line_id); sales_return_events(sales_return_id,occurred_at_utc).
- Self-FK indexes: cash/bank reversals, inventory movement reversal, loss reversal if field exists.
- Every child index tuple and composite parent key must be confirmed against exact final column names/types and TiDB's FK implementation.

## 8. Release status
This catalogue covers the currently visible proposed tables, not proof of complete source-to-target field mapping. NEEDS SPEC / NEEDS COMPOSITE / BLOCKED items remain. No DDL, TiDB FK/index runtime test, historical orphan query or deployment performed.
