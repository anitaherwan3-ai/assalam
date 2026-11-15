# MYSQL Migration — Financial Reconciliation & Balance Source-of-Truth Audit (Pass 16)

Date: 2026-11-15  
Branch: `migration/tidb-foundation`  
Scope: static source audit of report formulas and their source records. Documentation only: no DDL, runtime test, live-data query, Firebase/Auth mutation, deployment, merge to main, or production change.

## 1. Source snapshot

| File | Blob SHA | Relevant locations |
|---|---|---|
| `js/app.js` | `f74c4710161ddd2af230e51c18b1f107d6c52c82` | 53–194 (filters/financial calculation), 321–461 (shift cash), 3367–3425 (dashboard), 3559–3681 (P&L/cash flow/payables) |
| `js/store.js` | `99e74acf8caec9c70d82be1d5f6efc5bfa6bc4fb` | 236–260 (activity log), 282–350 (purchase/HPP/supplier settlement), 491–553 (supplier return) |
| `js/firebase-backend.js` | `3a613d96564f120b8141966f9ecbae21471c4e65` | 746–1007 (return approval/refund payout), 1079–1141 (checkout) |

Pass 16 extends Pass 15 by checking whether each displayed aggregate can be reconciled to an immutable source event. It does not certify real-world balances.

## 2. Current report dependency map

| Report value | Current source records | Date/filter basis | Limitation |
|---|---|---|---|
| Gross transaction revenue | Active `trx.total` | Invoice `tgl`, cashier and invoice payment method | Invoice total is already after discount; only one method per invoice in current checkout |
| Approved return value | Approved `returJual.total` | Approval timestamp (`diverifikasiPada`) or fallback `tgl`; cashier and original invoice method | Legacy missing approval time falls back to date string; old records may lack refund object |
| Net revenue | Gross invoice total minus approved return total | Mix of invoice date and return approval date | Period net revenue is an event-period measure, not a cohort measure of invoices created in period |
| COGS/HPP | Snapshot `trx.items[].hpp × qty`, less approved goods/package return HPP | Invoice date for sales, approval date for return | Depends on complete, immutable item/component HPP snapshots and package allocation policy |
| Operating expense | Approved `biaya.jml` | Entry `tgl` | Approval date is not the report date; status can change later |
| Petty cash | `petty.jml` | Entry `tgl` | Same class of outflow also affects drawer cash; may overlap conceptually with operating expenses |
| Cash receipts | Active invoice `total`, split by invoice `metode` | Invoice date | No separate settlement confirmation for non-cash |
| Supplier cash out | Full `beli.total` where `lunas=true` | `tglBayar`, fallback purchase date | A paid flag is not a payment event/amount; cannot represent partial payment or credit |
| Refund cash out | `pengembalian.nominal` for paid return | Actual payout timestamp and payout method | Current return query is first filtered by original invoice method, then payout method |
| Shift expected drawer | Opening `shift.modal` + shift cash invoice totals − shift-linked petty cash | Shift ID | Does not include explicit cash refund paid out of that drawer |
| Cash-on-hand aggregate | Sum of period opening floats + period cash invoice totals − cash refund − all petty cash | Period filter | Not a point-in-time balance; not shift-scoped; currently only returned by calculator and not consumed elsewhere |
| Activity/audit | Local activity log | Local date/time | Capped at 1,000 rows; not an accounting ledger |

## 3. Reconciliation findings

### R16-01 — A period profit-and-loss view mixes event dates intentionally, but needs explicit labels

Sales use invoice date; returns reduce revenue on approval date; supplier payments use payment date; expenses and petty cash use entry date; refunds use payout date for cash but approval date for revenue. This is acceptable only if each report is explicitly an event-period report and the date basis is shown for each account. A single generic `date` field cannot reproduce this safely.

### R16-02 — Return payout method filter can contradict original-sale method filter

The return list is initially filtered using the original invoice's payment method. The paid-refund subset then additionally filters by the refund payout method. If an invoice was paid by Transfer but the approved refund is paid in Cash, a report filtered to Cash can exclude the refund before the payout-method test, while a report filtered to Transfer can exclude it at the payout-method test. Therefore method-filtered refund cash flow can be omitted for valid differing methods. SQL reporting must separate `original_payment_method` from `refund_payout_method` and apply the requested filter to the intended dimension only.

### R16-03 — Cash-on-hand aggregate is not a reconciled cash balance

`totalKasDiTangan` sums all opening floats in the date range and adds cash invoice totals, then subtracts cash refunds and petty cash. It does not calculate a closing balance at a cutoff instant, does not group by drawer/shift, and does not include counted close cash, differences, or other cash transfers. Source search shows the property is returned by `calculateFinancials` but not used by the dashboard or other visible report. Treat it as an unused legacy projection, not a balance source.

### R16-04 — Shift drawer reconciliation is better scoped, but incomplete for cash refund events

`calcShiftCash` correctly uses shift ID for invoices and petty cash and includes opening float. It does not include cash refund payout. A refund may be paid by Pimpinan after the original shift has closed, so assigning it to that old cashier drawer would also be an assumption. Target schema should record the actual cash/bank account or drawer from which payout was made, with optional shift attribution only when a real shift supplied the cash.

### R16-05 — Supplier payment amount is inferred from invoice paid flag

The cash-flow report treats a fully paid invoice's entire current `beli.total` as paid on `tglBayar`. The source settlement function only toggles `lunas` and stores a date. No payment row, amount, method, reference or allocation is recorded. Partial payments and multiple payments cannot be reconciled.

### R16-06 — Supplier return after payment is not represented as cash/credit movement

Supplier return reduces quantity and stock; it reduces invoice total only while invoice is unpaid. For an already paid invoice, the historic invoice amount remains, but no supplier credit receivable, refund receipt or offset against future invoices is recorded in the observed path. Therefore cash-flow report may not represent the later supplier settlement outcome. Do not rewrite historical payment; record the return and its settlement disposition separately.

### R16-07 — Purchase return affects stock/HPP but its accounting settlement is under-specified

The return amount is based on stored purchase unit cost and returned quantity; the inventory value/HPP is adjusted locally. The source does not establish whether a supplier return is refunded in cash, credited to payable, or held as a supplier credit. This is an owner/accounting policy gate.

### R16-08 — Expenses and petty cash can be double-counted

P&L and cash flow subtract approved `biaya` and all `petty` separately. No source-level link or uniqueness rule proves that the same real-world expense cannot be entered in both collections. The target must distinguish expense recognition from payment execution and link a petty-cash payment to the expense it settles where applicable.

### R16-09 — Current dashboard and P&L labels are derived from the same calculator, not independent reconciliation

Dashboard and P&L share `calculateFinancials`; agreement between them is not an independent control. A separate ledger-based reconciliation must independently derive report totals and compare to projections.

### R16-10 — Activity log is not financial evidence

The activity log is a capped, mutable local projection. It is useful for user-facing history but cannot be the authoritative proof of money received, paid, reversed, or reconciled.

## 4. Target source-of-truth model — minimal and conditional

1. **Commercial source:** invoice and immutable invoice-line snapshots, including discount allocation, charged amount, quantity, medicine/component, batch allocation and historical HPP.
2. **Collection source:** actual patient payment event(s), with amount, method, reference/settlement state and timestamp. Keep single-method-per-invoice only if owner explicitly confirms it; otherwise allow multiple allocations.
3. **Cash custody source:** shift open/close events, opening float, cash sale allocations, cash expenses paid from that drawer, actual cash refunds paid from that drawer, counted cash and variance. Do not derive a clinic-wide point-in-time balance by summing historical floats.
4. **Expense source:** expense obligation/recognition and payment event are distinct; petty cash is a payment channel/source account, not automatically a second expense category.
5. **Supplier source:** purchase invoice and payable; supplier payment events and allocations; supplier return/credit/refund settlement events. Never infer a payment amount solely from a boolean.
6. **Return source:** approved return is a revenue/COGS adjustment and creates a refund obligation; payout is a separate cash/bank event, with its own method, source account, actor and timestamp.
7. **Cancellation source:** full invoice reversal, mutually exclusive with approved return; reversal entries reference original invoice and stock movements.
8. **Reporting:** build period reports from immutable event dates and explicit date basis; build balances as opening balance + posted movements through a cutoff, separately for each cash/bank account. Never treat a period flow as a closing balance.
9. **Audit:** append-only financial events with actor, source document, idempotency key and reversal reference; UI activity log remains supplementary.

Do not add a generic double-entry accounting engine or arbitrary chart of accounts in v1 without an explicit requirement. First make the existing workflows reconcilable.

## 5. Synthetic reconciliation suite for schema/runtime phase

Use synthetic data only, in isolated preview:

| Test | Input | Expected invariant |
|---|---|---|
| R1 Cash sale and change | Invoice 75,000; tender 100,000; change 25,000 | Revenue and drawer inflow = 75,000; tender/change separately traceable |
| R2 Non-cash sale | QRIS invoice 75,000 | Revenue 75,000; cash drawer inflow 0; settlement status distinct if configured |
| R3 Refund method differs | Original invoice Transfer; refund paid Cash 20,000 | Original-method filter and payout-method filter return distinct, correct dimensions; no silent omission |
| R4 Refund timing | Return approved Nov 10; paid Nov 12 | Revenue adjustment Nov 10; cash out Nov 12 |
| R5 Opening float | Open shift 200,000, no sales | Drawer opening 200,000; revenue/profit/cash receipts 0 |
| R6 Multiple shifts | Two shifts each open with 200,000 | Historical period flow may show 400,000 float issued; current drawer balance is calculated by account and cutoff, not 400,000 |
| R7 Shift expenses | Cash sale 100,000; float 200,000; petty paid 15,000 | Expected drawer 285,000 before other movements |
| R8 Refund drawer attribution | Pimpinan pays cash refund 20,000 after cashier shift closed | Cash account reduced 20,000; no false attribution to closed shift |
| R9 Supplier partial payment | Invoice 100,000; payments 40,000 + 60,000 | Outstanding 0; cash out totals 100,000 across actual payment dates |
| R10 Supplier return unpaid | Invoice 100,000; return credit 20,000 before payment | Payable reduced to 80,000, subject to confirmed credit policy |
| R11 Supplier return paid | Invoice paid 100,000; return 20,000 | Original payment remains 100,000; supplier credit/refund receivable 20,000 until settled |
| R12 Expense paid from petty cash | Expense recognized 15,000 and paid once from petty cash | P&L expense 15,000 once; cash out 15,000 once |
| R13 Expense pending approval | Expense 15,000 pending | Excluded from approved P&L expense until approval; cash payment separately prohibited or explicitly governed |
| R14 Cancellation | Invoice 75,000 then approved cancellation | Full revenue/COGS/stock reversal exactly once; no return can post to same invoice |
| R15 Report cutoff | Events across midnight WIB | Business-date bucketing consistent across invoice, approval, payout and supplier payment timestamps |
| R16 Independent reports | Same synthetic ledger | Dashboard, P&L, cash flow, shift and account balance reconcile from common posted events but independent aggregation paths |

## 6. Open decisions carried forward

- Whether checkout permits split tender and whether non-cash settlement confirmation is required.
- Whether cash refunds paid by Pimpinan are paid from a named clinic cash account, a specific drawer, or a bank account.
- Supplier return settlement: cash refund, credit note, or offset against payable/future invoice.
- Whether petty cash may be the payment channel for an approved expense, and the approval rule for petty cash.
- Package revenue/COGS allocation and historical HPP policy.
- Whether reporting should expose both invoice-cohort sales and event-period net revenue; current UI is event-period.
- Which date basis and timezone applies to each report account.

## 7. Migration gate and safety

Pass 16 identifies source-of-truth and reconciliation gaps; it does not approve a schema or accounting policy. No DDL was applied, no TiDB runtime tests were run, no live Firebase data was read, no Firebase/Auth account or document was changed, no Vercel deployment occurred, no production code was edited, and no branch was merged. Preserve Firebase and the five protected user accounts; retain the isolated migration branch.
