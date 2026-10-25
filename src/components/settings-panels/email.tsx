"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mail, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveEmailSettings } from "@/lib/admin-actions";
import type { EmailSettings } from "@/lib/email";

export type EmailLogRow = {
  id: string;
  event: string;
  recipient: string;
  subject: string;
  status: string;
  provider: string | null;
  provider_id: string | null;
  error: string | null;
  attempts: number;
  sent_at: string | null;
  created_at: string;
  next_attempt_at: string;
};

// Keep these keys aligned with saveEmailSettings's server schema.
const events = [
  ["welcome", "Welcome messages", "Account invitations and getting started."],
  ["employee_id", "Employee IDs", "Employee ID assignment updates."],
  ["reminders", "Reminders", "Scheduled reminders and follow-ups."],
  ["eod", "Daily reports", "Daily report submissions and updates."],
  ["questions", "Questions", "Questions and replies about work records."],
  ["approvals", "Approvals", "Review requests and approval decisions."],
  ["renewals", "Renewals", "Subscription and contract renewal alerts."],
  ["payments", "Payments", "Payment and outstanding balance updates."],
  ["tasks", "Tasks", "Task assignments and progress updates."],
  ["chat", "Chat", "Team conversation notifications."],
  ["field", "Field operations", "Field sessions, GPS photo checks and field reports. Never includes coordinates."],
] as const;
const statusLabels: Record<string, string> = {
  queued: "Queued",
  accepted: "Accepted by provider",
  failed: "Failed",
  skipped: "Not sent",
};
const statusColors: Record<string, string> = {
  queued: "bg-warning/10 text-warning",
  accepted: "bg-success/10 text-success",
  failed: "bg-danger/10 text-danger",
  skipped: "bg-muted text-muted-foreground",
};
const dateLabel = (value: string) =>
  new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });

export function EmailSettingsPanel({
  settings,
  log,
}: {
  settings: EmailSettings;
  log: EmailLogRow[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<EmailSettings>(() => ({
    ...settings,
    events: Object.fromEntries(
      events.map(([key]) => [key, Boolean(settings.events?.[key])]),
    ),
    templates: { ...settings.templates },
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [status, setStatus] = useState("");
  const lock = useRef(false);
  const change = (patch: Partial<EmailSettings>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setSaved(false);
    setError("");
  };
  const filteredLog = log.filter((row) => !status || row.status === status);
  const refresh = () => startTransition(() => router.refresh());

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const result = await saveEmailSettings(draft);
      if (!result.ok)
        throw Error(result.error || "Email settings could not be saved.");
      setSaved(true);
      refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Email settings could not be saved. Try again.",
      );
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="max-w-5xl space-y-6">
      <form
        onSubmit={save}
        className="panel space-y-5 p-4 sm:p-6"
        aria-busy={saving}
      >
        <div>
          <h2 className="section-title flex items-center gap-2">
            <Mail size={18} />
            Outgoing email
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Choose your sender and which workspace events generate email.
            Recipients need an email address on their profile, and the company
            email channel must be enabled.
          </p>
        </div>
        <fieldset disabled={saving} className="min-w-0 space-y-5">
          <legend className="sr-only">Email sender and event settings</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="email-provider">Delivery provider</label>
              <select
                id="email-provider"
                value={draft.provider}
                onChange={(event) =>
                  change({
                    provider: event.target.value as EmailSettings["provider"],
                  })
                }
                aria-describedby="email-provider-help"
              >
                <option value="resend">Resend — send email</option>
                <option value="console">Console — record only</option>
              </select>
              <p
                id="email-provider-help"
                className="mt-2 text-xs leading-5 text-muted-foreground"
              >
                {draft.provider === "resend"
                  ? "Use a sender verified with Resend. Your administrator must configure RESEND_API_KEY on the server."
                  : "Console mode records messages on the server without sending them. The log shows these as Not sent."}
              </p>
            </div>
            <div>
              <label htmlFor="email-company">Company name *</label>
              <input
                id="email-company"
                value={draft.company_name}
                onChange={(event) =>
                  change({ company_name: event.target.value })
                }
                required
                maxLength={100}
              />
            </div>
            <div>
              <label htmlFor="email-sender-name">Sender name</label>
              <input
                id="email-sender-name"
                value={draft.sender_name}
                onChange={(event) =>
                  change({ sender_name: event.target.value })
                }
                maxLength={100}
                placeholder="Your company name"
              />
            </div>
            <div>
              <label htmlFor="email-sender-address">Sender email</label>
              <input
                id="email-sender-address"
                type="email"
                value={draft.sender_email}
                onChange={(event) =>
                  change({ sender_email: event.target.value })
                }
                maxLength={254}
                placeholder="notifications@yourcompany.com"
                aria-describedby="email-sender-help"
              />
              <p
                id="email-sender-help"
                className="mt-2 text-xs leading-5 text-muted-foreground"
              >
                {draft.provider === "resend" && !draft.sender_email.trim()
                  ? "Add a verified sender address before emails can be sent through Resend."
                  : "Recipients see this address as the sender."}
              </p>
            </div>
            <div>
              <label htmlFor="email-support">
                Support contact{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </label>
              <input
                id="email-support"
                value={draft.support_contact}
                onChange={(event) =>
                  change({ support_contact: event.target.value })
                }
                maxLength={200}
                placeholder="Support email or phone number"
              />
            </div>
            <div>
              <label htmlFor="email-retries">Maximum delivery attempts</label>
              <input
                id="email-retries"
                type="number"
                min={1}
                max={20}
                step={1}
                required
                value={
                  Number.isFinite(draft.retry_limit) ? draft.retry_limit : ""
                }
                onChange={(event) =>
                  change({ retry_limit: event.target.valueAsNumber })
                }
                aria-describedby="email-retries-help"
              />
              <p
                id="email-retries-help"
                className="mt-2 text-xs leading-5 text-muted-foreground"
              >
                1–20 attempts, including the first attempt. Failed messages
                retry automatically until this limit.
              </p>
            </div>
          </div>
          <section aria-labelledby="email-events-title">
            <h3 id="email-events-title" className="text-sm font-semibold">
              Email events
            </h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Turning an event off stops new emails for that event. Messages
              already queued remain in the delivery log.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {events.map(([key, label, description]) => (
                <label
                  key={key}
                  className="mb-0 flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 font-normal"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 shrink-0"
                    checked={draft.events[key]}
                    onChange={(event) =>
                      change({
                        events: {
                          ...draft.events,
                          [key]: event.target.checked,
                        },
                      })
                    }
                  />
                  <span>
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      {description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </section>
        </fieldset>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {saved && (
          <p role="status" className="text-sm text-success">
            Email settings saved.
          </p>
        )}
        <div className="flex justify-end border-t border-border pt-4">
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? "Saving…" : "Save email settings"}
          </Button>
        </div>
      </form>
      <section
        className="panel overflow-hidden"
        aria-labelledby="email-log-title"
        aria-busy={refreshing}
      >
        <div className="border-b border-border p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="email-log-title" className="section-title">
                Email delivery log
              </h2>
              <p className="mt-2 max-w-2xl text-xs leading-5 text-muted-foreground">
                The latest 100 emails, newest first. Accepted by provider means
                the provider received the email; it does not confirm inbox
                delivery.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={refreshing}
              onClick={refresh}
            >
              <RefreshCw
                size={14}
                className={refreshing ? "animate-spin" : ""}
              />
              {refreshing ? "Refreshing…" : "Refresh log"}
            </Button>
          </div>
          <div className="mt-4 max-w-xs">
            <label htmlFor="email-log-status">Delivery status</label>
            <select
              id="email-log-status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">All statuses</option>
              {Object.entries(statusLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {filteredLog.length ? (
          <ul className="divide-y divide-border">
            {filteredLog.map((row) => (
              <li key={row.id} className="p-4 sm:px-6">
                <details>
                  <summary className="cursor-pointer text-sm">
                    <span className="ml-1 break-words font-medium">
                      {row.subject || "No subject"}
                    </span>
                    <span
                      className={`ml-2 inline-flex rounded-md px-2 py-1 text-[11px] font-medium ${statusColors[row.status] || statusColors.skipped}`}
                    >
                      {statusLabels[row.status] || row.status}
                    </span>
                    <span className="mt-2 block break-all text-xs text-muted-foreground">
                      To {row.recipient} · {dateLabel(row.created_at)}
                    </span>
                  </summary>
                  <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
                    <div>
                      <dt className="text-muted-foreground">Event</dt>
                      <dd className="mt-1">
                        {events.find(([key]) => key === row.event)?.[1] ||
                          row.event}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">
                        Delivery attempts
                      </dt>
                      <dd className="mt-1">{row.attempts}</dd>
                    </div>
                    {row.provider && (
                      <div>
                        <dt className="text-muted-foreground">Provider</dt>
                        <dd className="mt-1 capitalize">{row.provider}</dd>
                      </div>
                    )}
                    {row.sent_at && (
                      <div>
                        <dt className="text-muted-foreground">Accepted at</dt>
                        <dd className="mt-1">{dateLabel(row.sent_at)}</dd>
                      </div>
                    )}
                    {row.status === "queued" && (
                      <div>
                        <dt className="text-muted-foreground">
                          Eligible for next attempt
                        </dt>
                        <dd className="mt-1">
                          {dateLabel(row.next_attempt_at)}
                        </dd>
                      </div>
                    )}
                    {row.provider_id && (
                      <div>
                        <dt className="text-muted-foreground">
                          Provider reference
                        </dt>
                        <dd className="mt-1 break-all">{row.provider_id}</dd>
                      </div>
                    )}
                  </dl>
                  {row.error && (
                    <p
                      className={`mt-3 break-words rounded-lg p-3 text-xs leading-5 ${row.status === "failed" ? "bg-danger/5 text-danger" : "bg-muted text-muted-foreground"}`}
                    >
                      {row.error}
                    </p>
                  )}
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-5 py-10 text-center">
            <Mail size={26} className="mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm font-medium">
              {log.length
                ? "No emails with this status"
                : "No email activity yet"}
            </p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {log.length
                ? "Choose another delivery status to see more emails."
                : "Emails queued by workspace events will appear here."}
            </p>
            {status && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => setStatus("")}
              >
                Show all statuses
              </Button>
            )}
          </div>
        )}
        <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          Showing {filteredLog.length} of {log.length} recent emails.
        </p>
      </section>
    </div>
  );
}
