# Audit Struktur Nota, Paket, Diskon, dan Stok FEFO
Tanggal: 2026-11-15
Baseline read-only: `main`
Sumber: `js/app.js`, `js/store.js`, `js/firebase-backend.js`.

## Batas
Static source inspection only. No runtime acceptance test, schema DDL, Firebase/TiDB write, or production modification.

## 1. Nota transaksi — fields verified
`actionBayarTrx()` constructs:
- Header: `id,no,tgl,jam,pid,nama,hp,kasir,sh,items,total,metode,bayar,kembalian,_t`.
- `items` is a snapshot of the cart at checkout.
- Payment mode and tender are stored as `metode,bayar,kembalian`; for non-cash methods the code defaults `bayar=total` and `kembalian=0`.
- Invoice number is built from today's date and current local transaction count; this is not a concurrency-safe sequence allocator.
- The cashier must have an open shift and the patient must be called, today's, not done, and not cancelled/deleted.

## 2. Cart line types
Verified from cart construction and receipt/return code:
- Direct medicine: `oid,nama,t='Obat',harga,qty,hpp`, then `batchDeductions` is attached at checkout.
- Service/tariff: `nama,t=tarif.jenis,harga,qty=1,hpp=0`.
- Package: `pid,nama,t='Paket',jenis='Paket',harga,qty,items,hpp`.
- Package components are snapshots from package master: `id,type,nama,harga,qty`, with medicine components additionally carrying `oid`; batch deduction allocation is attached to medicine components during checkout.
- Package HPP is computed in UI from current medicine HPP for each medicine component multiplied by component quantity. Package line HPP is then multiplied by package quantity in the financial aggregation.
- Receipt renders package components as included items; medicine labels are separately generated from medicine rows and medicine components.

## 3. Inventory deduction and FEFO
- Before checkout, UI aggregates stock demand for direct medicines and package medicine components.
- It validates aggregate stock and batch stock with positive remaining quantity and expiry date >= today's date.
- It calls `deductBatchFEFO()`, attaches exact `batchDeductions` to the relevant item/component, and reduces local aggregate stock and batch balances.
- For cashier cloud checkout, the UI aggregates deductions by medicine and sends `newTrx`, patient ID and stock changes to `commitCashierTransaction()`.
- On cloud failure, the UI attempts to restore local aggregate stock and batch balances before returning an error.
- Firestore backend uses invoice ID idempotency and validates server stock/batch balances before applying writes. However, the method accepts client-provided stock-change quantities and batch IDs; the MySQL API must independently derive/validate the authoritative allocation and must not trust browser HPP, price, quantity, or stockChanges.

## 4. Discount and return allocation
- Checkout UI rejects free-standing discount lines and negative-price lines; price reductions are expected to be embedded in official package pricing.
- Return helper `calculateNetReturnAmount()` supports discount rows/negative price rows in legacy data: it distributes discount proportionally across positive rows using largest-remainder rounding, then computes incremental net refund for a returned quantity using prior returned quantity.
- This prevents repeated partial returns from rounding to more than the net line amount, provided original invoice snapshots and return quota remain consistent.
- Server-side helper `calculateVerifiedReturnAmount()` is used by cloud return flow and validates the amount against the original invoice.
- Return quota is per invoice item index; pending/non-rejected returns consume quota, and the UI tracks `priorQty`.

## 5. Critical design risks / required SQL invariants
1. Invoice number generation by local array length is race-prone. Allocate invoice sequence atomically by operating date and cashier/clinic policy; add unique constraint.
2. Preserve immutable invoice snapshots for item name, type, unit price, qty, HPP, package component recipe, discount allocation and batch deductions. Master changes must not rewrite old receipts.
3. Store package components in normalized invoice-line-component rows, including medicine/service distinction and component quantities.
4. Represent batch deductions as immutable movement rows linked to invoice line/component and batch.
5. Compute package HPP server-side from a defined cost snapshot policy; do not accept client HPP.
6. Use exact decimal/integer rupiah arithmetic; document rounding rules for weighted HPP, discount allocation and partial return.
7. Atomic checkout must include patient completion, shift association, invoice, invoice lines, component snapshots, batch movements, aggregate stock, cash ledger and audit.
8. A failed transaction must leave no partial invoice, stock deduction, patient completion or cash movement.
9. Return quota must lock invoice line/quota rows to prevent concurrent over-return. Return amount must use original invoice snapshots and exact discount allocation.
10. Keep invoice gross/net, refund obligation, refund payment, cash received, and revenue reporting as distinct ledger concepts.

## 6. Proposed relational entities (candidate only; not DDL)
- `sales_invoices`
- `sales_invoice_lines`
- `sales_invoice_line_components`
- `sales_invoice_line_batch_movements`
- `sales_invoice_discount_allocations`
- `sales_returns`, `sales_return_lines`, `sales_return_batch_movements`
- `refund_obligations`, `refund_payments`
- `cash_ledger_entries`, `inventory_ledger_entries`
- `daily_invoice_sequences`, `idempotency_keys`, `audit_events`

## 7. Not yet fully verified
- All item type values and legacy aliases in existing historical invoices.
- Full service/tariff master field dictionary.
- Whether package master can contain nested packages or only tariff/medicine components.
- All payment methods and external payment settlement behavior.
- Exact server-side return calculation and refund state transitions across all call sites.
- Historical invoices with discount rows, package snapshots or missing batchDeductions.
- Cross-device concurrent checkout and offline conflict behavior.

## Status
This document records source observations and migration requirements, not proof of correctness. No schema has been approved or created. No live data has been moved.
