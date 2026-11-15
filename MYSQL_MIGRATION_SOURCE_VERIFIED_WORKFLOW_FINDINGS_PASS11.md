# SOURCE-VERIFIED WORKFLOW FINDINGS — PASS 11
Tanggal: 2026-11-15  
Branch kerja: `migration/tidb-foundation`  
Status: **READ-ONLY STATIC SOURCE AUDIT — NOT RUNTIME TEST / NOT DDL**

## 1. Scope and source fingerprints

This pass inspects tracked application source to close selected Pass 10 source-verification gates. It does not access live Firestore records, Firebase Authentication, deployed Cloud Functions, TiDB application tables or production data.

Inspected source:
- `js/store.js` SHA `99e74acf8caec9c70d82be1d5f6efc5bfa6bc4fb` (553 lines).
- `js/app.js` SHA `f74c4710161ddd2af230e51c18b1f107d6c52c82`.
- `js/firebase-backend.js` SHA `3a613d96564f120b8141966f9ecbae21471c4e65` as recorded by the source crosswalk; selected backend paths were inspected for this pass.
- `MYSQL_MIGRATION_FOLLOWUP_SOURCE_VERIFICATION.md` and `MYSQL_MIGRATION_FIELD_CROSSWALK_AND_REPAIR_CANDIDATES_V0_1.md`.

The source baseline is static. A code path does not prove its live Firestore Rules, deployed Function, multi-device race behavior or historical data distribution.

## 2. Confirmed source facts

### 2.1 Medicine units and fractional quantities — PARTIALLY VERIFIED

The initial master data uses different units: Paracetamol and Amoxicillin use `strip`; Vitamin C uses `botol` (`js/store.js`, initial medicine fixtures). The purchase and FEFO functions convert requested quantity using `Number()`; FEFO then deducts `Math.min(remaining, batch.sisa)`. The inspected code does not establish a canonical per-medicine unit dictionary or an explicit integer-only/fractional validation policy.

**Decision:** preserve a unit attribute per medicine. Do not globally assume all medicines use strip, and do not globally approve fractional quantities. D01 remains an owner policy gate after a source/UI input audit establishes actual accepted increments. Server validation must enforce the eventual policy.

### 2.2 Purchase receipt creates one batch in the inspected local workflow — VERIFIED FOR THIS PATH ONLY

`ClinicStore.recordPurchase()` creates one purchase row and one batch row, links the batch to the purchase through `batch.beli = beliId`, and records `batchId` on the purchase. The inspected path therefore demonstrates one batch per purchase command. It does **not** prove that historical imports, manual edits, other clients or deployed cloud paths never split one purchase line into multiple lots.

**Decision:** do not add `supplier_invoice_line_batch_allocations` to v1 solely from speculation. Keep the one-batch-per-command model as the current minimum candidate, but do not freeze a UNIQUE constraint until other source paths and historical fixtures are checked. Partial/multiple receipt remains SOURCE VERIFICATION GATE, not owner policy by default.

### 2.3 Supplier return currently selects first linked batch and silently caps quantity — VERIFIED DEFECT

`ClinicStore.processReturBeli()` uses `find(b => b.beli === beli.id)`, so it selects only the first linked batch. It computes accepted quantity with `Math.min(requested, purchase qty, batch remaining, medicine stock)`; an over-limit request is silently reduced rather than rejected. It then decreases medicine stock and batch remaining, changes HPP, and changes unpaid purchase total/quantity.

**Target requirement:** require an explicit source batch (or a uniquely proven batch); reject a requested quantity exceeding any applicable available balance; never silently reduce the user's request. The return must link to the exact purchase line and batch, and its supplier/invoice ownership must be validated. HPP and payable changes must be ledger/reconciliation-driven and must not mutate historical invoice evidence.

### 2.4 FEFO date currently uses UTC date — VERIFIED

`ClinicStore.deductBatchFEFO()` compares batch expiry strings with `new Date().toISOString().slice(0,10)`, then sorts eligible batches by expiry. This is a UTC calendar date, not explicitly the clinic's Asia/Jakarta business date.

**Target requirement:** calculate the operational business date in Asia/Jakarta on the server and define expiry-day eligibility explicitly. Do not copy the local UTC date behavior into the new backend.

### 2.5 Sales return uses original invoice item index and cumulative quantity — VERIFIED

`ClinicStore.processReturJual()` checks invoice status, identifies the invoice item by `itemIndex`, sums prior non-rejected return quantities for that same transaction/item, rejects quantity above the sold line quantity, and computes a net refund amount from the original invoice with proportional discount allocation. For packages, it calculates batch restores from the original component `batchDeductions`; service-only components do not create stock restores.

This supports preserving immutable invoice line/component snapshots and a stable line/component-aware return subject. It does not prove the client-side check is concurrency-safe. Pending return requests are included in the local prior-quantity sum, but the server must perform atomic reservation/locking so two devices cannot reserve the same remaining quantity.

### 2.6 Local return approval differs from staged cloud policy — VERIFIED

`ClinicStore.approveReturJual()` allows either Admin or Pimpinan and immediately restores medicine/batch stock before marking the return approved. The source crosswalk / Firestore Rules audit records a staged cloud process: cashier submits, Admin forwards or rejects, Pimpinan makes final approval/rejection/payment. The local method is therefore not sufficient authority for the target lifecycle.

**Target requirement:** retain the staged separation of duties as the migration candidate: cashier submit; Admin review/forward or reject; Pimpinan final decision; payout recorded separately and exactly once. Stock restoration occurs only at the correct finalization stage after item disposition is validated. This is consistent with the explicit user preference for Admin verification and Pimpinan final authority. Do not reproduce the permissive local helper as the API authorization policy.

### 2.7 Weighted-average HPP is present in local purchase path — VERIFIED FORMULA, NOT FULL ACCOUNTING POLICY

`recordPurchase()` computes new HPP as `((old stock × old HPP) + purchase total) / (old stock + received quantity)`, rounded with `Math.round()`. The supplier-return path separately recomputes HPP after stock removal using its own formula.

**Target requirement:** preserve and formally test the intended weighted-average method, including return, loss, stocktake, opening balance and zero-stock edge cases. The observed local formula is evidence of current behavior, not proof that every historical HPP value is correct or that this is the final accounting policy for every adjustment.

### 2.8 Local audit log is capped — VERIFIED

`logActivity()` truncates local activity history after 1,000 entries. This is a local UI/storage behavior, not an acceptable retention rule for authoritative audit records. Target audit must be durable, paginated and retained by policy; it must not silently discard old events.

### 2.9 Local store seeds empty collections — VERIFIED BY FOLLOW-UP AUDIT

The follow-up source audit records that `ClinicStore.loadLocal()` repopulates selected collections (including medicines, batches, tariffs, users and packages) when arrays are empty. This is a demo convenience and must not be reused as MySQL production bootstrap behavior. An empty production table remains empty unless a separately authorized seed operation is run. Initial batches with `beli='init'` are seed provenance, not ordinary supplier receipts.

## 3. Identity and account mapping discrepancy — HIGH PRIORITY

The inspected Firebase adapter source contains older hard-coded identity assumptions:
- owner identity mapping includes `praktekrose@gmail.com` and `nursalim42@gmail.com`;
- staff provisioning defaults include `assalamadmin1@gmail.com`, `assalamkasir1@gmail.com`, and `assalamkasir2@gmail.com`;
- reset-password allowlist repeats those older addresses.

The current owner-confirmed protected account set for migration is different and supersedes those older source defaults:
1. Kasir Pagi — `assalamkasir1@gmail.com`
2. Kasir Sore — `assalamkasir2@gmail.com`
3. Admin — `assalamadmin@gmail.com`
4. Pimpinan — `praktekrose@gmail.com`
5. Akun kita — `nursalim422@gmail.com`

**Critical handling:** this is a source-code discrepancy to reconcile during the identity crosswalk, not authorization to modify Firebase/Auth or any account. Never infer UID mappings from email/name alone. Before any identity migration, verify all five UID/profile/role relationships read-only against the authoritative provider and protect those exact accounts. Do not bulk-seed, overwrite or clean them based on stale hard-coded source lists.

The Firebase adapter also resolves staff profiles by email-keyed `k_users` documents and injects the Auth UID into the client profile after lookup. The target API must instead verify the provider token and bind it to a stable immutable internal user identity server-side.

## 4. Pass 10 source-gate disposition

| Gate | Finding | Status |
|---|---|---|
| Medicine units/fractions | At least strip and bottle are used; no complete fractional policy proven | PARTIAL — D01 owner gate remains |
| Split supplier receipts | One batch per local purchase command observed; other paths/history not exhausted | PARTIAL — no allocation table yet; verify all paths |
| Batchless movement types | Opening/seed batches and other stocktake/adjustment cases need exact source inventory | OPEN |
| Invoice patient snapshot | Crosswalk observes invoice patient snapshot fields; precise semantics across all source paths not fully proven | OPEN |
| Queue lifecycle | Local queue and remote sequence paths need full concurrency/reissue verification | OPEN |
| Auth authority | Tracked repo source gap for Functions/bootstrap remains; stale hard-coded account defaults identified | BLOCKER |
| Legacy ID/timestamps | Generic ID and client `_t` observed; source-scoped identity and trusted timestamp normalization required | OPEN |
| Outbox provider | Extraction anomaly remains unverified | OPEN |

## 5. Corrections to schema design direction

1. Keep batch-to-medicine mandatory. Batch-to-purchase receipt is optional only for verified opening/seed/adjustment provenance.
2. Do not assume one purchase line always maps one-to-one to a batch merely because the local purchase method creates one batch per call.
3. Do not create a supplier allocation bridge until a real multi-batch/partial-receipt source path is demonstrated.
4. Return quota should use existing invoice line/component subject identity; do not create a second generic quota registry.
5. Separate return approval, stock disposition/restoration and refund payout; each effect must be idempotent and auditable.
6. Do not import local aggregate stock/HPP as independent truth without reconciling batches, purchase, sale, return, loss and stocktake history.
7. Use Asia/Jakarta business date for FEFO and reporting, not UTC date truncation.
8. Keep production bootstrap empty-by-default; no implicit demo seed.

## 6. Next exact work

1. Inspect all source callsites for purchase receipt, stocktake, loss, manual stock edits, supplier return, return approval and payout, including Firebase adapter command paths.
2. Verify whether purchase editing or historical imports can create multiple batches for one invoice line; collect synthetic fixtures only.
3. Complete medicine unit/input step validation across UI and API candidates; present a concise D01 policy choice only after source evidence is complete.
4. Build a single source-of-truth identity reconciliation sheet for the five protected accounts, with UID fields intentionally blank until verified through authorized read-only provider access.
5. Generate a minimal inventory movement type matrix (movement type, requires batch, source document, effect on medicine balance, effect on batch balance, reversibility).
6. Only after these source gates, produce the next exact FK tuple validation matrix and isolated TiDB test suite.

## 7. Safety and status

This pass is static source review only. No Firebase/Auth account, Firestore data/rules, Cloud Function, TiDB table/data, Vercel deployment, production environment, main branch or PR13 was changed. No runtime behavior is claimed as tested. Schema v1 remains **BLOCKED**.
