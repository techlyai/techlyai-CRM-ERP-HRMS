import { NextResponse, type NextRequest } from "next/server";
// Support private previews and audio seeking with standard HTTP byte ranges.
export function fileResponse(
  req: NextRequest,
  file: { name: string; mime: string; content: Buffer },
  sound = false,
) {
  const range = req.headers.get("range");
  const total = file.content.length;
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
  const bytes = file.content.subarray(start, end + 1);
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const next = Math.min(offset + 65536, bytes.length);
      controller.enqueue(new Uint8Array(bytes.subarray(offset, next)));
      offset = next;
    },
  });
  return new NextResponse(stream, {
    status: range ? 206 : 200,
    headers: {
      "Content-Type": file.mime,
      ...(range ? { "Content-Length": String(bytes.length) } : {}),
      "Content-Disposition": `${sound || /^(image\/|application\/pdf$)/.test(file.mime) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`,
      "Cache-Control": "private, no-store",
      "Accept-Ranges": "bytes",
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${total}` } : {}),
    },
  });
}
