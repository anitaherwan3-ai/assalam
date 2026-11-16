# Cross-Domain Audit Closure and Schema v1 Readiness — Pass 25

**Scope:** synthesis of Passes 1–24 and current source-backed findings. This is a documentation-level readiness assessment, not DDL approval or migration authorization.

## Audit coverage closed for this planning wave
- Patient identity and visit continuity: Pass 20.
- Queue allocation, calling and TV display: Pass 21.
- Medicine, tariff and package master data: Pass 22.
- Supplier purchase, batch receipt, payable and supplier return: Pass 23.
- Settings, audit log, exports and backup/restore: Pass 24.
- Previously audited domains remain in scope: identity/access, stock ledger, returns/cancellations, cash/finance, reports/date handling, FK ownership and anti-overfitting.

## Cross-domain blockers before schema v1 can be approved
1. **Identity and access:** five protected account identities must be preserved; current hard-coded account references and missing durable staff UID binding remain unresolved. No account mutation is authorized.
2. **Patient/encounter/queue:** current queue row doubles as patient identity; target must separate master and encounter. A/B semantics, active-call policy, recall, completed-visit meaning and retention are owner decisions.
3. **Invoice ownership:** enforce invoice → encounter → patient and cashier → shift consistency server-side; reject missing/ineligible patient or encounter.
4. **Inventory:** preserve batch allocations and signed movements; direct stock edits must be replaced with controlled adjustment commands. Exact composite ownership FKs and reversal/idempotency still require reconciliation.
5. **Returns/cancellations/refunds:** retain quota, approval, stock restoration, cancellation conflict and payout separation. Package component/service refund semantics and exact owner policies remain open.
6. **Purchases/supplier:** current purchase is a local multi-entity mutation; target receipt must be atomic. Supplier identity, multi-line invoice, partial payments and paid-return credit settlement remain unresolved.
7. **Financial truth:** distinguish invoice revenue, approval-time returns, payout-time cash outflow, supplier payable/payment and shift cash custody. Expense vs petty cash classification/double counting and cash-account attribution need decisions.
8. **Reports/time:** standardize Asia/Jakarta business date and server timestamps; unify on-screen/export query semantics and historical vs snapshot reports.
9. **Audit/backup:** client logs are mutable/capped; JSON restore overwrites local state after shallow validation. Need append-only server audit, versioned backup, integrity verification and isolated restore drill.
10. **Master data:** medicine/tariff/package edits must not rewrite historical invoices; archive referenced masters, version package snapshots, and route stock changes through movements.

## Schema v1 design boundaries
- Keep one clinic tenant scope; do not add speculative multi-tenancy or generic event registries.
- Required relational core: users/role grants and identity mapping; patient master; encounters; queue lane/counter/call projection; shifts; invoices and immutable invoice lines; payments; medicines/tariffs/packages with sale-time snapshots; batches, stock movements and allocations; purchase receipts/lines; suppliers and supplier payment/credit records only to the extent confirmed; return requests/quota/events/refunds; cancellation records; expenses/petty cash; settings versions; audit events; migration crosswalk/quarantine.
- Promote conditional tables only when source evidence or explicit owner policy requires them. Avoid modeling clinical records not currently present in source until scope is confirmed.
- Preserve source IDs and raw payload/hash for controlled migration; old Firebase operational records were owner-classified as dummy/testing data, not genuine clinic history. Do not import them as real patient/stock/financial history. Synthetic fixtures are appropriate for isolated tests.
- Five protected accounts: `assalamkasir1@gmail.com`, `assalamkasir2@gmail.com`, `assalamadmin@gmail.com`, `praktekrose@gmail.com`, `nursalim422@gmail.com`. Never delete, disable, demote, replace UID/email, or overwrite their linked profile/role docs without explicit separate authorization.

## Required gates before DDL
1. Resolve owner policy decisions listed across Passes 10, 15, 16, 18, 20–24.
2. Reconcile complete field inventory and exact SQL type/signedness/charset/collation/null/default for every FK pair.
3. Finalize PK/FK/index/action manifest, including composite same-parent constraints and idempotency keys.
4. Validate TiDB-specific transaction, isolation, unique-key locking, FK and index behavior in the isolated preview.
5. Run synthetic cross-module tests and concurrency/failure-injection tests.
6. Build deterministic migration crosswalk and quarantine rules; no automatic fuzzy patient merge.
7. Test backup/restore and rollback; verify protected account mapping read-only.
8. Obtain owner approval for schema v1 and migration plan.

## Test matrix
- Patient repeat visit, duplicate suggestion, cancellation/reactivation, invoice encounter ownership.
- A/B concurrent registration and call; TV cross-device updates and stale-cache rejection.
- Master edit/archive and historical invoice/package snapshots.
- Purchase receipt atomicity, weighted HPP, batch allocation, supplier returns and settlement.
- Refund/return/cancellation, shift close and financial reconciliation.
- Role/resource authorization, immutable audit, exports, backup/restore.
- TiDB FK/index/locking and concurrent idempotent commands.

## Readiness verdict
**Audit wave 20–25 is documented; schema v1 is NOT approved and NOT ready for production DDL or migration.** Several owner policy gates and source/schema reconciliation gates remain open. The next phase should be a consolidated decision register and field/FK manifest closure, then isolated TiDB compatibility tests—not a production deployment.

## Safety statement
No application source was edited. No schema DDL, live Firebase/Auth read or write, patient data extraction, import, cleanup, deployment, merge to `main`, PR13 merge or production operation was performed. These reports are static source audits and design synthesis only.
