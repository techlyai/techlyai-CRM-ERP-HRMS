# Deploy the separated Techly services

Deploy `backend` first, then `frontend`, as two Dokploy **Docker Compose** applications.
Each branch now has its own `./docker-compose.yml`. The previous `compose.yaml`
was only a local PostgreSQL helper and is not the production deployment file.

| Application | Git branch | Compose path | Domain service | Container port |
| --- | --- | --- | --- | --- |
| Backend | backend | ./docker-compose.yml | backend | 3000 |
| Frontend | frontend | ./docker-compose.yml | frontend | 3000 |

Use separate HTTPS hostnames, for example `api.example.com` and `crm.example.com`.
Configure these in Dokploy's Domains tab. Do not publish PostgreSQL's port or
attach a domain to `postgres`, `migrate`, or `scheduler`. Dokploy manages routing
to the selected application service. See the [Dokploy Compose example](https://docs.dokploy.com/docs/core/docker-compose/example)
and [Compose domains](https://docs.dokploy.com/docs/core/docker-compose/domains).

## Backend environment

Paste the variables from this branch's `.env.example` into Dokploy Environment.
Set `POSTGRES_PASSWORD`, `DATABASE_APP_PASSWORD`, `TECHLY_INTERNAL_API_KEY`, and
`CRON_SECRET` to **four different random secrets**. Generate each locally with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Use hexadecimal passwords because Compose interpolates them into connection URLs.
Set `APP_URL` to the final **frontend** HTTPS origin. `DATABASE_URL` and
`DATABASE_ADMIN_URL` are constructed by Compose; leave their example entries out
of Dokploy's environment. VAPID settings are optional for browser push; the same
public key must be supplied when building the frontend. In-app reminders work
without VAPID. Never put secrets in Git or a `NEXT_PUBLIC_` variable.

The backend starts four services:

1. `postgres`: PostgreSQL 18 with a persistent named volume.
2. `migrate`: installs the schema atomically into a new dedicated database, creates
   the restricted application login, and exits. Repeated deployments verify the
   schema checksum and preserve existing data. Schema changes require new migrations.
3. `backend`: API, sessions, permissions, reports, files and database access.
4. `scheduler`: calls the authenticated reminder job every minute, independently
   of browser sessions. The database deduplicates scheduled notifications.

Keep both database passwords stable after installation. Changing environment
values does not rotate passwords in a persistent PostgreSQL volume. Back up and
test restores for the volume: it holds business data **and uploaded files**.
Never remove the volume to repair an ordinary deployment problem.

## Create the first administrator

After deployment succeeds, open the `backend` container terminal in Dokploy:

```sh
npm run create-admin -- --phone YOUR_PHONE_NUMBER --name "Techly Admin"
```

The command prints a newly generated temporary password once. Save it privately.
It refuses to replace an existing first administrator. There is no fixed password
and no seeded production user. Existing local credentials are not copied to a
new production database. Sign in at the **frontend `/login`**, then change the
temporary password. Admin access is role-based within the same workspace;
there is no separate `/admin` login or separate administrator password.

## Frontend environment

Set `APP_URL=https://crm.example.com`, `BACKEND_URL=https://api.example.com`, and
the exact same `TECHLY_INTERNAL_API_KEY` used by the backend. Supply the optional
public VAPID key as a build argument through the Compose environment. Deploy and
attach the frontend domain to service `frontend`, port `3000`.

`APP_URL` and `BACKEND_URL` must be origins without a path. Use HTTPS between
separate hosts; HTTP is only appropriate on a trusted private container network
or localhost. The browser contacts the frontend origin only. Its server forwards
sessions and injects the service secret. No CORS configuration is needed.

## Verification

The backend `/api/health` returns a service health response. Other backend API
requests require the service key and, where applicable, a valid user session.
The health endpoint checks process availability, not database readiness.

Verify frontend sign-in, forced initial password change, a saved record, an
attachment upload/download, and a notification. Check `migrate` and `scheduler`
logs if reminders or sign-in fail. Check the shared secret and backend URL for
gateway errors. Browser push still requires browser permission, supported
devices, and valid VAPID configuration; sound may require a user interaction.

Both branches share domain definitions as source files. Keep their versions in
sync when changing API contracts. They are independent applications: do not
merge one branch wholesale into the other. The original combined application
remains in Git history at `6c1741ef7ed834e68f5bab76165c82b9bc86d96c`.
