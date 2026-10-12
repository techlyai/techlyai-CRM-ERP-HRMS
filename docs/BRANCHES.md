# Frontend and backend branches

The `frontend` and `backend` branches start from the same complete, verified project baseline. Both contain the full Next.js application so each can build and run independently; the application shares TypeScript contracts, Server Actions, and configuration across the two areas.

Use `frontend` for pages, layouts, components, styles, responsive behavior, and public assets, primarily under `src/app`, `src/components`, and `public`.

Use `backend` for database changes, authentication, permissions, Server Actions, Route Handlers, storage, jobs, and integration tests, primarily under `database`, `src/lib`, `src/app/api`, `scripts`, and `tests`.

Coordinate shared contract changes and merge them between branches as needed. Branches separate development work; they do not create separately deployable frontend/backend services. Environment files, database volumes, credentials, build output, and dependencies remain local.
