import { context } from "@/lib/database";
import { Settings, type CompanySettings } from "@/components/settings";
import type { Preferences } from "@/components/notifications";
export default async function SettingsPage() {
  const { db, profile } = await context();
  const [settings, prefs, runs, policies] = await Promise.all([
    db.select<{ data: CompanySettings }>("settings", "select=data&id=eq.1"),
    db.select<{ data: Preferences }>(
      "notification_preferences",
      "select=data&user_id=eq." + profile.id,
    ),
    db.select<{
      id: number;
      started_at: string;
      finished_at: string;
      notification_count: number;
      error: string | null;
    }>("scheduler_runs", "select=*&order=started_at.desc&limit=20"),
    db.select<{
      type: string;
      allocation: number;
      accrual: string;
      carry_forward: number;
      eligibility_days: number;
      paid: boolean;
    }>("leave_policies"),
  ]);
  return (
    <Settings
      profile={profile}
      settings={settings[0].data}
      preferences={
        prefs[0]?.data || { muted: false, volume: 0.5, categories: {} }
      }
      runs={runs}
      policies={policies}
    />
  );
}
