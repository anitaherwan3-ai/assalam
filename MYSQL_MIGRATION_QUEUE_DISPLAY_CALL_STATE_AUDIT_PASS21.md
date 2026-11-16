# Queue, Calling, and Display State Audit — Pass 21

**Scope:** static source inspection of the migration branch only. No runtime, concurrency, Firebase data, or TV-device test was executed.

## Inspected source
- `js/app.js` SHA `f74c4710161ddd2af230e51c18b1f107d6c52c82`
- `js/store.js` SHA `99e74acf8caec9c70d82be1d5f6efc5bfa6bc4fb`
- `js/firebase-backend.js` SHA `3a613d96564f120b8141966f9ecbae21471c4e65`
- `js/helpers.js` SHA `8fd9d89a1e7da5947a92c1dcb2c2bd41e313c690`
- `display.html` SHA `798e11e37cef1498bbc361b4c76474a85a71a9ca`

## Confirmed findings
1. Registration currently generates only prefix A. `registerPatientWithQueueNumber` queries same-day `k_pasien`, finds the largest A number, then uses a deterministic candidate document ID and Firestore transaction to avoid duplicate document IDs. It has no queue-type parameter or B counter.
2. Queue number formatting is `A` plus a padded integer; the current display uses this same queue record as patient/visit identity. The source does not establish independent A/B sequences.
3. Calling is initiated by `ClinicStore.callPatient` as a local state mutation. It clears other locally loaded active calls for today's WIB date, sets `calling=true`, logs, saves and broadcasts. There is no dedicated server transaction that atomically enforces one active call across all cashier devices.
4. Generic sync later patches selected patient fields, including `calling`, using client `_t` comparison. This is not equivalent to a server-side queue-call lock or ordered call event.
5. `BroadcastChannel('klinik_queue_channel')` communicates between tabs/windows in the same browser context. It is not a cross-device transport. Cross-device display depends on Firestore snapshots.
6. TV display has Firestore-backed queue rendering and a BroadcastChannel fast path. It filters today's rows and separates waiting, calling and done display states. The display does not establish a queue A/B selector or independent lane rendering in the inspected implementation.
7. Display status is projected from mutable fields (`calling`, `done`, `status`); re-call overwrites the previous call state. There is no first-class call-attempt history in the queue row model.
8. Cancellation and reactivation mutate the same visit document; reactivation clears cancellation timestamp/actor. Archive uses soft-delete fields. This does not preserve an immutable lifecycle timeline.
9. The source uses Asia/Jakarta for some queue date decisions, but queue timestamps include device-generated values and some operational date/time writes elsewhere use UTC/device-local formatting. Target business-date derivation must be server-owned.

## Target requirements
- Queue lane/type is an explicit controlled value (A/B) and must be selected/derived according to the clinic's confirmed policy.
- Allocate number by clinic-local date + queue type in a server transaction; enforce unique (business_date, queue_type, sequence) and idempotent registration.
- Model current call projection separately from append-only call attempts; server transaction enforces any active-call rule.
- Keep registration, call, recall, cancel, reactivate, complete and no-show events attributable to actor/time/device.
- TV display reads authorized server projections/events; local BroadcastChannel may remain an optimization only.
- Preserve exact legacy queue number and source queue ID in migration crosswalk.

## Open owner-policy decisions
- Does A/B mean separate service rooms, service classes, or selectable streams?
- Can A and B each have an active call simultaneously, or is there one clinic-wide active call?
- Who may select/change lane, and is transfer after registration allowed?
- Does "done" mean payment completed, treatment completed, or both? Current UI labels done as "Lunas" while display describes served/completed.
- What is the expected recall/no-show behavior?

## Synthetic tests required
- Two concurrent registrations on same lane/date; two lanes independently; rollover at WIB midnight; retries/idempotency; number formatting past 999.
- Two cashiers call simultaneously; recall same patient; call cancelled/done patient; call update on another device and TV.
- Reconnect after offline interval; stale local cache must not roll back a newer server state.
- A/B transfer and active-call policy scenarios after owner decision.

## Status
Static source audit only. No runtime/concurrency/TV-device test, schema DDL, Firebase mutation, import, deployment, merge or production change. A/B policy and call semantics remain open.
