"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Crosshair, ExternalLink, History, Loader2, MapPin, Pencil, Plus, Search } from "lucide-react";
import { saveOfficeLocation, setAttendanceLocation } from "@/lib/attendance-actions";
import { saveSettings } from "@/lib/actions";
import { geolocationError, mapEmbed, mapLink } from "@/lib/geo";
import { roleLabel } from "@/lib/roles";
import type { Profile } from "@/lib/modules";
import type { CompanySettings } from "./settings";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";

export type OfficeLocation = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  require_inside: boolean;
  is_default: boolean;
  active: boolean;
  updated_at: string;
};
export type Assignment = {
  user_id: string;
  location_id: string;
  radius_override_m: number | null;
  allow_remote: boolean;
};
export type LocationAuditEntry = {
  id: number;
  actor_id: string | null;
  action: string;
  location_id: string | null;
  user_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
};
type Person = Pick<Profile, "id" | "full_name" | "role" | "department"> & { employee_id: string | null };
type Draft = Omit<OfficeLocation, "id" | "updated_at" | "latitude" | "longitude" | "radius_m"> & {
  latitude: string;
  longitude: string;
  radius_m: string;
};
const blank: Draft = { name: "", address: "", latitude: "", longitude: "", radius_m: "100", require_inside: true, is_default: false, active: true };

/** Settings → Office locations & geofencing. Every save is re-checked by the database. */
export function OfficeLocations({
  offices,
  assignments,
  people,
  audit,
  assignable,
  abilities,
  settings,
}: {
  offices: OfficeLocation[];
  assignments: Assignment[];
  people: Person[];
  audit: LocationAuditEntry[];
  /** People this viewer may reassign. */
  assignable: string[];
  abilities: { manage: boolean; assign: boolean; retention: boolean };
  settings: CompanySettings | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [q, setQ] = useState("");
  const [officeFilter, setOfficeFilter] = useState("");
  const [retention, setRetention] = useState(String(settings?.location_retention_days ?? 365));
  const byUser = useMemo(() => new Map(assignments.map((a) => [a.user_id, a])), [assignments]);
  const officeName = (id: string | null | undefined) => offices.find((o) => o.id === id)?.name || "—";
  const personName = (id: string | null | undefined) => people.find((p) => p.id === id)?.full_name || "Former user";
  const defaultOffice = offices.find((o) => o.is_default && o.active);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of assignments) m.set(a.location_id, (m.get(a.location_id) || 0) + 1);
    return m;
  }, [assignments]);
  const needle = q.trim().toLowerCase();
  const list = people.filter((p) => {
    if (needle && !p.full_name.toLowerCase().includes(needle) && !(p.employee_id || "").toLowerCase().includes(needle)) return false;
    const a = byUser.get(p.id);
    if (officeFilter === "none") return !a;
    if (officeFilter) return a?.location_id === officeFilter;
    return true;
  });

  const done = (text: string) => {
    setMessage(text);
    setError("");
    router.refresh();
  };

  async function saveOffice() {
    if (!editing) return;
    const d = editing.draft;
    setBusy("office");
    setError("");
    const r = await saveOfficeLocation({
      id: editing.id,
      data: {
        name: d.name,
        address: d.address,
        latitude: d.latitude.trim() === "" ? NaN : Number(d.latitude),
        longitude: d.longitude.trim() === "" ? NaN : Number(d.longitude),
        radius_m: Number(d.radius_m),
        require_inside: d.require_inside,
        is_default: d.is_default,
        active: d.active,
      },
    });
    setBusy("");
    if (!r.ok) return setError(r.error || "Could not save the office");
    setEditing(null);
    done(`${d.name} saved.`);
  }

  function useCurrentPosition() {
    if (!navigator.geolocation) return setError(geolocationError(undefined));
    setBusy("locate");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setBusy("");
        setEditing((e) =>
          e && { ...e, draft: { ...e.draft, latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6) } },
        );
        setMessage(`Position captured (±${Math.round(p.coords.accuracy)} m). Check it on the map before saving.`);
      },
      (e) => {
        setBusy("");
        setError(geolocationError(e));
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }

  async function assign(user: string, patch: Omit<Partial<Assignment>, "location_id"> & { location_id: string | null }) {
    const cur = byUser.get(user);
    setBusy("assign:" + user);
    const r = await setAttendanceLocation({
      user,
      location: patch.location_id,
      radius: patch.location_id ? (patch.radius_override_m !== undefined ? patch.radius_override_m : cur?.radius_override_m ?? null) : null,
      allowRemote: patch.location_id ? (patch.allow_remote ?? cur?.allow_remote ?? false) : false,
    });
    setBusy("");
    if (!r.ok) return setError(r.error || "Could not change the assignment");
    done(`${personName(user)}: ${patch.location_id ? officeName(patch.location_id) : "assignment removed"}.`);
  }

  async function saveRetention() {
    if (!settings) return;
    setBusy("retention");
    const r = await saveSettings({ ...settings, location_retention_days: Number(retention) });
    setBusy("");
    if (!r.ok) return setError(r.error || "Could not save the retention period");
    done("Retention period saved.");
  }

  const draft = editing?.draft;
  const lat = Number(draft?.latitude);
  const lng = Number(draft?.longitude);
  const validPoint = draft && draft.latitude !== "" && draft.longitude !== "" && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const embed = validPoint ? mapEmbed(lat, lng) : null;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-[11px] text-muted-foreground">
            <Link href="/settings" className="hover:text-foreground">Settings</Link>
            <span className="mx-1.5 text-muted-foreground/40">/</span> Office locations
          </p>
          <h1 className="text-2xl font-semibold">Office locations & geofencing</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Each person checks in against their assigned office. People without an assignment use the default office
            {defaultOffice ? ` (${defaultOffice.name})` : "; there is none yet, so their check-ins are recorded without location verification"}.
          </p>
        </div>
        {abilities.manage && (
          <Button onClick={() => { setError(""); setMessage(""); setEditing({ id: null, draft: { ...blank, is_default: !defaultOffice } }); }}>
            <Plus size={14} /> Add office
          </Button>
        )}
      </div>
      {message && <p role="status" className="mb-4 rounded-lg border bg-primary/5 p-3 text-sm">{message}</p>}
      {error && !editing && <p role="alert" className="error mb-4">{error}</p>}

      <section aria-labelledby="offices-title" className="mb-8">
        <h2 id="offices-title" className="section-title mb-3">Offices</h2>
        {!offices.length ? (
          <div className="panel p-8 text-center text-sm text-muted-foreground">
            <Building2 size={22} className="mx-auto mb-3" />
            No office locations yet.{abilities.manage ? " Add one to start verifying check-ins." : ""}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {offices.map((o) => (
              <article key={o.id} className={`panel p-4 ${o.active ? "" : "opacity-60"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      {o.name}
                      {o.is_default && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">Default</span>}
                      {!o.active && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Inactive</span>}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">{o.address || "No address"}</p>
                  </div>
                  {abilities.manage && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Edit ${o.name}`}
                      onClick={() => {
                        setError("");
                        setMessage("");
                        setEditing({ id: o.id, draft: { ...o, latitude: String(o.latitude), longitude: String(o.longitude), radius_m: String(o.radius_m) } });
                      }}
                    >
                      <Pencil size={13} />
                    </Button>
                  )}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div><dt className="text-muted-foreground">Geofence</dt><dd className="font-medium">{o.radius_m} m</dd></div>
                  <div><dt className="text-muted-foreground">Assigned people</dt><dd className="font-medium">{counts.get(o.id) || 0}</dd></div>
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Check-in outside the geofence</dt>
                    <dd className="font-medium">{o.require_inside ? "Refused" : "Allowed, flagged as not verified"}</dd>
                  </div>
                </dl>
                <a className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline" href={mapLink(o.latitude, o.longitude)} target="_blank" rel="noreferrer">
                  <MapPin size={12} /> {o.latitude.toFixed(5)}, {o.longitude.toFixed(5)} <ExternalLink size={11} />
                </a>
              </article>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="assign-title" className="mb-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="assign-title" className="section-title">People and their attendance location</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Radius override replaces the office radius for one person. “Work from home” lets that person check in outside the geofence as Work From Home.
            </p>
          </div>
        </div>
        <div className="panel mb-3 flex flex-col gap-2 p-3 sm:flex-row">
          <label className="relative flex-1">
            <span className="sr-only">Search people</span>
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or employee ID" className="h-9 pl-9" />
          </label>
          <select aria-label="Filter by office" value={officeFilter} onChange={(e) => setOfficeFilter(e.target.value)} className="h-9 sm:w-52">
            <option value="">All offices</option>
            <option value="none">Not assigned</option>
            {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                {["Person", "Assigned office", "Radius override (m)", "Work from home", ""].map((h) => <th key={h} className="p-3 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const a = byUser.get(p.id);
                const editable = abilities.assign && assignable.includes(p.id);
                const saving = busy === "assign:" + p.id;
                return (
                  <tr key={p.id} className="border-t">
                    <td className="p-3">
                      <span className="block font-medium">{p.full_name}</span>
                      <span className="text-[11px] text-muted-foreground">{[p.employee_id, p.department, roleLabel(p.role)].filter(Boolean).join(" · ")}</span>
                    </td>
                    <td className="p-3">
                      {editable ? (
                        <select
                          aria-label={`Office for ${p.full_name}`}
                          value={a?.location_id || ""}
                          disabled={saving}
                          onChange={(e) => assign(p.id, { location_id: e.target.value || null })}
                          className="h-8 w-48 py-0 text-xs"
                        >
                          <option value="">{defaultOffice ? `Default (${defaultOffice.name})` : "Not assigned"}</option>
                          {offices.filter((o) => o.active || o.id === a?.location_id).map((o) => (
                            <option key={o.id} value={o.id}>{o.name}{o.active ? "" : " (inactive)"}</option>
                          ))}
                        </select>
                      ) : a ? officeName(a.location_id) : <span className="text-muted-foreground">{defaultOffice ? `Default (${defaultOffice.name})` : "Not assigned"}</span>}
                    </td>
                    <td className="p-3">
                      {editable && a ? (
                        <input
                          type="number"
                          min={10}
                          max={50000}
                          aria-label={`Radius override for ${p.full_name}`}
                          placeholder={`Office: ${offices.find((o) => o.id === a.location_id)?.radius_m ?? ""}`}
                          key={String(a.radius_override_m)}
                          defaultValue={a.radius_override_m ?? ""}
                          disabled={saving}
                          onBlur={(e) => {
                            const v = e.target.value.trim() === "" ? null : Number(e.target.value);
                            if (v !== a.radius_override_m) assign(p.id, { location_id: a.location_id, radius_override_m: v });
                          }}
                          className="h-8 w-32 py-0 text-xs"
                        />
                      ) : (
                        a?.radius_override_m ?? "—"
                      )}
                    </td>
                    <td className="p-3">
                      <input
                        type="checkbox"
                        aria-label={`Allow work from home for ${p.full_name}`}
                        checked={Boolean(a?.allow_remote)}
                        disabled={!editable || !a || saving}
                        onChange={(e) => a && assign(p.id, { location_id: a.location_id, allow_remote: e.target.checked })}
                      />
                    </td>
                    <td className="p-3 text-right">{saving && <Loader2 size={13} className="inline animate-spin text-muted-foreground" />}</td>
                  </tr>
                );
              })}
              {!list.length && (
                <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No people match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {abilities.retention && settings && (
        <section aria-labelledby="retention-title" className="panel mb-8 p-5">
          <h2 id="retention-title" className="section-title">Location data retention</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Exact check-in and check-out coordinates are removed after this many days. Distance, verification results and times are kept for attendance reports.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="mb-0">
              <span className="text-xs">Keep coordinates for (days)</span>
              <input type="number" min={30} max={3650} value={retention} onChange={(e) => setRetention(e.target.value)} className="h-9 w-36" />
            </label>
            <Button size="sm" onClick={saveRetention} disabled={busy === "retention" || Number(retention) === (settings.location_retention_days ?? 365)}>
              Save
            </Button>
          </div>
        </section>
      )}

      <section aria-labelledby="history-title">
        <h2 id="history-title" className="section-title mb-3 flex items-center gap-2"><History size={15} /> Change history</h2>
        <div className="panel divide-y divide-border">
          {audit.map((h) => (
            <div key={h.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-xs">
              <p>
                <span className="font-medium">{h.action}</span>
                {h.user_id ? ` · ${personName(h.user_id)}` : ""}
                {h.location_id ? ` · ${officeName(h.location_id)}` : ""}
                <span className="block text-[11px] text-muted-foreground">{describeChange(h, officeName)}</span>
              </p>
              <span className="text-[11px] text-muted-foreground">
                {personName(h.actor_id)} · {new Date(h.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
              </span>
            </div>
          ))}
          {!audit.length && <p className="p-6 text-center text-xs text-muted-foreground">No changes recorded yet.</p>}
        </div>
      </section>

      <Dialog open={Boolean(editing)} onOpenChange={(v) => !v && busy !== "office" && setEditing(null)}>
        {editing && draft && (
          <DialogContent
            title={editing.id ? `Edit ${draft.name || "office"}` : "Add office location"}
            description="Coordinates and radius are used on the server to verify check-ins. Changes apply to the next check-in."
          >
            <form
              className="mt-5 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                saveOffice();
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="o-name">Office name *</label>
                  <input id="o-name" required maxLength={120} value={draft.name} onChange={(e) => setEditing({ ...editing, draft: { ...draft, name: e.target.value } })} placeholder="Madurai office" />
                </div>
                <div>
                  <label htmlFor="o-radius">Geofence radius (metres) *</label>
                  <input id="o-radius" type="number" required min={10} max={50000} step={1} value={draft.radius_m} onChange={(e) => setEditing({ ...editing, draft: { ...draft, radius_m: e.target.value } })} />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="o-address">Address</label>
                  <textarea id="o-address" rows={2} maxLength={500} value={draft.address} onChange={(e) => setEditing({ ...editing, draft: { ...draft, address: e.target.value } })} />
                </div>
                <div>
                  <label htmlFor="o-lat">Latitude *</label>
                  <input id="o-lat" required inputMode="decimal" value={draft.latitude} onChange={(e) => setEditing({ ...editing, draft: { ...draft, latitude: e.target.value } })} placeholder="9.925200" />
                </div>
                <div>
                  <label htmlFor="o-lng">Longitude *</label>
                  <input id="o-lng" required inputMode="decimal" value={draft.longitude} onChange={(e) => setEditing({ ...editing, draft: { ...draft, longitude: e.target.value } })} placeholder="78.119800" />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <button type="button" onClick={useCurrentPosition} disabled={busy === "locate"} className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline disabled:opacity-50">
                  {busy === "locate" ? <Loader2 size={13} className="animate-spin" /> : <Crosshair size={13} />} Use my current position
                </button>
                {validPoint && (
                  <a className="inline-flex items-center gap-1.5 text-primary hover:underline" href={mapLink(lat, lng)} target="_blank" rel="noreferrer">
                    <MapPin size={13} /> Check on OpenStreetMap <ExternalLink size={11} />
                  </a>
                )}
              </div>
              {embed && <iframe title="Office location preview" src={embed} className="h-56 w-full rounded-lg border border-border" loading="lazy" referrerPolicy="no-referrer" />}
              <div className="space-y-2">
                <label className="flex items-start gap-2 font-normal">
                  <input type="checkbox" className="mt-0.5" checked={draft.require_inside} onChange={(e) => setEditing({ ...editing, draft: { ...draft, require_inside: e.target.checked } })} />
                  <span>Refuse check-in outside the geofence<span className="block text-[11px] text-muted-foreground">When off, outside check-ins are recorded but marked as not location-verified.</span></span>
                </label>
                <label className="flex items-start gap-2 font-normal">
                  <input type="checkbox" className="mt-0.5" checked={draft.is_default} onChange={(e) => setEditing({ ...editing, draft: { ...draft, is_default: e.target.checked, active: e.target.checked || draft.active } })} />
                  <span>Default office<span className="block text-[11px] text-muted-foreground">Used for anyone without an assignment.</span></span>
                </label>
                <label className="flex items-center gap-2 font-normal">
                  <input type="checkbox" checked={draft.active} disabled={draft.is_default} onChange={(e) => setEditing({ ...editing, draft: { ...draft, active: e.target.checked } })} />
                  Active
                </label>
              </div>
              {error && <p role="alert" className="error">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={busy === "office"}>Cancel</Button>
                <Button disabled={busy === "office"}>{busy === "office" ? "Saving…" : "Save office"}</Button>
              </div>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

function describeChange(h: LocationAuditEntry, officeName: (id: string | null | undefined) => string) {
  const b = h.before || {};
  const a = h.after || {};
  const parts: string[] = [];
  const show = (k: string, label: string, fmt = (v: unknown) => String(v ?? "—")) => {
    if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) parts.push(`${label}: ${h.before ? fmt(b[k]) + " → " : ""}${fmt(a[k])}`);
  };
  if (h.user_id) {
    show("location_id", "Office", (v) => (v ? officeName(String(v)) : "none"));
    show("radius_override_m", "Radius override");
    show("allow_remote", "Work from home", (v) => (v ? "allowed" : "not allowed"));
  } else {
    show("name", "Name");
    show("address", "Address");
    show("latitude", "Latitude");
    show("longitude", "Longitude");
    show("radius_m", "Radius (m)");
    show("require_inside", "Outside check-in", (v) => (v ? "refused" : "allowed"));
    show("is_default", "Default", (v) => (v ? "yes" : "no"));
    show("active", "Active", (v) => (v ? "yes" : "no"));
  }
  return parts.join(" · ") || "No field changes";
}
