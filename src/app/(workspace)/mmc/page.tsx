import Link from "next/link";
import { AlertTriangle, CalendarClock, Globe, IndianRupee, PowerOff, Users } from "lucide-react";
import { context } from "@/lib/database";
import { dashboardData, listClients, mmcAbilities, mmcSettings, pendingClaims } from "@/lib/mmc-data";
import { ClaimList } from "@/components/mmc/claims";
import { daysBetween, rupees } from "@/lib/mmc";
import { localDate } from "@/lib/domain";
import { DueBadge, PayButton, RemindButton, SiteToggle } from "@/components/mmc/controls";
export const metadata = { title: "MMC dashboard" };
export const dynamic = "force-dynamic";

export default async function MmcDashboard() {
  const { db, profile } = await context();
  const [a, clients, d, claims, settings] = await Promise.all([mmcAbilities(db, profile), listClients(db), dashboardData(db), pendingClaims(db), mmcSettings(db)]);
  const enabled = Object.entries(settings?.templates || {}).filter(([, t]) => t.enabled).map(([k]) => k);
  const today = localDate();
  const overdue = clients.filter((c) => c.status === "Overdue").sort((x, y) => y.days_overdue - x.days_overdue);
  const upcoming = clients
    .filter((c) => c.next_due && daysBetween(today, c.next_due) <= 7 && c.status !== "Overdue")
    .sort((x, y) => (x.next_due || "").localeCompare(y.next_due || ""));
  const expected = Math.max(Number(d.month.expected), Number(d.expectedFull));
  const cards = [
    { title: "Total clients", value: String(clients.length), icon: Users, href: "/mmc/clients" },
    { title: "Active sites", value: String(clients.filter((c) => c.site_active).length), icon: Globe, href: "/mmc/clients?filter=Active" },
    { title: "Suspended sites", value: String(clients.filter((c) => !c.site_active).length), icon: PowerOff, href: "/mmc/clients?filter=Suspended" },
    { title: "Overdue clients", value: String(overdue.length), icon: AlertTriangle, href: "/mmc/clients?filter=Overdue" },
  ];
  const max = Math.max(1, ...d.chart.map((c) => c.amount));
  return (
    <div className="space-y-6">
      <ClaimList claims={claims} manage={a.manage} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.title} href={c.href} className="panel flex items-center gap-4 p-5 transition-colors hover:border-primary/40">
            <div className="icon-tile h-10 w-10"><c.icon size={18} /></div>
            <div>
              <div className="text-2xl font-semibold">{c.value}</div>
              <div className="text-xs text-muted-foreground">{c.title}</div>
            </div>
          </Link>
        ))}
      </div>

      <section className="panel p-5">
        <h2 className="section-title">This month</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          {[
            ["Expected", rupees(expected), "text-foreground"],
            ["Collected (this month's dues)", rupees(d.month.collected), "text-success"],
            ["Pending", rupees(Math.max(0, expected - Number(d.month.collected))), "text-warning"],
            ["Received this month (all payments)", rupees(d.received), "text-primary"],
          ].map(([k, v, cls]) => (
            <div key={k} className="rounded-lg border border-border p-4">
              <div className="text-[11px] text-muted-foreground">{k}</div>
              <div className={`mt-1 text-xl font-semibold ${cls}`}>{v}</div>
            </div>
          ))}
        </div>
        {expected > 0 && (
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted" aria-label="Collected share">
            <div className="h-full rounded-full bg-success" style={{ width: `${Math.min(100, (Number(d.month.collected) / expected) * 100)}%` }} />
          </div>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <section className="panel">
          <h2 className="section-title flex items-center gap-2 p-4"><AlertTriangle size={16} className="text-danger" /> Overdue clients</h2>
          {overdue.length === 0 ? (
            <p className="px-4 pb-6 text-sm text-muted-foreground">No overdue clients. 🎉</p>
          ) : (
            <ul className="divide-y divide-border">
              {overdue.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-[160px] flex-1">
                    <Link href={`/mmc/clients/${c.id}`} className="text-sm font-semibold hover:text-primary">{c.name}</Link>
                    <div className="text-[11px] text-danger">{c.days_overdue} days overdue · {rupees(c.owed)}</div>
                  </div>
                  {a.manage && <PayButton client={c.id} name={c.name} owed={c.owed} amount={c.mmc_amount} />}
                  {a.manage && <RemindButton client={c.id} enabled={enabled} />}
                  <SiteToggle client={c.id} name={c.name} active={c.site_active} disabled={!a.manage} />
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel">
          <h2 className="section-title flex items-center gap-2 p-4"><CalendarClock size={16} className="text-primary" /> Due in the next 7 days</h2>
          {upcoming.length === 0 ? (
            <p className="px-4 pb-6 text-sm text-muted-foreground">Nothing due this week.</p>
          ) : (
            <ul className="divide-y divide-border text-xs">
              {upcoming.map((c) => (
                <li key={c.id} className="flex items-center gap-3 p-4">
                  <div className="flex-1">
                    <Link href={`/mmc/clients/${c.id}`} className="text-sm font-semibold hover:text-primary">{c.name}</Link>
                    <div className="text-[11px] text-muted-foreground">
                      {c.next_due === today ? "Due today" : `Due in ${daysBetween(today, c.next_due!)} days`} · {rupees(c.mmc_amount)}
                    </div>
                  </div>
                  <DueBadge status={c.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="panel p-5">
        <h2 className="section-title flex items-center gap-2"><IndianRupee size={16} /> Monthly revenue (payments received)</h2>
        <div className="mt-6 flex h-48 items-end gap-2" role="img" aria-label="Payments received per month for the last 12 months">
          {d.chart.map((m) => (
            <div key={m.month} className="flex flex-1 flex-col items-center gap-2">
              <span className="text-[10px] text-muted-foreground">{m.amount ? rupees(m.amount).replace("₹", "") : ""}</span>
              <div className="w-full rounded-t-md bg-primary/80" style={{ height: `${Math.max(2, (m.amount / max) * 140)}px` }} title={`${m.label}: ${rupees(m.amount)}`} />
              <span className="text-[10px] text-muted-foreground">{m.label}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
