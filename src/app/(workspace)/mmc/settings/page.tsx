import { context } from "@/lib/database";
import { mmcAbilities, mmcSettings } from "@/lib/mmc-data";
import { MmcSettingsForm } from "@/components/mmc/settings-form";
export const metadata = { title: "MMC settings" };
export const dynamic = "force-dynamic";

export default async function MmcSettingsPage() {
  const { db, profile } = await context();
  const a = await mmcAbilities(db, profile);
  if (!a.settings) return <p className="error">Only a Super Admin or someone granted MMC settings can change these settings.</p>;
  const settings = await mmcSettings(db);
  let templateIds: string[] = [];
  try {
    templateIds = Object.keys(JSON.parse(process.env.MSG91_SMS_TEMPLATE_IDS || "{}"));
  } catch {}
  return (
    <MmcSettingsForm
      initial={settings}
      env={{
        authKey: Boolean(process.env.MSG91_AUTH_KEY),
        sender: Boolean(process.env.MSG91_SENDER_ID),
        whatsapp: Boolean(process.env.MSG91_WHATSAPP_NUMBER),
        templateIds,
      }}
    />
  );
}
