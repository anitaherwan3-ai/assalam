# Settings, Audit Log, Export, and Backup Integrity Audit — Pass 24

**Scope:** static source inspection only; no backup file was generated/restored, no live records or production settings were read.

## Inspected source
- `js/app.js` SHA `f74c4710161ddd2af230e51c18b1f107d6c52c82`
- `js/store.js` SHA `99e74acf8caec9c70d82be1d5f6efc5bfa6bc4fb`
- `js/firebase-backend.js` SHA `3a613d96564f120b8141966f9ecbae21471c4e65`
- `js/export-helper.js` SHA `e383d719ba72dc391636444d772305ef9d412b2d`
- `index.html` SHA `7f9fbbb202c0fd346eb40b3e93d01c9427bdfad2`

## Confirmed findings
1. Clinic name is hard-coded in local settings hydration and UI as Klinik Assalaam Palembang. Other settings include logo, address, phone, receipt footer, owner WhatsApp, display text/video, approval threshold, expiry warning and receipt layout.
2. Display TV settings have a dedicated Admin/Pimpinan backend method that writes only selected display fields. General settings otherwise use local store + generic collection synchronization.
3. Audit log is generated in the browser from current client user identity and device clock. Date is UTC-derived while time is device-local. The log array is capped at 1,000 entries by dropping the oldest local entry.
4. Staff logs are pushed only when marked pending and are written with `merge:false`, but the overall source still allows local state to create/alter client-side audit entries. This is not a server-authored immutable audit ledger.
5. CSV/PDF export generators read the client-side loaded store. Patient export is visit/shift oriented; transaction export does not apply the full on-screen filter/cancellation semantics (Pass 17). Log export reads only the locally loaded/capped log array.
6. JSON backup serializes the entire local store state. Restore validates only that `obat` and `users` exist, then replaces the entire local state and invokes sync. It does not validate schema version, per-collection shape, references, hashes, provenance, or protected-account exceptions.
7. Restore therefore must not be used as a migration/import mechanism or executed on a live account without a separately tested isolated restore plan.
8. The current source does not establish a backup retention policy, encryption-at-rest for downloaded JSON, restore-point catalogue, integrity hash, or verified restore drill.
9. Generic settings/data sync can merge client state into cloud collections; the final MySQL service must distinguish configuration commands from operational data commands and apply server-side role/field authorization.
10. User/account lifecycle and role provisioning blockers remain as Pass 18; this pass does not authorize changes to the five protected accounts.

## Target requirements
- Server-authored append-only audit events with actor UID, role, request ID, server timestamp, action, entity, before/after or redacted diff, and source.
- Separate audit event storage from mutable UI activity feed; feed may be a projection with retention limits, ledger must not silently truncate.
- Versioned settings with allowlisted fields and role-scoped update commands; clinic name remains fixed.
- Server-side exports with explicit date basis, filters, cancellation/return semantics, permission checks and generated-at metadata.
- Versioned, integrity-checked encrypted backups; documented retention and tested restore into isolated environment.
- Strictly validate restore/import manifests and foreign-key closure; never overwrite protected auth identities through operational backup restore.
- Keep secrets/credentials out of backup exports; review Firebase config and environment separation before cutover.

## Synthetic tests required
- Forged client audit entry, altered timestamp, actor spoofing and attempted log deletion.
- Audit retention/archival with no silent loss of authoritative history.
- Restore malformed JSON, wrong schema version, missing collections, dangling FKs, wrong clinic identity, protected-account mismatch.
- Backup checksum mismatch, partial backup, restore drill and rollback.
- Export permission matrix and parity with reports; settings field allowlist and clinic-name immutability.

## Status
Static source audit only. No backup/restore, live settings read, runtime test, DDL, import, Firebase/Auth mutation, deployment, merge or production change.
