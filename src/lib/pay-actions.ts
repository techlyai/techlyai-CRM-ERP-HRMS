"use server";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { serviceDB } from "./database";

/** Public: a client reports a UPI payment from their /pay link. An admin must approve it. */
export async function submitPaymentClaim(input: { token: string; amount: number; utr: string; note?: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const v = z
      .object({
        token: z.string().regex(/^[0-9a-f]{64}$/),
        amount: z.coerce.number().positive("Enter the amount you paid").max(10_000_000),
        utr: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9]{6,35}$/, "Enter the UPI transaction ID (UTR / reference number) shown in your UPI app"),
        note: z.string().trim().max(300).default(""),
      })
      .strict()
      .parse(input);
    const db = serviceDB();
    const ip = headers().get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const key = createHash("sha256").update("pay-claim:" + ip).digest("hex");
    if (!(await db.rpc<boolean>("api_rate_limit", { p_key: key, p_limit: 10, p_window_seconds: 3600 })))
      return { ok: false, error: "Too many attempts. Please try again later or contact us." };
    await db.rpc("mmc_submit_claim", { p_token: v.token, p_amount: v.amount, p_utr: v.utr, p_note: v.note });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof z.ZodError ? e.errors[0]?.message || "Check the details" : e instanceof Error ? e.message : "Could not submit",
    };
  }
}
