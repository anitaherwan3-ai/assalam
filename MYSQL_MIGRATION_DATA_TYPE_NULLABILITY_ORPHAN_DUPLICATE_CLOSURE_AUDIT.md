# DATA TYPE, NULLABILITY, ORPHAN & DUPLICATE CLOSURE AUDIT
Date: 2026-11-15 | Branch: migration/tidb-foundation
Status: STATIC REVIEW ONLY — NOT DDL; NO LIVE DATA PROFILE; NO TiDB RUNTIME CLAIM

## Decision
Schema v1 remains BLOCKED. Existing proposal contains broad table coverage but many definitions are compressed prose, not a complete per-column physical data dictionary. It is not possible to certify every FK type pair mechanically from the present artifact. This audit records provable design gaps and release gates. No clinic data was queried; orphan/duplicate checks below are logical specifications, not executed queries.

## 1. Type-family closure

| Domain | Proposal | Finding / required freeze rule |
|---|---|---|
| Entity PKs | BIGINT UNSIGNED | Every FK must match exactly; audit all child columns for signedness and width. |
| User/actor IDs | VARCHAR(64); convention also permits CHAR(36) | Freeze one representation (recommend VARCHAR(64) for stable existing IDs); identical charset/collation on all user FKs. |
| Legacy IDs | VARCHAR(128), often UNIQUE | Unique must be source-scoped. Use source_system + source_collection + source_document_id mapping; don't assume IDs are globally unique across Firebase/local backup. |
| Public IDs | VARCHAR(80) | Define UUID/ULID format and collation; verify TiDB index byte limits. |
| Money | BIGINT signed, rupiah integer | mysql2 bigNumberStrings/supportBigNumbers; BigInt arithmetic; define upper/lower bounds and overflow policy. Never JS Number. |
| Quantity | DECIMAL(18,3) | D01 unresolved: canonical base unit, strip/tablet fractions, package/service scale and rounding. Not freeze-ready. |
| Rate | DECIMAL(9,4) | Confirm business range and exact rounding algorithm. |
| Business date | DATE, Asia/Jakarta | Calculate explicitly in WIB, never cast UTC timestamp to DATE. |
| Timestamp | DATETIME(3) UTC | Set connection session timezone +00:00 on every pool checkout; preserve raw legacy timestamp and provenance. |
| Flags | TINYINT(1) | API must enforce 0/1; storage type alone is not strict boolean. |
| Counters | INT UNSIGNED | Define rollover/maximum; file byte size should use BIGINT UNSIGNED where INT range is insufficient. |
| Text | Various VARCHAR lengths/TEXT | Lengths are candidates, not proven source maxima; reject truncation and preserve raw source. |
| JSON | snapshots/outbox/audit | No relational keys or authoritative money/status in JSON; validate size/schema and redact PII. |

## 2. Findings

### DT-01 — Complete FK type manifest missing (BLOCKER)
Before DDL create one normalized column dictionary: table, column, exact SQL type, signedness, length/precision, charset/collation, nullable, default, PK/UNIQUE parent key, child index, ON DELETE and ON UPDATE. Prose relationship summaries cannot certify FK compatibility.

### DT-02 — User ID type not frozen (BLOCKER)
Convention says CHAR(36) or VARCHAR(64), while actual table definitions use VARCHAR(64). Select one and apply exactly to every user/actor FK. Never reference users by email.

### DT-03 — BIGINT signedness audit incomplete (BLOCKER)
Entity IDs are mostly BIGINT UNSIGNED; money is BIGINT signed. Confirm every invoice, shift, batch, medicine, supplier, line, component, quota, return, payment, event and movement reference. No signed/unsigned coercion assumptions.

### DT-04 — Legacy ID uniqueness too broad (HIGH)
A UNIQUE legacy_id alone may collide across collections/source systems. Replace with unique source mapping tuple; keep legacy_id non-unique or scoped.

### DT-05 — Nullable unique behavior requires TiDB proof (HIGH)
inventory_batches.supplier_invoice_line_id is nullable UNIQUE for opening/adjustment batches. Test multiple NULL rows on the actual cluster; do not infer runtime behavior.

### DT-06 — Quantity precision is not a business decision (BLOCKER)
DECIMAL(18,3) is only a candidate. Define base unit per medicine, permitted fractions, conversion, package multipliers, service quantity scale and rounding. D01 remains unresolved.

### DT-07 — Money bounds not frozen (HIGH)
Define maximum invoice/payment/ledger amounts and overflow rejection. Serialize BIGINT consistently as string at API boundary and calculate with BigInt.

### DT-08 — VARCHAR lengths are unverified (HIGH)
Lengths for names, IDs, invoice numbers, reason, object key and settings are not based on the full historical field/type union. Profile protected export before ETL; never silently truncate.

### DT-09 — Collation/normalization not frozen (BLOCKER)
utf8mb4 is specified, but not exact collation. Define deterministic email trim/lowercase and explicit equality semantics for email, IDs, invoice numbers and human text. Test index byte limits and case/accent behavior on TiDB.

### DT-10 — Lifecycle nullability unresolved (BLOCKER)
Specify exactly when these are nullable/required: encounter.patient_id, encounter.shift_id, invoice.patient_id, actor IDs, approver IDs, paid/verified/closed timestamps, batch expiry/receipt references, invoice component IDs and return component IDs. New checkout must not use legacy orphan nullability. Legacy exceptions go to quarantine, not fake parent rows.

### DT-11 — Composite same-parent constraints incomplete (BLOCKER)
Need constraints or explicit API invariant tests for:
- encounter shift + cashier;
- invoice shift + cashier;
- invoice patient + encounter patient;
- batch medicine + receipt-line medicine;
- supplier return line + exact batch/receipt line/invoice;
- invoice batch allocation + sale medicine/component;
- loss/stocktake medicine + batch medicine;
- return line + exact quota subject/line/component;
- supplier payment + supplier invoice same supplier;
- credit note invoice = supplier return invoice;
- active shift slot references shift owned by same cashier.

### DT-12 — Status/code domains are free-form (HIGH)
Create versioned dictionary for statuses, payment methods, source/movement types, line/component types, queue prefixes, roles/scopes, dispositions and account codes. Unknown legacy values are preserved and quarantined, not coerced.

### DT-13 — Legacy timestamp ambiguity (BLOCKER)
Source contains local date/time, client milliseconds, ISO strings, missing offsets and mixed _t. Preserve raw values; define source-specific conversion rules. D17 unresolved. DATETIME(3) UTC does not prove source timezone.

### DT-14 — Event ordering (HIGH)
Millisecond timestamps can collide. Use event UUID/aggregate sequence as deterministic tie-breaker; timestamp alone is not concurrency or last-write-wins authority.

## 3. Static orphan/duplicate closure matrix — NOT EXECUTED

| Area | Required detection | Exception handling |
|---|---|---|
| Identity | normalized active email collisions; duplicate provider UID; role overlap; missing actor | quarantine mapping; protect both Pimpinan |
| Patient/visit | invoice patient differs from encounter; missing patient/encounter; shift/cashier mismatch | retain invoice snapshot; quarantine link |
| Queue | duplicate date+prefix+sequence; overlapping prefix assignment; duplicate ticket/encounter | preserve consumed sequence; define cancelled-ticket semantics |
| Shift | multiple open shifts; active slot points to another cashier's shift | quarantine inconsistent records |
| Inventory | batch medicine differs from line/loss/stocktake; negative balance; aggregate stock differs from batch sum | no silent adjustment; reconciliation |
| Purchase | batch receipt-line mismatch; duplicate invoice ambiguity; split receipt; supplier mismatch | source-preserving quarantine |
| Sales | line has zero/multiple target refs; totals differ from line gross-discount; duplicate invoice scope | preserve snapshot and reconcile |
| Returns | quota mismatch; pending+approved > sold; return/cancel conflict; duplicate restoration | freeze quota and block posting |
| Refund | payout without approved obligation; payout > obligation; duplicate idempotency | block payout/replay |
| Supplier credit | batch from another invoice; credit note mismatch; payment allocated to another supplier | reject and quarantine |
| Finance | duplicate source posting; shift drawer mismatch; petty cash double-count; duplicate purchase payment | reconcile ledger |
| Restore/audit | missing actor; replay; owner overwritten by restore | protect owner, retain evidence |

## 4. Synthetic fixtures required
Invoice patient ≠ encounter patient; encounter cashier ≠ shift cashier; invoice cashier ≠ shift owner; batch medicine ≠ receipt line medicine; invoice allocation batch ≠ sale component; supplier return batch from another invoice; credit note invoice mismatch; payment allocation supplier mismatch; return quota subject mismatch; overlapping A/B prefix assignment; first-use counter race; duplicate open shift; return reservation/release replay; invoice both cancelled and returned; duplicate ledger source posting; legacy sale without batch; multiple NULL receipt-line batch refs; normalized email collision; source-scoped legacy ID collision; timezone-less timestamp around WIB midnight.

These are not yet run against historical data or TiDB.

## 5. Required changes before DDL
1. Complete normalized data dictionary and FK type manifest.
2. Freeze VARCHAR(64) user_id or alternative consistently.
3. Source-scope legacy IDs.
4. Define all FK signedness, nullability and collations.
5. Resolve D01 quantity units/scale/rounding.
6. Define email/ID/text collation.
7. Define state-dependent nullability and status dictionaries.
8. Add composite same-parent keys/FKs or explicit accepted API-level invariant tests.
9. Preserve raw timestamps and define D17 conversion.
10. Profile protected historical export before real ETL.
11. Run synthetic orphan/duplicate tests and TiDB compatibility spike.

## 6. Work actually performed
Static cross-check of schema proposal/review, legacy compatibility, relational integrity, financial/inventory, FK/index closure and key/concurrency closure on migration branch. No live export, patient data, TiDB runtime test, DDL, deployment or production mutation. Firebase, production Vercel, main and PR13 unchanged.
