/**
 * Pure helpers for smart reminders. They mirror the SQL rules in
 * database/migrations/002 (private.reminder_alert_at and
 * private.reminder_next_due) so the browser can preview alert and
 * recurrence dates before saving. No dependencies: safe for client, server
 * and tests.
 */
export type Recurrence =
  | "none"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "custom";
export type Priority = "Low" | "Medium" | "High" | "Urgent";
export type AdvanceUnit = "minutes" | "hours" | "days" | "weeks" | "months";
export type ReminderStatus = "Pending" | "Completed" | "Cancelled";
export type Reminder = {
  id: string;
  owner_id: string;
  created_by: string;
  title: string;
  description: string;
  category: string;
  priority: Priority;
  recurrence: Recurrence;
  custom_interval_days: number | null;
  due_at: string;
  anchor_day: number;
  advance_amount: number;
  advance_unit: AdvanceUnit;
  alert_at: string;
  status: ReminderStatus;
  snoozed_until: string | null;
  last_alert_at: string | null;
  completed_at: string | null;
  completed_count: number;
  record_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};
export type ReminderOccurrence = {
  id: string;
  reminder_id: string;
  due_at: string;
  alert_at: string;
  status: "scheduled" | "alerted" | "completed" | "skipped";
  alerted_at: string | null;
  completed_at: string | null;
  created_at: string;
};
/** The reminder keys of settings.data. Every key is optional so a partial
 * settings object (or {}) falls back to the migration defaults. */
export type ReminderPolicy = {
  reminder_yearly_advance_months?: number;
  reminder_monthly_advance_days?: number;
  reminder_repeat_daily?: boolean;
  reminder_default_recurrence?: Recurrence;
  reminder_snooze_options?: number[];
  reminder_escalate_days?: number;
  timezone?: string;
};
export const defaultPolicy: Required<ReminderPolicy> = {
  reminder_yearly_advance_months: 1,
  reminder_monthly_advance_days: 14,
  reminder_repeat_daily: true,
  reminder_default_recurrence: "none",
  reminder_snooze_options: [10, 30, 60, 1440, 10080],
  reminder_escalate_days: 3,
  timezone: "Asia/Kolkata",
};
export const recurrences: Recurrence[] = [
  "none",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "custom",
];
export const priorities: Priority[] = ["Low", "Medium", "High", "Urgent"];
export const advanceUnits: AdvanceUnit[] = [
  "minutes",
  "hours",
  "days",
  "weeks",
  "months",
];
export const reminderStatuses: ReminderStatus[] = [
  "Pending",
  "Completed",
  "Cancelled",
];
export const recurrenceOptions: {
  value: Recurrence;
  label: string;
  hint: string;
}[] = [
  { value: "none", label: "None", hint: "Reminds you once." },
  { value: "daily", label: "Daily", hint: "Every day at the same time." },
  { value: "weekly", label: "Weekly", hint: "Every 7 days." },
  {
    value: "monthly",
    label: "Monthly",
    hint: "Same day each month. The 31st stays on the last day of shorter months.",
  },
  {
    value: "yearly",
    label: "Yearly",
    hint: "Same date each year. 29 Feb falls back to 28 Feb.",
  },
  { value: "custom", label: "Custom days", hint: "Every N days." },
];
export const priorityOptions: { value: Priority; label: string }[] =
  priorities.map((value) => ({ value, label: value }));
export const advanceUnitOptions: { value: AdvanceUnit; label: string }[] = [
  { value: "minutes", label: "Minutes" },
  { value: "hours", label: "Hours" },
  { value: "days", label: "Days" },
  { value: "weeks", label: "Weeks" },
  { value: "months", label: "Months" },
];
export const categorySuggestions = [
  "General",
  "Renewal",
  "Payment",
  "Compliance",
  "Meeting",
  "Personal",
];

// ---------------------------------------------------------------------------
// Timezone-aware calendar arithmetic (no libraries)
// ---------------------------------------------------------------------------
export type WallClock = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timezone: string, monthStyle: "2-digit" | "short") {
  const key = timezone + ":" + monthStyle;
  let f = formatters.get(key);
  if (!f) {
    const options: Intl.DateTimeFormatOptions = {
      hourCycle: "h23",
      year: "numeric",
      month: monthStyle,
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    };
    try {
      f = new Intl.DateTimeFormat("en-GB", { ...options, timeZone: timezone });
    } catch {
      f = new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" });
    }
    formatters.set(key, f);
  }
  return f;
}
export function toDate(value: Date | string | number): Date {
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(d.getTime())) throw Error("Invalid date");
  return d;
}
/** The calendar fields of an instant as seen in a timezone. */
export function wallClock(
  value: Date | string | number,
  timezone: string,
): WallClock {
  const parts = formatter(timezone, "2-digit").formatToParts(toDate(value));
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour") % 24,
    minute: pick("minute"),
    second: pick("second"),
  };
}
const utcOf = (w: WallClock) =>
  Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
/** The instant at which a timezone shows the given calendar fields. */
export function fromWallClock(w: WallClock, timezone: string): Date {
  const target = utcOf(w);
  const first = utcOf(wallClock(target, timezone)) - target;
  let instant = target - first;
  const second = utcOf(wallClock(instant, timezone)) - instant;
  if (second !== first) instant = target - second;
  return new Date(instant);
}
export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function shiftDays(w: WallClock, days: number): WallClock {
  const d = new Date(
    Date.UTC(w.year, w.month - 1, w.day + days, w.hour, w.minute, w.second),
  );
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}
/** Postgres month arithmetic: keep the day, clamped to the target month. */
function shiftMonths(w: WallClock, months: number): WallClock {
  const total = w.year * 12 + (w.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return { ...w, year, month, day: Math.min(w.day, daysInMonth(year, month)) };
}
function whole(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}
function minusInterval(
  d: Date,
  amount: number,
  unit: AdvanceUnit,
  timezone: string,
) {
  if (amount <= 0) return d;
  if (unit === "minutes") return new Date(d.getTime() - amount * 60_000);
  if (unit === "hours") return new Date(d.getTime() - amount * 3_600_000);
  const w = wallClock(d, timezone);
  if (unit === "days") return fromWallClock(shiftDays(w, -amount), timezone);
  if (unit === "weeks")
    return fromWallClock(shiftDays(w, -amount * 7), timezone);
  return fromWallClock(shiftMonths(w, -amount), timezone);
}

// ---------------------------------------------------------------------------
// Scheduling rules (mirror private.reminder_alert_at / reminder_next_due)
// ---------------------------------------------------------------------------
/**
 * When the first alert fires. An explicit advance (amount > 0) wins; otherwise
 * yearly reminders alert N months before (month-end clamped), monthly
 * reminders N days before, and everything else at the due time.
 * `sessionTimezone` is the database session timezone used for day and month
 * arithmetic (the deployed Postgres runs in UTC).
 */
export function alertAt(
  due: Date | string,
  recurrence: Recurrence,
  advanceAmount: number,
  advanceUnit: AdvanceUnit,
  policy: ReminderPolicy = {},
  sessionTimezone = "UTC",
): Date {
  const d = toDate(due);
  const amount = whole(advanceAmount, 0);
  if (amount > 0) return minusInterval(d, amount, advanceUnit, sessionTimezone);
  if (recurrence === "yearly")
    return minusInterval(
      d,
      whole(
        policy.reminder_yearly_advance_months,
        defaultPolicy.reminder_yearly_advance_months,
      ),
      "months",
      sessionTimezone,
    );
  if (recurrence === "monthly")
    return minusInterval(
      d,
      whole(
        policy.reminder_monthly_advance_days,
        defaultPolicy.reminder_monthly_advance_days,
      ),
      "days",
      sessionTimezone,
    );
  return d;
}
/**
 * The next occurrence after completing `due`, in the company timezone.
 * Monthly and yearly reminders keep the anchored day-of-month (the day the
 * reminder was first created on), so a 31st reminder returns to the 31st
 * after February and a 29 Feb reminder falls back to 28 Feb in common years.
 */
export function nextDue(
  due: Date | string,
  recurrence: Recurrence,
  customDays: number | null | undefined,
  anchorDay: number,
  timezone = "UTC",
): Date | null {
  const w = wallClock(toDate(due), timezone);
  if (recurrence === "daily") return fromWallClock(shiftDays(w, 1), timezone);
  if (recurrence === "weekly") return fromWallClock(shiftDays(w, 7), timezone);
  if (recurrence === "custom")
    return fromWallClock(
      shiftDays(w, Math.max(1, whole(customDays, 1))),
      timezone,
    );
  if (recurrence !== "monthly" && recurrence !== "yearly") return null;
  const first = shiftMonths({ ...w, day: 1 }, recurrence === "monthly" ? 1 : 12);
  const day = Math.min(
    Math.max(whole(anchorDay, 1), 1),
    daysInMonth(first.year, first.month),
  );
  return fromWallClock({ ...first, day }, timezone);
}
/** The anchor day the database stores: the day-of-month of `due` in the company timezone. */
export function anchorDayFor(due: Date | string, timezone = "UTC") {
  return wallClock(toDate(due), timezone).day;
}
export function effectiveAdvance(
  recurrence: Recurrence,
  advanceAmount: number,
  advanceUnit: AdvanceUnit,
  policy: ReminderPolicy = {},
): { amount: number; unit: AdvanceUnit; source: "custom" | "policy" | "due" } {
  const amount = whole(advanceAmount, 0);
  if (amount > 0) return { amount, unit: advanceUnit, source: "custom" };
  if (recurrence === "yearly")
    return {
      amount: whole(
        policy.reminder_yearly_advance_months,
        defaultPolicy.reminder_yearly_advance_months,
      ),
      unit: "months",
      source: "policy",
    };
  if (recurrence === "monthly")
    return {
      amount: whole(
        policy.reminder_monthly_advance_days,
        defaultPolicy.reminder_monthly_advance_days,
      ),
      unit: "days",
      source: "policy",
    };
  return { amount: 0, unit: "minutes", source: "due" };
}
export function plural(n: number, singular: string, pluralForm = singular + "s") {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}
export function advanceLabel(
  recurrence: Recurrence,
  advanceAmount: number,
  advanceUnit: AdvanceUnit,
  policy: ReminderPolicy = {},
) {
  const e = effectiveAdvance(recurrence, advanceAmount, advanceUnit, policy);
  const suffix = e.source === "policy" ? " (company default)" : "";
  if (e.amount === 0) return "At the due time" + suffix;
  return `${plural(e.amount, e.unit.slice(0, -1))} before` + suffix;
}
export function recurrenceLabel(
  recurrence: Recurrence,
  customDays?: number | null,
) {
  if (recurrence === "custom")
    return `Every ${plural(Math.max(1, whole(customDays, 1)), "day")}`;
  if (recurrence === "none") return "One-time";
  return recurrence[0].toUpperCase() + recurrence.slice(1);
}
/** One line describing the company reminder policy, for page headers. */
export function describePolicy(policy: ReminderPolicy = {}) {
  const yearly = whole(
    policy.reminder_yearly_advance_months,
    defaultPolicy.reminder_yearly_advance_months,
  );
  const monthly = whole(
    policy.reminder_monthly_advance_days,
    defaultPolicy.reminder_monthly_advance_days,
  );
  const escalate = whole(
    policy.reminder_escalate_days,
    defaultPolicy.reminder_escalate_days,
  );
  const parts = [
    yearly > 0
      ? `Yearly reminders alert ${plural(yearly, "month")} before`
      : "Yearly reminders alert on the due date",
    monthly > 0
      ? `monthly ${plural(monthly, "day")} before`
      : "monthly on the due date",
    (policy.reminder_repeat_daily ?? defaultPolicy.reminder_repeat_daily)
      ? "alerts repeat daily until done"
      : "each alert is sent once",
  ];
  if (escalate > 0)
    parts.push(`managers are told after ${plural(escalate, "day")} overdue`);
  return parts.join(" · ") + ".";
}

// ---------------------------------------------------------------------------
// Snooze
// ---------------------------------------------------------------------------
export function snoozeOptions(policy: ReminderPolicy = {}): number[] {
  const list = (policy.reminder_snooze_options ?? []).filter(
    (n) => Number.isInteger(n) && n > 0,
  );
  return list.length
    ? Array.from(new Set(list))
    : [...defaultPolicy.reminder_snooze_options];
}
/** "10, 30, 60" to [10, 30, 60]. Drops invalid or duplicate entries, keeps at most 10. */
export function parseSnoozeOptions(text: string): number[] {
  const seen = new Set<number>();
  for (const part of text.split(/[\s,;]+/)) {
    if (!part) continue;
    const n = Number(part);
    if (Number.isInteger(n) && n >= 1 && n <= 525600) seen.add(n);
  }
  return Array.from(seen).slice(0, 10);
}
export function snoozeUntil(minutes: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + Math.max(1, whole(minutes, 1)) * 60_000);
}
export function snoozeLabel(minutes: number): string {
  const m = Math.max(1, whole(minutes, 1));
  if (m % 10080 === 0) return plural(m / 10080, "week");
  if (m % 1440 === 0) return plural(m / 1440, "day");
  if (m % 60 === 0) return plural(m / 60, "hour");
  return plural(m, "minute");
}

// ---------------------------------------------------------------------------
// Formatting and state helpers
// ---------------------------------------------------------------------------
function parts(value: Date | string, timezone: string) {
  const list = formatter(timezone, "short").formatToParts(toDate(value));
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    list.find((p) => p.type === type)?.value ?? "";
  return {
    day: pick("day"),
    month: pick("month").replace(/^Sept$/, "Sep"),
    year: pick("year"),
    hour: pick("hour"),
    minute: pick("minute"),
  };
}
/** "15 Nov 2026, 09:00" in the given timezone. */
export function formatDateTime(value: Date | string, timezone = "UTC") {
  const p = parts(value, timezone);
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`;
}
/** "15 Nov 2026" in the given timezone. */
export function formatDate(value: Date | string, timezone = "UTC") {
  const p = parts(value, timezone);
  return `${p.day} ${p.month} ${p.year}`;
}
/** "09:00" in the given timezone. */
export function formatTime(value: Date | string, timezone = "UTC") {
  const p = parts(value, timezone);
  return `${p.hour}:${p.minute}`;
}
/** "in 3 days", "2 hours ago", "now". */
export function relativeTime(
  value: Date | string,
  now: Date | string = new Date(),
) {
  const diff = toDate(value).getTime() - toDate(now).getTime();
  const abs = Math.abs(diff);
  if (abs < 60_000) return "now";
  const units: [string, number][] = [
    ["year", 31_536_000_000],
    ["month", 2_592_000_000],
    ["week", 604_800_000],
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  const [unit, size] = units.find(([, s]) => abs >= s) || units[5];
  const label = plural(Math.floor(abs / size), unit);
  return diff < 0 ? `${label} ago` : `in ${label}`;
}
export function sameDay(
  a: Date | string,
  b: Date | string,
  timezone: string,
) {
  const x = wallClock(a, timezone);
  const y = wallClock(b, timezone);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}
export type Bucket = "overdue" | "today" | "upcoming" | "history";
export function bucketOf(
  r: Pick<Reminder, "status" | "due_at">,
  now: Date | string,
  timezone: string,
): Bucket {
  if (r.status !== "Pending") return "history";
  const due = toDate(r.due_at);
  const n = toDate(now);
  if (due.getTime() < n.getTime()) return "overdue";
  if (sameDay(due, n, timezone)) return "today";
  return "upcoming";
}
export function isOverdue(
  r: Pick<Reminder, "status" | "due_at">,
  now: Date | string = new Date(),
) {
  return (
    r.status === "Pending" &&
    toDate(r.due_at).getTime() < toDate(now).getTime()
  );
}
export function isSnoozed(
  r: Pick<Reminder, "snoozed_until">,
  now: Date | string = new Date(),
) {
  return Boolean(
    r.snoozed_until &&
      toDate(r.snoozed_until).getTime() > toDate(now).getTime(),
  );
}
/** A short line about the alert state, e.g. "Alerts started 12 Oct 2026, 09:00 · repeats daily until done". */
export function alertSummary(
  r: Pick<
    Reminder,
    | "status"
    | "alert_at"
    | "last_alert_at"
    | "snoozed_until"
    | "completed_at"
    | "completed_count"
    | "recurrence"
  >,
  now: Date | string,
  timezone: string,
  policy: ReminderPolicy = {},
) {
  if (r.status === "Completed")
    return (
      "Completed" +
      (r.completed_at ? " " + formatDateTime(r.completed_at, timezone) : "") +
      (r.recurrence !== "none" && r.completed_count > 1
        ? ` · done ${r.completed_count} times`
        : "")
    );
  if (r.status === "Cancelled") return "Cancelled · alerts stopped";
  if (isSnoozed(r, now))
    return `Snoozed until ${formatDateTime(r.snoozed_until as string, timezone)}`;
  if (r.last_alert_at)
    return (
      `Alerts started ${formatDateTime(r.last_alert_at, timezone)}` +
      ((policy.reminder_repeat_daily ?? defaultPolicy.reminder_repeat_daily)
        ? " · repeats daily until done"
        : "")
    );
  if (toDate(r.alert_at).getTime() > toDate(now).getTime())
    return `Next alert ${formatDateTime(r.alert_at, timezone)}`;
  return "Alert due · sent on the next scheduler run";
}
/** Value for an input[type=datetime-local], in the browser timezone. */
export function toDateTimeLocal(value: Date | string) {
  const d = toDate(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** ISO instant from a datetime-local value, or null when empty or invalid. */
export function fromDateTimeLocal(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
export const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
export function sortByDue<T extends Pick<Reminder, "due_at">>(list: T[]) {
  return [...list].sort((a, b) => a.due_at.localeCompare(b.due_at));
}
