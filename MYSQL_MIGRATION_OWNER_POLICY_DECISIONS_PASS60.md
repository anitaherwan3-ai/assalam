# Owner Policy Decisions — Pass 60

Date: 2026-11-17  
Branch: `migration/tidb-foundation`  
Base commit: `afa122f39925c62d37285265ff86a691e1a83b96`

## Confirmed by owner

- **D06:** Discounts apply per service line/item. Store gross price, discount and net charge for each line at checkout. Returns reverse the original stored line amount; do not allocate a package-wide discount across components.
- **D08–D09:** All expenses are processed by Admin with Pimpinan approval. Remove cash advances/cash-bon and advance-settlement workflows. Admin cannot approve their own expense.
- **D10:** For supplier returns on already-paid invoices, record a supplier receivable/credit. Keep it Pending until an evidenced refund or offset is received; keep Pimpinan informed and audit each event.
- **D11:** Supplier invoices support partial and multiple payments. Each payment records date, amount and evidence. The invoice is Lunas only when the full obligation is paid.
- **D12:** Kasir 1 and Kasir 2 shift closes are verified by Admin. Admin shift close is verified by Pimpinan. Preserve cash counts, expected cash, variance reasons and audit events. Variance resolution/reopening authority remains a narrower operational detail to specify.
- **D15:** Monthly stock opname is on the first day. Admin counts; Pimpinan approves. Traceable batch/expiry with unknown HPP remains recorded and may be sold, but its profit is not calculated until HPP is verified. Unknown batch origin/expiry remains quarantined. Expired/damaged stock awaits Pimpinan disposition. Initial production cutover count date remains to be set.
- **D16:** Kasir 1 manages lane A and Kasir 2 lane B. A cashier may hand over a patient/ticket to another cashier/shift with a recorded reason. Admin may assist. Pimpinan has full authority. Every queue transaction/movement is audited with actor, time, before/after state and reason where applicable.
- **D20:** New system uses Better Auth with TiDB; Firebase Authentication is not the new-system login provider. Pimpinan can create/register users and assign roles; no public self-registration. Do not migrate Firebase passwords; existing users activate/set new credentials securely. Protected account identities remain intact and the unknown role of `nursalim422@gmail.com` is not inferred.

## Preserved controls and remaining technical gates

- Firebase/Firestore remains the legacy source of truth until the new system is built and tested. Existing Firebase operational data is dummy/testing data and is not automatically imported as production history. Production data will be established after finalization.
- The five protected identities remain reserved and must be reconciled before account seeding. The role of `nursalim422@gmail.com` and emergency recovery if the primary Pimpinan account is inaccessible remain to be verified.
- D05 physical inspection/release SOP, D14 non-cash settlement evidence/channel mapping, D12 variance/reopen authority, D15 initial cutover count date and D20 recovery procedure remain implementation details/gates.
- No production deployment, Firebase mutation, TiDB operational DDL, data import or production cutover is performed by this policy update.
