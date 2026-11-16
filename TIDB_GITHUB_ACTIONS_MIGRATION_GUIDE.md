# Controlled TiDB Preview Migration via GitHub Actions

This workflow is an alternative to a Vercel deployment. It only targets the isolated TiDB preview database `assalam_db` and only runs from branch `migration/tidb-foundation`.

## Required one-time setup

In GitHub repository settings, open **Secrets and variables → Actions → Environments** and create an environment named `tidb-preview`. Add these environment secrets:

- `TIDB_HOST`: TiDB Cloud host
- `TIDB_PORT`: TiDB Cloud port
- `TIDB_USER`: dedicated preview database user
- `TIDB_PASSWORD`: password for that preview user
- `BETTER_AUTH_URL`: planned preview application base URL (HTTPS)
- `BETTER_AUTH_SECRET`: a newly generated random secret of at least 32 characters
- `BETTER_AUTH_TRUSTED_ORIGINS`: optional comma-separated HTTPS origins

Use a dedicated TiDB user limited to the preview database. Do not use production credentials. The workflow enforces database name `assalam_db` and TLS 1.2 or newer. Never put credentials in repository files, commit messages, or logs.

## Controlled trigger

The workflow does not run on ordinary pushes. After the environment secrets are configured and the preview database target is confirmed, create or update `MIGRATE_TIDB_PREVIEW.trigger` on branch `migration/tidb-foundation` with the exact one-line content:

```text
I_APPROVE_PREVIEW_SCHEMA_MIGRATIONS_001_013
```

The commit title must be exactly:

```text
RUN-TIDB-PREVIEW-MIGRATIONS
```

This is the explicit trigger. It runs tests first, verifies the connected database name and TiDB version, then applies migrations 001–013 and executes the existing synthetic rollback-only smoke tests. The smoke-test records are rolled back; schema migrations are intentionally persisted.

## Safety boundaries

- No trigger is configured for `main`.
- No Vercel deployment is created.
- No Firebase configuration, Firebase data, or Firebase Authentication is changed.
- No production database credentials should be stored in this environment.
- Do not treat a successful schema migration as production cutover. Authenticated application journeys, concurrency tests, backup/restore verification, and owner approval remain required.
- If the workflow fails, inspect its Actions log before retrying. Do not repeatedly trigger it blindly.
