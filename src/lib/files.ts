export const fileTypes: Record<string, string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    "docx",
  ],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "text/csv": ["csv"],
  "audio/mpeg": ["mp3"],
  "audio/wav": ["wav"],
};
export type FileKind = "general" | "joining";
/** Files above this size are stored in chunks and streamed, never held whole in memory. */
export const INLINE_LIMIT = 20 * 1024 * 1024;

/**
 * Optional ceiling for joining-document PDFs in megabytes. Unset or 0 means no
 * application limit; disk space and database backups become the practical limit.
 */
export function joiningLimitBytes(env = process.env.MAX_JOINING_DOCUMENT_MB) {
  const mb = Number(env || 0);
  return Number.isFinite(mb) && mb > 0 ? Math.floor(mb * 1024 * 1024) : null;
}

export function validateFile(
  name: string,
  mime: string,
  size: number,
  sound = false,
  kind: FileKind = "general",
) {
  const extension = name.toLowerCase().split(".").pop() || "";
  if (kind === "joining") {
    if (mime !== "application/pdf" || extension !== "pdf")
      throw Error("Joining documents must be uploaded as a single PDF file.");
    if (!Number.isSafeInteger(size) || size <= 0)
      throw Error("The PDF appears to be empty.");
    const limit = joiningLimitBytes();
    if (limit && size > limit)
      throw Error(
        `This PDF is larger than the ${Math.round(limit / 1048576)} MB limit set by your administrator.`,
      );
    return;
  }
  if (!fileTypes[mime] || !fileTypes[mime].includes(extension))
    throw Error("Use JPG, PNG, WebP, PDF, DOCX, XLSX, CSV, MP3, or WAV files.");
  if (sound && !mime.startsWith("audio/"))
    throw Error("Choose an MP3 or WAV sound");
  if (size <= 0 || size > (sound ? 5 : 20) * 1024 * 1024)
    throw Error(`File limit is ${sound ? 5 : 20} MB.`);
}
export function validMagic(bytes: Uint8Array, mime: string) {
  const s = Buffer.from(bytes).subarray(0, 16).toString("latin1");
  if (mime === "image/jpeg")
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/png") return bytes[0] === 137 && s.slice(1, 4) === "PNG";
  if (mime === "image/webp")
    return s.startsWith("RIFF") && s.slice(8, 12) === "WEBP";
  if (mime === "application/pdf") return s.startsWith("%PDF-");
  if (mime.includes("officedocument")) return s.startsWith("PK");
  if (mime === "audio/mpeg")
    return (
      s.startsWith("ID3") || (bytes[0] === 255 && (bytes[1] & 224) === 224)
    );
  if (mime === "audio/wav")
    return s.startsWith("RIFF") && s.slice(8, 12) === "WAVE";
  if (mime === "text/csv") return !bytes.includes(0);
  return false;
}
/** A complete PDF ends with an %%EOF marker near the end of the file. */
export function pdfHasEnd(tail: Uint8Array) {
  return Buffer.from(tail).subarray(-2048).toString("latin1").includes("%%EOF");
}
