"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
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
  FileText,
  AlertCircle,
  BellRing,
} from "lucide-react";
import { type Profile, type BusinessRecord, moduleMap } from "@/lib/modules";
import { money } from "@/lib/domain";
import { Status } from "./ui/status";
import { Button } from "./ui/button";
import { OperationsSnapshot } from "./operations-snapshot";
import { LogoMark } from "./logo";
import { priorityClass } from "./notifications";
export type Reminder = {
  id: string;
  title: string;
  description?: string;
  category: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  recurrence: string;
  due_at: string;
  status: string;
  snoozed_until?: string | null;
};
/** Fields refreshed live from /api/dashboard/counts. */
const liveKeys = [
  "reports_pending",
  "leave_pending",
  "claims_pending",
  "corrections_pending",
  "questions_pending",
  "pending",
] as const;
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
  stats: initialStats,
  recent,
  tasks,
  projects,
  visible,
  creatable = [],
  reminders = [],
}: {
  profile: Profile;
  stats: Stats;
  recent: BusinessRecord[];
  tasks: BusinessRecord[];
  projects: BusinessRecord[];
  visible: string[];
  creatable?: string[];
  reminders?: Reminder[];
}) {
  const admin = profile.role !== "employee";
  const reducedMotion = useReducedMotion();
  const [stats, setStats] = useState(initialStats);
  const [remindersUpcoming, setRemindersUpcoming] = useState<number>();
  const [updatedAt, setUpdatedAt] = useState<string>();
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [refreshAttempt, setRefreshAttempt] = useState(0);
  useEffect(() => setStats(initialStats), [initialStats]);
  // Keep pending-review counts current without a reload; paused while the tab is hidden.
  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setInterval> | undefined;
    const refresh = async () => {
      if (stopped || document.hidden || inFlight) return;
      inFlight = true;
      try {
        const res = await fetch("/api/dashboard/counts", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Counts unavailable");
        const live = (await res.json()) as Record<string, number | string>;
        if (stopped) return;
        setStats((current) => {
          const next = { ...current };
          for (const key of liveKeys) {
            const value = Number(live[key]);
            if (Number.isFinite(value)) next[key] = value;
          }
          return next;
        });
        if (Number.isFinite(Number(live.reminders_upcoming)))
          setRemindersUpcoming(Number(live.reminders_upcoming));
        setUpdatedAt(
          new Date().toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        );
        setRefreshFailed(false);
      } catch {
        if (!stopped) setRefreshFailed(true);
      } finally {
        inFlight = false;
      }
    };
    const start = () => {
      if (timer) clearInterval(timer);
      timer = setInterval(refresh, 15000);
    };
    const onVisibility = () => {
      if (document.hidden) {
        if (timer) clearInterval(timer);
        timer = undefined;
      } else {
        refresh();
        start();
      }
    };
    refresh();
    start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", refresh);
    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", refresh);
    };
  }, [refreshAttempt]);
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
  const attention = [
    {
      module: "eod",
      count: stats.reports_pending,
      label: "daily reports awaiting review",
      href: "/modules/eod",
      action: "View daily reports",
    },
    {
      module: "leave",
      count: stats.leave_pending,
      label: "leave requests awaiting review",
      href: "/modules/leave",
      action: "View leave requests",
    },
    {
      module: "expenses",
      count: stats.claims_pending,
      label: "expense claims awaiting review",
      href: "/modules/expenses",
      action: "View expenses",
    },
    {
      module: "tasks",
      count: stats.overdue_tasks,
      label: "overdue tasks",
      href: "/modules/tasks",
      action: "Open tasks",
    },
    {
      module: "renewals",
      count: stats.renewals,
      label: "upcoming renewals",
      href: "/modules/renewals",
      action: "Review renewals",
    },
  ].filter((item) => visible.includes(item.module) && item.count > 0);
  const nextAction = attention[0];
  const quickActions = [
    ...(visible.includes("attendance")
      ? [
          {
            href: "/modules/attendance",
            title: "Record attendance",
            detail: "Clock in or check today’s status",
            icon: Clock3,
          },
        ]
      : []),
    ...(creatable.includes("eod")
      ? [
          {
            href: "/modules/eod?new=1",
            title: "Write a daily report",
            detail: "Share progress and blockers",
            icon: FileText,
          },
        ]
      : []),
    ...(visible.includes("tasks")
      ? [
          {
            href: "/modules/tasks",
            title: "Open your tasks",
            detail: "See deadlines and next steps",
            icon: CheckCircle2,
          },
        ]
      : []),
    {
      href: "/reminders?new=1",
      title: "Set a reminder",
      detail: "Keep a follow-up from slipping",
      icon: BellRing,
    },
  ];
  return (
    <>
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Workspace <span className="mx-1.5 text-muted-foreground/40">/</span>{" "}
            Overview
          </p>
          <h1 className="text-[28px] font-semibold tracking-tight">
            Hello, {profile.full_name.split(" ")[0]}
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
          {creatable.includes("eod") && (
            <Button asChild>
              <Link href="/modules/eod?new=1">
                <Plus size={15} />
                Daily report
              </Link>
            </Button>
          )}
        </div>
      </div>
      <section
        aria-label="Quick actions"
        className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        {quickActions.map(({ href, title, detail, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="panel group flex items-start gap-3 p-4 transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            <span className="icon-tile h-10 w-10 shrink-0">
              <Icon size={18} />
            </span>
            <div>
              <p className="text-sm font-semibold group-hover:text-primary">
                {title}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {detail}
              </p>
            </div>
          </Link>
        ))}
      </section>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards
          .filter((c) => visible.includes(c.module))
          .map((c, i) => {
            const colour: Record<string, string> = {
              violet: "bg-primary/10 text-primary",
              blue: "bg-accent/10 text-accent",
              emerald: "bg-success/10 text-success",
              amber: "bg-warning/10 text-warning",
            };
            return (
              <motion.div
                key={c.title}
                initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: reducedMotion ? 0 : i * 0.04,
                  duration: reducedMotion ? 0 : 0.2,
                }}
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
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-primary/15 bg-gradient-to-r from-primary/10 to-accent/5 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-card text-primary">
            <AlertCircle size={20} />
          </div>
          <div>
            <p className="text-sm font-semibold">
              {nextAction
                ? `${nextAction.count} ${nextAction.label}`
                : "Your workspace at a glance"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {nextAction
                ? "Start here, then check the summaries below for other work that needs attention."
                : "Use a quick action above to get started, or choose a page from the menu."}
              {updatedAt && !refreshFailed && (
                <span
                  className="ml-2 text-[10px] text-muted-foreground/70"
                  title="Counts refresh every 15 seconds"
                >
                  Review counts updated {updatedAt}
                </span>
              )}
            </p>
          </div>
        </div>
        {nextAction && (
          <Link
            href={nextAction.href}
            className="flex items-center gap-2 text-xs font-semibold text-primary"
          >
            {nextAction.action}
            <ArrowRight size={14} />
          </Link>
        )}
      </div>
      {refreshFailed && (
        <div
          role="status"
          className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm"
        >
          <p>
            Live updates are unavailable. The last loaded figures are still
            shown.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefreshAttempt((n) => n + 1)}
          >
            <RefreshCw size={14} />
            Retry updates
          </Button>
        </div>
      )}
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
                      className={`w-full max-w-12 rounded-t-md ${i === 5 ? "bg-primary" : "bg-primary/15"}`}
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
          {visible.includes("projects") && (
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
                  detail={
                    creatable.includes("projects")
                      ? "Open Projects to create your first project and add the team."
                      : "Projects shared with you will appear here."
                  }
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
          )}
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
                    <span className="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
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
              <div>
                <h2 className="section-title">Upcoming reminders</h2>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {remindersUpcoming === undefined
                    ? "Your next due reminders"
                    : `${remindersUpcoming} due within 7 days`}
                </p>
              </div>
              <Link href="/reminders" className="text-[11px] text-primary">
                All reminders
              </Link>
            </div>
            {!reminders.length ? (
              <Empty
                icon={BellRing}
                message="No pending reminders"
                detail="Create a reminder and Orbit will alert you on time."
              />
            ) : (
              <div className="space-y-3">
                {reminders.slice(0, 5).map((r) => {
                  const due = new Date(r.due_at);
                  const overdue = due.getTime() < Date.now();
                  return (
                    <Link
                      key={r.id}
                      href={"/reminders?id=" + r.id}
                      className="flex gap-3 rounded-lg border border-border p-3 transition-colors hover:border-primary/30"
                    >
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                          overdue
                            ? "bg-danger"
                            : r.priority === "Urgent"
                              ? "bg-danger"
                              : r.priority === "High"
                                ? "bg-warning"
                                : "bg-primary"
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">
                          {r.title}
                        </p>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Clock3 size={11} />
                            {overdue ? "Overdue · " : ""}
                            {due.toLocaleString("en-IN", {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                            {r.recurrence !== "none"
                              ? ` · ${r.recurrence}`
                              : ""}
                          </span>
                          {overdue ? (
                            <Status value="Overdue" />
                          ) : (
                            <span
                              className={`inline-flex items-center rounded-md px-2 py-1 text-[11px] font-medium ${priorityClass(r.priority)}`}
                            >
                              {r.priority}
                            </span>
                          )}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
          {visible.includes("tasks") && (
            <section className="panel p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="section-title">Your next steps</h2>
                <Link
                  href="/modules/tasks"
                  className="text-[11px] text-primary"
                >
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
          )}
          {visible.includes("attendance") && (
            <section className="panel p-5">
              <h2 className="section-title">Today’s attendance</h2>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {admin ? "Authorized team overview" : "Your attendance status"}
              </p>
              <div className="my-5 flex items-center justify-center">
                <div className="flex h-32 w-32 flex-col items-center justify-center rounded-full border-[12px] border-primary/15">
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
                {["Present", "Late", "Work From Home", "Half-Day"].map(
                  (s, i) => (
                    <div
                      key={s}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <span
                          className={`h-2 w-2 rounded-full ${["bg-primary", "bg-warning", "bg-accent", "bg-danger"][i]}`}
                        />
                        {s}
                      </span>
                      <span className="font-medium">
                        {stats.attendance[s] || 0}
                      </span>
                    </div>
                  ),
                )}
              </div>
              <Button variant="outline" className="mt-5 w-full" asChild>
                <Link href="/modules/attendance">
                  Open attendance
                  <ArrowRight size={14} />
                </Link>
              </Button>
            </section>
          )}
          {creatable.includes("eod") && (
            <section className="rounded-xl bg-navy p-5 text-navy-foreground">
              <LogoMark size={16} tone="dark" className="mb-4" />
              <h2 className="text-base font-semibold">
                A little clarity goes a long way.
              </h2>
              <p className="mt-2 text-xs leading-6 text-navy-foreground/70">
                Close the loop on today’s work. Submit your daily report and
                keep your team in sync.
              </p>
              <Link
                href="/modules/eod?new=1"
                className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-navy-foreground"
              >
                Write your daily report
                <ArrowUpRight size={14} />
              </Link>
            </section>
          )}
        </div>
      </div>
      <p className="mt-8 text-center text-[10px] text-muted-foreground/70">
        Orbit · A Techly project
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
