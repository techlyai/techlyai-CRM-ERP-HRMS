"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Radio } from "lucide-react";
import { formatDistance } from "@/lib/geo";
import {
  endReasons,
  photoVerification,
  verificationInfo,
  type FieldPhoto,
  type FieldPoint,
  type FieldSession,
  type FieldSite,
  type FieldVisit,
  type OverviewRow,
} from "@/lib/field";
import { FieldMap, type MapCircle, type MapMarker } from "./field-map";
import { PhotoBadge, SourceBadge, VerificationBadge } from "./badges";

type Data = {
  sessions: FieldSession[];
  points: (FieldPoint & { session_id: string })[];
  visits: FieldVisit[];
  photos: FieldPhoto[];
  sites: FieldSite[];
};

/** One employee's recorded route, visits and photos for a day. */
export function TrackingView({
  rows,
  user,
  date,
  today,
  timezone,
  data,
}: {
  rows: OverviewRow[];
  user: string | null;
  date: string;
  today: string;
  timezone: string;
  data: Data | null;
}) {
  const router = useRouter();
  const [session, setSession] = useState<string>("");
  const [selected, setSelected] = useState<string | null>(null);
  const go = (u: string | null, d: string) => router.push(`/field/tracking?${u ? `user=${u}&` : ""}date=${d}`, { scroll: false });
  const person = rows.find((r) => r.user_id === user);
  const time = (v: string | null | undefined) => (v ? new Date(v).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: timezone }) : "—");
  const sessions = data?.sessions.filter((s) => !session || s.id === session) || [];
  const sessionIds = new Set(sessions.map((s) => s.id));
  const points = (data?.points || []).filter((p) => sessionIds.has(p.session_id));
  const visits = (data?.visits || []).filter((v) => sessionIds.has(v.session_id));
  const photos = (data?.photos || []).filter((p) => sessionIds.has(p.session_id));
  const active = sessions.find((s) => s.status === "active");

  const { markers, circles } = useMemo(() => {
    const m: MapMarker[] = [];
    const c: MapCircle[] = [];
    points.forEach((p, i) =>
      m.push({
        id: "pt" + i,
        lat: p.latitude,
        lng: p.longitude,
        kind: p.source === "start" ? "start" : p.source === "end" ? "end" : "point",
        tone: p.source === "start" ? "green" : p.source === "end" ? "red" : "blue",
        label: `${p.source === "start" ? "Session start" : p.source === "end" ? "Session end" : "Location point"} · ${time(p.captured_at)}`,
        detail: <p className="mt-1 text-muted-foreground">±{Math.round(p.accuracy_m)} m · {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}</p>,
      }),
    );
    for (const v of visits) {
      if (v.start_lat !== null && v.start_lng !== null)
        m.push({
          id: "v" + v.id,
          lat: v.start_lat,
          lng: v.start_lng,
          kind: "visit",
          tone: verificationInfo[v.start_status].tone,
          label: `Visit · ${v.title}`,
          detail: (
            <div className="mt-1 space-y-1 text-muted-foreground">
              <p>{time(v.started_at)}–{v.ended_at ? time(v.ended_at) : "in progress"}{v.customer ? ` · ${v.customer}` : ""}</p>
              <VerificationBadge status={v.start_status} />
              {v.start_distance_m !== null && <p>{formatDistance(v.start_distance_m)} from {v.expected_label}</p>}
            </div>
          ),
        });
      if (v.expected_lat !== null && v.expected_lng !== null && v.expected_radius_m) {
        c.push({ id: "vc" + v.id, lat: v.expected_lat, lng: v.expected_lng, radius: v.expected_radius_m, label: v.expected_label || "Expected location" });
      }
    }
    for (const p of photos)
      if (p.latitude !== null && p.longitude !== null)
        m.push({
          id: "ph" + p.id,
          lat: p.latitude,
          lng: p.longitude,
          kind: "photo",
          tone: verificationInfo[photoVerification(p)].tone,
          label: `Photo · ${p.title || p.file_name} · ${time(p.captured_at || p.uploaded_at)}`,
          detail: (
            <div className="mt-2 space-y-1.5">
              {p.file_path && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/field/files/photo/${p.id}`} alt={p.title || "Field photo"} className="h-28 w-full rounded object-cover" />
              )}
              <div className="flex flex-wrap gap-1"><PhotoBadge photo={p} short /><SourceBadge source={p.source} /></div>
              <Link href={`/field/photos?photo=${p.id}`} className="text-primary hover:underline">Open photo</Link>
            </div>
          ),
        });
    for (const s of data?.sites || [])
      if (!c.some((x) => x.lat === s.latitude && x.lng === s.longitude)) {
        c.push({ id: "s" + s.id, lat: s.latitude, lng: s.longitude, radius: s.radius_m, label: s.name });
        m.push({ id: "site" + s.id, lat: s.latitude, lng: s.longitude, kind: "site", tone: "blue", label: `Assigned site · ${s.name}`, detail: <p className="mt-1 text-muted-foreground">{s.address || s.customer} · {s.radius_m} m geofence</p> });
      }
    // Live position only while a session is running.
    if (active && active.last_lat !== null && active.last_lng !== null)
      m.push({ id: "live", lat: active.last_lat, lng: active.last_lng, kind: "live", tone: "green", label: `Live · last fix ${time(active.last_point_at)}`, detail: <p className="mt-1 text-muted-foreground">±{Math.round(active.last_accuracy || 0)} m</p> });
    return { markers: m, circles: c };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, visits, photos, data, active]);

  return (
    <div className="space-y-5">
      <div className="panel flex flex-col gap-2 p-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="mb-0 flex-1 text-xs">
          <span className="text-muted-foreground">Employee</span>
          <select value={user || ""} onChange={(e) => go(e.target.value || null, date)} className="mt-1 h-9">
            {!rows.length && <option value="">No field employees available</option>}
            {rows.map((r) => (
              <option key={r.user_id} value={r.user_id}>{r.name}{r.employee_id ? ` · ${r.employee_id}` : ""}{r.team_leader ? ` · TL ${r.team_leader.name}` : ""}</option>
            ))}
          </select>
        </label>
        <label className="mb-0 text-xs">
          <span className="text-muted-foreground">Date</span>
          <input type="date" value={date} max={today} onChange={(e) => e.target.value && go(user, e.target.value)} className="mt-1 h-9" />
        </label>
        {(data?.sessions.length || 0) > 1 && (
          <label className="mb-0 text-xs">
            <span className="text-muted-foreground">Session</span>
            <select value={session} onChange={(e) => setSession(e.target.value)} className="mt-1 h-9">
              <option value="">All sessions</option>
              {data!.sessions.map((s) => <option key={s.id} value={s.id}>{time(s.started_at)}–{s.ended_at ? time(s.ended_at) : "now"}</option>)}
            </select>
          </label>
        )}
      </div>

      {person && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
          <span><span className="font-semibold">{person.name}</span>{person.employee_id ? ` · ${person.employee_id}` : ""}{person.department ? ` · ${person.department}` : ""}</span>
          {active ? (
            <span className="inline-flex items-center gap-1.5 text-success"><Radio size={13} className="animate-pulse" /> Tracking active since {time(active.started_at)}</span>
          ) : (
            <span className="text-muted-foreground">{sessions.length ? "No active session · showing recorded history" : "No field session on this date"}</span>
          )}
          <span className="text-muted-foreground">{points.length} points · {formatDistance(sessions.reduce((n, s) => n + Number(s.distance_m), 0))} · {visits.length} visits · {photos.length} photos</span>
        </div>
      )}

      <FieldMap markers={markers} circles={circles} route={points.map((p) => [p.latitude, p.longitude])} selected={selected} onSelect={setSelected} />
      <p className="text-[11px] text-muted-foreground">
        Route lines join recorded points in time order; gaps mean the device sent no location (page closed, no signal or no permission). Positions are device-reported.
      </p>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="panel p-5">
          <h2 className="section-title mb-3">Sessions</h2>
          {!sessions.length && <p className="text-xs text-muted-foreground">No sessions.</p>}
          <ul className="space-y-2 text-xs">
            {sessions.map((s) => (
              <li key={s.id} className="rounded-lg border border-border p-3">
                <p className="font-medium">{time(s.started_at)}–{s.ended_at ? time(s.ended_at) : "running"}</p>
                <p className="mt-1 text-muted-foreground">
                  {s.point_count} points · {formatDistance(s.distance_m)} · every {Math.round(s.interval_seconds / 60)} min
                  {s.end_reason ? ` · ${endReasons[s.end_reason]}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel p-5">
          <h2 className="section-title mb-3">Visits and photos</h2>
          {!visits.length && !photos.length && <p className="text-xs text-muted-foreground">Nothing recorded.</p>}
          <ul className="space-y-2 text-xs">
            {visits.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2">
                <button type="button" className="font-medium text-primary hover:underline" onClick={() => setSelected("v" + v.id)}>{v.title}</button>
                <span className="text-muted-foreground">{time(v.started_at)}–{v.ended_at ? time(v.ended_at) : "…"}</span>
                <VerificationBadge status={v.start_status} short />
              </li>
            ))}
            {photos.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2">
                <button type="button" className="font-medium text-primary hover:underline" onClick={() => setSelected("ph" + p.id)}>Photo · {p.title || p.file_name}</button>
                <span className="text-muted-foreground">{time(p.captured_at || p.uploaded_at)}</span>
                <PhotoBadge photo={p} short />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
