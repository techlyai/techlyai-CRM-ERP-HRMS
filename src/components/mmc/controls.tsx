"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, IndianRupee, Loader2 } from "lucide-react";
import { recordMmcPayment, sendMmcReminder, setMmcSite } from "@/lib/mmc-actions";
import { paymentModes, rupees } from "@/lib/mmc";
import { Button } from "../ui/button";
import { Dialog, DialogContent } from "../ui/dialog";

const badge: Record<string, string> = {
  Paid: "bg-success/10 text-success",
  Pending: "bg-warning/10 text-warning",
  Overdue: "bg-danger/10 text-danger",
};
export function DueBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium ${badge[status] || "bg-muted text-muted-foreground"}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

/** ON/OFF switch. Turning a site OFF asks for confirmation and an optional reason. */
export function SiteToggle({ client, name, active, disabled }: { client: string; name: string; active: boolean; disabled?: boolean }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function apply(next: boolean, why = "") {
    setBusy(true);
    setError("");
    const r = await setMmcSite({ client, active: next, reason: why });
    setBusy(false);
    if (!r.ok) return setError(r.error || "Could not change the site");
    setConfirm(false);
    setReason("");
    router.refresh();
  }
  return (
    <div className="inline-flex flex-col items-start">
      <button
        type="button"
        role="switch"
        aria-checked={active}
        aria-label={`${name} website ${active ? "ON" : "OFF"}`}
        disabled={disabled || busy}
        onClick={() => (active ? setConfirm(true) : apply(true, "Switched on by admin"))}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${active ? "bg-success" : "bg-muted-foreground/40"}`}
      >
        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${active ? "translate-x-[22px]" : "translate-x-0.5"}`} />
        {busy && <Loader2 size={12} className="absolute left-1/2 -translate-x-1/2 animate-spin text-white" />}
      </button>
      <span className={`mt-1 text-[10px] font-semibold ${active ? "text-success" : "text-danger"}`}>{active ? "ON" : "OFF"}</span>
      {error && !confirm && <span className="text-[11px] text-danger">{error}</span>}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent title={`Turn OFF ${name}'s website?`} description="Visitors will see the Site Suspended page within about 5 minutes (the client's cache).">
          <div className="mt-5 space-y-4">
            <div className="field">
              <label htmlFor="off-reason">Reason (optional, kept in the log)</label>
              <input id="off-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Payment pending for 2 months" />
            </div>
            {error && <p className="error">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button>
              <Button variant="destructive" disabled={busy} onClick={() => apply(false, reason)}>
                {busy && <Loader2 size={15} className="animate-spin" />} Turn OFF
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function PayButton({ client, name, owed, amount, size = "sm" }: { client: string; name: string; owed: string; amount: string; size?: "sm" | "default" }) {
  const router = useRouter();
  const today = new Date().toLocaleDateString("en-CA");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState({ amount: "", paid_on: today, mode: "UPI", reference: "", note: "" });
  const suggested = Number(owed) > 0 ? owed : amount;
  async function submit() {
    setBusy(true);
    setError("");
    const r = await recordMmcPayment({ client, amount: Number(form.amount || suggested), paid_on: form.paid_on, mode: form.mode, reference: form.reference, note: form.note, key });
    setBusy(false);
    if (!r.ok) return setError(r.error || "Could not record the payment");
    setOpen(false);
    setKey(crypto.randomUUID());
    setForm({ amount: "", paid_on: today, mode: "UPI", reference: "", note: "" });
    router.refresh();
  }
  return (
    <>
      <Button size={size} variant="subtle" onClick={() => setOpen(true)}>
        <IndianRupee size={14} /> Mark as paid
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={`Record payment · ${name}`} description={`Outstanding ${rupees(owed)}. Pay more than that to keep an advance for coming months; less is kept as a partial payment.`}>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="field">
              <label htmlFor="pay-amount">Amount (₹) *</label>
              <input id="pay-amount" type="number" min="1" step="0.01" placeholder={suggested} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="pay-date">Payment date *</label>
              <input id="pay-date" type="date" max={today} value={form.paid_on} onChange={(e) => setForm({ ...form, paid_on: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="pay-mode">Mode *</label>
              <select id="pay-mode" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                {paymentModes.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="pay-ref">Reference no.</label>
              <input id="pay-ref" maxLength={120} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="UPI / bank reference" />
            </div>
            <div className="field sm:col-span-2">
              <label htmlFor="pay-note">Note</label>
              <input id="pay-note" maxLength={1000} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
          </div>
          {error && <p className="error mt-4">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={busy} onClick={submit}>
              {busy && <Loader2 size={15} className="animate-spin" />} Save payment {rupees(form.amount || suggested)}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RemindButton({ client, size = "sm" }: { client: string; size?: "sm" | "default" }) {
  const router = useRouter();
  const [state, setState] = useState<"" | "busy" | "done" | string>("");
  async function send() {
    setState("busy");
    const r = await sendMmcReminder(client);
    if (!r.ok) return setState(r.error || "Failed");
    const res = r.data?.result;
    setState(!r.data?.queued ? "Nothing sent (channel off or template disabled)" : res && res.sent ? "Sent" : res && res.skipped ? "Logged (MSG91 not configured)" : res && res.failed ? "Failed, will retry" : "Queued");
    router.refresh();
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button size={size} variant="outline" disabled={state === "busy"} onClick={send}>
        {state === "busy" ? <Loader2 size={14} className="animate-spin" /> : <BellRing size={14} />} Remind
      </Button>
      {state && state !== "busy" && <span className="text-[11px] text-muted-foreground">{state}</span>}
    </span>
  );
}
