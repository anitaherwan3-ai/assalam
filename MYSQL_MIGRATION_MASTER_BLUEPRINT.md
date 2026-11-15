# MASTER MIGRATION BLUEPRINT — Klinik Assalaam Palembang
Tanggal: 2026-11-15
Baseline: main read-only; PR #13 remains open/unmerged.
Target: TiDB Cloud (MySQL-compatible) + Vercel API on isolated migration branch.

Status: comprehensive working draft based on static source inspection. Fields marked verified are observed in audited source write paths; partial means not all call sites/legacy shapes checked; derived means calculated; unknown means extraction remains. No SQL DDL, production change, Firebase write or real-data migration has occurred.

## A. Safety and architecture
1. Keep Firebase and production Vercel active and untouched.
2. Use synthetic data only in TiDB preview until security, backup, privacy and migration controls are approved.
3. Do not merge PR #13 automatically; assess A/B queue and logout guard separately.
4. API server is the only database writer. Never trust browser-supplied role, cashier ID, final price, HPP, stock balance, cash balance or approval status.
5. Every business command validates on server, uses SQL transaction and row locks, idempotency key, audit event and full rollback on failure.
6. Business date uses Asia/Jakarta; server timestamps are authoritative.
7. Clinic name is fixed: Klinik Assalaam Palembang.
8. Protect master owners praktekrose@gmail.com and nursalim42@gmail.com from deletion, disablement, demotion, seed and restore overwrite.
9. Recommended transition auth: retain Firebase Authentication temporarily; verify ID token server-side and resolve profile/role from DB.
10. No patient data migration before backup, access control, audit, retention and privacy review.

## B. 1 — Firebase collection and field inventory

### B1. ClinicStore collections
Firestore collection prefix is k_.

| Firebase collection | Verified / candidate fields | Status and notes |
|---|---|---|
| k_obat | id, nama, stok, hpp; selling price, unit, category, status and attributes | Partial; reconcile aggregate stock to batches and ledger. |
| k_tarif | id, nama, jenis, harga | Partial; complete service fields remain. |
| k_paket | id, nama, harga, jenis, items; component id,type,nama,harga,qty,oid | Partial; preserve component snapshots. |
| k_pasien | id,nama,hp,tgl,jam,sh,kasir,done,calling,status,batalBerobatPada,batalBerobatOleh,deletedAt,registeredAt,_t | Partial; split patient master, encounter and queue. |
| k_trx | id,no,tgl,jam,pid,nama,hp,kasir,sh,items,total,metode,bayar,kembalian,_t,status,dibatalkanPada,dibatalkanOleh | Partial; item structure below. |
| k_petty | id,tgl,ket,jml,kasir,sh,_t | Verified. Use reversal, not silent delete. |
| k_beli | id,tgl,supplier,faktur,oid,qty,total,tempo,lunas,tglBayar,qtyAwal,totalAwal,hargaBeliSatuan,batchId,_t | Verified; no payment allocation history in inspected path. |
| k_biaya | id,tgl,kat,ket,jml,status,kasir,_t | Verified; approval threshold and decision history needed. |
| k_loss | id,tgl,oid,bid,qty,ket,nilai,_t | Verified; stock and expense movement atomic. |
| k_shift | id,tgl,jam,sh,kasir,nama,modal,status,jamT,sistem,fisik,selisih,verif,oleh,_t | Verified/partial; add actor UID, close/verify timestamps and reconciliation snapshot. |
| k_batch | id,oid,no,ed,qty,sisa,beli,_t | Verified; immutable inventory movement ledger required. |
| k_log | id,_t,tgl,jam,u,aksi,kol,rinci | Verified; append-only; do not cap authoritative DB log at 1,000. |
| k_users | uid,email,u,nama,hp,role,active,updatedAt | Partial; protect owners and retain email history. |
| k_returJual | id,trxId,itemIndex,qty,priorQty,quotaId,kasir,status,diverifikasiAdminOleh,diverifikasiAdminPada,alasan,jenis,pengembalian | Partial; exhaust all backend call sites. |
| k_returBeli | id,tgl,beliId,supplier,faktur,namaObat,qty,nilai,alasan,_t | Verified; supplier credit note needs separate entity. |
| k_batalTrx | id,trxId,kasir,status,alasan,alasanPenolakan,diverifikasiOleh,diverifikasiPada,tgl,_t | Partial; request/decision lifecycle. |

### B2. Other Firestore documents and local state
| Source | Fields / content | Destination |
|---|---|---|
| klinik_config/settings | set, seq; clinic settings, thresholds, display settings, queue sequence | clinic_settings, display_configs, queue_counters |
| klinik_config/queueAudioClip_* | type,clipId,audioData,sizeBytes,fileName,mimeType,updatedAt,updatedBy | Object storage for bytes; SQL metadata/checksum/version |
| k_returKuota | trxId,itemIndex,qtyTerpakai,originTrx,lastReturId,lastPriorQty,lastQty,_t | return_quotas |
| localStorage.klinik_data | cached collections, set, seq, firebaseConfig | Cache only; not source of truth |
| PR #13 | A/B queue, handoff/logout guard and UI changes | Optional delta; separately review/test |

### B3. Invoice line snapshots
- Direct medicine: oid,nama,t=Obat,harga,qty,hpp,batchDeductions.
- Service/tariff: nama,t=tariff type,harga,qty=1,hpp=0.
- Package: pid,nama,t=Paket,jenis=Paket,harga,qty,items,hpp.
- Package component: id,type,nama,harga,qty and oid for medicine; medicine components can have batchDeductions.
- Header: id,no,tgl,jam,pid,nama,hp,kasir,sh,items,total,metode,bayar,kembalian,_t.
- Still verify historical discounts, signa, label instructions, package component snapshots, HPP snapshots, payment methods and missing batchDeductions.
- Master edits must never rewrite old invoices/receipts.

### B4. Field completeness protocol
Before ETL, extract union of keys from every document in a secure environment; profile types/nullability and legacy aliases. Mark each field verified, derived, legacy or unknown. Unknown fields block automatic migration until mapped. The table above is a verified starter dictionary, not a claim that every historical key is enumerated.

## C. 2 — MySQL tables and relationships

### C1. Identity/config/audit
- users (immutable user_id, display name, active); user_emails (normalized email, verified, valid_from/to); role_assignments; user_sessions.
- clinic_settings (fixed identity separated from editable settings); display_configs; queue_audio_assets (metadata only).
- audit_events (actor, role snapshot, action, entity, before/after diff, request_id, server timestamp).
- idempotency_keys (actor, command, key, result reference, expiry).
- User 1:N emails, roles and audit events.

### C2. Patient and queue
- patients 1:N patient_encounters; encounter links queue_tickets; ticket 1:N queue_calls.
- queue_counters unique by business_date + prefix; cashier_queue_assignments maps stable cashier ID to A/B.
- Patient identity is separate from daily encounter and queue. Cancellation is a status/event, not physical deletion.

### C3. Master and inventory
- medicines, medicine_categories (if needed), tariffs, service_packages, package_components, suppliers.
- inventory_batches belongs to medicine and optionally purchase line.
- inventory_movements append-only: purchase, sale, patient_return, supplier_return, loss, stocktake, adjustment; signed qty, batch, source document, actor, timestamp.
- inventory_balances may be materialized but must reconcile to movement ledger and batch totals.
- stocktakes, stocktake_lines, inventory_adjustments.

### C4. Sales and refund
- sales_invoices belongs to encounter, cashier and shift.
- sales_invoice_lines stores immutable line snapshots.
- sales_invoice_line_components stores package composition.
- sales_invoice_line_batch_movements links lines/components to batch deductions.
- sales_invoice_discount_allocations stores discount rounding.
- sales_returns, sales_return_lines, return_quotas.
- refund_obligations created on final approval; refund_payments records actual payout.
- invoice_cancellation_requests and invoice_cancellation_events.
- Invoice 1:N lines; line 1:N components, batch movements and quota; return 1:N return lines; obligation 1:N payment events.

### C5. Supplier and purchases
- supplier_invoices, supplier_invoice_lines, supplier_returns, supplier_return_lines, supplier_credit_notes, supplier_payments, supplier_payment_allocations.
- Invoice line belongs to supplier invoice, medicine and received batch; return line references original line and batch.
- Payable = invoices + debit adjustments - accepted credit notes - allocated payments.

### C6. Shift and finance
- cashier_shifts, shift_reconciliations, cash_ledger_entries, bank_payment_entries, petty_cash_entries.
- expenses, expense_approvals, expense_reversals, loss_events.
- Cash ledger entry records signed amount, source, method, shift, actor, business date and reversal link. Non-cash never enters drawer cash.
- Revenue, COGS, refund obligation, refund paid, expense, inventory loss, payable settlement and physical cash are distinct.

### C7. Collection mapping
| Firebase | Main MySQL destinations |
|---|---|
| k_users | users, user_emails, role_assignments |
| k_obat | medicines |
| k_tarif | tariffs |
| k_paket | service_packages, package_components |
| k_pasien | patients, patient_encounters, queue_tickets, queue_calls |
| k_trx | sales_invoices, sales_invoice_lines, components, batch movements |
| k_returKuota | return_quotas |
| k_returJual | sales_returns, sales_return_lines, refund_obligations, refund_payments |
| k_batalTrx | invoice_cancellation_requests, invoice_cancellation_events |
| k_batch | inventory_batches, inventory_movements |
| k_beli | supplier_invoices, supplier_invoice_lines |
| k_returBeli | supplier_returns, supplier_return_lines, supplier_credit_notes |
| k_petty | petty_cash_entries, cash_ledger_entries |
| k_biaya | expenses, expense_approvals, expense_reversals |
| k_loss | loss_events, inventory_movements |
| k_shift | cashier_shifts, shift_reconciliations |
| k_log | audit_events |
| klinik_config/settings | clinic_settings, display_configs, queue_counters |
| queue audio docs | object storage + queue_audio_assets |

## D. 3 — Menu to replacement API commands
All are proposed, not implemented. Prefix /api/v1. Writes require auth, role checks, allowlisted fields, idempotency, audit and SQL transaction.

| Menu / feature | Candidate endpoint | Role |
|---|---|---|
| Session | GET /session; POST /session/logout; POST /session/password-reset | All authenticated roles |
| Dashboard | GET /reports/dashboard | Pimpinan |
| Patient/queue | POST /patients; PATCH /patients/:id/contact; POST /encounters/:id/call; /recall; /cancel-visit; /restore | Kasir/Pimpinan; limited Admin actions |
| Shift | POST /shifts/open; POST /shifts/:id/close; /verify; /adjustments | Open/close Kasir; verify Admin/Pimpinan |
| POS | POST /sales/checkout; GET /sales/:id; GET /sales; GET /sales/:id/receipt | Checkout Kasir/Pimpinan |
| History | GET /sales/history; GET /returns/history; GET /cancellations/history | Kasir/Admin/Pimpinan with scope |
| Patient return | POST /returns; POST /returns/:id/admin-review; /approve-final; /reject; /payments | Submit Kasir; review Admin; final approval/payment Pimpinan |
| Invoice cancellation | POST /sales/:id/cancellation-requests; POST /cancellations/:id/approve; /reject | Request Kasir; decision Admin/Pimpinan |
| Petty cash | POST /petty-cash; PATCH /petty-cash/:id; POST /petty-cash/:id/reverse | Kasir own; Pimpinan |
| Medicine/tariff/package | GET/POST/PATCH /medicines, /tariffs, /packages | Admin/Pimpinan write |
| Purchase | POST /purchases; GET /purchases; POST /purchases/:id/receive | Admin/Pimpinan |
| Supplier return/payable | POST /supplier-returns; /approve; /credit-note; POST /supplier-payments; /allocations; /reverse; GET /payables | Admin/Pimpinan |
| Expenses | POST /expenses; PATCH /expenses/:id; POST /expenses/:id/approve; /reject; /reverse | Admin manage; approval policy |
| Expiry/stocktake/loss | GET /inventory/expiry; POST /stocktakes; /losses; /inventory-adjustments | Admin/Pimpinan |
| Stock card | GET /inventory/ledger; GET /inventory/batches | Admin/Pimpinan |
| Finance reports | GET /reports/profit-loss; /cash-flow; /revenue; /shift-reconciliation; /payables | Pimpinan; limited Admin |
| Display | GET /display/state; /queue; PATCH /display/settings; POST /display/audio-assets; DELETE /display/audio-assets/:id | Scoped display read; Admin/Pimpinan config |
| Export/backup | POST /exports; GET /exports/:id; POST /backups; POST /restores/dry-run; POST /restores | Export by role; restore Pimpinan |
| Users/settings/log | GET /audit-events; POST/PATCH /users; POST /users/:id/change-email; PATCH /clinic-settings | Pimpinan; Admin display subset |

Avoid generic collection CRUD. Each route must have a strict request schema and field allowlist.

## E. 4 — Role permissions

| Capability | Pimpinan | Admin | Kasir 1 | Kasir 2 |
|---|---|---|---|---|
| Dashboard/financial reports | Full | Operational subset | Own shift/transaction scope | Own shift/transaction scope |
| Patient registration/queue | Oversight | Read/limited status ops | Create/manage workflow | Create/manage workflow |
| Queue prefix | Configure mapping | View | A default | B default |
| Shift | View/adjust/verify | Verify | Open/close own | Open/close own |
| POS checkout | Oversight/exception | Read | Own cashier identity | Own cashier identity |
| Sales history | Full | Operational view | Own/allowed scope | Own/allowed scope |
| Patient return | Final approve/pay/reject | First review/forward/reject | Submit own | Submit own |
| Invoice cancellation | Decide | Decide | Request own invoice | Request own invoice |
| Medicine/tariff/package | Full | Create/update | Read | Read |
| Purchase/supplier/stock | Full | Manage | Read if needed | Read if needed |
| Loss/stocktake/expiry | Oversight | Manage | No direct adjustment | No direct adjustment |
| Petty cash | Full | Read | Create/edit own; reversal | Create/edit own; reversal |
| Expense | Policy/oversight | Create/manage; approval per policy | No | No |
| Display/audio | Full | Allowed display/audio subset | Mode selector only if permitted | Mode selector only if permitted |
| Export | Full | Operational scope | Own scope | Own scope |
| Users/email/roles | Full, master protections | No role/email authority | Own profile limited | Own profile limited |
| Clinic settings | Full except fixed clinic name | Display subset | No | No |
| Backup/restore | Full audited | No restore | No | No |
| Audit log | Full | Operational read | Own activity if needed | Own activity if needed |

Stable accounts: Pimpinan praktekrose@gmail.com and nursalim42@gmail.com; Admin assalamadmin1@gmail.com; Kasir1 stable ID kasir / assalamkasir1@gmail.com / queue A; Kasir2 stable ID kasir2 / assalamkasir2@gmail.com / queue B. Email change retains immutable user ID and full history.

This is least-privilege target based on source rules and business requirements. Menu visibility is never authorization.

## F. 5 — Business transaction rules

### F1. POS and inventory
1. Validate active session, cashier's open shift, eligible patient encounter and unique idempotency key.
2. Server derives prices, discount rules, package composition and HPP policy.
3. Lock encounter, shift, medicine balances and eligible batches.
4. Allocate FEFO by expiry, excluding expired/zero batches; persist movement per invoice line/component.
5. Insert invoice, lines, components, update encounter, inventory, cash/bank ledger and audit atomically.
6. Same idempotency key returns original result without second stock deduction.
7. Any failure rolls back every write.
8. Historical invoice snapshots never change after master edits.

### F2. Purchase and supplier return
- Receive purchase atomically creates invoice/line, batch, positive inventory movement and weighted-average HPP snapshot.
- Validate finite positive qty/value, medicine, supplier and valid ED.
- Supplier return must not exceed original batch/purchase remainder and physical stock. Reject over-limit; do not silently cap.
- Separate goods shipped back, supplier acknowledgement, credit note and actual refund/offset.
- Payable = invoices + debit adjustments - accepted credits - allocated payments.
- Support partial payments with method, reference, date, actor and allocation. Reversal is a new audited event.
- Aggregate stock must reconcile to batch balances under an explicit expiry/damage policy.

### F3. Patient returns and refunds
- Return quota is per invoice line; pending/non-rejected proposals reserve quantity.
- Reject over-return, duplicate selection, invalid item index, cancelled invoice and cancellation conflict.
- Admin reviews first; no stock restoration at this stage.
- Pimpinan final approval creates refund obligation; restore stock only for returned goods, trace to original batch or quarantine under policy. Service return never increases stock.
- Actual refund is a separate payment event; cash/transfer, transfer reference and paid timestamp recorded. Prevent duplicate payout.
- Return value derives from immutable invoice price/discount snapshot and consistent rounding, never client amount.
- Cancellation and return must not double-reduce revenue or restore stock twice.

### F4. Invoice cancellation
- Cashier requests; Admin/Pimpinan approve/reject.
- Approval locks invoice, return quotas, batches, encounter and ledgers; checks no active return conflict.
- Restore stock once, mark invoice cancelled, write reversal/void and audit atomically.
- Rejected request may be resubmitted with history retained.

### F5. Shift, petty cash and expense
- One open shift per cashier; opening modal is float, not revenue.
- Expected cash = opening float + cash receipts - petty paid - cash refunds +/- adjustments. Exclude non-cash.
- Store counted cash and variance; Admin/Pimpinan verification records actor and timestamp. Later correction only by adjustment/reversal.
- Petty cash tied to shift; avoid duplicate expense accounting.
- Expense approval threshold is server config. Store creator/approver; enforce self-approval policy; edits after approval require revision/reapproval or reversal.
- Revenue, COGS, loss, expenses, payable settlement and cash are separate ledgers.

### F6. Financial definitions
- Gross revenue from active invoice lines net of invoice discounts.
- Net revenue = gross revenue - approved returns - cancelled sales according to one non-duplicating policy.
- COGS = immutable invoice HPP - HPP of goods actually restored.
- Gross profit = net revenue - COGS.
- Operating profit = gross profit - approved operating expenses - recognized inventory loss - other defined costs.
- Opening modal, supplier principal payments, transfers between bank/cash and refund liability are not revenue/expense merely because cash moved.
- Refund obligation is recognized on final approval; cash outflow on payment.
- All reports/exports share one calculation service and WIB business dates.

### F7. Queue and TV
- Queue unique by business date + prefix + sequence; allocate atomically server-side.
- Kasir1 defaults A; Kasir2 defaults B; mapping editable only by Pimpinan.
- Call/recall are immutable events; TV deduplicates by event ID.
- Display supports A-only, B-only, combined/switching configuration. Mode selection is separate from patient mutation rights.
- Spoken digits individually; chime and voice clips separately configurable; MP3 bytes in object storage.
- Batal Berobat retains encounter and allows audited restoration; no cashier physical delete.

## G. 6 — Acceptance and regression tests

### G1. Authentication/permissions
- [ ] Login all four roles and verify exact menus and API access.
- [ ] Inactive staff, wrong email/UID and invalid role blocked.
- [ ] Forged body role/email/cashier ID cannot elevate privileges.
- [ ] Master owners cannot be deleted, disabled, demoted or overwritten by seed/restore.
- [ ] Email change retains immutable ID; old email loses access after verified change.
- [ ] Direct API denial works even if UI menu is manipulated.

### G2. Patient and queue
- [ ] Two devices register same date/prefix concurrently; no duplicate sequence.
- [ ] A/B counters independent; cashier mapping correct.
- [ ] Recall produces one event and one announcement; duplicate snapshot does not repeat.
- [ ] Batal Berobat hides from waiting list but retains history; restore works.
- [ ] Contact edit cannot change encounter identity or queue number.
- [ ] Checkout blocked for not-called, cancelled, completed or wrong-day patient.

### G3. Shift and finance
- [ ] One open shift per cashier; concurrent duplicate opening blocked.
- [ ] Opening modal excluded from omzet, included in expected drawer.
- [ ] Cash vs transfer/QRIS separated; change correct.
- [ ] Petty cash tied to correct shift and not double-counted as expense.
- [ ] Expected cash and variance reconcile.
- [ ] Verification captures actor/time; post-verification adjustment retains history.
- [ ] Cross-midnight WIB business date correct.

### G4. POS and stock
- [ ] Direct medicine sale deducts correct FEFO batch and aggregate.
- [ ] Package sale deducts all medicine components by component qty × package qty.
- [ ] Expired batch excluded; valid earliest-expiry batch chosen first.
- [ ] Insufficient stock blocks whole transaction.
- [ ] Duplicate idempotency request creates one invoice and one deduction.
- [ ] Concurrent last-unit sales cannot create negative stock.
- [ ] Injected failure at each write step rolls back invoice, encounter, stock and ledger.
- [ ] Master edits do not alter old invoice/receipt/label.
- [ ] Batch and stock ledger totals reconcile.

### G5. Purchase, supplier, expense, loss
- [ ] Purchase creates batch/stock and correct weighted average HPP.
- [ ] Invalid qty/value/ED rejected server-side.
- [ ] Partial, repeated and over-limit supplier returns handled correctly.
- [ ] Supplier credit and partial payment produce correct payable.
- [ ] Duplicate supplier payment blocked; reversal audited.
- [ ] Expense below/at/above threshold follows server config.
- [ ] Approved expense correction creates revision/reversal.
- [ ] Loss/stocktake affects exact batch and value; reversal restores.

### G6. Return and cancellation
- [ ] Return qty <= sold qty minus active returns.
- [ ] Same line cannot have overlapping reserved return quantity.
- [ ] Admin review does not restore stock.
- [ ] Pimpinan approval restores correct stock and creates refund obligation.
- [ ] Service return affects revenue/refund only, not stock.
- [ ] Partial discount return uses original allocation and rounding.
- [ ] Refund paid once; transfer reference validated.
- [ ] Cancellation conflicts with active returns; no double restore/revenue reduction.
- [ ] Rejection/retry preserves history and releases quota accurately.

### G7. Reports, export, backup and display
- [ ] Revenue, net revenue, COGS, gross/operating profit reconcile from ledgers.
- [ ] Refund approved vs refund paid separated.
- [ ] Supplier payments/credit notes do not double-count expenses.
- [ ] Cash flow reconciles to drawers and bank.
- [ ] Export totals equal on-screen reports; WIB date filters.
- [ ] Backup checksum/version and restore dry-run; restore tested on isolated clone.
- [ ] Master owner identities protected through restore.
- [ ] Display read-only; cannot mutate patients, stock or invoices.
- [ ] Invalid/oversized audio rejected; chime and voice independently configurable.
- [ ] Offline/reconnect and concurrent-device tests show no lost updates.

### G8. Data migration
- [ ] Field dictionary covers every source key and type/nullability.
- [ ] Dry-run reports counts accepted/rejected and reasons per collection.
- [ ] Referential integrity validated across invoice/patient/shift/lines/batches/returns/payments.
- [ ] Aggregate medicine stock equals batch balances under policy.
- [ ] Daily/monthly financial totals match legacy on controlled fixtures.
- [ ] No master user missing; no unexpected duplicate IDs.
- [ ] ETL rerun is idempotent.
- [ ] Rollback tested on isolated target; production cutover remains separate approval.

## H. Remaining work before DDL
1. Exhaust exact source read/write field extraction for all collections, settings and audio; inspect all call sites and legacy shapes.
2. Build route-by-route permission matrix: method, role, ownership, allowed fields, preconditions and negative tests.
3. Resolve policy gaps: expense approver/self-approval, supplier credit recognition timing, package/service refund, payment methods, petty cash classification, shift verifier, PR13 A/B scope and legacy return migration.
4. Define SQL types, decimal precision, constraints, indexes, FK delete rules, timezone, retention and audit immutability.
5. Only after review create schema in isolated TiDB with synthetic fixtures.
6. Implement API command-by-command, test, security review and backup/restore drill.
7. Production cutover and real data transfer are separate explicit approval gates.

## I. Sources
js/store.js; js/app.js; js/firebase-backend.js; firestore.rules; MYSQL_MIGRATION_INVENTORY.md; MYSQL_MIGRATION_DEEP_DIVE_AUDIT.md; MYSQL_PERMISSION_MATRIX_AND_TESTS.md; MYSQL_MIGRATION_ROOT_CAUSE_AUDIT.md; MYSQL_MIGRATION_PURCHASE_FINANCE_SHIFT_AUDIT.md; MYSQL_MIGRATION_INVOICE_AND_INVENTORY_AUDIT.md; MYSQL_MIGRATION_FINANCIAL_RECONCILIATION_AUDIT.md; MYSQL_MIGRATION_PATIENT_QUEUE_DISPLAY_AUDIT.md; MYSQL_MIGRATION_IDENTITY_BACKUP_EXPORT_AUDIT.md.

## Status
Blueprint saved to migration branch. This is a static-source-based draft, not exhaustive legacy-field proof or runtime test report. No SQL DDL, production change, Firebase write or real patient-data migration.


## J. Addendum — exact ClinicStore source verification (js/store.js)

Source fingerprint: main/js/store.js SHA `99e74acf8caec9c70d82be1d5f6efc5bfa6bc4fb`, inspected lines 130–553.

### J1. Definitive local collection registry
The ClinicStore constructor explicitly initializes exactly these 16 arrays:
`obat, tarif, paket, pasien, trx, petty, beli, biaya, loss, shift, batch, log, users, returJual, returBeli, batalTrx`.
Firestore naming in the sync layer prefixes these as `k_<collection>`. Additional Firestore documents/configs are outside this ClinicStore array and must be separately inventoried.

### J2. Additional verified fields and behavior
- `log`: `id,_t,_pendingSync,tgl,jam,u,aksi,kol,rinci`. Local log prepends and truncates to 1,000; MySQL audit must not truncate authoritative history.
- `batch`: `id,oid,no,ed,qty,sisa,beli,_t`. FEFO filters same medicine, positive `sisa`, `ed >= today`, sorts ascending expiry. The local code uses UTC `toISOString()` for this date; server design must explicitly use WIB business date to avoid midnight drift.
- `beli`: verified purchase write includes `id,tgl,supplier,faktur,oid,qty,total,tempo,lunas,tglBayar,qtyAwal,totalAwal,hargaBeliSatuan,batchId,_t`. Purchase creates one batch per invoice line call and computes weighted average HPP from aggregate stock/HPP.
- `returJual` local proposal includes `id,status,tgl,trxId,itemIndex,quotaId,priorQty,noNota,namaPasien,namaItem,oid,jenis,hpp,metode,qty,harga,total,batchRestores,alasan,kasir,_t`; `batchRestores[]` entries include `oid,bid,qty,batchNo,ed`. Approval adds `diverifikasiOleh,diverifikasiPada`; rejection adds `alasanPenolakan`.
- `returBeli`: exact write fields `id,tgl,beliId,supplier,faktur,namaObat,qty,nilai,alasan,_t`.
- `returKuota` is not a ClinicStore collection; it is a separate cloud-side guard structure documented in the backend audit.
- `batalTrx` is initialized but this local source section does not expose its complete schema; keep field status unknown until backend and app call sites are exhausted.

### J3. Important local/cloud semantic divergence
The local `approveReturJual()` accepts both Admin and Pimpinan, then immediately restores stock and marks return `disetujui`. The previously audited cloud workflow is staged: Cashier submits, Admin reviews/forwards, Pimpinan final-approves, stock is restored at final approval, and refund payment is a separate event. Do not blindly port local behavior. The secure cloud workflow and user's stated concern about refund abuse take precedence, subject to final owner policy.
Local supplier return currently caps qty with `Math.min(requested, purchase remaining, batch remaining, aggregate stock)`, then mutates stock/batch/HPP and reduces unpaid invoice total. This silent cap can hide an over-return request; the new API should reject over-limit quantities and retain separate supplier credit/payment records.
Local FEFO and return allocation are client-side state mutations. In MySQL the server must lock rows and derive batch allocation itself; client `batchDeductions`/`batchRestores` are reference snapshots only, never authority.


## Source audit cross-reference — write paths, permissions and PR13

The detailed Firebase write-path and role-permission crosswalk is maintained separately in [MYSQL_MIGRATION_WRITE_PATH_PERMISSION_CROSSWALK.md](./MYSQL_MIGRATION_WRITE_PATH_PERMISSION_CROSSWALK.md). It maps each legacy collection/action to the required MySQL command boundary, records observed backend atomic operations and Firestore field/role restrictions, and provides role/security/concurrency acceptance tests.

PR13 remains open and unmerged. Its logout guard, patient handoff, queue A/B prefixing, display selector, calling synchronization and Firestore Rules changes have been reviewed as reference behavior only. Do not merge it automatically. Any future adoption must pass the PR13-specific regression checklist in the crosswalk and must not regress existing patient, POS, stock/batch, shift, returns, cancellation, finance, authentication or multi-device behavior.

The latest read-only source fingerprints and PR13 review are recorded in the crosswalk. This is still an inventory/design phase: no SQL DDL, production code replacement, Firebase mutation or real patient-data migration is authorized by this document.


## App UI callsite audit

The read-only UI/business-command inventory is available in [MYSQL_MIGRATION_APP_UI_CALLSITE_AUDIT.md](./MYSQL_MIGRATION_APP_UI_CALLSITE_AUDIT.md). It covers patient lifecycle, shifts/cash, petty cash, medicine/tariff/package master data, purchases/supplier returns, expenses/loss, return/cancellation UI, staff management, clinic settings, Display TV/audio, exports and stock card. It records legacy local-mutation risks and the MySQL command boundaries and regression tests required to preserve behavior safely.


## Export, backup/restore, WhatsApp and Display integration audit

See [MYSQL_MIGRATION_EXPORT_BACKUP_WHATSAPP_DISPLAY_AUDIT.md](./MYSQL_MIGRATION_EXPORT_BACKUP_WHATSAPP_DISPLAY_AUDIT.md). This audit records the current CSV/PDF report inventory and correctness/security gaps, destructive local JSON restore behavior, WhatsApp composer (manual send rather than automatic delivery), shift recap reconciliation risks, full-collection Display TV listener/privacy concerns, audio storage migration and acceptance tests. It also records the remaining exhaustive backend/collection pass before schema approval.


## Exhaustive backend method and collection catalog

See [MYSQL_MIGRATION_BACKEND_METHOD_COLLECTION_CATALOG.md](./MYSQL_MIGRATION_BACKEND_METHOD_COLLECTION_CATALOG.md). It inventories Firebase authentication/profile methods, realtime listener scopes, patient/queue, checkout, cancellation, return/quota/payout, audio/display, generic sync, configuration and disconnect paths; includes collection/document path mapping and critical concurrency/sync risks. It also records that PR13 A/B support remains unmerged reference behavior while the main baseline queue allocator is A-only.


### Authentication source-reproducibility gap

The backend catalog now records a repository artifact gap: the inspected `main` tree and `firebase.json` contain Firestore Rules configuration but no tracked Cloud Functions source/entrypoint, while README/auth migration docs describe Admin SDK/Cloud Functions behavior. This does not establish whether functions are deployed elsewhere; their authoritative source and deployed configuration must be located and audited before identity migration. Do not deploy or delete functions during this audit.


## Firestore Rules exhaustive static audit

See [MYSQL_MIGRATION_FIRESTORE_RULES_EXHAUSTIVE_AUDIT.md](./MYSQL_MIGRATION_FIRESTORE_RULES_EXHAUSTIVE_AUDIT.md). This document maps all matched Firestore paths and read/create/update/delete rules, records identity and field-validation gaps, prioritizes server-side authorization and atomic command requirements, and lists negative/security tests. Source fingerprint: main/firestore.rules SHA `d02b6d02c13bc85f867b668085edb85c54726779`. Static inspection only; no Rules deployment or live Firebase test was performed.


## Legacy data compatibility, seed and restore audit

See [MYSQL_MIGRATION_LEGACY_DATA_COMPATIBILITY_AUDIT.md](./MYSQL_MIGRATION_LEGACY_DATA_COMPATIBILITY_AUDIT.md). It documents the 16 local collections, seed-on-empty behavior, observed legacy field dictionary, mixed timestamps/date semantics, purchase/return/stock normalization risks, unsafe full-state JSON restore, demo-vs-live classification protocol and reconciliation gates. Static source only; actual historical document key/type union and data provenance remain unknown until a protected data export is profiled.


## Session, synchronization and authentication provenance audit

See [MYSQL_MIGRATION_SESSION_SYNC_AUTH_AUDIT.md](./MYSQL_MIGRATION_SESSION_SYNC_AUTH_AUDIT.md). Key gates: do not port generic local-state push to SQL; implement explicit atomic commands; reject checkout if patient is missing; enforce one open shift per cashier; use a durable outbox; and locate the authoritative Cloud Functions source/deployment before authentication cutover. This is static source analysis only.


## Follow-up source verification — Rules, seed behavior and authentication provenance

See [MYSQL_MIGRATION_FOLLOWUP_SOURCE_VERIFICATION.md](./MYSQL_MIGRATION_FOLLOWUP_SOURCE_VERIFICATION.md). The follow-up rechecks the exact Rules and Store source fingerprints and records additional target requirements: verified identity, least-privilege read projections, append-only petty cash/audit, command-only inventory changes, no implicit production seeding, WIB expiry handling, exact-batch supplier returns, and preservation of the staged patient-return approval/payment workflow. It also confirms the Cloud Functions reproducibility gate: `firebase.json` and documentation reference a Functions source directory and `activateInitialPimpinan`, but the inspected tracked main tree has no `functions/` directory or bootstrap script. Deployed Functions may exist elsewhere; source and deployed configuration must be located before auth cutover.

This remains static source review only. No DDL, Firebase changes, real-data migration or production deployment occurred.


## Cancellation, supplier return and Display asset callsite audit

See [MYSQL_MIGRATION_CANCELLATION_SUPPLIER_RETURN_DISPLAY_AUDIT.md](./MYSQL_MIGRATION_CANCELLATION_SUPPLIER_RETURN_DISPLAY_AUDIT.md). It records the exact `batalTrx` document shape and invoice/batch reversal behavior, the supplier-return local-only mutation and its silent quantity cap, and queue audio/Display TV storage and permission behavior. Key design gates: SQL must lock cancellation and return state together, quarantine legacy invoices missing batch allocations, preserve original purchase snapshots and create supplier credit/payment records, move MP3 binaries to object storage, and expose a least-privilege TV projection.

Static review only; no SQL DDL, Firebase mutation, real-data migration or production deployment.


## Screen-by-screen UI and workflow specification

See [MYSQL_MIGRATION_SCREEN_BY_SCREEN_UI_SPECIFICATION.md](./MYSQL_MIGRATION_SCREEN_BY_SCREEN_UI_SPECIFICATION.md). This document maps the actual `main` navigation for Kasir, Admin and Pimpinan to visible forms, buttons, table columns, user journeys, proposed API commands, authorization and acceptance tests. It separately describes the TV display page and flags the legacy Firebase settings/JSON backup controls, supplier-return local-only path, destructive correction buttons, patient PII, and unmerged PR13 A/B/handoff behavior. It explicitly distinguishes visible UI presence from tested behavior and requires desktop/tablet/phone parity plus database/ledger verification before sign-off.

No DDL, production change, Firebase mutation or real-data migration was performed.


## Relational integrity and orphan-data audit

See [MYSQL_MIGRATION_RELATIONAL_INTEGRITY_ORPHAN_AUDIT.md](./MYSQL_MIGRATION_RELATIONAL_INTEGRITY_ORPHAN_AUDIT.md). It maps patient/visit/queue/invoice, invoice-line/package/batch/return, purchase/stock/loss, shift/cash/finance, identity and audit relationships; documents archive/cancel/return lifecycles; defines candidate FK policies, pre-import orphan checks, quarantine rules, synthetic edge-case tests and unresolved owner policies. This is source-based analysis only: no live orphan query, production data export, DDL or production mutation was performed.


## Financial and inventory reconciliation audit

See [MYSQL_MIGRATION_FINANCIAL_INVENTORY_RECONCILIATION_AUDIT.md](./MYSQL_MIGRATION_FINANCIAL_INVENTORY_RECONCILIATION_AUDIT.md) for the source-based review of net revenue, returns, HPP, loss, expenses, petty cash, opening float, shift cash, FEFO, weighted-average HPP, purchase settlement, supplier returns, refund payout, reconciliation equations and 28 synthetic regression tests. No live data query, DDL or production mutation was performed.


## Screen, role and end-to-end acceptance test plan

See [MYSQL_MIGRATION_SCREEN_ROLE_END_TO_END_TEST_PLAN.md](./MYSQL_MIGRATION_SCREEN_ROLE_END_TO_END_TEST_PLAN.md). It expands the current screen specification into role-specific UI/API/database/business-result tests, concurrency and failure tests, isolated PR #13 tests, evidence requirements and release gates. Test cases are specified but have NOT been executed; no schema DDL or production migration is authorized by this document.


## Relational schema proposal (review-only)

See [MYSQL_MIGRATION_SCHEMA_PROPOSAL.md](./MYSQL_MIGRATION_SCHEMA_PROPOSAL.md). It proposes the relational domains, table/column catalogue, keys and relationships, source collection mapping, role/security boundaries, command transaction locks, financial/inventory reconciliation definitions, TiDB compatibility spike, migration quarantine rules and 20 owner decisions. It is a design artifact only: no DDL, schema creation, production change or real-data migration has occurred.

## Schema review gate
- [Schema v1 review findings](MYSQL_MIGRATION_SCHEMA_REVIEW.md)
- The schema proposal has an amendment listing mandatory corrections A1–A10. These corrections and the actual TiDB compatibility spike must pass before DDL v1 is generated.
- Latest review pass also cross-checks D01–D20 against existing clinic instructions, records which preferences are already known, and keeps unresolved clinical/accounting/security policy as explicit blockers.
- The preview compatibility endpoint is token-protected and its source test suite now covers FK/unique, commit/rollback, DECIMAL/BIGINT, EXPLAIN, explicit UTC session, row-lock blocking, concurrent last-stock guard, and cleanup failure reporting.
- Latest endpoint source changes were reviewed and Node 22 syntax-checked successfully in an isolated ephemeral sandbox. They have NOT been deployed or run against TiDB; syntax validity is not a compatibility pass.
- Deployment remains intentionally deferred until the complete source package is reviewed and Vercel deployment quota is available. No application schema DDL has been created.


## Identity and authentication authority audit

See [MYSQL_MIGRATION_IDENTITY_AUTHORITY_AUDIT.md](./MYSQL_MIGRATION_IDENTITY_AUTHORITY_AUDIT.md). Static review of the target branch's Firebase login, profile resolution, provisioning UI, Firestore Rules, Firebase config and documented bootstrap flow found an important provenance blocker: `firebase.json` and `AUTH_MIGRATION.md` refer to Cloud Functions and a bootstrap script, but the tracked branch contains no `functions/` or `scripts/` source. Deployed Functions may still exist; their source, region, service account, IAM, secrets and deployment provenance must be recovered before auth cutover. The audit also records the missing staff UID comparison in browser profile resolution, the unverified-email policy gap, the required immutable owner identity protection and the server-side token/role verification sequence.

## Application concurrency and idempotency test matrix

See [MYSQL_MIGRATION_APPLICATION_CONCURRENCY_TEST_MATRIX.md](./MYSQL_MIGRATION_APPLICATION_CONCURRENCY_TEST_MATRIX.md). It specifies 22 synthetic race/replay scenarios spanning shift opening, queue counters, checkout/FEFO, shift close, return quotas, cancellation, refund payout, supplier receiving/returns, expense approvals, petty cash, role suspension, email claims, restore protection and reversals. These are future integration tests, not executed tests. No application DDL or business API is authorized by the matrix.

Both documents are design/audit artifacts only. No Firebase rules/functions were deployed or changed, no TiDB schema DDL was run, no production data was accessed, and production `main`/Vercel remain untouched.


## Foreign-key and index closure audit

See [MYSQL_MIGRATION_FOREIGN_KEY_INDEX_CLOSURE_AUDIT.md](./MYSQL_MIGRATION_FOREIGN_KEY_INDEX_CLOSURE_AUDIT.md). Static review found the proposal's relationship section is not yet a complete column-level FK catalogue. Additional same-parent composite integrity is required for cashier/shift, medicine/batch, invoice/line/component/quota, and supplier/payment allocations. Every FK needs exact parent unique key, child supporting index, matching types/nullability and explicit delete/update policy. Polymorphic source references need typed service validation/reconciliation. `sales_return_events` must be added to relationship/index catalogues. DDL remains blocked; no TiDB FK/index runtime test or schema creation has occurred.


## Key, type, nullability and concurrency closure audit

See [MYSQL_MIGRATION_KEY_TYPE_CONCURRENCY_CLOSURE_AUDIT.md](./MYSQL_MIGRATION_KEY_TYPE_CONCURRENCY_CLOSURE_AUDIT.md). The second static pass identified additional blockers: queue-prefix assignment needs a shared guard row; first-use queue counter creation needs an explicit atomic algorithm; composite same-parent unique keys must be enumerated; return quota reservation/release needs exactly-once event linkage; actor NULL/system semantics, email collation, role scope and ticket reissue behavior need definition; and split supplier receipts must be confirmed. No TiDB runtime tests or DDL have been performed.


## Data type, nullability, orphan/duplicate and canonical FK catalogue

- [MYSQL_MIGRATION_DATA_TYPE_NULLABILITY_ORPHAN_DUPLICATE_CLOSURE_AUDIT.md](./MYSQL_MIGRATION_DATA_TYPE_NULLABILITY_ORPHAN_DUPLICATE_CLOSURE_AUDIT.md)
- [MYSQL_MIGRATION_CANONICAL_FK_INDEX_CATALOGUE.md](./MYSQL_MIGRATION_CANONICAL_FK_INDEX_CATALOGUE.md)

The static pass documents type-family rules, unresolved nullability/collation/quantity/timestamp decisions, synthetic orphan/duplicate scenarios and a candidate FK/index catalogue. It does not represent a TiDB runtime test, historical data profile, DDL approval or application table creation. See schema review section K for blockers.

## Schema contradiction and source-identity closure audit

- [MYSQL_MIGRATION_SCHEMA_CONTRADICTION_SOURCE_IDENTITY_CLOSURE_AUDIT.md](./MYSQL_MIGRATION_SCHEMA_CONTRADICTION_SOURCE_IDENTITY_CLOSURE_AUDIT.md)

This audit records 30 design contradictions/omissions, source-scoped migration identity requirements and synthetic negative tests. It is a static review only; schema v1 remains blocked and no DDL has been applied.


## L. Column dictionary v0.1 — 2026-11-15

Added `MYSQL_MIGRATION_COLUMN_DICTIONARY_V0_1.md` as a centralized extraction of the candidate column definitions across schema proposal domains 2–8. It records the proposed names, SQL types, explicit nullability/defaults and stated key/index notes without silently filling unspecified details.

This is an **extracted baseline, not an approved physical schema**. It does not close the source-field union, exact FK type/signedness/collation manifest, complete child-index coverage, lifecycle nullability, code dictionaries, money bounds, quantity units or timestamp provenance. All unresolved items remain DDL blockers.

Canonical corrections continue to supersede older text in this blueprint:
- Legacy document identity must be source-scoped; do not assume global uniqueness of `legacy_id`.
- Use `return_quota_subjects`, not the older `return_quotas` name.
- Use `active_email_claims` for active email uniqueness, not global uniqueness on email history.
- Preserve `sales_return_events` and component-aware return constraints.
- Purchase-line/batch link is one-directional unless split-receipt policy requires an allocation bridge.
- Optional PR13/A-B queue and handoff behavior remains gated.

No DDL was created, no TiDB application table was created, and no production system was changed.


## M. Legacy synchronization and repair runbook — 2026-11-15

Added `MYSQL_MIGRATION_LEGACY_SYNC_AND_REPAIR_RUNBOOK.md`. It establishes that unrestricted bidirectional Firebase↔TiDB writes are unsafe with the legacy generic collection push: per-collection partial commits, no reliable delete/tombstone propagation, client-clock conflict ordering and stale local merge behavior.

The approved migration direction is staged and controlled:
1. Read-only source snapshot with hashes and collection manifests.
2. Raw staging, normalization, crosswalk and quarantine.
3. Synthetic TiDB validation.
4. Read-only shadow reconciliation.
5. Controlled write freeze + final snapshot/delta replay + sign-off.
6. TiDB becomes the single writer only after cutover approval.

The runbook defines source-of-truth boundaries, domain mapping, structural/referential/inventory/financial/event reconciliation, discrepancy classes, mandatory repair approvals, rollback evidence and synthetic replay/concurrency tests.

**No live Firebase snapshot, data correction, production write, TiDB application data load or bidirectional sync was performed.** Legacy repair and migration remain blocked until backup/restore, source field completeness, schema/decision closure, TiDB runtime tests, reconciliation and explicit owner sign-off.


## N. Legacy field crosswalk and repair candidate register — 2026-11-15

Added [MYSQL_MIGRATION_FIELD_CROSSWALK_AND_REPAIR_CANDIDATES_V0_1.md](./MYSQL_MIGRATION_FIELD_CROSSWALK_AND_REPAIR_CANDIDATES_V0_1.md).

This draft maps observed legacy fields from identity/configuration, audio, audit logs, patient/queue, medicine/tariff/package/batch, invoices and line snapshots, returns/quotas/cancellation, purchases/supplier returns, expenses, petty cash, loss and shifts to candidate relational entities. It distinguishes OBSERVED, CONDITIONAL, DERIVED, SYSTEM, UNKNOWN-UNION, QUARANTINE and POLICY fields, and requires source-scoped identity plus immutable raw payload/hash before normalization.

The document also defines read-only repair detection patterns for stock-vs-batch variance, invoice math, missing references, absent batch lineage, duplicate candidates, return/cancellation conflicts, supplier-return ambiguity, paid-boolean evidence gaps, shift cash differences, timestamp conflicts, identity conflicts, seed provenance and unknown fields. None are auto-repairable. It includes a synthetic-only reconciliation fixture pack and ETL/repair gates.

**Important limitation:** this is a static source crosswalk, not a complete historical Firestore schema export. Actual key/type union, record counts, hashes, real discrepancy candidates and repair patches remain unknown until a protected owner-controlled snapshot is profiled. No production database was read or changed, no real data was exported/imported, no repair was executed, no TiDB application DDL was run, and no deployment occurred.


## O. Owner confirmation — legacy dataset is development dummy; protect five accounts

On 2026-11-15 the owner clarified that the old Firebase application's operational records are development/testing dummy data, not genuine clinic production history. They may be used for structural audit and regression fixtures, but must not be imported as real patient, inventory or financial history into the final database. Controlled synthetic fixtures may be added to the isolated TiDB preview when the schema/test gates are ready.

The owner explicitly requires these five identities to survive all future reset/cleanup operations, including Firebase Authentication and their linked profile/role documents:

1. Kasir Pagi — `assalamkasir1@gmail.com`
2. Kasir Sore — `assalamkasir2@gmail.com`
3. Admin — `assalamadmin@gmail.com`
4. Pimpinan — `praktekrose@gmail.com`
5. Akun kita — `nursalim422@gmail.com`

This latest whitelist supersedes older email references elsewhere in static audit notes for any future cleanup decision. Actual UID/email/profile/role matching still requires read-only verification; never infer or replace an identity by display name.

Before final deployment, the team must take and verify an encrypted private snapshot, test reset in an isolated Firebase clone, prepare a path-level deletion dry-run with explicit exceptions, obtain a separate final owner approval, then clean only the approved dummy operational documents. **No Firebase/Auth deletion is authorized now.** Never bulk-delete Auth users; preserve the five identities and their linked profiles/roles. Keep Firebase rollback/archive until the MySQL/TiDB cutover is accepted.

Current status: owner classification and whitelist confirmed; live snapshot, UID/role verification, cleanup dry-run and cleanup execution not yet performed. See section 14 of the legacy sync/repair runbook for the operational procedure.


## P. Schema v1 decision closure draft — 2026-11-15

See [MYSQL_MIGRATION_SCHEMA_V1_DECISION_CLOSURE_DRAFT.md](./MYSQL_MIGRATION_SCHEMA_V1_DECISION_CLOSURE_DRAFT.md). This pass turns recurring design findings into concrete technical amendments (canonical user ID type, single-clinic role scope, explicit system/import actor provenance, source-scoped legacy IDs, queue-prefix guard rows, safe first-use queue counter algorithm, append-only return quota events, durable stock/finance idempotency, composite same-parent integrity and projection ownership). It also records the five owner-protected account emails and the owner-confirmed classification of old Firebase operational records as development dummy data.

The draft explicitly preserves unresolved owner/accounting/clinical gates, especially medicine unit/fraction policy, returned medicine disposition, package/service refund rules, expense self-approval, petty cash classification, supplier credit/payment, shift verifier, refund payout, non-cash recognition, opening stock/HPP, timestamps, patient/audit retention, authentication provenance and split supplier receipts. It is a design amendment, not owner sign-off or DDL. No TiDB runtime compatibility test, application DDL, Firebase snapshot/cleanup or production change has occurred.


## Q. FK/index reconciliation pass 2 — 2026-11-15

See [MYSQL_MIGRATION_FOREIGN_KEY_INDEX_RECONCILIATION_PASS2.md](./MYSQL_MIGRATION_FOREIGN_KEY_INDEX_RECONCILIATION_PASS2.md). The latest static pass confirms that the canonical FK/type/index manifest is still incomplete and schema v1 remains blocked. Key blockers include the encounter/invoice ownership chain, same-parent invoice component and batch allocation constraints, component-aware return quota identity, supplier payment/return ownership, queue guard integration, reversal/idempotency semantics, shift reconciliation versioning, and unresolved split supplier receipts. No DDL or TiDB runtime test is authorized or claimed. The pass is proposal-level only; exact SQL types, charset/collation, nullability, child index order and delete/update actions must still be normalized per FK.


## R. Normalized dictionary and FK manifest — pass 3

The column type-family dictionary and 99 numbered FK manifest entries (F01–F99) are captured in [MYSQL_MIGRATION_NORMALIZED_COLUMN_DICTIONARY_FK_MANIFEST_PASS3.md](./MYSQL_MIGRATION_NORMALIZED_COLUMN_DICTIONARY_FK_MANIFEST_PASS3.md). Some entries bundle multiple individual FK tuples, so the earlier 104-relationship count still requires a field-by-field expansion; the first Pass 6 draft's claim that F100–F104 were missing has been withdrawn. See [Pass 6 FK type/ownership reconciliation](./MYSQL_MIGRATION_FK_TYPE_OWNERSHIP_RECONCILIATION_PASS6.md) for its preliminary first-tuple comparison and unresolved supplemental-table, composite ownership, index/action and nullable-pair blockers. Schema v1 remains blocked. This remains isolated migration-branch documentation.


## S. Exact column dictionary and signedness reconciliation — pass 4

The static physical dictionary is recorded in [MYSQL_MIGRATION_EXACT_COLUMN_NULL_DEFAULT_DICTIONARY_PASS4.md](./MYSQL_MIGRATION_EXACT_COLUMN_NULL_DEFAULT_DICTIONARY_PASS4.md): 56 base tables and 566 extracted columns. It preserves source `UNSIGNED` modifiers and leaves unspecified NULL/default attributes unresolved. An initial parser falsely dropped `UNSIGNED`; that finding has been corrected and withdrawn. Remaining bare signed integer fields require semantic/range review, especially monetary values, and every FK pair still needs exact type matching. Schema v1 remains blocked; no DDL, TiDB runtime validation, Firebase/Auth changes, production deployment, or PR13 merge occurred.


## T. NULL/default completeness matrix — pass 5

The specification gap matrix is in [MYSQL_MIGRATION_NULL_DEFAULT_COMPLETENESS_MATRIX_PASS5.md](./MYSQL_MIGRATION_NULL_DEFAULT_COMPLETENESS_MATRIX_PASS5.md): 56 base tables / 566 columns, with 65 nullability declarations and 535 defaults still unspecified in the current proposal. These remain explicit blockers; no implicit engine defaults or guessed NULL behavior may be used. Prioritize encounter/invoice ownership, batch nullable-pair semantics, actor provenance and lifecycle states. Migration remains documentation-only; Firebase/Auth and production are unchanged.


## U. Schema scope control and anti-overfitting — pass 8

See [MYSQL_MIGRATION_SCHEMA_SCOPE_CONTROL_PASS8.md](./MYSQL_MIGRATION_SCHEMA_SCOPE_CONTROL_PASS8.md). Apply evidence-first scope: do not add generic abstractions or speculative tables solely for hypothetical future cases. Preserve the confirmed single-clinic, A/B queue, role and financial/inventory workflows; defer conditional event, guard, outbox, partial-receipt and file-job tables unless source or owner evidence establishes v1 necessity. This does not relax core ownership, money, stock, return, idempotency or audit invariants. Documentation-only; no DDL or data mutation.


## V. Critical ownership chain matrix — pass 9

See [MYSQL_MIGRATION_CRITICAL_OWNERSHIP_CHAIN_MATRIX_PASS9.md](./MYSQL_MIGRATION_CRITICAL_OWNERSHIP_CHAIN_MATRIX_PASS9.md). Preserve exact ownership across cashier/shift, invoice/encounter, medicine/batch/movement, return quota and supplier finance. Tests are targeted to real business invariants rather than exhaustive hypothetical combinations. No schema/data mutation.


## W. Decision and requirement traceability closure — pass 10
See [MYSQL_MIGRATION_DECISION_AND_TRACEABILITY_CLOSURE_PASS10.md](./MYSQL_MIGRATION_DECISION_AND_TRACEABILITY_CLOSURE_PASS10.md). The pass maps confirmed clinic workflows to domains, invariants and acceptance proofs; separates engineering closure from owner policy and source-verification gates; and applies anti-overfitting rules to conditional tables. It does not authorize DDL, Firebase/Auth changes, cleanup, production deployment, main merge or PR13 merge.


## X. Source-verified workflow findings — pass 11
See [MYSQL_MIGRATION_SOURCE_VERIFIED_WORKFLOW_FINDINGS_PASS11.md](./MYSQL_MIGRATION_SOURCE_VERIFIED_WORKFLOW_FINDINGS_PASS11.md). This source pass adds evidence for mixed medicine units, local purchase-to-batch creation, FEFO date handling, supplier-return capping, sales-return quota and batch restore logic, weighted-average HPP, local audit truncation, demo seed behavior and stale hard-coded account defaults. It records required backend behavior and unresolved source gates without changing Firebase/Auth, production or application code.


## Y. Return/refund/cancellation state-machine audit — pass 12
See [MYSQL_MIGRATION_RETURN_REFUND_CANCELLATION_STATE_MACHINE_PASS12.md](./MYSQL_MIGRATION_RETURN_REFUND_CANCELLATION_STATE_MACHINE_PASS12.md). The source audit traces return quota reservation/release, Admin/Pimpinan stages, stock restoration, payout, cancellation conflict checks and invoice-time quota initialization. It records the current whole-package return granularity and the need for a shared invoice lock in SQL. It does not authorize any Firebase/Auth or production change.
