# TiDB Inventory Domain — Command & Integrity Contract (Pass 51)

**Branch:** `migration/tidb-foundation`  
**Status:** design contract only — not approved schema DDL  
**Evidence basis:** legacy `js/store.js`, purchase/financial audit, inventory reconciliation audit, return/cancellation crosswalk and 56 passing CI tests.  
**Production:** Firebase unchanged; no live inventory data read or imported.

## 1. Domain boundary

Inventory is a single transactional domain. Its write commands must update, as one database transaction:

- affected medicine and batch rows;
- immutable inventory movement rows;
- purchase/return/loss/stocktake source rows;
- weighted-average HPP and stock projections;
- audit event and idempotency result;
- payable/credit/cash entries when the command has a financial effect.

The browser may request an operation, but may not authoritatively submit the resulting stock, HPP, batch allocation, payable balance or final valuation.

## 2. Required invariants

1. Every quantity has a medicine-specific base unit and explicit precision policy. **D01 remains open**; do not freeze `DECIMAL(18,3)`, integer-only or fractional dispensing as a clinic policy until confirmed.
2. Medicine aggregate stock is a server-owned projection. A normal master edit cannot overwrite stock/HPP directly.
3. Batch balance is a server-owned projection. Every batch change has a movement or a documented opening/reconciliation event.
4. Physical stock and sellable stock are different concepts: expired stock may remain physically present until disposal but must be excluded from FEFO sale allocation based on the clinic's Asia/Jakarta business date.
5. Aggregate stock reconciles to all batch balances plus only explicitly documented and approved non-batch/opening adjustments. Missing historical batch lineage is quarantined; never fabricate a batch.
6. All financial amounts are integer Rupiah in persistence; calculations must be deterministic and use BigInt/string-safe transport.
7. Posted movements, invoices, receipts, returns and losses are immutable. Corrections use compensating/reversal movements linked to the original.
8. Every write command uses idempotency and server-derived actor/role/time.
9. Commands touching the same medicine, batch, receipt line or return quota must lock rows in a stable deterministic order and revalidate immediately before commit.

## 3. Command contracts

| Command | Required server work | Atomic result |
|---|---|---|
| Create/edit medicine master | Validate name, canonical unit policy, price and min stock; do not accept client stock/HPP edits | Master version + audit |
| Purchase receipt | Lock medicine and source invoice/line; validate positive qty/value, date and batch; calculate HPP from approved basis | Invoice/line, receipt, batch, purchase movement, stock/HPP projection, payable/payment records, audit |
| Checkout dispense | Recompute invoice/package component quantities; lock medicine/batches; use FEFO (expiry, received time, stable batch ID tie-break); reject insufficient sellable stock | Invoice snapshots, exact batch allocations, sale movements, balances/HPP snapshot, patient completion and return quota |
| Patient return | Verify original invoice/component/quota; rederive refund amount; reserve or finalize according to staged approval; restore only eligible quantity to original batch lineage | Return request/decision, quota, return movement, disposition, refund obligation and audit |
| Supplier return | Lock original purchase line and exact batch allocation; reject above purchase remaining, batch balance or physical stock; never silently clamp | Supplier return line, batch/stock movement, HPP projection, supplier credit record, audit |
| Loss/expiry disposal | Lock exact batch; validate quantity and value from server-side HPP snapshot; never physically delete posted event | Loss + negative movement + stock/HPP projection + audit |
| Stocktake/adjustment | Capture system quantity, counted quantity, variance, actor, reason and approver; no direct balance assignment | Approved adjustment movement and stock projection |
| Reverse/correct movement | Link original movement; calculate exact inverse and verify no dependent history is invalidated | Reversal movement and audit |

## 4. FEFO and batch allocation

Target deterministic order:

1. same medicine;
2. remaining quantity greater than zero;
3. expiry date not earlier than Asia/Jakarta business date;
4. expiry date ascending;
5. received timestamp ascending;
6. stable batch identifier ascending.

Do not allocate partially when total eligible quantity is insufficient. The full checkout transaction must fail without writing the invoice, patient completion, quota, batch movement or cash event.

The legacy source sorts by expiry only and uses a UTC date string. The target must use clinic business date and deterministic tie-breaking. Existing legacy test suite now covers expired-batch exclusion, no partial deduction on shortage and original-batch return restoration.

## 5. Purchase and HPP

Legacy evidence: `recordPurchase()` computes weighted-average HPP as:

`round((old_stock × old_hpp + purchase_total) / (old_stock + received_qty))`

The function creates one batch for each purchase record and stores original quantity, total, unit cost and batch ID. This is the compatibility baseline, not yet the complete accounting policy.

Still open/source-gated:
- whether an invoice line can be received in multiple shipments/lots/batches;
- supplier invoice-number uniqueness per supplier;
- whether freight, discounts, taxes or other landed costs enter HPP;
- supplier credit note vs cash refund vs future offset recognition;
- partial/multiple supplier payments (legacy only exposes a boolean paid flag);
- exact opening-stock and HPP evidence at cutover.

Never create synthetic historic payment allocations from `lunas=true`. A paid invoice's original amount remains historical; supplier credit/payment is represented separately.

## 6. Return and disposition

Established workflow must remain staged:

- Kasir submits a return request;
- Admin reviews/forwards or rejects;
- Pimpinan makes the final decision;
- any refund payout is a separate Pimpinan action and is recorded as “uang kembali”.

A service/fee return has no stock movement. Medicine/package return must link to the exact original sale-time batch deductions. A request alone must not increase stock.

Open clinic policy:
- who certifies unopened/resalable medicine;
- quarantine vs immediate re-entry timing;
- partial service/fee refund eligibility;
- package discount/refund rounding policy. Existing largest-remainder proportional allocation is captured in legacy behavior tests and is the compatibility candidate, but should not be silently promoted to a new clinic policy.

## 7. Legacy data treatment

- Medicine with no reliable batch lineage: quarantine for physical reconciliation.
- Sale without valid batch deduction: quarantine; do not fabricate allocations.
- Batch with invalid/ambiguous expiry: quarantine from FEFO until verified.
- Aggregate stock/HPP that does not reconcile to batch movements: retain raw source values and create a variance report; never force-fit.
- Opening stock is an explicit opening event with evidence/approver, not a synthetic purchase invoice.
- Preserve original Firebase document ID under source-system + collection scope.

## 8. Required TiDB tests before inventory DDL or UI cutover

- exact type/precision/unsignedness/collation for every FK tuple;
- FK parent key order and child index metadata;
- no negative stock under concurrent checkout/return/loss;
- two concurrent checkouts competing for same last batch;
- duplicate/retried purchase receipt is idempotent;
- two simultaneous returns cannot reserve more than sold quantity;
- patient return and cancellation race cannot both restore stock;
- split receipt and multi-batch supplier return once source cardinality is resolved;
- rollback leaves no partial movement or HPP change;
- projection reconciliation: aggregate = batch sum + documented approved opening/adjustment balance;
- HPP and integer Rupiah values round-trip at supported limits.

**Disposition:** safe to continue synthetic domain/service work. Not approved for inventory DDL, real data import, or production cutover.
