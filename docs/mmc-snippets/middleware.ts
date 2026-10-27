// Orbit MMC site switch — Next.js middleware. Save as middleware.ts in the project root
// (next to package.json, or in src/ if the app uses src/). Set in the site's environment (Dokploy):
//   ORBIT_SITE_KEY=sk_live_...        ORBIT_STATUS_URL=https://your-orbit-domain.example/api/site-status
// Caches 5 minutes, 3-second timeout, fails open (keeps the last known status if Orbit is down).
import { NextResponse, type NextRequest } from "next/server";

const ENDPOINT = process.env.ORBIT_STATUS_URL || "https://your-orbit-domain.example/api/site-status";
const SITE_KEY = process.env.ORBIT_SITE_KEY || "";
const CACHE_MS = 5 * 60 * 1000;
const PAGE = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex\"><title>Site Suspended</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f5fb;color:#1d1b2c}main{max-width:440px;margin:24px;padding:36px 28px;background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(40,20,90,.08);text-align:center}h1{margin:0 0 12px;font-size:24px}p{line-height:1.6;color:#555}a{color:#552daa}</style></head><body><main><h1>Site Suspended</h1><p>Site suspended due to pending maintenance payment. Please contact admin.</p><p></p></main></body></html>";
let state = { active: true, at: 0 };

async function refresh() {
  try {
    const res = await fetch(ENDPOINT, {
      headers: { "x-site-key": SITE_KEY, accept: "application/json" },
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    state = res.ok && json && typeof json.active === "boolean" ? { active: json.active, at: Date.now() } : { ...state, at: Date.now() };
  } catch {
    state = { ...state, at: Date.now() }; // fail open
  }
}

export async function middleware(_req: NextRequest) {
  if (!SITE_KEY) return NextResponse.next(); // not configured: stay online
  if (Date.now() - state.at > CACHE_MS) await refresh();
  if (state.active) return NextResponse.next();
  return new NextResponse(PAGE, {
    status: 503,
    headers: { "content-type": "text/html; charset=utf-8", "retry-after": "3600", "cache-control": "no-store" },
  });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"] };
