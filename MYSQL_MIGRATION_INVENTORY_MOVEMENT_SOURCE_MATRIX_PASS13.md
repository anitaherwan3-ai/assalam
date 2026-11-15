# INVENTORY MOVEMENT SOURCE MATRIX & LEDGER CLOSURE — PASS 13
Tanggal: 2026-11-15  
Branch: `migration/tidb-foundation`  
Status: **STATIC SOURCE MAPPING — NOT DDL / NOT RUNTIME RECONCILIATION**

## 1. Purpose and inspected evidence

Pass 13 defines the smallest evidence-backed inventory movement vocabulary from the inspected source, without inventing a generic event framework.

Inspected:
- `js/store.js` SHA `99e74acf8caec9c70d82be1d5f6efc5bfa6bc4fb`: `deductBatchFEFO`, `recordPurchase`, `processReturJual`, `approveReturJual`, `processReturBeli`.
- `js/app.js` SHA `f74c4710161ddd2af230e51c18b1f107d6c52c82`: checkout stock decrement/rollback, expired batch disposal, loss/opname entry/reversal, stock card projection.
- `js/firebase-backend.js` SHA `3a613d96564f120b8141966f9ecbae21471c4e65`: atomic checkout commit, return finalization and invoice cancellation stock restoration.

No live stock data was read. These are observed code paths, not a verified historical movement union.

## 2. Minimal movement vocabulary grounded in source

| Movement kind | Source operation | Medicine balance | Batch balance | Required source link | Batch required? | Reversal rule |
|---|---|---:|---:|---|---|---|
| `OPENING_BALANCE` / `SEED_OPENING` | Initial demo batches / verified opening stock | + | + | Explicit opening/seed provenance | Yes when batch exists; legacy unknown may be quarantined | Correct only by linked reversal/adjustment, never rewrite opening evidence |
| `PURCHASE_RECEIPT` | `recordPurchase()` | + | + | Supplier invoice line / receipt | Yes for this observed receipt path | Supplier return is a separate outbound movement; do not delete receipt |
| `SALE_ISSUE` | `deductBatchFEFO()` + `commitCashierTransaction()` | - | - | Invoice line and exact batch allocation | Yes for medicine sale | Cancellation or approved return posts separate inbound reversal; never edit sale movement |
| `SALES_RETURN_RESTORE` | `finalizeReturJual()` | + | + | Approved return line and original invoice batch allocation | Yes for medicine quantity restored | If restored item is not resalable, use quarantine/loss disposition instead of available stock |
| `INVOICE_CANCEL_RESTORE` | `processCancelRequest()` approved | + | + | Cancellation request, invoice line and original batch allocation | Yes if source medicine sale had batch allocation | Exactly once; invoice cancellation terminal state prevents duplicate restore |
| `SUPPLIER_RETURN` | `processReturBeli()` | - | - | Supplier return line, original purchase line and exact batch | Yes in the observed path | Reverse only through a separately authorized supplier-return reversal |
| `LOSS_OR_EXPIRY` | `actionAddLoss()`, `actionBuangAllExpired()` | - | - | Loss record and exact medicine/batch | Yes in the observed UI paths | Never delete original loss; authorized correction posts a linked inbound reversal or correction movement |
| `STOCKTAKE_VARIANCE` | UI reason “Selisih Stok Opname” currently recorded through `actionAddLoss()` | - in observed flow | - in observed flow | Stocktake/count evidence and batch | Yes in observed UI path | Positive variance is not evidenced; do not invent it. Add only after a real positive-adjustment workflow is found |

The target can represent these rows in one `inventory_movements` ledger with a constrained movement type dictionary and explicit source references. This is not a proposal for a generic event-sourcing platform. A single movement ledger is justified by the existing need to reconcile medicine and batch balances across these real workflows.

## 3. Source facts and important limitations

### 3.1 Checkout and rollback

The UI deducts FEFO batches and medicine aggregate stock locally, records `batchDeductions` on the invoice line/package component, then calls `commitCashierTransaction()`. The cloud transaction checks invoice idempotency, patient, medicine and batch existence/balances, decrements both medicine and batch, writes the invoice, and initializes one return quota per invoice item. If the cloud commit fails, the UI restores local medicine and batch quantities.

Target must persist invoice line, batch allocation, movement and quota subject atomically. A failed command must leave no partial balance movement. A retry of the same invoice/idempotency key must not deduct stock twice.

### 3.2 Purchase receipt and HPP

The local purchase path adds quantity to medicine stock, creates one batch with the same quantity, and calculates weighted-average HPP. It stores purchase fields as a flat row (`oid`, `qty`, `total`, `batchId`) rather than an `items[]` array.

The stock-card renderer iterates `b.items[]` for purchase movements, while the observed purchase writer stores flat fields. Likewise, the observed supplier-return writer stores flat fields and the stock-card renderer iterates `r.items[]`. Therefore the current stock-card projection may omit those local purchase/supplier-return rows. Do not treat the rendered stock card as a complete authoritative ledger or as proof of movement history.

### 3.3 Sales return and cancellation

The cloud final-return method reconstructs restoration quantities from original invoice item/component `batchDeductions`, validates batch/medicine documents, then restores both balances in one transaction. Cancellation similarly reconstructs original medicine/batch deductions and refuses restoration if batch allocation is absent or totals do not match. These are strong lineage requirements for the relational model.

### 3.4 Supplier return defect

The local supplier-return path selects the first batch matching the purchase ID and caps the request using `Math.min()`. The target must not reproduce either behavior. It must identify the exact batch and reject any request greater than purchase remaining quantity, batch remaining quantity or medicine available balance. Supplier, invoice, receipt line, medicine and batch must all match.

### 3.5 Loss and expiry

The UI records expired batch disposal and loss/opname as direct decreases to batch and medicine aggregate stock, with a loss row. The local `delLoss()` physically removes the loss record and adds stock back. Target financial/inventory history must be append-only: correction creates a linked reversal movement and audit reason; it does not delete the loss.

No positive stocktake variance workflow was observed in the inspected UI paths. Do not add a generic stock adjustment subsystem until source evidence shows the need and approval policy is defined.

## 4. Required balance equations

For each medicine (m):

`medicine_balance(m) = opening(m) + Σ inbound_movements(m) - Σ outbound_movements(m)`

For each batch (b):

`batch_balance(b) = batch_opening(b) + Σ batch_inbound(b) - Σ batch_outbound(b)`

For each medicine with batch-tracked stock:

`medicine_balance(m) = Σ batch_balance(b) + explicitly classified non-batch balance(m)`

The final term must be zero for workflows that require full batch tracking. If any non-batch balance is allowed, it must have an explicit movement kind and source evidence; never use a generic unexplained adjustment.

Additional invariants:
- every batch references exactly one medicine;
- every batch-bound movement's medicine equals the batch medicine;
- sale allocations sum exactly to the medicine quantity on the invoice line/component;
- every return/cancellation restoration is bounded by original sale allocation minus prior restored quantities;
- supplier return quantity/value is bounded by the exact source receipt line/batch;
- movement quantity is positive; direction/type determines inbound or outbound;
- reversal references the original movement and is bounded to the unreversed quantity;
- medicine aggregate and batch balances are projections updated in the same transaction as movements, not independently editable truth.

## 5. Minimal physical-model implications

1. Keep one append-only `inventory_movements` table for the actual stock ledger.
2. Keep `invoice_batch_allocations` to preserve invoice-line/component-to-batch sale allocation and link to the exact sale movement.
3. Keep batch-to-medicine ownership explicit; purchase/return source lineage is constrained separately.
4. Do not create a separate movement table per operation.
5. Do not add a generic inventory event registry, workflow engine, or stocktake workflow tables without evidence.
6. Do not make `batch_id` universally NOT NULL until opening/adjustment provenance rules are specified; but sale, purchase receipt, sales return, supplier return, loss and cancellation paths observed here require exact batch lineage.
7. Store source type/id with constrained known values or typed nullable FK alternatives. Avoid an unconstrained polymorphic reference that cannot be integrity-checked.
8. Keep raw legacy records and source-scoped identity for reconciliation; derived current balances do not replace original movement evidence.

## 6. Required positive/negative tests

| Test | Expected |
|---|---|
| Purchase receipt for medicine A and batch B | Both balances increase by identical quantity; movement and source line commit together |
| Sale from two FEFO batches | Allocation quantities sum to invoice demand; both balances decrease exactly once |
| Retry same invoice commit | No duplicate movement or stock deduction |
| Batch medicine differs from invoice medicine | Rejected |
| Batch allocation sum differs from sold quantity | Rejected |
| Return tries to restore more than original allocation | Rejected |
| Cancellation races with return | One terminal workflow wins under invoice lock |
| Supplier return references batch from another invoice/medicine | Rejected |
| Supplier return exceeds exact batch remaining quantity | Rejected, not silently capped |
| Loss exceeds batch remaining quantity | Rejected |
| Loss correction | Original loss remains; linked reversal restores balance once |
| Expired batch disposal | Loss movement and batch/medicine balance decrease atomically |
| Missing legacy batch allocation for sale reversal | Quarantine/manual reconciliation; no fabricated batch |
| Positive stocktake adjustment without source workflow/policy | Not supported in v1 until evidence and approval rules exist |
| Reconciliation medicine vs sum of batches | Exact match for batch-tracked inventory; discrepancies surfaced, not auto-fixed |

## 7. Remaining source verification

- Search all source callsites for any manual medicine/batch edits beyond the inspected UI paths.
- Verify whether Admin stock opname can create positive adjustments or only losses.
- Confirm whether all cloud writes to medicine/batch use the special atomic commands or whether broad generic sync paths can overwrite aggregate balances.
- Confirm whether supplier receipt editing/import can create more than one batch for a purchase line.
- Profile actual secured historical records only after separate read-only access and snapshot authorization; no production export is part of this pass.

## 8. Safety and result

This pass is a static source-to-ledger mapping, not a live stock reconciliation. No DDL, TiDB data, Firebase/Auth, production deployment, main branch or PR13 was changed. No stock movement was created or corrected. Schema v1 remains **BLOCKED**.
