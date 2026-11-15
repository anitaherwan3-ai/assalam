# MYSQL Migration Audit — Invoice Composition, Financial Calculations & Cash Ledger

Status: source-only inspection on read-only `main`; no live writes, no schema or data migration.
Branch for this audit: `migration/tidb-foundation`.

## 1. Invoice item shapes verified from POS construction

### Service / tariff line
Created from master tariff with:
- `nama`
- `t` = tariff's `jenis` (service type)
- `harga` = tariff price
- `qty`
- `hpp = 0`

### Medicine line
Created from medicine master with:
- `oid` medicine ID
- `nama`
- `t = 'Obat'`
- `harga` = medicine selling price
- `qty`
- `hpp` = current medicine weighted-average HPP snapshot

### Package line
Created from package master with:
- `pid` package ID
- `nama`
- `t = 'Paket'`, `jenis = 'Paket'`
- `harga` = package selling price
- `qty`
- `items` = package component snapshots (batch deductions stripped before checkout)
- `hpp` = sum of component medicine HPP × component quantity, excluding service components

Package components are copied from package master at checkout. Medicine components are recognized by `type === 'obat'` and `oid || id`; component quantities are multiplied by package quantity for stock demand. Batch FEFO deductions are subsequently attached to the transaction snapshot. This means historical package composition is retained on the invoice even if the package master changes later.

### Invoice header
Verified fields in checkout construction:
- `id`, `no`, `tgl`, `jam`
- `pid`, patient `nama`, `hp`
- `kasir`, `sh` shift ID
- `items` line snapshots
- `total` final payable amount
- `metode` payment method
- `bayar` amount received / amount recorded for non-cash
- `kembalian`
- `_t` client timestamp

The full checkout function also checks active patient/calling state, open shift, non-empty cart, disallows free-standing negative discount lines, validates aggregate stock and eligible non-expired batch availability, then deducts stock using FEFO before calling the cloud transaction for cashiers.

## 2. Checkout / atomicity findings

Cloud `commitCashierTransaction()` uses a Firestore transaction to:
- return without re-applying stock changes if invoice ID already exists (idempotency);
- read patient, medicine and batch records;
- verify sufficient aggregate medicine and batch balances;
- decrement medicine and batch balances;
- mark patient done;
- create invoice;
- create return-quota rows for each invoice line.

This cloud transaction is a meaningful integrity boundary. However, source code prepares the invoice and stock allocations in the browser. The cloud method receives `trx`, `patientId`, and `stockChanges` from the client and validates stock quantity against existing balances, but the inspected method does not recompute selling price, HPP, line totals, package component definitions, payment method, shift association or invoice total from authoritative server-side master data. New MySQL API must calculate these from database rows inside its own transaction.

Also note the browser applies local FEFO deductions before calling cloud and contains a compensating local stock increment if cloud transaction fails. This is not a replacement for server transaction rollback; the SQL API should own all authoritative stock mutation.

## 3. Discounts and total semantics

Checkout explicitly disallows a standalone `Diskon` item and negative item price. The UI comment says discounts are only through official package pricing. Invoice `total` is already the final amount after package pricing; financial report does not subtract discount again.

Need confirm in the next audit whether any separate discount field exists in legacy invoices or package master, and how package tariff components are priced. Until confirmed, do not invent a generic invoice discount field or assume package price equals sum of component prices.

## 4. Financial calculation semantics verified

`calculateFinancials()` uses active (not cancelled) invoices in the selected date/payment/cashier filter.

- Gross revenue = sum of active invoice `total`.
- Approved return value = sum of approved/legacy-approved return records, dated by approval timestamp converted to Asia/Jakarta date (fallback to return date).
- Net revenue `rev` = gross revenue − approved return value.
- HPP = sum of invoice line `hpp × qty` for medicine and package lines − HPP returned for approved medicine/package returns.
- Inventory loss = sum of loss `nilai` within report date range.
- Operating expenses = sum of `biaya.jml` where status is `approved`.
- Petty cash = sum of `petty.jml` in report range.
- Operating net profit `laba` = net revenue − HPP − loss − approved operating expenses − petty cash.
- Opening shift float is separately summed as `totalModalAwalShift`; it is not added to revenue or profit.
- `totalKasDiTangan` = opening floats + cash invoice totals − paid cash refunds − petty cash.

Returns have two separate timing concepts:
- revenue adjustment follows return approval date;
- cash outflow follows actual refund payment date, with payment method filter.
Pending refund is reported separately; legacy approved returns without a payment subdocument are tracked separately.

### Important accounting cautions
1. `calculateFinancials()` is a UI-side report function, not a formal journal/ledger. Its totals are useful business metrics but cannot substitute for an immutable cash/bank ledger.
2. `totalKasDiTangan` formula shown here does not subtract approved expenses or supplier invoice cash settlements. Confirm whether those are intentionally excluded from this KPI or are handled elsewhere. Do not call it a complete clinic-wide cash balance until reconciled.
3. Petty cash is subtracted from shift cash and also included as an expense in operating profit. This is not double-counting within separate calculations, but the SQL accounting model must keep cash movement and profit/expense classification distinct.
4. HPP for package line is captured as a single line HPP snapshot and return HPP logic must reconcile package component medicine quantities. Do not simply treat all package revenue as medicine revenue: report classifies return value by line kind and needs component-aware cost allocation.
5. Cash payment `bayar` can be greater than invoice total due to cash tender/change; revenue and shift cash correctly use invoice `total`, not tender `bayar`. Preserve this distinction.
6. Return approved value and actual refund payment are intentionally separate events; preserve the payable refund liability until paid.

## 5. Shift cash formula verified

`calcShiftCash(shift)`:
- takes non-cancelled invoices associated with shift ID;
- sums only invoices whose payment method is `Tunai`, using invoice total;
- sums petty cash entries associated with that shift;
- expected cash = opening modal + cash invoice totals − petty cash.

Non-cash sales are displayed separately and are not included in drawer cash. Cash returns are not included in this shift formula in the inspected code, even though paid cash refunds are deducted from the wider report `totalKasDiTangan`. This is a reconciliation gap to resolve: if a cash refund is paid from the cashier drawer during the shift, expected drawer cash should reflect it or there must be a separate refund cash-out source tied to the shift.

## 6. Inventory loss and petty cash findings

Inventory loss creation:
- selects a specific batch;
- validates requested qty against batch remaining;
- values loss as qty × current medicine HPP;
- decrements batch remaining and aggregate medicine stock;
- stores date, medicine ID, batch ID, qty, reason, loss value and timestamp.

Loss cancellation currently restores medicine and batch balances, then physically removes the loss record. For a ledger-based system this should become a reversal entry, not deletion. Validate that reversal cannot restore more than originally deducted and cannot exceed batch received quantity.

Petty cash creation:
- stores date, description, positive amount, cashier ID, shift ID (or null), timestamp.
- UI permits editing description/amount and physical deletion after confirmation.
- Firestore Rules allow cashier to create/edit/delete their own petty cash rows, Admin/Pimpinan broader rights as specified in rules.
- Since petty cash reduces expected shift cash, edits/deletions after shift close can change historical expected cash unless frozen or versioned. New system should require shift open for ordinary entry/edit, and use a reversal/adjustment workflow after close.

## 7. Date and operational period

Financial report timestamp conversion uses `Asia/Jakarta` for return approval/payment timestamps. Some store purchase functions instead use UTC ISO date. SQL should store event instant in UTC and clinic operational date explicitly in `Asia/Jakarta`; reporting by clinic date must not rely on browser locale.

## 8. Required relational boundaries (design candidates, not approved schema)

Candidate entities that need to remain separate:
- invoice header and immutable invoice line snapshots;
- package master and package component master;
- invoice line package component snapshots;
- inventory movement ledger and batch balance;
- sales return request, approval, refund payable, refund payment;
- shift header, cash movements, close count and verification;
- petty cash request/payment or petty cash movement;
- operating expense approval and payment;
- supplier invoice, supplier return credit, supplier payment;
- stock loss and reversal;
- audit event.

## 9. Remaining audit work before schema approval

- Inspect full invoice creation continuation and receipt/label logic for any additional snapshot fields.
- Inspect package master creation/edit and all component types.
- Inspect every report and export calculation, including supplier payables, purchase costs, return impact and cash/bank reconciliation.
- Inspect cancellation state machine against return state machine.
- Inspect sync merge/listener behavior, including offline caches and timestamp collision handling.
- Define canonical ledger mapping and verify each business event is posted exactly once.
- Define and test concurrency cases for duplicate invoice, simultaneous stock depletion, overlapping returns, shift close vs cash entry, and approval vs edit.

No SQL DDL or migration implementation is authorized by this audit.
