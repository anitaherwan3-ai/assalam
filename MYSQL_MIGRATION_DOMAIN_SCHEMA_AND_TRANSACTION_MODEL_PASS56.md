# Klinik Assalaam — Domain Schema and Transaction Model (Pass 56)

**Branch:** migration/tidb-foundation  
**Status:** logical schema, validators and command contracts; physical DDL is not approved or applied  
**Production authority:** Firebase remains active

## 1. Safety boundary

This package defines the relational model and command boundaries for:
- Medicine, batch, inventory movements, purchase receipts and supplier returns.
- Patient master, encounters, queue tickets, call events and display projection.
- Sales invoices, payment events, supplier payables/payments, refund obligations/payouts, cash and journals.
- Atomic transactions, rollback, concurrency and reconciliation.

Executable source is in:
- lib/clinic-domain-model.js
- lib/clinic-domain-contracts.js
- lib/clinic-domain-commands.js

There is deliberately no domain migration 004 registered in the active migration runner. No domain DDL was run, no operational data imported, and no Firebase, production, protected account, main branch or production deployment was changed.

## 2. Logical tables

Existing foundation tables are retained: users, role_assignments, active_role_slots, firebase_identities, audit_events, idempotency_requests, outbox_jobs, tariffs and suppliers.

### Inventory and purchasing

| Candidate table | Main fields | Critical invariants |
|---|---|---|
| medicines | public/legacy ID, name, canonical unit, approved quantity scale, price, minimum stock, active, version | Unit/precision is explicit per medicine; never accept stock/HPP from a master edit |
| purchase_invoices | supplier, supplier invoice number/date, total, status, source ID | Source identity and uniqueness require source verification |
| purchase_lines | invoice, medicine, ordered qty, received qty, unit cost, line total | Receipt never exceeds ordered qty; preserve original invoice facts |
| purchase_receipts | source line, receipt reference, business date, UTC time, qty, receipt value, actor | Idempotent; split receipt cardinality remains a source gate |
| medicine_batches | medicine, source receipt/line, batch no, expiry, received time, original qty, remaining qty, disposition, version | Never create a batch without receipt lineage; quantity bounds enforced |
| inventory_movements | medicine, batch, movement type/direction, positive qty, source, actor, reason, UTC time, reversal link | Append-only; correction is a linked reversal, not an overwrite |
| medicine_stock_projections | medicine, physical/sellable qty, HPP, version, projection time | Derived projection only; batch and movement ledgers remain the source |
| supplier_returns | source purchase line/batch, qty, reason, request/approval/dispatch status, evidence, settlement state | Request is stock-neutral; dispatch posts one negative movement |
| inventory_losses | batch, loss type, qty, HPP snapshot, approver/evidence, movement ID | Loss creates immutable movement |

Movement vocabulary: purchase_receipt, sale_issue, patient_return, supplier_return, loss, stocktake increase/decrease, opening_balance and reversal.

Quantities are calculated using string/BigInt-safe exact arithmetic. Physical SQL capacity for decimal precision does not decide whether a clinic may dispense fractional tablets/strips. D01 remains an owner policy gate.

FEFO order is expiry date, received UTC timestamp, then stable batch ID after filtering expired, empty or non-sellable batches. The command computes the complete allocation before writing. Insufficient quantity means no partial allocation. The final SQL adapter must re-lock and revalidate the batch rows before commit.

Purchase receipt is one transaction: receipt, batch, positive movement, stock/HPP projection, received quantity and payable upsert. Weighted-average HPP uses exact integer Rupiah arithmetic. Landed cost, split receipt source behavior and opening HPP evidence remain unresolved source/policy gates.

Supplier return is staged: request without stock effect, then dispatch only from an approved state. Dispatch records a negative movement and evidence; it does not rewrite historical invoices or invent a credit note/payment. D10 and D11 remain open.

### Patient, encounter and queue

| Candidate table | Main fields | Critical invariants |
|---|---|---|
| patients | stable ID, name, optional phone, active, version | No fuzzy auto-merge using name/phone |
| patient_identity_links | patient, source system/collection/document ID, link evidence/status | Preserve source IDs; quarantine ambiguous matches |
| encounters | patient, service, business date, registered/served time, cashier, shift, lifecycle | Every visit is distinct; invoice must match encounter/patient/cashier/shift |
| queue_prefix_policies | prefix, meaning/description, enabled, approval evidence, version | A/B mapping is not inferred |
| queue_counters | date, prefix, next sequence, version | Atomic unique sequence per business date/prefix |
| queue_tickets | encounter, date, prefix, sequence, public number, status | Unique, idempotent and history-preserving |
| queue_call_guards | scope and scope key, current ticket, version | Global or per-lane policy only after D16 |
| queue_call_events | ticket, call/recall/cancel event, actor, request ID, server time | Append-only event history |
| queue_display_config | display mode, running text, active prefix view, version | TV receives sanitized projection only |
| queue_audio_assets | object key, MIME, size, checksum, actor/time, version | MP3 bytes live in private object storage, not SQL |

Encounter registration uses server business date/time, locks an open shift owned by the authenticated cashier, creates or selects a stable patient ID, creates a new encounter, allocates a date/prefix sequence and creates its ticket in one transaction. It does not infer patient identity from name/phone.

Queue call events lock the configured active-call guard, validate the ticket/current call, append the event and update the current-call projection in the same transaction. Policy is read inside the transaction. Prefix creation fails closed without an approved prefix policy. D16 remains open for A/B meanings, global/per-lane exclusivity, transfers and completion semantics.

Preserve separate A/B TV views and switching, digit-by-digit voice announcement, and independent voice/chime configuration. TV data must not contain patient phone or clinical data. Batal Berobat keeps the visit and ticket history.

### Finance, payments, payables, refunds and cash

| Candidate table | Main fields | Critical invariants |
|---|---|---|
| sales_invoices | encounter, patient snapshot, cashier, shift, business date, total, status | Immutable; cancellation is a reversal, not deletion |
| sales_invoice_lines | sale-time name/unit/qty/price/discount/HPP/package snapshot | Current masters never re-price old notes |
| sales_batch_allocations | invoice line, medicine, batch, qty, HPP snapshot | Return uses exact original batch lineage |
| payment_events | invoice/source, method, amount, business date, settlement status/ref, actor/time | Payment is distinct from revenue recognition |
| supplier_payables | purchase invoice, original amount, recognized credit, outstanding | Legacy paid boolean is not a payment ledger |
| supplier_payments | payable, amount, method, paid/settled time, bank/cash ref, actor | Partial/multiple allocations gated by D11 |
| supplier_payment_allocations | payment, payable, allocated amount | Cannot exceed payment or payable |
| refund_obligations | original return, approved amount, outstanding, approver/time, status | Approval creates an obligation, not cash outflow |
| refund_payouts | obligation, amount, method, cash/bank account, payout date/evidence, Pimpinan | Separate, idempotent and Pimpinan-only |
| cash_accounts | cash drawer/bank identity, active, version | Cashier drawer, management cash and bank are separate |
| cash_ledger_entries | account, shift, direction, amount, source, dates, actor, reversal | Immutable; opening float is custody, not revenue |
| expense_requests | amount, category, requester, approver, status, evidence | D08 self-approval/threshold policy |
| petty_cash_events | account, classification, advance/reimbursement, amount, source, actor | D09 classification; prevent duplicate expense |
| journal_entries / journal_lines | date, source, actor, account, debit/credit | Posted journal must balance |
| accounting_periods | date range, open/closed, actor/time | Closed period rejects posting |
| shift_cash_closes | shift, opening float, expected/count cash, variance, verifier/evidence | D12 authority gate |

Compatibility rules:
- Invoice total already reflects legacy package/discount logic; never subtract discount twice.
- Approved returns adjust revenue on approval date.
- Refund payment reduces cash only on payout date; unpaid approved refunds remain obligations.
- Service return creates no inventory movement.
- Opening shift float is not omzet/profit.
- Supplier payment settles payable, not a second expense.
- Purchase enters inventory/HPP and is not expensed again when paid.
- Non-cash receipt follows D14; invoice method alone does not prove bank settlement.
- Reports aggregate posted events, not mutable browser state.

## 3. Atomic command contracts

| Command | Required locking/validation | Same-transaction writes |
|---|---|---|
| Create medicine | Approved unit/precision policy | Master + audit + idempotency |
| Purchase receipt | Purchase line, medicine and receipt policy | Receipt + batch + positive movement + stock/HPP projection + purchase line + payable upsert |
| Checkout | Active encounter/open shift; server-computed catalog/package/discount snapshot; medicine and FEFO batches | Invoice draft + allocations + negative movements + batch/stock projections + invoice posting + return quota + encounter completion |
| Supplier return request | Purchase line, source batch, return quota | Request only; no stock change |
| Supplier return dispatch | Approved request, line, batch and medicine | Batch decrement + negative movement + stock projection + dispatch evidence; no credit recognition pending D10/D11 |
| Encounter + ticket | Authenticated cashier/open shift, patient, approved prefix and counter | Optional patient + encounter + counter + ticket |
| Queue call | Approved policy, guard, ticket/current call | Event append + current-call projection |
| Payment event | Source and approved method policy | Payment event + applicable cash/bank event |
| Supplier payment | Payable and D11-approved policy | Payment + allocation + payable projection + cash/bank event |
| Refund payout | Approved obligation, D13 policy, Pimpinan | Payout + cash/bank outflow + obligation state |
| Journal post | Open period and balanced lines | Journal header + lines + audit/idempotency |

The command layer derives actor from verified server identity, uses idempotency and server-authored audit, and expects deterministic lock order. Checkout is one aggregate transaction: there is no separate stock-only sale command exposed by the domain command interface.

## 4. Executable coverage

Implemented command/validation contracts include:
- Medicine master validation blocks stock/HPP edits and requires explicit unit precision.
- Batch and movement provenance/direction validation.
- Purchase receipt with weighted HPP and supplier payable upsert boundary.
- Atomic checkout that computes sale snapshots server-side and writes invoice, FEFO allocations, movements, return quotas and encounter completion together.
- Supplier return request (no movement) and dispatch (negative movement only after approved state).
- Stable patient/encounter registration with atomic date/prefix counter and ticket.
- Queue call/recall/cancel with policy read inside the guard transaction.
- Balanced journals, payment method gate, supplier payment gate and Pimpinan refund payout gate.
- Inventory and finance reconciliation helpers.

The domain command layer uses a dependency-injected repository contract. SQL repository/API handlers and domain tables are not connected yet; do not wire operational UI buttons to these commands before the approved physical schema and real TiDB acceptance tests exist.

## 5. Policy/source gates remain closed

| Gate | Blocked behavior pending approval/evidence |
|---|---|
| D01 | Medicine unit, fractional quantity, precision/rounding |
| D05 | Returned medicine inspection, quarantine and resale |
| D06 | Package refund allocation; legacy largest-remainder is evidence only |
| D08 | Expense threshold and self-approval |
| D09 | Petty-cash classification/advances/reimbursements |
| D10 | Supplier credit note/refund/offset recognition |
| D11 | Partial/multiple supplier payments; no inference from old paid boolean |
| D12 | Shift verification roles/exceptions |
| D13 | Refund payout method, evidence and source cash/bank account |
| D14 | Non-cash settlement and recognition timing |
| D15 | Opening stock/HPP evidence |
| D16 | A/B prefix meaning, transfers and active-call policy |
| D17 | Malformed/missing historical timestamps |
| D18 | Clinical record retention/correction/legal hold |
| D19 | Audit retention/export/legal hold |
| D20 | Long-term auth/bootstrap/recovery |

Source evidence gates: deployed Firebase Functions source, deployed Firestore Rules snapshot, read-only Auth UID/profile exports, split receipt behavior, historic batch-lineage exceptions, and exact TiDB FK types/actions/parent keys/child indexes/runtime compatibility.

## 6. Acceptance matrix

Synthetic CI covers:
- Exact decimal quantities, integer Rupiah and per-medicine precision.
- FEFO deterministic allocation and all-or-nothing shortage.
- Weighted-average HPP.
- Supplier return source-batch matching and over-return prevention.
- Competing checkouts against the last batch; only one can commit.
- Same idempotency key returns original invoice without duplicate movement.
- Forced checkout/receipt failure rolls back invoice, batch, movement, projection, quota, audit and idempotency state.
- Concurrent encounter registration produces distinct encounters and unique date/prefix numbers.
- Concurrent queue calls serialize under an approved guard policy.
- Journal balance, refund obligations, supplier payable, cash and stock reconciliation.
- Unapproved non-cash, supplier payment, refund and queue policies fail closed.

Still required against real TiDB with two independent connections:
- SELECT FOR UPDATE, unique key and CAS conflicts on the exact serverless version.
- Restart/retry idempotency for purchase, checkout and refund.
- Failure injection after each persistent write in receipt, checkout, queue and finance commands.
- Checkout last-batch race, same-ticket re-call race, cancellation-vs-return race.
- Inventory reconciliation: medicine projection = batch sum plus approved adjustments; projection = opening events plus posted movement net.
- Payable reconciliation: original liability minus approved credits and allocated payments.
- Cash reconciliation per account/shift: opening + inflows − outflows vs counted cash.
- Financial reconciliation across invoices, approved returns, HPP, refund obligations/payouts and balanced journals.
- Two-device UI tests across protected roles.
- Backup, isolated restore, dry-run import and rollback drill.

## 7. DDL and deployment disposition

No domain migration is in the active runner and no domain DDL was executed. Current database remains the verified foundation only.

Vercel automatic deployments for migration/tidb-foundation remain paused in root vercel.json. Preview Deployments remain disabled on operational project klinikassalaam. GitHub Actions remains CI. Only after policy, source, FK and TiDB runtime gates close should one versioned domain migration be created, tested, wired to SQL commands, and deployed as one consolidated Preview build.

Firebase remains production source of truth until reconciliation, backup/restore, rollback and explicit owner cutover approval pass.
