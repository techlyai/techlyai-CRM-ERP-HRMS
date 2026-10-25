import { context } from "@/lib/database";
import { fieldContext } from "@/lib/field-data";
import type { FieldAssignment, FieldSite } from "@/lib/field";
import { FieldSettings, type AuditRow, type Person, type Policy } from "@/components/field/field-settings";
export const metadata = { title: "Field tracking settings" };

export default async function FieldSettingsPage() {
  const { db, profile } = await context();
  const f = await fieldContext(db, profile);
  if (!f.abilities.manage)
    return <p className="panel p-6 text-sm text-muted-foreground">Only a Super Admin, or someone granted field tracking management, can change these settings.</p>;
  const data = await db.run(async (c) => ({
    people: (await c.query("select id,full_name,employee_id,department,role from public.field_people where active order by full_name")).rows as Person[],
    assignments: (await c.query("select * from public.field_assignments")).rows as FieldAssignment[],
    assignmentSites: (await c.query("select user_id,site_id from public.field_assignment_sites")).rows as { user_id: string; site_id: string }[],
    viewers: (await c.query("select user_id,viewer_id from public.field_viewers")).rows as { user_id: string; viewer_id: string }[],
    sites: (await c.query("select * from public.field_sites order by name")).rows as FieldSite[],
    policy: (await c.query("select data from public.field_policy where id=1")).rows[0].data as Policy,
    audit: (
      await c.query(
        "select a.*,pr.full_name as actor_name,u.full_name as user_name,s.name as site_name from public.field_audit a left join public.field_people pr on pr.id=a.actor_id left join public.field_people u on u.id=a.user_id left join public.field_sites s on s.id=a.site_id order by a.id desc limit 100",
      )
    ).rows as AuditRow[],
  }));
  return <FieldSettings {...data} timezone={f.timezone} />;
}
