"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Eye, Search } from "lucide-react";
import { lastSeen, rupees } from "@/lib/mmc";
import type { ClientRow } from "@/lib/mmc-data";
import { DueBadge, PayButton, RemindButton, SiteToggle } from "./controls";
import { ClientFormButton } from "./client-form";
import { DeleteClientButton } from "./client-detail";

const filters = ["All", "Paid", "Pending", "Overdue", "Active", "Suspended"] as const;

export function ClientList({ clients, manage, canDelete, enabled, initialFilter }: { clients: ClientRow[]; manage: boolean; canDelete: boolean; enabled: string[]; initialFilter?: string }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof filters)[number]>(
    (filters as readonly string[]).includes(initialFilter || "") ? (initialFilter as (typeof filters)[number]) : "All",
  );
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return clients.filter((c) => {
      if (n && !`${c.name} ${c.business_name} ${c.phone} ${c.website_url}`.toLowerCase().includes(n)) return false;
      if (filter === "Active") return c.site_active;
      if (filter === "Suspended") return !c.site_active;
      if (filter !== "All") return c.status === filter;
      return true;
    });
  }, [clients, q, filter]);
  const count = (f: (typeof filters)[number]) =>
    f === "All" ? clients.length : f === "Active" ? clients.filter((c) => c.site_active).length : f === "Suspended" ? clients.filter((c) => !c.site_active).length : clients.filter((c) => c.status === f).length;
  return (
    <div className="panel">
      <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center">
        <label className="relative mb-0 flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-3 text-muted-foreground" />
          <input aria-label="Search clients" className="pl-9" placeholder="Search name, business, phone or website" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="no-scrollbar flex gap-1 overflow-x-auto">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs ${filter === f ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-muted"}`}
            >
              {f} <span className="opacity-60">{count(f)}</span>
            </button>
          ))}
        </div>
      </div>
      {list.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">{clients.length ? "No clients match this filter." : "No MMC clients yet. Add your first client to get a site key."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                {["Client", "MMC", "This month", "Outstanding", "Site last seen", "Site", ""].map((h) => (
                  <th key={h} className="p-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className="border-t border-border align-middle">
                  <td className="p-3">
                    <Link href={`/mmc/clients/${c.id}`} className="font-semibold hover:text-primary">{c.name}</Link>
                    <div className="text-[11px] text-muted-foreground">{c.business_name || c.website_url || c.phone}</div>
                  </td>
                  <td className="p-3">{rupees(c.mmc_amount)}<span className="text-muted-foreground"> / mo</span></td>
                  <td className="p-3">
                    <DueBadge status={c.status} />
                    {c.days_overdue > 0 && <div className="mt-1 text-[11px] text-danger">{c.days_overdue} days overdue</div>}
                  </td>
                  <td className="p-3">
                    {Number(c.owed) > 0 ? rupees(c.owed) : "—"}
                    {Number(c.credit) > 0 && <div className="text-[11px] text-success">Advance {rupees(c.credit)}</div>}
                  </td>
                  <td className="p-3 text-muted-foreground">{lastSeen(c.last_checked_at)}</td>
                  <td className="p-3">
                    <SiteToggle client={c.id} name={c.name} active={c.site_active} disabled={!manage} />
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1">
                      {manage && <PayButton client={c.id} name={c.name} owed={c.owed} amount={c.mmc_amount} />}
                      {manage && <RemindButton client={c.id} enabled={enabled} />}
                      <Link href={`/mmc/clients/${c.id}`} aria-label={`View ${c.name}`} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                        <Eye size={14} /> View
                      </Link>
                      {manage && <ClientFormButton client={c} />}
                      {canDelete && <DeleteClientButton client={c.id} name={c.name} />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
