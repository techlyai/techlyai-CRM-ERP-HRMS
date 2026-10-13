# PostgreSQL architecture

The browser talks only to Next.js. Next.js connects directly to PostgreSQL through `pg`; there is no database REST service, hosted authentication dependency, public file bucket, or browser database credential.

## Request flow

1. Phone/password login verifies a salted scrypt hash and the account's current active state. PostgreSQL rate-limit counters throttle attempts.
2. The app issues a random 256-bit opaque session cookie, HttpOnly and SameSite=Lax, with Secure enabled for HTTPS. Only the SHA-256 hash is stored in the database; sessions expire after 12 hours.
3. Each data operation checks the database session and current profile. A transaction sets the verified user ID in `app.user_id`, switches to `techly_user`, and runs scoped queries or workflow functions. The context ends at COMMIT/ROLLBACK, preventing pooled connections from retaining another user's identity.
4. The `techly_user` role has RLS-constrained reads and explicitly granted workflow functions, without direct writes. Fixed-search-path SECURITY DEFINER functions enforce authorization, revisions, and ledger invariants. The server-only service role performs authentication, file staging, and scheduled jobs.

The runtime login can select the application/service roles but is not a superuser and cannot create roles or databases. It is still a sensitive trusted-server credential: never give it to browsers or end users. The migration owner remains separate.

## Database structure

| Schema / table group | Purpose |
| --- | --- |
| `private.accounts`, `private.sessions` | Password hashes and expiring, revocable sessions |
| `public.profiles`, `permission_grants`, `record_shares` | People, role/user permissions, explicit record sharing |
| `public.records` | Twenty business modules with indexed module/owner/status and validated JSONB fields |
| `public.history`, `questions` | Revisions, approval audit, clarification conversations |
| `public.leave_policies`, `leave_ledger` | Allocations, deductions, reversals, and balances |
| `public.stock_movements`, `payments` | Stock and financial transaction history with idempotency keys |
| `public.attachments`, `private.stored_files` | Authorized attachment metadata and private binary contents |
| `private.uploads`, `private.upload_parts` | Expiring, quota-limited chunk staging; finalization is atomic |
| `public.settings` | Company hours, working days, holidays, reminders, geofence settings |
| `public.notifications`, `notification_preferences`, `push_subscriptions` | In-app delivery, category/sound preferences, browser endpoints |
| `private.push_outbox`, `public.scheduler_runs` | Retry leases, delivery attempts, scheduler execution history |
| `private.module_contracts`, `login_attempts`, `schema_migrations` | SQL field validation, login throttling, installation checksums |

Business algorithms retain separate stock, leave, and payment ledgers. Row/advisory locks serialize critical writes. Purchase receiving updates stock and creates its linked expense in one transaction. Workflow approval requires an independent authorized reviewer.

`src/lib/query.ts` translates the app's compact filter strings to parameterized SQL with table and identifier validation. `src/lib/database.ts` invokes named PostgreSQL functions with typed parameters. These strings are an internal query format, not HTTP endpoints.

File finalization validates the expected byte length and approved format, then registers the file and attachment in one transaction. Every download rechecks authorization; nothing is publicly addressable. Large downloads stream, and audio/PDF requests support ranges. Document malware scanning remains an optional additional service, not a claim made by signature validation.

The scheduler is an authenticated Next.js endpoint driven externally every five minutes. Push delivery has persistent retries and generic previews. Browser polling drives in-app/custom audio alerts. Reports include scoped CSV, XLSX, PDF, DOCX, and print output.

When changing deployed schemas, add a new reviewed migration; never edit and rerun version 1. `npm run db:contracts` regenerates validation source for a new installation or for deriving a subsequent migration.

Implementation references: [node-postgres transactions](https://node-postgres.com/features/transactions), [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).
