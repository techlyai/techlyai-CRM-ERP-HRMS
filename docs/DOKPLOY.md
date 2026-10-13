# Deploy all of Techly from the backend branch

Use **one Dokploy Docker Compose application**, one Git branch and one public
domain. The `backend` branch contains the complete Next.js frontend and backend,
SQL schema, Dockerfile, scheduler, and root `docker-compose.yml`.
The `frontend` branch is not required for this deployment.

## Dokploy settings

| Setting | Value |
| --- | --- |
| Repository | techlyai/techlyai-CRM-ERP-HRMS |
| Branch | backend |
| Compose Path | ./docker-compose.yml |
| Trigger | On Push |
| Domain service | backend |
| Container port | 3000 |

The service name `backend` serves the **entire website**, including `/login`,
dashboards, administration screens and APIs. Add your HTTPS domain to that service
in Dokploy. Do not add domains or public ports to PostgreSQL or the scheduler.
The older `compose.yaml` is only for local database development; Dokploy must use
the explicitly selected `./docker-compose.yml`.

## Environment

Add these variables in Dokploy Environment before deploying:

```dotenv
APP_URL=https://your-techly-domain.example
POSTGRES_PASSWORD=REPLACE_WITH_FIRST_64_CHARACTER_RANDOM_HEX_SECRET
DATABASE_APP_PASSWORD=REPLACE_WITH_SECOND_64_CHARACTER_RANDOM_HEX_SECRET
CRON_SECRET=REPLACE_WITH_THIRD_64_CHARACTER_RANDOM_HEX_SECRET
NEXT_PUBLIC_DEFAULT_COUNTRY_CODE=91
```

Generate each secret separately on your computer:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Use hexadecimal database passwords because Compose inserts them into connection
URLs. `APP_URL` must be the final HTTPS origin without a path. Compose constructs
the restricted `DATABASE_URL` and migration-only `DATABASE_ADMIN_URL` internally.
No `BACKEND_URL`, service gateway key, second repository, or frontend deployment
is needed. Never commit real environment values.

Optional browser push variables: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT=mailto:admin@your-domain.example`.
Changing the public VAPID key requires rebuilding the app. In-app reminders work
without browser push. Push requires supported devices and browser permission;
alert sounds may require a user interaction.

## Startup and persistence

The Compose deployment starts these services automatically:

1. `postgres`: PostgreSQL 18 with the persistent `postgres_data` volume.
2. `migrate`: installs the seven schema files atomically into a new dedicated
   database and creates the restricted runtime login. It exits after success.
3. `backend`: the complete Next.js web app and APIs on container port 3000.
4. `scheduler`: invokes the authenticated reminder job every minute without
   depending on an open browser. Database event keys prevent duplicate reminders.

Subsequent setup runs verify the installed schema checksum and preserve data.
Schema changes require new migrations. Keep database passwords stable after the
first installation; editing environment variables does not rotate passwords in
an existing volume. Back up the PostgreSQL volume, which also stores uploaded
files, and verify restoration. Do not delete it to fix a deployment error.

## First administrator and login

After deployment succeeds, open the `backend` container terminal in Dokploy:

```sh
npm run create-admin -- --phone YOUR_PHONE_NUMBER --name "Techly Admin"
```

This prints a random temporary password once. Save it privately and sign in at
`https://your-domain/login`; the app requires a password change. Administration
uses that same login and role-based workspace. There is no separate `/admin`
password or default seeded account. A new production database does not inherit
your local login credentials. The command refuses to replace an existing first
administrator.

## Verification

Check `migrate` logs for successful schema installation, then open `/login`, sign
in, save a record and upload/download an attachment. Check `scheduler` logs for
failures. `/api/health` checks that the web process responds; it does not verify
database readiness. See [VALIDATION.md](VALIDATION.md) for completed local checks
and deployment checks still needed.

If you run Compose manually, always name the deployment file explicitly:

```sh
docker compose -f docker-compose.yml up -d --build
```

Dokploy supplies public routing; no host port is exposed by this Compose file.
