import { serviceDB } from "./database";
import { fillTemplate, type MmcEvent, type MmcMessage, type MmcSettings } from "./mmc";

/**
 * MSG91 delivery for MMC client messages (SMS Flow API and WhatsApp templates).
 *
 * Environment:
 *   MSG91_AUTH_KEY           account auth key (required)
 *   MSG91_SENDER_ID          DLT sender ID used for SMS
 *   MSG91_SMS_TEMPLATE_IDS   JSON map of event → Flow template ID, e.g. {"overdue":"64ab..."}
 *                            (a template ID saved in MMC settings takes precedence)
 *   MSG91_WHATSAPP_NUMBER    integrated WhatsApp number, digits with country code
 */
export type SendResult =
  | { status: "sent"; providerId: string; response: string }
  | { status: "failed" | "skipped"; error: string; response?: string };

const SMS_URL = "https://control.msg91.com/api/v5/flow/";
const WHATSAPP_URL = "https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/";
const digits = (phone: string) => phone.replace(/\D/g, "");

function envTemplateIds(): Record<string, string> {
  try {
    const v = JSON.parse(process.env.MSG91_SMS_TEMPLATE_IDS || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
export function messageVars(m: Pick<MmcMessage, "vars">): Record<string, string> {
  const base = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const v = { ...m.vars };
  // "https://www.ravistores.in/" reads better in a message as "ravistores.in".
  if (v.website) v.website = v.website.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "");
  if (v.receipt_token && base) v.receipt_link = `${base}/api/mmc/receipt/${v.receipt_token}`;
  if (v.pay_token && base) v.pay_link = `${base}/pay/${v.pay_token}`;
  return v;
}
/** The template behind a message; manual reminders carry the template they reuse. */
export function templateKey(m: Pick<MmcMessage, "event" | "vars">): MmcEvent {
  return (m.event === "manual" ? m.vars.template || "overdue" : m.event) as MmcEvent;
}
export function previewText(m: Pick<MmcMessage, "event" | "vars">, settings: MmcSettings): string {
  return fillTemplate(settings.templates[templateKey(m)]?.text || "", messageVars(m as MmcMessage));
}

async function post(url: string, body: unknown, key: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { authkey: key, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text);
  } catch {}
  return { res, text, data };
}

/** Sends one queued message. Never throws: errors come back as a failed result. */
export async function sendMmcMessage(m: MmcMessage, settings: MmcSettings): Promise<SendResult> {
  const key = process.env.MSG91_AUTH_KEY;
  if (!key) return { status: "skipped", error: "MSG91_AUTH_KEY is not set on the server" };
  const tpl = settings.templates[templateKey(m)];
  const vars = messageVars(m);
  try {
    if (m.channel === "sms") {
      const templateId = tpl?.sms_template_id || envTemplateIds()[templateKey(m)];
      if (!templateId) return { status: "skipped", error: `No DLT SMS template ID set for "${templateKey(m)}"` };
      // Flow templates receive every variable by name (##client_name## etc. in the DLT template).
      const { res, text, data } = await post(
        SMS_URL,
        {
          template_id: templateId,
          ...(process.env.MSG91_SENDER_ID ? { sender: process.env.MSG91_SENDER_ID } : {}),
          short_url: "0",
          recipients: [{ mobiles: digits(m.recipient), ...vars }],
        },
        key,
      );
      if (res.ok && data.type === "success") return { status: "sent", providerId: String(data.message || data.request_id || ""), response: text };
      return { status: "failed", error: `MSG91 SMS ${res.status}: ${String(data.message || text || "request rejected").slice(0, 300)}`, response: text };
    }
    const number = process.env.MSG91_WHATSAPP_NUMBER;
    if (!number) return { status: "skipped", error: "MSG91_WHATSAPP_NUMBER is not set on the server" };
    if (!tpl?.whatsapp_template) return { status: "skipped", error: `No approved WhatsApp template name set for "${templateKey(m)}"` };
    const components: Record<string, unknown> = Object.fromEntries(
      (tpl.whatsapp_vars || []).map((name, i) => [`body_${i + 1}`, { type: "text", value: vars[name] ?? "" }]),
    );
    // Dynamic URL button, e.g. "Pay now" → https://<orbit>/pay/{{1}}: only the suffix is sent.
    if (tpl.whatsapp_button && vars[tpl.whatsapp_button]) components.button_1 = { subtype: "url", type: "text", value: vars[tpl.whatsapp_button] };
    const { res, text, data } = await post(
      WHATSAPP_URL,
      {
        integrated_number: digits(number),
        content_type: "template",
        payload: {
          messaging_product: "whatsapp",
          type: "template",
          template: {
            name: tpl.whatsapp_template,
            language: { code: tpl.whatsapp_language || "en", policy: "deterministic" },
            to_and_components: [{ to: [digits(m.recipient)], components }],
          },
        },
      },
      key,
    );
    if (res.ok && (data.status === "success" || data.type === "success") && !data.hasError)
      return { status: "sent", providerId: String(data.request_id || (data.data as { request_id?: string })?.request_id || data.message || ""), response: text };
    return { status: "failed", error: `MSG91 WhatsApp ${res.status}: ${String(data.errors || data.message || text || "request rejected").slice(0, 300)}`, response: text };
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : "MSG91 unreachable" };
  }
}

/** Drains the MMC message queue. Called by the scheduler tick with the service role. */
export async function processMmcMessages(limit = 20) {
  const db = serviceDB();
  const settings = (await db.run(async (c) => (await c.query("select data from public.mmc_settings where id=1")).rows[0]?.data)) as
    | MmcSettings
    | undefined;
  if (!settings) return { sent: 0, failed: 0, skipped: 0 };
  const jobs = await db.rpc<MmcMessage[]>("claim_mmc_messages", { p_limit: limit });
  let sent = 0, failed = 0, skipped = 0;
  for (const job of jobs) {
    const r = await sendMmcMessage(job, settings);
    await db.rpc("finish_mmc_message", {
      p_id: job.id,
      p_status: r.status,
      p_provider_id: r.status === "sent" ? r.providerId : null,
      p_response: r.response ?? null,
      p_error: r.status === "sent" ? null : r.error,
    });
    if (r.status === "sent") sent++;
    else if (r.status === "skipped") skipped++;
    else failed++;
  }
  return { sent, failed, skipped };
}
