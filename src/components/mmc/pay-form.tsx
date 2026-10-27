"use client";
import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { submitPaymentClaim } from "@/lib/pay-actions";

/** On the public pay page: after paying by UPI, the client reports the transaction ID. */
export function PaymentClaimForm({ token, amount }: { token: string; amount: number }) {
  const [form, setForm] = useState({ amount: amount > 0 ? String(amount) : "", utr: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  if (done)
    return (
      <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 p-4 text-sm">
        <CheckCircle2 size={20} className="shrink-0 text-success" />
        <div>
          <div className="font-semibold">Thank you! We received your payment details.</div>
          <div className="mt-1 text-muted-foreground">We will confirm it shortly and send your receipt on WhatsApp.</div>
        </div>
      </div>
    );
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const r = await submitPaymentClaim({ token, amount: Number(form.amount), utr: form.utr, note: form.note });
        setBusy(false);
        if (!r.ok) return setError(r.error || "Could not submit");
        setDone(true);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="field">
          <label htmlFor="pc-amount">Amount paid (₹)</label>
          <input id="pc-amount" type="number" min="1" step="0.01" inputMode="decimal" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="pc-utr">UPI transaction ID (UTR)</label>
          <input id="pc-utr" required placeholder="e.g. 431245678901" autoComplete="off" value={form.utr} onChange={(e) => setForm({ ...form, utr: e.target.value })} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="pc-note">Note (optional)</label>
        <input id="pc-note" maxLength={300} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      </div>
      {error && <p className="error">{error}</p>}
      <button disabled={busy} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card text-sm font-medium hover:bg-muted">
        {busy && <Loader2 size={15} className="animate-spin" />} I have paid — submit details
      </button>
    </form>
  );
}
