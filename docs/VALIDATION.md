# Complete backend-branch deployment validation

The `backend` deployment source contains the full website, APIs, PostgreSQL schema
and reminder worker, with one root Compose file.

Completed for this revision:

- Next.js production build, including login, workspace pages and all API routes.
- TypeScript validation and 15 domain, report, password, query, file and origin tests.
- `docker compose -f docker-compose.yml config --quiet` with test environment values.
- `npm ci --dry-run --offline` validates the combined package and dependency lock.
- Earlier local PostgreSQL RLS/workflow integration checks passed; this revision
  does not change the SQL schema.

The new live HTTP login smoke check could not run: automatic approval review
blocked starting its local server because sandbox approval is disabled. The
script is included as `scripts/smoke-complete.ts`; it uses disposable test users
against a local test database and removes them afterward. Set `DATABASE_ADMIN_URL`
and `TEST_BUILD_DIR` pointing to the built app's `.next` folder; run the app on
127.0.0.1:3102 with its runtime database connection, then execute:

```sh
node scripts/run-ts.cjs scripts/smoke-complete.ts
```

Docker image execution, fresh-cluster installation, HTTPS domain routing and live
browser push remain to be checked on Dokploy. See [DOKPLOY.md](DOKPLOY.md) for the
deployment steps and [STATUS.md](STATUS.md) for remaining product feature work.
