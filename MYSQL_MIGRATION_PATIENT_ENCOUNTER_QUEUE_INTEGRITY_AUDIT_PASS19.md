# Patient, Encounter, and Queue Integrity Audit — Pass 19

**Scope:** static source inspection only; no live Firebase reads and no runtime/concurrency test.
**Branch:** `migration/tidb-foundation`
**Source blobs inspected:**
- `js/app.js` — `f74c4710161ddd2af230e51c18b1f107d6c52c82`
- `js/store.js` — `99e74acf8caec9c70d82be1d5f6efc5bfa6bc4fb`
- `js/firebase-backend.js` — `3a613d96564f120b8141966f9ecbae21471c4e65`
- `index.html` — `7f9fbbb202c0fd346eb40b3e93d01c9427bdfad2`

## Executive findings

1. **Queue implementation currently allocates A only.** `registerPatientWithQueueNumber` scans today's documents for `A-?digits`, scans local cache for the same A pattern, and returns `A###`. There is no corresponding B prefix, independent A/B counter, or queue-type argument in the inspected registration call. The separate A/B TV switching requirement is therefore not represented by this registration path.
2. **Number allocation has a useful uniqueness mechanism, but only partial proof.** The backend queries server-side patients for the date, then runs a Firestore transaction that probes deterministic candidate document IDs `q_YYYYMMDD_NNNNNN`; a candidate document is created in the transaction. Concurrent creation of the same candidate should conflict/retry under Firestore transaction semantics. This was not stress-tested. Legacy records whose displayed number is A-prefixed but whose document ID is not in the deterministic pattern are included in the max scan.
3. **Registration is online-only and button-guarded.** The UI disables the submit button while awaiting the backend and refuses offline registration. The backend validates the date string and role. No explicit duplicate-patient identity check by phone/name is visible in this path; repeat visits are represented as new patient/queue documents, not a demonstrated stable patient master + encounter split.
4. **Queue calling is a local-state operation followed by sync/broadcast.** `callPatient` clears other active calls for the same WIB date across the loaded local patient array, then marks the selected patient calling and broadcasts. No server transaction atomically enforces one active call across devices. Two devices can therefore race or hold stale local state until synchronization.
5. **The state model is boolean-heavy.** Display derives status from `status === batal_berobat`, `done`, and `calling`; other patients appear waiting. There is no single validated lifecycle enum or explicit called-at/served-at event history in the inspected workflow.
6. **Batal Berobat is reversible and preserves the patient row.** Kasir can cancel an unserved patient; the code clears calling, records time/actor and syncs. Kasir can reactivate only same-day cancelled visits. Pimpinan can archive an unserved patient by soft-delete fields; the code says data/history remain. This supports preserving visit history, but status transitions are mutable fields rather than append-only events.
7. **Checkout validates local encounter state but backend linkage checks are incomplete in the inspected method.** UI requires a currently called, not-done, non-cancelled patient and an open cashier shift; invoice copies patient ID/name, cashier and shift. In `commitCashierTransaction`, however, a missing patient snapshot does not cause rejection, and the visible checks do not verify patient is still active/called, nor that invoice patient ID, cashier and shift match authoritative patient/shift records. It updates patient done only when patient exists, then writes invoice and return quotas. This is a critical integrity gate for MySQL.
8. **Patient completion and invoice creation are atomic with stock/quota in the Firestore transaction when patient exists.** The transaction checks invoice idempotency, reads patient, medicine and batch documents, validates stock, updates stock/batch, marks patient done if present, writes invoice and per-line return quota. No separate encounter record exists in the inspected code.
9. **Invoice number generation is local-count based.** The UI builds `NYYYYMMDD-####` from the length of the locally loaded transaction array + 1. It is not an authoritative concurrent allocator and can collide across cashiers/devices; invoice document ID is separately generated with `uid()`. MySQL should use a transactionally allocated sequence or unique number policy.
10. **Queue date uses Asia/Jakarta, but displayed time is device-local.** Date is refreshed from the clinic timezone before registration, while `jam` uses `new Date().toTimeString()`; this can disagree if device timezone is misconfigured.

## Source evidence

| Area | Evidence in inspected source |
|---|---|
| Registration UI | `js/app.js` lines 800–856: online-only, disabled submit, patient payload, backend allocation, local duplicate guard by allocated ID |
| Patient queue table | `js/app.js` lines 621–655: today-only list, done-first sorting, status derived from fields, call/edit/cancel actions |
| Cancellation/recovery/archive | `js/app.js` lines 882–936: Kasir cancel/reactivate, Pimpinan soft archive |
| Checkout validation | `js/app.js` lines 1414–1428: active shift and called-patient checks |
| Invoice construction | `js/app.js` lines 1550–1587: invoice patient/cashier/shift snapshots, local invoice number, completion |
| Local call | `js/store.js` lines 352–382: reset active calls in local state, mark selected call, broadcast |
| Atomic registration | `js/firebase-backend.js` lines 1012–1076: date scan, A-only max, deterministic candidate ID and transactional create |
| Atomic checkout | `js/firebase-backend.js` lines 1079–1139: idempotency, patient/stock reads, stock decrement, conditional patient completion, invoice and quota writes |

## Confirmed design constraints for MySQL

- Separate **patient master** identity from **encounter/visit**. Repeat attendance should create a new encounter; it must not create a new patient master merely to allocate a queue number.
- Each encounter must own one clinic-local business date, queue category/prefix (A or B), sequence number, registration timestamp, registering cashier, optional shift, patient master, service/clinic workflow status.
- Unique constraint candidate: `(business_date, queue_type, queue_number)`; allocate sequence under a database transaction/locked sequence row or equivalent TiDB-safe atomic mechanism. Never derive next number from a client cache or `MAX()+1` without serialization.
- Preserve existing queue numbers and legacy encounter IDs during import; duplicate or malformed numbers should be quarantined for review, not silently renumbered.
- Define a server-authoritative encounter state transition policy: waiting → called → in_service/checkout_ready → completed; cancelled/no_show/reactivated transitions explicitly permitted and audited. Do not assume the clinic wants a separate in-service state until confirmed.
- If only one active call per queue type is desired, enforce it server-side per date and queue type. If one active call across all queues is desired, enforce that instead; source currently clears all calls in the loaded local array, not by A/B type.
- Checkout command must lock/validate encounter, patient, shift and cashier ownership; require encounter status eligible for checkout; verify the submitted patient/encounter/shift/cashier tuple; insert invoice and lines; decrement medicine/batches; mark encounter completed; create return quotas — all in one transaction.
- Use immutable visit/encounter history. Patient master archival must not cascade-delete encounters, invoices, or clinical/financial history.
- Invoice display number must be uniquely allocated server-side independently from opaque invoice primary key.

## Blockers / decisions

### Engineering blockers
- A/B queue is not modeled in the current registration path; A/B switching requirement is not backed by two independent queue streams.
- Server-side one-active-call invariant is absent from the inspected local call path.
- No explicit patient deduplication/master identity strategy is evidenced.
- Checkout backend does not reject missing patient and does not visibly verify encounter state and ownership tuple.
- Invoice number can collide under concurrent cashier registration.
- Mutable booleans/status fields do not preserve a complete transition history.
- Registration and call times mix clinic-local date and device-local time.

### Owner policy to confirm before schema freeze
- What exactly distinguishes queue A and B (service type, doctor, room, or another category)?
- Should one patient be allowed to switch queue category after registration? If yes, preserve original queue number/history or issue a new encounter queue allocation?
- Is the one-active-call rule global, or one active call per queue category?
- Should re-call preserve the same queue number and record each call attempt?
- Does a completed visit mean invoice paid, service completed, or both? The current UI treats invoice completion as `done`.
- Is same-day cancelled visit reactivation allowed indefinitely, and should the original sequence be retained? Source currently reactivates same record/number only for today's visit.

## Synthetic test plan (not executed)

1. Two cashiers register simultaneously into A on the same date: unique consecutive queue allocations; no duplicate document/number.
2. Two cashiers register simultaneously into B: independent sequence and no A/B collision.
3. A and B receive registrations interleaved: each stream increments independently.
4. First registration after midnight Asia/Jakarta while browser stays open: correct business date.
5. Device timezone differs from Asia/Jakarta: date and display time remain consistent.
6. Retry same registration request after network timeout: no duplicate encounter or second queue number (requires idempotency key).
7. Repeat patient phone/name: one patient master, distinct encounter IDs and queue numbers.
8. Two devices call different patients simultaneously: server invariant prevents conflicting active call according to chosen policy.
9. Re-call same patient: same encounter/queue number, distinct call event.
10. Cancel while waiting; confirm patient disappears from active queue but history remains.
11. Cancel while called; active call is cleared on all devices.
12. Reactivate same-day cancelled encounter; original sequence remains and audit event appended.
13. Archive a patient master with historical encounters/invoices: no history cascade.
14. Checkout with missing patient ID: reject, no invoice/stock change.
15. Checkout with patient ID not matching encounter: reject.
16. Checkout with closed/foreign cashier shift: reject.
17. Checkout after another cashier completed/cancelled encounter: reject as stale.
18. Concurrent checkout for same encounter: only one invoice and one stock decrement.
19. Invoice number allocation across two cashiers: unique.
20. Failed checkout after stock validation: rollback invoice, encounter status, stock, batches and quotas together.
21. Import legacy queue records with A-prefixed and malformed numbers: deterministic reconciliation report, no silent renumbering.
22. Restore/archive workflows preserve patient, encounter, invoice and queue audit references.

## Safety / completion status

- Static source inspection and documentation only.
- No Firebase patient data or live queue documents read.
- No Firebase Auth/Firestore mutation, rules change, DDL, data import, production deployment, main merge, or PR13 merge.
- No runtime or concurrency tests were executed. The conclusions above are source findings and design requirements, not a production test pass.
