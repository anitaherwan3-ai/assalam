# LEGACY DATA COMPATIBILITY AND SEED/RESTORE AUDIT
Date: 2026-11-15
Source baseline: `main`
Primary sources inspected:
- `js/store.js` (source fingerprint previously recorded: `99e74acf8caec9c70d82be1d5f6efc5bfa6bc4fb`)
- `js/app.js` (source fingerprint: `f74c4710161ddd2af230e51c18b1f107d6c52c82`)
- `js/export-helper.js` (source fingerprint: `e383d719ba72dc391636444d772305ef9d412b2d`)
Scope: static source review; no production/local data was read, changed, exported or migrated.

## 1. Executive summary

The existing app is an offline-capable local-state application with Firebase synchronization. Its local state is not a formally versioned database schema. The constructor initializes missing collections and reseeds selected collections when empty. Backup restore replaces the complete local state after only two superficial checks, then triggers sync. This behavior is unsafe as a direct migration/import contract.

Before migration, we need a versioned legacy parser, a complete union-of-fields dictionary from actual documents, provenance classification, dry-run validation, referential integrity checks and a non-destructive reconciliation report. Empty arrays must not automatically trigger production seed records.

## 2. Store initialization and seed behavior

### 2.1 Local storage source
- Key: `localStorage['klinik_data']`.
- JSON parse failure is caught and logged; state then becomes an empty object.
- If no local data exists, constructor initializes an empty object.
- Sixteen collection arrays are initialized if their value is not an array:
  `obat, tarif, paket, pasien, trx, petty, beli, biaya, loss, shift, batch, log, users, returJual, returBeli, batalTrx`.
- `set` is merged as `Object.assign({}, DEFAULT_SETTINGS, existingSet)`; `seq` defaults to an object; `firebaseConfig` defaults to null.
- Fixed clinic name is forcibly reset to `Klinik Assalaam Palembang` on every local load.

### 2.2 Automatic seed-on-empty collections
The constructor repopulates these arrays whenever empty:
- `obat` → `INITIAL_OBAT` (o1–o3: Paracetamol, Amoxicillin, Vitamin C)
- `batch` → `INITIAL_BATCH` (b1–b3, batch numbers PCT-2026-01 / AMX-2026-02 / VTC-2026-01; `beli: 'init'`)
- `tarif` → `INITIAL_TARIF` (t1–t6)
- `users` → `INITIAL_USERS` (only u `praktekrose`, role pimpinan)
- `paket` → `INITIAL_PAKET` (p1–p3)

Other arrays remain empty when absent/empty.

### 2.3 Critical migration consequence
An empty medicine, batch, tariff, user or package collection is not stable: local initialization can silently reinsert sample records. A valid clinic may also intentionally have an empty collection (for example no packages yet). Therefore:
- Do not use constructor initialization as server-side migration seed logic.
- Do not infer a record is demo merely because its ID resembles o1/p1/t1 or it has an old date.
- Do not infer a record is safe to delete because its batch has `beli='init'`; verify all references and movement history.
- Seed only in an explicitly marked isolated demo tenant/database, with immutable `seed_batch_id` / provenance metadata.
- Production migration must preserve a deliberately empty collection as empty.
- Master owner account is protected independently of seed data and must never be deleted by reset/import.

### 2.4 Default settings that require review
The default settings include fixed clinic name/address, logo/branding, phone, footer, theme, font, page size, expense approval threshold (Rp1,000,000), payable warning days (7), expiry warning days (60), receipt paper size, WhatsApp feature flag, owner WhatsApp number, running text and YouTube display settings.
Some defaults are placeholders or stale sample content (for example default phone/WhatsApp values and running text mentioning another clinic name). Never overwrite the clinic's saved operational settings with these defaults during ETL. Fixed clinic identity must be stored separately from editable settings; only owner-approved values should be migrated.

## 3. Legacy field dictionary — observed starter mapping

Status definitions:
- **Observed**: explicitly written/read in inspected source path.
- **Conditional**: optional/legacy value or only present for some operation.
- **Derived**: calculated from other values; never trust imported value without reconciliation.
- **Unknown**: complete union of historical document keys not yet extracted.

### 3.1 Common identity and timestamps
| Entity | Observed fields | Notes |
|---|---|---|
| Generic local row | `id`, `_t` | IDs generated client-side; preserve original ID as legacy key and add stable migration mapping. |
| Audit log | `id,_t,_pendingSync,tgl,jam,u,aksi,kol,rinci` | `_pendingSync` is sync metadata, not business data. Local log is capped at 1,000 entries. |
| User profile | `u,nama,role,hp`; cloud profile additionally `uid,email,active,updatedAt` | Local seed user differs from cloud Auth profile; reconcile by stable UID and verified email. |
| Date/time | `tgl,jam,_t`, some event-specific timestamps | Mixed date strings, client milliseconds and ISO strings; normalize to WIB business date while preserving raw source timestamp. |

### 3.2 Master data
| Collection | Observed fields | Conditional / unknown |
|---|---|---|
| obat | `id,nama,satuan,hpp,jual,stok,min` | Category, active state, barcode, aliases and any extra legacy attributes need full extraction. |
| tarif | `id,nama,jenis,harga` | Active/status, category, duration and other fields unknown. |
| paket | `id,nama,deskripsi,harga,items[]` | Component `id,type,nama,harga,qty`; medicine component also `oid`. Nested packages and legacy component aliases unknown. |
| batch | `id,oid,no,ed,qty,sisa,beli,_t` | `beli` may be `init` or purchase ID; historical rows may lack fields. |
| settings | `nama,logo,logoImg,alamat,telp,footer,warna,tema,font,perHal,batasApproval,tempoPeringatan,edPeringatan,kertasNota,fiturKirimWA,waOwner,runningTextDisplay,youtubeVideoId,enableYoutubeDisplay` | Preserve unrecognized keys in a staging/legacy JSON field until mapped; never silently discard. |

### 3.3 Patient and queue
| Entity | Observed fields | Notes |
|---|---|---|
| Patient/visit row | `id,tgl,jam,sh,kasir,nama,hp,layanan,no,done,calling,status,_t` | Fields may be optional or absent in old rows. Patient master vs encounter vs queue ticket must be separated without losing legacy linkage. |
| Batal Berobat | `status,batalBerobatPada,batalBerobatOleh,calling` | Also may be represented in cancellation/history state. Preserve event history; do not delete patient. |
| Archive/delete | `deletedAt`, status `dihapus` | Soft-delete markers must be mapped distinctly from Batal Berobat. |
| Queue | `no`, possible sequence state under `seq`/settings | Queue numbering and A/B prefix need source-specific parser; main branch is A-only, PR13 A/B is unmerged. |

### 3.4 Sales and returns
| Entity | Observed fields | Notes |
|---|---|---|
| Invoice header | `id,no,tgl,jam,pid,nama,hp,kasir,sh,items,total,metode,bayar,kembalian,_t` | Some fields may be missing in older transactions; preserve original snapshots. |
| Invoice item | medicine: `oid,nama,t,harga,qty,hpp,batchDeductions`; service: `nama,t/jenis,harga,qty,hpp`; package: `pid,nama,t,jenis,harga,qty,items,hpp` | Discount rows may use `t='Diskon'` or `Potongan Diskon`, negative price; package components have `id,type,nama,harga,qty`, medicine components may have `oid,batchDeductions`. |
| Batch deduction | `bid,qty,batchNo,ed` | May be missing for historical invoices; never invent batch provenance. Mark unknown and reconcile against stock movements. |
| Return proposal | `id,status,tgl,trxId,itemIndex,quotaId,priorQty,noNota,namaPasien,namaItem,oid,jenis,hpp,metode,qty,harga,total,batchRestores,alasan,kasir,_t` | Approval fields `diverifikasiOleh,diverifikasiPada`; rejection `alasanPenolakan`; payout object may exist in cloud schema. |
| Return batch restore | `oid,bid,qty,batchNo,ed` | Verify actual batch and original deduction before restoring. |
| Cancellation request | `id,trxId,kasir,status`; optional `alasan,alasanPenolakan,diverifikasiOleh,diverifikasiPada,tgl,_t` | Full historical union unknown. |

### 3.5 Finance, purchases and shifts
| Entity | Observed fields | Notes |
|---|---|---|
| Purchase invoice | `id,tgl,supplier,faktur,oid,qty,total,tempo,lunas,tglBayar,qtyAwal,totalAwal,hargaBeliSatuan,batchId,_t` | Legacy may lack original quantity/value and unit price; calculate only when unambiguous and preserve raw. |
| Supplier return | `id,tgl,beliId,supplier,faktur,namaObat,qty,nilai,alasan,_t` | Old flow may mutate purchase total and batch/stock; return history may be only partial evidence. |
| Expense | `id,tgl,kat,ket,jml,status,kasir,_t` | Approval actor/time may be absent or in log only. |
| Petty cash | `id,tgl,ket,jml,kasir,sh,_t` | Some legacy rows may omit shift. |
| Loss | `id,tgl,oid,bid,qty,ket,nilai,_t` | Check corresponding batch/aggregate stock changes. |
| Shift | `id,tgl,jam,kasir,nama,modal,status,jamT,sistem,fisik,selisih,verif,oleh,_t` | Some rows may not have verified actor/time or exact close snapshot. |
| Financial derived values | omzet, HPP, return value, cash, profit | Recompute from normalized ledgers and compare with legacy reports; do not import a displayed total as ledger truth. |

## 4. Normalization and compatibility risks

1. `loadLocal()` accepts any parsed JSON as state, then expects object-like collection properties. It has no schema version or migration chain.
2. Missing/non-array collections become empty; selected empty collections are immediately seeded.
3. `set` defaults are merged with existing keys, meaning legacy unknown settings survive locally but a server ETL must preserve them explicitly.
4. Fixed clinic name is forcibly rewritten locally; do not accept an old editable name as canonical identity.
5. Default sample records can be mixed with live edits. ID patterns alone are insufficient for deletion.
6. `recordPurchase()` uses UTC date string, weighted-average HPP and writes purchase+batch; older rows may lack `qtyAwal,totalAwal,hargaBeliSatuan,batchId`.
7. `lunasiBeli()` only flips `lunas` and `tglBayar`; there is no partial-payment/allocation record in this local path.
8. `deductBatchFEFO()` filters by UTC today, positive `sisa`, expiry >= today and sorts ED ascending. This may differ from WIB business date near midnight.
9. `logActivity()` uses UTC date/time strings and truncates local log to 1,000. Preserve available audit data; do not invent missing entries.
10. Local sales return computes proportional discount allocation using largest remainder; preserve invoice line snapshots and reproduce the exact algorithm for legacy reconciliation.
11. Local supplier return uses `Math.min` to silently cap requested quantity by purchase quantity, batch remaining and aggregate stock; it mutates purchase totals if unpaid, batch, aggregate stock and HPP. New migration must import the resulting facts without applying the return a second time.
12. Return approval in local ClinicStore differs from staged cloud process. Historical status alone may not prove whether stock was restored or refund paid; reconcile against original batch and payout evidence.
13. `export-helper.js` JSON backup serializes the whole local state, but restore validates only that `obat` and `users` are truthy, then assigns `store.state=data` and calls `saveLocal(true)`. This may overwrite current state and trigger Firebase push.
14. Exported transaction report includes all invoice rows including cancelled; exports may not equal net financial reports. Treat reports as presentation artifacts, not authoritative import data.
15. CSV output quotes cells but does not neutralize spreadsheet formula prefixes. New exports need formula-injection protection and role/PII minimization.
16. Local IDs may collide across collections; SQL should use table-scoped primary keys or globally unique surrogate IDs plus source collection/key uniqueness.

## 5. Demo-vs-live classification protocol

Do not delete or reset records by name, date, ID pattern, low activity or `beli='init'` alone.

For each candidate record:
1. Preserve original collection, document ID, raw JSON, source timestamps and content hash.
2. Identify whether it was created by known seed code, with matching full seed payload and seed provenance, not merely matching ID.
3. Check references from invoices, package snapshots, patients, shifts, batches, returns, cancellations, supplier invoices, logs and audit events.
4. Check whether any value has been edited from seed default or used in a real transaction.
5. Classify as `seed_confirmed_unused`, `seed_modified_or_referenced`, `operational`, `master_protected`, `unknown`.
6. Only `seed_confirmed_unused` in an isolated demo environment may be eligible for deletion after an explicit reviewed plan.
7. Preserve `master_protected` owner records under every reset, restore and ETL.

Master protection includes at minimum owner identities `praktekrose@gmail.com` and `nursalim42@gmail.com`. Do not equate local INITIAL_USERS (one owner row) with complete Firebase Authentication or staff identity inventory.

## 6. Required migration staging format

Every imported record should have:
- `source_system` (firebase/local_backup)
- `source_collection`
- `source_document_id`
- `source_payload_json` (immutable raw snapshot, access restricted)
- `source_payload_hash`
- `source_created_at` / `source_updated_at` if actually available
- `migration_batch_id`
- `classification`
- `validation_status`
- `validation_errors[]`
- `transformation_version`
- `imported_at` server timestamp

Do not use raw patient data in ordinary logs or reports. Keep staging access restricted, encrypted and time-limited. Any eventual real-data ETL requires separate approval, backup verification, privacy/access controls and rollback plan.

## 7. Reconciliation checks before cutover

- Exact count by source collection, including empty collections.
- Union of every document key and value type by collection.
- Duplicate IDs, missing IDs, invalid dates, invalid numeric values, negative quantities and unexpected enum values.
- Missing references (invoice→patient/shift/cashier, line→medicine/package, batch→medicine/purchase, return→invoice/line/batch, cancellation→invoice, expense→approver).
- Stock aggregate vs sum of batch remaining vs inventory movements, with documented adjustments/expired-stock policy.
- Purchase original qty/value vs remaining qty, supplier returns and payments.
- Invoice header totals vs sum lines/discounts/payments/change; identify historical exceptions without auto-correcting.
- Return quota, approved returns, stock restoration, refund obligations and actual payout.
- Shift opening float, cash receipts, petty cash, refunds paid, expected cash, counted cash and variance.
- Financial reports by WIB date: gross revenue, net revenue, HPP, loss, expense, petty cash, refund obligation/payout, cash/bank and payable.
- Master Pimpinan identities and staff UID/email/role/active state.
- Idempotent re-run on synthetic clone; no duplicate ledger entries.

## 8. Open unknowns blocking a complete ETL map

- Complete union of historical Firestore document fields and types is not available from static repository source.
- Full app callsite coverage for every field alias and all older versions not yet proven.
- Full schema of `batalTrx` and older return/cancellation records remains partial.
- Actual data provenance for seed-like IDs and `init` batches is unknown without inspecting a secured export.
- Legacy documents missing batch deduction snapshots need policy for reconciliation; never fabricate lot traceability.
- Cloud Functions source/deployed auth setup remains unlocated in this repository.
- Any external/manual edits and backups not represented in Git source remain unknown.

## 9. Next sequence

1. Complete app/backend field callsite and alias scan for patient, shift, cancellation, expense, purchase and display settings.
2. Locate authoritative Cloud Functions source and deployed config before auth changes.
3. Obtain a protected, owner-controlled export only when ready for actual data profiling; run offline profiling with synthetic/redacted data where possible.
4. Produce a versioned ETL mapping and dry-run report; resolve all unknown rows before import.
5. Only after policy review design schema DDL and migration fixtures.

## Safety status
This is static source inspection only. No localStorage, Firebase collection, patient record, production backup or TiDB production data was read or changed. No reset, deletion, migration, DDL or deployment was performed.
