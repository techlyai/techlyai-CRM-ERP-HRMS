export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextResponse, type NextRequest } from "next/server";
import { context } from "@/lib/database";
import { downloadFile } from "@/lib/storage";
import { fileResponse } from "@/lib/file-response";
export async function GET(req: NextRequest) {
  try {
    const { token } = await context();
    return fileResponse(
      req,
      await downloadFile(
        token,
        req.nextUrl.searchParams.get("path") || "",
        true,
      ),
      true,
    );
  } catch {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
}
