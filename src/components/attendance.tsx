"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock3, MapPin, Loader2, Camera } from "lucide-react";
import { clock } from "@/lib/actions";
import { type BusinessRecord } from "@/lib/modules";
import { Button } from "./ui/button";
import { uploadFile } from "./attachments";
export function Attendance({
  today,
  timezone,
}: {
  today?: BusinessRecord;
  timezone: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const busy = saving || refreshing;
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);
  const [wfh, setWfh] = useState(false);
  const [photo, setPhoto] = useState<File>();
  async function run(action: "in" | "out") {
    if (lock.current || refreshing) return;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      let position: GeolocationPosition | undefined;
      if (consent && action === "in") {
        if (!navigator.geolocation)
          throw Error(
            "Location is unavailable in this browser. Use a supported browser or uncheck location sharing if office policy allows it.",
          );
        position = await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0,
          }),
        );
      }
      const result = await clock({
        action,
        lat: position?.coords.latitude,
        lng: position?.coords.longitude,
        accuracy: position?.coords.accuracy,
        wfh,
      });
      if (!result.ok) throw Error(result.error);
      if (photo && action === "in" && result.id) {
        try {
          await uploadFile(result.id, photo);
        } catch {
          setError(
            "Attendance was recorded, but the photo upload failed. Open your attendance record to upload it again.",
          );
        }
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Location permission was declined. Uncheck GPS consent or enable permission.",
      );
    }
    lock.current = false;
    setSaving(false);
  }
  return (
    <div className="panel mb-6 p-5">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-2">
            <Clock3 size={18} className="text-primary" />
            <h2 className="section-title">Today’s attendance</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {today
              ? today.data.clock_in
                ? `Clocked in at ${new Date(String(today.data.clock_in)).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: timezone })}${today.data.clock_out ? " · Day completed" : ""} (${timezone})`
                : today.status
              : "Ready to start your working day?"}
          </p>
          <p className="mt-2 max-w-xl text-xs leading-5 text-muted-foreground">
            GPS is collected only when you choose to share it at clock-in. Your
            device reports the location; authorized reviewers can see it. Server
            time records your check-in.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => run("in")} disabled={busy || Boolean(today)}>
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Clock3 size={14} />
            )}
            Clock in
          </Button>
          <Button
            variant="outline"
            onClick={() => run("out")}
            disabled={
              busy || !today?.data.clock_in || Boolean(today?.data.clock_out)
            }
          >
            Clock out
          </Button>
        </div>
      </div>
      {!today && (
        <div className="mt-5 flex flex-wrap items-center gap-5 border-t pt-4">
          <label className="mb-0 flex items-center gap-2 font-normal">
            <input
              type="checkbox"
              disabled={busy}
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <MapPin size={13} />I consent to sharing my check-in location
          </label>
          <label className="mb-0 flex items-center gap-2 font-normal">
            <input
              type="checkbox"
              disabled={busy}
              checked={wfh}
              onChange={(e) => setWfh(e.target.checked)}
            />
            Work from home
          </label>
          <label className="mb-0 cursor-pointer text-primary">
            <Camera size={14} className="mr-1 inline" />
            {photo ? photo.name : "Add attendance photo"}
            <input
              type="file"
              disabled={busy}
              className="hidden"
              accept="image/jpeg,image/png,image/webp"
              capture="user"
              onChange={(e) => setPhoto(e.target.files?.[0])}
            />
          </label>
        </div>
      )}
      {error && (
        <p className="error mt-4" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
