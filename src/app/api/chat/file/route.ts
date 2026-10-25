export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { context } from "@/lib/database";
import { downloadConversationFile } from "@/lib/storage";
import { fileResponse } from "@/lib/file-response";
/** GET /api/chat/file?path=<uploader>/chat/<conversation>/<file>.<ext> */
export async function GET(req: NextRequest) {
  try {
    const { token } = await context();
    const path = z
      .string()
      .min(1)
      .max(300)
      .parse(req.nextUrl.searchParams.get("path"));
    const file = await downloadConversationFile(token, path);
    return fileResponse(req, file);
  } catch (e) {
    if (
      e instanceof Error &&
      (e.message === "NEXT_REDIRECT" ||
        (e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT"))
    )
      throw e;
    return NextResponse.json(
      { error: "File unavailable or access denied" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
