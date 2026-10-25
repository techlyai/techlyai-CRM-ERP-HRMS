import { context } from "@/lib/database";
import { fieldContext, myFieldState, validDate } from "@/lib/field-data";
import type { OverviewRow } from "@/lib/field";
import { MyFieldWork } from "@/components/field/my-field-work";
import { FieldOverview } from "@/components/field/field-overview";
export const metadata = { title: "Field operations" };

export default async function FieldDashboard({ searchParams }: { searchParams: { date?: string } }) {
  const { db, profile } = await context();
  const f = await fieldContext(db, profile);
  const date = validDate(searchParams.date, f.today);
  const [mine, rows] = await Promise.all([
    f.assignment?.enabled ? myFieldState(db, profile, f.today, f.timezone) : Promise.resolve(null),
    f.abilities.view ? db.rpc<OverviewRow[]>("field_overview", { p_date: date }) : Promise.resolve([] as OverviewRow[]),
  ]);
  return (
    <div className="space-y-8">
      {f.assignment && !f.assignment.enabled && (
        <p className="panel p-4 text-sm text-muted-foreground">Field tracking is currently turned off for your account.</p>
      )}
      {mine && f.assignment && <MyFieldWork assignment={f.assignment} timezone={f.timezone} {...mine} />}
      {f.abilities.view && (
        <FieldOverview rows={rows.filter((r) => r.user_id !== profile.id)} date={date} today={f.today} timezone={f.timezone} />
      )}
    </div>
  );
}
