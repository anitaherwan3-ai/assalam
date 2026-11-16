# Klinik Assalaam — Parallel TiDB Migration Execution Roadmap (Pass 47)

**Branch:** `migration/tidb-foundation`  
**Target:** TiDB Cloud + isolated Vercel preview  
**Production source of truth:** Firebase until the final, explicitly approved cutover  
**Status:** execution control document; not approval for full schema DDL or production cutover

## Safety rules

1. Do not edit or deploy the production `main` branch as part of migration work.
2. Do not merge PR13 or replace the production app wholesale.
3. Preserve the five protected accounts: `assalamkasir1@gmail.com`, `assalamkasir2@gmail.com`, `assalamadmin@gmail.com`, `praktekrose@gmail.com`, and `nursalim422@gmail.com`. Do not infer the fifth account's role.
4. Keep all existing Firebase data and production authentication unchanged until backup, import reconciliation, restore and rollback evidence pass.
5. A domain may be migrated to TiDB only when its full write paths, authorization, UI callsites, concurrency and historical snapshot behavior are covered. No mixed writer for a domain.
6. Never create real patient/clinical data as a test fixture. Use synthetic fixtures and separately classified legacy data.
7. A successful connection, health check or foundation test is not evidence that the clinic is ready to cut over.

## Parallel workstreams

| Workstream | Scope | Can proceed in parallel with | Dependency / exit evidence |
|---|---|---|---|
| A. Source and feature contract | Map each Firestore collection/config path, Firebase backend method, UI callsite, role, and state transition | B, C, D, E, F | One-to-one traceability matrix; no unmapped writes or role-only UI assumptions |
| B. Policy and schema closure | Resolve owner gates D01–D20, patient/history and queue decisions; close exact types, FK tuples/actions, indexes and uniqueness | A, C, D, E, F | One approved schema v1; unresolved policy is quarantined, not guessed |
| C. Identity and access | Protected accounts, immutable user IDs, roles, email history, token/revocation, recovery and bootstrap | A, B, G | Role matrix tests and account mapping evidence with no account mutation |
| D. Medication, batch and purchasing | Medicine/unit rules, batch/expiry, stock movement ledger, weighted-average HPP, purchases, supplier returns/payables | A, B, C, E | Atomic service tests for FEFO, stock/HPP, split receipt, supplier return and concurrency |
| E. Patient, encounter and queue | Patient identity/history, registration, Batal Berobat, queue A/B, display, audio settings and cross-device updates | A, B, C | Role-based E2E and queue sequence/uniqueness tests |
| F. POS, shift and finance | Immutable invoice snapshots, package pricing, cash/non-cash, opening float, expenses, petty cash, shift close/verification, return/refund/cancellation, reports | A, B, C, D | Financial reconciliation tests, approval state machines, inventory/cash ledger invariants |
| G. Extraction and import | Versioned export, raw archive/checksum, normalizer, quarantine report, idempotent import, resume and reconciliation | A, B, C | Repeatable dry-run with counts/checksums/totals, orphan/duplicate report and no unexplained differences |
| H. Application cutover and operations | UI feature flags, preview E2E, monitoring, backup/restore, rollback and final switch | C–G | Signed go/no-go checklist; production cutover and rollback rehearsed |

## Current verified foundation

- Isolated preview branch and TiDB connection are in place.
- Only the foundation migrations have been applied: identity, audit/idempotency/outbox, tariff and supplier masters.
- The preview catalog API exists, but production and the existing application modules are not yet switched to it.
- The current foundation build does not enable automatic schema migrations on subsequent preview builds.
- Firebase remains the source of truth. No operational import or production cutover has occurred.

## Domain execution order

1. Finish source contract and role/write-path audit while policy/schema closure continues.
2. Complete identity/account mapping and catalog masters.
3. Build and verify medicine masters, unit conversion, batch ledger, purchasing, supplier returns and payable settlement as one inventory domain.
4. Build patient, encounter, registration and queue domain.
5. Build POS/package snapshots, shift/cash, petty cash, expenses, approvals, returns/refunds/cancellations and reporting.
6. Integrate UI domain-by-domain. A migrated domain reads and writes TiDB only after parity; do not dual-write the same business command to Firebase and TiDB.
7. Build the extraction/import toolchain and run synthetic plus classified legacy dry-runs in parallel with module work.
8. Perform full role/device regression, backup/restore and rollback rehearsals.
9. Freeze Firebase writes for the cutover window, capture final delta, import, reconcile, then switch production routing only after owner approval.
10. Keep the Firebase export and rollback path intact through the agreed observation period; retire Firebase only after stable operation and explicit approval.

## Mandatory cutover gates

The machine-readable file `config/tidb-cutover-gates.json` is fail-closed. It requires evidence for:
- owner policy closure and explicit schema v1 approval;
- full TiDB DDL/runtime compatibility;
- source inventory closure and verified export/backup;
- dry-run import/reconciliation;
- feature parity across every role;
- concurrency/multi-device validation;
- security/authorization validation;
- tested backup restore and rollback;
- explicit production cutover approval with an approver, UTC timestamp and change reference.

Run `npm run cutover:check` to evaluate the manifest. It intentionally exits non-zero while any required gate remains open. The checked-in manifest is blocked and does not permit production cutover.

## Known owner-policy gates — no silent assumptions

- D01: medicine canonical unit, fractional quantities and rounding.
- D05: returned medicine inspection, quarantine and stock re-entry.
- D06: package discount/refund allocation and rounding.
- D07: service/fee return eligibility and partial return conditions.
- D08: expense self-approval and thresholds.
- D09: petty cash categories, advances/reimbursements and expense recognition.
- D10: supplier credit note/refund/offset evidence and recognition.
- D11: split/partial/multiple supplier payments.
- D12: shift verification roles and exception authority.
- D13: refund payout methods, evidence and cash/bank source.
- D14: non-cash revenue recognition for pending/failed/settled instruments.
- D15: opening stock and HPP valuation evidence at cutover.
- D16: operational meaning of A/B queue lanes, concurrency and transfer/override.
- D17: malformed/missing legacy timestamp handling.
- D18: patient/clinical retention, correction, deletion and legal hold.
- D19: audit retention/export/legal hold.
- D20: long-term identity provider, provisioning and recovery strategy.

D02–D04 and source-derived integrity rules must remain governed by the existing traceability/quarantine notes; never fabricate patient identity, invoice history or batch lineage to make an import pass.

## Rollback principle

Before writes are routed to TiDB, rollback means returning routing to Firebase. After TiDB accepts production writes, rollback requires a tested reverse/delta reconciliation plan; simply pointing the UI back at Firebase would lose new transactions. Do not claim rollback readiness until this is rehearsed.
