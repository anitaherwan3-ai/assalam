# Schema v1 Finalization Addendum — Pass 61

**Date:** 2026-11-17  
**Branch:** `migration/tidb-foundation`  
**Base commit:** `fabd594494611cc278047f943a8507645a1f985b`  
**Purpose:** Supersedes unresolved owner-policy rows in earlier schema audits where the owner has now made an explicit decision. This is a logical-schema and policy-finalization record, **not permission to run DDL or cut over production**.

## 1. Owner decisions incorporated

| Domain | Final rule for v1 |
|---|---|
| Medicine units (D01) | Canonical whole units: tablet, kapsul, botol, pcs. Quantity is integer. Any legacy strip/box/carton conversion must be evidenced per medicine; no inferred conversion. |
| Patient medicine return (D05) | Cashier submits; Admin reviews; Pimpinan approval is required. Approved returned quantity enters quarantine. It becomes sellable only after Admin records a passing physical inspection and release. Rejected, damaged, opened, expired or untraceable items remain non-sellable with disposition reason. |
| Service discount (D06) | Discount is per service line/item. Persist gross, discount and net values at checkout. Partial return reverses the original line snapshot; no package-wide discount allocation. |
| Expense (D08–D09) | All expenses are entered/processed by Admin and require Pimpinan approval. Admin cannot self-approve. Remove cash advances, cash-bon and advance settlement workflows. Each expense needs date, amount, category, evidence and audit trail. |
| Supplier return (D10) | Return request has no stock effect. Approved dispatch posts one negative movement against the original batch. For an already-paid invoice, record supplier receivable/credit; keep Pending until evidenced refund or offset is actually received. |
| Supplier payments (D11) | Multiple and partial payments are supported. Each payment records date, amount and evidence. Allocations cannot exceed payment or remaining payable. Invoice is Lunas only when fully paid. |
| Shift close (D12) | Kasir 1 and Kasir 2 close their own shifts; Admin verifies cashier shifts. Pimpinan verifies Admin shift. Preserve opening float, expected cash, counted cash, variance reason, verifier and timestamps. |
| Refund payout (D13) | Pimpinan approves refund obligation. Approval is not payment. Report wording when transferred: “sudah ditransfer Rp X ke rekening”. Do not require bank account number/name, destination account, method or transfer reference as mandatory data. |
| Non-cash payment (D14) | Non-cash payment remains in review/pending state and is not recognized as income until Pimpinan reviews and approves it. Preserve the separate settlement/reconciliation facts; approval must not fabricate bank/provider settlement. |
| Stocktake/HPP (D15) | Stock opname every first day of the month; Admin counts, Pimpinan approves. Traceable batch and expiry with unknown HPP remains recorded and may be sold, but its profit is excluded/marked uncalculated until HPP is verified. Unknown batch origin or expiry is quarantined and non-sellable. Expired/damaged stock awaits Pimpinan disposition. Existing Firebase operational dataset is dummy/testing data; production opening stock comes from a new approved physical count. |
| Queue (D16) | Kasir 1 owns lane A; Kasir 2 owns lane B. A cashier may hand over a patient/ticket to another cashier/shift with a mandatory reason. Admin may assist with transfers. Pimpinan has full authority. Every queue transaction and movement is audited with actor, time, before/after state and reason where applicable. |
| Audit retention (D19) | Minimum one year; retain longer when law, accounting/tax requirements, dispute, investigation or legal hold requires it. Never auto-delete under legal hold. |
| Authentication (D20) | New system uses Better Auth backed by TiDB, not Firebase Authentication. No public self-registration. Pimpinan can register/create users, assign app roles, change identity, disable/reactivate and initiate secure reset/invitation. Passwords are newly set; Firebase passwords are not migrated. |

## 2. Canonical schema boundaries

### Identity and authentication
- Better Auth owns authentication credentials and sessions in dedicated tables: `auth_users`, `auth_sessions`, `auth_accounts`, `auth_verifications` (or exact equivalent names generated from the pinned Better Auth schema).
- Application `users` remains the clinic's internal actor/profile record and links one-to-one to the Better Auth user ID using a unique, non-null link after account activation.
- `role_assignments` and `active_role_slots` remain the server-owned application authorization source. The role names are `pimpinan`, `admin`, and `kasir`; UI visibility is never authorization.
- Pimpinan-only account management is implemented in application server endpoints with explicit role checks and audit. Do not grant clinic Admin the Better Auth platform-admin capability merely because the role is named Admin.
- `firebase_identities` is legacy migration/crosswalk evidence only. It is not consulted for new-system login. Do not copy Firebase passwords or trust browser-supplied UID/role.
- Existing five protected email identities remain reserved; role of `nursalim422@gmail.com` must be verified, not guessed. No identity merge/rebind without explicit approval.

### Core domain tables
The logical v1 model includes the following aggregates; physical names and FK definitions must be generated only after the canonical FK/type/index manifest is reconciled:

1. **Clinic identity/config:** clinic settings/version, users, role assignments, active role slots, auth tables.
2. **Catalog:** medicines, tariffs/services, packages and immutable package/service-line price snapshots.
3. **Patients/visits:** patients, patient identity links, encounters, encounter status history.
4. **Queue:** lane policy, counters, tickets, transfer/handover events, call events, active-call guards, display configuration and audio asset metadata.
5. **Shifts/cash:** shifts, shift close events, verification/variance events, cash accounts and cash ledger entries.
6. **Purchasing:** suppliers, purchase invoices, purchase lines, receipts, medicine batches, supplier payments and payment allocations.
7. **Inventory:** stock movements, batch allocations, stock projections, stocktake sessions/count lines/approvals, quarantines and inventory losses.
8. **Sales:** sales invoices, immutable invoice lines, batch allocations, payment events and non-cash review/approval events.
9. **Returns/refunds:** patient return requests, return line reservations/quotas, Admin review, Pimpinan approval, quarantine inspection/release, refund obligations and payout events.
10. **Supplier returns/credits:** supplier return requests, approved dispatch, supplier receivables/credits, settlement evidence and settlement events.
11. **Finance:** expenses and approvals, balanced journal entries/lines, accounting periods and report projections.
12. **Platform controls:** append-only audit events, idempotency requests, transactional outbox, migration crosswalk/quarantine and schema migration ledger.

## 3. Required invariants for the SQL repository

- Every write command derives actor and role from the verified server session; browser payload cannot assert actor, role, user ID, HPP, stock balance, approval or payment status.
- Each business command writes its domain event, audit event and idempotency result in the same database transaction.
- Audit events are append-only; corrections are compensating events, not edits/deletes.
- Queue transfer requires a reason and is one atomic state transition with an audit event. Lane ownership and Pimpinan/Admin override are checked inside the transaction.
- Invoice lines preserve the original service price/discount/net and medicine batch/HPP snapshots. Later master edits cannot change historical invoice/return calculations.
- Stock balance is a projection from immutable movements and batch allocations. Never update stock without a corresponding movement.
- HPP unknown is a first-class state; never substitute zero or selling price. Such lines may be sold only when batch and expiry are traceable; profit is marked uncalculated.
- Unknown batch origin/expiry is quarantined and cannot be sold or allocated by FEFO.
- Supplier-return receivable remains Pending until a recorded, evidenced refund or offset; age alone does not close it.
- Supplier invoice status is derived from allocated payments versus total payable, not a legacy boolean.
- Non-cash revenue is recognized only after Pimpinan approval; bank/provider settlement remains a separate reconciliation state.
- Refund approval and refund payout are separate states/events; Pimpinan approval does not mark payout paid.
- Cash advances/cash-bon do not exist in the v1 expense workflow.
- Shift verification authority is enforced server-side: Admin for cashier shifts, Pimpinan for Admin shift.
- Every mutation, approval, transfer, cancellation, return, payment, stock movement, shift close, verification, account/role change and override is audited with actor, server timestamp, request ID, entity, before/after state and reason where applicable.
- Money uses integer Rupiah. SQL BIGINT values are transported as strings/BigInt-safe values; never coerce arbitrary BIGINT to JavaScript Number.
- Clinic business dates use Asia/Jakarta; event timestamps are stored in UTC.
- FK constraints default to RESTRICT; every nullable/composite FK and polymorphic ownership rule must be explicitly tested.

## 4. Remaining engineering gates — not owner policy blockers

1. Complete the canonical table/column dictionary and integrate all composite parent UNIQUE keys and child indexes from the latest FK manifest.
2. Reconcile any remaining legacy source cardinality gates (notably purchase receipt to batch and source IDs); use quarantine instead of fabricated links.
3. Pin a Better Auth version and generate/inspect its exact MySQL schema; test TiDB compatibility before registering the auth migration.
4. Implement Pimpinan-only user registration/role-management endpoints, invitation/password setup, recovery and session revocation. Verify emergency recovery without allowing Admin self-promotion.
5. Read-only check the actual TiDB preview version, `foreign_key_checks`, SQL mode, charset and collation. No application DDL until supported baseline is confirmed.
6. Run disposable-schema compatibility tests: FK enforcement, composite keys, NULL semantics, rollback, row locks, concurrent checkout/queue allocation, BIGINT transport, JSON, index metadata and EXPLAIN.
7. Build and test SQL repositories and API endpoints for each aggregate; domain command contracts alone are not an operational backend.
8. Run full synthetic regression and two-connection concurrency tests. Then backup/restore drill and explicit production readiness review.

## 5. Safe rollout decision

- Firebase/Firestore remains untouched and is not the new-system login provider.
- Existing Firebase operational records are dummy/testing data and are not automatically migrated as production history.
- Production deployment, operational DDL, new production user seeding and cutover are separate approvals after all gates pass.
- Production branch `main`, current production users and running clinic app remain untouched.
- The migration branch deployment pause remains in place until one consolidated preview is genuinely ready.

**Verdict:** Owner policy is sufficiently finalized for the v1 logical model. Physical DDL and production cutover remain blocked only by the engineering gates listed above; do not describe the database or authentication migration as completed.
