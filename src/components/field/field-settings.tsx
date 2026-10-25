"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Crosshair, Loader2, Pencil, Plus, Search } from "lucide-react";
import { saveFieldAssignment, saveFieldPolicy, saveFieldSite } from "@/lib/field-actions";
import { geolocationError, mapLink } from "@/lib/geo";
import { roleLabel, type Role } from "@/lib/roles";
import { toneClass, weekdays, type FieldAssignment, type FieldSite } from "@/lib/field";
import { Button } from "../ui/button";
import { Dialog, DialogContent } from "../ui/dialog";

export type Person = { id: string; full_name: string; employee_id: string | null; department: string | null; role: Role };
export type Policy = { retention_days: number; time_skew_minutes: number; notify: Record<string, boolean> };
export type AuditRow = { id: number; action: string; actor_name: string | null; user_name: string | null; site_name: string | null; details: Record<string, unknown>; created_at: string };
const notifyLabels: [string, string][] = [
  ["session_start", "A field session starts (to the Team Leader)"],
  ["photo", "Every GPS photo submitted"],
  ["photo_failed", "A photo fails geofence validation"],
  ["gps_unavailable", "A photo has no GPS information"],
  ["report", "A field report is submitted or escalated"],
  ["reply", "An employee replies to a question"],
  ["decision", "Employee: decisions and questions on their photos and reports"],
];
const defaults: Omit<FieldAssignment, "user_id"> = {
  enabled: true,
  team_leader_id: null,
  reporting_admin_id: null,
  schedule_days: [1, 2, 3, 4, 5, 6],
  schedule_start: "08:00",
  schedule_end: "20:00",
  interval_seconds: 300,
  photo_upload: true,
  gallery_allowed: false,
  geofence_required: true,
  default_radius_m: 150,
};

export function FieldSettings({
  people,
  assignments,
  assignmentSites,
  viewers,
  sites,
  policy,
  audit,
  timezone,
}: {
  people: Person[];
  assignments: FieldAssignment[];
  assignmentSites: { user_id: string; site_id: string }[];
  viewers: { user_id: string; viewer_id: string }[];
  sites: FieldSite[];
  policy: Policy;
  audit: AuditRow[];
  timezone: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"" | "field" | "office">("");
  const [edit, setEdit] = useState<{ person: Person; a: Omit<FieldAssignment, "user_id">; sites: string[]; viewers: string[] } | null>(null);
  const [site, setSite] = useState<{ id: string | null; d: Record<string, string | boolean> } | null>(null);
  const [pol, setPol] = useState(policy);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const byUser = useMemo(() => new Map(assignments.map((a) => [a.user_id, a])), [assignments]);
  const name = (id: string | null) => people.find((p) => p.id === id)?.full_name || "—";
  const needle = q.trim().toLowerCase();
  const list = people.filter((p) => {
    if (needle && !p.full_name.toLowerCase().includes(needle) && !(p.employee_id || "").toLowerCase().includes(needle)) return false;
    const a = byUser.get(p.id);
    if (only === "field") return Boolean(a?.enabled);
    if (only === "office") return !a?.enabled;
    return true;
  });
  const done = (text: string) => {
    setMessage(text);
    setError("");
    startTransition(() => router.refresh());
  };
  const run = async (label: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok: string, close?: () => void) => {
    setBusy(label);
    setError("");
    const r = await fn();
    setBusy("");
    if (!r.ok) return setError(r.error || "Could not save");
    close?.();
    done(ok);
  };
  const openEdit = (p: Person) => {
    const a = byUser.get(p.id);
    setError("");
    setEdit({
      person: p,
      a: a ? { ...a, schedule_start: a.schedule_start.slice(0, 5), schedule_end: a.schedule_end.slice(0, 5) } : { ...defaults },
      sites: assignmentSites.filter((x) => x.user_id === p.id).map((x) => x.site_id),
      viewers: viewers.filter((x) => x.user_id === p.id).map((x) => x.viewer_id),
    });
  };
  const when = (v: string) => new Date(v).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });

  return (
    <div className="space-y-8">
      {message && <p role="status" className="rounded-lg border bg-primary/5 p-3 text-sm">{message}</p>}
      {error && !edit && !site && <p role="alert" className="error">{error}</p>}

      <section aria-labelledby="fs-people">
        <h2 id="fs-people" className="section-title">Field employees</h2>
        <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
          Only people turned on here get field tracking and GPS photos; everyone else keeps using normal attendance. Team Leaders,
          Reporting Admins and authorized viewers see a person’s field records only if they also hold the “View field sessions…”
          permission (Settings → Roles & permissions).
        </p>
        <div className="panel my-3 flex flex-col gap-2 p-3 sm:flex-row">
          <label className="relative flex-1">
            <span className="sr-only">Search people</span>
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or employee ID" className="h-9 pl-9" />
          </label>
          <select aria-label="Show" value={only} onChange={(e) => setOnly(e.target.value as typeof only)} className="h-9 sm:w-48">
            <option value="">Everyone</option>
            <option value="field">Field tracking on</option>
            <option value="office">Office-based (tracking off)</option>
          </select>
        </div>
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>{["Employee", "Field tracking", "Team Leader", "Reporting Admin", "Schedule", "Photos", ""].map((h) => <th key={h} className="p-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const a = byUser.get(p.id);
                return (
                  <tr key={p.id} className="border-t">
                    <td className="p-3"><span className="block font-medium">{p.full_name}</span><span className="text-[11px] text-muted-foreground">{[p.employee_id, p.department, roleLabel(p.role)].filter(Boolean).join(" · ")}</span></td>
                    <td className="p-3">
                      <span className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] ${a?.enabled ? toneClass.green : toneClass.gray}`}>{a ? (a.enabled ? "On" : "Off") : "Not assigned"}</span>
                    </td>
                    <td className="p-3">{a ? name(a.team_leader_id) : "—"}</td>
                    <td className="p-3">{a ? name(a.reporting_admin_id) : "—"}</td>
                    <td className="p-3">{a ? `${a.schedule_days.map((d) => weekdays[d]).join(" ")} · ${a.schedule_start.slice(0, 5)}–${a.schedule_end.slice(0, 5)}` : "—"}</td>
                    <td className="p-3">{a ? (a.photo_upload ? (a.gallery_allowed ? "Camera + gallery" : "Camera only") : "Off") : "—"}</td>
                    <td className="p-3 text-right"><Button size="sm" variant="outline" onClick={() => openEdit(p)}>{a ? "Edit" : "Set up"}</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="fs-sites">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="fs-sites" className="section-title">Field sites</h2>
            <p className="mt-1 text-xs text-muted-foreground">Customer or work locations with a geofence. Photos and visits are verified against them.</p>
          </div>
          <Button size="sm" onClick={() => { setError(""); setSite({ id: null, d: { name: "", customer: "", address: "", latitude: "", longitude: "", radius_m: "100", active: true } }); }}>
            <Plus size={13} /> Add site
          </Button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sites.map((s) => (
            <article key={s.id} className={`panel p-4 text-xs ${s.active ? "" : "opacity-60"}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">{s.name}{!s.active && " · inactive"}</h3>
                  <p className="mt-1 text-muted-foreground">{[s.customer, s.address].filter(Boolean).join(" · ") || "No address"}</p>
                </div>
                <Button size="sm" variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => { setError(""); setSite({ id: s.id, d: { ...s, latitude: String(s.latitude), longitude: String(s.longitude), radius_m: String(s.radius_m) } }); }}>
                  <Pencil size={13} />
                </Button>
              </div>
              <p className="mt-2">{s.radius_m} m geofence · {assignmentSites.filter((x) => x.site_id === s.id).length} assigned</p>
              <a className="mt-1 inline-block text-primary hover:underline" href={mapLink(s.latitude, s.longitude)} target="_blank" rel="noreferrer">{s.latitude.toFixed(5)}, {s.longitude.toFixed(5)}</a>
            </article>
          ))}
          {!sites.length && <p className="panel p-6 text-center text-xs text-muted-foreground md:col-span-2 xl:col-span-3">No field sites yet.</p>}
        </div>
      </section>

      <section aria-labelledby="fs-policy" className="panel p-5">
        <h2 id="fs-policy" className="section-title">Verification, retention and notifications</h2>
        <div className="mt-3 grid gap-4 text-xs sm:grid-cols-2">
          <label className="mb-0">
            Keep location history for (days)
            <input type="number" min={30} max={3650} value={pol.retention_days} onChange={(e) => setPol({ ...pol, retention_days: Number(e.target.value) })} className="mt-1 h-9" />
            <span className="mt-1 block text-[11px] text-muted-foreground">Older tracked points are deleted and photo/visit coordinates cleared; results and files stay.</span>
          </label>
          <label className="mb-0">
            Capture-time tolerance (minutes)
            <input type="number" min={1} max={1440} value={pol.time_skew_minutes} onChange={(e) => setPol({ ...pol, time_skew_minutes: Number(e.target.value) })} className="mt-1 h-9" />
            <span className="mt-1 block text-[11px] text-muted-foreground">Photos whose device time differs from server time by more than this need manual review.</span>
          </label>
          <fieldset className="sm:col-span-2">
            <legend className="mb-2 font-medium">In-app notifications (email follows Settings → Email, event “field”; emails never include coordinates)</legend>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {notifyLabels.map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 font-normal">
                  <input type="checkbox" checked={pol.notify[k] !== false} onChange={(e) => setPol({ ...pol, notify: { ...pol.notify, [k]: e.target.checked } })} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="mt-4 flex justify-end">
          <Button size="sm" disabled={busy === "policy"} onClick={() => run("policy", () => saveFieldPolicy(pol), "Field policy saved.")}>
            {busy === "policy" ? "Saving…" : "Save policy"}
          </Button>
        </div>
      </section>

      <section aria-labelledby="fs-audit">
        <h2 id="fs-audit" className="section-title mb-3">Change history</h2>
        <div className="panel divide-y divide-border">
          {audit.map((a) => (
            <div key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-xs">
              <p><span className="font-medium">{a.action}</span>{a.user_name ? ` · ${a.user_name}` : ""}{a.site_name ? ` · ${a.site_name}` : ""}</p>
              <span className="text-[11px] text-muted-foreground">{a.actor_name || "—"} · {when(a.created_at)}</span>
            </div>
          ))}
          {!audit.length && <p className="p-6 text-center text-xs text-muted-foreground">No changes recorded yet.</p>}
        </div>
      </section>

      <Dialog open={Boolean(edit)} onOpenChange={(v) => !v && !busy && setEdit(null)}>
        {edit && (
          <DialogContent title={`Field tracking · ${edit.person.full_name}`} description="Changes apply immediately. Turning tracking off ends a running session.">
            <form
              className="mt-5 space-y-4 text-xs"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  "assign",
                  () => saveFieldAssignment({ user: edit.person.id, data: { ...edit.a, site_ids: edit.sites, viewer_ids: edit.viewers } }),
                  `${edit.person.full_name}: field settings saved.`,
                  () => setEdit(null),
                );
              }}
            >
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={edit.a.enabled} onChange={(e) => setEdit({ ...edit, a: { ...edit.a, enabled: e.target.checked } })} />
                Field tracking enabled for this employee
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="mb-0">Team Leader
                  <select className="mt-1" value={edit.a.team_leader_id || ""} onChange={(e) => setEdit({ ...edit, a: { ...edit.a, team_leader_id: e.target.value || null } })}>
                    <option value="">None</option>
                    {people.filter((p) => p.id !== edit.person.id).map((p) => <option key={p.id} value={p.id}>{p.full_name} · {roleLabel(p.role)}</option>)}
                  </select>
                </label>
                <label className="mb-0">Reporting Admin
                  <select className="mt-1" value={edit.a.reporting_admin_id || ""} onChange={(e) => setEdit({ ...edit, a: { ...edit.a, reporting_admin_id: e.target.value || null } })}>
                    <option value="">None</option>
                    {people.filter((p) => p.id !== edit.person.id && p.role !== "employee").map((p) => <option key={p.id} value={p.id}>{p.full_name} · {roleLabel(p.role)}</option>)}
                  </select>
                </label>
                <label className="mb-0">Tracking starts
                  <input type="time" className="mt-1" value={edit.a.schedule_start} onChange={(e) => setEdit({ ...edit, a: { ...edit.a, schedule_start: e.target.value } })} />
                </label>
                <label className="mb-0">Tracking ends
                  <input type="time" className="mt-1" value={edit.a.schedule_end} onChange={(e) => setEdit({ ...edit, a: { ...edit.a, schedule_end: e.target.value } })} />
                </label>
                <fieldset className="sm:col-span-2">
                  <legend className="mb-1">Working days</legend>
                  <div className="flex flex-wrap gap-3">
                    {weekdays.map((d, i) => (
                      <label key={d} className="flex items-center gap-1.5 font-normal">
                        <input type="checkbox" checked={edit.a.schedule_days.includes(i)} onChange={(e) => setEdit({ ...edit, a: { ...edit.a, schedule_days: e.target.checked ? [...edit.a.schedule_days, i].sort() : edit.a.schedule_days.filter((x) => x !== i) } })} />
                        {d}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="mb-0">Location every
                  <select className="mt-1" value={edit.a.interval_seconds} onChange={(e) => setEdit({ ...edit, a: { ...edit.a, interval_seconds: Number(e.target.value) } })}>
                    {[60, 120, 300, 600, 900, 1800, 3600].map((s) => <option key={s} value={s}>{s < 3600 ? `${s / 60} min` : "1 hour"}</option>)}
                  </select>
                </label>
                <label className="mb-0">Default geofence radius (m)
                  <input type="number" min={10} max={50000} className="mt-1" value={edit.a.default_radius_m} onChange={(e) => setEdit({ ...edit, a: { ...edit.a, default_radius_m: Number(e.target.value) } })} />
                </label>
              </div>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 font-normal"><input type="checkbox" checked={edit.a.photo_upload} onChange={(e) => setEdit({ ...edit, a: { ...edit.a, photo_upload: e.target.checked } })} /> GPS photo upload allowed</label>
                <label className="flex items-center gap-2 font-normal"><input type="checkbox" checked={edit.a.gallery_allowed} disabled={!edit.a.photo_upload} onChange={(e) => setEdit({ ...edit, a: { ...edit.a, gallery_allowed: e.target.checked } })} /> Allow gallery uploads (otherwise camera capture during an active session is required)</label>
                <label className="flex items-center gap-2 font-normal"><input type="checkbox" checked={edit.a.geofence_required} onChange={(e) => setEdit({ ...edit, a: { ...edit.a, geofence_required: e.target.checked } })} /> Geofence verification required</label>
              </div>
              <fieldset>
                <legend className="mb-1">Assigned working locations {edit.sites.length ? `(${edit.sites.length})` : "(none: any active site)"}</legend>
                <div className="grid max-h-36 gap-1 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-2">
                  {sites.filter((s) => s.active || edit.sites.includes(s.id)).map((s) => (
                    <label key={s.id} className="flex items-center gap-2 font-normal">
                      <input type="checkbox" checked={edit.sites.includes(s.id)} onChange={(e) => setEdit({ ...edit, sites: e.target.checked ? [...edit.sites, s.id] : edit.sites.filter((x) => x !== s.id) })} />
                      {s.name}
                    </label>
                  ))}
                  {!sites.length && <span className="text-muted-foreground">Add field sites first.</span>}
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-1">Additional authorized viewers {edit.viewers.length ? `(${edit.viewers.length})` : ""}</legend>
                <div className="grid max-h-36 gap-1 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-2">
                  {people.filter((p) => p.id !== edit.person.id && p.role !== "super_admin").map((p) => (
                    <label key={p.id} className="flex items-center gap-2 font-normal">
                      <input type="checkbox" checked={edit.viewers.includes(p.id)} onChange={(e) => setEdit({ ...edit, viewers: e.target.checked ? [...edit.viewers, p.id] : edit.viewers.filter((x) => x !== p.id) })} />
                      {p.full_name}
                    </label>
                  ))}
                </div>
              </fieldset>
              {error && <p role="alert" className="error">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEdit(null)} disabled={Boolean(busy)}>Cancel</Button>
                <Button disabled={Boolean(busy)}>{busy === "assign" ? "Saving…" : "Save"}</Button>
              </div>
            </form>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={Boolean(site)} onOpenChange={(v) => !v && !busy && setSite(null)}>
        {site && (
          <DialogContent title={site.id ? "Edit field site" : "Add field site"} description="The geofence is checked on the server for visits and photos.">
            <form
              className="mt-5 grid gap-3 text-xs sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                const d = site.d;
                run(
                  "site",
                  () => saveFieldSite({ id: site.id, data: { name: String(d.name), customer: String(d.customer || ""), address: String(d.address || ""), latitude: d.latitude === "" ? NaN : Number(d.latitude), longitude: d.longitude === "" ? NaN : Number(d.longitude), radius_m: Number(d.radius_m), active: Boolean(d.active) } }),
                  `${d.name} saved.`,
                  () => setSite(null),
                );
              }}
            >
              {([["name", "Site name *"], ["customer", "Customer"], ["address", "Address"], ["radius_m", "Geofence radius (m) *"], ["latitude", "Latitude *"], ["longitude", "Longitude *"]] as const).map(([k, label]) => (
                <label key={k} className="mb-0">{label}
                  <input className="mt-1" required={label.endsWith("*")} inputMode={k === "name" || k === "customer" || k === "address" ? undefined : "decimal"} value={String(site.d[k] ?? "")} onChange={(e) => setSite({ ...site, d: { ...site.d, [k]: e.target.value } })} />
                </label>
              ))}
              <button
                type="button"
                className="inline-flex items-center gap-1.5 justify-self-start font-medium text-primary hover:underline"
                onClick={() =>
                  navigator.geolocation?.getCurrentPosition(
                    (p) => setSite((s) => s && { ...s, d: { ...s.d, latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6) } }),
                    (e) => setError(geolocationError(e)),
                    { enableHighAccuracy: true, timeout: 20000 },
                  )
                }
              >
                <Crosshair size={13} /> Use my current position
              </button>
              <label className="flex items-center gap-2 font-normal"><input type="checkbox" checked={Boolean(site.d.active)} onChange={(e) => setSite({ ...site, d: { ...site.d, active: e.target.checked } })} /> Active</label>
              {error && <p role="alert" className="error sm:col-span-2">{error}</p>}
              <div className="flex justify-end gap-2 sm:col-span-2">
                <Button type="button" variant="outline" onClick={() => setSite(null)} disabled={Boolean(busy)}>Cancel</Button>
                <Button disabled={Boolean(busy)}>{busy === "site" ? <Loader2 size={13} className="animate-spin" /> : null} Save site</Button>
              </div>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
