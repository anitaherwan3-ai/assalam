# MYSQL MIGRATION — SCREEN, ROLE AND END-TO-END ACCEPTANCE TEST PLAN

Date: 2026-11-15
Baseline: main branch source/UI inspection; PR #13 remains separate and unmerged.
Target: migration/tidb-foundation
Status: test specification only. No tests are claimed as executed.

## 1. Purpose and acceptance rule

This plan converts the visible Klinik Assalaam application into a testable checklist. It supplements, rather than replaces:
- MYSQL_MIGRATION_SCREEN_BY_SCREEN_UI_SPECIFICATION.md
- MYSQL_PERMISSION_MATRIX_AND_TESTS.md
- MYSQL_MIGRATION_FINANCIAL_INVENTORY_RECONCILIATION_AUDIT.md
- MYSQL_MIGRATION_RELATIONAL_INTEGRITY_ORPHAN_AUDIT.md

A feature is accepted only when all applicable layers pass:
1. UI: expected screen, controls, labels, loading/empty/error states and tablet/desktop/mobile layout.
2. API: authenticated request, server-derived actor/role, validation, authorization and safe error.
3. Database: atomic transaction, constraints, idempotency, relationship integrity and audit.
4. Business result: correct stock, batch, invoice, cash, bank, payable, return and queue state.
5. Regression: previously accepted features remain unchanged.
6. Recovery: failure/retry/reconnect does not duplicate or lose an operation.

A visible menu, successful HTTP 200, connected database, or successful page render is not sufficient acceptance evidence.

## 2. Test environment and fixtures

### 2.1 Environment isolation
- Use only isolated Vercel preview project and TiDB preview database.
- Use synthetic names, phone numbers, medicines, suppliers and transactions.
- Never copy real patient records, credentials, tokens or production exports into fixtures.
- Keep production Firebase, production Vercel and the currently running clinic app untouched.
- Every test run records branch, commit SHA, deployment ID, database schema version and test-run ID.

### 2.2 Synthetic identities
Use non-production test identities mapped to the four operational roles:
- Pimpinan master test identity (synthetic; verify protected-owner behavior without using a real master credential).
- Pimpinan second test identity.
- Admin test identity.
- Kasir 1 test identity, stable cashier assignment A.
- Kasir 2 test identity, stable cashier assignment B.

The two cashiers are distinct user profiles, not two interchangeable browser sessions. Test a role switch only by authenticating as the corresponding fixture identity.

### 2.3 Synthetic master data
Create deterministic fixtures:
- Patient P-001 and P-002; one active visit and one cancelled/no-treatment visit.
- Medicine M-001 with two batches: B-OLD (earlier expiry) and B-NEW (later expiry); known opening stock and HPP.
- Medicine M-002 with one batch near WIB date boundary.
- Service S-001.
- Package PK-001 containing one medicine component and one service component.
- Supplier SUP-001 with purchase invoices PI-001 and PI-002.
- Configured expense threshold and one approved / one pending expense.
- One shift for each cashier, plus closed and verified shift fixtures.
- A pending return, an Admin-reviewed return and a fully approved but unpaid return.
- A cancelled invoice and a non-cancelled invoice with historical snapshots.

All fixture IDs are stable and all expected amounts are precomputed in the test manifest.

## 3. Global authorization and identity tests

| ID | Role / action | Expected result |
|---|---|---|
| AUTH-01 | Unauthenticated request to any protected API | 401; no data disclosure or mutation |
| AUTH-02 | Expired/invalid token | 401; no mutation |
| AUTH-03 | Valid token but no active profile | Deny; audit security event without exposing sensitive profile data |
| AUTH-04 | Client submits role=pimpinan while authenticated as kasir | Server ignores client role and denies Pimpinan-only action |
| AUTH-05 | Client changes cashier ID to another cashier | Server derives actor from session and denies cross-cashier mutation |
| AUTH-06 | Disabled staff profile | Login/API denied according to policy |
| AUTH-07 | Staff changes own role, active flag, stable ID or auth binding | Denied |
| AUTH-08 | Pimpinan provisions Admin/Kasir | Profile and auth binding created with audit; duplicate identity rejected |
| AUTH-09 | Pimpinan changes staff email | Stable user ID remains; verified new email binding and audit required |
| AUTH-10 | Non-Pimpinan provisions staff | Denied |
| AUTH-11 | Reset/seed/restore attempts to remove master Pimpinan | Denied; protected master identities remain |
| AUTH-12 | Pimpinan deletes/demotes own last protected owner | Denied by invariant |
| AUTH-13 | Same account opened on two devices | Session policy enforced; no cross-user data leakage |
| AUTH-14 | API error occurs | Response contains safe error code/request ID, never SQL, credentials or stack trace |

## 4. Screen-by-screen test suites

## 4.1 Shared shell, login and navigation

| ID | Screen/control | Role | Test and expected result |
|---|---|---|---|
| UI-001 | Login | All | Correct credentials authenticate and load correct profile |
| UI-002 | Login | All | Wrong password gives safe error; no profile disclosure |
| UI-003 | Brand/header | All | Fixed clinic title displays exactly Klinik Assalaam Palembang |
| UI-004 | Header user/role | All | Displays server-resolved identity and role, not client-supplied label |
| UI-005 | Navigation | Kasir | Only Shift, Pasien, Transaksi, Riwayat Transaksi, Kas Kecil and approved cashier-specific functions appear |
| UI-006 | Navigation | Admin | Only Admin-authorized operational menus appear |
| UI-007 | Navigation | Pimpinan | Pimpinan dashboard, reports, approvals, users, settings and oversight menus appear |
| UI-008 | Direct URL/API invocation | All | Hiding a menu does not replace API authorization; forbidden route/API is denied |
| UI-009 | Logout | All | Session ends; protected API cannot be called with cleared/expired session |
| UI-010 | Session refresh/reconnect | All | User remains correctly authenticated or is safely redirected to login |
| UI-011 | Responsive shell | All | Desktop, tablet and phone have no clipped controls, hidden actions or unusable tables |
| UI-012 | Sync/error indicator | All | Shows pending, synced and failed states truthfully; no false success |

## 4.2 Kasir — Shift

| ID | Control / action | Expected result |
|---|---|---|
| KSH-001 | Open shift with modal awal | One open shift created for authenticated cashier; opening cash is not omzet |
| KSH-002 | Open second shift while first is open | Rejected atomically |
| KSH-003 | Two devices open shift concurrently | At most one open shift succeeds |
| KSH-004 | Open shift with negative/invalid modal | Rejected; no row created |
| KSH-005 | Close shift | Server calculates expected drawer from assigned shift movements |
| KSH-006 | Enter physical cash | Difference = physical - system; close snapshot immutable |
| KSH-007 | Close shift twice/retry | Idempotent; no duplicate close event |
| KSH-008 | Cashier closes another cashier's shift | Denied |
| KSH-009 | Admin verifies eligible closed shift | Verification actor/time recorded |
| KSH-010 | Cashier verifies own shift | Denied |
| KSH-011 | Pimpinan reviews shift | Full permitted oversight and audit trail |
| KSH-012 | Pending transaction/return during close | Policy enforced; cannot silently close inconsistent shift |
| KSH-013 | Cash refund assigned to shift | Drawer reflects payout exactly once |
| KSH-014 | Shift recap | Totals match invoice/payment/cash ledgers; opening modal separate |

## 4.3 Kasir — Pasien, visit and queue

| ID | Control / action | Expected result |
|---|---|---|
| KPS-001 | Register patient | Patient/visit/queue created atomically |
| KPS-002 | Register without open shift | Rejected if active shift is required by policy |
| KPS-003 | Required name/phone validation | Invalid data rejected with field-level message |
| KPS-004 | Concurrent queue registration same day/prefix | Unique sequential numbers; no duplicate queue |
| KPS-005 | Queue registration at WIB midnight | Correct business date and counter |
| KPS-006 | Queue A/B assignment | Assignment derived from server profile/approved mapping |
| KPS-007 | Edit patient/visit | Only permitted fields and workflow states update |
| KPS-008 | Batal Berobat | Visit status changes; no invoice or stock movement invented |
| KPS-009 | Restore Batal Berobat | Only permitted same-day/not-served state restored |
| KPS-010 | Archive patient | Pimpinan-only soft delete; historical invoices remain linked |
| KPS-011 | Re-register same patient | New visit/queue; does not overwrite patient history |
| KPS-012 | Patient phone/name privacy | Unauthorized fields are not returned in API projection |

## 4.4 Kasir — Transaksi/POS

| ID | Control / action | Expected result |
|---|---|---|
| POS-001 | Add medicine | Price and medicine identity loaded from server-authorized master |
| POS-002 | Add service | Service price and type validated server-side |
| POS-003 | Add package | Component snapshot and price validated |
| POS-004 | Quantity exceeds available stock | Checkout blocked with no partial writes |
| POS-005 | Expired batch | Not allocated |
| POS-006 | Multiple batches | FEFO allocation computed server-side |
| POS-007 | Discount | Authorized discount rule; exact integer rupiah rounding |
| POS-008 | Client tampers with price/HPP/total | Server recomputes; tampered payload rejected or ignored |
| POS-009 | Cash payment | Paid amount/change validated; cash ledger posted |
| POS-010 | Non-cash payment | Correct bank/QRIS/transfer account ledger; drawer unchanged |
| POS-011 | Insufficient payment | Checkout rejected |
| POS-012 | Invoice duplicate request | Idempotent; exactly one invoice and stock deduction |
| POS-013 | Patient not eligible/done state conflict | Checkout rejected |
| POS-014 | Transaction commit failure midway | Entire transaction rolls back |
| POS-015 | Successful checkout | Invoice, visit completion, payment, stock, batch, quota and audit all agree |
| POS-016 | Offline/retry after reconnect | No duplicate invoice or deduction |
| POS-017 | Package component medicine | Component stock/HPP deductions reconcile to package snapshot |
| POS-018 | Historical invoice view | Old price/HPP/package composition remains unchanged |

## 4.5 Kasir — Riwayat Transaksi, cancellation and return request

| ID | Control / action | Expected result |
|---|---|---|
| KRT-001 | View own/all permitted invoice history | Scope matches role and privacy policy |
| KRT-002 | Request invoice cancellation | Pending request created with reason and actor |
| KRT-003 | Cashier approves own cancellation | Denied |
| KRT-004 | Admin approves/rejects cancellation | Decision actor/time/reason recorded; stock only restored on valid approval |
| KRT-005 | Pimpinan final cancellation action | Authorized transition; no double restore |
| KRT-006 | Cancel invoice with existing return | Conflict is detected under transaction lock |
| KRT-007 | Submit return for medicine | Original line, qty, discount share and batch allocation validated |
| KRT-008 | Submit return for service | No stock movement; correct service refund amount |
| KRT-009 | Submit return for package | Component return policy and snapshot enforced |
| KRT-010 | Submit same item twice | Remaining return quota prevents over-return |
| KRT-011 | Return quantity above remaining qty | Rejected without writes |
| KRT-012 | Cashier directly finalizes/pays return | Denied |
| KRT-013 | Retry return submission | Idempotent; no duplicate reservation |
| KRT-014 | View return status | Correct staged status and reason shown |

## 4.6 Kasir — Kas Kecil

| ID | Control / action | Expected result |
|---|---|---|
| KPC-001 | Create petty cash | Actor and active shift derived server-side |
| KPC-002 | Edit own pending entry | Only allowed fields/state; full audit |
| KPC-003 | Edit another cashier's entry | Denied |
| KPC-004 | Delete posted petty cash | No hard delete; reversal command required |
| KPC-005 | Submit negative/zero amount | Rejected |
| KPC-006 | Petty cash after shift closed | Policy enforced; cannot rewrite closed snapshot |
| KPC-007 | Report petty cash | Same amount appears once in cash flow and according to P&L category |

## 4.7 Admin — Obat & Tarif, Paket Pelayanan

| ID | Control / action | Expected result |
|---|---|---|
| ADM-M-001 | Create/edit medicine master | Validated fields; actor and change history recorded |
| ADM-M-002 | Edit aggregate stock directly | Denied; use stock adjustment command |
| ADM-M-003 | Change medicine HPP | New valuation version; historical invoice HPP unchanged |
| ADM-M-004 | Delete medicine used historically | Restricted/archive; historical FK and snapshots preserved |
| ADM-M-005 | Create/edit service tariff | Valid price/type and audit |
| ADM-M-006 | Create/edit package | Component IDs/qty/price valid; no invalid nesting |
| ADM-M-007 | Change package after past sale | Past invoice snapshot remains unchanged |
| ADM-M-008 | Duplicate master ID/name policy | Duplicate behavior follows explicit uniqueness policy |

## 4.8 Admin — Pembelian and Utang

| ID | Control / action | Expected result |
|---|---|---|
| BUY-001 | Create purchase receipt | Purchase, batch, stock movement and AP created atomically |
| BUY-002 | Duplicate supplier invoice | Rejected or flagged per uniqueness policy |
| BUY-003 | Invalid batch expiry/qty/total | Rejected |
| BUY-004 | Weighted average HPP | Exact agreed rounding and reproducible calculation |
| BUY-005 | Purchase paid in full | Payment event, AP and cash/bank all reconcile |
| BUY-006 | Partial supplier payment | AP decreases only by payment amount |
| BUY-007 | Multiple payment methods | Each event records account, reference and actor |
| BUY-008 | Supplier return from batch | Explicit batch allocation; no over-return |
| BUY-009 | Supplier return greater than batch remaining | Rejected; no stock/AP mutation |
| BUY-010 | Supplier credit note | AP credit posted once; not sales revenue |
| BUY-011 | Supplier cash refund | Cash/bank receipt separate from credit note |
| BUY-012 | Edit historical purchase after settlement | Prohibited or reversal workflow; audit immutable |
| BUY-013 | Delete purchase with linked batch/payment | Restricted; reversal and reconciliation required |
| BUY-014 | Utang report | Original invoice - credits - payments = outstanding balance |

## 4.9 Admin — Kedaluwarsa, Stok Opname and Kartu Stok

| ID | Control / action | Expected result |
|---|---|---|
| INV-001 | Expiry list | WIB date, batch quantity and expiry correct |
| INV-002 | Stock opname count | Captures system qty, physical qty, variance and reason |
| INV-003 | Approve stock adjustment | Creates balanced inventory movement and audit |
| INV-004 | Concurrent sale during stock count | Lock/version prevents stale adjustment overwrite |
| INV-005 | Kartu stok | Derived from immutable movement ledger |
| INV-006 | Batch balance | Opening + receipts + returns - deductions - losses ± adjustments |
| INV-007 | Aggregate medicine stock | Equals sum of batch balances plus explicit non-batch opening balance |
| INV-008 | Manual stock correction | Requires reason, actor and approval |
| INV-009 | Undo posted loss | Compensating reversal, never deletion |
| INV-010 | FEFO same expiry tie | Stable tie-break ensures deterministic allocation |

## 4.10 Admin — Biaya and Verifikasi

| ID | Control / action | Expected result |
|---|---|---|
| EXP-001 | Create expense below threshold | Auto-approval only if owner-approved rule allows; rule version logged |
| EXP-002 | Create expense at/above threshold | Pending approval |
| EXP-003 | Admin approves own submitted expense | Separation-of-duties policy enforced |
| EXP-004 | Pimpinan approves expense | Actor/time/reason recorded |
| EXP-005 | Edit approved expense | Reversal/new version, not silent overwrite |
| EXP-006 | Delete approved expense | Denied; reversal required |
| EXP-007 | Same event posted as petty and expense | Duplicate economic event detected or explicitly linked |
| EXP-008 | Verify closed shift | Only authorized Admin/Pimpinan; immutable decision |
| EXP-009 | Approve return first stage | Admin moves only to allowed next state; no stock restore/payment |

## 4.11 Pimpinan — Dashboard, Laba Rugi, Arus Kas and Utang

| ID | Control / action | Expected result |
|---|---|---|
| FIN-001 | Dashboard date filters | Consistent Asia/Jakarta business dates |
| FIN-002 | Gross and net omzet | Gross invoices less approved returns; cancelled invoices excluded |
| FIN-003 | HPP | Sale snapshot HPP less eligible returned HPP |
| FIN-004 | Laba operasional | Revenue - HPP - loss - approved expenses - expense-class petty, without double count |
| FIN-005 | Modal awal shift | Excluded from omzet/profit; included in drawer cash |
| FIN-006 | Arus kas tunai | Actual cash receipts/outflows only |
| FIN-007 | Arus kas non-tunai | Bank/QRIS/transfer separate from drawer |
| FIN-008 | Refund approved not paid | Revenue adjusted; refund obligation remains; cash unchanged |
| FIN-009 | Refund paid | Obligation decreases and cash/bank decreases once |
| FIN-010 | Supplier payable | Invoice - credit notes - payments |
| FIN-011 | Date-range boundary | Event recognition dates and WIB timezone rules applied consistently |
| FIN-012 | Report drilldown | Each aggregate traceable to source invoice/ledger event |
| FIN-013 | Exported report | Matches on-screen filters and totals; PII minimized |
| FIN-014 | Compare old/new report | Every variance explained and signed off |

## 4.12 Pimpinan — Pengawasan Retur, Pengguna, Pengaturan, Log

| ID | Control / action | Expected result |
|---|---|---|
| OWN-001 | Final approve return | Inventory restore and refund obligation atomic |
| OWN-002 | Reject return | Quota released according to policy; reason recorded |
| OWN-003 | Pay refund by cash | Drawer/management cash account decreases once |
| OWN-004 | Pay refund by transfer | Bank account decreases; transfer reference mandatory |
| OWN-005 | Pay more than obligation | Rejected |
| OWN-006 | Duplicate refund payout | Idempotency prevents double payment |
| OWN-007 | Manage staff profiles | Only Pimpinan; stable user ID preserved |
| OWN-008 | Change clinic display name | Fixed name cannot be edited |
| OWN-009 | Change permitted clinic settings | Validated fields and audit |
| OWN-010 | Read activity log | Complete audit history; no arbitrary 1000-row truncation |
| OWN-011 | Modify/delete audit log | No hard edit/delete in ordinary operation |
| OWN-012 | Break-glass override | Explicit reason, strong auth, alert and immutable audit |

## 4.13 Display TV and queue

| ID | Control / action | Expected result |
|---|---|---|
| TV-001 | Open display | Only public queue projection loaded; no patient phone/clinical fields |
| TV-002 | Queue update on another device | Near-real-time refresh without manual app reopen |
| TV-003 | Queue A mode | Only A queue shown |
| TV-004 | Queue B mode | Only B queue shown |
| TV-005 | Combined/switch mode if approved | Selector behavior matches approved product decision |
| TV-006 | Queue call | Correct queue status and call event synced |
| TV-007 | Audio digit reading | Digits spoken individually (e.g. A-001) |
| TV-008 | Chime and voice clip | Independently configurable and fallback safe |
| TV-009 | Missing audio asset | Speech fallback or safe no-audio behavior; queue remains usable |
| TV-010 | Audio upload | MIME/size/checksum validated; private object storage |
| TV-011 | Display settings change | Only allowed fields update; no full config overwrite |
| TV-012 | Display device token | Revocable least-privilege access |
| TV-013 | Refresh/reconnect | Does not replay stale announcement indefinitely |
| TV-014 | PR13 handoff/A-B behavior | Test only in isolated feature branch until PR decision; do not imply main already contains it |

## 4.14 Export, backup and restore

| ID | Control / action | Expected result |
|---|---|---|
| BKP-001 | Export transaction report | Role scope, date filter and totals correct |
| BKP-002 | Export patient report | Minimum necessary PII; authorized role only |
| BKP-003 | CSV cell begins with formula marker | Formula injection neutralized |
| BKP-004 | Export activity log | Date filters applied; audit not truncated |
| BKP-005 | Backup snapshot | Versioned, encrypted, checksummed and access logged |
| BKP-006 | Restore dry-run | Shows schema/version/row counts/validation errors without mutation |
| BKP-007 | Restore to staging | Referential integrity and totals validated before promotion |
| BKP-008 | Restore contains missing master Pimpinan | Restore rejected or master protected; never delete owner |
| BKP-009 | Corrupt/incomplete backup | Rejected before writes |
| BKP-010 | Backup recovery drill | RTO/RPO measured and evidence retained |
| BKP-011 | WhatsApp receipt | Opens user composer; never claims message sent automatically |
| BKP-012 | Shift recap notification | Uses immutable closed-shift snapshot; no stale recalculation |

## 5. Cross-cutting concurrency, failure and data-integrity tests

| ID | Scenario | Expected result |
|---|---|---|
| SYS-001 | Two cashiers sell last unit simultaneously | Only valid stock allocation succeeds |
| SYS-002 | Two cashiers request same queue number concurrently | Unique sequence, no duplicate |
| SYS-003 | Two Admins approve same expense | One state transition only |
| SYS-004 | Admin and Pimpinan act on same return concurrently | State machine allows one valid transition |
| SYS-005 | Cancellation and return race on same invoice | Invoice lock prevents double restore/refund |
| SYS-006 | Browser retries after network timeout | Idempotency returns original result |
| SYS-007 | Database deadlock/lock timeout | Safe retry policy; no partial writes |
| SYS-008 | Vercel function cold start | Connection pool remains bounded; no leaked connections |
| SYS-009 | Database unavailable | Safe error, no false local success, retry queue policy explicit |
| SYS-010 | Client clock wrong by hours/days | Server timestamp/business date remains authoritative |
| SYS-011 | WIB midnight and month/year boundary | Correct business date, report period and expiry decision |
| SYS-012 | Orphan patient/invoice/return/batch references | Constraint or quarantine catches; no silent dangling reference |
| SYS-013 | Duplicate legacy IDs | Deterministic key mapping and exception report |
| SYS-014 | Re-run import batch | Idempotent; no duplicate posting |
| SYS-015 | Partial migration failure | Checkpoint and rollback/retry do not corrupt source |
| SYS-016 | Database restore | Foreign keys, balances, audit and master identities preserved |
| SYS-017 | Large history/pagination | No unbounded collection load; stable cursor pagination |
| SYS-018 | User deactivated with open shift | Explicit close/handoff policy; no orphaned active shift |
| SYS-019 | Tablet viewport / slow connection | Controls remain operable; loading and retry feedback clear |
| SYS-020 | Security probe for SQL injection / IDOR | Parameterized queries and ownership checks prevent access |

## 6. PR #13 isolated acceptance suite (not part of main baseline)

These tests apply only if the owner separately approves PR #13 behavior for the migration product:
- Handoff patient to another cashier with active target shift.
- Target shift closes between preview and confirmation; handoff must fail safely.
- Handoff updates patient ownership and audit atomically.
- Cashier logout guard with continue/cancel/handoff paths.
- Queue A/B assignment by stable cashier identity, not mutable email.
- Display selector A/B and live sync.
- Legacy queue rows without prefix.
- Audio announcement does not duplicate after reconnect.
- Firestore Rules and source PR tests are not substitutes for MySQL API tests.

Do not merge PR #13 as part of the migration test-plan task.

## 7. Test execution phases and evidence

### Phase A — Static source review
- Confirm source function and UI callsite.
- Record source SHA, line/function and known gaps.
- Static review cannot prove runtime behavior.

### Phase B — Unit tests
- Money rounding, discount allocation, HPP, FEFO, date/time, state transitions, permission predicates and idempotency key generation.
- Use deterministic fixed clock and synthetic fixtures.

### Phase C — API/database integration
- Run against isolated TiDB schema and preview API.
- Verify transaction rollback, locks, unique constraints, foreign keys, audit and retry behavior.
- Capture SQL assertions and ledger snapshots; redact credentials and PII.

### Phase D — UI end-to-end
- Test each role on desktop, tablet and phone.
- Verify visible controls, field validation, status labels, errors and report filters.
- Verify server-side denial even when API is called directly.

### Phase E — User acceptance and reconciliation
- Owner/Admin/Kasir execute approved scripts.
- Compare old and new systems using the same synthetic fixture.
- Sign off each financial and inventory variance with reason.

### Phase F — Backup/restore and cutover rehearsal
- Full backup, restore to isolated environment, integrity checks, reconciliation and rollback drill.
- No production cutover until all gates are signed.

### Evidence record for every test
Each test run must retain:
- Test ID and version.
- Branch/commit/deployment/schema version.
- Synthetic fixture IDs.
- Acting role and device type.
- Steps and expected result.
- Actual result: PASS / FAIL / BLOCKED / NOT RUN.
- API request ID and redacted trace.
- Before/after row counts and ledger totals.
- Screenshot/video where UI behavior matters.
- Defect ID and retest reference.

## 8. Release gates — do not bypass

| Gate | Minimum requirement |
|---|---|
| G0 Source baseline | Main SHA captured; PR13 separated; outstanding unknowns listed |
| G1 Identity/security | Auth source resolved; role tests and IDOR tests pass |
| G2 Schema approval | Table/field/relationship and retention policies approved |
| G3 Synthetic data | All critical API, concurrency, rollback and idempotency tests pass |
| G4 Feature parity | Every existing screen/function mapped and accepted or consciously retired |
| G5 Finance/inventory | Reconciliation equations pass; variances signed |
| G6 Backup/restore | Encrypted backup and restore drill pass; master owners protected |
| G7 UAT | Pimpinan, Admin, Kasir 1 and Kasir 2 sign their workflows |
| G8 Cutover | Explicit owner authorization, freeze window, backup, rollback plan and monitoring |
| G9 Retirement | Firebase data and services retained until post-cutover reconciliation and retention approval |

## 9. Current status

- Test cases defined in this document: design complete for review.
- Test execution: NOT RUN.
- Production acceptance: NOT APPROVED.
- Schema/DDL: NOT APPROVED and NOT EXECUTED.
- Real patient data migration: NOT STARTED.
- Firebase and production Vercel: unchanged.
- PR #13: remains unmerged and separate.
- Cloud Functions source/configuration: still an external dependency to locate and verify before auth cutover.

## 10. Next work

After this test plan, prepare the proposed relational schema as a review artifact only:
1. Table catalogue with purpose, owner and retention.
2. Column catalogue with types, nullability, defaults and source mapping.
3. Primary/foreign/unique/check constraints and indexes.
4. State machine and transaction boundaries for critical commands.
5. Data migration mapping and exception/quarantine rules.
6. Report query definitions and reconciliation controls.

Do not execute CREATE TABLE until policy decisions, security design and owner review are complete.
