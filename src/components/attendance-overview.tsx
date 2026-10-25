"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, MapPin, Search, ShieldAlert, ShieldCheck } from "lucide-react";
import {
  formatDistance,
  formatHours,
  locationStatusLabel,
  mapEmbed,
  mapLink,
} from "@/lib/geo";
import {
  locationFailed,
  overviewTotals,
  rowState,
  type OverviewRow,
} from "@/lib/attendance";
import { roleLabel } from "@/lib/roles";
import { Dialog, DialogContent } from "./ui/dialog";

const stateLabels = {
  not_checked_in: "Not checked in",
  checked_in: "Checked in",
  checked_out: "Checked out",
  missing_checkout: "Missing check-out",
} as const;
type Filter = "" | keyof typeof stateLabels | "late" | "failures" | "corrections";

/** Attendance for everyone the viewer may see on one day. Rows come from attendance_overview. */
export function AttendanceOverview({
  rows,
  date,
  today,
  timezone,
}: {
  rows: OverviewRow[];
  date: string;
  today: string;
  timezone: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [office, setOffice] = useState("");
  const [filter, setFilter] = useState<Filter>("");
  const [open, setOpen] = useState<OverviewRow | null>(null);
  const totals = overviewTotals(rows, date, today);
  const departments = useMemo(() => [...new Set(rows.map((r) => r.department).filter(Boolean))].sort() as string[], [rows]);
  const offices = useMemo(() => [...new Set(rows.map((r) => r.office || "Not assigned"))].sort(), [rows]);
  const needle = q.trim().toLowerCase();
  const list = rows.filter((r) => {
    if (needle && !r.name.toLowerCase().includes(needle) && !(r.employee_id || "").toLowerCase().includes(needle)) return false;
    if (dept && r.department !== dept) return false;
    if (office && (r.office || "Not assigned") !== office) return false;
    const s = rowState(r, date, today);
    if (filter === "late") return r.record?.status === "Late";
    if (filter === "failures") return locationFailed(r);
    if (filter === "corrections") return Boolean(r.correction && ["Submitted", "Resubmitted", "Clarification Required"].includes(r.correction.status));
    if (filter === "checked_in") return s === "checked_in";
    if (filter) return s === filter;
    return true;
  });
  const time = (v: unknown) =>
    v ? new Date(String(v)).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: timezone }) : "—";
  const tiles: [string, number, Filter][] = [
    ["Total people", totals.total, ""],
    ["Checked in", totals.checkedIn, ""],
    ["Not checked in", totals.notCheckedIn, "not_checked_in"],
    [date < today ? "Still open" : "Currently in", totals.current, "checked_in"],
    ["Checked out", totals.checkedOut, "checked_out"],
    ["Late arrivals", totals.late, "late"],
    ["Missing check-outs", totals.missingCheckout, "missing_checkout"],
    ["Correction requests", totals.corrections, "corrections"],
    ["Location failures", totals.failures, "failures"],
  ];

  return (
    <section className="mb-6" aria-labelledby="overview-title">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="overview-title" className="section-title">Team attendance</h2>
          <p className="mt-1 text-xs text-muted-foreground">Everyone whose attendance you are authorized to view.</p>
        </div>
        <label className="mb-0 text-xs">
          <span className="mr-2 text-muted-foreground">Date</span>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => e.target.value && router.push(`/modules/attendance?date=${e.target.value}`, { scroll: false })}
            className="h-9 w-auto"
          />
        </label>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
        {tiles.map(([label, n, f]) => (
          <button
            key={label}
            type="button"
            onClick={() => setFilter(filter === f ? "" : f)}
            aria-pressed={Boolean(f) && filter === f}
            className={`panel p-3 text-left transition-colors hover:border-primary/40 ${f && filter === f ? "border-primary bg-primary/5" : ""}`}
          >
            <span className="block text-[11px] text-muted-foreground">{label}</span>
            <span className="mt-1 block text-xl font-semibold tabular-nums">{n}</span>
          </button>
        ))}
      </div>
      <div className="panel mb-3 flex flex-col gap-2 p-3 sm:flex-row sm:flex-wrap">
        <label className="relative min-w-[180px] flex-1">
          <span className="sr-only">Search by name or employee ID</span>
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Employee name or ID" className="h-9 pl-9" />
        </label>
        <select aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)} className="h-9 sm:w-40">
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <select aria-label="Office location" value={office} onChange={(e) => setOffice(e.target.value)} className="h-9 sm:w-44">
          <option value="">All offices</option>
          {offices.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
        <select aria-label="Attendance status" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="h-9 sm:w-44">
          <option value="">All statuses</option>
          {Object.entries(stateLabels).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
          <option value="late">Late</option>
          <option value="failures">Location failures</option>
          <option value="corrections">Correction pending</option>
        </select>
      </div>
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              {["Person", "Office", "Status", "Check-in", "Check-out", "Hours", "Location", ""].map((h) => (
                <th key={h} className="p-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const d = r.record?.data;
              const s = rowState(r, date, today);
              const failed = locationFailed(r);
              return (
                <tr key={r.user_id} className="border-t">
                  <td className="p-3">
                    <span className="block font-medium">{r.name}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {[r.employee_id, r.department, roleLabel(r.role)].filter(Boolean).join(" · ")}
                    </span>
                  </td>
                  <td className="p-3">{r.office || <span className="text-muted-foreground">Not assigned</span>}</td>
                  <td className="p-3">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] ${s === "missing_checkout" ? "bg-danger/10 text-danger" : s === "not_checked_in" ? "bg-muted text-muted-foreground" : "bg-success/10 text-success"}`}>
                      {stateLabels[s]}
                    </span>
                    {r.record && r.record.status !== "Present" && <span className="ml-1 text-[11px] text-muted-foreground">{r.record.status}</span>}
                  </td>
                  <td className="p-3 tabular-nums">{time(d?.clock_in)}</td>
                  <td className="p-3 tabular-nums">{time(d?.clock_out)}</td>
                  <td className="p-3 tabular-nums">{d?.hours !== undefined ? formatHours(Number(d.hours)) : "—"}</td>
                  <td className="p-3">
                    {d?.clock_in ? (
                      <span className={`inline-flex items-center gap-1 ${failed ? "text-warning" : "text-success"}`}>
                        {failed ? <ShieldAlert size={12} /> : <ShieldCheck size={12} />}
                        {d.wfh ? "Work from home" : failed ? "Not verified" : "Verified"}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-3 text-right">
                    {r.record && (
                      <button type="button" className="font-medium text-primary hover:underline" onClick={() => setOpen(r)}>
                        Details
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!list.length && (
              <tr>
                <td colSpan={8} className="p-8 text-center text-muted-foreground">No one matches these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Dialog open={Boolean(open)} onOpenChange={(v) => !v && setOpen(null)}>
        {open?.record && (
          <DialogContent title={`${open.name} · ${date}`} description={`${open.office || "No office assigned"} · ${open.record.status}`}>
            <AttendanceLocationDetails data={open.record.data} original={open.record.original} timezone={timezone} />
            <div className="mt-4 flex flex-wrap gap-3 text-xs">
              <Link className="font-medium text-primary hover:underline" href={`/modules/attendance/${open.record.id}`}>
                Open attendance record
              </Link>
              {open.correction && (
                <Link className="font-medium text-primary hover:underline" href={`/modules/corrections/${open.correction.id}`}>
                  Correction request · {open.correction.status}
                </Link>
              )}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}

/** Check-in and check-out locations recorded on one attendance record. */
export function AttendanceLocationDetails({
  data: d,
  original,
  timezone,
}: {
  data: Record<string, unknown>;
  original?: Record<string, unknown> | null;
  timezone: string;
}) {
  const time = (v: unknown) =>
    v ? new Date(String(v)).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }) : "—";
  const sides = [
    { label: "Check-in", at: d.clock_in, lat: d.lat, lng: d.lng, acc: d.accuracy, dist: d.distance_m, ok: d.verified, status: d.location_status },
    { label: "Check-out", at: d.clock_out, lat: d.out_lat, lng: d.out_lng, acc: d.out_accuracy, dist: d.out_distance_m, ok: d.out_verified, status: d.out_location_status },
  ];
  const embed = typeof d.lat === "number" && typeof d.lng === "number" ? mapEmbed(d.lat, d.lng) : null;
  return (
    <div className="mt-4 space-y-4 text-xs">
      <p className="text-muted-foreground">
        Assigned office: <span className="font-medium text-foreground">{String(d.office_name || "None")}</span>
        {d.radius_m ? ` · ${d.radius_m} m geofence` : ""} · Hours worked:{" "}
        <span className="font-medium text-foreground">{d.hours !== undefined ? formatHours(Number(d.hours)) : "—"}</span>
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {sides.map((s) => (
          <div key={s.label} className="rounded-lg border border-border p-3">
            <p className="font-semibold">{s.label}</p>
            <p className="mt-1 tabular-nums">{time(s.at)}</p>
            {s.at ? (
              <>
                <p className={`mt-2 inline-flex items-center gap-1 ${s.ok === true ? "text-success" : "text-warning"}`}>
                  {s.ok === true ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
                  {d.wfh && s.label === "Check-in" ? "Work from home" : locationStatusLabel(s.status)}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Distance from office: {formatDistance(s.dist as number | null)}
                  {typeof s.acc === "number" ? ` · accuracy ±${Math.round(s.acc)} m` : ""}
                </p>
                {typeof s.lat === "number" && typeof s.lng === "number" ? (
                  <a className="mt-1 inline-flex items-center gap-1 text-primary hover:underline" href={mapLink(s.lat, s.lng)} target="_blank" rel="noreferrer">
                    <MapPin size={12} /> {s.lat.toFixed(5)}, {s.lng.toFixed(5)} <ExternalLink size={11} />
                  </a>
                ) : (
                  <p className="mt-1 text-muted-foreground">{d.location_purged_at ? "Coordinates removed under the retention policy" : "No coordinates recorded"}</p>
                )}
              </>
            ) : null}
          </div>
        ))}
      </div>
      {embed && <iframe title="Check-in location map" src={embed} className="h-56 w-full rounded-lg border border-border" loading="lazy" referrerPolicy="no-referrer" />}
      {original && (
        <p className="rounded-lg bg-muted/50 p-3 text-muted-foreground">
          Corrected record. Originally recorded: check-in {time(original.clock_in)}, check-out {time(original.clock_out)}
          {original.status ? `, status ${original.status}` : ""}.
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">Locations are reported by the person’s device and are not tamper-proof.</p>
    </div>
  );
}
