import Link from "next/link";
import { context } from "@/lib/database";
import { fieldContext } from "@/lib/field-data";
import { fieldParams } from "@/lib/field-params";
import { formatDistance } from "@/lib/geo";
import type { FieldVisit, OverviewRow } from "@/lib/field";
import { FilterBar } from "@/components/field/filter-bar";
import { VerificationBadge } from "@/components/field/badges";
export const metadata = { title: "Field visit history" };

type Row = FieldVisit & { name: string; employee_id: string | null; department: string | null; tl_name: string | null; photos: number; report_title: string | null };

export default async function VisitsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const { db, profile } = await context();
  const f = await fieldContext(db, profile);
  const p = fieldParams(searchParams, f.today, 14);
  const rows = await db.rpc<OverviewRow[]>("field_overview", { p_date: f.today });
  const visits = await db.run(async (c) => {
    const where = ["(v.started_at at time zone $1)::date between $2::date and $3::date"];
    const values: unknown[] = [f.timezone, p.from, p.to];
    const add = (sql: string, v: unknown) => {
      values.push(v);
      where.push(sql.replace("?", "$" + values.length));
    };
    if (p.user) add("v.user_id=?::uuid", p.user);
    if (p.tl) add("a.team_leader_id=?::uuid", p.tl);
    if (p.department) add("pr.department=?", p.department);
    if (p.verification) add("v.start_status=?", p.verification);
    if (p.status === "In progress") where.push("v.ended_at is null");
    if (p.status === "Ended") where.push("v.ended_at is not null");
    return (
      await c.query(
        `select v.*,pr.full_name as name,pr.employee_id,pr.department,tl.full_name as tl_name,
          (select count(*)::int from public.field_photos x where x.visit_id=v.id) as photos,r.title as report_title
         from public.field_visits v join public.field_people pr on pr.id=v.user_id left join public.field_assignments a on a.user_id=v.user_id
         left join public.field_people tl on tl.id=a.team_leader_id left join public.field_reports r on r.id=v.report_id
         where ${where.join(" and ")} order by v.started_at desc limit 500`,
        values,
      )
    ).rows as Row[];
  });
  const when = (v: string | null) => (v ? new Date(v).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: f.timezone }) : "—");
  const time = (v: string | null) => (v ? new Date(v).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: f.timezone }) : "in progress");
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="section-title">Field visit history</h2>
          <p className="mt-1 text-xs text-muted-foreground">Visits recorded by field employees you may review, with the arrival and departure location checks.</p>
        </div>
        {f.abilities.export && (
          <a className="text-xs font-medium text-primary hover:underline" href={`/api/field/export?type=visits&from=${p.from}&to=${p.to}`}>Export CSV</a>
        )}
      </div>
      <FilterBar action="/field/visits" rows={rows} values={p} statuses={["In progress", "Ended"]} fields={["dates", "user", "tl", "department", "verification", "status"]} />
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>{["Employee", "Visit", "Time", "Arrival check", "Departure check", "Photos", "Report", ""].map((h) => <th key={h} className="p-3 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {visits.map((v) => (
              <tr key={v.id} className="border-t align-top">
                <td className="p-3">
                  <span className="block font-medium">{v.name}</span>
                  <span className="text-[11px] text-muted-foreground">{[v.employee_id, v.department, v.tl_name && "TL " + v.tl_name].filter(Boolean).join(" · ")}</span>
                </td>
                <td className="p-3">
                  <span className="block font-medium">{v.title}</span>
                  <span className="text-[11px] text-muted-foreground">{[v.expected_label, v.customer, v.purpose].filter(Boolean).join(" · ") || "No site"}</span>
                </td>
                <td className="p-3 tabular-nums">{when(v.started_at)}<span className="block text-muted-foreground">to {time(v.ended_at)}</span></td>
                <td className="p-3">
                  <VerificationBadge status={v.start_status} short />
                  {v.start_distance_m !== null && <span className="mt-1 block text-[11px] text-muted-foreground">{formatDistance(v.start_distance_m)}{v.start_accuracy !== null ? ` · ±${Math.round(v.start_accuracy)} m` : ""}</span>}
                </td>
                <td className="p-3">
                  {v.end_status ? <VerificationBadge status={v.end_status} short /> : <span className="text-muted-foreground">—</span>}
                  {v.end_distance_m !== null && <span className="mt-1 block text-[11px] text-muted-foreground">{formatDistance(v.end_distance_m)}</span>}
                </td>
                <td className="p-3 tabular-nums">{v.photos}</td>
                <td className="p-3">{v.report_id ? <Link className="text-primary hover:underline" href={`/field/reports/${v.report_id}`}>{v.report_title}</Link> : "—"}</td>
                <td className="p-3 text-right">
                  <Link className="font-medium text-primary hover:underline" href={`/field/tracking?user=${v.user_id}&date=${new Date(v.started_at).toLocaleDateString("en-CA", { timeZone: f.timezone })}`}>Route</Link>
                </td>
              </tr>
            ))}
            {!visits.length && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No visits match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
