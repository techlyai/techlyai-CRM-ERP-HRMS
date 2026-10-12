import { requireGateway } from "@/lib/gateway";
import { headers as requestHeaders } from "next/headers";
export const dynamic = "force-dynamic";
import { context } from "@/lib/database";
import { NextResponse } from "next/server";
export async function GET() {
  try { requireGateway(requestHeaders()); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  const { db } = await context();
  const [items, unread] = await Promise.all([
    db.select("notifications", "select=*&order=created_at.desc&limit=100"),
    db.select("notifications", "select=id&read_at=is.null&limit=100"),
  ]);
  return NextResponse.json(items, {
    headers: {
      "Cache-Control": "private, no-store",
      "X-Techly-Unread": String(unread.length),
    },
  });
}
