import { NextResponse } from "next/server";
import { serviceDB } from "@/lib/database";
export const noStore = { "Cache-Control": "private, no-store" };
export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: noStore });
}
export function fail(message: string, status = 400) {
  return json({ error: message }, status);
}
/** Route wrapper: surfaces errors as JSON and lets auth redirects through. */
export async function handle(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (e) {
    if (
      e instanceof Error &&
      (e.message === "NEXT_REDIRECT" ||
        (e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT"))
    )
      throw e;
    return fail(e instanceof Error ? e.message : "Request failed");
  }
}
/** Builds a filter string for Database.select with every value safely encoded. */
export function filter(params: Record<string, string>) {
  return new URLSearchParams(params).toString();
}
export function chunk<T>(items: T[], size = 100) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
export const inList = (ids: string[]) => "in.(" + ids.join(",") + ")";
export const unique = (ids: (string | null | undefined)[]) =>
  Array.from(new Set(ids.filter((v): v is string => Boolean(v))));
/**
 * Display names for people referenced by rows the caller can already read.
 * Profiles are RLS-restricted for employees, so names (and nothing else) are
 * resolved with the service role, limited to the ids passed in.
 */
export async function namesFor(ids: (string | null | undefined)[]) {
  const map = new Map<string, { full_name: string; role: string }>();
  const wanted = unique(ids);
  if (!wanted.length) return map;
  const db = serviceDB();
  for (const part of chunk(wanted)) {
    const rows = await db.select<{ id: string; full_name: string; role: string }>(
      "profiles",
      filter({ select: "id,full_name,role", id: inList(part) }),
    );
    for (const row of rows)
      map.set(row.id, { full_name: row.full_name, role: row.role });
  }
  return map;
}
export const nameOf = (
  names: Map<string, { full_name: string }>,
  id: string,
) => names.get(id)?.full_name || "Former member";
