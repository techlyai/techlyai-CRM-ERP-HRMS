"use client";
import Link from "next/link";
import {
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  Download,
  FileText,
  Search,
  LayoutList,
  Filter,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { moduleMap, type Profile, type BusinessRecord } from "@/lib/modules";
import { money } from "@/lib/domain";
import { RecordForm, type Reference } from "./record-form";
import { Button } from "./ui/button";
import { Status } from "./ui/status";
import { Empty } from "./dashboard";
export function ModuleList({
  module,
  records,
  people,
  references,
  canCreate,
  canAssign,
  canExport,
  page,
  hasNext,
  q,
  status,
  newRecord,
  children,
}: {
  module: string;
  records: BusinessRecord[];
  people: Profile[];
  references: Reference[];
  canCreate: boolean;
  canAssign: boolean;
  canExport: boolean;
  page: number;
  hasNext: boolean;
  q: string;
  status: string;
  newRecord: boolean;
  children?: React.ReactNode;
}) {
  const m = moduleMap[module];
  const [format, setFormat] = useState("csv");
  const [reportFrom, setReportFrom] = useState("");
  const [reportTo, setReportTo] = useState("");
  const [importResult, setImportResult] = useState("");
  const [busy, setBusy] = useState(false);
  const link = (n: number) =>
    `/modules/${module}?page=${n}&q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}`;
  return (
    <>
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Workspace <span className="mx-1.5">/</span> {m.group}
          </p>
          <h1 className="text-[28px] font-semibold tracking-tight">
            {m.title}
          </h1>
          <p className="mt-2 text-[13px] text-muted-foreground">
            {m.description}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canExport && (
            <>
              <input
                type="date"
                aria-label="Export from date"
                title="Export from date"
                value={reportFrom}
                onChange={(e) => setReportFrom(e.target.value)}
                className="w-36 text-xs"
              />
              <input
                type="date"
                aria-label="Export to date"
                title="Export to date"
                value={reportTo}
                onChange={(e) => setReportTo(e.target.value)}
                className="w-36 text-xs"
              />
              <select
                aria-label="Export format"
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                className="w-24 text-xs"
              >
                {["csv", "xlsx", "pdf", "docx"].map((s) => (
                  <option value={s} key={s}>
                    {s.toUpperCase()}
                  </option>
                ))}
              </select>
              <Button asChild variant="outline">
                <a
                  href={`/api/export/${module}?format=${format}&from=${reportFrom}&to=${reportTo}&status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`}
                >
                  <Download size={14} />
                  Export
                </a>
              </Button>
              <Button variant="outline" onClick={() => window.print()}>
                Print
              </Button>
            </>
          )}
          {canCreate && (
            <RecordForm
              module={module}
              people={people}
              references={references}
              canAssign={canAssign}
              defaultOpen={newRecord}
            />
          )}
        </div>
      </div>
      {children}
      {module === "leads" && canCreate && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border p-3">
          <p className="text-xs text-muted-foreground">
            Import leads from CSV or Excel. Required columns: title, contact,
            phone. Other columns follow the lead form fields.
          </p>
          <label className="mb-0 cursor-pointer rounded-md border bg-card px-3 py-2 text-xs">
            <Upload size={13} className="mr-1 inline" />
            {busy ? "Importing…" : "Import file"}
            <input
              type="file"
              accept=".csv,.xlsx"
              className="hidden"
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBusy(true);
                const data = new FormData();
                data.set("file", file);
                try {
                  const res = await fetch("/api/import/leads", {
                    method: "POST",
                    body: data,
                  });
                  const json = await res.json();
                  setImportResult(
                    json.error ||
                      `Imported ${json.count} leads. Refresh to see new records.`,
                  );
                } catch {
                  setImportResult("Import failed. Try again.");
                }
                setBusy(false);
                e.target.value = "";
              }}
            />
          </label>
          {importResult && (
            <p role="status" className="w-full text-xs text-primary">
              {importResult}
            </p>
          )}
        </div>
      )}
      <section className="panel">
        <form
          className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4"
          action={"/modules/" + module}
        >
          <div className="relative w-full max-w-sm">
            <Search
              size={15}
              className="absolute left-3 top-3 text-muted-foreground"
            />
            <input
              name="q"
              defaultValue={q}
              placeholder={`Search ${m.title.toLowerCase()}…`}
              aria-label="Search module"
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-muted-foreground" />
            <select
              name="status"
              defaultValue={status}
              className="w-44 text-xs"
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              {m.statuses.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <Button variant="outline" size="sm" type="submit">
              Apply
            </Button>
          </div>
        </form>
        {records.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-4 font-medium">Record</th>
                  <th className="p-4 font-medium">Owner</th>
                  <th className="p-4 font-medium">Status</th>
                  <th className="p-4 font-medium">
                    {module === "inventory"
                      ? "Available / allocated"
                      : module === "attendance"
                        ? "Clock-in"
                        : module === "leave"
                          ? "Dates"
                          : "Amount / deadline"}
                  </th>
                  <th className="p-4 font-medium">Last updated</th>
                  <th className="p-4" />
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-border hover:bg-muted/40"
                  >
                    <td className="p-4">
                      <Link
                        href={`/modules/${module}/${r.id}`}
                        className="font-semibold hover:text-primary"
                      >
                        {r.title}
                      </Link>
                      <p className="mt-1.5 text-[10px] text-muted-foreground">
                        {String(
                          r.data.client ||
                            r.data.company ||
                            r.data.department ||
                            r.data.category ||
                            r.data.sku ||
                            "",
                        )}
                      </p>
                    </td>
                    <td className="p-4 text-muted-foreground">
                      {people.find((p) => p.id === r.owner_id)?.full_name ||
                        "Assigned colleague"}
                    </td>
                    <td className="p-4">
                      <Status value={r.status} />
                    </td>
                    <td className="p-4 text-muted-foreground">
                      {module === "inventory"
                        ? `${r.data.available || 0} / ${r.data.allocated || 0}`
                        : module === "attendance"
                          ? r.data.clock_in
                            ? new Date(
                                String(r.data.clock_in),
                              ).toLocaleTimeString("en-IN", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "—"
                          : module === "leave"
                            ? `${r.data.start_date} → ${r.data.end_date}`
                            : r.data.amount !== undefined
                              ? money(r.data.amount)
                              : String(
                                  r.data.due_date || r.data.expiry_date || "—",
                                )}
                    </td>
                    <td className="p-4 text-muted-foreground">
                      {new Date(r.updated_at).toLocaleDateString("en-IN")}
                    </td>
                    <td className="p-4">
                      <Link
                        href={`/modules/${module}/${r.id}`}
                        aria-label={"Open " + r.title}
                      >
                        <ArrowUpRight size={15} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={LayoutList}
            message={
              q || status
                ? "No matching records"
                : `No ${m.title.toLowerCase()} yet`
            }
            detail={
              q || status
                ? "Try a different search or status."
                : `Add your first ${m.singular.toLowerCase()} to get started.`
            }
          />
        )}
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <span>
            Page {page} · {records.length} records
            {canExport ? " · Export includes all permitted records" : ""}
          </span>
          <div className="flex items-center gap-2">
            {page > 1 ? (
              <Button asChild variant="outline" size="sm">
                <Link href={link(page - 1)}>
                  <ArrowLeft size={13} />
                  Previous
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled>
                <ArrowLeft size={13} />
                Previous
              </Button>
            )}
            {hasNext ? (
              <Button asChild variant="outline" size="sm">
                <Link href={link(page + 1)}>
                  Next
                  <ArrowRight size={13} />
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled>
                Next
                <ArrowRight size={13} />
              </Button>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
