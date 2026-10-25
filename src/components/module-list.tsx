"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  Download,
  Search,
  LayoutList,
  Filter,
  Upload,
  ChevronDown,
  Loader2,
  CheckCircle2,
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
  const router = useRouter();
  const m = moduleMap[module];
  const [showExport, setShowExport] = useState(false);
  const [format, setFormat] = useState("csv");
  const [reportFrom, setReportFrom] = useState("");
  const [reportTo, setReportTo] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportResult, setExportResult] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState("");
  const [importError, setImportError] = useState("");
  const [busy, setBusy] = useState(false);
  const filtered = Boolean(q || status);
  const invalidRange = Boolean(reportFrom && reportTo && reportFrom > reportTo);
  const link = (n: number) =>
    `/modules/${module}?page=${n}&q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}`;
  const valueLabel =
    module === "inventory"
      ? "Available / allocated"
      : module === "attendance"
        ? "Clock-in"
        : module === "leave"
          ? "Dates"
          : "Amount / deadline";
  const recordValue = (r: BusinessRecord) =>
    module === "inventory"
      ? `${r.data.available || 0} / ${r.data.allocated || 0}`
      : module === "attendance"
        ? r.data.clock_in
          ? new Date(String(r.data.clock_in)).toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "—"
        : module === "leave"
          ? `${r.data.start_date || "—"} → ${r.data.end_date || "—"}`
          : r.data.amount !== undefined
            ? money(r.data.amount)
            : String(r.data.due_date || r.data.expiry_date || "—");
  const ownerName = (r: BusinessRecord) =>
    people.find((p) => p.id === r.owner_id)?.full_name || "Assigned colleague";
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
        <div className="no-print flex flex-wrap items-center gap-2">
          {canExport && (
            <Button
              variant="outline"
              aria-expanded={showExport}
              aria-controls="module-export"
              onClick={() => setShowExport(!showExport)}
            >
              <Download size={14} />
              Export & print
              <ChevronDown
                size={14}
                className={showExport ? "rotate-180" : ""}
              />
            </Button>
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
      {canExport && showExport && (
        <section
          id="module-export"
          aria-label="Export records"
          className="panel no-print mb-6 p-4 sm:p-5"
        >
          <h2 className="text-sm font-semibold">
            Export {m.title.toLowerCase()}
          </h2>
          <p
            id="export-help"
            className="mt-1 text-xs leading-5 text-muted-foreground"
          >
            Download all records you can access that match your current search
            and status. Dates are optional.
          </p>
          <form
            className="mt-4"
            aria-describedby="export-help"
            onSubmit={async (e) => {
              e.preventDefault();
              if (exportBusy || invalidRange) return;
              setExportBusy(true);
              setExportError("");
              setExportResult("");
              try {
                const params = new URLSearchParams({
                  format,
                  from: reportFrom,
                  to: reportTo,
                  status,
                  q,
                });
                const response = await fetch(`/api/export/${module}?${params}`);
                if (!response.ok) {
                  const result = await response.json().catch(() => null);
                  throw Error(
                    result?.error ||
                      "The export could not be created. Please try again.",
                  );
                }
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const download = document.createElement("a");
                download.href = url;
                download.download = `orbit-${module}-${new Date().toISOString().slice(0, 10)}.${format}`;
                document.body.appendChild(download);
                download.click();
                download.remove();
                window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                setExportResult(
                  "Your export is ready. Check your browser’s downloads.",
                );
              } catch (error) {
                setExportError(
                  error instanceof Error
                    ? error.message
                    : "Export failed. Please try again.",
                );
              } finally {
                setExportBusy(false);
              }
            }}
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="export-from">
                  From date{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </label>
                <input
                  id="export-from"
                  type="date"
                  value={reportFrom}
                  onChange={(e) => setReportFrom(e.target.value)}
                  aria-invalid={invalidRange || undefined}
                  aria-describedby={
                    invalidRange ? "export-date-error" : undefined
                  }
                />
              </div>
              <div>
                <label htmlFor="export-to">
                  To date{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </label>
                <input
                  id="export-to"
                  type="date"
                  value={reportTo}
                  onChange={(e) => setReportTo(e.target.value)}
                  aria-invalid={invalidRange || undefined}
                  aria-describedby={
                    invalidRange ? "export-date-error" : undefined
                  }
                />
              </div>
              <div>
                <label htmlFor="export-format">File format</label>
                <select
                  id="export-format"
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                >
                  <option value="csv">CSV — spreadsheet data</option>
                  <option value="xlsx">Excel workbook (.xlsx)</option>
                  <option value="pdf">PDF document</option>
                  <option value="docx">Word document (.docx)</option>
                </select>
              </div>
            </div>
            {invalidRange && (
              <p id="export-date-error" role="alert" className="error mt-3">
                The to date must be on or after the from date.
              </p>
            )}
            {exportError && (
              <p role="alert" className="error mt-3">
                {exportError}
              </p>
            )}
            {exportResult && (
              <p role="status" className="mt-3 text-xs text-success">
                {exportResult}
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={exportBusy || invalidRange}>
                {exportBusy ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Download size={14} />
                )}
                {exportBusy ? "Preparing export…" : "Download export"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => window.print()}
              >
                Print this page
              </Button>
              {(reportFrom || reportTo) && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setReportFrom("");
                    setReportTo("");
                  }}
                >
                  Clear dates
                </Button>
              )}
            </div>
          </form>
        </section>
      )}
      {children}
      {module === "leads" && canCreate && (
        <details className="no-print mb-5 rounded-xl border border-dashed border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Import leads from a spreadsheet
          </summary>
          <p
            id="import-help"
            className="mt-3 text-xs leading-5 text-muted-foreground"
          >
            Choose a CSV or Excel (.xlsx) file up to 4 MB and 500 leads.
            Required column headers: <strong>title</strong>,{" "}
            <strong>contact</strong>, <strong>phone</strong>. Other columns use
            the lead form field names.
          </p>
          <a
            download="orbit-leads-template.csv"
            href="data:text/csv;charset=utf-8,title%2Ccontact%2Cphone%0A"
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary underline underline-offset-2"
          >
            <Download size={13} /> Download CSV template
          </a>
          <form
            className="mt-4"
            aria-busy={busy}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!importFile || busy) return;
              const form = e.currentTarget;
              setImportError("");
              setImportResult("");
              if (
                !/\.(csv|xlsx)$/i.test(importFile.name) ||
                importFile.size > 4 * 1024 * 1024
              ) {
                setImportError(
                  "Choose a CSV or Excel (.xlsx) file up to 4 MB.",
                );
                return;
              }
              setBusy(true);
              const data = new FormData();
              data.set("file", importFile);
              try {
                const response = await fetch("/api/import/leads", {
                  method: "POST",
                  body: data,
                });
                const result = await response.json().catch(() => null);
                if (!response.ok || !result || result.error)
                  throw Error(
                    result?.error || "Import failed. Please try again.",
                  );
                setImportResult(
                  `Imported ${result.count} ${result.count === 1 ? "lead" : "leads"}. The list has been updated.${filtered ? " Your current filters still apply." : ""}`,
                );
                setImportFile(null);
                form.reset();
                router.refresh();
              } catch (error) {
                setImportError(
                  error instanceof Error
                    ? error.message
                    : "Import failed. Please try again.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <label htmlFor="lead-import-file">Spreadsheet file</label>
                <input
                  id="lead-import-file"
                  type="file"
                  accept=".csv,.xlsx"
                  required
                  disabled={busy}
                  aria-describedby="import-help"
                  onChange={(e) => {
                    setImportFile(e.target.files?.[0] || null);
                    setImportError("");
                    setImportResult("");
                  }}
                  className="text-xs file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1 file:text-foreground"
                />
              </div>
              <Button
                type="submit"
                variant="outline"
                disabled={busy || !importFile}
              >
                {busy ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Upload size={14} />
                )}
                {busy ? "Importing…" : "Import leads"}
              </Button>
            </div>
            {importError && (
              <p role="alert" className="error mt-3">
                {importError}
              </p>
            )}
            {importResult && (
              <p
                role="status"
                className="mt-3 flex items-start gap-2 text-xs leading-5 text-success"
              >
                <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
                {importResult}
              </p>
            )}
          </form>
        </details>
      )}
      <section className="panel">
        <form
          key={`${module}:${q}:${status}`}
          className="no-print flex flex-wrap items-end gap-3 border-b border-border p-4"
          action={"/modules/" + module}
        >
          <div className="w-full sm:min-w-48 sm:flex-1">
            <label htmlFor="module-search">Search by title</label>
            <div className="relative">
              <Search
                size={15}
                className="absolute left-3 top-3.5 text-muted-foreground"
              />
              <input
                id="module-search"
                name="q"
                defaultValue={q}
                placeholder={`Search ${m.title.toLowerCase()}…`}
                className="pl-9"
              />
            </div>
          </div>
          <div className="min-w-0 flex-1 sm:flex-none sm:w-48">
            <label htmlFor="module-status">Status</label>
            <select id="module-status" name="status" defaultValue={status}>
              <option value="">All statuses</option>
              {m.statuses.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <Button variant="outline" type="submit">
            <Filter size={14} />
            Apply filters
          </Button>
          {filtered && (
            <Button asChild variant="ghost">
              <Link href={`/modules/${module}`}>Clear filters</Link>
            </Button>
          )}
        </form>
        {filtered && (
          <p className="border-b border-border px-4 py-3 text-xs text-muted-foreground">
            Showing{" "}
            {status ? `${status.toLowerCase()} records` : "all statuses"}
            {q ? ` with titles matching “${q}”` : ""}.
          </p>
        )}
        {records.length ? (
          <>
            <ul className="divide-y divide-border md:hidden print:hidden">
              {records.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/modules/${module}/${r.id}`}
                    className="block p-4 transition-colors hover:bg-muted/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 break-words text-sm font-semibold">
                        {r.title}
                      </p>
                      <ArrowUpRight
                        size={16}
                        className="mt-0.5 shrink-0 text-muted-foreground"
                      />
                    </div>
                    {Boolean(
                      r.data.client ||
                        r.data.company ||
                        r.data.department ||
                        r.data.category ||
                        r.data.sku,
                    ) && (
                      <p className="mt-1 break-words text-xs text-muted-foreground">
                        {String(
                          r.data.client ||
                            r.data.company ||
                            r.data.department ||
                            r.data.category ||
                            r.data.sku,
                        )}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Status value={r.status} />
                      <span className="text-xs text-muted-foreground">
                        {ownerName(r)}
                      </span>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <dt className="text-muted-foreground">{valueLabel}</dt>
                        <dd className="mt-1 break-words">{recordValue(r)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Last updated</dt>
                        <dd className="mt-1">
                          {new Date(r.updated_at).toLocaleDateString("en-IN")}
                        </dd>
                      </div>
                    </dl>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block print:block">
              <table className="w-full text-left text-xs">
                <caption className="sr-only">
                  {m.title} records, page {page}
                </caption>
                <thead className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="p-4 font-medium">Record</th>
                    <th className="p-4 font-medium">Owner</th>
                    <th className="p-4 font-medium">Status</th>
                    <th className="p-4 font-medium">{valueLabel}</th>
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
                        {ownerName(r)}
                      </td>
                      <td className="p-4">
                        <Status value={r.status} />
                      </td>
                      <td className="p-4 text-muted-foreground">
                        {recordValue(r)}
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
          </>
        ) : (
          <div>
            <Empty
              icon={LayoutList}
              message={
                filtered
                  ? "No matching records"
                  : page > 1
                    ? "No records on this page"
                    : `No ${m.title.toLowerCase()} yet`
              }
              detail={
                filtered
                  ? "Try another title or clear the filters to see more records."
                  : page > 1
                    ? "Return to the first page to see the latest records."
                    : module === "attendance"
                      ? "Use the attendance controls above to record your first check-in."
                      : canCreate
                        ? `Use New ${m.singular.toLowerCase()} above to add your first record.`
                        : "Records shared with you or assigned to you will appear here. Contact your manager if you expect to see a record."
              }
            />
            {(filtered || page > 1) && (
              <div className="flex justify-center px-4 pb-6">
                <Button asChild variant="outline">
                  <Link href={filtered ? `/modules/${module}` : link(1)}>
                    {filtered ? "Clear filters" : "Go to first page"}
                  </Link>
                </Button>
              </div>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <span>
            Page {page} · {records.length}{" "}
            {records.length === 1 ? "record" : "records"} on this page
          </span>
          <nav
            aria-label="Record pagination"
            className="flex items-center gap-2"
          >
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
          </nav>
        </div>
      </section>
    </>
  );
}
