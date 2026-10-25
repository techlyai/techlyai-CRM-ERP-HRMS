import type { PoolClient } from "pg";
import { serviceDB } from "./database";

/**
 * Email delivery service. Rows are queued in public.email_log by database
 * functions (or by queueEmail below for server code); the scheduler drains the
 * queue here. A row becomes "accepted" only when the provider acknowledges it
 * with an identifier, so the log never claims delivery the provider did not
 * confirm.
 */
export type EmailSettings = {
  provider: "resend" | "console";
  sender_name: string;
  sender_email: string;
  company_name: string;
  support_contact: string;
  retry_limit: number;
  events: Record<string, boolean>;
  templates: Record<string, { subject?: string; body?: string }>;
};
export type EmailJob = {
  id: string;
  event: string;
  recipient: string;
  subject: string;
  body: string;
  attempts: number;
};
export type SendResult =
  | { status: "accepted"; provider: string; providerId: string }
  | { status: "failed" | "skipped"; provider: string; error: string };

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Mirrors private.render_template: `{{ name }}` placeholders (lower-case
 * letters and underscores, optional inner spaces) are replaced with the
 * matching variable; unknown names render as an empty string and anything else
 * is left untouched.
 */
export function renderTemplate(template: string, vars: Record<string, unknown>) {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key: string) => {
    const value = vars[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

/** Minimal branded HTML wrapper around a plain-text body. */
export function renderEmailHtml(subject: string, body: string, company: string, appUrl: string) {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.6">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const linked = paragraphs.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}" style="color:#6366f1">${url}</a>`,
  );
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a"><div style="max-width:560px;margin:24px auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:28px"><div style="font-weight:600;font-size:18px;margin-bottom:18px"><span style="color:#0f172a">Orb</span><span style="color:#6366f1">it</span><div style="margin-top:6px;font-size:11px;font-weight:400;color:#64748b">A Techly project</div></div><h1 style="font-size:17px;margin:0 0 16px">${escapeHtml(subject)}</h1>${linked}<p style="margin:22px 0 0;font-size:12px;color:#64748b">${escapeHtml(company)} · <a href="${appUrl}" style="color:#6366f1">Open workspace</a></p></div></body></html>`;
}

export type QueueInput = {
  event: string;
  userId?: string | null;
  subject: string;
  body: string;
  recordId?: string | null;
  /** Extra template variables. `recipient` overrides the profile's email. */
  vars?: Record<string, string>;
  /** Idempotency key (email_log.event_key); a repeat is silently dropped. */
  key?: string | null;
};
export type QueueResult =
  | { queued: true; id: string; recipient: string }
  | { queued: false; reason: string };

/**
 * Queues one email with the same rules as private.queue_email: the event must
 * be enabled in Settings → Email, the company email channel must be on, the
 * recipient comes from the profile (or `vars.recipient`), and a per-event
 * template overrides the default subject and body. Intended for server code
 * running inside a service-role transaction (the SQL function itself is not
 * executable by techly_service). Unlike the SQL version, the default subject
 * and body are rendered with the same placeholders, so callers may use
 * {{name}}, {{company}} and friends in them; a custom template then sees the
 * finished text as {{subject}} and {{body}}.
 */
export async function queueEmail(client: PoolClient, input: QueueInput): Promise<QueueResult> {
  const settings = (await client.query("select data from public.email_settings where id=1")).rows[0]?.data as
    | EmailSettings
    | undefined;
  if (!settings) return { queued: false, reason: "Email is not configured" };
  if (settings.events?.[input.event] !== true)
    return { queued: false, reason: `"${input.event}" emails are turned off in Settings → Email` };
  const channels = (await client.query("select data->'notification_channels' as channels from public.settings where id=1"))
    .rows[0]?.channels as { email?: boolean } | null | undefined;
  if (channels && channels.email === false)
    return { queued: false, reason: "The email channel is turned off in Settings → Notifications" };
  let profile: { full_name: string; email: string | null } | undefined;
  if (input.userId) {
    profile = (await client.query("select full_name,email from public.profiles where id=$1 and active", [input.userId]))
      .rows[0];
    if (!profile) return { queued: false, reason: "This user is inactive or no longer exists" };
  }
  const recipient = (input.vars?.recipient || profile?.email || "").trim();
  if (!recipient) return { queued: false, reason: "No email address on file for this user" };
  const vars: Record<string, string> = {
    name: profile?.full_name || "",
    company: settings.company_name || "Techly",
    support: settings.support_contact || "",
    ...input.vars,
    subject: input.subject,
    body: input.body,
  };
  vars.subject = renderTemplate(input.subject, vars);
  vars.body = renderTemplate(input.body, vars);
  const template = settings.templates?.[input.event];
  const subject = template?.subject?.trim() ? renderTemplate(template.subject, vars) : vars.subject;
  const body = template?.body?.trim() ? renderTemplate(template.body, vars) : vars.body;
  const { rows } = await client.query(
    "insert into public.email_log(event,user_id,recipient,subject,body,record_id,event_key) values($1,$2,$3,$4,$5,$6,$7) on conflict(event_key) do nothing returning id",
    [input.event, input.userId || null, recipient, subject, body, input.recordId || null, input.key || null],
  );
  if (!rows[0]) return { queued: false, reason: "This email was already queued" };
  return { queued: true, id: rows[0].id as string, recipient };
}

/** Sends one email through the configured provider. Never throws. */
export async function sendEmail(settings: EmailSettings, job: EmailJob): Promise<SendResult> {
  const provider = settings.provider || "resend";
  const from = settings.sender_email
    ? `${settings.sender_name || "Techly"} <${settings.sender_email}>`
    : "";
  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";
  if (provider === "console") {
    // Development only: nothing leaves the server, so the row is marked skipped, not accepted.
    console.log(JSON.stringify({ event: "email_console", to: job.recipient, subject: job.subject }));
    return { status: "skipped", provider, error: "Console provider: email logged on the server, not delivered" };
  }
  if (!from) return { status: "failed", provider, error: "Verified sender email is not configured" };
  const key = process.env.RESEND_API_KEY;
  if (!key) return { status: "failed", provider, error: "RESEND_API_KEY is not set on the server" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [job.recipient],
        subject: job.subject,
        text: job.body,
        html: renderEmailHtml(job.subject, job.body, settings.company_name || "Techly", appUrl),
        headers: { "X-Entity-Ref-ID": job.id },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (res.ok && data.id) return { status: "accepted", provider, providerId: data.id };
    return { status: "failed", provider, error: `Resend ${res.status}: ${data.message || data.name || "request rejected"}` };
  } catch (e) {
    return { status: "failed", provider, error: e instanceof Error ? e.message : "Provider unreachable" };
  }
}

/** Drains queued emails. Called by the scheduler tick with the service role. */
export async function processEmailQueue(limit = 20) {
  const db = serviceDB();
  const settings = (
    await db.run(async (c) => (await c.query("select data from public.email_settings where id=1")).rows[0]?.data)
  ) as EmailSettings | undefined;
  if (!settings) return { sent: 0, failed: 0, skipped: 0 };
  const jobs = await db.rpc<EmailJob[]>("claim_email_jobs", { p_limit: limit });
  let sent = 0, failed = 0, skipped = 0;
  for (const job of jobs) {
    const result = await sendEmail(settings, job);
    await db.rpc("finish_email_job", {
      p_id: job.id,
      p_status: result.status,
      p_provider: result.provider,
      p_provider_id: result.status === "accepted" ? result.providerId : null,
      p_error: result.status === "accepted" ? null : result.error,
    });
    if (result.status === "accepted") sent++;
    else if (result.status === "skipped") skipped++;
    else failed++;
  }
  return { sent, failed, skipped };
}
