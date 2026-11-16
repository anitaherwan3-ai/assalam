# Owner Policy Decisions — Pass 59

Date: 2026-11-17  
Branch: `migration/tidb-foundation`  
Base commit: `c90256e20e7d4a6db985a08ba2f9641707692680`

## D13 — Refund reporting clarification (owner-confirmed)

The owner clarified that the application does not need to capture refund method or bank-account details. The required operational record is the refund status and amount.

- Refund still requires Pimpinan approval.
- Approval and actual transfer/payment are separate states.
- After the transfer has actually occurred, an authorized user records the status as transferred/paid and the amount.
- Pimpinan-facing reporting must show that the refund has been transferred and the amount, e.g. “Sudah ditransfer Rp X ke rekening”.
- Do not require or store bank account number/name, destination account details, payment method, or transfer reference as mandatory fields.
- Never infer that a refund has been paid merely because it was approved.
- Preserve audit actor and timestamps for approval and paid-status recording.

This replaces the D13 method/account setup requirement in Pass 58. No bank-account catalogue or refund-method configuration is needed.

## Wording correction (owner-confirmed)

The report wording is “Sudah ditransfer Rp X ke rekening”. It must not say “rekening kas”.

## Safety and scope

This is a policy clarification and design record only. It does not activate production behavior, alter Firebase data/authentication, execute TiDB DDL, import operational data, deploy Vercel, or change `main`.
