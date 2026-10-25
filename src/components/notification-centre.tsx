"use client";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Bell,
  Check,
  CheckCheck,
  Loader2,
  ArrowUpRight,
  Settings2,
  Inbox,
} from "lucide-react";
import { markRead } from "@/lib/actions";
import {
  readNotificationsInBatches,
  refreshUnreadCount,
} from "@/lib/notification-state";
import {
  categoryLabel,
  CategoryIcon,
  linkLabel,
  metaName,
  notificationLink,
  priorityClass,
  priorityDot,
  relativeTime,
  type Notification,
} from "./notifications";
type Filter = "all" | "unread" | "reminders" | "chat" | "reports";
const filters: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "reminders", label: "Reminders" },
  { key: "chat", label: "Chat" },
  { key: "reports", label: "Reports" },
];
const LIMIT = 20;
export function NotificationCentre({ unread }: { unread: number }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(unread);
  const [chatUnread, setChatUnread] = useState(0);
  const [items, setItems] = useState<Notification[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const request = useRef<AbortController | null>(null);
  const reading = useRef(false);
  const currentFilter = useRef(filter);
  const isOpen = useRef(open);
  currentFilter.current = filter;
  isOpen.current = open;
  useEffect(() => setCount(unread), [unread]);
  useEffect(() => {
    const onUnread = (event: Event) =>
      setCount(
        Math.max(
          0,
          Math.min(100, Number((event as CustomEvent<number>).detail) || 0),
        ),
      );
    const onChat = (event: Event) =>
      setChatUnread(
        Math.max(0, Number((event as CustomEvent<number>).detail) || 0),
      );
    window.addEventListener("techly:unread", onUnread);
    window.addEventListener("techly:chat-unread", onChat);
    return () => {
      window.removeEventListener("techly:unread", onUnread);
      window.removeEventListener("techly:chat-unread", onChat);
    };
  }, []);
  const load = useCallback(async (current: Filter, quiet = false) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (!quiet) setLoading(true);
    if (!quiet) setError("");
    try {
      const p = new URLSearchParams({ limit: String(LIMIT) });
      if (current === "unread") p.set("unread", "1");
      else if (current !== "all") p.set("category", current);
      const res = await fetch("/api/notifications?" + p.toString(), {
        signal: controller.signal,
      });
      if (!res.ok) throw Error("Could not load notifications");
      const next = (await res.json()) as Notification[];
      if (controller.signal.aborted || current !== currentFilter.current)
        return;
      setItems(next);
      setNow(Date.now());
      const header = Number(res.headers.get("X-Techly-Unread") || "0");
      setCount(Math.max(0, Math.min(100, header)));
      window.dispatchEvent(
        new CustomEvent("techly:unread", { detail: header }),
      );
    } catch (e) {
      if (!controller.signal.aborted && !quiet)
        setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);
  // Fetch on open and whenever the filter changes; poll every 15s while open.
  useEffect(() => {
    if (!open) return;
    setItems([]);
    load(filter);
    const timer = setInterval(() => {
      if (!document.hidden && !reading.current) load(filter, true);
    }, 15000);
    return () => {
      clearInterval(timer);
      request.current?.abort();
    };
  }, [open, filter, load]);
  // Close on outside click or Escape; return focus to the bell.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (wrapper.current && !wrapper.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    panel.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  async function read(ids: string[]) {
    if (!ids.length || reading.current) return;
    reading.current = true;
    request.current?.abort();
    setLoading(false);
    setBusy(ids.length === 1 ? ids[0] : "all");
    setError("");
    try {
      const result = await readNotificationsInBatches(ids, markRead);
      if (result.readIds.length) {
        const saved = new Set(result.readIds);
        const at = new Date().toISOString();
        setItems((current) =>
          current.map((n) =>
            saved.has(n.id) ? { ...n, read_at: n.read_at || at } : n,
          ),
        );
        await refreshUnreadCount().catch(() => {});
        if (isOpen.current) await load(currentFilter.current, true);
      }
      if (result.error) setError(result.error);
    } finally {
      reading.current = false;
      setBusy("");
    }
  }
  const unreadIds = items.filter((n) => !n.read_at).map((n) => n.id);
  return (
    <div ref={wrapper} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label={count ? `${count} unread notifications` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={`relative rounded-lg p-2 transition-colors hover:bg-muted hover:text-foreground ${open ? "bg-muted text-foreground" : "text-muted-foreground"}`}
      >
        <Bell size={18} />
        {count > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      {open && (
        <div
          ref={panel}
          id={panelId}
          role="dialog"
          aria-label="Notifications"
          tabIndex={-1}
          className="absolute right-0 top-full z-40 mt-2 w-[400px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-card shadow-soft outline-none"
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Notifications</h2>
              <p className="text-[10px] text-muted-foreground">
                {count ? `${count} unread` : "All caught up"}
                {chatUnread > 0 ? ` · ${chatUnread} chat` : ""}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={!unreadIds.length || Boolean(busy) || loading}
                onClick={() => read(unreadIds)}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/10 disabled:opacity-40"
              >
                {busy === "all" ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <CheckCheck size={13} />
                )}
                Mark shown read
              </button>
              <Link
                href="/settings/sounds"
                aria-label="Sound settings"
                title="Sound settings"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Settings2 size={14} />
              </Link>
            </div>
          </div>
          <div
            className="flex gap-1.5 overflow-x-auto border-b border-border px-3 py-2"
            role="tablist"
            aria-label="Filter"
          >
            {filters.map((f) => {
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  role="tab"
                  aria-selected={active}
                  disabled={Boolean(busy)}
                  onClick={() => setFilter(f.key)}
                  className={`flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${active ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  {f.label}
                  {f.key === "chat" && chatUnread > 0 && (
                    <span className="rounded-full bg-primary px-1.5 text-[9px] font-semibold text-primary-foreground">
                      {chatUnread}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="max-h-[min(60vh,480px)] overflow-y-auto">
            {error && (
              <p role="alert" className="error m-3">
                {error}
              </p>
            )}
            {loading && !items.length && (
              <div className="flex items-center justify-center gap-2 p-8 text-xs text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                Loading…
              </div>
            )}
            {!loading && !items.length && !error && (
              <div className="p-8 text-center">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                  <Inbox size={18} />
                </div>
                <p className="text-xs font-medium">
                  {filter === "unread"
                    ? "Nothing unread."
                    : "Nothing here yet."}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  New reminders, reports and messages will show up here.
                </p>
              </div>
            )}
            <ul className="divide-y divide-border">
              {items.map((n) => {
                const href = notificationLink(n);
                const name = metaName(n);
                const unread = !n.read_at;
                return (
                  <li
                    key={n.id}
                    className={`relative flex items-start gap-3 px-4 py-3 ${unread ? "bg-primary/[.04]" : ""}`}
                  >
                    <span
                      aria-hidden
                      className={`absolute left-0 top-0 h-full w-0.5 ${unread ? priorityDot(n.priority) : "bg-transparent"}`}
                    />
                    <span className="icon-tile mt-0.5 h-8 w-8 shrink-0">
                      <CategoryIcon category={n.category} size={14} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                        <span
                          className={`rounded px-1.5 py-0.5 font-medium ${priorityClass(n.priority)}`}
                        >
                          {n.priority || "Medium"}
                        </span>
                        <span className="text-muted-foreground">
                          {categoryLabel(n.category)}
                        </span>
                        <span className="text-muted-foreground/70">
                          · {relativeTime(n.created_at, now)}
                        </span>
                        {unread && (
                          <span
                            className="ml-auto h-1.5 w-1.5 rounded-full bg-primary"
                            aria-label="Unread"
                          />
                        )}
                      </div>
                      <Link
                        href={href}
                        onClick={() => {
                          setOpen(false);
                          if (unread) void read([n.id]);
                        }}
                        className={`mt-1 block text-xs leading-5 hover:text-primary ${unread ? "font-semibold" : "font-medium"}`}
                      >
                        {n.title}
                      </Link>
                      {name && (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {name}
                        </p>
                      )}
                      <div className="mt-1.5 flex items-center gap-3 text-[11px]">
                        <Link
                          href={href}
                          onClick={() => {
                            setOpen(false);
                            if (unread) void read([n.id]);
                          }}
                          className="inline-flex items-center gap-1 font-medium text-primary"
                        >
                          {linkLabel(n, href)}
                          <ArrowUpRight size={11} />
                        </Link>
                        {unread && (
                          <button
                            type="button"
                            disabled={Boolean(busy)}
                            onClick={() => read([n.id])}
                            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                          >
                            {busy === n.id ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : (
                              <Check size={11} />
                            )}
                            Mark read
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-1.5 border-t border-border py-2.5 text-xs font-medium text-primary hover:bg-muted"
          >
            View all notifications
            <ArrowUpRight size={13} />
          </Link>
        </div>
      )}
    </div>
  );
}
