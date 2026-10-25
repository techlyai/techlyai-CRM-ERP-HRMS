"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Radio, Search } from "lucide-react";
import { formatDistance } from "@/lib/geo";
import { sessionState, toneClass, type OverviewRow } from "@/lib/field";

const states = { active: "On an active session", completed: "Session completed", not_started: "Not started" } as const;
type Filter = "" | keyof typeof states | "failures" | "photos" | "reports";

/** Field employees the viewer may see, for one day. */
export function FieldOverview({ rows, date, today, timezone }: { rows: OverviewRow[]; date: string; today: string; timezone: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [tl, setTl] = useState("");
  const [dept, setDept] = useState("");
  const [filter, setFilter] = useState<Filter>("");
  const leaders = useMemo(() => [...new Map(rows.filter((r) => r.team_leader).map((r) => [r.team_leader!.id, r.team_leader!.name])).entries()], [rows]);
  const departments = useMemo(() => [...new Set(rows.map((r) => r.department).filter(Boolean))].sort() as string[], [rows]);
  const tracked = rows.filter((r) => r.enabled);
  const count = (fn: (r: OverviewRow) => boolean) => tracked.filter(fn).length;
  const tiles: [string, number, Filter][] = [
    ["Assigned field employees", tracked.length, ""],
    ["On an active session", count((r) => sessionState(r) === "active"), "active"],
    ["Completed sessions", count((r) => sessionState(r) === "completed"), "completed"],
    ["Not started", count((r) => sessionState(r) === "not_started"), "not_started"],
    ["GPS verification failures", tracked.reduce((n, r) => n + r.failures, 0), "failures"],
    ["Pending photo reviews", tracked.reduce((n, r) => n + r.pending_photos, 0), "photos"],
    ["Pending field reports", tracked.reduce((n, r) => n + r.pending_reports, 0), "reports"],
  ];
  const needle = q.trim().toLowerCase();
  const list = rows.filter((r) => {
    if (needle && !r.name.toLowerCase().includes(needle) && !(r.employee_id || "").toLowerCase().includes(needle)) return false;
    if (tl && r.team_leader?.id !== tl) return false;
    if (dept && r.department !== dept) return false;
    if (filter === "failures") return r.failures > 0;
    if (filter === "photos") return r.pending_photos > 0;
    if (filter === "reports") return r.pending_reports > 0;
    if (filter) return r.enabled && sessionState(r) === filter;
    return true;
  });
  const time = (v: string | null | undefined) => (v ? new Date(v).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: timezone }) : "—");

  return (
    <section aria-labelledby="field-overview">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="field-overview" className="section-title">Field team overview</h2>
          <p className="mt-1 text-xs text-muted-foreground">Field employees you are authorized to review.</p>
        </div>
        <label className="mb-0 text-xs">
          <span className="mr-2 text-muted-foreground">Date</span>
          <input type="date" value={date} max={today} className="h-9 w-auto" onChange={(e) => e.target.value && router.push(`/field?date=${e.target.value}`, { scroll: false })} />
        </label>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {tiles.map(([label, n, f]) => (
          <button
            key={label}
            type="button"
            aria-pressed={Boolean(f) && filter === f}
            onClick={() => setFilter(filter === f ? "" : f)}
            className={`panel p-3 text-left hover:border-primary/40 ${f && filter === f ? "border-primary bg-primary/5" : ""}`}
          >
            <span className="block text-[11px] text-muted-foreground">{label}</span>
            <span className="mt-1 block text-xl font-semibold tabular-nums">{n}</span>
          </button>
        ))}
      </div>
      <div className="panel mb-3 flex flex-col gap-2 p-3 sm:flex-row sm:flex-wrap">
        <label className="relative min-w-[180px] flex-1">
          <span className="sr-only">Search employee name or ID</span>
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Employee name or ID" className="h-9 pl-9" />
        </label>
        <select aria-label="Team Leader" value={tl} onChange={(e) => setTl(e.target.value)} className="h-9 sm:w-44">
          <option value="">All Team Leaders</option>
          {leaders.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)} className="h-9 sm:w-40">
          <option value="">All departments</option>
          {departments.map((d) => <option key={d}>{d}</option>)}
        </select>
        <select aria-label="Session status" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="h-9 sm:w-48">
          <option value="">All statuses</option>
          {Object.entries(states).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          <option value="failures">GPS failures</option>
          <option value="photos">Photos awaiting review</option>
          <option value="reports">Reports awaiting review</option>
        </select>
      </div>
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>{["Employee", "Team Leader", "Session", "Points · distance", "Visits", "Photos", "Needs attention", ""].map((h) => <th key={h} className="p-3 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const s = sessionState(r);
              const first = r.sessions[0];
              const last = r.sessions[r.sessions.length - 1];
              return (
                <tr key={r.user_id} className="border-t">
                  <td className="p-3">
                    <span className="block font-medium">{r.name}</span>
                    <span className="text-[11px] text-muted-foreground">{[r.employee_id, r.department].filter(Boolean).join(" · ")}{r.enabled ? "" : " · tracking off"}</span>
                  </td>
                  <td className="p-3">{r.team_leader?.name || <span className="text-muted-foreground">—</span>}</td>
                  <td className="p-3">
                    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] ${s === "active" ? toneClass.green : s === "completed" ? toneClass.gray : toneClass.amber}`}>
                      {s === "active" && <Radio size={11} className="animate-pulse" />} {states[s]}
                    </span>
                    {first && <span className="mt-1 block text-[11px] text-muted-foreground">{time(first.started_at)}–{last.ended_at ? time(last.ended_at) : "now"}</span>}
                  </td>
                  <td className="p-3 tabular-nums">{r.sessions.reduce((n, x) => n + x.point_count, 0)} · {formatDistance(r.sessions.reduce((n, x) => n + Number(x.distance_m), 0))}</td>
                  <td className="p-3 tabular-nums">{r.visits}</td>
                  <td className="p-3 tabular-nums">{r.photos}</td>
                  <td className="p-3">
                    <span className="flex flex-wrap gap-1">
                      {r.failures > 0 && <span className={`rounded border px-1.5 py-0.5 text-[11px] ${toneClass.red}`}>{r.failures} GPS failure{r.failures > 1 ? "s" : ""}</span>}
                      {r.pending_photos > 0 && <span className={`rounded border px-1.5 py-0.5 text-[11px] ${toneClass.amber}`}>{r.pending_photos} photo{r.pending_photos > 1 ? "s" : ""} to review</span>}
                      {r.pending_reports > 0 && <span className={`rounded border px-1.5 py-0.5 text-[11px] ${toneClass.amber}`}>{r.pending_reports} report{r.pending_reports > 1 ? "s" : ""}</span>}
                      {!r.failures && !r.pending_photos && !r.pending_reports && <span className="text-muted-foreground">—</span>}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <Link className="font-medium text-primary hover:underline" href={`/field/tracking?user=${r.user_id}&date=${date}`}>View route</Link>
                  </td>
                </tr>
              );
            })}
            {!list.length && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">{rows.length ? "No field employees match these filters." : "No field employees are assigned to you yet."}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
