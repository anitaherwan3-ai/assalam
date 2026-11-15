# CRITICAL OWNERSHIP CHAIN MATRIX — PASS 9

Date: 2026-11-15  
Branch: `migration/tidb-foundation`  
Status: **STATIC CROSS-DOCUMENT REVIEW — NO DDL / NO TiDB RUNTIME CLAIM**

## 1. Scope

This pass narrows the next engineering work to five high-value ownership chains. It does not add generic tables or expand feature scope. Evidence is taken from the Pass 3 FK manifest, Pass 4 exact column dictionary, and the current schema proposal. Where those documents do not establish a rule, the status remains OPEN.

## 2. Encounter and cashier-shift ownership

| Element | Pass 4 physical evidence | Required invariant | Status |
|---|---|---|---|
| patient_encounters.patient_id | BIGINT UNSIGNED, NULL | Normal new visit belongs to a patient; legacy exception must be explicitly quarantined | POLICY BLOCKER |
| patient_encounters.cashier_user_id | VARCHAR(64), NOT NULL | Cashier actor exists | TYPE CANDIDATE |
| patient_encounters.shift_id | BIGINT UNSIGNED, NULL | If shift is present, it belongs to the same cashier | NULL-PAIR BLOCKER |
| cashier_shifts.shift_id | BIGINT UNSIGNED, PK candidate | Stable shift identity | KEY VERIFICATION |
| cashier_shifts.cashier_user_id | VARCHAR(64), NOT NULL | Shift belongs to one cashier | TYPE CANDIDATE |
| active_shift_slots.shift_id | BIGINT UNSIGNED, NOT NULL | Active slot points to existing shift | COMPOSITE OWNERSHIP |
| active_shift_slots.cashier_user_id | VARCHAR(64), nullability unspecified in Pass 4 | Slot cashier must equal shift cashier | NULLABILITY + COMPOSITE BLOCKER |

Minimal safe rule: retain the composite parent key `cashier_shifts(shift_id,cashier_user_id)`. For new cashier-created encounters, decide whether shift is always mandatory. Do not weaken the new workflow merely to accept an unknown legacy row. If a legacy unshifted encounter is genuinely required, quarantine it or give it a separate explicit migration path; do not allow half-null ownership tuples.

## 3. Invoice, encounter and shift ownership

| Element | Pass 4 physical evidence | Required invariant | Status |
|---|---|---|---|
| sales_invoices.encounter_id | BIGINT UNSIGNED, NOT NULL | Invoice belongs to one encounter | TYPE CANDIDATE |
| sales_invoices.patient_id | BIGINT UNSIGNED, NULL | If populated, equals encounter patient | SNAPSHOT/MASTER POLICY |
| sales_invoices.cashier_user_id | VARCHAR(64), NOT NULL | Invoice cashier exists and matches encounter/shift | COMPOSITE OWNERSHIP |
| sales_invoices.shift_id | BIGINT UNSIGNED, NOT NULL | Invoice shift belongs to same cashier | COMPOSITE OWNERSHIP |
| patient_encounters(encounter_id,patient_id) | Parent composite key not established | Invoice patient must match encounter patient | PARENT KEY + NULLABILITY BLOCKER |
| cashier_shifts(shift_id,cashier_user_id) | UNIQUE candidate | Invoice cashier must own referenced shift | PARENT UNIQUE + FK BLOCKER |

Minimal safe rule: use composite ownership to prove the cashier owns the shift. Do not rely on independent single-column FKs. Decide whether invoice patient_id is a historical snapshot or a required FK to the encounter's patient; the current nullable column prevents a final composite key decision.

## 4. Medicine, batch and stock movement ownership

| Element | Pass 4 physical evidence | Required invariant | Status |
|---|---|---|---|
| inventory_batches.batch_id | BIGINT UNSIGNED, PK candidate | Stable batch identity | KEY VERIFICATION |
| inventory_batches.medicine_id | BIGINT UNSIGNED, NOT NULL | Batch belongs to one medicine | TYPE CANDIDATE |
| inventory_movements.medicine_id | BIGINT UNSIGNED, NOT NULL | Movement belongs to one medicine | TYPE CANDIDATE |
| inventory_movements.batch_id | BIGINT UNSIGNED, NULL | If batch-bound, batch belongs to same medicine | NULLABLE COMPOSITE BLOCKER |
| inventory_movements.quantity_delta | DECIMAL(18,3), NOT NULL | Quantity sign/direction follows movement_type | DOMAIN CHECK |
| invoice_batch_allocations.batch_id | BIGINT UNSIGNED, NOT NULL | Allocation uses a real batch | COMPOSITE OWNERSHIP |
| invoice_batch_allocations.movement_id | BIGINT UNSIGNED, NOT NULL | Movement is the exact sale deduction for that allocation | SAME-EVENT BLOCKER |

Minimal safe rule: retain `inventory_batches(batch_id,medicine_id)` as a parent UNIQUE candidate and use it wherever a batch+medicine pair is stored. Because movement.batch_id is nullable, define which movement types legitimately have no batch. Do not make all movements batch-required unless the source workflow proves it. A separate FK to movement_id alone does not prove the movement has the same batch, medicine, quantity and invoice allocation.

## 5. Return quota ownership

| Element | Pass 4 physical evidence | Required invariant | Status |
|---|---|---|---|
| sales_return_lines.return_quota_subject_id | BIGINT UNSIGNED, NOT NULL | Every return line consumes exactly one quota subject | REQUIRED |
| sales_return_lines.invoice_line_id | BIGINT UNSIGNED, NOT NULL | Must equal quota subject's invoice line | COMPOSITE BLOCKER |
| sales_return_lines.invoice_component_id | BIGINT UNSIGNED, NULL | If set, must belong to that invoice line and quota subject | NULLABLE COMPOSITE BLOCKER |
| return_quota_subjects.return_quota_subject_id | BIGINT UNSIGNED, PK candidate | Stable subject identity | KEY VERIFICATION |
| return_quota_subjects.invoice_line_id | BIGINT UNSIGNED, NOT NULL | Subject belongs to one invoice line | TYPE CANDIDATE |
| return_quota_subjects.invoice_component_id | BIGINT UNSIGNED, NULL | Optional component discriminator | POLICY/COMPOSITE BLOCKER |
| sold/reserved/approved quantities | DECIMAL(18,3) | Concurrent reservations cannot exceed sold quantity | TRANSACTION TEST BLOCKER |

Minimal safe rule: keep the existing surrogate `return_quota_subject_id`; do not invent another generic subject registry. Add exact composite ownership only after deciding the line-level versus package-component identity. The command must lock the quota subject and perform reserve/approve/release atomically; a read-then-write without locking is unsafe.

## 6. Supplier return, credit and payment ownership

| Element | Pass 4 physical evidence | Required invariant | Status |
|---|---|---|---|
| supplier_returns.supplier_invoice_id | BIGINT UNSIGNED, NOT NULL | Return belongs to one purchase invoice | TYPE CANDIDATE |
| supplier_return_lines.supplier_return_id | BIGINT UNSIGNED, NOT NULL | Line belongs to its return | TYPE CANDIDATE |
| supplier_return_lines.supplier_invoice_line_id | BIGINT UNSIGNED, NOT NULL | Receipt line belongs to same invoice as return | SAME-INVOICE BLOCKER |
| supplier_return_lines.batch_id | BIGINT UNSIGNED, NOT NULL | Batch belongs to the same medicine/receipt line | SAME-BATCH BLOCKER |
| supplier_credit_notes.supplier_return_id | BIGINT UNSIGNED, NOT NULL | Credit note belongs to one return | UNIQUE CANDIDATE |
| supplier_credit_notes.supplier_invoice_id | BIGINT UNSIGNED, NOT NULL | Credit note invoice equals return invoice | COMPOSITE BLOCKER |
| supplier_payments.supplier_id | BIGINT UNSIGNED, NOT NULL | Payment belongs to one supplier | TYPE CANDIDATE |
| supplier_payment_allocations.supplier_payment_id | BIGINT UNSIGNED, NOT NULL | Allocation references payment | TYPE CANDIDATE |
| supplier_payment_allocations.supplier_invoice_id | BIGINT UNSIGNED, NOT NULL | Invoice belongs to same supplier as payment | SAME-SUPPLIER BLOCKER |

Minimal safe rule: use composite parent keys to prove supplier and invoice identity. Do not enforce one receipt line → one batch until split/partial delivery behavior is verified. The raw Pass 4 dictionary also contains an anomalous duplicate-looking `expiry` entry in supplier_invoice_lines; resolve it from source before schema freeze.

## 7. Required test matrix — only targeted business invariants

| Test | Positive case | Negative case |
|---|---|---|
| SHIFT-OWN-01 | Cashier uses own active shift | Cashier references another cashier's shift |
| INV-OWN-01 | Invoice patient/cashier/shift agree with encounter | Invoice patient or cashier differs from encounter |
| STOCK-OWN-01 | Movement deducts medicine from its own batch | Movement references a batch of another medicine |
| STOCK-ALLOC-01 | Invoice allocation references matching sale movement | Allocation references unrelated movement |
| RETURN-QUOTA-01 | Return within remaining sold quantity | Two concurrent returns exceed sold quantity |
| SUP-RETURN-01 | Return line uses batch from its originating invoice line | Batch or receipt line belongs to another supplier invoice |
| SUP-PAY-01 | Payment allocated to invoice of same supplier | Payment allocated to invoice of a different supplier |
| IDEMP-01 | Repeated command returns same result | Retry creates duplicate money or stock effect |

No exhaustive Cartesian product is required. Add boundary cases only for actual decimal precision, rounding, date cut-off or concurrency semantics.

## 8. Decisions not to overfit

- Do not add a general ownership registry; composite FKs and transactional commands are the preferred mechanism.
- Do not add a new return subject abstraction; use the existing quota subject identity once its component rule is finalized.
- Do not add one batch-allocation bridge per hypothetical purchase path; add it only if partial receipt/multiple lots are confirmed.
- Do not force every stock movement to have a batch; establish actual movement-type semantics first.
- Do not make legacy nullability a permanent weakness in new transactions; isolate legacy exceptions.
- Do not claim TiDB supports any constraint behavior until the isolated compatibility suite proves it.

## 9. Release status

All five chains remain **NOT READY FOR DDL** until their listed blockers are resolved and the required positive/negative tests pass in isolated TiDB preview. This is a static review; no schema, data, Firebase/Auth, protected account, deployment, main branch or PR13 was changed.
