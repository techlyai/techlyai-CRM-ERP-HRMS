import type { OverviewRow } from "@/lib/field";
import { verificationInfo, reviewInfo } from "@/lib/field";

type Field = "dates" | "user" | "tl" | "department" | "verification" | "review" | "source" | "status";
const reportStatuses = ["Draft", "Submitted", "Clarification Required", "Resubmitted", "Escalated", "Approved", "Rejected"];

/** Plain GET filter form for field list pages (works without JavaScript). */
export function FilterBar({
  action,
  rows,
  values,
  fields,
  statuses = reportStatuses,
}: {
  action: string;
  rows: OverviewRow[];
  values: Record<string, string | undefined>;
  fields: Field[];
  statuses?: string[];
}) {
  const leaders = [...new Map(rows.filter((r) => r.team_leader).map((r) => [r.team_leader!.id, r.team_leader!.name])).entries()];
  const departments = [...new Set(rows.map((r) => r.department).filter(Boolean))].sort() as string[];
  const has = (f: Field) => fields.includes(f);
  return (
    <form method="get" action={action} className="panel mb-4 grid grid-cols-2 gap-2 p-3 text-xs sm:grid-cols-4 xl:grid-cols-8">
      {has("dates") && (
        <>
          <label className="mb-0"><span className="text-muted-foreground">From</span><input type="date" name="from" defaultValue={values.from} className="mt-1 h-9" /></label>
          <label className="mb-0"><span className="text-muted-foreground">To</span><input type="date" name="to" defaultValue={values.to} className="mt-1 h-9" /></label>
        </>
      )}
      {has("user") && (
        <label className="col-span-2 mb-0 sm:col-span-1">
          <span className="text-muted-foreground">Employee</span>
          <select name="user" defaultValue={values.user || ""} className="mt-1 h-9">
            <option value="">Everyone</option>
            {rows.map((r) => <option key={r.user_id} value={r.user_id}>{r.name}{r.employee_id ? ` · ${r.employee_id}` : ""}</option>)}
          </select>
        </label>
      )}
      {has("tl") && (
        <label className="mb-0">
          <span className="text-muted-foreground">Team Leader</span>
          <select name="tl" defaultValue={values.tl || ""} className="mt-1 h-9">
            <option value="">Any</option>
            {leaders.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
      )}
      {has("department") && (
        <label className="mb-0">
          <span className="text-muted-foreground">Department</span>
          <select name="department" defaultValue={values.department || ""} className="mt-1 h-9">
            <option value="">Any</option>
            {departments.map((d) => <option key={d}>{d}</option>)}
          </select>
        </label>
      )}
      {has("verification") && (
        <label className="mb-0">
          <span className="text-muted-foreground">Location result</span>
          <select name="verification" defaultValue={values.verification || ""} className="mt-1 h-9">
            <option value="">Any</option>
            {Object.entries(verificationInfo).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
      )}
      {has("review") && (
        <label className="mb-0">
          <span className="text-muted-foreground">Review</span>
          <select name="review" defaultValue={values.review || ""} className="mt-1 h-9">
            <option value="">Any</option>
            {Object.entries(reviewInfo).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
      )}
      {has("source") && (
        <label className="mb-0">
          <span className="text-muted-foreground">Source</span>
          <select name="source" defaultValue={values.source || ""} className="mt-1 h-9">
            <option value="">Any</option>
            <option value="camera">Camera capture</option>
            <option value="gallery">Gallery upload</option>
          </select>
        </label>
      )}
      {has("status") && (
        <label className="mb-0">
          <span className="text-muted-foreground">Status</span>
          <select name="status" defaultValue={values.status || ""} className="mt-1 h-9">
            <option value="">Any</option>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      )}
      <div className="col-span-2 flex items-end gap-2 sm:col-span-1">
        <button className="h-9 rounded-lg bg-primary px-3 font-medium text-primary-foreground hover:bg-primary-hover">Apply</button>
        <a href={action} className="flex h-9 items-center px-2 text-muted-foreground hover:text-foreground">Reset</a>
      </div>
    </form>
  );
}
