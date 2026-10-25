import { context, grants, can, scopeOf } from "@/lib/database";
import type { Profile } from "@/lib/modules";
import type { CompanySettings } from "@/components/settings";
import {
  OfficeLocations,
  type Assignment,
  type LocationAuditEntry,
  type OfficeLocation,
} from "@/components/office-locations";
export const metadata = { title: "Office locations & geofencing" };
export const dynamic = "force-dynamic";

export default async function LocationsPage() {
  const { db, profile } = await context();
  const permissions = await grants(db);
  const superAdmin = profile.role === "super_admin";
  const abilities = {
    manage: can(profile, permissions, "locations", "manage"),
    assign: can(profile, permissions, "locations", "assign"),
    retention: can(profile, permissions, "settings", "location_retention"),
  };
  if (!superAdmin && !abilities.manage && !abilities.assign && !can(profile, permissions, "locations", "view"))
    return (
      <div className="panel mx-auto max-w-xl p-8">
        <h1 className="text-xl font-semibold">Office locations & geofencing</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          You do not have permission to view office locations. Ask a Super Admin if you need it.
        </p>
      </div>
    );
  const [offices, assignments, people, audit, settings] = await Promise.all([
    db.select<OfficeLocation>("office_locations", "select=*&order=name.asc"),
    db.select<Assignment>("attendance_assignments", "select=*"),
    db.select<Profile & { employee_id: string | null }>(
      "profiles",
      "select=id,full_name,role,department,manager_id,employee_id,active&active=eq.true&order=full_name.asc",
    ),
    db.select<LocationAuditEntry>("location_audit", "select=*&order=id.desc&limit=100"),
    abilities.retention
      ? db.select<{ data: CompanySettings }>("settings", "select=data&id=eq.1")
      : Promise.resolve([]),
  ]);
  // Who this person may reassign (UI hint; set_attendance_location enforces it).
  const scope = scopeOf(profile, permissions, "locations", "assign");
  const assignable = people
    .filter(
      (p) =>
        superAdmin ||
        (p.role !== "super_admin" &&
          p.id !== profile.id &&
          (scope === "all" ||
            (scope === "team" && p.manager_id === profile.id) ||
            (scope === "department" && Boolean(profile.department) && p.department === profile.department))),
    )
    .map((p) => p.id);
  return (
    <OfficeLocations
      offices={offices}
      assignments={assignments}
      people={people}
      audit={audit}
      assignable={assignable}
      abilities={abilities}
      settings={settings[0]?.data || null}
    />
  );
}
