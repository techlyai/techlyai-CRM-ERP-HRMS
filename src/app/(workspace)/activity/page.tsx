import Link from "next/link";
import { context } from "@/lib/database";
import type { Profile } from "@/lib/modules";
export default async function Activity({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const { db, profile } = await context();
  if (profile.role !== "super_admin")
    return (
      <p className="error">Activity logs are restricted to Super Admins.</p>
    );
  const page = Math.max(1, Number(searchParams.page) || 1);
  const [entries, people] = await Promise.all([
    db.select<{
      id: number;
      record_id: string | null;
      actor_id: string | null;
      action: string;
      snapshot: Record<string, unknown>;
      created_at: string;
    }>(
      "history",
      `select=*&order=created_at.desc&limit=51&offset=${(page - 1) * 50}`,
    ),
    db.select<Profile>("profiles"),
  ]);
  return (
    <>
      <h1 className="text-2xl font-semibold">Company activity & audit trail</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        A permanent history of record revisions and business decisions.
      </p>
      <section className="panel mt-6 divide-y">
        {entries.slice(0, 50).map((h) => (
          <div className="p-5" key={h.id}>
            <div className="flex flex-wrap justify-between gap-3">
              <p className="text-xs font-semibold">
                {h.action} ·{" "}
                {people.find((p) => p.id === h.actor_id)?.full_name || "System"}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {new Date(h.created_at).toLocaleString("en-IN")}
              </p>
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-primary">
                View recorded details
              </summary>
              <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-muted p-3 text-xs">
                {JSON.stringify(h.snapshot, null, 2)}
              </pre>
            </details>
          </div>
        ))}
        {!entries.length && (
          <p className="p-10 text-center text-sm text-muted-foreground">
            Activity will appear as your team starts using Orbit.
          </p>
        )}
      </section>
      <div className="mt-5 flex justify-end gap-4 text-xs text-primary">
        {page > 1 && (
          <Link href={"/activity?page=" + (page - 1)}>← Previous</Link>
        )}
        {entries.length > 50 && (
          <Link href={"/activity?page=" + (page + 1)}>Next →</Link>
        )}
      </div>
    </>
  );
}
