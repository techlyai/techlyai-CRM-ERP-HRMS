import { notFound } from "next/navigation";
import { z } from "zod";
import { context } from "@/lib/database";
import { fieldContext } from "@/lib/field-data";
import type { FieldEvent, FieldPhoto, FieldReport, FieldSession, FieldVisit } from "@/lib/field";
import { ReportView, type ReportFile } from "@/components/field/report-view";
export const metadata = { title: "Field report" };

export default async function ReportPage({ params, searchParams }: { params: { id: string }; searchParams: { date?: string } }) {
  const { db, profile } = await context();
  const f = await fieldContext(db, profile);
  const isNew = params.id === "new";
  if (!isNew && !z.string().uuid().safeParse(params.id).success) notFound();
  if (isNew && !f.assignment) return <p className="panel p-6 text-sm text-muted-foreground">Field reports are written by field employees.</p>;
  const data = await db.run(async (c) => {
    const report = isNew ? null : ((await c.query("select * from public.field_reports where id=$1", [params.id])).rows[0] as FieldReport | undefined) || null;
    if (!isNew && !report) return null;
    if (report && report.status === "Draft" && report.user_id !== profile.id) return null;
    const owner = report?.user_id || profile.id;
    const date = report?.report_date || (/^\d{4}-\d{2}-\d{2}$/.test(searchParams.date || "") ? searchParams.date! : f.today);
    const person = (await c.query("select id,full_name,employee_id,department from public.field_people where id=$1", [owner])).rows[0];
    const linkedPhotos = report ? ((await c.query("select * from public.field_photos where report_id=$1 order by uploaded_at", [report.id])).rows as FieldPhoto[]) : [];
    const linkedVisits = report ? ((await c.query("select * from public.field_visits where report_id=$1 order by started_at", [report.id])).rows as FieldVisit[]) : [];
    const files = report ? ((await c.query("select id,name,mime,size,created_at from public.field_report_files where report_id=$1 order by created_at", [report.id])).rows as ReportFile[]) : [];
    const events = report
      ? ((await c.query("select e.*,pr.full_name as actor_name from public.field_events e left join public.field_people pr on pr.id=e.actor_id where e.report_id=$1 order by e.id", [report.id])).rows as (FieldEvent & { actor_name: string | null })[])
      : [];
    const sessions = (
      await c.query("select * from public.field_sessions where user_id=$1 and (started_at at time zone $2)::date=$3::date order by started_at", [owner, f.timezone, date])
    ).rows as FieldSession[];
    // Choices for the editor: the owner's own photos and visits for that day.
    const editable = owner === profile.id && (!report || ["Draft", "Clarification Required", "Rejected"].includes(report.status));
    const dayPhotos = editable
      ? ((await c.query("select * from public.field_photos where user_id=$1 and (uploaded_at at time zone $2)::date=$3::date order by uploaded_at", [owner, f.timezone, date])).rows as FieldPhoto[])
      : [];
    const dayVisits = editable
      ? ((await c.query("select * from public.field_visits where user_id=$1 and (started_at at time zone $2)::date=$3::date order by started_at", [owner, f.timezone, date])).rows as FieldVisit[])
      : [];
    const eods = editable
      ? ((await c.query("select id,title from public.records where module='eod' and owner_id=$1 and data->>'report_date'=$2 order by updated_at desc", [owner, date])).rows as { id: string; title: string }[])
      : [];
    const projects = (await c.query("select id,title from public.records where module='projects' and status<>'Archived' order by title limit 200")).rows as { id: string; title: string }[];
    const abilities = report
      ? (await c.query("select private.field_can($1,'review') as review,private.field_can($1,'approve') as approve", [owner])).rows[0]
      : { review: false, approve: false };
    return { report, person, linkedPhotos, linkedVisits, files, events, sessions, dayPhotos, dayVisits, eods, projects, abilities, date, editable };
  });
  if (!data) notFound();
  return <ReportView {...data} me={profile.id} timezone={f.timezone} />;
}
