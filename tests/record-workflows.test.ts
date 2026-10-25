import { test } from "node:test";
import assert from "node:assert/strict";
import { modules } from "../src/lib/modules";
import { localDate } from "../src/lib/domain";
import { fromDateTimeLocal, toDateTimeLocal } from "../src/lib/reminders";
import { attendanceDayStatus } from "../src/lib/attendance-calendar";

test("workflow status filters and exports include review and resubmission states", () => {
  for (const module of modules.filter((module) => module.workflow)) {
    for (const status of [
      "Draft",
      "Submitted",
      "Clarification Required",
      "Resubmitted",
      "Approved",
      "Rejected",
    ]) {
      assert.ok(
        module.statuses.includes(status),
        `${module.key} must allow filtering ${status}`,
      );
    }
  }
});

test("attendance company dates can differ from India and device dates", () => {
  const instant = new Date("2026-10-21T02:00:00Z");
  assert.equal(localDate(instant, "Asia/Kolkata"), "2026-10-21");
  assert.equal(localDate(instant, "America/Los_Angeles"), "2026-10-20");
});

test("correction datetime inputs preserve the saved instant across winter and summer offsets", () => {
  const original = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    for (const [instant, expected] of [
      ["2026-01-15T14:00:00.000Z", "2026-01-15T09:00"],
      ["2026-07-15T13:00:00.000Z", "2026-07-15T09:00"],
    ]) {
      const local = toDateTimeLocal(instant);
      assert.equal(local, expected);
      assert.equal(fromDateTimeLocal(local), instant);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test("attendance calendar honors special working days and recorded attendance", () => {
  const base = {
    date: "2026-10-18",
    today: "2026-10-21",
    holidays: ["2026-10-18"],
    workingDays: [1, 2, 3, 4, 5],
    specialDays: [{ date: "2026-10-18", working: true }],
  };
  assert.equal(attendanceDayStatus(base), "Not recorded");
  assert.equal(
    attendanceDayStatus({ ...base, recordedStatus: "Present" }),
    "Present",
  );
  assert.equal(attendanceDayStatus({ ...base, specialDays: [] }), "Holiday");
  assert.equal(
    attendanceDayStatus({ ...base, holidays: [], specialDays: [] }),
    "Day off",
  );
  assert.equal(
    attendanceDayStatus({
      ...base,
      date: "2026-10-21",
      specialDays: [{ date: "2026-10-21", working: false }],
    }),
    "Day off",
  );
  assert.equal(
    attendanceDayStatus({ ...base, date: "2026-10-21" }),
    "Not recorded",
  );
  assert.equal(
    attendanceDayStatus({ ...base, date: "2026-10-22" }),
    "Upcoming",
  );
});
