"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Circle,
  Download,
  ExternalLink,
  FileText,
  History,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { uploadFile, type Attachment } from "./attachments";
import { Button } from "./ui/button";
import { formatBytes, joiningDocuments, normalizeJoiningDocuments } from "@/lib/joining";

const when = (v?: string) =>
  v
    ? new Date(v).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

/** Upload control with live progress, used on the employee page and in the form. */
export function JoiningUpload({
  record,
  label,
  onDone,
}: {
  record: string;
  label: string;
  onDone: () => void;
}) {
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const abort = useRef<AbortController>();
  async function start(file: File) {
    setError("");
    abort.current = new AbortController();
    setProgress({ sent: 0, total: file.size });
    try {
      await uploadFile(record, file, false, undefined, {
        kind: "joining",
        signal: abort.current.signal,
        onProgress: (sent, total) => setProgress({ sent, total }),
      });
      setProgress(null);
      onDone();
    } catch (e) {
      setProgress(null);
      setError(e instanceof Error ? e.message : "Upload failed");
    }
  }
  return (
    <div>
      {progress ? (
        <UploadProgress
          sent={progress.sent}
          total={progress.total}
          onCancel={() => abort.current?.abort()}
        />
      ) : (
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-sm shadow-primary/20 transition-colors hover:bg-primary-hover focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
          <Upload size={14} />
          {label}
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) start(file);
            }}
          />
        </label>
      )}
      {error && (
        <p role="alert" className="error mt-3 text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

export function UploadProgress({
  sent,
  total,
  onCancel,
}: {
  sent: number;
  total: number;
  onCancel?: () => void;
}) {
  const pct = total ? Math.min(100, Math.round((sent / total) * 100)) : 0;
  return (
    <div className="rounded-lg border border-border p-3" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="flex items-center gap-2 font-medium">
          <Loader2 size={14} className="animate-spin text-primary" />
          {pct < 100 ? "Uploading PDF" : "Finishing up"} · {pct}%
        </span>
        <span className="text-muted-foreground">
          {formatBytes(sent)} of {formatBytes(total)}
        </span>
        {onCancel && pct < 100 && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel upload"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={14} />
          </button>
        )}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Keep this page open until the upload finishes.
      </p>
    </div>
  );
}

/** Checklist of documents the combined PDF should contain. */
export function JoiningChecklist({ included }: { included: readonly string[] }) {
  return (
    <ul className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
      {joiningDocuments.map((doc) => {
        const ok = included.includes(doc);
        return (
          <li key={doc} className="flex items-center gap-2 text-xs">
            {ok ? (
              <CheckCircle2 size={15} className="shrink-0 text-success" />
            ) : (
              <Circle size={15} className="shrink-0 text-muted-foreground/50" />
            )}
            <span className={ok ? "" : "text-muted-foreground"}>{doc}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Joining documents section on an employee record. */
export function JoiningDocuments({
  record,
  included: rawIncluded,
  files,
  people,
  canUpload,
}: {
  record: string;
  included: unknown;
  files: Attachment[];
  people: { id: string; full_name: string }[];
  canUpload: boolean;
}) {
  const router = useRouter();
  const included = normalizeJoiningDocuments(rawIncluded);
  const [current, ...previous] = files;
  const name = (id: string) => people.find((p) => p.id === id)?.full_name || "Unknown";
  const complete = included.length === joiningDocuments.length;
  return (
    <section className="panel p-5" aria-labelledby="joining-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="joining-heading" className="section-title">
            Joining documents
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            One combined PDF with every joining document. No file size limit.
          </p>
        </div>
        <span
          className={`rounded-md px-2 py-1 text-[11px] font-medium ${complete ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}
        >
          {included.length} of {joiningDocuments.length} documents included
        </span>
      </div>

      <div className="mt-5 rounded-xl border border-border p-4">
        {current ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="icon-tile h-11 w-11 shrink-0 rounded-xl">
              <FileText size={20} />
            </div>
            <div className="min-w-0 flex-1 basis-[calc(100%-56px)] sm:basis-0">
              <a
                href={"/api/files/" + current.id}
                target="_blank"
                rel="noreferrer"
                className="block truncate text-sm font-medium hover:text-primary"
              >
                {current.name}
              </a>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {formatBytes(current.size)} · Uploaded {when(current.created_at)} by{" "}
                {name(current.uploaded_by)}
                {current.verified ? " · Verified" : ""}
              </p>
            </div>
            <div className="flex w-full items-center gap-1 sm:w-auto">
              <Button variant="outline" size="sm" asChild>
                <a href={"/api/files/" + current.id} target="_blank" rel="noreferrer">
                  <ExternalLink size={13} />
                  View
                </a>
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <a href={"/api/files/" + current.id} download={current.name}>
                  <Download size={13} />
                  Download
                </a>
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="icon-tile h-11 w-11 shrink-0 rounded-xl">
              <FileText size={20} />
            </div>
            No joining PDF uploaded yet.
          </div>
        )}
        {canUpload && (
          <div className="mt-4 border-t border-border pt-4">
            <JoiningUpload
              record={record}
              label={current ? "Upload a new version" : "Upload joining PDF"}
              onDone={() => router.refresh()}
            />
          </div>
        )}
      </div>

      <div className="mt-5">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[.12em] text-muted-foreground">
          Included in the PDF
        </p>
        <JoiningChecklist included={included} />
        <p className="mt-3 text-[11px] text-muted-foreground">
          Update this checklist with Edit record.
        </p>
      </div>

      {previous.length > 0 && (
        <details className="mt-5 rounded-lg border border-border p-3">
          <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <History size={14} className="text-muted-foreground" />
            Previous versions ({previous.length})
          </summary>
          <ul className="mt-3 space-y-2">
            {previous.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <a
                  href={"/api/files/" + f.id}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 truncate hover:text-primary"
                >
                  {f.name}
                </a>
                <span className="text-[11px] text-muted-foreground">
                  {formatBytes(f.size)} · {when(f.created_at)} · {name(f.uploaded_by)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
