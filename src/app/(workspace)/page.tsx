import { context, grants, allowed } from "@/lib/database";
import { type BusinessRecord, modules } from "@/lib/modules";
import { Dashboard, type Stats, type Reminder } from "@/components/dashboard";
import { attendanceCardData } from "@/lib/attendance";
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
  const attendanceAllowed =
    allowed(profile, permissions, "attendance", "view") &&
    allowed(profile, permissions, "attendance", "create");
  const timezone = attendanceAllowed
    ? (
        await db.select<{ data: { timezone?: string } }>("settings", "select=data&id=eq.1")
      )[0]?.data.timezone || "Asia/Kolkata"
    : "Asia/Kolkata";
  const attendance = attendanceAllowed
    ? {
        ...(await attendanceCardData(db, profile, timezone)),
        canCheckIn: true,
        canCheckOut: allowed(profile, permissions, "attendance", "edit"),
        canRequestCorrection: allowed(profile, permissions, "corrections", "create"),
      }
    : null;
  // Field employees see whether tracking is running and a shortcut to the GPS camera.
  const field = await db
    .run(async (c) => {
      const a = (await c.query("select enabled,photo_upload from public.field_assignments where user_id=$1", [profile.id])).rows[0];
      if (!a?.enabled) return null;
      const s = (await c.query("select started_at from public.field_sessions where user_id=$1 and status='active'", [profile.id])).rows[0];
      return { active: Boolean(s), startedAt: (s?.started_at as Date | undefined)?.toISOString() || null, photos: Boolean(a.photo_upload) };
    })
    .catch(() => null);
  return (
    <Dashboard
      attendance={attendance}
      field={field}
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
