# SCHEMA V1 REVIEW — Klinik Assalaam Palembang
Tanggal: 2026-11-15
Branch: migration/tidb-foundation
Status: REVIEW FINDINGS — NO DDL APPLIED

## Ringkasan

Proposal schema sudah mencakup domain inti aplikasi (identitas, pasien/kunjungan, antrean, shift, kas/bank, master obat, batch, pembelian, POS, retur, pembatalan, biaya, audit, backup dan ekspor). Namun proposal belum boleh dibekukan menjadi DDL v1 sebelum koreksi struktural di bawah dan compatibility spike pada cluster TiDB aktual selesai.

Tidak ada tabel aplikasi yang dibuat, tidak ada data klinik yang dibaca/diimpor, dan tidak ada perubahan Firebase atau production. Uji kompatibilitas yang direncanakan harus menggunakan tabel sintetis bernama unik dan menghapusnya setelah tes.

## A. Temuan struktural — wajib diperbaiki sebelum DDL

### A1. Relasi pembelian ↔ batch berpotensi melingkar
Saat ini `supplier_invoice_lines.batch_id` dan `inventory_batches.supplier_invoice_line_id` sama-sama menyatakan relasi yang sama dari dua arah. Ini menciptakan FK melingkar dan urutan migrasi yang rumit.
**Keputusan schema:** jadikan `inventory_batches.supplier_invoice_line_id` sebagai satu-satunya relasi receipt-line → batch untuk kasus satu batch per baris pembelian. Hapus `batch_id` dari `supplier_invoice_lines`. Bila kelak satu baris pembelian boleh menghasilkan banyak batch, relasikan melalui tabel `supplier_invoice_line_batch_allocations`, bukan FK balik.

### A2. Email aktif vs histori email
Unique global pada `user_emails.email_normalized` akan melarang alamat lama dipakai kembali walau record historis sudah ditutup.
**Keputusan schema:** pisahkan klaim email aktif ke tabel `active_email_claims(email_normalized PK, user_id UNIQUE, email_id UNIQUE)`; `user_emails` menyimpan riwayat dan index non-unique untuk histori. Perubahan email harus transaksi atomik dan mempertahankan immutable user_id. Verifikasi email tetap diwajibkan.

### A3. Kuota retur tidak cukup granular
Unique `return_quotas.invoice_line_id` tidak bisa mewakili kuota komponen obat pada paket sekaligus kuota jasa pada invoice line. `sales_return_lines` sudah mengizinkan `invoice_component_id`, tetapi quota tidak.
**Keputusan schema:** ubah menjadi `return_quota_subjects` dengan `quota_key` unik yang deterministik, `invoice_line_id`, nullable `invoice_component_id`, `subject_type`, sold/reserved/approved quantity dan version. Setiap unit yang bisa diretur punya satu subject. Return service mengacu ke line; komponen obat paket mengacu ke component. Semua quota subject dikunci saat submit/finalize/cancel.

### A4. Satu role aktif dan assignment antrean perlu invariant
Index biasa pada `role_assignments(user_id, valid_to_utc)` tidak mencegah dua role aktif. Rentang `cashier_queue_assignments.valid_from/valid_to` juga bisa tumpang tindih.
**Keputusan schema:** gunakan tabel slot aktif terpisah untuk role klinik (mis. `active_role_slots(user_id PK, role_assignment_id UNIQUE)`) atau satu baris role aktif pada `users` bila kebijakan benar-benar single-role; pilih satu sumber kebenaran. Assignment antrean diubah lewat command yang mengunci user/prefix dan menolak rentang tumpang tindih. Jangan mengandalkan partial unique index.

### A5. Relasi active shift perlu kesesuaian kasir
`active_shift_slots.cashier_user_id` dan `shift_id` masing-masing FK belum menjamin shift yang ditunjuk milik kasir yang sama.
**Keputusan schema:** tambahkan unique key `cashier_shifts(shift_id,cashier_user_id)` dan composite FK dari `active_shift_slots(shift_id,cashier_user_id)`; open/close/recovery harus satu transaksi. Slot hanya dihapus saat shift ditutup final, bukan ketika request timeout.

### A6. Histori proses retur
Status review Admin dan final Pimpinan tersimpan di kolom header, tetapi tidak ada tabel event domain khusus untuk semua transisi retur.
**Keputusan schema:** tambahkan `sales_return_events` append-only (return_id, event_type, old_status, new_status, actor, reason, occurred_at). Audit umum tetap dicatat juga. Admin review tidak boleh membuat movement stok atau pembayaran; final approval membuat kewajiban refund; payout adalah command terpisah.

### A7. Validasi tipe baris invoice
`sales_invoice_lines` memiliki medicine_id/tariff_id/package_id nullable dengan aturan "tepat satu" berdasarkan line_type. CHECK constraint tidak boleh diasumsikan tersedia/identik sebelum spike.
**Keputusan schema:** validasi tepat satu target di API domain command; jika CHECK didukung pada versi cluster, gunakan sebagai lapisan tambahan. Terapkan pola sama untuk package_components dan invoice_line_components.

### A8. FK patient dan encounter harus konsisten
`sales_invoices.encounter_id` wajib, `patient_id` nullable, sedangkan encounter.patient_id juga nullable. Ini bisa dipakai untuk data lama yang orphan, tetapi invoice.patient_id dapat berbeda dari encounter.patient_id.
**Keputusan schema:** encounter adalah sumber relasi kunjungan; invoice.patient_id hanya snapshot/lookup opsional dan harus cocok dengan encounter bila keduanya terisi. Data legacy yang tidak punya encounter valid masuk quarantine/staging, bukan membuat encounter/pasien palsu.

### A9. Ledger dan angka uang
BIGINT signed rupiah tepat untuk nilai bulat, tetapi Node/mysql2 harus menghindari konversi BIGINT besar menjadi JavaScript Number yang tidak presisi.
**Keputusan implementasi:** gunakan mysql2 `supportBigNumbers: true`, `bigNumberStrings: true`; hitung nilai rupiah di server dengan integer/BigInt; API serialize angka rupiah secara konsisten. Kolom amount harus positif dan direction menentukan tanda; reversal membuat baris baru.

### A10. Batch split dan retur supplier
Proposal menyebut satu batch per purchase line, tetapi source lama/masa depan dapat membutuhkan split penerimaan.
**Keputusan schema v1:** satu batch per receipt line hanya jika data source/operasional mengonfirmasi. Kalau tidak, gunakan tabel allocation line-to-batch sejak awal. Supplier return harus mengunci line, batch dan saldo kuota; jangan memakai Math.min untuk menurunkan qty yang diminta diam-diam.

## B. Temuan teknis dan operasional

1. **Auto-increment:** jangan bergantung pada nomor berurutan atau gapless. Gunakan public_id UUID/ULID; internal BIGINT hanya surrogate key.
2. **UTC:** DATETIME(3) tidak menyimpan zona. Setiap koneksi aplikasi menetapkan session time_zone = '+00:00'; business_date dihitung eksplisit di Asia/Jakarta. Uji NOW(3), UTC_TIMESTAMP(3), default timestamp, dan session pool reuse.
3. **Index/FK:** pastikan setiap FK punya index child yang sesuai dan tipe/unsigned/collation kolom cocok. Jalankan EXPLAIN untuk query antrean, FEFO, invoice harian, stock card dan audit.
4. **Locking:** jangan mengandalkan gap locking untuk mencegah phantom/duplikasi. Kunci row counter, active slot, quota, invoice, medicine/batch yang sudah ditemukan, dan gunakan unique constraint sebagai pagar terakhir. Retry transaksi deadlock/write conflict dengan batas percobaan dan idempotency.
5. **Isolation:** tes concurrent last-stock sale, duplicate queue allocation, duplicate open shift, simultaneous return reservation, cancellation vs return, dan duplicate refund payment menggunakan koneksi terpisah.
6. **Transaction size:** checkout/return/cancel harus mengunci dan menulis hanya row yang diperlukan, konsisten urutan lock untuk mengurangi deadlock.
7. **Soft delete:** hindari ON DELETE CASCADE untuk data pasien/keuangan/stok. Gunakan RESTRICT dan status/reversal.
8. **Sensitive data:** audit before/after harus redacted; TV hanya menerima projection queue yang disanitasi. Jangan masukkan patient PII ke audit diff, log, atau test fixtures kecuali sintetis.
9. **Runtime pool:** set timezone saat connection checkout, release connection pada semua jalur, batasi pool sesuai Vercel concurrency dan uji reconnect/idle.
10. **Privileges:** migrator dan runtime DB credentials harus dipisah. Runtime tidak boleh DROP/ALTER. Jika saat ini satu credential dipakai untuk health check, itu belum memenuhi least privilege untuk produksi.

## C. Keputusan pemilik — tidak boleh diputuskan oleh implementasi

Tetap menunggu persetujuan klinik:
- D01 unit obat dan apakah pecahan kuantitas diperbolehkan.
- D02/D03 pemetaan pasien-kunjungan dan invoice lama tanpa pasien/kunjungan.
- D04 data penjualan lama tanpa batch.
- D05 barang retur yang bisa dijual kembali vs karantina.
- D06 alokasi retur komponen paket.
- D07 aturan pengembalian biaya/jasa.
- D08 siapa yang boleh menyetujui biaya sendiri/tidak.
- D09 klasifikasi petty cash agar tidak dihitung dua kali.
- D10 pengakuan kredit supplier.
- D11 pembayaran pembelian parsial dan alokasi historis.
- D12 verifikator tutup shift.
- D13 metode dan otorisasi payout refund.
- D14 tanggal pengakuan transaksi non-tunai.
- D15 saldo awal stok dan HPP dengan bukti.
- D16 antrean A/B dan handoff PR13 (PR13 tetap tidak di-merge).
- D17 normalisasi timestamp legacy yang ambigu.
- D18 retensi/arsip data pasien.
- D19 retensi audit.
- D20 provider autentikasi dan asal Cloud Functions yang masih perlu diverifikasi.

## D. Compatibility spike TiDB — daftar bukti wajib

Tes dilakukan pada database preview aktual, bukan asumsi MySQL lokal:
- versi TiDB, sql_mode, timezone/session, charset dan collation;
- CREATE TABLE InnoDB, FK enforcement, ON DELETE RESTRICT dan index;
- unique nullable (lebih dari satu NULL), composite unique, FK type matching;
- transaksi commit/rollback dan atomicity;
- SELECT ... FOR UPDATE, update blocking, concurrent last-stock and duplicate-counter tests;
- DECIMAL(18,3), BIGINT boundaries dan round-trip driver;
- EXPLAIN/index selection;
- JSON read/write bila digunakan;
- deadlock/write-conflict behavior dan bounded retry;
- cleanup tabel uji terverifikasi.

Semua tes memakai nama tabel khusus compatibility test, fixture sintetis, dan cleanup di finally. Jika cleanup gagal, hentikan proses schema v1 sampai tabel uji diperiksa manual.

## E. Gerbang sebelum schema v1

1. Temuan A1–A10 dimasukkan ke schema proposal.
2. Compatibility spike aktual lulus atau perbedaan terdokumentasi dan desain disesuaikan.
3. Schema v1 memiliki DDL versioned dan migration checksum.
4. Tabel aplikasi hanya dibuat di preview; data uji sintetis saja.
5. Jalankan seed idempotent untuk master dummy, 2 kasir dummy, 1 shift, pasien sintetis, antrean, obat/batch, invoice, retur dan ledger.
6. Jalankan FK, unique, rollback, lock/concurrency dan reconciliation tests.
7. Jangan menyatakan aplikasi siap migrasi sebelum authorization, backup/restore, regression dan UI E2E tests lulus.



## F. Compatibility endpoint access control — 2026-11-15

A source review found that a public preview URL could otherwise allow any visitor to trigger synthetic DDL and row-lock tests against the preview database. The diagnostic endpoint has therefore been changed to require a separate `COMPATIBILITY_TEST_TOKEN` environment variable and a constant-time token comparison on POST. GET remains read-only and reveals no database credentials.

Before the compatibility endpoint is deployed:
1. Set a high-entropy random `COMPATIBILITY_TEST_TOKEN` in the isolated `assalam-mysql-preview` Preview environment only.
2. Do not reuse any database password or Firebase credential as this token.
3. Never put the token in source control, URL query parameters, screenshots, or chat.
4. Confirm the endpoint returns 503 when the token is not configured and 401 for an incorrect token; only a correct token may start the test.
5. After the test window, rotate/remove the token and verify synthetic test-table cleanup.

This is a source-level security improvement only. It has not yet been deployed or runtime-tested. It does not change the production project or database.


## G. Decision register cross-check against existing clinic instructions — 2026-11-15

This cross-check records already-stated operating preferences to avoid asking the clinic to repeat decisions. It does not silently convert incomplete preferences into a final accounting/legal policy.

| Decision | Existing instruction/evidence | What remains unresolved before DDL or workflow acceptance |
|---|---|---|
| D01 medicine unit/fraction | Existing app stock and batch flows use medicine units such as strip; quantities must reconcile exactly. | Canonical unit per medicine, whether fractional strip/tablet quantities are permitted, and rounding policy. |
| D02/D03 patient/encounter legacy | Patient and visit history must be preserved; never invent a patient/visit to satisfy a foreign key. | Exact treatment for historical invoices with missing or conflicting patient/encounter links. |
| D04 historical sales without batch | Stock/batch accuracy is a hard requirement; never fabricate a batch allocation. | Reconciliation evidence and quarantine approval for each legacy exception. |
| D05 returned medicine disposition | Return quantity and value must match what was charged; stock must not be inflated. | Who certifies unopened/resalable condition and when a returned item is quarantined. |
| D06 package component allocation | Return must support medicine and service components and prevent duplicate/over-return. | Approved proportional allocation/rounding method for package discount and refund. |
| D07 service/fee return | User explicitly requires return of medicine and service/fee where eligible; service return must not create stock movement. | Eligibility windows, partial service return rules and approval matrix. |
| D08 expense self-approval | No final policy found. | Thresholds and separation-of-duty rules. |
| D09 petty cash | Cash on hand must remain distinct from omzet and modal awal; no double-counting in reports. | Category mapping for advances, reimbursements and expense recognition. |
| D10 supplier credit | Supplier return/credit must be traceable and must not silently alter purchase history. | Exact accounting recognition event and evidence required for credit note acceptance. |
| D11 partial supplier payment | Support allocation-based accounting; do not infer historical payment allocation from a boolean paid flag. | Approval and reconciliation of legacy payment allocations. |
| D12 shift verifier | Shift closing and verification must be role-controlled and auditable. | Whether Admin, Pimpinan, or both may verify each shift type and exception. |
| D13 refund payout | Existing instruction requires approval before refund, separate payout recording, and clear “uang kembali” evidence; refund cannot be implied merely from approval. | Final authority and accepted payout methods/reference evidence. |
| D14 non-cash revenue date | Omzet, cash-in-hand and settlement are separate concepts. | Exact recognition timestamp for pending/failed/settled payment instruments. |
| D15 opening stock/HPP | Stock and HPP must reconcile; no invented opening balance. | Signed opening-stock evidence and valuation method. |
| D16 queue A/B and handoff | Existing instruction: display may switch between separate A/B views; cashier may select queue mode; PR13 remains unmerged. | Final role/override policy and full PR13 review before any adoption. |
| D17 legacy timestamps | Preserve original timestamp evidence; normalize only when unambiguous. | Per-source rules for malformed, local-time and missing offsets. |
| D18 patient archive/retention | User prefers “Batal Berobat” for cancelled/no-treatment visits rather than treating them as ordinary archive. | Retention duration, deletion/legal hold, and which records remain searchable. |
| D19 audit retention | Audit must be append-only and not truncated by a UI row limit. | Formal retention period and export/legal hold policy. |
| D20 authentication/Cloud Functions | Firebase Auth is the temporary identity provider candidate; master Pimpinan must remain protected. | Locate authoritative deployed Cloud Functions source, verify token claims and service account ownership, then approve long-term identity architecture. |

**Interpretation:** Existing preferences above can guide domain modelling and test cases, but any unresolved accounting, clinical retention, regulatory, or authorization detail remains a release blocker. No owner decision is treated as approved merely because a schema can technically represent it.

## H. Compatibility test coverage update — source review only

The preview compatibility endpoint now includes source-level checks for:
- explicit transaction rollback and commit;
- concurrent conditional last-stock decrement using two independent connections;
- row-lock blocking with `SELECT ... FOR UPDATE`;
- explicit session UTC timezone;
- FK enforcement, ON DELETE RESTRICT, composite unique behavior including multiple NULL values;
- DECIMAL(18,3), BIGINT above JavaScript's safe-integer boundary, EXPLAIN, and synthetic table cleanup;
- cleanup outcome surfaced in the error response, with `stopSchemaV1: true` when cleanup fails.

Node.js `node --check` passed for the latest endpoint source using an isolated Node 22 sandbox. Static inspection also confirms these test paths are present. **This is not a TiDB runtime test.** The endpoint remains undeployed/unexecuted; no database compatibility result is claimed. The suite still does not replace the application-level concurrency tests for queue counters, duplicate open shifts, return reservations, cancellation-vs-return, or duplicate refund payout.


## I. FK and index closure review — 2026-11-15

See `MYSQL_MIGRATION_FOREIGN_KEY_INDEX_CLOSURE_AUDIT.md`. The relationship summary is not yet a column-level FK catalogue. DDL remains blocked until every FK has exact child/parent column tuples, matching types, parent PK/UNIQUE key, child supporting index, nullability and ON DELETE/UPDATE policy. Additional composite same-parent checks are required for cashier/shift, medicine/batch, receipt-line/batch, invoice/line/component/quota, supplier/payment and return/credit-note relationships. Polymorphic references require typed validation/reconciliation. The missing `sales_return_events` relationship/index entry must be added.

## J. Key, nullability and concurrency closure review — 2026-11-15

See `MYSQL_MIGRATION_KEY_TYPE_CONCURRENCY_CLOSURE_AUDIT.md`. Additional blockers:
- A shared queue-prefix guard row is required to serialize overlapping assignments made by different users.
- Queue counter first-use must use an explicit atomic initialization algorithm; do not assume a missing-row gap lock.
- Return quota reservation/release must have exactly-once event linkage, not only aggregate counters.
- Composite parent unique keys must be enumerated for same-parent FK constraints.
- Define actor NULL/system semantics, normalized email collation, role scope and cancelled/reissued queue ticket behavior.
- Confirm split/partial supplier receipt behavior before enforcing one batch per receipt line.

These are static design findings. No TiDB DDL/runtime test has been performed; no schema v1 approval is granted.


## K. Data type, nullability, orphan and duplicate closure — 2026-11-15

See MYSQL_MIGRATION_DATA_TYPE_NULLABILITY_ORPHAN_DUPLICATE_CLOSURE_AUDIT.md and MYSQL_MIGRATION_CANONICAL_FK_INDEX_CATALOGUE.md. The pass confirms schema v1 is not freeze-ready: exact FK type/signedness/length/collation manifest is missing; user_id representation is not frozen; quantity base unit and fractional rules (D01), legacy ID source scoping, text collations, lifecycle nullability and legacy timestamp conversion (D17) remain open. Several same-parent relationships require composite keys/FKs or explicit tested API invariants. The candidate catalogue marks unresolved rows.

Orphan/duplicate checks have NOT been executed against historical clinic data; they are static logical checks and synthetic fixtures only. TiDB runtime compatibility remains untested. No DDL approval.

## L. Schema contradiction and source-identity closure — 2026-11-15

The new audit MYSQL_MIGRATION_SCHEMA_CONTRADICTION_SOURCE_IDENTITY_CLOSURE_AUDIT.md records 30 concrete conflicts/omissions. Highest-priority blockers: per-table global UNIQUE legacy IDs despite collection-scoped source IDs; missing same-parent constraints across encounter/invoice/shift, invoice line/component/batch, return quota and supplier payment/return; queue assignment/counter races; ambiguous timestamp normalization; and source-event idempotency for polymorphic ledger references. Candidate migration_source_records mapping preserves (source_system, source_collection, source_document_id) and source hash.

These are static design findings, not evidence of live data anomalies. No DDL, live export, historical orphan query, TiDB runtime test or deployment has occurred. Schema v1 remains NOT APPROVED.


## M. Schema v1 decision closure draft — 2026-11-15

See [MYSQL_MIGRATION_SCHEMA_V1_DECISION_CLOSURE_DRAFT.md](./MYSQL_MIGRATION_SCHEMA_V1_DECISION_CLOSURE_DRAFT.md). The latest pass specifies technical amendment candidates for queue prefix serialization and first counter initialization, return quota event ledger, actor provenance, source-scoped legacy identity, composite parent-child constraints, durable idempotency and projection ownership. It records the five protected account emails supplied by the owner and confirms the old Firebase operational dataset is development dummy data.

This does not approve DDL. The exact FK/type/index manifest is still missing; D01–D20 owner policy gates and split supplier receipt behavior remain open; the compatibility harness has not been deployed or run against TiDB. No Firebase snapshot, account verification, data cleanup, production change or application table creation occurred.


## N. FK/index reconciliation pass 2 — 2026-11-15

See [MYSQL_MIGRATION_FOREIGN_KEY_INDEX_RECONCILIATION_PASS2.md](./MYSQL_MIGRATION_FOREIGN_KEY_INDEX_RECONCILIATION_PASS2.md). The latest static pass confirms that the canonical FK/type/index manifest is still incomplete and schema v1 remains blocked. Key blockers include the encounter/invoice ownership chain, same-parent invoice component and batch allocation constraints, component-aware return quota identity, supplier payment/return ownership, queue guard integration, reversal/idempotency semantics, shift reconciliation versioning, and unresolved split supplier receipts. No DDL or TiDB runtime test is authorized or claimed. The pass is proposal-level only; exact SQL types, charset/collation, nullability, child index order and delete/update actions must still be normalized per FK.


## O. Normalized dictionary and FK manifest — pass 3

See [MYSQL_MIGRATION_NORMALIZED_COLUMN_DICTIONARY_FK_MANIFEST_PASS3.md](./MYSQL_MIGRATION_NORMALIZED_COLUMN_DICTIONARY_FK_MANIFEST_PASS3.md). It contains 99 numbered entries (F01–F99), some of which group multiple FK tuples; the earlier prose count of 104 individual candidate relationships remains to be verified by expanding every grouped entry. Pass 6 [FK reconciliation](./MYSQL_MIGRATION_FK_TYPE_OWNERSHIP_RECONCILIATION_PASS6.md) is a preliminary first-tuple static comparison only: 86 textual matches, 11 entries with supplemental fields/tables absent from Pass 4, 2 not mechanically comparable, and no explicit mismatch among directly compared first tuples. It is not full-manifest or runtime proof. User identity is VARCHAR(64); audit_events.event_uuid CHAR(36) is an event UUID. No DDL or TiDB runtime test is claimed.


## P. Exact physical column dictionary — pass 4

See [MYSQL_MIGRATION_EXACT_COLUMN_NULL_DEFAULT_DICTIONARY_PASS4.md](./MYSQL_MIGRATION_EXACT_COLUMN_NULL_DEFAULT_DICTIONARY_PASS4.md). Corrected static extraction enumerates 56 base tables / 566 columns, with unspecified NULL/default retained as blockers and source `UNSIGNED` modifiers preserved. The earlier apparent widespread ID signedness conflict was caused by an extraction-regex issue and is withdrawn. Remaining bare signed integer fields must be reviewed by semantic role and range (notably monetary amounts); all FK pairs still require exact type matching. Charset/collation, constraint actions, supplemental integrity tables and TiDB runtime tests remain open. No DDL has been performed.


## Q. NULL/default completeness matrix — pass 5

See [MYSQL_MIGRATION_NULL_DEFAULT_COMPLETENESS_MATRIX_PASS5.md](./MYSQL_MIGRATION_NULL_DEFAULT_COMPLETENESS_MATRIX_PASS5.md). Across 56 tables / 566 extracted columns, 65 nullability declarations and 535 default declarations remain unspecified in the proposal. This is a specification completeness measure, not a runtime error count. Do not fill these with generic defaults. Resolve lifecycle and ownership semantics first, then synchronize SQL, API validation and synthetic negative tests. No DDL or TiDB runtime validation has occurred.


## R. Schema scope control and anti-overfitting — pass 8

See [MYSQL_MIGRATION_SCHEMA_SCOPE_CONTROL_PASS8.md](./MYSQL_MIGRATION_SCHEMA_SCOPE_CONTROL_PASS8.md). The pass establishes evidence-first inclusion rules: core clinic workflows and essential integrity constraints remain in scope; speculative support tables (quota event ledger, outbox, guards, generic registries, partial-receipt bridge, file/export/backup orchestration) are conditional or deferred until source/owner evidence justifies them. It also records concrete Pass 4 dictionary anomalies and prioritizes ownership, stock, money, returns and concurrency over hypothetical feature coverage. This is documentation-only; no DDL or data mutation.


## S. Critical ownership chain matrix — pass 9

See [MYSQL_MIGRATION_CRITICAL_OWNERSHIP_CHAIN_MATRIX_PASS9.md](./MYSQL_MIGRATION_CRITICAL_OWNERSHIP_CHAIN_MATRIX_PASS9.md). Five high-risk ownership chains have targeted positive/negative test cases. Key blockers are partial-null encounter/shift identity, invoice patient snapshot policy, batch-bound movement semantics, quota component identity, and same-supplier purchase/return/payment relationships. This is static review only.


## R. Decision and requirement traceability closure — pass 10
See [MYSQL_MIGRATION_DECISION_AND_TRACEABILITY_CLOSURE_PASS10.md](./MYSQL_MIGRATION_DECISION_AND_TRACEABILITY_CLOSURE_PASS10.md). This pass consolidates workflow-to-domain traceability, distinguishes owner policy decisions from engineering decisions, identifies source-verification gates (medicine units, split receipts, batchless movement types, invoice patient semantics, queue lifecycle, auth provenance and legacy identity/timestamps), and explicitly defers conditional support tables absent evidence. It is documentation-only; schema v1 remains blocked and no DDL/TiDB runtime test is claimed.


## S. Source-verified workflow findings — pass 11
See [MYSQL_MIGRATION_SOURCE_VERIFIED_WORKFLOW_FINDINGS_PASS11.md](./MYSQL_MIGRATION_SOURCE_VERIFIED_WORKFLOW_FINDINGS_PASS11.md). Source review verifies the local purchase/FEFO/return/HPP behaviors and identifies specific target requirements: reject over-limit supplier returns rather than silently cap, use WIB business date, preserve invoice line/component snapshots, enforce staged return authority and separate payout, and do not rely on local demo seeding or 1,000-row audit truncation. Stale Firebase adapter email defaults are a high-priority identity crosswalk discrepancy. Static only; no runtime test or data mutation.


## T. Return/refund/cancellation state-machine audit — pass 12
See [MYSQL_MIGRATION_RETURN_REFUND_CANCELLATION_STATE_MACHINE_PASS12.md](./MYSQL_MIGRATION_RETURN_REFUND_CANCELLATION_STATE_MACHINE_PASS12.md). This pass details the observed cloud state machine and target invariants: atomic quota reserve/release, Admin forward, Pimpinan final approval/stock restore, separate one-time payout, line-level package quota, and invoice-level serialization against cancellation. It identifies the out-of-transaction query race pattern in legacy Firestore code and specifies independent-connection TiDB race tests. Static only; no runtime or DDL claim.


## U. Inventory movement source matrix — pass 13
See [MYSQL_MIGRATION_INVENTORY_MOVEMENT_SOURCE_MATRIX_PASS13.md](./MYSQL_MIGRATION_INVENTORY_MOVEMENT_SOURCE_MATRIX_PASS13.md). Source evidence supports one stock movement ledger for opening/seed, purchase, sale, return, cancellation, supplier return and loss/expiry. It also records projection mismatches and append-only reversal requirements. Batch lineage is mandatory for the observed stock-affecting workflows; batchless movement types remain narrowly defined and must be proven. No DDL or runtime reconciliation was performed.


## V. Inventory ledger FK lineage closure — pass 14
See [MYSQL_MIGRATION_INVENTORY_LEDGER_FK_LINEAGE_CLOSURE_PASS14.md](./MYSQL_MIGRATION_INVENTORY_LEDGER_FK_LINEAGE_CLOSURE_PASS14.md). The signed `quantity_delta` convention is selected over a duplicate direction column; movement type constrains sign. The review identifies critical cross-row ownership constraints that ordinary scalar FKs cannot prove, including sale movement/allocation identity, supplier invoice/line/batch chain, return/cancellation restoration lineage, reversal bounds and polymorphic source references. These remain service/tuple/runtime gates, not claimed-enforced constraints.


## Financial and cash ownership closure — pass 15

[Pass 15 financial/cash audit](./MYSQL_MIGRATION_FINANCIAL_CASH_OWNERSHIP_AUDIT_PASS15.md) traces the current source formulas and workflow ownership. It separates revenue adjustment (return approval date) from cash payout date, confirms opening float is not income, and flags report/cash-custody projection risks, petty/expense double-counting, one-method-per-invoice, supplier boolean settlement, and missing supplier credit/partial payment evidence. Schema v1 remains blocked on the listed owner/accounting decisions and synthetic reconciliation tests. No DDL or runtime test was performed.


## Financial reconciliation review — pass 16

[Pass 16 source-of-truth audit](./MYSQL_MIGRATION_FINANCIAL_RECONCILIATION_SOURCE_OF_TRUTH_PASS16.md) distinguishes period flows from cutoff balances and traces each financial aggregate to its source/date. It flags the non-reconciled cash-on-hand projection, original-sale vs refund-payout method filter mismatch, incomplete shift refund attribution, supplier settlement/credit gaps and expense-vs-petty duplication. The proposed target keeps commercial, collection, custody, expense, supplier, return and cancellation sources distinct. No schema approval or DDL is implied.


## Date and report-export consistency review — pass 17

[Pass 17 audit](./MYSQL_MIGRATION_OPERATIONAL_DATE_REPORT_FILTER_EXPORT_AUDIT_PASS17.md) records report parity blockers across UI, CSV and PDF, including ignored cashier/method filters, cancelled invoice leakage, discount allocation mismatch, undated legacy rows, UTC/WIB date inconsistency and snapshot-vs-period confusion. The target MySQL report contract must make date basis, timezone, filters, generated time and snapshot cutoff explicit and shared across screen/CSV/PDF.


## Role authorization and security review — pass 18

[Pass 18 audit](./MYSQL_MIGRATION_ROLE_AUTHORIZATION_DATA_SECURITY_AUDIT_PASS18.md) identifies identity and authorization blockers. The branch's hard-coded Admin and second-owner emails do not match the latest protected account list; do not run staff provisioning until all five accounts are mapped read-only to UID/profile/role. The current client-side role checks and collection listeners are not proof of deployed Firestore Rules enforcement. MySQL APIs must enforce actor identity, role, resource ownership, field projection and workflow transitions server-side.
