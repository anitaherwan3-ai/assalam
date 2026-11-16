# Clinic Domain Relational Model & Transaction Contract — Pass 56

**Branch:** migration/tidb-foundation  
**Status:** logical model + tested command contracts; physical DDL intentionally not registered or executed  
**Production source of truth:** Firebase  
**Latest CI:** 89/89 tests passed (synthetic/unit layer; TiDB runtime tests are still a separate gate)

## 1. Safety and scope

This pass defines a unified domain model and atomic command boundaries for medicine, batches, inventory movements, purchasing, supplier returns, patients, encounters, queue, finance, payments, payables, refunds, cash and reconciliation.

Executable validations and dependency-injected commands are present in:
- lib/clinic-domain-model.js
- lib/clinic-domain-contracts.js
- lib/clinic-domain-commands.js

No domain SQL migration has been registered with the migration runner. No domain DDL was run, no operational records were imported, no Firebase/Auth data or protected accounts were changed, and no production code or deployment was changed. The SQL repository adapter and UI route integration remain blocked until the physical schema and policy gates are closed.

## 2. Logical relational model

Existing foundation tables remain: users, role_assignments, active_role_slots, firebase_identities, audit_events, idempotency_requests, outbox_jobs, tariffs and suppliers.

### A. Medicine / purchase / batch / inventory

| Candidate table | Core fields | Invariants |
|---|---|---|
| medicines | public ID, legacy ID, name, canonical unit, approved quantity scale, sell price, minimum stock, active, version | Unit and precision are explicit per medicine; browser cannot overwrite stock/HPP |
| purchase_invoices | supplier, invoice number/date, total, payment-term snapshot, source ID, status | Unique identity within supplier only after source rule verification |
| purchase_lines | invoice, medicine, ordered quantity, received quantity, original unit cost, line total, version | Received quantity cannot exceed ordered quantity; invoice-time values are immutable |
| purchase_receipts | purchase line, receipt reference, receipt/business date, quantity, receipt value, actor | Idempotent retry; split-receipt cardinality must be verified from source |
| medicine_batches | medicine, source receipt/line, batch number, expiry, received timestamp, original quantity, remaining quantity, disposition, version | No batch without purchase-receipt lineage; balance cannot be negative or exceed original quantity |
| inventory_movements | medicine, batch, movement type/direction, positive quantity, source, actor, reason, time, reversal reference | Append-only; correction uses a linked reversal, never a direct stock edit |
| medicine_stock_projections | medicine, physical/sellable quantity, HPP projection, version, projection timestamp | Derived from batch/movement ledger; not an independent source of truth |
| supplier_returns | purchase line, batch, requested quantity, reason, approval/dispatch state, evidence, settlement state | Must point to original batch; request does not move stock; dispatch posts negative movement |
| inventory_losses | batch, loss type, quantity, HPP snapshot, approver, evidence, movement ID | Loss creates immutable negative movement and cannot double-reduce sale HPP |

Movement types supported by the model: purchase receipt, sale issue, patient return, supplier return, loss, stocktake increase/decrease, opening balance and reversal.

Quantity arithmetic is exact and string/BigInt based. The physical SQL precision must support the explicitly approved per-medicine scale. Database capacity for decimals is not permission to dispense fractional tablets or strips. D01 remains an owner gate.

FEFO command order is expiry date, received UTC timestamp and stable batch ID, after filtering non-sellable/expired/empty batches. It calculates a full allocation before writing; insufficient quantity means no partial movement. Batch rows are revalidated and decremented in the same transaction.

Purchase receipt writes receipt, batch, positive movement, stock/HPP projection and received quantity on purchase line together. Weighted moving-average HPP is calculated using exact integer Rupiah arithmetic. Freight, rebate, tax, opening HPP evidence and source split-receipt behavior remain open source/policy gates.

Supplier return is staged: create request without stock effect, then dispatch only after an approved state. Dispatch posts negative movement and does not rewrite historical invoice/payment totals or recognize a supplier credit. Credit note/refund/offset accounting remains D10/D11.

### B. Patient / encounter / queue / display

| Candidate table | Core fields | Invariants |
|---|---|---|
| patients | stable ID, name, optional phone, active, timestamps, version | Name/phone suggestions are not automatic identity matching |
| patient_identity_links | patient ID, source system/collection/document ID, link status/evidence | Preserve legacy identity; quarantine ambiguous links |
| encounters | patient, service, business date, registered/served times, original cashier/shift, lifecycle, version | Each visit is separate; invoice must reference matching patient/encounter/cashier/shift |
| queue_prefix_policies | prefix, description/meaning, enabled, version, approval evidence | A/B prefix cannot be activated until operational meaning is approved |
| queue_counters | business date, prefix, next sequence, version | Unique by date+prefix; allocation is atomic/idempotent |
| queue_tickets | encounter, date, prefix, sequence, public number, status | Number unique per date/prefix; retries return same ticket |
| queue_call_guards | guard scope/key, current ticket, version | Global or per-lane guard only after D16 policy approval |
| queue_call_events | ticket, call/recall/cancel-call event, actor, request ID, server time | Append-only event history |
| queue_display_config | display mode, running text, active prefix view, version | TV receives sanitized projection only |
| queue_audio_assets | object key, MIME, byte count, checksum, version, actor/time, active | Audio bytes are in private object storage, not SQL |

Encounter registration gets business date and timestamp from the server, locks an open shift owned by the authenticated cashier, creates or selects a stable patient identity, creates one encounter, allocates a date+prefix sequence and creates one queue ticket in a single transaction. It does not fuzzy-match patients.

Queue call/recall/cancel locks the configured guard, checks current call, appends an event and updates the current-call projection within one transaction. The active-call policy is read inside that transaction. Queue prefix activation fails closed unless a prefix policy is approved. D16 remains open for A/B meaning, active-call exclusivity, transfer and completion semantics.

Preserve A/B display switching, digit-by-digit spoken queue number and independent voice/chime customization. TV payload cannot expose patient phone or clinical data. “Batal Berobat” preserves visit and ticket history.

### C. Finance / payments / payables / refund / cash

| Candidate table | Core fields | Invariants |
|---|---|---|
| sales_invoices | encounter, patient snapshot, cashier, shift, business date, total, status, source ID | Immutable invoice; cancellation is reversal, not deletion |
| sales_invoice_lines | sale-time name/unit/quantity/price/discount/HPP and package snapshot | Master edits never reprice history |
| sales_batch_allocations | invoice line, medicine, batch, allocated quantity, HPP snapshot | Allocations sum to sold quantity; return follows original lineage |
| payment_events | source invoice, method, amount, business date, settlement status/reference, actor/time | Payment and settlement are separate from revenue recognition |
| supplier_payables | purchase invoice, original amount, recognized credit, outstanding amount, status | Legacy paid boolean is not a payment ledger |
| supplier_payments | payable, amount, method, paid/settled time, cash/bank reference, actor | Partial/multiple allocation remains D11; no fabricated history |
| supplier_payment_allocations | payment, payable, allocated amount | Allocation cannot exceed payment or payable balance |
| refund_obligations | original return, approved amount, outstanding amount, approval actor/time, status | Approval creates obligation, not cash outflow |
| refund_payouts | obligation, amount, method, cash/bank account, payout date, evidence, Pimpinan | Payout separate, idempotent and Pimpinan-only |
| cash_accounts | cash drawer/bank identity, currency, active, version | Cashier drawer, management cash and bank are separate |
| cash_ledger_entries | account, shift, direction, amount, source, event/business date, actor, reversal | Immutable; opening float is custody, not revenue |
| expense_requests | amount, category, requester, approver, status, evidence | Self-approval and threshold policy D08 |
| petty_cash_events | account, category, advance/reimbursement, amount, source, actor, reversal | D09 classification; avoid duplicate expense |
| journal_entries / journal_lines | business date, source, actor, account, debit/credit | Every posted journal must balance |
| accounting_periods | date range, state, closed by/at | No posting into a closed period |
| shift_cash_closes | shift, opening float, expected/count cash, variance, verifier/evidence | Verification authority D12 |

Compatibility rules:
- Invoice total is already after existing package/discount logic; do not subtract the discount twice.
- Approved returns reduce revenue on approval/business date.
- Refund outflow uses actual payout date; an unpaid refund remains an obligation.
- Service returns create no stock movement.
- Opening shift float never enters omzet or operating profit.
- Supplier payment settles payable and is not a second expense.
- Purchase is inventory/HPP, not a second expense when paid.
- Non-cash receipt must follow D14 settlement rules; QRIS/transfer invoice alone is not bank settlement.
- Reports come from posted events, not browser cache.

## 3. Atomic command boundaries

| Command | Locks and validates | Writes committed together |
|---|---|---|
| Create medicine | Approved unit/precision policy | Medicine master + audit + idempotency |
| Purchase receipt | Purchase line, medicine and receipt policy | Receipt + batch + positive movement + stock/HPP projection + purchase line + payable upsert |
| Sale issue/checkout stock | Invoice/encounter/shift, medicine and FEFO batch candidates | Batch allocations + negative sale movements + batch/stock projections; final checkout must include invoice completion and return quota in the same aggregate transaction |
| Supplier return request | Purchase line, source batch and remaining quantity | Request only; no movement |
| Supplier return dispatch | Approved request, purchase line, batch, medicine | Batch decrement + negative movement + stock projection + dispatch evidence; no supplier credit recognition until D10/D11 |
| Encounter + queue ticket | Authenticated cashier/open shift, patient, approved prefix and counter | Optional patient + encounter + counter allocation + ticket |
| Queue call/recall/cancel | Approved policy, guard, ticket and current call | Append event + current-call projection |
| Payment event | Source invoice/payable + approved method policy | Payment event + relevant cash/bank event |
| Supplier payment | Payable and D11-approved policy | Payment + allocation + payable projection + cash/bank event |
| Refund payout | Approved obligation + D13 policy + Pimpinan | Payout + cash/bank outflow + obligation state |
| Journal post | Open period + balanced lines | Journal header + lines + audit/idempotency |

All commands derive actor from verified server identity, use idempotency and server-authored audit, and must use a deterministic row-lock order. Any failure before commit must leave no partial inventory, encounter, queue, payment, cash or journal side effect.

## 4. Executable source status

The command layer currently covers medicine validation, batch validation, movement validation, purchase receipt, weighted HPP, FEFO issue, supplier return request/dispatch, encounter/ticket registration, queue call events, balanced journal validation/posting, payment event, supplier payment and refund payout gates.

The command layer uses an injected repository contract. The production SQL adapter/API routes and database tables are not yet connected; this is intentional until physical schema/FK/runtime approval. Do not expose new operational UI actions to these commands until the TiDB repository exists and runtime tests pass.

## 5. Owner and source gates still blocking physical DDL or full posting

| Gate | Blocked action |
|---|---|
| D01 | Activate a medicine unit and fractional precision policy |
| D05 | Restore returned medicine to sellable stock before inspection/quarantine policy |
| D06 | Finalize package discount/refund allocation; legacy largest-remainder is compatibility evidence only |
| D08 | Expense self-approval and threshold policy |
| D09 | Petty-cash categories, advances/reimbursement and expense recognition |
| D10 | Recognize supplier credit note/refund/offset |
| D11 | Enable partial/multiple supplier payments; never convert legacy paid boolean |
| D12 | Approve shift-close authority and exceptions |
| D13 | Finalize refund payout method, evidence and cash/bank source |
| D14 | Non-cash settlement and recognition dates |
| D15 | Opening stock/HPP valuation evidence |
| D16 | A/B prefix meaning, transfer and global/per-lane call rule |
| D17 | Malformed/missing legacy timestamps |
| D18 | Clinical record retention, correction and legal hold |
| D19 | Audit retention/export/legal hold |
| D20 | Long-term auth/bootstrap/recovery strategy |

Source evidence gates: deployed Firebase Functions release source, deployed Firestore Rules snapshot, read-only Auth UID/profile exports, split receipt cardinality, historical batch lineage exceptions, exact TiDB FK types/actions/parent keys/child indexes and runtime compatibility.

## 6. Test and reconciliation matrix

### Synthetic CI layer
- Exact quantity scale and integer Rupiah safety.
- Deterministic FEFO and no partial allocation on shortage.
- Weighted-average HPP with integer and explicit fractional quantity scale.
- Supplier return follows purchase batch and rejects over-return.
- Two concurrent issues competing for one batch cannot create negative stock.
- Idempotent retry returns original response without a second movement.
- Injected mid-command failure rolls back batch, stock projection, movement, audit and idempotency completion.
- Simultaneous encounter registration returns distinct patient/encounter and unique queue sequences.
- Concurrent call events serialize under configured guard policy.
- Journal debit/credit totals balance.
- Non-cash, supplier-payment and refund policies fail closed until approved.
- Prefix and active-call policy must be explicitly approved.

### Real TiDB Preview gates (not yet claimed as passed)
- Two independent connections with overlapping transactions using SELECT FOR UPDATE, unique-key conflict and CAS/version conflict.
- Duplicate/retried receipt and stock issue under process restart.
- Rollback injection at receipt, batch, movement, projection, payable, encounter, counter, ticket, payment and journal writes.
- Two checkouts competing for final batch; simultaneous calls; cancellation-vs-return.
- Inventory reconciliation: medicine physical projection = batch remaining sum plus explicitly approved adjustments; stock projection = opening/reconciliation events + posted movement net.
- Payable reconciliation: source invoice/receipt amount − recognized credits − allocated supplier payments = outstanding.
- Cash reconciliation per account/shift: opening float + inflows − outflows = expected balance; compare with physical count and variance.
- Financial reconciliation: active invoices − approved returns; HPP and returned HPP; refund obligations vs actual payouts; all journals balanced.
- Two-device role tests for Kasir 1, Kasir 2, Admin and Pimpinan.
- Backup, isolated restore, dry-run import, orphan/duplicate report and rollback drill.

## 7. DDL and deployment disposition

No migration 004 is in the active migration runner and no physical domain DDL was executed. The current active schema remains the previously verified foundation only.

The Vercel migration branch auto-deployment remains paused in vercel.json; Preview Deployments are disabled on the operational klinikassalaam project. GitHub Actions remains the CI runner. When policy, source, FK and runtime gates close, create one versioned domain migration, test against isolated TiDB, implement the SQL adapter, complete the real TiDB acceptance matrix, then remove the Vercel branch pause for one consolidated Preview deployment.

Firebase remains production source of truth until data reconciliation, backup/restore, rollback and explicit owner cutover approval all pass.
