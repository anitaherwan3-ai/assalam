# MYSQL MIGRATION — FINANCIAL AND INVENTORY RECONCILIATION AUDIT

Date: 2026-11-15
Source: main branch, read-only source inspection
Target: migration/tidb-foundation
Status: calculation and workflow audit; no live financial data queried, no DDL executed.

## 1. Executive findings

This audit follows the actual screens and source calculations for Shift, Pembelian, Utang, Stok Obat, Kartu Stok, Laba Rugi, Arus Kas, retur, pembatalan and approval.

Key findings:
1. The UI already distinguishes omzet from cash-in-drawer: opening shift modal is not omzet, but it is included in estimated cash on hand.
2. Current Laba Rugi and Arus Kas are separate calculations and must not be assumed to reconcile automatically. Arus Kas currently counts paid purchase invoices by their full total when marked lunas; the local model does not represent partial supplier payments.
3. Current shift cash estimate is opening modal + cash invoices - petty cash. It does not visibly include cash refunds paid outside that shift or any explicit cash adjustment/transfer ledger.
4. Return approval and refund payout are separate cloud actions. Revenue reduction follows approval date; cash outflow follows actual payout date. This separation must remain in the new system.
5. Stock is represented both as medicine aggregate stock and per-batch remaining quantities. Sale, return, purchase, loss and supplier-return paths must reconcile both balances with an immutable movement ledger.
6. The purchase method computes weighted-average HPP using aggregate stock and current HPP, while batches preserve purchase-level quantity/cost context. This makes opening stock, historical HPP and purchase returns important migration cases.
7. Current local purchase settlement is a boolean (lunas/tglBayar), not a payment ledger. A future finance schema must not invent partial-payment history for legacy rows.

## 2. Source fingerprints and exact source areas

- js/app.js: f74c4710161ddd2af230e51c18b1f107d6c52c82 (4,872 lines)
- js/store.js: 99e74acf8caec9c70d82be1d5f6efc5bfa6bc4fb (552 lines)
- js/firebase-backend.js: 3a613d96564f120b8141966f9ecbae21471c4e65 (1,435 lines)

Reviewed functions and UI:
- app.js calculateFinancials() lines 95 onward.
- app.js calcShiftCash(), viewShift(), actionBukaShift(), actionTutupShift().
- app.js viewLabaRugi(), viewArusKas(), report cards and date filters.
- store.js deductBatchFEFO(), recordPurchase(), lunasiBeli(), approveReturJual(), processReturBeli().
- firebase-backend.js commitCashierTransaction(), submitReturJual(), approveReturJual(), finalizeReturJual(), payReturJual(), processCancelRequest().

## 3. Actual financial calculation behavior in main

### 3.1 Omzet and net revenue

The current calculateFinancials() obtains filtered, active invoices through getActiveFilteredTrx(). It calculates:
- grossRevenue = sum of active invoice total values.
- returnValue = sum of eligible approved return values, or legacy return records with blank status, on invoices not marked cancelled.
- net revenue (rev) = grossRevenue - returnValue.

Important details:
- Invoice total is already the final amount after discount. Do not subtract discount again.
- Return revenue recognition uses return approval date (diverifikasiPada, with tgl fallback), not original invoice date.
- Return records on cancelled invoices are excluded from financial return aggregation.
- Return is split for display into goods (Obat/Paket) and services (remaining return value).
- Date, payment method and cashier filters are applied using original invoice context for return records.
- Return HPP is subtracted for Obat/Paket returns using return hpp × qty.
- Legacy return records without pengembalian details are counted in legacyReturnValue and are not assumed to have a modern refund payout state.

Target requirement:
- Persist immutable invoice and return snapshots.
- Store approved_at separately from refund_paid_at.
- Derive amount from original line and discount allocation, not a client field.
- Keep legacy status handling explicit; never silently treat every missing status as approved without migration policy.

### 3.2 HPP and operational profit

Current calculation:
- HPP = sum of invoice item hpp × qty for items whose type is Obat or Paket, minus HPP of approved Obat/Paket returns.
- Loss = filtered loss records' nilai.
- Operating expense = filtered biaya records with status approved, summing jml.
- Petty cash = filtered petty records, summing jml.
- Operating profit = net revenue - HPP - loss - approved expenses - petty cash.

Important reconciliation risk:
- If a petty cash entry is also recorded as an expense in biaya, the current formula subtracts both. The application needs a clear category rule: petty cash is either a cash movement/advance with separate expense recognition, or an expense, but not both for the same economic event.
- Loss value and HPP must not represent the same stock event twice.
- Package HPP must be snapshotted at sale. Recalculating from current package composition or current medicine HPP would rewrite history.
- For partial returns, use exact original line HPP allocation and quantity already returned; avoid multiplying a rounded aggregate incorrectly.
- The current report is a source formula, not a full double-entry accounting system.

### 3.3 Cash-on-hand and opening modal

Current calculateFinancials() exposes:
- totalModalAwalShift = sum of shift.modal within date range.
- totalKasDiTangan = opening modal + cash invoice totals - cash refund payouts - petty cash.

The shift screen separately calculates:
- cash invoices for that shift = active, non-cancelled invoices with metode Tunai.
- petty cash for that shift = petty rows where sh equals shift.id.
- system drawer cash = shift.modal + cash invoice totals - petty cash.

Thus:
- Opening modal is not omzet or revenue.
- Opening modal is part of drawer cash.
- Non-cash methods are not counted as drawer cash.
- Shift cash and overall cash-in-hand are different scopes.

Target requirement:
- Keep separate ledgers/accounts for drawer cash, bank/QRIS/transfer, opening float, cash refunds, petty cash, supplier payments and other cash movements.
- Every cash movement should reference a shift/account when applicable.
- Cash refunds paid in cash must be assigned to a responsible shift/drawer or a management cash account; otherwise shift close cannot reconcile.
- Support cash adjustments with reason, actor, approver and source record.
- Do not mix opening float with sales revenue.

### 3.4 Return approval versus refund payment

Cloud backend stages:
1. Cashier submits return; quota is reserved and return status is menunggu.
2. Admin changes status to menunggu_pimpinan; no stock restoration.
3. Pimpinan finalizes; return is approved and inventory/batches restored; refund obligation is recorded as waiting.
4. Pimpinan pays refund separately using Tunai or Transfer; transfer requires reference; duplicate payout is rejected.

Current finance report behavior:
- Approved return reduces revenue on approval date.
- Refund cash flow reduces cash only on paid date.
- Pending refund obligation is separately calculated.
- Cash refund component is separately calculated for cash-in-hand.

Target requirement:
- Separate return_requests, return_decisions, refund_obligations and refund_payments.
- Exactly one approved stock-restoration posting per return allocation.
- Exactly one payout posting per refund payment.
- Payout amount cannot exceed approved obligation.
- A transfer payment requires reference and should support evidence metadata.
- Return and invoice cancellation must lock same invoice and quota records.
- Old return rows without modern pengembalian metadata require manual reconciliation, not automatic payout.

## 4. Actual inventory calculation and write paths

### 4.1 Sale and FEFO

Local ClinicStore.deductBatchFEFO():
- Filters batches by same medicine ID, positive remaining quantity and expiry >= current date.
- Sorts by expiry date ascending.
- If available stock is insufficient, returns no deductions and unallocated amount.
- Otherwise reduces batch sisa and returns deductions with bid, qty, batchNo, ed.

Current risks:
- Date is generated with UTC toISOString in this local function, whereas report/patient paths also use Asia/Jakarta business date. At night in WIB, expiry eligibility can differ by one calendar day.
- Equal-expiry batches have no explicit secondary sort key, so deterministic tie-break should be added in target.
- The backend commitCashierTransaction() receives client stockChanges and validates aggregate medicine stock and batch remaining quantities before updating. It does not fully derive and prove from the invoice lines that client batch allocation is the canonical FEFO allocation.
- It is therefore not enough to trust the UI-provided allocation in the MySQL API.

Target sale command must:
1. Verify authenticated cashier profile and active shift server-side.
2. Verify patient visit is eligible and belongs to correct business day/clinic.
3. Recompute invoice line price, discount, tax/fees if any, payment and change server-side.
4. Expand package snapshots and compute component quantities.
5. Lock medicine and eligible batch rows.
6. Select FEFO batches server-side using Asia/Jakarta business date and stable tie-break (expiry, received_at, batch_id).
7. Verify aggregate stock and batch sum.
8. Create invoice, lines, payment, inventory movements, batch deductions, visit completion, quota rows and audit event atomically.
9. Enforce idempotency by unique request/invoice key.

### 4.2 Purchase receipt and weighted-average HPP

Current recordPurchase():
- Reads medicine aggregate stock and HPP.
- Computes totalQty = old aggregate stock + received quantity.
- Computes new HPP = round((old stock × old HPP + purchase total) / totalQty).
- Increases aggregate medicine stock.
- Creates one batch with qty and sisa equal to received qty and purchase reference.
- Creates purchase record with supplier, invoice, medicine, qty, total, due date, paid flag/date, initial qty/total, unit purchase price and batchId.

Target requirement:
- Store original purchase header and lines, receiving event, batch and inventory movement.
- Store purchase cost per line and allocation basis (include/exclude freight/discount/other landed costs) explicitly.
- Store HPP calculation snapshots and version; don't recompute historical invoice HPP after purchase changes.
- Opening stock must be its own source event, not a fake purchase.
- Reject qty <= 0, total < 0, invalid/expired batch dates and duplicate supplier invoice where policy requires uniqueness.
- Define rounding policy for rupiah integers.

### 4.3 Supplier payment and payable

Current lunasiBeli():
- Sets lunas=true.
- Sets tglBayar to current UTC date.
- Logs full invoice settlement.
- No amount, partial payments, payment method, bank reference, account, receipt or allocation rows.

Arus Kas view:
- Adds full purchase total when lunas=true and tglBayar is in selected date range.
- It cannot represent partial payments or multiple settlement dates.

Target requirement:
- purchases and payables are separate from payments.
- purchase_payments supports amount, method, account, reference, paid_at, created_by and idempotency key.
- payable balance = original invoice amount - approved supplier credits - sum of valid payments.
- Support multiple payments and partial settlement.
- For legacy lunas=true rows, import one historical settlement event equal to source total only if source evidence/policy accepts this interpretation; preserve legacy marker and do not invent method/reference.
- For lunas=false, do not invent payment rows.
- Supplier return credit should reduce payable only after the selected policy's recognition/approval event.

### 4.4 Supplier returns

Current local processReturBeli():
- Finds purchase and first batch whose beli equals purchase ID.
- Caps return quantity using Math.min rather than rejecting excess.
- Adjusts batch remaining and aggregate medicine stock/HPP.
- May adjust unpaid purchase qty/total.
- Creates return history with purchase ID, supplier, invoice, medicine, qty, value, reason and timestamp.
- Does not model a full supplier credit note/payment allocation workflow.

Target requirement:
- Require explicit batch allocation(s), reject quantity above available batch stock or purchase quantity.
- Preserve original purchase invoice values.
- Create supplier return header and per-batch lines, inventory movement, supplier credit note and AP allocation.
- Do not count supplier credit as sales revenue.
- If supplier pays a refund rather than crediting AP, record a separate bank/cash receipt.
- Support returns against more than one batch only when explicit allocations sum to requested quantity.

### 4.5 Loss, stock opname and stock card

Current local loss records include medicine/batch identifiers, quantity, reason and value; loss reduces stock and deleting the record can restore stock. Medicine aggregate stock can also be edited from master screen even though batches exist. Stock card is reconstructed from local arrays and has known risks of incomplete or double-counted movements.

Target requirement:
- All stock changes must be movement commands: purchase receipt, sale, sales return, supplier return, loss, stock count adjustment, expiry disposal and correction reversal.
- Never permit direct editing of aggregate stock without a corresponding movement.
- Inventory movement rows are append-only; corrections create compensating movements.
- Stock card must be generated from movement ledger, not inferred from current stock and selected arrays.
- A stock count must record system qty, physical qty, variance, reason, count actor, approver, effective time and movement posting.
- No deletion of a posted loss or adjustment; use reversal.
- Validate aggregate stock equals sum of batch balances plus documented non-batch/opening adjustments.

## 5. UI-to-calculation crosswalk

| Existing screen | Display / action | Calculation or source | Required MySQL behavior |
|---|---|---|---|
| Kasir > Shift | Modal, cash sales, non-cash, cash drawer, physical count, difference | calcShiftCash and close-shift flow | Snapshot server-derived expected cash; reconcile cash account |
| Kasir > Riwayat | Invoice, return, cancellation state | invoice/return records | Preserve immutable invoice and state timeline |
| Admin > Pembelian | Supplier invoice, qty, total, due date, paid flag | recordPurchase | Purchase receipt + batch + payable atomically |
| Admin > Utang | Unpaid purchase list / settlement | lunas flag | Payable balance and payment history |
| Admin > Stok Opname | Physical count/variance | stock and batch arrays | Count session + approved adjustment movements |
| Admin > Kartu Stok | Stock mutation history | reconstructed local records | Ledger-based movements with source link |
| Admin > Biaya | Expense, approval/rejection | biaya status and threshold | Submitter, approver, decision time, reversal |
| Pimpinan > Laba Rugi | Gross/net revenue, returns, HPP, loss, expense, petty, profit | calculateFinancials | Server report from recognized ledger events |
| Pimpinan > Arus Kas | Cash/non-cash inflow, purchase payments, expenses, petty, refund outflow | viewArusKas | Cash/bank ledger by account and effective date |
| Pimpinan > Utang | Supplier balances | purchase paid flag/total | AP subledger with credits and payments |
| Pimpinan > Pengawasan Retur | Approval, restore, payout | staged cloud return | Return state machine and refund obligation/payment |

UI labels and familiar workflows should be retained. A better backend must not silently change the meaning of existing labels.

## 6. Required reconciliation equations

These are target control equations; exact treatment of legacy adjustments requires policy.

### Inventory
- Batch balance = opening qty + receipts + approved sales returns - sales deductions - supplier returns - losses - approved count reductions + approved count increases.
- Medicine aggregate stock = sum of active batch balances plus explicitly documented non-batch stock.
- For each invoice medicine line, sum(batch deductions) = sold qty × component multiplier.
- For each approved stock return, sum(batch restores) = physically restockable returned quantity, not automatically the full invoice quantity.

### Payables
- AP balance per supplier invoice = original invoice total - supplier credit notes applied - payments applied.
- Sum payment allocations for a payment <= payment amount.
- Sum applied supplier credit <= approved credit note amount.

### Revenue and profit
- Net revenue = recognized active invoice totals - approved sales returns.
- HPP = posted sale HPP - eligible returned HPP.
- Operating profit = net revenue - HPP - recognized inventory loss - approved operating expenses - only those petty cash items classified as expenses.
- Opening modal is excluded from revenue and profit.
- No double posting of expense, petty cash or loss.

### Cash and bank
- Drawer closing cash = opening float + cash receipts + other cash-in - cash refunds paid in cash - petty cash paid - supplier cash payments - other cash-out ± approved adjustments.
- Bank/QRIS/transfer balance is separate from cash drawer.
- Shift expected cash = opening float + cash movements assigned to that shift, not all clinic-wide movements.
- Actual counted cash and variance are immutable close snapshot values.

## 7. Critical reconciliation gaps and design decisions

1. Petty cash and approved expense may represent the same event. Define whether petty cash is always a P&L expense, an advance, or mixed by category. Prevent duplicate expense recognition.
2. Cash refund payout is not currently tied to a shift. Decide whether Pimpinan pays from management cash drawer/bank account or assigns payout to cashier shift.
3. Cash shift estimate does not visibly include separate cash refund payout. New cash ledger must.
4. Arus Kas currently counts purchase total only when fully marked lunas; partial payment cannot be reconstructed from source.
5. Supplier return changes unpaid purchase total in local flow. Target must preserve original invoice and record credit separately.
6. HPP weighted average includes aggregate stock, which may differ from batch sum. Reconcile opening balances before importing HPP.
7. Stock card derived from arrays can omit/misclassify historical movements. Build a new ledger and label unprovable history as opening/reconstructed balance.
8. Return HPP for package components needs a precise policy: use snapshotted component HPP at sale and returned component qty.
9. Loss value calculation basis needs confirmation: purchase cost, weighted-average HPP, batch acquisition cost or another valuation basis.
10. Expense threshold and auto-approval logic must be server-side and decision audit must identify approver or auto rule.

## 8. Regression test matrix (synthetic data only)

| ID | Scenario | Expected result | Evidence |
|---|---|---|---|
| FIN-01 | Open shift with Rp300,000 modal and no sales | Drawer Rp300,000; omzet Rp0 | Shift screen + ledger |
| FIN-02 | Cash sale Rp100,000 | Drawer Rp400,000; omzet Rp100,000 | Invoice + shift |
| FIN-03 | Non-cash sale Rp75,000 | Drawer remains Rp400,000; non-cash account +Rp75,000 | Payment ledger |
| FIN-04 | Petty cash Rp20,000 paid from drawer | Drawer Rp380,000; expense recognized once | Shift + expense/ledger |
| FIN-05 | Same event entered as petty and biaya | Duplicate recognition rejected or linked as one event | Audit |
| FIN-06 | Cash return approved Rp10,000, not paid | Net revenue decreases; drawer unchanged; refund payable Rp10,000 | Return + report |
| FIN-07 | Pay same refund cash Rp10,000 | Drawer decreases once; obligation zero | Refund payment |
| FIN-08 | Retry refund payment same idempotency key | No duplicate payout | Ledger unique key |
| FIN-09 | Return paid by transfer | Bank decreases; drawer unchanged; reference mandatory | Bank ledger |
| FIN-10 | Close shift with mismatch | Difference = physical - system; immutable snapshot | Shift close |
| FIN-11 | Two open-shift requests for same cashier | Only one succeeds | Concurrency test |
| FIN-12 | Purchase Rp1,000,000, unpaid | Inventory increases; AP increases; cash unchanged | Purchase/batch/AP |
| FIN-13 | Pay Rp400,000 partial purchase payment | AP decreases Rp400,000; cash/bank decreases same | Payment ledger |
| FIN-14 | Pay remaining Rp600,000 later | AP zero; two payment events | AP aging |
| FIN-15 | Return supplier goods Rp100,000 on credit | Inventory decreases; AP credit increases; no sales revenue | Supplier credit |
| FIN-16 | Return qty greater than batch remaining | Reject; no changes | Error + no movement |
| FIN-17 | Sell medicine across two FEFO batches | Correct batch movements; stock and batch sum reconcile | Stock card |
| FIN-18 | Expired batch at WIB boundary | Not selectable after business-date expiry | API test |
| FIN-19 | Cancel invoice after sale | One reversal; invoice excluded from omzet | Invoice + stock ledger |
| FIN-20 | Cancellation races with return | Exactly one valid workflow; no double restore | concurrency trace |
| FIN-21 | Package sale with medicine component | Component qty and HPP snapshot correct | Invoice lines |
| FIN-22 | Partial package return | Restock only eligible returned medicine components per policy | Return allocations |
| FIN-23 | Stock opname variance | Approved adjustment movement and updated aggregate/batches | Stock card |
| FIN-24 | Delete/undo loss | Reversal event, original history remains | Audit/ledger |
| FIN-25 | Change medicine HPP after historical sale | Old invoice HPP unchanged | Historical report |
| FIN-26 | Change package composition after sale | Old package snapshot unchanged | Historical receipt |
| FIN-27 | Monthly close across WIB midnight | Transactions grouped by Asia/Jakarta business date | Reports |
| FIN-28 | Repeat import/replay command | No duplicate inventory or finance posting | Idempotency report |

## 9. Report parity and visual acceptance

The new backend must preserve current screen semantics and provide a report comparison:
- Same date range and filters in old and new system.
- Compare transaction count, gross revenue, return value, net revenue, HPP, loss, approved expenses, petty cash, operating profit.
- Compare cash receipts, non-cash receipts, refund paid, purchase payments, expense payments and closing balances.
- Compare stock per medicine and batch, purchase receipts, sales deductions, returns, losses and stock count adjustments.
- Every variance must be explained by legacy source gaps or an approved policy difference.
- Keep familiar screen labels but add tooltips/definitions where a legacy calculation is replaced.
- No report is accepted solely because the page renders; its totals must reconcile to ledger and sample source documents.

## 10. Safety and limitations

- Source-only review; no production data queried or exported.
- No real patient data accessed.
- No MySQL/TiDB DDL executed.
- No Firebase Rules, production app or production Vercel deployment changed.
- No claim that the new formulas are implemented or tested.
- Synthetic regression tests and owner policy decisions remain required before schema freeze.
