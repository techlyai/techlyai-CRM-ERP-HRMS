# Orbit

**A Techly project.** Orbit connects your people, customers and operations in one workspace.

**Deploy the complete platform from the `backend` branch only.** Its root
[`docker-compose.yml`](docker-compose.yml) starts the website, APIs, PostgreSQL,
database setup and reminder worker in one Dokploy application. Follow
[docs/DOKPLOY.md](docs/DOKPLOY.md). No separate frontend deployment is needed.

Next.js App Router + TypeScript business management platform using **standalone PostgreSQL** for company data, phone/password authentication, sessions, private documents, and notification sounds.

Twenty modules cover CRM, renewals, HRIS, attendance, EOD reports, leave, projects, inventory, assets, purchases, expenses, and finance. Backend workflow functions and PostgreSQL RLS enforce record access and transactional approvals.

**MMC** (Operations → MMC) tracks each website client's monthly maintenance charge and switches their site ON/OFF through a small snippet; see [docs/MMC.md](docs/MMC.md).

Start with [docs/SETUP.md](docs/SETUP.md). The database structure is documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); current limits and verification are in [docs/STATUS.md](docs/STATUS.md).

```powershell
npm run db:docker:start
npm run db:setup
npm run create-admin -- --phone 9000000000 --name "Techly Admin"
npm run build
npm start
```

The first command requires Docker Desktop's Linux engine to be running. It creates a dedicated PostgreSQL container with persistent data. Native Windows PostgreSQL remains available through `npm run db:start`. For an existing server, set a dedicated database connection in `.env.database` and start with `db:setup`. The admin script prints a generated temporary password only after successfully creating the account. There is no default password.

Development checks: `npm test`, `npm run typecheck`, `npm run build`. Database checks: `npm run db:verify` against an isolated database. Never commit credentials or `.local` database files.
