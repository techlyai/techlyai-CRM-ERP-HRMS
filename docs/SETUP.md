# Techly PostgreSQL setup

Techly uses a standalone PostgreSQL 15+ database. Next.js handles phone/password authentication. Password hashes, sessions, documents, and notification sounds are stored in PostgreSQL. No external authentication or storage account is needed.

## Docker database (recommended for this workstation)

Open Docker Desktop and wait for its Linux engine to be running. PostgreSQL runs in its own container, independent of the incomplete native Windows installation.

```powershell
npm run db:docker:start
npm run db:setup
npm run create-admin -- --phone 9000000000 --name "Techly Admin"
npm run build
npm start
```

The Compose service uses the official `postgres:18-alpine` image, a persistent named volume, SCRAM password authentication, and a health check. Only `127.0.0.1:55432` is published. Its database-owner password is randomly generated in ignored `.local/docker-postgres-password` and mounted as a Docker secret; `.env.database` stores the corresponding migration URL. Keep these two files for subsequent starts. The helper preserves existing credentials and refuses to replace a different database connection.

`npm run db:docker:stop` stops the container without deleting its database volume. Use `npm run db:docker:status` to check it. Never remove the volume unless you deliberately intend to erase this database. The first start needs access to Docker Hub to pull the image. PostgreSQL 18 mounts its data volume at `/var/lib/postgresql`, following the [official image layout](https://hub.docker.com/_/postgres).

## Native Windows database (alternative)

A complete PostgreSQL installation must include `postgres.exe`, `initdb.exe`, `pg_ctl.exe`, and their runtime dependencies. The [official Windows download page](https://www.postgresql.org/download/windows/) links to installers and portable binaries.

From this project directory:

```powershell
npm ci
npm run db:start
npm run db:setup
npm run create-admin -- --phone 9000000000 --name "Techly Admin"
npm run build
npm start
```

`db:start` creates an isolated cluster in `.local/postgres`, listens only on `127.0.0.1:55432`, and creates the `techly` database. It never uses another installed cluster's data directory. Migration credentials go into ignored `.env.database`. To use another PostgreSQL installation:

```powershell
powershell -NoProfile -File scripts/local-postgres.ps1 start -PostgresBin "C:\Program Files\PostgreSQL\17\bin"
```

`db:setup` applies the seven SQL files atomically and records a checksum. It creates `techly_app`, a restricted runtime login, and saves its connection into ignored `.env.local`. It refuses a nonempty unrelated database and does not rerun a changed initial schema over existing data. Migration setup requires an owner that can create database roles including the service role with BYPASSRLS; it is intended for a dedicated PostgreSQL cluster.

The `create-admin` command prints the **actual randomly generated temporary password only after committing the account**. The example phone is an application login identifier; no SMS is sent. Use your real administrator's phone instead if preferred. There is no fixed or default password. First login requires changing the temporary password. Add subsequent users through Users & access.

Open http://localhost:3000. Stop only this database with `npm run db:stop`; start it again with `npm run db:start`.

## Existing standalone PostgreSQL server

Create a dedicated empty database. Put this in `.env.database`:

```text
DATABASE_ADMIN_URL=postgresql://migration_owner:URL_ENCODED_PASSWORD@HOST:5432/techly?sslmode=verify-full
```

Use the provider's verified certificate configuration; do not disable certificate checks. Run `npm run db:setup`, then `create-admin`. Keep `.env.database` off the application deployment. Only `.env.local` runtime variables are needed by the app.

Schema installation order (the script applies these for you):

1. `database/bootstrap.sql`: database roles, accounts, sessions, file objects.
2. `database/schema.sql`: business tables, permissions, RLS, transaction functions.
3. `database/contracts.sql`: generated module validation rules.
4. `database/scheduler.sql`: reminders, accruals, exports, sharing.
5. `database/analytics.sql`: scoped dashboard aggregations.
6. `database/admin.sql`: document verification, leave policy, CRM import.
7. `database/storage.sql`: private chunk upload staging and file constraints.

## Verification

```text
npm test
npm run typecheck
npm run db:verify
npm run build
```

`db:verify` uses the migration connection to run `tests/database.sql`. Use an isolated test database: fixtures are transactional and rolled back, but assertions expect no unrelated business records. Also test separate simultaneous stock allocations, leave approvals, account revocation, large file uploads/downloads, and payment submissions before production use.

## Deployment and reminders

Deploy Next.js on Vercel or a Node.js host with network access to PostgreSQL. Set `DATABASE_URL` to the restricted application login, the final HTTPS `NEXT_PUBLIC_APP_URL`, timezone/country settings, a random `CRON_SECRET` of at least 32 characters, and optional VAPID keys. Never expose database credentials through a `NEXT_PUBLIC_` variable. The app uses verified TLS when specified by its connection URL; keep the database on a private network where possible.

Uploads use private, authenticated 3 MiB chunks; complete files are assembled and registered transactionally in PostgreSQL after validation. Documents are limited to 20 MiB, sounds to 5 MiB. Downloads stream after a fresh access check. Validate these flows on the actual host; [Vercel documents payload limits and streaming](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions). PostgreSQL file bytes increase database size and backup/transfer costs; include them in capacity planning.

Configure a scheduler to call `GET /api/cron/tick` every five minutes with `Authorization: Bearer CRON_SECRET`. The scheduler must run independently of browser tabs. It applies company working days, holidays, attendance/EOD reminders, renewals, accruals, push delivery, and expired session/upload cleanup. Do not put secrets in public URLs. Set company policies in Settings and monitor scheduler history there.

Generate VAPID keys with the installed `web-push` package for browser push; each user enrolls their device in Settings. Browser/OS restrictions on sound and closed-app notifications still apply.

Before release, upgrade the cached Next.js 14 version to a supported release, install and audit dependencies normally, validate RLS/workflows, configure backups and restore drills, and run deployment smoke tests. The local dependency cache was used for this workstation's build; it is not a production dependency audit.
