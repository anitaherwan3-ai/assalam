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
