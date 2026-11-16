# FK Child-Index Evidence Audit — Pass 31

**Date:** 2026-11-16  
**Branch:** `migration/tidb-foundation`  
**Status:** STATIC PROPOSAL AUDIT — NOT LIVE DATABASE METADATA

## 1. Method

The 116 current candidate tuples in the Pass 28 matrix were compared against index declarations inside the matching table sections of `MYSQL_MIGRATION_SCHEMA_PROPOSAL.md`. The audit distinguishes exact declared tuples, leading-prefix coverage, missing table-section evidence, and absent table-section index declarations. The companion CSV has one row per candidate.

An index mentioned in the proposal is still only a design declaration. This pass does not inspect TiDB metadata and does not claim that an index exists in a deployed database.

## 2. Results

| Evidence status | Rows | Meaning |
|---|---:|---|
| `EXPLICIT_PROPOSAL_INDEX` | 30 | Required tuple appears in table section |
| `NOT_FOUND_IN_TABLE_SECTION` | 74 | No matching declaration in the table section |
| `NO_TABLE_SECTION_INDEX_EVIDENCE` | 9 | No table-section index evidence for supplemental/incomplete table |
| `EXPLICIT_PROPOSAL_LEADING_INDEX` | 3 | A declared index begins with FK tuple |

The proposal has explicit index text for only a subset of candidate FK child tuples. A large remainder is present only as a requirement in the FK manifest/catalogue, not as a table-level declaration. The 9 no-section cases include supplemental or incomplete definitions such as `active_email_claims`, `active_role_slots`, `stocktake_lines`, and `sales_return_events`.

## 3. Important interpretation

- `EXPLICIT_PROPOSAL_INDEX` and `EXPLICIT_PROPOSAL_LEADING_INDEX` mean only that the current proposal text describes a suitable candidate index.
- `NOT_FOUND_IN_TABLE_SECTION` is not a claim that TiDB lacks the index; it means the schema proposal has not explicitly defined it in that table's section.
- `NO_TABLE_SECTION_INDEX_EVIDENCE` means the supporting table definition is incomplete or only described in an addendum.
- Parent UNIQUE/PK requirements are a separate gate and are not closed by child index evidence.
- Composite ownership, nullable tuple semantics, exact collation, actions, and TiDB runtime tests remain independent release blockers.

## 4. Required next step

Produce a canonical per-table index/unique-key inventory that merges table definitions and the FK catalogue, resolves every missing child index and parent key, and then validate the final DDL with TiDB metadata and EXPLAIN. Do not infer that all 116 constraints can be applied just because an index candidate is listed.

## 5. Safety and verdict

No DDL, TiDB mutation, Firebase/Auth access or mutation, account change, import, deployment, main merge or PR13 merge occurred.

**Verdict:** child-index evidence is incomplete in the proposal. Schema v1 remains **BLOCKED**.
