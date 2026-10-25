import { z } from "zod";
import { context, grants, can } from "@/lib/database";
import {
  PermissionsManager,
  type AuditEntry,
  type Effective,
  type Person,
  type Template,
} from "@/components/permissions/manager";
import type { PermissionDefinition, PermissionState } from "@/components/permissions/checklist";
import type { Role, Scope } from "@/lib/roles";
export const metadata = { title: "Roles & permissions" };
export const dynamic = "force-dynamic";

export default async function RolesPage({
  searchParams,
}: {
  searchParams: { user?: string; tab?: string };
}) {
  const { db, profile } = await context();
  const permissions = await grants(db);
  const superAdmin = profile.role === "super_admin";
  if (!superAdmin && !can(profile, permissions, "users", "permissions"))
    return (
      <div className="panel mx-auto max-w-xl p-8">
        <h1 className="text-xl font-semibold">Roles & permissions</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          You do not have permission to manage access. Ask a Super Admin if you need it.
        </p>
      </div>
    );
  const [definitions, delegableRows, profiles, employees, overrides, roleDefaults, templates] =
    await Promise.all([
      db.select<PermissionDefinition>(
        "permission_definitions",
        "select=module,action,module_label,module_group,label,description,scoped,sensitive,sort&hidden=eq.false&order=sort.asc",
      ),
      superAdmin
        ? Promise.resolve([])
        : db.rpc<{ module: string; action: string; max_scope: Scope }[]>("delegable_permissions"),
      db.select<{
        id: string;
        full_name: string;
        employee_id: string | null;
        department: string | null;
        role: Role;
        active: boolean;
      }>("profiles", "select=id,full_name,employee_id,department,role,active&order=full_name.asc&limit=5000"),
      db.select<{ owner_id: string; data: { designation?: string } }>(
        "records",
        "select=owner_id,data&module=eq.employees&status=neq.Archived&limit=5000",
      ),
      db.select<{ user_id: string }>("permission_grants", "select=user_id&user_id=not.null&limit=10000"),
      superAdmin
        ? db.select<{ role: string; module: string; action: string; scope: Scope }>(
            "permission_grants",
            "select=role,module,action,scope&role=not.null&limit=5000",
          )
        : Promise.resolve([]),
      db.select<Template>("permission_templates", "select=*&order=name.asc&limit=500"),
    ]);
  const designation = new Map(employees.map((e) => [e.owner_id, e.data?.designation || null]));
  const overrideCount = new Map<string, number>();
  for (const o of overrides) overrideCount.set(o.user_id, (overrideCount.get(o.user_id) || 0) + 1);
  const people: Person[] = profiles.map((p) => ({
    ...p,
    designation: designation.get(p.id) || null,
    overrides: overrideCount.get(p.id) || 0,
  }));
  const delegable: PermissionState | null = superAdmin
    ? null
    : Object.fromEntries(delegableRows.map((d) => [`${d.module}.${d.action}`, d.max_scope]));

  let selected: { person: Person; effective: Effective[]; audit: AuditEntry[] } | null = null;
  const requested = z.string().uuid().safeParse(searchParams.user);
  const person = requested.success ? people.find((p) => p.id === requested.data) : undefined;
  if (person) {
    const [effective, audit] = await Promise.all([
      db.rpc<Effective[]>("effective_permissions", { p_user: person.id }).catch(() => []),
      db.select<AuditEntry>(
        "permission_audit",
        `select=id,actor_id,source,changes,reason,created_at&target_user=eq.${person.id}&order=created_at.desc&limit=50`,
      ),
    ]);
    if (effective.length) selected = { person, effective, audit };
  }
  const tab = searchParams.tab === "roles" && superAdmin ? "roles" : searchParams.tab === "templates" ? "templates" : "employees";
  return (
    <PermissionsManager
      me={{ id: profile.id, role: profile.role as Role }}
      definitions={definitions}
      delegable={delegable}
      people={people}
      selected={selected}
      roleDefaults={roleDefaults}
      templates={templates}
      initialTab={tab}
    />
  );
}
