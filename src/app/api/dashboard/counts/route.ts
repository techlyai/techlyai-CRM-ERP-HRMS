export const dynamic = "force-dynamic";
import { context } from "@/lib/database";
import { NextResponse } from "next/server";
export type DashboardCounts = {
  reports_pending: number;
  leave_pending: number;
  claims_pending: number;
  corrections_pending: number;
  questions_pending: number;
  pending: number;
  reminders_upcoming: number;
  generated_at: string;
};
/** Live pending counts for the overview page; polled every 15s while visible. */
export async function GET() {
  const { db } = await context();
  const horizon = new Date(Date.now() + 7 * 86400000).toISOString();
  const [stats, reminders] = await Promise.all([
    db.rpc<Record<string, number>>("dashboard_stats"),
    db.select<{ id: string }>(
      "reminders",
      "select=id&status=eq.Pending&due_at=lte." + horizon + "&limit=1000",
    ),
  ]);
  const n = (key: string) => Number(stats?.[key] ?? 0) || 0;
  const body: DashboardCounts = {
    reports_pending: n("reports_pending"),
    leave_pending: n("leave_pending"),
    claims_pending: n("claims_pending"),
    corrections_pending: n("corrections_pending"),
    questions_pending: n("questions_pending"),
    pending: n("pending"),
    reminders_upcoming: reminders.length,
    generated_at: new Date().toISOString(),
  };
  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
