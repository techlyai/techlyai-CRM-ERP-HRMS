import { context, grants, can } from "@/lib/database";
import {
  Settings,
  type CompanySettings,
  type SettingsTab,
} from "@/components/settings";
import type { Preferences } from "@/components/notifications";
import type { EmailSettings } from "@/lib/email";
import type { EmailLogRow } from "@/components/settings-panels/email";
import type { EmployeeIdSettings } from "@/components/settings-panels/employee-ids";
export const metadata = { title: "Settings" };
const tabs: SettingsTab[] = [
  "notifications",
  "sounds",
  "reminders",
  "company",
  "chat",
  "email",
  "employee IDs",
  "leave policy",
  "scheduler",
];
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const { db, profile } = await context();
  const permissions = await grants(db);
  const has = (action: string) => can(profile, permissions, "settings", action);
  // Each settings area follows its own permission; the database enforces saves.
  const allowedTabs: SettingsTab[] = [
    "notifications",
    "sounds",
    ...(has("reminders") ? (["reminders"] as SettingsTab[]) : []),
    ...(has("company") ? (["company"] as SettingsTab[]) : []),
    ...(has("chat") ? (["chat"] as SettingsTab[]) : []),
    ...(has("email") ? (["email"] as SettingsTab[]) : []),
    ...(has("employee_ids") ? (["employee IDs"] as SettingsTab[]) : []),
    ...(has("leave_policy") ? (["leave policy"] as SettingsTab[]) : []),
    ...(profile.role === "super_admin" ? (["scheduler"] as SettingsTab[]) : []),
  ];
  const canManageAccess = can(profile, permissions, "users", "permissions");
  const canViewLocations = ["view", "manage", "assign"].some((a) => can(profile, permissions, "locations", a));
  const [settings, prefs, runs, policies, emailSettings, emailLog, idSettings] =
    await Promise.all([
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
      has("email")
        ? db.select<{ data: EmailSettings }>(
            "email_settings",
            "select=data&id=eq.1",
          )
        : Promise.resolve([]),
      has("email")
        ? db.select<EmailLogRow>(
            "email_log",
            "select=id,event,recipient,subject,status,provider,provider_id,error,attempts,sent_at,created_at,next_attempt_at&order=created_at.desc&limit=100",
          )
        : Promise.resolve([]),
      has("employee_ids")
        ? db.select<{ data: EmployeeIdSettings }>(
            "employee_id_settings",
            "select=data&id=eq.1",
          )
        : Promise.resolve([]),
    ]);
  const employeeIdPreview = has("employee_ids")
    ? await db
        .rpc<string>("employee_id_preview", { p_department: null })
        .catch(() => "")
    : "";
  const requested = (searchParams.tab || "").replace(/-/g, " ") as SettingsTab;
  return (
    <Settings
      profile={profile}
      settings={settings[0].data}
      preferences={
        prefs[0]?.data || { muted: false, volume: 0.5, categories: {} }
      }
      runs={runs}
      policies={policies}
      emailSettings={emailSettings[0]?.data || null}
      emailLog={emailLog}
      employeeIdSettings={idSettings[0]?.data || null}
      employeeIdPreview={employeeIdPreview}
      allowedTabs={allowedTabs}
      canManageAccess={canManageAccess}
      canViewLocations={canViewLocations}
      initialTab={
        tabs.includes(requested) && allowedTabs.includes(requested)
          ? requested
          : "notifications"
      }
    />
  );
}
