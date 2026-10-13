export const dynamic = "force-dynamic";
import { NextResponse, type NextRequest } from "next/server";
import { context } from "@/lib/database";
import { z } from "zod";
import { requireSameOrigin } from "@/lib/request-origin";
export async function POST(req: NextRequest) {
  try {
    requireSameOrigin(req);
    const { db, profile } = await context();
    if (profile.role !== "super_admin") throw Error("Permission denied");
    const p = z
      .object({
        type: z.string().max(100),
        allocation: z.number().min(0).max(365),
        accrual: z.enum(["annual", "monthly", "none"]),
        carry_forward: z.number().min(0).max(365),
        eligibility_days: z.number().int().min(0).max(3650),
        paid: z.boolean(),
      })
      .parse(await req.json());
    await db.rpc("set_leave_policy", {
      p_type: p.type,
      p_allocation: p.allocation,
      p_accrual: p.accrual,
      p_carry: p.carry_forward,
      p_eligibility: p.eligibility_days,
      p_paid: p.paid,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Update failed" },
      { status: 400 },
    );
  }
}
