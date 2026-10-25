import { notFound } from "next/navigation";
import { context, grants, allowed, referencesFor, scopeOf } from "@/lib/database";
import { moduleMap, type BusinessRecord, type Profile } from "@/lib/modules";
import { ModuleList } from "@/components/module-list";
import { AttendanceCard } from "@/components/attendance-card";
import { AttendanceOverview } from "@/components/attendance-overview";
import { attendanceCardData, summarizeMonth, type OverviewRow } from "@/lib/attendance";
import { formatHours } from "@/lib/geo";
import { localDate } from "@/lib/domain";
import { type Reference } from "@/components/record-form";
import { AttendanceCalendar } from "@/components/attendance-calendar";
export default async function ModulePage({
  params,
  searchParams,
}: {
  params: { module: string };
  searchParams: {
    page?: string;
    q?: string;
    status?: string;
    new?: string;
    month?: string;
    date?: string;
    attendance?: string;
  };
}) {
  const { module } = params;
  if (!moduleMap[module]) notFound();
  const { db, profile } = await context();
  const permissions = await grants(db);
  if (!allowed(profile, permissions, module, "view"))
    return (
      <p className="error">You do not have permission to view this module.</p>
    );
  const page = Math.max(
    1,
    Math.min(10000, Math.floor(Number(searchParams.page) || 1)),
  );
  const q = (searchParams.q || "")
    .replace(/[^\p{L}\p{N} @.+-]/gu, "")
    .slice(0, 100);
  const status = moduleMap[module].statuses.includes(searchParams.status || "")
    ? searchParams.status || ""
    : "";
  const query =
    `select=*&module=eq.${module}&status=neq.Archived&order=updated_at.desc&limit=31&offset=${(page - 1) * 30}` +
    (q ? "&title=ilike." + encodeURIComponent("*" + q + "*") : "") +
    (status ? "&status=eq." + encodeURIComponent(status) : "");
  const [records, people, references] = await Promise.all([
    db.select<BusinessRecord>("records", query),
    db.select<Profile>("profiles", "select=*&active=eq.true&order=full_name"),
    referencesFor(db, module),
  ]);
  if (module === "purchases") {
    const catalog = await db.rpc<Reference[]>("purchase_catalog");
    for (const item of catalog)
      if (!references.some((r) => r.id === item.id)) references.push(item);
  }
  let children: React.ReactNode;
  if (module === "attendance") {
    const settings = await db.select<{
      data: {
        timezone: string;
        holidays: string[];
        working_days: number[];
        special_days?: { date: string; working: boolean }[];
      };
    }>("settings", "select=data&id=eq.1");
    const company = settings[0].data;
    const timezone = company.timezone || "Asia/Kolkata";
    const todayDate = localDate(new Date(), timezone);
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(searchParams.month || "")
      ? searchParams.month!
      : todayDate.slice(0, 7);
    const canCheckIn = allowed(profile, permissions, "attendance", "create");
    // Reviewers (any scope beyond their own records) also get the team overview.
    const reviewer = ["team", "department", "all"].includes(scopeOf(profile, permissions, "attendance", "view"));
    const date =
      /^d{4}-d{2}-d{2}$/.test(searchParams.date || "") && searchParams.date! <= todayDate
        ? searchParams.date!
        : todayDate;
    const [card, overview, monthRecords] = await Promise.all([
      attendanceCardData(db, profile, timezone),
      reviewer ? db.rpc<OverviewRow[]>("attendance_overview", { p_date: date }) : Promise.resolve([] as OverviewRow[]),
      db.select<BusinessRecord>(
        "records",
        `select=*&module=eq.attendance&owner_id=eq.${profile.id}&data->>date=gte.${month}-01&data->>date=lte.${month}-31&limit=31`,
      ),
    ]);
    children = (
      <>
        {canCheckIn && (
          <AttendanceCard
            {...card}
            canCheckIn
            canCheckOut={allowed(profile, permissions, "attendance", "edit")}
            canRequestCorrection={allowed(profile, permissions, "corrections", "create")}
            showHistoryLink={false}
          />
        )}
        <MonthSummary records={monthRecords} today={todayDate} month={month} />
        {reviewer && <AttendanceOverview rows={overview} date={date} today={todayDate} timezone={timezone} />}
        <AttendanceCalendar
          month={month}
          records={monthRecords}
          holidays={company.holidays}
          workingDays={company.working_days}
          specialDays={company.special_days || []}
          today={todayDate}
          timezone={timezone}
        />
      </>
    );
  }
  if (module === "leave") {
    const ledger = await db.select<{ type: string; amount: number }>(
      "leave_ledger",
      "select=type,amount&user_id=eq." + profile.id,
    );
    const balances: Record<string, number> = {};
    for (const l of ledger)
      balances[l.type] = (balances[l.type] || 0) + Number(l.amount);
    children = (
      <div className="mb-6 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Object.keys(balances).length ? (
          Object.entries(balances).map(([type, amount]) => (
            <div className="panel p-4" key={type}>
              <p className="text-[11px] text-muted-foreground">{type}</p>
              <p className="mt-2 text-2xl font-semibold">
                {amount}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  days
                </span>
              </p>
            </div>
          ))
        ) : (
          <p className="col-span-full rounded-lg border p-4 text-sm text-muted-foreground">
            Leave balances are allocated by the scheduler according to company
            policy. Your Admin can run the scheduler from Settings.
          </p>
        )}
      </div>
    );
  }
  return (
    <ModuleList
      module={module}
      records={records.slice(0, 30)}
      hasNext={records.length > 30}
      people={[profile, ...people.filter((p) => p.id !== profile.id)]}
      references={references}
      canCreate={
        module !== "attendance" &&
        allowed(profile, permissions, module, "create")
      }
      canAssign={profile.role !== "employee"}
      canExport={allowed(profile, permissions, module, "export")}
      page={page}
      q={q}
      status={status}
      newRecord={searchParams.new === "1"}
      prefill={
        module === "corrections" && /^[0-9a-f-]{36}$/i.test(searchParams.attendance || "")
          ? { attendance_id: searchParams.attendance! }
          : undefined
      }
    >
      {children}
    </ModuleList>
  );
}

function MonthSummary({ records, today, month }: { records: BusinessRecord[]; today: string; month: string }) {
  const s = summarizeMonth(records, today);
  const label = new Date(month + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  return (
    <section aria-label={`Your attendance in ${label}`} className="mb-6">
      <h2 className="section-title mb-3">Your month · {label}</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {(
          [
            ["Present", s.present],
            ["Late", s.late],
            ["Half-day", s.halfDay],
            ["Work from home", s.wfh],
            ["Missing check-outs", s.missingCheckout],
            ["Location not verified", s.unverified],
            ["Hours worked", formatHours(s.hours)],
          ] as [string, number | string][]
        ).map(([k, v]) => (
          <div key={k} className="panel p-3">
            <p className="text-[11px] text-muted-foreground">{k}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{v}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
