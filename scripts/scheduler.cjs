// Single worker; database scheduler deduplication also protects against retries.
async function tick() {
  try {
    const response = await fetch("http://backend:3000/api/cron/tick", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      signal: AbortSignal.timeout(55000),
    });
    if (!response.ok) console.error(`Scheduler request failed: HTTP ${response.status}`);
  } catch { console.error("Scheduler connection failed; retrying next minute"); }
}
async function main() {
  if (!process.env.CRON_SECRET) throw Error("CRON_SECRET is required");
  for (;;) {
    await tick();
    await new Promise(resolve => setTimeout(resolve, 60000));
  }
}
main().catch(() => { console.error("Scheduler configuration error"); process.exitCode = 1; });
