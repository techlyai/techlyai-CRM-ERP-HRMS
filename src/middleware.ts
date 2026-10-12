import { NextRequest, NextResponse } from "next/server";
export function middleware(req: NextRequest) {
  const key = process.env.TECHLY_INTERNAL_API_KEY;
  if (req.nextUrl.pathname !== "/api/health" && req.nextUrl.pathname !== "/api/cron/tick" &&
      (!key || key.length < 32 || req.headers.get("x-techly-service-key") !== key))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = { matcher: ["/:path*"] };
