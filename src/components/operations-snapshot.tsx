import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { money } from "@/lib/domain";
import type { Stats } from "./dashboard";
export function OperationsSnapshot({
  stats,
  visible,
}: {
  stats: Stats;
  visible: string[];
}) {
  const metrics = [
    {
      label: "Reports awaiting review",
      value: stats.reports_pending,
      module: "eod",
      href: "/modules/eod?status=Submitted",
    },
    {
      label: "Attendance corrections",
      value: stats.corrections_pending,
      module: "corrections",
      href: "/modules/corrections?status=Submitted",
    },
    {
      label: "Pending leave requests",
      value: stats.leave_pending,
      module: "leave",
      href: "/modules/leave?status=Submitted",
    },
    {
      label: "Pending expense claims",
      value: stats.claims_pending,
      module: "expenses",
      href: "/modules/expenses?status=Submitted",
    },
    {
      label: "Expired subscriptions",
      value: stats.expired,
      module: "renewals",
      href: "/modules/renewals",
    },
    {
      label: "Outstanding credit & purchases",
      value: money(stats.outstanding),
      module: "credit",
      href: "/modules/credit",
    },
    {
      label: "Assets due for service",
      value: stats.maintenance_due,
      module: "assets",
      href: "/modules/assets",
    },
    {
      label: "Low-stock items",
      value: stats.low_stock,
      module: "inventory",
      href: "/modules/inventory",
    },
  ];
  return (
    <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {metrics
        .filter((m) => visible.includes(m.module))
        .map((m) => (
          <Link
            key={m.label}
            href={m.href}
            className="panel flex items-center justify-between gap-3 p-4 hover:border-primary/30"
          >
            <div>
              <p className="text-[10px] text-muted-foreground">{m.label}</p>
              <p className="mt-2 text-xl font-semibold">{m.value}</p>
            </div>
            <ArrowUpRight size={15} className="text-muted-foreground" />
          </Link>
        ))}
    </section>
  );
}
