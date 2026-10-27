import { context } from "@/lib/database";
import { mmcAbilities } from "@/lib/mmc-data";
export const dynamic = "force-dynamic";

/** MMC: monthly maintenance charges and client website ON/OFF control. */
export default async function MmcLayout({ children }: { children: React.ReactNode }) {
  const { db, profile } = await context();
  const a = await mmcAbilities(db, profile);
  if (!a.view)
    return (
      <div className="panel mx-auto max-w-xl p-8">
        <h1 className="text-xl font-semibold">MMC</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          You do not have access to maintenance charges and client sites. Ask a Super Admin for the MMC permission.
        </p>
      </div>
    );
  return (
    <>
      <div className="mb-5">
        <p className="mb-2 text-[11px] text-muted-foreground">Operations / MMC</p>
        <h1 className="text-2xl font-semibold tracking-tight">Monthly Maintenance Charges & Site Control</h1>
      </div>
      {children}
    </>
  );
}
