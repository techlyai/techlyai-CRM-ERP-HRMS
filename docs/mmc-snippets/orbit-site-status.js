// Orbit MMC site switch — Express middleware (Node 18+ for global fetch).
// Usage: const siteStatus = require('./orbit-site-status'); app.use(siteStatus);
// Set ORBIT_SITE_KEY (and optionally ORBIT_STATUS_URL) in the site's environment, e.g. Dokploy.
const ENDPOINT = process.env.ORBIT_STATUS_URL || "https://your-orbit-domain.example/api/site-status";
const SITE_KEY = process.env.ORBIT_SITE_KEY || "";
const CACHE_MS = 5 * 60 * 1000;
const PAGE = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex\"><title>Site Suspended</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f5fb;color:#1d1b2c}main{max-width:440px;margin:24px;padding:36px 28px;background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(40,20,90,.08);text-align:center}h1{margin:0 0 12px;font-size:24px}p{line-height:1.6;color:#555}a{color:#552daa}</style></head><body><main><h1>Site Suspended</h1><p>Site suspended due to pending maintenance payment. Please contact admin.</p><p></p></main></body></html>";
let state = { active: true, at: 0 };
let pending = null;

async function refresh() {
  try {
    const res = await fetch(ENDPOINT, {
      headers: { 'x-site-key': SITE_KEY, accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
    });
    const json = await res.json().catch(() => null);
    if (res.ok && json && typeof json.active === 'boolean') state = { active: json.active, at: Date.now() };
    else state = { ...state, at: Date.now() }; // fail open: keep last known status
  } catch {
    state = { ...state, at: Date.now() }; // fail open: admin server unreachable
  }
}

module.exports = async function orbitSiteStatus(req, res, next) {
  if (!SITE_KEY) return next(); // not configured: stay online
  if (Date.now() - state.at > CACHE_MS) {
    pending = pending || refresh().finally(() => { pending = null; });
    await pending;
  }
  if (state.active) return next();
  res.status(503).set({ 'Retry-After': '3600', 'Cache-Control': 'no-store' }).type('html').send(PAGE);
};
