"use server";
import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { context, requirePermission } from "./database";
import { normalizePhone } from "./domain";
import { VPA_PATTERN, hostOf, paymentModes } from "./mmc";
import { openPassword, sealPassword, vaultConfigured, type SealedSecret } from "./vault";

export type MmcResult<T = undefined> = { ok: boolean; error?: string; data?: T };
async function guard<T>(fn: () => Promise<T>): Promise<MmcResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
    return {
      ok: false,
      error:
        e instanceof z.ZodError
          ? e.errors.map((x) => `${x.path.join(".") || "value"}: ${x.message}`).join("; ")
          : e instanceof Error
            ? e.message
            : "Request failed",
    };
  }
}
const uuid = z.string().uuid();
const phone = z
  .string()
  .trim()
  .transform((v, ctx) => {
    try {
      return normalizePhone(v);
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a valid phone number with country code" });
      return z.NEVER;
    }
  });
const optionalPhone = z.union([z.literal(""), phone]).optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const clientSchema = z
  .object({
    name: z.string().trim().min(1, "Required").max(160),
    business_name: z.string().trim().max(200).default(""),
    phone,
    whatsapp: optionalPhone,
    email: z.union([z.literal(""), z.string().trim().email()]).optional(),
    website_url: z.union([z.literal(""), z.string().trim().url().max(500)]).optional(),
    allowed_domain: z.string().trim().max(253).optional(),
    mmc_amount: z.coerce.number().min(0).max(10_000_000),
    billing_day: z.coerce.number().int().min(1).max(31),
    grace_days: z.coerce.number().int().min(0).max(60),
    start_date: date,
    notes: z.string().max(4000).default(""),
    channel: z.enum(["whatsapp", "sms", "both", "none"]),
    auto_suspend: z.boolean(),
    site_active: z.boolean().optional(),
  })
  .strict();

/** Creates a site key: only its SHA-256 reaches the database; the key is returned once. */
function newSiteKey() {
  const key = "sk_live_" + randomBytes(32).toString("base64url");
  return { key, hash: createHash("sha256").update(key).digest("hex"), prefix: key.slice(0, 12) };
}
// Encryption context for a client's saved key (kept apart from credential-vault entries).
const noteId = (client: string) => "mmc-site-key:" + client;
/** Saves the encrypted key to MMC → Notes. Returns false when no encryption key is configured. */
async function saveKeyNote(db: Awaited<ReturnType<typeof context>>["db"], client: string, key: string) {
  if (!vaultConfigured()) return false;
  await db.rpc("mmc_save_key_note", { p_client: client, p_sealed: sealPassword(key, noteId(client), 1) });
  return true;
}
const done = (id?: string) => {
  revalidatePath("/mmc", "layout");
  if (id) revalidatePath("/mmc/clients/" + id);
};

export async function saveMmcClient(input: { id: string | null; version?: number; data: z.input<typeof clientSchema> }) {
  return guard(async () => {
    const { db } = await context();
    const d = clientSchema.parse(input.data);
    const data = { ...d, allowed_domain: d.allowed_domain ? hostOf(d.allowed_domain) : hostOf(d.website_url) };
    const id = await db.rpc<string>("mmc_save_client", {
      p_id: input.id ? uuid.parse(input.id) : null,
      p_data: data,
      p_version: input.id ? z.number().int().parse(input.version) : 0,
    });
    let key: string | undefined;
    let saved = false;
    if (!input.id) {
      const k = newSiteKey();
      await db.rpc("mmc_rotate_key", { p_client: id, p_hash: k.hash, p_prefix: k.prefix });
      key = k.key;
      saved = await saveKeyNote(db, id, k.key);
    }
    done(id);
    revalidatePath("/mmc/notes");
    return { id, key, saved };
  });
}

export async function regenerateSiteKey(clientId: string) {
  return guard(async () => {
    const { db } = await context();
    const k = newSiteKey();
    await db.rpc("mmc_rotate_key", { p_client: uuid.parse(clientId), p_hash: k.hash, p_prefix: k.prefix });
    const saved = await saveKeyNote(db, clientId, k.key);
    done(clientId);
    revalidatePath("/mmc/notes");
    return { key: k.key, saved };
  });
}

export async function setMmcSite(input: { client: string; active: boolean; reason?: string }) {
  return guard(async () => {
    const { db } = await context();
    const changed = await db.rpc<boolean>("mmc_set_site", {
      p_client: uuid.parse(input.client),
      p_active: z.boolean().parse(input.active),
      p_reason: z.string().max(500).optional().parse(input.reason) || "",
    });
    done(input.client);
    return { changed };
  });
}

export async function recordMmcPayment(input: {
  client: string;
  amount: number;
  paid_on: string;
  mode: string;
  reference?: string;
  note?: string;
  key: string;
}) {
  return guard(async () => {
    const { db } = await context();
    const v = z
      .object({
        client: uuid,
        amount: z.coerce.number().positive("Enter an amount greater than zero").max(10_000_000),
        paid_on: date,
        mode: z.enum(paymentModes as [string, ...string[]]),
        reference: z.string().trim().max(120).default(""),
        note: z.string().trim().max(1000).default(""),
        key: uuid,
      })
      .strict()
      .parse(input);
    const r = await db.rpc<{ id: string; receipt_no: number; duplicate: boolean }>("mmc_record_payment", {
      p_client: v.client,
      p_amount: v.amount,
      p_paid_on: v.paid_on,
      p_mode: v.mode,
      p_reference: v.reference,
      p_note: v.note,
      p_key: "mmc-pay:" + v.key,
    });
    done(v.client);
    return r;
  });
}

export async function deleteMmcClient(id: string) {
  return guard(async () => {
    const { db } = await context();
    await db.rpc("mmc_delete_client", { p_id: uuid.parse(id) });
    revalidatePath("/mmc", "layout");
  });
}

export async function sendMmcReminder(clientId: string) {
  return guard(async () => {
    const { db } = await context();
    const queued = await db.rpc<number>("mmc_send_reminder", { p_client: uuid.parse(clientId) });
    // Deliver right away instead of waiting for the next scheduler tick.
    const { processMmcMessages } = await import("./msg91");
    const result = await processMmcMessages(10).catch(() => null);
    done(clientId);
    return { queued, result };
  });
}

export async function retryMmcMessage(id: string) {
  return guard(async () => {
    const { db } = await context();
    await db.rpc("mmc_retry_message", { p_id: uuid.parse(id) });
    revalidatePath("/mmc/notifications");
  });
}

const templateSchema = z
  .object({
    enabled: z.boolean(),
    text: z.string().max(1000),
    sms_template_id: z.string().trim().max(64),
    whatsapp_template: z.string().trim().max(120),
    whatsapp_language: z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, "Use a code like en or en_US").optional(),
    whatsapp_button: z.enum(["", "pay_token", "receipt_token"]).optional(),
    whatsapp_vars: z.array(z.string().regex(/^[a-z_]+$/)).max(10),
  })
  .strict();
const settingsSchema = z
  .object({
    auto_suspend_enabled: z.boolean(),
    auto_reactivate_enabled: z.boolean(),
    reminder_days_before: z.number().int().min(0).max(30),
    overdue_repeat_days: z.number().int().min(1).max(30),
    default_grace_days: z.number().int().min(0).max(60),
    suspended_title: z.string().trim().min(1).max(120),
    suspended_message: z.string().trim().min(1).max(500),
    contact: z
      .object({ name: z.string().max(120), phone: z.string().max(30), email: z.string().max(200), whatsapp: z.string().max(30) })
      .strict(),
    upi: z
      .object({
        vpa: z.union([z.literal(""), z.string().trim().regex(VPA_PATTERN, "Enter a valid UPI ID, like name@okaxis")]),
        payee_name: z.string().trim().max(80),
      })
      .strict(),
    admin_push: z.record(z.boolean()),
    templates: z.record(templateSchema),
  })
  .strict();

export async function saveMmcSettings(input: z.input<typeof settingsSchema>) {
  return guard(async () => {
    const { db } = await context();
    await requirePermission(db, "mmc", "settings");
    await db.rpc("mmc_save_settings", { p_data: settingsSchema.parse(input) });
    revalidatePath("/mmc", "layout");
  });
}

/**
 * Checks the client's website from the server: is it reachable, and has the snippet called
 * /api/site-status recently? (The snippet caches for 5 minutes, so "recent" means 10 minutes.)
 */
export async function testMmcConnection(clientId: string) {
  return guard(async () => {
    const { db } = await context();
    await requirePermission(db, "mmc", "manage");
    const c = await db.run(async (q) => (await q.query("select website_url,last_checked_at,site_active from public.mmc_clients where id=$1", [uuid.parse(clientId)])).rows[0]);
    if (!c) throw Error("Client not found");
    let site: { ok: boolean; status?: number; error?: string } = { ok: false, error: "No website URL saved" };
    if (c.website_url) {
      try {
        const u = new URL(c.website_url);
        if (!/^https?:$/.test(u.protocol)) throw Error("Only http(s) URLs can be tested");
        const res = await fetch(u, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(8000), headers: { "user-agent": "Orbit-MMC-Check/1.0" } });
        site = { ok: true, status: res.status };
      } catch (e) {
        site = { ok: false, error: e instanceof Error ? e.message : "Unreachable" };
      }
    }
    const last = c.last_checked_at ? new Date(c.last_checked_at).toISOString() : null;
    const recent = last ? Date.now() - Date.parse(last) < 10 * 60 * 1000 : false;
    return { site, last_checked_at: last, snippet_recent: recent, expected_status: c.site_active ? 200 : 503 };
  });
}

/** Decrypts a client's saved key for MMC → Notes. Each view is recorded in the audit log. */
export async function revealSiteKey(clientId: string) {
  return guard(async () => {
    const { db } = await context();
    const id = uuid.parse(clientId);
    if (!vaultConfigured()) throw Error("Key storage is not configured. Set CREDENTIALS_ENCRYPTION_KEY on the server.");
    const sealed = await db.rpc<SealedSecret>("mmc_key_note", { p_client: id });
    return { key: openPassword(sealed, noteId(id), 1) };
  });
}

/** Approve (records the payment, receipt and reactivation) or reject a client's UPI claim. */
export async function reviewPaymentClaim(input: { id: string; approve: boolean; note?: string }) {
  return guard(async () => {
    const { db } = await context();
    const r = await db.rpc<{ status: string }>("mmc_review_claim", {
      p_id: uuid.parse(input.id),
      p_approve: z.boolean().parse(input.approve),
      p_note: z.string().max(300).optional().parse(input.note) || "",
    });
    revalidatePath("/mmc", "layout");
    return r;
  });
}
