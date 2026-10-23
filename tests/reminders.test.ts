import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alertAt,
  nextDue,
  anchorDayFor,
  snoozeUntil,
  snoozeLabel,
  snoozeOptions,
  parseSnoozeOptions,
  bucketOf,
  alertSummary,
  advanceLabel,
  recurrenceLabel,
  formatDateTime,
  relativeTime,
  fromWallClock,
  wallClock,
} from "../src/lib/reminders";
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
test("yearly reminders alert one month before by default, clamped to month end", () => {
  assert.equal(day(alertAt("2026-12-15T09:00:00Z", "yearly", 0, "days", {})), "2026-11-15");
  assert.equal(day(alertAt("2026-03-31T09:00:00Z", "yearly", 0, "days", {})), "2026-02-28");
  assert.equal(
    alertAt("2026-03-31T09:00:00Z", "yearly", 0, "days", {}).toISOString(),
    "2026-02-28T09:00:00.000Z",
  );
  assert.equal(
    day(alertAt("2026-03-31T09:00:00Z", "yearly", 0, "days", { reminder_yearly_advance_months: 2 })),
    "2026-01-31",
  );
  assert.equal(
    day(alertAt("2026-03-31T09:00:00Z", "yearly", 0, "days", { reminder_yearly_advance_months: 0 })),
    "2026-03-31",
  );
});
test("monthly reminders alert 14 days before by default", () => {
  assert.equal(day(alertAt("2026-10-30T09:00:00Z", "monthly", 0, "days", {})), "2026-10-16");
  assert.equal(
    day(alertAt("2026-10-30T09:00:00Z", "monthly", 0, "days", { reminder_monthly_advance_days: 7 })),
    "2026-10-23",
  );
  assert.equal(day(alertAt("2026-10-05T09:00:00Z", "monthly", 0, "days", {})), "2026-09-21");
});
test("explicit advance overrides the policy and one-time reminders alert at the due time", () => {
  assert.equal(day(alertAt("2026-12-15T09:00:00Z", "yearly", 3, "days", {})), "2026-12-12");
  assert.equal(day(alertAt("2026-10-30T09:00:00Z", "monthly", 1, "weeks", {})), "2026-10-23");
  assert.equal(
    alertAt("2026-12-15T09:00:00Z", "none", 2, "hours", {}).toISOString(),
    "2026-12-15T07:00:00.000Z",
  );
  assert.equal(
    alertAt("2026-12-15T09:00:00Z", "weekly", 45, "minutes", {}).toISOString(),
    "2026-12-15T08:15:00.000Z",
  );
  assert.equal(day(alertAt("2026-05-31T09:00:00Z", "none", 1, "months", {})), "2026-04-30");
  assert.equal(
    alertAt("2026-12-15T09:00:00Z", "none", 0, "days", {}).toISOString(),
    "2026-12-15T09:00:00.000Z",
  );
  assert.equal(
    alertAt("2026-12-15T09:00:00Z", "daily", 0, "days", {}).toISOString(),
    "2026-12-15T09:00:00.000Z",
  );
  assert.equal(advanceLabel("yearly", 0, "days", {}), "1 month before (company default)");
  assert.equal(
    advanceLabel("monthly", 0, "days", { reminder_monthly_advance_days: 14 }),
    "14 days before (company default)",
  );
  assert.equal(advanceLabel("none", 0, "days", {}), "At the due time");
  assert.equal(advanceLabel("yearly", 3, "weeks", {}), "3 weeks before");
});
test("monthly next due keeps the anchored day of month across short months", () => {
  const jan = "2026-01-31T09:00:00Z";
  const feb = nextDue(jan, "monthly", null, 31, "UTC");
  assert.equal(day(feb), "2026-02-28");
  const mar = nextDue(feb as Date, "monthly", null, 31, "UTC");
  assert.equal(day(mar), "2026-03-31");
  assert.equal((mar as Date).toISOString(), "2026-03-31T09:00:00.000Z");
  assert.equal(day(nextDue("2026-01-15T09:00:00Z", "monthly", null, 15, "UTC")), "2026-02-15");
  assert.equal(anchorDayFor(jan, "UTC"), 31);
});
test("yearly next due handles leap days", () => {
  assert.equal(day(nextDue("2028-02-29T09:00:00Z", "yearly", null, 29, "UTC")), "2029-02-28");
  assert.equal(day(nextDue("2031-02-28T09:00:00Z", "yearly", null, 29, "UTC")), "2032-02-29");
  assert.equal(day(nextDue("2026-12-15T09:00:00Z", "yearly", null, 15, "UTC")), "2027-12-15");
});
test("custom, daily and weekly intervals add whole days in the company timezone", () => {
  assert.equal(day(nextDue("2026-10-12T09:00:00Z", "custom", 10, 12, "UTC")), "2026-10-22");
  assert.equal(day(nextDue("2026-10-12T09:00:00Z", "custom", null, 12, "UTC")), "2026-10-13");
  assert.equal(day(nextDue("2026-10-12T09:00:00Z", "daily", null, 12, "UTC")), "2026-10-13");
  assert.equal(day(nextDue("2026-10-12T09:00:00Z", "weekly", null, 12, "UTC")), "2026-10-19");
  assert.equal(nextDue("2026-10-12T09:00:00Z", "none", null, 12, "UTC"), null);
  // 03:30 IST on 12 Oct becomes 03:30 IST on 13 Oct: the wall-clock time is preserved.
  const kolkata = nextDue("2026-10-11T22:00:00Z", "daily", null, 12, "Asia/Kolkata");
  assert.equal((kolkata as Date).toISOString(), "2026-10-12T22:00:00.000Z");
  // 01:30 IST on 1 Nov anchors to day 1 even though it is still 31 Oct in UTC.
  assert.equal(anchorDayFor("2026-10-31T20:00:00Z", "Asia/Kolkata"), 1);
  // Monthly in IST: 31 Jan 09:00 IST becomes 28 Feb 09:00 IST.
  const ist = nextDue("2026-01-31T03:30:00Z", "monthly", null, 31, "Asia/Kolkata");
  assert.equal((ist as Date).toISOString(), "2026-02-28T03:30:00.000Z");
  assert.equal(recurrenceLabel("custom", 10), "Every 10 days");
  assert.equal(recurrenceLabel("monthly"), "Monthly");
});
test("wall clock conversion round-trips across a DST change", () => {
  const w = wallClock("2026-03-29T12:00:00Z", "Europe/London");
  assert.deepEqual(w, { year: 2026, month: 3, day: 29, hour: 13, minute: 0, second: 0 });
  assert.equal(fromWallClock(w, "Europe/London").toISOString(), "2026-03-29T12:00:00.000Z");
  // A day added across the DST switch keeps 13:00 local time.
  const next = nextDue("2026-03-28T13:00:00Z", "daily", null, 28, "Europe/London");
  assert.equal((next as Date).toISOString(), "2026-03-29T12:00:00.000Z");
});
test("snooze helpers", () => {
  const from = new Date("2026-10-13T10:00:00Z");
  assert.equal(snoozeUntil(30, from).toISOString(), "2026-10-13T10:30:00.000Z");
  assert.equal(snoozeUntil(1440, from).toISOString(), "2026-10-14T10:00:00.000Z");
  assert.equal(snoozeLabel(10), "10 minutes");
  assert.equal(snoozeLabel(60), "1 hour");
  assert.equal(snoozeLabel(120), "2 hours");
  assert.equal(snoozeLabel(1440), "1 day");
  assert.equal(snoozeLabel(10080), "1 week");
  assert.equal(snoozeLabel(90), "90 minutes");
  assert.deepEqual(parseSnoozeOptions("10, 30,abc,60, 60,-5, 0, 1440"), [10, 30, 60, 1440]);
  assert.deepEqual(snoozeOptions({}), [10, 30, 60, 1440, 10080]);
  assert.deepEqual(snoozeOptions({ reminder_snooze_options: [15, 15, 0] }), [15]);
});
test("buckets and alert summaries describe the schedule state", () => {
  const now = "2026-10-13T06:00:00Z"; // 11:30 IST
  const base = {
    status: "Pending" as const,
    due_at: "2026-10-13T10:00:00Z",
    alert_at: "2026-10-13T10:00:00Z",
    last_alert_at: null,
    snoozed_until: null,
    completed_at: null,
    completed_count: 0,
    recurrence: "none" as const,
  };
  assert.equal(bucketOf(base, now, "Asia/Kolkata"), "today");
  assert.equal(bucketOf({ ...base, due_at: "2026-10-12T10:00:00Z" }, now, "Asia/Kolkata"), "overdue");
  assert.equal(bucketOf({ ...base, due_at: "2026-10-14T10:00:00Z" }, now, "Asia/Kolkata"), "upcoming");
  assert.equal(bucketOf({ ...base, status: "Completed" }, now, "Asia/Kolkata"), "history");
  // 19:30 IST on 13 Oct is still today in Kolkata; 01:30 IST on 14 Oct is not.
  assert.equal(bucketOf({ ...base, due_at: "2026-10-13T14:00:00Z" }, now, "Asia/Kolkata"), "today");
  assert.equal(bucketOf({ ...base, due_at: "2026-10-13T20:00:00Z" }, now, "Asia/Kolkata"), "upcoming");
  assert.equal(alertSummary(base, now, "Asia/Kolkata"), "Next alert 13 Oct 2026, 15:30");
  assert.equal(
    alertSummary({ ...base, last_alert_at: "2026-10-13T03:30:00Z" }, now, "Asia/Kolkata", {
      reminder_repeat_daily: true,
    }),
    "Alerts started 13 Oct 2026, 09:00 · repeats daily until done",
  );
  assert.equal(
    alertSummary({ ...base, snoozed_until: "2026-10-13T07:00:00Z" }, now, "Asia/Kolkata"),
    "Snoozed until 13 Oct 2026, 12:30",
  );
  assert.equal(
    alertSummary({ ...base, alert_at: "2026-10-13T05:00:00Z" }, now, "Asia/Kolkata"),
    "Alert due · sent on the next scheduler run",
  );
  assert.equal(formatDateTime("2026-11-15T03:30:00Z", "Asia/Kolkata"), "15 Nov 2026, 09:00");
  assert.equal(relativeTime("2026-10-16T06:00:00Z", now), "in 3 days");
  assert.equal(relativeTime("2026-10-13T04:00:00Z", now), "2 hours ago");
});
