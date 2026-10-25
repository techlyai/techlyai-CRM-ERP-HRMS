/** Documents an employee's combined joining PDF is expected to contain. Browser-safe. */
export const joiningDocuments = [
  "Joining letter",
  "Aadhaar card",
  "PAN card",
  "Bank passbook",
  "10th certificate",
  "12th certificate",
  "Course completion certificate",
  "Experience certificates",
  "Resume",
  "Passport size photo",
] as const;
export type JoiningDocument = (typeof joiningDocuments)[number];

/** Keeps only known document names, in the canonical order, without duplicates. */
export function normalizeJoiningDocuments(value: unknown): JoiningDocument[] {
  const list = Array.isArray(value) ? value.map(String) : [];
  return joiningDocuments.filter((d) => list.includes(d));
}

/** Human-readable size, e.g. 1.4 MB. */
export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  return `${n >= 10 || u === 0 ? Math.round(n) : n.toFixed(1)} ${units[u]}`;
}
