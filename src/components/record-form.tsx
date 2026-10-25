"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X, Bold, Italic, List } from "lucide-react";
import { moduleMap, type Profile, type BusinessRecord } from "@/lib/modules";
import { localDate } from "@/lib/domain";
import { toDateTimeLocal } from "@/lib/reminders";
import { saveRecord } from "@/lib/actions";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";
import { uploadFile } from "./attachments";
import { UploadProgress } from "./joining-documents";
import {
  formatBytes,
  joiningDocuments,
  normalizeJoiningDocuments,
} from "@/lib/joining";
import { FileText } from "lucide-react";
export type Reference = { id: string; title: string; module: string };
export function RecordForm({
  module,
  people,
  references = [],
  record,
  defaultOpen = false,
  canAssign = false,
}: {
  module: string;
  people: Profile[];
  references?: Reference[];
  record?: BusinessRecord;
  defaultOpen?: boolean;
  canAssign?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [duplicates, setDuplicates] = useState(0);
  const submitting = useRef(false);
  // Employee joining PDF chosen in the form; uploaded after the record saves.
  const [joiningFile, setJoiningFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  const [savedId, setSavedId] = useState<string>();
  const duplicateRequest = useRef(0);
  const [lines, setLines] = useState<
    { item_id: string; quantity: number; unit_cost: number }[]
  >(
    (record?.data.lines as {
      item_id: string;
      quantity: number;
      unit_cost: number;
    }[]) || [{ item_id: "", quantity: 1, unit_cost: 0 }],
  );
  const m = moduleMap[module];
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);
  function changeOpen(next: boolean) {
    if (submitting.current) return;
    if (next) {
      setError("");
      setJoiningFile(null);
      setProgress(null);
      setSavedId(undefined);
      setDuplicates(0);
      duplicateRequest.current += 1;
      setLines(
        (record?.data.lines as typeof lines) || [
          { item_id: "", quantity: 1, unit_cost: 0 },
        ],
      );
    }
    setOpen(next);
  }
  async function checkDuplicates(phone: string) {
    const request = ++duplicateRequest.current;
    setDuplicates(0);
    if (!phone.trim()) return;
    try {
      const response = await fetch(
        "/api/leads/duplicates?phone=" + encodeURIComponent(phone),
      );
      if (!response.ok) return;
      const data = (await response.json()) as { ids?: string[] };
      if (request === duplicateRequest.current)
        setDuplicates(data.ids?.filter((id) => id !== record?.id).length || 0);
    } catch {
      // Duplicate detection is advisory; the form remains usable offline.
    }
  }
  function refModule(key: string) {
    if (key === "project_id") return "projects";
    if (key === "purchase_id") return "purchases";
    if (key === "attendance_id") return "attendance";
    if (module === "maintenance" && key === "asset_id") return "assets";
    return undefined;
  }
  return (
    <>
      <Button
        onClick={() => changeOpen(true)}
        variant={record ? "outline" : "default"}
      >
        <Plus size={15} />
        {record ? "Edit record" : `New ${m.singular.toLowerCase()}`}
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent
          title={
            record
              ? `Edit ${m.singular.toLowerCase()}`
              : `Create ${m.singular.toLowerCase()}`
          }
        >
          <form
            className="mt-6"
            onSubmit={async (e) => {
              e.preventDefault();
              if (submitting.current) return;
              submitting.current = true;
              setBusy(true);
              setError("");
              const f = new FormData(e.currentTarget);
              const data: Record<string, unknown> = {};
              try {
                for (const field of m.fields) {
                  const value = String(f.get(field.key) || "");
                  if (module === "purchases" && field.key === "lines")
                    data.lines = lines;
                  else if (field.key === "team") data.team = f.getAll("team");
                  else if (field.key === "joining_documents")
                    data.joining_documents = f.getAll("joining_documents");
                  else if (field.type === "json")
                    data[field.key] = value ? JSON.parse(value) : undefined;
                  else if (field.type === "number")
                    data[field.key] = value === "" ? undefined : Number(value);
                  else if (field.type === "datetime")
                    data[field.key] = value
                      ? new Date(value).toISOString()
                      : undefined;
                  else data[field.key] = value;
                }
                const result = await saveRecord({
                  module,
                  title: String(f.get("title")),
                  owner_id: String(f.get("owner_id") || record?.owner_id || ""),
                  id: record?.id,
                  version: record?.version,
                  status: record
                    ? String(f.get("status") || record.status)
                    : undefined,
                  data,
                });
                if (!result.ok) setError(result.error || "Unable to save");
                else {
                  let uploaded = true;
                  if (joiningFile && result.id) {
                    setSavedId(result.id);
                    setProgress({ sent: 0, total: joiningFile.size });
                    try {
                      await uploadFile(result.id, joiningFile, false, undefined, {
                        kind: "joining",
                        onProgress: (sent, total) => setProgress({ sent, total }),
                      });
                    } catch (uploadError) {
                      // The employee record is saved; keep the dialog open to explain.
                      uploaded = false;
                      setProgress(null);
                      setError(
                        "The employee record was saved, but the joining PDF did not upload: " +
                          (uploadError instanceof Error
                            ? uploadError.message
                            : "upload failed") +
                          ". Open the record to try again.",
                      );
                    }
                  }
                  if (uploaded) {
                    setOpen(false);
                    router.push(`/modules/${module}/${result.id}`);
                    router.refresh();
                  }
                }
              } catch (e) {
                setError(e instanceof Error ? e.message : "Invalid form");
              }
              submitting.current = false;
              setBusy(false);
            }}
          >
            <fieldset
              disabled={busy}
              className="grid min-w-0 gap-5 md:grid-cols-2"
            >
              <div className="md:col-span-2">
                <label htmlFor="title">{m.singular} name / title *</label>
                <input
                  name="title"
                  id="title"
                  defaultValue={record?.title}
                  required
                  maxLength={200}
                  placeholder={
                    module === "eod"
                      ? "Today’s progress"
                      : `Name this ${m.singular.toLowerCase()}`
                  }
                />
              </div>
              {canAssign && (
                <div>
                  <label htmlFor="owner_id">Responsible employee</label>
                  <select
                    name="owner_id"
                    id="owner_id"
                    defaultValue={record?.owner_id || people[0]?.id}
                  >
                    {record?.owner_id &&
                      !people.some((p) => p.id === record.owner_id) && (
                        <option value={record.owner_id}>
                          Current responsible employee
                        </option>
                      )}
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {record &&
                !m.workflow &&
                [
                  "leads",
                  "tasks",
                  "projects",
                  "employees",
                  "onboarding",
                  "assets",
                  "inventory",
                  "vendors",
                  "clients",
                ].includes(module) && (
                  <div>
                    <label htmlFor="status">Status</label>
                    <select
                      name="status"
                      id="status"
                      defaultValue={record.status}
                    >
                      {m.statuses.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                )}
              {m.fields.map((field) => {
                const value = record?.data[field.key];
                const ref = refModule(field.key);
                if (field.key === "team")
                  return (
                    <div key={field.key} className="md:col-span-2">
                      <label>Project team</label>
                      <div className="flex flex-wrap gap-4 rounded-lg border p-3">
                        {people.map((p) => (
                          <label
                            key={p.id}
                            className="flex items-center gap-2 font-normal"
                          >
                            <input
                              type="checkbox"
                              name="team"
                              value={p.id}
                              defaultChecked={
                                Array.isArray(value) && value.includes(p.id)
                              }
                            />
                            {p.full_name}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                  if (module === "employees" && field.key === "joining_documents") {
                  const included = normalizeJoiningDocuments(value);
                  return (
                    <div key={field.key} className="md:col-span-2">
                      <label>Joining documents</label>
                      <div className="space-y-4 rounded-xl border border-border p-4">
                        <p className="text-xs leading-5 text-muted-foreground">
                          Combine these documents into one PDF and upload it.
                          Tick each document the PDF contains. There is no file
                          size limit.
                        </p>
                        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                          {joiningDocuments.map((doc) => (
                            <label
                              key={doc}
                              className="mb-0 flex items-center gap-2 text-xs font-normal"
                            >
                              <input
                                type="checkbox"
                                name="joining_documents"
                                value={doc}
                                defaultChecked={included.includes(doc)}
                              />
                              {doc}
                            </label>
                          ))}
                        </div>
                        {!progress && !savedId ? (
                          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
                            <label className="mb-0 inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium transition-colors hover:border-primary/40 hover:bg-muted">
                              <FileText size={14} className="text-primary" />
                              {joiningFile ? "Choose a different PDF" : record ? "Upload a new joining PDF" : "Choose joining PDF"}
                              <input
                                type="file"
                                accept="application/pdf,.pdf"
                                className="sr-only"
                                onChange={(e) => {
                                  const file = e.target.files?.[0] || null;
                                  if (file && !/\.pdf$/i.test(file.name)) {
                                    setError("Joining documents must be a single PDF file.");
                                    e.target.value = "";
                                    return;
                                  }
                                  setError("");
                                  setJoiningFile(file);
                                }}
                              />
                            </label>
                            {joiningFile && (
                              <span className="flex min-w-0 items-center gap-2 text-xs">
                                <span className="truncate font-medium">{joiningFile.name}</span>
                                <span className="text-muted-foreground">
                                  {formatBytes(joiningFile.size)}
                                </span>
                                <button
                                  type="button"
                                  aria-label="Remove selected PDF"
                                  onClick={() => setJoiningFile(null)}
                                  className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                                >
                                  <X size={13} />
                                </button>
                              </span>
                            )}
                          </div>
                        ) : null}
                        {progress && (
                          <UploadProgress sent={progress.sent} total={progress.total} />
                        )}
                      </div>
                    </div>
                  );
                }
                if (module === "purchases" && field.key === "lines")
                  return (
                    <div key="lines" className="md:col-span-2">
                      <label>Items to purchase *</label>
                      <div className="space-y-3">
                        {lines.map((l, i) => (
                          <div
                            className="grid grid-cols-[1fr_75px_100px_24px] items-center gap-2"
                            key={i}
                          >
                            <select
                              aria-label="Stock item"
                              required
                              value={l.item_id}
                              onChange={(e) =>
                                setLines(
                                  lines.map((x, n) =>
                                    n === i
                                      ? { ...x, item_id: e.target.value }
                                      : x,
                                  ),
                                )
                              }
                            >
                              <option value="">Choose item</option>
                              {references
                                .filter((r) => r.module === "inventory")
                                .map((r) => (
                                  <option key={r.id} value={r.id}>
                                    {r.title}
                                  </option>
                                ))}
                            </select>
                            <input
                              aria-label="Quantity"
                              type="number"
                              min={1}
                              value={l.quantity}
                              onChange={(e) =>
                                setLines(
                                  lines.map((x, n) =>
                                    n === i
                                      ? {
                                          ...x,
                                          quantity: Number(e.target.value),
                                        }
                                      : x,
                                  ),
                                )
                              }
                            />
                            <input
                              aria-label="Unit cost"
                              type="number"
                              min={0}
                              step="0.01"
                              value={l.unit_cost}
                              onChange={(e) =>
                                setLines(
                                  lines.map((x, n) =>
                                    n === i
                                      ? {
                                          ...x,
                                          unit_cost: Number(e.target.value),
                                        }
                                      : x,
                                  ),
                                )
                              }
                            />
                            <button
                              type="button"
                              aria-label="Remove item"
                              onClick={() =>
                                setLines(lines.filter((_, n) => n !== i))
                              }
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setLines([
                              ...lines,
                              { item_id: "", quantity: 1, unit_cost: 0 },
                            ])
                          }
                        >
                          <Plus size={13} />
                          Add item
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          Create stock items in Inventory first. Enter the total
                          including GST in the purchase amount.
                        </p>
                      </div>
                    </div>
                  );
                return (
                  <div
                    className={
                      field.type === "textarea" || field.type === "json"
                        ? "md:col-span-2"
                        : ""
                    }
                    key={field.key}
                  >
                    <label htmlFor={field.key}>
                      {ref
                        ? field.label
                            .replace(" UUID", "")
                            .replace("record ", "")
                        : field.label}
                      {field.required ? " *" : ""}
                    </label>
                    {field.type === "textarea" ? (
                      <RichInput
                        name={field.key}
                        value={String(value || "")}
                        required={field.label.includes("*")}
                      />
                    ) : field.type === "select" ? (
                      <select
                        name={field.key}
                        id={field.key}
                        required={field.required}
                        defaultValue={String(value || "")}
                      >
                        <option value="">Select an option</option>
                        {field.options?.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    ) : field.type === "user" || ref ? (
                      <select
                        name={field.key}
                        id={field.key}
                        required={field.required}
                        defaultValue={String(value || "")}
                      >
                        <option value="">
                          Select {ref ? "a record" : "a person"}
                        </option>
                        {value &&
                        !(
                          ref
                            ? references.filter((r) => r.module === ref)
                            : people
                        ).some((option) => option.id === value) ? (
                          <option value={String(value)}>
                            Current {ref ? "linked record" : "person"}{" "}
                            (unavailable)
                          </option>
                        ) : null}
                        {ref
                          ? references
                              .filter((r) => r.module === ref)
                              .map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.title}
                                </option>
                              ))
                          : people.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.full_name}
                              </option>
                            ))}
                      </select>
                    ) : (
                      <input
                        id={field.key}
                        name={field.key}
                        type={
                          field.type === "number"
                            ? "number"
                            : field.type === "date"
                              ? "date"
                              : field.type === "datetime"
                                ? "datetime-local"
                                : field.type === "email"
                                  ? "email"
                                  : field.type === "url"
                                    ? "url"
                                    : "text"
                        }
                        min={field.min}
                        step={field.type === "number" ? "0.01" : undefined}
                        required={field.required}
                        onBlur={
                          module === "leads" && field.key === "phone"
                            ? (event) =>
                                checkDuplicates(event.currentTarget.value)
                            : undefined
                        }
                        onChange={
                          module === "leads" && field.key === "phone"
                            ? () => {
                                duplicateRequest.current += 1;
                                setDuplicates(0);
                              }
                            : undefined
                        }
                        defaultValue={
                          field.type === "datetime" && value
                            ? toDateTimeLocal(String(value))
                            : typeof value === "object"
                              ? JSON.stringify(value)
                              : value !== undefined
                                ? String(value)
                                : field.type === "date" &&
                                    [
                                      "report_date",
                                      "expense_date",
                                      "credit_date",
                                      "purchase_date",
                                    ].includes(field.key)
                                  ? localDate()
                                  : ""
                        }
                      />
                    )}
                  </div>
                );
              })}
            </fieldset>
            {duplicates > 0 && (
              <p
                role="status"
                className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-foreground"
              >
                This phone number already appears on {duplicates} accessible
                lead record(s). Check existing CRM entries before creating
                another lead.
              </p>
            )}
            {error && (
              <p role="alert" className="error mt-5">
                {error}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-3 border-t pt-5">
              {savedId && !progress ? (
                // Saved, but the PDF failed: never offer to save again (would duplicate).
                <Button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    router.push(`/modules/${module}/${savedId}`);
                    router.refresh();
                  }}
                >
                  Open employee record
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => changeOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={busy}>
                    {busy && <Loader2 size={14} className="animate-spin" />}
                    {progress
                      ? "Uploading PDF…"
                      : record
                        ? "Save changes"
                        : "Create record"}
                  </Button>
                </>
              )}
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
export function RichInput({
  name,
  value,
  required = false,
}: {
  name: string;
  value: string;
  required?: boolean;
}) {
  const [text, setText] = useState(value);
  const [preview, setPreview] = useState(false);
  function insert(before: string, after = "") {
    const field = document.getElementById(name) as HTMLTextAreaElement;
    const a = field.selectionStart,
      b = field.selectionEnd;
    setText(
      text.slice(0, a) + before + text.slice(a, b) + after + text.slice(b),
    );
  }
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b px-2 py-1.5">
        <button
          type="button"
          aria-label="Bold"
          onClick={() => insert("**", "**")}
          className="rounded p-1.5 hover:bg-muted"
        >
          <Bold size={13} />
        </button>
        <button
          type="button"
          aria-label="Italic"
          onClick={() => insert("*", "*")}
          className="rounded p-1.5 hover:bg-muted"
        >
          <Italic size={13} />
        </button>
        <button
          type="button"
          aria-label="List"
          onClick={() => insert("\n- ")}
          className="rounded p-1.5 hover:bg-muted"
        >
          <List size={13} />
        </button>
        <button
          type="button"
          className="ml-auto text-[10px] text-primary"
          onClick={() => setPreview(!preview)}
        >
          {preview ? "Edit" : "Preview"}
        </button>
      </div>
      <textarea
        id={name}
        name={name}
        required={required}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className={preview ? "hidden" : "border-0 focus:shadow-none"}
      />
      {preview && (
        <div className="min-h-28 p-3">
          <RichText text={text} />
        </div>
      )}
    </div>
  );
}
export function RichText({ text }: { text: string }) {
  return (
    <div className="space-y-1 whitespace-pre-wrap text-sm leading-6">
      {text.split("\n").map((line, i) => (
        <p key={i} className={line.startsWith("- ") ? "pl-3" : ""}>
          {line
            .split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
            .map((s, n) =>
              s.startsWith("**") ? (
                <strong key={n}>{s.slice(2, -2)}</strong>
              ) : s.startsWith("*") ? (
                <em key={n}>{s.slice(1, -1)}</em>
              ) : (
                s
              ),
            )}
        </p>
      ))}
    </div>
  );
}
