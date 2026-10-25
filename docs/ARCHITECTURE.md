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

## Reminders, chat, email and employee IDs (migration 002)

Numbered migrations in `database/migrations/` are applied by `npm run db:setup` after version 1; applied versions are recorded with checksums in `private.schema_migrations` and never re-run.

| Table group | Purpose |
| --- | --- |
| `public.reminders`, `reminder_occurrences` | Yearly, monthly, weekly, daily, custom and one-time reminders with server-computed `alert_at` (yearly: one month before with month-end clamping; monthly: 14 days before; explicit advance overrides), anchored recurrence, snooze, completion history |
| `public.conversations`, `conversation_members`, `messages`, `message_reads`, `presence`, `message_reports` | Direct, group, department and project chat with membership-based RLS, read receipts, typing/presence, pins, mutes, reports and audited Admin review |
| `public.email_settings`, `email_log`, `private.invites` | Sender identity, event toggles, templates, queued deliveries with provider status and retries, secure activation links |
| `public.employee_id_settings`, `employee_id_sequences` | Configurable ID format and row-locked sequences; `save_record` assigns IDs for new employee records |
| `public.notifications` (+ `priority`, `link`, `meta`) | Notification centre entries with deep links and structured context such as employee and project names |

`public.reminders_tick()` and `public.scheduler_tick()` run every minute from the scheduler container through the cron endpoint, so reminder alerts, daily repeats, escalations and email retries do not depend on an open browser. Duplicate alerts are prevented by `unique(user_id,event_key)`; chat uses one upserted notification per conversation. Email rows are marked `accepted` only when the provider returns an identifier; a missing `RESEND_API_KEY` or sender address records a `failed` attempt that is retried with backoff up to the configured limit.

## Joining documents and large files (migration 005)

Employee records have a **Joining documents** section: one combined PDF (joining letter, Aadhaar, PAN, bank passbook, 10th and 12th certificates, course completion and experience certificates, resume, passport photo) plus a checklist stored in `data.joining_documents`. Each upload is kept as a new version (`public.attachments.kind = 'joining'`); the newest is current and earlier ones stay downloadable.

Files above 20 MB, and every joining PDF, use chunked storage: uploaded 3 MiB pieces are copied inside PostgreSQL into `private.stored_file_chunks` when the upload finishes, and downloads stream one piece at a time with HTTP range support, so file size is not bounded by server memory. Smaller attachments keep the single-value layout. Joining PDFs have no application size limit unless `MAX_JOINING_DOCUMENT_MB` is set; plan disk space and backup size accordingly. Uploads are checked for a PDF header and a closing `%%EOF` marker, and stay alive while pieces keep arriving.
