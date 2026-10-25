import { context } from "@/lib/database";
import {
  Notifications,
  type Notification,
  type Preferences,
} from "@/components/notifications";
export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";
export default async function Inbox() {
  const { db, profile } = await context();
  const [items, prefs] = await Promise.all([
    db.select<Notification>(
      "notifications",
      "select=*&order=created_at.desc&limit=50",
    ),
    db.select<{ data: Preferences }>(
      "notification_preferences",
      "select=data&user_id=eq." + profile.id,
    ),
  ]);
  // Older rows (before deep links were stored) fall back to the record's module page.
  const legacy = Array.from(
    new Set(items.filter((n) => !n.link && n.record_id).map((n) => n.record_id!)),
  ).slice(0, 100);
  const records = legacy.length
    ? await db.select<{ id: string; module: string }>(
        "records",
        "select=id,module&id=in.(" + legacy.join(",") + ")",
      )
    : [];
  return (
    <Notifications
      initial={items}
      preferences={
        prefs[0]?.data || { muted: false, volume: 0.5, categories: {} }
      }
      recordModules={Object.fromEntries(records.map((r) => [r.id, r.module]))}
    />
  );
}
