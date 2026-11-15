# MySQL Migration — Follow-up Source Verification (Rules, Store and Authentication)

Date: 2026-11-15
Branch: migration/tidb-foundation
Source branch: main
Scope: read-only source inspection; no runtime or production data access.

## Source fingerprints verified

- `firestore.rules`: `d02b6d02c13bc85f867b668085edb85c54726779` (416 lines)
- `js/store.js`: `99e74acf8caec9c70d82be1d5f6efc5bfa6bc4fb` (553 lines)
- `README.md`: `fc647789a6d6c6586c41fbeea99ec47667eeefdc`
- `AUTH_MIGRATION.md`: `b67fedac378b43d983512225f436098894729161`
- `firebase.json`: `cf9deb7ef874a13fd8c7bba507d9b056ed27a931`

## 1. Additional Firestore Rules findings

The Rules use email allowlisting for the two owners and an email-keyed staff profile. Static inspection confirms:

1. `initialOwner()` checks the authenticated email against the owner allowlist, but does not explicitly require `email_verified == true`. Staff profile checks compare the profile email with the token email and require `active == true`, but likewise do not explicitly check verified email. The target backend must use verified identity and stable immutable user IDs; do not reproduce email-as-primary-key.
2. `k_pasien`, `k_trx`, `k_shift`, `k_petty`, `k_obat`, `k_batch`, `k_returJual` and related collections are broadly readable by every signed-in authorized role. This is not least-privilege for patient PII or role-limited financial/inventory views. The target API must provide role-specific projections and pagination.
3. `k_petty`: a cashier can update own petty cash amount/description and delete own petty cash record. That is a destructive financial control gap. Target must use append-only cash entries and reversal records; no direct delete or post-close edit.
4. `k_obat` and `k_batch`: Admin/Pimpinan have broad writes; cashier may decrease stock/sisa directly. A decrease is not proof of a valid invoice or FEFO movement. Target inventory changes must only arise from atomic domain commands (checkout, return finalization, purchase receipt, supplier return, loss/opname, adjustment).
5. `k_beli`, `k_biaya`, `k_loss`, `k_returBeli`, `k_tarif`, and `k_paket` grant Admin/Pimpinan broad collection writes. Rules do not encode complete business invariants such as purchase-to-batch consistency, weighted-average HPP, supplier-return caps/credit, expense approval threshold, or loss-to-batch consistency. The server must enforce these invariants.
6. Shift Rules constrain cashier ownership and Admin verification, but do not themselves enforce one open shift per cashier, derive expected cash from immutable ledger entries, or guarantee close-vs-checkout serialization.
7. Patient registration permits Pimpinan create and cashier create with matching document ID; target registration must derive cashier/shift/queue identity server-side and allocate queue numbers atomically.
8. Return workflow has a staged role split (cashier submit, Admin forward/reject, Pimpinan final approve/reject/pay) and quota guard documents. This is a critical business invariant to preserve. The SQL implementation must lock invoice line/quota/return state and prevent races with invoice cancellation.
9. Rules permit Pimpinan broad override/delete in many collections. Preserve owner recovery, but replace ordinary overrides with audited, reasoned break-glass/reversal commands.
10. Display/audio configuration is stored under a mixed config path; audio docs allow base64 payloads with strict size/type checks. Target should separate settings metadata from object storage assets and expose only a minimal TV read projection.

These are static policy observations, not proof that every live write path currently succeeds under deployed Rules.

## 2. Additional Store and historical-data findings

1. `ClinicStore.loadLocal()` initializes all 16 local collections and repopulates `obat`, `batch`, `tarif`, `users`, and `paket` whenever each array is empty. This can make an intentionally empty collection appear seeded after load. Do not reuse this behavior for MySQL production initialization.
2. Initial batch rows use `beli: 'init'`; these are seed batches, not ordinary supplier purchase records. Their provenance must remain explicitly classified as seed/legacy unless a protected data export proves otherwise.
3. Default settings contain placeholder-like phone/WhatsApp values and running text referring to “Klinik Sehat Pratama”. The store pins the clinic display name to “Klinik Assalaam Palembang”, but other defaults must not be treated as verified clinic facts.
4. Local FEFO compares expiry date strings to a UTC `toISOString()` date. The target must use the clinic's WIB business date and an explicit expiry policy.
5. Local `processReturBeli()` selects the first batch linked to a purchase and silently caps requested quantity with `Math.min()`. Target should identify the exact purchase batch, validate available quantity and reject an over-limit request rather than silently reducing it.
6. Local purchase settlement is a boolean `lunas` plus `tglBayar`; it has no payment allocation, partial payment, method, bank reference or payment audit. Do not infer a full payable/payment ledger from these two fields.
7. Local `approveReturJual()` accepts Admin or Pimpinan and restores stock immediately. This diverges from the staged cloud process. Use the staged cloud policy as the safer migration candidate, pending owner policy approval.
8. The local store caps activity log at 1,000 rows. The authoritative target audit trail must not silently discard older events.

## 3. Authentication source reproducibility remains a hard gate

The tracked `main` tree contains `firebase.json` with Functions source configured as `functions`, and `AUTH_MIGRATION.md` documents Admin SDK bootstrap plus callable `activateInitialPimpinan`. However, the inspected recursive Git tree does not contain a `functions/` directory or the referenced `scripts/bootstrap-owner.cjs`. The README also describes Cloud Functions-based staff administration and email changes.

This means repository documentation and tracked implementation are not reproducible from the inspected branch. It does not establish whether functions are deployed in Firebase or stored in another repository/branch. Before identity cutover, obtain and verify:
- authoritative source repository/commit for each deployed function;
- deployed function names, regions, runtime, triggers and callable/HTTP interface;
- service account/IAM permissions and secrets/config references;
- custom claims schema and owner allowlist;
- behavior for staff create/update/email change/disable/password reset;
- deployed version vs source commit and rollback procedure.

Do not deploy, delete, overwrite or replace Cloud Functions during this audit. Do not switch authentication authority until the gap is closed.

## 4. New target-side acceptance tests

- Unverified owner/staff email cannot access privileged endpoints.
- Changing email preserves stable user ID and historical attribution; stale email cannot authenticate as the same user.
- A cashier cannot edit/delete a petty cash record; corrections create linked reversal entries.
- Empty production tables remain empty unless an explicit, separately approved seed command is run.
- Seed rows and `beli='init'` batches are classified and never mixed with real purchases.
- WIB date controls FEFO eligibility and all operational reporting.
- Supplier return rejects quantity above the exact source batch's available balance.
- Purchase settlement supports explicit payment records and cannot mark paid without corresponding ledger evidence.
- Admin cannot final-approve or pay a patient return; Pimpinan cannot pay twice; stock restores exactly once.
- TV display cannot retrieve patient phone or unrelated patient fields.
- Audit retention is durable and cannot be truncated by client-side limits.

## 5. Safety and status

No SQL DDL/schema was created or executed. No Firebase Rules, Authentication, Functions or data were changed. No production Vercel project was touched. No patient/operational data was exported or migrated. These findings are based only on tracked source files and documentation.
