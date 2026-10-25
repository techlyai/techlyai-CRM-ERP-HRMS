import { z } from "zod";
import { context } from "@/lib/database";
import { fieldContext, validDate } from "@/lib/field-data";
import type { FieldPhoto, FieldPoint, FieldSession, FieldSite, FieldVisit, OverviewRow } from "@/lib/field";
import { TrackingView } from "@/components/field/tracking-view";
export const metadata = { title: "Field employee tracking" };

export default async function TrackingPage({ searchParams }: { searchParams: { user?: string; date?: string } }) {
  const { db, profile } = await context();
  const f = await fieldContext(db, profile);
  const date = validDate(searchParams.date, f.today);
  // Everyone the viewer may see (themselves included when they are a field employee).
  const rows = await db.rpc<OverviewRow[]>("field_overview", { p_date: date });
  const requested = z.string().uuid().safeParse(searchParams.user).success ? searchParams.user! : null;
  const user = rows.find((r) => r.user_id === requested)?.user_id || (rows.some((r) => r.user_id === profile.id) ? profile.id : rows[0]?.user_id) || null;
  const data = user
    ? await db.run(async (c) => {
        const sessions = (
          await c.query("select * from public.field_sessions where user_id=$1 and (started_at at time zone $2)::date=$3::date order by started_at", [user, f.timezone, date])
        ).rows as FieldSession[];
        const ids = sessions.map((s) => s.id);
        const points = (
          await c.query("select session_id,latitude,longitude,accuracy_m,captured_at,source from public.field_points where session_id = any($1) order by captured_at", [ids])
        ).rows as (FieldPoint & { session_id: string })[];
        const visits = (await c.query("select * from public.field_visits where session_id = any($1) order by started_at", [ids])).rows as FieldVisit[];
        const photos = (await c.query("select * from public.field_photos where session_id = any($1) order by uploaded_at", [ids])).rows as FieldPhoto[];
        const sites = (
          await c.query("select s.* from public.field_sites s join public.field_assignment_sites a on a.site_id=s.id where a.user_id=$1 and s.active order by s.name", [user])
        ).rows as FieldSite[];
        return { sessions, points, visits, photos, sites };
      })
    : null;
  return <TrackingView rows={rows} user={user} date={date} today={f.today} timezone={f.timezone} data={data} />;
}
