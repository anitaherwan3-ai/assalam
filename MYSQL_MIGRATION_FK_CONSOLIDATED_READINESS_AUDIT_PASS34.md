# Consolidated FK Readiness Gate — Pass 34

**Date:** 2026-11-16  
**Branch:** `migration/tidb-foundation`  
**Status:** CONSOLIDATED STATIC AUDIT — NOT DDL / NOT TI DB RUNTIME VALIDATION

## 1. Scope

Pass 34 joins the 116-row FK candidate/type matrix (Pass 28), child-index evidence (Pass 31), and parent-key evidence (Pass 32, including the F70 correction in Pass 33). The companion CSV has one row per candidate and independent columns for each release gate.

## 2. Verified inventory

- Candidate FK tuples: **116**.
- Type references: **256/256 populated** (type strings only; exact charset/collation not proven).
- Child index evidence:
  - `EXPLICIT_PROPOSAL_INDEX`: **30**
  - `NOT_FOUND_IN_TABLE_SECTION`: **74**
  - `NO_TABLE_SECTION_INDEX_EVIDENCE`: **9**
  - `EXPLICIT_PROPOSAL_LEADING_INDEX`: **3**
- Parent key evidence:
  - `EXPLICIT_PARENT_PK`: **101**
  - `ADDENDUM_UNIQUE_REQUIRED_NOT_TABLE`: **5**
  - `EXPLICIT_PARENT_UNIQUE`: **2**
  - `NO_PARENT_TABLE_SECTION`: **1**
  - `CATALOGUE_COMPOSITE_KEY_NOT_TABLE`: **5**
  - `PARENT_PK_COVERS_UNIQUE`: **2**
- Overall ready for DDL: **0/116**.

## 3. Gates still open for every or affected candidate

1. **Child index:** only proposal-text matches are evidence; no live TiDB index metadata has been inspected. Candidates without table-section evidence need explicit final index definitions.
2. **Parent key:** several composite UNIQUE tuples are only requirements in addenda/catalogue, not integrated in parent table definitions; F18 has no dedicated complete parent table section.
3. **Nullability:** the final all-null/all-present policy for composite relationships is not verified row by row.
4. **Charset/collation:** all text FK tuples require exact shared charset/collation declarations.
5. **Actions:** RESTRICT is a proposal-level default, not a per-FK TiDB-tested ON DELETE/ON UPDATE declaration.
6. **Ownership:** same-parent chains and polymorphic exactly-one targets require server-side enforcement and negative tests.
7. **Runtime:** no positive/negative FK test, rollback, concurrency or metadata reconciliation has been run against TiDB.

## 4. Key corrections already made

- F76 now references the explicit quota-subject primary key through a scalar FK; same-subject invoice-line/component equality is a separate server transaction invariant.
- F18 prefix type is normalized to VARCHAR(4), matching existing queue-prefix columns; collation and complete table definition remain open.
- F70 ordered parent UNIQUE now matches the FK tuple: (invoice_id, invoice_line_id), and the proposal table section declares that composite UNIQUE.

## 5. Exit verdict

All 116 candidates remain blocked for DDL. This is not a reason to abandon the migration; it is the exact checklist needed to finish the physical design without fabricating constraints. Do not apply DDL or import data until the physical and owner-policy gates are closed.

## 6. Safety

No DDL, TiDB schema/data mutation, Firebase/Auth access or mutation, protected-account change, import, deployment, main merge or PR13 merge occurred.
