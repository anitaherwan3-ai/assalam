# Klinik Assalaam — TiDB Migration Preview

This branch is an isolated migration foundation. It must not replace or modify the live Firebase application.

## Safety boundaries

- Vercel project: `assalam-mysql-preview`
- Git branch: `migration/tidb-foundation`
- TiDB cluster: `assalamklinik`
- Current initial database: `test` (connection smoke-test only)
- Production project `klinikassalaam` and Firebase production data remain unchanged.
- Do not merge this branch into `main` until the migration is fully reviewed and approved.

## Required Vercel environment variables

The TiDB integration should provide these server-side variables:

- `TIDB_HOST`
- `TIDB_PORT`
- `TIDB_USER`
- `TIDB_PASSWORD`
- `TIDB_DATABASE`

Secrets must never be prefixed with `NEXT_PUBLIC_` or exposed to browser code.

## Connection test

The read-only endpoint is:

`GET /api/db-health`

A successful response confirms that the Vercel Function can establish a TLS connection and execute `SELECT 1`. It does not create, alter, or delete database objects.

## Next steps

1. Confirm the Vercel Preview deployment for this branch is ready.
2. Call `/api/db-health` and confirm `status: connected`.
3. Create a separate application database named `assalam_db` in TiDB.
4. Update only this Vercel project's `TIDB_DATABASE` environment variable to `assalam_db`, then redeploy.
5. Design and test the schema before importing any clinic or patient data.

No patient, transaction, inventory, or staff data is copied by this branch.
