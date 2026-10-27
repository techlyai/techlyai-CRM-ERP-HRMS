import { NextResponse, type NextRequest } from "next/server";
import { serviceDB } from "@/lib/database";
import { receiptPdf, type ReceiptData } from "@/lib/mmc-receipt";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public receipt link sent to the client after a payment. The token is 64 random hex characters. */
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  if (!/^[0-9a-f]{64}$/.test(params.token)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const db = serviceDB();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!(await db.rpc<boolean>("api_rate_limit", { p_key: "receipt:" + ip, p_limit: 30, p_window_seconds: 60 })))
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const r = await db.rpc<ReceiptData | null>("mmc_receipt", { p_token: params.token });
  if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(Buffer.from(receiptPdf(r)), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="receipt-MMC-${String(r.payment.receipt_no).padStart(5, "0")}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
