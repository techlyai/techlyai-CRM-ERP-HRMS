# Security and verification

All business reads and writes require a fresh database-backed session. User IDs come from opaque session tokens, never browser-submitted identity fields. Passwords use individual random salts with Node.js scrypt. Session hashes are stored in a private table; logout revokes the current session, password changes revoke other sessions, and account deactivation blocks current sessions immediately on the next request. Initial administrators must change their generated passwords before accessing business modules.

The application role has RLS-constrained reads and only explicitly allowed transaction functions. Ordinary writes cannot directly modify attendance timestamps, stock counts, leave balances, payment totals, or approval states. Private HR/payroll/attendance records remain restricted even with overbroad employee grants. Managers start without module access. DB roles do not come from browser metadata.

The service role is available only inside trusted server code for session validation, provisioning, scheduler execution, and file handling. Its database credential is highly privileged within the application's data; do not distribute it to clients. Keep the migration-owner URL off the deployed app, use verified TLS for remote databases, and limit database network access. The database migration establishes no publicly reachable API.

File upload and completion endpoints check same-origin requests, current sessions, record visibility/upload permission, size, extension, MIME, and magic bytes. Chunks are bounded to 3 MiB; unfinished uploads expire in an hour, with a 100 MiB/20-upload per-user staging quota. Final files and metadata commit together. Downloads and custom sounds require a current authorized session. File signatures do not replace antivirus scanning.

GPS is device-reported and is collected only during attendance actions with user consent. Geofence/accuracy flags aid review but do not prove physical presence. No background location tracking is implemented.

Before release, run the SQL integration suite against an isolated PostgreSQL database, exercise the application with separate admin/manager/employee accounts, and test concurrent stock/leave/payment writes. Verify session revocation, document permissions, full-size uploads, push delivery, scheduler authentication, and backup restoration. Upgrade/audit the cached Next.js dependency before production deployment. Passing a build and unit tests does not establish database or production correctness.

## Client credentials vault

Client logins are stored on the client record's Credentials tab. Passwords are encrypted on the application server with AES-256-GCM before reaching PostgreSQL; the key is `CREDENTIALS_ENCRYPTION_KEY` (32 random bytes, 64 hex characters) and never enters the database or the browser. Each ciphertext is bound to its credential and version, so it cannot be moved between records. To rotate, set a new key and list previous keys in `CREDENTIALS_PREVIOUS_KEYS`. Back up the key separately from database backups: without it, stored passwords cannot be recovered.

- **Access.** Listing, adding, editing and revealing current passwords require Edit access to that client. Opening previous passwords requires Super Admin or Approve access to clients, plus re-entering the user's own password (valid for 10 minutes). Permanent deletion is Super Admin only, after archiving, with a reason.
- **History.** Every password change closes the previous version and stores the new one in a single transaction. Versions keep who set and replaced them, when, and why.
- **Audit.** Creation, edits, password changes, reveals, copies, history views, archive, restore and deletion are recorded in `public.credential_audit` without any secret values. Reveals and copies are limited to 30 per user per minute.
- **Exposure.** Credentials are excluded from exports, global search and notifications. Passwords are fetched only when a user clicks Show or Copy, and revealed values are masked again after 30 seconds.
