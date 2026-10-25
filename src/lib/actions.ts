"use server";
import { context, serviceDB, setSession } from "./database";
import {
  authenticate,
  revokeSession,
  replacePassword,
  provisionUser,
} from "./auth";
import { moduleMap, validateRecord, actions } from "./modules";
import { normalizePhone } from "./domain";
import {
  consumeInvite,
  inviteMessages,
  sendWelcomeInvite,
  validInviteToken,
} from "./invites";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
const uuid = z.string().uuid();
export type Result = {
  ok: boolean;
  error?: string;
  id?: string;
  message?: string;
};
async function safely(fn: () => Promise<Result>): Promise<Result> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
    return {
      ok: false,
      error:
        e instanceof z.ZodError
          ? e.errors.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")
          : e instanceof Error
            ? e.message
            : "Request failed",
    };
  }
}
export async function login(input: {
  phone: string;
  password: string;
}): Promise<Result> {
  return safely(async () => {
    z.string().min(1).max(200).parse(input.password);
    const phone = normalizePhone(input.phone);
    const ip = headers().get("x-forwarded-for")?.split(",")[0] || "local";
    const hash = (s: string) => createHash("sha256").update(s).digest("hex");
    const db = serviceDB();
    const valid = await db.rpc<boolean>("login_rate_limit", {
      p_key: hash("phone:" + phone),
    });
    const ipValid = await db.rpc<boolean>("login_rate_limit", {
      p_key: hash("ip:" + ip + ":" + phone),
    });
    if (!valid || !ipValid)
      throw Error("Too many attempts. Try again in 15 minutes.");
    const session = await authenticate(phone, input.password);
    await db.rpc("clear_login_limits", {
      p_keys: [hash("phone:" + phone), hash("ip:" + ip + ":" + phone)],
    });
    await setSession(session.token);
    return { ok: true };
  });
}
export async function logout() {
  const token = cookies().get("techly-session")?.value;
  if (token) await revokeSession(token);
  cookies().delete("techly-session");
  redirect("/login");
}
export async function changePassword(password: string): Promise<Result> {
  return safely(async () => {
    z.string()
      .min(12)
      .max(128)
      .refine(
        (p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p),
        "Use upper and lower case letters and a number",
      )
      .parse(password);
    const { token } = await context(true);
    await replacePassword(token, password);
    return { ok: true };
  });
}
export async function saveRecord(input: {
  module: string;
  title: string;
  owner_id?: string;
  data: unknown;
  id?: string;
  version?: number;
  status?: string;
}): Promise<Result> {
  return safely(async () => {
    const { db, profile } = await context();
    const data = validateRecord(input.module, input.data);
    const m = moduleMap[input.module];
    const title = z.string().trim().min(1).max(200).parse(input.title);
    const owner = uuid.parse(input.owner_id || profile.id);
    if (input.status && !m.statuses.includes(input.status))
      throw Error("Invalid status");
    const id = await db.rpc<string>("save_record", {
      p_module: input.module,
      p_title: title,
      p_data: data,
      p_owner: owner,
      p_id: input.id ? uuid.parse(input.id) : null,
      p_version: input.version ?? null,
      p_status: input.status ?? null,
    });
    revalidatePath("/");
    return { ok: true, id };
  });
}
export async function recordAction(input: {
  id: string;
  version: number;
  action: string;
  note?: string;
  expiry?: string;
  until?: string;
}): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    const id = uuid.parse(input.id);
    z.number().int().positive().parse(input.version);
    if (input.action === "renew")
      await db.rpc("renew_record", {
        p_id: id,
        p_expiry: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .parse(input.expiry),
        p_version: input.version,
      });
    else if (input.action === "snooze")
      await db.rpc("snooze_record", {
        p_id: id,
        p_until: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .parse(input.until),
      });
    else if (
      ["hold-renewal", "cancel-renewal", "resume-renewal"].includes(
        input.action,
      )
    )
      await db.rpc("set_renewal_status", {
        p_id: id,
        p_status:
          input.action === "hold-renewal"
            ? "On Hold"
            : input.action === "cancel-renewal"
              ? "Cancelled"
              : "Active",
        p_version: input.version,
      });
    else if (input.action === "receive")
      await db.rpc("receive_purchase", { p_id: id, p_version: input.version });
    else
      await db.rpc("workflow", {
        p_id: id,
        p_action: z
          .enum([
            "submit",
            "approve",
            "reject",
            "clarify",
            "cancel_request",
            "cancel_approve",
          ])
          .parse(input.action),
        p_version: input.version,
        p_note: input.note || "",
      });
    revalidatePath("/");
    return { ok: true };
  });
}
export async function clock(input: {
  action: "in" | "out";
  lat?: number;
  lng?: number;
  accuracy?: number;
  wfh?: boolean;
}): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    z.enum(["in", "out"]).parse(input.action);
    if (input.lat !== undefined)
      z.number().finite().min(-90).max(90).parse(input.lat);
    if (input.lng !== undefined)
      z.number().finite().min(-180).max(180).parse(input.lng);
    if (input.accuracy !== undefined)
      z.number().finite().nonnegative().parse(input.accuracy);
    const id = await db.rpc<string>("clock_attendance", {
      p_action: input.action,
      p_lat: input.lat ?? null,
      p_lng: input.lng ?? null,
      p_accuracy: input.accuracy ?? null,
      p_wfh: input.wfh ?? false,
    });
    revalidatePath("/");
    return { ok: true, id };
  });
}
export async function addQuestion(
  record: string,
  body: string,
  parent?: string,
): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    const id = await db.rpc<string>("record_question", {
      p_record: uuid.parse(record),
      p_body: z.string().trim().min(1).max(20000).parse(body),
      p_parent: parent ? uuid.parse(parent) : null,
    });
    revalidatePath("/");
    return { ok: true, id };
  });
}
export async function resolveQuestion(
  id: string,
  resolved: boolean,
): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    await db.rpc("resolve_question", {
      p_id: uuid.parse(id),
      p_resolved: z.boolean().parse(resolved),
    });
    revalidatePath("/");
    return { ok: true };
  });
}
export async function stockMovement(input: {
  item: string;
  kind: string;
  quantity: number;
  employee?: string;
  location?: string;
  note: string;
  key: string;
}): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    await db.rpc("stock_transaction", {
      p_item: uuid.parse(input.item),
      p_kind: z
        .enum([
          "Purchase",
          "Allocation",
          "Return",
          "Transfer",
          "Damage",
          "Disposal",
        ])
        .parse(input.kind),
      p_quantity: z
        .number()
        .int()
        .positive()
        .max(1000000)
        .parse(input.quantity),
      p_employee: input.employee ? uuid.parse(input.employee) : null,
      p_location: input.location || null,
      p_note: z.string().trim().min(1).max(2000).parse(input.note),
      p_key: uuid.parse(input.key),
    });
    revalidatePath("/");
    return { ok: true };
  });
}
export async function payment(input: {
  id: string;
  amount: number;
  method: string;
  reference: string;
  key: string;
}): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    await db.rpc("record_payment", {
      p_id: uuid.parse(input.id),
      p_amount: z.number().positive().max(1e12).parse(input.amount),
      p_method: z.string().min(1).max(100).parse(input.method),
      p_reference: z.string().trim().min(1).max(200).parse(input.reference),
      p_key: uuid.parse(input.key),
    });
    revalidatePath("/");
    return { ok: true };
  });
}
export async function markRead(ids: string[]): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    await db.rpc("read_notifications", {
      p_ids: z.array(uuid).max(100).parse(ids),
    });
    revalidatePath("/");
    return { ok: true };
  });
}
export async function savePreferences(data: unknown): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    const valid = z
      .object({
        muted: z.boolean(),
        volume: z.number().min(0).max(1),
        categories: z.record(
          z.object({
            muted: z.boolean().optional(),
            sound: z.string().max(1000).optional(),
          }),
        ),
        default_sound: z.string().max(1000).optional(),
        snoozed_until: z.string().datetime().optional(),
      })
      .strict()
      .parse(data);
    await db.rpc("update_preferences", { p_data: valid });
    revalidatePath("/");
    return { ok: true };
  });
}
export async function subscribePush(subscription: unknown): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    const s = z
      .object({
        endpoint: z
          .string()
          .url()
          .refine(
            (v) =>
              /^https:\/\/(?:[a-z0-9-]+\.)*(?:push\.services\.mozilla\.com|fcm\.googleapis\.com|web\.push\.apple\.com|notify\.windows\.com)\//i.test(
                v,
              ),
            "Unsupported push service",
          ),
        keys: z.object({
          p256dh: z.string().min(10).max(200),
          auth: z.string().min(10).max(100),
        }),
      })
      .parse(subscription);
    await db.rpc("subscribe_push", { p_endpoint: s.endpoint, p_keys: s.keys });
    return { ok: true };
  });
}
export async function saveSettings(data: unknown): Promise<Result> {
  return safely(async () => {
    const { db, profile } = await context();
    if (profile.role !== "super_admin") throw Error("Permission denied");
    const time = z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .refine((v) => Number(v.slice(0, 2)) < 24 && Number(v.slice(3)) < 60);
    const s = z
      .object({
        timezone: z.string().refine((t) => {
          try {
            new Intl.DateTimeFormat("en", { timeZone: t });
            return true;
          } catch {
            return false;
          }
        }),
        working_days: z.array(z.number().int().min(0).max(6)),
        office_start: time,
        office_end: time,
        grace_minutes: z.number().int().min(0).max(180),
        half_day_hours: z.number().min(0).max(12),
        attendance_reminder: time,
        eod_reminder: time,
        eod_deadline: time,
        office_lat: z.number().min(-90).max(90).nullable(),
        office_lng: z.number().min(-180).max(180).nullable(),
        geofence_radius: z.number().min(10).max(50000),
        enforce_geofence: z.boolean(),
        holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
        special_days: z.array(
          z.object({
            date: z.string(),
            working: z.boolean(),
            attendance_reminder: time.optional(),
            eod_reminder: time.optional(),
          }),
        ),
        renewal_days: z.number().int().min(1).max(365),
        reminder_intervals: z.array(z.number().int().min(0).max(365)),
        // Smart reminder policy
        reminder_yearly_advance_months: z.number().int().min(0).max(12).default(1),
        reminder_monthly_advance_days: z.number().int().min(0).max(90).default(14),
        reminder_repeat_daily: z.boolean().default(true),
        reminder_default_recurrence: z
          .enum(["none", "daily", "weekly", "monthly", "yearly", "custom"])
          .default("none"),
        reminder_snooze_options: z
          .array(z.number().int().min(1).max(525600))
          .max(10)
          .default([10, 30, 60, 1440, 10080]),
        reminder_escalate_days: z.number().int().min(0).max(90).default(3),
        notification_channels: z
          .object({
            in_app: z.boolean(),
            sound: z.boolean(),
            push: z.boolean(),
            email: z.boolean(),
          })
          .default({ in_app: true, sound: true, push: true, email: true }),
        // Company-wide sound defaults
        sounds: z
          .object({
            default: z.string().max(1000),
            categories: z.record(z.string().max(1000)),
          })
          .default({ default: "builtin:chime", categories: {} }),
        // Chat policy
        chat: z
          .object({
            group_creation: z.enum(["admins", "managers", "everyone"]),
            direct_messages: z.enum(["everyone", "team"]),
            edit_minutes: z.number().int().min(-1).max(1440),
            admin_review: z.boolean(),
          })
          .default({
            group_creation: "managers",
            direct_messages: "everyone",
            edit_minutes: 15,
            admin_review: false,
          }),
      })
      .strict()
      .parse(data);
    if (s.enforce_geofence && (s.office_lat === null || s.office_lng === null))
      throw Error("Set office coordinates before enforcing geofence");
    await db.rpc("update_settings", { p_data: s });
    revalidatePath("/");
    return { ok: true };
  });
}
export async function setPermission(input: {
  user?: string;
  role?: string;
  module: string;
  action: string;
  scope: string;
}): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    if (!moduleMap[input.module]) throw Error("Invalid module");
    if (Boolean(input.user) === Boolean(input.role))
      throw Error("Choose a user or role");
    await db.rpc("set_permission", {
      p_user: input.user ? uuid.parse(input.user) : null,
      p_role: input.role
        ? z.enum(["employee", "manager"]).parse(input.role)
        : null,
      p_module: input.module,
      p_action: z.enum(actions).parse(input.action),
      p_scope: z.enum(["self", "team", "all", "none"]).parse(input.scope),
    });
    revalidatePath("/");
    return { ok: true };
  });
}
export async function updateProfile(input: {
  id: string;
  name: string;
  department: string;
  manager: string;
  role: string;
  active: boolean;
  /** Omit to leave the address unchanged; "" clears it. */
  email?: string;
}): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    const id = uuid.parse(input.id);
    const email =
      input.email === undefined ? undefined : normalizeEmail(input.email);
    await db.rpc("set_profile", {
      p_id: id,
      p_name: z.string().min(1).max(200).parse(input.name),
      p_department: input.department,
      p_manager: input.manager ? uuid.parse(input.manager) : null,
      p_role: z.enum(["super_admin", "manager", "employee"]).parse(input.role),
      p_active: input.active,
    });
    if (email !== undefined) await setEmail(db, id, email);
    revalidatePath("/");
    return { ok: true };
  });
}
export async function createUser(input: {
  phone: string;
  name: string;
  role: string;
  department?: string;
  manager?: string;
  email?: string;
}): Promise<Result> {
  return safely(async () => {
    const { db, profile, token } = await context();
    if (profile.role !== "super_admin") throw Error("Permission denied");
    const phone = normalizePhone(input.phone);
    const name = z.string().min(1).max(200).parse(input.name);
    const role = z
      .enum(["super_admin", "manager", "employee"])
      .parse(input.role);
    const email = normalizeEmail(input.email);
    if (email) {
      const taken = await db.select<{ id: string }>(
        "profiles",
        "select=id&email=eq." + encodeURIComponent(email) + "&limit=1",
      );
      if (taken.length)
        throw Error("This email address is already in use by another user.");
    }
    const password = randomBytes(18).toString("base64url") + "Aa1!";
    const id = await provisionUser(
      token,
      {
        phone,
        name,
        role,
        department: input.department,
        manager: input.manager ? uuid.parse(input.manager) : undefined,
      },
      password,
    );
    if (email) {
      await setEmail(db, id, email);
      // The welcome email carries an activation link, never the temporary password.
      const idSettings = await db.select<{ data: { welcome_email?: boolean } }>(
        "employee_id_settings",
        "select=data&id=eq.1",
      );
      if (idSettings[0]?.data.welcome_email !== false)
        await sendWelcomeInvite(id).catch((e) =>
          console.error(
            JSON.stringify({
              event: "welcome_invite_failed",
              user: id,
              message: e instanceof Error ? e.message : "Unknown",
            }),
          ),
        );
    }
    revalidatePath("/");
    return { ok: true, id, message: password };
  });
}
export async function verifyAttachment(
  id: string,
  verified: boolean,
): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    await db.rpc("verify_document", {
      p_id: uuid.parse(id),
      p_verified: z.boolean().parse(verified),
    });
    revalidatePath("/");
    return { ok: true };
  });
}
export async function shareRecord(
  record: string,
  user: string,
): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    await db.rpc("share_record", {
      p_record: uuid.parse(record),
      p_user: uuid.parse(user),
    });
    revalidatePath("/");
    return { ok: true };
  });
}
export async function archiveRecord(
  id: string,
  version: number,
): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    await db.rpc("delete_record", {
      p_id: uuid.parse(id),
      p_version: z.number().int().positive().parse(version),
    });
    revalidatePath("/");
    return { ok: true };
  });
}
export async function markQuestionsRead(id: string): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    await db.rpc("read_questions", { p_record: uuid.parse(id) });
    return { ok: true };
  });
}
export async function grantLeave(input: {
  user: string;
  type: string;
  amount: number;
  reason: string;
  key: string;
}): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    await db.rpc("grant_leave", {
      p_user: uuid.parse(input.user),
      p_type: z.string().min(1).max(100).parse(input.type),
      p_amount: z.number().positive().max(365).parse(input.amount),
      p_reason: z.string().trim().min(1).max(1000).parse(input.reason),
      p_key: uuid.parse(input.key),
    });
    revalidatePath("/");
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Email addresses, activation invites and account activation
// ---------------------------------------------------------------------------
function normalizeEmail(value: string | undefined) {
  const email = (value || "").trim().toLowerCase();
  if (!email) return "";
  return z.string().email("Enter a valid email address").max(254).parse(email);
}
async function setEmail(
  db: Awaited<ReturnType<typeof context>>["db"],
  id: string,
  email: string,
) {
  try {
    await db.rpc("set_profile_email", { p_id: id, p_email: email });
  } catch (e) {
    if (e instanceof Error && /profiles_email_unique|duplicate key/i.test(e.message))
      throw Error("This email address is already in use by another user.");
    throw e;
  }
}
// Same rules as changePassword, for activation links.
const strongPassword = z
  .string()
  .min(12, "Use at least 12 characters")
  .max(128)
  .refine(
    (p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p),
    "Use upper and lower case letters and a number",
  );
/** Admin: issues a fresh activation link and queues the welcome email again. */
export async function resendInvite(userId: string): Promise<Result> {
  return safely(async () => {
    const { profile } = await context();
    if (profile.role !== "super_admin") throw Error("Permission denied");
    const result = await sendWelcomeInvite(uuid.parse(userId));
    if (!result.queued)
      throw Error(result.reason || "The invite could not be queued");
    revalidatePath("/");
    return {
      ok: true,
      message: `Activation link queued for ${result.recipient}. The scheduler sends it on its next run; the previous link no longer works.`,
    };
  });
}
/** Public: sets the password for an invited account and signs the person in. */
export async function activateAccount(
  token: string,
  password: string,
): Promise<Result> {
  return safely(async () => {
    if (typeof token !== "string" || !validInviteToken(token))
      throw Error(inviteMessages.invalid);
    strongPassword.parse(password);
    const ip = headers().get("x-forwarded-for")?.split(",")[0] || "local";
    const key = createHash("sha256").update("activate:" + ip).digest("hex");
    const db = serviceDB();
    const allowed = await db.rpc<boolean>("login_rate_limit", { p_key: key });
    if (!allowed) throw Error("Too many attempts. Try again in 15 minutes.");
    const session = await consumeInvite(token, password);
    await db.rpc("clear_login_limits", { p_keys: [key] });
    await setSession(session.token);
    return { ok: true, id: session.userId };
  });
}
