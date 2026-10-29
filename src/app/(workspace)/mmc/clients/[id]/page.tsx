import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileDown, Globe, Mail, MessageCircle, Phone } from "lucide-react";
import { context } from "@/lib/database";
import { clientDetail, mmcAbilities, mmcSettings, pendingClaims } from "@/lib/mmc-data";
import { ClaimList } from "@/components/mmc/claims";
import { CopyText } from "@/components/mmc/copy-text";
import { rupees } from "@/lib/mmc";
import { ClientFormButton } from "@/components/mmc/client-form";
import { DueBadge, PayButton, RemindButton, SiteToggle } from "@/components/mmc/controls";
import { DeleteClientButton, MessageTable, SiteKeyPanel } from "@/components/mmc/client-detail";
export const dynamic = "force-dynamic";

const day = (d: string) => new Date(d.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const month = (d: string) => new Date(d.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

export default async function MmcClientPage({ params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const { db, profile } = await context();
  const [a, detail, settings, claims] = await Promise.all([mmcAbilities(db, profile), clientDetail(db, params.id), mmcSettings(db), pendingClaims(db, params.id)]);
  if (!detail) notFound();
  const { client: c, dues, payments, logs, messages } = detail;
  const base = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
  return (
    <div className="space-y-6">
      <Link href="/mmc/clients" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft size={14} /> All clients
      </Link>
      <section className="panel p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">{c.name}</h2>
              <DueBadge status={c.status} />
              {c.days_overdue > 0 && <span className="text-xs text-danger">{c.days_overdue} days overdue</span>}
            </div>
            {c.business_name && <p className="text-sm text-muted-foreground">{c.business_name}</p>}
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Phone size={13} /> {c.phone}</span>
              {c.whatsapp && <span className="inline-flex items-center gap-1"><MessageCircle size={13} /> {c.whatsapp}</span>}
              {c.email && <span className="inline-flex items-center gap-1"><Mail size={13} /> {c.email}</span>}
              {c.website_url && (
                <a href={c.website_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-primary"><Globe size={13} /> {c.website_url}</a>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="text-[11px] text-muted-foreground">Website</span>
            <SiteToggle client={c.id} name={c.name} active={c.site_active} disabled={!a.manage} />
            {!c.site_active && c.suspend_reason && <span className="max-w-[220px] text-right text-[11px] text-muted-foreground">{c.suspend_reason}</span>}
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          {[
            ["MMC", rupees(c.mmc_amount) + " / month"],
            ["Billing", `Day ${c.billing_day} · ${c.grace_days} days grace`],
            ["Outstanding", rupees(c.owed)],
            ["Advance credit", rupees(c.credit)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-border p-3">
              <div className="text-[11px] text-muted-foreground">{k}</div>
              <div className="mt-1 text-sm font-semibold">{v}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {a.manage && <PayButton client={c.id} name={c.name} owed={c.owed} amount={c.mmc_amount} size="default" />}
          {a.manage && <RemindButton client={c.id} size="default" enabled={Object.entries(settings?.templates || {}).filter(([, t]) => t.enabled).map(([k]) => k)} />}
          {a.manage && <ClientFormButton client={c} />}
          {a.delete && <DeleteClientButton client={c.id} name={c.name} />}
          <span className="ml-auto text-[11px] text-muted-foreground">
            Auto-suspend {c.auto_suspend ? "on" : "off"} · Messages via {c.channel === "both" ? "WhatsApp + SMS" : c.channel === "none" ? "none" : c.channel === "sms" ? "SMS" : "WhatsApp"} · Since {day(c.start_date)}
            {c.next_due && <> · Next due {day(c.next_due)}</>}
          </span>
        </div>
        {c.notes && <p className="mt-4 whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-xs">{c.notes}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-xs">
          <span className="font-medium">UPI payment link</span>
          <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{base}/pay/{c.pay_token}</span>
          <CopyText text={`${base}/pay/${c.pay_token}`} label="Copy link" />
          <a href={`/pay/${c.pay_token}`} target="_blank" rel="noreferrer" className="text-primary">Open</a>
        </div>
      </section>
      <ClaimList claims={claims} manage={a.manage} />

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="panel">
          <h2 className="section-title p-4">Monthly dues</h2>
          {dues.length === 0 ? (
            <p className="px-4 pb-6 text-sm text-muted-foreground">No dues yet. The first one is created on the billing day.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>{["Month", "Due date", "Amount", "Paid", "Status"].map((h) => <th key={h} className="p-3 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {dues.map((d) => (
                    <tr key={d.id} className="border-t border-border">
                      <td className="p-3">{month(d.period)}</td>
                      <td className="p-3">{day(d.due_date)}</td>
                      <td className="p-3">{rupees(d.amount)}</td>
                      <td className="p-3">{rupees(d.paid_amount)}</td>
                      <td className="p-3"><DueBadge status={d.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="panel">
          <h2 className="section-title p-4">Payment history</h2>
          {payments.length === 0 ? (
            <p className="px-4 pb-6 text-sm text-muted-foreground">No payments recorded.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>{["Receipt", "Date", "Amount", "Mode", "Applied to", ""].map((h) => <th key={h} className="p-3 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-t border-border align-top">
                      <td className="p-3 font-mono">MMC-{String(p.receipt_no).padStart(5, "0")}</td>
                      <td className="p-3">{day(p.paid_on)}</td>
                      <td className="p-3 font-semibold">{rupees(p.amount)}</td>
                      <td className="p-3">{p.mode}{p.reference && <div className="text-[11px] text-muted-foreground">{p.reference}</div>}</td>
                      <td className="p-3 text-[11px]">{p.periods || <span className="text-success">Advance</span>}</td>
                      <td className="p-3 text-right">
                        <a className="inline-flex items-center gap-1 text-primary" href={`/api/mmc/receipt/${p.receipt_token}`} target="_blank" rel="noreferrer">
                          <FileDown size={13} /> PDF
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <SiteKeyPanel
        client={c.id}
        prefix={c.key_prefix}
        createdAt={c.key_created_at}
        lastChecked={c.last_checked_at}
        lastOrigin={c.last_check_origin}
        manage={a.manage}
        snippet={{
          endpoint: base + "/api/site-status",
          title: settings.suspended_title,
          message: settings.suspended_message,
          contact: settings.contact,
        }}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="panel">
          <h2 className="section-title p-4">Site ON/OFF log</h2>
          {logs.length === 0 ? (
            <p className="px-4 pb-6 text-sm text-muted-foreground">No changes yet.</p>
          ) : (
            <ul className="divide-y divide-border text-xs">
              {logs.map((l) => (
                <li key={l.id} className="flex gap-3 p-3">
                  <span className={`mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold ${l.new_state ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>{l.new_state ? "ON" : "OFF"}</span>
                  <div className="flex-1">
                    <div>
                      {l.source === "auto" ? "Auto (system)" : l.actor_name || "Admin"}
                      {l.reason && <span className="text-muted-foreground"> · {l.reason}</span>}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{new Date(l.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel">
          <h2 className="section-title p-4">Messages to client</h2>
          <MessageTable messages={messages} manage={a.manage} />
        </section>
      </div>
    </div>
  );
}
