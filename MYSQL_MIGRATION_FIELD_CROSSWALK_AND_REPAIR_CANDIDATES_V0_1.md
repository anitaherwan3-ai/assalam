# Legacy Firebase → MySQL/TiDB Field Crosswalk & Repair Candidate Register v0.1

Date: 2026-11-15  
Branch: `migration/tidb-foundation`  
Status: **STATIC SOURCE CROSSWALK — NOT ETL-READY, NOT APPROVED FOR REPAIR OR DDL**

## 1. Purpose and safety boundary

This document connects the legacy field dictionary, inspected Firebase backend paths, ClinicStore writes, UI callsites and the proposed relational model. It also defines patterns that a future read-only profiler may flag as repair candidates.

Evidence baseline:
- `js/store.js` on legacy `main`: `99e74acf8caec9c70d82be1d5f6efc5bfa6bc4fb`
- `js/app.js` on legacy `main`: `f74c4710161ddd2af230e51c18b1f107d6c52c82`
- `js/firebase-backend.js` on legacy `main`: `3a613d96564f120b8141966f9ecbae21471c4e65`
- Existing compatibility, backend method, UI callsite, write-path, relational integrity, financial/inventory and legacy sync/repair audits.

**This is not the historical Firestore field union.** It captures fields actually observed in the inspected source and audit artifacts. Fields from older deployed code, external scripts, Functions, manual console edits or historical documents may be missing. Every row remains subject to actual secured snapshot profiling.

No production Firebase reads/writes, no patient-data export, no TiDB application DDL, no real-data import, no production correction and no deployment were performed. Keep all work on this branch. Do not copy credentials, patient data, or raw production payloads into GitHub, chat, issue comments or ordinary logs.

## 2. Field disposition vocabulary

- **OBSERVED** — explicitly read/written in the inspected source.
- **CONDITIONAL** — present only for some states/operations or optional in legacy rows.
- **DERIVED** — calculated from other values; compare, do not import as independent truth.
- **SYSTEM** — local/cloud synchronization or provenance metadata; not ordinary business data.
- **UNKNOWN-UNION** — complete historical keys/types not established.
- **QUARANTINE** — retain raw payload and exclude from automatic target posting until reviewed.
- **POLICY** — mapping depends on an owner/accounting/security decision.

For every source record preserve a source-scoped identity:
`(source_system, source_collection, source_document_id)`.
Document IDs may collide between collections. Never use a bare legacy ID as a globally unique key.

## 3. Collection and field crosswalk

### 3.1 Identity, configuration and audit

| Legacy path / source | Observed fields | Target mapping | Disposition / rules |
|---|---|---|---|
| `k_users/{docId}` and local `users[]` | local: `u,nama,role,hp`; cloud: `uid,email,active,updatedAt`; generic `id/_t` may occur in local rows | `users`, `user_emails`, `role_assignments`, `active_email_claims`, identity audit | Map by verified Auth UID/email and reviewed stable identity, not name. Preserve both owner identities. Never seed-delete or merge identities solely by email/name. Legacy local owner row is not a complete Auth inventory. |
| `klinik_config/settings` | `set` object: `nama,logo,logoImg,alamat,telp,footer,warna,tema,font,perHal,batasApproval,tempoPeringatan,edPeringatan,kertasNota,fiturKirimWA,waOwner,runningTextDisplay,youtubeVideoId,enableYoutubeDisplay`; `seq` object | `clinic_settings`, `display_configs`, queue counters / legacy config staging | Fixed name is protected constant: Klinik Assalaam Palembang. Separate general settings from display projection. Preserve unknown keys in staging. Never replace saved production settings with defaults. Sequence meaning requires source-specific parser. |
| `klinik_config/queueAudioClip_{clipId}` | `type,clipId,audioData,sizeBytes,fileName,mimeType,updatedAt,updatedBy` | `queue_audio_assets` + private object storage | Do not store base64 audio in SQL. Validate clip ID, MP3 MIME/signature, size, hash and actor. Keep notification chime separate from spoken clips. Delete/version history must be audited. |
| `k_log/{id}` / local `log[]` | `id,_t,_pendingSync,tgl,jam,u,aksi,kol,rinci` | append-only audit/event tables | `_pendingSync` is SYSTEM and not a business event. Actor `u` must resolve to a verified identity or be marked unresolved. Local list is capped at 1,000; missing older events cannot be reconstructed. |

### 3.2 Master data and inventory

| Legacy collection | Observed fields | Target mapping | Disposition / rules |
|---|---|---|---|
| `k_obat/{id}` | `id,nama,satuan,hpp,jual,stok,min` | `medicines` | `hpp,jual,stok` are rupiah/quantity candidates; validate integer/range and units. Aggregate `stok` is a derived balance to reconcile against batches and movements, not a free-standing correction target. Category/barcode/active aliases remain UNKNOWN-UNION. |
| `k_tarif/{id}` | `id,nama,jenis,harga` | `service_catalog` / tariff master | Preserve historical invoice snapshots; current tariff must not rewrite past invoices. Active/category/duration aliases UNKNOWN-UNION. |
| `k_paket/{id}` | `id,nama,deskripsi,harga,items[]`; component: `id,type,nama,harga,qty`; medicine component may include `oid` | `packages`, `package_components` | Keep raw component order and snapshots. Validate component type/ref/qty. Nested package aliases and historical component variants UNKNOWN-UNION. Historical invoice package snapshot remains immutable. |
| `k_batch/{id}` | `id,oid,no,ed,qty,sisa,beli,_t` | `inventory_batches`, inventory movement ledger | `oid` maps medicine; `beli` may be literal `init` or purchase ID. `qty/sisa` must be nonnegative and same unit. Batch source and expiry cannot be fabricated. Reconcile `sisa` against movement history and aggregate medicine stock. |
| nested invoice/package `batchDeductions[]` | `bid,qty,batchNo,ed` | inventory issue/allocation ledger and invoice-line batch allocations | Historical allocation may be absent. Missing batch provenance is QUARANTINE for any reversal requiring exact lot restore. Never infer batch from current FEFO order. |

### 3.3 Patient, encounter and queue

| Legacy path / row | Observed fields | Target mapping | Disposition / rules |
|---|---|---|---|
| `k_pasien/{id}` / local patient row | `id,tgl,jam,sh,kasir,nama,hp,layanan,no,done,calling,status,_t` | `patients`, `patient_encounters`, `queue_tickets`, `queue_call_events` | Split patient identity from visit and ticket only when linkage can be proven. Preserve source ID/path and raw date/time. Patient PII restricted. Missing shift/cashier/patient link is a reconciliation flag, not a guessed FK. |
| patient lifecycle fields | `status`, `batalBerobatPada,batalBerobatOleh,calling`; archive: `deletedAt`, status `dihapus` | encounter lifecycle events; patient archive metadata | Batal Berobat is not invoice cancellation and not patient archive. Preserve event dates/actors when available. Unknown actor/time must remain unresolved. |
| queue state | `no`; possible `seq` under settings/config | `queue_counters`, `queue_tickets`, `queue_call_events` | Main inspected baseline is A-only. PR13 A/B and handoff are not assumed shipped. Parse only proven historical ticket formats; do not invent prefix B or missing sequence numbers. |

### 3.4 Sales, invoice lines, returns and cancellation

| Legacy path / row | Observed fields | Target mapping | Disposition / rules |
|---|---|---|---|
| `k_trx/{id}` invoice header | `id,no,tgl,jam,pid,nama,hp,kasir,sh,items,total,metode,bayar,kembalian,_t`; optional `status,dibatalkanPada,dibatalkanOleh` | `sales_invoices`, `sales_invoice_lines`, payment/cash/bank ledger, inventory issue ledger | Preserve header and item snapshots. `pid` is a patient/encounter reference requiring resolution. `total,bayar,kembalian` must be reconciled with lines, discounts and payment method; do not treat display total as ledger proof. |
| medicine line in `items[]` | `oid,nama,t,harga,qty,hpp,batchDeductions` | `sales_invoice_lines`, line batch allocations, inventory movement | Preserve item index/order and raw payload. Verify medicine, qty/unit, price, HPP and batch allocation. |
| service line | `nama,t/jenis,harga,qty,hpp` | `sales_invoice_lines` service snapshot | Service line has no medicine stock movement. Do not infer an `oid`. |
| package line | `pid,nama,t,jenis,harga,qty,items,hpp`; components: `id,type,nama,harga,qty`, possible `oid,batchDeductions` | invoice line + immutable component snapshots + batch allocations | Reconcile package price and component expansion separately. Never expand historical package using current master definition. |
| discount line | `t='Diskon'` or `'Potongan Diskon'`, negative `harga` | invoice discount allocation / discount ledger | Preserve exact sign and source row. Legacy largest-remainder proportional allocation must be reproduced for return comparison. Negative non-discount line is QUARANTINE until classified. |
| `k_returJual/{id}` | `id,status,tgl,trxId,itemIndex,quotaId,priorQty,noNota,namaPasien,namaItem,oid,jenis,hpp,metode,qty,harga,total,batchRestores,alasan,kasir,_t`; optional `diverifikasiOleh,diverifikasiPada,alasanPenolakan`; payout fields may vary | `sales_returns`, `sales_return_lines`, `return_quota_subjects`, `sales_return_events`, refund obligation and payout ledger | Match invoice by `trxId`, item by stable original index plus snapshot evidence. Compare `total` to recomputed net line value. Status does not prove stock restore or refund payout. |
| `batchRestores[]` | `oid,bid,qty,batchNo,ed` | return inventory restoration movement | Validate against original invoice `batchDeductions`, prior returns and current batch. Never post a second restoration just because the proposal says approved. |
| `k_returKuota/{trxId__itemIndex}` | source-side quota document used by backend; full historical field union not fully established | `return_quota_subjects` and event-linked reservations | Separate guard/subject from ClinicStore collection. Extract actual keys/types from protected snapshot before mapping. Enforce exactly-once reserve/release. |
| `k_batalTrx/{trxId}` | `id,trxId,status,kasir`; optional `alasan,alasanPenolakan,diverifikasiOleh,diverifikasiPada,tgl,_t,noNota,namaPasien` | cancellation request/event tables and invoice reversal event | Document ID equals invoice ID in observed backend. Full historical union UNKNOWN. Cancellation and sales return must mutually exclude under invoice lock. Restore stock only with verified original batch allocations. |

### 3.5 Purchase, supplier return, expenses, petty cash, loss and shift

| Legacy collection | Observed fields | Target mapping | Disposition / rules |
|---|---|---|---|
| `k_beli/{id}` | `id,tgl,supplier,faktur,oid,qty,total,tempo,lunas,tglBayar,qtyAwal,totalAwal,hargaBeliSatuan,batchId,_t` | `supplier_invoices`, `supplier_invoice_lines`, supplier payable/payment allocations, `inventory_batches` | Older rows may lack original quantity/value/unit price/batch ID. Derive unit price only if unambiguous; preserve raw and derivation marker. `lunas=true` is not proof of payment amount/date/reference. |
| `k_returBeli/{id}` | `id,tgl,beliId,supplier,faktur,namaObat,qty,nilai,alasan,_t` | supplier return/credit note, return line, inventory movement, supplier balance | Local code may already have changed purchase qty/total, batch and HPP. Import resulting state once; do not replay stock reduction. Exact batch may be ambiguous; QUARANTINE if not provable. |
| `k_biaya/{id}` | `id,tgl,kat,ket,jml,status,kasir,_t` | `expenses`, `expense_events`, cash/bank ledger on actual payment | Approval actor/time may be missing or only appear in logs. Do not infer approval/payment from status alone. |
| `k_petty/{id}` | `id,tgl,ket,jml,kasir,sh,_t` | petty cash/cash ledger entries and reversals | `sh` may be absent. Resolve shift ownership/date; never fabricate a shift. Distinguish expense, advance and transfer policy. |
| `k_loss/{id}` | `id,tgl,oid,bid,qty,ket,nilai,_t` | loss event + inventory movement + valuation | Check exact batch and medicine, qty and value against historical HPP. Do not delete/restore stock automatically. |
| `k_shift/{id}` | `id,tgl,jam,kasir,nama,modal,status,jamT,sistem,fisik,selisih,verif,oleh,_t` | `cashier_shifts`, `shift_reconciliations`, cash ledger, verification events | `modal` is opening float, not omzet. `sistem/fisik/selisih` are derived snapshots to recompute and compare. Missing close/verification evidence remains unknown, not auto-filled. |

### 3.6 Local-only, derived and infrastructure fields

| Source | Fields / behavior | Target disposition |
|---|---|---|
| All generic rows | `id,_t` | Preserve original ID as source-scoped identity. `_t` is client clock timestamp, not trusted canonical update time. Keep raw value and provenance separately. |
| Local state | `_pendingSync` | SYSTEM metadata; retain only in raw evidence if needed, never as a financial or operational event. |
| localStorage | `klinik_data` | Local cache/backup only, not authoritative server database. JSON restore must not be used as migration. |
| Firebase config | `firebaseConfig` | Infrastructure secret/config boundary; never import into editable clinic settings or expose to browser UI. |
| Financial reports | omzet, HPP, laba, cash totals | DERIVED. Recompute from source invoice/payment/return/expense/stock records and compare with displayed legacy reports. |
| Sync mechanics | per-collection batched writes, merge snapshots, timestamp conflict resolution | Not migrated as business data. Replace with explicit server commands, version checks, idempotency keys and outbox. |

## 4. Mandatory raw staging envelope

Before any future normalization, every source document must be staged with at least:

- `source_system`: firebase or explicitly identified local backup.
- `source_project` / environment identifier (non-secret).
- `source_collection`, `source_document_id`, full document path.
- immutable `source_payload_json` and SHA-256 payload hash.
- source create/update timestamps only where actually supplied; preserve raw timestamp representation/type.
- `extraction_batch_id`, extraction time, extractor version.
- `parser_version`, `mapping_version`.
- `classification`, `validation_status`, structured validation errors.
- target entity/key only after a deterministic mapping exists.
- disposition: mapped, accepted-with-warning, quarantined, rejected, duplicate-candidate.

No patient payload in GitHub. Raw staging should be encrypted, access-controlled, private, time-limited and restorable independently of transformation output.

## 5. Repair candidate register (detection only; no auto-repair)

| Candidate pattern | Safe read-only detection | Evidence needed before correction | Permitted future repair shape | Auto-repair |
|---|---|---|---|---|
| Aggregate medicine stock differs from sum of batch balances | Compare medicine `stok` with sum of valid `batch.sisa` by `oid`; separately identify expired/blocked batches | Complete batch list, all sale/return/purchase/loss/adjustment events, expiry policy, source snapshot | Append explicit inventory adjustment/reversal with reason and actor; recalculate balance from ledger | **NO** |
| Negative, nonnumeric or fractional quantity in a count-based unit | Type/range/unit scan on `stok,qty,sisa` and nested quantities | Unit definition, package conversion, raw invoice and batch records | Correct only with source evidence and a documented conversion/adjustment event | **NO** |
| Invoice total does not equal lines less discounts | Recompute exact integer-rupiah line totals and discount allocation | Original invoice payload, receipt/payment proof, historical discount algorithm/version | Preserve original invoice; add audited financial adjustment/reversal, never silently overwrite snapshot | **NO** |
| Invoice refers to missing patient, shift, cashier, medicine or batch | Referential anti-join using source-scoped identities | Related collection snapshots, archived/deleted records, old ID aliases and owner confirmation | Resolve deterministic alias or quarantine unresolved reference; no synthetic parent creation | **NO** |
| Historical invoice lacks batchDeductions | Identify stock-bearing lines with no complete allocation | Historical stock movements, batch receipts and reliable audit trail | Manual lot allocation only if evidence uniquely proves source; otherwise retain unallocated legacy exception | **NO** |
| Duplicate-looking document IDs or duplicate invoice numbers | Detect same ID within/across collections and normalized invoice-number collisions | Full path, payload hashes, timestamps, receipt evidence, device history | Keep both raw documents; merge only if proven duplicate and preserve both source identities | **NO** |
| Return quantity exceeds original sold qty after pending/approved requests | Sum non-rejected/reserved/approved returns by invoice + item index | Invoice snapshot, quota docs, return events, payout and stock restoration evidence | Repair quota/event state atomically after owner review; do not alter original invoice qty | **NO** |
| Return marked approved but stock restoration/payout unclear | Compare status history with exact batch balances/movements and payout record | Cloud backend events, batch movements, payment reference/bank/cash evidence | Separate inventory restoration from refund obligation and payout; create only missing proven event | **NO** |
| Invoice cancellation and return both appear active | Detect overlapping non-rejected return and cancellation lifecycles for same invoice | Full event chronology, invoice status and actual inventory/cash reversals | Resolve one lifecycle under controlled transaction; reverse duplicate effects with linked audit entries | **NO** |
| Supplier return exists but original purchase/batch cannot be identified | Match `beliId`, invoice/faktur, medicine, quantity and batch lineage | Purchase snapshot, batch ID, supplier credit note, stock movement | Quarantine if exact batch/value cannot be proven; no first-match batch assignment | **NO** |
| Purchase marked `lunas=true` but payment evidence absent | Flag paid boolean without amount/reference/payment event | Bank/cash evidence, supplier statement, log and original invoice | Record a verified payment allocation only with proof; otherwise preserve disputed status | **NO** |
| Shift cash variance or mismatch with cash ledger | Recompute opening float + cash receipts - cash refunds - petty cash/approved drawer movements | Shift snapshot, invoice payment methods, refunds, petty cash and verification history | Append reconciliation adjustment with approval; never rewrite historical cash events | **NO** |
| Timestamp order conflicts with lifecycle or device clock | Compare `_t`, event timestamps, server timestamps and known sequence | Device/server clock context, immutable event order, logs | Preserve raw timestamp and record canonical reviewed ordering separately | **NO** |
| User/email/role/UID conflict or duplicate active email | Compare Auth UID, profile doc ID, normalized email, role, active state and owner allowlist | Firebase Auth export, deployed Functions source/config, owner confirmation | Controlled identity mapping with immutable user ID and verified email claim | **NO** |
| Seed-like record mixed with operational references | Compare full payload to exact seed template and traverse all references/events | Snapshot before/after, transaction use, edits, logs and source provenance | Only isolated demo record with proof of unused status may be removed under separate approval | **NO** |
| Unknown field or unexpected status/type | Union-of-keys/type profiler and enum scan | Source version, actual record sample, UI/backend writer, policy decision | Preserve in raw payload and quarantine until mapped | **NO** |

**Repair principle:** a discrepancy is a signal, not proof of corruption. Do not "fix" a number merely to make two databases match. Determine which side is supported by source evidence, then use an append-only, idempotent, reversible correction event. Never patch historical invoice snapshots, owner identity, stock/batch balances, cash ledger, returns or cancellations with generic overwrite.

## 6. Synthetic-only reconciliation fixture pack

The following fixtures are specifications for isolated tests, not real clinic data. Each fixture must have deterministic IDs, frozen clock, exact expected balances and teardown. No fixture is loaded into production.

1. **Stock and batch:** medicine opening stock 10; batches 6 + 4; sale consumes 3 from earliest-expiry batch; loss consumes 1 from second batch; expected aggregate and batch sum both 6. Inject aggregate=7 and verify profiler flags variance without mutating.
2. **Missing batch lineage:** invoice medicine qty 2 with no batch deductions; return/cancel request must be quarantined and must not invent a batch.
3. **Invoice math:** two positive lines 3×100 and 2×150; discount 50; largest-remainder allocation must total exactly 50; partial returns in two calls must never exceed line net amount.
4. **Duplicate checkout/replay:** replay same invoice command/idempotency key twice; exactly one invoice, one stock deduction and one payment event.
5. **Concurrent FEFO:** two synthetic cashiers attempt to sell last 2 units when only 2 remain; only one command succeeds; no negative batch or aggregate stock.
6. **Return quota race:** two requests for same line compete for remaining sold quantity; one is rejected or bounded by locked quota; no over-return.
7. **Return vs cancellation race:** concurrent final return and cancellation for one invoice; exactly one lifecycle wins; no double stock restoration or double refund.
8. **Approved return payout:** approve return, then replay payout; exactly one payout ledger entry. Transfer requires reference; pending obligation remains distinct from paid amount.
9. **Supplier return:** invoice linked to two batches; return request names exact batch; over-return rejected (not silently capped); paid invoice credit does not rewrite original payment.
10. **Shift reconciliation:** opening float 100,000; cash sale 50,000; cash refund 10,000; petty cash 5,000; expected drawer 135,000. Opening float is not omzet.
11. **Paid boolean ambiguity:** purchase `lunas=true` but no payment event; report as evidence gap; do not create payment.
12. **Owner protection:** import/restore/reset with owner profiles absent from incoming file; both protected owners remain intact.
13. **Unknown keys:** insert unknown field in patient, invoice and settings fixtures; parser preserves raw payload and quarantines unknown business key without silent discard.
14. **Timestamp ambiguity:** two devices send conflicting client `_t`; canonical server event/version ordering wins, raw client times remain stored as evidence.
15. **Idempotent repair and rollback:** apply approved synthetic adjustment once; replay is no-op; injected failure rolls back all affected rows and leaves repair event uncommitted.
16. **Demo seed classification:** exact default medicine with a reference from a historical invoice is not deletable; unreferenced exact seed in isolated demo can be separately classified, not automatically deleted.

Acceptance requires assertions on database rows, inventory movement, ledger sums, audit events, idempotency replay and rollback—not merely HTTP 200 or UI success.

## 7. ETL and repair gates

Do not move to real data until all are true:
1. Protected read-only Firebase snapshot is complete, hashed and restorable; collection counts and document key/type union are recorded.
2. Cloud Functions/Admin SDK source and deployed identity/config provenance are located and audited.
3. Every observed field maps to a target, a raw legacy field, or an explicit quarantine reason; no silent field drops.
4. All historical aliases/status variants and source IDs have deterministic mapping or explicit quarantine.
5. Schema v1 decisions, FK/index/type/nullability/collation and TiDB compatibility tests are closed.
6. Synthetic fixture suite passes on preview with rollback and concurrency evidence.
7. Read-only shadow reconciliation has no unexplained financial/inventory discrepancy; all exceptions are owner-reviewed.
8. Restore rehearsal, delta replay, write freeze, cutover and rollback are documented and rehearsed.
9. Owner explicitly approves the specific source snapshot, migration batch, repair manifest and execution window.

## 8. Current completion status

- Static source field dictionary consolidated: **draft v0.1 created**.
- Observed fields mapped to candidate target entities: **draft crosswalk created**.
- Historical Firestore key/type union: **NOT obtained**.
- Read-only Firebase snapshot/count/hash: **NOT performed**.
- Repair candidates from real clinic data: **NOT identified**; only detection rules are specified.
- Production data correction: **NOT performed**.
- Synthetic fixtures: **specified, NOT executed**.
- TiDB schema DDL/runtime compatibility: **not approved / not complete**.
- Bidirectional sync: **not implemented and not recommended**.
- Production cutover: **not authorized**.

Next safe action is to complete static alias/source-writer verification, then prepare a protected snapshot profiling procedure that can be run by the owner without exposing credentials or patient data.
