# Physical FK Manifest Reconciliation & Readiness Audit — Pass 27

**Date:** 2026-11-16  
**Branch:** `migration/tidb-foundation`  
**Status:** STATIC DOCUMENT RECONCILIATION — NOT DDL / NOT TiDB RUNTIME VALIDATION

## 1. Scope and evidence

Rechecked the current branch copies of:
- `MYSQL_MIGRATION_NORMALIZED_COLUMN_DICTIONARY_FK_MANIFEST_PASS3.md`
- `MYSQL_MIGRATION_EXACT_COLUMN_NULL_DEFAULT_DICTIONARY_PASS4.md`
- `MYSQL_MIGRATION_NULL_DEFAULT_COMPLETENESS_MATRIX_PASS5.md`
- `MYSQL_MIGRATION_FK_FIELD_LEVEL_EXPANSION_PASS7.md`
- `MYSQL_MIGRATION_CANONICAL_FK_INDEX_CATALOGUE.md`
- `MYSQL_MIGRATION_SCHEMA_PROPOSAL.md`
- `MYSQL_MIGRATION_SCHEMA_REVIEW.md`
- `MYSQL_MIGRATION_SCHEMA_CONTRADICTION_SOURCE_IDENTITY_CLOSURE_AUDIT.md`
- `MYSQL_MIGRATION_KEY_TYPE_CONCURRENCY_CLOSURE_AUDIT.md`

This pass checks document cardinality and physical-readiness claims. It does not generate a complete 116-row type/index matrix and does not establish that any candidate FK works on TiDB.

## 2. Reproducible counts

| Measure | Verified count | Interpretation |
|---|---:|---|
| Main proposed tables in Pass 4 | 56 | Base table definitions scanned |
| Extracted columns in Pass 4 | 566 | Static extraction, not a final complete physical dictionary |
| Columns without explicit NULL/NOT NULL | 65 | Attribute unspecified, not automatically nullable |
| Columns without explicit DEFAULT | 535 | Attribute unspecified, not default zero |
| Explicit nullability declarations | 501 | Per Pass 5 summary |
| Explicit DEFAULT declarations | 31 | Per Pass 5 summary |
| Bare integer declarations without UNSIGNED | 50 | Signedness must be reviewed by semantic role |
| Pass 3 numbered FK rows | 104 | F01–F104, each ID occurs once |
| Grouped rows expanded in Pass 7 | 10 | F12, F23, F35, F54, F60, F63, F65, F74, F86, F90 |
| Extra tuple candidates from expansion | 12 | Grouped rows represent 22 tuples, not 10 |
| Literal FK tuple candidates | 116 | 94 single-tuple rows + 22 expanded tuples |
| Approved/applied physical FK constraints | 0 | No DDL has been applied |

The 116 figure is a candidate inventory count only. It is not a passing test count, an FK coverage percentage, or a statement that 116 physical constraints should all be created. Polymorphic alternatives, nullable relations and unresolved ownership tuples may require service validation, redesign or exclusion.

## 3. Material documentation contradictions found

### C27-01 — Pass 3 release paragraph contradicts its own manifest

A fresh scan of the Pass 3 file finds 104 unique numbered rows, F01–F104, with no missing or duplicate F-ID. Its final release paragraph nevertheless says 99 rows (F01–F99) and says F100–F104 are absent. That paragraph is demonstrably stale/incorrect and is corrected in the Pass 3 file.

### C27-02 — Pass 7 tuple arithmetic is wrong by one

Pass 7 correctly lists ten grouped rows and expands them into 22 tuple candidates, which adds 12 to the base 104. Its table incorrectly labels the result as “104 + 11”. Correct arithmetic is 104 + 12 = 116. The table and explanation are corrected in the Pass 7 file.

### C27-03 — Pass 4 calls 104 numbered rows “104 candidate relationships”

Pass 4's wording can be read as 104 individual FK tuples. The correct distinction is 104 numbered source rows versus 116 literal expanded tuple candidates. The Pass 4 wording is corrected; neither count represents approved physical constraints.

### C27-04 — Earlier Pass 6 first-tuple extraction metrics remain withdrawn

Pass 7 already withdraws the earlier 86/11/2 comparison as a complete-manifest metric because the input was truncated and grouped tuples were not expanded. This pass preserves that withdrawal. Do not quote a type-match percentage from the incomplete extraction.

## 4. Physical readiness gaps still open

1. **Exact type vector:** every child/parent tuple needs exact SQL type, precision/scale, signedness, varchar length, charset and collation.
2. **Parent key existence:** every composite parent tuple must be backed by an actually declared ordered PK/UNIQUE key in the final table definition.
3. **Child index coverage:** every FK tuple needs a child index with the correct leading column order; query indexes must additionally be justified by workload and EXPLAIN.
4. **Null tuple semantics:** define all-null/all-present rules. A composite FK with a NULL component does not prove ownership of the remaining components.
5. **Same-parent ownership:** encounter/patient/shift/cashier; invoice/encounter/patient/shift/cashier; invoice line/component/batch/movement; return quota/line/component; supplier/return/receipt line/batch/credit/payment must be enforced as one consistent chain.
6. **Polymorphic targets:** exactly-one medicine/tariff/package target and polymorphic source/entity references need explicit service rules or typed relational alternatives; they are not unconditional scalar FKs.
7. **Conditional tables:** queue prefix guards, return quota events, supplier line-to-batch allocations, outbox/jobs and other supplemental tables need full physical definitions before inclusion.
8. **Actions and lifecycle:** explicit ON DELETE/UPDATE, actor/system/import provenance, immutable history, reversal cardinality, reconciliation revision semantics and idempotency must be fixed.
9. **TiDB runtime:** FK enforcement, composite FK type matching, nullable UNIQUE behavior, row locking, transaction rollback, concurrent first-use counter creation, and query plans remain untested.

## 5. Immediate correction set applied

- Pass 3: correct release status to 104 numbered rows F01–F104; state that the 99-row count and missing-F100–F104 claim are erroneous; retain 116 as the literal expanded candidate tuple count.
- Pass 4: distinguish 104 numbered FK rows from 116 expanded tuple candidates.
- Pass 7: correct 104 + 11 to 104 + 12; keep the 116 candidate count and the withdrawal of incomplete Pass 6 metrics.
- This Pass 27 report records the reproducible evidence and remaining blockers.

## 6. Next exact engineering deliverable — completed in Pass 28

The 116-row machine-checkable matrix is now recorded in [MYSQL_MIGRATION_PHYSICAL_FK_TUPLE_MATRIX_PASS28.md](./MYSQL_MIGRATION_PHYSICAL_FK_TUPLE_MATRIX_PASS28.md) and its companion [CSV](./MYSQL_MIGRATION_PHYSICAL_FK_TUPLE_MATRIX_PASS28.csv). It expands all ten grouped rows, retains F76 as an undefined ownership tuple, and records exact Pass 4 type strings where extractable. Pass 28 still leaves all 116 candidates unapproved; 101 are unresolved, 10 are ownership-blocked, and 5 are polymorphic-policy-blocked. The next work is to close physical metadata and semantic gaps, then run isolated TiDB tests—not to generate/apply DDL yet.

Original required manifest fields:

`candidate_id, source_FK_ID, child_table, child_columns_ordered, parent_table, parent_columns_ordered, arity, child_type_vector, parent_type_vector, charset_collation, child_nullability, parent_key_kind, parent_key_columns_ordered, child_index_columns_ordered, on_delete, on_update, ownership_invariant, enforcement_method, positive_test_id, negative_test_id, status`.

Allowed statuses must distinguish `MATCH_CANDIDATE`, `TYPE_MISMATCH`, `MISSING_CHILD_COLUMN`, `MISSING_PARENT_COLUMN`, `MISSING_PARENT_UNIQUE`, `MISSING_CHILD_INDEX`, `NULL_TUPLE_BLOCKED`, `POLYMORPHIC_POLICY_BLOCKED`, `OWNERSHIP_BLOCKED`, `ACTION_UNSPECIFIED`, and `UNRESOLVED`. A row cannot be marked ready merely because scalar types match.

## 7. Safety and readiness

No DDL was generated/applied, no TiDB table/data was changed, no live Firebase/Auth data was read or mutated, no protected account was changed, no import, deployment, merge to `main`, PR13 merge or production operation occurred.

**Verdict:** document cardinality inconsistencies are corrected, but the physical FK/type/index manifest remains incomplete. Schema v1 remains unapproved and not ready for DDL or migration.
