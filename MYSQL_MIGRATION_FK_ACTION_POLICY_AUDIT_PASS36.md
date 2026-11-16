# FK ON DELETE / ON UPDATE Policy Evidence — Pass 36

**Date:** 2026-11-16  
**Branch:** `migration/tidb-foundation`  
**Status:** STATIC POLICY AUDIT — NO SQL ACTIONS APPROVED OR TESTED

## 1. Findings

The proposal gives a global RESTRICT default and says keys are immutable/no ON UPDATE CASCADE. It does not define explicit ON DELETE and ON UPDATE actions for each of the 116 candidate FK tuples. The companion CSV records the current policy evidence per candidate.

| ON DELETE evidence | Rows |
|---|---:|
| `RESTRICT_PROPOSAL_DEFAULT_NOT_PER_FK` | 115 |
| `OPEN_RESTRICT_OR_SET_NULL` | 1 |

F13 is specifically open: proposal §3.2 says the patient FK RESTRICT/SET NULL policy must be decided. The safe default is RESTRICT with patient archival, but the legacy orphan/nullable patient workflow needs an explicit rule before schema freeze.

## 2. Required canonical policy

- Default to `ON DELETE RESTRICT ON UPDATE RESTRICT` for identity, patient, encounter, invoice, stock, payment, return, audit and event history.
- Do not use cascade deletion for operational or historical records.
- Use archive/status/reversal rather than deleting clinic history.
- F13 must be explicitly resolved; do not silently apply SET NULL.
- System/import actor nullability is not permission to delete the user row.
- Record explicit per-FK actions in the final canonical manifest and test them on TiDB.

## 3. Exit verdict

All 116 candidates remain `ACTION_UNSPECIFIED` because a global prose default is not an explicit per-constraint DDL declaration or runtime test. Schema v1 remains **BLOCKED**.
