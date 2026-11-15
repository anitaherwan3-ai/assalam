# MYSQL Migration — Role Authorization & Data Security Audit (Pass 18)

Date: 2026-11-15  
Branch: `migration/tidb-foundation`  
Scope: static review of UI role navigation/guards, Firebase Authentication profile verification, collection listeners, write synchronization, privileged business operations, account allowlists, and currently visible MySQL preview API. Documentation only.

## 1. Source snapshot

| File | Blob SHA | Reviewed areas |
|---|---|---|
| `js/app.js` | `f74c4710161ddd2af230e51c18b1f107d6c52c82` | 37–42, 181–220, 883–930, 2967–3135, 3890–3940, 4668–4770 |
| `js/firebase-backend.js` | `3a613d96564f120b8141966f9ecbae21471c4e65` | 113–225, 269–330, 330–390, 410–570, 574–690, 697–1010, 1013–1210, 1211–1375 |
| `api/db-compatibility.js` | `ce9e09e77b4aae632cf11b9ce2e1b37fa724128b` | 1–80 and route guard |
| `index.html` | `7f9fbbb202c0fd346eb40b3e93d01c9427bdfad2` | script loading |
 
Searches for `firestore.rules`, `match /k_users`, and `allow read, write` returned no matching files through the repository code search. This does not prove that deployed Firebase Rules do not exist; the deployed ruleset and its version were not retrieved in this pass.

## 2. Role navigation observed

| Role | Visible tabs in `ROLE_TABS` | Main intended scope |
|---|---|---|
| Kasir | Shift, Pasien, Transaksi, Riwayat Transaksi, Kas Kecil | Own shift, patient queue, sales, petty cash, return/cancellation request |
| Admin | Obat & Tarif, Paket Pelayanan, Pembelian, Kedaluwarsa, Biaya, Stok Opname, Kartu Stok, Riwayat Transaksi, Verifikasi, Display TV, Ekspor | Inventory/purchase/operational approvals and display |
| Pimpinan | Dashboard, Data Pasien, Stok Obat, Kartu Stok, Laba Rugi, Arus Kas, Utang, Approval, Pengawasan Retur, Paket Pelayanan, Display TV, Ekspor, Log Aktivitas, Pengguna, Pengaturan | Oversight and final approvals/configuration |

Navigation is a presentation layer only. It must not be treated as an authorization boundary.

## 3. Authentication and profile verification

1. Firebase Auth state listener calls `verifyAuthProfile(user)` before starting data listeners and applying the session (`firebase-backend.js:113–137`).
2. Owner identity is hard-coded to `praktekrose@gmail.com` and `nursalim42@gmail.com` (`firebase-backend.js:143–149`).
3. Owner profile verification checks UID mismatch, email mismatch, role mismatch, and inactive state; if profile is missing it creates/merges a Pimpinan profile (`firebase-backend.js:151–190`).
4. Staff profile lookup uses `k_users/{email}`, checks stored email, active=true and role in admin/kasir, then injects the Auth UID into the returned in-memory profile (`firebase-backend.js:192–199`). It does not require a stored UID binding or immutable account identity mapping.
5. Session application accepts only active profiles with role in pimpinan/admin/kasir (`app.js:181–200`).
6. Password reset allowlist is hard-coded and currently repeats the stale email list (`firebase-backend.js:249–255`).

## 4. Critical account identity mismatch — BLOCKER

The latest owner-confirmed protected accounts are:

- Kasir Pagi — `assalamkasir1@gmail.com`
- Kasir Sore — `assalamkasir2@gmail.com`
- Admin — `assalamadmin@gmail.com`
- Pimpinan — `praktekrose@gmail.com`
- Akun kita — `nursalim422@gmail.com` (role must be verified; do not infer it)

The reviewed source still contains:

- Admin — `assalamadmin1@gmail.com`
- Second owner — `nursalim42@gmail.com`
- Kasir Pagi — `assalamkasir1@gmail.com`
- Kasir Sore — `assalamkasir2@gmail.com`

These stale identities appear in `ownerIdentity`, `provisionDefaultStaffProfiles`, and `resetPassword`. UI account instructions also show `assalamadmin1@gmail.com`.

**Required action:** do not run `provisionDefaultStaffProfiles`, password reset based on the stale allowlist, account cleanup, or migration account seeding until the five protected accounts are mapped read-only to Auth UID, email, Firestore profile document ID, username, active state and role. Preserve all five identities and their records. The role of `nursalim422@gmail.com` must be confirmed from the owner's authoritative account mapping, not guessed.

## 5. Provisioning hazard — BLOCKER

`provisionDefaultStaffProfiles` is owner-gated, but its definitions use the stale Admin email. For an existing profile it checks email and role, then merges a newly constructed profile with `active: true` (`firebase-backend.js:201–240`). This can reactivate a previously deactivated staff profile and overwrite profile metadata. It does not check or preserve a stored Auth UID binding. It should not be used until rewritten as an explicit, reviewed, non-destructive account reconciliation workflow.

## 6. Collection read scope observed

`setupRealtimeListeners` subscribes by collection:
- Kasir: obat, tarif, paket, batch, pasien, trx, shift, petty, returJual, batalTrx.
- Admin: all collections except users (the initial default set).
- Pimpinan: all collections except users (the initial default set).
- Settings and queue audio metadata have separate listeners.

The client merges full collection snapshots into local application state. The code shown does not add a cashier-ID query filter to the `k_trx` listener. Some UI paths and push paths filter records by cashier, but that is not equivalent to server-enforced row-level read authorization.

**Unverified:** whether Firestore Rules restrict document reads by role, owner, cashier, shift, or field. Without the deployed ruleset and adversarial tests, no claim can be made that a Kasir cannot read another cashier's records or that Admin cannot read sensitive patient data.

## 7. Write scope and business-operation guards observed

### Generic synchronization (`performPush`)

- Pimpinan: all listed operational collections except users; settings and sequence are written.
- Admin: all listed operational collections except users, pasien, trx, petty; shift writes are further limited to records with `verif === true`; settings write is limited to three Display TV fields.
- Kasir: pasien, shift, petty and log; own shift/petty rows and own log rows are filtered. Transaction creation is expected through `commitCashierTransaction`.
- Generic push excludes `batalTrx` and `returJual`; dedicated transactional methods handle these workflows.
- The push method writes full payloads for many collections using client-supplied state and timestamps. These client-side filters are not a substitute for Firestore Rules or a trusted server API.

### Dedicated methods

| Operation | Client/backend guard observed |
|---|---|
| Patient registration with queue number | Kasir/Pimpinan; server-side Firestore transaction |
| Checkout and stock deduction | Kasir only; idempotent invoice write, stock/batch validation and return quota creation in one transaction |
| Submit cancellation | Kasir only |
| Process cancellation | Admin or Pimpinan; same method can approve or reject |
| Submit return | Kasir/Pimpinan; cashier identity checked; source invoice/quota/amount/batch validated |
| Approve return stage 1 | Admin only |
| Final return decision and stock restoration | Pimpinan only |
| Reject return | Admin/Pimpinan, with stage-specific expected status |
| Refund payout | Pimpinan only; once-only state guard; transfer reference required |
| Migrate return quotas | Pimpinan only |
| Save/delete queue audio | Admin/Pimpinan |
| Save display settings | Admin/Pimpinan; only selected display fields |

Some UI-only guards also exist for patient archive/restore, cancel-visit and return actions. Every equivalent API/database write must independently enforce authorization.

## 8. Authorization risks / gaps to close

| ID | Risk | Evidence / consequence | Required MySQL target control |
|---|---|---|---|
| A18-01 | Stale protected account identities. | Owner/Admin allowlists differ from latest owner-confirmed accounts. Login, provisioning and password-reset flows can target wrong identity. | One authoritative account registry; explicit mapping of five protected Auth identities; no implicit provisioning. |
| A18-02 | Staff UID is not bound to persistent profile. | Staff verification checks email/active/role but not stored UID. | Persist immutable auth provider subject/UID; enforce unique identity binding and audit any rebind as a privileged workflow. |
| A18-03 | Provisioning can reactivate staff. | Existing profile is merged with `active: true`. | Never reactivate or alter role/email silently; explicit change request, confirmation and audit event. |
| A18-04 | Client-side role guards may be bypassed. | UI checks and JavaScript methods execute in the browser. | Server-side authorization on every endpoint and every resource; deny by default. |
| A18-05 | Firestore read scope is not established. | Listeners subscribe to whole collections; rules source not verified. | SQL queries enforce row-level predicates and sensitive-field projection; test cross-cashier and role isolation. |
| A18-06 | Admin has broad collection-level read/write synchronization. | Admin listener receives default full collection set; generic push can write most collections. | Explicit allowlist per entity and operation, not broad “all except” lists. Separate inventory mutation, approval and audit permissions. |
| A18-07 | Admin may approve cancellation. | `processCancelRequest` permits both Admin/Pimpinan for approve/reject. | Confirm owner policy: Admin cancellation approval versus escalation to Pimpinan; encode stage-specific transitions. |
| A18-08 | Pimpinan can submit a return. | `submitReturJual` accepts Kasir/Pimpinan; UI return flow rejects Admin only. | Confirm whether this exception is intentional; otherwise restrict submission to originating cashier and preserve oversight role separation. |
| A18-09 | Generic bulk push trusts local cache fields. | Payloads originate from browser state and are written as merge payloads. | Replace with command endpoints and validated DTOs; never accept arbitrary table/column payload from client. |
| A18-10 | Audit events are not a proven independent authorization log. | Client-side `logActivity` is mutable local state and generic sync. | Server-generated append-only audit records with actor, role, action, target, timestamp, request ID and before/after summary. |
| A18-11 | Staff profile reset/provisioning lacks a safe identity lifecycle. | Hard-coded email definitions and active=true merge. | Dedicated account lifecycle workflow with protected account lock and explicit approval. |
| A18-12 | MySQL preview compatibility route is not a business API. | `api/db-compatibility.js` is a preview-only token-gated diagnostic; it does not implement clinic role authorization. | Before any production migration, implement authenticated business API with session verification and centralized policy enforcement. |

## 9. Proposed target authorization model

- Authenticate with a trusted identity provider; validate token signature, issuer, audience, expiry and subject server-side.
- Resolve a server-owned active user record by immutable provider subject; never accept role, username or actor identity from request body.
- Use centralized policies: `can(resource, action, actor, context)`; default deny.
- Scope every query by clinic and authorized ownership/shift/cashier context. Apply field-level projection for sensitive patient and account data.
- Separate commands from CRUD: checkout, stock movement, shift close/verification, return submission, return review, final return, refund payout, cancellation request/decision, account activation/deactivation.
- Enforce transition preconditions and idempotency in database transactions.
- Require distinct permissions for reading, creating, updating, approving, paying, voiding, archiving, restoring, exporting and managing users.
- Do not let Admin approve their own created financial/operational requests where policy requires separation; define maker-checker explicitly.
- Audit every privileged action server-side; protect the audit log from edits/deletion by application roles.
- Protect the five owner-confirmed accounts from bulk disable, deletion, demotion, UID/email replacement and cleanup.

## 10. Required role/action matrix for owner sign-off

This matrix is a draft of observed behavior, not a final policy approval.

| Resource/action | Kasir | Admin | Pimpinan |
|---|---|---|---|
| Register patient / manage today's queue | Yes (own actions) | No evidence | Yes (backend allows registration) |
| Checkout / create invoice | Yes (own shift) | No | No |
| View invoices | Scope not verified | UI history / read scope not verified | Yes |
| Inventory/purchase/stock adjustment | No generic push | Broad write path exists | Yes |
| Verify shift | No | Can sync verified shifts | Yes |
| Submit cancellation | Yes | No | No |
| Approve/reject cancellation | No | Yes | Yes |
| Submit return | Yes | No | Backend allows; confirm policy |
| First-stage return review | No | Yes | No |
| Final return approval / stock restore | No | No | Yes |
| Refund payout | No | No | Yes |
| Expense / petty cash | Own petty cash | Expense approval scope needs exact audit | Broad oversight |
| Display TV / queue audio settings | No | Yes | Yes |
| Manage staff accounts / roles | No | Provision action owner-only | Yes |
| Export sensitive reports | No | Yes (Ekspor tab) | Yes |

## 11. Synthetic security tests required before migration sign-off

1. Each of the five protected accounts logs in and resolves to exactly one expected immutable subject/profile/role.
2. Attempt to alter role, email, UID, active state or username from browser payload; server rejects.
3. Disabled staff cannot log in, refresh session, call API or retain old session privileges.
4. Kasir Pagi cannot read, update, export or infer Kasir Sore's private shift/petty records or restricted patient/invoice fields.
5. Kasir cannot create/update invoice outside own active shift or impersonate another cashier.
6. Admin cannot create invoice, alter patient identity, write petty cash, modify user roles, or change unapproved shift data.
7. Admin cannot approve their own request if maker-checker policy forbids it.
8. Pimpinan-only refund payout, final return approval and account lifecycle controls reject Admin/Kasir.
9. Duplicate checkout, cancellation, return approval and refund requests are idempotent and cannot double-mutate stock/cash.
10. Forged resource IDs, cross-entity IDs and guessed endpoints do not bypass ownership checks.
11. Export endpoints enforce the same role and row scope as screen queries.
12. Audit events are written server-side and cannot be edited/deleted by Kasir/Admin.
13. Unknown role, missing profile, malformed token, expired token and database outage all fail closed.
14. Attempt to bulk-delete/disable/demote the five protected accounts is rejected without explicit owner-approved exception.
15. Concurrent role deactivation and in-flight API requests cannot continue with stale authorization beyond the defined session policy.

## 12. Open owner-policy decisions

- Confirm the exact role and immutable UID mapping for `nursalim422@gmail.com`.
- Confirm whether cancellation approval is Admin-only or Admin review plus Pimpinan final approval.
- Confirm whether Pimpinan may initiate returns, or only review/approve staff submissions.
- Define which patient fields Admin may view for operational verification.
- Define cashier visibility: own invoices/shift only, or clinic-wide history read-only.
- Define whether Admin can create/approve expenses, and maker-checker restrictions.
- Define which roles can export patient-identifiable data and whether exports require audit/approval.
- Define account deactivation, email change, UID replacement and emergency recovery procedure.

## 13. Safety status

Static source review and documentation only. No account login, Auth/Firestore data read, Firestore Rules read/deploy, account provisioning, account mutation, database DDL, MySQL data import, Vercel deployment, merge, PR13 merge or production operation occurred. No claim of deployed Firebase Rules enforcement or end-to-end security testing is made.
