# Patient, Queue & Display — Legacy Contract and TiDB Target Gates (Pass 52)

**Branch:** `migration/tidb-foundation`  
**Status:** source/behavior contract; not schema approval  
**Production:** Firebase and live queue unchanged  
**Latest CI evidence:** run #31 — 56 tests passed before this documentation-only pass.

## 1. Confirmed product constraints

- Preserve patient visit history; “Batal Berobat” is preferred over deleting a visit without treatment.
- Queue display must support separate A/B views and switching.
- Spoken queue numbers are read digit-by-digit (for example A-001: “A, kosong, kosong, satu”).
- Customizable spoken voice and notification chime are separate settings/assets.
- MP3 enhancement remains a follow-up item and must not block the core database migration.
- The TV display gets a minimal projection only; it must not expose patient phone numbers or unrestricted patient/clinical records.

## 2. Legacy source findings — not all behavior is a target requirement

| Area | Observed legacy behavior | Target treatment |
|---|---|---|
| Registration | Inspected backend registration path allocates A-prefixed numbers only; no separately proven B registration sequence in that path | Implement server-owned per-date/per-prefix sequence only after source/owner lane semantics are closed |
| Local call | `ClinicStore.callPatient()` clears all other active calls for the same WIB date from the local state, regardless of A/B | Characterized by a synthetic test; do not assume this is the desired multi-lane rule |
| Cross-device call | Local reset + realtime sync is not an atomic server lock | Introduce server-owned active-call guard(s) and immutable call events after owner selects global vs per-lane exclusivity |
| Date/time | Business date is calculated in Asia/Jakarta in some paths; parts of legacy timestamps use device local time or UTC ISO date | Persist server UTC instant plus explicit clinic business date; never trust device timezone |
| Re-call | State is primarily boolean `calling`; complete event history is not proven | Preserve same queue ticket and append call/recall events with idempotency |
| Cancellation | Same-day “Batal Berobat” can be restored by Kasir when not completed; Pimpinan archives with soft-delete fields | Preserve and audit lifecycle; do not hard-delete encounters or queue history |

## 3. Required relational concepts (candidate only)

- patient master: stable identity, not one row per visit;
- encounter: one clinic visit with original cashier/shift, status, operational date and history;
- queue prefix/counter: sequence allocation by clinic business date and lane;
- queue ticket: one encounter's stable number;
- queue call event: append-only call, recall and cancel-call history;
- display config: sanitized A/B/combined/switch mode and running text;
- queue audio asset metadata: clip ID, MIME, byte count, checksum, storage object key and version. Store audio bytes in private object storage, not SQL rows.

A/B counter uniqueness candidate: `(business_date, prefix, sequence_no)`. A retry with the same idempotency key must return the original ticket, not allocate another number.

## 4. D16 owner-policy gate remains open

Already known: A/B view switching and cashier lane selection are required.

Still not safe to guess:
1. Whether A and B represent cashier shifts, service types, rooms or another operational lane.
2. Whether one active announcement may exist globally or independently per lane.
3. Whether a patient can transfer lanes after registration and, if so, whether the original queue number is retained.
4. Whether a recall preserves the same ticket (recommended) and how simultaneous re-calls are serialized.
5. Exact meaning of “completed” relative to service delivery and payment.

Do not merge PR13 or copy its lane mapping without separate review and regression evidence.

## 5. Audio/display handling

- Current legacy configuration identifies separate notification, prefix/suffix, letter/digit and counter clips.
- Store object storage key, checksum, MIME, size, version, update actor/time and soft-delete state in SQL.
- Upload validation must enforce allowed clip ID, MP3 MIME/size, checksum and role. Audio bytes remain outside SQL.
- The display endpoint receives only the currently approved queue call, public ticket number, sanitized display mode, running text and non-sensitive media metadata.
- Announcements need event IDs so reconnecting TVs do not replay the same queue call accidentally.
- Keep spoken-number voice clips customizable separately from the notification chime.

## 6. Synthetic acceptance tests

1. Two simultaneous registrations on the same prefix/date receive unique sequence values.
2. A and B registrations interleaved do not collide.
3. Asia/Jakarta midnight rollover is correct even with a device in another timezone.
4. Network retry does not create a second patient, encounter or ticket.
5. Same patient returning creates a new encounter without duplicating the patient master.
6. A/B active-call exclusivity follows the final approved policy across two devices.
7. Re-call keeps the correct ticket number and appends a new call event.
8. Cancel/restore does not erase the visit or queue history.
9. Archive by Pimpinan is reversible and does not cascade-delete encounters/invoices.
10. TV reconnect does not replay stale announcements or expose patient phone/clinical fields.
11. Voice clip and chime can be independently changed and restored.
12. A-001 is spoken as “A, kosong, kosong, satu”; B numbers follow the same digit-by-digit rule.

**Disposition:** source evidence and synthetic local characterization can proceed. Queue A/B concurrency schema, lane mapping and production UI cutover remain blocked by D16 and source verification.
