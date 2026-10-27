import Link from "next/link";
import { FileDown } from "lucide-react";
import { context } from "@/lib/database";
import { mmcAbilities, pendingClaims, recentPayments } from "@/lib/mmc-data";
import { ClaimList } from "@/components/mmc/claims";
import { rupees } from "@/lib/mmc";
export const metadata = { title: "MMC payments" };
export const dynamic = "force-dynamic";

export default async function MmcPaymentsPage() {
  const { db, profile } = await context();
  const [a, payments, claims] = await Promise.all([mmcAbilities(db, profile), recentPayments(db, 300), pendingClaims(db)]);
  const total = payments.reduce((s, p) => s + Number(p.amount), 0);
  return (
    <div className="space-y-6">
    <ClaimList claims={claims} manage={a.manage} />
    <section className="panel">
      <div className="flex flex-wrap items-center justify-between gap-2 p-4">
        <h2 className="section-title">Recent payments</h2>
        <p className="text-xs text-muted-foreground">
          Latest {payments.length} · {rupees(total)} · To record a payment, open the client or use <Link href="/mmc/clients" className="text-primary">Clients</Link>.
        </p>
      </div>
      {payments.length === 0 ? (
        <p className="px-4 pb-6 text-sm text-muted-foreground">No payments recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>{["Receipt", "Date", "Client", "Amount", "Mode", "Reference", "Note", ""].map((h) => <th key={h} className="p-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-border align-top">
                  <td className="p-3 font-mono">MMC-{String(p.receipt_no).padStart(5, "0")}</td>
                  <td className="whitespace-nowrap p-3">{p.paid_on}</td>
                  <td className="p-3"><Link href={`/mmc/clients/${p.client_id}`} className="font-medium hover:text-primary">{p.client_name}</Link></td>
                  <td className="p-3 font-semibold">{rupees(p.amount)}</td>
                  <td className="p-3">{p.mode}</td>
                  <td className="p-3">{p.reference || "—"}</td>
                  <td className="max-w-[220px] p-3 text-muted-foreground">{p.note || "—"}</td>
                  <td className="p-3 text-right">
                    <a className="inline-flex items-center gap-1 text-primary" href={`/api/mmc/receipt/${p.receipt_token}`} target="_blank" rel="noreferrer"><FileDown size={13} /> PDF</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
    </div>
  );
}
