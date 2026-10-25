"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  BellRing,
  Check,
  CheckCheck,
  ArrowUpRight,
  MessageSquare,
  FileText,
  Loader2,
  Volume2,
  Settings2,
  Inbox,
} from "lucide-react";
import { markRead } from "@/lib/actions";
import {
  reconcileNotificationHead,
  readNotificationsInBatches,
  refreshUnreadCount,
} from "@/lib/notification-state";
import { Button } from "./ui/button";
import {
  notificationCategories,
  type Notification,
  type Preferences,
} from "@/lib/notification-types";
export type { Notification, Preferences } from "@/lib/notification-types";

// ---------------------------------------------------------------------------
// Shared helpers (also used by the header notification centre)
// ---------------------------------------------------------------------------
const categoryIndex = new Map(notificationCategories.map((c) => [c.key, c]));
export const categoryLabel = (key: string) =>
  categoryIndex.get(key)?.label || key.replace(/-/g, " ");
export const categoryGroup = (key: string) =>
  categoryIndex.get(key)?.group || "Other";
export const notificationGroups = Array.from(
  new Set(notificationCategories.map((c) => c.group)),
);
export function priorityClass(p: Notification["priority"] | undefined) {
  switch (p) {
    case "Urgent":
      return "bg-danger/10 text-danger";
    case "High":
      return "bg-warning/10 text-warning";
    case "Low":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-primary/10 text-primary";
  }
}
export function priorityDot(p: Notification["priority"] | undefined) {
  switch (p) {
    case "Urgent":
      return "bg-danger";
    case "High":
      return "bg-warning";
    case "Low":
      return "bg-muted-foreground/40";
    default:
      return "bg-primary";
  }
}
export function relativeTime(iso: string, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return d + "d ago";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}
export function notificationLink(
  n: Notification,
  recordModules?: Record<string, string>,
) {
  if (n.link && n.link.startsWith("/")) return n.link;
  const module = n.record_id ? recordModules?.[n.record_id] : undefined;
  if (n.record_id && module) return `/modules/${module}/${n.record_id}`;
  return "/notifications";
}
export function linkLabel(n: Notification, href: string) {
  const module = typeof n.meta?.module === "string" ? n.meta.module : "";
  if (n.category === "chat" || href.startsWith("/chat"))
    return "Open conversation";
  if (n.category.startsWith("reminder") || href.startsWith("/reminders"))
    return "Open reminder";
  if (
    n.category === "eod" ||
    module === "eod" ||
    href.includes("/modules/eod/")
  )
    return "Open report";
  if (href.startsWith("/modules/")) return "Open record";
  return "View";
}
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
/** Employee, sender or record name carried in meta. */
export function metaName(n: Notification) {
  const meta = n.meta || {};
  const employee = str(meta.employee);
  const project = str(meta.project);
  const sender = str(meta.sender);
  if (employee && project) return `${employee} · ${project}`;
  if (employee) return employee;
  if (sender) return sender;
  if (project) return project;
  return "";
}
/** Secondary detail line: due time for reminders, submission time for reports. */
export function metaDetail(n: Notification) {
  const meta = n.meta || {};
  if (n.category.startsWith("reminder") && str(meta.due_at)) {
    const due = new Date(String(meta.due_at));
    if (!Number.isNaN(due.getTime()))
      return (
        (meta.overdue ? "Overdue since " : "Due ") +
        due.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
      );
  }
  if (n.category === "eod" && str(meta.submitted_at)) {
    const at = new Date(String(meta.submitted_at));
    if (!Number.isNaN(at.getTime()))
      return (
        "Submitted " +
        at.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
      );
  }
  return "";
}
export function CategoryIcon({
  category,
  size = 16,
}: {
  category: string;
  size?: number;
}) {
  if (category === "chat") return <MessageSquare size={size} />;
  if (category.startsWith("reminder")) return <BellRing size={size} />;
  if (["eod", "questions", "approvals"].includes(category))
    return <FileText size={size} />;
  return <Bell size={size} />;
}
export function dayLabel(iso: string, now = new Date()) {
  const d = new Date(iso);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return "Yesterday";
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 6);
  if (d >= weekAgo) return d.toLocaleDateString("en-IN", { weekday: "long" });
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}
/** Merge freshly fetched rows into a list, replacing rows that were re-surfaced (chat upserts). */
export function mergeNotifications(
  current: Notification[],
  incoming: Notification[],
) {
  const byId = new Map(current.map((n) => [n.id, n]));
  for (const n of incoming) byId.set(n.id, n);
  return Array.from(byId.values()).sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

// ---------------------------------------------------------------------------
// Full notification centre page
// ---------------------------------------------------------------------------
const PAGE = 50;
type Filter = "all" | "unread" | (typeof notificationGroups)[number];
export function Notifications({
  initial,
  preferences,
  recordModules,
}: {
  initial: Notification[];
  preferences: Preferences;
  recordModules: Record<string, string>;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(false);
  const [exhausted, setExhausted] = useState(initial.length < PAGE);
  const [now, setNow] = useState(() => Date.now());
  const offset = useRef(initial.length);
  const head = useRef(initial);
  const paginationRevision = useRef(0);
  const reading = useRef(false);
  const loadingMore = useRef(false);
  const readRevision = useRef(0);
  const mergeHead = useCallback((next: Notification[]) => {
    const pagination = reconcileNotificationHead(head.current, next, PAGE);
    if (pagination) {
      head.current = next;
      paginationRevision.current++;
      // New arrivals can leave a gap before already-loaded history. Start
      // immediately after the head; merging handles any overlap safely.
      offset.current = pagination.offset;
      setExhausted(pagination.exhausted);
    }
    setItems((current) => mergeNotifications(current, next));
  }, []);
  useEffect(() => {
    mergeHead(initial);
  }, [initial, mergeHead]);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(tick);
  }, []);
  const query = useCallback((extra: Record<string, string | number>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
    return "/api/notifications?" + p.toString();
  }, []);
  // Live refresh: pull the latest rows and merge them (chat rows are re-surfaced in place).
  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      if (document.hidden || reading.current) return;
      const revision = readRevision.current;
      try {
        const res = await fetch(query({ limit: PAGE }));
        if (!res.ok || stopped) return;
        const next = (await res.json()) as Notification[];
        if (stopped || revision !== readRevision.current || reading.current)
          return;
        mergeHead(next);
        setNow(Date.now());
      } catch {}
    };
    const timer = setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [query, mergeHead]);
  async function loadMore() {
    if (loadingMore.current || reading.current) return;
    loadingMore.current = true;
    const revision = readRevision.current;
    const pageRevision = paginationRevision.current;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(query({ limit: PAGE, offset: offset.current }));
      if (!res.ok) throw Error("Could not load older notifications");
      const next = (await res.json()) as Notification[];
      if (
        revision !== readRevision.current ||
        pageRevision !== paginationRevision.current
      )
        return;
      offset.current += next.length;
      if (next.length < PAGE) setExhausted(true);
      setItems((current) => mergeNotifications(current, next));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      loadingMore.current = false;
      setLoading(false);
    }
  }
  async function read(ids: string[]) {
    if (!ids.length || reading.current) return;
    reading.current = true;
    readRevision.current++;
    setBusy(ids.length === 1 ? ids[0] : "all");
    setError("");
    try {
      const result = await readNotificationsInBatches(ids, markRead);
      if (result.readIds.length) {
        const saved = new Set(result.readIds);
        const at = new Date().toISOString();
        setItems((current) =>
          current.map((i) =>
            saved.has(i.id) ? { ...i, read_at: i.read_at || at } : i,
          ),
        );
        // Keep the last known badge on refresh failure; loaded rows are not the total.
        await refreshUnreadCount().catch(() => {});
        router.refresh();
      }
      if (result.error) setError(result.error);
    } finally {
      readRevision.current++;
      reading.current = false;
      setBusy("");
    }
  }
  const unreadCount = items.filter((n) => !n.read_at).length;
  const visible = useMemo(
    () =>
      items.filter((n) =>
        filter === "all"
          ? true
          : filter === "unread"
            ? !n.read_at
            : categoryGroup(n.category) === filter,
      ),
    [items, filter],
  );
  const sections = useMemo(() => {
    const out: { label: string; rows: Notification[] }[] = [];
    for (const n of visible) {
      const label = dayLabel(n.created_at, new Date(now));
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(n);
      else out.push({ label, rows: [n] });
    }
    return out;
  }, [visible, now]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {
      all: items.length,
      unread: unreadCount,
    };
    for (const n of items)
      c[categoryGroup(n.category)] = (c[categoryGroup(n.category)] || 0) + 1;
    return c;
  }, [items, unreadCount]);
  const snoozed =
    preferences.snoozed_until &&
    new Date(preferences.snoozed_until) > new Date(now);
  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "unread", label: "Unread" },
    ...notificationGroups.map((g) => ({ key: g as Filter, label: g })),
  ];
  return (
    <>
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Workspace <span className="mx-1.5 text-muted-foreground/40">/</span>{" "}
            Notifications
          </p>
          <h1 className="text-[28px] font-semibold tracking-tight">
            Your notifications
          </h1>
          <p className="mt-2 text-[13px] text-muted-foreground">
            {unreadCount
              ? `${unreadCount} unread in loaded notifications · reminders, reports and messages in one place.`
              : exhausted
                ? "You’re all caught up. New reminders, reports and messages will appear here."
                : "Loaded notifications are read. Load older notifications to see more."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Button variant="outline" asChild>
            <Link href="/settings/sounds">
              <Volume2 size={14} />
              Sounds
            </Link>
          </Button>
          <Button
            variant="outline"
            disabled={!unreadCount || Boolean(busy)}
            onClick={() =>
              read(items.filter((n) => !n.read_at).map((n) => n.id))
            }
          >
            {busy === "all" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <CheckCheck size={14} />
            )}
            Mark loaded read
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="error mb-4">
          {error}
        </p>
      )}
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div>
          <div
            role="tablist"
            aria-label="Filter notifications"
            className="mb-4 flex flex-wrap gap-2"
          >
            {filters.map((f) => {
              const active = filter === f.key;
              const count = counts[f.key] || 0;
              return (
                <button
                  key={f.key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(f.key)}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${active ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"}`}
                >
                  {f.label}
                  {count > 0 && (
                    <span
                      className={`rounded-full px-1.5 text-[10px] ${active ? "bg-primary/15" : "bg-muted"}`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <section className="panel">
            {!sections.length && (
              <div className="p-12 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                  <Inbox size={22} />
                </div>
                <p className="text-sm font-medium">
                  {filter === "all"
                    ? "You’re all caught up."
                    : "Nothing here yet."}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {filter === "unread"
                    ? exhausted
                      ? "Every notification has been read."
                      : "No unread notifications in the loaded results. Load older notifications to see more."
                    : "New updates and reminders will appear here."}
                </p>
              </div>
            )}
            {sections.map((section) => (
              <div key={section.label}>
                <div className="sticky top-[76px] z-10 border-b border-border bg-card/95 px-5 py-2 text-[10px] font-semibold uppercase tracking-[.12em] text-muted-foreground/80 backdrop-blur">
                  {section.label}
                </div>
                <div className="divide-y divide-border">
                  {section.rows.map((n) => {
                    const href = notificationLink(n, recordModules);
                    const name = metaName(n);
                    const detail = metaDetail(n);
                    const unread = !n.read_at;
                    return (
                      <article
                        key={n.id}
                        className={`relative flex items-start gap-4 p-5 ${unread ? "bg-primary/[.04]" : ""}`}
                      >
                        <span
                          aria-hidden
                          className={`absolute left-0 top-0 h-full w-0.5 ${unread ? priorityDot(n.priority) : "bg-transparent"}`}
                        />
                        <span className="icon-tile h-10 w-10 shrink-0 rounded-xl">
                          <CategoryIcon category={n.category} size={17} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${priorityClass(n.priority)}`}
                            >
                              {n.priority || "Medium"}
                            </span>
                            <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                              {categoryLabel(n.category)}
                            </span>
                            <span
                              className="text-[10px] text-muted-foreground"
                              title={new Date(n.created_at).toLocaleString(
                                "en-IN",
                              )}
                            >
                              {relativeTime(n.created_at, now)}
                            </span>
                            {unread && (
                              <span className="flex items-center gap-1 text-[10px] font-medium text-primary">
                                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                                New
                              </span>
                            )}
                          </div>
                          <p
                            className={`mt-2 text-sm ${unread ? "font-semibold" : "font-medium"}`}
                          >
                            {n.title}
                          </p>
                          {(name || detail) && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {[name, detail].filter(Boolean).join(" · ")}
                            </p>
                          )}
                          {n.body && (
                            <p className="mt-2 text-xs leading-5 text-muted-foreground">
                              {n.body}
                            </p>
                          )}
                          <div className="mt-3 flex flex-wrap items-center gap-3">
                            <Link
                              href={href}
                              onClick={() => unread && read([n.id])}
                              className="inline-flex items-center gap-1 text-xs font-medium text-primary"
                            >
                              {linkLabel(n, href)}
                              <ArrowUpRight size={13} />
                            </Link>
                            {unread && (
                              <button
                                type="button"
                                disabled={Boolean(busy)}
                                onClick={() => read([n.id])}
                                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                              >
                                {busy === n.id ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : (
                                  <Check size={12} />
                                )}
                                Mark read
                              </button>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
            {items.length > 0 && (
              <div className="flex items-center justify-between gap-3 border-t border-border p-4">
                <p className="text-[11px] text-muted-foreground">
                  Showing {visible.length} of {items.length} loaded
                  {exhausted ? " · that’s everything" : ""}.
                </p>
                {!exhausted && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loading}
                    onClick={loadMore}
                  >
                    {loading ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : null}
                    Load older
                  </Button>
                )}
              </div>
            )}
          </section>
        </div>
        <aside className="space-y-5">
          <section className="panel p-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="icon-tile h-8 w-8">
                <BellRing size={15} />
              </span>
              <h2 className="section-title">How alerts work</h2>
            </div>
            <ul className="space-y-3 text-xs leading-5 text-muted-foreground">
              <li>
                <span className="font-medium text-foreground">Priority.</span>{" "}
                Urgent and High alerts are marked in red and amber and pop up as
                a toast while you work.
              </li>
              <li>
                <span className="font-medium text-foreground">Reminders</span>{" "}
                are created by the scheduler from your reminder list; completing
                a reminder clears its alerts.
              </li>
              <li>
                <span className="font-medium text-foreground">Reports.</span>{" "}
                Reviewers are told when a daily report is submitted, and the
                author hears back on questions and decisions.
              </li>
              <li>
                <span className="font-medium text-foreground">Chat</span> keeps
                one live alert per conversation, so a busy thread never floods
                your inbox.
              </li>
              <li>
                <span className="font-medium text-foreground">Sounds</span> play
                while the workspace is open. Push notifications use your
                device’s own sound and need permission.
              </li>
            </ul>
            <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-[11px] text-muted-foreground">
              {preferences.muted
                ? "All alert sounds are muted."
                : snoozed
                  ? `Sounds are snoozed until ${new Date(preferences.snoozed_until!).toLocaleString("en-IN")}.`
                  : `Sounds are on at ${Math.round(preferences.volume * 100)}% volume.`}
            </div>
            <Button variant="outline" className="mt-4 w-full" asChild>
              <Link href="/settings/sounds">
                <Settings2 size={14} />
                Sound & notification settings
              </Link>
            </Button>
          </section>
          <section className="panel p-5">
            <h2 className="section-title">Shortcuts</h2>
            <div className="mt-3 grid gap-2">
              {[
                ["/reminders", "Reminders", BellRing],
                ["/chat", "Chat", MessageSquare],
                ["/modules/eod", "Daily reports", FileText],
              ].map(([href, label, Icon]) => {
                const C = Icon as React.ElementType;
                return (
                  <Link
                    key={String(href)}
                    href={String(href)}
                    className="flex items-center gap-3 rounded-lg border border-border p-3 text-xs transition-colors hover:border-primary/30"
                  >
                    <C size={15} className="text-primary" />
                    <span className="flex-1 font-medium">{String(label)}</span>
                    <ArrowUpRight size={13} className="text-muted-foreground" />
                  </Link>
                );
              })}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
