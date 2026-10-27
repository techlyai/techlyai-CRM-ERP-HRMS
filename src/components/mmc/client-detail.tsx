"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, Loader2, PlugZap, RefreshCw, Trash2 } from "lucide-react";
import { deleteMmcClient, regenerateSiteKey, retryMmcMessage, testMmcConnection } from "@/lib/mmc-actions";
import { KEY_PLACEHOLDER, htmlSnippet, nextSnippet, nodeSnippet, phpSnippet, type SnippetInput } from "@/lib/mmc-snippets";
import { lastSeen, type MmcMessage } from "@/lib/mmc";
import { Button } from "../ui/button";
import { Dialog, DialogContent } from "../ui/dialog";
import { KeyReveal } from "./client-form";

export function SiteKeyPanel({
  client,
  prefix,
  createdAt,
  lastChecked,
  lastOrigin,
  manage,
  snippet,
}: {
  client: string;
  prefix: string | null;
  createdAt: string | null;
  lastChecked: string | null;
  lastOrigin: string | null;
  manage: boolean;
  snippet: Omit<SnippetInput, "siteKey">;
}) {
  const router = useRouter();
  const [fresh, setFresh] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ key: string; saved: boolean } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [test, setTest] = useState<Awaited<ReturnType<typeof testMmcConnection>>["data"] | null>(null);
  const [tab, setTab] = useState<"env" | "next" | "php" | "node" | "html">("env");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    // A key created a moment ago on the Clients page is handed over once, then forgotten.
    try {
      const k = sessionStorage.getItem("mmc-key:" + client);
      if (k) {
        setFresh(k);
        sessionStorage.removeItem("mmc-key:" + client);
      }
    } catch {}
  }, [client]);
  async function regenerate() {
    setBusy("key");
    setError("");
    const r = await regenerateSiteKey(client);
    setBusy("");
    setConfirm(false);
    if (!r.ok || !r.data) return setError(r.error || "Could not create a key");
    setFresh(r.data.key);
    setReveal({ key: r.data.key, saved: r.data.saved });
    router.refresh();
  }
  async function runTest() {
    setBusy("test");
    setError("");
    const r = await testMmcConnection(client);
    setBusy("");
    if (!r.ok) return setError(r.error || "Test failed");
    setTest(r.data);
  }
  const input = { ...snippet, siteKey: fresh || KEY_PLACEHOLDER };
  const envBlock = `# Paste into the client website's environment variables (Dokploy → the client's app → Environment), then redeploy.
ORBIT_SITE_KEY=${fresh || KEY_PLACEHOLDER}
ORBIT_STATUS_URL=${snippet.endpoint}`;
  const code =
    tab === "env" ? envBlock : tab === "next" ? nextSnippet(input) : tab === "php" ? phpSnippet(input) : tab === "node" ? nodeSnippet(input) : htmlSnippet(input);
  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="icon-tile h-9 w-9"><KeyRound size={17} /></div>
        <div className="flex-1">
          <h2 className="section-title">Site key & integration</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {prefix ? <>Key <span className="font-mono">{prefix}…</span> created {createdAt ? new Date(createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : ""}</> : "No key yet."}
            {" · "}Last seen: <strong className={lastChecked && Date.now() - Date.parse(lastChecked) < 86400000 ? "text-success" : "text-danger"}>{lastSeen(lastChecked)}</strong>
            {lastOrigin && <> from {lastOrigin}</>}
          </p>
        </div>
        {manage && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy === "test"} onClick={runTest}>
              {busy === "test" ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />} Test connection
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirm(true)}>
              <RefreshCw size={14} /> Regenerate key
            </Button>
          </div>
        )}
      </div>
      {error && <p className="error mt-3">{error}</p>}
      {test && (
        <div className="notice mt-3 space-y-1 text-xs">
          <div>
            Website: {test.site.ok ? <>responded with HTTP <strong>{test.site.status}</strong> (expected {test.expected_status} once the snippet is installed)</> : <span className="text-danger">{test.site.error}</span>}
          </div>
          <div>
            Snippet check-in: {test.snippet_recent ? <span className="text-success">received in the last 10 minutes ✓</span> : <span className="text-danger">no check-in in the last 10 minutes{test.last_checked_at ? ` (last ${lastSeen(test.last_checked_at)})` : " (never)"}. Open the website once, then test again.</span>}
          </div>
        </div>
      )}
      <div className="mt-4">
        <div className="flex flex-wrap items-center gap-1 border-b border-border">
          {(
            [
              ["env", "Environment (.env)"],
              ["next", "Next.js"],
              ["php", "PHP / WordPress"],
              ["node", "Node / Express"],
              ["html", "Static HTML / React"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={`border-b-2 px-3 pb-2 text-xs ${tab === k ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground"}`}>
              {label}
            </button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={async () => {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            <Copy size={14} /> {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Put the two environment variables on the client&apos;s server (e.g. Dokploy → Environment) and add the code for their stack once; the code is the same for every client.
          {!fresh && <> The full key is shown only when it is created, so <span className="font-mono">{KEY_PLACEHOLDER}</span> stands in for it. Regenerate a key to get it pre-filled.</>}
        </p>
        <pre className="scroll-thin mt-3 max-h-[420px] overflow-auto rounded-lg bg-muted/50 p-3 text-[11px] leading-5"><code>{code}</code></pre>
      </div>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent title="Regenerate site key?" description="The current key stops working immediately. Update the client's website with the new key, or it will keep its last known status (fail-open).">
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button disabled={busy === "key"} onClick={regenerate}>{busy === "key" && <Loader2 size={15} className="animate-spin" />} Regenerate</Button>
          </div>
        </DialogContent>
      </Dialog>
      <KeyReveal siteKey={reveal?.key || null} saved={reveal?.saved} onClose={() => setReveal(null)} />
    </section>
  );
}

export function DeleteClientButton({ client, name }: { client: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <Button size="sm" variant="ghost" className="text-danger" onClick={() => setOpen(true)}>
        <Trash2 size={14} /> Delete
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={`Delete ${name}?`} description="Removes the client, its dues, payments and site key. The site ON/OFF history and audit log are kept. This cannot be undone.">
          <div className="mt-5 space-y-3">
            <div className="field">
              <label htmlFor="del-confirm">Type the client name to confirm</label>
              <input id="del-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} />
            </div>
            {error && <p className="error">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={busy || typed.trim() !== name.trim()}
                onClick={async () => {
                  setBusy(true);
                  const r = await deleteMmcClient(client);
                  setBusy(false);
                  if (!r.ok) return setError(r.error || "Could not delete");
                  router.push("/mmc/clients");
                }}
              >
                Delete client
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

const msgStatus: Record<MmcMessage["status"], string> = {
  sent: "text-success",
  failed: "text-danger",
  skipped: "text-muted-foreground",
  queued: "text-warning",
  sending: "text-warning",
};
export function MessageTable({ messages, manage, showClient }: { messages: MmcMessage[]; manage: boolean; showClient?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  if (!messages.length) return <p className="p-6 text-center text-sm text-muted-foreground">No messages yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-xs">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            {["When", ...(showClient ? ["Client"] : []), "Channel", "Event", "Status", "MSG91 ID / error", "Tries", ""].map((h) => (
              <th key={h} className="p-3 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {messages.map((m) => (
            <tr key={m.id} className="border-t border-border align-top">
              <td className="whitespace-nowrap p-3">{new Date(m.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</td>
              {showClient && <td className="p-3">{m.client_name}</td>}
              <td className="p-3 capitalize">{m.channel === "sms" ? "SMS" : "WhatsApp"}<div className="text-[11px] text-muted-foreground">{m.recipient}</div></td>
              <td className="p-3">{m.event === "manual" ? `Manual (${(m.vars.template || "").replace(/_/g, " ")})` : m.event.replace(/_/g, " ")}</td>
              <td className={`p-3 font-semibold capitalize ${msgStatus[m.status]}`}>{m.status}</td>
              <td className="max-w-[280px] break-words p-3 text-[11px] text-muted-foreground">{m.provider_id || m.error || "—"}</td>
              <td className="p-3">{m.attempts}/3</td>
              <td className="p-3 text-right">
                {manage && (m.status === "failed" || m.status === "skipped") && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === m.id}
                    onClick={async () => {
                      setBusy(m.id);
                      await retryMmcMessage(m.id);
                      setBusy("");
                      router.refresh();
                    }}
                  >
                    Retry
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
