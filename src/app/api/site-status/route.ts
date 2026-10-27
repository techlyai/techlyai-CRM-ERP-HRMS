import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { serviceDB } from "@/lib/database";
import { domainAllowed, hostOf } from "@/lib/mmc";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public site switch for MMC clients. Header: x-site-key: sk_live_…
 * 200 { active, message, checked_at } · 401 bad key · 403 wrong domain · 429 over 60/min.
 * Browser requests (JS snippet) get CORS only for the client's allowed domain.
 */
const LIMIT = 60;
function reply(body: unknown, status: number, origin?: string) {
  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("X-Content-Type-Options", "nosniff");
  if (origin) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Access-Control-Allow-Headers", "x-site-key");
    res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.headers.set("Access-Control-Max-Age", "600");
    res.headers.set("Vary", "Origin");
  }
  return res;
}
export function OPTIONS(req: NextRequest) {
  const origin = req.headers.get("origin") || undefined;
  // The key is checked on the real request; preflight only advertises what is allowed.
  return reply(null, 204, origin);
}
export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin") || undefined;
  const proto = req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "");
  if (process.env.NODE_ENV === "production" && proto !== "https" && process.env.MMC_ALLOW_HTTP !== "true")
    return reply({ error: "HTTPS required" }, 400);
  const key = (req.headers.get("x-site-key") || "").trim();
  if (!/^sk_live_[A-Za-z0-9_-]{43}$/.test(key)) return reply({ error: "Invalid site key" }, 401);
  const hash = createHash("sha256").update(key).digest("hex");
  const db = serviceDB();
  try {
    if (!(await db.rpc<boolean>("api_rate_limit", { p_key: "site-status:" + hash, p_limit: LIMIT, p_window_seconds: 60 })))
      return reply({ error: "Too many requests" }, 429);
    const originHost = hostOf(origin || req.headers.get("referer"));
    const r = await db.rpc<{ client_id: string; active: boolean; message: string; allowed_domain: string } | null>("mmc_site_check", {
      p_hash: hash,
      p_origin: originHost || null,
    });
    if (!r) return reply({ error: "Invalid site key" }, 401);
    // Server-side snippets send no Origin; browsers always do, so a foreign page cannot reuse the key.
    if (originHost && !domainAllowed(r.allowed_domain, originHost)) return reply({ error: "Domain not allowed for this key" }, 403);
    return reply({ active: r.active, message: r.message, checked_at: new Date().toISOString() }, 200, origin && originHost ? origin : undefined);
  } catch (e) {
    console.error(JSON.stringify({ event: "site_status_error", message: e instanceof Error ? e.message : "Unknown" }));
    return reply({ error: "Status unavailable" }, 503);
  }
}
