/**
 * Ready-to-copy client integrations for /api/site-status. Every snippet caches the status for
 * 5 minutes, gives up after 3 seconds, and FAILS OPEN: if the admin server cannot be reached it
 * keeps the last known status (or stays online), so an outage here never takes every client down.
 *
 * Server snippets read ORBIT_SITE_KEY and ORBIT_STATUS_URL from the environment (e.g. Dokploy →
 * Environment), so the code is identical for every client; the values written into the code are
 * only fallbacks. With no key at all the site simply stays online.
 */
export type SnippetInput = {
  endpoint: string;
  siteKey: string;
  title: string;
  message: string;
  contact: { name: string; phone: string; email: string; whatsapp: string };
};
export const KEY_PLACEHOLDER = "YOUR_SITE_KEY";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const single = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/** The static "Site Suspended" page every snippet serves with HTTP 503. */
export function suspendedPage(i: SnippetInput): string {
  const c = i.contact;
  const lines = [
    c.name && `<strong>${esc(c.name)}</strong>`,
    c.phone && `Phone: <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>`,
    c.whatsapp && `WhatsApp: <a href="https://wa.me/${esc(c.whatsapp.replace(/\D/g, ""))}">${esc(c.whatsapp)}</a>`,
    c.email && `Email: <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`,
  ].filter(Boolean);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(i.title)}</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f5fb;color:#1d1b2c}main{max-width:440px;margin:24px;padding:36px 28px;background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(40,20,90,.08);text-align:center}h1{margin:0 0 12px;font-size:24px}p{line-height:1.6;color:#555}a{color:#552daa}</style></head><body><main><h1>${esc(i.title)}</h1><p>${esc(i.message)}</p><p>${lines.join("<br>")}</p></main></body></html>`;
}

export function phpSnippet(i: SnippetInput): string {
  return `<?php
/**
 * Orbit MMC site switch — put this at the top of index.php, or save it as
 * wp-content/mu-plugins/orbit-site-status.php on WordPress.
 * Caches for 5 minutes, times out after 3 seconds, keeps the last known status on errors.
 */
if (!function_exists('orbit_site_status_check')) {
  function orbit_site_status_check() {
    if (PHP_SAPI === 'cli') return;
    $env = function ($name, $fallback) {
      $v = getenv($name);
      if ($v === false || $v === '') $v = $_SERVER[$name] ?? $_ENV[$name] ?? '';
      return $v !== '' ? $v : $fallback;
    };
    $endpoint = $env('ORBIT_STATUS_URL', '${single(i.endpoint)}');
    $key = $env('ORBIT_SITE_KEY', '${single(i.siteKey === KEY_PLACEHOLDER ? "" : i.siteKey)}');
    if ($key === '') return; // not configured: stay online
    $cache = sys_get_temp_dir() . '/orbit-site-status-' . md5($key) . '.json';
    $state = is_readable($cache) ? json_decode((string) @file_get_contents($cache), true) : null;
    if (!is_array($state) || (time() - (int) ($state['at'] ?? 0)) > 300) {
      $ctx = stream_context_create(['http' => [
        'method' => 'GET', 'timeout' => 3, 'ignore_errors' => true,
        'header' => "x-site-key: $key\\r\\nAccept: application/json\\r\\n",
      ]]);
      $body = @file_get_contents($endpoint, false, $ctx);
      $code = 0;
      if (isset($http_response_header[0]) && preg_match('/\\s(\\d{3})\\s/', $http_response_header[0], $m)) $code = (int) $m[1];
      $json = $body ? json_decode($body, true) : null;
      if ($code === 200 && is_array($json) && array_key_exists('active', $json)) {
        $state = ['active' => (bool) $json['active'], 'at' => time()];
      } else {
        // Fail open: keep the last known status (or stay online) and retry in 5 minutes.
        $state = ['active' => is_array($state) ? (bool) ($state['active'] ?? true) : true, 'at' => time()];
      }
      @file_put_contents($cache, json_encode($state), LOCK_EX);
    }
    if (empty($state['active'])) {
      http_response_code(503);
      header('Retry-After: 3600');
      header('Content-Type: text/html; charset=utf-8');
      header('Cache-Control: no-store');
      echo '${single(suspendedPage(i))}';
      exit;
    }
  }
  if (!(defined('WP_CLI') && WP_CLI) && !(function_exists('is_admin') && is_admin())) orbit_site_status_check();
}
`;
}

export function nodeSnippet(i: SnippetInput): string {
  return `// Orbit MMC site switch — Express middleware (Node 18+ for global fetch).
// Usage: const siteStatus = require('./orbit-site-status'); app.use(siteStatus);
// Set ORBIT_SITE_KEY (and optionally ORBIT_STATUS_URL) in the site's environment, e.g. Dokploy.
const ENDPOINT = process.env.ORBIT_STATUS_URL || ${JSON.stringify(i.endpoint)};
const SITE_KEY = process.env.ORBIT_SITE_KEY || ${JSON.stringify(i.siteKey === KEY_PLACEHOLDER ? "" : i.siteKey)};
const CACHE_MS = 5 * 60 * 1000;
const PAGE = ${JSON.stringify(suspendedPage(i))};
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
`;
}

export function htmlSnippet(i: SnippetInput): string {
  return `<!-- Orbit MMC site switch — static HTML / React fallback.
     Paste as the first script in <head>. Browser-only checks are easy to bypass
     (anyone can disable JavaScript); use the PHP or Node version when you can.
     The site key is visible in the page source, so set "Allowed domain" for this client. -->
<script>
(function () {
  var ENDPOINT = ${JSON.stringify(i.endpoint)};
  var KEY = ${JSON.stringify(i.siteKey)};
  var CACHE = 'orbit-site-status';
  var PAGE = ${JSON.stringify(suspendedPage(i))};
  function show(active) {
    if (active) return;
    document.open(); document.write(PAGE); document.close();
  }
  var cached = null;
  try { cached = JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch (e) {}
  if (cached && Date.now() - cached.at < 300000) return show(cached.active);
  if (cached) show(cached.active);
  var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 3000);
  fetch(ENDPOINT, { headers: { 'x-site-key': KEY }, signal: ctrl && ctrl.signal })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j || typeof j.active !== 'boolean') return; // fail open
      try { localStorage.setItem(CACHE, JSON.stringify({ active: j.active, at: Date.now() })); } catch (e) {}
      if (cached && !cached.active && j.active) location.reload();
      else if (!cached || cached.active !== j.active) show(j.active);
    })
    .catch(function () {}) // fail open: keep last known status
    .then(function () { clearTimeout(timer); });
})();
</script>
`;
}

/** Next.js (App or Pages router): save as middleware.ts in the project root (or src/). */
export function nextSnippet(i: SnippetInput): string {
  return `// Orbit MMC site switch — Next.js middleware. Save as middleware.ts in the project root
// (next to package.json, or in src/ if the app uses src/). Set in the site's environment (Dokploy):
//   ORBIT_SITE_KEY=sk_live_...        ORBIT_STATUS_URL=${i.endpoint}
// Caches 5 minutes, 3-second timeout, fails open (keeps the last known status if Orbit is down).
import { NextResponse, type NextRequest } from "next/server";

const ENDPOINT = process.env.ORBIT_STATUS_URL || ${JSON.stringify(i.endpoint)};
const SITE_KEY = process.env.ORBIT_SITE_KEY || ${JSON.stringify(i.siteKey === KEY_PLACEHOLDER ? "" : i.siteKey)};
const CACHE_MS = 5 * 60 * 1000;
const PAGE = ${JSON.stringify(suspendedPage(i))};
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
`;
}
