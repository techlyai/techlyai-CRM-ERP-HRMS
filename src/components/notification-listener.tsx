"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X, ArrowUpRight } from "lucide-react";
import type { Notification, Preferences, CompanySounds } from "@/lib/notification-types";
import { playAlertSound } from "@/lib/audio";
import { resolveSound } from "@/lib/sounds";
import {
  CategoryIcon,
  categoryLabel,
  linkLabel,
  metaName,
  notificationLink,
  priorityDot,
} from "./notifications";
type Channels = { in_app: boolean; sound: boolean; push: boolean; email: boolean };
type Toast = Notification & { shownAt: number };
const POLL_MS = 10000;
const TOAST_MS = 8000;
const MAX_TOASTS = 3;
const prompts = (n: Notification) =>
  n.priority === "High" ||
  n.priority === "Urgent" ||
  n.category === "chat" ||
  n.category === "eod";
export function NotificationListener({
  preferences,
  companySounds,
  channels,
}: {
  preferences: Preferences;
  companySounds?: CompanySounds;
  channels?: Partial<Channels>;
}) {
  const [blocked, setBlocked] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seen = useRef<Map<string, string>>();
  const settings = useRef({ preferences, companySounds, channels });
  settings.current = { preferences, companySounds, channels };
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const check = async () => {
      if (stopped || document.hidden) return;
      try {
        const res = await fetch("/api/notifications?limit=50");
        if (!res.ok || stopped) return;
        const rows = (await res.json()) as Notification[];
        window.dispatchEvent(
          new CustomEvent("techly:unread", {
            detail: Number(res.headers.get("X-Techly-Unread") || "0"),
          }),
        );
        if (!seen.current) {
          seen.current = new Map(rows.map((n) => [n.id, n.created_at]));
          return;
        }
        const { preferences: prefs, companySounds: company, channels: ch } = settings.current;
        const fresh: Notification[] = [];
        for (const row of rows) {
          // Chat rows are re-surfaced in place, so a newer created_at also counts as new.
          const previous = seen.current.get(row.id);
          if (previous === row.created_at) continue;
          seen.current.set(row.id, row.created_at);
          if (previous === undefined && row.read_at) continue;
          fresh.push(row);
        }
        if (!fresh.length) return;
        if (ch?.in_app !== false)
          setToasts((current) =>
            [
              ...fresh
                .filter(prompts)
                .map((n) => ({ ...n, shownAt: Date.now() })),
              ...current,
            ].slice(0, MAX_TOASTS),
          );
        if (ch?.sound === false) return;
        // Play one sound per batch, using the most important category's choice.
        const ranked = [...fresh].sort(
          (a, b) => rank(b.priority) - rank(a.priority),
        );
        for (const row of ranked) {
          const resolved = resolveSound(row.category, prefs, company);
          if (resolved.muted) continue;
          playAlertSound(resolved.sound, prefs.volume)
            .then(() => setBlocked(false))
            .catch(() => setBlocked(true));
          break;
        }
      } catch {}
    };
    const start = () => {
      if (timer) clearInterval(timer);
      timer = setInterval(check, POLL_MS);
    };
    const onVisibility = () => {
      if (document.hidden) {
        if (timer) clearInterval(timer);
        timer = undefined;
      } else {
        check();
        start();
      }
    };
    check();
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  // Auto-dismiss toasts.
  useEffect(() => {
    if (!toasts.length) return;
    const timer = setInterval(
      () => setToasts((current) => current.filter((t) => Date.now() - t.shownAt < TOAST_MS)),
      1000,
    );
    return () => clearInterval(timer);
  }, [toasts.length]);
  const dismiss = (id: string) => setToasts((current) => current.filter((t) => t.id !== id));
  return (
    <>
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="no-print pointer-events-none fixed bottom-20 right-4 z-40 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2 lg:bottom-5 lg:right-5"
        >
          {toasts.map((t) => {
            const href = notificationLink(t);
            const name = metaName(t);
            return (
              <div
                key={t.id + t.created_at}
                role="status"
                className="pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-xl border border-border bg-card p-3.5 shadow-soft"
              >
                <span aria-hidden className={`absolute left-0 top-0 h-full w-1 ${priorityDot(t.priority)}`} />
                <span className="icon-tile h-8 w-8 shrink-0">
                  <CategoryIcon category={t.category} size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-muted-foreground">
                    {categoryLabel(t.category)} · {t.priority}
                  </p>
                  <p className="mt-0.5 truncate text-xs font-semibold">{t.title}</p>
                  {name && <p className="truncate text-[11px] text-muted-foreground">{name}</p>}
                  <Link
                    href={href}
                    onClick={() => dismiss(t.id)}
                    className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-primary"
                  >
                    {linkLabel(t, href)}
                    <ArrowUpRight size={11} />
                  </Link>
                </div>
                <button
                  type="button"
                  aria-label="Dismiss notification"
                  onClick={() => dismiss(t.id)}
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {blocked && (
        <div
          role="status"
          className="no-print fixed bottom-20 left-4 z-40 flex max-w-xs items-start gap-3 rounded-xl border border-border bg-card p-4 text-xs shadow-soft lg:bottom-5 lg:left-auto lg:right-5"
          style={toasts.length ? { bottom: "auto", top: 88 } : undefined}
        >
          <div className="flex-1">
            Your browser blocked alert audio until you click on the page.{" "}
            <Link href="/notifications" className="text-primary underline">
              Updates are available in your inbox.
            </Link>
          </div>
          <button
            type="button"
            aria-label="Dismiss sound notice"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => setBlocked(false)}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );
}
function rank(p: Notification["priority"]) {
  return { Urgent: 3, High: 2, Medium: 1, Low: 0 }[p] ?? 1;
}
