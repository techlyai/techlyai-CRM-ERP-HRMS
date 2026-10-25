"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2,
  Camera,
  CheckCircle2,
  Clock3,
  History,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  Navigation,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { clock } from "@/lib/actions";
import { checkMyLocation } from "@/lib/attendance-actions";
import {
  formatDistance,
  formatHours,
  geolocationError,
  hoursBetween,
  locationStatusLabel,
  type GeofenceCheck,
  type Office,
} from "@/lib/geo";
import { type BusinessRecord } from "@/lib/modules";
import { Button } from "./ui/button";
import { uploadFile } from "./attachments";

type Position = { lat: number; lng: number; accuracy: number };
type Pending = { action: "in" | "out"; reason: string } | null;

function readPosition(): Promise<Position> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return reject({ code: 0 });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      reject,
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

const tone = (verified: unknown, status: unknown) =>
  verified === true
    ? "bg-success/10 text-success"
    : status === "no_office" || status === undefined
      ? "bg-muted text-muted-foreground"
      : "bg-warning/10 text-warning";

/**
 * Today's check-in / check-out with GPS geofence verification.
 * Location is read only when the person presses a button; the server validates it.
 */
export function AttendanceCard({
  today,
  open,
  office,
  timezone,
  canCheckIn,
  canCheckOut,
  canRequestCorrection,
  showHistoryLink = true,
}: {
  today?: BusinessRecord;
  /** An earlier day that was never checked out. */
  open?: BusinessRecord;
  office: Office | null;
  timezone: string;
  canCheckIn: boolean;
  canCheckOut: boolean;
  canRequestCorrection: boolean;
  showHistoryLink?: boolean;
}) {
  const router = useRouter();
  const [now, setNow] = useState<Date | null>(null);
  const [phase, setPhase] = useState<"" | "locating" | "saving">("");
  const [refreshing, startTransition] = useTransition();
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<Pending>(null);
  const [current, setCurrent] = useState<GeofenceCheck | null>(null);
  const [wfh, setWfh] = useState(false);
  const [photo, setPhoto] = useState<File>();
  const busy = Boolean(phase) || refreshing;

  // Live clock; started after hydration so server and client markup match.
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const d = today?.data || {};
  const checkedIn = Boolean(d.clock_in);
  const checkedOut = Boolean(d.clock_out);
  const time = (v: unknown) =>
    v ? new Date(String(v)).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: timezone }) : "—";
  const worked = checkedOut ? Number(d.hours) : checkedIn && now ? hoursBetween(String(d.clock_in), now) : null;
  const remoteAllowed = !office || !office.require_inside || office.allow_remote;
  const state = checkedOut ? "Checked out" : checkedIn ? "Checked in" : "Not checked in";

  async function run(action: "in" | "out", withLocation = true) {
    if (lock.current || refreshing) return;
    lock.current = true;
    setError("");
    setNotice("");
    setPending(null);
    let pos: Position | undefined;
    try {
      // Work-from-home check-ins do not need a position.
      if (withLocation && !(action === "in" && wfh)) {
        setPhase("locating");
        try {
          pos = await readPosition();
        } catch (e) {
          const reason = geolocationError(e as GeolocationPositionError);
          const blocked = action === "in" && office?.require_inside;
          setError(
            reason +
              (blocked
                ? ` ${office!.name} requires a verified location to check in.`
                : " You can continue without location; the record will be marked as not location-verified."),
          );
          if (!blocked) setPending({ action, reason });
          return;
        }
      }
      setPhase("saving");
      const result = await clock({ action, lat: pos?.lat, lng: pos?.lng, accuracy: pos?.accuracy, wfh: action === "in" && wfh });
      if (!result.ok) throw Error(result.error);
      if (photo && action === "in" && result.id) {
        try {
          await uploadFile(result.id, photo);
        } catch {
          setError("Attendance was recorded, but the photo upload failed. Open your attendance record to upload it again.");
        }
      }
      const at = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: timezone });
      let where = "";
      if (pos && office) {
        const r = await checkMyLocation(pos);
        if (r.ok && r.data?.check) {
          setCurrent(r.data.check);
          where = r.data.check.verified
            ? ` · Location verified (${formatDistance(r.data.check.distance_m)} from ${office.name})`
            : ` · ${locationStatusLabel(r.data.check.status)} (${formatDistance(r.data.check.distance_m)} from ${office.name})`;
        }
      } else if (!pos) where = action === "in" && wfh ? " · Work from home" : " · Location not shared";
      setNotice(`${action === "in" ? "Checked in" : "Checked out"} at ${at}${where}.`);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Attendance could not be saved. Try again.");
    } finally {
      lock.current = false;
      setPhase("");
    }
  }

  async function preview() {
    if (lock.current) return;
    lock.current = true;
    setError("");
    setPhase("locating");
    try {
      const pos = await readPosition();
      const r = await checkMyLocation(pos);
      if (!r.ok) throw Error(r.error);
      setCurrent(r.data?.check || { status: "no_office", verified: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : geolocationError(e as GeolocationPositionError));
    } finally {
      lock.current = false;
      setPhase("");
    }
  }

  const status = checkedOut ? d.out_location_status : checkedIn ? d.location_status : current?.status;
  const verified = checkedOut ? d.out_verified : checkedIn ? d.verified : current?.verified;
  const distance = checkedOut ? d.out_distance_m : checkedIn ? d.distance_m : current?.distance_m;

  return (
    <section aria-labelledby="attendance-title" className="panel mb-6 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5">
        <div className="flex items-start gap-3">
          <span className="icon-tile h-10 w-10 shrink-0">
            <Clock3 size={18} />
          </span>
          <div>
            <h2 id="attendance-title" className="text-sm font-semibold">
              Today’s attendance
            </h2>
            <p className="mt-1 text-xs text-muted-foreground" suppressHydrationWarning>
              {(now || new Date()).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: timezone })}
              {" · "}
              <span className="font-medium tabular-nums text-foreground" aria-live="off">
                {now ? now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: timezone }) : "--:--:--"}
              </span>
            </p>
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <span
            className={`w-full rounded-full px-2.5 py-1 text-center text-[11px] font-medium sm:w-auto ${checkedOut ? "bg-muted text-muted-foreground" : checkedIn ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}
          >
            {state}
            {today && today.status !== "Present" ? ` · ${today.status}` : ""}
          </span>
          <Button className="flex-1 sm:flex-none" onClick={() => run("in")} disabled={busy || checkedIn || !canCheckIn}>
            {phase && !checkedIn ? <Loader2 size={15} className="animate-spin" /> : <LogIn size={15} />}
            Check In
          </Button>
          <Button className="flex-1 sm:flex-none" variant="outline" onClick={() => run("out")} disabled={busy || !checkedIn || checkedOut || !canCheckOut}>
            {phase && checkedIn ? <Loader2 size={15} className="animate-spin" /> : <LogOut size={15} />}
            Check Out
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-px bg-border text-xs sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Check-in", time(d.clock_in)],
          ["Check-out", time(d.clock_out)],
          ["Hours worked", formatHours(worked)],
          ["Office", office ? office.name : "Not assigned"],
          ["Distance from office", formatDistance(distance as number | null)],
          [
            "Location",
            <span key="v" className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${tone(verified, status)}`}>
              {verified === true ? <ShieldCheck size={12} /> : status ? <ShieldAlert size={12} /> : null}
              {status ? locationStatusLabel(status) : "Not checked yet"}
            </span>,
          ],
        ].map(([label, value]) => (
          <div key={String(label)} className="bg-card px-4 py-3">
            <dt className="text-[11px] text-muted-foreground">{label}</dt>
            <dd className="mt-1 truncate font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="space-y-3 p-5 pt-4">
        {phase === "locating" && (
          <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={13} className="animate-spin" /> Getting your location…
          </p>
        )}
        {notice && (
          <p role="status" className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-xs text-success">
            <CheckCircle2 size={14} /> {notice}
          </p>
        )}
        {error && (
          <div role="alert" className="error text-xs">
            <p>{error}</p>
            {pending && (
              <Button size="sm" variant="outline" className="mt-2" onClick={() => run(pending.action, false)} disabled={busy}>
                {pending.action === "in" ? "Check in without location" : "Check out without location"}
              </Button>
            )}
          </div>
        )}
        {open && (
          <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs">
            You did not check out on {String(open.data.date)}.{" "}
            {canRequestCorrection ? (
              <Link className="font-medium text-primary hover:underline" href={`/modules/corrections?new=1&attendance=${open.id}`}>
                Request a correction
              </Link>
            ) : (
              "Ask your administrator to correct it."
            )}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
            {office && (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground" title={office.address || undefined}>
                <Building2 size={13} />
                {office.name} · {office.radius_m} m geofence
                {office.require_inside ? "" : " · outside check-ins allowed and flagged"}
              </span>
            )}
            {!checkedIn && (
              <button type="button" onClick={preview} disabled={busy} className="inline-flex items-center gap-1.5 text-primary hover:underline disabled:opacity-50">
                <Navigation size={13} /> Check my location
              </button>
            )}
            {!checkedIn && remoteAllowed && (
              <label className="mb-0 flex items-center gap-2 font-normal">
                <input type="checkbox" disabled={busy} checked={wfh} onChange={(e) => setWfh(e.target.checked)} />
                Work from home
              </label>
            )}
            {!checkedIn && (
              <label className="mb-0 cursor-pointer text-primary">
                <Camera size={13} className="mr-1 inline" />
                {photo ? photo.name : "Add photo"}
                <input type="file" disabled={busy} className="hidden" accept="image/jpeg,image/png,image/webp" capture="user" onChange={(e) => setPhoto(e.target.files?.[0])} />
              </label>
            )}
          </div>
          {showHistoryLink && (
            <Link href="/modules/attendance" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
              <History size={13} /> Attendance history
            </Link>
          )}
        </div>
        <p className="flex gap-1.5 text-[11px] leading-5 text-muted-foreground">
          <MapPin size={12} className="mt-1 shrink-0" />
          Your location is read once when you check in or out (or press “Check my location”) to confirm you are at your assigned
          office. Nothing is tracked in the background. Your device reports the position, so it is a verification aid, not proof of
          presence; authorized reviewers can see it.
        </p>
      </div>
    </section>
  );
}
