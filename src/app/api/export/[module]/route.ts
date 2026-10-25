export const dynamic = "force-dynamic";
import { type NextRequest, NextResponse } from "next/server";
import { context } from "@/lib/database";
import { moduleMap, type BusinessRecord } from "@/lib/modules";
import { reportFile } from "@/lib/reports";
import { z } from "zod";
export const runtime = "nodejs";
export async function GET(
  req: NextRequest,
  { params }: { params: { module: string } },
) {
  try {
    const m = moduleMap[params.module];
    if (!m) throw Error("Unknown module");
    const { db } = await context();
    const date = z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (d) =>
          !isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d,
      );
    const from = req.nextUrl.searchParams.get("from");
    const to = req.nextUrl.searchParams.get("to");
    const records = await db.rpc<(BusinessRecord & { owner_name?: string })[]>(
      "export_records",
      {
        p_module: m.key,
        p_from: from ? date.parse(from) : null,
        p_to: to ? date.parse(to) : null,
        p_status: req.nextUrl.searchParams.get("status") || null,
        p_query: req.nextUrl.searchParams.get("q") || null,
      },
    );
    if (records.length >= 10000)
      throw Error("Report limit reached. Use a narrower company report.");
    const columns = [...new Set(records.flatMap((r) => Object.keys(r.data)))];
    const rows = [
      ["Title", "Status", "Owner", ...columns],
      ...records.map((r) => [
        r.title,
        r.status,
        r.owner_name || "Assigned employee",
        ...columns.map((k) =>
          typeof r.data[k] === "object"
            ? JSON.stringify(r.data[k])
            : String(r.data[k] ?? ""),
        ),
      ]),
    ];
    const format = req.nextUrl.searchParams.get("format") || "csv";
    const file = await reportFile(m.title, rows, format);
    if (file.bytes.length > 4 * 1024 * 1024)
      throw Error(
        "Export exceeds the download limit. Choose a narrower date range or use Excel.",
      );
    return new NextResponse(Buffer.from(file.bytes), {
      headers: {
        "Content-Type": file.mime,
        "Content-Disposition": `attachment; filename="orbit-${m.key}-${new Date().toISOString().slice(0, 10)}.${format}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Report failed" },
      { status: 400 },
    );
  }
}
