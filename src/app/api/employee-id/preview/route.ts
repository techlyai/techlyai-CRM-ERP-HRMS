export const dynamic = "force-dynamic";
import { NextResponse, type NextRequest } from "next/server";
import { context } from "@/lib/database";

/**
 * GET /api/employee-id/preview?department=Sales
 * Returns the next employee ID the server would assign for that department
 * without consuming it, plus whether the signed-in person may type an ID by
 * hand (Admins, when manual assignment is allowed in Settings → Employee IDs).
 */
export async function GET(req: NextRequest) {
  try {
    const { db, profile } = await context();
    const department =
      (req.nextUrl.searchParams.get("department") || "").trim().slice(0, 100) ||
      null;
    const id = await db.rpc<string>("employee_id_preview", {
      p_department: department,
    });
    const admin = profile.role === "super_admin";
    let manual = false;
    if (admin) {
      const rows = await db.select<{ data: { allow_manual?: boolean } }>(
        "employee_id_settings",
        "select=data&id=eq.1",
      );
      manual = rows[0]?.data.allow_manual !== false;
    }
    return NextResponse.json({ id, admin, manual });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed";
    if (message === "NEXT_REDIRECT")
      return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
    if (/permission denied/i.test(message))
      return NextResponse.json(
        { error: "You do not have permission to create employee records" },
        { status: 403 },
      );
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
