import { context } from "@/lib/database";
import { messageLog, mmcAbilities } from "@/lib/mmc-data";
import { MessageTable } from "@/components/mmc/client-detail";
export const metadata = { title: "MMC notifications" };
export const dynamic = "force-dynamic";

export default async function MmcNotificationsPage() {
  const { db, profile } = await context();
  const [a, messages] = await Promise.all([mmcAbilities(db, profile), messageLog(db, 300)]);
  const count = (s: string) => messages.filter((m) => m.status === s).length;
  return (
    <div className="space-y-4">
      <div className="notice text-xs leading-5">
        Client SMS/WhatsApp messages go through MSG91. Failed messages are retried automatically up to 3 attempts (5 and 10 minutes apart);
        &quot;skipped&quot; means MSG91 is not configured for that channel or event yet (see Settings). A failed message never blocks a payment or a site switch.
        Admin alerts appear in the notification bell and as web push on enrolled devices.
      </div>
      <section className="panel">
        <div className="flex flex-wrap items-center justify-between gap-2 p-4">
          <h2 className="section-title">Message log</h2>
          <p className="text-xs text-muted-foreground">Sent {count("sent")} · Queued {count("queued") + count("sending")} · Failed {count("failed")} · Skipped {count("skipped")}</p>
        </div>
        <MessageTable messages={messages} manage={a.manage} showClient />
      </section>
    </div>
  );
}
