# Patient Identity, Visit History, and Continuity Audit — Pass 20

**Scope:** static source inspection only. No live patient data, Firestore reads, runtime tests, or migration execution.
**Branch:** `migration/tidb-foundation`
**Inspected source blobs:**
- `js/app.js` — `f74c4710161ddd2af230e51c18b1f107d6c52c82`
- `js/store.js` — `99e74acf8caec9c70d82be1d5f6efc5bfa6bc4fb`
- `js/firebase-backend.js` — `3a613d96564f120b8141966f9ecbae21471c4e65`

## Executive findings

1. **Patient identity and visit/queue are currently conflated.** A new queue registration creates a new `k_pasien` document containing name, phone, service, queue number, business date, cashier, shift, and visit status. The document ID is the queue record ID, not a stable patient-master ID.
2. **Existing-patient autocomplete is a convenience, not identity resolution.** It scans loaded visit/queue rows, groups by normalized `nama + hp`, and fills only name and phone into the new registration form. It does not select or persist a canonical patient ID. Same person with changed phone/name can fragment; different people sharing a name/phone can be incorrectly conflated in suggestions.
3. **No clinical medical-record model is evidenced in the inspected application source.** The patient/queue form contains name, phone, service, date/time, cashier and shift. The inspected visit workflow does not capture DOB, address, sex, identity document, allergy, diagnosis, examination, prescription/clinical note, provider, or follow-up as a structured longitudinal record. This audit must not invent or imply those features exist.
4. **Patient edit mutates the visit row.** `editPasien` updates only `nama` and `hp` on the selected patient/queue document. There is no canonical master record to update once for all visits, and no field-level edit history beyond general activity log.
5. **Visit lifecycle and historical facts share mutable fields.** `done`, `calling`, `status`, `batalBerobatPada`, `batalBerobatOleh`, `deletedAt`, and `deletedBy` are stored on the queue/patient document. Reactivation clears cancellation timestamp and actor, so the previous cancellation event is not retained as a first-class immutable event.
6. **Archive is soft-delete, not patient master archival.** Pimpinan can set `status='dihapus'`, `deletedAt`, and `deletedBy` on an unserved visit row. The UI message says history remains; the inspected source does not implement cascading deletion. Because there is no stable master/visit separation, the operation is effectively archiving a queue/visit record, not a distinct patient master.
7. **Invoice stores patient snapshots and visit linkage.** Checkout creates `trx.pid` from the queue document ID and copies patient name and phone into the invoice. It also stores cashier and shift IDs. This preserves a useful invoice-time snapshot but the patient ID refers to the visit/queue row, not a stable patient identity.
8. **Checkout backend can persist an invoice even if the patient document is missing.** The transaction reads the patient, but only marks it done if the snapshot exists; it does not throw when missing. It also does not visibly validate that the invoice patient, active encounter, cashier and shift form a consistent ownership tuple. This remains a critical referential-integrity blocker (also identified in Pass 19).
9. **Patient export is shift/visit reporting, not a longitudinal patient register.** PDF export selects queue records by `p.sh === shift.id`, includes name, phone, service, queue number and derived status. It does not export a consolidated patient master or medical history.
10. **Autocomplete is limited by locally loaded data.** The suggestion function scans `store.state.pasien`, deduplicates by name+phone, and returns at most eight matches. There is no dedicated server-side patient search or canonical matching endpoint in this inspected function.
11. **Current source uses no stable demographic identifier.** Phone is optional and name is required. No NIK or other government identity field is captured in this workflow. A MySQL migration must not manufacture a patient match from name alone.
12. **Local storage bootstraps operational demo master data when arrays are empty.** `loadLocal` seeds medicine, batch, tariff, users and packages; it does not seed patients in the shown logic. Production MySQL migration/bootstrap must remain separate from this local demo seeding behavior.

## Source evidence

| Area | Evidence |
|---|---|
| Patient/visit form payload | `js/app.js` lines 797–856: name, optional phone, service, date/time, cashier, shift, registration timestamp, queue allocation |
| Existing-patient autocomplete | `js/app.js` lines 4164–4216: loaded visit rows grouped by name+phone; only name/phone are copied into the form |
| Patient edit | `js/app.js` lines 867–879: updates name and phone on one visit row |
| Cancellation/reactivation/archive | `js/app.js` lines 882–936: mutable status/timestamps; archive marks row deleted |
| Shift patient PDF | `js/app.js` lines 700–795: export by shift ID with queue/visit fields |
| Invoice construction | `js/app.js` lines 1510–1595: invoice `pid` points to selected queue row; copies name/phone, cashier and shift |
| Local collection model | `js/store.js` lines 132–159: one `pasien` collection, no distinct patient master/encounter collection |
| Cloud queue creation | `js/firebase-backend.js` lines 1012–1075: writes visit-like queue row into `k_pasien` with queue ID |
| Cloud checkout | `js/firebase-backend.js` lines 1079–1139: reads queue row, conditionally marks it done, writes invoice and stock/quota changes |

## Target MySQL model implications

### Required separation

- **Patient master:** stable internal patient ID; demographic/contact fields; created/updated metadata; archive/merge state where needed.
- **Encounter/visit:** stable encounter ID; patient master ID; clinic-local business date/time; service/queue type and number; cashier and shift; workflow status; cancellation/reactivation facts; source legacy queue ID.
- **Invoice:** encounter ID plus patient master ID (or a controlled derivation from encounter); preserve invoice-time name/contact snapshot for historical receipt accuracy; cashier/shift references validated by server.
- **Clinical record:** do not create a full medical-record subsystem merely because this is a clinic. First establish the clinic's actual scope. If diagnosis, examination, prescription, allergy, provider, and follow-up are required, model those explicitly with appropriate access controls and audit trail; otherwise keep them out of schema v1.
- **Identity matching:** use exact stable internal IDs for relationships. Name/phone matching may produce suggestions only; never silently merge records or use a fuzzy match as a foreign key.
- **Patient duplicate resolution:** provide a reviewed merge/link workflow only if required. Preserve original IDs and an auditable mapping; never delete historical encounters or invoices when resolving duplicate masters.
- **Historical snapshot:** preserve name/phone/service as recorded at registration and name/phone as printed on invoice. A later master-data edit must not rewrite historical receipts or encounter facts.
- **Soft archive:** archive patient master separately from encounter. Prevent new registration if policy requires, but retain access to past visits and invoices according to role and retention policy.
- **Visit events:** cancellation, reactivation, call attempts, completion and archive should be append-only event records or equivalent immutable audit entries; current state can be a projection.
- **Referential integrity:** invoice.encounter_id must reference a real encounter; invoice.patient_id must match encounter.patient_id; encounter.shift_id and cashier identity must be valid and consistent. Reject checkout if any referenced entity is missing, closed, cancelled, or not eligible.
- **Legacy mapping:** each legacy `k_pasien` row maps to one encounter. Patient master identity is not reliably derivable from current fields; import must initially preserve one provisional master per legacy row unless a safe, separately reviewed identity-resolution process establishes a match. Do not auto-merge based only on name/phone.

## Data migration and reconciliation controls

1. Extract all legacy `k_pasien` rows with stable source document ID and full raw payload; preserve source IDs.
2. Extract all `k_trx` rows and link using exact legacy `pid` to source patient document ID; report invoices with missing patient references.
3. Validate each visit's `sh` against shift source ID and `kasir` against expected user identity; quarantine unresolved links rather than guessing.
4. Preserve original queue number, date, service, registration timestamp, cancellation/archive fields and `_t`.
5. Do not infer unique person from name alone or normalize away distinctions in phone numbers without retaining original value.
6. Generate deterministic migration crosswalks: legacy patient-row ID → encounter ID; legacy patient-row ID → provisional patient master ID; legacy invoice ID → invoice ID.
7. Produce duplicate-candidate report (normalized name/phone) for manual review only; never merge automatically.
8. Compare source and target counts, per-day/per-shift queue counts, invoice linkage counts, cancelled/archived counts, and orphan counts before cutover.
9. Keep Firebase source unchanged and available for rollback until reconciliation and acceptance complete.

## Blockers / decisions

### Engineering blockers
- Current `pasien` collection is visit-like, not a stable patient master.
- No explicit encounter table/model exists in inspected client store.
- No structured medical-record/clinical note model is evidenced.
- Autocomplete uses name+phone and does not retain a patient master ID.
- Visit edits mutate the queue row and have no immutable field history.
- Cancellation/reactivation overwrite current state and clear prior cancellation metadata.
- Invoice foreign key points to queue row; backend permits missing patient document.
- Patient export is per-shift queue output, not a longitudinal patient register.
- Legacy patient-to-invoice/shift/cashier relationship integrity requires a full source-data reconciliation; no live data was read.

### Owner policy gates before schema v1 freeze
- Does the clinic need only registration and billing history, or a full electronic medical record?
- Which patient demographics are actually required (e.g., DOB, address, sex, emergency contact, identity number)? Do not collect fields without a defined operational need.
- Is phone optional? What alternative is used when a patient has no phone or shares a family phone?
- Should duplicate patient candidates be resolved by staff review, and which role may approve a merge?
- Can an archived patient be reactivated for a new visit, and who may do so?
- Which roles may view or edit demographic data versus clinical data?
- What retention and correction policy applies to clinical records and patient identity changes?

## Synthetic test plan (not executed)

1. Register same returning patient three times: one master ID, three encounter IDs, three queue numbers.
2. Change phone number on patient master: all future encounters use new contact; old invoice snapshots remain unchanged.
3. Two unrelated patients share name: no automatic merge.
4. Family members share phone: no automatic merge.
5. Patient has no phone: registration and future encounter linking remain possible.
6. Autocomplete suggestion selected: stable patient ID is retained (target behavior), not just name/phone.
7. Duplicate candidates: manual review and approved merge preserve all encounter/invoice links.
8. Archive patient master: existing encounters/invoices remain readable; new visit behavior follows approved policy.
9. Reactivate archived patient: same master ID, new encounter ID, event history retained.
10. Cancel then reactivate a visit: original cancellation event remains in audit history.
11. Edit demographic data: actor, timestamp, before/after values retained; clinical/invoice snapshots unchanged.
12. Checkout with missing encounter: reject and rollback all stock/invoice/quota changes.
13. Checkout with patient/encounter mismatch: reject.
14. Checkout with wrong/closed shift or cashier mismatch: reject.
15. Invoice historical print after demographic edit: displays invoice-time snapshot.
16. Patient history query: returns all encounters chronologically, with linked invoices and permitted clinical data.
17. Export by shift: exact encounter set and counts match source; cancelled/archived policy explicit.
18. Legacy patient row with invoice: crosswalk preserves exact `pid` relation.
19. Legacy patient row with missing shift: quarantine/report; do not fabricate shift.
20. Legacy duplicate candidate names/phones: report only; no automatic merge.
21. Source and target reconciliation: per-day/per-shift visits, invoice links, queue values, and statuses match exactly.
22. Role tests: Kasir, Admin, and Pimpinan only see/edit fields permitted by policy; clinical privacy tested separately if clinical module is approved.

## Safety / completion status

- Static source inspection and documentation only.
- No patient records, clinical records, or live Firestore data were accessed.
- No Firebase/Auth mutation, Firestore Rules change, DDL, data import, production deployment, main merge, or PR13 merge.
- No runtime tests or reconciliation were executed.
- Do not describe this pass as a data migration or clinical-system validation.
