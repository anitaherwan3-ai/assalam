# Purchase, Supplier, Batch, and Payable Audit — Pass 23

**Scope:** static source inspection only; no supplier records, live database, runtime test or migration.

## Inspected source
- `js/app.js` SHA `f74c4710161ddd2af230e51c18b1f107d6c52c82`
- `js/store.js` SHA `99e74acf8caec9c70d82be1d5f6efc5bfa6bc4fb`
- `js/firebase-backend.js` SHA `3a613d96564f120b8141966f9ecbae21471c4e65`

## Confirmed findings
1. Purchase UI records supplier name, optional invoice number, medicine, quantity, invoice total, expiry date, due date and a paid/unpaid choice. Supplier is a text snapshot, not a stable supplier master reference.
2. `recordPurchase` performs local mutations: weighted-average HPP, medicine stock increment, new batch, and purchase invoice. The batch references purchase ID, and purchase stores one batch ID. The source path does not show a dedicated atomic cloud transaction for purchase + batch + medicine stock/HPP + payable.
3. Purchase line model is one medicine/quantity per purchase record. A split supplier invoice with multiple medicines or multiple receipts is not represented as a normalized parent invoice with multiple lines in this flow.
4. Settlement is a boolean `lunas` and one `tglBayar`; there is no amount, payment method, reference, partial payment or payment allocation ledger.
5. Supplier return finds the first batch where `batch.beli === beli.id`, caps quantity with `Math.min`, reduces batch/medicine stock and changes purchase quantity. If purchase is unpaid, it reduces the payable total; if paid, the historical invoice total is retained but no explicit supplier credit/refund receivable is recorded.
6. The source does not evidence a supplier return approval workflow, supplier credit note, supplier refund receipt, or cash/bank settlement link.
7. Purchase and return dates are generated from UTC `toISOString().slice(0,10)` in local store methods, not a single server-authoritative Asia/Jakarta business date.
8. The generic push path batches writes by collection, not as one cross-collection atomic purchase command. A partial commit can leave purchase, batch, medicine stock and HPP out of agreement.
9. Purchase export resolves medicine name from current master by `oid`; if master was deleted, the report prints '-'. Historical purchase should preserve item-name snapshot.
10. No unique supplier invoice constraint is evidenced. Duplicate invoice number handling and supplier identity normalization are open.

## Target requirements
- Supplier identity and supplier invoice header separated from invoice lines; preserve supplier/name/tax/invoice snapshots.
- Atomic receipt command: invoice/line, batch, stock movement, medicine stock projection and HPP valuation update commit together.
- Explicit payment events and allocations; support only the payment patterns the owner confirms (full, partial, multiple, transfer/cash).
- Supplier return references exact original receipt/batch and creates stock movement plus supplier credit/payable adjustment; paid-return settlement must be explicit.
- Use immutable document snapshots and source-scoped legacy IDs.
- Enforce duplicate invoice detection by supplier + normalized invoice number where policy permits; allow missing invoice numbers without false uniqueness.
- Server-side idempotency and row locks/version checks for purchase, settlement and return.

## Owner decisions still required
- Can one supplier invoice contain multiple medicines and multiple batches/receipts?
- Are partial payments and split payment methods needed?
- When goods are returned after payment, is the value refunded, credited to next invoice, or left as supplier receivable?
- Who approves purchase and supplier returns?
- Are supplier tax/identity fields required for current clinic operation?

## Synthetic tests required
- Atomic concurrent receipts for same medicine; stock/HPP/batch reconciliation.
- Duplicate/retried purchase request; duplicate supplier invoice; missing supplier invoice.
- Partial/split payment and multiple settlement allocations if approved.
- Return unpaid vs paid invoice, partial return across batches, missing/expired batch, supplier credit and cash settlement.
- UTC/WIB date boundary; export after medicine rename/archive.
- Simulate failure after each write boundary and verify all-or-nothing behavior.

## Status
Static source audit only. No live supplier data, DDL, runtime concurrency test, Firebase mutation, import, deployment, merge or production change. Payment and split-receipt policies remain unresolved.
