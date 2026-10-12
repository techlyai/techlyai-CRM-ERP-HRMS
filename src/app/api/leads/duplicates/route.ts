export const dynamic = "force-dynamic";
import { NextResponse, type NextRequest } from "next/server";
import { context } from "@/lib/database";
import { normalizePhone } from "@/lib/domain";
export async function GET(req: NextRequest) {
  try {
    const { db } = await context();
    const phone = normalizePhone(req.nextUrl.searchParams.get("phone") || "");
    const rows = await db.select<{ id: string }>(
      "records",
      "select=id&module=eq.leads&data->>phone=eq." +
        encodeURIComponent(phone) +
        "&limit=5",
    );
    return NextResponse.json({
      duplicates: rows.length,
      ids: rows.map((r) => r.id),
    });
  } catch {
    return NextResponse.json({ duplicates: 0 });
  }
}
