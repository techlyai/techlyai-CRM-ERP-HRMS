import { context, grants, allowed } from "@/lib/database";
import { type BusinessRecord, modules } from "@/lib/modules";
import { Dashboard, type Stats, type Reminder } from "@/components/dashboard";
export default async function Overview() {
  const { db, profile } = await context();
  const [stats, recent, tasks, projects, permissions, reminders] =
    await Promise.all([
      db.rpc<Stats>("dashboard_stats"),
      db.select<BusinessRecord>(
        "records",
        "select=*&status=neq.Archived&order=updated_at.desc&limit=6",
      ),
      db.select<BusinessRecord>(
        "records",
        "select=*&module=eq.tasks&status=neq.Completed&status=neq.Archived&owner_id=eq." +
          profile.id +
          "&order=data->>due_date.asc&limit=5",
      ),
      db.select<BusinessRecord>(
        "records",
        "select=*&module=eq.projects&status=neq.Archived&order=updated_at.desc&limit=5",
      ),
      grants(db),
      db
        .select<Reminder>(
          "reminders",
          "select=*&status=eq.Pending&order=due_at.asc&limit=5",
        )
        .catch(() => [] as Reminder[]),
    ]);
  return (
    <Dashboard
      profile={profile}
      stats={stats}
      recent={recent}
      tasks={tasks}
      projects={projects}
      reminders={reminders}
      creatable={modules
        .filter(
          (m) =>
            allowed(profile, permissions, m.key, "view") &&
            allowed(profile, permissions, m.key, "create"),
        )
        .map((m) => m.key)}
      visible={modules
        .filter((m) => allowed(profile, permissions, m.key, "view"))
        .map((m) => m.key)}
    />
  );
}
