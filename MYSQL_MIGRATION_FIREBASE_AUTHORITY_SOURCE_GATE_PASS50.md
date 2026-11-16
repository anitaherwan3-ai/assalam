# Firebase Identity & Cloud Functions Source Gate — Pass 50

**Branch:** `migration/tidb-foundation`  
**Review type:** repository-only, read-only source inspection  
**Production Firebase/Auth:** not queried or changed  
**Status:** SOURCE GATE OPEN — no account import/provisioning/cutover allowed

## 1. Exact repository evidence

| Source | Observed content | Migration impact |
|---|---|---|
| `firebase.json` | Declares Functions codebase with `source: "functions"` and Firestore rules path `firestore.rules` | Firebase deployment config expects a local Functions source directory |
| Repository tree at commit `7733250ac49e662fc3578158cf10eb904c925235` | No `functions/` directory or Cloud Functions source files present | Actual server-side deployed auth/bootstrap code cannot be reconstructed from this checkout |
| `AUTH_MIGRATION.md` | Describes `cd functions`, `scripts/bootstrap-owner.cjs`, `activateInitialPimpinan`, and Cloud Functions deployment | Documentation references source files that are not present in the current tree |
| `js/firebase-backend.js` `ownerIdentity()` | Maps `praktekrose@gmail.com` → `praktekrose`; `nursalim42@gmail.com` → `pimpinan2` | This is a browser-side allowlist and must not replace authoritative Auth/UID evidence |
| `js/firebase-backend.js` `resetPassword()` | Allowlist: praktekrose, nursalim42, assalamadmin1, assalamkasir1, assalamkasir2 | Does not include the separately protected address `assalamadmin@gmail.com` or `nursalim422@gmail.com` |
| `firestore.rules` | Initial Pimpinan emails: praktekrose and nursalim42; staff profile write allowlist: assalamadmin1, assalamkasir1 and assalamkasir2 | Current checked-in Rules align with the numbered Admin address, but deployed Rules must still be verified read-only |

## 2. Account identity discrepancy — do not auto-resolve

Two distinct Admin addresses appear in authoritative owner instructions versus checked-in source:

- Owner-protected address: `assalamadmin@gmail.com`
- Checked-in application/Rules address: `assalamadmin1@gmail.com`

Both must be treated as protected records until an authorized Firebase Auth + Firestore snapshot proves their exact status and the owner explicitly resolves any discrepancy. Do not treat one as an alias for the other, do not transfer a role, do not overwrite UID bindings and do not delete either.

The separately protected `nursalim422@gmail.com` account must also be preserved. Its role is intentionally unknown and must not be inferred from the similar `nursalim42@gmail.com` address. Keep both exact strings distinct.

The two checked-in Pimpinan addresses remain `praktekrose@gmail.com` and `nursalim42@gmail.com`; their application bootstrap mapping is source evidence, not proof of current provider UID or deployed claims.

## 3. Required read-only source closure

Before identity migration or Firebase Auth cutover:

1. Obtain the actual deployed Firebase project ID and environment mapping for production and preview.
2. Retrieve the deployed Cloud Functions source/release metadata from the authorized Firebase/GCP project; repository absence does not prove deployed absence.
3. Retrieve deployed Firestore Rules version and compare it byte-for-byte/semantically with the checked-in `firestore.rules`.
4. Export Firebase Authentication users read-only, retaining exact UID, email, disabled status, provider metadata and creation/update metadata. Never export passwords or tokens.
5. Export `k_users` profile documents read-only and reconcile by immutable UID first; email is mutable and is not a stable relational primary key.
6. Reconcile the six distinct protected email strings mentioned by either owner protection or checked-in source: `praktekrose@gmail.com`, `nursalim42@gmail.com`, `assalamadmin@gmail.com`, `assalamadmin1@gmail.com`, `assalamkasir1@gmail.com`, `assalamkasir2@gmail.com`, plus separately protected `nursalim422@gmail.com`. This is a protection set, not a claim that every address is active or has a distinct role.
7. Store source exports encrypted and checksummed, and create a review report of duplicate emails, missing profiles, duplicate UID bindings, inactive users and role discrepancies. Do not repair records as part of the export.
8. Only after owner review, create immutable TiDB identity mappings. Do not issue Firebase account mutations as a side effect of the import.

## 4. Immediate implementation boundary

- Keep Firebase Authentication as the current production identity provider during the staged migration.
- The TiDB API verifies the Firebase ID token and resolves the role from server-owned relational mappings; browser-supplied role is never authoritative.
- Preview-only bootstrap must remain allowlisted to the isolated preview Firebase project and must never be reused for production migration.
- Do not infer or seed UID, custom claims, role, active status, or email-history rows from source code defaults.
- No deployed Rules, Functions, Auth user, Firestore profile, patient record, stock record, or financial record was changed by this audit.

## 5. Gate disposition

**Blocked:** production account mapping, Cloud Functions replacement, identity import, and Firebase Auth cutover.

**Allowed to continue in parallel:** non-destructive TiDB domain design, synthetic test development, tariff/supplier integration in isolated preview when deployment quota permits, and source inventory work that does not access or mutate live Firebase data.
