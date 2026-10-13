# Backend is the complete deployment branch

Deploy only `backend`. It contains the full Next.js application: frontend pages,
components, styles, backend APIs, authentication, PostgreSQL schema, files,
reports, and scheduled jobs. Its root `docker-compose.yml` starts the entire
platform in one Dokploy application. The `frontend` branch is not a dependency.

Follow [DOKPLOY.md](DOKPLOY.md) for environment variables, the domain, and login.
Do not use the earlier instructions for separately deploying the two branches.
