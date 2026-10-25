"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MapPin, Navigation, Play, Radio, Square, WifiOff } from "lucide-react";
import {
  endFieldSession,
  endFieldVisit,
  sendFieldPoints,
  startFieldSession,
  startFieldVisit,
} from "@/lib/field-actions";
import { formatDistance, geolocationError } from "@/lib/geo";
import { endReasons, mergeQueue, type FieldAssignment, type FieldSession, type FieldSite, type FieldVisit, type QueuedPoint } from "@/lib/field";
import { Button } from "../ui/button";
import { VerificationBadge } from "./badges";
import { FieldPhotoCapture } from "./photo-capture";

type Fix = { lat: number; lng: number; accuracy: number; at: number };
const uuid = () => crypto.randomUUID();
const queueKey = (session: string) => "orbit-field-queue:" + session;
function readQueue(session: string): QueuedPoint[] {
  try {
    return JSON.parse(localStorage.getItem(queueKey(session)) || "[]");
  } catch {
    return [];
  }
}
function writeQueue(session: string, q: QueuedPoint[]) {
  try {
    if (q.length) localStorage.setItem(queueKey(session), JSON.stringify(q));
    else localStorage.removeItem(queueKey(session));
  } catch {}
}
export function onePosition(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject({ code: 0 });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: p.timestamp || Date.now() }),
      reject,
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

/**
 * The field employee's own controls. Location is recorded only while a session is running
 * and this page is open; the indicator says so, and tracking stops when the session ends.
 */
export function MyFieldWork({
  assignment,
  session,
  sessions,
  visits,
  sites,
  attendance,
  projects,
  timezone,
}: {
  assignment: FieldAssignment;
  session: FieldSession | null;
  sessions: FieldSession[];
  visits: FieldVisit[];
  sites: FieldSite[];
  attendance: { clock_in?: string; clock_out?: string } | null;
  projects: { id: string; title: string }[];
  timezone: string;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fix, setFix] = useState<Fix | null>(null);
  const [queued, setQueued] = useState(0);
  const [sent, setSent] = useState(0);
  const [online, setOnline] = useState(true);
  const [gpsProblem, setGpsProblem] = useState("");
  const [visitForm, setVisitForm] = useState(false);
  const latest = useRef<Fix | null>(null);
  const lastQueued = useRef(0);
  const flushing = useRef(false);
  const openVisit = visits.find((v) => v.ended_at === null && v.session_id === session?.id) || null;
  const time = (v: string | null | undefined) =>
    v ? new Date(v).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: timezone }) : "—";
  const refresh = () => startTransition(() => router.refresh());

  const flush = useCallback(async () => {
    if (!session || flushing.current) return;
    const q = readQueue(session.id);
    setQueued(q.length);
    if (!q.length) return;
    flushing.current = true;
    try {
      const batch = q.slice(0, 200);
      const r = await sendFieldPoints({ session: session.id, points: batch });
      if (!r.ok) throw Error(r.error);
      const rest = readQueue(session.id).filter((p) => !batch.some((b) => b.client_id === p.client_id));
      writeQueue(session.id, rest);
      setQueued(rest.length);
      setSent((n) => n + (r.data?.accepted || 0));
      setOnline(true);
      // The server ended the session (schedule, check-out or administrator): stop tracking.
      if (r.data && !r.data.active) {
        writeQueue(session.id, []);
        setNotice("Your field session has ended. Location tracking has stopped.");
        refresh();
      }
    } catch {
      setOnline(false);
    } finally {
      flushing.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  // Tracking: only while a session is active and this page is open.
  useEffect(() => {
    if (!session || !navigator.geolocation) return;
    setQueued(readQueue(session.id).length);
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        const f = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: p.timestamp || Date.now() };
        latest.current = f;
        setFix(f);
        setGpsProblem("");
      },
      (e) => setGpsProblem(geolocationError(e)),
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 60000 },
    );
    const intervalMs = session.interval_seconds * 1000;
    const tick = () => {
      const f = latest.current;
      // Queue one point per interval from a fresh fix; stale readings are not repeated.
      if (f && Date.now() - lastQueued.current >= intervalMs - 1000 && Date.now() - f.at < intervalMs) {
        lastQueued.current = Date.now();
        const q = mergeQueue(readQueue(session.id), [
          { client_id: uuid(), lat: f.lat, lng: f.lng, accuracy: f.accuracy, captured_at: new Date(f.at).toISOString(), source: "track" },
        ]);
        writeQueue(session.id, q);
        setQueued(q.length);
      }
      flush();
    };
    const timer = setInterval(tick, 15000);
    const first = setTimeout(tick, 3000);
    const back = () => flush();
    window.addEventListener("online", back);
    return () => {
      navigator.geolocation.clearWatch(watch);
      clearInterval(timer);
      clearTimeout(first);
      window.removeEventListener("online", back);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.interval_seconds, flush]);

  async function withPosition(label: string, fn: (p: Fix | null) => Promise<{ ok: boolean; error?: string }>, required = false) {
    setBusy(label);
    setError("");
    setNotice("");
    let p: Fix | null = null;
    try {
      p = await onePosition();
    } catch (e) {
      if (required) {
        setError(geolocationError(e as GeolocationPositionError) + " A location is needed for field tracking.");
        setBusy("");
        return false;
      }
      setNotice(geolocationError(e as GeolocationPositionError) + " Continuing without a location; it will be marked for review.");
    }
    const r = await fn(p);
    setBusy("");
    if (!r.ok) {
      setError(r.error || "Request failed");
      return false;
    }
    refresh();
    return true;
  }
  const position = (p: Fix | null) => (p ? { lat: p.lat, lng: p.lng, accuracy: p.accuracy } : null);

  const canStart = attendance?.clock_in && !attendance.clock_out;
  return (
    <div className="space-y-5">
      <section
        aria-live="polite"
        className={`panel overflow-hidden ${session ? "border-success/40" : ""}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-start gap-3">
            <span className={`mt-1 grid h-9 w-9 place-items-center rounded-full ${session ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
              <Radio size={17} className={session ? "animate-pulse" : ""} />
            </span>
            <div>
              <h2 className="text-sm font-semibold">{session ? "Field tracking is ON" : "Field tracking is off"}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {session
                  ? `Session started ${time(session.started_at)} · ends by ${time(session.window_end)} · one location every ${Math.round(session.interval_seconds / 60)} min while this page is open`
                  : `Your tracking schedule: ${assignment.schedule_start.slice(0, 5)}–${assignment.schedule_end.slice(0, 5)}. Location is recorded only during a session you start.`}
              </p>
            </div>
          </div>
          {session ? (
            <Button
              variant="outline"
              disabled={Boolean(busy) || refreshing}
              onClick={async () => {
                await flush();
                await withPosition("end", (p) => endFieldSession({ session: session.id, position: position(p), clientId: uuid() }));
              }}
            >
              {busy === "end" ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />} End field session
            </Button>
          ) : (
            <Button
              disabled={Boolean(busy) || refreshing || !canStart}
              onClick={() => withPosition("start", (p) => startFieldSession({ position: position(p), clientId: uuid() }), true)}
            >
              {busy === "start" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Start field session
            </Button>
          )}
        </div>
        {session && (
          <dl className="grid grid-cols-2 gap-px border-t border-border bg-border text-xs sm:grid-cols-4">
            {[
              ["Last location fix", fix ? `${time(new Date(fix.at).toISOString())} · ±${Math.round(fix.accuracy)} m` : gpsProblem ? "Unavailable" : "Waiting for GPS…"],
              ["Points saved", String(session.point_count + sent)],
              ["Waiting to send", queued ? `${queued}${online ? "" : " (offline)"}` : "0"],
              ["Distance covered", formatDistance(session.distance_m)],
            ].map(([k, v]) => (
              <div key={k} className="bg-card px-4 py-3">
                <dt className="text-[11px] text-muted-foreground">{k}</dt>
                <dd className="mt-1 font-medium tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="space-y-2 px-5 pb-4 pt-3 text-xs">
          {!canStart && !session && (
            <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2">
              {attendance?.clock_out ? "You have checked out for today." : "Check in for attendance on the Overview page before starting a field session."}
            </p>
          )}
          {gpsProblem && session && <p role="alert" className="error">{gpsProblem}</p>}
          {!online && session && (
            <p className="flex items-center gap-1.5 text-warning"><WifiOff size={13} /> Offline. Points are kept on this device and sent when the connection returns.</p>
          )}
          {error && <p role="alert" className="error">{error}</p>}
          {notice && <p role="status" className="rounded-lg border bg-primary/5 px-3 py-2">{notice}</p>}
          <p className="flex gap-1.5 text-[11px] leading-5 text-muted-foreground">
            <MapPin size={12} className="mt-1 shrink-0" />
            Why location is needed: to record work visits during your field session. Browsers only report location while this
            page is open, so tracking pauses if you close it or lock the phone, and the record shows gaps rather than guessed
            positions. Nothing is collected outside a session. Your device reports the positions; they are not tamper-proof.
          </p>
        </div>
      </section>

      {session && (
        <section className="panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="section-title">Current visit</h2>
            {openVisit ? (
              <Button
                size="sm"
                variant="outline"
                disabled={Boolean(busy)}
                onClick={() => withPosition("visit-end", (p) => endFieldVisit({ visit: openVisit.id, position: position(p), clientId: uuid() }))}
              >
                {busy === "visit-end" ? <Loader2 size={13} className="animate-spin" /> : <Square size={13} />} End visit
              </Button>
            ) : (
              !visitForm && (
                <Button size="sm" onClick={() => setVisitForm(true)}>
                  <Navigation size={13} /> Start a visit
                </Button>
              )
            )}
          </div>
          {openVisit && (
            <div className="mt-3 text-xs">
              <p className="font-medium">{openVisit.title}{openVisit.expected_label ? ` · ${openVisit.expected_label}` : ""}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
                Arrived {time(openVisit.started_at)} <VerificationBadge status={openVisit.start_status} short />
                {openVisit.start_distance_m !== null && `${formatDistance(openVisit.start_distance_m)} from the site`}
              </p>
            </div>
          )}
          {visitForm && !openVisit && (
            <form
              className="mt-4 grid gap-3 sm:grid-cols-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const ok = await withPosition("visit", (p) =>
                  startFieldVisit({
                    session: session.id,
                    clientId: uuid(),
                    position: position(p),
                    data: {
                      title: String(f.get("title")),
                      purpose: String(f.get("purpose") || ""),
                      customer: String(f.get("customer") || ""),
                      description: String(f.get("description") || ""),
                      notes: String(f.get("notes") || ""),
                      site_id: String(f.get("site") || "") || null,
                      project_id: String(f.get("project") || "") || null,
                    },
                  }),
                );
                if (ok) setVisitForm(false);
              }}
            >
              <div><label htmlFor="v-title">Visit title *</label><input id="v-title" name="title" required maxLength={200} placeholder="Site inspection" /></div>
              <div>
                <label htmlFor="v-site">Expected site</label>
                <select id="v-site" name="site" defaultValue="">
                  <option value="">No fixed site (manual review)</option>
                  {sites.map((s) => <option key={s.id} value={s.id}>{s.name}{s.customer ? ` · ${s.customer}` : ""}</option>)}
                </select>
              </div>
              <div><label htmlFor="v-purpose">Purpose</label><input id="v-purpose" name="purpose" maxLength={1000} /></div>
              <div><label htmlFor="v-customer">Customer or location name</label><input id="v-customer" name="customer" maxLength={200} /></div>
              <div>
                <label htmlFor="v-project">Related project</label>
                <select id="v-project" name="project" defaultValue="">
                  <option value="">None</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </div>
              <div><label htmlFor="v-notes">Notes</label><input id="v-notes" name="notes" maxLength={2000} /></div>
              <div className="sm:col-span-2"><label htmlFor="v-desc">Description</label><textarea id="v-desc" name="description" rows={2} maxLength={5000} /></div>
              <div className="flex justify-end gap-2 sm:col-span-2">
                <Button type="button" variant="outline" onClick={() => setVisitForm(false)}>Cancel</Button>
                <Button disabled={busy === "visit"}>{busy === "visit" ? "Getting location…" : "Start visit here"}</Button>
              </div>
            </form>
          )}
        </section>
      )}

      {assignment.photo_upload && (
        <FieldPhotoCapture
          session={session}
          visit={openVisit}
          sites={sites}
          projects={projects}
          galleryAllowed={assignment.gallery_allowed}
        />
      )}

      <section className="panel p-5">
        <h2 className="section-title mb-3">Today</h2>
        {!sessions.length && !visits.length ? (
          <p className="text-xs text-muted-foreground">No field sessions yet today.</p>
        ) : (
          <ul className="space-y-2 text-xs">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Session {time(s.started_at)}–{s.ended_at ? time(s.ended_at) : "now"}</span>
                <span className="text-muted-foreground">{s.point_count} points · {formatDistance(s.distance_m)}{s.end_reason ? ` · ${endReasons[s.end_reason]}` : ""}</span>
              </li>
            ))}
            {visits.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{v.title}</span>
                <span className="text-muted-foreground">{time(v.started_at)}–{v.ended_at ? time(v.ended_at) : "in progress"}</span>
                <VerificationBadge status={v.start_status} short />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
