export function normalizePhone(
  input: string,
  country = process.env.NEXT_PUBLIC_DEFAULT_COUNTRY_CODE || "91",
) {
  const cleaned = input.trim().replace(/[\s()-]/g, "");
  if (!/^\+?\d+$/.test(cleaned)) throw Error("Enter a valid phone number");
  let digits = cleaned.replace(/^\+/, "");
  if (digits.length === 10 && !cleaned.startsWith("+"))
    digits = country + digits;
  if (digits.length < 8 || digits.length > 15)
    throw Error("Enter a phone number with country code");
  return "+" + digits;
}
export function localDate(now = new Date(), timezone = "Asia/Kolkata") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function nextRenewal(
  expiry: string,
  frequency: string,
  customDays?: number,
) {
  const d = new Date(expiry + "T12:00:00Z");
  if (isNaN(d.getTime())) throw Error("Invalid expiration date");
  const months: Record<string, number> = {
    Monthly: 1,
    Quarterly: 3,
    "Half-Yearly": 6,
    Yearly: 12,
  };
  if (frequency === "Custom") {
    if (!customDays || customDays < 1)
      throw Error("Custom cycle days required");
    d.setUTCDate(d.getUTCDate() + customDays);
  } else {
    const count = months[frequency];
    if (!count) throw Error("Invalid billing frequency");
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + count);
    const last = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
    ).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return d.toISOString().slice(0, 10);
}
export function csvCell(v: unknown) {
  let s = typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
  if (/^[\s]*[=+@\-]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw Error("CSV has an unclosed quoted field");
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
export function money(v: unknown) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(v) || 0);
}
