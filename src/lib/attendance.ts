import type { Database } from "./database";
import type { BusinessRecord, Profile } from "./modules";
import type { Office } from "./geo";
import { localDate } from "./domain";

export type AttendanceCardData = {
  today?: BusinessRecord;
  open?: BusinessRecord;
  office: Office | null;
  timezone: string;
};

/** Today's record, the latest unclosed earlier day, and the person's office, in one transaction. */
export async function attendanceCardData(db: Database, profile: Profile, timezone: string): Promise<AttendanceCardData> {
  const today = localDate(new Date(), timezone);
  const since = localDate(new Date(Date.now() - 31 * 864e5), timezone);
  return db.run(async (c) => {
    const rows = (
      await c.query(
        `select r.* from public.records r where r.module='attendance' and r.owner_id=$1 and r.data->>'date' between $2 and $3
         and (r.data->>'date'=$3 or (r.data->>'clock_in' is not null and r.data->>'clock_out' is null
          and not exists(select 1 from public.records x where x.module='corrections' and x.data->>'attendance_id'=r.id::text and x.status<>'Rejected')))
         order by r.data->>'date' desc limit 2`,
        [profile.id, since, today],
      )
    ).rows as BusinessRecord[];
    const office = (await c.query("select public.my_attendance_location() l")).rows[0].l.office as Office | null;
    return {
      today: rows.find((r) => r.data.date === today),
      open: rows.find((r) => r.data.date !== today),
      office,
      timezone,
    };
  });
}

export type MonthSummary = {
  present: number;
  late: number;
  halfDay: number;
  wfh: number;
  missingCheckout: number;
  unverified: number;
  hours: number;
};

/** Monthly figures for one person's own records. */
export function summarizeMonth(records: BusinessRecord[], today: string): MonthSummary {
  const s: MonthSummary = { present: 0, late: 0, halfDay: 0, wfh: 0, missingCheckout: 0, unverified: 0, hours: 0 };
  for (const r of records) {
    if (!r.data.clock_in) continue;
    if (r.status === "Late") s.late++;
    else if (r.status === "Half-Day") s.halfDay++;
    else if (r.status === "Work From Home") s.wfh++;
    else s.present++;
    if (!r.data.clock_out && String(r.data.date) < today) s.missingCheckout++;
    if (r.data.verified === false && !r.data.wfh && r.status !== "Work From Home") s.unverified++;
    s.hours += Number(r.data.hours) || 0;
  }
  s.hours = Math.round(s.hours * 100) / 100;
  return s;
}

export type OverviewRow = {
  user_id: string;
  name: string;
  employee_id: string | null;
  department: string | null;
  role: Profile["role"];
  office: string | null;
  office_id: string | null;
  record: { id: string; status: string; data: Record<string, unknown>; original: Record<string, unknown> | null; updated_at: string } | null;
  correction: { id: string; status: string } | null;
};

export type OverviewTotals = {
  total: number;
  checkedIn: number;
  notCheckedIn: number;
  current: number;
  checkedOut: number;
  late: number;
  missingCheckout: number;
  corrections: number;
  failures: number;
};

/** Attendance state of one row for the chosen day. */
export function rowState(r: OverviewRow, date: string, today: string) {
  const d = r.record?.data;
  if (!d?.clock_in) return "not_checked_in" as const;
  if (d.clock_out) return "checked_out" as const;
  return date < today ? ("missing_checkout" as const) : ("checked_in" as const);
}

export function locationFailed(r: OverviewRow) {
  const d = r.record?.data;
  if (!d?.clock_in || d.wfh || r.record?.status === "Work From Home") return false;
  return d.verified === false || d.out_verified === false;
}

export function overviewTotals(rows: OverviewRow[], date: string, today: string): OverviewTotals {
  const t: OverviewTotals = { total: rows.length, checkedIn: 0, notCheckedIn: 0, current: 0, checkedOut: 0, late: 0, missingCheckout: 0, corrections: 0, failures: 0 };
  for (const r of rows) {
    const s = rowState(r, date, today);
    if (s === "not_checked_in") t.notCheckedIn++;
    else t.checkedIn++;
    if (s === "checked_in") t.current++;
    if (s === "checked_out") t.checkedOut++;
    if (s === "missing_checkout") t.missingCheckout++;
    if (r.record?.status === "Late") t.late++;
    if (r.correction && ["Submitted", "Resubmitted", "Clarification Required"].includes(r.correction.status)) t.corrections++;
    if (locationFailed(r)) t.failures++;
  }
  return t;
}
