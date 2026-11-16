# FK Child Index Prefix Coverage — Pass 37

**Date:** 2026-11-16  
**Branch:** `migration/tidb-foundation`  
**Status:** STATIC PROPOSAL AUDIT — NOT LIVE TI DB INDEX METADATA

## 1. Why this pass supersedes the earlier index count

Pass 31 compared the candidate index text in Pass 3 against proposal table-section indexes. That was useful for spotting omissions, but it did not always test the exact FK rule: a child index must begin with the entire ordered FK child tuple. Pass 37 rechecks each candidate using its actual child tuple, recognizes inline UNIQUE/PK indexes and supplemental index statements, and tests leading-column coverage.

## 2. Results

| Evidence status | Rows | Meaning |
|---|---:|---|
| `INDEX_PREFIX_PRESENT_IN_PROPOSAL` | 41 |
| `NO_INDEX_PREFIX_IN_TABLE` | 72 |
| `NO_TABLE_INDEX_SECTION` | 3 |

Only **41/116** candidate tuples have a matching leading index described in the proposal. **72** have a table section but no matching supporting index declaration; **3** lack a complete table-section index definition.

## 3. High-priority gaps

The CSV identifies every affected candidate. Common patterns include:
- actor FKs whose user columns have no supporting index;
- composite shift/cashier, batch/medicine, quota/component and invoice ownership FKs without a matching composite child index;
- polymorphic medicine/tariff/package alternatives where only one target column has an index;
- supplemental `stocktake_lines` without any index section.

An index on only the first column of a composite FK is not sufficient to cover the full ordered tuple. A separate single-column unique index also does not automatically cover a different composite FK tuple.

## 4. Important limitation

This pass reads proposal text only. A declared candidate index is not a live TiDB index. The final schema must explicitly define or deliberately rely on a TiDB-created supporting index, then verify the actual index metadata after DDL. Avoid creating redundant indexes without checking existing leading-prefix coverage and EXPLAIN.

## 5. Safety and verdict

No DDL, TiDB mutation, Firebase/Auth access or mutation, protected-account change, import, deployment, main merge or PR13 merge occurred.

**Verdict:** child-index coverage is materially incomplete. Schema v1 remains **BLOCKED**.
