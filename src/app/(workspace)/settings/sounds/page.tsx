import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { context } from "@/lib/database";
import type { CompanySettings } from "@/components/settings";
import type { Preferences } from "@/lib/notification-types";
import { SoundSettings } from "@/components/settings-panels/sounds";
export const metadata = { title: "Sound & notification settings" };
export const dynamic = "force-dynamic";
export default async function SoundSettingsPage() {
  const { db, profile } = await context();
  const [settings, prefs] = await Promise.all([
    db.select<{ data: CompanySettings }>("settings", "select=data&id=eq.1"),
    db.select<{ data: Preferences }>(
      "notification_preferences",
      "select=data&user_id=eq." + profile.id,
    ),
  ]);
  const company = settings[0]?.data;
  return (
    <>
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-[11px] text-muted-foreground">
            <Link href="/settings" className="hover:text-foreground">
              Settings
            </Link>
            <span className="mx-1.5 text-muted-foreground/40">/</span>
            Sounds
          </p>
          <h1 className="text-[28px] font-semibold tracking-tight">
            Sound & notification settings
          </h1>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Decide what you hear, how loud, and when Orbit stays quiet.
          </p>
        </div>
        <Link
          href="/settings?tab=notifications"
          className="flex items-center gap-2 pt-2 text-xs font-medium text-primary"
        >
          <ArrowLeft size={14} />
          Push & delivery settings
        </Link>
      </div>
      <SoundSettings
        profile={profile}
        preferences={
          prefs[0]?.data || { muted: false, volume: 0.5, categories: {} }
        }
        companySounds={
          company?.sounds || { default: "builtin:chime", categories: {} }
        }
        settings={profile.role === "super_admin" ? company : undefined}
      />
    </>
  );
}
