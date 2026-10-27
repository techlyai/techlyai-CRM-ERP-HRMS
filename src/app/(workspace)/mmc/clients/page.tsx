import { context } from "@/lib/database";
import { listClients, mmcAbilities, mmcSettings } from "@/lib/mmc-data";
import { ClientList } from "@/components/mmc/client-list";
import { ClientFormButton } from "@/components/mmc/client-form";
export const metadata = { title: "MMC clients" };
export const dynamic = "force-dynamic";

export default async function MmcClientsPage({ searchParams }: { searchParams?: { filter?: string } }) {
  const { db, profile } = await context();
  const [a, clients, settings] = await Promise.all([mmcAbilities(db, profile), listClients(db), mmcSettings(db)]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{clients.length} clients · {clients.filter((c) => !c.site_active).length} suspended</p>
        {a.manage && <ClientFormButton client={null} defaultGrace={settings?.default_grace_days ?? 5} />}
      </div>
      <ClientList clients={clients} manage={a.manage} initialFilter={searchParams?.filter} />
    </div>
  );
}
