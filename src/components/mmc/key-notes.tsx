"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Copy, Eye, EyeOff, Loader2, Search } from "lucide-react";
import { revealSiteKey } from "@/lib/mmc-actions";

export type KeyNote = {
  id: string;
  name: string;
  business_name: string;
  website_url: string;
  key_prefix: string | null;
  key_created_at: string | null;
  key_saved_at: string | null;
};

/** MMC → Notes: every client's site key, saved automatically when it is generated. */
export function KeyNotes({ notes, canReveal, endpoint }: { notes: KeyNote[]; canReveal: boolean; endpoint: string }) {
  const [q, setQ] = useState("");
  const [shown, setShown] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return notes.filter((c) => !n || `${c.name} ${c.business_name} ${c.website_url}`.toLowerCase().includes(n));
  }, [notes, q]);

  async function fetchKey(id: string) {
    if (shown[id]) return shown[id];
    setBusy(id);
    setError("");
    const r = await revealSiteKey(id);
    setBusy("");
    if (!r.ok || !r.data) {
      setError(r.error || "Could not open the key");
      return null;
    }
    setShown((s) => ({ ...s, [id]: r.data!.key }));
    return r.data.key;
  }
  async function copy(id: string, what: "key" | "env") {
    const key = await fetchKey(id);
    if (!key) return;
    await navigator.clipboard.writeText(what === "key" ? key : `ORBIT_SITE_KEY=${key}\nORBIT_STATUS_URL=${endpoint}`);
    setCopied(id + what);
    setTimeout(() => setCopied(""), 1500);
  }

  return (
    <div className="space-y-4">
      <div className="notice text-xs leading-5">
        Each client&apos;s site key is saved here automatically when it is created or regenerated, encrypted on the server. Paste it into the client
        website&apos;s environment as <span className="font-mono">ORBIT_SITE_KEY</span>. Every time a key is shown or copied, it is recorded in the audit log.
      </div>
      {error && <p className="error">{error}</p>}
      <div className="panel">
        <div className="border-b border-border p-4">
          <label className="relative mb-0 block">
            <Search size={15} className="pointer-events-none absolute left-3 top-3 text-muted-foreground" />
            <input aria-label="Search notes" className="pl-9" placeholder="Search client or website" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
        {list.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">{notes.length ? "No clients match." : "No clients yet. Keys appear here as soon as you add a client."}</p>
        ) : (
          <ul className="divide-y divide-border">
            {list.map((c) => (
              <li key={c.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
                <div className="min-w-[200px] lg:w-1/4">
                  <Link href={`/mmc/clients/${c.id}`} className="text-sm font-semibold hover:text-primary">{c.name}</Link>
                  <div className="truncate text-[11px] text-muted-foreground">{c.website_url || c.business_name || "No website saved"}</div>
                </div>
                <div className="min-w-0 flex-1">
                  {c.key_saved_at ? (
                    <div className="break-all rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-xs">
                      {shown[c.id] || `${c.key_prefix || "sk_live_"}${"•".repeat(24)}`}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                      {c.key_prefix ? `${c.key_prefix}… was created before keys were saved here. Regenerate it on the client page to save it.` : "No key yet."}
                    </div>
                  )}
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {c.key_created_at && <>Generated {new Date(c.key_created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</>}
                  </div>
                </div>
                {c.key_saved_at && canReveal && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs hover:bg-muted"
                      onClick={() => (shown[c.id] ? setShown(({ [c.id]: _, ...rest }) => rest) : fetchKey(c.id))}
                      disabled={busy === c.id}
                    >
                      {busy === c.id ? <Loader2 size={13} className="animate-spin" /> : shown[c.id] ? <EyeOff size={13} /> : <Eye size={13} />}
                      {shown[c.id] ? "Hide" : "Show"}
                    </button>
                    <button className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs hover:bg-muted" onClick={() => copy(c.id, "key")}>
                      <Copy size={13} /> {copied === c.id + "key" ? "Copied" : "Copy key"}
                    </button>
                    <button className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary/10 px-3 text-xs font-medium text-primary hover:bg-primary/15" onClick={() => copy(c.id, "env")}>
                      <Copy size={13} /> {copied === c.id + "env" ? "Copied" : "Copy .env lines"}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
