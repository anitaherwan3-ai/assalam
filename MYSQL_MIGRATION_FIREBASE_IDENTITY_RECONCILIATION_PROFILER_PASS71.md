# Firebase Auth ↔ k_users Identity Reconciliation Profiler — Pass 71

## Status
Read-only reconciliation utility and synthetic tests added. No live Firebase Auth or Firestore access was performed; actual account mapping remains unverified pending an owner-provided secure export.

## Authority rule
Per the owner's 2026-11-19 clarification, the five records actually present in the correct Firebase Authentication project are the sole roster source. Previously supplied email lists, static source allowlists, local seeds and inferred names/roles are not account roster authority. Expected Auth roster size is five; any different export count is reported as an exception, not silently normalized.

## Source findings
- `js/firebase-backend.js` revision `3a613d96564f120b8141966f9ecbae21471c4e65`: owner profile paths are currently username-keyed; staff profile paths are email-keyed. Owner profile writes verify an existing UID if present; staff profile verification does not compare a stored UID. Static owner and staff allowlists are implementation evidence only.
- `firestore.rules` revision `d02b6d02c13bc85f867b668085edb85c54726779`: current checked-in rules identify initial owners by email and staff by email-keyed profile; staff provisioning/deletion is allowlisted to static addresses. This is not proof of deployed Rules state.
- `MYSQL_MIGRATION_IDENTITY_AUTHORITY_AUDIT.md`: durable target identity should be internal user ID plus immutable Firebase UID/provider subject; email is mutable and cannot be the primary key.

## Tool and input
Run:
`npm run migration:identities -- --input ./private/firebase-auth-and-profiles.json [--output ./private/identity-reconciliation-report.json]`

Expected normalized envelope:
- `authUsers[]`: `uid`, `email`, `disabled`, `emailVerified`, `providerData[].providerId`; optional metadata may be retained in the private source export but is not emitted.
- `collections.k_users`: documentId-to-profile map or `[{documentId,data}]`.

Match policy:
1. UID exact match only. Never auto-bind a profile by email/document key.
2. Report auth users with no UID-bound profile, profiles without auth users, duplicate UIDs/email claims, missing UID, email mismatch, disabled Auth users, inactive profiles, and missing/invalid roles.
3. Email-only matches are unresolved candidates, not successful links.
4. The role is read only from a uniquely UID-matched profile. No role is inferred from address, document key, source allowlist, or seed.
5. Report masks email and fingerprints UID; no raw email, raw UID, password, token, or provider credential is emitted.
6. Output uses exclusive-create mode to prevent overwriting an earlier report.

## Verification
Eight synthetic tests cover five-account success, missing profile, unresolved email-only candidate, duplicate profile UID, duplicate Auth email, email mismatch, invalid role, unexpected Auth count, sensitive identifier masking, and no inferred email/document-key binding. (Several checks are exercised together.) Test suite is intended for Node 20+.

## Safety and blocker
No Firebase Auth/Firestore read, export, mutation, account/profile change, TiDB write, DDL, import, deployment, merge to main, or production change occurred. The tool does not authenticate to Firebase and cannot establish the correct project ID or export completeness. To produce the real account map, a complete read-only Auth user export and matching `k_users` export from the same production project are required. Never provide passwords, refresh tokens, ID tokens, service-account private keys, or other secrets.
