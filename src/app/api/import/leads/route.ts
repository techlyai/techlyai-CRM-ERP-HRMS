export const dynamic = "force-dynamic";
import { NextResponse, type NextRequest } from "next/server";
import { context } from "@/lib/database";
import { parseCSV } from "@/lib/domain";
import { parseXlsx } from "@/lib/reports";
import { validateRecord } from "@/lib/modules";
import { requireSameOrigin } from "@/lib/request-origin";
export async function POST(req: NextRequest) {
  try {
    requireSameOrigin(req);
    const { db, profile } = await context();
    const f = await req.formData();
    const file = f.get("file");
    if (!(file instanceof File) || file.size > 4 * 1024 * 1024)
      throw Error("Choose a CSV or XLSX file smaller than 4 MB.");
    const rows = file.name.toLowerCase().endsWith(".xlsx")
      ? parseXlsx(new Uint8Array(await file.arrayBuffer()))
      : parseCSV(await file.text());
    const header = rows.shift()?.map((h) =>
      h
        .trim()
        .toLowerCase()
        .replace(/^\ufeff/, ""),
    );
    if (
      !header ||
      !["title", "contact", "phone"].every((k) => header.includes(k))
    )
      throw Error("Required columns: title, contact, phone");
    if (rows.length > 500) throw Error("Import at most 500 leads at a time.");
    if (!rows.length) throw Error("No leads found");
    const items = rows.map((row, i) => {
      const input = Object.fromEntries(header.map((h, n) => [h, row[n] || ""]));
      const { title, ...data } = input;
      if (!title || title.length > 200)
        throw Error(
          `Row ${i + 2}: title is required and must be under 200 characters`,
        );
      return { title, data: validateRecord("leads", data) };
    });
    await db.rpc("import_leads", { p_items: items });
    return NextResponse.json({ count: items.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Import failed" },
      { status: 400 },
    );
  }
}
