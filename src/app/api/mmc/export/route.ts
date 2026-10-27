import { NextResponse, type NextRequest } from "next/server";
import { context } from "@/lib/database";
import { reportFile } from "@/lib/reports";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reports = {
  payments: {
    title: "MMC payments",
    header: ["Receipt", "Client", "Business", "Paid on", "Amount", "Mode", "Reference", "Note", "Recorded at"],
    sql: `select 'MMC-'||lpad(p.receipt_no::text,5,'0'),c.name,c.business_name,p.paid_on::text,p.amount::text,p.mode,p.reference,p.note,to_char(p.created_at,'YYYY-MM-DD HH24:MI')
      from public.mmc_payments p join public.mmc_clients c on c.id=p.client_id
      where ($1::date is null or p.paid_on>=$1) and ($2::date is null or p.paid_on<=$2) order by p.paid_on desc,p.receipt_no desc limit 10001`,
  },
  dues: {
    title: "MMC dues",
    header: ["Client", "Business", "Month", "Due date", "Amount", "Paid", "Balance", "Status"],
    sql: `select c.name,c.business_name,to_char(d.period,'Mon YYYY'),d.due_date::text,d.amount::text,d.paid_amount::text,(d.amount-d.paid_amount)::text,d.status
      from public.mmc_dues d join public.mmc_clients c on c.id=d.client_id
      where ($1::date is null or d.due_date>=$1) and ($2::date is null or d.due_date<=$2) order by d.due_date desc,c.name limit 10001`,
  },
  toggles: {
    title: "MMC site ON/OFF history",
    header: ["When", "Client", "From", "To", "Changed by", "Reason"],
    sql: `select to_char(l.created_at,'YYYY-MM-DD HH24:MI'),l.client_name,case when l.old_state then 'ON' else 'OFF' end,case when l.new_state then 'ON' else 'OFF' end,
      case when l.source='auto' then 'Auto (system)' else coalesce(p.full_name,'Admin') end,l.reason
      from public.mmc_site_logs l left join public.profiles p on p.id=l.actor_id
      where ($1::date is null or l.created_at::date>=$1) and ($2::date is null or l.created_at::date<=$2) order by l.id desc limit 10001`,
  },
} as const;

export async function GET(req: NextRequest) {
  const { db } = await context();
  const q = req.nextUrl.searchParams;
  const type = q.get("type") as keyof typeof reports;
  const format = q.get("format") === "xlsx" ? "xlsx" : "csv";
  const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const report = reports[type];
  if (!report) return NextResponse.json({ error: "Unknown report" }, { status: 400 });
  try {
    // RLS returns no rows to people without MMC view permission.
    const rows = await db.run(async (c) => (await c.query({ text: report.sql, values: [day(q.get("from")), day(q.get("to"))], rowMode: "array" })).rows as string[][]);
    if (rows.length > 10000) return NextResponse.json({ error: "More than 10,000 rows. Narrow the date range." }, { status: 400 });
    const file = await reportFile(report.title, [[...report.header], ...rows.map((r) => r.map((v) => v ?? ""))], format);
    return new NextResponse(Buffer.from(file.bytes), {
      headers: {
        "Content-Type": file.mime,
        "Content-Disposition": `attachment; filename="orbit-mmc-${type}-${new Date().toISOString().slice(0, 10)}.${format}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Export failed" }, { status: 400 });
  }
}
