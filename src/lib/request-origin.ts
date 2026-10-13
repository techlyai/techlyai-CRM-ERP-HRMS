import type { NextRequest } from "next/server";

// Dokploy terminates HTTPS before forwarding to Next.js over the container network.
// Compare against the configured public origin, never an untrusted forwarded header.
export function requireSameOrigin(req: NextRequest) {
  const origin = new URL(process.env.APP_URL || req.nextUrl.origin).origin;
  if (req.headers.get("origin") !== origin) throw Error("Invalid request origin");
}
