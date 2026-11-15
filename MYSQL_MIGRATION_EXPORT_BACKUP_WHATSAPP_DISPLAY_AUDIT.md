# MySQL Migration — Export, Backup/Restore, WhatsApp and Display Integration Audit

Status: read-only source audit. No application code changes, Firebase writes, SQL DDL, production changes or real patient-data migration were performed.

## 1. Source baseline

Repository: `anitaherwan3-ai/assalam`, branch `main` (read-only).
- `js/export-helper.js` SHA: `e383d719ba72dc391636444d772305ef9d412b2d` (267 lines)
- `js/helpers.js` SHA: `8fd9d89a1e7da5947a92c1dcb2c2bd41e313c690` (371 lines)
- `js/store.js` SHA: `99e74acf8caec9c70d82be1d5f6efc5bfa6bc4fb`
- `js/app.js` SHA: `f74c4710161ddd2af230e51c18b1f107d6c52c82`
- `js/firebase-backend.js` SHA: `3a613d96564f120b8141966f9ecbae21471c4e65`
- `display.html` SHA: `798e11e37cef1498bbc361b4c76474a85a71a9ca`
- `index.html` SHA: `7f9fbbb202c0fd346eb40b3e93d01c9427bdfad2`

This is an audit of observed legacy behavior, not a declaration that these exports/backups are safe or complete.

## 2. Export/report inventory

### Reports present in ExportHelper
- Transaksi: line-level invoice items (date, invoice, patient, cashier, method, item, type, qty, price, subtotal).
- Pasien: date, queue number, name, phone, service, done/waiting status.
- Pembelian: date, supplier, invoice, medicine, qty, total, due date, paid status and payment date.
- Biaya: date, category, description, amount, approval status.
- Kas Kecil: date, cashier, description, amount.
- Stok Obat: medicine, unit, HPP, sale price, aggregate stock, minimum and low-stock status.
- Kedaluwarsa: medicine, batch number, expiry date, remaining qty and expiry warning.
- Log Aktivitas: timestamp, user, action, category and detail.
- Paket Pelayanan: package name, description, components and package price.
- Separate stock card CSV is generated from purchase, sale, sales return, supplier return and loss arrays.

CSV uses UTF-8 BOM and quotes cell strings; PDF uses jsPDF + autoTable. Export is generated from browser-local `store.state`, not an authoritative server query.

## 3. Important export defects / risks

1. **Patient PII export**: patient CSV/PDF includes patient name and phone. There is no per-report server permission check or field minimization in ExportHelper. New API must enforce role, purpose and scope, and audit every export/download.
2. **CSV formula injection**: quoting and doubling quotes does not prevent spreadsheet formulas. User-controlled values beginning with `=`, `+`, `-` or `@` (including leading whitespace/control characters) must be neutralized before CSV export. This applies to patient names, descriptions, supplier names, logs and item names.
3. **Stale/local-only reporting**: reports read local state. A device may be offline, stale, or not yet synced, so reports can disagree across devices. New reporting must query a consistent server-side snapshot and include generation timestamp, filter range, timezone and source scope.
4. **Transaksi report includes cancelled invoices**: current generator filters only by date, not invoice cancellation status. It exports gross line subtotals and does not subtract approved returns/refunds. It must distinguish gross sales, cancellations, approved returns and net revenue.
5. **Patient report status is incomplete**: it maps only `done` to “Lunas / Selesai” and otherwise “Menunggu”; it does not explicitly represent Batal Berobat, archived/deleted, calling, or other encounter states. The migration should export normalized encounter/queue states.
6. **Log report ignores date filter**: `Log Aktivitas` does not apply the supplied date range and exports all locally retained logs. Server audit retention and export filters must be explicit.
7. **Expiry date uses UTC**: report computes “today” via `new Date().toISOString()`, which can differ from Asia/Jakarta business date near midnight. Use server business date in `Asia/Jakarta`.
8. **Stock card is a reconstructed ledger**: it derives movement history by scanning separate arrays, not from a canonical inventory ledger. It starts balance at zero, so the running balance is not guaranteed to equal actual stock. It can double-count a sales return if both `batchRestores` and `items` exist. Its assumptions about purchase and supplier-return `items[]` do not match the audited canonical single-item purchase/return payload shape (`oid,qty,batchId` etc.), risking missing movements. This report must be rebuilt from immutable inventory movements with opening balance and batch linkage.
9. **No complete finance report**: current report list does not export net omzet, HPP, gross/net profit, cash-on-hand, refund obligations/payouts, supplier payable aging, or reconciliation across cash/bank. Do not treat the existing CSV/PDF list as complete financial reporting.
10. **Filename/date consistency**: filenames use UTC ISO date while business dates are WIB. Standardize report date labels and filenames to Asia/Jakarta.
11. **CSV card export has a separate implementation**: `exportKartuStok()` builds CSV independently from ExportHelper, so both paths must be secured and reconciled; do not patch only the shared helper.

## 4. Backup and restore — high-risk behavior

Observed:
- `downloadBackup()` serializes the entire browser `store.state` to JSON and downloads it.
- The state contains the 16 operational arrays plus settings, sequence/cache fields and Firebase config state. It can contain patient PII, invoices, user profiles, logs, batches, returns, cancellation requests and local pending-sync metadata.
- `restoreBackup(file)` parses JSON and validates only that `data.obat` and `data.users` are truthy.
- After a browser confirmation, it directly assigns `this.store.state = data`, then `saveLocal(true)`. The latter stores to localStorage and triggers general Firebase push if connected.
- No schema version, checksum/signature, full type validation, preview, dry-run, selective restore, conflict resolution, duplicate-ID checks, date-range checks, role check in the helper, or master-owner preservation is enforced in this method.
- The confirmation is not an authorization boundary. Restore may overwrite local state and, when cloud-connected, may attempt a push into Firebase under the current user's permissions. Firestore Rules may reject some writes, but partial batches/collection failures are possible.

Migration requirements:
1. Browser JSON backup must not be considered the official clinic backup.
2. Provide server-side scheduled encrypted backups with retention, offsite copy, checksum, access log and tested restore procedure.
3. Provide an owner-authorized restore workflow with preview, dry-run, schema version, checksum, validation report, selective scope, conflict report and explicit final confirmation.
4. Restore must never delete, downgrade, deactivate or replace master Pimpinan identities. Protect stable user IDs and preserve audit history.
5. Do not restore directly into live operational tables as an unvalidated JSON overwrite. Restore into staging tables or a quarantined snapshot, reconcile, then execute a controlled atomic promotion.
6. Patient data and backups require least-privilege access, encryption in transit/at rest, retention and secure deletion policy.
7. Legacy backup import should map each of the 16 arrays explicitly, quarantine unknown fields, preserve IDs/timestamps and record import source. No silent default/demo reseeding over real records.
8. Add export/restore job records: requester, approver, scope, start/end, result, checksum, source backup, record counts and failure details.

## 5. WhatsApp receipts and shift recap

### Patient receipt
- `sendReceiptWA(trx, settings)` formats a receipt with clinic details, invoice, patient, cashier, line items, total and payment method; for cash it includes amount received and change.
- It constructs a `https://wa.me/{number}?text=...` URL and calls `window.open`.
- This does not send a WhatsApp message automatically. It opens WhatsApp with a prefilled message; a human must review and press Send.
- Receipt UI blocks sending for cancelled invoices and asks for a phone number if missing; it stores that number on the local invoice object.

### Shift recap
- `sendShiftRecapWA(shift, store)` calculates recap from local state and opens a `wa.me` URL. The cashier must press Send. It is not an automated server-to-server notification.
- The recap currently calculates sales totals by summing `trx.total` per shift and splits Tunai vs non-Tunai. It does not exclude cancelled invoices or subtract approved returns/refunds in this helper. This can overstate recap omzet after cancellation/return.
- It calculates drawer system cash from stored `shift.sistem` or modal + cash sales - petty cash, and reports physical cash and difference. Preserve separation: opening modal belongs to cash-on-hand, not omzet.
- The current close-shift UI closes local shift and saves before opening the WhatsApp composer. WhatsApp open/send success must not be a prerequisite for shift closure.
- Copy/re-send actions recalculate the recap from current local state, so later edits can change the message for an already-closed shift. New design should use an immutable close snapshot.

Migration requirements:
- Generate receipt and shift recap from authoritative committed invoice/shift/ledger snapshots.
- Clearly label the action “Buka WhatsApp untuk dikirim” rather than “terkirim otomatis” unless a real approved WhatsApp Business integration is installed and delivery receipt is confirmed.
- If true automatic messaging is required later, use an approved provider/WhatsApp Business API, consent/opt-out handling, template policy, delivery status, retries, rate limits and audit. Do not store provider secrets in browser code.
- Use an outbox event after shift close; notification failure must not roll back the close.
- Store the exact immutable recap snapshot or version so resend/copy produces the same numbers.
- Apply the same net omzet, cancellation, approved return and actual refund-payout logic as the finance ledger.

## 6. Display TV, real-time listeners and patient privacy

Observed:
- Display page loads Firebase app/firestore/auth SDKs and uses the same Firebase Authentication session as the main application.
- It listens to `klinik_config/settings`, all `queue_audio_clip` documents and the full `k_pasien` collection using realtime snapshots.
- The TV page then filters current-day patient queue locally and displays names, queue numbers, service/poli and waiting count.
- It also loads local `klinik_data` from localStorage and can show logo/config from local state.
- Queue audio clips are base64 MP3 documents, up to 600 KB each, and are downloaded to every display listener.

Risks / requirements:
1. The TV should not need unrestricted access to the entire patient collection or patient phone numbers/other clinical fields. Build a dedicated display read model/API with only queue number, display name (or masked name per clinic policy), service, status, call timestamp and display mode.
2. Prefer a short-lived, read-only display credential/token scoped to the clinic and display channel, not reuse a general staff session indefinitely. Define revocation and device registration.
3. Keep A/B mode, queue switching, call announcement and spoken-digit behavior; do not expose patient administration fields to TV.
4. Audio bytes should live in object storage/CDN with versioned metadata, size/type/checksum. The display should fetch only selected clips and cache safely.
5. Verify listener cleanup, reconnect behavior, snapshot replay, duplicate announcements, call event ordering and no audio replay on A/B mode switching.
6. Display mode changes must be authorized and versioned; TV reads the selected mode but cannot change settings unless specifically authorized.

## 7. Firebase configuration and migration boundary

- Main app loads Firebase SDKs from CDN; `firebase-config.js` provides client configuration. Firebase web API key is not a server secret, but backend service credentials and TiDB password must never be included in client files or exported settings.
- Legacy `saveConfig(cfg)` persists a Firebase config object into local state; `disconnect()` signs out, clears local config and resets local sync state. This is legacy infrastructure control, not normal clinic settings.
- MySQL connection details belong only in Vercel server environment variables. Do not create a client-side form for TiDB host/user/password.
- The Vercel API must validate request origin/CSRF policy as appropriate, verify identity token, rate-limit sensitive endpoints and never expose database errors or secrets.

## 8. Required tests before any production cutover

### Exports
- CSV formula-injection payloads in patient name, item, supplier, note and log fields are neutralized.
- Role-based report access and column minimization; Kasir cannot bulk-export all patients/financial data unless explicitly authorized.
- Date range and timezone are consistent; logs honor filters.
- Cancelled invoices and approved returns are reflected correctly in gross/net reports.
- Stock card equals opening stock + all signed ledger movements and reconciles to batch/aggregate stock; no duplicate return or missing purchase/return movement.
- Export snapshots are stable across devices and have actor/time/scope audit records.

### Backup/restore
- Invalid JSON, wrong schema, tampered checksum, duplicate IDs, missing arrays, wrong field types and oversized uploads are rejected safely.
- Dry-run reports exact adds/updates/skips/conflicts without writing.
- Restore never removes master Pimpinan or audit trail; role and approval are checked server-side.
- Simulate failed restore mid-process and verify atomic rollback/staging isolation.
- Test backup encryption, offsite copy, retention and full restore to isolated test environment.

### WhatsApp
- Receipt uses original invoice snapshot; cancelled invoice cannot be sent as paid receipt.
- Shift recap excludes cancelled invoices and accounts for approved returns/refund payout consistently.
- Opening modal excluded from omzet but included in drawer cash.
- WhatsApp unavailable, popup blocked or user cancels sending: shift remains closed and message status is not falsely shown as delivered.
- Re-send after later data changes uses the original immutable close snapshot or clearly labels a regenerated version.

### Display
- Display cannot read patient phone, medical detail or unrelated staff data.
- Expired/revoked display token is denied; only display API fields are returned.
- A/B switch, queue calls, digit-by-digit speech, separate chime, fallback speech, reload/reconnect and duplicate prevention pass across multiple devices.

## 9. Remaining inventory checklist

- [x] Main operational collections and source fields.
- [x] Backend command paths and role/Rules crosswalk.
- [x] UI callsites and business workflows.
- [x] Export/report, backup/restore, WhatsApp and display integration audit.
- [ ] Final exhaustive pass over every backend public method and every Firestore collection/query, including less-visible maintenance/diagnostic utilities.
- [ ] Full historical payload compatibility and alias mapping.
- [ ] Confirm policy decisions (export roles, restore authority, retention, display masking, WhatsApp automation consent, financial report definitions).
- [ ] Only after the above: propose normalized schema/DDL and migration rehearsal using synthetic data.

No production deployment, Firebase mutation, schema DDL or real-data migration is included in this audit.
