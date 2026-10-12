"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Download, Loader2, FileCheck2 } from "lucide-react";
export async function uploadFile(
  record: string | undefined,
  file: File,
  sound = false,
) {
  const info = {
    record,
    sound,
    name: file.name,
    mime: file.type || (file.name.endsWith(".csv") ? "text/csv" : ""),
    size: file.size,
  };
  const ticketRes = await fetch("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(info),
  });
  const ticket = await ticketRes.json();
  if (!ticketRes.ok) throw Error(ticket.error);
  for (
    let offset = 0, part = 0;
    offset < file.size;
    offset += ticket.chunkSize, part++
  ) {
    const upload = await fetch(
      `/api/uploads?upload=${encodeURIComponent(ticket.id)}&part=${part}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: file.slice(offset, offset + ticket.chunkSize),
      },
    );
    if (!upload.ok) {
      const result = await upload.json();
      throw Error(result.error || "File upload failed");
    }
  }
  const done = await fetch("/api/uploads", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: ticket.id }),
  });
  const result = await done.json();
  if (!done.ok) throw Error(result.error);
  return ticket.path as string;
}
export type Attachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  verified: boolean;
  uploaded_by: string;
};
export function Attachments({
  record,
  files,
  canUpload,
}: {
  record: string;
  files: Attachment[];
  canUpload: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="panel p-5">
      <div className="flex items-center justify-between">
        <h2 className="section-title">Attachments</h2>
        {canUpload && (
          <label className="mb-0 cursor-pointer text-xs font-medium text-primary">
            {busy ? (
              <Loader2 size={14} className="mr-1 inline animate-spin" />
            ) : (
              <Paperclip size={14} className="mr-1 inline" />
            )}
            Upload
            <input
              disabled={busy}
              type="file"
              multiple
              accept=".jpg,.jpeg,.png,.webp,.pdf,.docx,.xlsx,.csv,.mp3,.wav"
              className="hidden"
              onChange={async (e) => {
                const selected = e.target.files;
                if (!selected) return;
                setBusy(true);
                setError("");
                try {
                  for (const file of Array.from(selected))
                    await uploadFile(record, file);
                  router.refresh();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Upload failed");
                }
                setBusy(false);
              }}
            />
          </label>
        )}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Private files · 20 MB per file · Downloads require record access
      </p>
      <div className="mt-4 space-y-3">
        {files.map((file) => (
          <div
            key={file.id}
            className="flex items-center gap-3 rounded-lg border p-3"
          >
            <div className="rounded-lg bg-muted p-2 text-primary">
              <Paperclip size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <a
                className="block truncate text-xs font-medium hover:text-primary"
                href={"/api/files/" + file.id}
                target="_blank"
                rel="noreferrer"
              >
                {file.name}
              </a>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {(file.size / 1024).toFixed(0)} KB{" "}
                {file.verified ? "· Verified" : ""}
              </p>
            </div>
            <a
              href={"/api/files/" + file.id}
              target="_blank"
              rel="noreferrer"
              aria-label={"Download " + file.name}
            >
              <Download size={14} />
            </a>
          </div>
        ))}
        {!files.length && (
          <p className="py-5 text-center text-xs text-muted-foreground">
            No attachments yet.
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="error mt-3">
          {error}
        </p>
      )}
    </section>
  );
}
