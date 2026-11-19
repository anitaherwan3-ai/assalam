# Historical k_users Evidence Reconciliation — Pass 72

## Scope and conclusion
This pass re-examined available conversation history, saved Library artifacts, checked-in Firebase backend code, and historical Firestore Rules. It did not obtain a live Firestore `k_users` export or Firebase Authentication export. Therefore this is a **provisional evidence register**, not a completed UID reconciliation. No record below is promoted to a verified Auth↔Firestore match unless an exact UID pair was actually available; none of the recovered notes contains a literal UID value suitable for comparison.

## Recovered profile leads

| Historical lead | Profile/document evidence | Email evidence | Role/status evidence | UID match |
|---|---|---|---|---|
| Main owner | Intended/current historical path `k_users/praktekrose`; username `praktekrose` | `praktekrose@gmail.com` explicitly supplied by owner as master account | Intended role `pimpinan`; account creation was reported, but no exported current profile fields | **Unverified**: user previously reported UID created, but literal UID and exported profile UID are absent |
| Second owner | Historical code/rules map `nursalim42@gmail.com` to `k_users/pimpinan2` | `nursalim42@gmail.com` appears in old source/rules | Historical role mapping `pimpinan`; earlier records include proposed/static setup, not an authoritative current account record | **Unverified** |
| Admin | Historical profile/account references use `assalamadmin1@gmail.com`; old rules include it in a staff allowlist | `assalamadmin1@gmail.com` was later reported by owner as corrected account email | Intended role `admin`; owner reported login and menus working, but no exact profile document snapshot/UID supplied | **Unverified** |
| Kasir 1 | A prior user-provided profile snippet described a Kasir profile; exact Firestore document path was not preserved in the recovered record | `assalamkasir1@gmail.com` | Snippet included `u: kasir`, `role: kasir`, `active: true`; no literal UID in recovered evidence | **Unverified** |
| Kasir 2 | `k_users/assalamkasir2@gmail.com` and `k_users/kasir2` appeared as implementation suggestions in prior work | `assalamkasir2@gmail.com` | `kasir2` / `kasir` was a proposed mapping; no verified Auth creation/export was found | **Not established**; do not treat suggestion as actual account |

## Source-code and Rules findings
- Historical `firebase-backend.js` uses owner aliases `praktekrose` and `pimpinan2`, and its owner bootstrap writes UID/email/role/active fields to the owner profile. This is implementation behavior, not proof that the present Firestore documents contain those values.
- Historical Rules use email-keyed staff profile lookup and owner email allowlists. Another saved Rules revision includes a static staff allowlist. These lists are legacy implementation evidence only and must not define the current five-account roster.
- Older app code also contained local user records/password fields. Those are not Firebase Authentication evidence and must never be used to establish account identity or import passwords.

## Reconciliation result
- Historical profile leads recovered: 5.
- Exact UID values recovered for those leads: 0.
- Confirmed Auth↔k_users UID pairs: 0.
- Current five-account Firebase Auth roster: **unknown until a complete export from the correct Firebase project is supplied**.
- No account should be created, deleted, reactivated, renamed, or assigned a role based on this historical evidence register.

## Required input for definitive matching
Use the Pass 71 read-only profiler with one complete, same-project normalized export containing:
- `authUsers[]`: exact Firebase Auth UID, email, disabled state, verified state and provider IDs.
- `collections.k_users`: every document ID and complete non-secret profile fields, including UID, email, `u`, role and active.

Command: `npm run migration:identities -- --input ./private/firebase-auth-and-profiles.json --output ./private/identity-reconciliation-report.json`

Never include passwords, ID/refresh tokens, service-account private keys, or credential material. The export/report should remain private; do not commit it to GitHub.

## Safety
Read-only historical review only. No live Firebase access, account/profile mutation, TiDB write/DDL/import, merge, deployment, or production change.
