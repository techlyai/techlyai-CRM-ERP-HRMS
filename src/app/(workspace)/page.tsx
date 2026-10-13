import { context, grants, allowed } from "@/lib/database";
import { type BusinessRecord, modules } from "@/lib/modules";
import { Dashboard, type Stats } from "@/components/dashboard";
export default async function Overview() {
  const { db, profile } = await context();
  const [stats, recent, tasks, projects, permissions] = await Promise.all([
    db.rpc<Stats>("dashboard_stats"),
    db.select<BusinessRecord>(
      "records",
      "select=*&status=neq.Archived&order=updated_at.desc&limit=6",
    ),
    db.select<BusinessRecord>(
      "records",
      "select=*&module=eq.tasks&status=neq.Completed&owner_id=eq." +
        profile.id +
        "&order=data->>due_date.asc&limit=5",
    ),
    db.select<BusinessRecord>(
      "records",
      "select=*&module=eq.projects&status=neq.Archived&order=updated_at.desc&limit=5",
    ),
    grants(db),
  ]);
  return (
    <Dashboard
      profile={profile}
      stats={stats}
      recent={recent}
      tasks={tasks}
      projects={projects}
      visible={modules
        .filter((m) => allowed(profile, permissions, m.key, "view"))
        .map((m) => m.key)}
    />
  );
}
