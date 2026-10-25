import { AppFrame } from "@/components/app-frame";
import { context, grants, allowed, can } from "@/lib/database";
import { modules } from "@/lib/modules";
import { NotificationListener } from "@/components/notification-listener";
import type { Preferences } from "@/components/notifications";
import type { CompanySettings } from "@/components/settings";
export const dynamic = "force-dynamic";
export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { db, profile } = await context();
  const [permissions, notifications, prefs, settings] = await Promise.all([
    grants(db),
    db.select<{ id: string }>(
      "notifications",
      "select=id&read_at=is.null&limit=100",
    ),
    db.select<{ data: Preferences }>(
      "notification_preferences",
      "select=data&user_id=eq." + profile.id,
    ),
    db.select<{ data: Pick<CompanySettings, "sounds" | "notification_channels"> }>(
      "settings",
      "select=data&id=eq.1",
    ),
  ]);
  const company = settings[0]?.data;
  return (
    <AppFrame
      profile={profile}
      visible={modules
        .filter((m) => allowed(profile, permissions, m.key, "view"))
        .map((m) => m.key)}
      unread={notifications.length}
      features={{
        users: can(profile, permissions, "users", "view"),
        audit: can(profile, permissions, "audit", "view"),
        permissions: can(profile, permissions, "users", "permissions"),
        chat: can(profile, permissions, "chat", "view"),
      }}
    >
      {children}
      <NotificationListener
        preferences={
          prefs[0]?.data || { muted: false, volume: 0.5, categories: {} }
        }
        companySounds={
          company?.sounds || { default: "builtin:chime", categories: {} }
        }
        channels={
          company?.notification_channels || {
            in_app: true,
            sound: true,
            push: true,
            email: true,
          }
        }
      />
    </AppFrame>
  );
}
