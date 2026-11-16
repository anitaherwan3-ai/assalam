# Owner Policy Decisions — Pass 58

Date: 2026-11-17  
Branch: `migration/tidb-foundation`  
Base commit: `aabf4a026074e49ea9bd9de165df9ced84a0b924`

This pass records the owner's latest decisions. The policy file remains proposal/approval evidence only; it is deliberately not a runtime configuration and does not activate production behavior.

## Confirmed decisions

| ID | Owner decision | Implementation constraint |
|---|---|---|
| D05 | Admin performs inspection and records release, but only after Pimpinan approval. | Return stays in quarantine and unavailable to FEFO until Pimpinan approval AND Admin inspection/release event are both present. Refund approval is separate from inventory disposition. |
| D13 | Refund method and source account must be recorded. | Payout requires Pimpinan authorization, a configured actual method/account, amount, recipient/reference, date and evidence. No account or method is invented or hardcoded. |
| D14 | Accepted. Non-cash payment remains pending until Pimpinan review; after approval it is recognized as income. | Settlement to bank/provider remains separately reconciled; approval does not fabricate bank settlement. |
| D16 | Morning shift = lane A = Kasir 1 (`assalamkasir1@gmail.com`). Evening shift = lane B = Kasir 2 (`assalamkasir2@gmail.com`). | Separate lane state and one active call per lane. Overrides/transfers must be authorized and audited. |
| D19 | Audit retention minimum = 1 year. | Longer applicable accounting/tax/legal retention and legal hold take precedence; no deletion during hold. |

## D13 account setup boundary

The owner has confirmed that the refund method and account must be specified, but has not supplied the actual clinic cash/bank account register or the allowed method list. Therefore the schema must support a configured account/method catalogue and require selection for each payout. Posting is blocked until a valid configured account, method and required evidence exist.

## Scope and safety

- D01 and D17 remain owner-confirmed from Pass 57.
- D18 remains an administrative/financial application, not a clinical medical-record system.
- Protected user identities and production Firebase remain unchanged.
- No Firebase extraction, TiDB DDL, operational data import, production deployment, production mutation, merge, or Firebase disconnection is authorized by this decision record.
- The policy JSON remains `doNotUseAsRuntimeConfig: true`; implementation must wait for the SQL schema/repository, authorization checks and real TiDB integration tests.

## Remaining open items

- D05: Admin role assignment and inspection event are defined; physical inspection checklist/acceptance criteria still need an operational SOP.
- D13: actual clinic refund methods, cash/bank accounts and evidence standard.
- D16: authorized roles for override/transfer, if needed.
- D14: actual non-cash channels and settlement evidence mapping.
- D08–D12, D15, D20 and source-evidence gates remain open as recorded in the policy register.
