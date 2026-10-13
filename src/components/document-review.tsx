"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Attachment } from "./attachments";
import { verifyAttachment } from "@/lib/actions";
import { Button } from "./ui/button";
export function DocumentReview({
  files,
  canApprove,
  actor,
}: {
  files: Attachment[];
  canApprove: boolean;
  actor: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!files.length) return null;
  return (
    <section className="panel p-5">
      <h2 className="section-title mb-4">Document preview & verification</h2>
      <div className="space-y-4">
        {files.map((file) => (
          <div className="rounded-lg border p-3" key={file.id}>
            <p className="text-xs font-medium">{file.name}</p>
            {file.mime.startsWith("image/") && (
              <img
                src={"/api/files/" + file.id}
                alt={file.name}
                loading="lazy"
                className="mt-3 max-h-52 w-full rounded-lg object-contain"
              />
            )}
            {file.mime === "application/pdf" && (
              <a
                className="mt-3 block text-xs text-primary"
                href={"/api/files/" + file.id}
                target="_blank"
                rel="noreferrer"
              >
                Open secure PDF preview →
              </a>
            )}
            <p className="mt-3 text-[10px] text-muted-foreground">
              {file.verified ? "Document verified" : "Not yet verified"}
            </p>
            {canApprove && file.uploaded_by !== actor && (
              <Button
                className="mt-2"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await verifyAttachment(file.id, !file.verified);
                  if (!r.ok) setError(r.error || "Review failed");
                  else router.refresh();
                  setBusy(false);
                }}
              >
                {file.verified ? "Revoke verification" : "Verify document"}
              </Button>
            )}
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="error mt-4">
          {error}
        </p>
      )}
    </section>
  );
}
