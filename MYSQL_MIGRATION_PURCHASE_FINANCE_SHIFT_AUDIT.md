# MYSQL Migration Audit — Purchasing, Expenses, Shift Closing & Verification

Status: source-only inspection, no live writes or acceptance tests.
Branch: `migration/tidb-foundation`; source baseline: `main` read-only.

## 1. Purchase entry — verified behavior

UI `actionAddBeli()` validates supplier, medicine, positive quantity, positive invoice total and expiry date. It calls `ClinicStore.recordPurchase()` with supplier, invoice number, medicine ID, quantity, total, due date, batch number, expiry, and whether paid in cash.

Store behavior:
- Calculates weighted moving average HPP using current aggregate stock and HPP:
  `new HPP = round((old stock * old HPP + purchase invoice total) / (old stock + received qty))`.
- Increases aggregate medicine stock.
- Creates one batch linked to the purchase invoice, with batch number, expiry, initial quantity and remaining quantity.
- Creates purchase invoice with supplier, invoice number, medicine, quantity, total, due date, paid flag, payment date, original quantity/total, unit purchase price and batch ID.
- Logs the purchase.

Firestore Rules allow Admin/Pimpinan read/write on `k_beli`, but do not enforce field-level validation or atomic coupling with batch and medicine documents at the Rules layer. The local store performs all three mutations before a debounced whole-state sync.

### Risks / required design
1. HPP is weighted against aggregate medicine stock, not a sum of independently costed batch layers. This may be intentional weighted-average accounting, but must be documented and reconciled with batch valuation.
2. The HPP calculation assumes the aggregate stock and HPP are already consistent. If batch balances diverge, the new HPP can be wrong.
3. No unique supplier invoice constraint was found in this path. Decide whether supplier + invoice number must be unique, including per supplier.
4. Purchase quantity, amount, expiry, and medicine existence must be validated server-side; never trust browser calculations.
5. Purchase row, batch row, aggregate stock, inventory ledger, payable balance, and audit event must commit in one SQL transaction.
6. A stock purchase must be distinguishable from a supplier invoice payable and from a cash payment.

## 2. Purchase settlement — verified behavior and gaps

Store method `lunasiBeli(beliId)` simply sets:
- `lunas = true`
- `tglBayar = today`
- activity log entry

It does not capture amount paid, payment method, reference, partial payment, payer, or a separate payment event. The due date (`tempo`) and outstanding invoice total are stored on purchase. UI uses a binary `isLunas` choice at purchase entry.

### Decision required
Current source path supports only all-paid-at-entry or a later full settlement flag. It does not model partial settlements or multiple payment events. Before SQL design, owner must choose:
- retain full settlement only; or
- support partial/multiple payments with a payment ledger (recommended if clinic pays suppliers in installments).

Recommended model separates purchase invoice amount, supplier credit/remaining balance, payment transactions, and supplier-return credit notes. Do not infer paid cash merely from `lunas=true` without a payment record.

## 3. Supplier returns — verified behavior

UI `openModalReturBeli()` offers a return quantity and reason. Store `processReturBeli({beliId, qtyRetur, alasan})`:
- locates purchase, medicine, and the batch whose `beli` reference matches the invoice;
- caps return quantity to the minimum of requested qty, remaining invoice qty, batch remaining qty and aggregate medicine stock;
- determines unit cost from preserved original invoice unit price, falling back to original total/quantity or current total/quantity;
- computes return value as rounded qty × original unit cost;
- reduces aggregate stock and the linked batch balance;
- recalculates HPP from the aggregate inventory value remaining;
- reduces purchase total only when invoice is not paid; paid invoices retain historical total;
- reduces purchase remaining quantity;
- creates a supplier-return row with date, purchase ID, supplier, invoice, medicine name, qty, value, reason;
- logs and saves.

Rules grant Admin/Pimpinan read/write on `k_returBeli` and purchase rows without a detailed transition/field schema.

### Risks / required design
1. Supplier return quantity, batch balance, aggregate stock, HPP, payable credit, supplier-return record and ledger must be one atomic server transaction.
2. Paid and unpaid invoices have different balance semantics. A paid invoice should not have its original historical total overwritten; supplier credit/refund/offset must be represented separately.
3. Current supplier-return record does not capture settlement outcome (supplier credit note, cash refund, replacement goods, offset against future invoice).
4. Current return path uses a single matching batch by purchase ID; the relational model should support multiple batches per purchase invoice and explicitly allocate returned quantities to selected batch lots.
5. Prevent cumulative returns exceeding received/remaining invoice quantities, and prevent returning stock already dispensed, lost, expired, or otherwise unavailable.
6. Do not hard-delete a posted supplier return; use reversal with reason and approval.

## 4. Expense approval — verified source inconsistency

UI expense creation computes total as unit amount × quantity (quantity defaults to 1), then:
- records date, category, description, total, status, user identifier and timestamp;
- sets status `pending` when total >= `batasApproval` (default Rp1,000,000), else `approved`;
- logs and saves.

UI edit changes description and amount, then recomputes status from threshold. UI delete physically removes the expense row after confirmation.

UI `actionApproveBiaya(id, isApproved)` simply changes status to `approved` or `ditolak`, updates timestamp, logs and saves. It does not capture approver identity/time in the expense row in this path.

Firestore Rules allow only Admin/Pimpinan read/write on `k_biaya`. However, the UI's default status logic automatically marks below-threshold expenses approved, while the displayed approval view describes expenses exceeding the threshold as requiring Leadership authorization. The threshold logic and actual approver authority are therefore not consistently enforced by one authoritative server state machine.

### Risks / required design
1. Define who may create, approve, reject, edit and reverse an expense.
2. Decide whether the creator may approve their own expense. Recommended: no self-approval for threshold-controlled expense.
3. Capture approval actor, role, timestamp, decision and reason as immutable approval event.
4. Editing amount after approval must invalidate/revoke approval or create a new version requiring approval; do not silently flip state.
5. Posted expense must not be physically deleted; use void/reversal with actor and reason.
6. Distinguish expense request from actual cash/bank payment. A request being approved is not proof it has been paid.
7. Set threshold on server-side configuration with audit history; don't trust a client-supplied threshold.

## 5. Shift close and verification — verified behavior

UI close shift:
- obtains current shift and physical cash amount;
- calculates system cash through `calcShiftCash(shift)`;
- sets status to `tutup`, close time, system cash, physical cash, difference (physical − system), `verif:false`, timestamp;
- writes activity log and saves;
- opens close summary and prepares WhatsApp recap to owner.

Firestore Rules:
- Cashier can create own open shift with nonnegative opening modal.
- Cashier can update own shift fields within a restricted set. For an open shift, status can remain open or move to closed; closing must set `verif:false`.
- Once closed, cashier may only update timestamp.
- Admin can verify only a closed shift by setting `verif:true` and `oleh` plus timestamp.
- Pimpinan has broad update/delete authority.

UI `actionVerifShift(id)` sets `verif:true`, stores verifier display name in `oleh`, logs and saves. It does not independently check in this function that the shift is closed, nor does it store verifier's stable user ID/role in the shift row. The Firestore Rules provide the closed-shift/admin check.

### Risks / required design
1. New API must enforce shift status and role server-side; UI visibility is not authorization.
2. Calculate system cash server-side from classified cash movements. Never trust client `sistem` or `selisih`.
3. Define exact cash equation, including opening float, cash sales, cash refunds, petty cash, paid expenses, cash purchase payments, and cash adjustments. Opening modal is float, not omzet.
4. Store physical cash count as submitted by cashier, calculated expected cash, difference, verifier user ID, verifier role, verification timestamp and any adjustment reason.
5. Decide whether verified shifts can be reopened or adjusted. Recommended: do not overwrite; use an adjustment event with approval.
6. Prevent duplicate open shifts for same cashier and operational date with a database constraint/serialized command.
7. WhatsApp recap is a notification, not the accounting record; it must not be the only record of close/verification.

## 6. Date/time issue found

Purchase store method uses `new Date().toISOString().slice(0,10)` for purchase date and settlement date (UTC calendar date). Other app paths use `todayStr` or explicit `Asia/Jakarta` formatting. Near midnight WIB, UTC date can differ from the clinic's operational date.

**Migration requirement:** store UTC instant for event time and separately store clinic operational date computed using `Asia/Jakarta`. Reports, shift grouping, queue and invoice date must use the operational date. Do not derive it from browser timezone or UTC date alone.

## 7. What this audit confirms vs what remains open

### Verified from inspected source
- Purchase weighted-average HPP and batch creation are local store operations.
- Purchase settlement is currently a full-paid boolean/date update.
- Supplier return reduces stock, batch balance, remaining purchase qty and (for unpaid invoice) purchase total.
- Expense threshold and approval are implemented in UI; approval actor metadata is absent in the inspected approval method.
- Shift close records system/physical/difference and Admin verifies a closed shift.
- Firestore Rules are more restrictive for shift and role access than the local UI methods.

### Still requiring exact follow-up inspection
- Exact `calcShiftCash()` inclusion/exclusion rules and interaction with returns, petty cash and expenses.
- Purchase, supplier-return, expense and shift document shapes after actual cloud synchronization.
- Whether other screens or helper modules write settlement/approval fields.
- Full read/write mapping in `performPush()` and realtime listener merge conflict handling.
- Store methods for petty cash and loss reversal and the exact `k_petty` rules.
- All purchase-related report calculations and accounts-payable aging behavior.

## 8. Schema gate

No SQL DDL should be created until:
- purchase/payment/partial-payment policy is decided;
- supplier-return settlement policy is decided;
- expense approval threshold and self-approval policy is decided;
- shift cash formula and reopen/adjustment policy are documented;
- all dates use a single clinic operational-date rule;
- all these actions have server-side authorization and atomicity tests defined.
