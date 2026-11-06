# VPS release checklist

**Scope:** preparation and controlled release of the current `main` revision. This document is a checklist, not authorization to deploy. Do not run production-changing commands until the owner explicitly approves the release.

## Release candidate

- [ ] Confirm the intended `main` commit SHA and that CI and Mini App build both passed for that exact SHA.
- [ ] Record the currently deployed commit/version and the current API/frontend health before changing anything.
- [ ] Confirm the VPS paths and service names from the actual host; do not assume a service name or restart command.
- [ ] Review the production environment without printing secrets. Confirm `DATABASE_URL`, `JWT_SECRET`, and `TELEGRAM_BOT_TOKEN` are present in the server-side environment.

## Database preflight — read-only first

Run from the VPS with a properly configured PostgreSQL client. Never paste credentials into chat or shell history.

1. Confirm the target database and role:
   ```sql
   SELECT current_database(), current_user, version();
   ```
2. Confirm the existing schema matches migrations 001–004 and that the production database has the expected `public.profiles`, `public.orders`, `public.offers`, and `public.order_events` tables.
3. Confirm `public.orders.status` uses the existing `public.order_status` enum and contains `agreed`, `picked_up`, `in_transit`, `delivered`, and `cancelled`.
4. Check whether `public.order_cancellation_requests` already exists. If it does, inspect its columns, constraints, indexes, and grants before deciding whether migration 005 should run. Do not blindly rerun it.
5. Confirm role `curier_app` exists and can access the tables it needs. Migration 005 grants SELECT/INSERT/UPDATE on the new table to that role if it exists at migration time; it does not create the role.
6. Inspect migration 005 in full before applying it. It is transactional and additive, but it has no automatic down migration.

## Backup and restore verification

- [ ] Take a timestamped PostgreSQL backup before any schema change. Prefer a custom-format dump, stored outside the web root with restricted permissions.
- [ ] Confirm the dump command succeeded and the resulting file is non-empty; record its checksum and file size.
- [ ] Verify the backup by restoring it into a **separate, isolated test database**, never over production. Check that restore exits successfully and the expected core tables and recent row counts are present.
- [ ] Do not proceed if backup or restore verification fails.

Example pattern only; substitute the verified database connection securely and do not put passwords directly on the command line:

```bash
umask 077
pg_dump --format=custom --no-owner --no-acl --file="/secure/backup/path/curier-YYYYMMDD-HHMMSS.dump" "$DATABASE_URL"
pg_restore --list "/secure/backup/path/curier-YYYYMMDD-HHMMSS.dump" >/dev/null
```

A successful `pg_restore --list` checks that the archive is readable; it is **not** a substitute for a test restore.

## Release sequence — only after explicit approval

1. Keep the backup and current deployed version available for rollback.
2. Fetch the approved commit on the VPS and inspect the diff against the currently deployed version. Do not use an unpinned moving branch for the final release; check out the exact approved SHA.
3. Build frontend and API using the repository's documented commands. Stop on any failure.
4. Apply migration 005 only after the schema preflight and verified backup. Capture the migration output and verify the new table, constraints, indexes, and `curier_app` grants.
5. Publish frontend assets and restart/reload the API using the service configuration actually found on the VPS. Avoid deleting the existing working release until checks pass.
6. Run smoke checks: `/health`, `/health/db` (verify the reported database and role without exposing credentials), Telegram authentication, order list, offer flow, cancellation history/request/confirm/decline, and sequential delivery transitions. Use controlled test accounts/orders; do not create or cancel real customer orders as tests.
7. Verify API logs, browser/Mini App behavior, and that existing order/offer workflows still work.

## Stop and rollback conditions

Stop immediately on an unexpected schema, failed migration, failed build, unhealthy API/database, auth regression, unexpected 4xx/5xx responses, or a broken Mini App. Do not improvise schema changes in production.

- If the application release fails before migration, restore the previous application version.
- If the additive migration succeeded, prefer rolling the application back to the previous version while leaving the unused new table in place. Do **not** drop the table or attempt a destructive database rollback without a separate reviewed plan; cancellation history may already have been written.
- If data integrity may have been affected, stop writes if needed and use the verified backup only under an explicitly approved recovery plan.

## Final sign-off

- [ ] CI and Mini App build passed for the exact release SHA.
- [ ] Schema compatibility confirmed against production (read-only checks).
- [ ] Backup restore tested successfully.
- [ ] Rollback target and health checks are ready.
- [ ] Owner explicitly approved the release window.
- [ ] Post-release smoke checks passed and the deployed SHA was recorded.

**Current limitation:** CI can validate isolated fixtures but cannot prove compatibility with the live VPS database or prove that the Mini App works end-to-end inside Telegram. Those checks require the host and Telegram environment; no production deployment is performed by this checklist.
