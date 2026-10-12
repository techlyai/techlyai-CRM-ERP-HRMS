"use client";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Users,
  ArrowUpRight,
  ArrowRight,
  FolderKanban,
  IndianRupee,
  Target,
  CalendarDays,
  Clock3,
  Plus,
  CheckCircle2,
  RefreshCw,
  Package,
  FileText,
  AlertCircle,
} from "lucide-react";
import { type Profile, type BusinessRecord, moduleMap } from "@/lib/modules";
import { money } from "@/lib/domain";
import { Status } from "./ui/status";
import { Button } from "./ui/button";
import { OperationsSnapshot } from "./operations-snapshot";
export type Stats = {
  counts: Record<string, number>;
  employees: number;
  active_projects: number;
  attendance: Record<string, number>;
  expenses: number;
  pending: number;
  overdue_tasks: number;
  renewals: number;
  expired: number;
  low_stock: number;
  outstanding: number;
  conversion: number;
  missing_eod: number;
  maintenance_due: number;
  leave_pending: number;
  claims_pending: number;
  reports_pending: number;
  corrections_pending: number;
  questions_pending: number;
  chart: { label: string; amount: number }[];
};
export function Dashboard({
  profile,
  stats,
  recent,
  tasks,
  projects,
  visible,
}: {
  profile: Profile;
  stats: Stats;
  recent: BusinessRecord[];
  tasks: BusinessRecord[];
  projects: BusinessRecord[];
  visible: string[];
}) {
  const admin = profile.role !== "employee";
  const date = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "full",
    timeZone: "Asia/Kolkata",
  }).format(new Date());
  const cards = admin
    ? [
        {
          title: "Active employees",
          value: stats.employees,
          detail: "People in your authorized team",
          icon: Users,
          colour: "violet",
          module: "employees",
        },
        {
          title: "Active projects",
          value: stats.active_projects,
          detail: `${stats.overdue_tasks} overdue tasks to review`,
          icon: FolderKanban,
          colour: "blue",
          module: "projects",
        },
        {
          title: "Monthly expenses",
          value: money(stats.expenses),
          detail: "Approved spending this month",
          icon: IndianRupee,
          colour: "emerald",
          module: "expenses",
        },
        {
          title: "CRM pipeline",
          value: stats.counts.leads || 0,
          detail: `${stats.conversion}% lead conversion`,
          icon: Target,
          colour: "amber",
          module: "leads",
        },
      ]
    : [
        {
          title: "My tasks",
          value: stats.counts.tasks || 0,
          detail: `${stats.overdue_tasks} overdue`,
          icon: FolderKanban,
          colour: "blue",
          module: "tasks",
        },
        {
          title: "My reports",
          value: stats.counts.eod || 0,
          detail: "Your daily progress",
          icon: FileText,
          colour: "violet",
          module: "eod",
        },
        {
          title: "My lead pipeline",
          value: stats.counts.leads || 0,
          detail: "Assigned customer relationships",
          icon: Target,
          colour: "amber",
          module: "leads",
        },
        {
          title: "My leave requests",
          value: stats.counts.leave || 0,
          detail: "View balances and applications",
          icon: CalendarDays,
          colour: "emerald",
          module: "leave",
        },
      ];
  const max = Math.max(...stats.chart.map((x) => Number(x.amount)), 1);
  return (
    <>
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Workspace <span className="mx-1.5 text-muted-foreground/40">/</span>{" "}
            Overview
          </p>
          <h1 className="text-[28px] font-semibold tracking-tight">
            Hello, {profile.full_name.split(" ")[0]}{" "}
            <span className="text-2xl">✦</span>
          </h1>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Here’s what’s happening across your workspace today.
          </p>
        </div>
        <div className="flex items-center gap-3 pt-2">
          <span className="hidden items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground md:flex">
            <CalendarDays size={14} />
            {date}
          </span>
          <Button asChild>
            <Link href="/modules/eod?new=1">
              <Plus size={15} />
              Daily report
            </Link>
          </Button>
        </div>
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards
          .filter((c) => visible.includes(c.module))
          .map((c, i) => {
            const colour: Record<string, string> = {
              violet: "bg-violet-500/10 text-violet-600",
              blue: "bg-blue-500/10 text-blue-600",
              emerald: "bg-emerald-500/10 text-emerald-600",
              amber: "bg-amber-500/10 text-amber-600",
            };
            return (
              <motion.div
                key={c.title}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="panel p-5"
              >
                <div className="flex items-center justify-between">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-lg ${colour[c.colour]}`}
                  >
                    <c.icon size={19} />
                  </div>
                  <Link
                    href={"/modules/" + c.module}
                    aria-label={"Open " + c.title}
                    className="text-muted-foreground"
                  >
                    <ArrowUpRight size={16} />
                  </Link>
                </div>
                <p className="mt-5 text-xs text-muted-foreground">{c.title}</p>
                <p className="mt-1.5 text-[29px] font-semibold tracking-tight">
                  {c.value}
                </p>
                <p className="mt-3 text-[10px] text-muted-foreground">
                  {c.detail}
                </p>
              </motion.div>
            );
          })}
      </div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-violet-500/15 bg-gradient-to-r from-violet-500/10 to-indigo-500/5 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-card text-primary">
            <AlertCircle size={20} />
          </div>
          <div>
            <p className="text-sm font-semibold">
              {stats.pending
                ? `${stats.pending} records need attention`
                : "You’re ready for a productive day"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {admin
                ? `${stats.missing_eod} daily reports missing · ${stats.renewals} renewals coming up · ${stats.low_stock} low-stock items`
                : "Check in, focus on your next task, and share your progress."}
            </p>
          </div>
        </div>
        <Link
          href={admin ? "/modules/eod?status=Submitted" : "/modules/attendance"}
          className="flex items-center gap-2 text-xs font-semibold text-primary"
        >
          {admin ? "Review reports" : "Record attendance"}
          <ArrowRight size={14} />
        </Link>
      </div>
      <OperationsSnapshot stats={stats} visible={visible} />
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          {visible.includes("expenses") && (
            <section className="panel p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="section-title">Expense overview</h2>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Approved spending over the last six months
                  </p>
                </div>
                <span className="rounded-lg bg-muted px-3 py-1.5 text-[10px] text-muted-foreground">
                  INR · Monthly
                </span>
              </div>
              <div className="mt-6 flex items-baseline gap-3">
                <span className="text-2xl font-semibold">
                  {money(stats.expenses)}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  this month
                </span>
              </div>
              <div
                className="mt-5 grid h-40 grid-cols-6 items-end gap-4 border-b border-border px-3 pb-2"
                role="img"
                aria-label={stats.chart
                  .map((x) => `${x.label}: ${money(x.amount)}`)
                  .join(", ")}
              >
                {stats.chart.map((bar, i) => (
                  <div
                    key={bar.label}
                    className="flex h-full flex-col items-center justify-end gap-2"
                  >
                    <div
                      title={money(bar.amount)}
                      className={`w-full max-w-12 rounded-t-md ${i === 5 ? "bg-primary" : "bg-violet-500/15"}`}
                      style={{
                        height: `${Math.max(2, (Number(bar.amount) / max) * 85)}%`,
                      }}
                    />
                    <span className="text-[10px] text-muted-foreground">
                      {bar.label}
                    </span>
                  </div>
                ))}
              </div>
              {stats.chart.every((x) => Number(x.amount) === 0) && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Your chart will grow as approved expenses are recorded.
                </p>
              )}
            </section>
          )}
          <section className="panel">
            <div className="flex items-center justify-between border-b border-border p-5">
              <div>
                <h2 className="section-title">Projects in focus</h2>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Keep delivery moving in the right direction
                </p>
              </div>
              <Link
                href="/modules/projects"
                className="flex items-center gap-1 text-[11px] font-medium text-primary"
              >
                View all
                <ArrowUpRight size={13} />
              </Link>
            </div>
            {!projects.length ? (
              <Empty
                icon={FolderKanban}
                message="No assigned projects yet"
                detail="Create a project and bring your team together."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/40 text-[10px] text-muted-foreground">
                    <tr>
                      <th className="p-4 pl-5 font-medium">Project</th>
                      <th className="p-4 font-medium">Deadline</th>
                      <th className="p-4 font-medium">Status</th>
                      <th className="p-4 font-medium">Priority</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.slice(0, 5).map((p) => (
                      <tr key={p.id} className="border-t border-border">
                        <td className="p-4 pl-5">
                          <Link
                            className="font-medium hover:text-primary"
                            href={"/modules/projects/" + p.id}
                          >
                            {p.title}
                          </Link>
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            {String(p.data.client || "Internal project")}
                          </p>
                        </td>
                        <td className="p-4 text-muted-foreground">
                          {String(p.data.due_date || "—")}
                        </td>
                        <td className="p-4">
                          <Status value={p.status} />
                        </td>
                        <td className="p-4 text-muted-foreground">
                          {String(p.data.priority || "—")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="panel p-5">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="section-title">Recent activity</h2>
              <span className="text-[10px] text-muted-foreground">
                Across authorized records
              </span>
            </div>
            {recent.length ? (
              <div className="space-y-5">
                {recent.map((r) => (
                  <Link
                    href={"/modules/" + r.module + "/" + r.id}
                    key={r.id}
                    className="flex items-start gap-3"
                  >
                    <span className="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-violet-500/10 text-primary">
                      <FileText size={14} />
                    </span>
                    <div className="flex-1">
                      <p className="text-xs font-medium">{r.title}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {moduleMap[r.module]?.singular} · {r.status}
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(r.updated_at).toLocaleDateString("en-IN")}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <Empty
                icon={FileText}
                message="A fresh start"
                detail="Changes to your records will appear here."
              />
            )}
          </section>
        </div>
        <div className="space-y-6">
          <section className="panel p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="section-title">Your next steps</h2>
              <Link href="/modules/tasks" className="text-[11px] text-primary">
                All tasks
              </Link>
            </div>
            {!tasks.length ? (
              <Empty
                icon={CheckCircle2}
                message="All clear for now"
                detail="Your assigned tasks will appear here."
              />
            ) : (
              <div className="space-y-3">
                {tasks.slice(0, 5).map((t) => (
                  <Link
                    key={t.id}
                    href={"/modules/tasks/" + t.id}
                    className="flex gap-3 rounded-lg border border-border p-3"
                  >
                    <span className="mt-0.5 h-4 w-4 rounded border border-border" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium">{t.title}</p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Clock3 size={11} />
                          {String(t.data.due_date || "No deadline")}
                        </span>
                        <Status value={t.status} />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
          <section className="panel p-5">
            <h2 className="section-title">Today’s attendance</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {admin ? "Authorized team overview" : "Your attendance status"}
            </p>
            <div className="my-5 flex items-center justify-center">
              <div className="flex h-32 w-32 flex-col items-center justify-center rounded-full border-[12px] border-violet-500/15">
                <span className="text-3xl font-semibold">
                  {Object.values(stats.attendance).reduce(
                    (a, b) => a + Number(b),
                    0,
                  )}
                </span>
                <span className="mt-1 text-[10px] text-muted-foreground">
                  clocked in
                </span>
              </div>
            </div>
            <div className="space-y-3">
              {["Present", "Late", "Work From Home", "Half-Day"].map((s, i) => (
                <div
                  key={s}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span
                      className={`h-2 w-2 rounded-full ${["bg-primary", "bg-amber-400", "bg-blue-400", "bg-rose-400"][i]}`}
                    />
                    {s}
                  </span>
                  <span className="font-medium">
                    {stats.attendance[s] || 0}
                  </span>
                </div>
              ))}
            </div>
            <Button variant="outline" className="mt-5 w-full" asChild>
              <Link href="/modules/attendance">
                Open attendance
                <ArrowRight size={14} />
              </Link>
            </Button>
          </section>
          <section className="rounded-xl bg-[#211738] p-5 text-white">
            <span className="mb-4 block text-xl text-violet-300">✦</span>
            <h2 className="text-base font-semibold">
              A little clarity goes a long way.
            </h2>
            <p className="mt-2 text-xs leading-6 text-violet-200/70">
              Close the loop on today’s work. Submit your daily report and keep
              your team in sync.
            </p>
            <Link
              href="/modules/eod?new=1"
              className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-violet-200"
            >
              Write your daily report
              <ArrowUpRight size={14} />
            </Link>
          </section>
        </div>
      </div>
      <p className="mt-8 text-center text-[10px] text-muted-foreground/70">
        Techly workspace · Built for the way your team works
      </p>
    </>
  );
}
export function Empty({
  icon: Icon,
  message,
  detail,
}: {
  icon: React.ElementType;
  message: string;
  detail: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <div className="mb-3 rounded-xl bg-muted p-3 text-muted-foreground">
        <Icon size={22} />
      </div>
      <p className="text-sm font-medium">{message}</p>
      <p className="mt-2 max-w-xs text-xs leading-5 text-muted-foreground">
        {detail}
      </p>
    </div>
  );
}
