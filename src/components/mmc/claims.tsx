"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { reviewPaymentClaim } from "@/lib/mmc-actions";
import { rupees, type PaymentClaim } from "@/lib/mmc";

/** UPI payments reported by clients from their pay link, waiting for an admin to check the bank. */
export function ClaimList({ claims, manage }: { claims: (PaymentClaim & { client_name: string })[]; manage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  if (!claims.length) return null;
  async function review(id: string, approve: boolean) {
    setBusy(id + approve);
    setError("");
    const r = await reviewPaymentClaim({ id, approve });
    setBusy("");
    if (!r.ok) return setError(r.error || "Could not update");
    router.refresh();
  }
  return (
    <section className="panel border-warning/40">
      <div className="p-4">
        <h2 className="section-title">UPI payments to verify ({claims.length})</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Reported by clients from their payment link. Check that the UTR and amount appear in your bank or UPI app before approving. Approving records the payment, sends the receipt and switches an auto-suspended site back on.
        </p>
      </div>
      {error && <p className="error mx-4 mb-3">{error}</p>}
      <ul className="divide-y divide-border">
        {claims.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 p-4 text-xs">
            <div className="min-w-[180px] flex-1">
              <Link href={`/mmc/clients/${c.client_id}`} className="text-sm font-semibold hover:text-primary">{c.client_name}</Link>
              <div className="text-muted-foreground">
                {new Date(c.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                {c.note && <> · {c.note}</>}
              </div>
            </div>
            <div className="font-semibold">{rupees(c.amount)}</div>
            <div className="font-mono">UTR {c.utr}</div>
            {manage && (
              <div className="flex gap-2">
                <button disabled={Boolean(busy)} onClick={() => review(c.id, true)} className="inline-flex h-8 items-center gap-1 rounded-lg bg-success px-3 font-medium text-white disabled:opacity-50">
                  {busy === c.id + "true" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Received, approve
                </button>
                <button disabled={Boolean(busy)} onClick={() => review(c.id, false)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-3 disabled:opacity-50">
                  {busy === c.id + "false" ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />} Not received
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
