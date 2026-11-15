# MySQL Migration — Permission Matrix and Acceptance-Test Catalogue

Date: 2026-11-15  
Baseline: `main` Firestore Rules and backend; PR #13 is separately labelled reference-only.  
Status: design input only; no SQL DDL, API code, production writes or data migration.

## A. Identity and authorization principles

1. The API must authenticate every request. Never trust a client-supplied role, email, cashier ID or owner flag.
2. Resolve an immutable internal user ID and active role from a server-controlled profile. For temporary Firebase Auth compatibility, verify the Firebase ID token signature, issuer, audience, expiry and revocation as appropriate, then map UID/email to the active profile.
3. Owner accounts are the two Pimpinan identities. Their internal IDs are stable and must never be removed by seed/reset/restore logic.
4. Staff profiles must be active, email-matched and role-limited to Admin/Kasir. Staff may not edit their own role, active status, internal ID or auth binding.
5. UI menu visibility is not an access control. Every API endpoint and every field mutation must enforce authorization and invariants server-side.
6. Audit sensitive changes with actor, role, entity, action, before/after or structured diff, timestamp and request/idempotency ID.

## B. Resource-level permission matrix (baseline Rules)

Legend: R=read, C=create, U=update, D=delete, constrained=only explicitly allowed state/field transition, —=not allowed.

| Resource | Kasir | Admin | Pimpinan |
|---|---|---|---|
| users | R self only | R self only | R all; C/U staff provisioning; D only designated staff docs |
| pasien | R; C; U constrained own workflow; no D | R; U done=false constrained; no C/D | R/C/U/D |
| trx | R; C own cashier through atomic POS; U timestamp only | R; U controlled cancellation metadata | R/C/U/D subject to approved command semantics |
| batalTrx | R; C own pending request; U resubmit own rejected | R; U pending → approved/rejected | R; U decision; D |
| shift | R; C own open shift; U own close/timestamp only | R; U verify closed shift | R/C/U/D |
| petty | R; C/U own constrained description/amount; D own | R | R/C/U/D |
| obat | R; no C/D; U stock decrement only | R/C/U/D | R/C/U/D |
| batch | R; no C/D; U remaining qty decrement only | R/C/U/D | R/C/U/D |
| tarif, paket | R | R/C/U/D | R/C/U/D |
| beli, returBeli, biaya, loss | — | R/C/U/D | R/C/U/D |
| returKuota | R; reserve/increment only with own pending return + new invoice quota | R; release quota only in rejected return workflow | R/C/U/D |
| returJual | R; C own pending; U timestamp-only while pending | R; first-stage verify/reject | R; final decision and refund payment; D |
| log | C own; U only restricted timestamp sync | R/C under rules | R/C/U/D |
| clinic config | R | R; manage validated audio clips and only TV setting fields | R/C/U/D general config |
| queue audio | R | C/U/D valid clip IDs and MP3 metadata/data | C/U/D |
| queue display mode (PR13) | R/W A or B when authorized | Not explicitly granted in PR13 branch summary | R/W A or B |

Important nuance: broad Pimpinan Rules permissions do not mean the new API should expose unrestricted generic CRUD. Prefer explicit business commands and immutable history.

## C. Required server commands and atomic boundaries

| Command | Authorized actor | Required checks and transaction boundary |
|---|---|---|
| Login/session resolve | All | Token verified; profile active; resolve role/internal ID. |
| Provision/update staff account | Pimpinan | Validate role/email uniqueness; preserve stable internal ID; audit; never delete master owners. |
| Create patient/queue | Kasir/Pimpinan | Operational date WIB; allocate unique queue sequence; verify prefix/shift ownership; persist patient and queue event atomically. |
| Edit patient demographics | Owning Kasir/Pimpinan | Only name/HP; patient not completed/deleted; immutable ID/queue/date/shift/cashier. |
| Call patient | Owning Kasir/Pimpinan | Patient active, not completed/cancelled/deleted; atomically set selected call and clear prior active call for same queue context. |
| Mark Batal Berobat / restore | Owning Kasir/Pimpinan | Separate transitions; no completed patient; reason/actor/time; preserve patient record. |
| Handover patient (PR13 candidate) | Current owner Kasir or Pimpinan | Target cashier differs; target shift open and same business date; reason; preserve patient ID/number; append handover event and update current assignment atomically. |
| Open/close shift | Kasir own shift; Pimpinan | One active shift policy; opening modal non-revenue; close totals reconcile; record physical/system cash and difference. |
| Verify shift | Admin/Pimpinan | Closed shift only; actor/time; prevent duplicate or unauthorized edits. |
| POS commit | Kasir own shift; Pimpinan | Idempotency key; lock patient, shift, medicine and batches; check FEFO availability; write invoice snapshots, payment, batch/aggregate stock deductions, patient done, return quotas and audit in one DB transaction. |
| Purchase receive | Admin/Pimpinan | Validate qty/value/batch/expiry; create purchase, batch, stock ledger and weighted-average HPP update atomically. |
| Pay purchase | Admin/Pimpinan | Verify outstanding amount; payment event; prevent duplicate payment; partial payment support must be explicitly decided. |
| Supplier return | Admin/Pimpinan | Return against originating invoice/batch only; quantity <= remaining purchased and available batch; adjust stock/HPP/payable and append supplier return event atomically. |
| Stock opname/loss/expiry | Admin/Pimpinan | Reason, counted quantity, delta, batch selection, approval policy; ledger event and stock balance update atomically. |
| Expense request/approval | Admin/Pimpinan | Separate requester and approver where applicable; amount threshold setting; no self-approval policy to decide; approval and cashflow event atomic. |
| Submit sales return | Owning Kasir/Pimpinan | Original invoice and itemIndex exist; not cancelled; no active cancellation; quota lock/reserve; calculate amount from invoice snapshot and discount allocation server-side; derive batch restoration from original deductions; create pending request and audit atomically. |
| Admin return review | Admin | Only pending; verify data; forward to Pimpinan or reject; rejection releases reserved quota atomically; no stock restoration at first stage. |
| Final return decision | Pimpinan | Only Admin-verified pending; final approve/reject; approval creates refund obligation and restores correct stock/batches exactly once; rejection releases quota. |
| Refund payment | Pimpinan | Only approved unpaid refund; amount fixed to approved return; Tunai/Transfer; transfer reference mandatory; payment event/idempotency prevents double pay. |
| Cancel invoice request | Owning Kasir | Invoice not cancelled; no non-rejected return; reason; one pending request; create request atomically. |
| Cancel invoice decision | Admin/Pimpinan | Pending request only; cancellation conflicts with active return; on approval update invoice/patient and restore stock/batches exactly once; decision and ledger/audit same transaction. |
| Manage master/config | Admin/Pimpinan per field matrix | Fixed clinic name; Admin TV-only settings; Pimpinan general settings; validate ranges and file/media references. |
| Export/backup/restore | Permission to decide | Export scopes by role; encrypted/versioned backup; restore dry-run, validation, protected owner identities, duplicate prevention, atomic restore and audit. |

## D. Candidate state transitions

- Patient: active → completed; active → Batal Berobat → active; active → deleted/archive by Pimpinan; handover is an assignment event, not a new patient.
- Shift: open → closed → verified. Whether reopening or post-verification adjustment is allowed remains an explicit decision.
- Return: pending → Admin-forwarded pending_pimpinan → Pimpinan approved/rejected. Approved → refund pending → refund paid. Rejection releases quota. Do not restore stock twice.
- Cancellation: pending → approved/rejected; a rejected request may be resubmitted by the same cashier. Active return and pending cancellation must be mutually exclusive.
- Purchase: received/unpaid → payment outstanding → paid; supplier return reduces eligible outstanding amount. Partial payment behavior requires confirmation.
- Expense: requested → approved/rejected; define threshold and separation-of-duties policy before implementation.

## E. Acceptance-test catalogue (synthetic data only)

No tests below are claimed to have run. These are required scenarios for the isolated Preview environment.

### Authentication and authorization
- Missing, expired, invalid-audience, revoked and wrong-project tokens are rejected.
- Inactive staff, email mismatch, unknown profile and client-forged role are rejected.
- Kasir A cannot mutate Kasir B patient/shift/petty/return; Admin cannot access Pimpinan-only user/config actions; Pimpinan accounts remain intact.
- Staff cannot promote self, alter own email binding/role/internal ID, or delete owner accounts.

### Patient and queue
- Concurrent Kasir registrations never duplicate queue number.
- A and B have independent sequences; legacy A numbers remain ordered and readable.
- Calling one active patient clears prior active call only in the correct queue context.
- Completed, deleted or Batal Berobat patients cannot be called or edited through demographic endpoint.
- Batal Berobat/restore are reversible only through allowed transitions.
- Handover preserves patient ID and queue number; target must have open same-day shift; event history records each handover.
- Logout guard checks current pending patients at server before sign-out (PR13 feature if approved).

### Shift and finance
- One cashier cannot open conflicting active shifts if policy disallows it.
- Modal awal shift never increases omzet.
- Cash/non-cash sales, petty cash, refunds, physical cash, system cash and difference reconcile.
- Admin verification cannot alter cashier's original close figures.
- WIB operational date is stable around UTC midnight.

### POS and inventory
- Duplicate POS request/idempotency key cannot create duplicate invoice or deduct stock twice.
- Concurrent sales cannot oversell aggregate or batch stock.
- FEFO chooses earliest non-expired batch; expired/empty batch is excluded.
- Package medicine components decrement correct batches and snapshot deductions.
- Patient completion, invoice, stock, batch, quota and audit either all commit or all roll back.
- Historical receipt remains unchanged after medicine/tariff/HPP master changes.
- Number parsing rejects NaN, negative, infinity and invalid precision; all monetary arithmetic uses integer rupiah.

### Purchase, supplier return, expiry and opname
- Weighted average HPP recalculates correctly after receipt.
- Batch belongs to exact purchase; supplier return cannot exceed original remaining qty or batch balance.
- Paid invoice keeps historical purchase total while payable adjustment is represented separately.
- Unpaid/partially paid invoice balance reconciles after supplier return and payments.
- Expiry/loss/opname records ledger delta, reason, actor and batch impact.

### Sales return and cancellation
- Return quantity cannot exceed original line qty cumulatively, including simultaneous requests.
- Discount allocation uses deterministic largest-remainder rounding; returned amount equals original charged net line amount.
- Service return has no stock restoration; medicine/package return restores only original deducted batches.
- Admin review does not restore stock; Pimpinan final approval restores once.
- Rejection releases reserved quota; rejected request can be resubmitted without quota leak.
- Refund amount immutable; transfer requires reference; duplicate refund rejected.
- Cancellation blocked while active return exists; return blocked while cancellation pending.
- Approved cancellation restores stock and patient state exactly once; repeated decision is idempotent.

### Finance, reports, backup and media
- Net omzet, gross sales, approved returns, HPP, gross profit, operational expenses and net operational profit reconcile to ledger.
- Return approval date affects revenue; actual payment date affects cashflow.
- Debt aging uses due date and outstanding balance.
- CSV/PDF export filters, encoding and totals reconcile with UI.
- Backup is versioned and restore dry-run flags invalid/missing references; owner profiles cannot be deleted.
- Queue MP3 file type/size/clip ID validated; object storage authorization enforced; chime remains independent from voice clips.
- TV A/B mode selection syncs across devices; digit-by-digit spoken announcement; YouTube/local video/health-tip fallback and running text remain functional.

### Multi-device and resilience
- Two Kasir plus Admin/Pimpinan see permitted changes in realtime.
- Offline browser cannot overwrite newer server stock/financial state when reconnecting.
- Concurrent update conflicts are surfaced or retried safely; no silent last-write-wins on financial or inventory records.
- Server failure halfway through a transaction leaves no partial state.
- Audit events identify actual actor and are not client-editable.

## F. Decisions still required before schema approval

1. Confirm which PR13 behaviors are approved product requirements, especially logout guard and handover.
2. Confirm expense self-approval policy and threshold behavior.
3. Confirm whether purchase invoices support partial payments and how payment history is recorded.
4. Confirm shift reopen/adjustment process after Admin verification.
5. Confirm whether archive is soft-delete, and who may restore it.
6. Confirm backup/restore role policy and retention.
7. Confirm object storage provider for MP3, logo and video files.
8. Confirm auth transition: Firebase Auth token verification temporarily or a replacement auth system.

Schema design must wait until these decisions and the field-level audit are reviewed.
