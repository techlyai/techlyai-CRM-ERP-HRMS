"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { context } from "./database";

export type FieldResult<T = undefined> = { ok: boolean; error?: string; data?: T };
async function guard<T>(fn: () => Promise<T>): Promise<FieldResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
    if (e instanceof z.ZodError) return { ok: false, error: e.errors.map((x) => x.message).join("; ") };
    return { ok: false, error: e instanceof Error ? e.message : "Request failed" };
  }
}
const uuid = z.string().uuid();
const optUuid = z.string().uuid().nullable().optional();
const position = z
  .object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
    accuracy: z.number().finite().nonnegative().max(1e6),
  })
  .nullable()
  .optional();
const pos = (p: z.infer<typeof position>) => ({ p_lat: p?.lat ?? null, p_lng: p?.lng ?? null, p_accuracy: p?.accuracy ?? null });
const text = (max: number) => z.string().max(max).optional().default("");
const refresh = () => revalidatePath("/field", "layout");

// ---- Employee: sessions, points, visits, photos -------------------------------

export async function startFieldSession(input: { position?: z.infer<typeof position>; clientId: string }) {
  return guard(async () => {
    const { db } = await context();
    const id = await db.rpc<string>("field_start_session", { ...pos(position.parse(input.position)), p_client: uuid.parse(input.clientId) });
    refresh();
    revalidatePath("/");
    return id;
  });
}

export async function endFieldSession(input: { session: string; position?: z.infer<typeof position>; clientId: string }) {
  return guard(async () => {
    const { db } = await context();
    await db.rpc("field_end_session", { p_session: uuid.parse(input.session), ...pos(position.parse(input.position)), p_client: uuid.parse(input.clientId) });
    refresh();
    revalidatePath("/");
  });
}

const point = z
  .object({
    client_id: uuid,
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
    accuracy: z.number().finite().nonnegative().max(1e6),
    captured_at: z.string().datetime(),
    source: z.enum(["track", "visit", "photo"]).default("track"),
  })
  .strict();
/** Sends queued tracking points; the server ignores duplicates and anything outside the session window. */
export async function sendFieldPoints(input: { session: string; points: unknown }) {
  return guard(async () => {
    const { db } = await context();
    return db.rpc<{ accepted: number; skipped: number; active: boolean; window_end: string }>("field_record_points", {
      p_session: uuid.parse(input.session),
      p_points: z.array(point).max(200).parse(input.points),
    });
  });
}

const visit = z
  .object({
    title: z.string().trim().min(1, "Give the visit a title").max(200),
    purpose: text(1000),
    customer: text(200),
    description: text(5000),
    notes: text(2000),
    site_id: optUuid,
    project_id: optUuid,
  })
  .strict();
export async function startFieldVisit(input: { session: string; data: unknown; position?: z.infer<typeof position>; clientId: string }) {
  return guard(async () => {
    const { db } = await context();
    const id = await db.rpc<string>("field_start_visit", {
      p_session: uuid.parse(input.session),
      p_data: visit.parse(input.data),
      ...pos(position.parse(input.position)),
      p_client: uuid.parse(input.clientId),
    });
    refresh();
    return id;
  });
}
export async function endFieldVisit(input: { visit: string; position?: z.infer<typeof position>; clientId: string }) {
  return guard(async () => {
    const { db } = await context();
    await db.rpc("field_end_visit", { p_visit: uuid.parse(input.visit), ...pos(position.parse(input.position)), p_client: uuid.parse(input.clientId) });
    refresh();
  });
}

const photo = z
  .object({
    client_key: uuid,
    session_id: uuid,
    visit_id: optUuid,
    site_id: optUuid,
    project_id: optUuid,
    source: z.enum(["camera", "gallery"]),
    lat: z.number().finite().min(-90).max(90).nullable(),
    lng: z.number().finite().min(-180).max(180).nullable(),
    accuracy: z.number().finite().nonnegative().max(1e6).nullable(),
    captured_at: z.string().datetime().nullable(),
    file_name: z.string().min(1).max(255),
    mime: z.enum(["image/jpeg", "image/png", "image/webp"], { errorMap: () => ({ message: "Use a JPG, PNG or WebP photo" }) }),
    size: z.number().int().min(1).max(20 * 1024 * 1024, "Photos can be up to 20 MB"),
    title: text(200),
    purpose: text(1000),
    customer: text(200),
    description: text(5000),
    notes: text(2000),
  })
  .strict();
/** Registers a photo with its reported location; the image is uploaded right after. */
export async function createFieldPhoto(input: unknown) {
  return guard(async () => {
    const { db } = await context();
    const result = await db.rpc<{ id: string; verification: string; distance_m: number | null; expected_label: string | null; file_path: string | null }>(
      "field_create_photo",
      { p_data: photo.parse(input) },
    );
    refresh();
    return result;
  });
}

// ---- Reviewers ----------------------------------------------------------------

export async function reviewFieldPhoto(input: { photo: string; action: "approve" | "reject" | "clarify"; note?: string }) {
  return guard(async () => {
    const { db } = await context();
    await db.rpc("field_review_photo", {
      p_id: uuid.parse(input.photo),
      p_action: z.enum(["approve", "reject", "clarify"]).parse(input.action),
      p_note: z.string().max(2000).optional().default("").parse(input.note),
    });
    refresh();
  });
}
export async function replyFieldPhoto(input: { photo: string; body: string }) {
  return guard(async () => {
    const { db } = await context();
    await db.rpc("field_reply_photo", { p_id: uuid.parse(input.photo), p_body: z.string().trim().min(1, "Write a reply").max(5000).parse(input.body) });
    refresh();
  });
}

// ---- Reports --------------------------------------------------------------------

const report = z
  .object({
    title: z.string().trim().min(1, "Give the report a title").max(200),
    report_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    session_id: optUuid,
    work_completed: text(20000),
    customer: text(200),
    project_id: optUuid,
    issues: text(10000),
    next_steps: text(10000),
    eod_record_id: optUuid,
    photo_ids: z.array(uuid).max(200),
    visit_ids: z.array(uuid).max(200),
    version: z.number().int().optional(),
  })
  .strict();
export async function saveFieldReport(input: { id: string | null; data: unknown }) {
  return guard(async () => {
    const { db } = await context();
    const id = await db.rpc<string>("field_save_report", { p_id: input.id ? uuid.parse(input.id) : null, p_data: report.parse(input.data) });
    refresh();
    return id;
  });
}
export async function fieldReportAction(input: { id: string; action: string; version: number; note?: string }) {
  return guard(async () => {
    const { db } = await context();
    await db.rpc("field_report_action", {
      p_id: uuid.parse(input.id),
      p_action: z.enum(["submit", "reply", "question", "escalate", "approve", "reject"]).parse(input.action),
      p_version: z.number().int().parse(input.version),
      p_note: z.string().max(5000).optional().default("").parse(input.note),
    });
    refresh();
  });
}

// ---- Configuration (field.manage) ----------------------------------------------

const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Use HH:MM times");
const assignment = z
  .object({
    enabled: z.boolean(),
    team_leader_id: optUuid,
    reporting_admin_id: optUuid,
    schedule_days: z.array(z.number().int().min(0).max(6)).min(1, "Choose at least one working day"),
    schedule_start: time,
    schedule_end: time,
    interval_seconds: z.number().int().min(60).max(3600),
    photo_upload: z.boolean(),
    gallery_allowed: z.boolean(),
    geofence_required: z.boolean(),
    default_radius_m: z.number().int().min(10).max(50000),
    site_ids: z.array(uuid).max(500),
    viewer_ids: z.array(uuid).max(100),
  })
  .strict()
  .refine((a) => a.schedule_end > a.schedule_start, { message: "The schedule must end after it starts" });
export async function saveFieldAssignment(input: { user: string; data: unknown }) {
  return guard(async () => {
    const { db } = await context();
    await db.rpc("field_save_assignment", { p_user: uuid.parse(input.user), p_data: assignment.parse(input.data) });
    refresh();
    revalidatePath("/", "layout");
  });
}
const site = z
  .object({
    name: z.string().trim().min(1, "Give the site a name").max(160),
    customer: text(200),
    address: text(500),
    latitude: z.number({ invalid_type_error: "Latitude must be a number" }).finite().min(-90).max(90),
    longitude: z.number({ invalid_type_error: "Longitude must be a number" }).finite().min(-180).max(180),
    radius_m: z.number().int().min(10).max(50000),
    active: z.boolean(),
  })
  .strict();
export async function saveFieldSite(input: { id: string | null; data: unknown }) {
  return guard(async () => {
    const { db } = await context();
    const id = await db.rpc<string>("field_save_site", { p_id: input.id ? uuid.parse(input.id) : null, p_data: site.parse(input.data) });
    refresh();
    return id;
  });
}
const policy = z
  .object({
    retention_days: z.number().int().min(30).max(3650),
    time_skew_minutes: z.number().int().min(1).max(1440),
    notify: z.record(z.boolean()),
  })
  .strict();
export async function saveFieldPolicy(input: unknown) {
  return guard(async () => {
    const { db } = await context();
    await db.rpc("field_save_policy", { p_data: policy.parse(input) });
    refresh();
  });
}
