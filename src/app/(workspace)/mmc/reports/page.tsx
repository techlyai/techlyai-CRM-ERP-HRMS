import { FileSpreadsheet } from "lucide-react";
import { context } from "@/lib/database";
import { siteLogs } from "@/lib/mmc-data";
export const metadata = { title: "MMC reports" };
export const dynamic = "force-dynamic";

const reports = [
  { type: "payments", title: "Payments", detail: "Every payment with receipt number, mode and reference. Filtered by payment date." },
  { type: "dues", title: "Dues", detail: "Monthly dues with paid amount, balance and status. Filtered by due date." },
  { type: "toggles", title: "Site ON/OFF history", detail: "Every switch: who or what changed it, and why. Filtered by date of change." },
];

export default async function MmcReportsPage() {
  const { db } = await context();
  const logs = await siteLogs(db, 50);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        {reports.map((r) => (
          <form key={r.type} action="/api/mmc/export" method="get" className="panel space-y-3 p-5">
            <input type="hidden" name="type" value={r.type} />
            <div className="flex items-center gap-2">
              <div className="icon-tile h-8 w-8"><FileSpreadsheet size={16} /></div>
              <h2 className="section-title">{r.title}</h2>
            </div>
            <p className="text-xs text-muted-foreground">{r.detail}</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="field"><label htmlFor={r.type + "-from"}>From</label><input id={r.type + "-from"} name="from" type="date" /></div>
              <div className="field"><label htmlFor={r.type + "-to"}>To</label><input id={r.type + "-to"} name="to" type="date" /></div>
            </div>
            <div className="flex gap-2">
              <button name="format" value="xlsx" className="h-9 flex-1 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground">Excel</button>
              <button name="format" value="csv" className="h-9 flex-1 rounded-lg border border-border px-3 text-xs font-medium">CSV</button>
            </div>
          </form>
        ))}
      </div>
      <section className="panel">
        <h2 className="section-title p-4">Latest site ON/OFF changes</h2>
        {logs.length === 0 ? (
          <p className="px-4 pb-6 text-sm text-muted-foreground">No changes yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>{["When", "Client", "Change", "By", "Reason"].map((h) => <th key={h} className="p-3 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="whitespace-nowrap p-3">{new Date(l.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</td>
                    <td className="p-3">{l.client_name}</td>
                    <td className={`p-3 font-semibold ${l.new_state ? "text-success" : "text-danger"}`}>{l.old_state ? "ON" : "OFF"} → {l.new_state ? "ON" : "OFF"}</td>
                    <td className="p-3">{l.source === "auto" ? "Auto (system)" : l.actor_name || "Admin"}</td>
                    <td className="p-3 text-muted-foreground">{l.reason || "—"}</td>
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
