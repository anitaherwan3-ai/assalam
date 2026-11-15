# INVENTORY LEDGER OWNERSHIP & FK LINEAGE CLOSURE — PASS 14
Tanggal: 2026-11-15  
Branch: `migration/tidb-foundation`  
Status: **STATIC DESIGN AUDIT — NO DDL / NO TiDB RUNTIME VALIDATION**

## 1. Purpose

Pass 14 checks whether the proposed inventory ledger can prove the complete ownership chain for each stock effect, rather than merely prove that referenced IDs exist. It also reconciles one internal design inconsistency about movement quantity sign.

Inputs:
- `MYSQL_MIGRATION_INVENTORY_MOVEMENT_SOURCE_MATRIX_PASS13.md`
- `MYSQL_MIGRATION_CRITICAL_OWNERSHIP_CHAIN_MATRIX_PASS9.md`
- `MYSQL_MIGRATION_FK_FIELD_LEVEL_EXPANSION_PASS7.md`
- `MYSQL_MIGRATION_CANONICAL_FK_INDEX_CATALOGUE.md`
- `MYSQL_MIGRATION_SCHEMA_PROPOSAL.md` §§5.7–5.10, 6.4 and supplier-return sections
- Pass 3 FK manifest F39, F48–F53, F57, F66–F69, F92–F93 and Pass 4 exact column dictionary.

This pass is a design-level traceability review. It does not establish TiDB's actual FK/check/locking behavior and does not approve any DDL.

## 2. Important correction: signed delta vs positive quantity

The proposal defines `inventory_movements.quantity_delta DECIMAL(18,3)`, and Pass 9 explicitly describes a signed quantity delta. Pass 13's invariant that “movement quantity is positive; direction/type determines inbound or outbound” conflicts with that column definition.

**Closure:** retain one signed `quantity_delta` for the v1 candidate because it directly supports the balance equation and avoids duplicating direction and sign. Define:
- inbound movement types must have `quantity_delta > 0`;
- outbound movement types must have `quantity_delta < 0`;
- no zero-quantity movement;
- movement type is from a closed allowlist and its sign is checked by the domain service (and a SQL CHECK only if TiDB version/runtime test proves enforcement);
- a reversal has the opposite sign and is bounded by the unreversed original movement quantity.

Pass 13's “quantity is positive” sentence is superseded by this clarification. Do not add a second direction column unless later source evidence requires it.

## 3. Per-workflow lineage matrix

| Movement | Owning business source | Required identity chain | Batch rule | Balance effect | Evidence / unresolved gate |
|---|---|---|---|---|---|
| Opening/seed | Explicit opening stock record or approved migration fixture | medicine → batch → opening provenance | Batch required for batch-tracked stock; no invented source for legacy unknown | + medicine, + batch | Legacy seed provenance must be classified; do not label ordinary purchase |
| Purchase receipt | Supplier invoice line / receipt | supplier → invoice → line → medicine; batch → same medicine and receipt allocation | Exact received batch required for observed path | + medicine, + batch | One-batch-per-line not proven universally; no UNIQUE yet |
| Sale issue | Invoice line or package component | invoice → line → component (if package) → medicine; allocation → batch of same medicine; allocation → exact SALE_ISSUE movement | Required | − medicine, − batch | Allocation sum must equal sold medicine demand |
| Patient return restore | Approved return line → quota subject → original invoice line/component → original sale allocations | return invoice and line must match quota subject; restored batch must be among original allocations | Required for medicine restore | + medicine, + batch | Resalable/quarantine policy remains owner gate |
| Invoice cancellation restore | Approved cancellation → invoice → original lines/components → original sale allocations | Cancellation must own invoice; reversal must link to original sale movement/allocation | Required where original sale was batch-tracked | + medicine, + batch | Cancellation and return share invoice lock; cannot both finalize |
| Supplier return | Supplier return line → source supplier invoice line → batch → same medicine | Return, invoice line, supplier and batch receipt ownership must agree | Required in observed flow | − medicine, − batch | Existing local path picks first batch and silently caps; target must select exact batch and reject excess |
| Loss/expiry | Loss event → medicine + batch | Loss medicine must equal batch medicine; actor and reason recorded | Required in observed UI path | − medicine, − batch | Correct by linked reversal; never delete source loss |
| Stocktake variance | Approved stocktake line → medicine + optional batch | If batch supplied it must belong to medicine; counted/system/variance values reconcile | Batch required for batch-level variance; aggregate-only remains unproven | Signed variance | Only negative variance observed through loss UI; positive variance workflow remains unsupported until proven |

## 4. FK closure by relationship

### 4.1 Medicine and batch

Candidate parent:
- `medicines(medicine_id)` PK.
- `inventory_batches(batch_id,medicine_id)` UNIQUE in exact order.

Required child relationships:
- `inventory_batches.medicine_id → medicines.medicine_id`.
- `inventory_movements.medicine_id → medicines.medicine_id`.
- For batch-bound movement, `(batch_id,medicine_id) → inventory_batches(batch_id,medicine_id)`.
- `loss_events(batch_id,medicine_id) → inventory_batches(batch_id,medicine_id)`.
- `stocktake_lines(batch_id,medicine_id) → inventory_batches(batch_id,medicine_id)`, when batch_id is non-null.
- `invoice_batch_allocations.batch_id → inventory_batches.batch_id`, plus a second ownership tuple proving its medicine matches the invoice line/component medicine.

A nullable `batch_id` means a composite FK containing it can be bypassed by ordinary SQL NULL semantics. Keep the medicine FK independently. Do not assume a composite FK proves the medicine/batch pair when the batch side is NULL. For rows where batch is required, enforce non-null by movement type in a verified CHECK or command service and test negative cases.

### 4.2 Sale movement and allocation — critical same-event gap

Current candidate:
- allocation references invoice line/component, batch and unique `movement_id`.
- movement references medicine and nullable batch.

A simple `movement_id` FK does not prove that:
1. movement type is SALE_ISSUE;
2. movement is for the same medicine and batch;
3. movement quantity equals allocation quantity with the correct sign;
4. movement source invoice line/component equals allocation's line/component.

**Required closure before DDL:** define a parent UNIQUE tuple on the movement such as `(inventory_movement_id,movement_type,medicine_id,batch_id,source_line_id)` only if exact source column types and nullability are frozen; then make allocation store the matching type/medicine/batch/source identity and reference that exact tuple. Alternatively use a one-to-one typed sale-allocation relation whose transaction service verifies the full tuple. Do not create a broad generic registry. Exact physical tuple remains BLOCKED until source ID widths and nullable component semantics are settled.

Allocation quantity must equal the absolute movement delta; this is a cross-row equality and therefore requires transactional service validation, not a normal FK.

### 4.3 Purchase receipt and batch

Candidate:
- `supplier_invoice_lines(supplier_invoice_line_id,supplier_invoice_id,medicine_id)` parent UNIQUE after exact key review.
- `inventory_batches(supplier_invoice_line_id,medicine_id)` references the source line where non-null.

Do not make `supplier_invoice_line_id` UNIQUE until split deliveries, expiry lots and partial receipts are disproven. If a source line can create several batches, the batch rows may each reference the same line; a quantity allocation/receipt relation is only justified when the source workflow demonstrates the need. Current local method creates one batch per purchase command, which is not sufficient proof of global one-to-one cardinality.

A batch's medicine must match the source line's medicine. Its received quantity must be included in the receipt-line total. The latter is a cross-row aggregate and needs transactional validation/reconciliation.

### 4.4 Supplier return chain

Required relationships:
- `supplier_return_lines.supplier_return_id → supplier_returns.supplier_return_id`.
- `supplier_return_lines.supplier_invoice_line_id → supplier_invoice_lines.supplier_invoice_line_id`.
- `supplier_return_lines.batch_id → inventory_batches.batch_id`.
- Composite ownership must prove return invoice = source invoice line invoice; batch medicine = source invoice line medicine; and batch receipt source = that invoice line (or a verified allocation if split receipts exist).
- Credit note must belong to the same supplier return and invoice.
- Supplier payment allocation must use an invoice belonging to the same supplier as the payment.

Independent scalar FKs are insufficient. Exact composite tuples and parent UNIQUE keys remain DDL blockers until all referenced columns are typed and indexed in the final physical dictionary.

### 4.5 Return and cancellation restore chain

A patient return line must resolve to exactly one quota subject and the same invoice line/component. The original allocation(s) are the only allowed source of batch restoration. A cancellation must resolve to the invoice and its original allocations. The finalizer must lock the invoice, quota subject, return/cancellation request, affected allocations, batches and medicine balance rows in a deterministic order.

No restoration is valid if original sale allocation is missing, mismatched or already fully reversed. Legacy rows with missing lineage are quarantined for manual reconciliation; do not guess the batch from current stock.

## 5. Polymorphic source reference decision

The proposal currently has `source_type + source_id + source_line_id`. These columns are useful for migration traceability, but they do not provide relational FK enforcement and their widths may not match all source keys.

Do not pretend that a polymorphic string reference is a foreign key. For v1:
1. Preserve source type and source IDs as provenance fields only, with exact width selected after source-ID inventory.
2. Every stock-changing command must also write its typed business source relation in the same transaction: e.g. invoice batch allocation for sale, supplier return line for supplier return, loss event for loss, and approved return/cancellation line relation for restoration.
3. Require unique idempotency key per source effect and enforce one movement per command-line effect where cardinality is one-to-one.
4. Where one source line legitimately produces multiple batch movements, use a one-to-many source-to-movement relationship, not a false UNIQUE.
5. Do not add a generic `inventory_source_registry` table solely to make polymorphic IDs look relational.

The exact typed back-reference placement (movement FK from source row vs typed nullable source columns on movement) must be selected after the full table/column audit. This is an engineering closure item, not an owner question.

## 6. Reversal and append-only semantics

- `reversal_of_movement_id` is a self-FK to `inventory_movements`.
- Do not make it UNIQUE by default: a single original movement may require multiple partial reversals if the business workflow supports them. If the workflow is one full reversal only, prove that before adding UNIQUE.
- Every reversal has opposite sign and same medicine; if batch-bound, same batch; source/actor/reason are recorded.
- Under row lock, cumulative absolute reversal quantity must never exceed original absolute quantity.
- Original movement is immutable. No stock-affecting correction deletes or edits historical movements.
- Balance projection updates and movement insert commit atomically. Reconciliation reports discrepancies; it must not silently auto-repair production balances.

## 7. Proposed minimal validation constraints

These are semantic requirements, not yet executable SQL:
1. `quantity_delta <> 0`.
2. `movement_type` belongs to the explicit supported allowlist.
3. Inbound types have positive delta; outbound types have negative delta; stocktake variance may have either sign only if an approved positive/negative workflow exists.
4. Batch-required types reject NULL batch_id.
5. If batch_id is present, batch belongs to the same medicine.
6. Allocation quantity is positive and equals absolute linked sale movement delta.
7. Invoice line/component medicine matches allocation medicine and batch medicine.
8. Supplier return source invoice, receipt line, batch, medicine and supplier all agree.
9. Sum of reversals never exceeds original movement.
10. One idempotency key cannot produce duplicate stock effects.

TiDB enforcement via CHECK, composite FK, generated columns, unique index, or transaction service must be selected only after actual cluster compatibility tests. Do not claim any item enforced yet.

## 8. Contradiction and risk register

| Issue | Resolution / next action | Status |
|---|---|---|
| Pass 13 says positive quantity but proposal uses signed quantity_delta | Signed delta retained; movement type constrains sign | CLOSED DESIGN |
| Nullable batch and composite FK bypass risk | Keep medicine FK; enforce batch-required types and pair ownership | BLOCKER until runtime tests |
| Movement-to-allocation same-event identity | Exact composite tuple or typed one-to-one relation | BLOCKER |
| Polymorphic source_type/id has no FK | Treat as provenance only; typed business relations required | BLOCKER |
| Supplier line-to-batch cardinality | No UNIQUE until split/partial receipt source audit | OPEN |
| Return/cancel original batch lineage | Original allocation only; invoice lock and exact reversal bound | CLOSED DESIGN / runtime test open |
| Actor_user_id NOT NULL vs system/import actors | Define a real system principal or explicit actor provenance; never invent fake human user | BLOCKER |
| Source IDs widths 80 vs 128 vs Firestore IDs | Inventory exact source ID formats before choosing columns | BLOCKER |
| Batchless stocktake/opening types | Keep narrowly typed; no generic batchless adjustment | OPEN |

## 9. Focused TiDB compatibility and integrity tests required

Run only in isolated preview with synthetic fixtures after schema candidate is generated:
- composite FK rejects a batch/medicine mismatch;
- nullable composite FK behavior is measured and cannot be mistaken for proof when batch_id is NULL;
- CHECK rejects zero delta and wrong movement sign if CHECK is intended to enforce;
- sale allocation cannot reference non-sale movement or mismatched batch/medicine;
- source line/batch supplier ownership mismatch is rejected;
- duplicate movement idempotency key rejected;
- partial reversal total cannot exceed original under two concurrent connections;
- two concurrent sale commands cannot overdraw the same batch;
- return vs cancellation race yields one terminal path;
- transaction rollback leaves no movement/allocation/balance partial state;
- all FK parent keys and child indexes use exact ordered tuples and matching physical types/collations.

No test result is claimed in this document.

## 10. Safety and status

Documentation-only design closure. No DDL, TiDB table/data mutation, Firebase/Auth change, live data query, Vercel deployment, main merge, PR13 merge or production change. Schema v1 remains **BLOCKED** pending source identity closure, exact FK tuple definitions and isolated TiDB runtime compatibility tests.
