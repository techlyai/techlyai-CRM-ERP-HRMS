import { test } from "node:test";
import assert from "node:assert/strict";
import { distanceMeters, formatDistance, formatHours, geolocationError, locationStatusLabel, mapEmbed } from "../src/lib/geo";
import { overviewTotals, rowState, summarizeMonth, type OverviewRow } from "../src/lib/attendance";
import type { BusinessRecord } from "../src/lib/modules";

test("distance matches the database haversine formula", () => {
  // Madurai to Chennai is roughly 425 km in a straight line.
  const d = distanceMeters(9.9252, 78.1198, 13.0827, 80.2707);
  assert.ok(d > 420000 && d < 435000, String(d));
  assert.ok(Math.abs(distanceMeters(9.9252, 78.1198, 9.92547, 78.1198) - 30) < 1);
  assert.equal(distanceMeters(1, 2, 1, 2), 0);
});

test("distances, hours and statuses are readable", () => {
  assert.equal(formatDistance(42.4), "42 m");
  assert.equal(formatDistance(1530), "1.5 km");
  assert.equal(formatDistance(null), "—");
  assert.equal(formatHours(8.5), "8h 30m");
  assert.equal(formatHours(undefined), "—");
  assert.equal(locationStatusLabel("outside"), "Outside geofence");
  assert.equal(locationStatusLabel("bogus"), "Not recorded");
  assert.match(geolocationError({ code: 1 }), /permission was denied/);
  assert.match(geolocationError(undefined), /not available/);
});

test("maps are embedded only when explicitly enabled", () => {
  const before = process.env.NEXT_PUBLIC_ATTENDANCE_MAP;
  delete process.env.NEXT_PUBLIC_ATTENDANCE_MAP;
  assert.equal(mapEmbed(9.9, 78.1), null);
  process.env.NEXT_PUBLIC_ATTENDANCE_MAP = "openstreetmap";
  assert.match(String(mapEmbed(9.9, 78.1)), /^https:\/\/www\.openstreetmap\.org\/export\/embed\.html/);
  if (before === undefined) delete process.env.NEXT_PUBLIC_ATTENDANCE_MAP;
  else process.env.NEXT_PUBLIC_ATTENDANCE_MAP = before;
});

const row = (data: Record<string, unknown> | null, status = "Present", extra: Partial<OverviewRow> = {}): OverviewRow => ({
  user_id: Math.random().toString(), name: "P", employee_id: null, department: null, role: "employee", office: null, office_id: null,
  record: data ? { id: "r", status, data, original: null, updated_at: "" } : null, correction: null, ...extra,
});

test("overview counts check-ins, missing check-outs and location failures", () => {
  const rows = [
    row(null),
    row({ clock_in: "x", verified: true }),
    row({ clock_in: "x", clock_out: "y", verified: true, out_verified: false }, "Late"),
    row({ clock_in: "x", wfh: true, verified: false }, "Work From Home"),
    row({ clock_in: "x", verified: false }, "Present", { correction: { id: "c", status: "Submitted" } }),
  ];
  const today = overviewTotals(rows, "2026-10-25", "2026-10-25");
  assert.deepEqual(today, { total: 5, checkedIn: 4, notCheckedIn: 1, current: 3, checkedOut: 1, late: 1, missingCheckout: 0, corrections: 1, failures: 2 });
  // On a past day, sessions without a check-out are missing check-outs, not "currently in".
  const past = overviewTotals(rows, "2026-10-24", "2026-10-25");
  assert.equal(past.current, 0);
  assert.equal(past.missingCheckout, 3);
  assert.equal(rowState(rows[0], "2026-10-24", "2026-10-25"), "not_checked_in");
});

test("monthly summary for one person", () => {
  const rec = (date: string, status: string, data: Record<string, unknown>) => ({ id: date, status, data: { date, ...data } }) as unknown as BusinessRecord;
  const s = summarizeMonth(
    [
      rec("2026-10-01", "Present", { clock_in: "x", clock_out: "y", hours: 8, verified: true }),
      rec("2026-10-02", "Late", { clock_in: "x", clock_out: "y", hours: 7.5, verified: false }),
      rec("2026-10-03", "Work From Home", { clock_in: "x", clock_out: "y", hours: 8, wfh: true, verified: false }),
      rec("2026-10-04", "Present", { clock_in: "x" }),
      rec("2026-10-25", "Present", { clock_in: "x" }),
      rec("2026-10-05", "Absent", {}),
    ],
    "2026-10-25",
  );
  assert.deepEqual(s, { present: 3, late: 1, halfDay: 0, wfh: 1, missingCheckout: 1, unverified: 1, hours: 23.5 });
});
