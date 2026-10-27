import { jsPDF } from "jspdf";

export type ReceiptData = {
  payment: { receipt_no: string | number; amount: string | number; paid_on: string; mode: string; reference: string; note: string };
  client: { name: string; business_name: string; website_url: string; phone: string };
  periods: string[];
  contact: { name?: string; phone?: string; email?: string } | null;
};
// The built-in PDF font is Latin-1 only, so ₹ is written as "Rs." (see reports.ts).
const plain = (s: string) => s.replace(/₹/g, "Rs. ").replace(/[^\x20-\x7e\xa0-\xff]/g, "?");
const amount = (v: string | number) => "Rs. " + Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function receiptPdf(r: ReceiptData): Uint8Array {
  const doc = new jsPDF({ format: "a5", unit: "mm" });
  // Issuer details come from MMC → Settings → contact; nothing is printed when they are empty.
  const issuer = r.contact?.name || "";
  doc.setFontSize(18);
  doc.setTextColor(85, 45, 170);
  if (issuer) doc.text(plain(issuer), 12, 18);
  doc.setFontSize(9);
  doc.setTextColor(110, 110, 120);
  doc.text(plain([r.contact?.phone, r.contact?.email].filter(Boolean).join("  ·  ")), 12, 24);
  doc.setFontSize(13);
  doc.setTextColor(30, 30, 40);
  doc.text("Payment receipt", 12, 38);
  doc.setFontSize(9);
  doc.text(`Receipt no. MMC-${String(r.payment.receipt_no).padStart(5, "0")}`, 136, 38, { align: "right" });
  doc.setDrawColor(220, 220, 230);
  doc.line(12, 42, 136, 42);
  const rows: [string, string][] = [
    ["Received from", r.client.business_name ? `${r.client.name} (${r.client.business_name})` : r.client.name],
    ["Website", r.client.website_url || "-"],
    ["Payment date", new Date(r.payment.paid_on + "T00:00:00Z").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })],
    ["Mode", r.payment.mode + (r.payment.reference ? ` · Ref ${r.payment.reference}` : "")],
    ["For", r.periods.length ? "Monthly maintenance: " + r.periods.join(", ") : "Monthly maintenance (advance)"],
  ];
  if (r.payment.note) rows.push(["Note", r.payment.note]);
  let y = 52;
  doc.setFontSize(10);
  for (const [k, v] of rows) {
    doc.setTextColor(110, 110, 120);
    doc.text(k, 12, y);
    doc.setTextColor(30, 30, 40);
    const lines = doc.splitTextToSize(plain(v), 82) as string[];
    doc.text(lines, 54, y);
    y += 7 * lines.length;
  }
  doc.setFillColor(245, 242, 252);
  doc.roundedRect(12, y + 2, 124, 16, 2, 2, "F");
  doc.setFontSize(10);
  doc.setTextColor(85, 45, 170);
  doc.text("Amount received", 17, y + 12);
  doc.setFontSize(14);
  doc.text(amount(r.payment.amount), 131, y + 12, { align: "right" });
  doc.setFontSize(8);
  doc.setTextColor(140, 140, 150);
  doc.text("This is a computer-generated receipt and does not need a signature.", 12, 196);
  doc.text("Orbit · A Techly project", 136, 196, { align: "right" });
  return new Uint8Array(doc.output("arraybuffer"));
}
