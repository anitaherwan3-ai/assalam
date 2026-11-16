# Schema v1 Decision Register & Closure — Pass 26

**Date:** 2026-11-16  
**Branch:** `migration/tidb-foundation`  
**Status:** CONSOLIDATION / DECISION REGISTER — NOT DDL APPROVAL

## 1. Purpose and safety boundary

Pass 26 consolidates the policy and engineering gates recorded through Passes 1–25. Its purpose is to prevent repeated audits, contradictory schema drafts, invented defaults, and unnecessary owner questions.

This is a documentation-only pass. No application source, database schema, Firebase/Auth data, production deployment, or user account was changed. No DDL or runtime test is claimed.

## 2. Decision classification

- **CONFIRMED** — explicitly required by the clinic owner or established operating instructions.
- **ENGINEERING CLOSURE** — implementation detail can be resolved from source evidence and integrity principles without asking the owner to choose technical internals.
- **SOURCE GATE** — must be proven from the exact source path, fixtures, deployed configuration, or isolated tests before freeze.
- **OWNER GATE** — clinic, financial, clinical, authorization, or retention policy remains unresolved; do not silently assume.
- **DEFERRED** — not required for the first release unless evidence proves otherwise.

## 3. Confirmed requirements already known — do not ask again

1. Clinic display identity remains fixed as **Klinik Assalaam Palembang**.
2. Preserve the five protected accounts exactly:
   - Kasir Pagi: `assalamkasir1@gmail.com`
   - Kasir Sore: `assalamkasir2@gmail.com`
   - Admin: `assalamadmin@gmail.com`
   - Pimpinan: `praktekrose@gmail.com`
   - Akun kita: `nursalim422@gmail.com` (role must not be inferred).
3. Never delete, disable, demote, replace UID/email, or overwrite the linked profile/role documents for those accounts without separate explicit approval.
4. Keep Firebase and production unchanged until migration, reconciliation, backup/restore and cutover are separately accepted.
5. All old Firebase operational dataset was described by the owner as dummy/testing data, not genuine production patient/stock/financial history. Do not import it as genuine operational history by default; keep account identities protected.
6. Preserve all previously working clinic workflows and historical links. No blind source replacement.
7. Opening shift float is cash custody, not omzet.
8. Return requests must be traceable to the original invoice/item/component and original charged amount; service/fee returns do not create stock movements.
9. Existing return approval intent: cashier submits, Admin reviews/forwards or rejects, Pimpinan final approval; payout is separate from approval and recorded as “uang kembali”. No stock restoration before valid approval/disposition.
10. Prevent duplicate/over-return; a submitted return must reserve remaining eligible quantity until rejected/released or completed.
11. Queue display should support separate A/B views and switching; cashier selection of queue mode is an existing stated requirement. Spoken number should be digit-by-digit (e.g. A-001: “A, kosong, kosong, satu”); customizable voice and chime remain separate. MP3 enhancement is deferred/pending, not a migration blocker.
12. “Batal Berobat” is preferred for visits cancelled without treatment rather than deleting history or silently archiving it as an ordinary visit.
13. Keep Firebase rollback/archive until cutover is accepted.
14. No production DDL, bulk account changes, destructive cleanup, or main-branch merge is authorized by this audit.

## 4. Engineering closures — no owner decision required

| ID / area | Closure for target design | Guardrail |
|---|---|---|
| Patient / encounter | Separate stable patient master from each visit/encounter. | No fuzzy auto-merge; preserve legacy visit IDs; quarantine ambiguous links. |
| Invoice ownership | New invoice must reference a valid encounter; patient snapshot must match encounter patient; cashier and shift must match. | Reject and rollback on missing/mismatched patient, encounter, cashier or shift. |
| Queue numbering | Use server-owned counter/guard row and unique key by business date + lane + sequence; allocate atomically and idempotently. | Does not decide meaning of A/B or concurrent active-call policy. |
| Queue call state | Separate current-call projection from immutable call attempts/events. | Enforce concurrency on server; BroadcastChannel is only a local display optimization. |
| Historical master values | Invoice line preserves sale-time name/type/unit/qty/price/discount/HPP and package component snapshots. | Later master edits never rewrite old invoices or return basis. |
| Master deletion | Referenced medicine/tariff/package becomes inactive/archived, not physically deleted. | Hard delete only for never-referenced records under explicit safe checks. |
| Stock changes | Stock balance is server-owned projection derived from signed movements and batch allocations. | No browser-submitted stock/HPP final value; adjustments require reason and actor. |
| Purchase receipt | Receipt, lines, batch, movement, stock and HPP update must be one server transaction. | Split receipt/batch cardinality remains source gate. |
| Supplier settlement | Use explicit payment events/allocations rather than boolean `lunas` as the target source of truth. | Legacy boolean must not be converted to fabricated payment details. |
| Return/refund | Separate request, quota reservation, approvals, stock disposition, refund obligation and payout. | Exactly-once effects and same-invoice ownership constraints. |
| Cancellation | Append a cancellation/reversal record; do not erase prior visit/invoice state. | Cancellation and return must lock the same invoice subject and be mutually exclusive as policy requires. |
| Financial reports | Aggregate from posted source events with explicit event date, business date, payment date and payout date. | Do not treat current projections as historical period balances. |
| Time | Server timestamps for events; Asia/Jakarta for clinic business-date boundaries. | Preserve raw legacy timestamp and offset evidence; quarantine ambiguous timestamps. |
| Money | Integer rupiah in database; BigInt/string-safe transport in Node. | Never coerce arbitrary BIGINT to JS Number; test bounds/round-trip. |
| Legacy identity | Scope source IDs by source system + collection/table + document ID. | Do not assume Firestore document IDs are globally unique across collections. |
| FK acceptance | Require exact matching types/signedness/length/collation, parent ordered PK/UNIQUE, child index, nullability/action and same-parent ownership. | Candidate FK list is not approved physical DDL until manifest and TiDB tests pass. |
| Audit | Append-only server-authored audit with authenticated actor, server time, request/entity IDs and redacted before/after. | UI activity feed may be capped; authoritative audit may not be silently truncated. |
| Authorization | API verifies token and resolves role/permissions server-side; deny by default and scope every resource query. | UI tab visibility is not authorization; no client-supplied actor/role authority. |
| Backup/restore | Versioned, integrity-checked backup; isolated restore drill; protected identities excluded from operational overwrite. | JSON client backup is not a migration/import mechanism. |

## 5. Owner policy gates — explicit and not silently resolved

| Decision | What is already known | Still requires owner policy |
|---|---|---|
| D01 Medicine units/fractions | Stock accuracy is mandatory; real units include strip/botol examples. | Canonical unit per medicine; whether fractional strip/tablet quantities are allowed; rounding. |
| D05 Returned medicine disposition | Return value must match original charge; stock must not inflate. | Who certifies unopened/resalable condition and quarantine/re-entry timing. |
| D06 Package discount/refund allocation | Medicine and service components can be returned; no over-return. | Exact proportional allocation and rounding method for package discounts/refunds. |
| D07 Service/fee return | Service/fee return is required where eligible and creates no stock movement. | Eligibility window, partial service return conditions and service already delivered rules. |
| D08 Expense self-approval | Expense approval is required in current workflow. | Thresholds and whether creator may approve own expense; separation-of-duty matrix. |
| D09 Petty cash classification | Petty cash is distinct from omzet and opening float; avoid double-counting. | Categories for advances/reimbursements and expense recognition/payment policy. |
| D10 Supplier credit | Supplier return must be traceable and must not rewrite purchase history. | Credit recognition point and evidence; refund vs credit note vs offset. |
| D11 Supplier partial payment | Boolean paid flag is insufficient for detailed allocations. | Whether partial/multiple/split payments are required operationally and historical allocation approval. |
| D12 Shift verification | Close and verification must be role-controlled and auditable. | Which roles verify each shift and exception (Admin, Pimpinan or both). |
| D13 Refund payout | Pimpinan final approval and separate payout are established. | Accepted payout methods and minimum evidence/reference; exact cash drawer/bank source. |
| D14 Non-cash revenue recognition | Omzet, cash-in-hand and settlement are separate concepts. | Recognition date for pending/failed/settled non-cash instruments. |
| D15 Opening stock/HPP | No invented opening balance/HPP. | Approved opening stock evidence and valuation method at cutover. |
| D16 Queue A/B | Separate A/B views, switching, and cashier lane selection are stated. | Operational meaning of lanes, simultaneous active calls per lane vs clinic-wide, transfer/override policy. PR13 requires separate review. |
| D17 Legacy timestamps | Preserve raw source values; normalize only when unambiguous. | Rules for malformed/local timestamps and missing offsets on concrete records. |
| D18 Patient/clinical retention | “Batal Berobat” is preferred; preserve history. | Retention duration, legal hold, deletion/correction and search policy. |
| D19 Audit retention | Authoritative audit must not be truncated by UI cap. | Formal retention period, export and legal hold. |
| D20 Authentication authority | Five protected accounts and current Firebase Auth identity must be preserved. | Verify deployed Cloud Functions/bootstrap/token authority and decide long-term identity provider after read-only UID mapping. |

D02/D03 (patient/encounter and historical invoice linkage) are engineering-handled by quarantine/no fabrication. D04 (historical sale without batch) is quarantine/manual reconciliation, never fake batch creation. These do not require a blanket owner guess; any specific exception needing acceptance must be presented with evidence.

## 6. Source verification gates — engineering must complete

1. Re-run full source-path audit for all writes/read paths, not only UI excerpts, for medicine fractional quantities and package component allocation.
2. Verify supplier purchase line → receipt → batch cardinality across every writer, editor, seed and import path. Only then decide whether a line-to-batch allocation table is needed.
3. Verify queue counter/reset/reissue behavior and inspect PR13 separately before adopting any implementation.
4. Retrieve and inspect the actual deployed Firestore Rules and Cloud Functions source only through authorized read-only access; repository absence is not proof of deployed absence.
5. Profile legacy IDs, timestamps, missing references, duplicate candidates and source collection counts from an authorized snapshot in an isolated workspace. No live data extraction is authorized by this document.
6. Complete exact field union and physical type/null/default/charset/collation dictionary; resolve every FK tuple and child index.
7. Test TiDB transaction, FK, unique NULL, locking, isolation, decimal, BIGINT, rollback and concurrency behavior with synthetic fixtures in preview.
8. Complete security tests for token verification, resource-level authorization, staff UID binding, protected-account preservation and audit actor provenance.
9. Complete restore drill and cross-module regression before any migration/cutover proposal.

## 7. Scope control for schema v1

### Core domains to model
- identity and role assignments;
- patient master and encounters;
- queue lane, counters, tickets, calls and display configuration;
- shifts and cash custody/reconciliation;
- medicine, tariff, package and immutable sale-time snapshots;
- supplier, purchase invoice/lines, receipt batches and supplier settlement;
- stock batches, signed movements and invoice batch allocations;
- invoices, invoice lines and payment events;
- return quota/requests/approvals/refund obligation/payout;
- cancellations and reversals;
- expenses, petty cash and losses;
- settings versions, append-only audit, migration crosswalk and quarantine.

### Conditional/deferred until evidence requires
- multi-tenant registry;
- generic event framework for every table;
- queue handoff tables beyond the already required lane selection;
- supplier line-to-many-batch allocation table;
- outbox/jobs and file/export/backup job tables;
- full electronic medical record / clinical notes;
- generic polymorphic source registry;
- separate return/quota event tables if row-version + transaction + audit prove sufficient;
- MP3 voice management enhancement (retain as product backlog).

## 8. Recommended next sequence

1. Freeze this decision register as the single decision source; update it only when new source evidence or explicit owner policy changes.
2. Complete source gates and exact FK/type/index manifest without writing application code.
3. Produce a single consolidated schema v1 candidate with every unresolved field marked, not guessed.
4. Run TiDB compatibility and synthetic cross-domain tests in preview.
5. Present only genuinely necessary owner policy questions, grouped by operational impact, before final DDL approval.
6. Keep Firebase and production intact until a separate migration/cutover approval.

## 9. Readiness verdict

**Pass 26 decision consolidation is documented. Schema v1 is not approved, not frozen, and not ready for production DDL or migration.** The largest remaining gates are owner policies D01/D05–D20, source verification for split receipts/queue/authentication, complete physical FK/type/index closure, TiDB runtime tests, security and restore drills.

## 10. Safety statement

No app source was edited; no DDL or data import was executed; no Firebase/Auth data was read or changed; no protected account was modified; no Vercel deployment or production operation occurred; no merge to `main` or PR13 was performed. This document is a design/decision register only.
