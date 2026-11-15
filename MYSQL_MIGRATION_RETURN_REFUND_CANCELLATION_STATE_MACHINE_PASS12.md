# RETURN, REFUND & CANCELLATION STATE-MACHINE SOURCE AUDIT — PASS 12
Tanggal: 2026-11-15  
Branch: `migration/tidb-foundation`  
Status: **STATIC SOURCE AUDIT — NO RUNTIME TEST / NO DDL**

## 1. Scope and evidence

Inspected `js/firebase-backend.js` at source SHA `3a613d96564f120b8141966f9ecbae21471c4e65`, particularly:
- `submitCancelRequest()`, `processCancelRequest()` (approximately lines 418–565)
- `returQuotaId()`, `submitReturJual()`, `migrateReturKuota()` (approximately lines 567–745)
- `approveReturJual()`, `finalizeReturJual()`, `rejectReturJual()`, `payReturJual()` (approximately lines 746–1007)
- `commitCashierTransaction()` (approximately lines 1084–1150)

This is tracked source evidence only. It does not prove live Firestore Rules, deployed Function behavior, transaction retry rates, or historical quota consistency.

## 2. Observed patient-return lifecycle

### 2.1 Submit and reserve quota atomically

`submitReturJual()` runs a Firestore transaction that reads the original invoice, quota document, proposed return document and cancellation request. It verifies:
- invoice exists and is not cancelled;
- return ID is not already used;
- cancellation request is absent or rejected;
- quota document exists and belongs to the same invoice/item index;
- cumulative reserved quantity does not exceed the original invoice line quantity;
- submitted item name, price and type match the immutable invoice line;
- return amount is recalculated server-side from original invoice and proportional discount allocation;
- batch restoration details are reconstructed from original invoice deductions, not trusted from the browser.

It then increments `qtyTerpakai` on the quota document and creates the pending return in the same transaction. Thus the quota counter is reserved at submission, not at final approval. The local helper's calculation is only a UI-side check; cloud transaction is authoritative.

**Target implication:** one quota row per actual returnable subject is sufficient if the business subject is an invoice line. Reservation, request creation, rejection release and finalization must all be atomic and idempotent. Do not create a separate quota-event table unless a concrete audit/replay requirement cannot be met with quota row versioning plus ordinary audit records.

### 2.2 Role stages and source divergence

Observed cloud adapter permissions:
- submit: Kasir **or Pimpinan**;
- Admin: only advances status `menunggu` → `menunggu_pimpinan`;
- final approval/stock restoration: Pimpinan only;
- rejection: Admin can reject `menunggu`; Pimpinan can reject `menunggu_pimpinan`;
- refund payout: Pimpinan only.

The user-confirmed operational preference is cashier submission, Admin verification and Pimpinan final decision. The adapter's extra Pimpinan submit capability is a source behavior, not sufficient evidence that it is required.

**Target policy candidate:** ordinary returns are submitted by the cashier who owns the invoice/shift; Admin reviews/forwards or rejects; Pimpinan finalizes. If an owner emergency/override is needed, model it as a separately audited override with reason and explicit permission—not silently as a normal submit path. This does not change Firebase.

### 2.3 Final approval and stock restoration

`finalizeReturJual()` accepts only `menunggu_pimpinan`, rechecks invoice/line/price/name/type/return amount, rebuilds batch restores from the original invoice, reads affected medicine and batch documents, and updates stock/batch plus return status and pending refund obligation in one Firestore transaction. It does not trust the submitted `batchRestores` payload.

**Target implication:** final approval must atomically:
1. lock invoice and quota subject;
2. verify the reserved request and immutable source line/component;
3. recalculate net refundable value;
4. validate exact original batch allocations and item disposition;
5. post stock restoration only for accepted resalable quantities (or route non-resalable quantities to quarantine/loss);
6. create one refund obligation;
7. record final actor/time and state.

The precise resalable-vs-quarantine rule remains owner policy D05. The source restores stock for all reconstructed batch units; do not copy that behavior without the disposition policy.

### 2.4 Reject releases reservation

`rejectReturJual()` computes the quota key from the return's quota ID or invoice/item index, decrements `qtyTerpakai` by the rejected quantity in the same transaction as setting `ditolak`, and rejects a negative resulting quota.

**Target implication:** release must be exactly once. Duplicate rejection/retry must not decrement quota twice. Use locked/versioned quota row and a conditional status transition. No separate quota event table by default.

### 2.5 Refund payout is a separate command

`payReturJual()` only accepts a Pimpinan profile, only allows `Tunai` or `Transfer`, requires a transfer reference for transfer, requires final approved status and pending payout state, and changes payout to `dibayar` with actor/time/reference in a transaction. It refuses a second payout and does not treat approval alone as proof that money was returned.

**Target implication:** preserve separate refund obligation and refund payment record; use unique idempotency/one-time transition; do not permit Admin or cashier payout. The accepted payout method set and any future additions are policy/config decisions, not a reason for a generic payment-method framework.

## 3. Package component granularity

The observed return quota key is `trxId + '__' + itemIndex`, i.e. one quota per top-level invoice item. For a package invoice line, the code calculates component medicine restoration from each package component's original `batchDeductions` and package component quantity multiplied by the returned package quantity. It does not create independent quota subjects for each nested package component in this code path.

This means current source evidence supports whole-package quantity returns with component-aware stock reconstruction; it does **not** demonstrate independent partial return of one nested component while keeping other package components. If the clinic requires component-level package returns, that is a distinct business behavior requiring owner confirmation and source/UI redesign. Do not assume it merely because a relational table can represent it.

Service-only invoice lines can be returned by the same top-level item-index quota and have no stock restore. Service eligibility and partial-return rules remain D07.

## 4. Cancellation lifecycle and concurrency observation

### 4.1 Submit cancellation

Only Kasir can submit cancellation. The adapter queries returns for the invoice **outside** the Firestore transaction (compat Transaction.get does not accept a Query), then transactionally reads invoice and cancellation request and creates/updates a pending cancellation. It blocks cancellation if any non-rejected return exists.

### 4.2 Process cancellation

Admin or Pimpinan can process cancellation. For approval, the adapter again queries returns outside the transaction, then transactionally reads request/invoice, verifies status, reconstructs all original medicine and batch deductions, validates batch ownership and exact quantity totals, restores stock/batches, marks invoice cancelled and request approved. Rejection only changes request state.

### 4.3 Concurrency consequence

The source relies partly on Firestore Rules and the pending cancellation document to prevent a new return from racing with cancellation; the return query itself is not a transactional query read. The SQL design should not reproduce this split-query pattern.

**Target requirement:** use a single invoice lifecycle guard/row lock and a consistent lock order. Return submission and cancellation submission/finalization must all lock/read the same invoice state in one DB transaction and reject conflicting active workflows. Cancellation approval must lock original invoice lines, batch allocations, batches and medicine balances before posting reversal. Tests must run simultaneous return-vs-cancel on independent TiDB connections and prove exactly one valid path wins.

## 5. Invoice creation and quota bootstrap

`commitCashierTransaction()` is cashier-only. It returns idempotently if invoice ID already exists, checks patient/medicine/batch existence and available balances, decrements medicine and batch stock, marks patient done, writes invoice, and creates one `k_returKuota` document per top-level invoice item with `qtyTerpakai: 0` in the same transaction.

This confirms quota initialization is coupled to invoice creation. The target should create invoice lines and their returnable quota subjects atomically at checkout, not in a later background migration for new sales. Legacy invoices without quota require a separate audited backfill/quarantine process; the source adapter's migration helper must not be run blindly against production.

## 6. Schema decisions from this pass

1. Keep a single quota subject per invoice line for current demonstrated behavior.
2. Do not add nested component quota rows unless independent package-component returns are explicitly required.
3. Reserve quota on submit; release on rejection; consume/finalize at approval according to a single well-defined counter semantic. The target should avoid one ambiguous `qtyTerpakai` field if it conflates reserved and approved quantities.
4. Model return request state and refund payout state separately.
5. Stock restoration is tied to final approval and validated original batch lineage; disposition policy controls resalable vs quarantine.
6. Cancellation and return are mutually exclusive under the same invoice-level transaction lock.
7. Invoice creation and quota subject creation are atomic.
8. Event-specific tables are conditional. Do not add `sales_return_quota_events` or a generic state-machine table without evidence that quota row + audit log is insufficient.

## 7. Target positive/negative test matrix

| Test | Expected |
|---|---|
| Submit a valid line return within remaining quota | Request and reservation commit atomically |
| Two concurrent returns compete for last remaining quantity | At most one succeeds; no over-return |
| Return payload changes price/name/type from invoice | Rejected |
| Batch restore payload names another batch | Ignored/rebuilt from invoice; mismatched ownership rejected |
| Admin attempts final approval or payout | Denied |
| Cashier attempts final approval or payout | Denied |
| Pimpinan finalizes same request twice | Second attempt rejected; stock restored once |
| Admin rejects same request twice | Second attempt cannot release quota again |
| Pimpinan rejects after Admin forwarded | Quota reservation released exactly once |
| Transfer payout without reference | Rejected |
| Payout replay with same request/idempotency key | No duplicate payout |
| Service return | Refund obligation only; no inventory movement |
| Package whole-unit return | Component medicine batch allocations restored according to original invoice |
| Component-only package return when unsupported | Rejected explicitly; not guessed |
| Return submission races with cancellation submission | Invoice lock/guard serializes; no both-active state |
| Cancellation approval races with return finalization | Exactly one terminal path succeeds |
| Legacy invoice lacks quota or original batch allocations | Quarantine/manual reconciliation; no fabricated quota or batch |

## 8. Open policy/source gates

- D05: returned medicine resalable vs quarantine criteria.
- D06: package discount/refund allocation and rounding; whether component-only return is required.
- D07: service return eligibility and partial-return rules.
- D13: payout methods/evidence beyond current Tunai/Transfer source path.
- Confirm whether Pimpinan may submit a routine return or only an audited override; target default follows cashier-submission preference.
- Confirm legacy quota backfill completeness and duplicates using a secured read-only snapshot before any migration.

## 9. Safety and status

Static source audit only. No Firestore/Firebase/Auth mutation, no live data query, no TiDB DDL/data mutation, no deployment, no production change, no main merge and no PR13 merge. Schema v1 remains **BLOCKED**.
