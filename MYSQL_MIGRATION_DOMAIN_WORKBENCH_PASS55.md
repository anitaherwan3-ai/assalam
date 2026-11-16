# TiDB Domain Workbench — Inventory, Patient/Queue and Finance (Pass 55)

**Branch:** `migration/tidb-foundation`  
**Status:** executable domain primitives + cross-domain contract; not schema-v1 DDL approval  
**CI baseline before this pass:** 61/61 tests passed  
**Production:** Firebase remains authoritative; no operational records, account identities or stock balances were changed

## 1. What this pass actually implements

A policy-neutral Node.js domain module now provides tested primitives for:

- explicit quantity scale and exact decimal arithmetic;
- integer-Rupiah / BigInt-safe money;
- deterministic, non-mutating FEFO allocation by expiry, receipt time and batch ID;
- all-or-nothing allocation planning when sellable quantity is insufficient;
- weighted-moving-average HPP without floating-point arithmetic;
- supplier-return source-batch and purchase-quantity validation, rejecting excess rather than silently clamping;
- checkout ownership checks across patient, encounter, cashier and open shift;
- a queue sequence subject key that includes date and caller-supplied prefix without deciding what A/B mean;
- period revenue/refund bridge that separates approval date from actual refund payout date and keeps opening float out of omzet.

The module does not connect to TiDB, write SQL, choose a clinic unit, create a batch, post a stock movement, or settle a supplier credit. These are intentionally not claimed as complete.

## 2. Inventory domain — target transaction boundary

The inventory domain is built around a server-owned movement ledger and derived projections.

| Aggregate | Proposed responsibility | Non-negotiable invariant |
|---|---|---|
| Medicine master | Name, canonical unit, selling/HPP display fields and version | D01 is open; do not set universal strip/tablet/fraction precision or allow the browser to overwrite stock/HPP |
| Batch | Purchase receipt provenance, expiry, received timestamp, original and remaining quantity, disposition | No synthetic batch for legacy sales/stock with missing lineage |
| Inventory movement | Append-only signed quantity event with source type/ID, medicine/batch, actor, timestamp and reversal link | No hard-delete or direct balance assignment |
| Purchase/receipt | Supplier invoice + line + one or more receipt/batch records | Header, receipt, batch, movement, stock/HPP projection, payable and audit are one server transaction |
| Supplier return | Return against source purchase line and exact source batch | Reject over-return, no clamp, no negative stock, never erase historical invoice/payment facts |

### FEFO

Allocation candidate order is:
1. exact medicine;
2. remaining quantity above zero;
3. expiry date on or after Asia/Jakarta business date;
4. earliest expiry;
5. earliest received timestamp;
6. stable batch ID as final deterministic tie-break.

Expired batches remain physically recorded but are not sellable allocations. The allocation helper first proves total eligible quantity is sufficient, then returns a complete plan without mutating source records. The SQL command must re-lock and revalidate rows inside the transaction before writing movements.

### HPP and supplier return

The helper reproduces the legacy weighted moving-average formula with exact integer-Rupiah calculations. This is a compatibility baseline, not a final accounting policy for freight, rebates, landed cost or multi-batch partial receipts.

Supplier-return validation requires the selected batch to be part of the original purchase receipt lineage. It checks both original purchase quantity remaining and physical batch balance; it never silently caps an excessive request. The helper leaves supplier credit note/refund/offset recognition as `OWNER_DECISION_REQUIRED` (D10), and does not fabricate historical partial supplier payments (D11).

### Open inventory policy gates

- **D01:** unit per medicine, fractional quantities and precision/rounding.
- **D05:** who certifies returned medicine as resalable and quarantine/re-entry timing.
- **D10/D11:** supplier return settlement and partial/multiple supplier payments.
- **D15:** opening-stock and HPP valuation evidence at cutover.
- **SOURCE GATE:** split receipt/batch cardinality, freight/discount/tax cost basis, invoice uniqueness, invalid/ambiguous expiry, legacy batch lineage.

No inventory DDL, stock migration or purchasing UI cutover is approved by this pass.

## 3. Patient and encounter domain

Target model keeps stable person identity separate from each visit:
- `patients`: stable identity; no fuzzy auto-merge using name or phone alone;
- `encounters`: each clinic visit with service status, operational date, original cashier/shift and lifecycle;
- `queue_tickets`: stable ticket attached to one encounter;
- `queue_call_events`: append-only call/recall/cancel-call event history;
- `patient_identity_links`: explicit source-document crosswalk for legacy IDs and unresolved matches.

The currently inspected legacy registration data has only name, optional phone, service, queue date/time, cashier and shift. It does not prove a longitudinal clinical-record module. This pass does not add NIK, demographics, diagnosis, prescription or medical notes by assumption.

Checkout must fail and roll back unless invoice patient and encounter patient are identical, encounter/cashier/shift ownership matches, and the shift is open. The executable ownership guard now covers this linkage.

### Queue

Target key candidate is `(business_date, prefix, sequence_no)`, generated under a server transaction with a unique constraint and idempotency key. Prefix and active-call rules are not decided by the helper.

Still open:
- **D16:** what A/B operationally mean; independent/global active-call exclusivity; transfer semantics; completion meaning.
- **SOURCE GATE:** retrieve deployed Functions/release source and exact A/B routing semantics; do not import a guessed implementation from PR13.
- **RUNTIME GATE:** simultaneous two-device registration/call/re-call, WIB midnight and retry tests against TiDB.

Confirmed presentation requirements remain: A/B views and switching, digit-by-digit spoken number (A-001 is “A, kosong, kosong, satu”), and voice recording customization separate from the notification chime. “Batal Berobat” and visit history remain recoverable; no destructive patient deletion.

No patient, encounter or queue DDL is approved by this pass.

## 4. Finance domain — separate subledgers and dates

Target write model separates:
- invoice/revenue and sale-time line/package snapshots;
- payment/settlement receipts (cash, QRIS, transfer, card);
- supplier payable, supplier credit and payment allocations;
- expense request, approval and actual disbursement;
- petty-cash movements and expense/reimbursement classification;
- shift opening float, cashier-drawer movements and close/verification;
- return approval, refund obligation and actual refund payout;
- inventory cost, HPP, loss and stock adjustment events.

Key compatibility boundaries:
1. `invoice.total` is the final amount charged after the existing package/discount logic; don't deduct the same discount twice.
2. Approved returns reduce recognized revenue by their approval/business date.
3. Refund cash outflow is dated by actual payout, not approval. An approved-but-unpaid refund is an obligation, not a cash payment.
4. Opening shift float is cash custody, never omzet or profit.
5. Supplier invoice payment settles an existing payable; it is not a second operating expense.
6. Inventory purchase is capitalized into inventory/HPP, not automatically expensed again when its supplier invoice is paid.
7. Preserve sale-time medicine, tariff, package-component, price, discount and HPP snapshots; current master edits must not reprice history.

Open owner gates: D08 expense/self-approval threshold and segregation; D09 petty-cash classification; D12 shift verification; D13 refund payout authorization/evidence; D14 non-cash settlement/recognition timing. D06 package refund allocation remains an explicit policy decision; the tested legacy largest-remainder behavior is compatibility evidence only.

No finance DDL or financial-data import is approved by this pass.

## 5. Cross-domain atomic commands (API contract candidates)

These boundaries guide the later endpoint implementation; paths are candidates and not yet live routes.

| Command | Required atomic work |
|---|---|
| Purchase receipt | Validate source purchase line; create receipt and batch; append receipt movement; update stock/HPP projections; create/adjust payable; write audit and idempotency result |
| Checkout | Validate active encounter and open cashier shift; compute lines from server-side catalog; lock medicine/batches; allocate FEFO; post invoice, batch movements, stock projection, patient completion and return quota together |
| Patient return request | Lock invoice-line return quota; reserve remaining quantity; snapshot original price/discount/HPP/batch deductions; no stock movement while pending |
| Return approval/disposition | Lock same invoice/quota and exact source batches; enforce D05 disposition; post reversal/return movement only when authorized; create refund obligation |
| Supplier return | Lock purchase line and original batch; validate remaining quantities; append negative movement; update stock/HPP projection; create credit/offset only under D10/D11 policy |
| Queue registration/call | Allocate unique date+prefix sequence and idempotency under server lock; append immutable call event; update current-call projection according to D16 policy |
| Refund payout | Verify final approval and evidence/method; write cash/bank ledger movement exactly once; update refund state |
| Shift close/verification | Lock shift and all linked cash movements; snapshot expected vs physical cash; enforce D12 authority and audit event |

Every command must derive actor, role, timestamp and amounts server-side; use optimistic version checks where appropriate; lock shared subjects in deterministic order; and write idempotency/audit records in the same transaction.

## 6. DDL and cutover gates remain closed

This pass does not close the remaining schema/operational gates:
- D01, D05–D16, D17–D20 policy/source decisions remain as recorded in the consolidated decision register;
- the FK type/action/index/parent-key/nullability manifest must be complete and proven against the exact TiDB runtime;
- deployed Firebase Functions source, deployed Firestore Rules and read-only Auth UID/profile export must be captured before identity migration;
- backup/export checksums, dry-run import, row counts, orphans, financial/inventory variance and restore drill must pass;
- role parity, two-device concurrency, authorization, protected identity and rollback tests must pass;
- explicit owner approval is required before production cutover.

The only live SQL schema remains the previously verified identity/audit/catalog foundation. No new migration file or runtime DDL was added in this pass.
