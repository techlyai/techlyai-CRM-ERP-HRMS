/** Display names for the three access levels. The database keeps `manager` for Admin. */
export type Role = "super_admin" | "manager" | "employee";
export const roleLabels: Record<Role, string> = {
  super_admin: "Super Admin",
  manager: "Admin",
  employee: "Employee",
};
export const roleDescriptions: Record<Role, string> = {
  super_admin: "Full system access. Cannot be restricted.",
  manager: "Configurable administrative access.",
  employee: "Individually assigned access.",
};
export function roleLabel(role: string) {
  return roleLabels[role as Role] || role.replace("_", " ");
}

export type Scope = "none" | "self" | "team" | "department" | "all";
export const scopes: Scope[] = ["none", "self", "team", "department", "all"];
export const scopeLabels: Record<Scope, string> = {
  none: "No access",
  self: "Own records",
  team: "Reporting team",
  department: "Department",
  all: "All records",
};
/** True when `holder` reaches everything `x` reaches (mirrors private.scope_covers). */
export function scopeCovers(holder: Scope, x: Scope) {
  return (
    x === "none" ||
    holder === "all" ||
    holder === x ||
    (x === "self" && (holder === "team" || holder === "department"))
  );
}
