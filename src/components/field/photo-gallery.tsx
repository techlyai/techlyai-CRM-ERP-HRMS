"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, ImageOff, Loader2, MessageSquare, X } from "lucide-react";
import { replyFieldPhoto, reviewFieldPhoto } from "@/lib/field-actions";
import { formatDistance, mapLink } from "@/lib/geo";
import { photoVerification, verificationInfo, type FieldEvent } from "@/lib/field";
import type { PhotoRow } from "@/lib/field-data";
import { Button } from "../ui/button";
import { Dialog, DialogContent } from "../ui/dialog";
import { PhotoBadge, ReviewBadge, SourceBadge } from "./badges";
import { FieldMap } from "./field-map";

type Event = FieldEvent & { actor_name: string | null };
const actionLabel: Record<string, string> = {
  photo_approve: "Approved",
  photo_reject: "Rejected",
  photo_clarify: "Asked for clarification",
  reply: "Replied",
};

/** Grid of GPS photos with a detail panel for metadata, verification and review. */
export function PhotoGallery({
  photos,
  events,
  me,
  timezone,
  initial,
  empty,
}: {
  photos: PhotoRow[];
  events: Event[];
  me: string;
  timezone: string;
  initial?: string;
  empty: string;
}) {
  const [open, setOpen] = useState<string | null>(initial && photos.some((p) => p.id === initial) ? initial : null);
  useEffect(() => {
    if (initial && photos.some((p) => p.id === initial)) setOpen(initial);
  }, [initial, photos]);
  const photo = photos.find((p) => p.id === open) || null;
  const when = (v: string | null) => (v ? new Date(v).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }) : "—");
  return (
    <>
      {!photos.length ? (
        <p className="panel p-8 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {photos.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => setOpen(p.id)} className="panel block w-full overflow-hidden text-left hover:border-primary/40">
                {p.file_path ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/field/files/photo/${p.id}`} alt={p.title || "Field photo"} loading="lazy" className="aspect-[4/3] w-full bg-muted object-cover" />
                ) : (
                  <span className="grid aspect-[4/3] place-items-center bg-muted text-[11px] text-muted-foreground"><ImageOff size={18} />Upload not finished</span>
                )}
                <span className="block space-y-1.5 p-2.5">
                  <span className="block truncate text-xs font-medium">{p.title || p.visit_title || p.file_name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{p.name} · {when(p.captured_at || p.uploaded_at)}</span>
                  <span className="flex flex-wrap gap-1"><PhotoBadge photo={p} short /><ReviewBadge status={p.review_status} /></span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={Boolean(photo)} onOpenChange={(v) => !v && setOpen(null)}>
        {photo && (
          <DialogContent title={photo.title || photo.visit_title || "Field photo"} description={`${photo.name}${photo.employee_id ? ` · ${photo.employee_id}` : ""} · ${when(photo.uploaded_at)}`}>
            <PhotoDetail photo={photo} events={events.filter((e) => e.photo_id === photo.id)} me={me} when={when} onDone={() => setOpen(photo.id)} />
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

function PhotoDetail({ photo: p, events, me, when }: { photo: PhotoRow; events: Event[]; me: string; when: (v: string | null) => string; onDone: () => void }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const own = p.user_id === me;
  const status = photoVerification(p);
  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, label: string) => {
    setBusy(label);
    setError("");
    const r = await fn();
    setBusy("");
    if (!r.ok) return setError(r.error || "Request failed");
    setNote("");
    startTransition(() => router.refresh());
  };
  const rows: [string, React.ReactNode][] = [
    ["Device location", p.latitude !== null && p.longitude !== null ? (
      <a key="l" className="inline-flex items-center gap-1 text-primary hover:underline" href={mapLink(p.latitude, p.longitude)} target="_blank" rel="noreferrer">
        {p.latitude.toFixed(6)}, {p.longitude.toFixed(6)} <ExternalLink size={11} />
      </a>
    ) : p.location_purged_at ? "Removed under the retention policy" : "Not available"],
    ["GPS accuracy", p.accuracy_m !== null ? `±${Math.round(p.accuracy_m)} m` : "—"],
    ["Expected location", p.expected_label ? `${p.expected_label} · ${p.expected_radius_m} m geofence` : "None configured"],
    ["Distance from expected", formatDistance(p.distance_m)],
    ["Captured (device time)", when(p.captured_at)],
    ["Registered (server time)", when(p.uploaded_at)],
    ["File received", when(p.file_uploaded_at)],
    ["Visit", p.visit_title || "—"],
    ["Customer", p.customer || "—"],
    ["Purpose", p.purpose || "—"],
  ];
  const checks: string[] = [];
  if (p.checks.gallery_image) checks.push("Uploaded from the gallery: where it was taken is not established.");
  if (p.checks.no_expected_location) checks.push("No expected site was set, so there was nothing to compare against.");
  if (p.checks.time_skew_seconds !== undefined)
    checks.push(
      p.checks.time_skew_seconds === null
        ? "The device did not report a capture time."
        : `Device capture time differs from server time by ${Math.round(Math.abs(Number(p.checks.time_skew_seconds)) / 60)} min.`,
    );
  return (
    <div className="mt-4 space-y-4 text-xs">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          {p.file_path ? (
            <a href={`/api/field/files/photo/${p.id}`} target="_blank" rel="noreferrer" title="Open original image">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/field/files/photo/${p.id}`} alt={p.title || "Field photo"} className="max-h-80 w-full rounded-lg border border-border bg-muted object-contain" />
            </a>
          ) : (
            <p className="grid h-48 place-items-center rounded-lg border border-border bg-muted text-muted-foreground">The image upload has not finished.</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5"><PhotoBadge photo={p} /><ReviewBadge status={p.review_status} /><SourceBadge source={p.source} /></div>
        </div>
        <div>
          {p.latitude !== null && p.longitude !== null ? (
            <FieldMap
              height={240}
              markers={[
                { id: "photo", lat: p.latitude, lng: p.longitude, kind: "photo", tone: verificationInfo[status].tone, label: "Photo location" },
                ...(p.expected_lat !== null && p.expected_lng !== null ? [{ id: "exp", lat: p.expected_lat, lng: p.expected_lng, kind: "site" as const, tone: "blue" as const, label: p.expected_label || "Expected location" }] : []),
              ]}
              circles={p.expected_lat !== null && p.expected_lng !== null && p.expected_radius_m ? [{ id: "g", lat: p.expected_lat, lng: p.expected_lng, radius: p.expected_radius_m, label: "Geofence" }] : []}
            />
          ) : (
            <p className="grid h-[240px] place-items-center rounded-xl border border-border bg-muted/40 text-muted-foreground">No location to show</p>
          )}
        </div>
      </div>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-border/60 pb-1.5">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {(p.description || p.notes) && <p className="whitespace-pre-wrap">{p.description}{p.notes ? `\n\nNotes: ${p.notes}` : ""}</p>}
      <div className="rounded-lg bg-muted/50 p-3 text-muted-foreground">
        <p className="font-medium text-foreground">About this result</p>
        <p className="mt-1">
          {verificationInfo[status].label}. This compares the device-reported position with the expected geofence. It does not prove the photo was taken there, or that the device location was genuine.
        </p>
        {checks.map((c) => <p key={c} className="mt-1">• {c}</p>)}
      </div>
      <section>
        <h3 className="mb-2 font-semibold">Review history</h3>
        {!events.length && <p className="text-muted-foreground">No review activity yet.</p>}
        <ol className="space-y-2">
          {events.map((e) => (
            <li key={e.id} className="rounded-lg border border-border p-2.5">
              <p><span className="font-medium">{e.actor_name || "Former user"}</span> · {actionLabel[e.action] || e.action} · <span className="text-muted-foreground">{when(e.created_at)}</span></p>
              {e.body && <p className="mt-1 whitespace-pre-wrap">{e.body}</p>}
            </li>
          ))}
        </ol>
      </section>
      {(p.can_review && !own) || own ? (
        <div className="space-y-2">
          <label htmlFor="photo-note" className="text-xs">{own ? "Reply to your reviewer" : "Note or question (required to reject or ask)"}</label>
          <textarea id="photo-note" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          {error && <p role="alert" className="error">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            {own ? (
              <Button size="sm" disabled={Boolean(busy) || !note.trim()} onClick={() => act(() => replyFieldPhoto({ photo: p.id, body: note }), "reply")}>
                {busy === "reply" ? <Loader2 size={13} className="animate-spin" /> : <MessageSquare size={13} />} Send reply
              </Button>
            ) : (
              <>
                <Button size="sm" variant="outline" disabled={Boolean(busy) || !note.trim()} onClick={() => act(() => reviewFieldPhoto({ photo: p.id, action: "clarify", note }), "clarify")}>
                  <MessageSquare size={13} /> Ask / request more photos
                </Button>
                <Button size="sm" variant="outline" disabled={Boolean(busy) || !note.trim()} onClick={() => act(() => reviewFieldPhoto({ photo: p.id, action: "reject", note }), "reject")}>
                  <X size={13} /> Reject
                </Button>
                <Button size="sm" disabled={Boolean(busy)} onClick={() => act(() => reviewFieldPhoto({ photo: p.id, action: "approve", note }), "approve")}>
                  {busy === "approve" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Approve
                </Button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
