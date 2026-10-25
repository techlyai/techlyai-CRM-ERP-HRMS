export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { context } from "@/lib/database";
import { downloadFieldFile } from "@/lib/storage";
import { fileResponse } from "@/lib/file-response";

/** Field photos and report files, served only to authorized, signed-in viewers. */
export async function GET(req: NextRequest, { params }: { params: { kind: string; id: string } }) {
  try {
    const { token } = await context();
    const kind = z.enum(["photo", "report"]).parse(params.kind);
    const file = await downloadFieldFile(token, kind, z.string().uuid().parse(params.id));
    return fileResponse(req, file);
  } catch {
    return NextResponse.json({ error: "File unavailable or access denied" }, { status: 403 });
  }
}
