# Klinik Assalaam — Owner Policy Proposals (Pass 57)

**Branch:** `migration/tidb-foundation`  
**Status:** proposal register only — NOT owner approval, NOT runtime configuration, NOT DDL approval  
**Current source of truth:** Firebase  
**Target:** TiDB Cloud

## Purpose and safety

This pass turns the open decision list into concrete, reviewable recommendations so that the team does not repeatedly restart the same discussion or silently invent clinic policy.

The machine-readable proposal is `config/proposed-clinic-policies.v1.json`. It is intentionally marked:
- `documentStatus = PROPOSAL_ONLY_NOT_OWNER_APPROVAL`
- `doNotUseAsRuntimeConfig = true`
- `policyActivationAllowed = false`
- empty owner approval fields.

It is not read by the application or migration runner. The production cutover manifest remains unchanged, with owner-policy, schema, data-source, import, security, restore and cutover gates closed. This work does not alter Firebase, Auth identities, production, `main`, PR13 or deployments.

## Recommended policy closure

| Decision | Safe candidate | What still needs approval/evidence |
|---|---|---|
| D01 units/fractions | Per-medicine canonical smallest dispensing unit; integer stock by default for countable items; fractions only with an explicitly approved scale; exact conversion and no silent rounding. | Real unit, package conversion and fractional-dispensing practice for each medicine. |
| D05 patient-return medicine | Quarantine first; no returned item becomes sellable without documented inspection, original batch traceability and approval by a Pimpinan-designated medicine-responsible person. | Authorized inspector, whether any opened/patient-held medicine may be resold, and checklist. |
| D06 package allocation | Snapshot component prices/discounts at checkout; only carry forward largest-remainder allocation if source-code parity proves it. | Source parity and approval of refund behavior for services already delivered. |
| D08 expenses | Maker-checker; requester cannot approve own expense; thresholds configurable. Until thresholds are approved, require a separate approver for every expense. | Approver roles, thresholds and emergency exception. |
| D09 petty cash | Separate opening float, cash advances, expenses and reimbursements; advance is not expense until settled with evidence. | Categories, settlement deadline, custodian and approver. |
| D10 supplier credits | Dispatch changes stock only; supplier payable changes only on a supplier credit note/refund/approved offset with evidence. | Acceptable supplier settlement proof and approver. |
| D11 supplier payment | Multiple/partial payments can be represented with allocation rows; no allocation over payment or payable balance. Never fabricate payment events from legacy `lunas`. | Confirm actual payment patterns and evidence requirements. |
| D12 shift verification | Cashier cannot verify own close; preserve expected/count/variance separately. | Which roles verify each shift and exceptions. |
| D13 refunds | Confirmed: Cashier submission → Admin review → Pimpinan final decision; payout is a separate Pimpinan-only action. Record actual method, source account, date, recipient/reference and evidence. | Accepted payout methods and source cash/bank accounts. |
| D14 non-cash | Keep revenue, payment report, settlement and available cash distinct. Transfer/QRIS starts pending; bank/clearing balance changes only on verifiable settlement. Record fees separately. | Supported channels, settlement evidence and timing. |
| D15 opening stock/HPP | Signed physical count by medicine and batch; trace quantity, batch, expiry and HPP evidence. Untraceable stock is quarantined/reviewed; unknown HPP stays unknown. | Count date, counters, valuation method for missing purchase evidence. |
| D16 queue A/B | Keep A/B separate and selectable; candidate is one active call per lane, with append-only call/recall/cancel/transfer events. | Actual lane meaning, active-call scope and transfer authority. Do not merge PR13. |
| D17 old timestamps | Preserve raw source value; normalize only when unambiguous; otherwise leave normalized date null and quarantine from date-sensitive reports. | Source profile and specific exceptions. |
| D18 medical record retention | Apply the legal minimum of 25 years from the patient's last visit for electronic medical records; corrections are attributable amendments; legal hold blocks destruction. | Correction/release/legal-hold workflow and retention for other operational records. |
| D19 audit | Server-authored append-only audit; category-specific retention; checksum-backed exports and legal hold. | Retention schedule by audit category and export/hold authority. |
| D20 authentication | Keep Firebase Auth during data migration; server verifies tokens and maps provider UID to immutable internal user ID. Protect existing identities; no implicit account creation/reactivation. | Read-only UID/profile/role evidence, unknown role verification, long-term provider and recovery policy. |

## Requirements already confirmed and carried forward

- Fixed clinic identity: **Klinik Assalaam Palembang**.
- Keep the five protected account identities intact:
  - `assalamkasir1@gmail.com` — Kasir Pagi
  - `assalamkasir2@gmail.com` — Kasir Sore
  - `assalamadmin@gmail.com` — Admin
  - `praktekrose@gmail.com` — Pimpinan
  - `nursalim422@gmail.com` — protected; role must be verified, not inferred.
- Return workflow and stock restoration guardrails described above.
- A/B queue views, digit-by-digit spoken number, and independent voice/chime settings remain requirements; optional MP3 enhancement stays a backlog item.
- `Batal Berobat` preserves the visit/ticket history.
- Opening shift float is not omzet.
- No production data cutover before reconciliation, backup/restore, rollback and explicit owner approval.

## Legal baseline checked

- **Permenkes No. 24 Tahun 2022 tentang Rekam Medis**, Article 39(1) sets a minimum 25-year storage period for electronic medical record data from the patient's last visit. Article 39(2) allows continued retention after that point where the data will still be used. The BPK regulation portal currently lists this regulation as **Berlaku**.
- **UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi**, Articles 43–47 address deletion/destruction and related controller duties. This means the system must not implement either unconditional indefinite retention or automatic erasure without checking the applicable retention schedule, purpose, legal hold and statutory rules.

Sources:
- BPK regulation record: https://peraturan.bpk.go.id/Details/245544/p
- Official BPK PDF: https://peraturan.bpk.go.id/Download/301563/Permenkes%20Nomor%2024%20Tahun%202022.pdf
- Kemenkes JDIH record: https://jdih.kemkes.go.id/documents/peraturan-menteri-kesehatan-nomor-24-tahun-2022
- Komdigi JDIH — UU 27/2022: https://jdih.komdigi.go.id/produk_hukum/view/id/832/t/undangundang%20nomor%2027%20tahun%202022

## Implementation that can proceed without owner sign-off

1. Preserve all raw timestamps and add migration-quality classifications; never backfill unknown event time with migration time.
2. Build the database model to support per-medicine quantity scale, append-only movement ledger, batch disposition, payment allocations, supplier credits, refund obligations/payouts and audit events — but do not activate clinic-specific values.
3. Keep patient-return stock quarantined unless an authorized inspection decision is present.
4. Keep transfer/QRIS payments pending settlement until evidence is recorded.
5. Keep supplier credit and refund payout separate from physical stock dispatch and approval.
6. Add reconciliation reports and evidence capture before any bulk import.
7. Keep Firebase Auth as the interim identity provider and preserve protected users.
8. Keep all operational endpoints/UI cutover disabled until the approved schema, SQL adapter and real TiDB tests are complete.

## D17 engineering primitive added in this pass

`lib/legacy-timestamp-normalizer.js` implements a conservative source-time conversion helper:

- RFC 3339/ISO timestamps are normalized only when an explicit `Z` or numeric UTC offset exists.
- Numeric epoch values require an explicit source declaration of seconds or milliseconds; the code does not guess from digit count.
- Firestore-style `{ seconds, nanoseconds }` values are supported with range validation.
- Missing, malformed, date-only, local-time-without-offset or undeclared numeric values retain the raw source value and return `needs_review`; migration time is never substituted.
- Fractional timestamp digits are preserved in the normalized UTC value where supplied.

The helper is intentionally not wired to live import routes. Source-specific collection mapping and raw timestamp profile remain required before use in a migration run. Tests cover explicit offsets, epoch units, Firestore nanos and ambiguous values.

## Source evidence still required

- Deployed Firestore Rules snapshot and version.
- Deployed Firebase Functions source/version for transactional writes and account bootstrap.
- Read-only Firebase Auth UID/profile/role export.
- Purchase-line → split-receipt → batch lineage examples.
- Timestamp/raw-value profile by collection and source type.
- Exact TiDB FK type/action/parent-key/child-index manifest and real two-connection locking tests.

## Readiness verdict

This pass makes the policy questions concrete and assigns safe engineering defaults, but it does **not** close the owner-policy gate. The proposals must be explicitly approved and any required source evidence must be attached before physical domain DDL is frozen. No live data extraction, DDL, data import, Firebase change, deployment, production change, merge, or account mutation was performed.
