import { context } from "@/lib/database";
import { fieldContext, loadPhotos } from "@/lib/field-data";
import { fieldParams } from "@/lib/field-params";
import type { OverviewRow } from "@/lib/field";
import { FilterBar } from "@/components/field/filter-bar";
import { PhotoGallery } from "@/components/field/photo-gallery";
export const metadata = { title: "Geofence verification review" };

export default async function ReviewPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const { db, profile } = await context();
  const f = await fieldContext(db, profile);
  if (!f.abilities.view)
    return <p className="panel p-6 text-sm text-muted-foreground">You do not have permission to review field photos.</p>;
  const p = fieldParams(searchParams, f.today, 30);
  const [rows, data] = await Promise.all([
    db.rpc<OverviewRow[]>("field_overview", { p_date: f.today }),
    loadPhotos(db, p.photo ? { from: p.from, to: p.to, photo: p.photo } : { ...p, queue: !p.review }, f.timezone),
  ]);
  return (
    <>
      <div className="mb-3">
        <h2 className="section-title">Geofence verification review</h2>
        <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
          Photos outside the geofence, with missing or inaccurate GPS, from the gallery, or without an expected location, that still
          need a decision. “Within geofence” means the device reported a position inside the boundary; it does not prove where the
          photo was taken.
        </p>
      </div>
      <FilterBar action="/field/review" rows={rows} values={p} fields={["dates", "user", "tl", "department", "verification", "review", "source"]} />
      <PhotoGallery photos={data.photos} events={data.events} me={profile.id} timezone={f.timezone} initial={p.photo} empty="Nothing is waiting for review." />
    </>
  );
}
