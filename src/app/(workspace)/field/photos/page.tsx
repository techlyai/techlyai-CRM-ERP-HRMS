import { context } from "@/lib/database";
import { fieldContext, loadPhotos } from "@/lib/field-data";
import { fieldParams } from "@/lib/field-params";
import type { OverviewRow } from "@/lib/field";
import { FilterBar } from "@/components/field/filter-bar";
import { PhotoGallery } from "@/components/field/photo-gallery";
export const metadata = { title: "GPS photo gallery" };

export default async function PhotosPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const { db, profile } = await context();
  const f = await fieldContext(db, profile);
  const p = fieldParams(searchParams, f.today);
  const [rows, data] = await Promise.all([
    db.rpc<OverviewRow[]>("field_overview", { p_date: f.today }),
    loadPhotos(db, p.photo ? { from: p.from, to: p.to, photo: p.photo } : p, f.timezone),
  ]);
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="section-title">GPS photo gallery</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {p.photo ? "Showing one photo. " : ""}Photos are stored privately and shown only to authorized reviewers.
          </p>
        </div>
        {f.abilities.export && (
          <a className="text-xs font-medium text-primary hover:underline" href={`/api/field/export?type=photos&from=${p.from}&to=${p.to}`}>
            Export CSV
          </a>
        )}
      </div>
      <FilterBar action="/field/photos" rows={rows} values={p} fields={["dates", "user", "tl", "department", "verification", "review", "source"]} />
      <PhotoGallery photos={data.photos} events={data.events} me={profile.id} timezone={f.timezone} initial={p.photo} empty="No photos match these filters." />
    </>
  );
}
