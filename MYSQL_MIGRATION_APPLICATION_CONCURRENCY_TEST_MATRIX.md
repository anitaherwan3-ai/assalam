# APPLICATION CONCURRENCY AND IDEMPOTENCY TEST MATRIX
Date: 2026-11-15
Status: design/test-plan only. No application schema DDL or business API implementation is authorized by this document.

## Principles
- TiDB is distributed; do not rely on MySQL gap-lock behavior or auto-increment ordering.
- Every state-changing command must have a stable idempotency key and append-only audit event.
- Use explicit guard/counter rows, conditional updates, unique constraints and transactions.
- Lock rows in a deterministic order to reduce deadlocks; retry only recognized retryable transaction conflicts with bounded attempts.
- Re-read authoritative state inside the transaction. Never trust client totals, stock deltas, role, shift status or approval status.
- Each test uses synthetic fixtures and two or more independent database connections.

## Test matrix

| ID | Concurrent workflow | Race to simulate | Required invariant / expected result |
|---|---|---|---|
| CC-01 | Open cashier shift | Two requests from same cashier at once | Exactly one active shift; unique active-shift slot or guarded counter prevents second open shift |
| CC-02 | Open different cashier shifts | Kasir 1 and Kasir 2 open together | Both succeed independently; no cross-cashier slot collision |
| CC-03 | Queue number allocation | Two registrations request same queue/day concurrently | Unique sequential allocation; no duplicate ticket; A/B counters isolated; no gapless promise |
| CC-04 | Queue allocation retry | Client times out after commit and repeats same key | Same queue ticket returned; no second patient/queue record |
| CC-05 | Last stock unit checkout | Two cashiers buy same final batch unit concurrently | At most one checkout succeeds; stock never negative; loser receives conflict/insufficient stock |
| CC-06 | FEFO checkout | Two checkouts compete across multiple batches | Server chooses eligible earliest-expiry batch under lock; no stale client batch allocation |
| CC-07 | Shift close vs checkout | Close shift races with new invoice | One serializable business outcome; no invoice accepted into a closed shift and no close totals omitting a committed invoice |
| CC-08 | Duplicate invoice submit | Same cashier repeats checkout after network timeout | One invoice and one inventory/cash ledger effect; same idempotent response |
| CC-09 | Return quota reservation | Two return requests compete for remaining quantity | Cumulative approved + reserved return quantity never exceeds original sold quantity |
| CC-10 | Duplicate return line | Same item component submitted twice concurrently | Unique quota subject / reservation guard prevents over-return |
| CC-11 | Return vs cancellation | Return submit and invoice cancellation race | Only one path reserves invoice state; incompatible operation rejected consistently |
| CC-12 | Return approval vs rejection | Two reviewers decide same pending request concurrently | First valid transition wins; second sees terminal state and cannot overwrite history |
| CC-13 | Refund payout replay | Same approved refund payout retried | Unique payout idempotency key prevents duplicate cash/bank outflow |
| CC-14 | Refund payout vs approval | Payout arrives before approval or twice | Payout requires approved refund; separate payout ledger row; no approval-as-payment shortcut |
| CC-15 | Purchase receiving vs supplier return | Concurrent receive/return same invoice line/batch | Received and returned quantities remain bounded; stock and supplier payable reconcile |
| CC-16 | Expense approval vs edit | Submitter edits while approver approves | Approval applies to exact immutable submitted version; stale edit rejected |
| CC-17 | Petty cash vs shift close | Petty cash posting races with close | Ledger cutoff and shift close agree; no uncounted cash movement after close |
| CC-18 | Role suspension vs command | Admin suspended while request is in flight | Authorization checked at transaction boundary or policy-defined token/session version; suspended user cannot continue new writes |
| CC-19 | Email claim race | Two users claim same normalized email | Exactly one active claim; unique constraint decides winner atomically |
| CC-20 | Restore/import vs owner protection | Seed/restore contains owner deletion/demotion | Restore rejects protected owner mutation; operational audit and owner UID preserved |
| CC-21 | Concurrent stock adjustment | Two adjustments target same batch | Version/lock guard prevents lost update; adjustment ledger reconciles to on-hand |
| CC-22 | Reversal replay | Same reversal command sent multiple times | One reversal event and one ledger compensation only |

## Test harness requirements
- Two independent mysql2 connections (not one shared connection) for each true race.
- Barrier/latch so competing transactions start at controlled points.
- Record request key, actor, transaction start/commit outcome, affected row count, final state and ledger totals.
- Assert both business rows and append-only event rows; verify no orphan child rows.
- Inject a simulated network timeout after commit, then replay the same idempotency key.
- Run a bounded deadlock/write-conflict retry test; ensure retries do not duplicate side effects.
- Capture TiDB version, isolation mode, SQL mode, session timezone and EXPLAIN for relevant indexes.
- Cleanup synthetic fixtures and report cleanup failure explicitly.

## Release gates
- No DDL until schema review and TiDB compatibility probes pass.
- No business API implementation until identity authority and role matrix are approved.
- No production data until backup/restore rehearsal, privacy review, least-privilege DB credentials and owner approval.
- A test is PASS only when executed against the actual TiDB cluster and its evidence is retained; source-level assertions are not runtime passes.
