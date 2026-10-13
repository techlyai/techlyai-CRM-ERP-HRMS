export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextResponse, type NextRequest } from "next/server";
import { context } from "@/lib/database";
import {
  startUpload,
  saveUploadPart,
  finishUpload,
  CHUNK_SIZE,
} from "@/lib/storage";
import { z } from "zod";
import { requireSameOrigin } from "@/lib/request-origin";
function origin(req: NextRequest) {
  requireSameOrigin(req);
}
function error(e: unknown) {
  return NextResponse.json(
    { error: e instanceof Error ? e.message : "Upload failed" },
    { status: 400 },
  );
}
export async function POST(req: NextRequest) {
  try {
    origin(req);
    const { token } = await context();
    const info = z
      .object({
        record: z.string().uuid().optional(),
        sound: z.boolean().optional(),
        name: z.string().min(1).max(255),
        mime: z.string().max(255),
        size: z.number().int().positive(),
      })
      .strict()
      .parse(await req.json());
    return NextResponse.json(await startUpload(token, info));
  } catch (e) {
    return error(e);
  }
}
export async function PUT(req: NextRequest) {
  try {
    origin(req);
    const { token } = await context();
    const id = req.nextUrl.searchParams.get("upload");
    if (id) {
      z.string().uuid().parse(id);
      const part = z.coerce
        .number()
        .int()
        .min(0)
        .max(6)
        .parse(req.nextUrl.searchParams.get("part"));
      const reader = req.body?.getReader();
      if (!reader) throw Error("Missing file chunk");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > CHUNK_SIZE) {
            await reader.cancel();
            throw Error("Chunk too large");
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      await saveUploadPart(token, id, part, Buffer.concat(chunks));
      return NextResponse.json({ ok: true });
    }
    const input = z
      .object({ id: z.string().uuid() })
      .strict()
      .parse(await req.json());
    return NextResponse.json({
      ok: true,
      ...(await finishUpload(token, input.id)),
    });
  } catch (e) {
    return error(e);
  }
}
