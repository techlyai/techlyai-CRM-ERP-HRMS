"use client";
import { CalendarDays } from "lucide-react";
import { type BusinessRecord } from "@/lib/modules";
import { Status } from "./ui/status";
export function AttendanceCalendar({
  month,
  records,
  holidays,
  workingDays,
}: {
  month: string;
  records: BusinessRecord[];
  holidays: string[];
  workingDays: number[];
}) {
  const [year, m] = month.split("-").map(Number);
  const first = new Date(year, m - 1, 1);
  const total = new Date(year, m, 0).getDate();
  const offset = first.getDay();
  const summaries: Record<string, number> = {};
  for (const r of records) summaries[r.status] = (summaries[r.status] || 0) + 1;
  return (
    <section className="panel mb-6 p-5">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="section-title flex items-center gap-2">
          <CalendarDays size={17} className="text-primary" />
          My monthly attendance
        </h2>
        <form className="flex items-center gap-2">
          <input
            aria-label="Attendance month"
            type="month"
            name="month"
            defaultValue={month}
            className="w-40"
          />
          <button className="rounded-lg border px-3 py-2 text-xs">
            View month
          </button>
        </form>
      </div>
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div
            key={d}
            className="pb-2 text-center text-[10px] text-muted-foreground"
          >
            {d}
          </div>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <div key={"blank" + i} />
        ))}
        {Array.from({ length: total }, (_, i) => {
          const day = i + 1;
          const date = `${month}-${String(day).padStart(2, "0")}`;
          const record = records.find((r) => r.data.date === date);
          const weekday = new Date(year, m - 1, day).getDay();
          const status =
            record?.status ||
            (holidays.includes(date)
              ? "Holiday"
              : !workingDays.includes(weekday)
                ? "Day off"
                : date < new Date().toLocaleDateString("en-CA")
                  ? "Not recorded"
                  : "Upcoming");
          const title = record
            ? `${status} · ${record.data.clock_in ? new Date(String(record.data.clock_in)).toLocaleTimeString("en-IN") : "No clock-in"}`
            : status;
          return (
            <div
              key={date}
              title={title}
              className={`flex min-h-[68px] flex-col justify-between rounded-lg border p-2 sm:min-h-[82px] ${status === "Late" ? "border-amber-500/25 bg-amber-500/5" : status === "Present" ? "border-emerald-500/25 bg-emerald-500/5" : status === "Absent" ? "border-rose-500/25 bg-rose-500/5" : "bg-muted/20"}`}
            >
              <span className="text-xs font-medium">{day}</span>
              <span className="hidden text-[9px] text-muted-foreground sm:block">
                {status}
              </span>
              <span
                className={`mt-2 h-1 w-4 rounded-full sm:hidden ${status === "Present" ? "bg-emerald-500" : status === "Late" ? "bg-amber-500" : "bg-muted-foreground/20"}`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        {Object.entries(summaries).map(([status, count]) => (
          <span key={status} className="flex items-center gap-2 text-xs">
            <Status value={status} />
            {count}
          </span>
        ))}
      </div>
    </section>
  );
}
