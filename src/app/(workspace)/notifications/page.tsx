import { context } from "@/lib/database";
import {
  Notifications,
  type Notification,
  type Preferences,
} from "@/components/notifications";
export default async function Inbox() {
  const { db, profile } = await context();
  const [items, prefs, records] = await Promise.all([
    db.select<Notification>(
      "notifications",
      "select=*&order=created_at.desc&limit=100",
    ),
    db.select<{ data: Preferences }>(
      "notification_preferences",
      "select=data&user_id=eq." + profile.id,
    ),
    db.select<{ id: string; module: string }>(
      "records",
      "select=id,module&limit=1000",
    ),
  ]);
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
