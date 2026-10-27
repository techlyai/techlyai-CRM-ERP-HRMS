import { context } from "@/lib/database";
import { mmcAbilities } from "@/lib/mmc-data";
import { vaultConfigured } from "@/lib/vault";
import { KeyNotes, type KeyNote } from "@/components/mmc/key-notes";
export const metadata = { title: "MMC notes" };
export const dynamic = "force-dynamic";

export default async function MmcNotesPage() {
  const { db, profile } = await context();
  const a = await mmcAbilities(db, profile);
  const notes = await db.run(
    async (c) =>
      (
        await c.query(
          "select id,name,business_name,website_url,key_prefix,key_created_at,key_saved_at from public.mmc_clients order by lower(name)",
        )
      ).rows as KeyNote[],
  );
  const base = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
  return (
    <div className="space-y-4">
      {!vaultConfigured() && (
        <p className="error">
          Key storage is not configured on this server, so new keys cannot be saved here. An administrator must set CREDENTIALS_ENCRYPTION_KEY
          (64 hex characters) and restart the app.
        </p>
      )}
      <KeyNotes notes={notes} canReveal={a.manage} endpoint={base + "/api/site-status"} />
    </div>
  );
}
