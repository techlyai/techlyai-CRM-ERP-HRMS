"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, ImageUp, Loader2, MapPin, RotateCcw, X } from "lucide-react";
import { createFieldPhoto } from "@/lib/field-actions";
import { formatDistance, geolocationError } from "@/lib/geo";
import type { FieldSession, FieldSite, FieldVisit, Verification } from "@/lib/field";
import { uploadFile } from "../attachments";
import { Button } from "../ui/button";
import { SourceBadge, VerificationBadge } from "./badges";
import { onePosition } from "./my-field-work";

type Draft = {
  file: File;
  preview: string;
  source: "camera" | "gallery";
  clientKey: string;
  position: { lat: number; lng: number; accuracy: number } | null;
  positionError: string;
  capturedAt: string;
  /** Set once the photo is registered; reused when retrying the upload. */
  photoId?: string;
  result?: { verification: Verification; distance_m: number | null; expected_label: string | null };
};
// A "camera" file older than this was not just taken; treat it as a gallery image.
const FRESH_MS = 2 * 60 * 1000;

/**
 * GPS camera: takes (or, when allowed, picks) a photo, reads the device location at that
 * moment, registers both with the server for geofence verification, then uploads the
 * original image to private storage with progress and retry.
 */
export function FieldPhotoCapture({
  session,
  visit,
  sites,
  projects,
  galleryAllowed,
}: {
  session: FieldSession | null;
  visit: FieldVisit | null;
  sites: FieldSite[];
  projects: { id: string; title: string }[];
  galleryAllowed: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<"" | "locating" | "saving" | "uploading">("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const preview = draft?.preview;
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function choose(file: File | undefined, picked: "camera" | "gallery") {
    if (!file) return;
    setError("");
    setDone("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return setError("Use a JPG, PNG or WebP photo.");
    if (file.size > 20 * 1024 * 1024) return setError("Photos can be up to 20 MB.");
    // Desktop browsers ignore the camera hint and open a file picker; an older file is labelled as a gallery image.
    let source = picked;
    if (picked === "camera" && Date.now() - file.lastModified > FRESH_MS) {
      if (!galleryAllowed) return setError("This photo was not just taken. Your field policy requires a new photo from the camera.");
      source = "gallery";
    }
    setBusy("locating");
    let position: Draft["position"] = null;
    let positionError = "";
    try {
      const p = await onePosition();
      position = { lat: p.lat, lng: p.lng, accuracy: p.accuracy };
    } catch (e) {
      positionError = geolocationError(e as GeolocationPositionError);
    }
    setBusy("");
    setDraft({
      file,
      preview: URL.createObjectURL(file),
      source,
      clientKey: crypto.randomUUID(),
      position,
      positionError,
      capturedAt: new Date(source === "camera" ? file.lastModified || Date.now() : Date.now()).toISOString(),
    });
  }

  async function submit(form: HTMLFormElement) {
    if (!draft || !session) return;
    const f = new FormData(form);
    setError("");
    let d = draft;
    if (!d.photoId) {
      setBusy("saving");
      const r = await createFieldPhoto({
        client_key: d.clientKey,
        session_id: session.id,
        visit_id: visit?.id || null,
        site_id: visit ? null : String(f.get("site") || "") || null,
        project_id: String(f.get("project") || "") || null,
        source: d.source,
        lat: d.position?.lat ?? null,
        lng: d.position?.lng ?? null,
        accuracy: d.position?.accuracy ?? null,
        captured_at: d.capturedAt,
        file_name: d.file.name || "photo.jpg",
        mime: d.file.type,
        size: d.file.size,
        title: String(f.get("title") || ""),
        purpose: String(f.get("purpose") || ""),
        customer: String(f.get("customer") || ""),
        description: String(f.get("description") || ""),
        notes: String(f.get("notes") || ""),
      });
      if (!r.ok || !r.data) {
        setBusy("");
        return setError(r.error || "The photo could not be saved.");
      }
      d = { ...d, photoId: r.data.id, result: { verification: r.data.verification as Verification, distance_m: r.data.distance_m, expected_label: r.data.expected_label } };
      setDraft(d);
      if (r.data.file_path) {
        setBusy("");
        return finish(d);
      }
    }
    setBusy("uploading");
    setProgress(0);
    try {
      await uploadFile(undefined, d.file, false, undefined, {
        kind: "field_photo",
        fieldTarget: d.photoId,
        onProgress: (sent, total) => setProgress(Math.round((sent / total) * 100)),
      });
      finish(d);
    } catch (e) {
      setError((e instanceof Error ? e.message : "Upload failed") + " Your photo details are saved; retry the upload when you have a connection.");
    } finally {
      setBusy("");
    }
  }
  function finish(d: Draft) {
    const r = d.result;
    setDone(
      !r
        ? "Photo uploaded."
        : r.verification === "gps_unavailable"
          ? "Photo uploaded without a GPS location. It is marked for manual review."
          : r.expected_label && r.distance_m !== null
            ? `Photo uploaded · ${formatDistance(r.distance_m)} from ${r.expected_label}.`
            : "Photo uploaded. No expected site to compare against, so it is marked for manual review.",
    );
    setDraft(null);
    startTransition(() => router.refresh());
  }

  if (!session)
    return (
      <section className="panel p-5">
        <h2 className="section-title">GPS camera</h2>
        <p className="mt-2 text-xs text-muted-foreground">Start a field session to take GPS photos.</p>
      </section>
    );
  return (
    <section className="panel p-5" aria-labelledby="gps-camera">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="gps-camera" className="section-title">GPS camera</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {visit ? `Photos are linked to your visit “${visit.title}”.` : "Photos are linked to this field session."}{" "}
            {galleryAllowed ? "Gallery images are allowed but always need manual review." : "Your policy requires taking photos with the camera."}
          </p>
        </div>
        {!draft && (
          <div className="flex gap-2">
            <Button onClick={() => camera.current?.click()} disabled={Boolean(busy)}>
              {busy === "locating" ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />} Take photo
            </Button>
            {galleryAllowed && (
              <Button variant="outline" onClick={() => gallery.current?.click()} disabled={Boolean(busy)}>
                <ImageUp size={14} /> From gallery
              </Button>
            )}
          </div>
        )}
        <input ref={camera} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={(e) => { choose(e.target.files?.[0], "camera"); e.target.value = ""; }} />
        <input ref={gallery} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { choose(e.target.files?.[0], "gallery"); e.target.value = ""; }} />
      </div>
      {busy === "locating" && <p role="status" className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={13} className="animate-spin" /> Reading your location…</p>}
      {done && <p role="status" className="mt-3 rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-xs text-success">{done}</p>}
      {error && <p role="alert" className="error mt-3 text-xs">{error}</p>}
      {draft && (
        <form
          className="mt-4 grid gap-4 md:grid-cols-[220px_1fr]"
          onSubmit={(e) => {
            e.preventDefault();
            submit(e.currentTarget);
          }}
        >
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={draft.preview} alt="Photo preview" className="aspect-square w-full rounded-lg border border-border object-cover" />
            <div className="mt-2 flex flex-wrap gap-1.5">
              <SourceBadge source={draft.source} />
              {draft.result && <VerificationBadge status={draft.result.verification} short />}
            </div>
            <p className="mt-2 flex items-start gap-1 text-[11px] text-muted-foreground">
              <MapPin size={11} className="mt-0.5 shrink-0" />
              {draft.position
                ? `${draft.position.lat.toFixed(5)}, ${draft.position.lng.toFixed(5)} · ±${Math.round(draft.position.accuracy)} m`
                : draft.positionError || "No location"}
            </p>
            {!draft.position && <p className="mt-1 text-[11px] text-warning">Without GPS this photo will be marked “GPS Unavailable” for review.</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label htmlFor="p-title">Visit / photo title</label><input id="p-title" name="title" maxLength={200} defaultValue={visit?.title || ""} disabled={Boolean(draft.photoId)} /></div>
            <div><label htmlFor="p-purpose">Visit purpose</label><input id="p-purpose" name="purpose" maxLength={1000} defaultValue={visit?.purpose || ""} disabled={Boolean(draft.photoId)} /></div>
            <div><label htmlFor="p-customer">Customer or location name</label><input id="p-customer" name="customer" maxLength={200} defaultValue={visit?.customer || ""} disabled={Boolean(draft.photoId)} /></div>
            <div>
              <label htmlFor="p-project">Related project</label>
              <select id="p-project" name="project" defaultValue="" disabled={Boolean(draft.photoId)}>
                <option value="">None</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
            {!visit && (
              <div>
                <label htmlFor="p-site">Expected site</label>
                <select id="p-site" name="site" defaultValue="" disabled={Boolean(draft.photoId)}>
                  <option value="">Nearest assigned site</option>
                  {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
            <div><label htmlFor="p-notes">Notes</label><input id="p-notes" name="notes" maxLength={2000} disabled={Boolean(draft.photoId)} /></div>
            <div className="sm:col-span-2"><label htmlFor="p-desc">Description</label><textarea id="p-desc" name="description" rows={2} maxLength={5000} disabled={Boolean(draft.photoId)} /></div>
            {busy === "uploading" && (
              <div className="sm:col-span-2" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
                <div className="h-2 overflow-hidden rounded bg-muted"><div className="h-full bg-primary transition-all" style={{ width: progress + "%" }} /></div>
                <p className="mt-1 text-[11px] text-muted-foreground">Uploading {progress}%</p>
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
              {!draft.photoId && (
                <Button type="button" variant="outline" onClick={() => setDraft(null)} disabled={Boolean(busy)}>
                  <X size={14} /> Discard
                </Button>
              )}
              <Button disabled={Boolean(busy)}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : draft.photoId ? <RotateCcw size={14} /> : <Camera size={14} />}
                {busy === "saving" ? "Saving…" : busy === "uploading" ? "Uploading…" : draft.photoId ? "Retry upload" : "Submit photo"}
              </Button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}
