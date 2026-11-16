# FK Child Nullability and Optional-Composite Semantics — Pass 35

**Date:** 2026-11-16  
**Branch:** `migration/tidb-foundation`  
**Status:** STATIC DICTIONARY/PROPOSAL AUDIT — NOT RUNTIME VALIDATION

## 1. Method

Pass 35 extracts child-side FK nullability from Pass 4 and explicit proposal table definitions, then supplements the known integrity tables. Primary-key columns are treated as NOT NULL. It does not invent NULL/NOT NULL where source definitions omit them. The companion CSV contains all 116 candidate FK rows and their ordered child nullability vector.

## 2. Candidate tuple patterns

| Pattern | Rows | Meaning |
|---|---:|---|
| `SINGLE_NOT_NULL` | 75 |
| `SINGLE_NULLABLE` | 28 |
| `COMPOSITE_ALL_NOT_NULL` | 7 |
| `SINGLE_UNSPECIFIED` | 1 |
| `OPTIONAL_FIRST_COLUMN_NULLABLE` | 5 |

The matrix leaves unspecified child nullability visible instead of assuming engine defaults.

## 3. Important nullable composite relationships

- **F15 — encounter shift/cashier:** `shift_id` is nullable while `cashier_user_id` is NOT NULL. This is an optional shift association, not an all-null tuple. NULL means no shift relationship (legacy/quarantined records only); when shift_id is present, the composite FK must prove the shift belongs to that cashier. New checkout must require an active shift.
- **F49 — batch/receipt line:** `supplier_invoice_line_id` is nullable while medicine_id is NOT NULL. NULL is allowed for opening/seed batches; when present, the receipt line must match the batch medicine.
- **F51 — movement/batch:** batch_id is nullable for non-batch movements; when present it must match medicine_id. The separate medicine FK still validates medicine existence.
- **F57 — stocktake line/batch:** batch_id is nullable for aggregate stocktake rows; when present it must match medicine_id.
- **F78 — quota subject/component:** invoice_component_id is nullable for non-component lines; when present it must belong to invoice_line_id.
- **F08, F25, F33, F39, F61, F70:** composite columns are all NOT NULL in the candidate definitions and can enforce same-parent ownership once the exact ordered parent UNIQUE and child index exist.

## 4. Remaining nullability gap

The current source leaves **0** composite tuple row(s) and **1** single FK row(s) with unspecified child nullability. The single unspecified case must be resolved before schema freeze. Any optional composite FK must have a documented conditional rule and negative tests for a mismatched non-null parent.

## 5. Safety and verdict

No DDL, TiDB mutation, Firebase/Auth access or mutation, protected-account change, import, deployment, main merge or PR13 merge occurred.

**Verdict:** source nullability is now mapped for the candidate FKs. Optional composite semantics are documented, but exact actions, keys/indexes, service checks and TiDB tests remain open. Schema v1 remains **BLOCKED**.
