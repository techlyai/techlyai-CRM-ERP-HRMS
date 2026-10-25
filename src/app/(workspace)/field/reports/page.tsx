import Link from "next/link";
import { Plus } from "lucide-react";
import { context } from "@/lib/database";
import { fieldContext } from "@/lib/field-data";
import { fieldParams } from "@/lib/field-params";
import type { FieldReport, OverviewRow } from "@/lib/field";
import { FilterBar } from "@/components/field/filter-bar";
import { ReportBadge } from "@/components/field/badges";
export const metadata = { title: "Field reports" };

type Row = FieldReport & { name: string; employee_id: string | null; tl_name: string | null; photos: number; visits: number; failures: number };

export default async function ReportsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const { db, profile } = await context();
  const f = await fieldContext(db, profile);
  const p = fieldParams(searchParams, f.today, 30);
  const rows = await db.rpc<OverviewRow[]>("field_overview", { p_date: f.today });
  const reports = await db.run(async (c) => {
    const where = ["r.report_date between $1::date and $2::date"];
    const values: unknown[] = [p.from, p.to];
    const add = (sql: string, v: unknown) => {
      values.push(v);
      where.push(sql.replace("?", "$" + values.length));
    };
    if (p.user) add("r.user_id=?::uuid", p.user);
    if (p.tl) add("a.team_leader_id=?::uuid", p.tl);
    if (p.department) add("pr.department=?", p.department);
    if (p.status) add("r.status=?", p.status);
    // Reviewers do not see other people's drafts.
    return (
      await c.query(
        `select r.*,pr.full_name as name,pr.employee_id,tl.full_name as tl_name,
          (select count(*)::int from public.field_photos x where x.report_id=r.id) as photos,
          (select count(*)::int from public.field_visits x where x.report_id=r.id) as visits,
          (select count(*)::int from public.field_photos x where x.report_id=r.id and x.verification in ('outside','inaccurate','gps_unavailable')) as failures
         from public.field_reports r join public.field_people pr on pr.id=r.user_id left join public.field_assignments a on a.user_id=r.user_id
         left join public.field_people tl on tl.id=a.team_leader_id
         where ${where.join(" and ")} and (r.status<>'Draft' or r.user_id=private.current_user_id())
         order by r.report_date desc,r.updated_at desc limit 500`,
        values,
      )
    ).rows as Row[];
  });
  const when = (v: string | null) => (v ? new Date(v).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: f.timezone }) : "—");
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="section-title">Field reports</h2>
          <p className="mt-1 text-xs text-muted-foreground">Reports with their visits, GPS photos and review history.</p>
        </div>
        <div className="flex items-center gap-3">
          {f.abilities.export && (
            <a className="text-xs font-medium text-primary hover:underline" href={`/api/field/export?type=reports&from=${p.from}&to=${p.to}`}>Export CSV</a>
          )}
          {f.assignment && (
            <Link href="/field/reports/new" className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-xs font-medium text-primary-foreground hover:bg-primary-hover">
              <Plus size={14} /> New field report
            </Link>
          )}
        </div>
      </div>
      <FilterBar action="/field/reports" rows={rows} values={p} fields={["dates", "user", "tl", "department", "status"]} />
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>{["Report", "Employee", "Date", "Status", "Visits · photos", "Submitted", ""].map((h) => <th key={h} className="p-3 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3 font-medium">{r.title}{r.customer ? <span className="block text-[11px] font-normal text-muted-foreground">{r.customer}</span> : null}</td>
                <td className="p-3">{r.name}<span className="block text-[11px] text-muted-foreground">{[r.employee_id, r.tl_name && "TL " + r.tl_name].filter(Boolean).join(" · ")}</span></td>
                <td className="p-3 tabular-nums">{r.report_date}</td>
                <td className="p-3"><ReportBadge status={r.status} /></td>
                <td className="p-3 tabular-nums">{r.visits} · {r.photos}{r.failures ? <span className="ml-1 text-danger">({r.failures} location issue{r.failures > 1 ? "s" : ""})</span> : null}</td>
                <td className="p-3">{when(r.submitted_at)}</td>
                <td className="p-3 text-right"><Link className="font-medium text-primary hover:underline" href={`/field/reports/${r.id}`}>Open</Link></td>
              </tr>
            ))}
            {!reports.length && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No field reports match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
