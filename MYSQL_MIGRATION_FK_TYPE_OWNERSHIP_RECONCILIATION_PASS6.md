# FOREIGN KEY TYPE & OWNERSHIP RECONCILIATION — PASS 6

Tanggal: 2026-11-15  
Branch: `migration/tidb-foundation`  
Sources: `MYSQL_MIGRATION_NORMALIZED_COLUMN_DICTIONARY_FK_MANIFEST_PASS3.md` and `MYSQL_MIGRATION_EXACT_COLUMN_NULL_DEFAULT_DICTIONARY_PASS4.md`  
Status: **STATIC RECONCILIATION ONLY — NOT EXECUTABLE DDL / NOT TiDB RUNTIME VALIDATION**

## 1. Ringkasan hasil

- FK manifest contains **99 numbered entries (F01–F99)**. The earlier statement of **104 candidate relationships** may count individual FK tuples inside grouped entries; the 99 numbered rows are not necessarily 99 individual constraints. The precise individual-tuple count is not independently verified in this pass.
- The initial parser compared only the first concrete tuple expression in each numbered entry. It did **not** expand grouped actor FKs or all alternatives inside multi-target rows. Therefore its result is a preliminary sample, not complete coverage of all candidate relationships.
- Preliminary first-tuple comparison: **86** textual matches; **11** entries reference supplemental/unmodeled columns or tables absent from the Pass 4 base-table extraction; **2** entries are abbreviated/multi-target and cannot be compared mechanically; **0** explicit type mismatches detected among directly comparable first tuples.
- The prior assertion that F100–F104 were missing is withdrawn. No missing five FK IDs have been established; the discrepancy is between numbered entries and the earlier count of individual candidate relationships, and must be reconciled by expanding grouped entries.

A textual match is not proof of a valid FK: it does not verify actual SQL parent UNIQUE/PK declarations, index order, collation, nullable tuple semantics, ON DELETE/UPDATE, engine support, or runtime behavior. No constraints are created by this report.

## 2. Static tuple comparison by FK ID

**Scope warning:** the table below classifies only the first concrete child-parent tuple parsed from each numbered entry. Grouped tuples (for example actor columns) and polymorphic alternatives require a second expanded pass. The 86/11/2 figures are therefore not a full-manifest pass rate.

| Result | FK IDs | Interpretation |
|---|---|---|
| First tuple type matches textually | F01, F02, F05, F06, F09, F10, F11, F12, F13, F14, F15, F16, F17, F19, F20, F21, F22, F23, F24, F25, F26, F27, F28, F29, F30, F31, F32, F33, F34, F35, F36, F37, F38, F39, F40, F41, F42, F43, F44, F45, F46, F47, F48, F49, F50, F51, F52, F53, F54, F58, F59, F60, F61, F62, F64, F66, F67, F68, F69, F70, F71, F72, F73, F74, F75, F77, F78, F81, F82, F83, F84, F85, F86, F87, F88, F89, F90, F91, F92, F93, F94, F95, F96, F97, F98, F99 | Preliminary only; grouped tuples not expanded |
| Missing table/column in Pass 4 | F03, F04, F07, F08, F18, F55, F56, F57, F76, F79, F80 | Supplemental or unmodeled tables need full definitions |
| Not mechanically comparable | F63, F65 | Multi-target/abbreviated mapping must be expanded |
| Explicit type mismatch | None detected | Block DDL until resolved |

## 3. Critical structural gaps

1. **Manifest cardinality reconciliation:** table has 99 numbered entries, while earlier prose says 104 candidate relationships. Several numbered entries group multiple child FK tuples. Expand every grouped row and count actual tuples before deciding whether the 104 count is correct; do not invent IDs F100–F104.
2. **Supplemental tables lack complete physical definitions:** `active_email_claims`, `active_role_slots`, `queue_prefix_guards`, `stocktake_lines`, `sales_return_events`, and `return_quota_subjects` (plus any missing event/guard/quota tables) must have full column, PK, UNIQUE, NULL/default, FK, index, and actor provenance definitions before DDL.
3. **Polymorphic target references:** F63/F65 must be represented as mutually exclusive typed nullable FKs plus exactly-one validation, or redesigned as a common supertype/reference table. A loose `medicine_id`/`tariff_id`/`package_id` combination is not enough without a CHECK or transactional API invariant and negative tests.
4. **Nullable composite references:** F15/F51/F57 and similar pairs require an all-null/all-present rule. A composite FK with one NULL component does not prove the non-null component belongs to the intended parent.
5. **Ownership chain:** invoice must belong to the same encounter, patient, shift, and cashier; return quota subject must belong to the same invoice line/component; supplier return line/batch/invoice and supplier payment allocation/invoice must share the same supplier. Single-column FKs do not prove these ownership chains.
6. **Parent unique tuples:** every composite child FK requires an exact parent UNIQUE tuple in identical order and exact type/collation. Pass 3 lists required tuples but does not prove all are declared in base table definitions.
7. **Index/action gaps:** child indexes must be declared in exact tuple order; ON DELETE/UPDATE must be explicit for every FK. RESTRICT is a policy principle, not yet a physical declaration inventory.

## 4. Priority ownership constraints to close

- Shift ownership: `(shift_id,cashier_user_id)` for encounters, invoices, petty cash, and active shift slots; require matching composite parent key.
- Encounter ownership: invoice `(encounter_id,patient_id,shift_id,cashier_user_id)` must match the encounter tuple; current patient nullable policy prevents a full tuple until resolved.
- Inventory: `(batch_id,medicine_id)` and receipt allocation identity; batch may not be assigned to a different medicine or invoice line.
- Invoice allocation: line/component/batch/movement tuple must prove that the deducted stock belongs to the same invoice line/component and medicine.
- Return quota: use a non-null `subject_type` + `subject_id` identity or separate line/component quota tables; avoid nullable component discriminator and conflicting IDs.
- Supplier chain: supplier invoice → receipt line → batch → supplier return line/credit note; supplier payment allocation must reference an invoice belonging to the same supplier.
- Audit actors: distinguish human/system/import/unknown provenance; nullable actor alone is insufficient to identify the principal.

## 5. TiDB test matrix required after definitions are complete

1. Insert valid parent and child rows for every FK and composite FK.
2. Reject orphan child references and wrong-parent composite tuples.
3. Reject mixed NULL composite tuples; accept only documented all-null/all-present cases.
4. Reject cross-cashier shift, cross-patient encounter/invoice, cross-medicine batch, cross-invoice return quota, cross-supplier receipt/return/payment allocations.
5. Test RESTRICT behavior on delete/update; verify archive/reversal flows instead of hard delete.
6. Test index presence/order via metadata inspection and query plans for hot paths.
7. Test concurrent insert/update, retries, duplicate idempotency keys, and rollback on multi-row transaction failure.
8. Verify FK/CHECK support and behavior on the exact TiDB Starter cluster version before relying on it.

## 6. Exit criteria before DDL

Do not generate or apply application DDL until (a) F01–F99 are reconciled and missing F100–F104 are sourced or formally withdrawn, (b) supplemental tables are fully defined, (c) all 99 concrete tuples have exact parent key and child index definitions, (d) nullable/polymorphic/ownership invariants have physical or service enforcement plus negative tests, (e) all ON DELETE/UPDATE actions are decided, and (f) D01–D20 policy gates have owner decisions. Firebase, the five protected accounts, production deployment, and main branch remain untouched.


## 7. Correction to initial cardinality interpretation

The first draft incorrectly interpreted F01–F99 as proving that F100–F104 were absent. That is withdrawn. The manifest numbers rows/entries, and some entries bundle multiple actor or alternative relationships. A complete next pass must expand every field-level FK tuple (including grouped actor references, supplier/payment/return chains and polymorphic alternatives), then produce a one-row-per-FK inventory. Until that expansion, neither 99 nor 104 should be presented as a verified count of individual SQL constraints. The preliminary 86/11/2 comparison is limited to the first concrete tuple in each numbered row.
