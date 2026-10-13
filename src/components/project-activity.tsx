import Link from "next/link";
import type { BusinessRecord } from "@/lib/modules";
import { money } from "@/lib/domain";
import { Status } from "./ui/status";
export function ProjectActivity({
  records,
  budget,
}: {
  records: BusinessRecord[];
  budget: number;
}) {
  const tasks = records.filter((r) => r.module === "tasks");
  const completed = tasks.filter((r) => r.status === "Completed").length;
  const expenses = records.filter(
    (r) =>
      r.module === "expenses" &&
      ["Approved", "Pending Payment", "Paid"].includes(r.status),
  );
  const spent = expenses.reduce((n, r) => n + Number(r.data.amount || 0), 0);
  return (
    <section className="panel mt-6 p-5">
      <h2 className="section-title">Project activity & budget</h2>
      <p className="mt-2 text-xs text-muted-foreground">
        Task progress, submitted reports, and spending visible to your account.
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-4">
        {[
          ["Task progress", `${completed} / ${tasks.length}`],
          ["Budget", money(budget)],
          ["Approved expenses", money(spent)],
          ["Remaining budget", money(budget - spent)],
        ].map(([label, value]) => (
          <div className="rounded-lg border p-4" key={label}>
            <p className="text-[10px] text-muted-foreground">{label}</p>
            <p className="mt-2 text-xl font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary"
          style={{
            width: `${tasks.length ? (completed / tasks.length) * 100 : 0}%`,
          }}
        />
      </div>
      <div className="mt-5 space-y-3">
        {records.slice(0, 30).map((r) => (
          <Link
            href={`/modules/${r.module}/${r.id}`}
            key={r.id}
            className="flex items-center justify-between gap-3 rounded-lg border p-3"
          >
            <div>
              <p className="text-xs font-medium">{r.title}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {r.module === "eod"
                  ? "Daily report"
                  : r.module === "tasks"
                    ? "Task"
                    : "Expense"}{" "}
                · {new Date(r.updated_at).toLocaleDateString("en-IN")}
              </p>
            </div>
            <Status value={r.status} />
          </Link>
        ))}
      </div>
      {records.length >= 500 && (
        <p className="mt-4 text-xs text-muted-foreground">
          Showing the first 500 authorized records. Export project records for
          further analysis.
        </p>
      )}
    </section>
  );
}
