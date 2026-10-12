export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextResponse, type NextRequest } from "next/server";
import { context } from "@/lib/database";
import { downloadFile } from "@/lib/storage";
import { fileResponse } from "@/lib/file-response";
import { z } from "zod";
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const { token } = await context();
    const file = await downloadFile(token, z.string().uuid().parse(params.id));
    return fileResponse(req, file);
  } catch {
    return NextResponse.json(
      { error: "File unavailable or access denied" },
      { status: 403 },
    );
  }
}
