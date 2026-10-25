import type { Database } from "./database";
import { can, grants } from "./database";
import type { Profile } from "./modules";
import type { FieldAssignment, FieldSite, FieldSession, FieldVisit } from "./field";

export type FieldAbilities = {
  /** Sees other people's field records (still limited by scope and assignment in the database). */
  view: boolean;
  review: boolean;
  approve: boolean;
  export: boolean;
  manage: boolean;
};
export type FieldContext = {
  assignment: FieldAssignment | null;
  abilities: FieldAbilities;
  timezone: string;
  today: string;
};

/** What the signed-in person can do in Field operations. UI hints; the database enforces. */
export async function fieldContext(db: Database, profile: Profile): Promise<FieldContext> {
  const permissions = await grants(db);
  return db.run(async (c) => {
    const assignment = (await c.query("select * from public.field_assignments where user_id=$1", [profile.id])).rows[0] || null;
    const tz = (await c.query("select coalesce(data->>'timezone','Asia/Kolkata') tz from public.settings where id=1")).rows[0]?.tz || "Asia/Kolkata";
    const today = (await c.query("select (now() at time zone $1)::date::text d", [tz])).rows[0].d as string;
    const has = (a: string) => can(profile, permissions, "field", a);
    return {
      assignment,
      abilities: { view: has("view"), review: has("review"), approve: has("approve"), export: has("export"), manage: has("manage") },
      timezone: tz,
      today,
    };
  });
}

/** The employee's current session (if any), today's visits and usable sites. */
export async function myFieldState(db: Database, profile: Profile, today: string, timezone: string) {
  return db.run(async (c) => {
    const session = ((await c.query("select * from public.field_sessions where user_id=$1 and status='active'", [profile.id])).rows[0] || null) as FieldSession | null;
    const sessions = (
      await c.query("select * from public.field_sessions where user_id=$1 and (started_at at time zone $2)::date=$3::date order by started_at desc", [profile.id, timezone, today])
    ).rows as FieldSession[];
    const visits = (
      await c.query("select * from public.field_visits where user_id=$1 and (started_at at time zone $2)::date=$3::date order by started_at desc", [profile.id, timezone, today])
    ).rows as FieldVisit[];
    const assigned = (await c.query("select site_id from public.field_assignment_sites where user_id=$1", [profile.id])).rows.map((r) => r.site_id as string);
    const sites = (
      await c.query(
        "select * from public.field_sites where active and ($1::uuid[] = '{}' or id = any($1)) order by name",
        [assigned],
      )
    ).rows as FieldSite[];
    const attendance = (
      await c.query("select data from public.records where module='attendance' and owner_id=$1 and data->>'date'=$2", [profile.id, today])
    ).rows[0]?.data as { clock_in?: string; clock_out?: string } | undefined;
    const projects = (await c.query("select id,title from public.records where module='projects' and status<>'Archived' order by title limit 200")).rows as { id: string; title: string }[];
    return { session, sessions, visits, sites, attendance: attendance || null, projects };
  });
}

export function validDate(value: string | undefined, fallback: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "") && value! <= fallback ? value! : fallback;
}

export type PhotoRow = import("./field").FieldPhoto & {
  name: string;
  employee_id: string | null;
  department: string | null;
  team_leader_id: string | null;
  can_review: boolean;
  visit_title: string | null;
  reviewer_name: string | null;
};
export type PhotoFilters = {
  from: string;
  to: string;
  user?: string;
  tl?: string;
  department?: string;
  verification?: string;
  review?: string;
  source?: string;
  /** Only photos whose result is not "verified" and that still await a decision. */
  queue?: boolean;
  photo?: string;
};
/** Photos the viewer may see (row level security), with their review threads. */
export async function loadPhotos(db: Database, f: PhotoFilters, timezone: string) {
  return db.run(async (c) => {
    const where: string[] = ["(p.uploaded_at at time zone $1)::date between $2::date and $3::date"];
    const values: unknown[] = [timezone, f.from, f.to];
    const add = (sql: string, v: unknown) => {
      values.push(v);
      where.push(sql.replace("?", "$" + values.length));
    };
    if (f.user) add("p.user_id=?::uuid", f.user);
    if (f.tl) add("a.team_leader_id=?::uuid", f.tl);
    if (f.department) add("pr.department=?", f.department);
    if (f.verification === "pending") where.push("p.file_path is null");
    else if (f.verification) add("p.verification=? and p.file_path is not null", f.verification);
    if (f.review) add("p.review_status=?", f.review);
    if (f.source) add("p.source=?", f.source);
    if (f.queue) where.push("p.review_status in ('pending','clarification') and (p.verification<>'verified' or p.file_path is null)");
    const photos = (
      await c.query(
        `select p.*,pr.full_name as name,pr.employee_id,pr.department,a.team_leader_id,private.field_can(p.user_id,'review') as can_review,
          v.title as visit_title,rv.full_name as reviewer_name
         from public.field_photos p join public.field_people pr on pr.id=p.user_id left join public.field_assignments a on a.user_id=p.user_id
         left join public.field_visits v on v.id=p.visit_id left join public.field_people rv on rv.id=p.reviewer_id
         where ${f.photo ? "p.id=$1::uuid" : where.join(" and ")} order by p.uploaded_at desc limit 200`,
        f.photo ? [f.photo] : values,
      )
    ).rows as PhotoRow[];
    const events = photos.length
      ? ((
          await c.query(
            "select e.*,pr.full_name as actor_name from public.field_events e left join public.field_people pr on pr.id=e.actor_id where e.photo_id = any($1) order by e.id",
            [photos.map((p) => p.id)],
          )
        ).rows as (import("./field").FieldEvent & { actor_name: string | null })[])
      : [];
    return { photos, events };
  });
}
