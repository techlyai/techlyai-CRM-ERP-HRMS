"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { context, serviceDB } from "./database";
import { processEmailQueue } from "./email";

export type Result = { ok: boolean; error?: string; message?: string };
export type TestEmailResult = {
  ok: boolean;
  id?: string;
  status?: "queued" | "accepted" | "failed" | "skipped";
  provider?: string | null;
  providerId?: string | null;
  attempts?: number;
  error?: string | null;
};

async function safely<T extends { ok: boolean }>(
  fn: () => Promise<T>,
): Promise<T | { ok: false; error: string }> {
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

// Keep in step with the toggles in src/components/settings-panels/email.tsx.
const EMAIL_EVENTS = [
  "welcome",
  "employee_id",
  "reminders",
  "eod",
  "questions",
  "approvals",
  "renewals",
  "payments",
  "tasks",
  "chat",
] as const;
const emailAddress = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const emailSettingsSchema = z
  .object({
    provider: z.enum(["resend", "console"]),
    sender_name: z.string().trim().max(100),
    sender_email: z
      .string()
      .trim()
      .max(254)
      .refine((v) => v === "" || emailAddress.test(v), "Enter a valid sender email"),
    company_name: z.string().trim().min(1, "Enter the company name").max(100),
    support_contact: z.string().trim().max(200),
    retry_limit: z.number().int().min(1).max(20),
    events: z
      .object(
        Object.fromEntries(EMAIL_EVENTS.map((e) => [e, z.boolean()])) as Record<
          (typeof EMAIL_EVENTS)[number],
          z.ZodBoolean
        >,
      )
      .strict(),
    templates: z.record(
      z.enum(EMAIL_EVENTS),
      z
        .object({
          subject: z.string().max(200).default(""),
          body: z.string().max(20000).default(""),
        })
        .strict(),
    ),
  })
  .strict();

export async function saveEmailSettings(data: unknown): Promise<Result> {
  return safely(async () => {
    const { db, profile } = await context();
    if (profile.role !== "super_admin") throw Error("Permission denied");
    const s = emailSettingsSchema.parse(data);
    // An empty template means "use the built-in message", so drop it.
    const templates = Object.fromEntries(
      Object.entries(s.templates)
        .filter(([, t]) => t && (t.subject.trim() || t.body.trim()))
        .map(([event, t]) => [event, { subject: t!.subject.trim(), body: t!.body }]),
    );
    await db.rpc("update_email_settings", { p_data: { ...s, templates } });
    revalidatePath("/");
    return { ok: true };
  });
}

export async function retryEmail(id: string): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    await db.rpc("retry_email", { p_id: z.string().uuid().parse(id) });
    revalidatePath("/");
    return { ok: true };
  });
}

/**
 * Queues a one-off test row and drains the queue straight away so the admin
 * sees the provider's real answer. A test that fails on its first attempt is
 * marked failed rather than left for the scheduler to retry.
 */
export async function sendTestEmail(recipient: string): Promise<TestEmailResult> {
  return safely(async () => {
    const { profile } = await context();
    if (profile.role !== "super_admin") throw Error("Permission denied");
    const to = z
      .string()
      .trim()
      .email("Enter a valid email address")
      .max(254)
      .parse(recipient)
      .toLowerCase();
    const service = serviceDB();
    const settings = (await service.run(
      async (c) => (await c.query("select data from public.email_settings where id=1")).rows[0]?.data,
    )) as { company_name?: string; provider?: string } | undefined;
    const company = settings?.company_name || "Techly";
    const id = await service.run(
      async (c) =>
        (
          await c.query(
            "insert into public.email_log(event,user_id,recipient,subject,body) values('test',$1,$2,$3,$4) returning id",
            [
              profile.id,
              to,
              `Test email from ${company}`,
              `This is a test message from ${company}. If you can read it, outgoing email is working.\n\nProvider: ${settings?.provider || "resend"}\nRequested by: ${profile.full_name}`,
            ],
          )
        ).rows[0].id as string,
    );
    await processEmailQueue(5);
    const row = (await service.run(
      async (c) =>
        (
          await c.query(
            "select status,error,provider,provider_id,attempts from public.email_log where id=$1",
            [id],
          )
        ).rows[0],
    )) as {
      status: TestEmailResult["status"];
      error: string | null;
      provider: string | null;
      provider_id: string | null;
      attempts: number;
    };
    if (row.status === "queued" && row.error) {
      await service.run(async (c) => {
        await c.query("update public.email_log set status='failed' where id=$1 and status='queued'", [id]);
      });
      row.status = "failed";
    }
    revalidatePath("/");
    return {
      ok: row.status === "accepted",
      id,
      status: row.status,
      provider: row.provider,
      providerId: row.provider_id,
      attempts: row.attempts,
      error: row.error,
    };
  });
}

const code = /^[A-Za-z0-9/_-]*$/;
const employeeIdSchema = z
  .object({
    prefix: z.string().trim().max(20).regex(code, "Use letters, numbers, / _ or - in the prefix"),
    include_department: z.boolean(),
    branch_code: z
      .string()
      .trim()
      .max(10)
      .regex(code, "Use letters, numbers, / _ or - in the branch code"),
    include_year: z.boolean(),
    separator: z.string().max(3),
    digits: z.number().int().min(1).max(8),
    start: z.number().int().min(1).max(1_000_000_000),
    scope: z.enum(["global", "department"]),
    reset: z.enum(["never", "yearly"]),
    allow_manual: z.boolean(),
    welcome_email: z.boolean(),
  })
  .strict();

export async function saveEmployeeIdSettings(data: unknown): Promise<Result> {
  return safely(async () => {
    const { db, profile } = await context();
    if (profile.role !== "super_admin") throw Error("Permission denied");
    const s = employeeIdSchema.parse(data);
    await db.rpc("update_employee_id_settings", { p_data: s });
    revalidatePath("/");
    return { ok: true };
  });
}

/** Next employee ID for a department without consuming it (message = the ID). */
export async function previewEmployeeId(department: string): Promise<Result> {
  return safely(async () => {
    const { db } = await context();
    const dept = z.string().trim().max(100).parse(department || "");
    const id = await db.rpc<string>("employee_id_preview", {
      p_department: dept || null,
    });
    return { ok: true, message: id };
  });
}
