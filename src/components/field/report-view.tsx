"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, FileText, Loader2, MessageSquare, Paperclip, Send, X } from "lucide-react";
import { fieldReportAction, saveFieldReport } from "@/lib/field-actions";
import { formatDistance } from "@/lib/geo";
import type { FieldEvent, FieldPhoto, FieldReport, FieldSession, FieldVisit } from "@/lib/field";
import { uploadFile } from "../attachments";
import { Button } from "../ui/button";
import { PhotoBadge, ReportBadge, SourceBadge, VerificationBadge } from "./badges";

export type ReportFile = { id: string; name: string; mime: string; size: number; created_at: string };
type Event = FieldEvent & { actor_name: string | null };
const actionLabels: Record<string, string> = {
  created: "Created the report",
  submit: "Submitted for review",
  reply: "Replied",
  question: "Asked a question",
  escalate: "Escalated to the Admin",
  approve: "Approved",
  reject: "Rejected",
  attachment: "Attached a file",
};

export function ReportView({
  report,
  person,
  linkedPhotos,
  linkedVisits,
  files,
  events,
  sessions,
  dayPhotos,
  dayVisits,
  eods,
  projects,
  abilities,
  date,
  editable,
  me,
  timezone,
}: {
  report: FieldReport | null;
  person: { id: string; full_name: string; employee_id: string | null; department: string | null };
  linkedPhotos: FieldPhoto[];
  linkedVisits: FieldVisit[];
  files: ReportFile[];
  events: Event[];
  sessions: FieldSession[];
  dayPhotos: FieldPhoto[];
  dayVisits: FieldVisit[];
  eods: { id: string; title: string }[];
  projects: { id: string; title: string }[];
  abilities: { review: boolean; approve: boolean };
  date: string;
  editable: boolean;
  me: string;
  timezone: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [photoIds, setPhotoIds] = useState<string[]>(linkedPhotos.map((p) => p.id));
  const [visitIds, setVisitIds] = useState<string[]>(linkedVisits.map((v) => v.id));
  const [progress, setProgress] = useState<string>("");
  const own = person.id === me;
  const when = (v: string | null) => (v ? new Date(v).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }) : "—");
  const time = (v: string | null) => (v ? new Date(v).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: timezone }) : "—");
  const refresh = () => startTransition(() => router.refresh());
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const photos = editable ? dayPhotos : linkedPhotos;
  const visits = editable ? dayVisits : linkedVisits;
  const start = sessions[0]?.started_at || null;
  const end = sessions.length ? sessions[sessions.length - 1].ended_at : null;

  async function save(form: HTMLFormElement, submitAfter = false) {
    const f = new FormData(form);
    setBusy(submitAfter ? "submit" : "save");
    setError("");
    const r = await saveFieldReport({
      id: report?.id || null,
      data: {
        title: String(f.get("title")),
        report_date: String(f.get("report_date")),
        session_id: String(f.get("session") || "") || null,
        work_completed: String(f.get("work_completed") || ""),
        customer: String(f.get("customer") || ""),
        project_id: String(f.get("project") || "") || null,
        issues: String(f.get("issues") || ""),
        next_steps: String(f.get("next_steps") || ""),
        eod_record_id: String(f.get("eod") || "") || null,
        photo_ids: photoIds,
        visit_ids: visitIds,
        ...(report ? { version: report.version } : {}),
      },
    });
    if (!r.ok || !r.data) {
      setBusy("");
      return setError(r.error || "Could not save the report");
    }
    if (submitAfter) {
      const s = await fieldReportAction({ id: r.data, action: "submit", version: (report?.version || 0) + 1 });
      if (!s.ok) {
        setBusy("");
        setError(s.error || "Saved, but the report could not be submitted");
        if (!report) router.replace(`/field/reports/${r.data}`);
        return;
      }
    }
    setBusy("");
    if (!report) router.replace(`/field/reports/${r.data}`);
    else refresh();
  }
  async function act(action: string) {
    if (!report) return;
    setBusy(action);
    setError("");
    const r = await fieldReportAction({ id: report.id, action, version: report.version, note });
    setBusy("");
    if (!r.ok) return setError(r.error || "Request failed");
    setNote("");
    refresh();
  }
  async function attach(file: File | undefined) {
    if (!file || !report) return;
    setError("");
    setProgress("0%");
    try {
      await uploadFile(undefined, file, false, undefined, {
        kind: "field_report",
        fieldTarget: report.id,
        onProgress: (sent, total) => setProgress(Math.round((sent / total) * 100) + "%"),
      });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    }
    setProgress("");
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/field/reports" className="text-[11px] text-muted-foreground hover:text-foreground">← Field reports</Link>
          <h2 className="mt-1 text-lg font-semibold">{report ? report.title : "New field report"}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {person.full_name}{person.employee_id ? ` · ${person.employee_id}` : ""}{person.department ? ` · ${person.department}` : ""} · {report?.report_date || date}
          </p>
        </div>
        {report && <ReportBadge status={report.status} />}
      </div>

      <section className="panel grid grid-cols-2 gap-px overflow-hidden bg-border text-xs sm:grid-cols-4">
        {[
          ["Field session start", time(start)],
          ["Field session end", sessions.length ? (end ? time(end) : "Running") : "—"],
          ["Locations visited", String((editable ? dayVisits.filter((v) => visitIds.includes(v.id)) : linkedVisits).length)],
          ["GPS photos", String((editable ? dayPhotos.filter((p) => photoIds.includes(p.id)) : linkedPhotos).length)],
        ].map(([k, v]) => (
          <div key={k} className="bg-card px-4 py-3"><p className="text-[11px] text-muted-foreground">{k}</p><p className="mt-1 font-medium">{v}</p></div>
        ))}
      </section>

      {editable ? (
        <form
          className="panel space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            save(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "submit");
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label htmlFor="r-title">Title *</label><input id="r-title" name="title" required maxLength={200} defaultValue={report?.title || ""} /></div>
            <div><label htmlFor="r-date">Reporting date *</label><input id="r-date" name="report_date" type="date" required defaultValue={report?.report_date || date} onChange={(e) => !report && e.target.value && router.replace(`/field/reports/new?date=${e.target.value}`)} /></div>
            <div><label htmlFor="r-customer">Customer</label><input id="r-customer" name="customer" maxLength={200} defaultValue={report?.customer || ""} /></div>
            <div>
              <label htmlFor="r-project">Project</label>
              <select id="r-project" name="project" defaultValue={report?.project_id || ""}>
                <option value="">None</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="r-session">Field session</label>
              <select id="r-session" name="session" defaultValue={report?.session_id || sessions[0]?.id || ""}>
                <option value="">None</option>
                {sessions.map((s) => <option key={s.id} value={s.id}>{time(s.started_at)}–{s.ended_at ? time(s.ended_at) : "running"}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="r-eod">Linked daily report (EOD)</label>
              <select id="r-eod" name="eod" defaultValue={report?.eod_record_id || ""}>
                <option value="">None</option>
                {eods.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2"><label htmlFor="r-work">Work completed</label><textarea id="r-work" name="work_completed" rows={4} maxLength={20000} defaultValue={report?.work_completed || ""} /></div>
            <div><label htmlFor="r-issues">Issues encountered</label><textarea id="r-issues" name="issues" rows={3} maxLength={10000} defaultValue={report?.issues || ""} /></div>
            <div><label htmlFor="r-next">Next steps</label><textarea id="r-next" name="next_steps" rows={3} maxLength={10000} defaultValue={report?.next_steps || ""} /></div>
          </div>
          <fieldset>
            <legend className="mb-2 text-xs font-semibold">Visits to include</legend>
            {!dayVisits.length && <p className="text-xs text-muted-foreground">No visits recorded on this date.</p>}
            <div className="space-y-1">
              {dayVisits.map((v) => (
                <label key={v.id} className="flex items-center gap-2 text-xs font-normal">
                  <input type="checkbox" checked={visitIds.includes(v.id)} onChange={() => toggle(visitIds, setVisitIds, v.id)} />
                  {v.title} · {time(v.started_at)}–{v.ended_at ? time(v.ended_at) : "…"} <VerificationBadge status={v.start_status} short />
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-xs font-semibold">GPS photos to include</legend>
            {!dayPhotos.length && <p className="text-xs text-muted-foreground">No photos taken on this date.</p>}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {dayPhotos.map((p) => (
                <label key={p.id} className={`cursor-pointer overflow-hidden rounded-lg border text-[11px] font-normal ${photoIds.includes(p.id) ? "border-primary ring-1 ring-primary" : "border-border"}`}>
                  <input type="checkbox" className="sr-only" checked={photoIds.includes(p.id)} onChange={() => toggle(photoIds, setPhotoIds, p.id)} />
                  {p.file_path ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/field/files/photo/${p.id}`} alt={p.title || "Field photo"} className="aspect-square w-full object-cover" />
                  ) : (
                    <span className="grid aspect-square place-items-center bg-muted">Upload not finished</span>
                  )}
                  <span className="block truncate p-1.5">{photoIds.includes(p.id) ? "✓ " : ""}{p.title || time(p.uploaded_at)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {error && <p role="alert" className="error">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" value="save" disabled={Boolean(busy)}>{busy === "save" ? "Saving…" : "Save draft"}</Button>
            <Button value="submit" disabled={Boolean(busy)}>
              {busy === "submit" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {report && report.status !== "Draft" ? "Save and resubmit" : "Save and submit"}
            </Button>
          </div>
        </form>
      ) : (
        report && (
          <section className="panel grid gap-4 p-5 text-xs sm:grid-cols-2">
            {[
              ["Work completed", report.work_completed],
              ["Issues encountered", report.issues],
              ["Next steps", report.next_steps],
              ["Customer", report.customer],
            ].map(([k, v]) => (
              <div key={k}><h3 className="font-semibold">{k}</h3><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{v || "—"}</p></div>
            ))}
          </section>
        )
      )}

      {!editable && (
        <>
          <section className="panel p-5">
            <h3 className="section-title mb-3">Locations visited</h3>
            {!visits.length && <p className="text-xs text-muted-foreground">No visits attached.</p>}
            <ul className="space-y-2 text-xs">
              {visits.map((v) => (
                <li key={v.id} className="rounded-lg border border-border p-3">
                  <p className="font-medium">{v.title}{v.expected_label ? ` · ${v.expected_label}` : ""}</p>
                  <p className="mt-1 text-muted-foreground">{time(v.started_at)}–{v.ended_at ? time(v.ended_at) : "…"}{v.purpose ? ` · ${v.purpose}` : ""}{v.customer ? ` · ${v.customer}` : ""}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2">
                    <VerificationBadge status={v.start_status} short />
                    {v.start_lat !== null && v.start_lng !== null && <span className="text-muted-foreground">{v.start_lat.toFixed(5)}, {v.start_lng.toFixed(5)}{v.start_distance_m !== null ? ` · ${formatDistance(v.start_distance_m)} from site` : ""}</span>}
                  </p>
                </li>
              ))}
            </ul>
          </section>
          <section className="panel p-5">
            <h3 className="section-title mb-3">GPS photos</h3>
            {!photos.length && <p className="text-xs text-muted-foreground">No photos attached.</p>}
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {photos.map((p) => (
                <li key={p.id} className="overflow-hidden rounded-lg border border-border text-[11px]">
                  <Link href={`/field/photos?photo=${p.id}`}>
                    {p.file_path ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/field/files/photo/${p.id}`} alt={p.title || "Field photo"} className="aspect-[4/3] w-full object-cover" />
                    ) : (
                      <span className="grid aspect-[4/3] place-items-center bg-muted">Upload not finished</span>
                    )}
                  </Link>
                  <div className="space-y-1 p-2">
                    <p className="truncate font-medium">{p.title || p.file_name}</p>
                    <div className="flex flex-wrap gap-1"><PhotoBadge photo={p} short /><SourceBadge source={p.source} /></div>
                    <p className="text-muted-foreground">
                      {p.latitude !== null && p.longitude !== null ? `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)} · ±${Math.round(p.accuracy_m || 0)} m` : "No GPS"}
                      {p.distance_m !== null ? ` · ${formatDistance(p.distance_m)} from ${p.expected_label}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {report && (
        <section className="panel p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="section-title">Supporting documents</h3>
            {own && editable && (
              <label className="mb-0 inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-primary">
                <Paperclip size={13} /> {progress ? `Uploading ${progress}` : "Attach file"}
                <input
                  type="file"
                  className="hidden"
                  accept=".jpg,.jpeg,.png,.webp,.pdf,.docx,.xlsx,.csv"
                  disabled={Boolean(progress)}
                  onChange={(e) => { attach(e.target.files?.[0]); e.target.value = ""; }}
                />
              </label>
            )}
          </div>
          {!files.length && <p className="text-xs text-muted-foreground">No documents attached{own && editable ? " (images, PDF, Word, Excel or CSV up to 20 MB)" : ""}.</p>}
          <ul className="space-y-1 text-xs">
            {files.map((f) => (
              <li key={f.id}>
                <a className="inline-flex items-center gap-1.5 text-primary hover:underline" href={`/api/field/files/report/${f.id}`} target="_blank" rel="noreferrer">
                  <FileText size={13} /> {f.name}
                </a>
                <span className="ml-2 text-muted-foreground">{Math.max(1, Math.round(f.size / 1024))} KB · {when(f.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report && (
        <section className="panel p-5">
          <h3 className="section-title mb-3">Review history</h3>
          <ol className="space-y-2 text-xs">
            {events.map((e) => (
              <li key={e.id} className={`rounded-lg border p-3 ${e.action === "question" ? "border-warning/40 bg-warning/5" : "border-border"}`}>
                <p><span className="font-medium">{e.actor_name || "Former user"}</span> · {actionLabels[e.action] || e.action} · <span className="text-muted-foreground">{when(e.created_at)}</span></p>
                {e.body && <p className="mt-1 whitespace-pre-wrap">{e.body}</p>}
              </li>
            ))}
          </ol>
          {(own || abilities.review || abilities.approve) && report.status !== "Draft" && (
            <div className="mt-4 space-y-2">
              <label htmlFor="r-note" className="text-xs">{own ? "Reply to your reviewer" : "Comment, question or reason"}</label>
              <textarea id="r-note" rows={2} maxLength={5000} value={note} onChange={(e) => setNote(e.target.value)} />
              {error && !editable && <p role="alert" className="error">{error}</p>}
              <div className="flex flex-wrap justify-end gap-2">
                {own ? (
                  <Button size="sm" disabled={Boolean(busy) || !note.trim()} onClick={() => act("reply")}><MessageSquare size={13} /> Send reply</Button>
                ) : (
                  ["Submitted", "Resubmitted", "Escalated"].includes(report.status) && (
                    <>
                      {abilities.review && (
                        <Button size="sm" variant="outline" disabled={Boolean(busy) || !note.trim()} onClick={() => act("question")}><MessageSquare size={13} /> Ask a question</Button>
                      )}
                      {report.status !== "Escalated" && (abilities.review || abilities.approve) && (
                        <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => act("escalate")}><ArrowUpRight size={13} /> Escalate to Admin</Button>
                      )}
                      {abilities.approve && (
                        <>
                          <Button size="sm" variant="outline" disabled={Boolean(busy) || !note.trim()} onClick={() => act("reject")}><X size={13} /> Reject</Button>
                          <Button size="sm" disabled={Boolean(busy)} onClick={() => act("approve")}><Check size={13} /> Approve</Button>
                        </>
                      )}
                    </>
                  )
                )}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
