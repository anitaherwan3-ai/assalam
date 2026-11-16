# F70 Parent Composite-Key Order Correction — Pass 33

**Date:** 2026-11-16  
**Branch:** `migration/tidb-foundation`  
**Status:** STATIC DESIGN CORRECTION — NOT DDL / NOT TI DB RUNTIME VALIDATION

## 1. Finding

Pass 3 and the canonical catalogue disagreed on the ordered parent key for F70:
- Child tuple: `invoice_discount_allocations(invoice_id,invoice_line_id)`
- Parent tuple: `sales_invoice_lines(invoice_id,invoice_line_id)`
- One note incorrectly proposed `UNIQUE(invoice_line_id,invoice_id)`, which is reversed relative to the FK tuple.

An FK's child and parent tuple order must correspond to the referenced ordered parent key. The reverse-order UNIQUE is not an acceptable substitute for the current F70 tuple.

## 2. Canonical correction

Keep the existing child and parent tuple order and declare:
`UNIQUE sales_invoice_lines(invoice_id,invoice_line_id)`.

The existing `sales_invoice_lines` primary key remains `invoice_line_id`; the additional composite UNIQUE is intentionally required as a referenced key for the invoice ownership FK. `invoice_discount_allocations` already declares `UNIQUE(invoice_id,invoice_line_id)` for its own row identity.

Pass 33 updates:
- Pass 3 F70 manifest row.
- Canonical FK/index catalogue parent-key order.
- Schema proposal §6.2 with the explicit parent composite UNIQUE.
- Pass 32 parent-key evidence CSV and interpretation.

## 3. Current parent-key evidence status

The corrected parent-key evidence matrix now records F70 as `EXPLICIT_PARENT_UNIQUE` in the proposal text. The remaining composite-key requirements are still not integrated into their parent table sections or are only present as addendum/catalogue requirements. The queue-prefix guard table also still lacks a dedicated table section.

## 4. Safety and verdict

This is a documentation/schema-proposal correction only. No DDL, TiDB metadata/data mutation, Firebase/Auth access or mutation, protected-account change, import, deployment, main merge or PR13 merge occurred.

**Verdict:** F70's ordered-key contradiction is corrected in the proposal. Its TiDB FK creation and positive/negative ownership tests remain unverified; schema v1 remains **BLOCKED**.
