"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, Volume2 } from "lucide-react";
import { markRead } from "@/lib/actions";
import { Button } from "./ui/button";
import type { Notification, Preferences } from "@/lib/notification-types";
export type { Notification, Preferences } from "@/lib/notification-types";
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
  const [error, setError] = useState("");
  const [soundBlocked, setSoundBlocked] = useState(false);
  const seen = useRef(new Set(initial.map((n) => n.id)));
  useEffect(() => setItems(initial), [initial]);
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/notifications");
        if (!res.ok) return;
        const next = (await res.json()) as Notification[];
        setItems(next);
      } catch {}
    }, 30000);
    return () => clearInterval(timer);
  }, []);
  async function read(ids: string[]) {
    const r = await markRead(ids);
    if (!r.ok) setError(r.error || "Failed");
    else {
      setItems(
        items.map((i) =>
          ids.includes(i.id) ? { ...i, read_at: new Date().toISOString() } : i,
        ),
      );
      router.refresh();
    }
  }
  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Your notifications</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Stay in the loop, without losing focus.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => read(items.filter((n) => !n.read_at).map((n) => n.id))}
        >
          <Check size={14} />
          Mark all read
        </Button>
      </div>
      {error && <p className="error mb-4">{error}</p>}
      {soundBlocked && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"
        >
          Your browser blocked sound playback. Your notifications are still
          available here. Use sound preview in Settings to enable audio during
          this visit.
        </p>
      )}
      <section className="panel divide-y">
        {items.map((n) => (
          <div
            key={n.id}
            className={`flex items-start gap-4 p-5 ${!n.read_at ? "bg-violet-500/[.03]" : ""}`}
          >
            <span className="rounded-xl bg-violet-500/10 p-2.5 text-primary">
              <Bell size={17} />
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold">{n.title}</p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {n.body}
              </p>
              <p className="mt-2 text-[10px] text-muted-foreground">
                {new Date(n.created_at).toLocaleString("en-IN")} · {n.category}
              </p>
              {n.record_id && recordModules[n.record_id] && (
                <Link
                  className="mt-3 block text-xs text-primary"
                  href={`/modules/${recordModules[n.record_id]}/${n.record_id}`}
                >
                  View record →
                </Link>
              )}
            </div>
            {!n.read_at && (
              <button
                aria-label="Mark notification read"
                onClick={() => read([n.id])}
                className="rounded-lg p-2 hover:bg-muted"
              >
                <Check size={14} />
              </button>
            )}
          </div>
        ))}
        {!items.length && (
          <div className="p-12 text-center">
            <Bell size={28} className="mx-auto mb-4 text-muted-foreground" />
            <p className="text-sm font-medium">You’re all caught up.</p>
            <p className="mt-2 text-xs text-muted-foreground">
              New updates and reminders will appear here.
            </p>
          </div>
        )}
      </section>
      <p className="mt-4 text-xs text-muted-foreground">
        Showing your most recent 100 notifications. Push delivery depends on
        device support and your notification permissions.
      </p>
    </>
  );
}
