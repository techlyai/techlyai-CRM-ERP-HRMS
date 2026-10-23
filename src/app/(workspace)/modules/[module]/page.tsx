import { notFound } from "next/navigation";
import { context, grants, allowed, referencesFor } from "@/lib/database";
import { moduleMap, type BusinessRecord, type Profile } from "@/lib/modules";
import { ModuleList } from "@/components/module-list";
import { Attendance } from "@/components/attendance";
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
    const [today, monthRecords] = await Promise.all([
      db.select<BusinessRecord>(
        "records",
        `select=*&module=eq.attendance&owner_id=eq.${profile.id}&data->>date=eq.${todayDate}`,
      ),
      db.select<BusinessRecord>(
        "records",
        `select=*&module=eq.attendance&owner_id=eq.${profile.id}&data->>date=gte.${month}-01&data->>date=lte.${month}-31&limit=31`,
      ),
    ]);
    children = (
      <>
        <Attendance today={today[0]} timezone={timezone} />
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
    >
      {children}
    </ModuleList>
  );
}
