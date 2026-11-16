# Schema v1 dictionary, Better Auth and operational SQL — Pass 62

Date: 2026-11-17  
Branch: `migration/tidb-foundation`  
Scope: isolated TiDB preview only. Production `main`, Firebase Auth, Firestore data and production deployment remain untouched.

## 1. Canonical dictionary

The canonical machine-readable dictionary is `config/schema-v1-manifest.json`. It is derived from migration source files `001` through `009` and records each table's columns, primary key, indexes, foreign keys, referenced columns and referential actions.

Current static inventory:

- 71 tables
- 681 columns
- 243 declared indexes (including unique indexes)
- 146 foreign keys

Static integrity audit on the manifest:
- every FK child-column tuple has a matching child index or primary-key prefix;
- every referenced parent-column tuple is an exact primary key or unique key;
- FK child and parent column types match;
- no FK points to a missing table;
- clinic operational FKs use `ON DELETE RESTRICT ON UPDATE RESTRICT`;
- the two Better Auth provider-owned FKs (session → user and account → user) use Better Auth's expected `ON DELETE CASCADE`.

The dictionary is the reviewable contract. After DDL is applied to the disposable preview schema, the live `INFORMATION_SCHEMA` output must be compared against this file; static extraction is not a substitute for live TiDB introspection.

## 2. Registered migration sequence

| Migration | Tables | Scope |
| --- | ---: | --- |
| 001–003 | 9 | identity, roles, Firebase legacy crosswalk, audit/idempotency/outbox, tariff and supplier masters |
| 004 | 5 | Better Auth user, session, credential account, verification and persistent rate-limit tables |
| 005 | 10 | patient, encounter, cashier shifts, active shift slots, A/B queue counters/tickets/calls/transfers |
| 006 | 11 | stored evidence files, medicines, supplier invoices/receipts, batches, immutable stock movements and stocktakes |
| 007 | 10 | invoice snapshots, line discounts, batch allocation, payment review, return quotas, returns and refunds |
| 008 | 13 | shift reconciliation, cash/bank ledgers, expenses, supplier returns/credits/payments and stock quarantine |
| 009 | 13 | clinic/display/audio settings, service packages, invoice cancellation, stock losses, journals and backup/export |

Migrations `004` through `009` are registered in `scripts/apply-preview-migrations.js`. DDL uses `CREATE TABLE IF NOT EXISTS`; seed rows for the two A/B queue call guards use `INSERT IGNORE`. No operational opening stock or legacy Firebase records are seeded.

## 3. Better Auth + TiDB

- Exact package pin: `better-auth@1.7.25`.
- MySQL2 pool uses UTC timezone (`timezone: "Z"`) and existing TLS settings.
- Core model names remain Better Auth defaults: `user`, `session`, `account`, `verification`.
- Database-backed rate limiting uses the `rateLimit` model/table; it is not left in per-instance memory.
- Email/password is enabled, self-registration disabled, password minimum set to 12 characters.
- Session lifetime: 12 hours; refresh age: 4 hours.
- Secure, HttpOnly, SameSite=Lax cookies; exact trusted origins from `BETTER_AUTH_URL` plus `BETTER_AUTH_TRUSTED_ORIGINS`.
- `BETTER_AUTH_SECRET` is required and must be at least 32 characters. No secret value is committed.
- Vercel route mount: `api/auth/[...all].js`.

Application authorization remains separate from Better Auth authentication. The Better Auth user ID must be provisioned into the clinic `users.user_id` table with a server-owned role assignment before the user is allowed into clinic APIs. No client-supplied role or user ID is trusted. The Pimpinan-only user invitation/provisioning workflow and server-side Better Auth role resolver are still engineering work; this branch does not yet switch existing Firebase-backed app routes.

The schema is hand-authored to the documented Better Auth core contract. The exact pinned-version CLI check (`npx auth@1.7.25 check schema`) and live TiDB schema validation remain required before auth is enabled. Do not disable Better Auth schema validation merely to bypass a mismatch.

## 4. Owner policy invariants represented

- Medicine units are whole `tablet`, `kapsul`, `botol`, `pcs`; no silent legacy unit conversion.
- Unknown HPP remains nullable; traceable stock can exist and sell, while profit remains uncalculated until HPP is verified.
- Unknown batch origin/expiry is not sellable; quarantine and explicit inspection/disposition events are recorded.
- Monthly stocktake is represented by unique stocktake date; Admin counter and Pimpinan approver identities are retained.
- Queue A/B call guards are independent; each ticket has a single current cashier/shift owner; handoff events require a reason and preserve before/after shift owners.
- Service discounts are stored on invoice lines; original gross, discount, net and HPP snapshots are retained.
- Non-cash review status and bank/provider settlement status are separate; income recognition timestamp is explicit.
- Item/service return quota is component-aware; Admin review, Pimpinan approval, quarantine disposition and refund obligation/payment are separate records.
- Supplier return request/approval is distinct from dispatch; supplier credit settlement remains pending until evidenced; supplier invoice payments allow multiple payment events and allocations.
- Expenses record creator and separate approver; role separation is enforced by repository/API, not by DDL alone.
- Shift close stores expected/count/variance and separate verifier event.
- Every ledger has idempotency keys or source uniqueness where applicable; corrections use reversal references rather than deletion.

## 5. Verification status and remaining gates

Completed in repository:
- canonical schema dictionary generated;
- static FK/index/parent-key/type audit clean;
- Better Auth config and Vercel auth route scaffolded;
- operational SQL migrations 005–009 created and registered;
- static Node contract tests added for auth schema, operational migrations and dictionary.

Not yet completed:
1. Run the full CI suite on the latest branch head and correct any failures.
2. Deploy one isolated preview build only after CI passes; migration branch auto-deploy pause remains intentional until that point.
3. Apply migrations 004–009 to the disposable TiDB preview schema; inspect actual `INFORMATION_SCHEMA.COLUMNS`, `STATISTICS`, `KEY_COLUMN_USAGE` and `REFERENTIAL_CONSTRAINTS`.
4. Run the exact Better Auth 1.7.25 schema check against preview.
5. Run real TiDB transaction/rollback, FK, unique/idempotency, concurrent queue allocation, stock batch decrement/return quarantine, partial supplier payment allocation, expense approval separation, non-cash review and shift-close reconciliation tests.
6. Implement SQL repository and API slices with transaction boundaries, row locks, idempotency, server-side role resolution and audit/outbox writes. DDL alone does not implement these workflows.
7. Build Pimpinan-only account provisioning/invitation, secure reset, protected identity crosswalk and recovery before any staff login test.
8. Backup/restore test and owner-approved opening stocktake before production cutover.

## 6. Explicit safety boundary

No production DDL, deployment, Firebase export/import, Firebase Auth change, account migration, data deletion, or cutover has occurred. The previous preview deployment belongs to an older commit and does not contain this schema. This addendum must not be read as a statement that the new system is live or production-ready.
