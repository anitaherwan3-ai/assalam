# Legacy Inventory & Return Behavioral Contract — Pass 48

**Branch:** `migration/tidb-foundation`  
**Source examined:** `js/store.js` legacy implementation  
**Automated evidence:** `tests/legacy-store-characterization.test.js` (9 tests)  
**CI:** GitHub Actions run #29 — 53 total tests, 53 passed, 0 failed  
**Scope:** synthetic in-process characterization of the legacy browser store; not a Firebase/Firestore server E2E test and not production-data validation.

## Behaviors captured

| Domain | Current source behavior | TiDB replacement requirement |
|---|---|---|
| Batch FEFO | Select positive, unexpired batches ordered by expiry; return no partial deductions if eligible quantity is insufficient | Preserve FEFO with database row locks, atomic batch + aggregate projection updates, and idempotency |
| Purchase receipt | Weighted moving-average HPP: round((old stock × old HPP + purchase total) / resulting stock); creates one batch and links it to the purchase invoice | Reproduce valuation using integer Rupiah rules and an atomic purchase/header/line/batch/movement/HPP command |
| Sales return | Pending request records invoice line and historical batch deductions; stock is restored only on approval | Keep staged workflow and immutable invoice snapshots; lock return quota and original batch lineage |
| Return quantity | Pending and approved non-rejected requests consume cumulative quantity quota; over-return is rejected | Enforce at server/database boundary under concurrent requests, not only in UI |
| Service return | Service/treatment can be returned without a stock movement | Return amount follows original invoice valuation; eligibility and delivered-service rules remain owner policy |
| Supplier return | Uses the invoice-linked batch, reduces stock, and recalculates HPP; paid invoice historical total remains unchanged; unpaid balance is reduced | Preserve paid invoice history; create separate supplier credit/settlement events and reconcile HPP/stock ledgers |
| Supplier over-return | Legacy helper clamps requested quantity with `Math.min` rather than rejecting the request | **Do not reproduce this defect.** Reject any request above invoice outstanding quantity, matching batch remaining, and available stock |

## Source-level caveats

1. The local helper's date comparison uses the browser's UTC ISO date. The relational design requires explicit Asia/Jakarta business dates and UTC server timestamps; this timezone behavior must not be copied unexamined.
2. Legacy `recordPurchase` creates one batch per call. The UI and source evidence still need to establish whether one supplier invoice may be received in multiple batches/shipments.
3. Supplier return selects the first batch linked to a purchase. This is insufficient if one purchase line can span several batches; the TiDB design must use explicit purchase-line-to-batch allocation.
4. Historical HPP and current aggregate stock can diverge from reconstructed batch valuation. Cutover must reconcile them and quarantine unexplained differences; never fabricate an opening batch.
5. These characterization tests run the legacy local store code with mocked browser globals. They do not replace tests of Firestore Cloud Functions, deployed rules, multi-device listeners, or role-specific E2E flows.

## Next domain work

- Close the D01 owner decision for medicine base unit, packaging conversions, fractional dispensing, and rounding before freezing medicine/stock DDL.
- Close purchase split-receipt cardinality and supplier credit/payment policy.
- Implement the TiDB inventory service as a transactional ledger command, then test FEFO/weighted HPP/purchase return under concurrency.
- Keep the production app on Firebase until all role/device parity and reconciliation evidence exists.
