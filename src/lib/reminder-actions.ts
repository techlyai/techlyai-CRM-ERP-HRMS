"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { context } from "./database";
import type { Result } from "./actions";
import { advanceUnits, priorities, recurrences } from "./reminders";
export type { Result } from "./actions";
const uuid = z.string().uuid();
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
const reminderInput = z
  .object({
    id: uuid.optional(),
    version: z.number().int().positive().optional(),
    owner_id: uuid.optional(),
    title: z.string().trim().min(1, "Give the reminder a title").max(200),
    description: z.string().max(5000).default(""),
    category: z.string().trim().max(60).default("General"),
    priority: z.enum(priorities as [string, ...string[]]).default("Medium"),
    recurrence: z.enum(recurrences as [string, ...string[]]).default("none"),
    custom_interval_days: z
      .number()
      .int()
      .min(1)
      .max(3660)
      .nullable()
      .optional(),
    due_at: z
      .string()
      .datetime({ offset: true, message: "Choose a date and time" }),
    advance_amount: z.number().int().min(0).max(10000).default(0),
    advance_unit: z.enum(advanceUnits as [string, ...string[]]).default("days"),
    record_id: uuid.nullable().optional(),
  })
  .strict();
export type ReminderInput = z.input<typeof reminderInput>;
/** Create (no id) or update (id + version) a reminder through public.save_reminder. */
export async function saveReminder(input: ReminderInput): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    const valid = reminderInput.parse(input);
    if (valid.id && valid.version === undefined)
      throw Error("Reminder changed. Refresh and try again.");
    if (valid.recurrence === "custom" && !valid.custom_interval_days)
      throw Error("Enter the custom interval in days");
    const id = await db.rpc<string>("save_reminder", {
      p_data: {
        ...valid,
        category: valid.category || "General",
        custom_interval_days:
          valid.recurrence === "custom" ? valid.custom_interval_days : null,
        record_id: valid.record_id || null,
      },
    });
    revalidatePath("/");
    revalidatePath("/reminders");
    return { ok: true, id };
  });
}
/** complete | cancel | reopen | snooze (needs until) | delete, through public.reminder_action. */
export async function reminderAction(input: {
  id: string;
  action: string;
  until?: string;
  version?: number;
}): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    const id = uuid.parse(input.id);
    const action = z
      .enum(["complete", "cancel", "reopen", "snooze", "delete"])
      .parse(input.action);
    const until = input.until
      ? z.string().datetime({ offset: true }).parse(input.until)
      : null;
    if (action === "snooze") {
      if (!until) throw Error("Choose when to be reminded again");
      if (new Date(until).getTime() <= Date.now())
        throw Error("Choose a snooze time in the future");
    }
    await db.rpc("reminder_action", {
      p_id: id,
      p_action: action,
      p_until: until,
      p_version:
        input.version === undefined
          ? null
          : z.number().int().positive().parse(input.version),
    });
    revalidatePath("/");
    revalidatePath("/reminders");
    revalidatePath("/notifications");
    return { ok: true, id };
  });
}
