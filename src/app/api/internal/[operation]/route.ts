import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { requireGateway } from "@/lib/gateway";
import { transaction } from "@/lib/postgres";
import { sessionProfile } from "@/lib/auth";
import { Database } from "@/lib/database";
import { actionHandlers } from "@/lib/action-handlers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: { operation: string } }) {
  try { requireGateway(req.headers); }
  catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  try {
    // Only the explicit action registry may run mutations. SQL remains server-side.
    if (params.operation === "action") {
      const input = z.object({ name: z.string(), args: z.array(z.unknown()).max(8) }).strict().parse(await req.json());
      if (!Object.hasOwn(actionHandlers, input.name))
        return NextResponse.json({ error: "Unknown action" }, { status: 404 });
      const fn = actionHandlers[input.name as keyof typeof actionHandlers] as (...args: any[]) => Promise<unknown>;
      return NextResponse.json({ result: await fn(...input.args) });
    }
    const token = cookies().get("techly-session")?.value || "";
    const profile = await transaction(c => sessionProfile(c, token));
    if (!profile) return NextResponse.json({ redirect: "/login" }, { status: 401 });
    if (params.operation === "session") return NextResponse.json({ result: profile });
    if (profile.must_change_password)
      return NextResponse.json({ redirect: "/change-password" }, { status: 403 });
    const db = new Database(token);
    if (params.operation === "select") {
      const input = z.object({ table: z.string().max(100), query: z.string().max(20000) }).strict().parse(await req.json());
      return NextResponse.json({ result: await db.select(input.table, input.query) });
    }
    if (params.operation === "rpc") {
      const input = z.object({ name: z.enum(["dashboard_stats", "purchase_catalog"]), args: z.object({}).strict() }).strict().parse(await req.json());
      return NextResponse.json({ result: await db.rpc(input.name, input.args) });
    }
    return NextResponse.json({ error: "Unknown operation" }, { status: 404 });
  } catch (error) {
    const digest = (error as { digest?: string })?.digest;
    if (digest?.startsWith("NEXT_REDIRECT;")) {
      const location = digest.split(";")[2];
      if (location === "/login" || location === "/change-password")
        return NextResponse.json({ redirect: location });
    }
    console.error("Internal API request failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ error: "Request failed. Check your access and submitted values." }, { status: 400 });
  }
}
