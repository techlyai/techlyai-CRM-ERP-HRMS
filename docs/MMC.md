# MMC — monthly maintenance charges & website ON/OFF

**Operations → MMC** tracks the fixed monthly maintenance charge (MMC) each website client pays, and switches each client's website ON or OFF through a small snippet installed on that site.

| Tab | What it does |
| --- | --- |
| Dashboard | Totals, active/suspended sites, this month's expected/collected/pending, overdue clients with Pay/Remind/Toggle, dues in the next 7 days, 12-month revenue chart |
| Clients | Search and filter (Paid / Pending / Overdue / Active / Suspended), ON/OFF switch per row, add client |
| Client page | Dues, payment history with PDF receipts, ON/OFF log, messages, site key, snippets, Test connection |
| Payments | Latest payments and receipts |
| Notifications | SMS/WhatsApp log with MSG91 IDs, errors and retry |
| Notes | Every client's site key with the client and website name, saved automatically (encrypted) when generated; show, copy, or copy the `.env` lines. Each view is audited |
| Reports | Payments, dues and ON/OFF history to Excel/CSV with date filters |
| Integration guide | How to install and test the snippets; last-seen status of every site |
| Settings | Auto-suspend/reactivate, reminder timing, Site Suspended page, admin push events, message templates |

## Setup

1. Apply the migration: `npm run db:setup` (applies `database/migrations/011_mmc.sql`). On Dokploy, the `migrate` service does this on deploy.
2. Permissions (Users & access → permissions, group **Operations**):
   - `mmc.view`: see everything in MMC
   - `mmc.manage`: add and edit clients, record payments, switch sites, regenerate keys, send reminders
   - `mmc.delete`: delete clients
   - `mmc.settings`: change MMC settings and templates

   Super Admins have all four. For a **Staff** member, grant `view` and `manage` only.
3. Set `APP_URL` to the public HTTPS origin. It is used in the snippets and in receipt links.
4. Optional: set the MSG91 variables (below). Without them, messages are recorded as **skipped**, and toggles and payments still work.

## How money is tracked

- **Dues.** A due is created for each client on its billing day. Days 29–31 fall back to the month's last day. The first due is the first billing day on or after the later of the start date and the day the client was added, so adding an existing client never creates (or suspends for) past months.
- **Overdue.** A due becomes **Overdue** once its date plus the client's grace period (default 5 days) has passed without full payment.
- **Payments.** Each payment is applied to the oldest open dues first.
  - Paying less than the open dues leaves a partial balance.
  - Paying more keeps an **advance credit**, which is used automatically when future dues are generated.
  - Every payment gets a receipt number (`MMC-00001`) and a downloadable PDF receipt.
- **No duplicates.** The *Mark as paid* form sends an idempotency key, so a double click or a retry records one payment.

## UPI payment link

Every client has a payment link, `https://<orbit>/pay/<token>`. The token is 64 random characters, and the link is shown on the client's page with a Copy button.

The page shows:
- what the client owes and for which months
- a **Pay with UPI app** button, a `upi://pay` link that opens GPay, PhonePe, Paytm or a bank app with the payee and amount filled in
- a UPI QR code
- an **Already paid?** form where the client enters the UPI transaction ID (UTR)

How a reported payment is handled:
- A submitted UTR creates a **payment to verify**. It appears on the MMC Dashboard, the Payments page and the client's page, and sends an admin alert (category *claim*).
- **Received, approve** records the payment as UPI with the UTR as its reference, which sends the receipt message and reactivates an auto-suspended site.
- **Not received** closes the claim without recording anything.
- Nothing is marked paid on the client's word alone.

Setting the UPI ID:
- Set the UPI ID and payee name in **MMC → Settings → UPI payments**.
- A business or merchant UPI ID works best: some UPI apps limit or block pre-filled payments to personal IDs.

The link in messages:
- WhatsApp template buttons only accept `https` links, so messages carry the Orbit link, not `upi://`.
- The reminder, due today, overdue and suspended templates use a **dynamic URL button** `https://<orbit>/pay/{{1}}`, set as *WhatsApp URL button = Pay now* in Settings.
- The payment received template uses a receipt button, `https://<orbit>/api/mmc/receipt/{{1}}`.
- The text variable `{{pay_link}}` is also available.

## ON/OFF and auto mode

- **Manual switch.** The switch works any time. Turning a site OFF asks for confirmation and an optional reason.
- **Auto-suspend** (Settings, plus the client's own *auto-suspend* box). When a client has an Overdue due, the scheduler turns the site OFF within a minute.
- **Auto-reactivate.** When a payment clears every overdue due, the site is turned back ON, but only if the system turned it off. A site you switched off by hand stays off.
- **Log.** Every change is recorded (client, old → new, admin or auto, reason, time) and shown on the client page and in Reports.
- **Client message.** Every change queues a "Site suspended" or "Site reactivated" message to the client.

## Site status API

```
GET /api/site-status
x-site-key: sk_live_…

200 {"active":true,"message":"","checked_at":"…"}
200 {"active":false,"message":"Site suspended due to pending maintenance payment. Please contact admin.","checked_at":"…"}
401 invalid key · 403 browser Origin outside the allowed domain · 429 over 60 requests/min per key · 400 plain HTTP in production
```

- **Keys.** Each key is `sk_live_` followed by 43 random characters. The API looks keys up by SHA-256. A copy is also saved to **MMC → Notes**, encrypted with AES-256-GCM using `CREDENTIALS_ENCRYPTION_KEY` (the same key as the client credentials vault). Without that variable the key is shown once and not saved. Showing a saved key needs `mmc.manage` and is written to the audit log. **Regenerate key** replaces the key and its saved copy immediately.
- **Domain check.** Browser requests (the HTML snippet) must come from the client's **allowed domain** or its subdomains. Server-side snippets send no Origin and are matched by key alone.
- **Last seen.** Each check updates the client's *last seen* time (at most once a minute). A site that checked in before and then goes quiet for 24 hours triggers an admin alert.

## Client websites: key in the environment, one shared piece of code

Each client website calls the API itself. It needs two things:

**1. Two environment variables**, for example in Dokploy → the client's app → Environment. Redeploy after setting them.

```
ORBIT_SITE_KEY=sk_live_…            # the client's key (shown once in Orbit when created or regenerated)
ORBIT_STATUS_URL=https://your-orbit-domain/api/site-status
```

**2. The status check code**, added once to the site. It is identical for every client; only the environment differs. Copy it from the client's page (*Site key & integration*), or use the generic files in `docs/mmc-snippets/`.

| Stack | File | Install |
| --- | --- | --- |
| Next.js | `middleware.ts` | Save as `middleware.ts` in the project root (or `src/`), then rebuild |
| PHP / WordPress | `orbit-site-status.php` | Top of `index.php`, or `wp-content/mu-plugins/orbit-site-status.php` |
| Node / Express | `orbit-site-status.js` | `app.use(require('./orbit-site-status'))` before your routes (Node 18+) |
| Static HTML / React | `orbit-site-status.html` | First `<script>` in `<head>`. It runs in the browser, so it cannot read server environment variables; the key goes in the code (set the allowed domain) |

Behaviour of every snippet:
- caches the status for 5 minutes
- times out after 3 seconds
- **fails open**: if Orbit is unreachable, the site keeps its last known status, so an Orbit outage never takes every client down
- with no `ORBIT_SITE_KEY` set, the site simply stays online
- when the site is OFF, returns HTTP 503 with the Site Suspended page and your contact details from Settings

PHP reads the variables with `getenv()`, falling back to `$_SERVER` and `$_ENV`. Under PHP-FPM, environment variables reach PHP only when the pool has `clear_env = no`; official Docker PHP images and most Dokploy PHP templates already pass them through.

## Notifications

### Client (MSG91)

**Events** (one polite wording for every client: messages carry only the client name and website, and amounts appear on the Pay now page; WhatsApp templates may carry a *Pay now* URL button, see UPI payment link): reminder N days before the due date (default 3), due today, overdue (repeats every N days, default 2), site suspended, site reactivated, payment received (includes the receipt link). The *Remind* button sends the most relevant one immediately.

**Channel per client:** WhatsApp, SMS, both, or none.

**Delivery:**
- Messages are queued in the same transaction as the event, then sent by the scheduler. A failed message never blocks a payment or a toggle.
- Failures are retried up to 3 attempts, about 5 and 10 minutes apart.
- A final failure alerts the admins. **Retry** in the log re-queues a failed or skipped message.

**Environment variables:**

| Variable | Meaning |
| --- | --- |
| `MSG91_AUTH_KEY` | MSG91 auth key (sent in the `authkey` header) |
| `MSG91_SENDER_ID` | DLT-approved sender ID for SMS |
| `MSG91_SMS_TEMPLATE_IDS` | JSON map of event → Flow template ID, e.g. `{"overdue":"65…"}`. IDs saved in MMC → Settings take precedence |
| `MSG91_WHATSAPP_NUMBER` | Integrated WhatsApp number, digits with country code |

**SMS (Flow API, `https://control.msg91.com/api/v5/flow/`).**
- The text is fixed by your DLT-approved template.
- Create one Flow template per event, using variables named `##client_name##`, `##amount##`, `##due_date##`, `##website##`, `##days_overdue##` and `##receipt_link##`.
- Put each template ID in Settings.
- Every variable is sent by name.

**WhatsApp (MSG91 outbound template API).**
- Get each template approved in MSG91, then enter its name in Settings.
- List its body variables in the order the template uses them (they are sent as `body_1`, `body_2`, …).
- Language defaults to `en`.
- If MSG91 changes its payload format, adjust `src/lib/msg91.ts`.

The **text** fields in Settings with `{{variables}}` are used for previews.

### Admin

Admin alerts go to the notification bell, with web push on devices enrolled under Settings → Notifications. They also work when Orbit is installed as a PWA on a phone. Push needs the VAPID keys.

Alert events, each of which can be turned off in MMC → Settings: client became overdue, site auto-suspended, payment recorded, site silent for 24 hours, message failed.

## Scheduler

No extra cron is needed. The existing scheduler container calls `/api/cron/tick` every minute, and each tick runs `mmc_tick()` and then delivers queued messages. Every step is idempotent:
- `unique(client, month)` on dues
- deterministic message keys, e.g. `mmc:overdue:<client>:<date>`
- one admin alert per client per day

Running the tick many times never duplicates a due or a message. Elsewhere, call `GET /api/cron/tick` with `Authorization: Bearer $CRON_SECRET` at least daily; every minute is better, so switches take effect quickly.

## Testing checklist

1. `npm run typecheck && npm test && npm run build`.
2. Add a test client whose start date and billing day are today, with a grace period of 0. Within a minute the due is generated; the next day it becomes Overdue and the site switches OFF.
3. Call the API:

   ```
   curl -s -H "x-site-key: <key>" http://127.0.0.1:3000/api/site-status
   ```

   An active client's key returns `active:true`, a suspended client's key returns `active:false`, and a wrong key returns 401. Sending 61 requests within a minute returns 429.
4. Record a payment that clears an auto-suspended client's overdue amount. The site turns back ON, a receipt PDF opens, and "payment received" and "reactivated" messages appear in Notifications.
5. Turn a site OFF with a reason and check the log and Reports → Site ON/OFF history.
6. On a test site, set `ORBIT_SITE_KEY` and `ORBIT_STATUS_URL` in its environment and add the snippet for its stack:
   - Open the site and check that *Last seen* updates.
   - Toggle OFF and confirm HTTP 503 within 5 minutes.
   - Stop Orbit and confirm the site keeps its last status.
