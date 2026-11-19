# Historical k_users Evidence Reconciliation — Pass 72

## Scope and conclusion
This pass re-examined available conversation history, saved Library artifacts, checked-in Firebase backend code, and historical Firestore Rules. It did not obtain a live Firestore `k_users` export or Firebase Authentication export. The owner has now explicitly confirmed the intended five-account email-to-role roster (two Pimpinan, one Admin, two Kasir). This resolves the **business role roster**, but it does not establish the live Auth UIDs or prove that the corresponding Firestore profiles currently match. This remains a provisional evidence register, not a completed UID reconciliation.

For privacy, exact email addresses are retained in the owner conversation and are intentionally not copied into this repository report.

## Owner-confirmed role roster
| Account slot | Owner-confirmed role | Roster count | Auth UID ↔ k_users match |
|---|---|---:|---|
| Pimpinan account 1 | `pimpinan` | 1 | Unverified |
| Pimpinan account 2 | `pimpinan` | 1 | Unverified |
| Admin account | `admin` | 1 | Unverified |
| Kasir account 1 | `kasir` | 1 | Unverified |
| Kasir account 2 | `kasir` | 1 | Unverified |
| **Total** | **2 Pimpinan, 1 Admin, 2 Kasir** | **5** | **0 confirmed UID pairs** |

The exact email-to-role mapping supplied by the owner is the current business authority for this migration. Older email lists, hardcoded allowlists, suggested document IDs, and historical account proposals are superseded and must not be used to alter this roster. The profiler's expected account count remains five; any actual mismatch must be reported, never silently corrected.

## Recovered profile leads and historical evidence
| Historical lead | Profile/document evidence | Role/status evidence | UID match |
|---|---|---|---|
| Main owner | Historical intended path `k_users/praktekrose`; username `praktekrose` | Owner-confirmed as Pimpinan; account creation was previously reported | **Unverified**: literal Auth UID and exported profile UID absent |
| Second owner | Historical code/rules map to `k_users/pimpinan2` | Owner-confirmed as Pimpinan; old path is not proof of current profile | **Unverified** |
| Admin | Historical profile/account references exist | Owner-confirmed as Admin; owner previously reported login/menu working | **Unverified** |
| Kasir 1 | A prior user-provided profile snippet described a Kasir profile; exact Firestore document path not preserved | Owner-confirmed as Kasir; historical snippet included `u: kasir`, `role: kasir`, `active: true` | **Unverified** |
| Kasir 2 | Historical document/path variants appeared as implementation suggestions | Owner-confirmed as Kasir; old suggested path is not proof of current profile or Auth creation | **Unverified** |

## Source-code and Rules findings
- Historical `firebase-backend.js` uses owner aliases and bootstrap behavior to write UID/email/role/active fields. This is implementation behavior, not proof that present Firestore documents contain those values.
- Historical Rules use email-keyed staff profile lookup and owner email allowlists. Other saved Rules revisions include static staff allowlists. These are legacy implementation details only and must not define or override the owner-confirmed roster.
- Older app code also contained local user records/password fields. Those are not Firebase Authentication evidence and must never be used to establish account identity or import passwords.

## Reconciliation result
- Owner-confirmed intended roster: **5 accounts (2 Pimpinan, 1 Admin, 2 Kasir)**.
- Exact UID values recovered for those accounts: 0.
- Confirmed Auth↔k_users UID pairs: 0.
- Live profile completeness and actual Auth membership: **not yet verified**.
- No account should be created, deleted, reactivated, renamed, or assigned a role based only on historical evidence or this role roster.

## Required input for definitive matching
Use the Pass 71 read-only profiler with one complete, same-project normalized export containing:
- `authUsers[]`: exact Firebase Auth UID, email, disabled state, verified state and provider IDs.
- `collections.k_users`: every document ID and complete non-secret profile fields, including UID, email, `u`, role and active.

Command: `npm run migration:identities -- --input ./private/firebase-auth-and-profiles.json --output ./private/identity-reconciliation-report.json`

Never include passwords, ID/refresh tokens, service-account private keys, or credential material. The export/report should remain private; do not commit it to GitHub.

## Safety
Read-only historical review and owner role confirmation only. No live Firebase access, account/profile mutation, TiDB write/DDL/import, merge, deployment, or production change.
