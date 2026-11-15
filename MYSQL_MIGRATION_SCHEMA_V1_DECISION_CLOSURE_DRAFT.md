# SCHEMA V1 DECISION CLOSURE — TECHNICAL AMENDMENTS AND OWNER GATES

Date: 2026-11-15  
Branch: `migration/tidb-foundation`  
Status: **DESIGN AMENDMENT DRAFT — NOT DDL, NOT OWNER SIGN-OFF**

## 1. Purpose and safety boundary

This pass converts recurring schema-review findings into concrete implementation candidates, while separating decisions already supported by clinic instructions from decisions that still require owner/accounting/clinical policy.

- Work only on `migration/tidb-foundation` and isolated `assalam-mysql-preview`.
- Do not touch `main`, production Vercel, production Firebase, or PR #13.
- No application DDL is authorized by this document.
- No live Firebase snapshot, data import, cleanup, or account mutation is performed here.
- Old Firebase operational records are owner-confirmed development dummy data. They are test evidence/fixtures only, not real patient or financial history to migrate.
- Five account emails are protected exactly as listed in section 3.

## 2. Technical decisions that can be fixed without inventing clinic policy

### T01 — One canonical user key

**Candidate resolution:** use `user_id VARCHAR(64)` as the immutable internal identity key in every user/actor FK. Do not use email, display name, or Firebase UID as the relational PK. Store Firebase UID as a provider identity mapping with a unique constraint scoped to provider.

Reason: the proposal already uses VARCHAR(64) in `users`; the alternative CHAR(36) creates inconsistent FK types. Freeze only after checking every user-reference column in the column dictionary.

### T02 — One clinic role scope

**Candidate resolution:** schema v1 is for one clinic, Klinik Assalaam Palembang. Use a single clinic scope and make `active_role_slots.user_id` the single active role slot for this clinic. Reject unsupported scope values at the API boundary. If multi-clinic tenancy is later required, introduce a versioned migration with composite slot key; do not half-support it in v1.

This follows the current single-clinic deployment context; it is not permission to add other clinics.

### T03 — Explicit system/import actor

**Candidate resolution:** do not use NULL or a fake staff account to represent system actions. Add an actor discriminator (for example `actor_kind = human|system|import|unknown_legacy`) to event/audit records where actor provenance matters. Human actors reference `users.user_id`; system/import actors use a documented service principal identifier; unknown legacy actors remain explicitly unknown and cannot be attributed to a staff user.

For new commands, human actor is mandatory unless the command is explicitly system-owned. For imported dummy fixtures, actor may be synthetic and clearly marked. No old actor is mapped to a real person based on display name.

### T04 — Source-scoped legacy IDs

**Resolution:** remove every global UNIQUE constraint on a bare `legacy_id` where the source may contain collection-scoped IDs. Canonical uniqueness belongs in `migration_source_records(source_system, source_collection, source_document_id)`. A target table may retain a non-unique legacy ID for traceability. Do not merge two entities merely because their legacy IDs or names match.

### T05 — Queue prefix assignment serialization

**Resolution:** add `queue_prefix_guards(prefix PRIMARY KEY, version, updated_at_utc)` with pre-created guard rows for A and B. An assignment command locks the user row and all affected prefix guard rows in sorted prefix order, checks interval overlap, then writes the assignment and append-only assignment event in one transaction. This closes cross-user races that locking only a user cannot prevent.

Queue A and B are distinct operational queues. The display may switch between A and B views; cashier selection of queue mode is allowed as previously instructed. The exact UI/default display mode remains a presentation setting, not a database integrity rule. PR #13 remains unmerged; adopt only the independently approved behaviors after regression review.

### T06 — Queue counter first-use

**Resolution:** implement an atomic insert-if-absent + duplicate-key retry + locking read algorithm for `(business_date,prefix)`, or pre-create both daily counter rows through a serialized day-initialization command. Do not rely on SELECT FOR UPDATE of a missing row. Ticket insert, counter increment, encounter association, idempotency result and audit event commit in one transaction. A cancelled sequence remains consumed; never recycle a displayed number.

If ticket reissue for one encounter is needed, create a new ticket linked to the prior ticket; do not overwrite/reuse the consumed sequence. This is a safe technical default and still requires workflow acceptance tests.

### T07 — Return quota event ledger

**Resolution:** add append-only `sales_return_quota_events` with quota subject, return line, event type (reserve/release/approve/consume/reversal), quantity delta, actor provenance, occurred_at_utc, idempotency key and reference to the return event. Each reservation/release is uniquely tied to one return line and transition. The aggregate quota counters are projections, updated in the same transaction and rebuildable from events. Rejection/withdrawal releases exactly once; final approval consumes only eligible quantity; retry cannot reserve/release twice.

### T08 — Permanent financial/stock idempotency

**Resolution:** invoice creation, stock movement, return submission, refund payout, supplier payment, cancellation/reversal and queue-ticket allocation require durable domain-level command/event IDs. Generic idempotency rows must not expire while replay could create a second financial, stock or queue effect. If technical request logs are purged, permanent domain uniqueness remains.

### T09 — Composite parent-child integrity

**Resolution:** where a child must refer to multiple values belonging to the same parent, use a composite parent UNIQUE key plus a composite FK, not separate independent FKs. Apply at minimum:
- shift + cashier for encounter, invoice, petty cash and active shift slot;
- invoice + patient/encounter consistency;
- receipt line + medicine for batch and supplier return;
- batch + medicine for movements, losses, stocktake and invoice allocations;
- invoice line + invoice for discount allocations;
- invoice component + invoice line for package allocations and return quotas;
- quota subject + invoice line + component for return lines;
- supplier payment + supplier and supplier invoice + supplier for payment allocations;
- supplier return + invoice for credit notes.

All tuples need exact matching SQL types, order, signedness, nullability, child index and ON DELETE/UPDATE policy in the final manifest. A nullable composite tuple must be either fully NULL or fully non-NULL; partial NULL is rejected by the service and negative tests.

### T10 — Projection ownership

**Resolution:** `medicines.stock_on_hand`, `inventory_batches.remaining_quantity`, supplier credit aggregates, refund paid aggregates and shift cash summaries are projections, never browser inputs or independent ledgers. Each projection must declare:
- the append-only source events;
- the single command/service allowed to update it;
- row lock/version strategy;
- deterministic rebuild query;
- reconciliation invariant and alert threshold.

No repair by directly patching a projection without identifying the source event.

## 3. Protected account identity policy

The owner confirmed the following exact five email identities must survive all future reset, seed, restore, migration and cleanup operations:

| Role/name | Protected email |
|---|---|
| Kasir Pagi | `assalamkasir1@gmail.com` |
| Kasir Sore | `assalamkasir2@gmail.com` |
| Admin | `assalamadmin@gmail.com` |
| Pimpinan | `praktekrose@gmail.com` |
| Akun kita | `nursalim422@gmail.com` |

Protection must cover provider account identity and linked application user/profile/role. Before any identity operation, verify actual provider UID + normalized email + mapped user_id + role through read-only inspection. If any mismatch exists, stop for owner review. Never replace identity by matching display name.

The email list is the current owner-approved whitelist and supersedes older email references in historical static audit documents for future cleanup logic. This does not establish that all five accounts have already been provisioned in Firebase or TiDB; live verification remains pending.

## 4. Explicit owner/business gates still open

These cannot be safely inferred from the code or schema and remain blockers to freezing schema/workflows:

| Gate | Required owner decision/evidence | Safe interim behavior |
|---|---|---|
| D01 medicine base unit/fraction | Per-medicine base unit, fraction allowed, conversion and rounding | Keep quantities exact; reject unsupported fractions |
| D05 returned medicine condition | Who confirms unopened/resalable vs quarantine | Returned stock remains quarantined; no sellable stock restoration until approved |
| D06 package discount return allocation | Owner-approved allocation and rounding for component refunds | Preserve original line/component snapshots and exact charged amount; block ambiguous partial component return |
| D07 service/fee refund | Eligibility, partial service refund and approval matrix | Require separate return line and approval; no stock movement |
| D08 expense self-approval | Role/threshold and separation of duties | Block self-approval unless explicitly authorized by a policy |
| D09 petty cash classification | Expense vs advance/transfer/reimbursement mapping | Separate cash movement from expense recognition |
| D10 supplier credit recognition | Evidence and event that accepts supplier credit | Keep credit pending; do not reduce payable before acceptance |
| D11 supplier partial payments | Allocation and evidence requirements | Record only evidenced payment allocations |
| D12 shift verifier | Admin/Pimpinan authority and exceptions | Keep verification role-gated; no self-verification |
| D13 refund payout | Payout authority, method, proof/reference | Approval creates obligation only; payout is a separate verified command |
| D14 non-cash revenue date | Recognition point for pending/failed/settled payments | Keep tender and settlement separate |
| D15 opening stock/HPP | Signed opening quantity/value evidence | Do not create opening stock or HPP from guesses |
| D16 queue display/assignment | Confirm A/B assignment overrides and default display mode | Preserve separate A/B queues and cashier selection; PR13 remains unmerged |
| D17 timestamp source mapping | Source-specific timezone/epoch/string rules | Preserve raw timestamp; quarantine ambiguous dates |
| D18 patient retention | Retention duration, legal hold, archive/search behavior | No hard deletion; use Batal Berobat lifecycle |
| D19 audit retention | Retention/export/legal hold period | Append-only; no routine deletion |
| D20 authentication provenance | Recover deployed Cloud Functions source, token claims, IAM/service account and approve provider | Firebase Auth remains temporary candidate; no auth cutover |

### Additional blocker: split/partial supplier receipt

The current one-batch-per-receipt-line model is not approved until clinic workflow confirms whether one purchase line can arrive in multiple deliveries, expiry lots or batch numbers. If yes or uncertain, use `supplier_invoice_line_batch_allocations` from schema v1. Do not force operational reality into one batch per line.

### Additional blocker: invoice and ticket uniqueness

Freeze invoice-number scope only after verifying current numbering semantics. Queue ticket uniqueness should be `(business_date,prefix,sequence_no)`; encounter-to-current-ticket cardinality and reissue lifecycle need acceptance tests before adding a hard UNIQUE on encounter_id.

## 5. Exact type/index manifest required next

Before generating DDL, produce one row per FK with:
- child table/columns and exact SQL type, signedness, length/precision, charset/collation, nullable/default;
- parent table/columns and exact type, PK/UNIQUE definition;
- child supporting index (column order);
- composite tuple null semantics;
- ON DELETE and ON UPDATE action;
- same-parent invariant;
- TiDB compatibility test ID and result;
- API negative-test ID for constraints not enforceable in SQL.

The manifest must include every table/column from the final proposal, not only examples. Any unclassified FK or missing child index blocks DDL.

## 6. TiDB compatibility gate

The existing `api/db-compatibility.js` is a source-reviewed test harness only. It has NOT been deployed or run against the cluster. It currently covers metadata, FK/RESTRICT, nullable composite unique, BIGINT string round-trip, DECIMAL, commit/rollback, EXPLAIN, conditional concurrent stock decrement, row-lock waiting and cleanup.

Before running it:
1. Confirm isolated preview deployment is from `migration/tidb-foundation`.
2. Set a new high-entropy `COMPATIBILITY_TEST_TOKEN` only in Preview env; never reuse DB/Firebase secrets.
3. Confirm missing token returns 503 and wrong token returns 401.
4. Run once during a controlled window and save sanitized JSON results (no host/user/secret).
5. Verify every synthetic table is dropped; if cleanup is uncertain, stop all schema work.
6. Rotate/remove the test token after the run.
7. Extend the spike for any unsupported behavior discovered; do not call the suite a pass if one test failed or was skipped.

Vercel deployment quota was previously exhausted. Do not retry deployments merely to check availability; batch the complete reviewed package and deploy only when ready.

## 7. Test fixture plan — synthetic only

Once schema v1 is approved and created in preview, seed a deterministic isolated fixture set:
- five protected identity fixtures with non-production provider identifiers and explicit test-only markers (never copy live credentials);
- Kasir Pagi/A and Kasir Sore/B;
- one Admin and two Pimpinan test roles mapped to the protected identity model without changing real auth accounts;
- two patient records and encounters;
- queue A and B tickets including cancellation/reissue;
- two medicines with multiple expiry batches and weighted-average purchase receipts;
- one tariff and one package with medicine + service components;
- one invoice with discount largest-remainder allocation and mixed tender;
- one return request with reserve/reject/re-submit/approve/payout states;
- one cancellation race fixture;
- supplier partial receipt/split-lot scenario if supported;
- petty cash, approved expense, loss and two shifts (opening float excluded from omzet);
- duplicate/replay, orphan, wrong-parent, last-stock race, lock timeout and rollback cases.

Fixture IDs must be deterministic, names clearly synthetic, dates fixed in fixture configuration, and every run idempotent. Seed must refuse to run against production by environment/branch/database guard.

## 8. Current status

- Technical amendments T01–T10: proposed, not yet applied to canonical schema proposal.
- Five protected account emails: owner-confirmed; actual UID/profile/role verification pending.
- Old Firebase operational data dummy classification: owner-confirmed; no snapshot or cleanup performed.
- D01–D20: unresolved gates listed above; do not invent policy.
- Split receipt behavior: unresolved.
- Exact FK/type/index manifest: not complete.
- TiDB compatibility: source harness reviewed and Node syntax checked previously; runtime test NOT performed.
- Application DDL/schema v1: NOT CREATED.
- Synthetic application fixtures: NOT seeded.
- Production Firebase/Vercel/main/PR #13: unchanged.

## 9. Acceptance criteria for the next pass

1. Apply T01–T10 to the canonical proposal without contradicting existing business behavior.
2. Build complete exact FK/type/index manifest and reconcile every table/column against the column dictionary.
3. Resolve split supplier receipt, D01 and remaining owner decisions or keep affected domains blocked.
4. Extend source-level tests for queue guards/counter initialization, quota events, composite same-parent constraints and actor provenance.
5. Re-run static review and Node syntax check in isolated sandbox.
6. Do not create application DDL until the owner policy gates and actual TiDB compatibility spike are closed.
