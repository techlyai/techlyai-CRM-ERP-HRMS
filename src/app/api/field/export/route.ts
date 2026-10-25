export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { context } from "@/lib/database";

const queries = {
  photos: `select p.id as photo_id,pr.employee_id,pr.full_name as employee_name,p.session_id,p.visit_id,p.report_id,p.source,p.title,p.customer,p.purpose,
    p.latitude,p.longitude,p.accuracy_m,p.captured_at as device_captured_at,p.uploaded_at as server_registered_at,p.file_uploaded_at,
    p.expected_label,p.expected_lat,p.expected_lng,p.expected_radius_m,p.distance_m,p.verification,p.review_status,rv.full_name as reviewer,p.reviewed_at,p.review_notes
   from public.field_photos p join public.field_people pr on pr.id=p.user_id left join public.field_people rv on rv.id=p.reviewer_id
   where (p.uploaded_at at time zone $1)::date between $2::date and $3::date and private.field_can(p.user_id,'export') order by p.uploaded_at`,
  visits: `select v.id as visit_id,pr.employee_id,pr.full_name as employee_name,v.session_id,v.title,v.purpose,v.customer,v.expected_label,v.expected_radius_m,
    v.started_at,v.ended_at,v.start_lat,v.start_lng,v.start_accuracy,v.start_distance_m,v.start_status,v.end_lat,v.end_lng,v.end_accuracy,v.end_distance_m,v.end_status
   from public.field_visits v join public.field_people pr on pr.id=v.user_id
   where (v.started_at at time zone $1)::date between $2::date and $3::date and private.field_can(v.user_id,'export') order by v.started_at`,
  reports: `select r.id as report_id,pr.employee_id,pr.full_name as employee_name,r.report_date,r.title,r.status,r.customer,r.work_completed,r.issues,r.next_steps,
    r.submitted_at,d.full_name as decided_by,r.decided_at,
    (select count(*) from public.field_photos x where x.report_id=r.id) as photos,(select count(*) from public.field_visits x where x.report_id=r.id) as visits
   from public.field_reports r join public.field_people pr on pr.id=r.user_id left join public.field_people d on d.id=r.decided_by
   where r.report_date between $2::date and $3::date and $1::text is not null and r.status<>'Draft' and private.field_can(r.user_id,'export') order by r.report_date`,
};
const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  // Neutralise spreadsheet formulas and quote every value.
  return '"' + (/^[=+\-@]/.test(s) ? "'" + s : s).replaceAll('"', '""') + '"';
};

/** CSV export of field records the signed-in person may export. */
export async function GET(req: NextRequest) {
  try {
    const { db } = await context();
    const p = req.nextUrl.searchParams;
    const type = z.enum(["photos", "visits", "reports"]).parse(p.get("type"));
    const from = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(p.get("from"));
    const to = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(p.get("to"));
    const rows = await db.run(async (c) => {
      const tz = (await c.query("select coalesce(data->>'timezone','Asia/Kolkata') tz from public.settings where id=1")).rows[0].tz;
      const r = await c.query(queries[type], [tz, from, to]);
      return { fields: r.fields.map((f) => f.name), rows: r.rows };
    });
    const csv = [rows.fields.map(cell).join(","), ...rows.rows.map((r) => rows.fields.map((f) => cell(r[f])).join(","))].join("\r\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="field-${type}-${from}-to-${to}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Export unavailable" }, { status: 400 });
  }
}
