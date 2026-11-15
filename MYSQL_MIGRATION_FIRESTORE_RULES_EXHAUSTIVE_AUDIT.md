# FIRESTORE RULES — EXHAUSTIVE STATIC AUDIT
Date: 2026-11-15
Source: `main/firestore.rules`
Source blob SHA: `d02b6d02c13bc85f867b668085edb85c54726779`
Length: 416 lines
Scope: static inspection only. No Firebase writes, Rules deployment, runtime emulator tests, TiDB DDL, production changes or patient-data access.

## 1. Executive conclusion

The Rules implement a role hierarchy using Firebase Authentication email plus a staff profile document. Most collections have explicit role gates, but the Rules are not a complete replacement for server-side business validation. Some create/update paths accept client-supplied business values without enough field-level or cross-record validation. MySQL must implement explicit commands and derive all trusted values server-side.

Default Firestore behavior denies unmatched paths, but the matched paths below still contain permissive or incomplete business constraints.

## 2. Identity helpers and trust model

- `initialOwner()`: trusts authenticated token email if it equals `praktekrose@gmail.com` or `nursalim42@gmail.com`; does not require an owner profile document or profile active flag.
- `ownerDocId()`: maps the two owner emails to `praktekrose` and `pimpinan2`.
- `staffProfileExists()/staffProfile()`: loads `k_users/{auth token email}`.
- `staffActive()`: requires profile email to equal token email, active=true and role in admin/kasir.
- `signedIn()`: owner allowlist OR active staff.
- `pimpinan()`: owner allowlist.
- `adminOrPimpinan()` and `kasirOrPimpinan()`: active staff role or owner.

### Findings
1. Owner authority is rooted in immutable-looking email allowlist, not a DB role/profile. New backend should use stable user IDs and DB role assignments after verifying the Firebase ID token; maintain a protected owner bootstrap allowlist during transition.
2. Staff profile document ID is email, coupling identity to mutable email. MySQL must use immutable user_id and a separate verified email history table.
3. Staff profiles require active/email/role checks for most operations, but the `k_users` read rule lets any authenticated user read a document whose path equals their token email without checking active profile. This exposes only their own profile, but should be explicitly decided in API session policy.
4. Rules rely on role predicates but generally do not bind the authenticated UID to an explicit immutable staff UID for every action. New API must resolve actor from verified token and server-side profile; ignore client role, email, cashier ID and owner claims supplied in request body.
5. Owner email changes cannot be handled by simply editing a profile document because the allowlist and document mapping are hard-coded. Plan a separately audited owner-identity migration.

## 3. Collection-by-collection rules matrix

| Path | Read | Create | Update | Delete | Key constraints / gaps |
|---|---|---|---|---|---|
| `klinik_config/{document}` | signedIn | Owner except audio; Admin/Owner audio with validation | Owner broad; Admin/Owner audio; Admin display subset | Owner all; Admin/Owner audio | Owner can change any non-audio config fields; admin display update only `set.youtubeVideoId`, `enableYoutubeDisplay`, `runningTextDisplay`; nested `set` assumptions require validation. |
| `k_users/{document}` | Owner all; authenticated user own doc | Owner only, fixed owner docs or three fixed staff emails | Owner only, constrained owner/staff identity fields | Owner only, but only three fixed staff docs | No general staff provisioning; staff cannot edit own profile. Owner update allowlist is key values but not full keysOnly validation. |
| `k_log/{document}` | Admin/Owner | signedIn; staff u must match | Owner unrestricted; staff own log may change only `_t` | Owner | Staff append-only-ish; Owner can rewrite/delete logs. New audit should be immutable/append-only with break-glass audited retention. |
| `k_pasien/{document}` | signedIn | Owner or active Cashier; id must match | Several narrow state/contact/calling transitions | Owner | Create has no full field allowlist or strong identity/date/shift/queue validation. Contact update checks done/deleted/status but no comprehensive type/length/format. Calling update checks bool but no event/version/idempotency. |
| `k_trx/{document}` | signedIn | Owner or active Cashier; id, cashier, patient existence and getAfter patient.done=true | Cashier/Owner timestamp only; Admin/Owner cancellation status transition if cancellation doc pending | Owner | Create does not enforce strict keys/values, totals, item snapshots, payment, discount, batch allocation, shift ownership/open status, patient eligibility or server-derived price/HPP. |
| `k_batalTrx/{document}` | signedIn | active Cashier; id/trxId match, pending, own cashier | Admin/Owner pending→approved/rejected; Cashier can resubmit own rejected request | Owner | Admin/Owner decision field allowlist exists but values/actor/time semantics not all validated; resubmission can change selected fields without strict reason/attempt history. |
| `k_shift/{document}` | signedIn | Owner or Cashier own shift, status buka, modal number >=0 | Owner unrestricted; Cashier own shift limited fields; Admin verifies closed shift | Owner | No DB-level one-open-shift guarantee in Rules; close values sistem/fisik/selisih are client supplied; transition permits status buka→buka; Admin verification does not bind `oleh` to profile or require only false→true. |
| `k_petty/{document}` | signedIn | Owner or Cashier own; ket nonempty, jml>0, tgl string | Owner unrestricted; Cashier own ket/jml | Owner or Cashier own | No required shift binding, upper bounds, allowed keys, immutable date/shift validation, or append-only correction. |
| `k_obat/{document}` | signedIn | Admin/Owner | Admin/Owner unrestricted; Cashier/Owner can only decrease/non-increase stok and keep >=0 | Admin/Owner | Cashier path prevents increase but does not prove decrease is tied to a valid sale/return/correction. Owner bypasses all restrictions. |
| `k_tarif/{document}` | signedIn | Admin/Owner | Admin/Owner unrestricted | Admin/Owner | No field allowlist/type/price constraints. |
| `k_paket/{document}` | signedIn | Admin/Owner | Admin/Owner unrestricted | Admin/Owner | No component schema/stock composition validation. |
| `k_batch/{document}` | signedIn | Admin/Owner | Admin/Owner unrestricted; Cashier/Owner may only decrease sisa, >=0 | Admin/Owner | No FEFO, expiry, medicine ownership, qty/sisa relation or sale-linked movement validation. |
| `k_beli/{document}` | Admin/Owner | Admin/Owner | Admin/Owner | Admin/Owner | Entire write permitted to Admin/Owner; no immutable purchase snapshots/payment history constraints. |
| `k_biaya/{document}` | Admin/Owner | Admin/Owner | Admin/Owner | Admin/Owner | Entire write permitted; approval threshold, self-approval, decision actor/time and post-approval reversal are not enforced here. |
| `k_loss/{document}` | Admin/Owner | Admin/Owner | Admin/Owner | Admin/Owner | Entire write permitted; stock/batch/valuation consistency and reversal are not enforced here. |
| `k_returKuota/{document}` | signedIn | Owner or Cashier creating initial zero quota with matching ID and after-write invoice | Owner; Cashier increments quota if paired with matching pending return; Admin/Owner release quota for rejected return | Owner | Sophisticated pairing, but no complete immutable source-line snapshot/locking guarantee; all validation must be atomic in SQL. |
| `k_returJual/{document}` | signedIn | Cashier/Owner pending with quota pairing, invoice not cancelled and cancellation absent/rejected | Admin first review/forward or reject; Owner final approve/reject and payout; Cashier own pending timestamp only | Owner | Rules constrain state and some fields, but not a complete schema/value validation of requested qty, total, item snapshot, method, HPP, returnable item kind or batch restoration. |
| `k_returBeli/{document}` | Admin/Owner | Admin/Owner | Admin/Owner | Admin/Owner | Entire write permitted; no cap against purchase/batch/stock, credit note or payment separation. |

## 4. Important path-level findings

### 4.1 Config and audio
- Audio document IDs are restricted to known names: notification, prefix, suffix, letter_A-Z, digit_0-9, counter_umum, counter_gigi.
- Audio payload requires exact keys, type `queue_audio_clip`, audioData string <=820500 chars, sizeBytes >0 and <=614400, filename <=120, MIME audio/mpeg, numeric updatedAt, string updatedBy.
- Admin/Owner can create/update/delete audio; the Rules do not bind updatedBy to authenticated staff identity.
- Owner can create/update/delete arbitrary non-audio config. Admin can update only the three display settings under `set`, but create behavior for non-audio config is not equivalent to the update restriction: Admin cannot create non-audio docs through that branch.
- Future design: object storage for audio; SQL stores key, MIME, byte size, checksum, uploader, version. Validate uploader server-side. Separate fixed clinic identity from editable settings.

### 4.2 Patient and queue
- Patient create only checks role and matching document id; no strict schema or queue sequence uniqueness.
- Contact edit allows only nama/hp/_t and blocks done/deleted patients.
- Batal Berobat requires not done, not deleted, status not deleted; writes status, cancellation actor, time and calling=false.
- Restore requires current status batal_berobat and sets status aktif, clears cancellation metadata.
- Calling toggle only checks bool and patient not done/cancelled/deleted.
- Rules do not allocate a unique queue number or enforce queue prefix/day concurrency. MySQL must use a counter row locked by business_date+prefix and unique constraint; call/recall should be separate events, not just mutable bool.

### 4.3 Sales checkout
- Cashier create checks patient exists and after-write patient.done=true; invoice id matches path and cashier equals profile.u.
- It does not check patient is the right day's active encounter, shift is open/owned, invoice number uniqueness, line items, arithmetic, discount, tender, payment method, FEFO, batch ownership/expiry, stock sufficiency, HPP or allowed keys.
- Firestore atomic batch/transaction can ensure writes are co-committed, but Rules cannot replace domain logic. The backend currently uses a transaction but accepts client-provided transaction and stockChanges; MySQL must rederive authoritative values on server and lock relevant rows.

### 4.4 Shift and cash
- Cashier open checks id, own cashier ID, status buka and modal >=0.
- Cashier update may modify status/jamT/sistem/fisik/selisih/verif/_t within an allowed set; status may remain buka or become tutup, and close requires verif=false. No check that sistem equals server-derived expected cash or selisih equals fisik-sistem.
- Admin verification requires status tutup and verif=true, but does not require prior verif=false or validate `oleh` matches the Admin. The update key allowlist includes verif, oleh, _t.
- Pimpinan bypasses all shift restrictions.
- New API must derive expected drawer cash from ledger, capture counted cash, lock shift, enforce one open shift per cashier and append verification event with actor/time.

### 4.5 Petty cash, expenses and loss
- Cashier petty cash creation checks owner, amount >0, nonempty description and date string, but not shift ID validity/ownership, category, amount maximum or duplicate/idempotency.
- Cashier can edit description/amount and delete own petty cash. Owner can fully rewrite/delete. This is incompatible with robust audit; new system should use correction/reversal events.
- Expense and loss collections grant full read/write to Admin/Owner. The expense approval threshold and approver provenance are not enforced by Rules; loss inventory effects must be atomic and tied to batch.
- New API must enforce approval threshold and self-approval policy, use reversal after posting, and link every loss to batch movement.

### 4.6 Returns and cancellation
- Cancellation request creation requires Cashier, own cashier ID, matching id/trxId, pending status.
- Admin/Owner may approve/reject pending request with constrained keys. Cashier may resubmit their own rejected request with selected fields.
- Invoice status update to dibatalkan is allowed only for Admin/Owner when matching cancellation request is pending. The actual workflow must ensure request decision and stock restoration happen atomically.
- Return quota is per invoice line: Cashier can add qty only when a matching pending return is created in same atomic write; Admin/Owner can release quota on rejection.
- Return submission checks quota linkage, invoice not cancelled and cancellation request absent/rejected.
- Admin moves pending→menunggu_pimpinan or rejects. Pimpinan finalizes approval/rejection; approval requires refund status menunggu and nominal equal to request total. Pimpinan records payout separately, with Tunai/Transfer, transfer reference and exact nominal, and cannot pay again once status changes.
- Key gap: the Rules compare refund nominal to client-provided `resource.data.total`; they do not themselves prove that total was calculated from immutable invoice line and proportional discount. Server must derive amount.
- Rules do not comprehensively validate returned qty, line index bounds, item kind, HPP, batchRestores, service-vs-medicine stock semantics, exact quota source, or duplicate payment/idempotency. Server must lock invoice line/quota and derive all values.
- Local ClinicStore behavior differs from cloud staged workflow; use the stricter staged cloud process as migration baseline, subject to final owner decisions.

## 5. Priority gaps to close in MySQL API

P0 — must be enforced before any real data or cashier use:
1. Server-resolved actor and role; never trust client actor fields.
2. Strict schema/field allowlist for every command.
3. Shift ownership/open status and one-open-shift uniqueness.
4. Patient encounter eligibility, queue counter locking and unique queue ticket.
5. Checkout arithmetic, discount, price, HPP, FEFO batch allocation and stock all server-derived.
6. Atomic transaction across invoice, patient status, stock/batches, cash/bank ledger and audit.
7. Return quota locking, exact net refund derived from invoice snapshot, service-vs-medicine behavior, no double payment.
8. Cancellation/return mutual exclusion and one-time stock restoration.
9. Append-only finance/inventory/audit ledger and reversals.
10. Owner protection from deletion, demotion, deactivation, seed/restore overwrite.

P1 — required for reliable operations:
1. Strict date/time/decimal/length/enum validation and idempotency.
2. Admin/Owner approval actor and server timestamp binding.
3. Purchase/supplier-return limits and credit note/payment accounting.
4. Queue display read projection, privacy minimization and scoped TV token.
5. Audio asset storage outside SQL, metadata/checksum and size validation.
6. Pagination and narrow read APIs rather than whole-collection listeners.
7. Audit retention and export/backup role checks.

## 6. Differences between legacy Rules and target permission policy

- Keep role split: Cashier submits returns; Admin reviews; Pimpinan final approves/pays. Do not collapse to Admin auto-approval.
- Keep Cashier ownership on shift, petty cash, patient registration and invoice creation.
- Replace generic Admin/Owner writes to purchases, expenses, losses, tariffs, packages and batches with explicit command endpoints and field-level validation.
- Cashier stock decrement is not an authorization to write arbitrary stock; only a successful checkout command may post stock movement.
- Calling/display access must not grant broad patient write access.
- Owner full override should be replaced by audited break-glass commands, while preserving master owner recovery path.
- Staff profile/email updates must use immutable user ID plus verified email lifecycle, not email-as-document-ID.

## 7. Required negative/security tests

- Unauthenticated, inactive staff, wrong-email profile, unknown role and stale token.
- Cashier1 attempts to act as Cashier2 by changing `kasir`, `u`, email or role in body.
- Cashier closes/edits another cashier's shift; opens second shift concurrently.
- Cashier writes stock/batch without valid checkout command.
- Client tampers price, HPP, qty, discount, total, method, payment, batch allocation or patient ID.
- Checkout uses completed/cancelled/wrong-day patient or closed/other cashier shift.
- Duplicate checkout request and concurrent last-unit sale.
- Return over original qty, duplicate line selection, invalid itemIndex, cancelled invoice, return/cancellation race.
- Service return attempts to restore stock; medicine return restores wrong batch.
- Admin attempts final return approval/payment; duplicate transfer payment; missing transfer reference.
- Expense self-approval, approval under wrong threshold, edit/delete after approval.
- Loss with wrong batch/medicine or negative stock.
- Display token attempts to read patient phone or write patient/stock/invoice.
- Backup restore attempts to delete/demote master owners or overwrite live data.

## 8. What has NOT been verified

- Rules Emulator test suite and deployed Rules version.
- Runtime behavior of every multi-document operation against these Rules.
- Whether deployed Cloud Functions exist outside this repository.
- Historical Firestore documents' complete union of keys/types and malformed legacy records.
- Whether PR13's Rules are deployed; PR13 is still open/unmerged on GitHub.
- Real patient data, production Firebase contents or backups.

## 9. Next audit sequence

1. Complete historical data compatibility audit from source normalizers, seed/reset, backup/restore and all collection callsites.
2. Resolve Cloud Functions source/deployment provenance before auth migration.
3. Produce final field dictionary with observed aliases, nullable/type profile and required transformation.
4. Review business policy gaps before writing schema DDL.
5. Only then build isolated schema and synthetic test fixtures.

## Safety status
This report is static source analysis only. No Firestore Rules were changed/deployed. No production data was read or written. No SQL DDL or real-data migration occurred.
