# Service split validation

Validated locally on Node.js 22 against the local Docker PostgreSQL database:

- Both Next.js production builds and TypeScript checks pass.
- Backend domain, password, query and file-response tests: 14 pass.
- Transactional PostgreSQL RLS/business-workflow integration tests pass.
- Two running production services pass HTTP checks for service-key enforcement,
  frontend login/session cookies, forced password change, admin server rendering,
  lead creation, cross-user record isolation, the read-RPC allowlist, upload origin
  validation, private file upload/download, cross-user file denial and logout.
- Both dependency locks are normalized with npm; `npm ci --dry-run --offline`
  validates package/lock consistency. Native Docker image builds and production
  deployment were not run in this restricted session.

The HTTP test creates random test users and records and removes those fixtures
afterward. To rerun using a disposable local database, start backend on port 3101
and frontend on port 3100. Set their shared `TECHLY_INTERNAL_API_KEY` and set
frontend `APP_URL=http://127.0.0.1:3100`, `BACKEND_URL=http://127.0.0.1:3101`.
In the backend checkout, set `DATABASE_ADMIN_URL` for that test database,
`TECHLY_INTERNAL_API_KEY`, and `TEST_FRONTEND_BUILD_DIR` to the frontend `.next`
directory, then run:

```sh
node scripts/run-ts.cjs scripts/smoke-split.ts
```

Production domain routing, fresh-cluster migration in Docker, browser push with
real VAPID keys, device geolocation and visual/mobile browser checks still need
verification in the deployment environment. This validation describes the service
split; it does not certify completion of every feature in the original product brief.
