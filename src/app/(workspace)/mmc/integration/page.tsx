import Link from "next/link";
import { context } from "@/lib/database";
import { listClients } from "@/lib/mmc-data";
import { lastSeen } from "@/lib/mmc";
export const metadata = { title: "MMC integration guide" };
export const dynamic = "force-dynamic";

export default async function MmcIntegrationPage() {
  const { db } = await context();
  const clients = await listClients(db);
  const base = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
  const steps = [
    ["Create the client", "Clients → Add client. Copy the site key shown once (sk_live_…). Lost it? Open the client and Regenerate key."],
    ["Pick a snippet", "On the client's page choose PHP / WordPress, Node / Express or Static HTML. Snippets copied right after creating or regenerating a key have it pre-filled."],
    ["Install it", "PHP: top of index.php, or save as wp-content/mu-plugins/orbit-site-status.php. Node: app.use(require('./orbit-site-status')) before your routes. HTML: first script inside <head>."],
    ["Open the website once", "The snippet calls the status API and the client's “Last seen” changes from Never to Just now."],
    ["Test connection", "On the client's page press Test connection: it loads the website and confirms the snippet checked in within the last 10 minutes."],
    ["Test the switch", "Turn the site OFF. Within 5 minutes (snippet cache) the site returns HTTP 503 with the Site Suspended page. Turn it ON again to restore it."],
  ];
  return (
    <div className="space-y-6">
      <section className="panel p-5">
        <h2 className="section-title">How the switch works</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Each client website asks Orbit whether it should be online. The answer is cached on the client for 5 minutes and the request gives up after
          3 seconds. If Orbit cannot be reached, the website keeps its last known status (<strong>fail-open</strong>), so an outage here never takes all
          clients down at once. When the site is OFF, visitors get HTTP 503 and the Site Suspended page with your contact details from MMC Settings.
        </p>
        <ol className="mt-5 space-y-3">
          {steps.map(([t, d], i) => (
            <li key={t} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{i + 1}</span>
              <div>
                <div className="text-sm font-medium">{t}</div>
                <div className="text-xs text-muted-foreground">{d}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section className="panel p-5">
        <h2 className="section-title">API reference</h2>
        <pre className="scroll-thin mt-3 overflow-auto rounded-lg bg-muted/50 p-3 text-[11px] leading-5"><code>{`GET ${base}/api/site-status
x-site-key: sk_live_…

200 {"active":true,"message":"","checked_at":"2026-10-26T10:00:00.000Z"}
200 {"active":false,"message":"Site suspended due to pending maintenance payment. Please contact admin.","checked_at":"…"}
401 invalid or missing key · 403 browser Origin is not the client's allowed domain · 429 more than 60 requests/minute per key

Test from a terminal:
curl -s -H "x-site-key: sk_live_…" ${base}/api/site-status`}</code></pre>
        <p className="mt-3 text-xs text-muted-foreground">
          Production requires HTTPS. Browser calls are accepted only from the client&apos;s allowed domain (or its subdomains); server snippets send no Origin and are matched by key.
        </p>
      </section>
      <section className="panel">
        <h2 className="section-title p-4">Installation status</h2>
        {clients.length === 0 ? (
          <p className="px-4 pb-6 text-sm text-muted-foreground">No clients yet.</p>
        ) : (
          <ul className="divide-y divide-border text-xs">
            {clients.map((c) => (
              <li key={c.id} className="flex items-center gap-3 p-3">
                <Link href={`/mmc/clients/${c.id}`} className="flex-1 font-medium hover:text-primary">{c.name}</Link>
                <span className="text-muted-foreground">{c.allowed_domain || "any domain"}</span>
                <span className={c.last_checked_at && Date.now() - Date.parse(c.last_checked_at) < 86400000 ? "text-success" : "text-danger"}>{lastSeen(c.last_checked_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
