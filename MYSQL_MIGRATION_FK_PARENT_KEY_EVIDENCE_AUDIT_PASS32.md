# FK Parent PK / UNIQUE Evidence Audit — Pass 32

**Date:** 2026-11-16  
**Branch:** `migration/tidb-foundation`  
**Status:** STATIC PROPOSAL/CATALOGUE RECONCILIATION — NOT LIVE TI DB METADATA

## 1. Method

Each of the 116 current candidate tuples was checked against the matching parent table section in the schema proposal. The audit distinguishes declared parent PKs, declared UNIQUE tuples, addendum requirements not yet integrated into table definitions, catalogue-only composite-key requirements, and order mismatches. The companion CSV provides one row per FK candidate.

## 2. Results

| Evidence status | Rows | Meaning |
|---|---:|---|
| `PK_NOT_PROVEN` | 50 |
| `ADDENDUM_UNIQUE_REQUIRED_NOT_TABLE` | 5 |
| `EXPLICIT_PARENT_UNIQUE` | 1 |
| `EXPLICIT_PARENT_PK` | 51 |
| `NO_PARENT_TABLE_SECTION` | 1 |
| `CATALOGUE_COMPOSITE_KEY_NOT_TABLE` | 5 |
| `PARENT_UNIQUE_ORDER_MISMATCH` | 1 |
| `PARENT_PK_COVERS_UNIQUE` | 2 |

Single-column parent PKs count as unique and can satisfy a single-column FK even if the manifest labels the required key as UNIQUE. This applies to F81 and F94.

## 3. Material blockers

- **F04:** `user_emails(email_id,user_id)` is explicitly required as a composite UNIQUE in proposal §2.7, but it is not integrated into the table's own physical definition.
- **F15, F25, F33, F61:** `cashier_shifts(shift_id,cashier_user_id)` is explicitly required by proposal §2.8 but not present in the cashier_shifts table section.
- **F39, F49, F51, F57, F78:** the catalogue requires composite parent UNIQUE keys, but the matching parent table sections do not declare them.
- **F70:** material ordered-key mismatch. The FK tuple is `(invoice_id,invoice_line_id)`, while the proposed additional UNIQUE is written as `(invoice_line_id,invoice_id)`. The tuple and key order must be normalized together; do not generate this FK from the current wording.
- **F18:** `queue_prefix_guards` has a candidate definition in Pass 30 but still lacks an integrated dedicated table section and full key/index evidence.

## 4. Interpretation

The CSV's explicit PK/UNIQUE statuses are text-level evidence only. They are not evidence of actual TiDB metadata. Composite unique keys must be declared in the final DDL in exactly the referenced order. A candidate key in the catalogue or a statement that a key “must be added” is not equivalent to an integrated table definition.

## 5. Required next work

1. Integrate all required composite parent UNIQUE keys into the correct table definitions.
2. Correct F70 ordered tuple/key inconsistency.
3. Integrate supplemental tables and their exact keys/indexes.
4. Re-run the 116-row child-index and parent-key matrix against the reconciled canonical schema.
5. Validate all key definitions and FK creation on isolated TiDB before any data import.

## 6. Safety and verdict

No DDL, TiDB mutation, Firebase/Auth access or mutation, protected-account change, import, deployment, main merge or PR13 merge occurred.

**Verdict:** parent key definitions are not yet complete or internally consistent. Schema v1 remains **BLOCKED**.
