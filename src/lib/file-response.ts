import { NextResponse, type NextRequest } from "next/server";
import type { StoredFile } from "./storage";
/** In-memory files may omit size; chunked files must provide it. */
type Sendable = Omit<StoredFile, "size"> & { size?: number };

const STREAM_STEP = 65536;
/** Streams bytes [start, end] of a stored file, small or chunked. */
function byteStream(file: Sendable, start: number, end: number) {
  let offset = start;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (offset > end) {
          controller.close();
          return;
        }
        if (file.content) {
          const next = Math.min(offset + STREAM_STEP, end + 1);
          controller.enqueue(new Uint8Array(file.content.subarray(offset, next)));
          offset = next;
          return;
        }
        // Chunked: fetch only the chunk that holds the next byte.
        const size = file.chunkSize!;
        const part = Math.floor(offset / size);
        const chunk = await file.readChunk!(part);
        const from = offset - part * size;
        const to = Math.min(chunk.length, end - part * size + 1);
        controller.enqueue(new Uint8Array(chunk.subarray(from, to)));
        offset = part * size + to;
      } catch (e) {
        controller.error(e);
      }
    },
  });
}
// Support private previews, audio seeking and large downloads with HTTP byte ranges.
export function fileResponse(
  req: NextRequest,
  file: Sendable,
  sound = false,
) {
  const range = req.headers.get("range");
  const total = file.content ? file.content.length : Number(file.size);
  let start = 0,
    end = total - 1;
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match)
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${total}` },
      });
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : total - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= total
    )
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${total}` },
      });
    end = Math.min(end, total - 1);
  }
  return new NextResponse(byteStream(file, start, end), {
    status: range ? 206 : 200,
    headers: {
      "Content-Type": file.mime,
      "Content-Length": String(end - start + 1),
      "Content-Disposition": `${sound || /^(image\/|application\/pdf$)/.test(file.mime) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`,
      "Cache-Control": "private, no-store",
      "Accept-Ranges": "bytes",
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${total}` } : {}),
    },
  });
}
