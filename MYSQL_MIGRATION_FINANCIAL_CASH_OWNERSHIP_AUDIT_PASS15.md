# MYSQL Migration — Financial & Cash Ownership Audit (Pass 15)

Date: 2026-11-15  
Branch: `migration/tidb-foundation`  
Scope: static source review of the current branch; no DDL, runtime test, live-data query, deployment, Firebase/Auth mutation, or production change.

## 1. Source snapshot and provenance

| Source | Blob SHA | Relevant ranges |
|---|---|---|
| `js/app.js` | `f74c4710161ddd2af230e51c18b1f107d6c52c82` | 95–159, 330–462, 1416–1590, 1727–1819, 2415–2457, 2594–2643, 2811–2824, 3106–3160, 3559–3681, 3780–3792 |
| `js/store.js` | `99e74acf8caec9c70d82be1d5f6efc5bfa6bc4fb` | 282–350, 386–490, 491–553 |
| `js/firebase-backend.js` | `3a613d96564f120b8141966f9ecbae21471c4e65` | 412–490, 571–745, 746–1007, 1079–1141 |

This is source evidence from the isolated migration branch, not proof of historical data correctness or production behavior.

## 2. Confirmed source behavior

### 2.1 Checkout, invoice, and payment method

- Checkout requires an active cashier shift and an active/called patient; cashier checkout requires an online authenticated Firebase cashier profile (`app.js:1416–1470`).
- Invoice snapshot stores one `total`, one `metode`, `bayar`, `kembalian`, cashier, shift ID, patient ID and item snapshots (`app.js:1510–1545`).
- For cash, `bayar` is cash tendered and `kembalian = bayar - total`; the invoice total is the amount recognized as received. For non-cash, `bayar` is set to invoice total and change is zero (`app.js:1440–1456`, `1510–1545`).
- The current invoice supports exactly one payment method per invoice. There is no observed payment-split allocation or separate payment transaction record in this checkout path.
- Firebase `commitCashierTransaction` writes invoice, marks patient done, decreases medicine/batch stock and creates return quota rows in one Firestore transaction; existing invoice ID is an idempotency guard (`firebase-backend.js:1079–1141`).

### 2.2 Shift float and cash custody

- Opening a shift records cashier, opening time/date, `modal` (opening float) and status `buka` (`app.js:415–430`).
- Expected drawer cash is `modal + cash-method invoice totals - petty cash assigned to that shift` (`app.js:330–335`).
- Closing stores system amount, physically counted cash, difference, close time and an unverified flag; Admin verification is a separate boolean/actor update (`app.js:432–461`, `2811–2820`).
- Non-cash invoices are displayed separately and do not increase expected drawer cash (`app.js:337–360`).
- The opening float is correctly treated as a custody/balance component in drawer reconciliation, not as sales revenue. It must not be posted to omzet, income or profit.

### 2.3 Petty cash and operating expenses

- Petty cash rows store date, description, amount, cashier, optional shift ID and timestamp (`app.js:1768–1790`).
- The current UI permits the owning cashier (and Pimpinan) to edit/delete petty cash entries; no approval or immutable reversal workflow is evidenced in these functions (`app.js:1727–1819`).
- Operating expense rows store date, category, description, total amount, status and actor. Amounts at or above configurable `batasApproval` become `pending`; lower amounts are immediately `approved` (`app.js:2594–2623`). Approval/rejection updates status and timestamp (`app.js:3780–3790`).
- Expense edit recalculates approval status based on the current threshold (`app.js:2625–2642`).
- The profit report deducts approved operating expenses and all petty cash entries separately (`app.js:95–159`, `3559–3587`). Source does not prove that petty cash is disjoint from operating-expense rows; the SQL design must prevent or explicitly classify double entry.

### 2.4 Supplier purchases, payable and payments

- A purchase command creates a purchase invoice row and a medicine batch; stores supplier name as text, invoice number, medicine, quantity, total, due date, paid boolean, payment date, original quantity/value, unit purchase cost and batch ID (`store.js:282–338`).
- Weighted-average HPP is updated at purchase time using existing stock value plus purchase total (`store.js:294–309`).
- The current settlement action changes `lunas` to true and records one payment date; it does not store payment amount, method, reference, payer or multiple allocations (`store.js:341–350`).
- The supplier debt screen considers invoices unpaid/paid using a boolean and reports unpaid invoice totals (`app.js:3649–3681`).
- Supplier return reduces the purchase quantity and (if unpaid) the invoice total; it selects a linked batch, caps the requested quantity to remaining invoice/batch/medicine stock, and records a return value (`store.js:491–553`). This means partial supplier payment, credit-note allocation and refund receivable from supplier are not represented explicitly in this path.

### 2.5 Sales return, refund obligation and payout

- Return amount is recomputed from the original invoice line with proportional invoice-discount allocation and cumulative quantity limits; approved returns reduce revenue once (`store.js:88–130`, `app.js:95–159`).
- Return approval is staged: Admin changes status to `menunggu_pimpinan`; Pimpinan finalizes approval and restores verified original batch/medicine quantities; final approval creates a separate `pengembalian.status = menunggu` obligation (`firebase-backend.js:746–923`).
- Pimpinan payout is separate, only accepts Tunai or Transfer, requires a reference for Transfer, and marks the refund as paid with amount, method, actor and timestamp. The transaction rejects a second payout (`firebase-backend.js:969–1007`).
- Revenue reduction follows return approval date, while cash outflow follows actual payout date. Pending refund is disclosed separately from cash outflow (`app.js:95–159`, `3592–3647`).
- Legacy approved returns without a payout object are surfaced as a separate reconciliation amount; they are not treated as proven cash payments (`app.js:135–158`, `3620–3642`).

### 2.6 Cancellation

- Cashier submits a cancellation request; invoice and stock remain unchanged while pending. Admin/Pimpinan decision is handled by a dedicated cloud transaction (`app.js:3106–3160`, `firebase-backend.js:412–490`).
- Cancellation approval restores stock/batches and marks invoice cancelled in the backend transaction; the report excludes cancelled invoices from active revenue (`firebase-backend.js:457–490`; cancellation remainder must be re-read in later implementation review).
- A cancellation request is blocked when a non-rejected return exists for the same invoice. This is a cross-workflow mutual exclusion rule that must survive SQL migration.

## 3. Current report semantics (as implemented)

The current `calculateFinancials()` uses active filtered invoices and approved return rows:

- `grossRevenue`: sum of invoice `total` for active invoices in the selected invoice-date range. The source comment says invoice total is already net of discount; discounts must not be subtracted again.
- `returnValue`: sum of approved return totals selected by return approval date.
- `rev = grossRevenue - returnValue`: net revenue after approved returns.
- `hpp`: invoice item HPP for medicine/package rows less HPP on approved goods/package returns.
- `laba = rev - hpp - loss - approved operating expense - petty cash`.
- Cash-flow receipts are invoice totals split by the single invoice method; supplier cash out is the full amount of invoices marked paid in the period; expense/petty/refund cash out are counted separately.
- Drawer expected cash is a separate custody calculation and includes opening float; it is not equivalent to revenue or cash-flow net movement.

These are observed application formulas, not an approved accounting policy or independently reconciled ledger.

## 4. Material findings and migration blockers

| ID | Finding | Consequence / required target behavior |
|---|---|---|
| F15-01 | No payment split per invoice; only one `metode` and one `total`. | V1 must either explicitly preserve one-method-per-invoice as a confirmed constraint or add payment allocations only if owner confirms split tender is required. Do not silently infer split payments. |
| F15-02 | Non-cash payment stores no provider reference, settlement status or actual settlement timestamp in the invoice snapshot. | Decide whether QRIS/transfer/card settlement tracking is in v1; distinguish invoice collection from bank settlement if tracked. |
| F15-03 | `bayar` for cash is tendered amount and includes change; revenue/cash receipts use `total`. | Persist amount applied to invoice separately from tendered cash and change; drawer cash increases by invoice amount, not tender amount. |
| F15-04 | Opening float is included in drawer custody, but report's `totalKasDiTangan` sums all shift floats in the selected date range. | Define report grain (per shift, point-in-time, or period turnover). Never aggregate repeated opening floats as clinic revenue or as a point-in-time cash balance. |
| F15-05 | Current global `totalKasDiTangan` subtracts cash refunds paid and petty cash but does not filter refund by shift, and sums all shift opening floats in date range. | Replace with shift-scoped cash reconciliation and separate period cash-flow ledger; do not reuse this projection as a bank/cash account balance. |
| F15-06 | Petty cash is editable/deletable and is deducted in both shift cash and profit/cash-flow calculations. | Define immutable correction/reversal and expense classification. Prevent the same expense from being entered as both petty cash and operating expense. |
| F15-07 | Operating expenses below threshold are auto-approved; threshold is configurable. | Persist approval policy/version and approver provenance; decide whether creator can approve own expense. |
| F15-08 | Supplier invoice settlement is a boolean/full-payment action. No partial payments, payment allocations, payment method/reference or credit-note ledger is evidenced. | Do not model boolean as a robust payment ledger. Add supplier payment/allocation and supplier credit only if source/owner requirements confirm; otherwise retain a documented simple full-settlement constraint. |
| F15-09 | Supplier return adjusts unpaid invoice total but preserves paid invoice total; no explicit supplier refund/credit allocation is represented. | Define paid-vs-unpaid supplier return accounting and how credit/refund is recognized before finalizing payable schema. |
| F15-10 | Sales return revenue date is approval date, while cash out date is payout date. | SQL needs distinct approval and payout timestamps and separate revenue adjustment vs cash disbursement projections. |
| F15-11 | Return payout is one-time and Pimpinan-only in source; transfer requires reference. | Enforce unique payout per return (or an explicit payout-allocation model if partial refunds are later authorized), actor and reference provenance. |
| F15-12 | Cancellation and return are mutually exclusive by invoice; cancellation restores stock and excludes invoice from revenue. | Enforce a shared invoice-level lock/state invariant in SQL transactions; never allow both cancellation and an approved/active return to post. |
| F15-13 | HPP on purchase uses weighted moving average; sales report derives COGS from invoice line HPP snapshots; return reverses HPP using stored return HPP × quantity. | Preserve historical HPP snapshots; separately validate package HPP semantics and supplier-return impact on inventory valuation. |
| F15-14 | Report uses invoice date for sales, approval date for return revenue, payout date for cash, payment date for paid supplier invoices, and entry date for expenses/petty. | Define explicit business-date policy and store immutable event timestamps; avoid one generic `tgl` for every financial event. |
| F15-15 | Audit log is a capped local projection (1,000 rows) per store implementation, not a durable financial subledger. | Financial posting/reversal records must be durable and append-only independently of the UI activity log. |

## 5. Candidate financial domain model — not approved DDL

Keep the target design minimal and source-led:

1. Invoice and invoice-line snapshots remain the origin of patient charges and historical HPP.
2. A payment record/allocation is conditional on whether multiple tender methods, settlement tracking or payment references are required. If one method per invoice remains the owner-approved rule, model that rule explicitly.
3. Shift opening/closing and cash count remain a distinct cashier-custody/reconciliation domain; opening float is not income.
4. Petty cash and operating expenses need a single classification/anti-double-counting rule, with immutable correction history.
5. Supplier invoice payable and supplier payment are separate concepts; current boolean settlement is insufficient for partial payments but no partial-payment requirement is yet owner-confirmed.
6. Return approval creates a refund obligation; payout is a separate cash/bank event. Maintain exactly-once payout unless a partial payout policy is explicitly approved.
7. Cancellation is a full invoice reversal and must be mutually exclusive with return postings.
8. Keep a durable financial posting/reversal trail separate from UI audit logs and derived reports.

No speculative generic accounting/event framework is recommended. Exact table additions remain subject to the existing schema scope-control and source/owner gates.

## 6. Required focused tests before schema v1 approval

Use synthetic data only in isolated preview:

1. Cash invoice: tender 100,000; invoice 75,000; change 25,000. Revenue and drawer increase by 75,000, not 100,000.
2. QRIS/transfer/card invoice: revenue counted once; drawer cash unchanged; method classification exact.
3. Opening float only: drawer custody increases; omzet, income and profit remain zero.
4. Two shifts with same opening float on different dates: period reports do not present the sum as current cash balance or income.
5. Shift close: expected cash = opening float + cash invoice allocations − shift-assigned petty cash − cash refunds explicitly assigned to that shift (if policy allows).
6. Non-cash refund: reduces revenue on approval date; reduces bank/cash-flow on payout date; does not reduce drawer cash.
7. Cash refund: exactly once; drawer reduction linked to the responsible shift or a defined clinic cash account.
8. Rejected return: quota reservation released once; no stock, revenue or cash posting.
9. Approved but unpaid return: revenue adjustment exists; cash out remains zero and refund obligation remains open.
10. Duplicate payout/replay: second payout rejected at DB transaction level.
11. Cancellation vs return race: only one workflow can post for a given invoice.
12. Expense threshold boundary: amount below, equal to and above approval limit; creator/approver provenance.
13. Petty cash correction: no destructive deletion of posted cash movements; reversal is traceable.
14. Same expense entered as petty cash and operating expense: duplicate financial impact blocked or explicitly linked.
15. Supplier full/partial payment and supplier return before/after payment: payable, cash and credit balances reconcile.
16. Purchase and supplier return preserve stock value and weighted-average HPP.
17. Package sale/return: revenue allocation and COGS reversal reconcile against component medicines and service value.
18. Date boundaries: invoice date, return approval, payout, supplier payment and expense entry use clinic business timezone and correct report period.

## 7. Open owner/accounting decisions (do not guess)

- Is split tender (e.g. part cash + part QRIS) allowed at checkout?
- Must non-cash settlement references/status be tracked, or is recording method and invoice amount sufficient?
- Are partial supplier payments and supplier credit notes/refunds required in the first MySQL release?
- Can petty cash be treated as an expense directly, or must it be classified into a linked operating-expense category to avoid double counting?
- May a user approve their own operating expense below/above threshold?
- Can a patient refund be paid in installments, or is one full payout per approved return the rule?
- Which shift/cash account owns a cash refund paid after the original cashier shift has closed?
- Is a supplier return from a fully paid invoice treated as supplier credit, cash refund receivable, or another settlement?
- What is the approved package HPP/COGS method for bundles containing both services and medicines?

## 8. Status and safety boundary

Pass 15 is a static source audit and candidate design only. It does not prove the financial statements reconcile to real operations. No live Firebase data was accessed; no Firebase/Auth account, rule, or record was changed; no TiDB DDL or application data was created; no runtime test against TiDB was run; no deployment, main merge, PR13 merge, production write, or cleanup occurred. Firebase remains preserved as rollback/archive pending explicit cutover approval.
