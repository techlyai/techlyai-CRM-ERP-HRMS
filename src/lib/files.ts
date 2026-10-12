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
export function validateFile(
  name: string,
  mime: string,
  size: number,
  sound = false,
) {
  if (
    !fileTypes[mime] ||
    !fileTypes[mime].includes(name.toLowerCase().split(".").pop() || "")
  )
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
