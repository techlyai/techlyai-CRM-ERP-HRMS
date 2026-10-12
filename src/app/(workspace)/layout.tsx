import { AppFrame } from "@/components/app-frame";
import { context, grants, allowed } from "@/lib/database";
import { modules } from "@/lib/modules";
import { NotificationListener } from "@/components/notification-listener";
import type { Preferences } from "@/components/notifications";
export const dynamic = "force-dynamic";
export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { db, profile } = await context();
  const [permissions, notifications, prefs] = await Promise.all([
    grants(db),
    db.select<{ id: string }>(
      "notifications",
      "select=id&read_at=is.null&limit=100",
    ),
    db.select<{ data: Preferences }>(
      "notification_preferences",
      "select=data&user_id=eq." + profile.id,
    ),
  ]);
  return (
    <AppFrame
      profile={profile}
      visible={modules
        .filter((m) => allowed(profile, permissions, m.key, "view"))
        .map((m) => m.key)}
      unread={notifications.length}
    >
      {children}
      <NotificationListener
        preferences={
          prefs[0]?.data || { muted: false, volume: 0.5, categories: {} }
        }
      />
    </AppFrame>
  );
}
