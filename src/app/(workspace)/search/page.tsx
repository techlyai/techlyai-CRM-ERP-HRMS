import Link from "next/link";
import { context } from "@/lib/database";
import { type BusinessRecord, moduleMap } from "@/lib/modules";
import { Status } from "@/components/ui/status";
export default async function SearchPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const { db } = await context();
  const q = (searchParams.q || "")
    .replace(/[^\p{L}\p{N} @.+-]/gu, "")
    .slice(0, 100);
  const records = q
    ? await db.select<BusinessRecord>(
        "records",
        "select=*&status=neq.Archived&title=ilike." +
          encodeURIComponent("*" + q + "*") +
          "&order=updated_at.desc&limit=100",
      )
    : [];
  return (
    <>
      <h1 className="text-2xl font-semibold">Search your workspace</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Searches include only records you can access.
      </p>
      <form className="my-6 flex max-w-xl gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by record title"
          aria-label="Search records"
        />
        <button className="rounded-lg bg-primary px-5 text-xs text-white">
          Search
        </button>
      </form>
      <section className="panel divide-y">
        {records.map((r) => (
          <Link
            key={r.id}
            href={`/modules/${r.module}/${r.id}`}
            className="flex items-center justify-between gap-3 p-5 hover:bg-muted"
          >
            <div>
              <p className="text-sm font-semibold">{r.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {moduleMap[r.module]?.title}
              </p>
            </div>
            <Status value={r.status} />
          </Link>
        ))}
        {!records.length && (
          <p className="p-8 text-center text-sm text-muted-foreground">
            {q
              ? "No matching authorized records."
              : "Enter a title to find a record."}
          </p>
        )}
        {records.length === 100 && (
          <p className="p-4 text-xs text-muted-foreground">
            Showing the first 100 matches. Refine your search for more precise
            results.
          </p>
        )}
      </section>
    </>
  );
}
