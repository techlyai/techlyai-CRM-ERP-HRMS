"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { context } from "./database";
import type { GeofenceCheck, Office } from "./geo";

export type AttendanceResult<T = undefined> = { ok: boolean; error?: string; data?: T };
async function guard<T>(fn: () => Promise<T>): Promise<AttendanceResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
    if (e instanceof z.ZodError)
      return { ok: false, error: e.errors.map((x) => x.message).join("; ") };
    return { ok: false, error: e instanceof Error ? e.message : "Request failed" };
  }
}
const uuid = z.string().uuid();
const position = z
  .object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
    accuracy: z.number().finite().nonnegative(),
  })
  .strict();

/**
 * The signed-in person's office and, when a position is given, the server's geofence
 * result for it. Nothing is stored; check-in and check-out repeat the check.
 */
export async function checkMyLocation(input?: { lat: number; lng: number; accuracy: number }) {
  return guard(async () => {
    const { db } = await context();
    const p = input ? position.parse(input) : null;
    return db.rpc<{ office: Office | null; check: GeofenceCheck | null }>("my_attendance_location", {
      p_lat: p?.lat ?? null,
      p_lng: p?.lng ?? null,
      p_accuracy: p?.accuracy ?? null,
    });
  });
}

const office = z
  .object({
    name: z.string().trim().min(1, "Give the office a name").max(120),
    address: z.string().trim().max(500).default(""),
    latitude: z.number({ invalid_type_error: "Latitude must be a number" }).finite().min(-90).max(90),
    longitude: z.number({ invalid_type_error: "Longitude must be a number" }).finite().min(-180).max(180),
    radius_m: z.number({ invalid_type_error: "Radius must be a number" }).int("Radius must be whole metres").min(10).max(50000),
    require_inside: z.boolean(),
    is_default: z.boolean(),
    active: z.boolean(),
  })
  .strict();

/** Creates (id null) or updates an office; the database requires location management permission. */
export async function saveOfficeLocation(input: { id: string | null; data: unknown }) {
  return guard(async () => {
    const { db } = await context();
    const id = await db.rpc<string>("save_office_location", {
      p_id: input.id ? uuid.parse(input.id) : null,
      p_data: office.parse(input.data),
    });
    revalidatePath("/settings/locations");
    revalidatePath("/", "layout");
    return id;
  });
}

/** Assigns a person to an office (or clears it); the database checks who may do this. */
export async function setAttendanceLocation(input: {
  user: string;
  location: string | null;
  radius: number | null;
  allowRemote: boolean;
}) {
  return guard(async () => {
    const { db } = await context();
    await db.rpc("set_attendance_location", {
      p_user: uuid.parse(input.user),
      p_location: input.location ? uuid.parse(input.location) : null,
      p_radius: input.radius === null ? null : z.number().int().min(10).max(50000).parse(input.radius),
      p_allow_remote: z.boolean().parse(input.allowRemote),
    });
    revalidatePath("/settings/locations");
    revalidatePath("/", "layout");
  });
}
