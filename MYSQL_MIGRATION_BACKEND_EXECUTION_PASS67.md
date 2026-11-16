# Backend execution status — Pass 67

Date: 2026-11-17  
Branch: `migration/tidb-foundation`  
Latest CI run: https://github.com/anitaherwan3-ai/assalam/actions/runs/43969379551

## Verified in source and CI

- 177 Node tests passed; 0 failed.
- TiDB repositories and API slices now cover purchase receipts, batch/HPP, FEFO checkout, per-service-line discounts, patient return quota, Admin review, Pimpinan return approval, quarantine, separate refund approval/transfer, supplier return dispatch/credit, supplier partial payments, non-cash review, expenses, journal entries, stocktake and shift reconciliation.
- Stocktake is monthly on day 1, requires complete positive-balance batch coverage, and records batch version snapshots to reject stale counts.
- Quarantine release requires latest Admin inspection decision = release, Pimpinan approval, verified origin and expiry, and a final Admin release action. Disposal requires a separate Pimpinan approval and Admin execution.
- Supplier return dispatch records its dispatch reference and creates a pending receivable/offset credit note. It remains pending until evidence-backed settlement is implemented.
- Refund transfer does not require destination account number/name, payment method or transfer reference. The record captures amount, transfer actor and timestamp, and uses the clinic wording “sudah ditransfer Rp X ke rekening”.
- TiDB session and catalog endpoints now require Better Auth cookies. The browser TiDB adapter no longer sends Firebase bearer tokens. Firebase-based preview owner bootstrap is disabled and its helper removed. Public Better Auth signup remains disabled pending a Pimpinan-controlled invitation/provisioning workflow.

## Live TiDB preview execution

Migrations `001` through `013` were applied to the isolated TiDB preview during Pass 66. The rollback-only repository smoke test successfully exercised purchase receipt, FEFO checkout, return approvals/quarantine release, refund transfer, non-cash payment review, expense approval, supplier partial payment, supplier return dispatch/credit, journal posting and monthly stocktake.

The smoke test then reached shift close and failed because the database status column rejected the value `closed_pending_verification` as too long. This was corrected to the schema-compatible `pending_verification` value in both the repository and tests. CI passes after the correction, but the corrected end-to-end smoke has **not yet been rerun against TiDB**.

The smoke transaction rolled back after the failure; no synthetic operational rows were committed. Schema migrations are DDL and remain applied to the isolated preview.

## Deployment and production safety

- Vercel deployment API reported its daily deployment limit (>100 deployments/day). No further deployment was attempted after that response.
- The migration preview project is paused again; `TIDB_MIGRATIONS_ENABLED=false` and the one-time confirmation is disabled.
- The obsolete Firebase preview-owner bootstrap flag is false.
- Production branch `main` remains at `2c26a769a95a84c06974e249d318498fde8eb7d1`.
- The production deployment target remains the same pre-migration commit. No production DDL, data import, Firebase Auth removal or cutover occurred.

## Remaining gates

1. Rerun the corrected rollback-only repository smoke test against TiDB after the Vercel deployment limit resets.
2. Implement Pimpinan-only Better Auth invitation/user provisioning, role assignment, identity changes, disable/reactivate, secure reset and primary-owner recovery. Do not enable public self-registration.
3. Add authenticated integration/concurrency tests for two database connections, then backup/restore rehearsal.
4. Integrate the new APIs and Better Auth login UI into the application only after these gates pass.
5. Production cutover remains blocked until explicit owner approval.
