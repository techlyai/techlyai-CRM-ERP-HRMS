import { context } from "@/lib/database";
import { fieldContext } from "@/lib/field-data";
import { FieldTabs } from "@/components/field/field-tabs";
export const dynamic = "force-dynamic";

/** Field operations: available to assigned field employees and to people granted field permissions. */
export default async function FieldLayout({ children }: { children: React.ReactNode }) {
  const { db, profile } = await context();
  const f = await fieldContext(db, profile);
  const employee = Boolean(f.assignment);
  if (!employee && !f.abilities.view && !f.abilities.manage)
    return (
      <div className="panel mx-auto max-w-xl p-8">
        <h1 className="text-xl font-semibold">Field operations</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Field tracking is not enabled for your account, and you have not been given access to field records.
        </p>
      </div>
    );
  return (
    <>
      <div className="mb-5">
        <p className="mb-2 text-[11px] text-muted-foreground">Workspace / Field operations</p>
        <h1 className="text-2xl font-semibold tracking-tight">Field Operations & GPS Tracking</h1>
      </div>
      <FieldTabs reviewer={f.abilities.view} manage={f.abilities.manage} />
      {children}
    </>
  );
}
