"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Notification, Preferences } from "./notifications";
import { playAlertSound } from "@/lib/audio";
export function NotificationListener({
  preferences,
}: {
  preferences: Preferences;
}) {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    let seen: Set<string> | undefined;
    const check = async () => {
      try {
        const res = await fetch("/api/notifications");
        if (!res.ok) return;
        const rows = (await res.json()) as Notification[];
        window.dispatchEvent(
          new CustomEvent("techly:unread", {
            detail: Number(res.headers.get("X-Techly-Unread") || "0"),
          }),
        );
        if (!seen) {
          seen = new Set(rows.map((n) => n.id));
          return;
        }
        for (const row of rows) {
          if (seen.has(row.id)) continue;
          seen.add(row.id);
          const c = preferences.categories?.[row.category];
          if (
            preferences.muted ||
            c?.muted ||
            (preferences.snoozed_until &&
              new Date(preferences.snoozed_until) > new Date())
          )
            continue;
          playAlertSound(c?.sound, preferences.volume).catch(() =>
            setBlocked(true),
          );
        }
      } catch {}
    };
    check();
    const timer = setInterval(check, 30000);
    return () => clearInterval(timer);
  }, [preferences]);
  return blocked ? (
    <div
      role="status"
      className="no-print fixed bottom-20 right-5 z-40 max-w-xs rounded-xl border border-border bg-card p-4 text-xs shadow-lg lg:bottom-5"
    >
      Your browser blocked alert audio.{" "}
      <Link href="/notifications" className="text-primary underline">
        Updates are available in your inbox.
      </Link>
      <button
        aria-label="Dismiss sound notice"
        className="ml-3"
        onClick={() => setBlocked(false)}
      >
        ×
      </button>
    </div>
  ) : null;
}
