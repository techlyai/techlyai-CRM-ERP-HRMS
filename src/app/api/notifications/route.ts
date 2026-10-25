export const dynamic = "force-dynamic";
import { context } from "@/lib/database";
import { notificationCategories } from "@/lib/notification-types";
import { NextResponse, type NextRequest } from "next/server";
/** Category group names (lower case) that can be passed as ?category=reports. */
const groups: Record<string, string[]> = {};
for (const c of notificationCategories)
  (groups[c.group.toLowerCase()] ||= []).push(c.key);
const known = new Set(notificationCategories.map((c) => c.key));
/**
 * GET /api/notifications
 *   ?unread=1            only unread rows
 *   ?since=<ISO 8601>    rows created at or after the timestamp
 *   ?category=<a,b|group> one or more categories, or a group (reminders, team, reports, business, work, operations)
 *   ?limit=1..100 (default 100)  ?offset=n
 * Returns rows with priority, link and meta; X-Techly-Unread carries the unread count.
 */
export async function GET(req: NextRequest) {
  const { db } = await context();
  const q = req.nextUrl.searchParams;
  const filters: string[] = [];
  if (["1", "true"].includes(q.get("unread") || "")) filters.push("read_at=is.null");
  const since = q.get("since");
  if (since) {
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(since) ||
      Number.isNaN(Date.parse(since))
    )
      return NextResponse.json({ error: "Invalid since" }, { status: 400 });
    filters.push("created_at=gte." + since);
  }
  const category = (q.get("category") || "").trim().toLowerCase();
  if (category) {
    const keys = groups[category]
      ? groups[category]
      : category.split(",").map((c) => c.trim());
    if (!keys.length || keys.some((k) => !known.has(k)))
      return NextResponse.json({ error: "Unknown category" }, { status: 400 });
    filters.push(
      keys.length === 1 ? "category=eq." + keys[0] : "category=in.(" + keys.join(",") + ")",
    );
  }
  const limit = Number(q.get("limit") || 100);
  const offset = Number(q.get("offset") || 0);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 100000
  )
    return NextResponse.json({ error: "Invalid pagination" }, { status: 400 });
  const [items, unread] = await Promise.all([
    db.select(
      "notifications",
      ["select=*", ...filters, "order=created_at.desc", "limit=" + limit, "offset=" + offset].join("&"),
    ),
    db.select("notifications", "select=id&read_at=is.null&limit=100"),
  ]);
  return NextResponse.json(items, {
    headers: {
      "Cache-Control": "private, no-store",
      "X-Techly-Unread": String(unread.length),
    },
  });
}
