/** MMC (monthly maintenance charges & website ON/OFF): browser-safe types and helpers. */
export type MmcClient = {
  id: string;
  name: string;
  business_name: string;
  phone: string;
  whatsapp: string | null;
  email: string | null;
  website_url: string;
  allowed_domain: string;
  mmc_amount: string;
  billing_day: number;
  grace_days: number;
  start_date: string;
  notes: string;
  channel: "whatsapp" | "sms" | "both" | "none";
  site_active: boolean;
  auto_suspend: boolean;
  suspend_reason: string | null;
  key_prefix: string | null;
  key_created_at: string | null;
  last_checked_at: string | null;
  last_check_origin: string | null;
  crm_record_id: string | null;
  pay_token: string;
  row_version: number;
  created_at: string;
};
export type DueStatus = "Pending" | "Paid" | "Overdue";
export type MmcDue = {
  id: string;
  client_id: string;
  period: string;
  due_date: string;
  amount: string;
  paid_amount: string;
  status: DueStatus;
  overdue_since: string | null;
};
export type PaymentMode = "UPI" | "Cash" | "Bank" | "Other";
export const paymentModes: PaymentMode[] = ["UPI", "Cash", "Bank", "Other"];
export type MmcPayment = {
  id: string;
  client_id: string;
  amount: string;
  paid_on: string;
  mode: PaymentMode;
  reference: string;
  note: string;
  receipt_no: string;
  receipt_token: string;
  actor_id: string | null;
  created_at: string;
};
export type MmcSiteLog = {
  id: string;
  client_id: string;
  client_name: string;
  old_state: boolean;
  new_state: boolean;
  source: "admin" | "auto";
  actor_id: string | null;
  reason: string;
  created_at: string;
};
export type MmcEvent = "reminder" | "due_today" | "overdue" | "suspended" | "reactivated" | "payment_received";
export type MmcMessage = {
  id: string;
  client_id: string | null;
  client_name: string;
  event: MmcEvent | "manual";
  channel: "sms" | "whatsapp";
  recipient: string;
  vars: Record<string, string>;
  status: "queued" | "sending" | "sent" | "failed" | "skipped";
  provider_id: string | null;
  response: string | null;
  error: string | null;
  attempts: number;
  created_at: string;
  sent_at: string | null;
};
export type MmcTemplate = {
  enabled: boolean;
  text: string;
  sms_template_id: string;
  whatsapp_template: string;
  /** Language code the template was approved in, e.g. "en" or "en_US". */
  whatsapp_language?: string;
  /** Variable sent as the template's dynamic URL button suffix (e.g. pay_token → /pay/{{1}}). */
  whatsapp_button?: "" | "pay_token" | "receipt_token";
  whatsapp_vars: string[];
};
export type MmcSettings = {
  auto_suspend_enabled: boolean;
  auto_reactivate_enabled: boolean;
  reminder_days_before: number;
  overdue_repeat_days: number;
  default_grace_days: number;
  suspended_title: string;
  suspended_message: string;
  contact: { name: string; phone: string; email: string; whatsapp: string };
  upi: { vpa: string; payee_name: string };
  admin_push: Record<"overdue" | "auto_suspend" | "payment" | "no_checkin" | "message_failed" | "claim", boolean>;
  templates: Record<MmcEvent, MmcTemplate>;
};
export const mmcEvents: { key: MmcEvent; label: string }[] = [
  { key: "reminder", label: "Reminder before due date" },
  { key: "due_today", label: "Due today" },
  { key: "overdue", label: "Overdue reminder" },
  { key: "suspended", label: "Site suspended" },
  { key: "reactivated", label: "Site reactivated" },
  { key: "payment_received", label: "Payment received (thank you)" },
];
export const adminPushEvents: { key: keyof MmcSettings["admin_push"]; label: string }[] = [
  { key: "overdue", label: "A client becomes overdue" },
  { key: "auto_suspend", label: "A site is auto-suspended" },
  { key: "payment", label: "A payment is recorded" },
  { key: "no_checkin", label: "A site has not checked in for 24 hours" },
  { key: "message_failed", label: "An SMS/WhatsApp message fails" },
  { key: "claim", label: "A client submits a UPI payment to verify" },
];
export type PaymentClaim = {
  id: string;
  client_id: string;
  amount: string;
  utr: string;
  note: string;
  status: "pending" | "approved" | "rejected";
  payment_id: string | null;
  reviewed_at: string | null;
  review_note: string;
  created_at: string;
};
export const templateVariables = ["client_name", "amount", "due_date", "website", "days_overdue", "receipt_link", "pay_link"];
/** Button suffix variables: the template's URL button ends in {{1}} and receives this value. */
export const buttonVariables = ["pay_token", "receipt_token"];
export const VPA_PATTERN = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/;

/** UPI intent link (NPCI deep link) that opens GPay/PhonePe/Paytm with payee and amount filled in. */
export function upiLink(vpa: string, payee: string, amount: number, note: string): string {
  const q = new URLSearchParams({ pa: vpa });
  if (payee) q.set("pn", payee);
  q.set("cu", "INR");
  if (amount > 0) q.set("am", amount.toFixed(2));
  if (note) q.set("tn", note.slice(0, 60));
  return "upi://pay?" + q.toString().replace(/\+/g, "%20");
}

/** A client's headline status for the current month: the worst open due wins. */
export function clientStatus(dues: Pick<MmcDue, "status">[]): DueStatus {
  if (dues.some((d) => d.status === "Overdue")) return "Overdue";
  if (dues.some((d) => d.status === "Pending")) return "Pending";
  return "Paid";
}
/** Billing day clamped to the month's last day, matching private.mmc_due_date in SQL. */
export function dueDateFor(period: string, billingDay: number): string {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(billingDay, last)).padStart(2, "0")}`;
}
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);
}
export function rupees(value: string | number): string {
  return "₹" + Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
/** Fills {{name}} placeholders; unknown names become empty, like private.render_template. */
export function fillTemplate(text: string, vars: Record<string, string | undefined>): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
}
/** Host part of a URL or bare domain, lower-cased, without "www." or a port. */
export function hostOf(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(value) ? value : "https://" + value);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}
/** True when no domain is configured, or the host is that domain or one of its subdomains. */
export function domainAllowed(allowed: string, host: string): boolean {
  const a = allowed.toLowerCase().replace(/^www\./, "");
  if (!a) return true;
  const h = host.toLowerCase().replace(/^www\./, "");
  return h === a || h.endsWith("." + a);
}
export function lastSeen(at: string | null, now = Date.now()): string {
  if (!at) return "Never";
  const mins = Math.floor((now - Date.parse(at)) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)} h ago`;
  return `${Math.floor(mins / 1440)} days ago`;
}
