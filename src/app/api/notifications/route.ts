export const dynamic = "force-dynamic";
import { context } from "@/lib/database";
import { NextResponse } from "next/server";
export async function GET() {
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
