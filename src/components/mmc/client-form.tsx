"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, Loader2, Pencil, Plus } from "lucide-react";
import { saveMmcClient } from "@/lib/mmc-actions";
import type { MmcClient } from "@/lib/mmc";
import { Button } from "../ui/button";
import { Dialog, DialogContent } from "../ui/dialog";

type Draft = {
  name: string;
  business_name: string;
  phone: string;
  whatsapp: string;
  email: string;
  website_url: string;
  allowed_domain: string;
  mmc_amount: string;
  billing_day: string;
  grace_days: string;
  start_date: string;
  notes: string;
  channel: MmcClient["channel"];
  auto_suspend: boolean;
};
const fromClient = (c: MmcClient | null, grace: number): Draft => ({
  name: c?.name || "",
  business_name: c?.business_name || "",
  phone: c?.phone || "",
  whatsapp: c?.whatsapp || "",
  email: c?.email || "",
  website_url: c?.website_url || "",
  allowed_domain: c?.allowed_domain || "",
  mmc_amount: c ? String(Number(c.mmc_amount)) : "500",
  billing_day: String(c?.billing_day || 1),
  grace_days: String(c?.grace_days ?? grace),
  start_date: c?.start_date?.slice(0, 10) || new Date().toLocaleDateString("en-CA"),
  notes: c?.notes || "",
  channel: c?.channel || "whatsapp",
  auto_suspend: c?.auto_suspend ?? true,
});

/** Shows a new site key exactly once, with a copy button. */
export function KeyReveal({ siteKey, saved, onClose }: { siteKey: string | null; saved?: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open={Boolean(siteKey)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Site key created"
        description={
          saved
            ? "Saved automatically (encrypted) in MMC → Notes with this client's name. Paste it into the client website's environment as ORBIT_SITE_KEY."
            : "Copy it now. Key storage is not configured on this server, so it was not saved to MMC → Notes and cannot be shown again."
        }
      >
        <div className="mt-5 space-y-4">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs break-all">
            <KeyRound size={15} className="shrink-0 text-primary" />
            <span className="flex-1 select-all">{siteKey}</span>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(siteKey || "");
                setCopied(true);
              }}
            >
              <Copy size={14} /> {copied ? "Copied" : "Copy key"}
            </Button>
            <Button onClick={onClose}>I have saved it</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ClientFormButton({ client, defaultGrace = 5, onKey }: { client: MmcClient | null; defaultGrace?: number; onKey?: (key: string, id: string) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => fromClient(client, defaultGrace));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [key, setKey] = useState<{ key: string; id: string; saved: boolean } | null>(null);
  const set = (k: keyof Draft, v: string | boolean) => setDraft((d) => ({ ...d, [k]: v }));
  async function save() {
    setBusy(true);
    setError("");
    const r = await saveMmcClient({
      id: client?.id || null,
      version: client?.row_version,
      data: {
        ...draft,
        mmc_amount: Number(draft.mmc_amount),
        billing_day: Number(draft.billing_day),
        grace_days: Number(draft.grace_days),
      },
    });
    setBusy(false);
    if (!r.ok || !r.data) return setError(r.error || "Could not save the client");
    setOpen(false);
    if (r.data.key) {
      if (onKey) onKey(r.data.key, r.data.id);
      else setKey({ key: r.data.key, id: r.data.id, saved: r.data.saved });
      setDraft(fromClient(null, defaultGrace));
    }
    router.refresh();
  }
  const input = (k: keyof Draft, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="field">
      <label htmlFor={"mc-" + k}>{label}</label>
      <input id={"mc-" + k} value={draft[k] as string} onChange={(e) => set(k, e.target.value)} {...props} />
    </div>
  );
  return (
    <>
      {client ? (
        <Button size="sm" variant="outline" onClick={() => { setDraft(fromClient(client, defaultGrace)); setOpen(true); }}>
          <Pencil size={14} /> Edit
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus size={16} /> Add client
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={client ? `Edit ${client.name}` : "Add MMC client"}>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {input("name", "Client name *", { maxLength: 160, required: true })}
            {input("business_name", "Business name", { maxLength: 200 })}
            {input("phone", "Phone (with country code) *", { placeholder: "+91 98765 43210", inputMode: "tel" })}
            {input("whatsapp", "WhatsApp number", { placeholder: "Same as phone if empty", inputMode: "tel" })}
            {input("email", "Email", { type: "email" })}
            {input("website_url", "Website URL", { type: "url", placeholder: "https://client-site.com" })}
            {input("allowed_domain", "Allowed domain", { placeholder: "From the website URL if empty" })}
            {input("mmc_amount", "MMC amount (₹ per month) *", { type: "number", min: 0, step: "1" })}
            {input("billing_day", "Billing day of month *", { type: "number", min: 1, max: 31 })}
            {input("grace_days", "Grace period (days)", { type: "number", min: 0, max: 60 })}
            {input("start_date", "Start date *", { type: "date" })}
            <div className="field">
              <label htmlFor="mc-channel">Notify client by</label>
              <select id="mc-channel" value={draft.channel} onChange={(e) => set("channel", e.target.value)}>
                <option value="whatsapp">WhatsApp</option>
                <option value="sms">SMS</option>
                <option value="both">WhatsApp + SMS</option>
                <option value="none">Don&apos;t message</option>
              </select>
            </div>
            <div className="field sm:col-span-2">
              <label htmlFor="mc-notes">Notes</label>
              <textarea id="mc-notes" maxLength={4000} value={draft.notes} onChange={(e) => set("notes", e.target.value)} />
            </div>
            <label className="flex items-start gap-2 font-normal sm:col-span-2">
              <input type="checkbox" className="mt-0.5" checked={draft.auto_suspend} onChange={(e) => set("auto_suspend", e.target.checked)} />
              <span>
                Auto-suspend this site when unpaid beyond the grace period
                <span className="block text-[11px] text-muted-foreground">Also needs auto mode turned on in MMC settings.</span>
              </span>
            </label>
          </div>
          {error && <p className="error mt-4">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={busy} onClick={save}>
              {busy && <Loader2 size={15} className="animate-spin" />} {client ? "Save changes" : "Create client & site key"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <KeyReveal
        siteKey={key?.key || null}
        saved={key?.saved}
        onClose={() => {
          const id = key?.id;
          // Lets the client page pre-fill its snippets once; it removes the key after reading.
          try {
            if (id && key) sessionStorage.setItem("mmc-key:" + id, key.key);
          } catch {}
          setKey(null);
          if (id) router.push(`/mmc/clients/${id}`);
        }}
      />
    </>
  );
}
